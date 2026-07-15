import { getToken } from './auth';

const API_BASE =
  import.meta.env.VITE_API_BASE || 'https://transport-api-production-d0c6.up.railway.app';

type SendPositionPayload = {
  lat: number;
  lng: number;
  accuracyM: number;
  speedMs: number | null;
  headingDeg: number | null;
  timestamp: number;
};

export async function sendPosition(payload: SendPositionPayload) {
  const token = getToken();

  const res = await fetch(`${API_BASE}/driver/position`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || `Request failed (${res.status})`);
  }

  // Keep response flexible (we can return { ok: true } later)
  return res.json().catch(() => ({}));
}
