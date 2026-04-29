import { useEffect, useMemo, useState } from 'react';
import { Layout, Menu, theme, Typography } from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  CloudDownloadOutlined,
  ExperimentOutlined,
  InfoCircleOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { getVersion } from '@/api/version';

const { Header, Sider, Content } = Layout;

type MenuItem = Required<MenuProps>['items'][number];

// Top-level navigation. New pages should add a route in App.tsx and an
// entry here. Keep ordering consistent with the original product IA.
const NAV_ITEMS: MenuItem[] = [
  {
    key: '/tasks',
    icon: <UnorderedListOutlined />,
    label: <Link to="/tasks">任务列表</Link>,
  },
  {
    key: '/knowledge/fingerprints',
    icon: <BookOutlined />,
    label: <Link to="/knowledge/fingerprints">AI 应用指纹</Link>,
  },
  {
    key: '/knowledge/vulnerabilities',
    icon: <SafetyCertificateOutlined />,
    label: <Link to="/knowledge/vulnerabilities">漏洞库</Link>,
  },
  {
    key: '/knowledge/mcp',
    icon: <AppstoreOutlined />,
    label: <Link to="/knowledge/mcp">MCP 插件</Link>,
  },
  {
    key: '/knowledge/evaluations',
    icon: <ExperimentOutlined />,
    label: <Link to="/knowledge/evaluations">评测集</Link>,
  },
  {
    key: 'system',
    icon: <SettingOutlined />,
    label: '系统配置',
    children: [
      {
        key: '/system/models',
        icon: <RobotOutlined />,
        label: <Link to="/system/models">模型管理</Link>,
      },
      {
        key: '/system/data-update',
        icon: <CloudDownloadOutlined />,
        label: <Link to="/system/data-update">数据更新</Link>,
      },
      {
        key: '/system/info',
        icon: <InfoCircleOutlined />,
        label: <Link to="/system/info">系统信息</Link>,
      },
    ],
  },
  {
    key: '/about',
    icon: <InfoCircleOutlined />,
    label: <Link to="/about">关于</Link>,
  },
];

/** Flatten the menu tree so we can match a route prefix to the deepest key. */
function flattenKeys(items: MenuItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (!item) continue;
    const key = String((item as { key: React.Key }).key);
    if (key.startsWith('/')) out.push(key);
    const children = (item as { children?: MenuItem[] }).children;
    if (children) out.push(...flattenKeys(children));
  }
  return out;
}

const ALL_KEYS = flattenKeys(NAV_ITEMS);

export default function AppLayout() {
  const location = useLocation();
  const { token } = theme.useToken();
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    getVersion()
      .then((v) => setVersion(v?.version ?? ''))
      .catch(() => undefined);
  }, []);

  // Highlight the deepest-matching nav entry. A leaf with key `/system/models`
  // wins over a notional prefix `/system` because we sort by key length desc.
  const selectedKey = useMemo(
    () =>
      ALL_KEYS.filter((k) => location.pathname.startsWith(k)).sort(
        (a, b) => b.length - a.length,
      )[0] ?? '/tasks',
    [location.pathname],
  );

  // Auto-open the parent submenu when one of its children is active.
  const defaultOpenKeys = useMemo(
    () => (selectedKey.startsWith('/system/') ? ['system'] : []),
    [selectedKey],
  );

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
          defaultOpenKeys={defaultOpenKeys}
          style={{ borderInlineEnd: 'none' }}
          items={NAV_ITEMS}
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

