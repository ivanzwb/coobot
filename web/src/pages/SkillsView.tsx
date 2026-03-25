import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface Skill {
  id: string;
  name: string;
  description: string;
  version?: string;
  runtimeLanguage?: string;
  tools: { name: string; description: string; riskLevel: string }[];
}

const SkillsView: React.FC = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSkills();
  }, []);

  const fetchSkills = async () => {
    try {
      const response = await axios.get('/api/v1/skills');
      setSkills(response.data);
    } catch (error) {
      console.error('Failed to fetch skills:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUninstall = async (id: string) => {
    if (!confirm('确定要卸载这个 Skill 吗？')) return;
    try {
      await axios.delete(`/api/v1/skills/${id}`);
      fetchSkills();
    } catch (error: any) {
      alert(error.response?.data?.error || '卸载失败');
    }
  };

  const getRiskBadge = (level: string) => {
    const colors: Record<string, string> = {
      low: '#52c41a',
      medium: '#faad14',
      high: '#ff4d4f',
    };
    return (
      <span style={{ 
        padding: '2px 8px', 
        borderRadius: 4, 
        fontSize: 12,
        background: colors[level] || '#999',
        color: 'white',
      }}>
        {level}
      </span>
    );
  };

  if (loading) {
    return <div className="page-content">加载中...</div>;
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Skill 管理</h1>
        <button className="btn btn-primary">
          + 安装 Skill
        </button>
      </div>

      <div>
        {skills.map(skill => (
          <div key={skill.id} className="agent-card">
            <div className="agent-card-header">
              <span className="agent-name">{skill.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {skill.version && <span className="tag">v{skill.version}</span>}
                {skill.runtimeLanguage && <span className="tag">{skill.runtimeLanguage}</span>}
                <button 
                  className="btn btn-danger"
                  onClick={() => handleUninstall(skill.id)}
                  style={{ padding: '4px 8px', fontSize: 12 }}
                >
                  卸载
                </button>
              </div>
            </div>
            <p style={{ color: '#666', marginBottom: 12 }}>{skill.description}</p>
            
            {skill.tools.length > 0 && (
              <div>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>提供的工具:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {skill.tools.map((tool, i) => (
                    <div key={i} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: '#f5f5f5',
                      borderRadius: 6,
                    }}>
                      <div>
                        <code style={{ fontWeight: 500 }}>{tool.name}</code>
                        <span style={{ color: '#666', marginLeft: 8 }}>{tool.description}</span>
                      </div>
                      {getRiskBadge(tool.riskLevel)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {skills.length === 0 && (
          <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>
            暂无已安装的 Skill，点击上方按钮安装
          </div>
        )}
      </div>
    </div>
  );
};

export default SkillsView;