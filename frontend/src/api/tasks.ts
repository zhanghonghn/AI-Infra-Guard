import { api } from './client';
import type { TaskListResponse } from '@/types/task';

export interface TaskListParams {
  q?: string;
  taskType?: string;
}

/** GET /api/v1/app/tasks — list tasks for the current identity. */
export function listTasks(params: TaskListParams = {}) {
  return api.get<TaskListResponse>('/api/v1/app/tasks', params);
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
