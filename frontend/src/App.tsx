import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import TaskList from '@/pages/TaskList';
import TaskCreate from '@/pages/TaskCreate';
import TaskDetail from '@/pages/TaskDetail';
import Findings from '@/pages/Findings';
import Fingerprints from '@/pages/Fingerprints';
import Vulnerabilities from '@/pages/Vulnerabilities';
import McpPlugins from '@/pages/McpPlugins';
import Evaluations from '@/pages/Evaluations';
import About from '@/pages/About';
import SystemModels from '@/pages/system/Models';
import SystemDataUpdate from '@/pages/system/DataUpdate';
import SystemInfo from '@/pages/system/SystemInfo';
import Login from '@/pages/Login';
import { isLoggedIn } from '@/utils/auth';

function RequireAuth({ children }: { children: JSX.Element }) {
  const location = useLocation();
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/tasks" replace />} />
        <Route path="tasks" element={<TaskList />} />
        <Route path="tasks/new" element={<TaskCreate />} />
        <Route path="tasks/:sessionId" element={<TaskDetail />} />
        <Route path="scans/:scanId/findings" element={<Findings />} />
        <Route path="knowledge">
          <Route path="fingerprints" element={<Fingerprints />} />
          <Route path="vulnerabilities" element={<Vulnerabilities />} />
          <Route path="mcp" element={<McpPlugins />} />
          <Route path="evaluations" element={<Evaluations />} />
        </Route>
        <Route path="system">
          <Route index element={<Navigate to="/system/models" replace />} />
          <Route path="models" element={<SystemModels />} />
          <Route path="data-update" element={<SystemDataUpdate />} />
          <Route path="info" element={<SystemInfo />} />
        </Route>
        <Route path="models" element={<Navigate to="/system/models" replace />} />
        <Route path="about" element={<About />} />
        <Route path="*" element={<Navigate to="/tasks" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/tasks" replace />} />
    </Routes>
  );
}

