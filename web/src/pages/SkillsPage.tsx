import { useState, useEffect } from 'react';
import { api } from '../api/client';

interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  status: string;
  createdAt: string;
}

export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    instructions: ''
  });

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      setLoading(true);
      const data = await api.getSkills();
      setSkills(data as Skill[]);
    } catch (error) {
      console.error('Failed to load skills:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      await api.createSkill(formData);
      setShowForm(false);
      setFormData({ name: '', description: '', instructions: '' });
      loadSkills();
    } catch (error) {
      console.error('Failed to create skill:', error);
    }
  };

  const handleActivate = async (skillId: string) => {
    try {
      await api.activateSkill(skillId);
      alert('Skill 激活成功');
    } catch (error) {
      console.error('Failed to activate:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个Skill吗?')) return;
    try {
      await api.deleteSkill(id);
      loadSkills();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  return (
    <div className="content">
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Skills 管理</h2>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? '取消' : '创建 Skill'}
          </button>
        </div>

        {showForm && (
          <div style={{ marginBottom: 24, padding: 16, background: '#f9fafb', borderRadius: 8 }}>
            <div className="form-group">
              <label className="form-label">名称</label>
              <input
                type="text"
                className="form-input"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="输入 Skill 名称"
              />
            </div>
            <div className="form-group">
              <label className="form-label">描述</label>
              <textarea
                className="form-input"
                rows={2}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="描述 Skill 功能"
              />
            </div>
            <div className="form-group">
              <label className="form-label">指令</label>
              <textarea
                className="form-input"
                rows={6}
                value={formData.instructions}
                onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                placeholder="输入 Skill 指令模板"
              />
            </div>
            <button className="btn btn-primary" onClick={handleCreate}>
              创建
            </button>
          </div>
        )}

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : skills.length === 0 ? (
          <div className="empty-state">
            <h3>暂无 Skills</h3>
            <p>创建您的第一个 Skill</p>
          </div>
        ) : (
          <div className="task-list">
            {skills.map((skill) => (
              <div key={skill.id} className="task-item">
                <div className="task-header">
                  <span style={{ fontWeight: 500 }}>{skill.name}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                      onClick={() => handleActivate(skill.id)}
                    >
                      激活
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                      onClick={() => handleDelete(skill.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div className="task-summary">{skill.description}</div>
                {skill.instructions && (
                  <div style={{ marginTop: 8, padding: 8, background: '#f3f4f6', borderRadius: 4, fontSize: 12 }}>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{skill.instructions.substring(0, 200)}...</pre>
                  </div>
                )}
                <div className="task-meta">
                  <span>状态: {skill.status}</span>
                  <span>{new Date(skill.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
