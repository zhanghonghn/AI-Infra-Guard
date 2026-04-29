import { api } from './client';
import type { PageResult } from '@/types/api';
import type {
  Evaluation,
  Fingerprint,
  McpPlugin,
  Vulnerability,
} from '@/types/knowledge';

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

export interface VulnerabilityListParams {
  page?: number;
  size?: number;
  q?: string;
}

/** GET /api/v1/knowledge/vulnerabilities */
export function listVulnerabilities(params: VulnerabilityListParams = {}) {
  return api.get<PageResult<Vulnerability>>(
    '/api/v1/knowledge/vulnerabilities',
    params,
  );
}

// HandleList for MCP returns { total, items } only (no page/size fields), and
// it does not currently support server-side filtering / pagination. Callers
// paginate / filter client-side.
export interface McpListResult {
  total: number;
  items: McpPlugin[];
}

/** GET /api/v1/knowledge/mcp */
export function listMcpPlugins() {
  return api.get<McpListResult>('/api/v1/knowledge/mcp');
}

export interface EvaluationListParams {
  page?: number;
  size?: number;
  q?: string;
  /** When true, the backend includes the heavyweight `data` array. */
  detail?: boolean;
}

/** GET /api/v1/knowledge/evaluations */
export function listEvaluations(params: EvaluationListParams = {}) {
  const { detail, ...rest } = params;
  return api.get<PageResult<Evaluation>>('/api/v1/knowledge/evaluations', {
    ...rest,
    detail: detail ? 'true' : undefined,
  });
}

/** GET /api/v1/knowledge/evaluations/:name */
export function getEvaluationDetail(name: string) {
  return api.get<Evaluation>(
    `/api/v1/knowledge/evaluations/${encodeURIComponent(name)}`,
  );
}
