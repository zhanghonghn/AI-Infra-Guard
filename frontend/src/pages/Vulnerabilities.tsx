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
import { listVulnerabilities } from '@/api/knowledge';
import type { Vulnerability } from '@/types/knowledge';

// Map the free-form severity strings used in data/vuln/*.yaml onto Ant Design
// Tag preset colors. Anything we don't recognise renders as a neutral tag.
function severityColor(sev?: string): string {
  switch ((sev || '').toLowerCase()) {
    case 'critical':
      return 'magenta';
    case 'high':
      return 'red';
    case 'medium':
    case 'moderate':
      return 'orange';
    case 'low':
      return 'gold';
    case 'info':
    case 'informational':
      return 'blue';
    default:
      return 'default';
  }
}

export default function VulnerabilitiesPage() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Vulnerability[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [active, setActive] = useState<Vulnerability | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await listVulnerabilities({
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

  const columns = useMemo<ColumnsType<Vulnerability>>(
    () => [
      {
        title: 'CVE',
        dataIndex: ['info', 'cve'],
        key: 'cve',
        width: 200,
        render: (v: string) => (
          <Typography.Text strong copyable={!!v}>
            {v || '-'}
          </Typography.Text>
        ),
      },
      {
        title: '组件',
        dataIndex: ['info', 'name'],
        key: 'name',
        width: 180,
      },
      {
        title: '严重度',
        dataIndex: ['info', 'severity'],
        key: 'severity',
        width: 110,
        render: (sev?: string) =>
          sev ? <Tag color={severityColor(sev)}>{sev}</Tag> : '-',
      },
      {
        title: 'CVSS',
        dataIndex: ['info', 'cvss'],
        key: 'cvss',
        width: 80,
        render: (v?: string) => v || '-',
      },
      {
        title: '摘要',
        dataIndex: ['info', 'summary'],
        key: 'summary',
        ellipsis: true,
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
        title="漏洞库"
        description="后端从 data/vuln/ 下加载的 CVE 规则，可按 CVE 编号、组件名、摘要、详情或参考链接模糊搜索。"
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
          placeholder="搜索 CVE / 组件 / 摘要 / 详情"
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
        rowKey={(r, idx) =>
          r.info?.cve ? `${r.info.cve}__${idx}` : `__row_${idx}`
        }
        columns={columns}
        dataSource={items}
        loading={loading}
        size="middle"
        locale={{ emptyText: <Empty description="暂无漏洞数据" /> }}
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
        title={active?.info?.cve || active?.info?.name || '漏洞详情'}
        width={640}
        open={!!active}
        onClose={() => setActive(null)}
        destroyOnClose
      >
        {active ? (
          <div>
            <Space size={[8, 8]} wrap style={{ marginBottom: 12 }}>
              {active.info?.severity ? (
                <Tag color={severityColor(active.info.severity)}>
                  {active.info.severity}
                </Tag>
              ) : null}
              {active.info?.cvss ? (
                <Tag color="purple">CVSS {active.info.cvss}</Tag>
              ) : null}
              {active.info?.author ? (
                <Tag>作者：{active.info.author}</Tag>
              ) : null}
            </Space>
            {active.info?.summary ? (
              <Typography.Paragraph>
                <Typography.Text strong>摘要：</Typography.Text>
                {active.info.summary}
              </Typography.Paragraph>
            ) : null}
            {active.info?.details ? (
              <Typography.Paragraph>
                <Typography.Text strong>详情：</Typography.Text>
                <br />
                <Typography.Text>{active.info.details}</Typography.Text>
              </Typography.Paragraph>
            ) : null}
            {active.info?.security_advise ? (
              <Typography.Paragraph>
                <Typography.Text strong>修复建议：</Typography.Text>
                <br />
                <Typography.Text>{active.info.security_advise}</Typography.Text>
              </Typography.Paragraph>
            ) : null}
            {active.rule ? (
              <>
                <Typography.Text strong>匹配规则：</Typography.Text>
                <pre
                  style={{
                    background: '#f6f8fa',
                    padding: 12,
                    borderRadius: 4,
                    overflow: 'auto',
                  }}
                >
                  {active.rule}
                </pre>
              </>
            ) : null}
            {active.references && active.references.length > 0 ? (
              <>
                <Typography.Text strong>参考链接：</Typography.Text>
                <ul style={{ paddingLeft: 20 }}>
                  {active.references.map((r) => (
                    <li key={r}>
                      <Typography.Link href={r} target="_blank" rel="noreferrer">
                        {r}
                      </Typography.Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </Card>
  );
}
