import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getToken } from '../lib/auth';
import { sendPosition } from '../lib/driver';

type DriverStatus = 'OFFLINE' | 'ONLINE';

type GeoState = {
  supported: boolean;
  permission: 'unknown' | 'granted' | 'denied' | 'prompt';
  tracking: boolean;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  speedMs?: number | null;
  headingDeg?: number | null;
  timestamp?: number;
  error?: string | null;
};

type PositionPayload = {
  lat: number;
  lng: number;
  accuracyM: number;
  speedMs?: number | null;
  headingDeg?: number | null;
  timestamp: number;
};

const styles: {
  grid: React.CSSProperties;
  card: React.CSSProperties;
  title: React.CSSProperties;
  sub: React.CSSProperties;
  row: React.CSSProperties;
  btn: React.CSSProperties;
  btnDark: React.CSSProperties;
  btnDisabled: React.CSSProperties;
  pill: (ok: boolean) => React.CSSProperties;
  kv: React.CSSProperties;
  mono: React.CSSProperties;
  errorBox: React.CSSProperties;
} = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 14,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: 16,
    boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
  },
  title: { margin: 0, fontSize: 16, fontWeight: 900, color: '#111827' },
  sub: {
    marginTop: 6,
    marginBottom: 0,
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 1.5,
  },
  row: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  btn: {
    padding: '10px 12px',
    borderRadius: 12,
    border: 'none',
    background: '#fbbf24',
    color: '#111827',
    fontWeight: 900,
    cursor: 'pointer',
  },
  btnDark: {
    padding: '10px 12px',
    borderRadius: 12,
    border: 'none',
    background: '#111827',
    color: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
  },
  btnDisabled: { opacity: 0.65, cursor: 'not-allowed' },
  pill: (ok: boolean): React.CSSProperties => ({
    padding: '6px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    background: ok ? '#dcfce7' : '#fee2e2',
    color: ok ? '#166534' : '#991b1b',
  }),
  kv: {
    marginTop: 10,
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 12,
    background: '#fafafa',
  },
  mono: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  errorBox: {
    marginTop: 12,
    padding: '10px 12px',
    borderRadius: 12,
    background: '#fee2e2',
    color: '#991b1b',
    fontSize: 13,
    fontWeight: 800,
  },
};

function formatTime(ts?: number) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

function normalizeGeoError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as any).message || '');
    if (msg) return msg;
  }
  return 'Erreur GPS inconnue.';
}

export default function DriverDashboard() {
  const [status, setStatus] = useState<DriverStatus>('OFFLINE');

  const [geo, setGeo] = useState<GeoState>(() => ({
    supported: typeof navigator !== 'undefined' && 'geolocation' in navigator,
    permission: 'unknown',
    tracking: false,
    error: null,
  }));

  // --- WebSocket (Socket.IO) ---
  const socketRef = useRef<Socket | null>(null);
  const [wsStatus, setWsStatus] = useState<'OFF' | 'ON' | 'ERR'>('OFF');
  const [wsError, setWsError] = useState<string | null>(null);

  // last known payload (used on reconnect)
  const lastPayloadRef = useRef<PositionPayload | null>(null);

  // throttle sending (REST+WS) so we don’t spam
  const lastSentAtRef = useRef<number>(0);
  const [lastSentAtUi, setLastSentAtUi] = useState<number | null>(null);
  const SEND_INTERVAL_MS = 1000; // 1s is plenty for MVP

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setWsStatus('OFF');
      setWsError('Non connecté (token manquant).');
      return;
    }

    // Nest gateway uses namespace '/ws'
    const socket = io('http://localhost:3000/ws', {
      auth: { token },
      transports: ['polling', 'websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 10000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setWsStatus('ON');
      setWsError(null);

      // On reconnect, immediately push the last known position (if any)
      const last = lastPayloadRef.current;
      if (last) {
        socket.emit('position:update', last);
      }
    });

    socket.on('disconnect', (reason) => {
      // Don’t mark as ERR; it might reconnect automatically.
      setWsStatus('OFF');
      setWsError(reason ? `Déconnecté: ${reason}` : 'Déconnecté');
    });

    socket.on('connect_error', (err) => {
      setWsStatus('ERR');
      setWsError(err?.message || 'Erreur WebSocket');
      // keep console for debugging
      console.error('WS connect_error:', err?.message || err);
    });

    socket.on('position:ack', (_) => {
      // optional debug
      // console.log('WS ack:', msg);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // watchPosition id (must be cleared)
  const watchIdRef = useRef<number | null>(null);

  // Safety: avoid setting state after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Best-effort permission read (doesn't block if unsupported)
  useEffect(() => {
    let cancelled = false;

    async function checkPermission() {
      try {
        const navAny = navigator as any;
        if (!navAny?.permissions?.query) {
          if (!cancelled) setGeo((s) => ({ ...s, permission: 'unknown' }));
          return;
        }

        const p = await navAny.permissions.query({ name: 'geolocation' });
        const state = (p.state as 'granted' | 'denied' | 'prompt') ?? 'unknown';

        if (!cancelled && mountedRef.current) {
          setGeo((s) => ({ ...s, permission: state }));
        }

        p.onchange = () => {
          if (!cancelled && mountedRef.current) {
            setGeo((s) => ({ ...s, permission: (p.state as any) ?? 'unknown' }));
          }
        };
      } catch {
        if (!cancelled && mountedRef.current) {
          setGeo((s) => ({ ...s, permission: 'unknown' }));
        }
      }
    }

    checkPermission();
    return () => {
      cancelled = true;
    };
  }, []);

  const canUseGps = useMemo(() => geo.supported, [geo.supported]);

  function stopTracking() {
    if (watchIdRef.current !== null && canUseGps) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;

    setGeo((s) => ({
      ...s,
      tracking: false,
    }));
  }

  function sendBoth(payload: PositionPayload) {
    const now = Date.now();
    if (now - lastSentAtRef.current < SEND_INTERVAL_MS) return;
  
    lastSentAtRef.current = now;
    setLastSentAtUi(now);
  
    const restPayload = {
      ...payload,
      speedMs: payload.speedMs ?? null,
      headingDeg: payload.headingDeg ?? null,
    };
  
    void sendPosition(restPayload).catch(() => {
      // keep silent for now (no UI spam)
    });
  
    socketRef.current?.emit('position:update', payload);
  }

  async function startTracking() {
    if (!canUseGps) {
      setGeo((s) => ({ ...s, error: 'GPS non supporté sur cet appareil / navigateur.' }));
      return;
    }
    if (geo.tracking) return;

    setGeo((s) => ({ ...s, tracking: true, error: null }));

    try {
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          const c = pos.coords;
          if (!mountedRef.current) return;

          const payload: PositionPayload = {
            lat: c.latitude,
            lng: c.longitude,
            accuracyM: c.accuracy,
            speedMs: c.speed ?? null,
            headingDeg: c.heading ?? null,
            timestamp: pos.timestamp,
          };

          lastPayloadRef.current = payload;

          setGeo((s) => ({
            ...s,
            tracking: true,
            ...payload,
            error: null,
          }));

          sendBoth(payload);
        },
        (err) => {
          if (!mountedRef.current) return;

          const message =
            err?.code === 1
              ? 'Permission GPS refusée. Activez la localisation dans le navigateur.'
              : err?.code === 2
                ? 'Position indisponible (signal faible).'
                : err?.code === 3
                  ? 'Timeout GPS. Réessayez.'
                  : normalizeGeoError(err);

          setGeo((s) => ({ ...s, tracking: false, error: message }));
          stopTracking();
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5_000,
          timeout: 15_000,
        },
      );

      watchIdRef.current = id;
    } catch (e) {
      setGeo((s) => ({ ...s, tracking: false, error: normalizeGeoError(e) }));
      stopTracking();
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && geo.supported) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleOnline() {
    if (status === 'OFFLINE') {
      setStatus('ONLINE');
      void startTracking();
      return;
    }

    setStatus('OFFLINE');
    stopTracking();
  }

  const online = status === 'ONLINE';

  return (
    <div style={styles.grid}>
      <div style={styles.card}>
        <h3 style={styles.title}>Statut</h3>
        <p style={styles.sub}>
          {online
            ? 'En ligne. La position est suivie en continu.'
            : 'Hors-ligne. Activez “Aller en ligne” pour démarrer le suivi GPS.'}
        </p>

        <div style={styles.row}>
          <div style={styles.pill(online)}>{online ? 'EN LIGNE' : 'HORS LIGNE'}</div>

          <div
            style={{
              ...styles.pill(geo.tracking),
              background: geo.tracking ? '#dcfce7' : '#e5e7eb',
              color: geo.tracking ? '#166534' : '#111827',
            }}
          >
            {geo.tracking ? 'GPS ACTIF' : 'GPS INACTIF'}
          </div>

          <div
            style={{
              ...styles.pill(wsStatus === 'ON'),
              background: wsStatus === 'ON' ? '#dcfce7' : wsStatus === 'ERR' ? '#fee2e2' : '#e5e7eb',
              color: wsStatus === 'ON' ? '#166534' : wsStatus === 'ERR' ? '#991b1b' : '#111827',
            }}
            title={wsError ?? ''}
          >
            WS {wsStatus}
          </div>
        </div>

        <div style={styles.row}>
          <button style={styles.btnDark} onClick={toggleOnline}>
            {online ? 'Arrêter le service' : 'Aller en ligne'}
          </button>

          <button
            style={{
              ...styles.btn,
              ...(online && geo.tracking ? {} : styles.btnDisabled),
            }}
            disabled={!(online && geo.tracking)}
            onClick={() => {
              alert('MVP: shift démarré (placeholder). Prochaine étape: event backend + audit.');
            }}
          >
            Démarrer le shift
          </button>
        </div>

        {lastSentAtUi && (
          <p style={{ ...styles.sub, marginTop: 10 }}>
            Dernier envoi: <span style={styles.mono}>{formatTime(lastSentAtUi)}</span>
          </p>
        )}

        {wsError && <p style={{ ...styles.sub, marginTop: 6 }}>WS: {wsError}</p>}

        {geo.error && <div style={styles.errorBox}>{geo.error}</div>}
      </div>

      <div style={styles.card}>
        <h3 style={styles.title}>Mission / Destination</h3>
        <p style={styles.sub}>Placeholder: prochaine mission + bouton navigation (Google/Apple Maps) + ETA.</p>
      </div>

      <div style={styles.card}>
        <h3 style={styles.title}>Position</h3>
        <p style={styles.sub}>
          GPS: {geo.supported ? 'supporté' : 'non supporté'} · Permission: {geo.permission}
        </p>

        <div style={styles.kv}>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8 }}>
            <div style={{ fontWeight: 900, color: '#111827' }}>Latitude</div>
            <div style={styles.mono}>{geo.lat ?? '—'}</div>

            <div style={{ fontWeight: 900, color: '#111827' }}>Longitude</div>
            <div style={styles.mono}>{geo.lng ?? '—'}</div>

            <div style={{ fontWeight: 900, color: '#111827' }}>Précision</div>
            <div style={styles.mono}>{geo.accuracyM ? `${Math.round(geo.accuracyM)} m` : '—'}</div>

            <div style={{ fontWeight: 900, color: '#111827' }}>Vitesse</div>
            <div style={styles.mono}>
              {geo.speedMs === null || geo.speedMs === undefined ? '—' : `${(geo.speedMs * 3.6).toFixed(1)} km/h`}
            </div>

            <div style={{ fontWeight: 900, color: '#111827' }}>Dernière maj</div>
            <div style={styles.mono}>{formatTime(geo.timestamp)}</div>
          </div>
        </div>

        <div style={styles.row}>
          <button
            style={{ ...styles.btn, ...(geo.tracking ? styles.btnDisabled : {}) }}
            disabled={geo.tracking}
            onClick={() => void startTracking()}
          >
            Activer GPS
          </button>

          <button
            style={{ ...styles.btnDark, ...(geo.tracking ? {} : styles.btnDisabled) }}
            disabled={!geo.tracking}
            onClick={stopTracking}
          >
            Stop GPS
          </button>
        </div>

        <p style={{ ...styles.sub, marginTop: 12 }}>
          Prochaine étape: envoyer la position vers l’API (REST) ou WebSocket pour affichage temps réel côté Admin.
        </p>
      </div>
    </div>
  );
}
