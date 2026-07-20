import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, setSession, type Role } from '../lib/auth';

const styles: Record<string, React.CSSProperties> = {
  card: {
    maxWidth: 420,
    margin: '0 auto',
    background: '#fff',
    borderRadius: 16,
    padding: 18,
    boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
  },
  h: { margin: 0, fontSize: 22, fontWeight: 900, color: '#111827' },
  p: { marginTop: 8, marginBottom: 14, color: '#6b7280', fontSize: 14 },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 700,
    color: '#374151',
    marginTop: 10,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 12,
    border: '1px solid #e5e7eb',
    outline: 'none',
    marginTop: 6,
    fontSize: 14,
  },
  btn: {
    width: '100%',
    marginTop: 14,
    padding: '11px 12px',
    borderRadius: 12,
    border: 'none',
    background: '#111827',
    color: '#fff',
    fontWeight: 800,
    cursor: 'pointer',
  },
  btnDisabled: {
    opacity: 0.7,
    cursor: 'not-allowed',
  },
  errorBox: {
    marginTop: 12,
    padding: '10px 12px',
    borderRadius: 12,
    background: '#fee2e2',
    color: '#991b1b',
    fontSize: 13,
    fontWeight: 700,
  },
  note: { marginTop: 10, fontSize: 12, color: '#6b7280' },
  code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
};

function redirectPathForRole(role: Role) {
  if (role === 'DRIVER') return '/driver';
  if (role === 'SUPERADMIN') return '/superadmin';
  return '/admin';
}

function normalizeErrorMessage(err: unknown) {
  if (err instanceof Error) {
    // If backend returns JSON text, it might be long; keep it readable.
    return err.message || 'Erreur inconnue';
  }
  return 'Erreur inconnue';
}

export default function Login() {
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanPhone = phone.trim();
    const cleanPin = pin.trim();

    if (!cleanPhone || !cleanPin) {
      setError('Veuillez entrer votre téléphone et votre PIN.');
      return;
    }

    try {
      setLoading(true);

      const res = await login(cleanPhone, cleanPin);
      setSession(res.accessToken, res.user);

      navigate(redirectPathForRole(res.user.role), { replace: true });
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.card}>
      <h2 style={styles.h}>Connexion</h2>
      <p style={styles.p}>Conducteur / Admin. Auth par téléphone + PIN (JWT).</p>

      <form onSubmit={onSubmit}>
        <label style={styles.label}>Téléphone</label>
        <input
          style={styles.input}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          inputMode="tel"
          placeholder="Ex: 0759917862"
          disabled={loading}
        />

        <label style={styles.label}>PIN</label>
        <input
          style={styles.input}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoComplete="one-time-code"
          inputMode="numeric"
          placeholder="Ex: 2876"
          disabled={loading}
        />

        <button
          style={{ ...styles.btn, ...(loading ? styles.btnDisabled : {}) }}
          type="submit"
          disabled={loading}
        >
          {loading ? 'Connexion...' : 'Se connecter'}
        </button>

        {error && <div style={styles.errorBox}>{error}</div>}
      </form>

      <div style={styles.note}>
        Backend attendu: <span style={styles.code}>POST /auth/login</span> → token + user.
      </div>
    </div>
  );
}
