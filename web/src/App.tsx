import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from './stores/appStore';
import { getClientContext } from './api/client';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { TaskList } from './components/TaskList';
import { TaskDetail } from './components/TaskDetail';
import { PermissionPanel } from './components/PermissionConfirmModal';
import { KnowledgePage } from './pages/KnowledgePage';
import { MemoryPage } from './pages/MemoryPage';
import { AgentsPage } from './pages/AgentsPage';
import { SkillsPage } from './pages/SkillsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ResultPage } from './pages/ResultPage';
import { DashboardPage } from './pages/DashboardPage';
import { PromptsPage } from './pages/PromptsPage';
import { AgentPromptsPage } from './pages/AgentPromptsPage';
import { TaskCheckpointsPage } from './pages/TaskCheckpointsPage';
import { buildWebSocketUrl, getRealtimeTaskIds, isTerminalTaskStatus } from './realtime/taskRealtime';

function App() {
  const { init, conversationId, currentTask, tasks, fetchMessages, fetchTasks, fetchTaskDetail, handleRealtimeEvent, setWsConnected } = useAppStore();
  const socketRef = useRef<WebSocket | null>(null);
  const subscribedTaskIdsRef = useRef<Set<string>>(new Set());
  const realtimeTaskIds = getRealtimeTaskIds(tasks, currentTask?.id);
  const navigate = useNavigate();
  const location = useLocation();
  const routeConversationId = location.pathname.match(/^\/chat\/([^/]+)$/)?.[1];
  const isChatRoute = location.pathname === '/chat' || location.pathname.startsWith('/chat/');
  const [chatDisplayedPermissionRequestIds, setChatDisplayedPermissionRequestIds] = useState<string[]>([]);

  useEffect(() => {
    void init(routeConversationId);
  }, [init, routeConversationId]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    if (location.pathname === '/chat') {
      navigate(`/chat/${conversationId}`, { replace: true });
    }
  }, [conversationId, location.pathname, navigate]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    void fetchMessages({ silent: true });
  }, [conversationId, fetchMessages]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const { clientId, entryPoint } = getClientContext();
    const socket = new WebSocket(buildWebSocketUrl(window.location.origin, clientId, entryPoint));
    socketRef.current = socket;

    socket.onopen = () => {
      const initialTaskIds = new Set(realtimeTaskIds);
      for (const taskId of initialTaskIds) {
        socket.send(JSON.stringify({ type: 'subscribe', taskId }));
      }
      subscribedTaskIdsRef.current = initialTaskIds;
    };

    socket.onmessage = (event) => {
      try {
        void handleRealtimeEvent(JSON.parse(event.data));
      } catch (error) {
        console.error('Failed to handle realtime event', error);
      }
    };

    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
        subscribedTaskIdsRef.current = new Set();
        setWsConnected(false);
      }
    };

    socket.onerror = () => {
      setWsConnected(false);
    };

    return () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      subscribedTaskIdsRef.current = new Set();
      setWsConnected(false);
      socket.close();
    };
  }, [conversationId, handleRealtimeEvent, setWsConnected]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const nextIds = new Set(realtimeTaskIds);

    for (const taskId of subscribedTaskIdsRef.current) {
      if (!nextIds.has(taskId)) {
        socket.send(JSON.stringify({ type: 'unsubscribe', taskId }));
      }
    }

    for (const taskId of nextIds) {
      if (!subscribedTaskIdsRef.current.has(taskId)) {
        socket.send(JSON.stringify({ type: 'subscribe', taskId }));
      }
    }

    subscribedTaskIdsRef.current = nextIds;
  }, [realtimeTaskIds]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const hasActiveTasks = tasks.some((task) => !isTerminalTaskStatus(task.status));
    const activeTaskId = currentTask?.id;

    if (!hasActiveTasks && !activeTaskId) {
      return;
    }

    const timer = window.setInterval(() => {
      fetchTasks({ silent: true });

      if (activeTaskId) {
        fetchTaskDetail(activeTaskId, { silent: true });
      }
    }, 3000);

    return () => window.clearInterval(timer);
  }, [conversationId, currentTask?.id, tasks, fetchTaskDetail, fetchTasks]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <PermissionPanel
          disabled={isChatRoute}
          excludeRequestIds={chatDisplayedPermissionRequestIds}
        />
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route
            path="/chat"
            element={<ChatArea onPermissionRequestIdsChange={setChatDisplayedPermissionRequestIds} />}
          />
          <Route
            path="/chat/:conversationId"
            element={<ChatArea onPermissionRequestIdsChange={setChatDisplayedPermissionRequestIds} />}
          />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/tasks/:taskId" element={<TaskDetail />} />
          <Route path="/tasks/:taskId/checkpoints" element={<TaskCheckpointsPage />} />
          <Route path="/results/:taskId" element={<ResultPage />} />
          <Route path="/knowledge/:agentId?" element={<KnowledgePage />} />
          <Route path="/memory/:agentId?" element={<MemoryPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:agentId/prompts" element={<AgentPromptsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/monitor" element={<DashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
