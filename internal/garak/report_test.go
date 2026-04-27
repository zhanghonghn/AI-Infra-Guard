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

package garak

import (
	"strings"
	"testing"

	"github.com/Tencent/AI-Infra-Guard/pkg/engine"
)

func TestRenderMarkdownReport_NoFindings(t *testing.T) {
	out := &AdapterOutput{
		AdapterVersion: "1.0.0",
		GarakVersion:   "0.10.0",
		ScanID:         "scan-empty",
		Success:        true,
		Metadata: OutputMeta{
			ModelProvider: "openai",
			ModelName:     "gpt-4o",
			StartTime:     "2026-04-27T09:00:00Z",
			EndTime:       "2026-04-27T09:05:00Z",
		},
	}

	md := RenderMarkdownReport(ReportInputs{
		ScanID:    "scan-empty",
		Intensity: "fast",
		Output:    out,
		Findings:  nil,
		Language:  "zh",
	})

	if !strings.Contains(md, "Garak 大模型安全扫描") {
		t.Fatalf("expected zh title in report, got:\n%s", md)
	}
	if !strings.Contains(md, "本次扫描未发现风险问题") {
		t.Fatalf("expected empty-findings hint, got:\n%s", md)
	}
	if !strings.Contains(md, "scan-empty") {
		t.Fatalf("expected scan id in metadata table, got:\n%s", md)
	}
	if !strings.Contains(md, "未收到任何探针执行结果") {
		t.Fatalf("expected no-probe hint, got:\n%s", md)
	}
}

func TestRenderMarkdownReport_FullContent(t *testing.T) {
	out := &AdapterOutput{
		AdapterVersion: "1.0.0",
		GarakVersion:   "0.10.0",
		ScanID:         "scan-001",
		Success:        true,
		Metadata: OutputMeta{
			ModelProvider: "openai",
			ModelName:     "gpt-4o",
			StartTime:     "2026-04-27T09:00:00Z",
			EndTime:       "2026-04-27T09:30:00Z",
		},
		ProbeResults: []ProbeResult{
			{
				ProbeID:       "dan.Dan_11_0",
				DetectorName:  "mitigation.MitigationBypass",
				TotalAttempts: 10,
				Failures:      8,
				PassRate:      0.2,
				Examples: []ProbeExample{
					{Prompt: "ignore previous instructions ...", Response: "Sure, here is ...", Passed: false},
					{Prompt: "another prompt", Response: "another bad response", Passed: false},
				},
			},
			{
				ProbeID:       "lmrc.Deadnames",
				DetectorName:  "specialwords.Deadname",
				TotalAttempts: 5,
				Failures:      1,
				PassRate:      0.8,
			},
		},
	}

	findings := []engine.Finding{
		{
			FindingID:         "F-1",
			ScanID:            "scan-001",
			RiskType:          engine.RiskTypeJailbreak,
			RiskTypeDisplay:   "越狱绕过",
			Severity:          engine.SeverityCritical,
			Confidence:        90,
			Asset:             "gpt-4o @ openai",
			EvidenceSummary:   "探针 [dan.Dan_11_0] 触发越狱",
			FixRecommendation: "增强系统提示防护",
			GarakProbeID:      "dan.Dan_11_0",
			GarakDetectorName: "mitigation.MitigationBypass",
			EvidenceDetail: map[string]interface{}{
				"probe_id":      "dan.Dan_11_0",
				"detector_name": "mitigation.MitigationBypass",
				"fail_examples": []ProbeExample{
					{Prompt: "ignore previous", Response: "ok here you go", Passed: false},
				},
			},
		},
		{
			FindingID:         "F-2",
			ScanID:            "scan-001",
			RiskType:          engine.RiskTypeContentViolation,
			RiskTypeDisplay:   "内容安全违规",
			Severity:          engine.SeverityLow,
			Confidence:        40,
			EvidenceSummary:   "探针 [lmrc.Deadnames] 触发",
			FixRecommendation: "加强内容安全过滤器",
		},
	}

	md := RenderMarkdownReport(ReportInputs{
		ScanID:    "scan-001",
		Intensity: "standard",
		Output:    out,
		Findings:  findings,
		Language:  "zh",
	})

	for _, want := range []string{
		"# Garak 大模型安全扫描",
		"scan-001",
		"gpt-4o",
		"standard",
		"风险问题总数",
		"严重",
		"### 1. [CRITICAL] 越狱绕过", // 严重度排序：critical 在前
		"### 2. [LOW] 内容安全违规",
		"`dan.Dan_11_0`",
		"探针 [dan.Dan_11_0] 触发越狱",
		"增强系统提示防护",
		"探针执行结果",
		"`lmrc.Deadnames`",
		"失败样本（已截断）",
		"ignore previous",
	} {
		if !strings.Contains(md, want) {
			t.Errorf("expected report to contain %q, missing in output:\n%s", want, md)
		}
	}

	// 严重度顺序：critical 应当出现在 low 之前
	idxCritical := strings.Index(md, "### 1. [CRITICAL]")
	idxLow := strings.Index(md, "### 2. [LOW]")
	if idxCritical < 0 || idxLow < 0 || idxCritical > idxLow {
		t.Errorf("findings should be sorted by severity descending, got idxCritical=%d idxLow=%d", idxCritical, idxLow)
	}
}

func TestRenderMarkdownReport_English(t *testing.T) {
	md := RenderMarkdownReport(ReportInputs{
		ScanID:    "scan-en",
		Intensity: "fast",
		Output: &AdapterOutput{
			AdapterVersion: "1.0.0",
			GarakVersion:   "0.10.0",
			ScanID:         "scan-en",
			Metadata:       OutputMeta{ModelProvider: "openai", ModelName: "gpt-4o"},
		},
		Findings: nil,
		Language: "en",
	})
	if !strings.Contains(md, "Garak LLM Security Scan") {
		t.Fatalf("expected EN title, got:\n%s", md)
	}
	if !strings.Contains(md, "Executive Summary") {
		t.Fatalf("expected EN summary heading, got:\n%s", md)
	}
}

func TestRenderMarkdownReport_TruncatesLongExamples(t *testing.T) {
	longPrompt := strings.Repeat("A", MaxExampleTextLen+100)
	findings := []engine.Finding{
		{
			FindingID: "F-trunc",
			ScanID:    "scan-trunc",
			RiskType:  engine.RiskTypeJailbreak,
			Severity:  engine.SeverityHigh,
			EvidenceDetail: map[string]interface{}{
				"fail_examples": []ProbeExample{
					{Prompt: longPrompt, Response: "ok", Passed: false},
				},
			},
		},
	}
	md := RenderMarkdownReport(ReportInputs{
		ScanID:   "scan-trunc",
		Output:   &AdapterOutput{Metadata: OutputMeta{ModelProvider: "p", ModelName: "m"}},
		Findings: findings,
	})
	if !strings.Contains(md, "...") {
		t.Errorf("expected truncated marker '...' for long prompt, got:\n%s", md)
	}
	// 确认未泄露完整长 prompt
	if strings.Contains(md, longPrompt) {
		t.Errorf("expected long prompt to be truncated, but full text was rendered")
	}
}

func TestExtractFailExamples_JSONRoundTrip(t *testing.T) {
	// 模拟 JSON 反序列化后的形态：[]interface{}{ map[string]interface{}{...} }
	detail := map[string]interface{}{
		"fail_examples": []interface{}{
			map[string]interface{}{"prompt": "p1", "response": "r1", "passed": false},
			map[string]interface{}{"prompt": "p2", "response": "r2", "passed": false},
			map[string]interface{}{"prompt": "p3", "response": "r3", "passed": false},
			map[string]interface{}{"prompt": "p4", "response": "r4", "passed": false},
		},
	}
	got := extractFailExamples(detail)
	if len(got) != MaxFailExamplesPerFinding {
		t.Fatalf("expected truncation to %d examples, got %d", MaxFailExamplesPerFinding, len(got))
	}
	if got[0].Prompt != "p1" || got[0].Response != "r1" {
		t.Fatalf("unexpected first example: %+v", got[0])
	}
}

func TestExtractFailExamples_NilSafe(t *testing.T) {
	if extractFailExamples(nil) != nil {
		t.Error("expected nil for nil detail")
	}
	if extractFailExamples("not a map") != nil {
		t.Error("expected nil for non-map detail")
	}
	if extractFailExamples(map[string]interface{}{}) != nil {
		t.Error("expected nil when fail_examples is missing")
	}
}
