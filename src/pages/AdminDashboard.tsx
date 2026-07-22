import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getToken, clearSession } from '../lib/auth';
import TripReplayModal from './TripReplayModal';

import Map, { Marker, Popup, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

type UserRole = 'ADMIN' | 'OPERATOR' | 'DRIVER';
type FleetStatus = 'ONLINE' | 'STALE' | 'OFFLINE';
type MotionStatus = 'MOVING' | 'IDLE';

const STALE_AFTER_MS  = 3  * 60_000; // 3 min silence → amber badge (synced with server ONLINE_AFTER_MS)
const OFFLINE_AFTER_MS = 10 * 60_000; // 10 min silence → red / offline

const STALE_MS = 2 * 60 * 60 * 1000;       // 2 hours — remove from map
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes — cleanup check interval

type FleetPosition = {
  userId: string;
  phone?: string;
  role?: UserRole;

  lat: number;
  lng: number;
  accuracyM: number;

  // New (from backend)
  speedKmh?: number | null;
  rawSpeedKmh?: number | null;
  fleetStatus?: FleetStatus;
  motionStatus?: MotionStatus;
  lastSeenAt?: number; // server timestamp
  ageMs?: number;

  // Optional future fields
  confidence?: number; // 0..1 (if backend sends it)
  tripId?: string | null;
  routeId?: string | null;
  busId?: string | null;

  // Backward compatibility (old payloads)
  speedMs?: number | null;
  headingDeg?: number | null;
  timestamp?: number; // old server timestamp
};

type AdminUser = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type Bus = {
  id: string;
  number: string;
  plate: string | null;
  isActive: boolean;
  createdAt: string;
};

type Route = {
  id: string;
  name: string;
  origin: string;
  destination: string;
  speedLimitKmh: number;
  originLat: number | null;
  originLng: number | null;
  waypointName: string | null;
  waypointLat: number | null;
  waypointLng: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
  geofenceRadiusM: number;
  originStopId: string | null;
  waypointStopId: string | null;
  destinationStopId: string | null;
  isActive: boolean;
  createdAt: string;
};

type Stop = {
  id: string;
  name: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  capturedAt: string | null;
  createdAt: string;
};

type TripStatus = 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

type Trip = {
  id: string;
  driverId: string | null;
  busId: string;
  routeId: string;
  status: TripStatus;
  startedAt: string | null;
  endedAt: string | null;
  durationMin: number | null;
  distanceKm: number | null;
  createdAt: string;
};

type OverspeedSeverity = 'MILD' | 'MODERATE' | 'SEVERE';

type OverspeedRecord = {
  id: string;
  userId: string;
  label: string;
  speedKmh: number;
  limitKmh: number;
  durationMs: number;
  tripId: string | null;
  acknowledged: boolean;
  detectedAt: string;
  severity?: OverspeedSeverity;
};

// ✅ Keep this configurable (prod-ready)
const API_BASE = import.meta.env.VITE_API_BASE || 'https://transport-api-production-d0c6.up.railway.app';
const WS_URL = `${API_BASE}/ws`;

const styles = {
  page: {
    padding: '10px 10px 0',
    background: '#f6f7f9',
    minHeight: '100vh',
  } as React.CSSProperties,

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  } as React.CSSProperties,

  h1: {
    margin: 0,
    fontSize: 17,
    fontWeight: 950,
    color: '#111827',
    letterSpacing: -0.2,
  } as React.CSSProperties,

  sub: {
    marginTop: 2,
    marginBottom: 0,
    color: '#6b7280',
    fontSize: 11,
    lineHeight: 1.4,
  } as React.CSSProperties,

  rightHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
    justifyContent: 'flex-end',
  } as React.CSSProperties,

  grid: (open: boolean): React.CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: open ? '320px 1fr' : '0px 1fr',
    gap: open ? 10 : 0,
    alignItems: 'start',
    transition: 'grid-template-columns 0.22s ease',
  }),

  card: {
    background: '#fff',
    borderRadius: 14,
    padding: 12,
    boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
    border: '1px solid rgba(0,0,0,0.06)',
  } as React.CSSProperties,

  cardTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  } as React.CSSProperties,

  title: {
    margin: 0,
    fontSize: 12,
    fontWeight: 950,
    color: '#111827',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  } as React.CSSProperties,

  mapWrap: {
    marginTop: 8,
    height: 'calc(100vh - 218px)',
    minHeight: 400,
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid #e5e7eb',
    background: '#f9fafb',
  } as React.CSSProperties,

  mapFallback: {
    height: 'calc(100vh - 218px)',
    minHeight: 400,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #eef2ff, #f5f3ff)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#6b7280',
    fontWeight: 900,
    padding: 14,
    textAlign: 'center',
    whiteSpace: 'pre-line',
    border: '1px solid rgba(0,0,0,0.06)',
  } as React.CSSProperties,

  divider: {
    height: 1,
    background: '#e5e7eb',
    marginTop: 8,
    marginBottom: 8,
  } as React.CSSProperties,

  // KPI tiles
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 6,
    marginTop: 8,
  } as React.CSSProperties,

  kpi: (bg: string): React.CSSProperties => ({
    borderRadius: 12,
    padding: '8px 10px',
    border: '1px solid rgba(0,0,0,0.06)',
    background: bg,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  }),

  kpiLabel: {
    fontSize: 11,
    fontWeight: 900,
    color: '#374151',
  } as React.CSSProperties,

  kpiValue: {
    fontSize: 20,
    fontWeight: 950,
    color: '#111827',
    letterSpacing: -0.3,
  } as React.CSSProperties,

  // Search / Filters
  searchRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    marginTop: 8,
  } as React.CSSProperties,

  input: {
    flex: 1,
    minWidth: 140,
    padding: '7px 10px',
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    outline: 'none',
    fontWeight: 800,
    fontSize: 12,
    background: '#fff',
  } as React.CSSProperties,

  select: {
    width: '100%',
    padding: '7px 10px',
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    outline: 'none',
    fontWeight: 800,
    fontSize: 12,
    background: '#fff',
  } as React.CSSProperties,

  btn: (variant: 'primary' | 'ghost' | 'danger' = 'primary'): React.CSSProperties => {
    const base: React.CSSProperties = {
      padding: '7px 12px',
      borderRadius: 10,
      border: '1px solid #e5e7eb',
      fontWeight: 950,
      fontSize: 12,
      cursor: 'pointer',
      userSelect: 'none',
    };

    if (variant === 'primary') return { ...base, background: '#111827', color: '#fff', borderColor: '#111827' };
    if (variant === 'danger') return { ...base, background: '#ef4444', color: '#fff', borderColor: '#ef4444' };
    return { ...base, background: '#fff', color: '#111827' };
  },

  // Fleet list items
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 8,
  } as React.CSSProperties,

  listItem: (active: boolean): React.CSSProperties => ({
    padding: '8px 10px',
    borderRadius: 12,
    border: active ? '1px solid rgba(17,24,39,0.25)' : '1px solid rgba(0,0,0,0.08)',
    background: active ? 'rgba(17,24,39,0.03)' : '#fff',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    boxShadow: active ? '0 4px 12px rgba(0,0,0,0.06)' : 'none',
  }),

  leftCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    minWidth: 0,
  } as React.CSSProperties,

  rowSmall: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,

  mono: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  } as React.CSSProperties,

  labelStrong: {
    fontWeight: 950,
    color: '#111827',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 200,
    fontSize: 13,
  } as React.CSSProperties,

  small: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: 700,
  } as React.CSSProperties,

  // Chips
  chip: (bg: string, fg: string): React.CSSProperties => ({
    padding: '4px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 950,
    background: bg,
    color: fg,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
    border: '1px solid rgba(0,0,0,0.06)',
  }),

  chipSmall: (bg: string, fg: string): React.CSSProperties => ({
    padding: '3px 7px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 950,
    background: bg,
    color: fg,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
    border: '1px solid rgba(0,0,0,0.06)',
  }),

  wsBadge: (state: 'OFF' | 'ON' | 'ERR' | 'RECONNECTING'): React.CSSProperties => {
    if (state === 'ON') return { ...styles.chip('#dcfce7', '#166534') };
    if (state === 'ERR') return { ...styles.chip('#fee2e2', '#991b1b') };
    if (state === 'RECONNECTING') return { ...styles.chip('#fef9c3', '#854d0e') };
    return { ...styles.chip('#f3f4f6', '#374151') };
  },

  // Tabs
  tabs: {
    display: 'flex',
    gap: 4,
    marginTop: 8,
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,

  tab: (active: boolean): React.CSSProperties => ({
    padding: '5px 10px',
    borderRadius: 999,
    border: '1px solid #e5e7eb',
    background: active ? '#111827' : '#fff',
    color: active ? '#fff' : '#374151',
    fontWeight: 950,
    fontSize: 11,
    cursor: 'pointer',
    userSelect: 'none',
  }),

  // User portal styles
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
    marginTop: 6,
  } as React.CSSProperties,

  userRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  } as React.CSSProperties,

  rowActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  } as React.CSSProperties,

  badgeRole: (role: UserRole): React.CSSProperties => {
    const map: Record<UserRole, { bg: string; fg: string }> = {
      ADMIN: { bg: '#e0f2fe', fg: '#075985' },
      OPERATOR: { bg: '#fef9c3', fg: '#854d0e' },
      DRIVER: { bg: '#dcfce7', fg: '#166534' },
    };
    return {
      padding: '6px 10px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 950,
      background: map[role].bg,
      color: map[role].fg,
      width: 'fit-content',
      border: '1px solid rgba(0,0,0,0.06)',
    };
  },
};

function formatAge(ms?: number) {
  if (ms === undefined || ms === null) return '—';
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `il y a ${s}s`;
  const m = Math.round(s / 60);
  return `il y a ${m}m`;
}

function displaySpeedKmh(v: FleetPosition) {
  if (v.speedKmh !== undefined && v.speedKmh !== null && Number.isFinite(v.speedKmh)) {
    return `${Math.max(0, v.speedKmh).toFixed(0)} km/h`;
  }
  if (v.speedMs !== undefined && v.speedMs !== null && Number.isFinite(v.speedMs)) {
    return `${Math.max(0, v.speedMs * 3.6).toFixed(0)} km/h`;
  }
  return '—';
}

function normalizeFleetRow(r: any): FleetPosition | null {
  if (!r?.userId) return null;

  const lat = Number(r.lat);
  const lng = Number(r.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const accuracyM = Number(r.accuracyM);
  const ts =
    Number.isFinite(Number(r.lastSeenAt)) ? Number(r.lastSeenAt) :
    Number.isFinite(Number(r.timestamp)) ? Number(r.timestamp) :
    undefined;

  const ageMs =
    Number.isFinite(Number(r.ageMs)) ? Number(r.ageMs) :
    ts ? Date.now() - ts : undefined;

  const fleetStatus: FleetStatus | undefined =
    r.fleetStatus === 'ONLINE' || r.fleetStatus === 'STALE' || r.fleetStatus === 'OFFLINE'
      ? r.fleetStatus
      : undefined;

  const motionStatus: MotionStatus | undefined =
    r.motionStatus === 'MOVING' || r.motionStatus === 'IDLE' ? r.motionStatus : undefined;

  const confidence =
    r.confidence !== undefined && r.confidence !== null && Number.isFinite(Number(r.confidence))
      ? Number(r.confidence)
      : undefined;

  return {
    userId: String(r.userId),
    phone: r.phone ? String(r.phone) : undefined,
    role: r.role,

    lat,
    lng,
    accuracyM: Number.isFinite(accuracyM) ? accuracyM : 0,

    speedKmh: r.speedKmh ?? null,
    rawSpeedKmh: r.rawSpeedKmh ?? null,
    fleetStatus,
    motionStatus,
    lastSeenAt: ts,
    ageMs,

    confidence,

    tripId: r.tripId ?? null,
    routeId: r.routeId ?? null,
    busId: r.busId ?? null,

    // legacy
    speedMs: r.speedMs ?? null,
    headingDeg: r.headingDeg ?? null,
    timestamp: r.timestamp ?? ts,
  };
}

function severityColors(s?: OverspeedSeverity): { bg: string; border: string; text: string; left: string } {
  if (s === 'SEVERE')   return { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b', left: '#ef4444' };
  if (s === 'MODERATE') return { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', left: '#f97316' };
  return                       { bg: '#fefce8', border: '#fde68a', text: '#854d0e', left: '#eab308' };
}

/**
 * Marker that glides to each new position instead of jumping — the map-level
 * counterpart of the app's Kalman smoothing. Tweens lng/lat over ANIM_MS with
 * ease-out. Sub-meter hops render instantly (no wasted frames) and jumps
 * > 500 m (reconnect backfill, teleport) snap directly to avoid a fake glide
 * across the city.
 */
const MARKER_ANIM_MS = 1000; // matches the ~1 s position cadence → continuous motion

function AnimatedMarker({
  longitude,
  latitude,
  children,
  ...rest
}: { longitude: number; latitude: number; children?: React.ReactNode } & Omit<
  React.ComponentProps<typeof Marker>,
  'longitude' | 'latitude' | 'children'
>) {
  const [pos, setPos] = useState({ lng: longitude, lat: latitude });
  const animRef = useRef<number | null>(null);
  const currentRef = useRef({ lng: longitude, lat: latitude });

  useEffect(() => {
    const from = { ...currentRef.current };
    const dLng = longitude - from.lng;
    const dLat = latitude - from.lat;

    // Approximate meters (fine at Abidjan's latitude)
    const jumpM = Math.hypot(
      dLat * 111_320,
      dLng * 111_320 * Math.cos((latitude * Math.PI) / 180),
    );

    if (jumpM < 0.5 || jumpM > 500) {
      currentRef.current = { lng: longitude, lat: latitude };
      setPos({ lng: longitude, lat: latitude });
      return;
    }

    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / MARKER_ANIM_MS);
      const e = 1 - (1 - k) * (1 - k); // ease-out
      const next = { lng: from.lng + dLng * e, lat: from.lat + dLat * e };
      currentRef.current = next;
      setPos(next);
      if (k < 1) animRef.current = requestAnimationFrame(step);
    };

    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [longitude, latitude]);

  return (
    <Marker longitude={pos.lng} latitude={pos.lat} {...rest}>
      {children}
    </Marker>
  );
}

function markerDot(status: FleetStatus, selected: boolean): React.CSSProperties {
  const color = status === 'ONLINE' ? '#16a34a' : status === 'STALE' ? '#f59e0b' : '#ef4444';
  const size = selected ? 18 : 14;
  return {
    width: size,
    height: size,
    borderRadius: '50%',
    background: color,
    border: '2.5px solid rgba(255,255,255,0.95)',
    boxShadow: selected
      ? `0 0 0 5px rgba(17,24,39,0.15), 0 2px 6px rgba(0,0,0,0.25)`
      : `0 2px 4px rgba(0,0,0,0.2)`,
    cursor: 'pointer',
    transition: 'transform 0.15s',
  };
}

function SelectedMarkerPopup({
  v,
  busMap,
  routeMap,
  onClose,
}: {
  v: FleetPosition;
  busMap: Record<string, Bus>;
  routeMap: Record<string, Route>;
  onClose: () => void;
}) {
  const status = (v.fleetStatus ?? 'OFFLINE') as FleetStatus;
  const motion = (v.motionStatus ?? 'IDLE') as MotionStatus;
  const label = v.phone ?? v.userId.slice(0, 8);

  return (
    <Popup
      longitude={v.lng}
      latitude={v.lat}
      anchor="bottom"
      onClose={onClose}
      closeOnClick={false}
      maxWidth="280px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px', fontFamily: 'inherit' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 13, color: '#111827' }}>{label}</div>
          <div style={statusChip(status)}>{statusLabel(status)}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <div style={motionChip(motion)}>{motion === 'MOVING' ? 'EN MOUVEMENT' : 'À L\u2019ARRÊT'}</div>
          <div style={chipSmall('#f3f4f6', '#374151')}>Vitesse: {displaySpeedKmh(v)}</div>
          <div style={chipSmall('#f3f4f6', '#374151')}>
            Précision: {Number.isFinite(v.accuracyM) ? `${Math.round(v.accuracyM)} m` : '—'}
          </div>
          {v.confidence !== undefined && (
            <div style={chipSmall('#f3f4f6', '#374151')}>
              Confiance: {(Math.max(0, Math.min(1, v.confidence)) * 100).toFixed(0)}%
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700 }}>
          Dernière maj: <b>{formatAge(v.ageMs)}</b>
        </div>
        {(v.busId || v.routeId) && (
          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {v.busId && <div>Bus: <b style={{ color: '#111827' }}>{busMap[v.busId]?.number ?? v.busId.slice(0, 8)}</b></div>}
            {v.routeId && <div>Route: <b style={{ color: '#111827' }}>{routeMap[v.routeId]?.name ?? v.routeId.slice(0, 8)}</b></div>}
          </div>
        )}
      </div>
    </Popup>
  );
}

const geoInput: React.CSSProperties = {
  padding: '5px 8px',
  borderRadius: 7,
  border: '1px solid #e5e7eb',
  fontSize: 12,
  fontWeight: 700,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

function CoordDot({ hasCoord }: { hasCoord: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: hasCoord ? '#16a34a' : '#d1d5db', marginRight: 4,
    }} />
  );
}

function RouteRow({
  r,
  onToggle,
  onUpdateSpeed,
  onUpdateGeo,
}: {
  r: Route;
  onToggle: (r: Route) => void;
  onUpdateSpeed: (r: Route, limit: number) => void;
  onUpdateGeo: (r: Route, patch: Partial<Route>) => void;
}) {
  const [editingSpeed, setEditingSpeed] = React.useState(false);
  const [speedVal, setSpeedVal] = React.useState(String(r.speedLimitKmh ?? 90));
  const [showGeo, setShowGeo] = React.useState(false);

  // Local geo state
  const [oLat, setOLat] = React.useState(String(r.originLat ?? ''));
  const [oLng, setOLng] = React.useState(String(r.originLng ?? ''));
  const [wpName, setWpName] = React.useState(r.waypointName ?? '');
  const [wpLat, setWpLat] = React.useState(String(r.waypointLat ?? ''));
  const [wpLng, setWpLng] = React.useState(String(r.waypointLng ?? ''));
  const [dLat, setDLat] = React.useState(String(r.destinationLat ?? ''));
  const [dLng, setDLng] = React.useState(String(r.destinationLng ?? ''));
  const [radius, setRadius] = React.useState(String(r.geofenceRadiusM ?? 300));

  const commitSpeed = () => {
    const n = parseInt(speedVal, 10);
    if (Number.isFinite(n) && n >= 20 && n <= 200 && n !== r.speedLimitKmh) {
      onUpdateSpeed(r, n);
    }
    setEditingSpeed(false);
  };

  const commitGeo = () => {
    const patch: Partial<Route> = {};
    const p = parseFloat;
    if (oLat && oLng)   { patch.originLat = p(oLat); patch.originLng = p(oLng); }
    if (wpLat && wpLng) { patch.waypointLat = p(wpLat); patch.waypointLng = p(wpLng); }
    if (wpName)         { patch.waypointName = wpName; }
    if (dLat && dLng)   { patch.destinationLat = p(dLat); patch.destinationLng = p(dLng); }
    if (radius)         { patch.geofenceRadiusM = parseInt(radius, 10); }
    if (Object.keys(patch).length > 0) onUpdateGeo(r, patch);
    setShowGeo(false);
  };

  const geoSet = r.originLat != null && r.destinationLat != null;

  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 950, color: '#111827' }}>{r.name}</div>
          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700 }}>{r.origin} → {r.destination}</div>
        </div>
        <div style={r.isActive
          ? { padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 800, background: '#dcfce7', color: '#166534' }
          : { padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 800, background: '#fee2e2', color: '#991b1b' }
        }>
          {r.isActive ? 'ACTIVE' : 'INACTIVE'}
        </div>
      </div>

      {/* Speed + geo status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 700 }}>Limite:</span>
        {editingSpeed ? (
          <>
            <input autoFocus type="number" min={20} max={200} value={speedVal}
              onChange={(e) => setSpeedVal(e.target.value)} onBlur={commitSpeed}
              onKeyDown={(e) => { if (e.key === 'Enter') commitSpeed(); if (e.key === 'Escape') setEditingSpeed(false); }}
              style={{ width: 60, padding: '2px 6px', borderRadius: 6, border: '1px solid #6366f1', fontWeight: 800, fontSize: 12, outline: 'none' }}
            />
            <span style={{ fontSize: 11, color: '#6b7280' }}>km/h</span>
          </>
        ) : (
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 12, color: '#6366f1', padding: '2px 4px', borderRadius: 4 }}
            onClick={() => { setSpeedVal(String(r.speedLimitKmh ?? 90)); setEditingSpeed(true); }}>
            {r.speedLimitKmh ?? 90} km/h ✎
          </button>
        )}

        <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginLeft: 4 }}>GPS:</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: geoSet ? '#16a34a' : '#f59e0b' }}>
          <CoordDot hasCoord={r.originLat != null} />{r.origin}
          {r.waypointName ? <><CoordDot hasCoord={r.waypointLat != null} />{r.waypointName}</> : null}
          <CoordDot hasCoord={r.destinationLat != null} />{r.destination}
        </span>

        <div style={{ flex: 1 }} />
        <button style={{ padding: '3px 8px', borderRadius: 7, border: '1px solid #6366f1', background: '#f5f3ff', color: '#6366f1', fontWeight: 800, fontSize: 11, cursor: 'pointer' }}
          onClick={() => setShowGeo((v) => !v)}>
          {showGeo ? 'Fermer' : 'Coordonnées'}
        </button>
        <button style={{ padding: '3px 10px', borderRadius: 7, border: '1px solid #e5e7eb', background: r.isActive ? '#f9fafb' : '#6366f1', color: r.isActive ? '#374151' : '#fff', fontWeight: 800, fontSize: 11, cursor: 'pointer' }}
          onClick={() => onToggle(r)}>
          {r.isActive ? 'Désactiver' : 'Activer'}
        </button>
      </div>

      {/* Expandable geo form */}
      {showGeo && (
        <div style={{ marginTop: 10, padding: 12, background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: '#374151' }}>Coordonnées GPS des arrêts</div>

          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700 }}>Départ — {r.origin}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input style={geoInput} placeholder="Latitude" value={oLat} onChange={(e) => setOLat(e.target.value)} />
            <input style={geoInput} placeholder="Longitude" value={oLng} onChange={(e) => setOLng(e.target.value)} />
          </div>

          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700 }}>Arrêt intermédiaire (optionnel)</div>
          <input style={geoInput} placeholder="Nom de l'arrêt (ex: Gare Yamoussoukro)" value={wpName} onChange={(e) => setWpName(e.target.value)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input style={geoInput} placeholder="Latitude" value={wpLat} onChange={(e) => setWpLat(e.target.value)} />
            <input style={geoInput} placeholder="Longitude" value={wpLng} onChange={(e) => setWpLng(e.target.value)} />
          </div>

          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700 }}>Arrivée — {r.destination}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input style={geoInput} placeholder="Latitude" value={dLat} onChange={(e) => setDLat(e.target.value)} />
            <input style={geoInput} placeholder="Longitude" value={dLng} onChange={(e) => setDLng(e.target.value)} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 700 }}>Rayon géofence:</span>
            <input style={{ ...geoInput, width: 70 }} type="number" min={50} max={1000} value={radius} onChange={(e) => setRadius(e.target.value)} />
            <span style={{ fontSize: 11, color: '#6b7280' }}>m</span>
          </div>

          <button onClick={commitGeo} style={{ padding: '6px 12px', borderRadius: 8, background: '#111827', color: '#fff', fontWeight: 800, fontSize: 12, border: 'none', cursor: 'pointer', marginTop: 4 }}>
            Enregistrer les coordonnées
          </button>
        </div>
      )}
    </div>
  );
}

function HistoriquePanel({
  trips,
  userMap,
  busMap,
  routeMap,
  loading,
  onRefresh,
  onReplay,
}: {
  trips: Trip[];
  userMap: Record<string, AdminUser>;
  busMap: Record<string, Bus>;
  routeMap: Record<string, Route>;
  loading: boolean;
  onRefresh: () => void;
  onReplay: (tripId: string) => void;
}) {
  const completed = trips.filter((t) => t.status === 'COMPLETED').sort((a, b) =>
    (b.endedAt ?? b.createdAt) > (a.endedAt ?? a.createdAt) ? 1 : -1
  );

  const totalKm = completed.reduce((s, t) => s + (t.distanceKm ?? 0), 0);
  const totalMin = completed.reduce((s, t) => s + (t.durationMin ?? 0), 0);
  const avgSpeed = totalMin > 0 ? (totalKm / totalMin) * 60 : null;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 950, color: '#111827' }}>Historique ({completed.length})</div>
        <button
          style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#f9fafb', fontWeight: 800, fontSize: 11, cursor: 'pointer', color: '#374151' }}
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? '…' : 'Rafraîchir'}
        </button>
      </div>
      {completed.length > 0 && (
        <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 80, background: '#f0fdf4', borderRadius: 10, padding: '8px 12px', border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#166534' }}>DISTANCE TOTALE</div>
            <div style={{ fontSize: 18, fontWeight: 950, color: '#111827' }}>{totalKm.toFixed(0)} km</div>
          </div>
          <div style={{ flex: 1, minWidth: 80, background: '#eff6ff', borderRadius: 10, padding: '8px 12px', border: '1px solid #bfdbfe' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#1d4ed8' }}>TEMPS TOTAL</div>
            <div style={{ fontSize: 18, fontWeight: 950, color: '#111827' }}>{Math.round(totalMin / 60)} h {Math.round(totalMin % 60)} min</div>
          </div>
          {avgSpeed != null && (
            <div style={{ flex: 1, minWidth: 80, background: '#fef9c3', borderRadius: 10, padding: '8px 12px', border: '1px solid #fde68a' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#854d0e' }}>VITESSE MOY.</div>
              <div style={{ fontSize: 18, fontWeight: 950, color: '#111827' }}>{avgSpeed.toFixed(0)} km/h</div>
            </div>
          )}
        </div>
      )}

      {completed.length === 0 ? (
        <div style={{ fontSize: 12, color: '#6b7280', padding: 12, border: '1px dashed #e5e7eb', borderRadius: 14, textAlign: 'center' }}>
          Aucun trajet terminé.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {completed.map((t) => {
            const driver = t.driverId ? userMap[t.driverId] : undefined;
            const bus    = busMap[t.busId];
            const route  = routeMap[t.routeId];
            const driverLabel = driver ? `${driver.firstName} ${driver.lastName}` : (bus?.number ?? t.busId.slice(0, 8));
            return (
              <div key={t.id} style={{ background: '#f9fafb', borderRadius: 12, padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 950, fontSize: 13, color: '#111827' }}>{driverLabel}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginTop: 2 }}>
                      {route?.name ?? '—'} · Bus {bus?.number ?? '—'}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {t.endedAt ? new Date(t.endedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <div style={{ padding: '3px 8px', borderRadius: 6, background: '#e0f2fe', color: '#075985', fontSize: 11, fontWeight: 800 }}>
                    {t.durationMin != null ? `${Math.round(t.durationMin)} min` : '—'}
                  </div>
                  <div style={{ padding: '3px 8px', borderRadius: 6, background: '#f0fdf4', color: '#166534', fontSize: 11, fontWeight: 800 }}>
                    {t.distanceKm != null ? `${t.distanceKm.toFixed(1)} km` : '—'}
                  </div>
                  {t.durationMin != null && t.distanceKm != null && t.durationMin > 0 ? (
                    <div style={{ padding: '3px 8px', borderRadius: 6, background: '#fef9c3', color: '#854d0e', fontSize: 11, fontWeight: 800 }}>
                      {((t.distanceKm / t.durationMin) * 60).toFixed(0)} km/h moy.
                    </div>
                  ) : null}
                  <button
                    onClick={() => onReplay(t.id)}
                    style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 6, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                  >
                    ▶ Replay
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function chipSmall(bg: string, color: string): React.CSSProperties {
  return {
    padding: '2px 7px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 800,
    background: bg,
    color,
    display: 'inline-flex',
    alignItems: 'center',
  };
}

async function api<T>(path: string, opts: { method?: string; token: string; body?: any }): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }

  return data as T;
}

function statusLabel(status: FleetStatus) {
  return status === 'ONLINE' ? 'EN LIGNE' : status === 'STALE' ? 'INACTIF' : 'HORS LIGNE';
}

function statusChip(status: FleetStatus) {
  if (status === 'ONLINE') return styles.chip('#dcfce7', '#166534');
  if (status === 'STALE') return styles.chip('#fef9c3', '#854d0e');
  return styles.chip('#fee2e2', '#991b1b');
}

function motionChip(motion: MotionStatus) {
  if (motion === 'MOVING') return styles.chipSmall('#e0f2fe', '#075985');
  return styles.chipSmall('#f3f4f6', '#374151');
}

export default function AdminDashboard() {
  // ----------------- WS / Fleet -----------------
  const [wsStatus, setWsStatus] = useState<'OFF' | 'ON' | 'ERR' | 'RECONNECTING'>('OFF');
  const [wsError, setWsError] = useState<string | null>(null);

  const [fleet, setFleet] = useState<Record<string, FleetPosition>>({});
  const [now, setNow] = useState<number>(() => Date.now());

  const socketRef = useRef<Socket | null>(null);
  const mapRef    = useRef<MapRef>(null);
  const lastMapCenterRef = useRef<[number, number] | null>(null);
  const overspeedTimerRefs = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Walkie-talkie
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const audioChunksRef    = useRef<Blob[]>([]);
  const [wkRecording, setWkRecording] = useState(false);

  // UI state
  const [panel, setPanel] = useState<'FLOTTE' | 'UTILISATEURS' | 'BUS' | 'ROUTES' | 'TRAJETS' | 'HISTORIQUE' | 'ARRETS' | 'ALERTES'>('FLOTTE');
  const [panelOpen, setPanelOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | FleetStatus>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Overspeed alerts — kept for 60 s then auto-dismissed
  type OverspeedAlert = {
    id: string;
    userId: string;
    phone: string;
    speedKmh: number;
    limitKmh: number;
    detectedAt: number;
    tripId?: string | null;
    severity?: OverspeedSeverity;
  };
  const [overspeedAlerts, setOverspeedAlerts] = useState<OverspeedAlert[]>([]);

  // GPS health alerts pushed by the driver-app watchdog (fleet:health)
  type HealthAlert = { userId: string; busNumber: string | null; reason: string; at: number };
  const [healthAlerts, setHealthAlerts] = useState<HealthAlert[]>([]);

  const dismissOverspeed = (id: string) =>
    setOverspeedAlerts((prev) => prev.filter((a) => a.id !== id));

  // tick to refresh ages (purely UI)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 2000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const token = getToken();

    if (!token) {
      setWsStatus('OFF');
      setWsError('Connectez-vous en ADMIN pour voir la flotte.');
      return;
    }

    const socket = io(WS_URL, {
      auth: { token },
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setWsStatus('ON');
      setWsError(null);
    });

    socket.on('disconnect', (reason) => {
      // Don't show ERR for clean client-initiated disconnects
      if (reason === 'io client disconnect') return;
      setWsStatus('RECONNECTING');
      setWsError('Connexion perdue — reconnexion…');
    });

    socket.io.on('reconnect_attempt', () => {
      setWsStatus('RECONNECTING');
    });

    socket.io.on('reconnect', () => {
      setWsStatus('ON');
      setWsError(null);
      // Re-seed map after reconnect so stale dots are replaced with fresh data
      const tok = getToken();
      if (tok) {
        fetch(`${API_BASE}/positions/live`, {
          headers: { Authorization: `Bearer ${tok}` },
        })
          .then((r) => r.json())
          .then((liveBuses: any[]) => {
            if (!Array.isArray(liveBuses)) return;
            setFleet((prev) => {
              const next = { ...prev };
              for (const bus of liveBuses) {
                if (!bus.busId || !Number.isFinite(Number(bus.lat)) || !Number.isFinite(Number(bus.lng))) continue;
                const lastSeenAt = Date.parse(bus.lastSeenAt);
                if (!Number.isFinite(lastSeenAt)) continue;
                const existing = next[bus.busId];
                if (existing && (existing.lastSeenAt ?? 0) >= lastSeenAt) continue;
                next[bus.busId] = {
                  userId: bus.busId,
                  lat: Number(bus.lat),
                  lng: Number(bus.lng),
                  accuracyM: 0,
                  speedKmh: bus.speedKmh ?? null,
                  headingDeg: bus.headingDeg ?? null,
                  lastSeenAt,
                  busId: bus.busId,
                };
              }
              return next;
            });
          })
          .catch(() => {});
      }
    });

    socket.io.on('reconnect_error', () => {
      setWsStatus('ERR');
    });

    socket.on('connect_error', (err) => {
      setWsStatus('ERR');
      setWsError(err?.message || 'Erreur WebSocket');
    });

    socket.on('fleet:snapshot', (rows: Array<any>) => {
      if (!Array.isArray(rows)) return;

      setFleet((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          const n = normalizeFleetRow(r);
          if (!n) continue;
          next[n.userId] = n;
        }
        return next;
      });
    });

    socket.on('fleet:position', (p: any) => {
      const n = normalizeFleetRow(p);
      if (!n) return;
      setFleet((prev) => ({ ...prev, [n.userId]: { ...n, lastSeenAt: Date.now() } }));
    });

    socket.on('fleet:status', (rows: Array<any>) => {
      if (!Array.isArray(rows)) return;
      setFleet((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          const n = normalizeFleetRow(r);
          if (!n) continue;
          next[n.userId] = { ...(next[n.userId] ?? n), ...n };
        }
        return next;
      });
    });

    socket.on('fleet:health', (evt: any) => {
      if (!evt?.userId) return;
      setHealthAlerts((prev) => {
        const others = prev.filter((h) => h.userId !== evt.userId);
        if (evt.ok) return others; // issue resolved → clear the banner
        return [
          {
            userId: evt.userId,
            busNumber: evt.busNumber ?? null,
            reason: evt.reason ?? 'Problème GPS signalé',
            at: evt.at ?? Date.now(),
          },
          ...others,
        ].slice(0, 10);
      });
    });

    socket.on('driver:overspeed', (evt: any) => {
      const alert: OverspeedAlert = {
        id: `${evt.userId}-${evt.detectedAt}`,
        userId: evt.userId,
        phone: evt.phone ?? evt.userId.slice(0, 8),
        speedKmh: Math.round(evt.speedKmh ?? 0),
        limitKmh: evt.limitKmh ?? 90,
        detectedAt: evt.detectedAt ?? Date.now(),
        tripId: evt.tripId ?? null,
      };
      setOverspeedAlerts((prev) => {
        // De-dupe by userId — keep the latest
        const filtered = prev.filter((a) => a.userId !== alert.userId);
        return [alert, ...filtered].slice(0, 10);
      });
      // Auto-dismiss after 60 s
      const timerId = setTimeout(() => setOverspeedAlerts((prev) => prev.filter((a) => a.id !== alert.id)), 60_000);
      overspeedTimerRefs.current.add(timerId);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      overspeedTimerRefs.current.forEach(clearTimeout);
      overspeedTimerRefs.current.clear();
    };
  }, []);

  // Seed the map from /positions/live on mount
  useEffect(() => {
    const tok = getToken();
    if (!tok) return;
    fetch(`${API_BASE}/positions/live`, {
      headers: { Authorization: `Bearer ${tok}` },
    })
      .then((r) => r.json())
      .then((liveBuses: any[]) => {
        if (!Array.isArray(liveBuses)) return;
        setFleet((prev) => {
          const next = { ...prev };
          for (const bus of liveBuses) {
            if (!bus.busId || !Number.isFinite(Number(bus.lat)) || !Number.isFinite(Number(bus.lng))) continue;
            const lastSeenAt = Date.parse(bus.lastSeenAt);
            if (!Number.isFinite(lastSeenAt)) continue;
            const existing = next[bus.busId];
            if (existing && (existing.lastSeenAt ?? 0) >= lastSeenAt) continue;
            next[bus.busId] = {
              userId: bus.busId,
              lat: Number(bus.lat),
              lng: Number(bus.lng),
              accuracyM: 0,
              speedKmh: bus.speedKmh ?? null,
              headingDeg: bus.headingDeg ?? null,
              lastSeenAt,
              busId: bus.busId,
            };
          }
          return next;
        });
      })
      .catch(() => {}); // silent fail — WebSocket will fill in anyway
  }, []);

  // Remove buses that haven't sent a position in 2 hours; check every 30 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - STALE_MS;
      setFleet((prev) => {
        const next: Record<string, FleetPosition> = {};
        for (const [id, pos] of Object.entries(prev)) {
          if ((pos.lastSeenAt ?? 0) >= cutoff) {
            next[id] = pos;
          }
        }
        return next;
      });
    }, CLEANUP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const vehicles = useMemo(() => {
    const list = Object.values(fleet);

    const normalized = list.map((p) => {
      const lastSeenAt = p.lastSeenAt ?? p.timestamp ?? 0;
      const ageMs = now - lastSeenAt;

      const fleetStatus: FleetStatus =
        p.fleetStatus ??
        (ageMs <= STALE_AFTER_MS ? 'ONLINE' : ageMs <= OFFLINE_AFTER_MS ? 'STALE' : 'OFFLINE');

      const motionStatus: MotionStatus = p.motionStatus ?? 'IDLE';

      return { ...p, lastSeenAt, ageMs, fleetStatus, motionStatus };
    });

    const q = search.trim().toLowerCase();
    const filtered = normalized.filter((v) => {
      if (filter !== 'ALL' && v.fleetStatus !== filter) return false;
      if (!q) return true;
      const label = (v.phone ?? v.userId).toLowerCase();
      return label.includes(q);
    });

    // Sorting: ONLINE first, then STALE, then OFFLINE; most recent first
    const rank = (s: FleetStatus) => (s === 'ONLINE' ? 0 : s === 'STALE' ? 1 : 2);

    return filtered.sort((a, b) => {
      const ra = rank(a.fleetStatus as FleetStatus);
      const rb = rank(b.fleetStatus as FleetStatus);
      if (ra !== rb) return ra - rb;
      return (b.lastSeenAt || 0) - (a.lastSeenAt || 0);
    });
  }, [fleet, now, search, filter]);

  const counts = useMemo(() => {
    const all = Object.values(fleet).map((p) => {
      const lastSeenAt = p.lastSeenAt ?? p.timestamp ?? 0;
      const ageMs = now - lastSeenAt;

      const fleetStatus: FleetStatus =
        p.fleetStatus ??
        (ageMs <= STALE_AFTER_MS ? 'ONLINE' : ageMs <= OFFLINE_AFTER_MS ? 'STALE' : 'OFFLINE');

      return fleetStatus;
    });

    const online = all.filter((x) => x === 'ONLINE').length;
    const stale = all.filter((x) => x === 'STALE').length;
    const offline = all.filter((x) => x === 'OFFLINE').length;

    return { total: all.length, online, stale, offline };
  }, [fleet, now]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return vehicles.find((v) => v.userId === selectedId) ?? null;
  }, [vehicles, selectedId]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (selected && Number.isFinite(selected.lat) && Number.isFinite(selected.lng)) return [selected.lat, selected.lng];
    if (vehicles.length > 0 && Number.isFinite(vehicles[0].lat) && Number.isFinite(vehicles[0].lng)) return [vehicles[0].lat, vehicles[0].lng];
    return [5.3364, -4.0267]; // Abidjan
  }, [vehicles, selected]);

  const mapReady = wsStatus === 'ON';

  // Fly map to new center when selection changes
  useEffect(() => {
    const [lat, lng] = mapCenter;
    if (lastMapCenterRef.current?.[0] === lat && lastMapCenterRef.current?.[1] === lng) return;
    lastMapCenterRef.current = [lat, lng];
    mapRef.current?.flyTo({ center: [lng, lat], duration: 700 });
  }, [mapCenter]);

  const fallbackText = useMemo(() => {
    if (wsStatus !== 'ON') {
      return wsStatus === 'ERR'
        ? `WS: erreur (${wsError ?? 'inconnue'})`
        : `WS: non connecté (${wsError ?? '—'})`;
    }
    if (Object.keys(fleet).length === 0) return 'Aucune position reçue (encore).\nOuvrez /driver et activez le GPS.';
    return `Positions reçues: ${Object.keys(fleet).length}\nLa carte est prête.`;
  }, [fleet, wsStatus, wsError]);

  // ----------------- Admin Users Portal -----------------
  const token = useMemo(() => getToken(), []);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [cFirst, setCFirst] = useState('');
  const [cLast, setCLast] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cPin, setCPin] = useState('');
  const [cRole, setCRole] = useState<UserRole>('DRIVER');
  const [createLoading, setCreateLoading] = useState(false);

  const refreshUsers = async () => {
    if (!token) return;
    setUsersLoading(true);
    setUsersError(null);
    try {
      const data = await api<AdminUser[]>('/users', { token });
      setUsers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setUsersError(e?.message || 'Erreur');
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    refreshUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreateUser = async () => {
    if (!token) return;

    setCreateLoading(true);
    setUsersError(null);
    try {
      await api<AdminUser>('/users', {
        token,
        method: 'POST',
        body: {
          firstName: cFirst.trim(),
          lastName: cLast.trim(),
          phone: cPhone.trim(),
          pin: cPin.trim(),
          role: cRole,
        },
      });

      setCFirst('');
      setCLast('');
      setCPhone('');
      setCPin('');
      setCRole('DRIVER');

      await refreshUsers();
      alert('Utilisateur créé ✅');
    } catch (e: any) {
      alert(`Erreur création: ${e?.message || 'Erreur'}`);
    } finally {
      setCreateLoading(false);
    }
  };

  const onUpdateUser = async (
    id: string,
    patch: Partial<Pick<AdminUser, 'firstName' | 'lastName' | 'phone' | 'role' | 'isActive'>>,
  ) => {
    if (!token) return;
    try {
      await api<AdminUser>(`/users/${id}`, { token, method: 'PATCH', body: patch });
      await refreshUsers();
    } catch (e: any) {
      alert(`Erreur mise à jour: ${e?.message || 'Erreur'}`);
    }
  };

  const onResetPin = async (id: string) => {
    if (!token) return;
    const pin = window.prompt('Nouveau PIN (4–8 chiffres):');
    if (!pin) return;

    try {
      await api<{ ok: true }>(`/users/${id}/pin`, { token, method: 'PATCH', body: { pin: pin.trim() } });
      alert('PIN mis à jour ✅');
    } catch (e: any) {
      alert(`Erreur PIN: ${e?.message || 'Erreur'}`);
    }
  };

  // ─── Buses ────────────────────────────────────────────────────────────────
  const [buses, setBuses] = useState<Bus[]>([]);
  const [busesLoading, setBusesLoading] = useState(false);
  const [busesError, setBusesError] = useState<string | null>(null);
  const [bNumber, setBNumber] = useState('');
  const [bPlate, setBPlate] = useState('');
  const [bCreateLoading, setBCreateLoading] = useState(false);

  // ===== Walkie-talkie =====
  const startTalking = async (busId: string) => {
    if (wkRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          socketRef.current?.emit('admin:bus-voice', { busId, audio: base64 });
        };
        reader.readAsDataURL(blob);
        setWkRecording(false);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setWkRecording(true);
    } catch {
      alert('Microphone inaccessible. Vérifiez les permissions.');
    }
  };

  const stopTalking = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const refreshBuses = async () => {
    if (!token) return;
    setBusesLoading(true);
    setBusesError(null);
    try {
      const data = await api<Bus[]>('/buses', { token });
      setBuses(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setBusesError(e?.message || 'Erreur');
    } finally {
      setBusesLoading(false);
    }
  };

  useEffect(() => { if (token) refreshBuses(); }, []); // eslint-disable-line

  const onCreateBus = async () => {
    if (!token || !bNumber.trim()) return;
    setBCreateLoading(true);
    try {
      await api<Bus>('/buses', { token, method: 'POST', body: { number: bNumber.trim(), plate: bPlate.trim() || null } });
      setBNumber(''); setBPlate('');
      await refreshBuses();
    } catch (e: any) { alert(`Erreur: ${e?.message}`); }
    finally { setBCreateLoading(false); }
  };

  const onToggleBus = async (b: Bus) => {
    if (!token) return;
    try {
      await api<Bus>(`/buses/${b.id}`, { token, method: 'PATCH', body: { isActive: !b.isActive } });
      await refreshBuses();
    } catch (e: any) { alert(`Erreur: ${e?.message}`); }
  };

  const [pinBusId, setPinBusId] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinLoading, setPinLoading] = useState(false);

  const onSetDevicePin = async (busId: string) => {
    if (!token || !pinValue.trim() || pinValue.trim().length < 4) {
      alert('Le PIN doit faire au moins 4 chiffres.');
      return;
    }
    setPinLoading(true);
    try {
      await api(`/buses/${busId}/device-pin`, { token, method: 'PATCH', body: { pin: pinValue.trim() } });
      setPinBusId(null);
      setPinValue('');
      alert('PIN configuré avec succès.');
    } catch (e: any) { alert(`Erreur: ${e?.message}`); }
    finally { setPinLoading(false); }
  };

  // Lookup map for fleet markers
  const busMap = useMemo(() => {
    const m: Record<string, Bus> = {};
    for (const b of buses) m[b.id] = b;
    return m;
  }, [buses]);

  // ─── Routes ───────────────────────────────────────────────────────────────
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [rName, setRName] = useState('');
  const [rOriginStopId, setROriginStopId] = useState('');
  const [rDestStopId, setRDestStopId] = useState('');
  const [rWaypointStopId, setRWaypointStopId] = useState('');
  const [rSpeedLimit, setRSpeedLimit] = useState('90');
  const [rCreateLoading, setRCreateLoading] = useState(false);

  const refreshRoutes = async () => {
    if (!token) return;
    setRoutesLoading(true);
    setRoutesError(null);
    try {
      const data = await api<Route[]>('/routes', { token });
      setRoutes(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setRoutesError(e?.message || 'Erreur');
    } finally {
      setRoutesLoading(false);
    }
  };

  useEffect(() => { if (token) refreshRoutes(); }, []); // eslint-disable-line

  const onCreateRoute = async () => {
    if (!token || !rOriginStopId || !rDestStopId) return;
    setRCreateLoading(true);
    const speedLimit = parseInt(rSpeedLimit, 10);
    const originStop = stops.find((s) => s.id === rOriginStopId);
    const destStop   = stops.find((s) => s.id === rDestStopId);
    const routeName  = rName.trim() || `${stopCity(originStop?.name ?? '?')} → ${stopCity(destStop?.name ?? '?')}`;
    try {
      await api<Route>('/routes', {
        token, method: 'POST',
        body: {
          name:             routeName,
          origin:           originStop?.name ?? rOriginStopId,
          destination:      destStop?.name   ?? rDestStopId,
          originStopId:     rOriginStopId,
          destinationStopId: rDestStopId,
          ...(rWaypointStopId ? { waypointStopId: rWaypointStopId } : {}),
          ...(Number.isFinite(speedLimit) && speedLimit >= 20 && speedLimit <= 200 ? { speedLimitKmh: speedLimit } : {}),
        },
      });
      setRName(''); setROriginStopId(''); setRDestStopId(''); setRWaypointStopId(''); setRSpeedLimit('90');
      await refreshRoutes();
    } catch (e: any) { alert(`Erreur: ${e?.message}`); }
    finally { setRCreateLoading(false); }
  };

  const onUpdateRouteSpeed = async (r: Route, newLimit: number) => {
    if (!token || !Number.isFinite(newLimit) || newLimit < 20 || newLimit > 200) return;
    try {
      await api<Route>(`/routes/${r.id}`, { token, method: 'PATCH', body: { speedLimitKmh: newLimit } });
      await refreshRoutes();
    } catch (e: any) { alert(`Erreur: ${e?.message}`); }
  };

  const onUpdateRouteGeo = async (r: Route, patch: Partial<Route>) => {
    if (!token) return;
    try {
      await api<Route>(`/routes/${r.id}`, { token, method: 'PATCH', body: patch });
      await refreshRoutes();
    } catch (e: any) { alert(`Erreur: ${e?.message}`); }
  };

  const onToggleRoute = async (r: Route) => {
    if (!token) return;
    try {
      await api<Route>(`/routes/${r.id}`, { token, method: 'PATCH', body: { isActive: !r.isActive } });
      await refreshRoutes();
    } catch (e: any) { alert(`Erreur: ${e?.message}`); }
  };

  const routeMap = useMemo(() => {
    const m: Record<string, Route> = {};
    for (const r of routes) m[r.id] = r;
    return m;
  }, [routes]);

  // ─── Stops ────────────────────────────────────────────────────────────────
  const [stops, setStops] = useState<Stop[]>([]);
  const [stopsLoading, setStopsLoading] = useState(false);
  const [stopsError, setStopsError] = useState<string | null>(null);
  const [sName, setSName] = useState('');
  const [sCity, setSCity] = useState('');
  const [sCreateLoading, setSCreateLoading] = useState(false);
  const [sLat, setSLat] = useState<number | null>(null);
  const [sLng, setSLng] = useState<number | null>(null);
  const [sCapturing, setSCapturing] = useState(false);
  const [capturingStopId, setCapturingStopId] = useState<string | null>(null);

  const refreshStops = async () => {
    if (!token) return;
    setStopsLoading(true);
    setStopsError(null);
    try {
      const data = await api<Stop[]>('/stops', { token });
      setStops(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setStopsError(e?.message || 'Erreur');
    } finally {
      setStopsLoading(false);
    }
  };

  useEffect(() => { if (token) refreshStops(); }, []); // eslint-disable-line

  // Strip "Gare de/d'/du/des/D'" prefix — "Gare d'Abidjan" → "Abidjan"
  const stopCity = (name: string) =>
    name.replace(/^gare\s+(d['']\s*|de\s+|du\s+|des\s+)/i, '').trim();

  // Auto-fill route name from selected stops when the name field is empty
  useEffect(() => {
    if (!rOriginStopId || !rDestStopId) return;
    setRName((prev) => {
      if (prev.trim()) return prev;
      const origin = stops.find((s) => s.id === rOriginStopId);
      const dest   = stops.find((s) => s.id === rDestStopId);
      if (origin && dest) return `${stopCity(origin.name)} → ${stopCity(dest.name)}`;
      return prev;
    });
  }, [rOriginStopId, rDestStopId, stops]); // eslint-disable-line

  const captureForCreate = () => {
    if (!navigator.geolocation) { alert('Géolocalisation non disponible.'); return; }
    setSCapturing(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setSLat(pos.coords.latitude); setSLng(pos.coords.longitude); setSCapturing(false); },
      (err) => { alert(`GPS refusé: ${err.message}`); setSCapturing(false); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const onCreateStop = async () => {
    if (!token || !sName.trim()) return;
    setSCreateLoading(true);
    try {
      await api<Stop>('/stops', {
        token, method: 'POST',
        body: {
          name: sName.trim(),
          city: sCity.trim() || undefined,
          ...(sLat !== null && sLng !== null ? { lat: sLat, lng: sLng } : {}),
        },
      });
      setSName(''); setSCity(''); setSLat(null); setSLng(null);
      await refreshStops();
    } catch (e: any) { alert(`Erreur: ${e?.message}`); }
    finally { setSCreateLoading(false); }
  };

  const onCaptureStopLocation = (stop: Stop) => {
    if (!token) return;
    if (!navigator.geolocation) { alert('Géolocalisation non disponible dans ce navigateur.'); return; }
    setCapturingStopId(stop.id);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await api<Stop>(`/stops/${stop.id}/capture`, {
            token, method: 'PATCH',
            body: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          await refreshStops();
        } catch (e: any) { alert(`Erreur: ${e?.message}`); }
        finally { setCapturingStopId(null); }
      },
      (err) => { alert(`Géolocalisation refusée: ${err.message}`); setCapturingStopId(null); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  // ─── Trips ────────────────────────────────────────────────────────────────
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripsError, setTripsError] = useState<string | null>(null);
  const [replayTripId, setReplayTripId] = useState<string | null>(null);
  const [tBusId, setTBusId] = useState('');
  const [tRouteId, setTRouteId] = useState('');
  const [tCreateLoading, setTCreateLoading] = useState(false);

  const refreshTrips = async () => {
    if (!token) return;
    setTripsLoading(true);
    setTripsError(null);
    try {
      const data = await api<Trip[]>('/trips', { token });
      setTrips(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setTripsError(e?.message || 'Erreur');
    } finally {
      setTripsLoading(false);
    }
  };

  useEffect(() => { if (token) refreshTrips(); }, []); // eslint-disable-line

  // ─── Overspeed alert history ──────────────────────────────────────────────
  const [overspeedRecords, setOverspeedRecords] = useState<OverspeedRecord[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  const refreshAlerts = async () => {
    if (!token) return;
    setAlertsLoading(true);
    try {
      const data = await api<OverspeedRecord[]>('/alerts/overspeed', { token });
      setOverspeedRecords(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setAlertsLoading(false); }
  };

  const acknowledgeAlert = async (id: string) => {
    if (!token) return;
    try {
      await api(`/alerts/overspeed/${id}/acknowledge`, { token, method: 'PATCH' });
      setOverspeedRecords((prev) => prev.map((a) => a.id === id ? { ...a, acknowledged: true } : a));
    } catch { /* silent */ }
  };

  const onCreateTrip = async () => {
    if (!token || !tBusId || !tRouteId) return;
    setTCreateLoading(true);
    try {
      await api<Trip>('/trips', { token, method: 'POST', body: { busId: tBusId, routeId: tRouteId } });
      setTBusId(''); setTRouteId('');
      await refreshTrips();
    } catch (e: any) { alert(`Erreur: ${e?.message}`); }
    finally { setTCreateLoading(false); }
  };

  const onStartTrip = async (id: string) => {
    if (!token) return;
    try {
      await api<Trip>(`/trips/${id}/start`, { token, method: 'POST' });
      await refreshTrips();
    } catch (e: any) { alert(`Erreur: ${e?.message}`); }
  };

  const onEndTrip = async (id: string) => {
    if (!token) return;
    try {
      await api<Trip>(`/trips/${id}/end`, { token, method: 'POST' });
      await refreshTrips();
    } catch (e: any) { alert(`Erreur: ${e?.message}`); }
  };

  const onCancelTrip = async (id: string) => {
    if (!token || !window.confirm('Annuler ce trajet ?')) return;
    try {
      await api<Trip>(`/trips/${id}/cancel`, { token, method: 'POST' });
      await refreshTrips();
    } catch (e: any) { alert(`Erreur: ${e?.message}`); }
  };

  const userMap = useMemo(() => {
    const m: Record<string, AdminUser> = {};
    for (const u of users) m[u.id] = u;
    return m;
  }, [users]);

  const tripStatusChip = (s: TripStatus): React.CSSProperties => {
    if (s === 'ACTIVE')    return styles.chipSmall('#dcfce7', '#166534');
    if (s === 'SCHEDULED') return styles.chipSmall('#e0f2fe', '#075985');
    if (s === 'COMPLETED') return styles.chipSmall('#f3f4f6', '#374151');
    return styles.chipSmall('#fee2e2', '#991b1b');
  };

  const tripStatusLabel = (s: TripStatus) => {
    if (s === 'ACTIVE')    return 'EN COURS';
    if (s === 'SCHEDULED') return 'PLANIFIÉ';
    if (s === 'COMPLETED') return 'TERMINÉ';
    return 'ANNULÉ';
  };

  return (
    <div style={styles.page}>
      {replayTripId && token && (
        <TripReplayModal tripId={replayTripId} token={token} onClose={() => setReplayTripId(null)} />
      )}
      <div style={styles.header}>
        <div>
          <div style={styles.h1}>DiomST · Contrôle de flotte</div>
          <p style={styles.sub}>GPS temps réel · vitesse · statuts flotte</p>
        </div>

        <div style={styles.rightHeader}>
          <div style={styles.wsBadge(wsStatus)}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: wsStatus === 'ON' ? '#16a34a' : wsStatus === 'ERR' ? '#ef4444' : '#9ca3af' }} />
            WS: <span style={styles.mono}>{wsStatus}</span>
            {wsError ? <span style={{ opacity: 0.75 }}>· {wsError}</span> : null}
          </div>

          <div style={styles.chip('#f3f4f6', '#374151')}>
            API: <span style={{ ...styles.mono, fontWeight: 950 }}>{API_BASE}</span>
          </div>

          <button
            onClick={() => { clearSession(); window.location.href = '/login'; }}
            style={{ padding: '6px 12px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer', color: '#374151' }}
          >
            Déconnexion
          </button>
        </div>
      </div>

      {/* Reconnect banner */}
      {wsStatus !== 'ON' && (
        <div style={{
          marginBottom: 8, padding: '6px 12px', borderRadius: 10,
          background: wsStatus === 'ERR' ? '#fee2e2' : wsStatus === 'RECONNECTING' ? '#fef9c3' : '#f3f4f6',
          color: wsStatus === 'ERR' ? '#991b1b' : wsStatus === 'RECONNECTING' ? '#854d0e' : '#374151',
          fontWeight: 900, fontSize: 12, border: '1px solid rgba(0,0,0,0.06)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0,
            background: wsStatus === 'ERR' ? '#ef4444' : wsStatus === 'RECONNECTING' ? '#f59e0b' : '#9ca3af' }} />
          {wsStatus === 'RECONNECTING' ? 'Reconnexion…'
            : wsStatus === 'ERR' ? `Erreur WebSocket${wsError ? ` : ${wsError}` : ''}`
            : `Non connecté${wsError ? ` : ${wsError}` : ''}`}
        </div>
      )}

      {/* Overspeed alerts */}
      {overspeedAlerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {overspeedAlerts.map((a) => {
            const sc = severityColors(a.severity);
            return (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '7px 12px', borderRadius: 10,
                border: `1px solid ${sc.border}`,
                background: sc.bg, fontSize: 12, fontWeight: 900, color: sc.text,
                borderLeft: `4px solid ${sc.left}`,
              }}>
                <span>
                  {a.severity === 'SEVERE' ? '🔴' : a.severity === 'MODERATE' ? '🟠' : '🟡'}{' '}
                  EXCÈS · <span style={styles.mono}>{a.phone}</span>
                  {' '}· {Math.round(a.speedKmh)} km/h (limite {a.limitKmh} km/h)
                  {' '}· {new Date(a.detectedAt).toLocaleTimeString()}
                </span>
                <button onClick={() => dismissOverspeed(a.id)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: sc.text, fontWeight: 950, fontSize: 14, lineHeight: 1, padding: '0 4px',
                }}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {/* GPS health alerts — bus lost permission/GPS mid-trip */}
      {healthAlerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {healthAlerts.map((h) => (
            <div key={h.userId} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              padding: '7px 12px', borderRadius: 10,
              border: '1px solid #fcd34d',
              background: '#fffbeb', fontSize: 12, fontWeight: 900, color: '#92400e',
              borderLeft: '4px solid #f59e0b',
            }}>
              <span>
                ⚠️ GPS · <span style={styles.mono}>{h.busNumber ?? h.userId.slice(0, 8)}</span>
                {' '}· {h.reason}
                {' '}· {new Date(h.at).toLocaleTimeString()}
              </span>
              <button
                onClick={() => setHealthAlerts((p) => p.filter((x) => x.userId !== h.userId))}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#92400e', fontWeight: 950, fontSize: 14, lineHeight: 1, padding: '0 4px',
                }}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      <div style={styles.grid(panelOpen)}>
        {/* RIGHT (visually): MAP + KPI — order:2 so it renders after panel */}
        <div style={{ ...styles.card, position: 'relative', order: 2 }}>
          {/* Panel toggle button — left edge of map */}
          <button
            onClick={() => setPanelOpen((v) => !v)}
            style={{
              position: 'absolute',
              left: -14,
              top: 24,
              zIndex: 10,
              width: 24,
              height: 48,
              borderRadius: '8px 0 0 8px',
              background: '#111827',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 900,
              boxShadow: '-2px 2px 8px rgba(0,0,0,0.15)',
            }}
            title={panelOpen ? 'Fermer le panneau' : 'Ouvrir le panneau'}
          >
            {panelOpen ? '‹' : '›'}
          </button>

          <div style={styles.cardTitleRow}>
            <h3 style={styles.title}>Carte flotte</h3>
            {selected ? (
              <div style={styles.chip('#111827', '#fff')}>
                Sélection: <span style={styles.mono}>{selected.phone ?? selected.userId.slice(0, 8)}</span>
              </div>
            ) : (
              <div style={styles.chip('#f3f4f6', '#374151')}>Cliquez un conducteur dans le panneau</div>
            )}
          </div>

          <div style={styles.kpiRow}>
            <div style={styles.kpi('linear-gradient(135deg, #ecfeff, #e0f2fe)')}>
              <div style={styles.kpiLabel}>Total</div>
              <div style={styles.kpiValue}>{counts.total}</div>
            </div>
            <div style={styles.kpi('linear-gradient(135deg, #ecfdf5, #dcfce7)')}>
              <div style={styles.kpiLabel}>En ligne</div>
              <div style={styles.kpiValue}>{counts.online}</div>
            </div>
            <div style={styles.kpi('linear-gradient(135deg, #fffbeb, #fef9c3)')}>
              <div style={styles.kpiLabel}>Inactif</div>
              <div style={styles.kpiValue}>{counts.stale}</div>
            </div>
            <div style={styles.kpi('linear-gradient(135deg, #fef2f2, #fee2e2)')}>
              <div style={styles.kpiLabel}>Hors ligne</div>
              <div style={styles.kpiValue}>{counts.offline}</div>
            </div>
          </div>

          {mapReady ? (
            <div style={styles.mapWrap}>
              {(() => {
                const vehicleMarkers = vehicles.map((v) => {
                  const status = (v.fleetStatus ?? 'OFFLINE') as FleetStatus;
                  const isSelected = v.userId === selectedId;
                  const busLabel = v.busId ? (busMap[v.busId]?.number ?? null) : null;
                  return (
                    <AnimatedMarker
                      key={v.userId}
                      longitude={v.lng}
                      latitude={v.lat}
                      anchor="bottom"
                      onClick={() => setSelectedId((prev) => (prev === v.userId ? null : v.userId))}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
                        {v.motionStatus === 'MOVING' && v.headingDeg != null && (
                          <div style={{
                            transform: `rotate(${Math.round(v.headingDeg)}deg)`,
                            fontSize: 11, lineHeight: 1, marginBottom: 2, color: '#111827',
                            transition: 'transform 600ms ease',
                            textShadow: '0 1px 2px rgba(255,255,255,0.8)',
                          }}>▲</div>
                        )}
                        {busLabel && (
                          <div style={{
                            background: '#111827', color: '#fff', fontSize: 10, fontWeight: 900,
                            padding: '1px 5px', borderRadius: 5, marginBottom: 3, whiteSpace: 'nowrap',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
                          }}>
                            {busLabel}
                          </div>
                        )}
                        <div style={markerDot(status, isSelected)} />
                        {status !== 'ONLINE' && v.ageMs !== undefined && (
                          <div style={{
                            marginTop: 3,
                            background: status === 'OFFLINE' ? '#ef4444' : '#f59e0b',
                            color: '#fff',
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '1px 4px',
                            borderRadius: 4,
                            whiteSpace: 'nowrap',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                          }}>
                            {formatAge(v.ageMs)}
                          </div>
                        )}
                      </div>
                    </AnimatedMarker>
                  );
                });
                return (
                  <Map
                    ref={mapRef}
                    mapStyle="https://tiles.openfreemap.org/styles/liberty"
                    initialViewState={{ longitude: -4.0267, latitude: 5.3364, zoom: 11 }}
                    style={{ width: '100%', height: '100%' }}
                  >
                    {vehicleMarkers}
                    {selected && (
                      <SelectedMarkerPopup
                        v={selected}
                        busMap={busMap}
                        routeMap={routeMap}
                        onClose={() => setSelectedId(null)}
                      />
                    )}
                  </Map>
                );
              })()}
            </div>
          ) : (
            <div style={styles.mapFallback}>{fallbackText}</div>
          )}

        </div>

        {/* LEFT (visually): ADMIN PANEL — order:1 so it renders before map */}
        <div style={{
          ...styles.card,
          order: 1,
          maxHeight: 'calc(100vh - 76px)',
          overflowY: panelOpen ? 'auto' : 'hidden',
          overflowX: 'hidden',
          position: 'sticky',
          top: 66,
          minWidth: 0,
          opacity: panelOpen ? 1 : 0,
          padding: panelOpen ? 12 : 0,
          border: panelOpen ? '1px solid rgba(0,0,0,0.06)' : 'none',
          transition: 'padding 0.22s ease, opacity 0.18s ease',
        }}>
          {panelOpen && (<>
          <div style={styles.cardTitleRow}>
            <h3 style={styles.title}>Administration</h3>
            {panel === 'FLOTTE' ? (
              <button style={styles.btn('ghost')} onClick={() => setSelectedId(null)}>
                Désélectionner
              </button>
            ) : null}
          </div>

          <div style={styles.tabs}>
            <div style={styles.tab(panel === 'FLOTTE')} onClick={() => setPanel('FLOTTE')}>FLOTTE</div>
            <div style={styles.tab(panel === 'BUS')} onClick={() => setPanel('BUS')}>BUS</div>
            <div style={styles.tab(panel === 'ROUTES')} onClick={() => setPanel('ROUTES')}>ROUTES</div>
            <div style={styles.tab(panel === 'TRAJETS')} onClick={() => setPanel('TRAJETS')}>TRAJETS</div>
            <div style={styles.tab(panel === 'ARRETS')} onClick={() => { setPanel('ARRETS'); refreshStops(); }}>ARRÊTS</div>
            <div style={styles.tab(panel === 'HISTORIQUE')} onClick={() => { setPanel('HISTORIQUE'); refreshTrips(); }}>HISTORIQUE</div>
            <div style={styles.tab(panel === 'ALERTES')} onClick={() => { setPanel('ALERTES'); refreshAlerts(); }}>ALERTES</div>
            <div style={styles.tab(panel === 'UTILISATEURS')} onClick={() => setPanel('UTILISATEURS')}>ÉQUIPE</div>
          </div>

          <div style={styles.divider} />

          {panel === 'FLOTTE' ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 950, color: '#111827' }}>Conducteurs</div>
                  <div style={styles.small}>Cliquez un conducteur pour centrer la carte et voir ses détails.</div>
                </div>
                <div style={styles.small}>
                  Affichés: <span style={styles.mono}>{vehicles.length}</span>
                </div>
              </div>

              <div style={styles.searchRow}>
                <input
                  style={styles.input}
                  placeholder="Rechercher (téléphone ou ID)…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />

                <select style={styles.select} value={filter} onChange={(e) => setFilter(e.target.value as any)}>
                  <option value="ALL">Tous statuts</option>
                  <option value="ONLINE">En ligne</option>
                  <option value="STALE">Inactif (GPS lent)</option>
                  <option value="OFFLINE">Hors ligne</option>
                </select>
              </div>

              <div style={styles.list}>
                {vehicles.length === 0 ? (
                  <div style={{ ...styles.small, padding: 12, border: '1px dashed #e5e7eb', borderRadius: 14 }}>
                    Aucune donnée flotte pour le moment.
                  </div>
                ) : (
                  vehicles.map((v) => {
                    const label = v.phone ?? v.userId.slice(0, 8);
                    const status = (v.fleetStatus ?? 'OFFLINE') as FleetStatus;
                    const motion = (v.motionStatus ?? 'IDLE') as MotionStatus;
                    const active = v.userId === selectedId;

                    return (
                      <div
                        key={v.userId}
                        style={styles.listItem(active)}
                        onClick={() => setSelectedId(v.userId)}
                      >
                        <div style={styles.leftCol}>
                          <div style={styles.labelStrong}>
                            <span style={styles.mono}>{label}</span>
                          </div>

                          <div style={styles.rowSmall}>
                            <div style={styles.small}>
                              Dernière maj: <span style={styles.mono}>{formatAge(v.ageMs)}</span>
                            </div>
                            <div style={styles.small}>
                              Vitesse: <span style={styles.mono}>{displaySpeedKmh(v)}</span>
                            </div>
                          </div>

                          <div style={styles.rowSmall}>
                            <div style={styles.small}>
                              Précision: <span style={styles.mono}>{Number.isFinite(v.accuracyM) ? `${Math.round(v.accuracyM)} m` : '—'}</span>
                            </div>
                            {v.confidence !== undefined ? (
                              <div style={styles.small}>
                                Confiance: <span style={styles.mono}>{(Math.max(0, Math.min(1, v.confidence)) * 100).toFixed(0)}%</span>
                              </div>
                            ) : null}
                          </div>
                          {(v.busId || v.routeId) ? (
                            <div style={styles.rowSmall}>
                              {v.busId ? <div style={styles.small}>Bus: <b>{busMap[v.busId]?.number ?? '—'}</b></div> : null}
                              {v.routeId ? <div style={styles.small}>Route: <b>{routeMap[v.routeId]?.name ?? '—'}</b></div> : null}
                            </div>
                          ) : null}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                          <div style={statusChip(status)}>{statusLabel(status)}</div>
                          <div style={motionChip(motion)}>{motion === 'MOVING' ? 'EN MOUVEMENT' : "À L'ARRÊT"}</div>
                          {active && (
                            <button
                              style={{
                                padding: '6px 12px',
                                borderRadius: 10,
                                border: 'none',
                                cursor: 'pointer',
                                fontWeight: 800,
                                fontSize: 12,
                                background: wkRecording ? '#dc2626' : '#111827',
                                color: '#fff',
                                userSelect: 'none',
                                touchAction: 'none',
                              }}
                              onMouseDown={(e) => { e.stopPropagation(); startTalking(v.userId); }}
                              onMouseUp={(e) => { e.stopPropagation(); stopTalking(); }}
                              onMouseLeave={() => stopTalking()}
                              onTouchStart={(e) => { e.stopPropagation(); startTalking(v.userId); }}
                              onTouchEnd={(e) => { e.stopPropagation(); stopTalking(); }}
                            >
                              {wkRecording ? '🔴 Envoi…' : '🎙 Parler'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : panel === 'BUS' ? (
            <>
              <div style={{ fontWeight: 950, color: '#111827' }}>Gestion des bus</div>
              <p style={{ ...styles.sub, marginTop: 4 }}>Ajoutez et gérez le parc de véhicules.</p>

              <div style={styles.formGrid}>
                <input style={styles.input} placeholder="Numéro du bus (ex: BUS-01)" value={bNumber} onChange={(e) => setBNumber(e.target.value)} />
                <input style={styles.input} placeholder="Immatriculation (optionnel)" value={bPlate} onChange={(e) => setBPlate(e.target.value)} />
              </div>
              <button style={{ ...styles.btn('primary'), marginTop: 8, width: '100%' }} onClick={onCreateBus} disabled={bCreateLoading || !bNumber.trim()}>
                {bCreateLoading ? 'Création…' : '+ Ajouter un bus'}
              </button>

              <div style={styles.divider} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 950 }}>Parc ({buses.length})</div>
                <button style={styles.btn('ghost')} onClick={refreshBuses} disabled={busesLoading}>{busesLoading ? '…' : 'Rafraîchir'}</button>
              </div>
              {busesError ? <div style={{ ...styles.small, color: '#991b1b', marginTop: 6 }}>{busesError}</div> : null}

              <div style={styles.list}>
                {buses.length === 0 ? (
                  <div style={{ ...styles.small, padding: 12, border: '1px dashed #e5e7eb', borderRadius: 14 }}>Aucun bus enregistré.</div>
                ) : buses.map((b) => (
                  <div key={b.id} style={styles.userRow}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div>
                        <span style={{ fontWeight: 950, color: '#111827' }}>{b.number}</span>
                        {b.plate ? <span style={{ ...styles.small, marginLeft: 8 }}>{b.plate}</span> : null}
                      </div>
                      <div style={b.isActive ? styles.chipSmall('#dcfce7', '#166534') : styles.chipSmall('#fee2e2', '#991b1b')}>
                        {b.isActive ? 'ACTIF' : 'INACTIF'}
                      </div>
                    </div>
                    <div style={styles.rowActions}>
                      <button style={b.isActive ? styles.btn('ghost') : styles.btn('primary')} onClick={() => onToggleBus(b)}>
                        {b.isActive ? 'Désactiver' : 'Activer'}
                      </button>
                      <button style={styles.btn('ghost')} onClick={() => { setPinBusId(pinBusId === b.id ? null : b.id); setPinValue(''); }}>
                        {pinBusId === b.id ? 'Annuler' : 'Changer de tablette'}
                      </button>
                    </div>
                    {pinBusId === b.id && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ ...styles.small, marginBottom: 6, color: '#6b7280' }}>
                          Entrez un nouveau code — l'ancienne tablette sera bloquée dès la prochaine tentative de connexion.
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            style={{ ...styles.input, flex: 1 }}
                            placeholder="Nouveau code (≥4 chiffres)"
                            value={pinValue}
                            onChange={(e) => setPinValue(e.target.value)}
                            inputMode="numeric"
                            maxLength={8}
                          />
                          <button style={styles.btn('primary')} onClick={() => onSetDevicePin(b.id)} disabled={pinLoading || pinValue.trim().length < 4}>
                            {pinLoading ? '…' : 'Confirmer'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>

          ) : panel === 'ROUTES' ? (
            <>
              <div style={{ fontWeight: 950, color: '#111827' }}>Gestion des routes</div>
              <p style={{ ...styles.sub, marginTop: 4 }}>Définissez les lignes opérées sur le territoire.</p>

              {stops.length === 0 && (
                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: '#fef9c3', border: '1px solid #fde68a', fontSize: 12, fontWeight: 700, color: '#854d0e' }}>
                  Créez d'abord vos arrêts dans l'onglet <b>ARRÊTS</b> pour pouvoir les sélectionner ici.
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <input style={styles.input} placeholder="Nom de la ligne (ex: Abidjan → Man)" value={rName} onChange={(e) => setRName(e.target.value)} />

                <select style={styles.select} value={rOriginStopId} onChange={(e) => setROriginStopId(e.target.value)}>
                  <option value="">— Gare de départ —</option>
                  {stops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.city ? ` (${s.city})` : ''}{s.lat != null ? ' ✓' : ''}
                    </option>
                  ))}
                </select>

                <select style={styles.select} value={rWaypointStopId} onChange={(e) => setRWaypointStopId(e.target.value)}>
                  <option value="">— Arrêt intermédiaire (optionnel) —</option>
                  {stops.filter((s) => s.id !== rOriginStopId && s.id !== rDestStopId).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.city ? ` (${s.city})` : ''}{s.lat != null ? ' ✓' : ''}
                    </option>
                  ))}
                </select>

                <select style={styles.select} value={rDestStopId} onChange={(e) => setRDestStopId(e.target.value)}>
                  <option value="">— Gare d'arrivée —</option>
                  {stops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.city ? ` (${s.city})` : ''}{s.lat != null ? ' ✓' : ''}
                    </option>
                  ))}
                </select>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    style={{ ...styles.input, flex: 1 }}
                    type="number"
                    placeholder="Limite de vitesse (km/h)"
                    value={rSpeedLimit}
                    min={20}
                    max={200}
                    onChange={(e) => setRSpeedLimit(e.target.value)}
                  />
                  <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 700, whiteSpace: 'nowrap' }}>km/h</span>
                </div>
              </div>
              <button
                style={{ ...styles.btn('primary'), marginTop: 8, width: '100%' }}
                onClick={onCreateRoute}
                disabled={rCreateLoading || !rOriginStopId || !rDestStopId}
              >
                {rCreateLoading ? 'Création…' : '+ Ajouter une route'}
              </button>

              <div style={styles.divider} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 950 }}>Lignes ({routes.length})</div>
                <button style={styles.btn('ghost')} onClick={refreshRoutes} disabled={routesLoading}>{routesLoading ? '…' : 'Rafraîchir'}</button>
              </div>
              {routesError ? <div style={{ ...styles.small, color: '#991b1b', marginTop: 6 }}>{routesError}</div> : null}

              <div style={styles.list}>
                {routes.length === 0 ? (
                  <div style={{ ...styles.small, padding: 12, border: '1px dashed #e5e7eb', borderRadius: 14 }}>Aucune route enregistrée.</div>
                ) : routes.map((r) => (
                  <RouteRow key={r.id} r={r} onToggle={onToggleRoute} onUpdateSpeed={onUpdateRouteSpeed} onUpdateGeo={onUpdateRouteGeo} />
                ))}
              </div>
            </>

          ) : panel === 'TRAJETS' ? (
            <>
              <div style={{ fontWeight: 950, color: '#111827' }}>Gestion des trajets</div>
              <p style={{ ...styles.sub, marginTop: 4 }}>Assignez un bus et une route pour créer un trajet.</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <select style={styles.select} value={tBusId} onChange={(e) => setTBusId(e.target.value)}>
                  <option value="">— Sélectionner un bus —</option>
                  {buses.filter((b) => b.isActive).map((b) => (
                    <option key={b.id} value={b.id}>{b.number}{b.plate ? ` · ${b.plate}` : ''}</option>
                  ))}
                </select>

                <select style={styles.select} value={tRouteId} onChange={(e) => setTRouteId(e.target.value)}>
                  <option value="">— Sélectionner une route —</option>
                  {routes.filter((r) => r.isActive).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <button
                style={{ ...styles.btn('primary'), marginTop: 8, width: '100%' }}
                onClick={onCreateTrip}
                disabled={tCreateLoading || !tBusId || !tRouteId}
              >
                {tCreateLoading ? 'Création…' : '+ Créer un trajet'}
              </button>

              <div style={styles.divider} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 950 }}>Trajets ({trips.length})</div>
                <button style={styles.btn('ghost')} onClick={refreshTrips} disabled={tripsLoading}>{tripsLoading ? '…' : 'Rafraîchir'}</button>
              </div>
              {tripsError ? <div style={{ ...styles.small, color: '#991b1b', marginTop: 6 }}>{tripsError}</div> : null}

              <div style={styles.list}>
                {trips.length === 0 ? (
                  <div style={{ ...styles.small, padding: 12, border: '1px dashed #e5e7eb', borderRadius: 14 }}>Aucun trajet enregistré.</div>
                ) : trips.map((t) => {
                  const bus    = busMap[t.busId];
                  const route  = routeMap[t.routeId];
                  return (
                    <div key={t.id} style={styles.userRow}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <div>
                          <div style={{ fontWeight: 950, color: '#111827', fontSize: 13 }}>
                            {bus?.number ?? t.busId.slice(0, 8)}
                          </div>
                          <div style={styles.small}>
                            {route?.name ?? '—'}
                          </div>
                        </div>
                        <div style={tripStatusChip(t.status)}>{tripStatusLabel(t.status)}</div>
                      </div>

                      {t.startedAt ? (
                        <div style={styles.small}>
                          Départ: {new Date(t.startedAt).toLocaleString()}
                          {t.endedAt ? <span> · Fin: {new Date(t.endedAt).toLocaleString()}</span> : null}
                        </div>
                      ) : null}

                      <div style={styles.rowActions}>
                        {t.status === 'SCHEDULED' ? (
                          <button style={styles.btn('primary')} onClick={() => onStartTrip(t.id)}>Démarrer</button>
                        ) : null}
                        {t.status === 'ACTIVE' ? (
                          <button style={styles.btn('ghost')} onClick={() => onEndTrip(t.id)}>Terminer</button>
                        ) : null}
                        {(t.status === 'SCHEDULED' || t.status === 'ACTIVE') ? (
                          <button style={styles.btn('danger')} onClick={() => onCancelTrip(t.id)}>Annuler</button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>

          ) : panel === 'ARRETS' ? (
            <>
              <div style={{ fontWeight: 950, color: '#111827' }}>Gares et arrêts</div>
              <p style={{ ...styles.sub, marginTop: 4 }}>
                Créez chaque gare séparément. Sur place, cliquez <b>Capturer ma position</b> pour enregistrer les coordonnées GPS exactes.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <input style={styles.input} placeholder="Nom de la gare (ex: Gare d'Abidjan)" value={sName} onChange={(e) => setSName(e.target.value)} />
                <input style={styles.input} placeholder="Ville (optionnel)" value={sCity} onChange={(e) => setSCity(e.target.value)} />

                {/* Optional: capture GPS now if admin is already on-site */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #6366f1', background: sLat !== null ? '#ecfdf5' : '#f5f3ff', color: sLat !== null ? '#166534' : '#6366f1', fontWeight: 800, fontSize: 12, cursor: sCapturing ? 'not-allowed' : 'pointer' }}
                    disabled={sCapturing}
                    onClick={captureForCreate}
                  >
                    {sCapturing ? 'Localisation…' : sLat !== null ? 'Position capturée ✓' : 'Capturer ma position (optionnel)'}
                  </button>
                  {sLat !== null && sLng !== null && (
                    <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'ui-monospace, monospace' }}>
                      {sLat.toFixed(5)}, {sLng.toFixed(5)}
                    </span>
                  )}
                  {sLat !== null && (
                    <button type="button" onClick={() => { setSLat(null); setSLng(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 13, padding: 0 }}>✕</button>
                  )}
                </div>
              </div>
              <button
                style={{ ...styles.btn('primary'), marginTop: 8, width: '100%' }}
                onClick={onCreateStop}
                disabled={sCreateLoading || !sName.trim()}
              >
                {sCreateLoading ? 'Création…' : '+ Ajouter un arrêt'}
              </button>

              <div style={styles.divider} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 950 }}>Arrêts ({stops.length})</div>
                <button style={styles.btn('ghost')} onClick={refreshStops} disabled={stopsLoading}>{stopsLoading ? '…' : 'Rafraîchir'}</button>
              </div>
              {stopsError ? <div style={{ ...styles.small, color: '#991b1b', marginTop: 6 }}>{stopsError}</div> : null}

              <div style={styles.list}>
                {stops.length === 0 ? (
                  <div style={{ ...styles.small, padding: 12, border: '1px dashed #e5e7eb', borderRadius: 14 }}>
                    Aucun arrêt enregistré.
                  </div>
                ) : stops.map((s) => (
                  <div key={s.id} style={styles.userRow}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 950, color: '#111827' }}>{s.name}</div>
                        {s.city ? <div style={styles.small}>{s.city}</div> : null}
                      </div>
                      <div style={s.lat != null
                        ? { padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 800, background: '#dcfce7', color: '#166534' }
                        : { padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 800, background: '#fef9c3', color: '#854d0e' }
                      }>
                        {s.lat != null ? 'GPS OK' : 'Sans GPS'}
                      </div>
                    </div>

                    {s.lat != null && s.lng != null ? (
                      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                        {s.lat.toFixed(6)}, {s.lng.toFixed(6)}
                        {s.capturedAt ? <span style={{ marginLeft: 8 }}>· capturé {new Date(s.capturedAt).toLocaleDateString('fr-FR')}</span> : null}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700 }}>
                        Coordonnées non encore capturées
                      </div>
                    )}

                    <button
                      style={{
                        padding: '6px 12px', borderRadius: 8, border: '1px solid #6366f1',
                        background: capturingStopId === s.id ? '#f5f3ff' : '#6366f1',
                        color: capturingStopId === s.id ? '#6366f1' : '#fff',
                        fontWeight: 800, fontSize: 12, cursor: capturingStopId === s.id ? 'not-allowed' : 'pointer',
                        marginTop: 4,
                      }}
                      disabled={capturingStopId === s.id}
                      onClick={() => onCaptureStopLocation(s)}
                    >
                      {capturingStopId === s.id ? 'Localisation en cours…' : 'Capturer ma position'}
                    </button>
                  </div>
                ))}
              </div>
            </>

          ) : panel === 'HISTORIQUE' ? (
            <HistoriquePanel trips={trips} userMap={userMap} busMap={busMap} routeMap={routeMap} loading={tripsLoading} onRefresh={refreshTrips} onReplay={setReplayTripId} />

          ) : panel === 'ALERTES' ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 950, color: '#111827' }}>Excès de vitesse ({overspeedRecords.length})</div>
                <button style={styles.btn('ghost')} onClick={refreshAlerts} disabled={alertsLoading}>{alertsLoading ? '…' : 'Rafraîchir'}</button>
              </div>
              <p style={{ ...styles.sub, marginTop: 4 }}>Historique complet · cliquez ✓ pour acquitter.</p>

              <div style={styles.list}>
                {overspeedRecords.length === 0 ? (
                  <div style={{ ...styles.small, padding: 12, border: '1px dashed #e5e7eb', borderRadius: 14, textAlign: 'center' }}>
                    Aucun excès enregistré.
                  </div>
                ) : overspeedRecords.map((a) => {
                  const sc = severityColors(a.severity);
                  return (
                    <div key={a.id} style={{
                      ...styles.userRow,
                      opacity: a.acknowledged ? 0.5 : 1,
                      borderLeft: a.acknowledged ? '3px solid #d1d5db' : `3px solid ${sc.left}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 900, fontSize: 13, color: '#111827' }}>
                            {a.severity === 'SEVERE' ? '🔴' : a.severity === 'MODERATE' ? '🟠' : '🟡'}{' '}
                            {a.label} · <span style={{ color: sc.left }}>{Math.round(a.speedKmh)} km/h</span>
                            <span style={{ color: '#6b7280', fontWeight: 700 }}> (limite {a.limitKmh} km/h)</span>
                          </div>
                          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginTop: 2 }}>
                            {new Date(a.detectedAt).toLocaleString('fr-FR')} · {Math.round(a.durationMs / 1000)}s en excès
                          </div>
                        </div>
                        {!a.acknowledged && (
                          <button
                            onClick={() => acknowledgeAlert(a.id)}
                            style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '4px 10px', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
                          >✓</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>

          ) : (
            <>
              <div style={{ fontWeight: 950, color: '#111827' }}>Gestion des utilisateurs</div>
              <p style={{ ...styles.sub, marginTop: 6 }}>
                Créer drivers / opérateurs, activer/désactiver, changer rôle, réinitialiser PIN.
              </p>

              {!token ? (
                <div style={{ ...styles.small, padding: 12, border: '1px dashed #e5e7eb', borderRadius: 14 }}>
                  Connectez-vous en ADMIN.
                </div>
              ) : (
                <>
                  <div style={{ fontWeight: 950, marginTop: 8 }}>Créer un utilisateur</div>

                  <div style={styles.formGrid}>
                    <input style={styles.input} placeholder="Prénom" value={cFirst} onChange={(e) => setCFirst(e.target.value)} />
                    <input style={styles.input} placeholder="Nom" value={cLast} onChange={(e) => setCLast(e.target.value)} />
                    <input style={styles.input} placeholder="Téléphone (8–10 chiffres)" value={cPhone} onChange={(e) => setCPhone(e.target.value)} />
                    <input style={styles.input} placeholder="PIN (4–8 chiffres)" value={cPin} onChange={(e) => setCPin(e.target.value)} />

                    <select style={styles.select} value={cRole} onChange={(e) => setCRole(e.target.value as UserRole)}>
                      <option value="DRIVER">DRIVER</option>
                      <option value="OPERATOR">OPERATOR</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>

                    <button style={styles.btn('primary')} onClick={onCreateUser} disabled={createLoading}>
                      {createLoading ? 'Création…' : 'Créer'}
                    </button>
                  </div>

                  <div style={styles.divider} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontWeight: 950 }}>Utilisateurs</div>
                    <button style={styles.btn('ghost')} onClick={refreshUsers} disabled={usersLoading}>
                      {usersLoading ? 'Chargement…' : 'Rafraîchir'}
                    </button>
                  </div>

                  {usersError ? <div style={{ ...styles.small, color: '#991b1b' }}>{usersError}</div> : null}
                  <div style={styles.small}>API: {API_BASE}</div>

                  {users.length === 0 ? (
                    <div style={{ ...styles.small, padding: 12, border: '1px dashed #e5e7eb', borderRadius: 14 }}>
                      Aucun utilisateur trouvé.
                    </div>
                  ) : (
                    users.map((u) => (
                      <div key={u.id} style={styles.userRow}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                          <div style={{ fontWeight: 950, color: '#111827' }}>
                            {u.firstName} {u.lastName} · <span style={styles.mono}>{u.phone}</span>
                          </div>
                          <div style={styles.badgeRole(u.role)}>{u.role}</div>
                        </div>

                        <div style={styles.rowSmall}>
                          <div style={styles.small}>
                            Statut: <span style={styles.mono}>{u.isActive ? 'ACTIF' : 'DÉSACTIVÉ'}</span>
                          </div>
                          <div style={styles.small}>
                            Créé: <span style={styles.mono}>{new Date(u.createdAt).toLocaleString()}</span>
                          </div>
                        </div>

                        <div style={styles.rowActions}>
                          <select style={styles.select} value={u.role} onChange={(e) => onUpdateUser(u.id, { role: e.target.value as UserRole })}>
                            <option value="DRIVER">DRIVER</option>
                            <option value="OPERATOR">OPERATOR</option>
                            <option value="ADMIN">ADMIN</option>
                          </select>

                          <button
                            style={u.isActive ? styles.btn('ghost') : styles.btn('primary')}
                            onClick={() => onUpdateUser(u.id, { isActive: !u.isActive })}
                          >
                            {u.isActive ? 'Désactiver' : 'Activer'}
                          </button>

                          <button style={styles.btn('danger')} onClick={() => onResetPin(u.id)}>
                            Reset PIN
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </>
          )}
          </>)}
        </div>
      </div>
    </div>
  );
}
