// Mirror of pkg/database.Finding — only the fields the UI needs.
// Risk types and severities follow Garak conventions.

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | string;

export type FindingRiskType =
  | 'jailbreak'
  | 'prompt_injection'
  | 'data_leakage'
  | 'content_violation'
  | 'unknown'
  | string;

export type FindingStatus =
  | 'open'
  | 'fixed'
  | 'accepted_risk'
  | 'false_positive'
  | string;

export interface Finding {
  finding_id: string;
  scan_id: string;
  risk_type: FindingRiskType;
  risk_type_display?: string;
  severity: FindingSeverity;
  confidence: number;
  asset?: string;
  evidence_summary: string;
  evidence_detail?: unknown;
  fix_recommendation: string;
  status: FindingStatus;
  source_engine?: string;
  garak_probe_id?: string;
  garak_detector_name?: string;
  raw_metadata?: unknown;
  created_at: number;
  updated_at: number;
}

/**
 * Response shape of GET /api/v1/app/findings/:scanId.
 *
 * IMPORTANT: this endpoint does NOT use the standard `{status,message,data}`
 * envelope — the JSON body is the payload itself. The shared API client
 * already passes such bodies through unchanged.
 */
export interface FindingsResponse {
  scan_id: string;
  total: number;
  by_severity: Record<string, number>;
  findings: Finding[];
}
