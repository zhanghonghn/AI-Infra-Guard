// Copyright (c) 2024-2026 Tencent Zhuque Lab. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

package garak_test

import (
	"encoding/json"
	"testing"

	garakpkg "github.com/Tencent/AI-Infra-Guard/internal/garak"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Test_AdapterOutput_PreservesMetadataError 验证 garak-adapter 在失败路径下
// 写入 metadata.error 时，Go 侧能正确反序列化为 OutputMeta.Error 字段。
//
// 这是排查问题 2 ("扫描失败 - 进程异常退出: exit status 2") 的关键：旧代码
// 中 OutputMeta 没有 Error 字段，导致 adapter 输出的真实失败原因（如
// "Garak 未安装"）被 json 解码静默丢弃，用户只能看到无信息的退出码。
func Test_AdapterOutput_PreservesMetadataError(t *testing.T) {
	// 模拟 garak-adapter/main.py 在 RunnerError 路径下 print 的 JSON：
	// 包含 success=false、空 probe_results 与 metadata.error。
	raw := []byte(`{
		"adapter_version": "1.0.0",
		"garak_version": "unknown",
		"scan_id": "scan-abc",
		"success": false,
		"probe_results": [],
		"metadata": {
			"model_provider": "openai",
			"model_name": "gpt-4o",
			"error": "Garak 未安装，无法执行真实扫描。"
		}
	}`)

	var out garakpkg.AdapterOutput
	require.NoError(t, json.Unmarshal(raw, &out))

	assert.False(t, out.Success)
	assert.Equal(t, "Garak 未安装，无法执行真实扫描。", out.Metadata.Error,
		"metadata.error 必须被反序列化为 OutputMeta.Error，否则上游无法显示真实失败原因")
}

// Test_AdapterOutput_ErrorOmittedWhenEmpty 验证成功路径下不会输出空 error 字段
// （omitempty 行为），保证既有 fixture / 契约测试不受影响。
func Test_AdapterOutput_ErrorOmittedWhenEmpty(t *testing.T) {
	out := garakpkg.AdapterOutput{
		AdapterVersion: "1.0.0",
		GarakVersion:   "0.10.0",
		ScanID:         "scan-1",
		Success:        true,
		Metadata: garakpkg.OutputMeta{
			ModelProvider: "openai",
			ModelName:     "gpt-4o",
		},
	}
	data, err := json.Marshal(out)
	require.NoError(t, err)
	assert.NotContains(t, string(data), `"error"`,
		"成功路径下 OutputMeta.Error 必须 omitempty，避免污染既有契约 schema")
}
