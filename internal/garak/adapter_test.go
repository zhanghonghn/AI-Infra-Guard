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
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	garakpkg "github.com/Tencent/AI-Infra-Guard/internal/garak"
	"github.com/Tencent/AI-Infra-Guard/pkg/engine"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------- 命令行参数构建测试（不启动真实进程）----------

func TestGarakAdapter_Name(t *testing.T) {
	adapter := garakpkg.NewGarakAdapter("python3", "/path/to/main.py", "/policies", 4)
	assert.Equal(t, "garak", adapter.Name())
}

func TestGarakAdapter_NewAdapter_DefaultConcurrency(t *testing.T) {
	// maxConcurrent=0 时应使用默认值 4，信号量应正常创建
	adapter := garakpkg.NewGarakAdapter("python3", "/path/to/main.py", "/policies", 0)
	assert.NotNil(t, adapter)
	// 验证信号量缓冲大小（通过 len/cap 检查）
	assert.NotNil(t, adapter.Semaphore)
	assert.Equal(t, garakpkg.DefaultMaxConcurrency, cap(adapter.Semaphore))
}

// ---------- parseAdapterOutputFromLines 测试（通过 mock subprocess 验证）----------

// mockAdapterScript 生成一个临时 Python 脚本，输出给定 JSON
func mockAdapterScript(t *testing.T, outputJSON string) (scriptPath string) {
	t.Helper()
	dir := t.TempDir()
	scriptPath = filepath.Join(dir, "mock_adapter.py")
	script := "import sys\nprint('" + outputJSON + "', flush=True)\n"
	if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
		t.Fatalf("创建 mock adapter 脚本失败: %v", err)
	}
	return scriptPath
}

// findPython 获取可用的 Python 解释器路径
func findPython(t *testing.T) string {
	t.Helper()
	for _, name := range []string{"python3", "python"} {
		if path, err := exec.LookPath(name); err == nil {
			return path
		}
	}
	t.Skip("Python 解释器不可用，跳过需要子进程的测试")
	return ""
}

func TestGarakAdapter_Start_WithMockPython(t *testing.T) {
	pythonBin := findPython(t)

	// 构建标准输出 JSON（mock garak-adapter 输出）
	sampleOutput := garakpkg.AdapterOutput{
		AdapterVersion: "1.0.0",
		GarakVersion:   "mock",
		ScanID:         "test-001",
		Success:        true,
		ProbeResults: []garakpkg.ProbeResult{
			{
				ProbeID:       "dan.Dan_11_0",
				DetectorName:  "base.TriggerListDetector",
				TotalAttempts: 10,
				Failures:      3,
				PassRate:      0.7,
			},
		},
		Metadata: garakpkg.OutputMeta{
			ModelProvider: "openai",
			ModelName:     "gpt-4o",
		},
	}
	outputJSON, _ := json.Marshal(sampleOutput)

	// 创建 mock Python 脚本
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "main.py")
	// 脚本输出 JSON 后退出（忽略所有命令行参数）
	scriptContent := "import sys\nprint('" + string(outputJSON) + "')\n"
	require.NoError(t, os.WriteFile(scriptPath, []byte(scriptContent), 0755))

	// 创建策略文件
	policyDir := writeTempPolicy(t, validFastYAML)

	adapter := garakpkg.NewGarakAdapter(pythonBin, scriptPath, policyDir, 2)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	params := engine.ScanParams{
		ScanID:        "test-001",
		ModelProvider: "openai",
		ModelName:     "gpt-4o",
		APIKey:        "sk-test",
		Intensity:     engine.IntensityFast,
	}

	jobID, err := adapter.Start(ctx, params)
	require.NoError(t, err)
	assert.NotEmpty(t, jobID)

	// 等待任务完成
	rawResult, err := adapter.CollectResult(ctx, jobID)
	require.NoError(t, err)
	assert.True(t, rawResult.Success)
	assert.Equal(t, "garak", rawResult.EngineType)

	// 验证内部数据
	outputData, ok := rawResult.Data.(*garakpkg.AdapterOutput)
	require.True(t, ok, "RawResult.Data 应为 *AdapterOutput 类型")
	assert.Len(t, outputData.ProbeResults, 1)
}

func TestGarakAdapter_Cancel_StopsJob(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 上进程取消行为不同，跳过此测试")
	}
	pythonBin := findPython(t)

	// 创建一个会阻塞很久的 Python 脚本（模拟长时间运行的 Garak）
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "slow_adapter.py")
	script := "import time\ntime.sleep(60)\nprint('{}')\n"
	require.NoError(t, os.WriteFile(scriptPath, []byte(script), 0755))

	policyDir := writeTempPolicy(t, validFastYAML)
	adapter := garakpkg.NewGarakAdapter(pythonBin, scriptPath, policyDir, 2)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	params := engine.ScanParams{
		ScanID:        "cancel-test-001",
		ModelProvider: "openai",
		ModelName:     "gpt-4o",
		Intensity:     engine.IntensityFast,
	}

	jobID, err := adapter.Start(ctx, params)
	require.NoError(t, err)

	// 等待任务进入 Running 状态
	time.Sleep(500 * time.Millisecond)

	// 取消任务
	assert.NoError(t, adapter.Cancel(jobID))

	// 应在短时间内感知到取消
	ctxShort, cancelShort := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelShort()
	_, collectErr := adapter.CollectResult(ctxShort, jobID)
	assert.Error(t, collectErr, "任务被取消后 CollectResult 应返回错误")
}

func TestGarakAdapter_Status_UnknownJob(t *testing.T) {
	adapter := garakpkg.NewGarakAdapter("python3", "/fake/main.py", "/policies", 2)
	_, err := adapter.Status("non-existent-job-id")
	assert.Error(t, err)
}

func TestGarakAdapter_Cancel_UnknownJob(t *testing.T) {
	adapter := garakpkg.NewGarakAdapter("python3", "/fake/main.py", "/policies", 2)
	err := adapter.Cancel("non-existent-job-id")
	assert.Error(t, err)
}

// ---------- 契约测试：解析 fixtures/sample_output.json ----------

func TestAdapter_ContractTest_ParseFixture(t *testing.T) {
	// 找到 fixture 文件
	fixturePath := findFixturePath(t)
	if fixturePath == "" {
		t.Skip("找不到 fixtures/sample_output.json，跳过契约测试")
	}

	data, err := os.ReadFile(fixturePath)
	require.NoError(t, err)

	var output garakpkg.AdapterOutput
	require.NoError(t, json.Unmarshal(data, &output), "fixture 应可解析为 AdapterOutput")

	// 验证契约字段
	assert.NotEmpty(t, output.AdapterVersion)
	assert.NotEmpty(t, output.GarakVersion)
	assert.NotEmpty(t, output.ScanID)
	assert.NotEmpty(t, output.Metadata.ModelProvider)

	// 验证每个 probe 结果
	for _, pr := range output.ProbeResults {
		assert.NotEmpty(t, pr.ProbeID)
		assert.GreaterOrEqual(t, pr.PassRate, 0.0)
		assert.LessOrEqual(t, pr.PassRate, 1.0)
		assert.GreaterOrEqual(t, pr.TotalAttempts, pr.Failures)
	}

	// 端到端：fixture 通过 Normalizer 后应产生合理数量的 Finding
	n := garakpkg.NewNormalizer(garakpkg.SeverityThresholds{Critical: 0.2, High: 0.4, Medium: 0.7})
	findings, err := n.Normalize(&output)
	require.NoError(t, err)
	assert.NotEmpty(t, findings, "fixture 中有失败探针，应至少产生 1 个 Finding")
}

func findFixturePath(t *testing.T) string {
	t.Helper()
	wd, _ := os.Getwd()
	dir := wd
	for i := 0; i < 10; i++ {
		candidate := filepath.Join(dir, "garak-adapter", "tests", "fixtures", "sample_output.json")
		if _, err := os.Stat(candidate); err == nil {
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
