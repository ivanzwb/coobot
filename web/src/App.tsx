import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './stores/appStore';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { TaskList } from './components/TaskList';
import { TaskDetail } from './components/TaskDetail';
import { KnowledgePage } from './pages/KnowledgePage';
import { MemoryPage } from './pages/MemoryPage';
import { AgentsPage } from './pages/AgentsPage';
import { SkillsPage } from './pages/SkillsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ResultPage } from './pages/ResultPage';

function App() {
  const { init } = useAppStore();
  
  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatArea />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/tasks/:taskId" element={<TaskDetail />} />
          <Route path="/results/:taskId" element={<ResultPage />} />
          <Route path="/knowledge/:agentId?" element={<KnowledgePage />} />
          <Route path="/memory/:agentId?" element={<MemoryPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
