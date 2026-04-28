import { useEffect, useState } from 'react';
import { Card, Skeleton, Typography } from 'antd';
import PageHeader from '@/components/PageHeader';
import { getVersion, type VersionInfo } from '@/api/version';

export default function About() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getVersion()
      .then((v) => setInfo(v))
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <PageHeader
        title="关于 A.I.G"
        description="Tencent Zhuque Lab — AI Infrastructure Guard"
      />
      {loading ? (
        <Skeleton active />
      ) : (
        <>
          <Typography.Paragraph>
            <Typography.Text strong>当前版本：</Typography.Text>
            {info?.version || '未知'}
          </Typography.Paragraph>
          <Typography.Title level={5}>更新日志</Typography.Title>
          <pre
            style={{
              background: '#f6f8fa',
              padding: 12,
              borderRadius: 4,
              maxHeight: 480,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {info?.changelog || '(暂无)'}
          </pre>
        </>
      )}
    </Card>
  );
}
