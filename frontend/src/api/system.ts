import { api } from './client';
import type { UpdateStatus } from '@/types/system';

/** GET /api/v1/system/update-data — current/last sync state. */
export function getUpdateStatus() {
  return api.get<UpdateStatus>('/api/v1/system/update-data');
}

/** POST /api/v1/system/update-data — trigger a new sync.
 *
 * The backend always pulls from `main` and refreshes every data/ subdir;
 * the request body is intentionally empty. Returns the updated status
 * snapshot. Only one sync may run at a time — the backend is idempotent
 * if called while another sync is already in progress. */
export function triggerDataUpdate() {
  return api.post<UpdateStatus>('/api/v1/system/update-data', {});
}
