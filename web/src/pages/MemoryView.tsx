import React, { useEffect, useState } from 'react';
import { memoryApi, agentsApi } from '../api';
import type { Agent, LongTermMemory } from '../types';

interface DashboardData {
  stm: { activeCount: number; archivedCount: number; recentMessages: { role: string; content: string; timestamp: string }[] };
  ltm: { totalCount: number; byCategory: Record<string, number> };
}

const MemoryView: React.FC = () => {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [ltm, setLtm] = useState<LongTermMemory[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [filterAgentId, setFilterAgentId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [dashRes, agentsRes, ltmRes] = await Promise.all([
        memoryApi.getDashboard(),
        agentsApi.getAll(),
        memoryApi.getLtm(filterAgentId || undefined),
      ]);
      setDashboard(dashRes.data as DashboardData);
      setAgents(agentsRes.data);
      setLtm(ltmRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [filterAgentId]);

  const handleDelete = async (id: string) => {
    if (!confirm('删除该条长期记忆？')) return;
    try {
      await memoryApi.deleteLtm(id);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  if (loading && !dashboard) {
    return <div className="page-content">加载中...</div>;
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">记忆管理</h1>
        <p style={{ color: '#666', fontSize: 14, marginTop: 8 }}>
          短期记忆（会话）与长期记忆（事实）概览；可删除 LTM 条目。
        </p>
      </div>

      {dashboard && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div className="settings-section">
            <h3 className="settings-section-title">会话记忆 (STM)</h3>
            <div className="settings-item">
              <span className="settings-label">活跃消息数</span>
              <span>{dashboard.stm.activeCount}</span>
            </div>
            <div className="settings-item">
              <span className="settings-label">已归档</span>
              <span>{dashboard.stm.archivedCount}</span>
            </div>
          </div>
          <div className="settings-section">
            <h3 className="settings-section-title">长期记忆 (LTM)</h3>
            <div className="settings-item">
              <span className="settings-label">条目总数</span>
              <span>{dashboard.ltm.totalCount}</span>
            </div>
            {Object.entries(dashboard.ltm.byCategory).map(([cat, n]) => (
              <div key={cat} className="settings-item">
                <span className="settings-label">{cat}</span>
                <span>{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="settings-section" style={{ marginBottom: 16 }}>
        <h3 className="settings-section-title">筛选 LTM（Agent）</h3>
        <select
          value={filterAgentId}
          onChange={e => setFilterAgentId(e.target.value)}
          style={{ padding: 8, minWidth: 220 }}
        >
          <option value="">全部</option>
          {agents.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">长期记忆列表</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>
                <th style={{ padding: 8 }}>类别</th>
                <th style={{ padding: 8 }}>键</th>
                <th style={{ padding: 8 }}>内容摘要</th>
                <th style={{ padding: 8 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {ltm.map(row => (
                <tr key={row.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: 8 }}>{row.category}</td>
                  <td style={{ padding: 8, maxWidth: 160 }}>{row.key}</td>
                  <td style={{ padding: 8, maxWidth: 420, whiteSpace: 'pre-wrap' }}>{row.value.slice(0, 200)}{row.value.length > 200 ? '…' : ''}</td>
                  <td style={{ padding: 8 }}>
                    <button type="button" className="btn btn-sm" onClick={() => handleDelete(row.id)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ltm.length === 0 && (
            <div style={{ padding: 16, color: '#999' }}>暂无长期记忆</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MemoryView;
