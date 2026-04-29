// Task-related shared types. The backend stores tasks as flexible
// map[string]interface{} so we model only the fields the UI consumes.
//
// Note: in-app tasks (POST /api/v1/app/tasks) use PascalCase-with-dashes
// task types like 'AI-Infra-Scan', while the third-party taskapi/* uses
// lowercase_underscored names like 'ai_infra_scan'. Both forms can appear
// in the task list; we accept both.
export type InAppTaskType =
  | 'AI-Infra-Scan'
  | 'Mcp-Scan'
  | 'Model-Redteam-Report'
  | 'Agent-Scan'
  | 'Garak-Scan';

export type TaskApiTaskType =
  | 'mcp_scan'
  | 'ai_infra_scan'
  | 'model_redteam_report'
  | 'agent_scan'
  | 'garak_scan';

export type TaskType = InAppTaskType | TaskApiTaskType;

export type TaskStatus =
  | 'pending'
  | 'todo'
  | 'doing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'terminated';

export interface TaskListItem {
  sessionId: string;
  taskType: TaskType | string;
  title?: string;
  rawTitle?: string;
  status: TaskStatus | string;
  createdAt?: number | string;
  updatedAt?: number | string;
  completedAt?: number | string | null;
  countryIsoCode?: string;
  source?: string;
  sourceLabel?: string;
  // Backend may include arbitrary extra fields.
  [key: string]: unknown;
}

export interface TaskListResponse {
  tasks: TaskListItem[];
}

export interface TaskAttachment {
  filename: string;
  fileUrl: string;
}

/**
 * A replayable task event as returned by GetTaskDetail.
 *
 * `event` carries the original SSE payload (one of LiveStatusEvent,
 * PlanUpdateEvent, NewPlanStepEvent, StatusUpdateEvent, ToolUsedEvent,
 * ActionLogEvent, ResultUpdateEvent...). Shapes are loose because the
 * backend evolves them frequently.
 */
export interface TaskMessage {
  id: string;
  type: string;
  timestamp: number;
  event: Record<string, unknown>;
}

export interface TaskDetail {
  sessionId: string;
  title: string;
  rawTitle?: string;
  status: TaskStatus | string;
  countryIsoCode?: string;
  createdAt?: number;
  content: string;
  params: Record<string, unknown>;
  taskType: TaskType | string;
  attachments?: TaskAttachment[];
  messages: TaskMessage[];
  source?: string;
  sourceLabel?: string;
}

/**
 * Request body for POST /api/v1/app/tasks.
 * The frontend MUST generate `id` and `sessionId` (UUIDs) and open the
 * SSE channel for `sessionId` BEFORE posting — `AddTask` blocks for up
 * to ~100s waiting for that connection to be established.
 */
export interface CreateTaskRequest {
  id: string;
  sessionId: string;
  taskType: InAppTaskType;
  timestamp: number;
  content: string;
  params?: Record<string, unknown>;
  attachments?: string[];
  countryIsoCode?: string;
}

export interface CreateTaskResponse {
  sessionId: string;
  title: string;
}

/** Result of a successful upload via /api/v1/app/tasks/uploadFile. */
export interface UploadResult {
  fileUrl: string;
  filename: string;
  size: number;
}

