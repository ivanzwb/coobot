import React, { useEffect, useState } from 'react';
import { memoryApi, agentsApi } from '../api';
import type { Agent, MemoryDashboardData, UnifiedLtmItem } from '../types';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const MemoryView: React.FC = () => {
  const [dashboard, setDashboard] = useState<MemoryDashboardData | null>(null);
  const [ltm, setLtm] = useState<UnifiedLtmItem[]>([]);
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
      setDashboard(dashRes.data as MemoryDashboardData);
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
    if (!confirm('删除该条长期记忆？（将先尝试 Agent Brain 库，否则 Coobot 库）')) return;
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
          Coobot 会话 STM（Drizzle）与双源 LTM：Coobot 表 + Agent Brain（@biosbot/agent-memory）；删除会按 ID 双库尝试。
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
            <h3 className="settings-section-title">长期记忆 (LTM) 合并</h3>
            <div className="settings-item">
              <span className="settings-label">条目总数</span>
              <span>{dashboard.ltm.totalCount}</span>
            </div>
            <div className="settings-item">
              <span className="settings-label">Coobot 表（活跃）</span>
              <span>{dashboard.ltm.coobotTotal}</span>
            </div>
            <div className="settings-item">
              <span className="settings-label">Agent Brain LTM 活跃</span>
              <span>{dashboard.ltm.brainLtmActive}</span>
            </div>
            <div className="settings-item">
              <span className="settings-label">Agent Brain LTM 休眠</span>
              <span>{dashboard.ltm.brainLtmDormant}</span>
            </div>
            {Object.entries(dashboard.ltm.byCategory).map(([cat, n]) => (
              <div key={cat} className="settings-item">
                <span className="settings-label">{cat}</span>
                <span>{n}</span>
              </div>
            ))}
          </div>
          {dashboard.agentMemory && (
            <div className="settings-section">
              <h3 className="settings-section-title">Agent Brain 记忆库</h3>
              <div className="settings-item">
                <span className="settings-label">对话消息（活跃 / 归档）</span>
                <span>
                  {dashboard.agentMemory.stats.conversation.activeCount} /{' '}
                  {dashboard.agentMemory.stats.conversation.archivedCount}
                </span>
              </div>
              <div className="settings-item">
                <span className="settings-label">知识块 / 来源数</span>
                <span>
                  {dashboard.agentMemory.stats.knowledge.chunkCount} /{' '}
                  {dashboard.agentMemory.stats.knowledge.sourceCount}
                </span>
              </div>
              <div className="settings-item">
                <span className="settings-label">存储（SQLite / 向量）</span>
                <span>
                  {formatBytes(dashboard.agentMemory.stats.storage.sqliteBytes)} /{' '}
                  {formatBytes(dashboard.agentMemory.stats.storage.vectorIndexBytes)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {dashboard?.agentMemory && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div className="settings-section">
            <h3 className="settings-section-title">Brain 近期对话（截断）</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#444' }}>
              {dashboard.agentMemory.recentMessages.map((m, i) => (
                <li key={`${m.conversationId}-${i}`} style={{ marginBottom: 6 }}>
                  <span style={{ color: '#888' }}>{m.role}</span> · {m.content}
                  <div style={{ fontSize: 11, color: '#aaa' }}>{m.createdAt}</div>
                </li>
              ))}
            </ul>
            {dashboard.agentMemory.recentMessages.length === 0 && (
              <div style={{ padding: 8, color: '#999' }}>暂无</div>
            )}
          </div>
          <div className="settings-section">
            <h3 className="settings-section-title">Brain 知识预览</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#444' }}>
              {dashboard.agentMemory.knowledgePreview.map((k) => (
                <li key={k.id} style={{ marginBottom: 8 }}>
                  <strong>{k.title}</strong>
                  <span style={{ color: '#888' }}> ({k.source})</span>
                  <div style={{ marginTop: 2 }}>{k.preview}</div>
                </li>
              ))}
            </ul>
            {dashboard.agentMemory.knowledgePreview.length === 0 && (
              <div style={{ padding: 8, color: '#999' }}>暂无</div>
            )}
          </div>
        </div>
      )}

      <div className="settings-section" style={{ marginBottom: 16 }}>
        <h3 className="settings-section-title">筛选 LTM（仅 Coobot 按 Agent；Brain 条目始终列出）</h3>
        <select
          value={filterAgentId}
          onChange={(e) => setFilterAgentId(e.target.value)}
          style={{ padding: 8, minWidth: 220 }}
        >
          <option value="">全部</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">长期记忆列表</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>
                <th style={{ padding: 8 }}>来源</th>
                <th style={{ padding: 8 }}>Agent</th>
                <th style={{ padding: 8 }}>类别</th>
                <th style={{ padding: 8 }}>键</th>
                <th style={{ padding: 8 }}>内容摘要</th>
                <th style={{ padding: 8 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {ltm.map((row) => (
                <tr key={`${row.store}-${row.id}`} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                    {row.store === 'agent-memory' ? 'Brain' : 'Coobot'}
                  </td>
                  <td style={{ padding: 8 }}>{row.agentId ?? '—'}</td>
                  <td style={{ padding: 8 }}>{row.category}</td>
                  <td style={{ padding: 8, maxWidth: 160 }}>{row.key}</td>
                  <td style={{ padding: 8, maxWidth: 360, whiteSpace: 'pre-wrap' }}>
                    {row.value.slice(0, 200)}
                    {row.value.length > 200 ? '…' : ''}
                  </td>
                  <td style={{ padding: 8 }}>
                    <button type="button" className="btn btn-sm" onClick={() => handleDelete(row.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ltm.length === 0 && <div style={{ padding: 16, color: '#999' }}>暂无长期记忆</div>}
        </div>
      </div>
    </div>
  );
};

export default MemoryView;
