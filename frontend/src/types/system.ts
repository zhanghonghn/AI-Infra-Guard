/** Status of the GitHub data-directory sync (mirrors update_api.go). */
export interface UpdateStatus {
  running: boolean;
  /** Tri-state: undefined while never run, true on success, false on failure. */
  success?: boolean;
  started_at?: string;
  finished_at?: string;
  message: string;
  files_updated: number;
  ref?: string;
}
