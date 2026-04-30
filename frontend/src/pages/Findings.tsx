import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import PageHeader from '@/components/PageHeader';
import {
  findingsExportUrl,
  listFindings,
  updateFindingStatus,
} from '@/api/findings';
import type {
  Finding,
  FindingSeverity,
  FindingStatus,
  FindingsResponse,
} from '@/types/finding';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'magenta',
  high: 'red',
  medium: 'orange',
  low: 'gold',
  unknown: 'default',
};

const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'high', 'medium', 'low'];

const STATUS_OPTIONS: { value: FindingStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'fixed', label: '已修复' },
  { value: 'accepted_risk', label: '接受风险' },
  { value: 'false_positive', label: '误报' },
];

function severityRank(s: string): number {
  const idx = SEVERITY_ORDER.indexOf(s as FindingSeverity);
  return idx === -1 ? SEVERITY_ORDER.length : idx;
}

export default function FindingsPage() {
  const { scanId = '' } = useParams<{ scanId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<FindingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [active, setActive] = useState<Finding | null>(null);

  const fetchData = useCallback(async () => {
    if (!scanId) return;
    setLoading(true);
    try {
      const r = await listFindings(scanId);
      setData(r);
    } catch {
      // toast already shown
    } finally {
      setLoading(false);
    }
  }, [scanId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo<Finding[]>(() => {
    const all = data?.findings ?? [];
    return all.filter((f) => {
      if (severityFilter && f.severity !== severityFilter) return false;
      if (statusFilter && f.status !== statusFilter) return false;
      if (keyword) {
        const q = keyword.toLowerCase();
        const hay = [
          f.evidence_summary,
          f.fix_recommendation,
          f.risk_type,
          f.risk_type_display,
          f.asset,
          f.garak_probe_id,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, severityFilter, statusFilter, keyword]);

  const total = data?.total ?? 0;
  const bySev = data?.by_severity ?? {};
  const passRate = useMemo(() => {
    // Approximate pass rate as 1 - (high+critical)/total. The backend
    // exposes a precise value in metadata for Garak runs, but it is not
    // returned by /findings/:id.
    if (total === 0) return 1;
    const blocking = (bySev.critical || 0) + (bySev.high || 0);
    return Math.max(0, 1 - blocking / total);
  }, [bySev, total]);

  const onUpdateStatus = async (f: Finding, next: FindingStatus) => {
    try {
      await updateFindingStatus(f.finding_id, next);
      message.success('状态已更新');
      // Patch in place to avoid a full refetch.
      setData((d) =>
        d
          ? {
              ...d,
              findings: d.findings.map((x) =>
                x.finding_id === f.finding_id ? { ...x, status: next } : x,
              ),
            }
          : d,
      );
      if (active && active.finding_id === f.finding_id) {
        setActive({ ...active, status: next });
      }
    } catch {
      /* handled */
    }
  };

  const columns = useMemo<ColumnsType<Finding>>(
    () => [
      {
        title: '严重度',
        dataIndex: 'severity',
        key: 'severity',
        width: 110,
        sorter: (a, b) => severityRank(a.severity) - severityRank(b.severity),
        render: (s: string) => (
          <Tag color={SEVERITY_COLORS[s] ?? 'default'}>{s.toUpperCase()}</Tag>
        ),
      },
      {
        title: '风险类型',
        dataIndex: 'risk_type_display',
        key: 'risk_type_display',
        width: 160,
        render: (v: string, r) => v || r.risk_type,
      },
      {
        title: '证据摘要',
        dataIndex: 'evidence_summary',
        key: 'evidence_summary',
        ellipsis: true,
      },
      {
        title: '置信度',
        dataIndex: 'confidence',
        key: 'confidence',
        width: 110,
        sorter: (a, b) => a.confidence - b.confidence,
        render: (n: number) => (
          <Progress
            percent={Math.round(n)}
            size="small"
            showInfo
            format={(v) => `${v}%`}
          />
        ),
      },
      {
        title: '资产',
        dataIndex: 'asset',
        key: 'asset',
        width: 160,
        ellipsis: true,
        render: (v?: string) => v || '-',
      },
      {
        title: 'Probe',
        dataIndex: 'garak_probe_id',
        key: 'garak_probe_id',
        width: 160,
        ellipsis: true,
        render: (v?: string) => (v ? <code>{v}</code> : '-'),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 150,
        render: (s: FindingStatus, r) => (
          <Select
            size="small"
            value={s}
            options={STATUS_OPTIONS}
            style={{ width: 130 }}
            onChange={(v) => onUpdateStatus(r, v)}
          />
        ),
      },
      {
        title: '操作',
        key: 'actions',
        width: 90,
        render: (_v, r) => (
          <Button type="link" size="small" onClick={() => setActive(r)}>
            详情
          </Button>
        ),
      },
    ],
    [active],
  );

  return (
    <>
      <PageHeader
        title="评估报告"
        description={
          <Space size={12}>
            <span>
              扫描 ID：<code>{scanId}</code>
            </span>
            {data ? (
              <span>共 {data.total} 项发现</span>
            ) : null}
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() =>
                navigate(`/tasks/${encodeURIComponent(scanId)}`)
              }
            >
              返回任务
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              href={findingsExportUrl(scanId)}
              target="_blank"
            >
              导出 JSON
            </Button>
          </Space>
        }
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="总发现数" value={total} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="探针通过率"
              value={(passRate * 100).toFixed(1)}
              suffix="%"
              valueStyle={{
                color:
                  passRate >= 0.9
                    ? '#52c41a'
                    : passRate >= 0.7
                    ? '#faad14'
                    : '#cf1322',
              }}
            />
          </Card>
        </Col>
        {SEVERITY_ORDER.map((sev) => (
          <Col xs={12} md={3} key={sev}>
            <Card size="small">
              <Statistic
                title={sev.toUpperCase()}
                value={bySev[sev] ?? 0}
                valueStyle={{ color: severityStatColor(sev) }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="搜索证据 / 修复建议 / 资产 / probe"
            allowClear
            style={{ width: 320 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            placeholder="按严重度过滤"
            allowClear
            style={{ width: 160 }}
            value={severityFilter || undefined}
            onChange={(v) => setSeverityFilter(v || '')}
            options={SEVERITY_ORDER.map((v) => ({
              value: v,
              label: v.toUpperCase(),
            }))}
          />
          <Select
            placeholder="按状态过滤"
            allowClear
            style={{ width: 160 }}
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            options={STATUS_OPTIONS}
          />
        </Space>
        <Table
          rowKey="finding_id"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          size="middle"
          locale={{ emptyText: <Empty description="暂无 Finding" /> }}
        />
      </Card>

      <Drawer
        title={active ? `${active.severity.toUpperCase()} · ${active.risk_type_display || active.risk_type}` : ''}
        width={640}
        open={!!active}
        onClose={() => setActive(null)}
        destroyOnClose
      >
        {active ? (
          <>
            <Typography.Title level={5}>证据摘要</Typography.Title>
            <Typography.Paragraph>{active.evidence_summary}</Typography.Paragraph>

            <Typography.Title level={5}>修复建议</Typography.Title>
            <Typography.Paragraph>{active.fix_recommendation || '-'}</Typography.Paragraph>

            <Typography.Title level={5}>元数据</Typography.Title>
            <Space direction="vertical" size={4} style={{ marginBottom: 12 }}>
              <span>
                Finding ID：<code>{active.finding_id}</code>
              </span>
              <span>
                Confidence：{active.confidence}%
              </span>
              {active.asset ? <span>Asset：{active.asset}</span> : null}
              {active.garak_probe_id ? (
                <span>
                  Probe：<code>{active.garak_probe_id}</code>
                </span>
              ) : null}
              {active.garak_detector_name ? (
                <span>
                  Detector：<code>{active.garak_detector_name}</code>
                </span>
              ) : null}
              {active.source_engine ? (
                <span>Source engine：{active.source_engine}</span>
              ) : null}
              {active.created_at ? (
                <span>
                  Created：{dayjs(active.created_at).format('YYYY-MM-DD HH:mm:ss')}
                </span>
              ) : null}
            </Space>

            {active.evidence_detail ? (
              <>
                <Typography.Title level={5}>Evidence Detail</Typography.Title>
                <pre
                  style={{
                    background: '#f6f8fa',
                    padding: 12,
                    borderRadius: 4,
                    overflow: 'auto',
                    maxHeight: 240,
                  }}
                >
                  {JSON.stringify(active.evidence_detail, null, 2)}
                </pre>
              </>
            ) : null}
            {active.raw_metadata ? (
              <>
                <Typography.Title level={5}>Raw Metadata</Typography.Title>
                <pre
                  style={{
                    background: '#f6f8fa',
                    padding: 12,
                    borderRadius: 4,
                    overflow: 'auto',
                    maxHeight: 240,
                  }}
                >
                  {JSON.stringify(active.raw_metadata, null, 2)}
                </pre>
              </>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </>
  );
}

function severityStatColor(sev: string): string {
  switch (sev) {
    case 'critical':
      return '#c41d7f';
    case 'high':
      return '#cf1322';
    case 'medium':
      return '#d46b08';
    case 'low':
      return '#d4b106';
    default:
      return '#999';
  }
}
