import { Link } from 'react-router-dom';

const styles: Record<string, React.CSSProperties> = {
  hero: {
    background: '#111827',
    borderRadius: 20,
    padding: 32,
    color: '#fff',
    marginBottom: 16,
  },
  brand: { margin: 0, fontSize: 32, fontWeight: 900, color: '#fff', letterSpacing: -0.5 },
  tagline: { marginTop: 10, marginBottom: 0, color: 'rgba(255,255,255,0.65)', fontSize: 16, lineHeight: 1.6 },
  actions: { marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  btnPrimary: {
    display: 'inline-block',
    padding: '12px 20px',
    borderRadius: 12,
    background: '#fbbf24',
    color: '#111827',
    textDecoration: 'none',
    fontWeight: 800,
    fontSize: 14,
  },
  btnGhost: {
    display: 'inline-block',
    padding: '12px 20px',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.1)',
    color: '#fff',
    textDecoration: 'none',
    fontWeight: 800,
    fontSize: 14,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 14,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 4px 16px rgba(0,0,0,0.05)',
    border: '1px solid rgba(0,0,0,0.06)',
  },
  icon: { fontSize: 24, marginBottom: 10 },
  title: { margin: 0, fontSize: 15, fontWeight: 800, color: '#111827', marginBottom: 8 },
  desc: { margin: 0, color: '#6b7280', fontSize: 14, lineHeight: 1.6 },
};

const features = [
  {
    icon: '📍',
    title: 'Suivi GPS en temps réel',
    desc: 'Visualisez chaque bus sur la carte en direct. Position mise à jour toutes les secondes.',
  },
  {
    icon: '🚌',
    title: 'Tablette embarquée',
    desc: 'Chaque bus est équipé d\'une tablette. Le conducteur se connecte et le suivi démarre automatiquement.',
  },
  {
    icon: '⚡',
    title: 'Vitesse instantanée',
    desc: 'La vitesse de chaque véhicule est calculée et affichée en km/h avec filtrage du bruit GPS.',
  },
  {
    icon: '📡',
    title: 'Mode hors-ligne',
    desc: 'Les positions sont mises en file d\'attente en cas de coupure réseau et synchronisées dès la reconnexion.',
  },
  {
    icon: '🔐',
    title: 'Accès sécurisé',
    desc: 'Authentification par téléphone + code PIN. Chaque conducteur a ses propres identifiants.',
  },
  {
    icon: '🗺️',
    title: 'Couverture nationale',
    desc: 'Conçu pour les trajets longue distance à travers toute la Côte d\'Ivoire.',
  },
];

export default function Landing() {
  return (
    <div>
      <div style={styles.hero}>
        <h1 style={styles.brand}>DiomST</h1>
        <p style={styles.tagline}>
          Gestion de flotte en temps réel pour les opérateurs de transport en Côte d'Ivoire.
          Suivez vos bus, vérifiez les vitesses, gardez le contrôle.
        </p>
        <div style={styles.actions}>
          <Link to="/login" style={styles.btnPrimary}>Se connecter</Link>
          <Link to="/admin" style={styles.btnGhost}>Tableau de bord</Link>
        </div>
      </div>

      <div style={styles.grid}>
        {features.map((f) => (
          <div key={f.title} style={styles.card}>
            <div style={styles.icon}>{f.icon}</div>
            <p style={styles.title}>{f.title}</p>
            <p style={styles.desc}>{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
