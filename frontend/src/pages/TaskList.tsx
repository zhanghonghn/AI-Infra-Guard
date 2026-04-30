import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import PageHeader from '@/components/PageHeader';
import {
  deleteTask,
  getTaskDetail,
  listTasks,
  terminateTask,
  updateTaskTitle,
} from '@/api/tasks';
import { listFindings } from '@/api/findings';
import { isTaskRunning, TASK_CLONE_STORAGE_KEY } from '@/utils/task';
import type { TaskListItem } from '@/types/task';
import type { Finding } from '@/types/finding';

// Task types — both shapes are accepted by the backend filter:
// in-app tasks store PascalCase-with-dashes (AI-Infra-Scan), while the
// third-party taskapi/* endpoint stores lowercase_underscored values.
const TASK_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'AI-Infra-Scan', label: 'AI 基础设施扫描（应用内）' },
  { value: 'Mcp-Scan', label: 'MCP 扫描（应用内）' },
  { value: 'Agent-Scan', label: 'Agent 扫描（应用内）' },
  { value: 'Model-Redteam-Report', label: '大模型安全体检（应用内）' },
  { value: 'Garak-Scan', label: 'Garak 扫描（应用内）' },
  { value: 'ai_infra_scan', label: 'AI 基础设施扫描（TaskAPI）' },
  { value: 'mcp_scan', label: 'MCP 扫描（TaskAPI）' },
  { value: 'agent_scan', label: 'Agent 扫描（TaskAPI）' },
  { value: 'model_redteam_report', label: '大模型安全体检（TaskAPI）' },
  { value: 'garak_scan', label: 'Garak 扫描（TaskAPI）' },
];

const TASK_TYPE_LABEL_MAP = TASK_TYPE_OPTIONS.reduce<Record<string, string>>(
  (acc, option) => {
    if (option.value) acc[option.value] = option.label;
    return acc;
  },
  {},
);

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'todo', label: '待处理' },
  { value: 'doing', label: '运行中' },
  { value: 'done', label: '已完成' },
  { value: 'error', label: '失败' },
  { value: 'terminated', label: '已终止' },
];

const STATUS_COLORS: Record<string, string> = {
  todo: 'default',
  doing: 'processing',
  done: 'success',
  error: 'error',
  terminated: 'warning',
};

// Map raw backend status strings to the Chinese labels used in the filter.
const STATUS_LABEL_MAP: Record<string, string> = {
  todo:       '待处理',
  doing:      '运行中',
  done:       '已完成',
  error:      '失败',
  terminated: '已终止',
};

function normalizeTaskStatus(rawStatus: string | undefined): string {
  const status = (rawStatus || '').toLowerCase();
  switch (status) {
    case 'pending':
    case 'todo':
      return 'todo';
    case 'doing':
    case 'running':
      return 'doing';
    case 'done':
    case 'completed':
    case 'success':
      return 'done';
    case 'failed':
    case 'error':
      return 'error';
    case 'terminated':
    case 'cancelled':
    case 'canceled':
      return 'terminated';
    default:
      return status;
  }
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'magenta',
  high:     'red',
  medium:   'orange',
  low:      'gold',
  info:     'blue',
  safe:     'green',
  unknown:  'default',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: '严重',
  high:     '高危',
  medium:   '中危',
  low:      '低危',
  info:     '信息',
  safe:     '安全',
};

function normalizeSev(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (s === '严重' || s === 'critical') return 'critical';
  if (s === '高危' || s === '高' || s === 'high') return 'high';
  if (s === '中危' || s === '中' || s === 'medium' || s === 'med') return 'medium';
  if (s === '低危' || s === '低' || s === 'low') return 'low';
  if (s === 'info' || s === 'informational') return 'info';
  if (s === 'safe' || s === '安全' || s === 'none') return 'safe';
  return s;
}

// Map a STATUS_OPTIONS bucket to the set of raw status strings it covers.
function statusMatches(rowStatus: string | undefined, bucket: string): boolean {
  if (!bucket) return true;
  return normalizeTaskStatus(rowStatus) === bucket;
}

function formatTime(value: unknown): string {
  if (!value) return '-';
  const d = dayjs(value as string);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : String(value);
}

// How often to refresh the list when at least one task is running.
const AUTO_REFRESH_INTERVAL_MS = 10_000;

export default function TaskList() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TaskListItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [taskType, setTaskType] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [renameTarget, setRenameTarget] = useState<TaskListItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  // Findings quick-view drawer state.
  const [findingsTask, setFindingsTask] = useState<TaskListItem | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [riskCountMap, setRiskCountMap] = useState<Record<string, number>>({});
  const [riskCountLoadingMap, setRiskCountLoadingMap] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await listTasks({
        q: keyword || undefined,
        taskType: taskType || undefined,
      });
      setData(resp?.tasks ?? []);
    } catch {
      // toast already shown by client interceptor
    } finally {
      setLoading(false);
    }
  }, [keyword, taskType]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh the list while there are running tasks. Disable from the
  // toolbar to avoid surprising users who are inspecting the table.
  const hasRunning = useMemo(
    () => data.some((t) => isTaskRunning(t.status)),
    [data],
  );
  const fetchRef = useRef(fetchData);
  fetchRef.current = fetchData;
  useEffect(() => {
    if (!autoRefresh || !hasRunning) return undefined;
    const id = window.setInterval(() => {
      fetchRef.current();
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, hasRunning]);

  const onTerminate = async (item: TaskListItem) => {
    try {
      await terminateTask(item.sessionId);
      message.success('已请求终止');
      fetchData();
    } catch {
      /* handled */
    }
  };

  const onDelete = async (item: TaskListItem) => {
    try {
      await deleteTask(item.sessionId);
      message.success('已删除');
      fetchData();
    } catch {
      /* handled */
    }
  };

  // Stash the source task in sessionStorage and route to /tasks/new — the
  // create page reads back from sessionStorage and pre-populates the form.
  const onClone = async (item: TaskListItem) => {
    try {
      const detail = await getTaskDetail(item.sessionId);
      if (!detail) {
        message.error('无法读取任务详情');
        return;
      }
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
      navigate(`/tasks/new?clone=${encodeURIComponent(item.sessionId)}`);
    } catch {
      /* handled */
    }
  };

  const openRename = (item: TaskListItem) => {
    setRenameTarget(item);
    setRenameValue(item.title || item.rawTitle || '');
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (!title) {
      message.warning('标题不能为空');
      return;
    }
    if (title.length > 100) {
      message.warning('标题不能超过 100 个字符');
      return;
    }
    setRenaming(true);
    try {
      await updateTaskTitle(renameTarget.sessionId, title);
      message.success('已重命名');
      setRenameTarget(null);
      fetchData();
    } catch {
      /* handled */
    } finally {
      setRenaming(false);
    }
  };

  // Findings quick-view: fetch and open drawer.
  const openFindingsDrawer = useCallback(async (item: TaskListItem) => {
    setFindingsTask(item);
    setFindings([]);
    setFindingsLoading(true);
    try {
      const resp = await listFindings(item.sessionId);
      setFindings(resp?.findings ?? []);
      setRiskCountMap((prev) => ({
        ...prev,
        [item.sessionId]: Number(resp?.total ?? (resp?.findings?.length ?? 0)),
      }));
    } catch {
      /* handled */
    } finally {
      setFindingsLoading(false);
    }
  }, []);

  const loadRiskCount = useCallback(async (item: TaskListItem) => {
    const sessionId = item.sessionId;
    if (!sessionId) return;
    if (riskCountMap[sessionId] !== undefined || riskCountLoadingMap[sessionId]) return;

    setRiskCountLoadingMap((prev) => ({ ...prev, [sessionId]: true }));
    try {
      const resp = await listFindings(sessionId);
      setRiskCountMap((prev) => ({
        ...prev,
        [sessionId]: Number(resp?.total ?? (resp?.findings?.length ?? 0)),
      }));
    } catch {
      setRiskCountMap((prev) => ({ ...prev, [sessionId]: 0 }));
    } finally {
      setRiskCountLoadingMap((prev) => ({ ...prev, [sessionId]: false }));
    }
  }, [riskCountMap, riskCountLoadingMap]);

  // Apply client-side status filter on top of server-side text/type filtering
  // so users can narrow down without re-fetching.
  const filtered = useMemo(
    () => data.filter((t) => statusMatches(t.status, statusFilter)),
    [data, statusFilter],
  );

  useEffect(() => {
    const candidates = filtered
      .slice(0, 20)
      .filter((item) => riskCountMap[item.sessionId] === undefined && !riskCountLoadingMap[item.sessionId]);
    if (!candidates.length) return;
    candidates.forEach((item) => {
      void loadRiskCount(item);
    });
  }, [filtered, loadRiskCount, riskCountMap, riskCountLoadingMap]);

  const columns = useMemo<ColumnsType<TaskListItem>>(
    () => [
      {
        title: '任务',
        dataIndex: 'title',
        key: 'title',
        ellipsis: true,
        render: (v: string | undefined, item) => (
          <Space size={4}>
            <Link to={`/tasks/${encodeURIComponent(item.sessionId)}`}>
              {v || item.rawTitle || (
                <span style={{ color: '#999' }}>(未命名)</span>
              )}
            </Link>
            <Tooltip title="重命名">
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={() => openRename(item)}
              />
            </Tooltip>
          </Space>
        ),
      },
      {
        title: '类型',
        dataIndex: 'taskType',
        key: 'taskType',
        width: 180,
        render: (v: string) => <Tag>{TASK_TYPE_LABEL_MAP[v] ?? v}</Tag>,
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 110,
        render: (v: string) => {
          const key = normalizeTaskStatus(v);
          const label = STATUS_LABEL_MAP[key] ?? (v || '未知');
          return <Tag color={STATUS_COLORS[key] ?? 'default'}>{label}</Tag>;
        },
      },
      {
        title: '风险数',
        key: 'riskCount',
        width: 90,
        align: 'center',
        render: (_v, item) => {
          const count = riskCountMap[item.sessionId];
          const loadingCount = riskCountLoadingMap[item.sessionId] && count === undefined;
          if (loadingCount) {
            return <Spin size="small" />;
          }
          return (
            <Button
              size="small"
              type="link"
              style={{ padding: 0 }}
              onClick={() => openFindingsDrawer(item)}
            >
              {count ?? 0}
            </Button>
          );
        },
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 170,
        render: formatTime,
      },
      {
        title: '更新时间',
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        width: 170,
        render: formatTime,
      },
      {
        title: '操作',
        key: 'actions',
        width: 220,
        render: (_v, item) => (
          <Space size="small" wrap>
            <Link to={`/tasks/${encodeURIComponent(item.sessionId)}`}>
              <Button size="small" type="link">
                详情
              </Button>
            </Link>
            <Button size="small" type="link" onClick={() => onClone(item)}>
              克隆
            </Button>
            <Popconfirm title="确认终止该任务?" onConfirm={() => onTerminate(item)}>
              <Button
                size="small"
                type="link"
                disabled={!isTaskRunning(item.status)}
              >
                终止
              </Button>
            </Popconfirm>
            <Popconfirm title="确认删除该任务?" onConfirm={() => onDelete(item)}>
              <Button size="small" type="link" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    // onClone / onTerminate / onDelete / openFindingsDrawer close over state;
    // re-derive columns when fetchData changes so handlers stay fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchData, openFindingsDrawer, riskCountLoadingMap, riskCountMap],
  );

  return (
    <Card>
      <PageHeader
        title="任务列表"
        description="按用户身份查询所有扫描任务，支持关键字、类型、状态过滤；含运行中任务时可自动刷新。"
        extra={
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                // Clear any stale clone payload so the create form starts fresh.
                sessionStorage.removeItem(TASK_CLONE_STORAGE_KEY);
                navigate('/tasks/new');
              }}
            >
              新建任务
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      />
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="搜索关键字"
          allowClear
          enterButton
          style={{ width: 280 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={() => fetchData()}
        />
        <Select
          style={{ width: 220 }}
          value={taskType}
          options={TASK_TYPE_OPTIONS}
          onChange={(v) => setTaskType(v)}
        />
        <Select
          style={{ width: 140 }}
          value={statusFilter}
          options={STATUS_OPTIONS}
          onChange={(v) => setStatusFilter(v)}
        />
        <Tooltip
          title={
            hasRunning
              ? `每 ${AUTO_REFRESH_INTERVAL_MS / 1000}s 自动刷新（仅当有运行中任务）`
              : '当前无运行中任务，无需自动刷新'
          }
        >
          <Space size={6}>
            <Switch
              size="small"
              checked={autoRefresh}
              onChange={setAutoRefresh}
              disabled={!hasRunning}
            />
            <Typography.Text type="secondary">自动刷新</Typography.Text>
          </Space>
        </Tooltip>
        {filtered.length !== data.length ? (
          <Typography.Text type="secondary">
            显示 {filtered.length} / 共 {data.length} 条
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">共 {data.length} 条</Typography.Text>
        )}
      </Space>
      <Table
        rowKey={(r) => r.sessionId}
        columns={columns}
        dataSource={filtered}
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        size="middle"
      />
      <Modal
        title="重命名任务"
        open={!!renameTarget}
        onCancel={() => setRenameTarget(null)}
        onOk={submitRename}
        confirmLoading={renaming}
        destroyOnClose
        okText="保存"
        cancelText="取消"
      >
        <Input
          autoFocus
          maxLength={100}
          showCount
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={submitRename}
          placeholder="输入新的任务标题"
        />
      </Modal>

      {/* ── Findings Quick-View Drawer ── */}
      <Drawer
        title={
          <Space>
            <EyeOutlined />
            <span>
              问题快速查看
              {findingsTask
                ? ` — ${findingsTask.title || findingsTask.rawTitle || findingsTask.sessionId.slice(0, 8)}`
                : ''}
            </span>
            {!findingsLoading && findings.length > 0 && (
              <Badge count={findings.length} color="red" />
            )}
          </Space>
        }
        width={760}
        open={!!findingsTask}
        onClose={() => setFindingsTask(null)}
        destroyOnClose
        extra={
          findingsTask && (
            <Link to={`/tasks/${encodeURIComponent(findingsTask.sessionId)}`}>
              <Button size="small" type="primary">
                查看完整详情
              </Button>
            </Link>
          )
        }
      >
        {findingsLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin tip="加载问题中…" />
          </div>
        ) : findings.length === 0 ? (
          <Empty description="暂无问题记录（任务可能尚未完成或无发现问题）" />
        ) : (
          <>
            {/* Severity summary badges */}
            <Space wrap style={{ marginBottom: 16 }}>
              {(['critical', 'high', 'medium', 'low', 'info'] as const).map((sev) => {
                const cnt = findings.filter(
                  (f) => normalizeSev(f.severity) === sev,
                ).length;
                if (!cnt) return null;
                return (
                  <Tag key={sev} color={SEVERITY_COLORS[sev]}>
                    {SEVERITY_LABELS[sev] ?? sev.toUpperCase()} × {cnt}
                  </Tag>
                );
              })}
            </Space>

            {/* Findings table */}
            <Table<Finding>
              rowKey="finding_id"
              size="small"
              pagination={{ pageSize: 15, showSizeChanger: false }}
              dataSource={[...findings].sort((a, b) => {
                const sevOrder = ['critical', 'high', 'medium', 'low', 'info', 'safe', 'unknown'];
                return sevOrder.indexOf(normalizeSev(a.severity)) - sevOrder.indexOf(normalizeSev(b.severity));
              })}
              columns={[
                {
                  title: '严重性',
                  dataIndex: 'severity',
                  key: 'severity',
                  width: 80,
                  render: (v) => {
                    const norm = normalizeSev(v);
                    return (
                      <Tag color={SEVERITY_COLORS[norm] ?? 'default'}>
                        {SEVERITY_LABELS[norm] ?? String(v).toUpperCase()}
                      </Tag>
                    );
                  },
                },
                {
                  title: '风险类型',
                  dataIndex: 'risk_type_display',
                  key: 'risk_type',
                  width: 140,
                  render: (v, record) => v || record.risk_type || '-',
                },
                {
                  title: '摘要',
                  dataIndex: 'evidence_summary',
                  key: 'evidence_summary',
                  ellipsis: true,
                  render: (v) => (
                    <Typography.Text ellipsis={{ tooltip: v }}>
                      {v || '-'}
                    </Typography.Text>
                  ),
                },
                {
                  title: '探针',
                  dataIndex: 'garak_probe_id',
                  key: 'probe',
                  width: 160,
                  ellipsis: true,
                  render: (v, record) =>
                    v ? (
                      <Typography.Text code style={{ fontSize: 11 }}>
                        {v}
                      </Typography.Text>
                    ) : record.source_engine ? (
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {record.source_engine}
                      </Typography.Text>
                    ) : (
                      '-'
                    ),
                },
                {
                  title: '处理状态',
                  dataIndex: 'status',
                  key: 'status',
                  width: 90,
                  render: (v) => {
                    const colorMap: Record<string, string> = {
                      open: 'red',
                      fixed: 'green',
                      accepted_risk: 'orange',
                      false_positive: 'default',
                    };
                    const labelMap: Record<string, string> = {
                      open: '待处理',
                      fixed: '已修复',
                      accepted_risk: '接受风险',
                      false_positive: '误报',
                    };
                    return (
                      <Tag color={colorMap[v] ?? 'default'}>
                        {labelMap[v] ?? v ?? '-'}
                      </Tag>
                    );
                  },
                },
              ]}
              expandable={{
                expandedRowRender: (record) => (
                  <Descriptions size="small" column={1} bordered>
                    {record.fix_recommendation && (
                      <Descriptions.Item label="修复建议">
                        {record.fix_recommendation}
                      </Descriptions.Item>
                    )}
                    {record.garak_detector_name && (
                      <Descriptions.Item label="检测器">
                        <Typography.Text code>
                          {record.garak_detector_name}
                        </Typography.Text>
                      </Descriptions.Item>
                    )}
                    {record.asset && (
                      <Descriptions.Item label="资产">
                        {record.asset}
                      </Descriptions.Item>
                    )}
                    {record.confidence !== undefined && (
                      <Descriptions.Item label="置信度">
                        {(record.confidence * 100).toFixed(1)}%
                      </Descriptions.Item>
                    )}
                  </Descriptions>
                ),
                rowExpandable: (record) =>
                  !!(
                    record.fix_recommendation ||
                    record.garak_detector_name ||
                    record.asset ||
                    record.confidence !== undefined
                  ),
              }}
            />
          </>
        )}
      </Drawer>
    </Card>
  );
}
