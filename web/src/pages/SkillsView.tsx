import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface Skill {
  id: string;
  name: string;
  description: string;
  version?: string;
  runtimeLanguage?: string;
  installMode?: string;
  enabled?: boolean;
  tools: { name: string; description: string }[];
}

interface SkillPreview {
  skillId?: string;
  /** Present when zip was staged under server temp; import sends this instead of re-uploading the zip. */
  previewId?: string;
  name: string;
  description: string;
  version?: string;
  runtimeLanguage?: string;
  installMode?: string;
  tools: { name: string; description: string; invoke?: unknown }[];
}

const SkillsView: React.FC = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState('');

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setInstallError('');
    setLoadingPreview(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        console.log('[SkillsView] File type:', file.type);
        console.log('[SkillsView] File size:', file.size);
        const base64 = (reader.result as string).split(',')[1];
        console.log('[SkillsView] Base64 length:', base64.length);
        const response = await axios.post('/api/v1/skills/preview', {
          fileContent: base64,
          encoding: 'base64',
        });
        setPreview(response.data);
        setShowPreviewModal(true);
        setLoadingPreview(false);
      };
      reader.onerror = () => {
        setInstallError('读取文件失败');
        setLoadingPreview(false);
      };
      reader.readAsDataURL(file);
    } catch (error: any) {
      setInstallError(error.response?.data?.error || '预览失败');
      setLoadingPreview(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!preview || !selectedFile) return;

    setInstalling(true);
    setInstallError('');

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        if (preview.previewId) {
          await axios.post('/api/v1/skills/import', { previewId: preview.previewId });
        } else {
          await axios.post('/api/v1/skills/import', {
            fileContent: base64,
            encoding: 'base64',
          });
        }
        resetAndRefresh();
      };
      reader.onerror = () => {
        setInstallError('读取文件失败');
        setInstalling(false);
      };
      reader.readAsDataURL(selectedFile);
    } catch (error: any) {
      setInstallError(error.response?.data?.error || '导入失败');
      setInstalling(false);
    }
  };

  const resetAndRefresh = () => {
    setShowInstallModal(false);
    setShowPreviewModal(false);
    setSelectedFile(null);
    setPreview(null);
    setInstalling(false);
    fetchSkills();
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

  if (loading) {
    return <div className="page-content">加载中...</div>;
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Skills</h1>
        <button className="btn btn-primary" onClick={() => setShowInstallModal(true)}>
          + 导入 Skill
        </button>
      </div>

      {showInstallModal && (
        <div className="modal-overlay" onClick={() => setShowInstallModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h2 className="modal-title">导入 Skill</h2>
            <div className="form-group">
              <label className="form-label">选择本地 zip 文件</label>
              <input
                type="file"
                accept=".zip"
                onChange={handleFileSelect}
                disabled={loadingPreview}
              />
              {loadingPreview && <div style={{ marginTop: 8 }}>正在预览...</div>}
            </div>

            {installError && (
              <div style={{ color: '#ff4d4f', marginTop: 12 }}>{installError}</div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={() => setShowInstallModal(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showPreviewModal && preview && (
        <div className="modal-overlay" onClick={() => setShowPreviewModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h2 className="modal-title">确认导入 Skill</h2>
            
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 'bold', fontSize: 18 }}>{preview.name}</div>
              <div style={{ color: '#666', marginTop: 4 }}>{preview.description}</div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {preview.version && <span className="tag">v{preview.version}</span>}
              {preview.runtimeLanguage && <span className="tag">{preview.runtimeLanguage}</span>}
              {preview.installMode && <span className="tag">{preview.installMode}</span>}
            </div>

            {preview.tools.length === 0 && (
              <div style={{ color: '#666', marginBottom: 12, fontSize: 13 }}>
                当前包未解析出任何托管工具（仍可能为 copy_only 类 Skill）。
              </div>
            )}

            {preview.tools.length > 0 && (
              <div>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>提供的工具:</div>
                {preview.tools.map((tool, i) => (
                  <div key={i} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: '#f5f5f5',
                    borderRadius: 6,
                    marginBottom: 8,
                  }}>
                    <div>
                      <code style={{ fontWeight: 500 }}>{tool.name}</code>
                      <span style={{ color: '#666', marginLeft: 8 }}>{tool.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {preview.previewId && (
              <div style={{ color: '#666', marginBottom: 12, fontSize: 12 }}>
                已生成清单并暂存在服务端，确认导入时将直接使用该目录（无需再次上传 zip）。
              </div>
            )}

            {installError && (
              <div style={{ color: '#ff4d4f', marginBottom: 12 }}>{installError}</div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={() => setShowPreviewModal(false)} disabled={installing}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConfirmImport}
                disabled={installing}
              >
                {installing ? '导入中...' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        {skills.map(skill => (
          <div key={skill.id} className="agent-card">
            <div className="agent-card-header">
              <span className="agent-name">{skill.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {skill.version && <span className="tag">v{skill.version}</span>}
                {skill.runtimeLanguage && <span className="tag">{skill.runtimeLanguage}</span>}
                {skill.installMode && <span className="tag">{skill.installMode}</span>}
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
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {skills.length === 0 && (
          <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>
            暂无已安装的 Skill，点击上方按钮导入
          </div>
        )}
      </div>
    </div>
  );
};

export default SkillsView;
