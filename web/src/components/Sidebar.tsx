import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { sidebarOpen } = useAppStore();

  const navItems = [
    { key: '/', label: '对话', icon: '💬' },
    { key: '/agents', label: 'Agent', icon: '🤖' },
    { key: '/knowledge', label: '知识库', icon: '📚' },
    { key: '/prompts', label: 'Prompt', icon: '📝' },
    { key: '/skills', label: 'Skills', icon: '🛠️' },
    { key: '/memory', label: '记忆', icon: '🧠' },
    { key: '/scheduler', label: '定时任务', icon: '⏰' },
    { key: '/monitor', label: '监控', icon: '📊' },
    { key: '/settings', label: '设置', icon: '⚙️' },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">B</div>
        {sidebarOpen && <span className="sidebar-title">BiosBot</span>}
      </div>
      <nav className="sidebar-nav">
        {navItems.map(item => (
          <div
            key={item.key}
            className={`nav-item ${isActive(item.key) ? 'active' : ''}`}
            onClick={() => navigate(item.key)}
          >
            <span className="nav-icon">{item.icon}</span>
            {sidebarOpen && <span>{item.label}</span>}
          </div>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;