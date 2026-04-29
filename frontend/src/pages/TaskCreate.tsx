import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Progress,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { ArrowLeftOutlined, UploadOutlined } from '@ant-design/icons';
import PageHeader from '@/components/PageHeader';
import { listModels } from '@/api/models';
import { uploadTaskFile } from '@/api/files';
import { createTask, taskSseUrl } from '@/api/tasks';
import { listAgentNames, listEvaluations } from '@/api/knowledge';
import type { ModelEntry } from '@/types/model';
import type {
  CreateTaskRequest,
  InAppTaskType,
  TaskAttachment,
} from '@/types/task';
import {
  genId,
  TASK_CLONE_STORAGE_KEY,
  TASK_LANG_STORAGE_KEY,
} from '@/utils/task';

// --- Task type catalogue ----------------------------------------------------

interface TaskTypeMeta {
  value: InAppTaskType;
  label: string;
  description: string;
}

const TASK_TYPES: TaskTypeMeta[] = [
  {
    value: 'AI-Infra-Scan',
    label: 'AI 基础设施扫描',
    description: '指纹识别 + CVE 漏洞扫描，可对一组 URL/IP 进行批量探测。',
  },
  {
    value: 'Mcp-Scan',
    label: 'MCP 安全扫描',
    description: '上传源码 zip 或填写远程 MCP 地址，对 MCP Server 做安全扫描。',
  },
  {
    value: 'Agent-Scan',
    label: 'Agent 安全扫描',
    description: '对 Dify / Coze / 自研 Agent 做提示注入、越权、数据泄露等检测。',
  },
  {
    value: 'Model-Redteam-Report',
    label: '大模型安全体检',
    description: '使用越狱 / 有害内容数据集对 LLM 做红队评估，输出综合报告。',
  },
  {
    value: 'Garak-Scan',
    label: 'Garak LLM 安全扫描',
    description: '使用 NVIDIA Garak 探针深度评估，产出可结构化查询的 Findings。',
  },
];

// --- Helpers ---------------------------------------------------------------

const INTENSITY_OPTIONS = [
  { value: 'fast', label: 'Fast (~15min)' },
  { value: 'standard', label: 'Standard (~45min)' },
  { value: 'deep', label: 'Deep (~90min)' },
];

const GARAK_PROVIDERS = [
  { value: 'openai', label: 'openai' },
  { value: 'huggingface', label: 'huggingface' },
];

// Hard-coded fallbacks used only when the evaluations API fails or is empty,
// so the form remains usable. Server-loaded names take precedence.
const FALLBACK_REDTEAM_DATASETS = [
  'JailBench-Tiny',
  'JailbreakPrompts-Tiny',
  'ChatGPT-Jailbreak-Prompts',
  'JADE-db-v3.0',
  'HarmfulEvalBenchmark',
];

// Loose RFC-ish target validation. We accept full URLs, host:port, and bare
// hostnames / IPs — the backend does the strict parsing later. We only flag
// obviously bad lines (whitespace inside the token, or empty after split).
const TARGET_RE = /^[A-Za-z0-9._:\-/?=&%#@+,;~!$()*[\]]+$/;

function modelLabel(m: ModelEntry): string {
  const n = m.model?.note ? ` (${m.model.note})` : '';
  return `${m.model_id} — ${m.model?.model ?? ''}${n}`;
}

/** Open the SSE channel for the given session and resolve only after
 *  the connection is `open` (or reject after `timeoutMs`). The returned
 *  EventSource MUST be closed by the caller after the task POST completes
 *  (the task detail page will reopen its own subscription).
 */
function openSseAndWait(
  sessionId: string,
  timeoutMs = 15_000,
): Promise<EventSource> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(taskSseUrl(sessionId));
    const timer = setTimeout(() => {
      es.close();
      reject(new Error('SSE 连接超时'));
    }, timeoutMs);
    es.onopen = () => {
      clearTimeout(timer);
      resolve(es);
    };
    es.onerror = () => {
      // Surface only if we never managed to open.
      if (es.readyState === EventSource.CLOSED) {
        clearTimeout(timer);
        reject(new Error('SSE 连接失败'));
      }
    };
  });
}

// --- Clone payload (shared with TaskList) ----------------------------------

interface ClonePayload {
  taskType?: string;
  title?: string;
  content?: string;
  params?: Record<string, unknown>;
  attachments?: TaskAttachment[];
  countryIsoCode?: string;
}

function readClonePayload(): ClonePayload | null {
  try {
    const raw = sessionStorage.getItem(TASK_CLONE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ClonePayload;
  } catch {
    return null;
  }
}

// Map the raw `taskType` from a stored task back to the in-app form key.
// Both PascalCase ("AI-Infra-Scan") and lowercase ("ai_infra_scan") forms
// are accepted; unknown types fall back to AI-Infra-Scan.
function normalizeTaskType(t: string | undefined): InAppTaskType {
  const norm = (t || '').toLowerCase().replace(/_/g, '-');
  switch (norm) {
    case 'ai-infra-scan':
      return 'AI-Infra-Scan';
    case 'mcp-scan':
      return 'Mcp-Scan';
    case 'agent-scan':
      return 'Agent-Scan';
    case 'model-redteam-report':
      return 'Model-Redteam-Report';
    case 'garak-scan':
      return 'Garak-Scan';
    default:
      return 'AI-Infra-Scan';
  }
}

// Build the initial form values for a given task type, optionally seeded
// from a clone payload.
function buildInitialValues(
  type: InAppTaskType,
  clone: ClonePayload | null,
): Record<string, unknown> {
  const params = (clone?.params as Record<string, unknown> | undefined) || {};
  const language =
    clone?.countryIsoCode ||
    localStorage.getItem(TASK_LANG_STORAGE_KEY) ||
    'zh';
  switch (type) {
    case 'AI-Infra-Scan': {
      const target = Array.isArray(params.target)
        ? (params.target as string[]).join('\n')
        : clone?.content || '';
      return {
        target,
        timeout: (params.timeout as number) ?? 30,
        model_id: params.model_id,
        language,
      };
    }
    case 'Mcp-Scan':
      return {
        content: clone?.content || '',
        model_id: params.model_id,
        thread: (params.thread as number) ?? 4,
        language,
      };
    case 'Agent-Scan':
      return {
        agent_id: params.agent_id,
        model_id: params.model_id,
        prompt: clone?.content || '',
        language,
      };
    case 'Model-Redteam-Report': {
      const ds = (params.dataset as Record<string, unknown> | undefined) || {};
      return {
        model_id: params.model_id,
        eval_model_id: params.eval_model_id,
        dataFile: (ds.dataFile as string[]) || ['JailBench-Tiny'],
        numPrompts: (ds.numPrompts as number) ?? 100,
        randomSeed: (ds.randomSeed as number) ?? 42,
        prompt: clone?.content || '',
        language,
      };
    }
    case 'Garak-Scan':
      return {
        provider: (params.provider as string) || 'openai',
        model: (params.model as string) || clone?.content || '',
        api_key: params.api_key,
        base_url: params.base_url,
        intensity: (params.intensity as string) || 'fast',
        language,
      };
  }
}

// --- Page ------------------------------------------------------------------

export default function TaskCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const cloneFromQuery = searchParams.get('clone');

  // Read the clone payload exactly once on mount (lazy useState init,
  // since useRef has no lazy-init form). Stored in a ref afterwards so
  // we can null it out after consuming or after the user clicks
  // "clear clone data" without triggering a re-render.
  const [cloneInit] = useState<ClonePayload | null>(() =>
    cloneFromQuery ? readClonePayload() : null,
  );
  const cloneRef = useRef<ClonePayload | null>(cloneInit);
  const initialType = useMemo<InAppTaskType>(
    () => normalizeTaskType(cloneRef.current?.taskType),
    [],
  );

  const [taskType, setTaskType] = useState<InAppTaskType>(initialType);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [agentNames, setAgentNames] = useState<string[]>([]);
  const [datasetNames, setDatasetNames] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  // Live-parsed AI-Infra-Scan target preview.
  const [targetPreview, setTargetPreview] = useState<{
    valid: string[];
    invalid: string[];
  }>({ valid: [], invalid: [] });
  const [form] = Form.useForm();
  const sessionIdRef = useRef<string>(genId());
  const cloneAppliedRef = useRef(false);

  // --- Initial side effects: load models + reference data ---------------

  useEffect(() => {
    setModelsLoading(true);
    listModels()
      .then((m) => setModels(m ?? []))
      .catch(() => undefined)
      .finally(() => setModelsLoading(false));
    listAgentNames()
      .then((names) => setAgentNames(names ?? []))
      .catch(() => undefined);
    // Pre-load a generous page of evaluation names so the redteam dropdown
    // has the user's full library available without an extra search step.
    listEvaluations({ page: 1, size: 200 })
      .then((r) => setDatasetNames((r?.items ?? []).map((e) => e.name)))
      .catch(() => undefined);
  }, []);

  // Reset form whenever the task type changes. If we still have a pending
  // clone payload (matching the new type) on the *first* render after mount,
  // re-apply it so e.g. switching to MCP after cloning an MCP task keeps
  // the values; otherwise fall back to plain defaults.
  useEffect(() => {
    const clone = cloneRef.current;
    const useClone =
      !cloneAppliedRef.current &&
      clone &&
      normalizeTaskType(clone.taskType) === taskType;
    const initial = buildInitialValues(taskType, useClone ? clone : null);
    form.resetFields();
    form.setFieldsValue(initial);
    setUploadProgress(null);
    // For Mcp-Scan, restore the first attachment URL if cloning.
    if (
      useClone &&
      taskType === 'Mcp-Scan' &&
      clone?.attachments &&
      clone.attachments.length > 0
    ) {
      setUploadedUrl(clone.attachments[0].fileUrl);
    } else {
      setUploadedUrl(null);
    }
    if (useClone) {
      cloneAppliedRef.current = true;
    }
    // Refresh sessionId for every fresh form so a previously failed submit
    // can't poison the next attempt's SSE channel.
    sessionIdRef.current = genId();
    // Also recompute the AI-Infra target preview from the seeded value.
    if (taskType === 'AI-Infra-Scan') {
      computeTargetPreview(String(initial.target ?? ''));
    } else {
      setTargetPreview({ valid: [], invalid: [] });
    }
  }, [taskType, form]);

  const modelOptions = useMemo(
    () => models.map((m) => ({ value: m.model_id, label: modelLabel(m) })),
    [models],
  );

  const agentOptions = useMemo(
    () => agentNames.map((n) => ({ value: n, label: n })),
    [agentNames],
  );

  // Merge live evaluation names with the legacy fallback list, dedup, sort.
  const datasetOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const n of [...datasetNames, ...FALLBACK_REDTEAM_DATASETS]) {
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push({ value: n, label: n });
    }
    return out;
  }, [datasetNames]);

  const computeTargetPreview = (raw: string) => {
    const tokens = raw
      .split(/[\s,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    // Dedup while preserving first-seen order.
    const seen = new Set<string>();
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      if (TARGET_RE.test(t)) valid.push(t);
      else invalid.push(t);
    }
    setTargetPreview({ valid, invalid });
  };

  const handleManualUpload = async (file: File): Promise<boolean> => {
    setUploadProgress(0);
    try {
      const r = await uploadTaskFile(file, (p) => setUploadProgress(p));
      setUploadedUrl(r.fileUrl);
      message.success(`已上传：${r.filename}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setUploadProgress(null);
    }
    // Always return false → suppress antd Upload's built-in xhr.
    return false;
  };

  const buildRequest = (values: Record<string, unknown>): CreateTaskRequest => {
    const sessionId = sessionIdRef.current;
    const id = genId();
    const timestamp = Date.now();
    const language = (values.language as string) || 'zh';
    // Persist the user's choice for next time.
    try {
      localStorage.setItem(TASK_LANG_STORAGE_KEY, language);
    } catch {
      /* ignore quota / privacy mode */
    }

    const base: CreateTaskRequest = {
      id,
      sessionId,
      taskType,
      timestamp,
      content: '',
      params: {},
      attachments: [],
      countryIsoCode: language,
    };

    switch (taskType) {
      case 'AI-Infra-Scan': {
        const targets = String(values.target || '')
          .split(/[\s,;\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        // Dedup while preserving order.
        const seen = new Set<string>();
        const dedup: string[] = [];
        for (const t of targets) {
          if (!seen.has(t)) {
            seen.add(t);
            dedup.push(t);
          }
        }
        base.content = dedup.join('\n');
        base.params = {
          model_id: values.model_id,
          target: dedup,
          timeout: values.timeout ?? 30,
        };
        break;
      }
      case 'Mcp-Scan': {
        base.content = (values.content as string) || '';
        base.params = {
          model_id: values.model_id,
          thread: values.thread ?? 4,
          language,
        };
        if (uploadedUrl) {
          base.attachments = [uploadedUrl];
        }
        break;
      }
      case 'Agent-Scan': {
        base.content = (values.prompt as string) || '';
        base.params = {
          agent_id: values.agent_id,
          model_id: values.model_id,
          language,
        };
        break;
      }
      case 'Model-Redteam-Report': {
        const target = (values.model_id as string[]) || [];
        base.content = (values.prompt as string) || '';
        base.params = {
          model_id: target,
          eval_model_id: values.eval_model_id,
          dataset: {
            dataFile: values.dataFile,
            numPrompts: values.numPrompts ?? 100,
            randomSeed: values.randomSeed ?? 42,
          },
        };
        break;
      }
      case 'Garak-Scan': {
        base.content = (values.model as string) || '';
        base.params = {
          provider: values.provider,
          model: values.model,
          api_key: values.api_key,
          base_url: values.base_url,
          intensity: values.intensity || 'fast',
        };
        break;
      }
    }
    return base;
  };

  const onSubmit = async () => {
    let values: Record<string, unknown>;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (taskType === 'Mcp-Scan' && !uploadedUrl && !values.content) {
      message.error('请上传源码 zip 或填写远程 MCP 地址');
      return;
    }
    if (taskType === 'AI-Infra-Scan' && targetPreview.valid.length === 0) {
      message.error('未识别到任何合法目标，请检查 URL / IP 格式');
      return;
    }
    if (taskType === 'AI-Infra-Scan' && targetPreview.invalid.length > 0) {
      // Soft warning — backend will perform the authoritative parse.
      message.warning(
        `发现 ${targetPreview.invalid.length} 条疑似非法目标，已忽略`,
      );
    }
    const req = buildRequest(values);
    setSubmitting(true);
    let es: EventSource | null = null;
    try {
      // Step 1: open SSE first — backend AddTask blocks until it sees the connection.
      es = await openSseAndWait(req.sessionId);
      // Step 2: post create.
      const resp = await createTask(req);
      message.success('任务已创建：' + (resp?.title ?? req.sessionId));
      // The detail page will open its own SSE subscription; close ours
      // *after* navigating to avoid losing the very first events.
      // Clear the clone payload now that it has been consumed successfully.
      sessionStorage.removeItem(TASK_CLONE_STORAGE_KEY);
      navigate(`/tasks/${encodeURIComponent(req.sessionId)}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      // Close after a short delay so any pre-flight events still flush.
      if (es) {
        setTimeout(() => es && es.close(), 500);
      }
      setSubmitting(false);
    }
  };

  const renderForm = () => {
    switch (taskType) {
      case 'AI-Infra-Scan':
        return (
          <>
            <Form.Item
              name="target"
              label="扫描目标"
              tooltip="支持 URL / IP / 域名，多个用换行、空格、逗号或分号分隔；自动去重"
              rules={[{ required: true, message: '请填写至少一个扫描目标' }]}
            >
              <Input.TextArea
                rows={5}
                placeholder={'https://example.com\n10.0.0.1:11434'}
                onChange={(e) => computeTargetPreview(e.target.value)}
              />
            </Form.Item>
            {targetPreview.valid.length + targetPreview.invalid.length > 0 ? (
              <Alert
                style={{ marginBottom: 16 }}
                type={targetPreview.invalid.length > 0 ? 'warning' : 'info'}
                showIcon
                message={
                  <Space size={8} wrap>
                    <span>
                      已识别 <Tag color="blue">{targetPreview.valid.length}</Tag>{' '}
                      个有效目标
                    </span>
                    {targetPreview.invalid.length > 0 ? (
                      <span>
                        ，<Tag color="orange">{targetPreview.invalid.length}</Tag>{' '}
                        条疑似非法（提交时将被忽略）
                      </span>
                    ) : null}
                  </Space>
                }
                description={
                  targetPreview.invalid.length > 0 ? (
                    <Typography.Text type="secondary">
                      非法示例：{targetPreview.invalid.slice(0, 3).join(', ')}
                    </Typography.Text>
                  ) : undefined
                }
              />
            ) : null}
            <Form.Item name="timeout" label="超时(秒)" initialValue={30}>
              <InputNumber min={1} max={600} />
            </Form.Item>
            <Form.Item name="model_id" label="辅助分析模型(可选)">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                loading={modelsLoading}
                options={modelOptions}
                placeholder="不选则不进行 LLM 辅助分析"
              />
            </Form.Item>
          </>
        );
      case 'Mcp-Scan':
        return (
          <>
            <Form.Item label="源码 zip(可选)">
              <Upload
                accept=".zip"
                maxCount={1}
                beforeUpload={(f) => handleManualUpload(f as File)}
                onRemove={() => {
                  setUploadedUrl(null);
                  return true;
                }}
              >
                <Button icon={<UploadOutlined />}>选择 zip</Button>
              </Upload>
              {uploadProgress !== null ? (
                <Progress percent={uploadProgress} size="small" />
              ) : null}
              {uploadedUrl ? (
                <Typography.Text type="success">
                  已上传：<code>{uploadedUrl}</code>
                </Typography.Text>
              ) : null}
            </Form.Item>
            <Form.Item
              name="content"
              label="远程 MCP 地址(可选)"
              tooltip="若上传了源码 zip，可留空"
            >
              <Input placeholder="https://mcp-server.example.com 或 github 仓库 URL" />
            </Form.Item>
            <Form.Item
              name="model_id"
              label="模型"
              rules={[{ required: true, message: '请选择模型' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                loading={modelsLoading}
                options={modelOptions}
                placeholder="选择已配置的模型"
              />
            </Form.Item>
            <Form.Item name="thread" label="并发线程数" initialValue={4}>
              <InputNumber min={1} max={32} />
            </Form.Item>
          </>
        );
      case 'Agent-Scan':
        return (
          <>
            <Form.Item
              name="agent_id"
              label="Agent 配置"
              tooltip="从 知识库 → Agent 配置 中选择，或手动填写未在列表中的 ID"
              rules={[{ required: true, message: '请选择或填写 Agent ID' }]}
            >
              <AutoComplete
                options={agentOptions}
                placeholder="例如 my-dify-agent"
                filterOption={(input, opt) =>
                  String(opt?.value ?? '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item
              name="model_id"
              label="评估模型"
              rules={[{ required: true, message: '请选择评估模型' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                loading={modelsLoading}
                options={modelOptions}
                placeholder="选择已配置的模型"
              />
            </Form.Item>
            <Form.Item name="prompt" label="附加扫描提示(可选)">
              <Input.TextArea rows={3} />
            </Form.Item>
          </>
        );
      case 'Model-Redteam-Report':
        return (
          <>
            <Form.Item
              name="model_id"
              label="待评估模型"
              rules={[{ required: true, message: '至少选择一个模型' }]}
            >
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                loading={modelsLoading}
                options={modelOptions}
              />
            </Form.Item>
            <Form.Item
              name="eval_model_id"
              label="裁判模型"
              rules={[{ required: true, message: '请选择裁判模型' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                loading={modelsLoading}
                options={modelOptions}
              />
            </Form.Item>
            <Form.Item
              name="dataFile"
              label="数据集"
              tooltip="来源于 知识库 → 评测集；可选多个"
              rules={[{ required: true, message: '至少选择一个数据集' }]}
              initialValue={['JailBench-Tiny']}
            >
              <Select
                mode="multiple"
                showSearch
                options={datasetOptions}
                placeholder="选择评测集"
              />
            </Form.Item>
            <Form.Item name="numPrompts" label="样本数" initialValue={100}>
              <InputNumber min={1} max={10000} />
            </Form.Item>
            <Form.Item name="randomSeed" label="随机种子" initialValue={42}>
              <InputNumber min={0} />
            </Form.Item>
            <Form.Item name="prompt" label="自定义 prompt(可选)">
              <Input.TextArea rows={2} />
            </Form.Item>
          </>
        );
      case 'Garak-Scan':
        return (
          <>
            <Form.Item
              name="provider"
              label="Provider"
              rules={[{ required: true }]}
              initialValue="openai"
            >
              <Select options={GARAK_PROVIDERS} />
            </Form.Item>
            <Form.Item
              name="model"
              label="模型名"
              rules={[{ required: true, message: '请填写模型名' }]}
            >
              <Input placeholder="例如 gpt-4o" />
            </Form.Item>
            <Form.Item name="api_key" label="API Key">
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="base_url" label="Base URL(可选)">
              <Input placeholder="https://api.openai.com/v1" />
            </Form.Item>
            <Form.Item name="intensity" label="扫描强度" initialValue="fast">
              <Select options={INTENSITY_OPTIONS} />
            </Form.Item>
          </>
        );
    }
  };

  const cloneActive = cloneAppliedRef.current && !!cloneRef.current;

  return (
    <Card>
      <PageHeader
        title="新建扫描任务"
        description="选择任务类型并填写参数。提交时会先建立 SSE 连接、再创建任务。"
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/tasks')}>
            返回任务列表
          </Button>
        }
      />
      {cloneActive ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <Space size={6} wrap>
              <span>
                已从来源任务克隆参数
                {cloneRef.current?.title ? (
                  <>
                    （<Typography.Text strong>{cloneRef.current.title}</Typography.Text>）
                  </>
                ) : null}
                ，请按需调整后提交。
              </span>
              <Button
                size="small"
                type="link"
                onClick={() => {
                  cloneAppliedRef.current = false;
                  cloneRef.current = null;
                  sessionStorage.removeItem(TASK_CLONE_STORAGE_KEY);
                  // Re-trigger initial values build.
                  form.resetFields();
                  form.setFieldsValue(buildInitialValues(taskType, null));
                  if (taskType === 'AI-Infra-Scan') {
                    setTargetPreview({ valid: [], invalid: [] });
                  }
                }}
              >
                清空克隆数据
              </Button>
            </Space>
          }
        />
      ) : null}
      <Segmented
        options={TASK_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        value={taskType}
        onChange={(v) => setTaskType(v as InAppTaskType)}
        block
        style={{ marginBottom: 16 }}
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={TASK_TYPES.find((t) => t.value === taskType)?.description}
      />
      <Spin spinning={submitting} tip="正在建立 SSE 并创建任务...">
        <Form
          form={form}
          layout="vertical"
          requiredMark="optional"
          style={{ maxWidth: 720 }}
        >
          {renderForm()}
          <Form.Item name="language" label="语言" initialValue="zh">
            <Select
              options={[
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Form.Item>
          <Space>
            <Button type="primary" onClick={onSubmit} loading={submitting}>
              创建任务
            </Button>
            <Button
              onClick={() => {
                form.resetFields();
                form.setFieldsValue(buildInitialValues(taskType, null));
                setUploadedUrl(null);
                setTargetPreview({ valid: [], invalid: [] });
              }}
            >
              重置
            </Button>
          </Space>
        </Form>
      </Spin>
    </Card>
  );
}
