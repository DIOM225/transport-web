import React, { useEffect, useRef, useState, useCallback } from 'react';
import Map, { Layer, Marker, Source, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ||
  'https://transport-api-production-d0c6.up.railway.app';

type ReplayPos = {
  lat: number;
  lng: number;
  speedKmh: number | null;
  headingDeg: number | null;
  ts: number | null;
};

type ReplayData = {
  tripId: string;
  busNumber: string;
  busPlate: string | null;
  routeName: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMin: number | null;
  distanceKm: number | null;
  positions: ReplayPos[];
};

const PLAY_INTERVAL_MS = 120; // ms between auto-advances
const SPEEDS = [1, 2, 4, 8] as const;

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDuration(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}min` : `${m} min`;
}

export default function TripReplayModal({
  tripId,
  token,
  onClose,
}: {
  tripId: string;
  token: string;
  onClose: () => void;
}) {
  const mapRef = useRef<MapRef>(null);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<typeof SPEEDS[number]>(2);

  // ── Fetch replay data ──────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/trips/${tripId}/replay`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d: ReplayData) => { setData(d); setIdx(0); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tripId, token]);

  // ── Fit map to path once data loads ────────────────────────────────────────
  useEffect(() => {
    if (!data || data.positions.length < 2) return;
    const lngs = data.positions.map((p) => p.lng);
    const lats = data.positions.map((p) => p.lat);
    setTimeout(() => {
      mapRef.current?.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 48, duration: 600 },
      );
    }, 300);
  }, [data]);

  // ── Pan map to current position as index advances ──────────────────────────
  useEffect(() => {
    if (!data) return;
    const pos = data.positions[idx];
    if (!pos) return;
    mapRef.current?.panTo({ lat: pos.lat, lng: pos.lng }, { duration: 200 });
  }, [idx, data]);

  // ── Play / pause ───────────────────────────────────────────────────────────
  const stopPlay = useCallback(() => {
    if (playRef.current) { clearInterval(playRef.current); playRef.current = null; }
    setPlaying(false);
  }, []);

  const startPlay = useCallback(() => {
    if (!data) return;
    setPlaying(true);
    playRef.current = setInterval(() => {
      setIdx((prev) => {
        if (prev >= data.positions.length - 1) {
          stopPlay();
          return prev;
        }
        return prev + speed;
      });
    }, PLAY_INTERVAL_MS);
  }, [data, speed, stopPlay]);

  useEffect(() => { return () => stopPlay(); }, [stopPlay]);

  useEffect(() => {
    if (playing) { stopPlay(); startPlay(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  const togglePlay = () => (playing ? stopPlay() : startPlay());

  // ── Derived ────────────────────────────────────────────────────────────────
  const pos = data?.positions[idx];
  const total = data?.positions.length ?? 0;

  const geojsonLine = data && data.positions.length >= 2 ? {
    type: 'Feature' as const,
    properties: null,
    geometry: {
      type: 'LineString' as const,
      coordinates: data.positions.map((p) => [p.lng, p.lat]),
    },
  } : null;

  const geojsonDone = data && idx > 0 ? {
    type: 'Feature' as const,
    properties: null,
    geometry: {
      type: 'LineString' as const,
      coordinates: data.positions.slice(0, idx + 1).map((p) => [p.lng, p.lat]),
    },
  } : null;

  // ── Initial map center: Abidjan fallback ───────────────────────────────────
  const initLat = data?.positions[0]?.lat ?? 5.345;
  const initLng = data?.positions[0]?.lng ?? -4.025;

  // ── Styles ─────────────────────────────────────────────────────────────────
  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const modal: React.CSSProperties = {
    background: '#fff', borderRadius: 18,
    width: 'min(95vw, 900px)', height: 'min(90vh, 680px)',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 950, fontSize: 15, color: '#111827' }}>
              Replay — Bus {data?.busNumber ?? '…'}{data?.busPlate ? ` · ${data.busPlate}` : ''}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginTop: 2 }}>
              {data?.routeName ?? '…'} · {fmtDate(data?.startedAt)} · {fmtTime(data?.startedAt)} → {fmtTime(data?.endedAt)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {data && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ padding: '2px 8px', borderRadius: 6, background: '#e0f2fe', color: '#075985', fontSize: 11, fontWeight: 800 }}>{fmtDuration(data.durationMin)}</span>
                {data.distanceKm != null && (
                  <span style={{ padding: '2px 8px', borderRadius: 6, background: '#f0fdf4', color: '#166534', fontSize: 11, fontWeight: 800 }}>{data.distanceKm.toFixed(1)} km</span>
                )}
              </div>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280', lineHeight: 1, padding: '0 4px' }}>✕</button>
          </div>
        </div>

        {/* ── Map ── */}
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', zIndex: 10, fontSize: 13, color: '#6b7280', fontWeight: 700 }}>
              Chargement du trajet…
            </div>
          )}
          {error && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fef2f2', zIndex: 10, fontSize: 13, color: '#dc2626', fontWeight: 700 }}>
              {error}
            </div>
          )}
          {!loading && !error && (
            <Map
              ref={mapRef}
              initialViewState={{ latitude: initLat, longitude: initLng, zoom: 12 }}
              style={{ width: '100%', height: '100%' }}
              mapStyle="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
            >
              {/* Full ghost path */}
              {geojsonLine && (
                <Source id="path-ghost" type="geojson" data={geojsonLine}>
                  <Layer id="path-ghost-line" type="line" paint={{ 'line-color': '#d1d5db', 'line-width': 3, 'line-dasharray': [2, 2] }} />
                </Source>
              )}

              {/* Replayed portion */}
              {geojsonDone && (
                <Source id="path-done" type="geojson" data={geojsonDone}>
                  <Layer id="path-done-line" type="line" paint={{ 'line-color': '#2563eb', 'line-width': 4 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
                </Source>
              )}

              {/* Start marker */}
              {data && data.positions.length > 0 && (
                <Marker latitude={data.positions[0].lat} longitude={data.positions[0].lng} anchor="center">
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#16a34a', border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
                </Marker>
              )}

              {/* End marker */}
              {data && data.positions.length > 1 && (
                <Marker latitude={data.positions[data.positions.length - 1].lat} longitude={data.positions[data.positions.length - 1].lng} anchor="center">
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#dc2626', border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
                </Marker>
              )}

              {/* Moving bus marker */}
              {pos && (
                <Marker latitude={pos.lat} longitude={pos.lng} anchor="center">
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%',
                    background: '#2563eb', border: '3px solid #fff',
                    boxShadow: '0 2px 8px rgba(37,99,235,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, transform: pos.headingDeg != null ? `rotate(${pos.headingDeg}deg)` : undefined,
                  }}>
                    🚌
                  </div>
                </Marker>
              )}
            </Map>
          )}
        </div>

        {/* ── Controls ── */}
        {data && data.positions.length > 0 && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid #e5e7eb', flexShrink: 0, background: '#f9fafb' }}>

            {/* Speed + time info */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {/* Play/pause */}
                <button
                  onClick={togglePlay}
                  style={{ width: 34, height: 34, borderRadius: '50%', background: '#2563eb', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {playing ? '⏸' : '▶'}
                </button>

                {/* Speed multiplier */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSpeed(s)}
                      style={{ padding: '2px 7px', borderRadius: 6, border: '1px solid #e5e7eb', background: speed === s ? '#2563eb' : '#fff', color: speed === s ? '#fff' : '#374151', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              </div>

              {/* Current stats */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, fontWeight: 800, color: '#374151' }}>
                {pos?.speedKmh != null && (
                  <span style={{ color: pos.speedKmh > 90 ? '#dc2626' : '#111827' }}>{Math.round(pos.speedKmh)} km/h</span>
                )}
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>
                  {idx + 1} / {total}
                </span>
              </div>
            </div>

            {/* Scrubber */}
            <input
              type="range"
              min={0}
              max={total - 1}
              value={idx}
              onChange={(e) => { stopPlay(); setIdx(Number(e.target.value)); }}
              style={{ width: '100%', accentColor: '#2563eb', cursor: 'pointer' }}
            />

            {/* Time label */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', fontWeight: 700, marginTop: 2 }}>
              <span>{fmtTime(data.startedAt)}</span>
              <span>{fmtTime(data.endedAt)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
