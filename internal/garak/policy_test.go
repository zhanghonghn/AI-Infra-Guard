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
	"os"
	"path/filepath"
	"testing"

	garakpkg "github.com/Tencent/AI-Infra-Guard/internal/garak"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// writeTempPolicy 在临时目录写入策略 YAML 文件，返回目录路径
func writeTempPolicy(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "fast.yaml"), []byte(content), 0644); err != nil {
		t.Fatalf("写入测试策略文件失败: %v", err)
	}
	return dir
}

const validFastYAML = `
name: fast
description: 测试用快速策略
intensity: fast
timeout_minutes: 20
max_concurrency: 4

probe_groups:
  - name: jailbreak
    probes:
      - "dan.Dan_11_0"
    enabled: true
  - name: content_safety
    probes:
      - "lmrc.Deadnames"
    enabled: false  # 已禁用

severity_thresholds:
  critical: 0.2
  high: 0.4
  medium: 0.7
`

const minimalYAML = `
name: minimal
intensity: fast
probe_groups:
  - name: jailbreak
    probes:
      - "dan.Dan_11_0"
    enabled: true
`

// ---------- 策略加载测试 ----------

func TestPolicyLoader_LoadFast_Success(t *testing.T) {
	dir := writeTempPolicy(t, validFastYAML)
	loader := garakpkg.NewPolicyLoader(dir)
	cfg, err := loader.Load("fast")

	require.NoError(t, err)
	assert.Equal(t, "fast", cfg.Name)
	assert.Equal(t, 20, cfg.TimeoutMinutes)
	assert.Equal(t, 4, cfg.MaxConcurrency)
	assert.Len(t, cfg.ProbeGroups, 2)
}

func TestPolicyLoader_LoadMissing_ReturnsError(t *testing.T) {
	loader := garakpkg.NewPolicyLoader(t.TempDir()) // 空目录
	_, err := loader.Load("fast")
	assert.Error(t, err)
}

func TestPolicyLoader_PathTraversal_ReturnsError(t *testing.T) {
	loader := garakpkg.NewPolicyLoader(t.TempDir())
	// 路径遍历攻击向量应被拒绝
	for _, malicious := range []string{"../etc/passwd", "../../secret", "fast/../evil", "fast\x00"} {
		_, err := loader.Load(malicious)
		assert.Errorf(t, err, "非法 intensity=%q 应返回错误", malicious)
	}
}

func TestPolicyLoader_LoadEmptyIntensity_DefaultsFast(t *testing.T) {
	dir := writeTempPolicy(t, validFastYAML)
	loader := garakpkg.NewPolicyLoader(dir)
	cfg, err := loader.Load("") // 空 intensity 应默认 fast
	require.NoError(t, err)
	assert.NotNil(t, cfg)
}

func TestPolicyLoader_DefaultThresholds_WhenNotSet(t *testing.T) {
	dir := writeTempPolicy(t, minimalYAML)
	loader := garakpkg.NewPolicyLoader(dir)
	cfg, err := loader.Load("fast")
	require.NoError(t, err)
	// 未设置阈值时应使用默认值
	assert.Equal(t, 0.2, cfg.SeverityThresholds.Critical)
	assert.Equal(t, 0.4, cfg.SeverityThresholds.High)
	assert.Equal(t, 0.7, cfg.SeverityThresholds.Medium)
}

func TestPolicyLoader_DefaultConcurrency_WhenZero(t *testing.T) {
	dir := writeTempPolicy(t, minimalYAML)
	loader := garakpkg.NewPolicyLoader(dir)
	cfg, err := loader.Load("fast")
	require.NoError(t, err)
	assert.Equal(t, 4, cfg.MaxConcurrency, "默认并发数应为 4")
}

// ---------- SelectedProbes 测试 ----------

func TestSelectedProbes_OnlyEnabledGroups(t *testing.T) {
	dir := writeTempPolicy(t, validFastYAML)
	loader := garakpkg.NewPolicyLoader(dir)
	cfg, err := loader.Load("fast")
	require.NoError(t, err)

	probes := cfg.SelectedProbes()
	// 只有 jailbreak 组启用（content_safety 禁用）
	assert.Equal(t, []string{"dan.Dan_11_0"}, probes)
}

func TestSelectedProbes_EmptyWhenAllDisabled(t *testing.T) {
	const allDisabledYAML = `
name: disabled
intensity: fast
probe_groups:
  - name: jailbreak
    probes:
      - "dan.Dan_11_0"
    enabled: false
`
	dir := writeTempPolicy(t, allDisabledYAML)
	loader := garakpkg.NewPolicyLoader(dir)
	cfg, err := loader.Load("fast")
	require.NoError(t, err)
	assert.Empty(t, cfg.SelectedProbes())
}

func TestSelectedProbes_MultipleEnabledGroups(t *testing.T) {
	const multiYAML = `
name: multi
intensity: standard
probe_groups:
  - name: jailbreak
    probes:
      - "dan.Dan_11_0"
      - "dan.Dan_10_0"
    enabled: true
  - name: injection
    probes:
      - "promptinject.HijackHateHumanized"
    enabled: true
  - name: disabled_group
    probes:
      - "lmrc.Deadnames"
    enabled: false
`
	dir := writeTempPolicy(t, multiYAML)
	loader := garakpkg.NewPolicyLoader(dir)
	cfg, err := loader.Load("fast") // 测试目录只有 fast.yaml
	require.NoError(t, err)

	probes := cfg.SelectedProbes()
	assert.Len(t, probes, 3)
	assert.Contains(t, probes, "dan.Dan_11_0")
	assert.Contains(t, probes, "dan.Dan_10_0")
	assert.Contains(t, probes, "promptinject.HijackHateHumanized")
	assert.NotContains(t, probes, "lmrc.Deadnames")
}

// ---------- 策略文件内容校验 ----------

func TestProductionPolicies_AllIntensitiesExist(t *testing.T) {
	// 找到项目根的 data/garak_policies 目录
	policyDir := findGarakPoliciesDir(t)
	if policyDir == "" {
		t.Skip("找不到 data/garak_policies 目录，跳过生产策略文件检查")
	}

	loader := garakpkg.NewPolicyLoader(policyDir)
	for _, intensity := range []string{"fast", "standard", "deep"} {
		cfg, err := loader.Load(intensity)
		require.NoErrorf(t, err, "加载 %s 策略失败", intensity)
		assert.NotEmptyf(t, cfg.SelectedProbes(), "%s 策略没有启用任何探针", intensity)
		assert.Positivef(t, cfg.TimeoutMinutes, "%s 策略超时时间应大于 0", intensity)
	}
}

// findGarakPoliciesDir 向上查找 data/garak_policies 目录
func findGarakPoliciesDir(t *testing.T) string {
	t.Helper()
	wd, _ := os.Getwd()
	dir := wd
	for i := 0; i < 10; i++ {
		candidate := filepath.Join(dir, "data", "garak_policies")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}
