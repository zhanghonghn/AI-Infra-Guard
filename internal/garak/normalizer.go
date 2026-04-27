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

package garak

import (
	"fmt"

	"github.com/Tencent/AI-Infra-Guard/pkg/engine"
	"github.com/google/uuid"
)

// ------------------- Garak 适配器输出契约（与 Python 侧保持一致）-------------------

// AdapterOutput 是 garak-adapter/main.py 写入 stdout 的顶层 JSON 结构。
// 此结构同时作为契约测试的验证基准。
type AdapterOutput struct {
	AdapterVersion string        `json:"adapter_version"`
	GarakVersion   string        `json:"garak_version"`
	ScanID         string        `json:"scan_id"`
	Success        bool          `json:"success"`
	ProbeResults   []ProbeResult `json:"probe_results"`
	Metadata       OutputMeta    `json:"metadata"`
}

// ProbeResult 单个探针的检测结果
type ProbeResult struct {
	ProbeID       string         `json:"probe_id"`
	DetectorName  string         `json:"detector_name"`
	TotalAttempts int            `json:"total_attempts"`
	Failures      int            `json:"failures"`
	PassRate      float64        `json:"pass_rate"`
	Examples      []ProbeExample `json:"examples"`
}

// ProbeExample 单次探测的请求/响应样本
type ProbeExample struct {
	Prompt  string `json:"prompt"`
	Response string `json:"response"`
	Passed  bool   `json:"passed"`
}

// OutputMeta 扫描执行元数据
type OutputMeta struct {
	StartTime     string `json:"start_time"`
	EndTime       string `json:"end_time"`
	ModelProvider string `json:"model_provider"`
	ModelName     string `json:"model_name"`
	// Error 仅在 adapter 失败时由 garak-adapter/main.py 写入；用于将真实
	// 失败原因（例如 "Garak 未安装"）回传给上游 Agent，避免用户只看到
	// "exit status 2" 这种无信息的退出码。
	Error string `json:"error,omitempty"`
}

// ------------------- 风险类型映射（probe ID → RiskType）-------------------

// ProbeToRiskType 将 Garak probe 名映射到统一风险类型。
// 映射规则在此集中维护，配合 data/garak_policies/ YAML 使用。
// ADR-002：主要映射逻辑放 Go 代码，运行时通过 YAML 可扩展追加。
var ProbeToRiskType = map[string]engine.RiskType{
	// 越狱绕过
	"dan.Dan_11_0":           engine.RiskTypeJailbreak,
	"dan.Dan_10_0":           engine.RiskTypeJailbreak,
	"dan.DAN_Jailbreak":      engine.RiskTypeJailbreak,
	"atkgen.Atkgen":          engine.RiskTypeJailbreak,
	"gcg.GCG_T_2_23":         engine.RiskTypeJailbreak,
	"suffix.GCGCached":       engine.RiskTypeJailbreak,

	// 提示注入
	"promptinject.HijackHateHumanized":  engine.RiskTypePromptInjection,
	"promptinject.HijackKillHumanized":  engine.RiskTypePromptInjection,
	"promptinject.HijackHijackHumanized": engine.RiskTypePromptInjection,

	// 数据泄露
	"leakreplay.LiteratureCloze80":      engine.RiskTypeDataLeakage,
	"leakreplay.LiteratureCloze50":      engine.RiskTypeDataLeakage,
	"knownbadsignatures.EICAR":          engine.RiskTypeDataLeakage,

	// 内容安全违规
	"lmrc.Deadnames":                    engine.RiskTypeContentViolation,
	"lmrc.Profanity":                    engine.RiskTypeContentViolation,
	"lmrc.SexualContent":                engine.RiskTypeContentViolation,
	"lmrc.Violence":                     engine.RiskTypeContentViolation,

	// 工具滥用（Agent 场景）
	"tooluse.ToolUseMisuse":             engine.RiskTypeToolMisuse,
}

// RiskTypeDisplayNames 中英文风险类型显示名
var RiskTypeDisplayNames = map[engine.RiskType]string{
	engine.RiskTypeJailbreak:        "越狱绕过",
	engine.RiskTypePromptInjection:  "提示注入",
	engine.RiskTypeDataLeakage:      "数据泄露",
	engine.RiskTypeContentViolation: "内容安全违规",
	engine.RiskTypeToolMisuse:       "工具滥用",
	engine.RiskTypeUnknown:          "未知风险",
}

// FixRecommendations 按风险类型的修复建议模板
var FixRecommendations = map[engine.RiskType]string{
	engine.RiskTypeJailbreak:        "增强系统提示防护，启用输出过滤层，并在推理管道中加入意图检测组件",
	engine.RiskTypePromptInjection:  "对用户输入进行严格清理和边界隔离，避免在提示中直接嵌入不可信内容",
	engine.RiskTypeDataLeakage:      "在输出层添加敏感信息检测，设置内容脱敏规则，限制训练数据记忆复现",
	engine.RiskTypeContentViolation: "加强内容安全过滤器，更新有害内容分类规则，引入多维度内容审核",
	engine.RiskTypeToolMisuse:       "限制工具调用范围和权限，添加工具使用意图验证，实施最小权限原则",
	engine.RiskTypeUnknown:          "请联系安全团队对检测结果进行人工审核",
}

// MaxConfidence 置信度最大值
const MaxConfidence = 100

// Normalizer 将 Garak 适配器输出映射到统一 Finding Schema。
type Normalizer struct {
	// thresholds 可由策略配置覆盖
	thresholds SeverityThresholds
	// extraMapping 运行时追加的 probe → risk 映射（来自 YAML 策略扩展）
	extraMapping map[string]engine.RiskType
}

// NewNormalizer 创建标准化器，使用策略配置中的严重度阈值
func NewNormalizer(thresholds SeverityThresholds) *Normalizer {
	return &Normalizer{
		thresholds:   thresholds,
		extraMapping: make(map[string]engine.RiskType),
	}
}

// AddProbeMapping 追加额外的 probe → riskType 映射（用于 YAML 扩展）
func (n *Normalizer) AddProbeMapping(probeID string, riskType engine.RiskType) {
	n.extraMapping[probeID] = riskType
}

// Normalize 将 AdapterOutput 转换为 []Finding
func (n *Normalizer) Normalize(output *AdapterOutput) ([]engine.Finding, error) {
	if output == nil {
		return nil, fmt.Errorf("adapter output 为空")
	}

	var findings []engine.Finding
	asset := fmt.Sprintf("%s @ %s", output.Metadata.ModelName, output.Metadata.ModelProvider)

	for _, pr := range output.ProbeResults {
		// 仅将探测失败的结果（pass_rate < 1.0）转化为 Finding
		if pr.PassRate >= 1.0 && pr.Failures == 0 {
			continue
		}

		riskType := n.resolveRiskType(pr.ProbeID)
		severity := n.mapSeverity(pr.PassRate)
		confidence := n.calcConfidence(pr)

		finding := engine.Finding{
			FindingID:         uuid.NewString(),
			ScanID:            output.ScanID,
			RiskType:          riskType,
			RiskTypeDisplay:   n.riskTypeDisplay(riskType),
			Severity:          severity,
			Confidence:        confidence,
			Asset:             asset,
			EvidenceSummary:   n.buildEvidenceSummary(riskType, pr),
			FixRecommendation: n.fixRecommendation(riskType),
			Status:            engine.FindingStatusOpen,

			// 内部字段
			SourceEngine:      "garak",
			GarakProbeID:      pr.ProbeID,
			GarakDetectorName: pr.DetectorName,
			EvidenceDetail:    n.buildEvidenceDetail(pr),
		}
		findings = append(findings, finding)
	}

	return findings, nil
}

// resolveRiskType 按优先级查找 probe 对应的风险类型
// 优先使用运行时追加的映射，其次是内置映射，最后回退到 Unknown
func (n *Normalizer) resolveRiskType(probeID string) engine.RiskType {
	if rt, ok := n.extraMapping[probeID]; ok {
		return rt
	}
	if rt, ok := ProbeToRiskType[probeID]; ok {
		return rt
	}
	return engine.RiskTypeUnknown
}

// mapSeverity 根据 pass_rate 映射严重度
func (n *Normalizer) mapSeverity(passRate float64) engine.Severity {
	t := n.thresholds
	switch {
	case passRate < t.Critical:
		return engine.SeverityCritical
	case passRate < t.High:
		return engine.SeverityHigh
	case passRate < t.Medium:
		return engine.SeverityMedium
	default:
		return engine.SeverityLow
	}
}

// calcConfidence 根据样本数量和失败率计算置信度 (0-100)
func (n *Normalizer) calcConfidence(pr ProbeResult) int {
	if pr.TotalAttempts == 0 {
		return 0
	}
	failRate := float64(pr.Failures) / float64(pr.TotalAttempts)
	// 置信度基础 = 失败率 * 80（样本越多、失败率越高，置信越高）
	confidence := int(failRate * 80)
	// 样本量补偿（最多 +20）
	sampleBonus := pr.TotalAttempts
	if sampleBonus > 20 {
		sampleBonus = 20
	}
	confidence += sampleBonus
	if confidence > MaxConfidence {
		confidence = MaxConfidence
	}
	return confidence
}

// buildEvidenceSummary 生成 L1/L2 可见的证据摘要（不含原始 payload）
func (n *Normalizer) buildEvidenceSummary(riskType engine.RiskType, pr ProbeResult) string {
	display := n.riskTypeDisplay(riskType)
	return fmt.Sprintf("探针 [%s] 检测到「%s」风险：共 %d 次尝试，%d 次触发（失败率 %.0f%%）",
		pr.ProbeID, display, pr.TotalAttempts, pr.Failures,
		(1-pr.PassRate)*100)
}

// buildEvidenceDetail 构建 L2/L3 可见的详细证据（含前 3 个失败样本）
func (n *Normalizer) buildEvidenceDetail(pr ProbeResult) map[string]interface{} {
	var failExamples []ProbeExample
	for _, ex := range pr.Examples {
		if !ex.Passed {
			failExamples = append(failExamples, ex)
			if len(failExamples) >= 3 {
				break
			}
		}
	}
	return map[string]interface{}{
		"probe_id":       pr.ProbeID,
		"detector_name":  pr.DetectorName,
		"total_attempts": pr.TotalAttempts,
		"failures":       pr.Failures,
		"pass_rate":      pr.PassRate,
		"fail_examples":  failExamples,
	}
}

func (n *Normalizer) riskTypeDisplay(riskType engine.RiskType) string {
	if name, ok := RiskTypeDisplayNames[riskType]; ok {
		return name
	}
	return string(riskType)
}

func (n *Normalizer) fixRecommendation(riskType engine.RiskType) string {
	if rec, ok := FixRecommendations[riskType]; ok {
		return rec
	}
	return FixRecommendations[engine.RiskTypeUnknown]
}
