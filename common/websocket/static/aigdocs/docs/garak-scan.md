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

## 前提条件

1. **Python 环境**：Agent 节点需安装 Python 3.10+
2. **Garak 安装**：在 Agent 节点执行 `pip install garak`
3. **网络连通**：Agent 节点需能访问目标 LLM API 端点

> 若 Garak 未安装，扫描任务将以 **Mock 模式**运行，仅返回样例数据，适用于接口联调和 CI 测试验证。

## 常见问题

**Q: 扫描时间超过预期，如何处理？**

A: 建议先使用 `fast` 强度进行初步评测，确认流程通畅后再升级到 `standard` 或 `deep`。也可在策略配置（`data/garak_policies/`）中调整探针组开关来缩短扫描时间。

**Q: 如何添加自定义探针？**

A: 修改 `data/garak_policies/` 目录下对应强度的 YAML 文件，在 `probe_groups` 中启用或禁用特定探针组。系统支持所有 Garak 原生探针。

**Q: API Key 会被记录到日志吗？**

A: 不会。API Key 通过环境变量（`GARAK_API_KEY`）注入子进程，不会出现在命令行参数或平台日志中。
