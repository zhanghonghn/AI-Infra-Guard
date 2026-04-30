import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
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
  CopyOutlined,
  DownloadOutlined,
  EditOutlined,
  ExperimentOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import PageHeader from '@/components/PageHeader';
import TaskResult from '@/components/TaskResult';
import {
  getTaskDetail,
  terminateTask,
  updateTaskTitle,
} from '@/api/tasks';
import { useTaskSse } from '@/hooks/useTaskSse';
import {
  formatDuration,
  formatTime,
  isTaskFinished,
  isTaskRunning,
  TASK_CLONE_STORAGE_KEY,
} from '@/utils/task';
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
  // Plan-related events surfaced in the timeline so users can see when
  // step transitions happened.
  planEvents: TaskMessage[];
} {
  const stepsById = new Map<string, PlanStep>();
  const actionLogs: TaskMessage[] = [];
  const toolUses: TaskMessage[] = [];
  const statusUpdates: TaskMessage[] = [];
  const planEvents: TaskMessage[] = [];
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
        planEvents.push(m);
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
        planEvents.push(m);
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
    planEvents,
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

// Visible event type filters for the live log timeline.
const LOG_TYPE_OPTIONS = [
  { value: 'statusUpdate', label: '状态' },
  { value: 'toolUsed', label: '工具' },
  { value: 'actionLog', label: '操作' },
  { value: 'planUpdate', label: '计划' },
  { value: 'newPlanStep', label: '步骤' },
];

const DEFAULT_LOG_TYPES = LOG_TYPE_OPTIONS.map((o) => o.value);

// Trigger a download in the user's browser by creating a temporary blob URL.
function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Allow Safari to grab the blob before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TaskDetailPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [terminating, setTerminating] = useState(false);
  // Live "now" tick used to keep the running-time counter fresh.
  const [now, setNow] = useState<number>(() => Date.now());
  // Live log controls.
  const [enabledTypes, setEnabledTypes] =
    useState<string[]>(DEFAULT_LOG_TYPES);
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  // Track whether we already showed the "task completed" toast for this view.
  const completedToastShownRef = useRef(false);

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
  const finished = isTaskFinished(detail?.status);
  const sse = useTaskSse(sessionId, running);

  // Tick once per second only while the task is actively running so the
  // duration counter updates without burning cycles on completed tasks.
  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

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
    if (hasFinalEvent && !completedToastShownRef.current) {
      completedToastShownRef.current = true;
      message.success('任务已完成');
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

  const onRename = async (next: string) => {
    const value = (next || '').trim();
    if (!detail) return;
    if (!value) {
      message.warning('标题不能为空');
      return;
    }
    if (value === detail.title) return;
    if (value.length > 100) {
      message.warning('标题不能超过 100 个字符');
      return;
    }
    try {
      await updateTaskTitle(sessionId, value);
      message.success('已重命名');
      setDetail({ ...detail, title: value });
    } catch {
      /* handled */
    }
  };

  const onClone = () => {
    if (!detail) return;
    sessionStorage.setItem(
      TASK_CLONE_STORAGE_KEY,
      JSON.stringify({
        taskType: detail.taskType,
        title: detail.title,
        content: detail.content,
        params: detail.params,
        attachments: detail.attachments,
        countryIsoCode: detail.countryIsoCode,
      }),
    );
    navigate(`/tasks/new?clone=${encodeURIComponent(sessionId)}`);
  };

  const onExport = () => {
    if (!detail) return;
    downloadJson(
      `task-${sessionId}.json`,
      {
        ...detail,
        // Include the live events too so users get the full picture.
        liveEvents: sse.events,
      },
    );
  };

  const isGarak =
    detail?.taskType === 'Garak-Scan' || detail?.taskType === 'garak_scan';

  // Compute task duration. We treat the latest message timestamp as a
  // proxy for completion time when the backend doesn't expose one.
  const duration = useMemo(() => {
    const created = (detail?.createdAt as number | undefined) || 0;
    if (!created) return null;
    if (running) return now - created;
    if (allMessages.length > 0) {
      const last = allMessages[allMessages.length - 1].timestamp || created;
      return Math.max(0, last - created);
    }
    return null;
  }, [detail?.createdAt, running, now, allMessages]);

  // Live log timeline events, filtered + capped + (optionally) frozen.
  const timelineEvents = useMemo(() => {
    const buckets: TaskMessage[] = [];
    if (enabledTypes.includes('statusUpdate'))
      buckets.push(...reduced.statusUpdates);
    if (enabledTypes.includes('toolUsed')) buckets.push(...reduced.toolUses);
    if (enabledTypes.includes('actionLog')) buckets.push(...reduced.actionLogs);
    if (
      enabledTypes.includes('planUpdate') ||
      enabledTypes.includes('newPlanStep')
    ) {
      for (const m of reduced.planEvents) {
        if (
          (m.type === 'planUpdate' && enabledTypes.includes('planUpdate')) ||
          (m.type === 'newPlanStep' && enabledTypes.includes('newPlanStep'))
        ) {
          buckets.push(m);
        }
      }
    }
    return buckets
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(-200);
  }, [
    enabledTypes,
    reduced.statusUpdates,
    reduced.toolUses,
    reduced.actionLogs,
    reduced.planEvents,
  ]);

  // Snapshot the timeline when paused so it stops appending while the
  // user inspects an entry; live state keeps accumulating in the
  // background and is restored on resume. Using state (not a ref) so
  // React renders consistently.
  const [frozenTimeline, setFrozenTimeline] = useState<TaskMessage[] | null>(
    null,
  );
  useEffect(() => {
    if (paused) {
      // Capture the current view at the moment of pausing.
      setFrozenTimeline(timelineEvents);
    } else {
      setFrozenTimeline(null);
    }
    // We deliberately exclude `timelineEvents` so the snapshot is taken
    // exactly once when `paused` flips to true; otherwise the snapshot
    // would refresh on every new event and defeat the freeze.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);
  const renderedTimeline = paused
    ? frozenTimeline ?? timelineEvents
    : timelineEvents;

  // Auto-scroll to the bottom whenever new events arrive (and not paused).
  useEffect(() => {
    if (!autoScroll || paused) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [renderedTimeline.length, autoScroll, paused]);

  return (
    <Spin spinning={loading} tip="加载任务详情...">
      <PageHeader
        title={
          detail ? (
            <Space size={6}>
              <Typography.Title
                level={3}
                style={{ margin: 0 }}
                editable={{
                  onChange: onRename,
                  tooltip: '重命名任务',
                  icon: <EditOutlined />,
                  maxLength: 100,
                  triggerType: ['icon', 'text'],
                }}
              >
                {detail.title || sessionId}
              </Typography.Title>
            </Space>
          ) : (
            sessionId
          )
        }
        description={
          <Space size={12} wrap>
            <Space size={4}>
              <span>会话 ID：</span>
              <Typography.Text
                code
                copyable={{
                  text: sessionId,
                  icon: <CopyOutlined />,
                  tooltips: ['复制', '已复制'],
                }}
              >
                {sessionId}
              </Typography.Text>
            </Space>
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
            {duration !== null ? (
              <span>
                {running ? '已运行 ' : '耗时 '}
                <Tag color={running ? 'blue' : 'default'}>
                  {formatDuration(duration)}
                </Tag>
              </span>
            ) : null}
          </Space>
        }
        extra={
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/tasks')}>
              返回
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchDetail}>
              刷新
            </Button>
            <Button icon={<ExperimentOutlined />} onClick={onClone}>
              克隆任务
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={onExport}
              disabled={!detail}
            >
              导出 JSON
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
        <Col xs={24} md={12}>
          <Card
            title={
              <Space wrap>
                <span>实时日志</span>
                {running ? (
                  <Badge
                    status={sse.connected ? 'success' : 'default'}
                    text={sse.connected ? 'SSE 已连接' : '等待连接'}
                  />
                ) : null}
                <Tag>{renderedTimeline.length} 条</Tag>
              </Space>
            }
            extra={
              <Space size={8} wrap>
                <Checkbox.Group
                  options={LOG_TYPE_OPTIONS}
                  value={enabledTypes}
                  onChange={(v) => setEnabledTypes(v as string[])}
                />
                <Checkbox
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                >
                  自动滚动
                </Checkbox>
                <Button
                  size="small"
                  type={paused ? 'primary' : 'default'}
                  onClick={() => setPaused((p) => !p)}
                  disabled={!running}
                >
                  {paused ? '继续' : '暂停'}
                </Button>
              </Space>
            }
            size="small"
            style={{ marginBottom: 16 }}
          >
            <div ref={logRef} style={{ maxHeight: 540, overflow: 'auto' }}>
              <Timeline
                mode="left"
                items={renderedTimeline.map((m) => ({
                  label: formatTime(m.timestamp),
                  color:
                    m.type === 'toolUsed'
                      ? 'blue'
                      : m.type === 'actionLog'
                      ? 'gray'
                      : m.type === 'planUpdate' || m.type === 'newPlanStep'
                      ? 'purple'
                      : 'green',
                  children: (
                    <div>
                      <Tag>{m.type}</Tag>
                      <Typography.Text>{summarizeEvent(m)}</Typography.Text>
                    </div>
                  ),
                }))}
              />
            </div>
            {renderedTimeline.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  running
                    ? '尚未收到匹配筛选条件的事件'
                    : '暂无日志事件'
                }
              />
            ) : null}
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card title="任务参数" size="small" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="语言">
                {detail?.countryIsoCode || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="内容">
                <Typography.Paragraph
                  ellipsis={{ rows: 3, expandable: true }}
                  style={{ marginBottom: 0 }}
                  copyable={!!detail?.content}
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
                {reduced.steps.length > 0 ? (
                  <Tag>
                    {
                      reduced.steps.filter(
                        (s) => statusToStepStatus(s.status) === 'finish',
                      ).length
                    }
                    /{reduced.steps.length}
                  </Tag>
                ) : null}
              </Space>
            }
            size="small"
            style={{ marginBottom: 16 }}
          >
            {reduced.steps.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={running ? '正在等待计划事件…' : '暂无步骤'}
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

          <Card
            title="最终结果"
            size="small"
            extra={
              reduced.finalResult ? (
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={() =>
                    downloadJson(
                      `task-${sessionId}-result.json`,
                      reduced.finalResult,
                    )
                  }
                >
                  下载
                </Button>
              ) : null
            }
          >
            {reduced.finalResult ? (
              <TaskResult
                event={reduced.finalResult}
                taskType={detail?.taskType}
                scanId={sessionId}
              />
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

/** Best-effort one-line summary of an event payload. Keep this readable —
 *  power users can see the full payload via the JSON exporter. */
function summarizeEvent(m: TaskMessage): string {
  const ev = m.event || {};
  if (m.type === 'newPlanStep') {
    const title = (ev.title as string) || (ev.stepId as string) || '';
    return title ? `▶ ${title}` : '新增步骤';
  }
  if (m.type === 'planUpdate') {
    const tasks = ev.tasks as { stepId?: string }[] | undefined;
    return `计划更新（${tasks?.length ?? 0} 步）`;
  }
  if (m.type === 'toolUsed') {
    const name = (ev.tool as string) || (ev.name as string) || '';
    const brief = (ev.brief as string) || (ev.description as string) || '';
    return [name && `🔧 ${name}`, brief].filter(Boolean).join(' — ');
  }
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
