// Copyright (c) 2024-2026 Tencent Zhuque Lab. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Requirement: Any integration or derivative work must explicitly attribute
// Tencent Zhuque Lab (https://github.com/Tencent/AI-Infra-Guard) in its
// documentation or user interface, as detailed in the NOTICE file.

// Package engine 定义扫描引擎的统一抽象接口，供所有引擎实现。
// 遵循依赖倒置原则：上层编排层依赖本接口，不依赖具体引擎实现。
package engine

import "context"

// ------------------- 通用枚举值 -------------------

// Severity 风险严重程度
type Severity string

const (
	SeverityCritical Severity = "critical"
	SeverityHigh     Severity = "high"
	SeverityMedium   Severity = "medium"
	SeverityLow      Severity = "low"
	SeverityInfo     Severity = "info"
)

// Intensity 扫描强度
type Intensity string

const (
	IntensityFast     Intensity = "fast"
	IntensityStandard Intensity = "standard"
	IntensityDeep     Intensity = "deep"
)

// RiskType 统一风险类型枚举
type RiskType string

const (
	RiskTypeJailbreak        RiskType = "Jailbreak"
	RiskTypePromptInjection  RiskType = "PromptInjection"
	RiskTypeDataLeakage      RiskType = "DataLeakage"
	RiskTypeContentViolation RiskType = "ContentViolation"
	RiskTypeToolMisuse       RiskType = "ToolMisuse"
	RiskTypeUnknown          RiskType = "Unknown"
)

// FindingStatus 发现状态
type FindingStatus string

const (
	FindingStatusOpen     FindingStatus = "open"
	FindingStatusFixed    FindingStatus = "fixed"
	FindingStatusIgnored  FindingStatus = "ignored"
	FindingStatusFP       FindingStatus = "false_positive"
)

// ------------------- 数据模型 -------------------

// ScanParams 扫描任务参数
type ScanParams struct {
	ScanID        string    `json:"scan_id"`
	ModelProvider string    `json:"model_provider"` // 如 openai/azure/ollama
	ModelName     string    `json:"model_name"`
	APIKey        string    `json:"-"` // 内存传递，不序列化
	BaseURL       string    `json:"base_url,omitempty"`
	ScanTarget    string    `json:"scan_target"`  // pre_release/quick_check 等
	Intensity     Intensity `json:"intensity"`
	Language      string    `json:"language"` // zh/en
}

// Finding 统一风险发现（标准化输出）
type Finding struct {
	FindingID         string        `json:"finding_id"`
	ScanID            string        `json:"scan_id"`
	RiskType          RiskType      `json:"risk_type"`
	RiskTypeDisplay   string        `json:"risk_type_display"`
	Severity          Severity      `json:"severity"`
	Confidence        int           `json:"confidence"` // 0-100
	Asset             string        `json:"asset,omitempty"`
	EvidenceSummary   string        `json:"evidence_summary"`
	EvidenceDetail    interface{}   `json:"evidence_detail,omitempty"`  // L2/L3 可见
	FixRecommendation string        `json:"fix_recommendation"`
	Status            FindingStatus `json:"status"`

	// 内部字段（L3 可见）
	SourceEngine      string      `json:"source_engine,omitempty"`
	GarakProbeID      string      `json:"garak_probe_id,omitempty"`
	GarakDetectorName string      `json:"garak_detector_name,omitempty"`
	RawMetadata       interface{} `json:"raw_metadata,omitempty"` // L3 专属
}

// RawResult 引擎原始输出
type RawResult struct {
	EngineType string      `json:"engine_type"`
	ScanID     string      `json:"scan_id"`
	Success    bool        `json:"success"`
	Data       interface{} `json:"data"`
}

// JobStatus 引擎执行任务状态
type JobStatus string

const (
	JobStatusPending   JobStatus = "pending"
	JobStatusRunning   JobStatus = "running"
	JobStatusCompleted JobStatus = "completed"
	JobStatusFailed    JobStatus = "failed"
	JobStatusCanceled  JobStatus = "canceled"
)

// ------------------- 引擎接口 -------------------

// ScanEngine 扫描引擎统一抽象接口。
// 所有引擎（AIG Native、Garak Adapter、未来引擎）均实现此接口，
// 使编排层依赖抽象而非具体实现。
type ScanEngine interface {
	// Name 返回引擎标识符
	Name() string

	// Start 异步启动扫描任务，返回 jobID
	Start(ctx context.Context, params ScanParams) (jobID string, err error)

	// Status 查询任务执行状态
	Status(jobID string) (JobStatus, error)

	// Cancel 取消正在执行的任务
	Cancel(jobID string) error

	// CollectResult 收集任务结果（阻塞直到完成）
	CollectResult(ctx context.Context, jobID string) (*RawResult, error)
}
