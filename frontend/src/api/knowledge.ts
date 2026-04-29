import { api } from './client';
import type { PageResult } from '@/types/api';
import type { Fingerprint } from '@/types/knowledge';

export interface FingerprintListParams {
  page?: number;
  size?: number;
  q?: string;
}

/** GET /api/v1/knowledge/fingerprints */
export function listFingerprints(params: FingerprintListParams = {}) {
  return api.get<PageResult<Fingerprint>>(
    '/api/v1/knowledge/fingerprints',
    params,
  );
}

/** DELETE /api/v1/knowledge/fingerprints  body: { name } */
export function deleteFingerprint(name: string) {
  return api.delete<unknown>('/api/v1/knowledge/fingerprints', { name });
}
