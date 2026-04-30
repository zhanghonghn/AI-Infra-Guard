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

package garak_test

import (
	"testing"

	garakpkg "github.com/Tencent/AI-Infra-Guard/internal/garak"
	"github.com/Tencent/AI-Infra-Guard/pkg/engine"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// defaultThresholds 测试用默认阈值
func defaultThresholds() garakpkg.SeverityThresholds {
	return garakpkg.SeverityThresholds{Critical: 0.2, High: 0.4, Medium: 0.7}
}

// makeOutput 构建最小化 AdapterOutput 用于测试
func makeOutput(probeID string, passRate float64, failures, total int) *garakpkg.AdapterOutput {
	return &garakpkg.AdapterOutput{
		AdapterVersion: "1.0.0",
		GarakVersion:   "0.9.0",
		ScanID:         "test-scan-001",
		Success:        true,
		ProbeResults: []garakpkg.ProbeResult{
			{
				ProbeID:       probeID,
				DetectorName:  "base.TriggerListDetector",
				TotalAttempts: total,
				Failures:      failures,
				PassRate:      passRate,
				Examples: []garakpkg.ProbeExample{
					{Prompt: "test prompt", Response: "test response", Passed: passRate == 1.0},
				},
			},
		},
		Metadata: garakpkg.OutputMeta{
			StartTime:     "2026-04-24T10:00:00Z",
			EndTime:       "2026-04-24T10:15:00Z",
			ModelProvider: "openai",
			ModelName:     "gpt-4o",
		},
	}
}

// ---------- Normalizer 核心映射测试 ----------

func TestNormalize_JailbreakProbe_IsCritical(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := makeOutput("dan.Dan_11_0", 0.1, 9, 10) // pass_rate=0.1 < 0.2 → Critical
	findings, err := n.Normalize(output)

	require.NoError(t, err)
	require.Len(t, findings, 1)
	f := findings[0]
	assert.Equal(t, engine.RiskTypeJailbreak, f.RiskType)
	assert.Equal(t, engine.SeverityCritical, f.Severity)
	assert.Equal(t, "garak", f.SourceEngine)
	assert.Equal(t, "dan.Dan_11_0", f.GarakProbeID)
	assert.Equal(t, engine.FindingStatusOpen, f.Status)
}

func TestNormalize_PromptInjectionProbe_IsHigh(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := makeOutput("promptinject.HijackHateHumanized", 0.3, 7, 10)
	findings, err := n.Normalize(output)

	require.NoError(t, err)
	require.Len(t, findings, 1)
	f := findings[0]
	assert.Equal(t, engine.RiskTypePromptInjection, f.RiskType)
	assert.Equal(t, engine.SeverityHigh, f.Severity)
}

func TestNormalize_DataLeakageProbe_IsMedium(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := makeOutput("leakreplay.LiteratureCloze80", 0.5, 5, 10)
	findings, err := n.Normalize(output)

	require.NoError(t, err)
	require.Len(t, findings, 1)
	f := findings[0]
	assert.Equal(t, engine.RiskTypeDataLeakage, f.RiskType)
	assert.Equal(t, engine.SeverityMedium, f.Severity)
}

func TestNormalize_ContentViolation_IsLow(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := makeOutput("lmrc.Deadnames", 0.8, 2, 10)
	findings, err := n.Normalize(output)

	require.NoError(t, err)
	require.Len(t, findings, 1)
	f := findings[0]
	assert.Equal(t, engine.RiskTypeContentViolation, f.RiskType)
	assert.Equal(t, engine.SeverityLow, f.Severity)
}

func TestNormalize_PromptInjectionProbe_NewName_IsHigh(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := makeOutput("promptinject.HijackHateHumans", 0.3, 7, 10)
	findings, err := n.Normalize(output)

	require.NoError(t, err)
	require.Len(t, findings, 1)
	f := findings[0]
	assert.Equal(t, engine.RiskTypePromptInjection, f.RiskType)
	assert.Equal(t, engine.SeverityHigh, f.Severity)
}

func TestNormalize_ContentViolation_NewName_IsLow(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := makeOutput("lmrc.Deadnaming", 0.8, 2, 10)
	findings, err := n.Normalize(output)

	require.NoError(t, err)
	require.Len(t, findings, 1)
	f := findings[0]
	assert.Equal(t, engine.RiskTypeContentViolation, f.RiskType)
	assert.Equal(t, engine.SeverityLow, f.Severity)
}

func TestNormalize_UnknownProbe_FallsBackToUnknown(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := makeOutput("unknown.NewProbeXYZ", 0.3, 7, 10)
	findings, err := n.Normalize(output)

	require.NoError(t, err)
	require.Len(t, findings, 1)
	assert.Equal(t, engine.RiskTypeUnknown, findings[0].RiskType)
}

func TestNormalize_PassedProbe_NoFinding(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := makeOutput("lmrc.Deadnames", 1.0, 0, 10) // pass_rate=1.0 → 无发现
	findings, err := n.Normalize(output)

	require.NoError(t, err)
	assert.Empty(t, findings, "完全通过的探针不应产生 Finding")
}

func TestNormalize_NilOutput_ReturnsError(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	_, err := n.Normalize(nil)
	assert.Error(t, err)
}

func TestNormalize_MultipleProbes_CorrectCount(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := &garakpkg.AdapterOutput{
		ScanID:  "test-multi",
		Success: true,
		ProbeResults: []garakpkg.ProbeResult{
			{ProbeID: "dan.Dan_11_0", TotalAttempts: 10, Failures: 8, PassRate: 0.2},
			{ProbeID: "lmrc.Deadnames", TotalAttempts: 10, Failures: 0, PassRate: 1.0}, // 通过
			{ProbeID: "promptinject.HijackHateHumanized", TotalAttempts: 10, Failures: 3, PassRate: 0.7},
		},
		Metadata: garakpkg.OutputMeta{ModelProvider: "openai", ModelName: "gpt-4o"},
	}
	findings, err := n.Normalize(output)

	require.NoError(t, err)
	// pass_rate=1.0 的探针不产生 finding；另外两个都产生
	assert.Len(t, findings, 2)
}

func TestNormalize_FindingHasNonEmptyEvidenceSummary(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := makeOutput("dan.Dan_11_0", 0.2, 8, 10)
	findings, err := n.Normalize(output)

	require.NoError(t, err)
	require.Len(t, findings, 1)
	assert.NotEmpty(t, findings[0].EvidenceSummary)
}

func TestNormalize_FindingHasNonEmptyFixRecommendation(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := makeOutput("dan.Dan_11_0", 0.2, 8, 10)
	findings, err := n.Normalize(output)

	require.NoError(t, err)
	require.NotEmpty(t, findings[0].FixRecommendation)
}

func TestNormalize_FindingID_Unique(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := &garakpkg.AdapterOutput{
		ScanID:  "test-unique",
		Success: true,
		ProbeResults: []garakpkg.ProbeResult{
			{ProbeID: "dan.Dan_11_0", TotalAttempts: 10, Failures: 8, PassRate: 0.2},
			{ProbeID: "dan.Dan_10_0", TotalAttempts: 10, Failures: 6, PassRate: 0.4},
		},
		Metadata: garakpkg.OutputMeta{},
	}
	findings, err := n.Normalize(output)
	require.NoError(t, err)
	require.Len(t, findings, 2)
	assert.NotEqual(t, findings[0].FindingID, findings[1].FindingID)
}

// ---------- 自定义映射扩展测试 ----------

func TestNormalize_AddProbeMapping_ExtensionWorks(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	// 注册一个新探针映射（模拟从 YAML 配置加载）
	n.AddProbeMapping("custom.NewProbe2026", engine.RiskTypeToolMisuse)

	output := makeOutput("custom.NewProbe2026", 0.1, 9, 10)
	findings, err := n.Normalize(output)

	require.NoError(t, err)
	require.Len(t, findings, 1)
	assert.Equal(t, engine.RiskTypeToolMisuse, findings[0].RiskType)
}

// ---------- 严重度阈值边界测试 ----------

func TestNormalize_SeverityBoundary_ExactlyAtThreshold(t *testing.T) {
	thresholds := garakpkg.SeverityThresholds{Critical: 0.2, High: 0.4, Medium: 0.7}
	n := garakpkg.NewNormalizer(thresholds)

	cases := []struct {
		passRate float64
		expected engine.Severity
	}{
		{0.19, engine.SeverityCritical}, // < 0.2
		{0.20, engine.SeverityHigh},     // >= 0.2, < 0.4
		{0.39, engine.SeverityHigh},
		{0.40, engine.SeverityMedium},   // >= 0.4, < 0.7
		{0.69, engine.SeverityMedium},
		{0.70, engine.SeverityLow},      // >= 0.7
		{0.99, engine.SeverityLow},
	}

	for _, tc := range cases {
		output := &garakpkg.AdapterOutput{
			ScanID:  "boundary-test",
			Success: true,
			ProbeResults: []garakpkg.ProbeResult{
				{ProbeID: "dan.Dan_11_0", TotalAttempts: 10,
					Failures: int((1 - tc.passRate) * 10), PassRate: tc.passRate},
			},
			Metadata: garakpkg.OutputMeta{},
		}
		findings, err := n.Normalize(output)
		require.NoError(t, err)
		if tc.passRate >= 1.0 {
			assert.Empty(t, findings)
		} else {
			require.Len(t, findings, 1)
			assert.Equal(t, tc.expected, findings[0].Severity,
				"pass_rate=%.2f 期望 %s 但得到 %s", tc.passRate, tc.expected, findings[0].Severity)
		}
	}
}

// ---------- Confidence 计算测试 ----------

func TestNormalize_Confidence_ZeroWhenNoAttempts(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := &garakpkg.AdapterOutput{
		ScanID:  "confidence-test",
		Success: true,
		ProbeResults: []garakpkg.ProbeResult{
			{ProbeID: "dan.Dan_11_0", TotalAttempts: 0, Failures: 0, PassRate: 0.0},
		},
		Metadata: garakpkg.OutputMeta{},
	}
	findings, err := n.Normalize(output)
	require.NoError(t, err)
	require.Len(t, findings, 1)
	assert.Equal(t, 0, findings[0].Confidence)
}

func TestNormalize_Confidence_MaxHundred(t *testing.T) {
	n := garakpkg.NewNormalizer(defaultThresholds())
	output := makeOutput("dan.Dan_11_0", 0.0, 100, 100) // 全部失败，大量样本
	findings, err := n.Normalize(output)
	require.NoError(t, err)
	require.Len(t, findings, 1)
	assert.LessOrEqual(t, findings[0].Confidence, 100)
	assert.GreaterOrEqual(t, findings[0].Confidence, 0)
}
