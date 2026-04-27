// Copyright (c) 2024-2026 Tencent Zhuque Lab. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

package websocket

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/Tencent/AI-Infra-Guard/pkg/database"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTaskManagerWithFindings builds a TaskManager wired to a real FindingStore
// over a temporary SQLite DB. Used by the FR-3 / FR-6 API tests below.
func newTaskManagerWithFindings(t *testing.T) (*TaskManager, *database.FindingStore, func()) {
	t.Helper()
	f, err := os.CreateTemp("", "findings-api-*.db")
	require.NoError(t, err)
	dbPath := f.Name()
	f.Close()

	cfg := database.NewConfig(dbPath)
	db, err := database.InitDB(cfg)
	require.NoError(t, err)

	ts := database.NewTaskStore(db)
	require.NoError(t, ts.Init())
	ms := database.NewModelStore(db)
	require.NoError(t, ms.Init())
	fs := database.NewFindingStore(db)
	require.NoError(t, fs.Init())

	tm := NewTaskManager(NewAgentManager(), ts, ms, nil, NewSSEManager())
	tm.SetFindingStore(fs)

	cleanup := func() {
		if sqlDB, _ := db.DB(); sqlDB != nil {
			_ = sqlDB.Close()
		}
		os.Remove(dbPath)
	}
	return tm, fs, cleanup
}

func newFindingsRouter(tm *TaskManager) *gin.Engine {
	r := gin.New()
	r.GET("/api/v1/app/findings/:scanId", func(c *gin.Context) {
		HandleListFindings(c, tm)
	})
	r.GET("/api/v1/app/findings/:scanId/export", func(c *gin.Context) {
		HandleExportFindings(c, tm)
	})
	r.PUT("/api/v1/app/findings/status/:findingId", func(c *gin.Context) {
		HandleUpdateFindingStatus(c, tm)
	})
	r.GET("/api/v1/app/scans/compare", func(c *gin.Context) {
		HandleCompareScans(c, tm)
	})
	r.GET("/api/v1/app/scans/:scanId/retest_history", func(c *gin.Context) {
		HandleListBaselines(c, tm)
	})
	return r
}

func seedFindings(t *testing.T, fs *database.FindingStore) {
	t.Helper()
	require.NoError(t, fs.SaveFindings([]database.Finding{
		{
			FindingID: "f-1", ScanID: "scan-A",
			RiskType: "Jailbreak", RiskTypeDisplay: "越狱绕过",
			Severity: "high", Confidence: 80,
			Asset: "gpt-4o", Status: "open",
			SourceEngine: "garak", GarakProbeID: "dan.Dan_11_0",
		},
		{
			FindingID: "f-2", ScanID: "scan-A",
			RiskType: "DataLeakage", RiskTypeDisplay: "敏感数据泄露",
			Severity: "critical", Confidence: 90,
			Asset: "gpt-4o", Status: "open",
			SourceEngine: "garak", GarakProbeID: "leakreplay.X",
		},
		{
			FindingID: "f-3", ScanID: "scan-B",
			RiskType: "Jailbreak", RiskTypeDisplay: "越狱绕过",
			Severity: "high", Confidence: 80,
			Asset: "gpt-4o", Status: "open",
			SourceEngine: "garak", GarakProbeID: "dan.Dan_11_0",
		},
	}))
}

func TestHandleListFindings(t *testing.T) {
	tm, fs, cleanup := newTaskManagerWithFindings(t)
	defer cleanup()
	seedFindings(t, fs)

	r := newFindingsRouter(tm)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/app/findings/scan-A", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		ScanID     string                 `json:"scan_id"`
		Total      int                    `json:"total"`
		BySeverity map[string]int         `json:"by_severity"`
		Findings   []database.Finding     `json:"findings"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, "scan-A", resp.ScanID)
	assert.Equal(t, 2, resp.Total)
	assert.Len(t, resp.Findings, 2)
	assert.Equal(t, 1, resp.BySeverity["critical"])
	assert.Equal(t, 1, resp.BySeverity["high"])
	// 严重度排序：critical 优先
	assert.Equal(t, "critical", resp.Findings[0].Severity)
}

func TestHandleListFindings_Empty(t *testing.T) {
	tm, _, cleanup := newTaskManagerWithFindings(t)
	defer cleanup()
	r := newFindingsRouter(tm)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/app/findings/no-such-scan", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.EqualValues(t, 0, resp["total"])
}

func TestHandleListFindings_NoStore(t *testing.T) {
	tm, _, cleanup := newTaskManagerWithFindings(t)
	defer cleanup()
	tm.SetFindingStore(nil)
	r := newFindingsRouter(tm)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/app/findings/scan-A", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestHandleExportFindings(t *testing.T) {
	tm, fs, cleanup := newTaskManagerWithFindings(t)
	defer cleanup()
	seedFindings(t, fs)

	r := newFindingsRouter(tm)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/app/findings/scan-A/export", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Header().Get("Content-Type"), "application/json")
	assert.Contains(t, w.Header().Get("Content-Disposition"), "attachment")
	assert.Contains(t, w.Header().Get("Content-Disposition"), "findings-scan-A-")

	var doc map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &doc))
	assert.Equal(t, "scan-A", doc["scan_id"])
	assert.EqualValues(t, 2, doc["total"])
	assert.Equal(t, "garak_findings_export_v1", doc["report_kind"])
	assert.Contains(t, doc, "exported_at")
	assert.Contains(t, doc, "findings")
}

func TestHandleUpdateFindingStatus(t *testing.T) {
	tm, fs, cleanup := newTaskManagerWithFindings(t)
	defer cleanup()
	seedFindings(t, fs)

	r := newFindingsRouter(tm)
	body, _ := json.Marshal(UpdateFindingStatusRequest{Status: "fixed"})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/app/findings/status/f-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	got, err := fs.ListByScan("scan-A")
	require.NoError(t, err)
	for _, f := range got {
		if f.FindingID == "f-1" {
			assert.Equal(t, "fixed", f.Status)
		}
	}
}

func TestHandleUpdateFindingStatus_BadStatus(t *testing.T) {
	tm, fs, cleanup := newTaskManagerWithFindings(t)
	defer cleanup()
	seedFindings(t, fs)
	r := newFindingsRouter(tm)
	body, _ := json.Marshal(UpdateFindingStatusRequest{Status: "nonsense"})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/app/findings/status/f-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandleCompareScans(t *testing.T) {
	tm, fs, cleanup := newTaskManagerWithFindings(t)
	defer cleanup()
	seedFindings(t, fs)

	r := newFindingsRouter(tm)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/app/scans/compare?baseline=scan-A&new=scan-B", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	var res database.CompareResult
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &res))
	assert.Equal(t, "scan-A", res.BaselineScanID)
	assert.Equal(t, "scan-B", res.NewScanID)
	// scan-A 有 Jailbreak + DataLeakage；scan-B 只有 Jailbreak
	// → DataLeakage fixed, Jailbreak unfixed, no new
	assert.Len(t, res.Fixed, 1)
	assert.Len(t, res.Unfixed, 1)
	assert.Empty(t, res.NewRisks)
	assert.Equal(t, "DataLeakage", res.Fixed[0].RiskType)
}

func TestHandleCompareScans_MissingParam(t *testing.T) {
	tm, _, cleanup := newTaskManagerWithFindings(t)
	defer cleanup()
	r := newFindingsRouter(tm)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/app/scans/compare?baseline=foo", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandleListBaselines(t *testing.T) {
	tm, fs, cleanup := newTaskManagerWithFindings(t)
	defer cleanup()

	require.NoError(t, fs.CreateBaseline(&database.RetestBaseline{
		BaselineID:     "b-1",
		OriginalScanID: "scan-A",
		RetestScanID:   "scan-A2",
	}))

	r := newFindingsRouter(tm)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/app/scans/scan-A/retest_history", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	var resp struct {
		ScanID    string                       `json:"scan_id"`
		Baselines []database.RetestBaseline    `json:"baselines"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, "scan-A", resp.ScanID)
	require.Len(t, resp.Baselines, 1)
	assert.Equal(t, "b-1", resp.Baselines[0].BaselineID)
}

func TestValidFindingStatus(t *testing.T) {
	for _, ok := range []string{"open", "fixed", "ignored", "false_positive"} {
		assert.True(t, validFindingStatus(ok))
	}
	for _, bad := range []string{"", "deleted", "OPEN", "in_progress"} {
		assert.False(t, validFindingStatus(bad))
	}
}
