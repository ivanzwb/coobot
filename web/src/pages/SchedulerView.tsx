import React, { useEffect, useState } from 'react';
import { schedulerApi, agentsApi } from '../api';
import type { ScheduledJob, AgentBrainCronJob, Agent } from '../types';

const SchedulerView: React.FC = () => {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [agentBrainJobs, setAgentBrainJobs] = useState<AgentBrainCronJob[]>([]);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<unknown[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    cronExpression: '0 9 * * *',
    targetAgentId: '',
    prompt: '',
  });

  const load = async () => {
    try {
      const [j, ab, s, a] = await Promise.all([
        schedulerApi.getJobs(),
        schedulerApi.getAgentBrainJobs().catch(() => ({ data: { jobs: [] as AgentBrainCronJob[] } })),
        schedulerApi.getStatus(),
        agentsApi.getAll(),
      ]);
      setJobs(j.data);
      setAgentBrainJobs(ab.data.jobs ?? []);
      setStatus(s.data as Record<string, unknown>);
      setAgents(a.data.filter(x => x.type !== 'LEADER'));
      if (!form.targetAgentId && a.data.length) {
        const first = a.data.find(x => x.type !== 'LEADER') || a.data[0];
        setForm(f => ({ ...f, targetAgentId: first?.id || '' }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadLogs = async (jobId: string) => {
    try {
      const res = await schedulerApi.getLogs(jobId);
      setLogs(res.data as unknown[]);
    } catch (e) {
      console.error(e);
    }
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    await loadLogs(id);
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.cronExpression.trim() || !form.targetAgentId || !form.prompt.trim()) {
      alert('请填写名称、Cron、目标 Agent 与任务模板（prompt）');
      return;
    }
    try {
      await schedulerApi.createJob({
        name: form.name,
        description: form.description,
        cronExpression: form.cronExpression,
        taskTemplate: {
          prompt: form.prompt,
          targetAgentId: form.targetAgentId,
          attachments: [],
          clarificationData: null,
        },
      });
      setShowCreate(false);
      setForm(f => ({ ...f, name: '', description: '', prompt: '' }));
      await load();
    } catch (e) {
      console.error(e);
      alert('创建失败');
    }
  };

  const handleTrigger = async (id: string) => {
    try {
      await schedulerApi.triggerNow(id);
      await load();
      alert('已触发，任务已创建');
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleEnabled = async (job: ScheduledJob) => {
    try {
      if (job.enabled) await schedulerApi.disableJob(job.id);
      else await schedulerApi.enableJob(job.id);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('删除该定时任务？')) return;
    try {
      await schedulerApi.deleteJob(id);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteAgentBrain = async (id: string) => {
    if (!confirm('删除该对话创建的定时任务？')) return;
    try {
      await schedulerApi.deleteAgentBrainJob(id);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleTriggerAgentBrain = async (id: string) => {
    try {
      await schedulerApi.triggerAgentBrainJob(id);
      await load();
      alert('已触发，任务已入队');
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleAgentBrain = async (job: AgentBrainCronJob) => {
    try {
      if (job.status === 'active') await schedulerApi.pauseAgentBrainJob(job.id);
      else await schedulerApi.resumeAgentBrainJob(job.id);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return <div className="page-content">加载中...</div>;
  }

  return (
    <div className="page-content">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">定时任务</h1>
          <p style={{ color: '#666', fontSize: 14, marginTop: 8 }}>
            Cron 调度、手动触发与执行历史。下方「对话定时任务」为聊天里 Agent 通过内置{' '}
            <code>cron_add</code> 创建的任务。调度器状态：{status ? JSON.stringify(status) : '—'}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? '取消新建' : '新建任务'}
        </button>
      </div>

      {showCreate && (
        <div className="settings-section" style={{ marginBottom: 24 }}>
          <h3 className="settings-section-title">新建定时任务</h3>
          <div style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
            <label>
              名称
              <input className="chat-input" style={{ width: '100%', display: 'block' }} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </label>
            <label>
              说明
              <input className="chat-input" style={{ width: '100%', display: 'block' }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </label>
            <label>
              Cron 表达式
              <input className="chat-input" style={{ width: '100%', display: 'block' }} value={form.cronExpression} onChange={e => setForm(f => ({ ...f, cronExpression: e.target.value }))} placeholder="0 9 * * *" />
            </label>
            <label>
              目标 Agent
              <select
                className="chat-input"
                style={{ width: '100%', display: 'block' }}
                value={form.targetAgentId}
                onChange={e => setForm(f => ({ ...f, targetAgentId: e.target.value }))}
              >
                <option value="">—</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            <label>
              任务内容 (prompt)
              <textarea
                className="chat-input"
                rows={4}
                style={{ width: '100%', display: 'block' }}
                value={form.prompt}
                onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
              />
            </label>
            <button type="button" className="btn btn-primary" onClick={handleCreate}>保存</button>
          </div>
        </div>
      )}

      <div className="settings-section">
        <h3 className="settings-section-title">对话定时任务（AgentBrain）</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>
                <th style={{ padding: 8 }}>名称</th>
                <th style={{ padding: 8 }}>Cron (UTC)</th>
                <th style={{ padding: 8 }}>触发内容</th>
                <th style={{ padding: 8 }}>状态</th>
                <th style={{ padding: 8 }}>下次运行</th>
                <th style={{ padding: 8 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {agentBrainJobs.map((job) => (
                <tr key={job.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: 8 }}>{job.name || '—'}</td>
                  <td style={{ padding: 8 }}>
                    <code>{job.cronExpression}</code>
                  </td>
                  <td
                    style={{ padding: 8, maxWidth: 280, wordBreak: 'break-word' }}
                    title={job.command}
                  >
                    {job.command.length > 120 ? `${job.command.slice(0, 120)}…` : job.command}
                  </td>
                  <td style={{ padding: 8 }}>{job.status === 'active' ? '运行中' : job.status === 'paused' ? '已暂停' : job.status}</td>
                  <td style={{ padding: 8 }}>
                    {job.nextRunTime
                      ? new Date(job.nextRunTime).toLocaleString('zh-CN')
                      : '—'}
                  </td>
                  <td style={{ padding: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button type="button" className="btn btn-sm" onClick={() => void handleTriggerAgentBrain(job.id)}>
                      立即触发
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => void handleToggleAgentBrain(job)}>
                      {job.status === 'active' ? '暂停' : '恢复'}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => void handleDeleteAgentBrain(job.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {agentBrainJobs.length === 0 && (
            <div style={{ padding: 16, color: '#999' }}>暂无对话创建的定时任务</div>
          )}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">手动创建的定时任务</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>
                <th style={{ padding: 8 }}>名称</th>
                <th style={{ padding: 8 }}>Cron</th>
                <th style={{ padding: 8 }}>启用</th>
                <th style={{ padding: 8 }}>下次运行</th>
                <th style={{ padding: 8 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
                <React.Fragment key={job.id}>
                  <tr style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: 8 }}>{job.name}</td>
                    <td style={{ padding: 8 }}><code>{job.cronExpression}</code></td>
                    <td style={{ padding: 8 }}>{job.enabled ? '是' : '否'}</td>
                    <td style={{ padding: 8 }}>{job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : '—'}</td>
                    <td style={{ padding: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button type="button" className="btn btn-sm" onClick={() => handleTrigger(job.id)}>立即触发</button>
                      <button type="button" className="btn btn-sm" onClick={() => handleToggleEnabled(job)}>{job.enabled ? '禁用' : '启用'}</button>
                      <button type="button" className="btn btn-sm" onClick={() => toggleExpand(job.id)}>{expandedId === job.id ? '收起历史' : '执行历史'}</button>
                      <button type="button" className="btn btn-sm" onClick={() => handleDelete(job.id)}>删除</button>
                    </td>
                  </tr>
                  {expandedId === job.id && (
                    <tr>
                      <td colSpan={5} style={{ padding: 12, background: '#fafafa', verticalAlign: 'top' }}>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(logs, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {jobs.length === 0 && (
            <div style={{ padding: 16, color: '#999' }}>暂无定时任务</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SchedulerView;
