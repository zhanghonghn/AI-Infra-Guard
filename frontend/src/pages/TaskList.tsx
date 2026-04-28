import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import PageHeader from '@/components/PageHeader';
import { deleteTask, listTasks, terminateTask } from '@/api/tasks';
import type { TaskListItem } from '@/types/task';

// Tasks supported by the backend (see common/websocket/task.go).
const TASK_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'ai_infra_scan', label: 'AI Infra Scan' },
  { value: 'mcp_scan', label: 'MCP Scan' },
  { value: 'agent_scan', label: 'Agent Scan' },
  { value: 'model_redteam_report', label: 'Model Redteam' },
  { value: 'garak_scan', label: 'Garak Scan' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'default',
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
        title: '会话 ID',
        dataIndex: 'sessionId',
        key: 'sessionId',
        width: 280,
        ellipsis: true,
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: '名称',
        dataIndex: 'taskName',
        key: 'taskName',
        ellipsis: true,
        render: (v?: string) => v || <span style={{ color: '#999' }}>(未命名)</span>,
      },
      {
        title: '类型',
        dataIndex: 'taskType',
        key: 'taskType',
        width: 160,
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
        width: 200,
        render: (_v, item) => (
          <Space size="small">
            <Popconfirm title="确认终止该任务?" onConfirm={() => onTerminate(item)}>
              <Button size="small" type="link" disabled={item.status !== 'running'}>
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
          <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
            刷新
          </Button>
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
          style={{ width: 180 }}
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
