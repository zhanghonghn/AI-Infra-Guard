import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import TaskList from '@/pages/TaskList';
import TaskCreate from '@/pages/TaskCreate';
import TaskDetail from '@/pages/TaskDetail';
import Findings from '@/pages/Findings';
import Fingerprints from '@/pages/Fingerprints';
import Placeholder from '@/pages/Placeholder';
import About from '@/pages/About';
import SystemModels from '@/pages/system/Models';
import SystemDataUpdate from '@/pages/system/DataUpdate';
import SystemInfo from '@/pages/system/SystemInfo';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/tasks" replace />} />
        <Route path="tasks" element={<TaskList />} />
        <Route path="tasks/new" element={<TaskCreate />} />
        <Route path="tasks/:sessionId" element={<TaskDetail />} />
        <Route path="scans/:scanId/findings" element={<Findings />} />
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
        <Route path="system">
          <Route index element={<Navigate to="/system/models" replace />} />
          <Route path="models" element={<SystemModels />} />
          <Route path="data-update" element={<SystemDataUpdate />} />
          <Route path="info" element={<SystemInfo />} />
        </Route>
        {/* Backwards-compatible alias for the old top-level entry. */}
        <Route path="models" element={<Navigate to="/system/models" replace />} />
        <Route path="about" element={<About />} />
        <Route path="*" element={<Navigate to="/tasks" replace />} />
      </Route>
    </Routes>
  );
}


