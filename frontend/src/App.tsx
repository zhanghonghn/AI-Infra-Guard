import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import TaskList from '@/pages/TaskList';
import Fingerprints from '@/pages/Fingerprints';
import Placeholder from '@/pages/Placeholder';
import About from '@/pages/About';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/tasks" replace />} />
        <Route path="tasks" element={<TaskList />} />
        <Route path="knowledge">
          <Route path="fingerprints" element={<Fingerprints />} />
          <Route
            path="vulnerabilities"
            element={
              <Placeholder
                title="漏洞库"
                apiHint="GET /api/v1/knowledge/vulnerabilities"
              />
            }
          />
          <Route
            path="mcp"
            element={
              <Placeholder title="MCP 插件" apiHint="GET /api/v1/knowledge/mcp" />
            }
          />
          <Route
            path="evaluations"
            element={
              <Placeholder
                title="评测集"
                apiHint="GET /api/v1/knowledge/evaluations"
              />
            }
          />
        </Route>
        <Route
          path="models"
          element={
            <Placeholder title="模型管理" apiHint="GET /api/v1/app/models" />
          }
        />
        <Route path="about" element={<About />} />
        <Route path="*" element={<Navigate to="/tasks" replace />} />
      </Route>
    </Routes>
  );
}
