import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Space,
  Table,
  Tag,
  Tabs,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { listMcpPlugins } from '@/api/knowledge';
import type { McpPlugin } from '@/types/knowledge';

// MCP HandleList does not support server-side pagination / search yet, so we
// fetch once and filter / paginate client-side. This keeps the UX consistent
// with the other knowledge pages without requiring backend changes.
function matches(plugin: McpPlugin, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const info = plugin.info ?? ({} as McpPlugin['info']);
  if (info.name && info.name.toLowerCase().includes(needle)) return true;
  if (info.id && info.id.toLowerCase().includes(needle)) return true;
  if (info.description && info.description.toLowerCase().includes(needle))
    return true;
  if (info.author && info.author.toLowerCase().includes(needle)) return true;
  if (info.category) {
    for (const c of info.category) {
      if (c && c.toLowerCase().includes(needle)) return true;
    }
  }
  return false;
}

export default function McpPluginsPage() {
  const [loading, setLoading] = useState(false);
  const [allItems, setAllItems] = useState<McpPlugin[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [active, setActive] = useState<McpPlugin | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await listMcpPlugins();
      setAllItems(resp?.items ?? []);
    } catch {
      /* handled by axios interceptor */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(
    () => allItems.filter((p) => matches(p, keyword)),
    [allItems, keyword],
  );

  const paged = useMemo(() => {
    const start = (page - 1) * size;
    return filtered.slice(start, start + size);
  }, [filtered, page, size]);

  const columns = useMemo<ColumnsType<McpPlugin>>(
    () => [
      {
        title: 'ID',
        dataIndex: ['info', 'id'],
        key: 'id',
        width: 200,
        render: (v: string) => <Typography.Text code>{v || '-'}</Typography.Text>,
      },
      {
        title: '名称',
        dataIndex: ['info', 'name'],
        key: 'name',
        width: 200,
        render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
      },
      {
        title: '描述',
        dataIndex: ['info', 'description'],
        key: 'description',
        ellipsis: true,
      },
      {
        title: '作者',
        dataIndex: ['info', 'author'],
        key: 'author',
        width: 140,
      },
      {
        title: '分类',
        dataIndex: ['info', 'category'],
        key: 'category',
        width: 200,
        render: (cats?: string[]) =>
          cats && cats.length > 0 ? (
            <Space size={[4, 4]} wrap>
              {cats.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </Space>
          ) : (
            <span style={{ color: '#bbb' }}>-</span>
          ),
      },
      {
        title: '操作',
        key: 'actions',
        width: 100,
        render: (_v, item) => (
          <Button type="link" size="small" onClick={() => setActive(item)}>
            详情
          </Button>
        ),
      },
    ],
    [],
  );

  const detailTabs = active
    ? [
        {
          key: 'overview',
          label: '概览',
          children: (
            <div>
              <Typography.Paragraph>
                <Typography.Text strong>ID：</Typography.Text>
                <Typography.Text code copyable={!!active.info?.id}>
                  {active.info?.id || '-'}
                </Typography.Text>
              </Typography.Paragraph>
              {active.info?.description ? (
                <Typography.Paragraph>
                  <Typography.Text strong>描述：</Typography.Text>
                  <br />
                  {active.info.description}
                </Typography.Paragraph>
              ) : null}
              {active.info?.category && active.info.category.length > 0 ? (
                <Space size={[4, 4]} wrap style={{ marginBottom: 12 }}>
                  {active.info.category.map((c) => (
                    <Tag key={c}>{c}</Tag>
                  ))}
                </Space>
              ) : null}
              {active.prompt_template ? (
                <>
                  <Typography.Text strong>Prompt Template：</Typography.Text>
                  <pre
                    style={{
                      background: '#f6f8fa',
                      padding: 12,
                      borderRadius: 4,
                      overflow: 'auto',
                      maxHeight: 320,
                    }}
                  >
                    {active.prompt_template}
                  </pre>
                </>
              ) : null}
            </div>
          ),
        },
        {
          key: 'rules',
          label: `规则 (${active.rules?.length ?? 0})`,
          children:
            active.rules && active.rules.length > 0 ? (
              <ul style={{ paddingLeft: 20 }}>
                {active.rules.map((r, idx) => (
                  <li key={`${r.name ?? 'rule'}_${idx}`}>
                    <Typography.Text strong>{r.name || '(unnamed)'}</Typography.Text>
                    {r.description ? <span> — {r.description}</span> : null}
                    {r.pattern ? (
                      <pre
                        style={{
                          background: '#f6f8fa',
                          padding: 8,
                          borderRadius: 4,
                          overflow: 'auto',
                          margin: '6px 0',
                        }}
                      >
                        {r.pattern}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty description="该插件未声明规则" />
            ),
        },
        {
          key: 'raw',
          label: 'YAML',
          children: (
            <pre
              style={{
                background: '#f6f8fa',
                padding: 12,
                borderRadius: 4,
                overflow: 'auto',
                maxHeight: 'calc(100vh - 220px)',
              }}
            >
              {active.raw_data || '(no raw_data returned by backend)'}
            </pre>
          ),
        },
      ]
    : [];

  return (
    <Card>
      <PageHeader
        title="MCP 插件"
        description="后端从 data/mcp/ 下加载的 MCP 安全扫描插件配置。搜索与分页在前端完成。"
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => fetchData()}
            loading={loading}
          >
            刷新
          </Button>
        }
      />
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="搜索 ID / 名称 / 描述 / 作者 / 分类"
          allowClear
          enterButton
          style={{ width: 360 }}
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
        />
      </Space>
      <Table
        rowKey={(r, idx) =>
          r.info?.id ? `${r.info.id}__${idx}` : `__row_${idx}`
        }
        columns={columns}
        dataSource={paged}
        loading={loading}
        size="middle"
        locale={{ emptyText: <Empty description="暂无 MCP 插件" /> }}
        pagination={{
          current: page,
          pageSize: size,
          total: filtered.length,
          showSizeChanger: true,
          onChange: (p, s) => {
            setPage(p);
            setSize(s);
          },
        }}
      />
      <Drawer
        title={active?.info?.name || active?.info?.id || 'MCP 插件详情'}
        width={720}
        open={!!active}
        onClose={() => setActive(null)}
        destroyOnClose
      >
        {active ? <Tabs items={detailTabs} /> : null}
      </Drawer>
    </Card>
  );
}
