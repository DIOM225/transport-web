import React, { useEffect, useState } from 'react';
import { getToken, getUser } from '../lib/auth';

// ─── Types ────────────────────────────────────────────────────────────────────

type OrgPlan = 'FREE' | 'STARTER' | 'GROWTH' | 'PRO';

type Organization = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  plan: OrgPlan;
  isActive: boolean;
  createdAt: string;
};

type OrgStats = {
  busCount: number;
  userCount: number;
};

type OrgWithStats = Organization & OrgStats;

type PlatformStats = {
  orgCount: number;
  busCount: number;
  userCount: number;
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

// ─── API helper (same pattern as AdminDashboard) ──────────────────────────────

const API_BASE =
  import.meta.env.VITE_API_BASE || 'https://transport-api-production-d0c6.up.railway.app';

async function api<T>(
  path: string,
  opts: { method?: string; token: string; body?: any },
): Promise<T> {
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

// ─── Slug generator ───────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Plan badge ───────────────────────────────────────────────────────────────

function planBadge(plan: OrgPlan): React.CSSProperties {
  const map: Record<OrgPlan, { bg: string; fg: string }> = {
    FREE:    { bg: '#f3f4f6', fg: '#6b7280' },
    STARTER: { bg: '#dbeafe', fg: '#1d4ed8' },
    GROWTH:  { bg: '#dcfce7', fg: '#16a34a' },
    PRO:     { bg: '#ede9fe', fg: '#7c3aed' },
  };
  const { bg, fg } = map[plan] ?? map.FREE;
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 800,
    background: bg,
    color: fg,
  };
}

function statusBadge(isActive: boolean): React.CSSProperties {
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

  header: {
    marginBottom: 24,
  } as React.CSSProperties,

  h1: {
    margin: 0,
    fontSize: 20,
    fontWeight: 950,
    color: '#111827',
    letterSpacing: -0.3,
  } as React.CSSProperties,

  sub: {
    margin: '4px 0 0',
    fontSize: 12,
    color: '#6b7280',
  } as React.CSSProperties,

  section: {
    marginBottom: 24,
  } as React.CSSProperties,

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
    gridTemplateColumns: 'repeat(3, 1fr)',
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

  label: {
    fontSize: 11,
    fontWeight: 800,
    color: '#374151',
  } as React.CSSProperties,

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
    padding: '6px 12px',
    fontWeight: 700,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,

  btnDanger: {
    background: '#ef4444',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '6px 12px',
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

  smallText: {
    fontSize: 12,
    color: '#6b7280',
  } as React.CSSProperties,

  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 10,
    padding: '8px 12px',
    fontSize: 12,
    color: '#dc2626',
    marginTop: 8,
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
};

// ─── Component ────────────────────────────────────────────────────────────────

const EMPTY_FORM: CreateTenantForm = {
  name: '',
  slug: '',
  email: '',
  adminFirstName: '',
  adminLastName: '',
  adminPhone: '',
  adminPin: '',
};

export default function SuperAdminDashboard() {
  // ── State (all hooks before conditional return) ──────────────────────────
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<OrgWithStats[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgsError, setOrgsError] = useState<string | null>(null);

  const [form, setForm] = useState<CreateTenantForm>(EMPTY_FORM);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [toggleBusy, setToggleBusy] = useState<string | null>(null);

  // ── Auth ─────────────────────────────────────────────────────────────────
  const token = getToken();
  const rawUser = getUser() as { id: string; phone: string; role: string } | null;
  const role = rawUser?.role;

  // ── Data fetchers ─────────────────────────────────────────────────────────

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

      // Enrich each org with its stats in parallel
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

  // ── Auth guard (after hooks) ──────────────────────────────────────────────
  if (!token || role !== 'SUPERADMIN') {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#374151', fontSize: 15, fontWeight: 700 }}>
        Accès refusé.
      </div>
    );
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleFormChange(field: keyof CreateTenantForm, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'name') {
        next.slug = toSlug(value);
      }
      return next;
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!form.name.trim()) { setFormError('Le nom de la société est requis.'); return; }
    if (!form.slug.trim()) { setFormError('Le slug est requis.'); return; }
    if (!form.adminFirstName.trim()) { setFormError('Le prénom de l\'admin est requis.'); return; }
    if (!form.adminLastName.trim()) { setFormError('Le nom de l\'admin est requis.'); return; }
    if (!form.adminPhone.trim()) { setFormError('Le téléphone de l\'admin est requis.'); return; }
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
      // Refresh list and stats
      await Promise.all([loadStats(token!), loadOrgs(token!)]);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setFormBusy(false);
    }
  }

  async function handleToggleActive(org: OrgWithStats) {
    setToggleBusy(org.id);
    try {
      await api<Organization>(`/organizations/${org.id}`, {
        token: token!,
        method: 'PATCH',
        body: { isActive: !org.isActive },
      });
      setOrgs((prev) =>
        prev.map((o) => (o.id === org.id ? { ...o, isActive: !o.isActive } : o)),
      );
    } catch (e) {
      setOrgsError((e as Error).message);
    } finally {
      setToggleBusy(null);
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

      {/* Stats bar */}
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
      </div>

      {/* Create tenant form */}
      <div style={S.section}>
        <h2 style={S.sectionTitle}>Créer un nouveau tenant</h2>
        <div style={S.card}>
          <form onSubmit={handleCreate} noValidate>
            <div style={S.formGrid}>
              {/* Nom */}
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

              {/* Slug */}
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

              {/* Email */}
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

              {/* Prénom admin */}
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

              {/* Nom admin */}
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

              {/* Téléphone admin */}
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

              {/* PIN admin */}
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

      {/* Organizations list */}
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
                    <th style={S.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((org) => (
                    <tr key={org.id}>
                      <td style={S.td}>
                        <span style={{ fontWeight: 800, color: '#111827' }}>{org.name}</span>
                      </td>
                      <td style={S.td}>
                        <span
                          style={{
                            fontFamily:
                              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            fontSize: 12,
                            color: '#374151',
                          }}
                        >
                          {org.slug}
                        </span>
                      </td>
                      <td style={S.td}>
                        <span style={planBadge(org.plan)}>{org.plan}</span>
                      </td>
                      <td style={S.td}>
                        <span style={statusBadge(org.isActive)}>
                          {org.isActive ? 'Actif' : 'Suspendu'}
                        </span>
                      </td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 800 }}>
                        {org.busCount}
                      </td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 800 }}>
                        {org.userCount}
                      </td>
                      <td style={{ ...S.td, ...S.smallText }}>
                        {new Date(org.createdAt).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                        <button
                          style={org.isActive ? S.btnDanger : S.btnGhost}
                          disabled={toggleBusy === org.id}
                          onClick={() => handleToggleActive(org)}
                        >
                          {toggleBusy === org.id
                            ? '…'
                            : org.isActive
                            ? 'Suspendre'
                            : 'Activer'}
                        </button>
                      </td>
                    </tr>
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
