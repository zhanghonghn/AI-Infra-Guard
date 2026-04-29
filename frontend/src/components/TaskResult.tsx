import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Drawer,
  Empty,
  Image,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { listFindings, updateFindingStatus } from '@/api/findings';
import type { Finding, FindingStatus } from '@/types/finding';

const { Paragraph, Text, Title } = Typography;

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'magenta',
  high: 'red',
  medium: 'orange',
  low: 'gold',
  info: 'blue',
  unknown: 'default',
  safe: 'green',
};

const STATUS_COLORS: Record<string, string> = {
  Jailbreak: 'red',
  Safe: 'green',
  Exception: 'orange',
  SimulationFailed: 'default',
};

function normalizeSeverity(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return 'unknown';
  // Map e.g. "HIGH" / "High" / "high" / "严重" / "高危" to canonical.
  if (s === '严重' || s === 'critical') return 'critical';
  if (s === '高危' || s === '高' || s === 'high') return 'high';
  if (s === '中危' || s === '中' || s === 'medium' || s === 'med') return 'medium';
  if (s === '低危' || s === '低' || s === 'low') return 'low';
  if (s === 'info' || s === 'informational') return 'info';
  if (s === 'safe' || s === '安全' || s === 'none') return 'safe';
  return s;
}

function severityRank(raw: unknown): number {
  const s = normalizeSeverity(raw);
  const order = ['critical', 'high', 'medium', 'low', 'info', 'safe', 'unknown'];
  const idx = order.indexOf(s);
  return idx === -1 ? order.length : idx;
}

function SeverityTag({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === '') return null;
  const norm = normalizeSeverity(value);
  return (
    <Tag color={SEVERITY_COLORS[norm] ?? 'default'}>
      {String(value).toUpperCase()}
    </Tag>
  );
}

/** Render a string as paragraph text preserving newlines. Markdown source
 *  is shown as-is — we don't bring in a markdown parser to keep the
 *  bundle lean, but the surrounding cards + monospaced code blocks make
 *  it readable enough. */
function MarkdownLite({
  text,
  maxHeight,
}: {
  text: string;
  maxHeight?: number;
}) {
  if (!text) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <div
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        background: '#fafafa',
        border: '1px solid #f0f0f0',
        borderRadius: 4,
        padding: 12,
        maxHeight,
        overflow: maxHeight ? 'auto' : undefined,
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      {text}
    </div>
  );
}

function RawJson({
  payload,
  defaultOpen = false,
}: {
  payload: unknown;
  defaultOpen?: boolean;
}) {
  return (
    <Collapse
      ghost
      size="small"
      defaultActiveKey={defaultOpen ? ['raw'] : []}
      items={[
        {
          key: 'raw',
          label: '原始 JSON',
          children: (
            <pre
              style={{
                background: '#f6f8fa',
                padding: 12,
                borderRadius: 4,
                margin: 0,
                maxHeight: 360,
                overflow: 'auto',
                fontSize: 12,
              }}
            >
              {JSON.stringify(payload, null, 2)}
            </pre>
          ),
        },
      ]}
    />
  );
}

/** Truncate to a one-line preview for table cells. */
function preview(text: unknown, max = 80): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/* ------------------------------------------------------------------ */
/* AI-Infra-Scan                                                       */
/* ------------------------------------------------------------------ */

interface AIVuln {
  name?: string;
  cve?: string;
  summary?: string;
  details?: string;
  cvss?: string;
  severity?: string;
  security_advise?: string;
  references?: string[];
  author?: string;
}

interface AIScanResult {
  target_url?: string;
  status_code?: number;
  title?: string;
  fingerprint?: string;
  vulnerabilities?: AIVuln[];
  screenshot?: string;
  reason?: string;
  summary?: string;
}

function AIInfraScanResult({ result }: { result: Record<string, unknown> }) {
  const score = (result.score as number | undefined) ?? null;
  const total = (result.total as number | undefined) ?? 0;
  const rows = ((result.results as AIScanResult[] | undefined) ?? []).map(
    (r, idx) => ({ ...r, key: `${r.target_url ?? 'row'}-${idx}` }),
  );

  // Severity counts across all targets.
  const sevCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      for (const v of r.vulnerabilities ?? []) {
        const k = normalizeSeverity(v.severity);
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    return counts;
  }, [rows]);

  const targetsWithVulns = rows.filter(
    (r) => (r.vulnerabilities?.length ?? 0) > 0,
  ).length;

  const columns: ColumnsType<AIScanResult & { key: string }> = [
    {
      title: '目标',
      dataIndex: 'target_url',
      key: 'target_url',
      ellipsis: true,
      render: (v: string) => (
        <a href={v} target="_blank" rel="noreferrer">
          {v}
        </a>
      ),
    },
    {
      title: '状态码',
      dataIndex: 'status_code',
      key: 'status_code',
      width: 90,
      render: (v: number) => (v ? <Tag>{v}</Tag> : '-'),
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: '指纹',
      dataIndex: 'fingerprint',
      key: 'fingerprint',
      width: 180,
      render: (v: string) =>
        v ? <Tag color="geekblue">{v}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: '漏洞',
      key: 'vuln',
      width: 90,
      sorter: (a, b) =>
        (a.vulnerabilities?.length ?? 0) - (b.vulnerabilities?.length ?? 0),
      render: (_: unknown, r) => {
        const n = r.vulnerabilities?.length ?? 0;
        return n > 0 ? <Tag color="red">{n}</Tag> : <Tag>0</Tag>;
      },
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="安全评分"
              value={score ?? '-'}
              suffix={score !== null ? '/100' : ''}
              valueStyle={{
                color:
                  score === null
                    ? undefined
                    : score >= 80
                    ? '#52c41a'
                    : score >= 60
                    ? '#faad14'
                    : '#ff4d4f',
              }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="扫描目标" value={rows.length} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="存在漏洞目标"
              value={targetsWithVulns}
              valueStyle={
                targetsWithVulns > 0 ? { color: '#ff4d4f' } : undefined
              }
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="漏洞总数"
              value={total}
              valueStyle={total > 0 ? { color: '#ff4d4f' } : undefined}
            />
          </Card>
        </Col>
      </Row>

      {Object.keys(sevCounts).length > 0 ? (
        <Card size="small" title="按严重等级">
          <Space wrap>
            {Object.entries(sevCounts)
              .sort((a, b) => severityRank(a[0]) - severityRank(b[0]))
              .map(([sev, n]) => (
                <Tag
                  key={sev}
                  color={SEVERITY_COLORS[sev] ?? 'default'}
                  style={{ fontSize: 13 }}
                >
                  {sev.toUpperCase()}: {n}
                </Tag>
              ))}
          </Space>
        </Card>
      ) : null}

      <Card size="small" title="目标详情" bodyStyle={{ padding: 0 }}>
        {rows.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="无目标数据"
            style={{ padding: 16 }}
          />
        ) : (
          <Table
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            expandable={{
              expandedRowRender: (r) => (
                <AIScanResultDetail row={r} />
              ),
              rowExpandable: (r) =>
                !!(
                  (r.vulnerabilities && r.vulnerabilities.length > 0) ||
                  r.summary ||
                  r.reason ||
                  r.screenshot
                ),
            }}
          />
        )}
      </Card>
    </Space>
  );
}

function AIScanResultDetail({ row }: { row: AIScanResult }) {
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {row.summary ? (
        <Alert
          type="info"
          showIcon
          message="AI 总结"
          description={
            <Paragraph
              style={{ margin: 0, whiteSpace: 'pre-wrap' }}
              ellipsis={{ rows: 6, expandable: true, symbol: '展开' }}
            >
              {row.summary}
            </Paragraph>
          }
        />
      ) : null}
      {row.reason ? (
        <Alert
          type="warning"
          showIcon
          message="判定理由"
          description={
            <Paragraph
              style={{ margin: 0, whiteSpace: 'pre-wrap' }}
              ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}
            >
              {row.reason}
            </Paragraph>
          }
        />
      ) : null}
      {row.screenshot ? (
        <Card size="small" title="截图">
          <Image
            src={row.screenshot}
            alt="screenshot"
            style={{ maxWidth: '100%' }}
          />
        </Card>
      ) : null}
      {(row.vulnerabilities?.length ?? 0) > 0 ? (
        <Card size="small" title={`漏洞 (${row.vulnerabilities!.length})`}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {row.vulnerabilities!.map((v, i) => (
              <VulnCard key={`${v.cve ?? v.name ?? i}`} vuln={v} />
            ))}
          </Space>
        </Card>
      ) : null}
    </Space>
  );
}

function VulnCard({ vuln }: { vuln: AIVuln }) {
  return (
    <Card size="small" type="inner">
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Space wrap size={8} align="start">
          <Text strong style={{ fontSize: 14 }}>
            {vuln.cve || vuln.name || '未命名漏洞'}
          </Text>
          <SeverityTag value={vuln.severity} />
          {vuln.cvss ? <Tag color="purple">CVSS {vuln.cvss}</Tag> : null}
          {vuln.name && vuln.cve ? <Tag>{vuln.name}</Tag> : null}
        </Space>
        {vuln.summary ? (
          <Paragraph style={{ marginBottom: 0 }}>{vuln.summary}</Paragraph>
        ) : null}
        {vuln.details ? (
          <Paragraph
            style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}
            type="secondary"
            ellipsis={{ rows: 6, expandable: true, symbol: '展开' }}
          >
            {vuln.details}
          </Paragraph>
        ) : null}
        {vuln.security_advise ? (
          <Alert
            type="success"
            showIcon
            message="修复建议"
            description={
              <span style={{ whiteSpace: 'pre-wrap' }}>
                {vuln.security_advise}
              </span>
            }
          />
        ) : null}
        {vuln.references && vuln.references.length > 0 ? (
          <div>
            <Text type="secondary">参考链接：</Text>
            <ul style={{ paddingLeft: 18, margin: '4px 0 0' }}>
              {vuln.references.map((ref) => (
                <li key={ref}>
                  <a href={ref} target="_blank" rel="noreferrer">
                    {ref}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Space>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Mcp-Scan                                                            */
/* ------------------------------------------------------------------ */

interface McpVuln {
  title?: string;
  description?: string;
  risk_type?: string;
  level?: string;
  suggestion?: string;
}

function McpScanResult({ result }: { result: Record<string, unknown> }) {
  const score = (result.score as number | undefined) ?? null;
  const language = (result.language as string | undefined) ?? '';
  const readme = (result.readme as string | undefined) ?? '';
  const startTime = (result.start_time as number | undefined) ?? 0;
  const endTime = (result.end_time as number | undefined) ?? 0;
  const llm = (result.llm as string | undefined) ?? '';
  const vulns = ((result.results as McpVuln[] | undefined) ?? []).map(
    (v, idx) => ({ ...v, key: `${v.title ?? 'row'}-${idx}` }),
  );

  const elapsedSec =
    startTime && endTime && endTime >= startTime ? endTime - startTime : 0;

  const sevCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of vulns) {
      const k = normalizeSeverity(v.level);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [vulns]);

  const columns: ColumnsType<McpVuln & { key: string }> = [
    {
      title: '风险等级',
      dataIndex: 'level',
      key: 'level',
      width: 110,
      sorter: (a, b) => severityRank(a.level) - severityRank(b.level),
      render: (v: string) => <SeverityTag value={v} />,
    },
    {
      title: '类型',
      dataIndex: 'risk_type',
      key: 'risk_type',
      width: 160,
      render: (v: string) => (v ? <Tag color="geekblue">{v}</Tag> : '-'),
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      render: (v: string) => v || '-',
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (v: string) => preview(v, 120),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="安全评分"
              value={score ?? '-'}
              suffix={score !== null ? '/100' : ''}
              valueStyle={{
                color:
                  score === null
                    ? undefined
                    : score >= 80
                    ? '#52c41a'
                    : score >= 60
                    ? '#faad14'
                    : '#ff4d4f',
              }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="发现漏洞"
              value={vulns.length}
              valueStyle={vulns.length > 0 ? { color: '#ff4d4f' } : undefined}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="主要语言" value={language || '-'} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="扫描耗时"
              value={
                elapsedSec
                  ? elapsedSec >= 60
                    ? `${(elapsedSec / 60).toFixed(1)} 分钟`
                    : `${Math.round(elapsedSec)} 秒`
                  : '-'
              }
            />
          </Card>
        </Col>
      </Row>

      {(llm || startTime || endTime) ? (
        <Card size="small">
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }}>
            {llm ? (
              <Descriptions.Item label="模型">{llm}</Descriptions.Item>
            ) : null}
            {startTime ? (
              <Descriptions.Item label="开始时间">
                {dayjs(startTime * 1000).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
            ) : null}
            {endTime ? (
              <Descriptions.Item label="结束时间">
                {dayjs(endTime * 1000).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
            ) : null}
          </Descriptions>
        </Card>
      ) : null}

      {Object.keys(sevCounts).length > 0 ? (
        <Card size="small" title="按风险等级">
          <Space wrap>
            {Object.entries(sevCounts)
              .sort((a, b) => severityRank(a[0]) - severityRank(b[0]))
              .map(([sev, n]) => (
                <Tag
                  key={sev}
                  color={SEVERITY_COLORS[sev] ?? 'default'}
                  style={{ fontSize: 13 }}
                >
                  {sev.toUpperCase()}: {n}
                </Tag>
              ))}
          </Space>
        </Card>
      ) : null}

      <Card size="small" title={`漏洞列表 (${vulns.length})`} bodyStyle={{ padding: 0 }}>
        {vulns.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="未发现漏洞"
            style={{ padding: 16 }}
          />
        ) : (
          <Table
            size="small"
            columns={columns}
            dataSource={vulns}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            expandable={{
              expandedRowRender: (v) => (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {v.description ? (
                    <Alert
                      type="warning"
                      showIcon
                      message="详细描述"
                      description={
                        <span style={{ whiteSpace: 'pre-wrap' }}>
                          {v.description}
                        </span>
                      }
                    />
                  ) : null}
                  {v.suggestion ? (
                    <Alert
                      type="success"
                      showIcon
                      message="修复建议"
                      description={
                        <span style={{ whiteSpace: 'pre-wrap' }}>
                          {v.suggestion}
                        </span>
                      }
                    />
                  ) : null}
                </Space>
              ),
              rowExpandable: (v) => !!(v.description || v.suggestion),
            }}
          />
        )}
      </Card>

      {readme ? (
        <Card size="small" title="项目概况 (Readme)">
          <Collapse
            ghost
            size="small"
            items={[
              {
                key: 'readme',
                label: '展开查看',
                children: <MarkdownLite text={readme} maxHeight={500} />,
              },
            ]}
          />
        </Card>
      ) : null}
    </Space>
  );
}

/* ------------------------------------------------------------------ */
/* Agent-Scan                                                          */
/* ------------------------------------------------------------------ */

interface AgentConversationTurn {
  prompt?: string;
  response?: string;
}

interface AgentFinding {
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  level?: string;
  owasp?: string[];
  suggestion?: string;
  conversation?: AgentConversationTurn[];
}

interface AgentOWASPSummary {
  id?: string;
  name?: string;
  total?: number;
  high_or_above?: number;
  max_level?: string;
  findings?: string[];
}

function AgentScanResult({ result }: { result: Record<string, unknown> }) {
  const score = (result.score as number | undefined) ?? null;
  const riskType = normalizeSeverity(result.risk_type);
  const totalTests = (result.total_tests as number | undefined) ?? 0;
  const vulnerableTests =
    (result.vulnerable_tests as number | undefined) ?? 0;
  const agentName = (result.agent_name as string | undefined) ?? '';
  const agentType = (result.agent_type as string | undefined) ?? '';
  const modelName = (result.model_name as string | undefined) ?? '';
  const startTime = (result.start_time as number | undefined) ?? 0;
  const endTime = (result.end_time as number | undefined) ?? 0;
  const language = (result.language as string | undefined) ?? '';
  const description = (result.report_description as string | undefined) ?? '';
  const findings = ((result.results as AgentFinding[] | undefined) ?? []).map(
    (f, idx) => ({ ...f, key: f.id ?? `finding-${idx}` }),
  );
  const owasp =
    (result.owasp_agentic_2026_top10 as AgentOWASPSummary[] | undefined) ?? [];

  const elapsedSec =
    startTime && endTime && endTime >= startTime ? endTime - startTime : 0;

  const columns: ColumnsType<AgentFinding & { key: string }> = [
    {
      title: '等级',
      dataIndex: 'level',
      key: 'level',
      width: 100,
      sorter: (a, b) => severityRank(a.level) - severityRank(b.level),
      render: (v: string) => <SeverityTag value={v} />,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 180,
      render: (v: string) => (v ? <Tag color="geekblue">{v}</Tag> : '-'),
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      render: (v: string) => v || '-',
    },
    {
      title: 'OWASP',
      dataIndex: 'owasp',
      key: 'owasp',
      width: 180,
      render: (arr: string[] | undefined) =>
        arr && arr.length > 0 ? (
          <Space size={4} wrap>
            {arr.map((o) => (
              <Tag key={o}>{o}</Tag>
            ))}
          </Space>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="安全评分"
              value={score ?? '-'}
              suffix={score !== null ? '/100' : ''}
              valueStyle={{
                color:
                  score === null
                    ? undefined
                    : score >= 80
                    ? '#52c41a'
                    : score >= 60
                    ? '#faad14'
                    : '#ff4d4f',
              }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="风险等级"
              value={riskType.toUpperCase()}
              valueStyle={{
                color:
                  riskType === 'safe'
                    ? '#52c41a'
                    : riskType === 'medium'
                    ? '#faad14'
                    : riskType === 'high' || riskType === 'critical'
                    ? '#ff4d4f'
                    : undefined,
              }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="测试总数" value={totalTests} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="存在漏洞"
              value={vulnerableTests}
              valueStyle={
                vulnerableTests > 0 ? { color: '#ff4d4f' } : undefined
              }
              suffix={
                totalTests > 0 ? (
                  <Text type="secondary" style={{ fontSize: 14 }}>
                    /{totalTests}
                  </Text>
                ) : undefined
              }
            />
          </Card>
        </Col>
      </Row>

      {(agentName || agentType || modelName || language || elapsedSec) ? (
        <Card size="small">
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }}>
            {agentName ? (
              <Descriptions.Item label="Agent 名称">
                {agentName}
              </Descriptions.Item>
            ) : null}
            {agentType ? (
              <Descriptions.Item label="Agent 类型">
                <Tag>{agentType}</Tag>
              </Descriptions.Item>
            ) : null}
            {modelName ? (
              <Descriptions.Item label="模型">{modelName}</Descriptions.Item>
            ) : null}
            {language ? (
              <Descriptions.Item label="主要语言">
                {language}
              </Descriptions.Item>
            ) : null}
            {startTime ? (
              <Descriptions.Item label="开始">
                {dayjs(startTime * 1000).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
            ) : null}
            {endTime ? (
              <Descriptions.Item label="结束">
                {dayjs(endTime * 1000).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
            ) : null}
            {elapsedSec ? (
              <Descriptions.Item label="耗时">
                {elapsedSec >= 60
                  ? `${(elapsedSec / 60).toFixed(1)} 分钟`
                  : `${Math.round(elapsedSec)} 秒`}
              </Descriptions.Item>
            ) : null}
          </Descriptions>
        </Card>
      ) : null}

      {owasp.length > 0 ? (
        <Card size="small" title="OWASP Agentic Top 10 命中">
          <Row gutter={[8, 8]}>
            {owasp.map((o) => (
              <Col xs={24} sm={12} md={8} key={o.id ?? o.name}>
                <Card
                  size="small"
                  type="inner"
                  bodyStyle={{ padding: 8 }}
                  title={
                    <Space size={6}>
                      <Tag color="purple">{o.id}</Tag>
                      <Text strong style={{ fontSize: 13 }}>
                        {o.name}
                      </Text>
                    </Space>
                  }
                >
                  <Space size={6} wrap>
                    <SeverityTag value={o.max_level} />
                    <Tag>命中 {o.total ?? 0}</Tag>
                    {(o.high_or_above ?? 0) > 0 ? (
                      <Tag color="red">高危 {o.high_or_above}</Tag>
                    ) : null}
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>
      ) : null}

      <Card
        size="small"
        title={`漏洞发现 (${findings.length})`}
        bodyStyle={{ padding: 0 }}
      >
        {findings.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="未发现漏洞"
            style={{ padding: 16 }}
          />
        ) : (
          <Table
            size="small"
            columns={columns}
            dataSource={findings}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            expandable={{
              expandedRowRender: (f) => <AgentFindingDetail finding={f} />,
            }}
          />
        )}
      </Card>

      {description ? (
        <Card size="small" title="报告说明">
          <Collapse
            ghost
            size="small"
            items={[
              {
                key: 'desc',
                label: '展开查看',
                children: <MarkdownLite text={description} maxHeight={500} />,
              },
            ]}
          />
        </Card>
      ) : null}
    </Space>
  );
}

function AgentFindingDetail({ finding }: { finding: AgentFinding }) {
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {finding.description ? (
        <Alert
          type="warning"
          showIcon
          message="漏洞描述"
          description={
            <span style={{ whiteSpace: 'pre-wrap' }}>{finding.description}</span>
          }
        />
      ) : null}
      {finding.suggestion ? (
        <Alert
          type="success"
          showIcon
          message="修复建议"
          description={
            <span style={{ whiteSpace: 'pre-wrap' }}>{finding.suggestion}</span>
          }
        />
      ) : null}
      {finding.conversation && finding.conversation.length > 0 ? (
        <Card
          size="small"
          type="inner"
          title={`攻击对话 (${finding.conversation.length} 轮)`}
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {finding.conversation.map((turn, i) => (
              <div key={i}>
                {turn.prompt ? (
                  <div style={{ marginBottom: 4 }}>
                    <Tag color="blue">攻击</Tag>
                    <Text style={{ whiteSpace: 'pre-wrap' }}>
                      {turn.prompt}
                    </Text>
                  </div>
                ) : null}
                {turn.response ? (
                  <div>
                    <Tag color="orange">响应</Tag>
                    <Text style={{ whiteSpace: 'pre-wrap' }}>
                      {turn.response}
                    </Text>
                  </div>
                ) : null}
              </div>
            ))}
          </Space>
        </Card>
      ) : null}
    </Space>
  );
}

/* ------------------------------------------------------------------ */
/* Model-Redteam-Report (PromptSecurity)                               */
/* ------------------------------------------------------------------ */

interface RedTeamCase {
  status?: string;
  modelName?: string;
  vulnerability?: string;
  attackMethod?: string;
  originalInput?: string | null;
  input?: string;
  output?: string;
  reason?: string;
  error?: string;
}

interface RedTeamCategory {
  vulnerability?: string;
  attackMethod?: string;
  total?: number;
  jailbreak?: number;
  score?: number;
  asr?: number;
  errored?: number;
}

interface RedTeamReport {
  modelName?: string;
  baseTotal?: number;
  total?: number;
  jailbreak?: number;
  score?: number;
  errored?: number;
  useless?: number;
  results?: RedTeamCase[];
  attachment?: string;
  extraBody?: {
    vulnerabilityResults?: RedTeamCategory[];
    attackMethodResults?: RedTeamCategory[];
  };
}

function ModelRedteamResult({ result }: { result: Record<string, unknown> }) {
  const msgType = (result.msgType as string | undefined) ?? '';
  const status = result.status as boolean | undefined;
  const content = result.content;

  // Markdown / text payloads
  if (msgType === 'markdown' || msgType === 'text') {
    return (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {status !== undefined ? (
          <Alert
            type={status ? 'error' : 'success'}
            showIcon
            message={status ? '检测到越狱风险' : '未发现越狱风险'}
          />
        ) : null}
        <MarkdownLite text={String(content ?? '')} />
      </Space>
    );
  }

  // File payload
  if (msgType === 'file') {
    const url = String(content ?? '');
    return (
      <Alert
        type="info"
        showIcon
        message="报告文件"
        description={
          url ? (
            <a href={url} target="_blank" rel="noreferrer">
              {url}
            </a>
          ) : (
            '无内容'
          )
        }
      />
    );
  }

  // Default: JSON list of per-model reports.
  const reports: RedTeamReport[] = Array.isArray(content)
    ? (content as RedTeamReport[])
    : isObject(content)
    ? [content as RedTeamReport]
    : Array.isArray(result.content)
    ? (result.content as RedTeamReport[])
    : [];

  if (reports.length === 0) {
    // Could also be a single report at top level.
    if (
      isObject(result) &&
      (result.results || result.score !== undefined ||
        result.modelName !== undefined)
    ) {
      reports.push(result as unknown as RedTeamReport);
    }
  }

  if (reports.length === 0) {
    return <GenericResult result={result} />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {status !== undefined ? (
        <Alert
          type={status ? 'error' : 'success'}
          showIcon
          message={status ? '检测到越狱风险' : '未发现越狱风险'}
        />
      ) : null}
      {reports.map((r, idx) => (
        <RedTeamReportCard key={r.modelName ?? `report-${idx}`} report={r} />
      ))}
    </Space>
  );
}

function RedTeamReportCard({ report }: { report: RedTeamReport }) {
  const { modelName, total = 0, jailbreak = 0, score = 0, errored = 0,
    useless = 0, baseTotal = 0, results = [], attachment, extraBody } = report;
  const asr = total > 0 ? Math.round((jailbreak / total) * 100) : 0;

  const [caseFilter, setCaseFilter] = useState('');
  const filteredCases = useMemo(() => {
    const q = caseFilter.trim().toLowerCase();
    if (!q) return results;
    return results.filter((c) =>
      [c.vulnerability, c.attackMethod, c.input, c.output, c.reason]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [results, caseFilter]);

  const caseColumns: ColumnsType<RedTeamCase> = [
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (v: string) =>
        v ? <Tag color={STATUS_COLORS[v] ?? 'default'}>{v}</Tag> : '-',
    },
    {
      title: '漏洞类型',
      dataIndex: 'vulnerability',
      key: 'vulnerability',
      width: 180,
      render: (v: string) => (v ? <Tag>{v}</Tag> : '-'),
    },
    {
      title: '攻击方法',
      dataIndex: 'attackMethod',
      key: 'attackMethod',
      width: 160,
      render: (v: string) => v || '-',
    },
    {
      title: '输入',
      dataIndex: 'input',
      key: 'input',
      ellipsis: true,
      render: (v: string) => preview(v, 80),
    },
  ];

  const categoryColumns = (key: 'vulnerability' | 'attackMethod'):
    ColumnsType<RedTeamCategory> => [
    {
      title: key === 'vulnerability' ? '漏洞类型' : '攻击方法',
      dataIndex: key,
      key,
      render: (v: string) => v || '-',
    },
    {
      title: '总数',
      dataIndex: 'total',
      key: 'total',
      width: 80,
      sorter: (a, b) => (a.total ?? 0) - (b.total ?? 0),
    },
    {
      title: '越狱',
      dataIndex: 'jailbreak',
      key: 'jailbreak',
      width: 80,
      sorter: (a, b) => (a.jailbreak ?? 0) - (b.jailbreak ?? 0),
      render: (v: number) =>
        v > 0 ? <Tag color="red">{v}</Tag> : <Tag>0</Tag>,
    },
    {
      title: 'ASR',
      dataIndex: 'asr',
      key: 'asr',
      width: 110,
      sorter: (a, b) => (a.asr ?? 0) - (b.asr ?? 0),
      render: (v: number) =>
        typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '-',
    },
    {
      title: '通过率',
      dataIndex: 'score',
      key: 'score',
      width: 110,
      sorter: (a, b) => (a.score ?? 0) - (b.score ?? 0),
      render: (v: number) =>
        typeof v === 'number' ? `${v}%` : '-',
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <Text strong>{modelName || '未命名模型'}</Text>
          {jailbreak > 0 ? (
            <Tag color="red">检测到越狱</Tag>
          ) : (
            <Tag color="green">安全</Tag>
          )}
        </Space>
      }
      extra={
        attachment ? (
          <a href={attachment} target="_blank" rel="noreferrer">
            下载明细 CSV
          </a>
        ) : null
      }
    >
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}>
          <Statistic
            title="安全得分"
            value={score}
            suffix="/100"
            valueStyle={{
              color:
                score >= 80 ? '#52c41a' : score >= 60 ? '#faad14' : '#ff4d4f',
            }}
          />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="越狱次数"
            value={jailbreak}
            suffix={total > 0 ? `/${total}` : ''}
            valueStyle={jailbreak > 0 ? { color: '#ff4d4f' } : undefined}
          />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="ASR (越狱率)"
            value={asr}
            suffix="%"
            valueStyle={asr > 0 ? { color: '#ff4d4f' } : undefined}
          />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="异常 / 失效"
            value={`${errored} / ${useless}`}
          />
        </Col>
      </Row>
      {total > 0 ? (
        <Progress
          percent={Math.round((jailbreak / total) * 100)}
          status={jailbreak > 0 ? 'exception' : 'success'}
          format={(p) => `越狱 ${jailbreak}/${total} (${p}%)`}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {baseTotal && baseTotal !== total ? (
        <Paragraph type="secondary" style={{ margin: '0 0 8px' }}>
          原始测试集: {baseTotal}，参与评估: {total}
        </Paragraph>
      ) : null}

      <Collapse
        ghost
        size="small"
        items={[
          ...(extraBody?.vulnerabilityResults?.length
            ? [
                {
                  key: 'vuln',
                  label: `漏洞类型分布 (${extraBody.vulnerabilityResults.length})`,
                  children: (
                    <Table
                      size="small"
                      rowKey={(r, i) => r.vulnerability ?? `v-${i}`}
                      pagination={false}
                      columns={categoryColumns('vulnerability')}
                      dataSource={extraBody.vulnerabilityResults}
                    />
                  ),
                },
              ]
            : []),
          ...(extraBody?.attackMethodResults?.length
            ? [
                {
                  key: 'attack',
                  label: `攻击方法分布 (${extraBody.attackMethodResults.length})`,
                  children: (
                    <Table
                      size="small"
                      rowKey={(r, i) => r.attackMethod ?? `a-${i}`}
                      pagination={false}
                      columns={categoryColumns('attackMethod')}
                      dataSource={extraBody.attackMethodResults}
                    />
                  ),
                },
              ]
            : []),
          ...(results.length
            ? [
                {
                  key: 'cases',
                  label: `典型案例 (${results.length})`,
                  children: (
                    <>
                      <Input.Search
                        allowClear
                        size="small"
                        placeholder="按漏洞 / 方法 / 输入 / 输出搜索"
                        value={caseFilter}
                        onChange={(e) => setCaseFilter(e.target.value)}
                        style={{ marginBottom: 8, maxWidth: 360 }}
                      />
                      <Table
                        size="small"
                        rowKey={(_, i) => `case-${i}`}
                        pagination={{ pageSize: 5, showSizeChanger: false }}
                        columns={caseColumns}
                        dataSource={filteredCases}
                        expandable={{
                          expandedRowRender: (c) => (
                            <RedTeamCaseDetail c={c} />
                          ),
                        }}
                      />
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
    </Card>
  );
}

function RedTeamCaseDetail({ c }: { c: RedTeamCase }) {
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {c.originalInput ? (
        <Alert
          type="info"
          showIcon
          message="原始提示"
          description={
            <span style={{ whiteSpace: 'pre-wrap' }}>{c.originalInput}</span>
          }
        />
      ) : null}
      {c.input ? (
        <Alert
          type="warning"
          showIcon
          message="越狱输入"
          description={
            <span style={{ whiteSpace: 'pre-wrap' }}>{c.input}</span>
          }
        />
      ) : null}
      {c.output ? (
        <Alert
          type={c.status === 'Jailbreak' ? 'error' : 'success'}
          showIcon
          message="模型输出"
          description={
            <span style={{ whiteSpace: 'pre-wrap' }}>{c.output}</span>
          }
        />
      ) : null}
      {c.reason ? (
        <Alert
          type="info"
          showIcon
          message="判定理由"
          description={
            <span style={{ whiteSpace: 'pre-wrap' }}>{c.reason}</span>
          }
        />
      ) : null}
      {c.error ? (
        <Alert type="error" showIcon message="异常" description={c.error} />
      ) : null}
    </Space>
  );
}

/* ------------------------------------------------------------------ */
/* Garak-Scan                                                          */
/* ------------------------------------------------------------------ */

const FINDING_STATUS_OPTIONS: { value: FindingStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'fixed', label: '已修复' },
  { value: 'accepted_risk', label: '接受风险' },
  { value: 'false_positive', label: '误报' },
];

function GarakScanResult({
  result,
  scanId,
}: {
  result: Record<string, unknown>;
  scanId?: string;
}) {
  const total = (result.total as number | undefined) ?? 0;
  const bySeverity =
    (result.by_severity as Record<string, number> | undefined) ?? {};
  const garakVersion = (result.garak_version as string | undefined) ?? '';
  const adapterVersion = (result.adapter_version as string | undefined) ?? '';
  const reportUrl = (result.report_url as string | undefined) ?? '';
  const reportFilename = (result.report_filename as string | undefined) ?? '';
  const scanIdField =
    (result.scan_id as string | undefined) ?? scanId ?? '';
  const reportMarkdown = (result.report_markdown as string | undefined) ?? '';

  // Findings loaded either from the result payload or via API.
  const [findings, setFindings] = useState<Finding[]>(() => {
    const embedded =
      (result.findings as Finding[] | undefined) ??
      (result.results as Finding[] | undefined) ??
      [];
    return Array.isArray(embedded) ? (embedded as Finding[]) : [];
  });
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [activeFinding, setActiveFinding] = useState<Finding | null>(null);
  const [keyword, setKeyword] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');

  // If we have a scanId but no embedded findings, try fetching from API.
  useEffect(() => {
    const sid = scanIdField;
    if (!sid || findings.length > 0) return;
    setFindingsLoading(true);
    listFindings(sid)
      .then((r) => {
        if (r?.findings?.length) setFindings(r.findings);
      })
      .catch(() => undefined)
      .finally(() => setFindingsLoading(false));
  }, [scanIdField]);  // eslint-disable-line react-hooks/exhaustive-deps

  const filteredFindings = useMemo<Finding[]>(() => {
    return findings.filter((f) => {
      if (severityFilter && f.severity !== severityFilter) return false;
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
  }, [findings, severityFilter, keyword]);

  const onUpdateStatus = async (f: Finding, next: FindingStatus) => {
    try {
      await updateFindingStatus(f.finding_id, next);
      setFindings((prev) =>
        prev.map((x) =>
          x.finding_id === f.finding_id ? { ...x, status: next } : x,
        ),
      );
      if (activeFinding?.finding_id === f.finding_id) {
        setActiveFinding({ ...activeFinding, status: next });
      }
    } catch {
      /* handled */
    }
  };

  const findingColumns: ColumnsType<Finding> = [
    {
      title: '严重度',
      dataIndex: 'severity',
      key: 'severity',
      width: 100,
      sorter: (a, b) => severityRank(a.severity) - severityRank(b.severity),
      render: (s: string) => (
        <Tag color={SEVERITY_COLORS[s] ?? 'default'}>{s.toUpperCase()}</Tag>
      ),
    },
    {
      title: '风险类型',
      dataIndex: 'risk_type_display',
      key: 'risk_type_display',
      width: 150,
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
      width: 100,
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
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (s: FindingStatus, r) => (
        <Select
          size="small"
          value={s}
          options={FINDING_STATUS_OPTIONS}
          style={{ width: 120 }}
          onChange={(v) => onUpdateStatus(r, v)}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_v, r) => (
        <Button type="link" size="small" onClick={() => setActiveFinding(r)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="发现总数" value={total} />
          </Card>
        </Col>
        {(['critical', 'high', 'medium', 'low', 'info'] as const).map((sev) => (
          <Col xs={12} md={3} key={sev}>
            <Card size="small">
              <Statistic
                title={sev.toUpperCase()}
                value={bySeverity[sev] ?? 0}
                valueStyle={{
                  color:
                    sev === 'critical' || sev === 'high'
                      ? '#ff4d4f'
                      : sev === 'medium'
                      ? '#faad14'
                      : sev === 'low'
                      ? '#fadb14'
                      : undefined,
                }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {garakVersion || adapterVersion || scanIdField ? (
        <Card size="small">
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }}>
            {scanIdField ? (
              <Descriptions.Item label="扫描 ID">
                <Text code>{scanIdField}</Text>
              </Descriptions.Item>
            ) : null}
            {garakVersion ? (
              <Descriptions.Item label="Garak 版本">
                {garakVersion}
              </Descriptions.Item>
            ) : null}
            {adapterVersion ? (
              <Descriptions.Item label="Adapter 版本">
                {adapterVersion}
              </Descriptions.Item>
            ) : null}
          </Descriptions>
        </Card>
      ) : null}

      {reportUrl ? (
        <Alert
          type="info"
          showIcon
          message="详细 Markdown 报告"
          description={
            <a href={reportUrl} target="_blank" rel="noreferrer">
              {reportFilename || '下载报告'}
            </a>
          }
        />
      ) : null}

      {/* Inline findings table */}
      <Card
        size="small"
        title={`评估发现 (${findings.length})`}
        bodyStyle={{ padding: 0 }}
        extra={
          <Space size={8}>
            <Input.Search
              size="small"
              placeholder="搜索证据 / 资产 / probe"
              allowClear
              style={{ width: 200 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Select
              size="small"
              placeholder="严重度"
              allowClear
              style={{ width: 100 }}
              value={severityFilter || undefined}
              onChange={(v) => setSeverityFilter(v || '')}
              options={(['critical', 'high', 'medium', 'low'] as const).map(
                (v) => ({ value: v, label: v.toUpperCase() }),
              )}
            />
          </Space>
        }
      >
        {findings.length === 0 && !findingsLoading ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无评估发现"
            style={{ padding: 16 }}
          />
        ) : (
          <Table
            rowKey="finding_id"
            size="small"
            loading={findingsLoading}
            columns={findingColumns}
            dataSource={filteredFindings}
            pagination={{ pageSize: 10, showSizeChanger: false }}
          />
        )}
      </Card>

      {/* Markdown report inline */}
      {reportMarkdown ? (
        <Card size="small" title="Markdown 详细报告">
          <Collapse
            ghost
            size="small"
            defaultActiveKey={['report']}
            items={[
              {
                key: 'report',
                label: '查看完整报告',
                children: (
                  <MarkdownLite text={reportMarkdown} maxHeight={600} />
                ),
              },
            ]}
          />
        </Card>
      ) : null}

      {/* Finding detail drawer */}
      <Drawer
        title={
          activeFinding
            ? `${activeFinding.severity.toUpperCase()} · ${activeFinding.risk_type_display || activeFinding.risk_type}`
            : ''
        }
        width={560}
        open={!!activeFinding}
        onClose={() => setActiveFinding(null)}
      >
        {activeFinding ? (
          <GarakFindingDetail
            finding={activeFinding}
            onStatusChange={(next) => onUpdateStatus(activeFinding, next)}
          />
        ) : null}
      </Drawer>
    </Space>
  );
}

function GarakFindingDetail({
  finding,
  onStatusChange,
}: {
  finding: Finding;
  onStatusChange: (s: FindingStatus) => void;
}) {
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Descriptions size="small" column={1}>
        <Descriptions.Item label="严重度">
          <Tag color={SEVERITY_COLORS[finding.severity] ?? 'default'}>
            {finding.severity.toUpperCase()}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="风险类型">
          {finding.risk_type_display || finding.risk_type}
        </Descriptions.Item>
        {finding.asset ? (
          <Descriptions.Item label="资产">{finding.asset}</Descriptions.Item>
        ) : null}
        {finding.garak_probe_id ? (
          <Descriptions.Item label="Probe">
            <code>{finding.garak_probe_id}</code>
          </Descriptions.Item>
        ) : null}
        {finding.garak_detector_name ? (
          <Descriptions.Item label="Detector">
            <code>{finding.garak_detector_name}</code>
          </Descriptions.Item>
        ) : null}
        <Descriptions.Item label="置信度">
          <Progress
            percent={Math.round(finding.confidence)}
            size="small"
            style={{ maxWidth: 200 }}
          />
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <Select
            size="small"
            value={finding.status}
            options={FINDING_STATUS_OPTIONS}
            style={{ width: 150 }}
            onChange={onStatusChange}
          />
        </Descriptions.Item>
      </Descriptions>
      {finding.evidence_summary ? (
        <Alert
          type="warning"
          showIcon
          message="证据摘要"
          description={
            <span style={{ whiteSpace: 'pre-wrap' }}>
              {finding.evidence_summary}
            </span>
          }
        />
      ) : null}
      {finding.fix_recommendation ? (
        <Alert
          type="success"
          showIcon
          message="修复建议"
          description={
            <span style={{ whiteSpace: 'pre-wrap' }}>
              {finding.fix_recommendation}
            </span>
          }
        />
      ) : null}
      {finding.evidence_detail ? (
        <Card size="small" title="证据详情">
          <pre
            style={{
              background: '#f6f8fa',
              padding: 8,
              borderRadius: 4,
              margin: 0,
              maxHeight: 300,
              overflow: 'auto',
              fontSize: 12,
            }}
          >
            {JSON.stringify(finding.evidence_detail, null, 2)}
          </pre>
        </Card>
      ) : null}
    </Space>
  );
}

/* ------------------------------------------------------------------ */
/* Generic fallback                                                    */
/* ------------------------------------------------------------------ */

function GenericResult({ result }: { result: Record<string, unknown> }) {
  const entries = Object.entries(result);
  const scalars = entries.filter(([, v]) =>
    ['string', 'number', 'boolean'].includes(typeof v),
  );
  const complex = entries.filter(([, v]) => v !== null && typeof v === 'object');

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {scalars.length > 0 ? (
        <Card size="small">
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }}>
            {scalars.map(([k, v]) => (
              <Descriptions.Item key={k} label={k}>
                {String(v)}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      ) : null}
      {complex.map(([k, v]) => (
        <Card key={k} size="small" title={k}>
          <pre
            style={{
              background: '#f6f8fa',
              padding: 8,
              borderRadius: 4,
              margin: 0,
              maxHeight: 240,
              overflow: 'auto',
              fontSize: 12,
            }}
          >
            {JSON.stringify(v, null, 2)}
          </pre>
        </Card>
      ))}
      {entries.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="结果为空"
        />
      ) : null}
    </Space>
  );
}

/* ------------------------------------------------------------------ */
/* Public component                                                    */
/* ------------------------------------------------------------------ */

interface TaskResultProps {
  /** Raw event object stored for the resultUpdate message:
   *  `{ id, type, timestamp, result }` (Go agents) or just `{ ...payload }`
   *  for some adapters. The component handles both. */
  event: Record<string, unknown> | null;
  taskType?: string;
  /** Optional scan/session ID — used by Garak to display inline findings. */
  scanId?: string;
}

/** Human-friendly renderer for a task's final result.
 *
 *  Dispatches by taskType. Always finishes with a "原始 JSON" collapse
 *  panel so power users can still inspect everything.
 */
export default function TaskResult({ event, taskType, scanId }: TaskResultProps) {
  if (!event) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="无结果数据"
      />
    );
  }

  // Normalize: the SSE-side ResultUpdateEvent wraps the payload as
  // `{ id, type:"resultUpdate", timestamp, result }`. Older / direct
  // payloads are sometimes the bare object. Try the wrapper first.
  let payload: unknown = event;
  if (
    isObject(event) &&
    'result' in event &&
    isObject((event as Record<string, unknown>).result)
  ) {
    payload = (event as Record<string, unknown>).result;
  }

  if (!isObject(payload)) {
    return (
      <>
        <Title level={5} style={{ marginTop: 0 }}>
          结果
        </Title>
        <pre
          style={{
            background: '#f6f8fa',
            padding: 12,
            borderRadius: 4,
            margin: 0,
          }}
        >
          {String(payload)}
        </pre>
      </>
    );
  }

  // Normalize task type to a canonical key.
  const t = String(taskType ?? '').toLowerCase().replace(/-/g, '_');

  let body: JSX.Element;
  switch (t) {
    case 'ai_infra_scan':
      body = <AIInfraScanResult result={payload} />;
      break;
    case 'mcp_scan':
      body = <McpScanResult result={payload} />;
      break;
    case 'agent_scan':
      body = <AgentScanResult result={payload} />;
      break;
    case 'model_redteam_report':
      body = <ModelRedteamResult result={payload} />;
      break;
    case 'garak_scan':
      body = <GarakScanResult result={payload} scanId={scanId} />;
      break;
    default:
      body = <GenericResult result={payload} />;
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {body}
      <RawJson payload={event} />
    </Space>
  );
}
