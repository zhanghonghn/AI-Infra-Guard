// Knowledge-base shared types.
// Mirror of parser.FingerPrint as serialised by HandleListFingerprints.

export interface FingerprintInfo {
  name: string;
  author?: string;
  desc?: string;
  reference?: string[];
  recommendation?: number;
  tags?: string[];
}

export interface FingerprintRule {
  // Backend exposes the raw rule tree; we only render summary fields,
  // so keep this opaque for now.
  [key: string]: unknown;
}

export interface Fingerprint {
  info: FingerprintInfo;
  rule?: FingerprintRule;
  // Tolerate unknown fields from rule engine evolution.
  [key: string]: unknown;
}

// Mirror of vulstruct.Info in pkg/vulstruct/scanner.go.
export interface VulnerabilityInfo {
  name: string;
  cve: string;
  summary: string;
  details: string;
  cvss: string;
  severity: string;
  security_advise?: string;
  references?: string[];
  author?: string;
}

// Mirror of vulstruct.VersionVul. `rule` is the raw DSL string.
export interface Vulnerability {
  info: VulnerabilityInfo;
  rule?: string;
  references?: string[];
  [key: string]: unknown;
}

// Mirror of mcp.PluginConfig.Info plus the `raw_data` field added by
// websocket.McpLoadFile. Categories are exposed as `category` (json tag).
export interface McpPluginInfo {
  id: string;
  name: string;
  description: string;
  author: string;
  category?: string[];
}

export interface McpPluginRule {
  name?: string;
  pattern?: string;
  description?: string;
  [key: string]: unknown;
}

export interface McpPlugin {
  info: McpPluginInfo;
  rules?: McpPluginRule[];
  prompt_template?: string;
  raw_data?: string;
  [key: string]: unknown;
}

// Mirror of websocket.EvaluationDataset.
export interface EvaluationDataItem {
  prompt?: string;
  [key: string]: unknown;
}

export interface Evaluation {
  name: string;
  description: string;
  description_zh?: string;
  author?: string;
  source?: string[];
  count: number;
  default: boolean;
  tags?: string[];
  recommendation?: number;
  language?: string;
  data?: EvaluationDataItem[] | null;
  [key: string]: unknown;
}
