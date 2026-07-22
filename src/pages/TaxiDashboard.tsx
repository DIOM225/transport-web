import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import Map, { Marker, Popup, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getToken, getUser, clearSession } from '../lib/auth';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://transport-api-production-d0c6.up.railway.app';
const WS_URL = `${API_BASE}/ws`;

// Presence thresholds — synced with the gateway.
const ONLINE_MS = 3 * 60_000;
const STALE_MS = 10 * 60_000;

type FleetStatus = 'ONLINE' | 'STALE' | 'OFFLINE';
type Vehicle = {
  userId: string; busId?: string | null; lat: number; lng: number;
  speedKmh?: number | null; headingDeg?: number | null; motionStatus?: string;
  lastSeenAt?: number; shiftId?: string | null; phone?: string;
};
type ZoneKind = 'ALLOWED' | 'RESTRICTED';
type Zone = { id: string; name: string; kind: ZoneKind; centerLat: number; centerLng: number; radiusM: number; isActive: boolean };
type DailyRow = {
  shiftId: string; vehicleNumber: string; vehiclePlate: string | null; driverName: string; driverPhone: string | null;
  status: string; startedAt: string | null; endedAt: string | null;
  distanceKm: number; durationMin: number | null; maxSpeedKmh: number | null; avgSpeedKmh: number | null; overspeedCount: number;
};
type LeaderRow = { driverId: string; driverName: string; distanceKm: number; durationMin: number; maxSpeedKmh: number; overspeedCount: number; shifts: number };
type Alert = { id: string; kind: 'AFTERHOURS' | 'ZONE' | 'SPEED'; text: string; at: number };

type Tab = 'LIVE' | 'REPORT' | 'LEADER' | 'ZONES' | 'DRIVERS' | 'VEHICLES';

type Driver = { id: string; firstName: string; lastName: string; phone: string; role: string; isActive: boolean; assignedVehicleId?: string | null };
type FleetVehicle = { id: string; number: string; plate: string | null; isActive: boolean };
const TAB_LABEL: Record<Tab, string> = {
  LIVE: 'Carte', REPORT: 'Rapport du jour', LEADER: 'Classement',
  ZONES: 'Zones', DRIVERS: 'Chauffeurs', VEHICLES: 'Véhicules',
};

async function authFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers as any) },
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Session expirée' : `Erreur ${res.status}`);
  return (await res.json()) as T;
}

function fleetStatus(lastSeenAt?: number): FleetStatus {
  if (!lastSeenAt) return 'OFFLINE';
  const age = Date.now() - lastSeenAt;
  return age <= ONLINE_MS ? 'ONLINE' : age <= STALE_MS ? 'STALE' : 'OFFLINE';
}
const statusColor = (s: FleetStatus) => (s === 'ONLINE' ? '#16a34a' : s === 'STALE' ? '#f59e0b' : '#ef4444');
const fmtKm = (n?: number | null) => (n == null ? '—' : `${n.toFixed(1)} km`);
const fmtMin = (n?: number | null) => (n == null ? '—' : `${Math.round(n)} min`);
const fmtKmh = (n?: number | null) => (n == null ? '—' : `${Math.round(n)} km/h`);
const today = () => new Date().toISOString().slice(0, 10);

/** Circle polygon for a zone (GeoJSON), ~48 segments. */
function circleGeoJSON(lat: number, lng: number, radiusM: number) {
  const pts: [number, number][] = [];
  const R = 6371000;
  for (let i = 0; i <= 48; i++) {
    const brng = (i / 48) * 2 * Math.PI;
    const dR = radiusM / R;
    const lat2 = Math.asin(Math.sin((lat * Math.PI) / 180) * Math.cos(dR) + Math.cos((lat * Math.PI) / 180) * Math.sin(dR) * Math.cos(brng));
    const lng2 = (lng * Math.PI) / 180 + Math.atan2(Math.sin(brng) * Math.sin(dR) * Math.cos((lat * Math.PI) / 180), Math.cos(dR) - Math.sin((lat * Math.PI) / 180) * Math.sin(lat2));
    pts.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [pts] } };
}

export default function TaxiDashboard() {
  const user = getUser();
  const [tab, setTab] = useState<Tab>('LIVE');
  const [fleet, setFleet] = useState<Record<string, Vehicle>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [wsOn, setWsOn] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const mapRef = useRef<MapRef>(null);
  const [, forceTick] = useState(0);

  // Re-render every 20 s so presence colors decay.
  useEffect(() => { const t = setInterval(() => forceTick((n) => n + 1), 20_000); return () => clearInterval(t); }, []);

  // Socket
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket = io(WS_URL, { path: '/socket.io', transports: ['websocket'], auth: { token } });
    socketRef.current = socket;
    socket.on('connect', () => setWsOn(true));
    socket.on('disconnect', () => setWsOn(false));

    const upsert = (p: any) => {
      if (!p?.userId || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
      setFleet((prev) => ({ ...prev, [p.userId]: { ...prev[p.userId], ...p, lastSeenAt: Date.now() } }));
    };
    socket.on('fleet:snapshot', (rows: any[]) => { if (Array.isArray(rows)) rows.forEach(upsert); });
    socket.on('fleet:position', upsert);
    socket.on('fleet:status', (rows: any[]) => { if (Array.isArray(rows)) rows.forEach(upsert); });

    const pushAlert = (a: Alert) => {
      setAlerts((prev) => [a, ...prev].slice(0, 12));
      setTimeout(() => setAlerts((prev) => prev.filter((x) => x.id !== a.id)), 90_000);
    };
    socket.on('taxi:afterhours', (e: any) =>
      pushAlert({ id: `ah-${e.userId}-${e.at}`, kind: 'AFTERHOURS', at: e.at ?? Date.now(),
        text: `Mouvement hors service — véhicule ${e.busId ?? e.userId?.slice(0, 6)}` }));
    socket.on('taxi:zone', (e: any) =>
      pushAlert({ id: `z-${e.userId}-${e.at}`, kind: 'ZONE', at: e.at ?? Date.now(),
        text: e.kind === 'ALLOWED' ? `Sortie de zone «${e.zoneName}»` : `Entrée en zone interdite «${e.zoneName}»` }));
    socket.on('driver:overspeed', (e: any) =>
      pushAlert({ id: `s-${e.userId}-${e.detectedAt}`, kind: 'SPEED', at: e.detectedAt ?? Date.now(),
        text: `Excès de vitesse — ${Math.round(e.speedKmh ?? 0)} km/h (limite ${e.limitKmh})` }));

    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  // Seed live positions
  useEffect(() => {
    authFetch<any[]>('/positions/live').then((rows) => {
      if (!Array.isArray(rows)) return;
      setFleet((prev) => { const next = { ...prev }; rows.forEach((p) => { if (p?.userId) next[p.userId] = { ...p, lastSeenAt: p.lastSeenAt ?? Date.now() }; }); return next; });
    }).catch(() => {});
  }, []);

  const vehicles = useMemo(() => Object.values(fleet), [fleet]);
  const counts = useMemo(() => {
    let online = 0, stale = 0, offline = 0;
    vehicles.forEach((v) => { const s = fleetStatus(v.lastSeenAt); if (s === 'ONLINE') online++; else if (s === 'STALE') stale++; else offline++; });
    return { online, stale, offline, total: vehicles.length };
  }, [vehicles]);

  const logout = () => { clearSession(); window.location.href = '/login'; };

  return (
    <div style={st.page}>
      <div style={st.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong style={{ fontSize: 18 }}>DiomST</strong>
          <span style={st.badge}>TAXI</span>
          <span style={{ ...st.wsDot, background: wsOn ? '#16a34a' : '#ef4444' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>{user?.phone}</span>
          <button style={st.logout} onClick={logout}>Se déconnecter</button>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 16px 0' }}>
          {alerts.map((a) => (
            <div key={a.id} style={st.alert(a.kind)}>
              <span>{a.kind === 'SPEED' ? '🚨' : a.kind === 'ZONE' ? '📍' : '🌙'} {a.text} · {new Date(a.at).toLocaleTimeString()}</span>
              <button style={st.alertX} onClick={() => setAlerts((p) => p.filter((x) => x.id !== a.id))}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={st.tabs}>
        {(['LIVE', 'REPORT', 'LEADER', 'ZONES', 'DRIVERS', 'VEHICLES'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...st.tab, ...(tab === t ? st.tabOn : {}) }}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      <div style={st.body}>
        {tab === 'LIVE' && <LiveTab vehicles={vehicles} counts={counts} mapRef={mapRef} />}
        {tab === 'REPORT' && <ReportTab />}
        {tab === 'LEADER' && <LeaderTab />}
        {tab === 'ZONES' && <ZonesTab mapRef={mapRef} />}
        {tab === 'DRIVERS' && <DriversTab />}
        {tab === 'VEHICLES' && <VehiclesTab />}
      </div>
    </div>
  );
}

/* ---------------- LIVE ---------------- */
function LiveTab({ vehicles, counts, mapRef }: { vehicles: Vehicle[]; counts: any; mapRef: React.RefObject<MapRef | null> }) {
  const [sel, setSel] = useState<string | null>(null);
  const selected = vehicles.find((v) => v.userId === sel) ?? null;
  return (
    <div style={st.liveGrid}>
      <div style={st.card}>
        <div style={st.kpis}>
          <Kpi label="En ligne" value={counts.online} color="#16a34a" />
          <Kpi label="Inactif" value={counts.stale} color="#f59e0b" />
          <Kpi label="Hors ligne" value={counts.offline} color="#ef4444" />
        </div>
        <div style={{ height: 480, borderRadius: 12, overflow: 'hidden', marginTop: 10 }}>
          <Map ref={mapRef} mapStyle="https://tiles.openfreemap.org/styles/liberty"
            initialViewState={{ longitude: -4.0083, latitude: 5.345, zoom: 11 }} style={{ width: '100%', height: '100%' }}>
            {vehicles.map((v) => {
              const s = fleetStatus(v.lastSeenAt);
              return (
                <Marker key={v.userId} longitude={v.lng} latitude={v.lat} anchor="bottom" onClick={() => setSel(v.userId)}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
                    {v.motionStatus === 'MOVING' && v.headingDeg != null && (
                      <div style={{ transform: `rotate(${Math.round(v.headingDeg)}deg)`, fontSize: 11, color: '#111827' }}>▲</div>
                    )}
                    <div style={{ width: 16, height: 16, borderRadius: 999, background: statusColor(s), border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }} />
                  </div>
                </Marker>
              );
            })}
            {selected && (
              <Popup longitude={selected.lng} latitude={selected.lat} anchor="top" onClose={() => setSel(null)} closeButton>
                <div style={{ fontSize: 12 }}>
                  <strong>Véhicule {selected.busId?.slice(0, 6) ?? '—'}</strong><br />
                  {fmtKmh(selected.speedKmh)} · {selected.motionStatus === 'MOVING' ? 'En mouvement' : 'À l\'arrêt'}
                </div>
              </Popup>
            )}
          </Map>
        </div>
      </div>
      <div style={st.card}>
        <h3 style={st.h3}>Véhicules ({vehicles.length})</h3>
        {vehicles.length === 0 ? <p style={st.dim}>Aucun véhicule en service.</p> :
          vehicles.map((v) => {
            const s = fleetStatus(v.lastSeenAt);
            return (
              <div key={v.userId} onClick={() => setSel(v.userId)} style={st.vehRow}>
                <span style={{ ...st.dot, background: statusColor(s) }} />
                <span style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>{v.busId?.slice(0, 8) ?? v.userId.slice(0, 8)}</span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>{fmtKmh(v.speedKmh)}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/* ---------------- REPORT ---------------- */
function ReportTab() {
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true); setErr(null);
    authFetch<DailyRow[]>(`/shifts/report/daily?date=${date}`)
      .then(setRows).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, [date]);
  const totals = rows.reduce((a, r) => ({ km: a.km + (r.distanceKm ?? 0), min: a.min + (r.durationMin ?? 0), over: a.over + (r.overspeedCount ?? 0) }), { km: 0, min: 0, over: 0 });
  return (
    <div style={st.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h3 style={st.h3}>Rapport journalier</h3>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={st.input} />
      </div>
      {err && <p style={{ color: '#991b1b' }}>{err}</p>}
      {loading ? <p style={st.dim}>Chargement…</p> : rows.length === 0 ? <p style={st.dim}>Aucune activité ce jour.</p> : (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 13 }}>
            <span><strong>{totals.km.toFixed(1)} km</strong> total</span>
            <span><strong>{Math.round(totals.min)} min</strong> conduite</span>
            <span><strong>{totals.over}</strong> excès</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={st.table}>
              <thead><tr>
                {['Véhicule', 'Chauffeur', 'Début', 'Distance', 'Durée', 'V.max', 'Excès', 'Statut'].map((h) => <th key={h} style={st.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.shiftId}>
                    <td style={st.td}>{r.vehicleNumber}</td>
                    <td style={st.td}>{r.driverName}</td>
                    <td style={st.td}>{r.startedAt ? new Date(r.startedAt).toLocaleTimeString() : '—'}</td>
                    <td style={st.td}>{fmtKm(r.distanceKm)}</td>
                    <td style={st.td}>{fmtMin(r.durationMin)}</td>
                    <td style={st.td}>{fmtKmh(r.maxSpeedKmh)}</td>
                    <td style={{ ...st.td, color: r.overspeedCount > 0 ? '#991b1b' : '#374151', fontWeight: r.overspeedCount > 0 ? 800 : 400 }}>{r.overspeedCount}</td>
                    <td style={st.td}>{r.status === 'ACTIVE' ? '🟢 En service' : '✔ Terminé'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- LEADERBOARD ---------------- */
function LeaderTab() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    authFetch<LeaderRow[]>(`/shifts/leaderboard?from=${from}&to=${to}`).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [from, to]);
  return (
    <div style={st.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 style={st.h3}>Classement des chauffeurs</h3>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={st.input} />
        <span style={{ color: '#9ca3af' }}>→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={st.input} />
      </div>
      {loading ? <p style={st.dim}>Chargement…</p> : rows.length === 0 ? <p style={st.dim}>Aucune donnée.</p> : (
        <table style={st.table}>
          <thead><tr>{['#', 'Chauffeur', 'Distance', 'Conduite', 'V.max', 'Excès', 'Services'].map((h) => <th key={h} style={st.th}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.driverId}>
                <td style={{ ...st.td, fontWeight: 900 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                <td style={st.td}>{r.driverName}</td>
                <td style={{ ...st.td, fontWeight: 800 }}>{fmtKm(r.distanceKm)}</td>
                <td style={st.td}>{fmtMin(r.durationMin)}</td>
                <td style={st.td}>{fmtKmh(r.maxSpeedKmh)}</td>
                <td style={{ ...st.td, color: r.overspeedCount > 0 ? '#991b1b' : '#374151' }}>{r.overspeedCount}</td>
                <td style={st.td}>{r.shifts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- DRIVERS ---------------- */
function DriversTab() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = () =>
    Promise.all([
      authFetch<Driver[]>('/users').then((all) => all.filter((u) => u.role === 'DRIVER')).catch(() => []),
      authFetch<FleetVehicle[]>('/buses').catch(() => []),
    ]).then(([ds, vs]) => { setDrivers(ds); setFleet(vs); });
  useEffect(() => { load(); }, []);

  const assignVehicle = async (d: Driver, vehicleId: string) => {
    await authFetch(`/users/${d.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ assignedVehicleId: vehicleId || null }),
    }).catch(() => {});
    load();
  };

  const valid = firstName.trim() && lastName.trim() && /^\d{8,10}$/.test(phone.trim()) && /^\d{4,8}$/.test(pin.trim());

  const create = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr(null); setOk(null);
    try {
      await authFetch('/users', {
        method: 'POST',
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim(), pin: pin.trim(), role: 'DRIVER' }),
      });
      setOk(`Chauffeur ${firstName} créé. PIN communiqué : ${pin}`);
      setFirstName(''); setLastName(''); setPhone(''); setPin('');
      await load();
    } catch (e: any) {
      setErr(e?.message === 'Erreur 400' ? 'Téléphone déjà utilisé ou données invalides.' : (e?.message ?? 'Erreur'));
    } finally { setBusy(false); }
  };

  const toggleActive = async (d: Driver) => {
    await authFetch(`/users/${d.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !d.isActive }) }).catch(() => {});
    load();
  };
  const resetPin = async (d: Driver) => {
    const np = window.prompt(`Nouveau PIN (4–8 chiffres) pour ${d.firstName} ${d.lastName} :`);
    if (!np) return;
    if (!/^\d{4,8}$/.test(np)) { alert('Le PIN doit contenir 4 à 8 chiffres.'); return; }
    await authFetch(`/users/${d.id}/pin`, { method: 'PATCH', body: JSON.stringify({ pin: np }) })
      .then(() => alert('PIN réinitialisé.')).catch((e) => alert(e?.message ?? 'Erreur'));
  };

  return (
    <div style={st.liveGrid}>
      <div style={st.card}>
        <h3 style={st.h3}>Nouveau chauffeur</h3>
        <p style={st.dim}>Le chauffeur se connecte dans l'app mobile (onglet « Chauffeur ») avec son téléphone et son PIN.</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input placeholder="Prénom" value={firstName} onChange={(e) => setFirstName(e.target.value)} style={{ ...st.input, flex: 1 }} />
          <input placeholder="Nom" value={lastName} onChange={(e) => setLastName(e.target.value)} style={{ ...st.input, flex: 1 }} />
        </div>
        <input placeholder="Téléphone (8–10 chiffres)" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={{ ...st.input, width: '100%', marginTop: 8 }} />
        <input placeholder="PIN (4–8 chiffres)" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" type="password" style={{ ...st.input, width: '100%', marginTop: 8 }} />
        {err && <p style={{ color: '#991b1b', fontSize: 13, marginTop: 8 }}>{err}</p>}
        {ok && <p style={{ color: '#166534', fontSize: 13, marginTop: 8, fontWeight: 700 }}>{ok}</p>}
        <button onClick={create} disabled={!valid || busy} style={{ ...st.primary, ...((!valid || busy) ? { opacity: 0.5 } : {}) }}>
          {busy ? '…' : 'Créer le chauffeur'}
        </button>
      </div>
      <div style={st.card}>
        <h3 style={st.h3}>Chauffeurs ({drivers.length})</h3>
        {drivers.length === 0 ? <p style={st.dim}>Aucun chauffeur.</p> : drivers.map((d) => (
          <div key={d.id} style={{ ...st.zoneRow, flexWrap: 'wrap' }}>
            <span style={{ ...st.dot, background: d.isActive ? '#16a34a' : '#9ca3af' }} />
            <span style={{ flex: 1, minWidth: 140, fontSize: 13 }}>
              <strong>{d.firstName} {d.lastName}</strong> <span style={{ color: '#9ca3af' }}>· {d.phone}</span>
              {!d.isActive && <span style={{ color: '#991b1b', fontWeight: 700 }}> · désactivé</span>}
            </span>
            <select
              value={d.assignedVehicleId ?? ''}
              onChange={(e) => assignVehicle(d, e.target.value)}
              style={st.assignSelect}
              title="Véhicule assigné"
            >
              <option value="">— Aucun véhicule —</option>
              {fleet.filter((v) => v.isActive).map((v) => (
                <option key={v.id} value={v.id}>{v.number}{v.plate ? ` · ${v.plate}` : ''}</option>
              ))}
            </select>
            <button onClick={() => resetPin(d)} style={st.smallBtn} title="Réinitialiser le PIN">PIN</button>
            <button onClick={() => toggleActive(d)} style={st.smallBtn}>{d.isActive ? 'Désactiver' : 'Activer'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- VEHICLES ---------------- */
function VehiclesTab() {
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [number, setNumber] = useState('');
  const [plate, setPlate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => authFetch<FleetVehicle[]>('/buses').then(setVehicles).catch(() => setVehicles([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!number.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      await authFetch('/buses', { method: 'POST', body: JSON.stringify({ number: number.trim(), plate: plate.trim() || undefined }) });
      setNumber(''); setPlate(''); await load();
    } catch (e: any) {
      setErr(e?.message === 'Erreur 400' ? 'Ce numéro de véhicule existe déjà.' : (e?.message ?? 'Erreur'));
    } finally { setBusy(false); }
  };
  const toggleActive = async (v: FleetVehicle) => {
    await authFetch(`/buses/${v.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !v.isActive }) }).catch(() => {});
    load();
  };

  return (
    <div style={st.liveGrid}>
      <div style={st.card}>
        <h3 style={st.h3}>Nouveau véhicule</h3>
        <p style={st.dim}>Les chauffeurs choisissent un véhicule au début de leur journée.</p>
        <input placeholder="Numéro / identifiant (ex : TAXI-04)" value={number} onChange={(e) => setNumber(e.target.value)} style={{ ...st.input, width: '100%', marginTop: 10 }} />
        <input placeholder="Immatriculation (optionnel)" value={plate} onChange={(e) => setPlate(e.target.value)} style={{ ...st.input, width: '100%', marginTop: 8 }} />
        {err && <p style={{ color: '#991b1b', fontSize: 13, marginTop: 8 }}>{err}</p>}
        <button onClick={create} disabled={!number.trim() || busy} style={{ ...st.primary, ...((!number.trim() || busy) ? { opacity: 0.5 } : {}) }}>
          {busy ? '…' : 'Ajouter le véhicule'}
        </button>
      </div>
      <div style={st.card}>
        <h3 style={st.h3}>Véhicules ({vehicles.length})</h3>
        {vehicles.length === 0 ? <p style={st.dim}>Aucun véhicule.</p> : vehicles.map((v) => (
          <div key={v.id} style={st.zoneRow}>
            <span style={{ ...st.dot, background: v.isActive ? '#16a34a' : '#9ca3af' }} />
            <span style={{ flex: 1, fontSize: 13 }}>
              <strong>{v.number}</strong>{v.plate ? <span style={{ color: '#9ca3af' }}> · {v.plate}</span> : null}
              {!v.isActive && <span style={{ color: '#991b1b', fontWeight: 700 }}> · désactivé</span>}
            </span>
            <button onClick={() => toggleActive(v)} style={st.smallBtn}>{v.isActive ? 'Désactiver' : 'Activer'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- ZONES ---------------- */
function ZonesTab({ mapRef }: { mapRef: React.RefObject<MapRef | null> }) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ZoneKind>('ALLOWED');
  const [radius, setRadius] = useState(2000);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => authFetch<Zone[]>('/zones').then(setZones).catch(() => setZones([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim() || !pin || busy) return;
    setBusy(true);
    try {
      await authFetch('/zones', { method: 'POST', body: JSON.stringify({ name: name.trim(), kind, centerLat: pin.lat, centerLng: pin.lng, radiusM: radius }) });
      setName(''); setPin(null); await load();
    } catch { /* surfaced by disabled state */ } finally { setBusy(false); }
  };
  const remove = async (id: string) => { await authFetch(`/zones/${id}`, { method: 'DELETE' }).catch(() => {}); load(); };

  return (
    <div style={st.liveGrid}>
      <div style={st.card}>
        <h3 style={st.h3}>Carte des zones — cliquez pour placer</h3>
        <div style={{ height: 460, borderRadius: 12, overflow: 'hidden' }}>
          <Map ref={mapRef} mapStyle="https://tiles.openfreemap.org/styles/liberty"
            initialViewState={{ longitude: -4.0083, latitude: 5.345, zoom: 11 }} style={{ width: '100%', height: '100%' }}
            onClick={(e) => setPin({ lat: e.lngLat.lat, lng: e.lngLat.lng })}>
            {zones.map((z) => (
              <Source key={z.id} id={`z-${z.id}`} type="geojson" data={circleGeoJSON(z.centerLat, z.centerLng, z.radiusM) as any}>
                <Layer id={`zf-${z.id}`} type="fill" paint={{ 'fill-color': z.kind === 'ALLOWED' ? '#16a34a' : '#ef4444', 'fill-opacity': 0.12 }} />
                <Layer id={`zl-${z.id}`} type="line" paint={{ 'line-color': z.kind === 'ALLOWED' ? '#16a34a' : '#ef4444', 'line-width': 2 }} />
              </Source>
            ))}
            {pin && (
              <>
                <Source id="new-zone" type="geojson" data={circleGeoJSON(pin.lat, pin.lng, radius) as any}>
                  <Layer id="nz-f" type="fill" paint={{ 'fill-color': kind === 'ALLOWED' ? '#16a34a' : '#ef4444', 'fill-opacity': 0.18 }} />
                  <Layer id="nz-l" type="line" paint={{ 'line-color': '#111827', 'line-width': 2, 'line-dasharray': [2, 2] }} />
                </Source>
                <Marker longitude={pin.lng} latitude={pin.lat}><div style={{ fontSize: 20 }}>📍</div></Marker>
              </>
            )}
          </Map>
        </div>
      </div>
      <div style={st.card}>
        <h3 style={st.h3}>Nouvelle zone</h3>
        <input placeholder="Nom (ex : Abidjan)" value={name} onChange={(e) => setName(e.target.value)} style={{ ...st.input, width: '100%', marginBottom: 8 }} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={() => setKind('ALLOWED')} style={{ ...st.chip, ...(kind === 'ALLOWED' ? st.chipOnGreen : {}) }}>Autorisée</button>
          <button onClick={() => setKind('RESTRICTED')} style={{ ...st.chip, ...(kind === 'RESTRICTED' ? st.chipOnRed : {}) }}>Interdite</button>
        </div>
        <label style={st.dim}>Rayon : {(radius / 1000).toFixed(1)} km</label>
        <input type="range" min={200} max={20000} step={100} value={radius} onChange={(e) => setRadius(Number(e.target.value))} style={{ width: '100%' }} />
        <p style={st.dim}>{pin ? `Centre : ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}` : 'Cliquez sur la carte pour définir le centre.'}</p>
        <button onClick={create} disabled={!name.trim() || !pin || busy} style={{ ...st.primary, ...((!name.trim() || !pin || busy) ? { opacity: 0.5 } : {}) }}>
          {busy ? '…' : 'Créer la zone'}
        </button>

        <h3 style={{ ...st.h3, marginTop: 20 }}>Zones ({zones.length})</h3>
        {zones.map((z) => (
          <div key={z.id} style={st.zoneRow}>
            <span style={{ ...st.dot, background: z.kind === 'ALLOWED' ? '#16a34a' : '#ef4444' }} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{z.name} <span style={{ color: '#9ca3af', fontWeight: 400 }}>({(z.radiusM / 1000).toFixed(1)} km)</span></span>
            <button onClick={() => remove(z.id)} style={st.del}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- shared bits ---------------- */
function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return <div style={{ flex: 1, background: '#f9fafb', borderRadius: 12, padding: 12, textAlign: 'center' }}>
    <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: 1 }}>{label.toUpperCase()}</div>
    <div style={{ fontSize: 28, fontWeight: 900, color }}>{value}</div>
  </div>;
}

const st: Record<string, any> = {
  page: { minHeight: '100vh', background: '#f6f7f9' },
  topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#fff', borderBottom: '1px solid #eee' },
  badge: { background: '#fde68a', color: '#92400e', fontSize: 11, fontWeight: 900, padding: '2px 8px', borderRadius: 999 },
  wsDot: { width: 10, height: 10, borderRadius: 999 },
  logout: { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 10, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  tabs: { display: 'flex', gap: 4, padding: '10px 16px 0' },
  tab: { border: 'none', background: 'transparent', padding: '8px 14px', borderRadius: 10, fontWeight: 800, fontSize: 13, color: '#6b7280', cursor: 'pointer' },
  tabOn: { background: '#111827', color: '#fff' },
  body: { padding: 16 },
  liveGrid: { display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16 },
  card: { background: '#fff', borderRadius: 16, padding: 16, border: '1px solid rgba(0,0,0,0.06)' },
  kpis: { display: 'flex', gap: 10 },
  h3: { margin: 0, fontSize: 15, fontWeight: 900, color: '#111827' },
  dim: { fontSize: 13, color: '#9ca3af' },
  vehRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer' },
  dot: { width: 10, height: 10, borderRadius: 999 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', color: '#6b7280', fontWeight: 800, fontSize: 11, borderBottom: '2px solid #f3f4f6', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' },
  input: { padding: '8px 10px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13 },
  primary: { width: '100%', marginTop: 10, padding: '11px', borderRadius: 12, border: 'none', background: '#111827', color: '#fff', fontWeight: 800, cursor: 'pointer' },
  chip: { flex: 1, padding: '8px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  chipOnGreen: { borderColor: '#16a34a', background: '#f0fdf4', color: '#166534' },
  chipOnRed: { borderColor: '#ef4444', background: '#fef2f2', color: '#991b1b' },
  zoneRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', borderBottom: '1px solid #f3f4f6' },
  del: { border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontWeight: 900 },
  smallBtn: { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: '#374151', cursor: 'pointer', marginLeft: 6 },
  assignSelect: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '4px 8px', fontSize: 12, fontWeight: 700, color: '#111827', background: '#fff', cursor: 'pointer', maxWidth: 160 },
  alert: (kind: string) => ({
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 10,
    fontSize: 12, fontWeight: 800,
    background: kind === 'SPEED' ? '#fef2f2' : kind === 'ZONE' ? '#eff6ff' : '#fffbeb',
    color: kind === 'SPEED' ? '#991b1b' : kind === 'ZONE' ? '#1e3a8a' : '#92400e',
    border: `1px solid ${kind === 'SPEED' ? '#fca5a5' : kind === 'ZONE' ? '#bfdbfe' : '#fcd34d'}`,
  }),
  alertX: { border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 900, color: 'inherit' },
};
