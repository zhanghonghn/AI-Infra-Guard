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

package websocket

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/Tencent/AI-Infra-Guard/common/agent"
	"github.com/Tencent/AI-Infra-Guard/pkg/database"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"trpc.group/trpc-go/trpc-go/log"
)

// ============== Finding 查询 / 导出 / 复测 / 对比 HTTP API ==============
//
// 这一组接口对应 PRD §6 FR-3（Finding 存储与查询）/ FR-5（导出）/ FR-6（复测对比）。
// 所有接口都挂在 /api/v1/app/findings、/api/v1/app/scans 路径下，
// 复用 setupIdentityMiddleware 完成 username 注入。

// HandleListFindings godoc
//
//	@Summary	列出某次扫描的全部 Finding
//	@Tags		Findings
//	@Param		scanId	path	string	true	"扫描会话 ID"
//	@Success	200		{object}	map[string]interface{}
//	@Router		/api/v1/app/findings/{scanId} [get]
func HandleListFindings(c *gin.Context, tm *TaskManager) {
	scanID := c.Param("scanId")
	if scanID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "scanId 不能为空"})
		return
	}
	fs := tm.GetFindingStore()
	if fs == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "FindingStore 未初始化"})
		return
	}
	findings, err := fs.ListByScan(scanID)
	if err != nil {
		log.Errorf("查询 findings 失败: scanId=%s, error=%v", scanID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	counts, err := fs.CountByScan(scanID)
	if err != nil {
		log.Errorf("统计 findings 严重度失败: scanId=%s, error=%v", scanID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"scan_id":     scanID,
		"total":       len(findings),
		"by_severity": counts,
		"findings":    findings,
	})
}

// HandleExportFindings godoc
//
//	@Summary	以 JSON 文件形式导出某次扫描的 Finding 完整内容（FR-5）
//	@Tags		Findings
//	@Param		scanId	path	string	true	"扫描会话 ID"
//	@Success	200		{file}	string	"application/json"
//	@Router		/api/v1/app/findings/{scanId}/export [get]
func HandleExportFindings(c *gin.Context, tm *TaskManager) {
	scanID := c.Param("scanId")
	if scanID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "scanId 不能为空"})
		return
	}
	fs := tm.GetFindingStore()
	if fs == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "FindingStore 未初始化"})
		return
	}
	findings, err := fs.ListByScan(scanID)
	if err != nil {
		log.Errorf("导出 findings 失败: scanId=%s, error=%v", scanID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	counts, err := fs.CountByScan(scanID)
	if err != nil {
		log.Errorf("统计 findings 严重度失败: scanId=%s, error=%v", scanID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	report := gin.H{
		"scan_id":      scanID,
		"exported_at":  time.Now().Format(time.RFC3339),
		"total":        len(findings),
		"by_severity":  counts,
		"findings":     findings,
		"report_kind":  "garak_findings_export_v1",
	}
	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	filename := fmt.Sprintf("findings-%s-%s.json", sanitizeFilenamePart(scanID), time.Now().Format("20060102-150405"))
	c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
	c.Data(http.StatusOK, "application/json; charset=utf-8", body)
}

// sanitizeFilenamePart 将一个用户提供的字符串转换为安全的文件名片段：
// 仅保留 [A-Za-z0-9_-]，其他字符替换成 '_'。用于防止 Content-Disposition 头注入
// 与导出文件名中的目录穿越。
func sanitizeFilenamePart(s string) string {
	if s == "" {
		return "scan"
	}
	const max = 64
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s) && len(out) < max; i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z',
			c >= 'A' && c <= 'Z',
			c >= '0' && c <= '9',
			c == '-' || c == '_':
			out = append(out, c)
		default:
			out = append(out, '_')
		}
	}
	if len(out) == 0 {
		return "scan"
	}
	return string(out)
}

// UpdateFindingStatusRequest 更新 Finding 处理状态请求体
type UpdateFindingStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

// HandleUpdateFindingStatus godoc
//
//	@Summary	更新某个 Finding 的处理状态（FR-7：标记已修复 / 接受风险）
//	@Tags		Findings
//	@Param		findingId	path	string	true	"Finding ID"
//	@Param		body		body	UpdateFindingStatusRequest	true	"新状态"
//	@Router		/api/v1/app/findings/status/{findingId} [put]
func HandleUpdateFindingStatus(c *gin.Context, tm *TaskManager) {
	findingID := c.Param("findingId")
	if findingID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "findingId 不能为空"})
		return
	}
	var req UpdateFindingStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !validFindingStatus(req.Status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status 必须是 open/fixed/ignored/false_positive 之一"})
		return
	}
	fs := tm.GetFindingStore()
	if fs == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "FindingStore 未初始化"})
		return
	}
	if err := fs.UpdateStatus(findingID, req.Status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"finding_id": findingID, "status": req.Status})
}

func validFindingStatus(s string) bool {
	switch s {
	case "open", "fixed", "ignored", "false_positive":
		return true
	}
	return false
}

// HandleCompareScans godoc
//
//	@Summary	对比两次扫描的 Finding 集合（FR-6）
//	@Description	返回 fixed/unfixed/new_risks 三分类。
//	@Tags		Findings
//	@Param		baseline	query	string	true	"基线扫描 ID"
//	@Param		new			query	string	true	"新扫描 ID"
//	@Router		/api/v1/app/scans/compare [get]
func HandleCompareScans(c *gin.Context, tm *TaskManager) {
	baselineID := c.Query("baseline")
	newID := c.Query("new")
	if baselineID == "" || newID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "需提供 baseline 与 new 两个 scan_id"})
		return
	}
	fs := tm.GetFindingStore()
	if fs == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "FindingStore 未初始化"})
		return
	}
	res, err := fs.CompareScans(baselineID, newID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// HandleListBaselines godoc
//
//	@Summary	列出某次扫描的最近 N 次复测基线（FR-6）
//	@Tags		Findings
//	@Param		scanId	path	string	true	"原始扫描 ID"
//	@Param		limit	query	int		false	"返回条目数（默认 10）"
//	@Router		/api/v1/app/scans/{scanId}/retest_history [get]
func HandleListBaselines(c *gin.Context, tm *TaskManager) {
	scanID := c.Param("scanId")
	if scanID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "scanId 不能为空"})
		return
	}
	limit := 10
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	fs := tm.GetFindingStore()
	if fs == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "FindingStore 未初始化"})
		return
	}
	bs, err := fs.ListBaselinesByOriginal(scanID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"scan_id": scanID, "baselines": bs})
}

// RetestRequest 复测请求体
type RetestRequest struct {
	// 可选：缩窄复测范围到指定 finding_ids
	FindingIDs []string `json:"finding_ids,omitempty"`
	// 可选：覆盖原任务的强度（fast/standard/deep）
	Intensity string `json:"intensity,omitempty"`
}

// HandleRetestScan godoc
//
//	@Summary	基于历史扫描发起复测（FR-6）
//	@Description	复制原任务的目标/凭证/策略，创建一个新的 Garak-Scan 任务，并写入 RetestBaseline 关联。
//	@Tags		Findings
//	@Param		scanId	path	string			true	"原始扫描 ID"
//	@Param		body	body	RetestRequest	false	"可选参数"
//	@Router		/api/v1/app/scans/{scanId}/retest [post]
func HandleRetestScan(c *gin.Context, tm *TaskManager) {
	originalScanID := c.Param("scanId")
	if originalScanID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "scanId 不能为空"})
		return
	}
	username := c.GetString("username")
	if username == "" {
		username = "public_user"
	}

	var req RetestRequest
	_ = c.ShouldBindJSON(&req) // body 可空

	// 1. 读取原会话
	session, err := tm.taskStore.GetSession(originalScanID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "原始任务不存在: " + err.Error()})
		return
	}
	if session.TaskType != agent.TaskTypeGarakScan {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅 Garak-Scan 类型支持复测"})
		return
	}

	// 2. 复制 params，按需覆盖 intensity
	params := map[string]interface{}{}
	if len(session.Params) > 0 {
		_ = json.Unmarshal(session.Params, &params)
	}
	if req.Intensity != "" {
		params["intensity"] = req.Intensity
	}

	// 3. 构造新任务请求
	newSessionID := uuid.NewString()
	newTaskReq := &TaskCreateRequest{
		ID:             uuid.NewString(),
		SessionID:      newSessionID,
		Username:       username,
		Task:           agent.TaskTypeGarakScan,
		Timestamp:      time.Now().UnixMilli(),
		Content:        fmt.Sprintf("复测自任务 %s", originalScanID),
		Params:         params,
		CountryIsoCode: session.CountryIsoCode,
	}

	// 4. 入库 + 派发
	if err := tm.AddTask(newTaskReq, "retest-"+originalScanID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建复测任务失败: " + err.Error()})
		return
	}

	// 5. 写复测基线关联
	if fs := tm.GetFindingStore(); fs != nil {
		idsBytes, _ := json.Marshal(req.FindingIDs)
		baseline := &database.RetestBaseline{
			BaselineID:     uuid.NewString(),
			OriginalScanID: originalScanID,
			RetestScanID:   newSessionID,
			FindingIDs:     idsBytes,
		}
		if err := fs.CreateBaseline(baseline); err != nil {
			log.Warnf("写入复测基线失败（任务已创建）: error=%v", err)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"original_scan_id": originalScanID,
		"retest_scan_id":   newSessionID,
		"status":           "created",
	})
}
