import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Rate,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { getEvaluationDetail, listEvaluations } from '@/api/knowledge';
import type { Evaluation, EvaluationDataItem } from '@/types/knowledge';

// Maximum number of prompt rows we render in the detail drawer. The full
// dataset can have thousands of items, so we cap rendering to keep the
// browser responsive. The full payload is still fetched and downloadable.
const MAX_PREVIEW_ITEMS = 100;

export default function EvaluationsPage() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Evaluation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [active, setActive] = useState<Evaluation | null>(null);
  const [detail, setDetail] = useState<Evaluation | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await listEvaluations({
        page,
        size,
        q: keyword || undefined,
      });
      setItems(resp?.items ?? []);
      setTotal(resp?.total ?? 0);
    } catch {
      /* handled by axios interceptor */
    } finally {
      setLoading(false);
    }
  }, [page, size, keyword]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openDetail = useCallback(async (item: Evaluation) => {
    setActive(item);
    setDetail(null);
    setDetailLoading(true);
    try {
      const full = await getEvaluationDetail(item.name);
      setDetail(full ?? item);
    } catch {
      // On failure fall back to the summary row we already have so the user
      // still sees metadata.
      setDetail(item);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const columns = useMemo<ColumnsType<Evaluation>>(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        width: 220,
        render: (v: string, row) => (
          <Space size={6}>
            <Typography.Text strong>{v}</Typography.Text>
            {row.default ? <Tag color="blue">默认</Tag> : null}
          </Space>
        ),
      },
      {
        title: '描述',
        dataIndex: 'description',
        key: 'description',
        ellipsis: true,
        render: (v: string, row) => <div><Tooltip title={row.description_zh || v}>{row.description_zh || v}</Tooltip></div>,
      },
      {
        title: '题目数',
        dataIndex: 'count',
        key: 'count',
        width: 90,
        sorter: (a, b) => (a.count || 0) - (b.count || 0),
      },
      {
        title: '语言',
        dataIndex: 'language',
        key: 'language',
        width: 80,
        render: (v?: string) => (v ? <Tag>{v}</Tag> : '-'),
      },
      {
        title: '推荐度',
        dataIndex: 'recommendation',
        key: 'recommendation',
        width: 130,
        render: (v?: number) =>
          typeof v === 'number' && v > 0 ? (
            <Rate disabled allowHalf value={v} style={{ fontSize: 12 }} />
          ) : (
            <span style={{ color: '#bbb' }}>-</span>
          ),
      },
      {
        title: '标签',
        dataIndex: 'tags',
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
          <Button type="link" size="small" onClick={() => openDetail(item)}>
            详情
          </Button>
        ),
      },
    ],
    [openDetail],
  );

  const previewData: EvaluationDataItem[] = useMemo(() => {
    const data = detail?.data;
    if (!Array.isArray(data)) return [];
    return data.slice(0, MAX_PREVIEW_ITEMS);
  }, [detail]);

  return (
    <Card>
      <PageHeader
        title="评测集"
        description="后端从 data/eval/ 下加载的越狱 / 红队评测集。可按名称、描述、作者或标签搜索。"
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
          placeholder="搜索名称 / 描述 / 作者 / 标签"
          allowClear
          enterButton
          style={{ width: 360 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={() => {
            setPage(1);
            fetchData();
          }}
        />
      </Space>
      <Table
        rowKey={(r, idx) => r.name || `__row_${idx}`}
        columns={columns}
        dataSource={items}
        loading={loading}
        size="middle"
        locale={{ emptyText: <Empty description="暂无评测集" /> }}
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
        title={active?.name || '评测集详情'}
        width={720}
        open={!!active}
        onClose={() => {
          setActive(null);
          setDetail(null);
        }}
        destroyOnClose
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : detail ? (
          <div>
            {detail.description_zh || detail.description ? (
              <Typography.Paragraph>
                {detail.description_zh || detail.description}
              </Typography.Paragraph>
            ) : null}
            <Space size={[8, 8]} wrap style={{ marginBottom: 12 }}>
              {detail.language ? <Tag>语言：{detail.language}</Tag> : null}
              {detail.author ? <Tag>作者：{detail.author}</Tag> : null}
              <Tag>题目数：{detail.count}</Tag>
              {detail.default ? <Tag color="blue">默认</Tag> : null}
              {typeof detail.recommendation === 'number' &&
                detail.recommendation > 0 ? (
                <span>
                  推荐度：
                  <Rate
                    disabled
                    allowHalf
                    value={detail.recommendation}
                    style={{ fontSize: 14, marginLeft: 4 }}
                  />
                </span>
              ) : null}
            </Space>
            {detail.tags && detail.tags.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <Typography.Text strong>标签：</Typography.Text>{' '}
                <Space size={[4, 4]} wrap>
                  {detail.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </Space>
              </div>
            ) : null}
            {detail.source && detail.source.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <Typography.Text strong>来源：</Typography.Text>
                <ul style={{ paddingLeft: 20, margin: '4px 0 0' }}>
                  {detail.source.map((s) => (
                    <li key={s}>
                      {/^https?:\/\//.test(s) ? (
                        <Typography.Link
                          href={s}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {s}
                        </Typography.Link>
                      ) : (
                        <Typography.Text>{s}</Typography.Text>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Typography.Title level={5} style={{ marginTop: 16 }}>
              示例题目
              {Array.isArray(detail.data) && detail.data.length > MAX_PREVIEW_ITEMS
                ? `（仅显示前 ${MAX_PREVIEW_ITEMS} / 共 ${detail.data.length} 条）`
                : ''}
            </Typography.Title>
            {previewData.length > 0 ? (
              <ol style={{ paddingLeft: 20 }}>
                {previewData.map((d, idx) => (
                  <li key={idx} style={{ marginBottom: 8 }}>
                    <Typography.Text>
                      {typeof d.prompt === 'string' && d.prompt
                        ? d.prompt
                        : JSON.stringify(d)}
                    </Typography.Text>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty description="无题目数据" />
            )}
          </div>
        ) : (
          <Empty description="无数据" />
        )}
      </Drawer>
    </Card>
  );
}
