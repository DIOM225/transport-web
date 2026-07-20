import React, { useEffect, useRef, useState } from 'react';
import { getToken, getUser } from '../lib/auth';

// ─── Types ────────────────────────────────────────────────────────────────────

type OrgPlan = 'FREE' | 'STARTER' | 'GROWTH' | 'PRO';
const PLANS: OrgPlan[] = ['FREE', 'STARTER', 'GROWTH', 'PRO'];

type Organization = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  plan: OrgPlan;
  isActive: boolean;
  createdAt: string;
  alertPhone?: string | null;
  alertsEnabled?: boolean;
};

type OrgStats = { busCount: number; userCount: number };
type OrgWithStats = Organization & OrgStats;

type PlatformStats = {
  orgCount: number;
  busCount: number;
  userCount: number;
  tripsToday?: number;
};

type CreateTenantForm = {
  name: string;
  slug: string;
  email: string;
  adminFirstName: string;
  adminLastName: string;
  adminPhone: string;
  adminPin: string;
};

type Bus = { id: string; number?: string; plate?: string; isActive: boolean };
type OrgUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  role?: string;
};
type Route = { id: string; name?: string };

type OrgDetail = {
  org: Organization;
  buses: Bus[];
  users: OrgUser[];
  routes: Route[];
  activeTrips: number;
  tripsLast7Days: number;
};

// ─── API helper ───────────────────────────────────────────────────────────────

const API_BASE =
  import.meta.env.VITE_API_BASE || 'https://transport-api-production-d0c6.up.railway.app';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api<T>(path: string, opts: { method?: string; token: string; body?: any }): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return data as T;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const PLAN_COLORS: Record<OrgPlan, { bg: string; fg: string }> = {
  FREE:    { bg: '#f3f4f6', fg: '#6b7280' },
  STARTER: { bg: '#dbeafe', fg: '#1d4ed8' },
  GROWTH:  { bg: '#dcfce7', fg: '#16a34a' },
  PRO:     { bg: '#ede9fe', fg: '#7c3aed' },
};

function planSelectStyle(plan: OrgPlan): React.CSSProperties {
  const { bg, fg } = PLAN_COLORS[plan] ?? PLAN_COLORS.FREE;
  return {
    background: bg,
    color: fg,
    border: '1.5px solid transparent',
    borderRadius: 8,
    padding: '3px 6px',
    fontSize: 11,
    fontWeight: 800,
    cursor: 'pointer',
    fontFamily: 'inherit',
    outline: 'none',
  };
}

function statusBadgeStyle(isActive: boolean): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 800,
    background: isActive ? '#dcfce7' : '#fee2e2',
    color: isActive ? '#16a34a' : '#dc2626',
  };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page: {
    padding: '24px 24px 40px',
    background: '#f9fafb',
    minHeight: '100vh',
    fontFamily: 'system-ui, sans-serif',
  } as React.CSSProperties,

  header: { marginBottom: 24 } as React.CSSProperties,

  h1: {
    margin: 0,
    fontSize: 20,
    fontWeight: 950,
    color: '#111827',
    letterSpacing: -0.3,
  } as React.CSSProperties,

  sub: { margin: '4px 0 0', fontSize: 12, color: '#6b7280' } as React.CSSProperties,

  section: { marginBottom: 24 } as React.CSSProperties,

  sectionTitle: {
    margin: '0 0 12px',
    fontSize: 11,
    fontWeight: 950,
    color: '#111827',
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,

  card: {
    background: '#fff',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  } as React.CSSProperties,

  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
    marginBottom: 24,
  } as React.CSSProperties,

  statCard: {
    background: '#fff',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  } as React.CSSProperties,

  statLabel: {
    fontSize: 11,
    fontWeight: 900,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as React.CSSProperties,

  statValue: {
    fontSize: 28,
    fontWeight: 950,
    color: '#111827',
    letterSpacing: -0.5,
  } as React.CSSProperties,

  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  } as React.CSSProperties,

  formGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  } as React.CSSProperties,

  label: { fontSize: 11, fontWeight: 800, color: '#374151' } as React.CSSProperties,

  input: {
    border: '1.5px solid #e5e7eb',
    borderRadius: 10,
    padding: '8px 12px',
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box' as const,
    outline: 'none',
    fontFamily: 'inherit',
  } as React.CSSProperties,

  btnPrimary: {
    background: '#111827',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '8px 16px',
    fontWeight: 800,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,

  btnGhost: {
    background: 'transparent',
    border: '1.5px solid #e5e7eb',
    borderRadius: 10,
    padding: '5px 9px',
    fontWeight: 700,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: '#374151',
  } as React.CSSProperties,

  btnDanger: {
    background: '#ef4444',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '5px 9px',
    fontWeight: 700,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,

  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 13,
  } as React.CSSProperties,

  th: {
    textAlign: 'left' as const,
    fontSize: 11,
    fontWeight: 900,
    color: '#6b7280',
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
    padding: '0 8px 10px',
    borderBottom: '1px solid #e5e7eb',
  } as React.CSSProperties,

  td: {
    padding: '10px 8px',
    borderBottom: '1px solid #f3f4f6',
    verticalAlign: 'middle' as const,
  } as React.CSSProperties,

  smallText: { fontSize: 12, color: '#6b7280' } as React.CSSProperties,

  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 10,
    padding: '8px 12px',
    fontSize: 12,
    color: '#dc2626',
    marginTop: 8,
  } as React.CSSProperties,

  inlineError: {
    fontSize: 11,
    color: '#dc2626',
    marginTop: 4,
  } as React.CSSProperties,

  successBox: {
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 10,
    padding: '8px 12px',
    fontSize: 12,
    color: '#16a34a',
    marginTop: 8,
  } as React.CSSProperties,

  expandPanel: {
    padding: '14px 16px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
  } as React.CSSProperties,
};

// ─── OrgRow ───────────────────────────────────────────────────────────────────

interface OrgRowProps {
  org: OrgWithStats;
  token: string;
  colCount: number;
  onUpdate: (id: string, patch: Partial<OrgWithStats>) => void;
  onDelete: (id: string) => void;
  isDetailOpen: boolean;
  onToggleDetail: () => void;
}

function OrgRow({ org, token, colCount, onUpdate, onDelete, isDetailOpen, onToggleDetail }: OrgRowProps) {
  // Plan
  const [plan, setPlan] = useState<OrgPlan>(org.plan);
  const [planBusy, setPlanBusy] = useState(false);
  const [planConfirm, setPlanConfirm] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const planTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Toggle active
  const [toggleBusy, setToggleBusy] = useState(false);

  // Alerts SMS
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertPhone, setAlertPhone] = useState(org.alertPhone ?? '');
  const [alertsEnabled, setAlertsEnabled] = useState(org.alertsEnabled ?? false);
  const [alertsBusy, setAlertsBusy] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsSuccess, setAlertsSuccess] = useState(false);

  // Edit
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(org.name);
  const [editEmail, setEditEmail] = useState(org.email ?? '');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Detail
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<OrgDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailFetched = useRef(false);

  // Delete
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handlePlanChange(newPlan: OrgPlan) {
    if (newPlan === plan || planBusy) return;
    const prev = plan;
    setPlan(newPlan);
    setPlanBusy(true);
    setPlanError(null);
    try {
      await api<Organization>(`/organizations/${org.id}`, {
        token,
        method: 'PATCH',
        body: { plan: newPlan },
      });
      onUpdate(org.id, { plan: newPlan });
      setPlanConfirm(true);
      if (planTimerRef.current) clearTimeout(planTimerRef.current);
      planTimerRef.current = setTimeout(() => setPlanConfirm(false), 2000);
    } catch (e) {
      setPlanError((e as Error).message);
      setPlan(prev);
    } finally {
      setPlanBusy(false);
    }
  }

  async function handleToggleActive() {
    setToggleBusy(true);
    try {
      await api<Organization>(`/organizations/${org.id}`, {
        token,
        method: 'PATCH',
        body: { isActive: !org.isActive },
      });
      onUpdate(org.id, { isActive: !org.isActive });
    } catch {
      // silent — toggle is non-critical
    } finally {
      setToggleBusy(false);
    }
  }

  async function handleAlertsSave() {
    setAlertsBusy(true);
    setAlertsError(null);
    setAlertsSuccess(false);
    try {
      await api<Organization>(`/organizations/${org.id}`, {
        token,
        method: 'PATCH',
        body: { alertPhone: alertPhone.trim() || null, alertsEnabled },
      });
      onUpdate(org.id, { alertPhone: alertPhone.trim() || null, alertsEnabled });
      setAlertsSuccess(true);
      setTimeout(() => setAlertsSuccess(false), 2500);
    } catch (e) {
      setAlertsError((e as Error).message);
    } finally {
      setAlertsBusy(false);
    }
  }

  async function handleEditSave() {
    if (!editName.trim()) { setEditError('Le nom est requis.'); return; }
    setEditBusy(true);
    setEditError(null);
    try {
      await api<Organization>(`/organizations/${org.id}`, {
        token,
        method: 'PATCH',
        body: { name: editName.trim(), email: editEmail.trim() || null },
      });
      onUpdate(org.id, { name: editName.trim(), email: editEmail.trim() || null });
      setEditOpen(false);
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditBusy(false);
    }
  }

  function handleEditCancel() {
    setEditOpen(false);
    setEditName(org.name);
    setEditEmail(org.email ?? '');
    setEditError(null);
  }

  async function handleDetailToggle() {
    if (isDetailOpen) {
      onToggleDetail();
      return;
    }
    onToggleDetail();
    if (detailFetched.current) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await api<OrgDetail>(`/organizations/${org.id}/detail`, { token });
      setDetailData(data);
      detailFetched.current = true;
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Supprimer l'organisation "${org.name}" ?\n\nCette action est irréversible.`)) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api<Organization>(`/organizations/${org.id}`, { token, method: 'DELETE' });
      onDelete(org.id);
    } catch (e) {
      setDeleteError((e as Error).message);
      setDeleteBusy(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Main row ── */}
      <tr>
        <td style={S.td}>
          <span style={{ fontWeight: 800, color: '#111827' }}>{org.name}</span>
        </td>

        <td style={S.td}>
          <span
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 12,
              color: '#374151',
            }}
          >
            {org.slug}
          </span>
        </td>

        {/* Plan — inline select */}
        <td style={S.td}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <select
              style={planSelectStyle(plan)}
              value={plan}
              disabled={planBusy}
              onChange={(e) => handlePlanChange(e.target.value as OrgPlan)}
            >
              {PLANS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {planBusy && <span style={{ fontSize: 11, color: '#6b7280' }}>…</span>}
            {planConfirm && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 800 }}>✓</span>}
            {planError && (
              <span style={{ fontSize: 11, color: '#dc2626' }} title={planError}>!</span>
            )}
          </div>
        </td>

        <td style={S.td}>
          <span style={statusBadgeStyle(org.isActive)}>
            {org.isActive ? 'Actif' : 'Suspendu'}
          </span>
        </td>

        <td style={{ ...S.td, textAlign: 'right', fontWeight: 800 }}>{org.busCount}</td>
        <td style={{ ...S.td, textAlign: 'right', fontWeight: 800 }}>{org.userCount}</td>

        <td style={{ ...S.td, ...S.smallText }}>
          {new Date(org.createdAt).toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })}
        </td>

        {/* Actions */}
        <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              style={org.isActive ? S.btnDanger : S.btnGhost}
              disabled={toggleBusy}
              onClick={handleToggleActive}
            >
              {toggleBusy ? '…' : org.isActive ? 'Suspendre' : 'Activer'}
            </button>
            <button
              style={S.btnGhost}
              onClick={() => {
                setEditOpen((o) => !o);
                setEditError(null);
              }}
            >
              {editOpen ? 'Annuler ▴' : 'Modifier'}
            </button>
            <button style={S.btnGhost} onClick={() => setAlertsOpen((o) => !o)}>
              {alertsOpen ? 'SMS ▴' : 'SMS ▾'}
            </button>
            <button style={S.btnGhost} onClick={handleDetailToggle}>
              {isDetailOpen ? 'Détails ▴' : 'Détails ▾'}
            </button>
            <button style={S.btnDanger} disabled={deleteBusy} onClick={handleDelete}>
              {deleteBusy ? '…' : 'Supprimer'}
            </button>
          </div>
          {deleteError && <div style={S.inlineError}>{deleteError}</div>}
        </td>
      </tr>

      {/* ── Edit form row ── */}
      {editOpen && (
        <tr>
          <td colSpan={colCount} style={{ padding: 0 }}>
            <div style={{ ...S.expandPanel, borderLeft: '3px solid #f59e0b' }}>
              <p style={{ ...S.label, marginBottom: 10, color: '#92400e' }}>Modifier l'organisation</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 520 }}>
                <div style={S.formGroup}>
                  <label style={S.label}>Nom *</label>
                  <input
                    style={S.input}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div style={S.formGroup}>
                  <label style={S.label}>Email</label>
                  <input
                    style={S.input}
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                <button style={S.btnPrimary} disabled={editBusy} onClick={handleEditSave}>
                  {editBusy ? 'Enregistrement…' : 'Enregistrer'}
                </button>
                <button style={S.btnGhost} onClick={handleEditCancel}>
                  Annuler
                </button>
              </div>
              {editError && <div style={S.inlineError}>{editError}</div>}
            </div>
          </td>
        </tr>
      )}

      {/* ── Alertes SMS row ── */}
      {alertsOpen && (
        <tr>
          <td colSpan={colCount} style={{ padding: 0 }}>
            <div style={{ ...S.expandPanel, borderLeft: '3px solid #10b981' }}>
              <p style={{ ...S.label, marginBottom: 10, color: '#065f46' }}>Alertes SMS</p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
                <div style={S.formGroup}>
                  <label style={S.label}>Téléphone d'alerte (E.164)</label>
                  <input
                    style={{ ...S.input, width: 220 }}
                    type="tel"
                    placeholder="+2250701234567"
                    value={alertPhone}
                    onChange={(e) => setAlertPhone(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 10 }}>
                  <input
                    id={`alerts-enabled-${org.id}`}
                    type="checkbox"
                    checked={alertsEnabled}
                    onChange={(e) => setAlertsEnabled(e.target.checked)}
                  />
                  <label htmlFor={`alerts-enabled-${org.id}`} style={S.label}>
                    Alertes activées
                  </label>
                </div>
                <div style={{ paddingBottom: 10 }}>
                  <button style={S.btnPrimary} disabled={alertsBusy} onClick={handleAlertsSave}>
                    {alertsBusy ? '…' : 'Enregistrer'}
                  </button>
                </div>
                {alertsSuccess && (
                  <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 800, paddingBottom: 10 }}>
                    ✓ Enregistré
                  </span>
                )}
              </div>
              {alertsError && <div style={S.inlineError}>{alertsError}</div>}
            </div>
          </td>
        </tr>
      )}

      {/* ── Detail panel row ── */}
      {isDetailOpen && (
        <tr>
          <td colSpan={colCount} style={{ padding: 0 }}>
            <div style={{ ...S.expandPanel, borderLeft: '3px solid #6366f1' }}>
              <p style={{ ...S.label, marginBottom: 12, color: '#4338ca' }}>
                Détails — {org.name}
              </p>

              {detailLoading && <p style={S.smallText}>Chargement…</p>}
              {detailError && <div style={S.inlineError}>{detailError}</div>}

              {detailData && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {/* Buses */}
                  <div>
                    <p style={{ ...S.label, marginBottom: 8 }}>
                      Bus ({detailData.buses.length})
                    </p>
                    {detailData.buses.length === 0 ? (
                      <p style={S.smallText}>Aucun bus</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {detailData.buses.map((b) => (
                          <div key={b.id} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontWeight: 700, minWidth: 40 }}>{b.number ?? '—'}</span>
                            <span style={{ color: '#6b7280' }}>{b.plate ?? '—'}</span>
                            <span style={statusBadgeStyle(b.isActive)}>
                              {b.isActive ? 'Actif' : 'Inactif'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Users */}
                  <div>
                    <p style={{ ...S.label, marginBottom: 8 }}>
                      Utilisateurs ({detailData.users.length})
                    </p>
                    {detailData.users.length === 0 ? (
                      <p style={S.smallText}>Aucun utilisateur</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {detailData.users.map((u) => (
                          <div key={u.id} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontWeight: 700 }}>
                              {u.firstName} {u.lastName}
                            </span>
                            <span style={{ color: '#6b7280' }}>{u.phone ?? '—'}</span>
                            <span style={{ color: '#6366f1', fontWeight: 600, fontSize: 11 }}>
                              {u.role}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Stats + Routes */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <p style={{ ...S.label, marginBottom: 8 }}>Statistiques</p>
                    <div style={{ display: 'flex', gap: 24 }}>
                      <div>
                        <p style={{ ...S.statLabel, fontSize: 10 }}>Trajets actifs</p>
                        <p style={{ fontSize: 22, fontWeight: 800, color: '#111827', margin: 0 }}>
                          {detailData.activeTrips}
                        </p>
                      </div>
                      <div>
                        <p style={{ ...S.statLabel, fontSize: 10 }}>7 derniers jours</p>
                        <p style={{ fontSize: 22, fontWeight: 800, color: '#111827', margin: 0 }}>
                          {detailData.tripsLast7Days}
                        </p>
                      </div>
                      <div>
                        <p style={{ ...S.statLabel, fontSize: 10 }}>Routes</p>
                        <p style={{ fontSize: 22, fontWeight: 800, color: '#111827', margin: 0 }}>
                          {detailData.routes.length}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const EMPTY_FORM: CreateTenantForm = {
  name: '',
  slug: '',
  email: '',
  adminFirstName: '',
  adminLastName: '',
  adminPhone: '',
  adminPin: '',
};

const COL_COUNT = 8;

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<OrgWithStats[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgsError, setOrgsError] = useState<string | null>(null);

  const [form, setForm] = useState<CreateTenantForm>(EMPTY_FORM);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Only one detail panel open at a time
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);

  const token = getToken();
  const rawUser = getUser() as { id: string; phone: string; role: string } | null;
  const role = rawUser?.role;

  // ── Data fetchers ──────────────────────────────────────────────────────────

  async function loadStats(tk: string) {
    try {
      const data = await api<PlatformStats>('/organizations/platform-stats', { token: tk });
      setStats(data);
    } catch (e) {
      setStatsError((e as Error).message);
    }
  }

  async function loadOrgs(tk: string) {
    setOrgsLoading(true);
    setOrgsError(null);
    try {
      const list = await api<Organization[]>('/organizations', { token: tk });
      const enriched = await Promise.all(
        list.map(async (org) => {
          try {
            const s = await api<OrgStats>(`/organizations/${org.id}/stats`, { token: tk });
            return { ...org, busCount: s.busCount, userCount: s.userCount };
          } catch {
            return { ...org, busCount: 0, userCount: 0 };
          }
        }),
      );
      setOrgs(enriched);
    } catch (e) {
      setOrgsError((e as Error).message);
    } finally {
      setOrgsLoading(false);
    }
  }

  useEffect(() => {
    if (!token || role !== 'SUPERADMIN') return;
    loadStats(token);
    loadOrgs(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auth guard (after all hooks) ──────────────────────────────────────────
  if (!token || role !== 'SUPERADMIN') {
    return (
      <div
        style={{ padding: 40, textAlign: 'center', color: '#374151', fontSize: 15, fontWeight: 700 }}
      >
        Accès refusé.
      </div>
    );
  }

  // ── Org list handlers ─────────────────────────────────────────────────────

  function handleOrgUpdate(id: string, patch: Partial<OrgWithStats>) {
    setOrgs((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  function handleOrgDelete(id: string) {
    setOrgs((prev) => prev.filter((o) => o.id !== id));
    setOpenDetailId((prev) => (prev === id ? null : prev));
  }

  function handleToggleDetail(id: string) {
    setOpenDetailId((prev) => (prev === id ? null : id));
  }

  // ── Form handlers ─────────────────────────────────────────────────────────

  function handleFormChange(field: keyof CreateTenantForm, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'name') next.slug = toSlug(value);
      return next;
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    if (!form.name.trim()) { setFormError('Le nom de la société est requis.'); return; }
    if (!form.slug.trim()) { setFormError('Le slug est requis.'); return; }
    if (!form.adminFirstName.trim()) { setFormError("Le prénom de l'admin est requis."); return; }
    if (!form.adminLastName.trim()) { setFormError("Le nom de l'admin est requis."); return; }
    if (!form.adminPhone.trim()) { setFormError("Le téléphone de l'admin est requis."); return; }
    if (form.adminPin.length < 4 || form.adminPin.length > 8) {
      setFormError('Le PIN doit contenir entre 4 et 8 chiffres.');
      return;
    }
    setFormBusy(true);
    try {
      await api<Organization>('/organizations', {
        token: token!,
        method: 'POST',
        body: {
          name: form.name.trim(),
          slug: form.slug.trim(),
          email: form.email.trim() || undefined,
          adminFirstName: form.adminFirstName.trim(),
          adminLastName: form.adminLastName.trim(),
          adminPhone: form.adminPhone.trim(),
          adminPin: form.adminPin,
        },
      });
      setFormSuccess(`Tenant « ${form.name} » créé avec succès.`);
      setForm(EMPTY_FORM);
      await Promise.all([loadStats(token!), loadOrgs(token!)]);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setFormBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <h1 style={S.h1}>DiomST — Plateforme Super Admin</h1>
        <p style={S.sub}>Gestion globale des tenants et de la flotte</p>
      </div>

      {/* Stats bar — 4 tiles */}
      <div style={S.statsRow}>
        <div style={S.statCard}>
          <span style={S.statLabel}>Organisations</span>
          <span style={S.statValue}>
            {statsError ? '—' : stats == null ? '…' : stats.orgCount}
          </span>
          {statsError && <span style={S.smallText}>{statsError}</span>}
        </div>
        <div style={S.statCard}>
          <span style={S.statLabel}>Total Bus</span>
          <span style={S.statValue}>
            {statsError ? '—' : stats == null ? '…' : stats.busCount}
          </span>
        </div>
        <div style={S.statCard}>
          <span style={S.statLabel}>Total Utilisateurs</span>
          <span style={S.statValue}>
            {statsError ? '—' : stats == null ? '…' : stats.userCount}
          </span>
        </div>
        <div style={S.statCard}>
          <span style={S.statLabel}>Trajets Aujourd'hui</span>
          <span style={S.statValue}>
            {statsError
              ? '—'
              : stats == null
              ? '…'
              : stats.tripsToday != null
              ? stats.tripsToday
              : '—'}
          </span>
        </div>
      </div>

      {/* Create tenant form */}
      <div style={S.section}>
        <h2 style={S.sectionTitle}>Créer un nouveau tenant</h2>
        <div style={S.card}>
          <form onSubmit={handleCreate} noValidate>
            <div style={S.formGrid}>
              <div style={S.formGroup}>
                <label style={S.label}>Nom de la société *</label>
                <input
                  style={S.input}
                  type="text"
                  placeholder="Ex: Société Exemple"
                  value={form.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                />
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Slug *</label>
                <input
                  style={S.input}
                  type="text"
                  placeholder="ex: societe-exemple"
                  value={form.slug}
                  onChange={(e) => handleFormChange('slug', e.target.value)}
                />
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Email (optionnel)</label>
                <input
                  style={S.input}
                  type="email"
                  placeholder="contact@societe.com"
                  value={form.email}
                  onChange={(e) => handleFormChange('email', e.target.value)}
                />
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Prénom admin *</label>
                <input
                  style={S.input}
                  type="text"
                  placeholder="Mohamed"
                  value={form.adminFirstName}
                  onChange={(e) => handleFormChange('adminFirstName', e.target.value)}
                />
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Nom admin *</label>
                <input
                  style={S.input}
                  type="text"
                  placeholder="Diomandé"
                  value={form.adminLastName}
                  onChange={(e) => handleFormChange('adminLastName', e.target.value)}
                />
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Téléphone admin *</label>
                <input
                  style={S.input}
                  type="tel"
                  placeholder="+225 01 23 45 67 89"
                  value={form.adminPhone}
                  onChange={(e) => handleFormChange('adminPhone', e.target.value)}
                />
              </div>
              <div style={{ ...S.formGroup, gridColumn: '1 / -1' }}>
                <label style={S.label}>PIN admin (4–8 chiffres) *</label>
                <input
                  style={{ ...S.input, maxWidth: 200 }}
                  type="password"
                  inputMode="numeric"
                  placeholder="••••"
                  maxLength={8}
                  value={form.adminPin}
                  onChange={(e) =>
                    handleFormChange('adminPin', e.target.value.replace(/\D/g, ''))
                  }
                />
              </div>
            </div>

            {formError && <div style={S.errorBox}>{formError}</div>}
            {formSuccess && <div style={S.successBox}>{formSuccess}</div>}

            <div style={{ marginTop: 16 }}>
              <button type="submit" style={S.btnPrimary} disabled={formBusy}>
                {formBusy ? 'Création…' : 'Créer le tenant'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Organisations list */}
      <div style={S.section}>
        <h2 style={S.sectionTitle}>Organisations</h2>
        <div style={S.card}>
          {orgsLoading && (
            <p style={{ ...S.smallText, textAlign: 'center', padding: '20px 0' }}>
              Chargement…
            </p>
          )}
          {orgsError && <div style={S.errorBox}>{orgsError}</div>}
          {!orgsLoading && !orgsError && orgs.length === 0 && (
            <p style={{ ...S.smallText, textAlign: 'center', padding: '20px 0' }}>
              Aucune organisation pour l'instant.
            </p>
          )}
          {!orgsLoading && orgs.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Société</th>
                    <th style={S.th}>Slug</th>
                    <th style={S.th}>Plan</th>
                    <th style={S.th}>Statut</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Bus</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Utilisateurs</th>
                    <th style={S.th}>Créé le</th>
                    <th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((org) => (
                    <OrgRow
                      key={org.id}
                      org={org}
                      token={token!}
                      colCount={COL_COUNT}
                      onUpdate={handleOrgUpdate}
                      onDelete={handleOrgDelete}
                      isDetailOpen={openDetailId === org.id}
                      onToggleDetail={() => handleToggleDetail(org.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
