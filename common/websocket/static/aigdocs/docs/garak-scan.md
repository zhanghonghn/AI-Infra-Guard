# Garak LLM 安全扫描

A.I.G 集成了 [Garak](https://github.com/NVIDIA/garak) LLM 漏洞评测框架，通过**策略驱动、多探针编排**的方式对大模型 API 进行深度红队评测。用户只需配置目标模型和扫描强度，系统自动编排探针组合并生成统一风险报告。

## 检测覆盖的风险维度

<table>
<tr>
<th>风险维度</th>
<th>风险说明</th>
<th>典型探针</th>
</tr>
<tr>
<td>越狱（Jailbreak）</td>
<td>尝试绕过模型安全限制，诱导模型输出有害内容或执行禁止的操作。</td>
<td>dan.Dan_11_0、dan.DAN_Jailbreak 等</td>
</tr>
<tr>
<td>提示注入（Prompt Injection）</td>
<td>通过构造特殊输入劫持模型指令，使其执行攻击者意图而非用户原始意图。</td>
<td>promptinject.HijackHateHumans 等</td>
</tr>
<tr>
<td>数据泄露（Data Leakage）</td>
<td>诱导模型泄露训练数据、系统提示或用户隐私信息。</td>
<td>leakreplay.LiteratureSingle 等</td>
</tr>
<tr>
<td>内容违规（Content Violation）</td>
<td>测试模型是否会生成违法、歧视性或危害社会的内容。</td>
<td>lmrc.Deadnames、lmrc.SexualContent 等</td>
</tr>
</table>

## 扫描强度配置

| 强度 | 代码 | 预计耗时 | 适用场景 |
|------|------|----------|---------|
| 快速 | `fast` | 约 15 分钟 | 日常 CI/CD 集成、快速冒烟评测 |
| 标准 | `standard` | 约 45 分钟 | 版本迭代前的常规安全评测 |
| 深度 | `deep` | 约 90 分钟 | 正式发布前的完整红队评测 |

## 使用方式

### 方式一：通过界面操作

1. 点击界面顶部 **@Garak安全扫描** 服务卡片
2. 选择或配置目标大模型 API（填写 Provider、Model 名称和 API Key）
3. 选择扫描强度
4. 点击**提交**，实时查看扫描进度和探针执行日志

### 方式二：通过 API 调用

```python
import requests

def garak_scan():
    task_url = "http://localhost:8088/api/v1/app/taskapi/tasks"
    task_data = {
        "type": "garak_scan",
        "content": {
            "provider": "openai",
            "model": "gpt-4o",
            "api_key": "sk-your-api-key",
            "base_url": "https://api.openai.com/v1",
            "intensity": "fast"
        }
    }
    response = requests.post(task_url, json=task_data)
    return response.json()

result = garak_scan()
print(f"任务创建成功，会话ID: {result['data']['session_id']}")
```

### cURL 示例

```bash
curl -X POST http://localhost:8088/api/v1/app/taskapi/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "garak_scan",
    "content": {
      "provider": "openai",
      "model": "gpt-4o",
      "api_key": "sk-your-api-key",
      "intensity": "standard"
    }
  }'
```

## 支持的 LLM Provider

| Provider | 说明 | 示例 model 名称 |
|----------|------|----------------|
| `openai` | OpenAI API（含兼容接口） | `gpt-4o`、`gpt-3.5-turbo` |
| `huggingface` | Hugging Face Inference API | `meta-llama/Meta-Llama-3-8B-Instruct` |

> 使用兼容 OpenAI 接口的私有部署（如 vLLM、Ollama）时，将 `provider` 设为 `openai` 并提供 `base_url` 指向本地端点。

## 结果报告说明

扫描完成后，报告包含以下核心字段：

| 字段 | 说明 |
|------|------|
| **findings** | 发现的安全问题列表（含 risk_type、severity、evidence_summary、fix_recommendation） |
| **summary.total_findings** | 发现问题总数 |
| **summary.pass_rate** | 探针通过率（0.0 – 1.0，越高越安全） |
| **summary.severity_counts** | 按 critical / high / medium / low 统计的问题数量 |
| **metadata.scan_duration_seconds** | 本次扫描耗时（秒） |
| **metadata.total_probes** | 执行的探针总数 |
| **report_markdown** | 详细报告的 Markdown 全文（前端可直接渲染，无需额外下载） |
| **report_filename** | 详细报告的建议文件名，例如 `garak-report-<scan_id>.md` |
| **report_url** | 详细报告在服务端的访问地址（已上传时返回，前缀为 `/api/v1/images/`） |
| **report_local_path** | 详细报告在 Agent 节点上的本地临时路径（仅供排查用） |
| **attachment** | 与 `report_url` 对应的服务端 fileUrl，遵循其他任务的附件字段约定 |

### 详细 Markdown 报告内容

`report_markdown` 字段固定包含以下章节，按 `language` 自动切换中英文：

1. **顶部元信息表**：扫描 ID / 模型 Provider / 模型名称 / 扫描强度 / 起止时间 / Garak & Adapter 版本
2. **执行摘要**：风险问题总数、执行探针总数、失败尝试 / 总尝试、整体通过率，以及按严重度分布的统计表
3. **风险问题详情**：按严重度从高到低排序，每条 Finding 含证据摘要、置信度、关联探针 / 检测器、最多 3 条失败样本（prompt / response 各截断到 ≤ 800 字符）、修复建议
4. **探针执行结果表**：按通过率升序展示所有探针，便于快速定位高风险探针
5. **附录**：报告生成说明与脱敏提示（API Key 等敏感凭证不会出现在报告中）

> 报告同时以 inline 字段（`report_markdown`）和上传文件（`report_url` / `attachment`）两种形式返回。
> Server 不可达或上传失败时只返回 inline 字段，不会阻塞主结果，并在 Agent 日志中给出警告。


## 前提条件

1. **Python 环境**：Agent 节点需安装 Python 3.10+
2. **Garak 安装**：在 Agent 节点执行 `pip install garak`（必装；缺失时扫描会立即失败而非降级）
3. **网络连通**：Agent 节点需能访问目标 LLM API 端点

> Mock 模式仅供 CI 烟测使用，**默认禁用**。如需在无 Garak 环境下做接口联调，可在 Agent 端设置环境变量 `GARAK_MOCK=1`，或调用 adapter 时显式追加 `--mock`。生产环境严禁开启。

## 常见问题

**Q: 扫描时间超过预期，如何处理？**

A: 建议先使用 `fast` 强度进行初步评测，确认流程通畅后再升级到 `standard` 或 `deep`。也可在策略配置（`data/garak_policies/`）中调整探针组开关来缩短扫描时间。

**Q: 如何添加自定义探针？**

A: 修改 `data/garak_policies/` 目录下对应强度的 YAML 文件，在 `probe_groups` 中启用或禁用特定探针组。系统支持所有 Garak 原生探针。

**Q: API Key 会被记录到日志吗？**

A: 不会。API Key 通过环境变量（`GARAK_API_KEY`）注入子进程，不会出现在命令行参数或平台日志中。

## 故障排查（Troubleshooting）

### 1. 「初始化扫描环境」一直显示「准备中」

- **现象**：任务整体已结束，但前端步骤 1「初始化 Garak 扫描环境」仍停留在「准备中」状态。
- **原因**：旧版 Agent 在切换到步骤 2/3 时未显式回调步骤 1 的完成事件，前端永远收不到 `completed` 状态。
- **修复**：升级到包含「步骤状态收敛」修复的版本即可（A.I.G v0.x 起）。Agent 现在会在每个步骤推进时显式发送 `AgentStatusCompleted`。
- **自检**：若仍出现该现象，请检查 Agent 日志中是否有 `初始化 Garak 扫描环境` 对应的 `statusUpdate` 消息，并确认 Agent 与服务端版本一致。

### 2. 提示「扫描失败 - 进程异常退出: exit status 2」

`exit status 2` 来自 `garak-adapter` 子进程，按约定表示「完全失败」。常见根因与处置如下：

| 真实原因 | 典型表现 / 排查方式 | 处置建议 |
|----------|--------------------|---------|
| Agent 节点未安装 garak | `pip show garak` 不存在；Agent 日志包含 `Garak 未安装` | 在 Agent 节点执行 `pip install garak` |
| Python 版本过低 | `python --version` < 3.10 | 升级到 Python 3.10+ |
| 模型端点不可达 | 自定义部署 / Ollama / vLLM 未配置 `base_url` | 在请求 `content` 中追加正确的 `base_url`（见下） |
| API Key 无效 / 额度耗尽 | 上游模型返回 401/429 | 更新有效 Key 或释放额度 |
| 探针组与目标模型不兼容 | `data/garak_policies/` 中启用了不支持的探针 | 缩减探针组或切换 `intensity` 到 `fast` |

> 自 A.I.G 修复版本起，前端「扫描失败」的 desc 字段会优先展示 adapter 输出的 `metadata.error`（例如 `Garak 未安装，无法执行真实扫描`），而非仅显示 `exit status 2`。如仍只看到退出码，请确认 Agent / adapter 版本已同步升级。

### 3. 自定义 / 本地化部署如何配置 `base_url`

以 Ollama 为例：

```json
{
  "type": "garak_scan",
  "content": {
    "provider": "openai",
    "model": "llama3:8b",
    "api_key": "ollama",
    "base_url": "http://127.0.0.1:11434/v1",
    "intensity": "fast"
  }
}
```

- `base_url` 仅在显式提供时才会透传到 garak (`--base-url`)，**留空则使用 Provider 默认地址**，避免覆盖原生行为。
- vLLM / FastChat / OneAPI 等 OpenAI 兼容服务可同样配置 `provider=openai` + `base_url`。

### 4. adapter 退出码约定

`garak-adapter/main.py` 与 Go Agent 之间的退出码契约：

| Exit Code | 含义 | Agent 行为 |
|-----------|------|-----------|
| `0` | 全部探针成功 | 步骤 2 标记 `completed`，正常进入步骤 3 |
| `1` | 部分探针失败，但仍输出可解析 JSON | 步骤 2 标记 `completed`（带「部分探针失败」提示），继续走标准化 |
| `2` 或其他 | 完全失败（adapter 启动 / Garak 未安装 / 未捕获异常） | 步骤 2 标记 `failed` 并立即终止；不会再推进步骤 3 |

如需在 CI 流水线里识别失败原因，可以读取 adapter 最后一行 stdout JSON 的 `success` 与 `metadata.error` 字段。
