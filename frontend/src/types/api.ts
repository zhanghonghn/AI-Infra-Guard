/**
 * Common API envelope used by every Go handler in common/websocket.
 * See api.md → "Common Response Format".
 *
 *   { "status": 0, "message": "...", "data": { ... } }
 *
 * status === 0 → success; non-zero → business error.
 */
export interface ApiResponse<T> {
  status: number;
  message: string;
  data: T;
}

export interface PageResult<T> {
  total: number;
  page: number;
  size: number;
  items: T[];
}
