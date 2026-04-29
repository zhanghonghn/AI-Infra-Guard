import { api } from './client';
import type { ModelEntry, ModelConfig } from '@/types/model';

/** GET /api/v1/app/models — list available models (incl. YAML defaults). */
export function listModels() {
  return api.get<ModelEntry[]>('/api/v1/app/models');
}

/** GET /api/v1/app/models/:modelId — fetch one model (token is masked). */
export function getModel(modelId: string) {
  return api.get<ModelEntry>(
    `/api/v1/app/models/${encodeURIComponent(modelId)}`,
  );
}

/** POST /api/v1/app/models — create a new model.
 *
 * `model_id` must be globally unique. The backend validates the token /
 * base_url combo at create time. */
export function createModel(req: { model_id: string; model: ModelConfig }) {
  return api.post<unknown>('/api/v1/app/models', req);
}

/** PUT /api/v1/app/models/:modelId — partial update.
 *
 * If `model.token` is empty or "********" the existing token is kept. */
export function updateModel(modelId: string, req: { model: Partial<ModelConfig> }) {
  return api.put<unknown>(
    `/api/v1/app/models/${encodeURIComponent(modelId)}`,
    req,
  );
}

/** DELETE /api/v1/app/models — supports batch deletion. */
export function deleteModels(modelIds: string[]) {
  return api.delete<unknown>('/api/v1/app/models', { model_ids: modelIds });
}

