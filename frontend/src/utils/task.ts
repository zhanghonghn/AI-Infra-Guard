/** Generate a UUIDv4 string. Uses `crypto.randomUUID` when available
 *  (modern browsers / Node 19+), falling back to `crypto.getRandomValues`
 *  when only the older WebCrypto API is exposed. We deliberately avoid
 *  `Math.random()` because the resulting value is used as the canonical
 *  task `sessionId` — a guessable id would let other users address the
 *  task before its first SSE connection is established. */
export function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // Per RFC4122 §4.4 set version (4) and variant (10) bits.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex: string[] = [];
    for (let i = 0; i < bytes.length; i += 1) {
      hex.push(bytes[i].toString(16).padStart(2, '0'));
    }
    return (
      `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-` +
      `${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-` +
      `${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
    );
  }
  throw new Error('Secure random source (Web Crypto) not available');
}

/** Format a unix-millisecond timestamp (or ISO string) as 'HH:mm:ss'. */
export function formatTime(ts: number | string | undefined): string {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts : ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** True if the task status indicates the agent is still working on it. */
export function isTaskRunning(status: string | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === 'running' || s === 'doing' || s === 'pending' || s === 'todo';
}

/** True if the task is finished (success or failure). */
export function isTaskFinished(status: string | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s === 'completed' || s === 'failed' || s === 'terminated' || s === 'error'
  );
}

/** Format a duration in milliseconds as a short human-readable string,
 *  e.g. `1h 23m 45s`. Null/undefined/negative inputs render as `0s`. */
export function formatDuration(ms: number | undefined | null): string {
  if (ms == null || ms < 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** sessionStorage key used to hand a "clone source" task between
 *  TaskList → TaskCreate without exceeding URL length limits. */
export const TASK_CLONE_STORAGE_KEY = 'aig.taskClone';

/** localStorage key for the user's last-used UI language preference on
 *  the New Task form. */
export const TASK_LANG_STORAGE_KEY = 'aig.taskLang';
