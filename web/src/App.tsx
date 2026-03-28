import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAppStore } from './stores/appStore';
import Sidebar from './components/Sidebar';
import ChatView from './pages/ChatView';
import AgentsView from './pages/AgentsView';
import SettingsView from './pages/SettingsView';
import PromptsView from './pages/PromptsView';
import SkillsView from './pages/SkillsView';
import TaskDetailView from './pages/TaskDetailView';
import MonitorView from './pages/MonitorView';
import KnowledgeView from './pages/KnowledgeView';
import MemoryView from './pages/MemoryView';
import SchedulerView from './pages/SchedulerView';
import './App.css';

function App() {
  const { sidebarOpen } = useAppStore();

  return (
    <BrowserRouter>
      <div className="app">
        <Sidebar />
        <main className={`main-content ${sidebarOpen ? '' : 'sidebar-closed'}`}>
          <Routes>
            <Route path="/" element={<ChatView />} />
            <Route path="/chat" element={<ChatView />} />
            <Route path="/agents" element={<AgentsView />} />
            <Route path="/knowledge" element={<KnowledgeView />} />
            <Route path="/prompts" element={<PromptsView />} />
            <Route path="/skills" element={<SkillsView />} />
            <Route path="/monitor" element={<MonitorView />} />
            <Route path="/memory" element={<MemoryView />} />
            <Route path="/scheduler" element={<SchedulerView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="/tasks/:id" element={<TaskDetailView />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;