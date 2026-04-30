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
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { listFingerprints } from '@/api/knowledge';
import type { Fingerprint } from '@/types/knowledge';

export default function FingerprintsPage() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Fingerprint[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [active, setActive] = useState<Fingerprint | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await listFingerprints({
        page,
        size,
        q: keyword || undefined,
      });
      setItems(resp?.items ?? []);
      setTotal(resp?.total ?? 0);
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  }, [page, size, keyword]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const columns = useMemo<ColumnsType<Fingerprint>>(
    () => [
      {
        title: '名称',
        dataIndex: ['info', 'name'],
        key: 'name',
        width: 220,
        render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
      },
      {
        title: '描述',
        dataIndex: ['info', 'desc'],
        key: 'desc',
        ellipsis: true,
      },
      {
        title: '作者',
        dataIndex: ['info', 'author'],
        key: 'author',
        width: 140,
      },
      {
        title: '标签',
        dataIndex: ['info', 'tags'],
        key: 'tags',
        width: 220,
        render: (tags?: string[]) =>
          tags && tags.length > 0 ? (
            <Space size={[4, 4]} wrap>
              {tags.map((t) => (
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

  return (
    <Card>
      <PageHeader
        title="AI 应用指纹"
        description="后端从 data/fingerprints/ 下加载的 YAML 指纹规则。可按名称、描述、作者模糊搜索。"
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
          placeholder="搜索名称 / 描述 / 作者"
          allowClear
          enterButton
          style={{ width: 320 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={() => {
            setPage(1);
            fetchData();
          }}
        />
      </Space>
      <Table
        rowKey={(r, idx) => r.info?.name ?? `__row_${idx}`}
        columns={columns}
        dataSource={items}
        loading={loading}
        size="middle"
        locale={{ emptyText: <Empty description="暂无指纹数据" /> }}
        pagination={{
          current: page,
          pageSize: size,
          total,
          showSizeChanger: true,
          onChange: (p, s) => {
            setPage(p);
            setSize(s);
          },
        }}
      />
      <Drawer
        title={active?.info?.name ?? '指纹详情'}
        width={560}
        open={!!active}
        onClose={() => setActive(null)}
        destroyOnClose
      >
        {active ? (
          <pre
            style={{
              background: '#f6f8fa',
              padding: 12,
              borderRadius: 4,
              overflow: 'auto',
              maxHeight: 'calc(100vh - 160px)',
            }}
          >
            {JSON.stringify(active, null, 2)}
          </pre>
        ) : null}
      </Drawer>
    </Card>
  );
}
