import { Card, Empty, Typography } from 'antd';
import PageHeader from '@/components/PageHeader';

interface PlaceholderProps {
  title: string;
  apiHint?: string;
}

/**
 * Placeholder for routes that have not yet been ported to the new source
 * project. Each entry should eventually become its own page module under
 * src/pages/. See frontend/README.md for guidance on how to add a page.
 */
export default function Placeholder({ title, apiHint }: PlaceholderProps) {
  return (
    <Card>
      <PageHeader
        title={title}
        description="此页面尚未在新前端工程中实现，欢迎按 README 指南补齐。"
      />
      <Empty
        description={
          <div>
            <Typography.Paragraph>
              该模块对应的后端接口已就绪，但前端源码版本尚未完成。
            </Typography.Paragraph>
            {apiHint ? (
              <Typography.Paragraph type="secondary">
                参考接口：<code>{apiHint}</code>
              </Typography.Paragraph>
            ) : null}
          </div>
        }
      />
    </Card>
  );
}
