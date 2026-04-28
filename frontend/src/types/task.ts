// Task-related shared types. The backend stores tasks as flexible
// map[string]interface{} so we model only the fields the UI consumes.
export type TaskType =
  | 'mcp_scan'
  | 'ai_infra_scan'
  | 'model_redteam_report'
  | 'agent_scan'
  | 'garak_scan';

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'terminated';

export interface TaskListItem {
  sessionId: string;
  taskType: TaskType | string;
  taskName?: string;
  status: TaskStatus | string;
  createdAt?: string;
  updatedAt?: string;
  username?: string;
  // Backend may include arbitrary extra fields.
  [key: string]: unknown;
}

export interface TaskListResponse {
  tasks: TaskListItem[];
}
