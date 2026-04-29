import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
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
  Typography,
  Upload,
  message,
} from 'antd';
import { ArrowLeftOutlined, UploadOutlined } from '@ant-design/icons';
import PageHeader from '@/components/PageHeader';
import { listModels } from '@/api/models';
import { uploadTaskFile } from '@/api/files';
import { createTask, taskSseUrl } from '@/api/tasks';
import type { ModelEntry } from '@/types/model';
import type { CreateTaskRequest, InAppTaskType } from '@/types/task';
import { genId } from '@/utils/task';

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

const REDTEAM_DATASETS = [
  'JailBench-Tiny',
  'JailbreakPrompts-Tiny',
  'ChatGPT-Jailbreak-Prompts',
  'JADE-db-v3.0',
  'HarmfulEvalBenchmark',
];

const GARAK_PROVIDERS = [
  { value: 'openai', label: 'openai' },
  { value: 'huggingface', label: 'huggingface' },
];

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

// --- Page ------------------------------------------------------------------

export default function TaskCreate() {
  const navigate = useNavigate();
  const [taskType, setTaskType] = useState<InAppTaskType>('AI-Infra-Scan');
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [form] = Form.useForm();
  const sessionIdRef = useRef<string>(genId());

  useEffect(() => {
    setModelsLoading(true);
    listModels()
      .then((m) => setModels(m ?? []))
      .catch(() => undefined)
      .finally(() => setModelsLoading(false));
  }, []);

  // Reset transient state when switching task type.
  useEffect(() => {
    form.resetFields();
    setUploadProgress(null);
    setUploadedUrl(null);
    sessionIdRef.current = genId();
  }, [taskType, form]);

  const modelOptions = useMemo(
    () => models.map((m) => ({ value: m.model_id, label: modelLabel(m) })),
    [models],
  );

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
        base.content = targets.join('\n');
        base.params = {
          model_id: values.model_id,
          target: targets,
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
              tooltip="支持 URL / IP / 域名，多个用换行或逗号分隔"
              rules={[{ required: true, message: '请填写至少一个扫描目标' }]}
            >
              <Input.TextArea
                rows={4}
                placeholder={'https://example.com\n10.0.0.1:11434'}
              />
            </Form.Item>
            <Form.Item name="timeout" label="超时(秒)" initialValue={30}>
              <InputNumber min={1} max={600} />
            </Form.Item>
            <Form.Item name="model_id" label="辅助分析模型(可选)">
              <Select
                allowClear
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
              label="Agent 配置 ID"
              tooltip="使用 知识库 → Agent 配置 中预先保存的 ID"
              rules={[{ required: true, message: '请填写 Agent ID' }]}
            >
              <Input placeholder="例如 my-dify-agent" />
            </Form.Item>
            <Form.Item
              name="model_id"
              label="评估模型"
              rules={[{ required: true, message: '请选择评估模型' }]}
            >
              <Select
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
                loading={modelsLoading}
                options={modelOptions}
              />
            </Form.Item>
            <Form.Item
              name="eval_model_id"
              label="裁判模型"
              rules={[{ required: true, message: '请选择裁判模型' }]}
            >
              <Select loading={modelsLoading} options={modelOptions} />
            </Form.Item>
            <Form.Item
              name="dataFile"
              label="数据集"
              rules={[{ required: true, message: '至少选择一个数据集' }]}
              initialValue={['JailBench-Tiny']}
            >
              <Select
                mode="multiple"
                options={REDTEAM_DATASETS.map((v) => ({ value: v, label: v }))}
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
            <Button onClick={() => form.resetFields()}>重置</Button>
          </Space>
        </Form>
      </Spin>
    </Card>
  );
}
