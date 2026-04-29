import { useState } from 'react';
import { Button, Card, Form, Input, Typography, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { login } from '@/api/auth';
import { isLoggedIn, saveLoginSession } from '@/utils/auth';

type LoginForm = {
  username: string;
  password: string;
};

type LoginLocationState = {
  from?: {
    pathname?: string;
    search?: string;
    hash?: string;
  };
};

function resolveReturnPath(state: LoginLocationState | null): string {
  const from = state?.from;
  if (!from?.pathname || from.pathname === '/login') return '/tasks';
  return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
}

export default function Login() {
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath = resolveReturnPath((location.state as LoginLocationState) ?? null);

  if (isLoggedIn()) {
    return <Navigate to={returnPath} replace />;
  }

  const onFinish = async (values: LoginForm) => {
    try {
      setSubmitting(true);
      const resp = await login({
        username: values.username.trim(),
        password: values.password,
      });
      saveLoginSession({
        username: resp.username,
        token: resp.token,
        expiresAt: resp.expires_at,
      });
      message.success('登录成功');
      navigate(returnPath, { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 420 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          A.I.G 登录
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          登录后可访问任务管理与知识库功能。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          默认管理员账号：admin / admin
        </Typography.Paragraph>
        <Form<LoginForm> layout="vertical" onFinish={onFinish} autoComplete="off">
          <Form.Item
            label="用户名"
            name="username"
            rules={[
              { required: true, message: '请输入用户名' },
              { max: 64, message: '用户名长度不能超过 64' },
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
