// Copyright (c) 2024-2026 Tencent Zhuque Lab. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

package database

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func newFindingStore(t *testing.T) (*FindingStore, func()) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "findings.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	require.NoError(t, err)

	fs := NewFindingStore(db)
	require.NoError(t, fs.Init())
	return fs, func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	}
}

func makeFinding(id, scanID, severity, riskType, asset string) Finding {
	return Finding{
		FindingID:       id,
		ScanID:          scanID,
		RiskType:        riskType,
		RiskTypeDisplay: riskType,
		Severity:        severity,
		Confidence:      80,
		Asset:           asset,
		EvidenceSummary: "test evidence",
		Status:          "open",
		SourceEngine:    "garak",
		GarakProbeID:    "dan.Dan_11_0",
	}
}

func TestFindingStore_Init(t *testing.T) {
	fs, cleanup := newFindingStore(t)
	defer cleanup()
	// 重复 Init 应该幂等
	assert.NoError(t, fs.Init())
}

func TestFindingStore_SaveAndList(t *testing.T) {
	fs, cleanup := newFindingStore(t)
	defer cleanup()

	findings := []Finding{
		makeFinding("f1", "scan-1", "high", "Jailbreak", "model-A"),
		makeFinding("f2", "scan-1", "critical", "PromptInjection", "model-A"),
		makeFinding("f3", "scan-2", "medium", "DataLeakage", "model-B"),
	}
	require.NoError(t, fs.SaveFindings(findings))

	got, err := fs.ListByScan("scan-1")
	require.NoError(t, err)
	require.Len(t, got, 2)
	// critical 排在 high 前
	assert.Equal(t, "critical", got[0].Severity)
	assert.Equal(t, "high", got[1].Severity)

	// 写入应填充 CreatedAt/UpdatedAt
	assert.NotZero(t, got[0].CreatedAt)
	assert.NotZero(t, got[0].UpdatedAt)
}

func TestFindingStore_SaveFindings_Empty(t *testing.T) {
	fs, cleanup := newFindingStore(t)
	defer cleanup()
	assert.NoError(t, fs.SaveFindings(nil))
	assert.NoError(t, fs.SaveFindings([]Finding{}))
}

func TestFindingStore_SaveFindings_Upsert(t *testing.T) {
	fs, cleanup := newFindingStore(t)
	defer cleanup()

	f := makeFinding("f-upsert", "scan-x", "high", "Jailbreak", "asset-x")
	require.NoError(t, fs.SaveFindings([]Finding{f}))

	// 同 ID 再写一次应该是 update 而不是新建
	f.Severity = "critical"
	require.NoError(t, fs.SaveFindings([]Finding{f}))

	got, err := fs.ListByScan("scan-x")
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, "critical", got[0].Severity)
}

func TestFindingStore_CountByScan(t *testing.T) {
	fs, cleanup := newFindingStore(t)
	defer cleanup()

	require.NoError(t, fs.SaveFindings([]Finding{
		makeFinding("a", "scan-c", "high", "Jailbreak", "x"),
		makeFinding("b", "scan-c", "high", "PromptInjection", "y"),
		makeFinding("c", "scan-c", "critical", "DataLeakage", "z"),
		makeFinding("d", "scan-other", "low", "DataLeakage", "z"),
	}))

	counts, err := fs.CountByScan("scan-c")
	require.NoError(t, err)
	assert.Equal(t, 1, counts["critical"])
	assert.Equal(t, 2, counts["high"])
	assert.Equal(t, 0, counts["low"])
}

func TestFindingStore_DeleteByScan(t *testing.T) {
	fs, cleanup := newFindingStore(t)
	defer cleanup()

	require.NoError(t, fs.SaveFindings([]Finding{
		makeFinding("a", "scan-del", "high", "Jailbreak", "x"),
		makeFinding("b", "scan-keep", "high", "Jailbreak", "y"),
	}))
	require.NoError(t, fs.DeleteByScan("scan-del"))
	got, err := fs.ListByScan("scan-del")
	require.NoError(t, err)
	assert.Empty(t, got)

	got, err = fs.ListByScan("scan-keep")
	require.NoError(t, err)
	require.Len(t, got, 1)
}

func TestFindingStore_PurgeOlderThan(t *testing.T) {
	fs, cleanup := newFindingStore(t)
	defer cleanup()

	old := makeFinding("old", "scan-o", "low", "Jailbreak", "z")
	old.CreatedAt = 1000
	fresh := makeFinding("fresh", "scan-f", "low", "Jailbreak", "z")
	fresh.CreatedAt = time.Now().UnixMilli()

	require.NoError(t, fs.SaveFindings([]Finding{old, fresh}))

	rows, err := fs.PurgeOlderThan(time.Now().UnixMilli() - 60_000)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, rows, int64(1))

	gotOld, err := fs.ListByScan("scan-o")
	require.NoError(t, err)
	assert.Empty(t, gotOld, "old 应当被清理")

	gotFresh, err := fs.ListByScan("scan-f")
	require.NoError(t, err)
	assert.Len(t, gotFresh, 1, "fresh 应保留")
}

func TestFindingStore_UpdateStatus(t *testing.T) {
	fs, cleanup := newFindingStore(t)
	defer cleanup()
	require.NoError(t, fs.SaveFindings([]Finding{
		makeFinding("f-upd", "scan-u", "high", "Jailbreak", "x"),
	}))

	require.NoError(t, fs.UpdateStatus("f-upd", "fixed"))
	got, err := fs.ListByScan("scan-u")
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, "fixed", got[0].Status)
}

func TestFindingStore_RetestBaselineCRUD(t *testing.T) {
	fs, cleanup := newFindingStore(t)
	defer cleanup()

	ids, _ := json.Marshal([]string{"f1", "f2"})
	require.NoError(t, fs.CreateBaseline(&RetestBaseline{
		BaselineID:     "b-1",
		OriginalScanID: "scan-orig",
		RetestScanID:   "scan-new",
		FindingIDs:     datatypes.JSON(ids),
	}))

	got, err := fs.ListBaselinesByOriginal("scan-orig", 10)
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, "b-1", got[0].BaselineID)
	assert.NotZero(t, got[0].CreatedAt)
}

func TestCompareFindings(t *testing.T) {
	baseline := []Finding{
		makeFinding("b1", "s1", "high", "Jailbreak", "model-A"),
		makeFinding("b2", "s1", "medium", "PromptInjection", "model-A"),
	}
	current := []Finding{
		// 同 RiskType + Asset + GarakProbeID 视为相同 → unfixed
		makeFinding("c1", "s2", "high", "Jailbreak", "model-A"),
		// 新出现的风险
		makeFinding("c2", "s2", "low", "DataLeakage", "model-A"),
	}
	res := CompareFindings("s1", "s2", baseline, current)

	assert.Equal(t, "s1", res.BaselineScanID)
	assert.Equal(t, "s2", res.NewScanID)
	assert.Equal(t, 2, res.BaselineTotal)
	assert.Equal(t, 2, res.NewTotal)

	// PromptInjection 在 current 中消失 → fixed
	require.Len(t, res.Fixed, 1)
	assert.Equal(t, "PromptInjection", res.Fixed[0].RiskType)

	// Jailbreak 仍存在 → unfixed
	require.Len(t, res.Unfixed, 1)
	assert.Equal(t, "Jailbreak", res.Unfixed[0].RiskType)

	// DataLeakage 是新增 → new_risks
	require.Len(t, res.NewRisks, 1)
	assert.Equal(t, "DataLeakage", res.NewRisks[0].RiskType)
}

func TestCompareFindings_AllFixed(t *testing.T) {
	baseline := []Finding{
		makeFinding("b1", "s1", "high", "Jailbreak", "model-A"),
	}
	res := CompareFindings("s1", "s2", baseline, nil)
	assert.Len(t, res.Fixed, 1)
	assert.Empty(t, res.Unfixed)
	assert.Empty(t, res.NewRisks)
}

func TestCompareFindings_AllNew(t *testing.T) {
	current := []Finding{
		makeFinding("c1", "s2", "high", "Jailbreak", "model-A"),
	}
	res := CompareFindings("s1", "s2", nil, current)
	assert.Empty(t, res.Fixed)
	assert.Empty(t, res.Unfixed)
	assert.Len(t, res.NewRisks, 1)
}

func TestFindingFromMap(t *testing.T) {
	m := map[string]interface{}{
		"finding_id":         "f-from-map",
		"risk_type":          "Jailbreak",
		"risk_type_display":  "越狱绕过",
		"severity":           "high",
		"confidence":         85,
		"asset":              "gpt-4o",
		"evidence_summary":   "DAN 越狱攻击成功",
		"evidence_detail":    map[string]interface{}{"fail_examples": []string{"q1", "q2"}},
		"fix_recommendation": "加强系统提示词",
		"status":             "open",
		"source_engine":      "garak",
		"garak_probe_id":     "dan.Dan_11_0",
		"raw_metadata":       map[string]interface{}{"pass_rate": 0.3},
	}
	f, err := FindingFromMap("scan-test", m)
	require.NoError(t, err)
	assert.Equal(t, "f-from-map", f.FindingID)
	assert.Equal(t, "scan-test", f.ScanID)
	assert.Equal(t, "Jailbreak", f.RiskType)
	assert.Equal(t, 85, f.Confidence)
	assert.NotEmpty(t, f.EvidenceDetail)
	assert.NotEmpty(t, f.RawMetadata)
}

func TestFindingStore_CompareScansFromDB(t *testing.T) {
	fs, cleanup := newFindingStore(t)
	defer cleanup()

	require.NoError(t, fs.SaveFindings([]Finding{
		makeFinding("b1", "scan-base", "high", "Jailbreak", "model-A"),
		makeFinding("b2", "scan-base", "medium", "DataLeakage", "model-A"),
	}))
	require.NoError(t, fs.SaveFindings([]Finding{
		makeFinding("c1", "scan-new", "high", "Jailbreak", "model-A"),
	}))

	res, err := fs.CompareScans("scan-base", "scan-new")
	require.NoError(t, err)
	assert.Len(t, res.Fixed, 1)
	assert.Len(t, res.Unfixed, 1)
	assert.Empty(t, res.NewRisks)
}
