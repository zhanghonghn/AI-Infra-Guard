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
	"os"
	"strconv"
	"time"

	"github.com/Tencent/AI-Infra-Guard/pkg/database"
	"trpc.group/trpc-go/trpc-go/log"
)

// 默认 Finding 保留期为 90 天（FR-3 / 第 9 章 §9.2 数据保留策略）。
//
// 通过环境变量 FINDING_RETENTION_DAYS 调整：
//   - 设置为 0 或 负数：禁用自动清理
//   - 设置为正整数 N：保留 N 天
const (
	defaultFindingRetentionDays = 90
	findingRetentionEnvVar      = "FINDING_RETENTION_DAYS"
	findingRetentionInterval    = 24 * time.Hour
)

// StartFindingRetentionJob 启动后台 goroutine，按日清理超出保留期的 Finding。
//
// 程序终止时本 goroutine 会随主进程退出，无须额外取消。
// 测试场景下应直接调用 RunFindingRetentionOnce 而不是本函数。
func StartFindingRetentionJob(fs *database.FindingStore) {
	if fs == nil {
		log.Warnf("FindingStore 未初始化，跳过保留策略调度")
		return
	}
	days := loadRetentionDays()
	if days <= 0 {
		log.Infof("Finding 保留策略已禁用（FINDING_RETENTION_DAYS=%d）", days)
		return
	}
	log.Infof("启用 Finding 保留策略：每 %s 清理早于 %d 天的数据", findingRetentionInterval, days)
	go func() {
		// 启动 1 分钟后执行首次清理，避免与启动期其他初始化竞争
		time.Sleep(time.Minute)
		for {
			if rows, err := RunFindingRetentionOnce(fs, days); err != nil {
				log.Errorf("Finding 保留策略执行失败: error=%v", err)
			} else if rows > 0 {
				log.Infof("Finding 保留策略已清理 %d 行（>%d 天）", rows, days)
			}
			time.Sleep(findingRetentionInterval)
		}
	}()
}

// RunFindingRetentionOnce 执行一次清理，返回被删除的行数。导出供单测使用。
func RunFindingRetentionOnce(fs *database.FindingStore, retentionDays int) (int64, error) {
	if fs == nil || retentionDays <= 0 {
		return 0, nil
	}
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour).UnixMilli()
	return fs.PurgeOlderThan(cutoff)
}

func loadRetentionDays() int {
	v := os.Getenv(findingRetentionEnvVar)
	if v == "" {
		return defaultFindingRetentionDays
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		log.Warnf("非法的 %s=%q，使用默认 %d", findingRetentionEnvVar, v, defaultFindingRetentionDays)
		return defaultFindingRetentionDays
	}
	return n
}
