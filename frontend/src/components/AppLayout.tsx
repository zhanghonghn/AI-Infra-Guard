import { useEffect, useState } from 'react';
import { Layout, Menu, theme, Typography } from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  ExperimentOutlined,
  InfoCircleOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { getVersion } from '@/api/version';

const { Header, Sider, Content } = Layout;

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
}

// Top-level navigation. New pages should add a route in App.tsx and an
// entry here. Keep ordering consistent with the original product IA.
const NAV_ITEMS: NavItem[] = [
  { key: '/tasks', icon: <UnorderedListOutlined />, label: '任务列表' },
  { key: '/knowledge/fingerprints', icon: <BookOutlined />, label: 'AI 应用指纹' },
  { key: '/knowledge/vulnerabilities', icon: <SafetyCertificateOutlined />, label: '漏洞库' },
  { key: '/knowledge/mcp', icon: <AppstoreOutlined />, label: 'MCP 插件' },
  { key: '/knowledge/evaluations', icon: <ExperimentOutlined />, label: '评测集' },
  { key: '/models', icon: <RobotOutlined />, label: '模型管理' },
  { key: '/about', icon: <InfoCircleOutlined />, label: '关于' },
];

export default function AppLayout() {
  const location = useLocation();
  const { token } = theme.useToken();
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    getVersion()
      .then((v) => setVersion(v?.version ?? ''))
      .catch(() => undefined);
  }, []);

  // Highlight the deepest-matching nav entry.
  const selectedKey =
    NAV_ITEMS.map((i) => i.key)
      .filter((k) => location.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0] ?? '/tasks';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        breakpoint="lg"
        collapsedWidth={64}
        style={{ background: token.colorBgContainer }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: 16,
            color: token.colorPrimary,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          A.I.G
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          style={{ borderInlineEnd: 'none' }}
          items={NAV_ITEMS.map((item) => ({
            key: item.key,
            icon: item.icon,
            label: <Link to={item.key}>{item.label}</Link>,
          }))}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            paddingInline: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            AI Infrastructure Guard
          </Typography.Title>
          <Typography.Text type="secondary">
            {version ? `v${version}` : ''}
          </Typography.Text>
        </Header>
        <Content style={{ padding: 24, background: token.colorBgLayout }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
