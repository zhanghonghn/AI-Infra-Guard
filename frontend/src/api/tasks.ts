import { api } from './client';
import { getAuthToken } from '@/utils/auth';
import type {
  CreateTaskRequest,
  CreateTaskResponse,
  TaskDetail,
  TaskListResponse,
} from '@/types/task';

export interface TaskListParams {
  q?: string;
  taskType?: string;
}

/** GET /api/v1/app/tasks — list tasks for the current identity. */
export function listTasks(params: TaskListParams = {}) {
  return api.get<TaskListResponse>('/api/v1/app/tasks', params);
}

/** GET /api/v1/app/tasks/:sessionId — full detail incl. message replay. */
export function getTaskDetail(sessionId: string) {
  return api.get<TaskDetail>(
    `/api/v1/app/tasks/${encodeURIComponent(sessionId)}`,
  );
}

/**
 * POST /api/v1/app/tasks — create a new task.
 *
 * Caller MUST have already opened the SSE connection for `sessionId`
 * (see `openTaskSse`) — the backend `AddTask` blocks for ~100s waiting
 * for that connection before it dispatches the task to an agent.
 */
export function createTask(req: CreateTaskRequest) {
  return api.post<CreateTaskResponse>('/api/v1/app/tasks', req);
}

/** PUT /api/v1/app/tasks/:sessionId — rename a task. Backend currently
 *  accepts only `{title}` and validates title length (≤100). */
export function updateTaskTitle(sessionId: string, title: string) {
  return api.put<unknown>(
    `/api/v1/app/tasks/${encodeURIComponent(sessionId)}`,
    { title },
  );
}

/** DELETE /api/v1/app/tasks/:sessionId */
export function deleteTask(sessionId: string) {
  return api.delete<unknown>(`/api/v1/app/tasks/${encodeURIComponent(sessionId)}`);
}

/** POST /api/v1/app/tasks/:sessionId/terminate */
export function terminateTask(sessionId: string) {
  return api.post<unknown>(
    `/api/v1/app/tasks/${encodeURIComponent(sessionId)}/terminate`,
  );
}

/**
 * URL of the live SSE channel for a session. Use with the native
 * EventSource constructor — see hooks/useTaskSse.ts.
 *
 * SSE in the browser does not let us add custom headers, so we cannot
 * inject `username`. The backend tolerates this (it falls back to the
 * default identity) for read-only event streams.
 */
export function taskSseUrl(sessionId: string): string {
  const token = getAuthToken();
  const base = `/api/v1/app/tasks/sse/${encodeURIComponent(sessionId)}`;
  if (!token) return base;
  return `${base}?token=${encodeURIComponent(token)}`;
}

