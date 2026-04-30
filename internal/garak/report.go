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
	"sort"
	"strings"

	"github.com/Tencent/AI-Infra-Guard/pkg/engine"
)

// MaxFailExamplesPerFinding 单个 Finding 在详细报告中展示的失败样本数上限。
// 与 normalizer.buildEvidenceDetail 中的截断保持一致，避免巨型 prompt/response
// 把 Markdown 报告撑爆。
const MaxFailExamplesPerFinding = 3

// MaxExampleTextLen 单条 prompt/response 在 Markdown 中的最大长度，
// 超出则截断并附 "..."，避免单个样本占满整页。
const MaxExampleTextLen = 800

// ReportInputs 渲染详细报告所需的全部上下文。
// 与 GarakTask.Execute 的中间状态保持一致，便于直接复用。
type ReportInputs struct {
	ScanID    string
	Intensity string
	Output    *AdapterOutput
	Findings  []engine.Finding
	// Language: "zh" / "en"。空字符串视为 "zh"。
	Language string
}

// RenderMarkdownReport 按统一的 Markdown 模板渲染 Garak 详细扫描报告。
//
// 报告结构：
//  1. 顶部元信息（扫描 ID / 模型 / 强度 / 时间 / Garak 版本）
//  2. 执行摘要（findings 总数、严重度计数、整体通过率）
//  3. Findings 详情（按严重度降序，每条含证据摘要 / 修复建议 / 失败样本）
//  4. 探针执行结果表（probe_id / detector / pass_rate / 失败次数）
//  5. 附录：注意事项 / 数据脱敏说明
//
// 当 inputs.Output 为 nil 时返回一个最小化的占位报告，保证调用方不会拿到空字符串。
func RenderMarkdownReport(inputs ReportInputs) string {
	lang := strings.ToLower(strings.TrimSpace(inputs.Language))
	if lang == "" || lang == "zh_cn" {
		lang = "zh"
	}
	t := reportTexts(lang)

	var b strings.Builder

	// ---------- 1. 标题与元信息 ----------
	b.WriteString("# " + t.title + "\n\n")
	b.WriteString(renderMetaSection(t, inputs))

	// ---------- 2. 执行摘要 ----------
	b.WriteString("## " + t.summaryHeading + "\n\n")
	b.WriteString(renderSummarySection(t, inputs))

	// ---------- 3. Findings 详情 ----------
	b.WriteString("## " + t.findingsHeading + "\n\n")
	if len(inputs.Findings) == 0 {
		b.WriteString("> " + t.noFindings + "\n\n")
	} else {
		b.WriteString(renderFindingsSection(t, inputs.Findings))
	}

	// ---------- 4. 探针结果表 ----------
	b.WriteString("## " + t.probesHeading + "\n\n")
	b.WriteString(renderProbeResultsSection(t, inputs.Output))

	// ---------- 5. 附录 ----------
	b.WriteString("## " + t.appendixHeading + "\n\n")
	b.WriteString(t.appendixBody + "\n")

	return b.String()
}

// renderMetaSection 渲染顶部元信息表格
func renderMetaSection(t reportI18n, in ReportInputs) string {
	var (
		provider, model, start, end, garakVersion, adapterVersion string
	)
	if in.Output != nil {
		provider = in.Output.Metadata.ModelProvider
		model = in.Output.Metadata.ModelName
		start = in.Output.Metadata.StartTime
		end = in.Output.Metadata.EndTime
		garakVersion = in.Output.GarakVersion
		adapterVersion = in.Output.AdapterVersion
	}

	rows := [][2]string{
		{t.metaScanID, fallback(in.ScanID, "-")},
		{t.metaProvider, fallback(provider, "-")},
		{t.metaModel, fallback(model, "-")},
		{t.metaIntensity, fallback(in.Intensity, "-")},
		{t.metaStart, fallback(start, "-")},
		{t.metaEnd, fallback(end, "-")},
		{t.metaGarakVer, fallback(garakVersion, "-")},
		{t.metaAdapterVer, fallback(adapterVersion, "-")},
	}

	var b strings.Builder
	b.WriteString(fmt.Sprintf("| %s | %s |\n", t.metaCol, t.valueCol))
	b.WriteString("|---|---|\n")
	for _, row := range rows {
		b.WriteString(fmt.Sprintf("| %s | %s |\n", row[0], escapeMarkdownCell(row[1])))
	}
	b.WriteString("\n")
	return b.String()
}

// renderSummarySection 计算并渲染执行摘要
func renderSummarySection(t reportI18n, in ReportInputs) string {
	bySeverity := map[engine.Severity]int{
		engine.SeverityCritical: 0,
		engine.SeverityHigh:     0,
		engine.SeverityMedium:   0,
		engine.SeverityLow:      0,
		engine.SeverityInfo:     0,
	}
	for _, f := range in.Findings {
		bySeverity[f.Severity]++
	}

	totalProbes, totalAttempts, totalFailures := 0, 0, 0
	if in.Output != nil {
		totalProbes = len(in.Output.ProbeResults)
		for _, pr := range in.Output.ProbeResults {
			totalAttempts += pr.TotalAttempts
			totalFailures += pr.Failures
		}
	}
	overallPassRate := 1.0
	if totalAttempts > 0 {
		overallPassRate = 1.0 - float64(totalFailures)/float64(totalAttempts)
	}

	var b strings.Builder
	b.WriteString(fmt.Sprintf("- **%s**：%d\n", t.summaryTotalFindings, len(in.Findings)))
	b.WriteString(fmt.Sprintf("- **%s**：%d\n", t.summaryTotalProbes, totalProbes))
	b.WriteString(fmt.Sprintf("- **%s**：%d / %d\n", t.summaryAttempts, totalFailures, totalAttempts))
	b.WriteString(fmt.Sprintf("- **%s**：%.2f%%\n\n", t.summaryPassRate, overallPassRate*100))

	// 严重度分布表
	b.WriteString(fmt.Sprintf("| %s | %s |\n", t.severityCol, t.countCol))
	b.WriteString("|---|---|\n")
	severityOrder := []engine.Severity{
		engine.SeverityCritical,
		engine.SeverityHigh,
		engine.SeverityMedium,
		engine.SeverityLow,
		engine.SeverityInfo,
	}
	for _, sev := range severityOrder {
		b.WriteString(fmt.Sprintf("| %s | %d |\n", severityDisplay(t, sev), bySeverity[sev]))
	}
	b.WriteString("\n")
	return b.String()
}

// renderFindingsSection 按严重度降序渲染所有 Findings
func renderFindingsSection(t reportI18n, findings []engine.Finding) string {
	sorted := make([]engine.Finding, len(findings))
	copy(sorted, findings)
	sort.SliceStable(sorted, func(i, j int) bool {
		return severityRank(sorted[i].Severity) < severityRank(sorted[j].Severity)
	})

	var b strings.Builder
	for i, f := range sorted {
		title := f.RiskTypeDisplay
		if title == "" {
			title = string(f.RiskType)
		}
		b.WriteString(fmt.Sprintf("### %d. [%s] %s\n\n", i+1, strings.ToUpper(string(f.Severity)), title))

		b.WriteString(fmt.Sprintf("- **%s**：`%s`\n", t.findingID, f.FindingID))
		if f.Asset != "" {
			b.WriteString(fmt.Sprintf("- **%s**：%s\n", t.findingAsset, f.Asset))
		}
		if f.GarakProbeID != "" {
			b.WriteString(fmt.Sprintf("- **%s**：`%s`\n", t.findingProbe, f.GarakProbeID))
		}
		if f.GarakDetectorName != "" {
			b.WriteString(fmt.Sprintf("- **%s**：`%s`\n", t.findingDetector, f.GarakDetectorName))
		}
		b.WriteString(fmt.Sprintf("- **%s**：%d / 100\n", t.findingConfidence, f.Confidence))
		b.WriteString(fmt.Sprintf("- **%s**：%s\n", t.findingSeverity, severityDisplay(t, f.Severity)))
		b.WriteString("\n")

		if f.EvidenceSummary != "" {
			b.WriteString("**" + t.evidenceSummary + "**\n\n")
			b.WriteString("> " + strings.ReplaceAll(f.EvidenceSummary, "\n", "\n> ") + "\n\n")
		}

		// 失败样本（来自 normalizer.buildEvidenceDetail，类型为 map[string]interface{}）
		examples := extractFailExamples(f.EvidenceDetail)
		if len(examples) > 0 {
			b.WriteString("**" + t.failExamples + "**\n\n")
			for j, ex := range examples {
				b.WriteString(fmt.Sprintf("- %s #%d\n", t.exampleLabel, j+1))
				if strings.TrimSpace(ex.Prompt) != "" {
					b.WriteString("    - " + t.examplePrompt + "：\n")
					b.WriteString("      ```\n")
					b.WriteString(indentLines(truncate(ex.Prompt, MaxExampleTextLen), "      "))
					b.WriteString("\n      ```\n")
				}
				if strings.TrimSpace(ex.Response) != "" {
					b.WriteString("    - " + t.exampleResponse + "：\n")
					b.WriteString("      ```\n")
					b.WriteString(indentLines(truncate(ex.Response, MaxExampleTextLen), "      "))
					b.WriteString("\n      ```\n")
				}
			}
			b.WriteString("\n")
		}

		if f.FixRecommendation != "" {
			b.WriteString("**" + t.fixRecommendation + "**\n\n")
			b.WriteString(f.FixRecommendation + "\n\n")
		}

		b.WriteString("---\n\n")
	}
	return b.String()
}

// renderProbeResultsSection 渲染所有探针的执行结果表
func renderProbeResultsSection(t reportI18n, output *AdapterOutput) string {
	if output == nil || len(output.ProbeResults) == 0 {
		return "> " + t.noProbeResults + "\n\n"
	}

	probes := make([]ProbeResult, len(output.ProbeResults))
	copy(probes, output.ProbeResults)
	sort.SliceStable(probes, func(i, j int) bool {
		return probes[i].PassRate < probes[j].PassRate
	})

	var b strings.Builder
	b.WriteString(fmt.Sprintf("| %s | %s | %s | %s | %s |\n",
		t.probeIDCol, t.probeDetectorCol, t.probeAttemptsCol, t.probeFailuresCol, t.probePassRateCol))
	b.WriteString("|---|---|---|---|---|\n")
	for _, pr := range probes {
		b.WriteString(fmt.Sprintf("| `%s` | `%s` | %d | %d | %.2f%% |\n",
			escapeMarkdownCell(pr.ProbeID),
			escapeMarkdownCell(pr.DetectorName),
			pr.TotalAttempts, pr.Failures, pr.PassRate*100))
	}
	b.WriteString("\n")
	return b.String()
}

// extractFailExamples 从 Finding.EvidenceDetail 中提取失败样本。
// 容忍 nil / 类型不匹配等情况，返回空切片即可。
func extractFailExamples(detail interface{}) []ProbeExample {
	if detail == nil {
		return nil
	}
	m, ok := detail.(map[string]interface{})
	if !ok {
		return nil
	}
	raw, ok := m["fail_examples"]
	if !ok || raw == nil {
		return nil
	}

	// normalizer.buildEvidenceDetail 直接放入 []ProbeExample
	if examples, ok := raw.([]ProbeExample); ok {
		if len(examples) > MaxFailExamplesPerFinding {
			return examples[:MaxFailExamplesPerFinding]
		}
		return examples
	}

	// 兜底：如果上游做过 JSON round-trip 变成 []interface{}，做尽力解析。
	if list, ok := raw.([]interface{}); ok {
		var examples []ProbeExample
		for _, item := range list {
			if mm, ok := item.(map[string]interface{}); ok {
				ex := ProbeExample{
					Prompt:   stringField(mm, "prompt"),
					Response: stringField(mm, "response"),
				}
				if v, ok := mm["passed"].(bool); ok {
					ex.Passed = v
				}
				examples = append(examples, ex)
				if len(examples) >= MaxFailExamplesPerFinding {
					break
				}
			}
		}
		return examples
	}
	return nil
}

func stringField(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// severityRank 用于按严重度降序排序，数值越小越严重
func severityRank(s engine.Severity) int {
	switch s {
	case engine.SeverityCritical:
		return 0
	case engine.SeverityHigh:
		return 1
	case engine.SeverityMedium:
		return 2
	case engine.SeverityLow:
		return 3
	case engine.SeverityInfo:
		return 4
	default:
		return 5
	}
}

// truncate 在保留 UTF-8 完整性的前提下截断字符串
func truncate(s string, max int) string {
	if max <= 0 {
		return s
	}
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "..."
}

// indentLines 给字符串的每一行添加前缀（用于代码块对齐）
func indentLines(s, prefix string) string {
	if s == "" {
		return s
	}
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = prefix + line
	}
	return strings.Join(lines, "\n")
}

// escapeMarkdownCell 转义 Markdown 表格单元格中的特殊字符
func escapeMarkdownCell(s string) string {
	s = strings.ReplaceAll(s, "|", "\\|")
	s = strings.ReplaceAll(s, "\n", " ")
	return s
}

func fallback(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

// ------------------- i18n -------------------

type reportI18n struct {
	title           string
	metaCol         string
	valueCol        string
	metaScanID      string
	metaProvider    string
	metaModel       string
	metaIntensity   string
	metaStart       string
	metaEnd         string
	metaGarakVer    string
	metaAdapterVer  string
	summaryHeading       string
	summaryTotalFindings string
	summaryTotalProbes   string
	summaryAttempts      string
	summaryPassRate      string
	severityCol          string
	countCol             string
	severityCritical     string
	severityHigh         string
	severityMedium       string
	severityLow          string
	severityInfo         string
	findingsHeading      string
	noFindings           string
	findingID            string
	findingAsset         string
	findingProbe         string
	findingDetector      string
	findingConfidence    string
	findingSeverity      string
	evidenceSummary      string
	failExamples         string
	exampleLabel         string
	examplePrompt        string
	exampleResponse      string
	fixRecommendation    string
	probesHeading        string
	noProbeResults       string
	probeIDCol           string
	probeDetectorCol     string
	probeAttemptsCol     string
	probeFailuresCol     string
	probePassRateCol     string
	appendixHeading      string
	appendixBody         string
}

func reportTexts(lang string) reportI18n {
	if lang == "en" {
		return reportI18n{
			title:                "Garak LLM Security Scan — Detailed Report",
			metaCol:              "Item",
			valueCol:             "Value",
			metaScanID:           "Scan ID",
			metaProvider:         "Model Provider",
			metaModel:            "Model Name",
			metaIntensity:        "Intensity",
			metaStart:            "Start Time",
			metaEnd:              "End Time",
			metaGarakVer:         "Garak Version",
			metaAdapterVer:       "Adapter Version",
			summaryHeading:       "Executive Summary",
			summaryTotalFindings: "Total Findings",
			summaryTotalProbes:   "Total Probes",
			summaryAttempts:      "Failed Attempts / Total Attempts",
			summaryPassRate:      "Overall Pass Rate",
			severityCol:          "Severity",
			countCol:             "Count",
			severityCritical:     "Critical",
			severityHigh:         "High",
			severityMedium:       "Medium",
			severityLow:          "Low",
			severityInfo:         "Info",
			findingsHeading:      "Findings",
			noFindings:           "No risk finding was reported in this scan.",
			findingID:            "Finding ID",
			findingAsset:         "Asset",
			findingProbe:         "Probe",
			findingDetector:      "Detector",
			findingConfidence:    "Confidence",
			findingSeverity:      "Severity",
			evidenceSummary:      "Evidence Summary",
			failExamples:         "Failed Examples",
			exampleLabel:         "Example",
			examplePrompt:        "Prompt",
			exampleResponse:      "Response",
			fixRecommendation:    "Fix Recommendation",
			probesHeading:        "Probe Results",
			noProbeResults:       "No probe execution result was reported.",
			probeIDCol:           "Probe ID",
			probeDetectorCol:     "Detector",
			probeAttemptsCol:     "Attempts",
			probeFailuresCol:     "Failures",
			probePassRateCol:     "Pass Rate",
			appendixHeading:      "Notes",
			appendixBody: "- This report is auto-generated by AI-Infra-Guard.\n" +
				"- Failed examples are truncated to keep the report compact; see the raw JSON result for full payloads.\n" +
				"- API keys are never persisted in the report.",
		}
	}
	return reportI18n{
		title:                "Garak 大模型安全扫描 — 详细报告",
		metaCol:              "项目",
		valueCol:             "取值",
		metaScanID:           "扫描 ID",
		metaProvider:         "模型 Provider",
		metaModel:            "模型名称",
		metaIntensity:        "扫描强度",
		metaStart:            "开始时间",
		metaEnd:              "结束时间",
		metaGarakVer:         "Garak 版本",
		metaAdapterVer:       "Adapter 版本",
		summaryHeading:       "执行摘要",
		summaryTotalFindings: "风险问题总数",
		summaryTotalProbes:   "执行探针总数",
		summaryAttempts:      "失败尝试 / 总尝试",
		summaryPassRate:      "整体通过率",
		severityCol:          "严重度",
		countCol:             "数量",
		severityCritical:     "严重",
		severityHigh:         "高危",
		severityMedium:       "中危",
		severityLow:          "低危",
		severityInfo:         "提示",
		findingsHeading:      "风险问题详情",
		noFindings:           "本次扫描未发现风险问题。",
		findingID:            "Finding ID",
		findingAsset:         "目标资产",
		findingProbe:         "探针",
		findingDetector:      "检测器",
		findingConfidence:    "置信度",
		findingSeverity:      "严重度",
		evidenceSummary:      "证据摘要",
		failExamples:         "失败样本（已截断）",
		exampleLabel:         "样本",
		examplePrompt:        "Prompt",
		exampleResponse:      "Response",
		fixRecommendation:    "修复建议",
		probesHeading:        "探针执行结果",
		noProbeResults:       "未收到任何探针执行结果。",
		probeIDCol:           "探针 ID",
		probeDetectorCol:     "检测器",
		probeAttemptsCol:     "尝试次数",
		probeFailuresCol:     "失败次数",
		probePassRateCol:     "通过率",
		appendixHeading:      "附录",
		appendixBody: "- 本报告由 AI-Infra-Guard 自动生成。\n" +
			"- 失败样本在 Markdown 报告中已做截断，完整 payload 请查看原始 JSON 结果。\n" +
			"- API Key 等敏感凭证不会出现在报告中。",
	}
}

func severityDisplay(t reportI18n, sev engine.Severity) string {
	switch sev {
	case engine.SeverityCritical:
		return t.severityCritical
	case engine.SeverityHigh:
		return t.severityHigh
	case engine.SeverityMedium:
		return t.severityMedium
	case engine.SeverityLow:
		return t.severityLow
	case engine.SeverityInfo:
		return t.severityInfo
	default:
		return string(sev)
	}
}
