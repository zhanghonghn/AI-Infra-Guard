import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  EditOutlined,
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
import { isTaskRunning, TASK_CLONE_STORAGE_KEY } from '@/utils/task';
import type { TaskListItem } from '@/types/task';

// Task types — both shapes are accepted by the backend filter:
// in-app tasks store PascalCase-with-dashes (AI-Infra-Scan), while the
// third-party taskapi/* endpoint stores lowercase_underscored values.
const TASK_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'AI-Infra-Scan', label: 'AI Infra Scan (in-app)' },
  { value: 'Mcp-Scan', label: 'MCP Scan (in-app)' },
  { value: 'Agent-Scan', label: 'Agent Scan (in-app)' },
  { value: 'Model-Redteam-Report', label: 'Model Redteam (in-app)' },
  { value: 'Garak-Scan', label: 'Garak Scan (in-app)' },
  { value: 'ai_infra_scan', label: 'AI Infra Scan (taskapi)' },
  { value: 'mcp_scan', label: 'MCP Scan (taskapi)' },
  { value: 'agent_scan', label: 'Agent Scan (taskapi)' },
  { value: 'model_redteam_report', label: 'Model Redteam (taskapi)' },
  { value: 'garak_scan', label: 'Garak Scan (taskapi)' },
];

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'running', label: '运行中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'terminated', label: '已终止' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'default',
  todo: 'default',
  doing: 'processing',
  running: 'processing',
  completed: 'success',
  failed: 'error',
  terminated: 'warning',
};

// Map a STATUS_OPTIONS bucket to the set of raw status strings it covers.
function statusMatches(rowStatus: string | undefined, bucket: string): boolean {
  if (!bucket) return true;
  const v = (rowStatus || '').toLowerCase();
  switch (bucket) {
    case 'running':
      return v === 'running' || v === 'doing' || v === 'pending' || v === 'todo';
    case 'completed':
      return v === 'completed' || v === 'success';
    case 'failed':
      return v === 'failed' || v === 'error';
    case 'terminated':
      return v === 'terminated';
    default:
      return v === bucket;
  }
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

  // Apply client-side status filter on top of server-side text/type filtering
  // so users can narrow down without re-fetching.
  const filtered = useMemo(
    () => data.filter((t) => statusMatches(t.status, statusFilter)),
    [data, statusFilter],
  );

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
        title: '会话 ID',
        dataIndex: 'sessionId',
        key: 'sessionId',
        width: 280,
        ellipsis: true,
        render: (v: string) => (
          <Typography.Text
            code
            copyable={{ text: v, tooltips: ['复制', '已复制'] }}
            style={{ fontSize: 12 }}
          >
            {v}
          </Typography.Text>
        ),
      },
      {
        title: '类型',
        dataIndex: 'taskType',
        key: 'taskType',
        width: 180,
        render: (v: string) => <Tag>{v}</Tag>,
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 110,
        render: (v: string) => (
          <Tag color={STATUS_COLORS[v] ?? 'default'}>{v || 'unknown'}</Tag>
        ),
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
        width: 240,
        render: (_v, item) => (
          <Space size="small">
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
    // onClone / onTerminate / onDelete close over `fetchData`; re-derive
    // columns when the loader identity changes so handlers stay fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchData],
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
    </Card>
  );
}
