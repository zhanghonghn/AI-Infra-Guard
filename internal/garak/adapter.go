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
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/Tencent/AI-Infra-Guard/internal/gologger"
	"github.com/Tencent/AI-Infra-Guard/pkg/engine"
	"github.com/google/uuid"
)

// ------------------- GarakAdapter -------------------

// DefaultMaxConcurrency 默认最大并发 Garak 子进程数
const DefaultMaxConcurrency = 4

// GarakAdapter 实现 engine.ScanEngine 接口，通过启动
// garak-adapter/main.py 子进程与 Garak 引擎交互。
// 遵循 ADR-001：使用子进程而非 Python 库 import，
// 与现有 McpTask/PromptTask 模式保持一致。
type GarakAdapter struct {
	// PythonBin Python 解释器路径（默认 "python3"）
	PythonBin string
	// AdapterScript garak-adapter/main.py 绝对路径
	AdapterScript string
	// PolicyLoader 策略配置加载器
	PolicyLoader *PolicyLoader
	// Semaphore 控制最大并发 Garak 子进程数
	Semaphore chan struct{}

	mu   sync.RWMutex
	jobs map[string]*garakJob
}

type garakJob struct {
	jobID   string
	status  engine.JobStatus
	cancel  context.CancelFunc
	result  *engine.RawResult
	err     error
	done    chan struct{}
}

// NewGarakAdapter 创建 GarakAdapter
// maxConcurrent 为最大并发子进程数（建议 2-4）
func NewGarakAdapter(pythonBin, adapterScript, policyDir string, maxConcurrent int) *GarakAdapter {
	if maxConcurrent <= 0 {
		maxConcurrent = DefaultMaxConcurrency
	}
	return &GarakAdapter{
		PythonBin:     pythonBin,
		AdapterScript: adapterScript,
		PolicyLoader:  NewPolicyLoader(policyDir),
		Semaphore:     make(chan struct{}, maxConcurrent),
		jobs:          make(map[string]*garakJob),
	}
}

// Name 返回引擎标识符
func (a *GarakAdapter) Name() string {
	return "garak"
}

// Start 异步启动 Garak 扫描子进程，立即返回 jobID
func (a *GarakAdapter) Start(ctx context.Context, params engine.ScanParams) (string, error) {
	policy, err := a.PolicyLoader.Load(string(params.Intensity))
	if err != nil {
		return "", fmt.Errorf("加载策略失败: %w", err)
	}

	jobID := uuid.NewString()
	jobCtx, jobCancel := context.WithTimeout(ctx, time.Duration(policy.TimeoutMinutes)*time.Minute)

	job := &garakJob{
		jobID:  jobID,
		status: engine.JobStatusPending,
		cancel: jobCancel,
		done:   make(chan struct{}),
	}

	a.mu.Lock()
	a.jobs[jobID] = job
	a.mu.Unlock()

	go a.runJob(jobCtx, job, params, policy)
	return jobID, nil
}

// Status 查询任务状态
func (a *GarakAdapter) Status(jobID string) (engine.JobStatus, error) {
	a.mu.RLock()
	job, ok := a.jobs[jobID]
	a.mu.RUnlock()
	if !ok {
		return engine.JobStatusFailed, fmt.Errorf("job %s 不存在", jobID)
	}
	return job.status, nil
}

// Cancel 取消任务
func (a *GarakAdapter) Cancel(jobID string) error {
	a.mu.RLock()
	job, ok := a.jobs[jobID]
	a.mu.RUnlock()
	if !ok {
		return fmt.Errorf("job %s 不存在", jobID)
	}
	if job.cancel != nil {
		job.cancel()
	}
	return nil
}

// CollectResult 阻塞等待任务完成并返回结果
func (a *GarakAdapter) CollectResult(ctx context.Context, jobID string) (*engine.RawResult, error) {
	a.mu.RLock()
	job, ok := a.jobs[jobID]
	a.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("job %s 不存在", jobID)
	}

	select {
	case <-job.done:
		return job.result, job.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// runJob 在 goroutine 中执行 Garak 子进程
func (a *GarakAdapter) runJob(ctx context.Context, job *garakJob, params engine.ScanParams, policy *PolicyConfig) {
	defer close(job.done)
	defer job.cancel()

	// 获取并发信号量
	select {
	case a.Semaphore <- struct{}{}:
		defer func() { <-a.Semaphore }()
	case <-ctx.Done():
		a.setJobFailed(job, fmt.Errorf("等待信号量时上下文取消: %w", ctx.Err()))
		return
	}

	a.setJobStatus(job, engine.JobStatusRunning)

	probes := policy.SelectedProbes()
	if len(probes) == 0 {
		a.setJobFailed(job, fmt.Errorf("策略 [%s] 没有启用任何探针", policy.Name))
		return
	}

	// 构建命令行参数（凭证通过环境变量注入，不出现在 argv）
	argv := []string{
		a.AdapterScript,
		"--scan-id", params.ScanID,
		"--model-provider", params.ModelProvider,
		"--model-name", params.ModelName,
		"--probe-groups", strings.Join(probes, ","),
		"--output-format", "json",
	}
	if params.BaseURL != "" {
		argv = append(argv, "--base-url", params.BaseURL)
	}

	cmd := exec.CommandContext(ctx, a.PythonBin, argv...)

	// 凭证通过环境变量注入，进程退出后自动消失（ADR-001 安全要求）
	cmd.Env = append(os.Environ(), "GARAK_API_KEY="+params.APIKey)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		a.setJobFailed(job, fmt.Errorf("获取 stdout pipe 失败: %w", err))
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		a.setJobFailed(job, fmt.Errorf("获取 stderr pipe 失败: %w", err))
		return
	}

	if err := cmd.Start(); err != nil {
		a.setJobFailed(job, fmt.Errorf("启动 Garak 子进程失败: %w", err))
		return
	}

	// 并发读取 stdout 和 stderr
	var outputLines []string
	var mu sync.Mutex
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			mu.Lock()
			outputLines = append(outputLines, line)
			mu.Unlock()
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		stderrBytes, _ := io.ReadAll(stderr)
		if len(stderrBytes) > 0 {
			gologger.Warnf("[garak-adapter] stderr: %s", string(stderrBytes))
		}
	}()

	wg.Wait()
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			a.setJobFailed(job, fmt.Errorf("Garak 子进程被取消: %w", ctx.Err()))
		} else {
			a.setJobFailed(job, fmt.Errorf("Garak 子进程退出异常 (%v)", err))
		}
		return
	}

	// 从 stdout 中找到最后一个 JSON 对象行
	output, err := parseAdapterOutputFromLines(outputLines)
	if err != nil {
		a.setJobFailed(job, fmt.Errorf("解析适配器输出失败: %w", err))
		return
	}

	rawResult := &engine.RawResult{
		EngineType: "garak",
		ScanID:     params.ScanID,
		Success:    output.Success,
		Data:       output,
	}

	a.mu.Lock()
	job.status = engine.JobStatusCompleted
	job.result = rawResult
	a.mu.Unlock()
}

// parseAdapterOutputFromLines 从输出行中找到 JSON 输出并解析
func parseAdapterOutputFromLines(lines []string) (*AdapterOutput, error) {
	// 从最后一行往前找第一个合法 JSON 对象
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "{") {
			var output AdapterOutput
			if err := json.Unmarshal([]byte(line), &output); err == nil {
				return &output, nil
			}
		}
	}
	return nil, fmt.Errorf("在输出中未找到合法的 JSON 结果（共 %d 行输出）", len(lines))
}

func (a *GarakAdapter) setJobStatus(job *garakJob, status engine.JobStatus) {
	a.mu.Lock()
	job.status = status
	a.mu.Unlock()
}

func (a *GarakAdapter) setJobFailed(job *garakJob, err error) {
	a.mu.Lock()
	job.status = engine.JobStatusFailed
	job.err = err
	a.mu.Unlock()
	gologger.Errorf("[GarakAdapter] job %s 失败: %v", job.jobID, err)
}
