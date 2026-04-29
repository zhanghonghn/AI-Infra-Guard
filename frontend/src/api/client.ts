import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { message } from 'antd';
import type { ApiResponse } from '@/types/api';
import { getCurrentUsername } from '@/utils/auth';

/**
 * Shared axios instance.
 *
 * - In dev, requests to /api/* are proxied to the Go server (see vite.config.ts).
 * - In production, the SPA is served by the same Go server, so /api is same-origin.
 */
const instance: AxiosInstance = axios.create({
  baseURL: '/',
  timeout: 60_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Inject the lightweight identity header expected by setupIdentityMiddleware.
instance.interceptors.request.use((config) => {
  const username = getCurrentUsername() || 'public_user';
  config.headers = config.headers ?? {};
  // axios v1 supports plain assignment for both AxiosHeaders and plain objects.
  (config.headers as Record<string, string>).username = username;
  return config;
});

/**
 * Unwrap the standard `{status, message, data}` envelope and surface
 * business-level errors as rejected promises.
 */
async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const resp = await instance.request<ApiResponse<T>>(config);
    const body = resp.data;
    if (body && typeof body === 'object' && 'status' in body) {
      if (body.status === 0) {
        return body.data;
      }
      const msg = body.message || `Request failed (status=${body.status})`;
      message.error(msg);
      throw new Error(msg);
    }
    // Some endpoints (e.g. /version) return raw JSON without the envelope.
    return resp.data as unknown as T;
  } catch (err) {
    if (err instanceof AxiosError) {
      const msg =
        err.response?.data?.message ||
        err.message ||
        'Network error';
      message.error(msg);
      throw new Error(msg);
    }
    throw err;
  }
}

export const api = {
  get: <T>(url: string, params?: Record<string, unknown> | object) =>
    request<T>({ method: 'GET', url, params }),
  post: <T>(url: string, data?: unknown) =>
    request<T>({ method: 'POST', url, data }),
  put: <T>(url: string, data?: unknown) =>
    request<T>({ method: 'PUT', url, data }),
  delete: <T>(url: string, data?: unknown) =>
    request<T>({ method: 'DELETE', url, data }),
};

export default api;
