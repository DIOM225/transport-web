import { Link, Outlet, useLocation } from 'react-router-dom';
import type React from 'react';

const shellStyles = {
  shell: { minHeight: '100vh', background: '#f5f6f8' },
  topbar: {
    height: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    background: '#111827',
    color: '#fff',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  brand: { display: 'flex', gap: 10, alignItems: 'center', fontWeight: 800 as const },
  nav: { display: 'flex', gap: 10, alignItems: 'center' },
  main: { maxWidth: '100%', padding: 0 },
} satisfies Record<string, React.CSSProperties>;

const linkStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 10px',
  borderRadius: 10,
  textDecoration: 'none',
  color: active ? '#111827' : '#e5e7eb',
  background: active ? '#fbbf24' : 'transparent',
  fontWeight: 700,
  fontSize: 14,
});

export default function AppShell() {
  const { pathname } = useLocation();

  return (
    <div style={shellStyles.shell}>
      <header style={shellStyles.topbar}>
        <div style={shellStyles.brand}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: '#fbbf24',
            }}
          />
          DiomST
        </div>

        <nav style={shellStyles.nav}>
          <Link to="/" style={linkStyle(pathname === '/')}>
            Accueil
          </Link>
          <Link to="/login" style={linkStyle(pathname.startsWith('/login'))}>
            Connexion
          </Link>
          <Link to="/admin" style={linkStyle(pathname.startsWith('/admin'))}>
            Flotte
          </Link>
        </nav>
      </header>

      <main style={shellStyles.main}>
        <Outlet />
      </main>
    </div>
  );
}
