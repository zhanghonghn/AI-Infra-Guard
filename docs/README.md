# Docs 目录说明

本目录收录 AI-Infra-Guard 的产品与技术文档。

## 目录结构

```
docs/
├── product/                          # 产品需求文档（PRD）
│   └── garak-integration-prd.md     # Garak 能力无感集成 PRD（v1.0）
├── architecture/                     # 技术架构设计文档
│   └── garak-integration-4plus1-design.md  # Garak 集成 4+1 架构设计（v1.0）
├── architecture_evolution.md         # AIG 平台架构演进记录
├── api_data_update.md                # API 数据更新说明
├── swagger.yaml                      # OpenAPI 规范
└── swagger.json                      # OpenAPI 规范（JSON 格式）
```

## 文档速览

### Garak 集成系列（2026-04 新增）

| 文档 | 路径 | 适合读者 |
|---|---|---|
| Garak 集成 PRD | `product/garak-integration-prd.md` | 产品经理、研发负责人 |
| Garak 集成 4+1 架构设计 | `architecture/garak-integration-4plus1-design.md` | 技术架构师、后端/前端工程师 |

**关键内容索引**：
- 想了解**产品目标与用户场景** → PRD §3-4
- 想了解**功能需求与验收标准** → PRD §7, §16
- 想了解**架构分层与模块职责** → 架构设计 §4（逻辑视图）
- 想了解**代码文件布局与新增模块** → 架构设计 §5（开发视图）
- 想了解**运行时进程与状态机** → 架构设计 §6（进程视图）
- 想了解**部署拓扑与 Docker Compose** → 架构设计 §7（物理视图）
- 想了解**典型场景序列图** → 架构设计 §8（场景视图）
- 想了解**数据模型与安全合规** → 架构设计 §9-10
- 想了解**实现代码指导** → 架构设计 §12

### 平台架构历史

- `architecture_evolution.md`：记录 AIG 从 v0.1 到 v3.6.0+ 的架构演进

---

*如需贡献文档，请遵循已有文档的语言风格（中英双语按文件保持一致），并确保 YAML 规则变更通过 `go run cmd/yamlcheck/main.go` 验证。*
