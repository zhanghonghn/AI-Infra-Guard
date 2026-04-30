import { api } from './client';
import type { FindingsResponse, FindingStatus } from '@/types/finding';

/**
 * GET /api/v1/app/findings/:scanId
 *
 * NOTE: This endpoint returns the payload directly (no `{status,message,data}`
 * envelope). The shared `request` wrapper in client.ts already passes such
 * bodies through unchanged when the `status` field is absent.
 */
export function listFindings(scanId: string) {
  return api.get<FindingsResponse>(
    `/api/v1/app/findings/${encodeURIComponent(scanId)}`,
  );
}

/** PUT /api/v1/app/findings/status/:findingId — change processing status. */
export function updateFindingStatus(findingId: string, status: FindingStatus) {
  return api.put<unknown>(
    `/api/v1/app/findings/status/${encodeURIComponent(findingId)}`,
    { status },
  );
}

/** Browser-friendly URL for the export-as-JSON endpoint (FR-5). */
export function findingsExportUrl(scanId: string): string {
  return `/api/v1/app/findings/${encodeURIComponent(scanId)}/export`;
}
