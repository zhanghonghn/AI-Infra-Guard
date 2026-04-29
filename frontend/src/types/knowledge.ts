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
