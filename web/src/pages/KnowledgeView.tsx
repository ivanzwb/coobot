import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface KnowledgeFile {
  id: string;
  agentId: string;
  fileName: string;
  filePath: string;
  status: 'PROCESSING' | 'READY' | 'ERROR';
  version: number;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
  type: string;
}

const KnowledgeView: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAgents();
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      fetchFiles(selectedAgent);
    }
  }, [selectedAgent]);

  const fetchAgents = async () => {
    try {
      const response = await axios.get('/api/v1/agents');
      setAgents(response.data);
      if (response.data.length > 0) {
        setSelectedAgent(response.data[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch agents:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchFiles = async (agentId: string) => {
    try {
      const response = await axios.get(`/api/v1/knowledge/${agentId}/files`);
      setFiles(response.data);
    } catch (error) {
      console.error('Failed to fetch files:', error);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedAgent) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      await axios.post(`/api/v1/knowledge/${selectedAgent}/upload`, {
        file: {
          name: file.name,
        },
      });
      fetchFiles(selectedAgent);
    } catch (error) {
      console.error('Failed to upload file:', error);
    }
  };

  const handleDelete = async (fileId: string) => {
    if (!confirm('确定要删除这个文件吗？')) return;
    
    try {
      await axios.delete(`/api/v1/knowledge/${selectedAgent}/files/${fileId}`, {
        params: { deletePhysical: false },
      });
      fetchFiles(selectedAgent);
    } catch (error) {
      console.error('Failed to delete file:', error);
    }
  };

  const handleReindex = async (fileId: string) => {
    try {
      await axios.post(`/api/v1/knowledge/${selectedAgent}/files/${fileId}/reindex`);
      alert('重新解析已触发');
    } catch (error) {
      console.error('Failed to reindex file:', error);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      READY: '#52c41a',
      PROCESSING: '#1890ff',
      ERROR: '#ff4d4f',
    };
    const labels: Record<string, string> = {
      READY: '就绪',
      PROCESSING: '处理中',
      ERROR: '错误',
    };
    return (
      <span style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 12,
        background: colors[status] || '#999',
        color: 'white',
      }}>
        {labels[status] || status}
      </span>
    );
  };

  if (loading) {
    return <div className="page-content">加载中...</div>;
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">知识库管理</h1>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={{ marginRight: 12 }}>选择 Agent:</label>
        <select
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          className="form-input"
          style={{ width: 200, display: 'inline-block' }}
        >
          {agents.map(agent => (
            <option key={agent.id} value={agent.id}>
              {agent.name} ({agent.type === 'LEADER' ? 'Leader' : 'Domain'})
            </option>
          ))}
        </select>
      </div>

      <div className="settings-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 className="settings-section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
            文件列表 ({files.length})
          </h3>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            + 上传文件
            <input
              type="file"
              accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg"
              onChange={handleUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e8e8e8' }}>
              <th style={{ textAlign: 'left', padding: 12 }}>文件名</th>
              <th style={{ textAlign: 'left', padding: 12 }}>状态</th>
              <th style={{ textAlign: 'left', padding: 12 }}>版本</th>
              <th style={{ textAlign: 'left', padding: 12 }}>上传时间</th>
              <th style={{ textAlign: 'left', padding: 12 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {files.map(file => (
              <tr key={file.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: 12, fontWeight: 500 }}>{file.fileName}</td>
                <td style={{ padding: 12 }}>{getStatusBadge(file.status)}</td>
                <td style={{ padding: 12 }}>v{file.version}</td>
                <td style={{ padding: 12 }}>{new Date(file.createdAt).toLocaleString()}</td>
                <td style={{ padding: 12 }}>
                  <button
                    className="btn"
                    onClick={() => handleReindex(file.id)}
                    style={{ marginRight: 8, padding: '4px 8px', fontSize: 12 }}
                  >
                    重新解析
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDelete(file.id)}
                    style={{ padding: '4px 8px', fontSize: 12 }}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {files.length === 0 && (
          <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>
            该 Agent 暂无知识库文件，请上传
          </div>
        )}
      </div>
    </div>
  );
};

export default KnowledgeView;