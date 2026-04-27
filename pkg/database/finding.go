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

package database

import (
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// Finding 统一风险发现持久化表
//
// 表结构来自 docs/architecture/garak-integration-4plus1-design.md §9.1
// 字段对应 pkg/engine.Finding，但增加 CreatedAt/UpdatedAt 时间戳列
// 以支持数据保留策略（FR-3）与查询索引。
type Finding struct {
	FindingID         string         `gorm:"primaryKey;column:finding_id" json:"finding_id"`
	ScanID            string         `gorm:"column:scan_id;not null;index" json:"scan_id"`
	RiskType          string         `gorm:"column:risk_type;not null" json:"risk_type"`
	RiskTypeDisplay   string         `gorm:"column:risk_type_display" json:"risk_type_display"`
	Severity          string         `gorm:"column:severity;not null" json:"severity"`
	Confidence        int            `gorm:"column:confidence" json:"confidence"`
	Asset             string         `gorm:"column:asset" json:"asset,omitempty"`
	EvidenceSummary   string         `gorm:"column:evidence_summary" json:"evidence_summary"`
	EvidenceDetail    datatypes.JSON `gorm:"column:evidence_detail" json:"evidence_detail,omitempty"`
	FixRecommendation string         `gorm:"column:fix_recommendation" json:"fix_recommendation"`
	Status            string         `gorm:"column:status;not null;default:'open'" json:"status"`

	// 内部字段（L3 可见）
	SourceEngine      string         `gorm:"column:source_engine" json:"source_engine,omitempty"`
	GarakProbeID      string         `gorm:"column:garak_probe_id" json:"garak_probe_id,omitempty"`
	GarakDetectorName string         `gorm:"column:garak_detector_name" json:"garak_detector_name,omitempty"`
	RawMetadata       datatypes.JSON `gorm:"column:raw_metadata" json:"raw_metadata,omitempty"`

	CreatedAt int64 `gorm:"column:created_at;not null;index" json:"created_at"`
	UpdatedAt int64 `gorm:"column:updated_at;not null" json:"updated_at"`
}

// TableName 指定表名（避免 GORM 复数化变形）
func (Finding) TableName() string { return "findings" }

// RetestBaseline 复测基线表
//
// 当用户基于 OriginalScanID 触发复测时，记录新生成的 RetestScanID 与
// 关注的 FindingIDs 列表，供后续对比/审计使用。
type RetestBaseline struct {
	BaselineID     string         `gorm:"primaryKey;column:baseline_id" json:"baseline_id"`
	OriginalScanID string         `gorm:"column:original_scan_id;not null;index" json:"original_scan_id"`
	RetestScanID   string         `gorm:"column:retest_scan_id;not null;index" json:"retest_scan_id"`
	FindingIDs     datatypes.JSON `gorm:"column:finding_ids" json:"finding_ids"`
	CreatedAt      int64          `gorm:"column:created_at;not null" json:"created_at"`
}

// TableName 指定表名
func (RetestBaseline) TableName() string { return "retest_baselines" }

// ------------------- FindingStore -------------------

// FindingStore Finding 与 RetestBaseline 的存储层
type FindingStore struct {
	db *gorm.DB
}

// NewFindingStore 创建新的 FindingStore 实例
func NewFindingStore(db *gorm.DB) *FindingStore {
	return &FindingStore{db: db}
}

// Init 自动迁移 Finding/RetestBaseline 表结构并创建索引
func (s *FindingStore) Init() error {
	if err := s.db.AutoMigrate(&Finding{}, &RetestBaseline{}); err != nil {
		return fmt.Errorf("迁移 finding/retest 表失败: %w", err)
	}
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_findings_scan_severity ON findings(scan_id, severity)",
		"CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status)",
		"CREATE INDEX IF NOT EXISTS idx_retest_original ON retest_baselines(original_scan_id)",
	}
	for _, sql := range indexes {
		if err := s.db.Exec(sql).Error; err != nil {
			return fmt.Errorf("创建 finding 索引失败: %s, error: %v", sql, err)
		}
	}
	return nil
}

// SaveFindings 批量写入 Findings。已存在的 FindingID 会被更新（upsert）。
func (s *FindingStore) SaveFindings(findings []Finding) error {
	if len(findings) == 0 {
		return nil
	}
	now := time.Now().UnixMilli()
	for i := range findings {
		if findings[i].CreatedAt == 0 {
			findings[i].CreatedAt = now
		}
		findings[i].UpdatedAt = now
		if findings[i].Status == "" {
			findings[i].Status = "open"
		}
	}
	return s.db.Save(&findings).Error
}

// ListByScan 查询某次扫描的全部 Finding，按严重度优先排序
func (s *FindingStore) ListByScan(scanID string) ([]Finding, error) {
	var findings []Finding
	// SQLite 通过 CASE WHEN 实现严重度排序
	order := "CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, created_at"
	err := s.db.Where("scan_id = ?", scanID).Order(order).Find(&findings).Error
	return findings, err
}

// CountByScan 返回某次扫描下各严重度的 Finding 数量
func (s *FindingStore) CountByScan(scanID string) (map[string]int, error) {
	type row struct {
		Severity string
		Count    int
	}
	var rows []row
	err := s.db.Model(&Finding{}).
		Select("severity, count(*) as count").
		Where("scan_id = ?", scanID).
		Group("severity").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := map[string]int{
		"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0,
	}
	for _, r := range rows {
		out[r.Severity] = r.Count
	}
	return out, nil
}

// DeleteByScan 删除某次扫描下的所有 Finding（数据保留策略使用）
func (s *FindingStore) DeleteByScan(scanID string) error {
	return s.db.Where("scan_id = ?", scanID).Delete(&Finding{}).Error
}

// PurgeOlderThan 清理早于 cutoffMs（毫秒时间戳）的 Finding
// 返回被删除的行数。用于实现数据保留策略（FR-3：90 天）。
func (s *FindingStore) PurgeOlderThan(cutoffMs int64) (int64, error) {
	res := s.db.Where("created_at < ?", cutoffMs).Delete(&Finding{})
	return res.RowsAffected, res.Error
}

// UpdateStatus 更新某个 Finding 的处理状态（open/fixed/ignored/false_positive）
func (s *FindingStore) UpdateStatus(findingID, status string) error {
	return s.db.Model(&Finding{}).
		Where("finding_id = ?", findingID).
		Updates(map[string]interface{}{
			"status":     status,
			"updated_at": time.Now().UnixMilli(),
		}).Error
}

// ------------------- RetestBaseline -------------------

// CreateBaseline 创建复测基线记录
func (s *FindingStore) CreateBaseline(b *RetestBaseline) error {
	if b.CreatedAt == 0 {
		b.CreatedAt = time.Now().UnixMilli()
	}
	return s.db.Create(b).Error
}

// ListBaselinesByOriginal 列出某次原始扫描的所有复测基线（最近 N 次）
func (s *FindingStore) ListBaselinesByOriginal(scanID string, limit int) ([]RetestBaseline, error) {
	if limit <= 0 {
		limit = 10
	}
	var out []RetestBaseline
	err := s.db.Where("original_scan_id = ?", scanID).
		Order("created_at DESC").
		Limit(limit).
		Find(&out).Error
	return out, err
}

// ------------------- 比较算法 -------------------

// CompareResult 为前端 FR-6 对比页面返回的三分类结果
type CompareResult struct {
	BaselineScanID string    `json:"baseline_scan_id"`
	NewScanID      string    `json:"new_scan_id"`
	Fixed          []Finding `json:"fixed"`     // baseline 中存在但 new 中已消失
	Unfixed        []Finding `json:"unfixed"`   // 两次都存在的同类风险
	NewRisks       []Finding `json:"new_risks"` // baseline 中没有、new 中新增的
	BaselineTotal  int       `json:"baseline_total"`
	NewTotal       int       `json:"new_total"`
}

// CompareScans 对比两次扫描的 Finding 集合，按 (RiskType, Asset, GarakProbeID) 三元组判定相同。
//
// 业务定义（与 PRD §6 FR-6 对齐）：
//   - fixed：baseline 中存在的风险点，在 new 中不再出现
//   - unfixed：在 new 中仍然存在的风险点
//   - new_risks：baseline 中没有但 new 中出现的新风险
//
// 注意：本函数纯内存比较，不修改任何状态；调用方需保证两个 scanID 都存在。
func (s *FindingStore) CompareScans(baselineScanID, newScanID string) (*CompareResult, error) {
	baseline, err := s.ListByScan(baselineScanID)
	if err != nil {
		return nil, fmt.Errorf("查询基线 findings 失败: %w", err)
	}
	current, err := s.ListByScan(newScanID)
	if err != nil {
		return nil, fmt.Errorf("查询新一轮 findings 失败: %w", err)
	}
	return CompareFindings(baselineScanID, newScanID, baseline, current), nil
}

// CompareFindings 是 CompareScans 的纯函数版本，便于单元测试。
func CompareFindings(baselineScanID, newScanID string, baseline, current []Finding) *CompareResult {
	key := func(f Finding) string {
		return fmt.Sprintf("%s|%s|%s", f.RiskType, f.Asset, f.GarakProbeID)
	}

	baseMap := make(map[string]Finding, len(baseline))
	for _, f := range baseline {
		baseMap[key(f)] = f
	}
	curMap := make(map[string]Finding, len(current))
	for _, f := range current {
		curMap[key(f)] = f
	}

	out := &CompareResult{
		BaselineScanID: baselineScanID,
		NewScanID:      newScanID,
		BaselineTotal:  len(baseline),
		NewTotal:       len(current),
	}
	for k, f := range baseMap {
		if _, ok := curMap[k]; ok {
			out.Unfixed = append(out.Unfixed, f)
		} else {
			out.Fixed = append(out.Fixed, f)
		}
	}
	for k, f := range curMap {
		if _, ok := baseMap[k]; !ok {
			out.NewRisks = append(out.NewRisks, f)
		}
	}
	return out
}

// ------------------- 工具：与 engine.Finding 的转换 -------------------

// FindingFromMap 从前端/Agent 上报的任意 map 构造 DB Finding。
//
// 由于 Garak 任务结果通过 WebSocket 以 map[string]interface{} 形式上来，
// 这里需要在 task_manager 中调用本函数完成结构转换。
func FindingFromMap(scanID string, m map[string]interface{}) (Finding, error) {
	bytes, err := json.Marshal(m)
	if err != nil {
		return Finding{}, err
	}
	// 使用中间结构以便处理 evidence_detail/raw_metadata 这两个 interface{} 字段
	var raw struct {
		FindingID         string      `json:"finding_id"`
		RiskType          string      `json:"risk_type"`
		RiskTypeDisplay   string      `json:"risk_type_display"`
		Severity          string      `json:"severity"`
		Confidence        int         `json:"confidence"`
		Asset             string      `json:"asset"`
		EvidenceSummary   string      `json:"evidence_summary"`
		EvidenceDetail    interface{} `json:"evidence_detail"`
		FixRecommendation string      `json:"fix_recommendation"`
		Status            string      `json:"status"`
		SourceEngine      string      `json:"source_engine"`
		GarakProbeID      string      `json:"garak_probe_id"`
		GarakDetectorName string      `json:"garak_detector_name"`
		RawMetadata       interface{} `json:"raw_metadata"`
	}
	if err := json.Unmarshal(bytes, &raw); err != nil {
		return Finding{}, err
	}
	f := Finding{
		FindingID:         raw.FindingID,
		ScanID:            scanID,
		RiskType:          raw.RiskType,
		RiskTypeDisplay:   raw.RiskTypeDisplay,
		Severity:          raw.Severity,
		Confidence:        raw.Confidence,
		Asset:             raw.Asset,
		EvidenceSummary:   raw.EvidenceSummary,
		FixRecommendation: raw.FixRecommendation,
		Status:            raw.Status,
		SourceEngine:      raw.SourceEngine,
		GarakProbeID:      raw.GarakProbeID,
		GarakDetectorName: raw.GarakDetectorName,
	}
	if raw.EvidenceDetail != nil {
		if b, err := json.Marshal(raw.EvidenceDetail); err == nil {
			f.EvidenceDetail = datatypes.JSON(b)
		}
	}
	if raw.RawMetadata != nil {
		if b, err := json.Marshal(raw.RawMetadata); err == nil {
			f.RawMetadata = datatypes.JSON(b)
		}
	}
	return f, nil
}
