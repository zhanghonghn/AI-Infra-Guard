import { api } from './client';
import type { ModelEntry } from '@/types/model';

/** GET /api/v1/app/models — list available models (incl. YAML defaults). */
export function listModels() {
  return api.get<ModelEntry[]>('/api/v1/app/models');
}
