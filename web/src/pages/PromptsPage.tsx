import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api/client';

interface PromptTemplate {
  id: string;
  name: string;
  type: 'leader' | 'domain';
  description?: string;
  currentVersion: number;
}

interface PromptVersion {
  id: string;
  templateId: string;
  version: number;
  system?: string;
  changeLog?: string;
  createdAt: string;
}

interface TemplateForm {
  name: string;
  type: 'leader' | 'domain';
  description: string;
  promptContent: string;
}

const createEmptyTemplateForm = (): TemplateForm => ({
  name: '',
  type: 'domain',
  description: '',
  promptContent: ''
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function PromptsPage() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<PromptVersion | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [search, setSearch] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const [promptEditorMode, setPromptEditorMode] = useState<'edit' | 'preview'>('edit');

  const [templateForm, setTemplateForm] = useState<TemplateForm>(createEmptyTemplateForm());
  const [rollbackReason, setRollbackReason] = useState('');

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  const filteredTemplates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return templates;
    }

    return templates.filter((item) => (
      item.name.toLowerCase().includes(keyword)
      || item.type.toLowerCase().includes(keyword)
    ));
  }, [templates, search]);

  const highlightSearchText = (value: string) => {
    const keyword = search.trim();
    if (!keyword) {
      return value;
    }

    const escapedKeyword = escapeRegExp(keyword);
    const pattern = new RegExp(`(${escapedKeyword})`, 'ig');
    const parts = value.split(pattern);

    if (parts.length === 1) {
      return value;
    }

    return parts.map((part, index) => (
      part.toLowerCase() === keyword.toLowerCase()
        ? <mark key={`${part}-${index}`} className="prompt-search-highlight">{part}</mark>
        : <span key={`${part}-${index}`}>{part}</span>
    ));
  };

  const loadTemplates = async () => {
    try {
      setLoadingTemplates(true);
      const data = await api.getPromptTemplates() as PromptTemplate[];
      setTemplates(data);
      if (data.length > 0) {
        setSelectedTemplateId((current) => (current && data.some((item) => item.id === current) ? current : data[0].id));
      } else {
        setSelectedTemplateId('');
      }
    } catch (error: any) {
      setErrorMessage(error?.message || '加载模板列表失败');
    } finally {
      setLoadingTemplates(false);
    }
  };

  const loadVersions = async (templateId: string) => {
    if (!templateId) {
      setVersions([]);
      setSelectedVersion(null);
      return;
    }

    try {
      setLoadingVersions(true);
      const data = await api.getPromptTemplateVersions(templateId) as PromptVersion[];
      setVersions(data);
      setSelectedVersion(data[0] || null);
    } catch (error: any) {
      setErrorMessage(error?.message || '加载模板版本失败');
    } finally {
      setLoadingVersions(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  useEffect(() => {
    void loadVersions(selectedTemplateId);
  }, [selectedTemplateId]);

  const setBanner = (success?: string, error?: string) => {
    setStatusMessage(success || '');
    setErrorMessage(error || '');
  };

  const formatDateTime = (value?: string) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString();
  };

  const openCreate = () => {
    setTemplateForm(createEmptyTemplateForm());
    setPromptEditorMode('edit');
    setBanner();
    setShowCreateModal(true);
  };

  const openEdit = async (template: PromptTemplate) => {
    try {
      const targetVersions = template.id === selectedTemplateId
        ? versions
        : (await api.getPromptTemplateVersions(template.id) as PromptVersion[]);

      if (template.id !== selectedTemplateId) {
        setSelectedTemplateId(template.id);
        setVersions(targetVersions);
        setSelectedVersion(targetVersions[0] || null);
      }

      setTemplateForm({
        name: template.name,
        type: template.type,
        description: template.description || '',
        promptContent: targetVersions[0]?.system || ''
      });
      setPromptEditorMode('edit');
      setBanner();
      setShowEditModal(true);
    } catch (error: any) {
      setBanner(undefined, error?.message || '加载模板内容失败');
    }
  };

  const handleImportMarkdown = async (event: ChangeEvent<HTMLInputElement>) => {
    const targetFile = event.target.files?.[0];
    if (!targetFile) {
      return;
    }

    try {
      const content = await targetFile.text();
      setTemplateForm((current) => ({ ...current, promptContent: content }));
      setPromptEditorMode('edit');
      setBanner('已导入 Markdown 文件内容');
    } catch (error: any) {
      setBanner(undefined, error?.message || '导入 Markdown 文件失败');
    } finally {
      event.target.value = '';
    }
  };

  const openDelete = async (template: PromptTemplate) => {
    const confirmed = window.confirm('确认删除该模板吗？模板删除后，不可恢复。');
    if (!confirmed) {
      return;
    }

    try {
      setSubmitting(true);
      await api.deletePromptTemplate(template.id);
      await loadTemplates();
      if (selectedTemplateId === template.id) {
        setVersions([]);
        setSelectedVersion(null);
      }
      setBanner('模板已删除');
    } catch (error: any) {
      setBanner(undefined, error?.message || '删除模板失败');
    } finally {
      setSubmitting(false);
    }
  };

  const openRollback = (version: PromptVersion) => {
    setSelectedVersion(version);
    setRollbackReason('');
    setBanner();
    setShowRollbackModal(true);
  };

  const handleCreateTemplate = async () => {
    if (!templateForm.name.trim()) {
      setBanner(undefined, '模板名称不能为空');
      return;
    }

    try {
      setSubmitting(true);
      const created = await api.createPromptTemplate({
        name: templateForm.name.trim(),
        type: templateForm.type,
        description: templateForm.description.trim() || undefined,
        system: templateForm.promptContent.trim() || undefined,
        changeLog: '创建模板初始版本'
      }) as PromptTemplate;

      await loadTemplates();
      setSelectedTemplateId(created.id);
      await loadVersions(created.id);
      setShowCreateModal(false);
      setBanner('模板已创建');
    } catch (error: any) {
      setBanner(undefined, error?.message || '创建模板失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditTemplate = async () => {
    if (!selectedTemplateId) {
      setBanner(undefined, '请先选择模板');
      return;
    }
    if (!templateForm.name.trim()) {
      setBanner(undefined, '模板名称不能为空');
      return;
    }

    try {
      setSubmitting(true);
      await api.updatePromptTemplate(selectedTemplateId, {
        name: templateForm.name.trim(),
        type: templateForm.type,
        description: templateForm.description.trim() || undefined,
        promptContent: templateForm.promptContent,
        changeLog: '编辑模板自动更新'
      });

      await loadTemplates();
      await loadVersions(selectedTemplateId);
      setShowEditModal(false);
      setBanner('模板已保存，版本已自动更新（如内容有变化）');
    } catch (error: any) {
      setBanner(undefined, error?.message || '修改模板失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRollback = async () => {
    if (!selectedTemplateId || !selectedVersion) {
      setBanner(undefined, '请选择要恢复的版本');
      return;
    }

    try {
      setSubmitting(true);
      await api.rollbackPromptTemplateVersion(
        selectedTemplateId,
        selectedVersion.version,
        rollbackReason.trim() || undefined
      );

      await loadTemplates();
      await loadVersions(selectedTemplateId);
      setShowRollbackModal(false);
      setBanner(`已恢复到 v${selectedVersion.version}，并创建新版本`);
    } catch (error: any) {
      setBanner(undefined, error?.message || '恢复版本失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="content prompt-manager-page">
      <div className="card prompt-manager-shell">
        <div className="card-header">
          <h2 className="card-title">Prompt 模板管理</h2>
          <button className="btn btn-primary" onClick={openCreate}>创建模板</button>
        </div>

        {(statusMessage || errorMessage) && (
          <div className={`prompt-manager-banner ${errorMessage ? 'error' : 'success'}`}>
            {errorMessage || statusMessage}
          </div>
        )}

        <div className="prompt-manager-toolbar">
          <input
            type="text"
            className="search-input"
            placeholder="搜索模板名 / 类型"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="prompt-manager-layout">
          <section className="prompt-manager-list card">
            <div className="card-title" style={{ marginBottom: 12 }}>模板列表</div>
            {loadingTemplates ? (
              <div className="prompt-muted">加载中...</div>
            ) : filteredTemplates.length === 0 ? (
              <div className="prompt-muted">{search.trim() ? '未匹配到模板' : '暂无模板'}</div>
            ) : (
              <table className="prompt-version-table">
                <thead>
                  <tr>
                    <th>模板名</th>
                    <th>类型</th>
                    <th>当前版本</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTemplates.map((item) => (
                    <tr
                      key={item.id}
                      className={item.id === selectedTemplateId ? 'prompt-template-row-active' : ''}
                      onClick={() => setSelectedTemplateId(item.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{highlightSearchText(item.name)}</td>
                      <td>{highlightSearchText(item.type)}</td>
                      <td>v{item.currentVersion}</td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', marginRight: 6 }}
                          onClick={(event) => {
                            event.stopPropagation();
                            void openEdit(item);
                          }}
                        >
                          修改模板
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ padding: '4px 8px' }}
                          onClick={(event) => {
                            event.stopPropagation();
                            void openDelete(item);
                          }}
                          disabled={submitting}
                        >
                          删除模板
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="prompt-manager-detail card">
            <div className="card-title" style={{ marginBottom: 12 }}>
              {selectedTemplate ? `版本历史 - ${selectedTemplate.name}` : '版本历史'}
            </div>

            {loadingVersions ? (
              <div className="prompt-muted">正在加载版本...</div>
            ) : versions.length === 0 ? (
              <div className="prompt-muted">当前模板暂无版本</div>
            ) : (
              <>
                <table className="prompt-version-table">
                  <thead>
                    <tr>
                      <th>版本</th>
                      <th>变更原因</th>
                      <th>创建时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((item) => (
                      <tr key={item.id}>
                        <td>v{item.version}</td>
                        <td>{item.changeLog || '无记录'}</td>
                        <td>{formatDateTime(item.createdAt)}</td>
                        <td>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', marginRight: 6 }}
                            onClick={() => setSelectedVersion(item)}
                          >
                            查看
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => openRollback(item)}>
                            恢复
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {selectedVersion && (
                  <div className="prompt-manager-preview-panel">
                    <div className="prompt-manager-preview-title">模板内容预览 v{selectedVersion.version}</div>
                    <div className="prompt-manager-preview-row">
                      <span className="prompt-manager-preview-label">Prompt 内容</span>
                      <p>{selectedVersion.system || '-'}</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {(showCreateModal || showEditModal) && (
        <div className="modal-overlay" onClick={() => {
          setShowCreateModal(false);
          setShowEditModal(false);
        }}>
          <div className="modal prompt-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">{showCreateModal ? '创建模板' : '修改模板'}</div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">模板名称</label>
                <input className="form-input" value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">模板类型</label>
                <select className="form-input" value={templateForm.type} onChange={(event) => setTemplateForm((current) => ({ ...current, type: event.target.value as 'leader' | 'domain' }))}>
                  <option value="leader">leader</option>
                  <option value="domain">domain</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">模板描述</label>
                <input className="form-input" value={templateForm.description} onChange={(event) => setTemplateForm((current) => ({ ...current, description: event.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Prompt 内容</label>
                <div className="prompt-editor-toolbar">
                  <div className="prompt-editor-modes">
                    <button
                      type="button"
                      className={`btn btn-secondary ${promptEditorMode === 'edit' ? 'prompt-editor-mode-active' : ''}`}
                      onClick={() => setPromptEditorMode('edit')}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className={`btn btn-secondary ${promptEditorMode === 'preview' ? 'prompt-editor-mode-active' : ''}`}
                      onClick={() => setPromptEditorMode('preview')}
                    >
                      预览
                    </button>
                  </div>
                  <label className="btn btn-secondary prompt-editor-import-btn">
                    导入 .md
                    <input type="file" accept=".md,text/markdown" onChange={(event) => { void handleImportMarkdown(event); }} />
                  </label>
                </div>

                {promptEditorMode === 'edit' ? (
                  <textarea
                    className="form-input"
                    rows={12}
                    value={templateForm.promptContent}
                    onChange={(event) => setTemplateForm((current) => ({ ...current, promptContent: event.target.value }))}
                    placeholder="请输入模板完整 Prompt 文本内容（支持 Markdown）"
                  />
                ) : (
                  <div className="prompt-editor-preview markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {templateForm.promptContent.trim() || '暂无内容'}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => {
                setShowCreateModal(false);
                setShowEditModal(false);
              }} disabled={submitting}>取消</button>
              {showCreateModal && <button className="btn btn-primary" onClick={handleCreateTemplate} disabled={submitting}>{submitting ? '保存中...' : '创建模板'}</button>}
              {showEditModal && <button className="btn btn-primary" onClick={handleEditTemplate} disabled={submitting}>{submitting ? '保存中...' : '保存修改'}</button>}
            </div>
          </div>
        </div>
      )}

      {showRollbackModal && (
        <div className="modal-overlay" onClick={() => setShowRollbackModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">恢复模板版本</div>
            <div className="modal-body">
              <p style={{ marginTop: 0 }}>将基于当前选中版本 v{selectedVersion?.version} 创建一个新的恢复版本。</p>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">恢复原因（可选）</label>
                <input className="form-input" value={rollbackReason} onChange={(event) => setRollbackReason(event.target.value)} placeholder="例如：线上回归，恢复稳定版本" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowRollbackModal(false)} disabled={submitting}>取消</button>
              <button className="btn btn-primary" onClick={handleRollback} disabled={submitting}>{submitting ? '恢复中...' : '确认恢复'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
