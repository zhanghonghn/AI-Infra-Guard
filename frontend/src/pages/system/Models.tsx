import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import {
  createModel,
  deleteModels,
  listModels,
  updateModel,
} from '@/api/models';
import type { ModelConfig, ModelEntry } from '@/types/model';

const MASKED = '********';

interface FormValues {
  model_id: string;
  model: string;
  base_url: string;
  token: string;
  note?: string;
  limit?: number;
}

/** A YAML-defined model has a `default` array and is read-only. */
function isYamlModel(m: ModelEntry): boolean {
  return Array.isArray(m.default);
}

export default function ModelsPage() {
  const [data, setData] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<ModelEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listModels();
      setData(list ?? []);
    } catch {
      // toast already shown
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const userModels = useMemo(
    () => data.filter((m) => !isYamlModel(m)),
    [data],
  );

  // The select-able rows must exclude YAML models, which are read-only.
  const rowSelection = {
    selectedRowKeys: selected,
    onChange: (keys: React.Key[]) => setSelected(keys.map((k) => String(k))),
    getCheckboxProps: (m: ModelEntry) => ({
      disabled: isYamlModel(m),
    }),
  };

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    form.resetFields();
    form.setFieldsValue({ limit: 1000 });
  };

  const openEdit = (m: ModelEntry) => {
    setEditing(m);
    setCreating(false);
    form.setFieldsValue({
      model_id: m.model_id,
      model: m.model.model,
      base_url: m.model.base_url,
      token: '',
      note: m.model.note,
      limit: m.model.limit,
    });
  };

  const closeModal = () => {
    setEditing(null);
    setCreating(false);
    form.resetFields();
  };

  const onSubmit = async () => {
    let v: FormValues;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    const model: ModelConfig = {
      model: v.model,
      // For edits, an empty token preserves the existing one (backend
      // contract). For creates the field is required.
      token: v.token || (editing ? MASKED : ''),
      base_url: v.base_url,
      note: v.note,
      limit: v.limit,
    };
    try {
      if (editing) {
        await updateModel(editing.model_id, { model });
        message.success('已更新');
      } else {
        await createModel({ model_id: v.model_id, model });
        message.success('已创建');
      }
      closeModal();
      fetchData();
    } catch {
      /* handled */
    }
  };

  const onDeleteOne = async (m: ModelEntry) => {
    try {
      await deleteModels([m.model_id]);
      message.success('已删除');
      setSelected((s) => s.filter((id) => id !== m.model_id));
      fetchData();
    } catch {
      /* handled */
    }
  };

  const onDeleteSelected = async () => {
    if (selected.length === 0) return;
    try {
      await deleteModels(selected);
      message.success(`已删除 ${selected.length} 个模型`);
      setSelected([]);
      fetchData();
    } catch {
      /* handled */
    }
  };

  const columns = useMemo<ColumnsType<ModelEntry>>(
    () => [
      {
        title: '模型 ID',
        dataIndex: 'model_id',
        key: 'model_id',
        width: 220,
        render: (v: string, m) => (
          <Space size={4}>
            <code>{v}</code>
            {isYamlModel(m) ? <Tag color="blue">YAML</Tag> : null}
          </Space>
        ),
      },
      {
        title: '模型名',
        dataIndex: ['model', 'model'],
        key: 'model_name',
        width: 200,
      },
      {
        title: 'Base URL',
        dataIndex: ['model', 'base_url'],
        key: 'base_url',
        ellipsis: true,
      },
      {
        title: '默认任务',
        dataIndex: 'default',
        key: 'default',
        width: 240,
        render: (vs?: string[]) =>
          vs && vs.length > 0
            ? vs.map((v) => <Tag key={v}>{v}</Tag>)
            : '-',
      },
      {
        title: 'Limit',
        dataIndex: ['model', 'limit'],
        key: 'limit',
        width: 100,
        render: (v?: number) => v ?? '-',
      },
      {
        title: '备注',
        dataIndex: ['model', 'note'],
        key: 'note',
        ellipsis: true,
        render: (v?: string) => v || '-',
      },
      {
        title: '操作',
        key: 'actions',
        width: 180,
        fixed: 'right',
        render: (_v, m) => {
          const yaml = isYamlModel(m);
          return (
            <Space size="small">
              <Button
                size="small"
                type="link"
                icon={<EditOutlined />}
                disabled={yaml}
                onClick={() => openEdit(m)}
              >
                编辑
              </Button>
              <Popconfirm
                title="确认删除该模型?"
                onConfirm={() => onDeleteOne(m)}
                disabled={yaml}
              >
                <Button
                  size="small"
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={yaml}
                >
                  删除
                </Button>
              </Popconfirm>
            </Space>
          );
        },
      },
    ],
    [],
  );

  const open = creating || editing !== null;

  return (
    <Card>
      <PageHeader
        title="模型管理"
        description={
          <span>
            共 {data.length} 个模型（用户 {userModels.length} 个，YAML{' '}
            {data.length - userModels.length} 个）。YAML 模型只读，需修改请编辑{' '}
            <code>db/model.yaml</code>。
          </span>
        }
        extra={
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreate}
            >
              新建模型
            </Button>
            <Popconfirm
              title={`确认删除选中的 ${selected.length} 个模型?`}
              onConfirm={onDeleteSelected}
              disabled={selected.length === 0}
            >
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={selected.length === 0}
              >
                批量删除
              </Button>
            </Popconfirm>
            <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="API Token 保存后会被掩码为 ********。编辑时若不填新 token，原 token 将被保留。"
      />

      <Table
        rowKey="model_id"
        loading={loading}
        columns={columns}
        dataSource={data}
        rowSelection={rowSelection}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        scroll={{ x: 1100 }}
        size="middle"
      />

      <Modal
        title={editing ? `编辑模型 — ${editing.model_id}` : '新建模型'}
        open={open}
        onOk={onSubmit}
        onCancel={closeModal}
        width={640}
        okText={editing ? '更新' : '创建'}
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item
            name="model_id"
            label="模型 ID"
            rules={[
              { required: true, message: '请填写模型 ID' },
              {
                pattern: /^[A-Za-z0-9._-]+$/,
                message: '只允许字母、数字、点、下划线、连字符',
              },
            ]}
          >
            <Input
              placeholder="my-gpt4-model"
              disabled={!!editing}
              autoComplete="off"
            />
          </Form.Item>
          <Form.Item
            name="model"
            label="模型名"
            rules={[{ required: true, message: '请填写模型名' }]}
          >
            <Input placeholder="gpt-4 / deepseek-chat / qwen-max" />
          </Form.Item>
          <Form.Item
            name="base_url"
            label="Base URL"
            rules={[{ required: true, message: '请填写 Base URL' }]}
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            name="token"
            label={
              editing
                ? 'API Token（留空则不修改原值）'
                : 'API Token'
            }
            rules={editing ? [] : [{ required: true, message: '请填写 token' }]}
          >
            <Input.Password
              autoComplete="new-password"
              placeholder={editing ? '留空表示不修改' : 'sk-...'}
            />
          </Form.Item>
          <Form.Item name="limit" label="请求上限 (可选)">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="备注 (可选)">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
        {editing ? (
          <Typography.Text type="secondary">
            后端会校验 token / base_url 的可用性。
          </Typography.Text>
        ) : null}
      </Modal>
    </Card>
  );
}
