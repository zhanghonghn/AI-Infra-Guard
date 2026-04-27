// Copyright (c) 2024-2026 Tencent Zhuque Lab. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

package websocket

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Tencent/AI-Infra-Guard/pkg/database"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newRetentionTestStore(t *testing.T) (*database.FindingStore, func()) {
	t.Helper()
	dir := t.TempDir()
	cfg := database.NewConfig(filepath.Join(dir, "ret.db"))
	db, err := database.InitDB(cfg)
	require.NoError(t, err)
	fs := database.NewFindingStore(db)
	require.NoError(t, fs.Init())
	cleanup := func() {
		if sqlDB, _ := db.DB(); sqlDB != nil {
			_ = sqlDB.Close()
		}
	}
	return fs, cleanup
}

func TestRunFindingRetentionOnce(t *testing.T) {
	fs, cleanup := newRetentionTestStore(t)
	defer cleanup()

	// 写入 1 个老数据 + 1 个新数据
	old := database.Finding{
		FindingID: "old", ScanID: "s-old",
		RiskType: "Jailbreak", Severity: "high",
		CreatedAt: 1000, // 1970 年的时间戳
	}
	fresh := database.Finding{
		FindingID: "fresh", ScanID: "s-fresh",
		RiskType: "Jailbreak", Severity: "high",
		CreatedAt: time.Now().UnixMilli(),
	}
	require.NoError(t, fs.SaveFindings([]database.Finding{old, fresh}))

	// 保留 1 天
	rows, err := RunFindingRetentionOnce(fs, 1)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, rows, int64(1))

	// 老数据被清理，新数据保留
	got, err := fs.ListByScan("s-old")
	require.NoError(t, err)
	assert.Empty(t, got)
	got, err = fs.ListByScan("s-fresh")
	require.NoError(t, err)
	assert.Len(t, got, 1)
}

func TestRunFindingRetentionOnce_Disabled(t *testing.T) {
	fs, cleanup := newRetentionTestStore(t)
	defer cleanup()

	old := database.Finding{
		FindingID: "old2", ScanID: "s-old2",
		RiskType: "Jailbreak", Severity: "high",
		CreatedAt: 1000,
	}
	require.NoError(t, fs.SaveFindings([]database.Finding{old}))

	// retentionDays <= 0 时不清理
	rows, err := RunFindingRetentionOnce(fs, 0)
	require.NoError(t, err)
	assert.Zero(t, rows)
	rows, err = RunFindingRetentionOnce(fs, -7)
	require.NoError(t, err)
	assert.Zero(t, rows)

	rows, err = RunFindingRetentionOnce(nil, 30)
	require.NoError(t, err)
	assert.Zero(t, rows)
}

func TestLoadRetentionDays(t *testing.T) {
	t.Setenv(findingRetentionEnvVar, "")
	assert.Equal(t, defaultFindingRetentionDays, loadRetentionDays())

	t.Setenv(findingRetentionEnvVar, "30")
	assert.Equal(t, 30, loadRetentionDays())

	t.Setenv(findingRetentionEnvVar, "-1")
	assert.Equal(t, -1, loadRetentionDays())

	t.Setenv(findingRetentionEnvVar, "not-a-number")
	assert.Equal(t, defaultFindingRetentionDays, loadRetentionDays())

	// cleanup
	_ = os.Unsetenv(findingRetentionEnvVar)
}

func TestStartFindingRetentionJob_NilStore(t *testing.T) {
	// 不会 panic、不会 goroutine 泄漏（因为直接 return）
	StartFindingRetentionJob(nil)
}
