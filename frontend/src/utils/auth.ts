export const USERNAME_STORAGE_KEY = 'aig.username';
export const AUTH_TOKEN_STORAGE_KEY = 'aig.auth.token';
export const AUTH_EXPIRES_AT_STORAGE_KEY = 'aig.auth.expiresAt';

export type LoginSession = {
  username: string;
  token: string;
  expiresAt: number;
};

export function getCurrentUsername(): string {
  return localStorage.getItem(USERNAME_STORAGE_KEY)?.trim() ?? '';
}

export function getAuthToken(): string {
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim() ?? '';
}

export function getAuthExpiresAt(): number {
  const raw = localStorage.getItem(AUTH_EXPIRES_AT_STORAGE_KEY);
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export function isLoggedIn(): boolean {
  const username = getCurrentUsername();
  const token = getAuthToken();
  const expiresAt = getAuthExpiresAt();
  const now = Math.floor(Date.now() / 1000);
  return username.length > 0 && token.length > 0 && expiresAt > now;
}

export function loginWithUsername(username: string): void {
  localStorage.setItem(USERNAME_STORAGE_KEY, username.trim());
}

export function saveLoginSession(session: LoginSession): void {
  localStorage.setItem(USERNAME_STORAGE_KEY, session.username.trim());
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, session.token);
  localStorage.setItem(AUTH_EXPIRES_AT_STORAGE_KEY, String(session.expiresAt));
}

export function logout(): void {
  localStorage.removeItem(USERNAME_STORAGE_KEY);
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_EXPIRES_AT_STORAGE_KEY);
}
