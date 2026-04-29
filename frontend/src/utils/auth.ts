export const USERNAME_STORAGE_KEY = 'aig.username';

export function getCurrentUsername(): string {
  return localStorage.getItem(USERNAME_STORAGE_KEY)?.trim() ?? '';
}

export function isLoggedIn(): boolean {
  return getCurrentUsername().length > 0;
}

export function loginWithUsername(username: string): void {
  localStorage.setItem(USERNAME_STORAGE_KEY, username.trim());
}

export function logout(): void {
  localStorage.removeItem(USERNAME_STORAGE_KEY);
}
