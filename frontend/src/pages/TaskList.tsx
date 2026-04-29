import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import PageHeader from '@/components/PageHeader';
import { deleteTask, listTasks, terminateTask } from '@/api/tasks';
import { isTaskRunning } from '@/utils/task';
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

const STATUS_COLORS: Record<string, string> = {
  pending: 'default',
  todo: 'default',
  doing: 'processing',
  running: 'processing',
  completed: 'success',
  failed: 'error',
  terminated: 'warning',
};

function formatTime(value: unknown): string {
  if (!value) return '-';
  const d = dayjs(value as string);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : String(value);
}

export default function TaskList() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TaskListItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [taskType, setTaskType] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await listTasks({ q: keyword || undefined, taskType: taskType || undefined });
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

  const columns = useMemo<ColumnsType<TaskListItem>>(
    () => [
      {
        title: '任务',
        dataIndex: 'title',
        key: 'title',
        ellipsis: true,
        render: (v: string | undefined, item) => (
          <Link to={`/tasks/${encodeURIComponent(item.sessionId)}`}>
            {v || item.rawTitle || (
              <span style={{ color: '#999' }}>(未命名)</span>
            )}
          </Link>
        ),
      },
      {
        title: '会话 ID',
        dataIndex: 'sessionId',
        key: 'sessionId',
        width: 280,
        ellipsis: true,
        render: (v: string) => <code>{v}</code>,
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
        width: 120,
        render: (v: string) => (
          <Tag color={STATUS_COLORS[v] ?? 'default'}>{v || 'unknown'}</Tag>
        ),
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 180,
        render: formatTime,
      },
      {
        title: '操作',
        key: 'actions',
        width: 220,
        render: (_v, item) => (
          <Space size="small">
            <Link to={`/tasks/${encodeURIComponent(item.sessionId)}`}>
              <Button size="small" type="link">
                详情
              </Button>
            </Link>
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
    [],
  );

  return (
    <Card>
      <PageHeader
        title="任务列表"
        description="按用户身份查询所有扫描任务，支持关键字搜索与按任务类型过滤。"
        extra={
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/tasks/new')}
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
      </Space>
      <Table
        rowKey={(r) => r.sessionId}
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        size="middle"
      />
    </Card>
  );
}
