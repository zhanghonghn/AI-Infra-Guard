import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import PageHeader from '@/components/PageHeader';
import { getVersion, type VersionInfo } from '@/api/version';

const USERNAME_KEY = 'aig.username';
const DEFAULT_USERNAME = 'public_user';

/** Read the locally-persisted identity used by the API client. */
function readUsername(): string {
  return localStorage.getItem(USERNAME_KEY) || DEFAULT_USERNAME;
}

export default function SystemInfoPage() {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState(readUsername());
  const [savingUsername, setSavingUsername] = useState(false);

  const fetchVersion = useCallback(async () => {
    setLoading(true);
    try {
      const v = await getVersion();
      setVersion(v);
    } catch {
      // toast already shown
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVersion();
  }, [fetchVersion]);

  const onSaveUsername = (values: { username: string }) => {
    setSavingUsername(true);
    try {
      const next = (values.username || '').trim();
      if (!next) {
        localStorage.removeItem(USERNAME_KEY);
        setUsername(DEFAULT_USERNAME);
        message.success('已清空，使用默认 public_user');
      } else {
        localStorage.setItem(USERNAME_KEY, next);
        setUsername(next);
        message.success(`身份已更新为 ${next}`);
      }
    } finally {
      setSavingUsername(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <PageHeader
          title="系统信息"
          description="查看当前服务版本与发布说明。"
          extra={
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={fetchVersion}
            >
              刷新
            </Button>
          }
        />
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="版本">
            {version?.version ? (
              <Tag color="blue">v{version.version}</Tag>
            ) : (
              '-'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="后端 API 基址">
            <code>/api/v1</code>
          </Descriptions.Item>
          <Descriptions.Item label="WebSocket Agent 入口">
            <code>/api/v1/agents/ws</code>
          </Descriptions.Item>
        </Descriptions>

        <Typography.Title level={5} style={{ marginTop: 16 }}>
          CHANGELOG
        </Typography.Title>
        {version?.changelog ? (
          <pre
            style={{
              background: '#f6f8fa',
              padding: 12,
              borderRadius: 4,
              maxHeight: 320,
              overflow: 'auto',
              margin: 0,
              whiteSpace: 'pre-wrap',
            }}
          >
            {version.changelog}
          </pre>
        ) : (
          <Typography.Text type="secondary">
            后端未提供 CHANGELOG 文件
          </Typography.Text>
        )}
      </Card>

      <Card>
        <PageHeader
          title="当前身份"
          description={
            <span>
              前端通过 <code>username</code> 请求头向后端表明身份，所有任务、模型、Finding 都会按此名隔离。
              {username === DEFAULT_USERNAME ? (
                <>（当前使用默认身份 <code>{DEFAULT_USERNAME}</code>）</>
              ) : null}
            </span>
          }
        />
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="此值仅保存在浏览器本地（localStorage），后端不做鉴权 — 不应在公网部署本服务。"
        />
        <Form
          layout="inline"
          initialValues={{ username }}
          onFinish={onSaveUsername}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { max: 64, message: '不超过 64 个字符' },
              {
                pattern: /^[A-Za-z0-9_.\-@]*$/,
                message: '只允许字母 / 数字 / _ . - @',
              },
            ]}
          >
            <Input placeholder={DEFAULT_USERNAME} style={{ width: 280 }} />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={savingUsername}
            >
              保存
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </Space>
  );
}
