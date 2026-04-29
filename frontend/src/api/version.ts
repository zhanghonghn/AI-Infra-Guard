import { api } from './client';

export interface VersionInfo {
  version: string;
  changelog: string;
}

/** GET /api/v1/version — note: this endpoint does NOT use the standard envelope. */
export function getVersion() {
  return api.get<VersionInfo>('/api/v1/version');
}
