import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Empty,
  Popconfirm,
  Row,
  Space,
  Spin,
  Steps,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import PageHeader from '@/components/PageHeader';
import { getTaskDetail, terminateTask } from '@/api/tasks';
import { useTaskSse } from '@/hooks/useTaskSse';
import { isTaskFinished, isTaskRunning, formatTime } from '@/utils/task';
import type { TaskDetail, TaskMessage } from '@/types/task';

const STATUS_COLORS: Record<string, string> = {
  pending: 'default',
  todo: 'default',
  doing: 'processing',
  running: 'processing',
  completed: 'success',
  failed: 'error',
  terminated: 'warning',
};

interface PlanStep {
  stepId: string;
  title: string;
  status: string;
  startedAt?: number;
}

/** Reduce a flat event list into the structures the UI actually renders. */
function reducePlanState(messages: TaskMessage[]): {
  steps: PlanStep[];
  liveStatus: string;
  finalResult: Record<string, unknown> | null;
  actionLogs: TaskMessage[];
  toolUses: TaskMessage[];
  statusUpdates: TaskMessage[];
} {
  const stepsById = new Map<string, PlanStep>();
  const actionLogs: TaskMessage[] = [];
  const toolUses: TaskMessage[] = [];
  const statusUpdates: TaskMessage[] = [];
  let liveStatus = '';
  let finalResult: Record<string, unknown> | null = null;

  for (const m of messages) {
    const ev = m.event || {};
    switch (m.type) {
      case 'planUpdate': {
        const tasks = (ev.tasks as PlanStep[]) || [];
        for (const t of tasks) {
          if (!t.stepId) continue;
          stepsById.set(t.stepId, { ...stepsById.get(t.stepId), ...t });
        }
        break;
      }
      case 'newPlanStep': {
        const stepId = ev.stepId as string;
        if (stepId) {
          const existing = stepsById.get(stepId);
          stepsById.set(stepId, {
            stepId,
            title: (ev.title as string) || existing?.title || '',
            status: existing?.status || 'doing',
            startedAt:
              (ev.timestamp as number) || existing?.startedAt || m.timestamp,
          });
        }
        break;
      }
      case 'liveStatus':
        liveStatus = (ev.text as string) || liveStatus;
        break;
      case 'statusUpdate':
        statusUpdates.push(m);
        break;
      case 'toolUsed':
        toolUses.push(m);
        break;
      case 'actionLog':
        actionLogs.push(m);
        break;
      case 'resultUpdate':
        finalResult = ev as Record<string, unknown>;
        break;
      default:
        break;
    }
  }

  return {
    steps: Array.from(stepsById.values()),
    liveStatus,
    finalResult,
    actionLogs,
    toolUses,
    statusUpdates,
  };
}

function statusToStepStatus(
  s: string,
): 'wait' | 'process' | 'finish' | 'error' {
  const v = s?.toLowerCase();
  if (v === 'completed' || v === 'success' || v === 'finish') return 'finish';
  if (v === 'failed' || v === 'error') return 'error';
  if (v === 'doing' || v === 'running') return 'process';
  return 'wait';
}

export default function TaskDetailPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [terminating, setTerminating] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const d = await getTaskDetail(sessionId);
      setDetail(d);
    } catch {
      // toast already shown
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const running = isTaskRunning(detail?.status);
  const sse = useTaskSse(sessionId, running);

  // Merge historical (already-stored) and live events. De-dupe by id.
  const allMessages = useMemo<TaskMessage[]>(() => {
    const seen = new Set<string>();
    const merged: TaskMessage[] = [];
    for (const m of [...(detail?.messages ?? []), ...sse.events]) {
      const key = m.id || `${m.type}-${m.timestamp}-${merged.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(m);
    }
    return merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }, [detail?.messages, sse.events]);

  const reduced = useMemo(() => reducePlanState(allMessages), [allMessages]);

  // Auto-refresh detail when SSE indicates the task has finished, so we
  // pick up the final stored status.
  useEffect(() => {
    const hasFinalEvent = sse.events.some((e) => e.type === 'resultUpdate');
    if (hasFinalEvent) {
      fetchDetail();
    }
  }, [sse.events, fetchDetail]);

  const onTerminate = async () => {
    if (!sessionId) return;
    setTerminating(true);
    try {
      await terminateTask(sessionId);
      message.success('已请求终止');
      fetchDetail();
    } catch {
      /* handled */
    } finally {
      setTerminating(false);
    }
  };

  const isGarak =
    detail?.taskType === 'Garak-Scan' || detail?.taskType === 'garak_scan';
  const finished = isTaskFinished(detail?.status);

  return (
    <Spin spinning={loading} tip="加载任务详情...">
      <PageHeader
        title={detail?.title || sessionId}
        description={
          <Space size={12}>
            <span>
              会话 ID：<code>{sessionId}</code>
            </span>
            {detail?.taskType ? <Tag>{detail.taskType}</Tag> : null}
            {detail?.status ? (
              <Badge
                status={
                  (STATUS_COLORS[detail.status] as
                    | 'default'
                    | 'processing'
                    | 'success'
                    | 'error'
                    | 'warning') || 'default'
                }
                text={detail.status}
              />
            ) : null}
            {detail?.createdAt ? (
              <span>
                创建于{' '}
                {dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm:ss')}
              </span>
            ) : null}
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/tasks')}>
              返回
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchDetail}>
              刷新
            </Button>
            {running ? (
              <Popconfirm title="确认终止该任务?" onConfirm={onTerminate}>
                <Button danger icon={<StopOutlined />} loading={terminating}>
                  终止
                </Button>
              </Popconfirm>
            ) : null}
            {isGarak && finished ? (
              <Link to={`/scans/${encodeURIComponent(sessionId)}/findings`}>
                <Button type="primary">查看评估报告</Button>
              </Link>
            ) : null}
          </Space>
        }
      />

      {sse.error ? (
        <Alert
          type="warning"
          showIcon
          message={sse.error}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Row gutter={16}>
        <Col xs={24} md={10}>
          <Card title="任务参数" size="small" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="语言">
                {detail?.countryIsoCode || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="内容">
                <Typography.Paragraph
                  ellipsis={{ rows: 3, expandable: true }}
                  style={{ marginBottom: 0 }}
                >
                  {detail?.content || '-'}
                </Typography.Paragraph>
              </Descriptions.Item>
            </Descriptions>
            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: 'params',
                  label: 'Params (JSON)',
                  children: (
                    <pre
                      style={{
                        background: '#f6f8fa',
                        padding: 8,
                        borderRadius: 4,
                        margin: 0,
                        maxHeight: 240,
                        overflow: 'auto',
                      }}
                    >
                      {JSON.stringify(detail?.params || {}, null, 2)}
                    </pre>
                  ),
                },
                ...(detail?.attachments && detail.attachments.length > 0
                  ? [
                      {
                        key: 'attachments',
                        label: `附件 (${detail.attachments.length})`,
                        children: (
                          <ul style={{ paddingLeft: 18, margin: 0 }}>
                            {detail.attachments.map((a) => (
                              <li key={a.fileUrl}>
                                <a href={a.fileUrl} target="_blank" rel="noreferrer">
                                  {a.filename}
                                </a>
                              </li>
                            ))}
                          </ul>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Card>

          <Card
            title={
              <Space>
                <span>执行计划</span>
                {running ? (
                  <Badge status="processing" text="进行中" />
                ) : null}
              </Space>
            }
            size="small"
          >
            {reduced.steps.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无步骤"
              />
            ) : (
              <Steps
                direction="vertical"
                size="small"
                items={reduced.steps.map((s) => ({
                  title: s.title || s.stepId,
                  description: s.startedAt ? formatTime(s.startedAt) : undefined,
                  status: statusToStepStatus(s.status),
                }))}
              />
            )}
            {reduced.liveStatus ? (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 12 }}
                message={reduced.liveStatus}
              />
            ) : null}
          </Card>
        </Col>

        <Col xs={24} md={14}>
          <Card
            title={
              <Space>
                <span>实时日志</span>
                {running ? (
                  <Badge
                    status={sse.connected ? 'success' : 'default'}
                    text={sse.connected ? 'SSE 已连接' : '等待连接'}
                  />
                ) : null}
              </Space>
            }
            size="small"
            style={{ marginBottom: 16 }}
          >
            <Timeline
              mode="left"
              style={{ maxHeight: 480, overflow: 'auto' }}
              items={[...reduced.statusUpdates, ...reduced.toolUses, ...reduced.actionLogs]
                .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
                .slice(-200)
                .map((m) => ({
                  label: formatTime(m.timestamp),
                  color:
                    m.type === 'toolUsed'
                      ? 'blue'
                      : m.type === 'actionLog'
                      ? 'gray'
                      : 'green',
                  children: (
                    <div>
                      <Tag>{m.type}</Tag>
                      <Typography.Text>{summarizeEvent(m)}</Typography.Text>
                    </div>
                  ),
                }))}
            />
            {reduced.statusUpdates.length +
              reduced.toolUses.length +
              reduced.actionLogs.length ===
            0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无日志事件"
              />
            ) : null}
          </Card>

          <Card title="最终结果" size="small">
            {reduced.finalResult ? (
              <pre
                style={{
                  background: '#f6f8fa',
                  padding: 12,
                  borderRadius: 4,
                  maxHeight: 360,
                  overflow: 'auto',
                  margin: 0,
                }}
              >
                {JSON.stringify(reduced.finalResult, null, 2)}
              </pre>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={running ? '任务尚未完成' : '无结果数据'}
              />
            )}
          </Card>
        </Col>
      </Row>
    </Spin>
  );
}

/** Best-effort one-line summary of an event payload. */
function summarizeEvent(m: TaskMessage): string {
  const ev = m.event || {};
  const candidates = [
    'brief',
    'description',
    'text',
    'message',
    'detail',
    'tool',
    'name',
    'agentStatus',
  ] as const;
  for (const k of candidates) {
    const v = (ev as Record<string, unknown>)[k];
    if (typeof v === 'string' && v) return v;
  }
  try {
    return JSON.stringify(ev).slice(0, 160);
  } catch {
    return '';
  }
}
