export type Role = 'ADMIN' | 'OPERATOR' | 'DRIVER';

export type User = {
  id: string;
  phone: string;
  role: Role;
};

const TOKEN_KEY = 'transport_token';
const USER_KEY = 'transport_user';

const API_BASE =
  import.meta.env.VITE_API_BASE || 'https://transport-api-production-d0c6.up.railway.app';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setSession(accessToken: string, user: User) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  auth = false,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
  
    try {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        message = data?.message || data?.error || message;
      } else {
        const txt = await res.text();
        if (txt) message = txt;
      }
    } catch {}
  
    throw new Error(message);
  }
  

  return (await res.json()) as T;
}

export type LoginResponse = {
  accessToken: string;
  user: User;
};

export function login(phone: string, pin: string) {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, pin }),
  });
}

export function me() {
  return request<User>('/auth/me', { method: 'GET' }, true);
}
