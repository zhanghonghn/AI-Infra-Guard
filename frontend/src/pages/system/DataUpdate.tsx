import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Descriptions,
  Popconfirm,
  Space,
  Statistic,
  Tag,
  message,
} from 'antd';
import {
  CloudDownloadOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import PageHeader from '@/components/PageHeader';
import { getUpdateStatus, triggerDataUpdate } from '@/api/system';
import type { UpdateStatus } from '@/types/system';

const POLL_INTERVAL_MS = 3_000;

function formatTs(s?: string): string {
  if (!s) return '-';
  const d = dayjs(s);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : s;
}

function statusBadge(s: UpdateStatus): {
  status: 'processing' | 'success' | 'error' | 'default';
  text: string;
} {
  if (s.running) return { status: 'processing', text: '同步中…' };
  if (s.success === true) return { status: 'success', text: '上次同步成功' };
  if (s.success === false) return { status: 'error', text: '上次同步失败' };
  return { status: 'default', text: '尚未同步' };
}

export default function DataUpdatePage() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = useCallback(async (silent = false): Promise<UpdateStatus | null> => {
    if (!silent) setRefreshing(true);
    try {
      const s = await getUpdateStatus();
      setStatus(s);
      return s;
    } catch {
      return null;
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, []);

  // Mount: one initial fetch, then start polling only while a sync is running.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const s = await fetchStatus(true);
      if (cancelled) return;
      if (s?.running) {
        pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
      } else {
        pollTimer.current = null;
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [fetchStatus]);

  const onTrigger = async () => {
    setTriggering(true);
    try {
      const s = await triggerDataUpdate();
      message.success(s?.running ? '同步已开始' : '已请求同步');
      setStatus(s);
      // Resume polling if we just kicked off a run.
      if (s?.running && !pollTimer.current) {
        const tick = async () => {
          const next = await fetchStatus(true);
          if (next?.running) {
            pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
          } else {
            pollTimer.current = null;
          }
        };
        pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
      }
    } catch {
      /* handled */
    } finally {
      setTriggering(false);
    }
  };

  const badge = status ? statusBadge(status) : null;

  return (
    <Card>
      <PageHeader
        title="数据更新"
        description="从 GitHub 主分支同步指纹库 / 漏洞库 / MCP 插件 / 评测集 / Agent 模板等数据目录。"
        extra={
          <Space>
            <Popconfirm
              title="将从 GitHub 主分支拉取最新数据并覆盖本地，确认?"
              onConfirm={onTrigger}
              disabled={triggering || (status?.running ?? false)}
            >
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                loading={triggering}
                disabled={status?.running}
              >
                立即同步
              </Button>
            </Popconfirm>
            <Button
              icon={<ReloadOutlined />}
              loading={refreshing}
              onClick={() => fetchStatus()}
            >
              刷新
            </Button>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="同步会在临时目录克隆 Tencent/AI-Infra-Guard 仓库，并将以下子目录复制到当前工作目录的 data/ 下：fingerprints / vuln / vuln_en / mcp / eval / agents。同时只能运行一次同步。"
      />

      {status ? (
        <>
          <Space size={16} style={{ marginBottom: 16 }} wrap>
            {badge ? <Badge status={badge.status} text={badge.text} /> : null}
            {status.ref ? <Tag color="purple">ref: {status.ref}</Tag> : null}
          </Space>

          <Space size={16} wrap style={{ marginBottom: 16 }}>
            <Card size="small" style={{ minWidth: 200 }}>
              <Statistic title="本次更新文件数" value={status.files_updated} />
            </Card>
            <Card size="small" style={{ minWidth: 200 }}>
              <Statistic
                title="状态消息"
                valueStyle={{ fontSize: 16 }}
                value={status.message || '-'}
              />
            </Card>
          </Space>

          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="开始时间">
              {formatTs(status.started_at)}
            </Descriptions.Item>
            <Descriptions.Item label="结束时间">
              {formatTs(status.finished_at)}
            </Descriptions.Item>
            <Descriptions.Item label="是否在跑">
              {status.running ? <Tag color="processing">运行中</Tag> : <Tag>否</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="是否成功">
              {status.success === undefined ? (
                '-'
              ) : status.success ? (
                <Tag color="success">成功</Tag>
              ) : (
                <Tag color="error">失败</Tag>
              )}
            </Descriptions.Item>
          </Descriptions>
        </>
      ) : (
        <Alert
          type="warning"
          showIcon
          message="未取到同步状态"
        />
      )}
    </Card>
  );
}
