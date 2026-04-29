import { api } from './client';

export type LoginRequest = {
  username: string;
  password: string;
};

export type LoginResponse = {
  token: string;
  username: string;
  expires_at: number;
};

export function login(req: LoginRequest) {
  return api.post<LoginResponse>('/api/v1/auth/login', req);
}

export type MeResponse = {
  username: string;
};

export function getMe() {
  return api.get<MeResponse>('/api/v1/auth/me');
}
