// Model configuration as exposed by /api/v1/app/models.
// Tokens are masked as "********" in responses.

export interface ModelConfig {
  model: string;
  token: string;
  base_url: string;
  note?: string;
  limit?: number;
}

export interface ModelEntry {
  model_id: string;
  model: ModelConfig;
  /** YAML-only: list of task types where this model is the default. */
  default?: string[];
}
