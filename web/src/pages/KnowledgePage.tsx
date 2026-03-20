import { useState, useEffect } from 'react';
import { api } from '../api/client';

interface KnowledgeDocument {
  id: string;
  title: string;
  overview?: string;
  content: string;
  sourceType: string;
  agentId?: string;
  agentName?: string;
  createdAt: string;
  updatedAt: string;
}

interface Agent {
  id: string;
  name: string;
}

interface ImportHistory {
  id: string;
  filename: string;
  status: 'success' | 'failed' | 'processing';
  message?: string;
  importedAt: string;
}

interface UploadResultItem {
  fileName: string;
  status: 'success' | 'failed';
  error?: string;
  title?: string;
  overview?: string;
  docId?: string;
}

interface UploadResultSummary {
  total: number;
  successCount: number;
  failedCount: number;
  items: UploadResultItem[];
}

export function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  const [importHistory, setImportHistory] = useState<ImportHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadResult, setUploadResult] = useState<UploadResultSummary | null>(null);
  const [showUploadResultModal, setShowUploadResultModal] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const isAllAgentsSelected = selectedAgentId === 'all';

  useEffect(() => {
    loadAgents();
    loadDocuments();
  }, []);

  useEffect(() => {
    loadDocuments();
    if (selectedAgentId === 'all') {
      setImportHistory([]);
      return;
    }

    loadImportHistory();
  }, [selectedAgentId]);

  useEffect(() => {
    if (isAllAgentsSelected) {
      setSelectedFiles([]);
    }
  }, [isAllAgentsSelected]);

  const loadAgents = async () => {
    try {
      const data = await api.getAgents();
      setAgents(data as Agent[]);
    } catch (error) {
      console.error('Failed to load agents:', error);
    }
  };

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const data = await api.getKnowledge();
      setDocuments(data as KnowledgeDocument[]);
    } catch (error) {
      console.error('Failed to load documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadImportHistory = async () => {
    try {
      const data = await api.getImportHistory(selectedAgentId === 'all' ? undefined : selectedAgentId);
      setImportHistory(data as ImportHistory[]);
    } catch (error) {
      console.error('Failed to load import history:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadDocuments();
      return;
    }
    try {
      const results = await api.searchKnowledge(searchQuery);
      setDocuments(results as KnowledgeDocument[]);
    } catch (error) {
      console.error('Search failed:', error);
    }
  };

  const handleUpload = async () => {
    if (isAllAgentsSelected) {
      return;
    }

    if (selectedFiles.length === 0) {
      return;
    }

    try {
      setUploading(true);
      const response = await api.uploadKnowledgeFiles(
        selectedFiles,
        selectedAgentId === 'all' ? undefined : selectedAgentId
      ) as any;

      const normalized = normalizeUploadResult(response, selectedFiles);
      setUploadResult(normalized);
      setShowUploadResultModal(true);

      setSelectedFiles([]);
      await loadDocuments();
      await loadImportHistory();
    } catch (error) {
      console.error('Failed to upload knowledge file:', error);
      const fallbackItems = selectedFiles.map((file) => ({
        fileName: file.name,
        status: 'failed' as const,
        error: error instanceof Error ? error.message : '上传失败'
      }));

      setUploadResult({
        total: fallbackItems.length,
        successCount: 0,
        failedCount: fallbackItems.length,
        items: fallbackItems
      });
      setShowUploadResultModal(true);
    } finally {
      setUploading(false);
    }
  };

  const normalizeUploadResult = (response: any, files: File[]): UploadResultSummary => {
    if (response && Array.isArray(response.items)) {
      const items = response.items.map((item: any, index: number) => ({
        fileName: typeof item.fileName === 'string' && item.fileName
          ? item.fileName
          : files[index]?.name || `文件${index + 1}`,
        status: item.status === 'success' ? 'success' : 'failed',
        error: typeof item.error === 'string' ? item.error : undefined,
        title: typeof item.title === 'string' ? item.title : undefined,
        overview: typeof item.overview === 'string' ? item.overview : undefined,
        docId: typeof item.docId === 'string' ? item.docId : undefined
      } as UploadResultItem));

      const successCount = typeof response.successCount === 'number'
        ? response.successCount
        : items.filter((item: UploadResultItem) => item.status === 'success').length;
      const total = typeof response.total === 'number' ? response.total : items.length;
      const failedCount = typeof response.failedCount === 'number' ? response.failedCount : Math.max(0, total - successCount);

      return { total, successCount, failedCount, items };
    }

    const singleFileName = files[0]?.name || response?.fileName || '文件';
    const successItem: UploadResultItem = {
      fileName: singleFileName,
      status: 'success',
      title: typeof response?.title === 'string' ? response.title : undefined,
      overview: typeof response?.overview === 'string' ? response.overview : undefined,
      docId: typeof response?.docId === 'string' ? response.docId : undefined
    };

    return {
      total: 1,
      successCount: 1,
      failedCount: 0,
      items: [successItem]
    };
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条知识吗?')) return;
    try {
      await api.deleteKnowledgeDocument(id);
      loadDocuments();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return '✓';
      case 'failed': return '⚠️';
      case 'processing': return '🔄';
      default: return '○';
    }
  };

  const agentNameById = new Map(agents.map((agent) => [agent.id, agent.name]));

  const filteredDocs = documents.filter((doc) => {
    if (selectedAgentId !== 'all' && doc.agentId !== selectedAgentId) {
      return false;
    }

    if (searchQuery &&
      !doc.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !doc.content?.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    return true;
  });

  const getDocumentAgentName = (doc: KnowledgeDocument) => {
    if (doc.agentName) {
      return doc.agentName;
    }
    if (doc.agentId) {
      return agentNameById.get(doc.agentId) || doc.agentId;
    }
    return '未指定';
  };

  const showAgentSource = selectedAgentId === 'all';

  const startEditTitle = (doc: KnowledgeDocument) => {
    setEditingDocId(doc.id);
    setEditingTitle(doc.title);
  };

  const cancelEditTitle = () => {
    setEditingDocId(null);
    setEditingTitle('');
  };

  const saveTitle = async (docId: string) => {
    const title = editingTitle.trim();
    if (!title) {
      return;
    }

    try {
      await api.updateKnowledgeDocumentTitle(docId, title);
      setEditingDocId(null);
      setEditingTitle('');
      await loadDocuments();
    } catch (error) {
      console.error('Failed to update title:', error);
    }
  };

  return (
    <div className="knowledge-page">
      <div className="page-header">
        <h2>知识库</h2>
        <div className="header-actions">
          <select
            className="form-input"
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="all">全部 Agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        </div>
      </div>

      {isAllAgentsSelected ? (
        <div className="knowledge-form knowledge-upload-panel">
          <div className="empty-hint">请选择具体 Agent 后再上传文件入库。</div>
        </div>
      ) : (
        <div className="knowledge-form knowledge-upload-panel">
          <div className="form-row">
            <div className="form-group knowledge-upload-row">
              <label className="form-label">上传文件入库</label>
              <input
                type="file"
                className="form-input"
                onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
                multiple
                accept=".txt,.md,.json,.csv,.xml,.yaml,.yml,.html,.pdf,.doc,.docx"
              />
              <button
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={selectedFiles.length === 0 || uploading}
              >
                {uploading ? '上传中...' : `上传并入库${selectedFiles.length > 1 ? ` (${selectedFiles.length}个)` : ''}`}
              </button>
            </div>
          </div>
          {selectedFiles.length > 0 && (
            <div className="knowledge-file-name">
              已选文件: {selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles.length} 个文件`}
            </div>
          )}
        </div>
      )}

      <div className="knowledge-toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="🔍 搜索知识资料..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button className="btn btn-secondary" onClick={handleSearch}>
          搜索
        </button>
      </div>

      <div className={`knowledge-layout ${isAllAgentsSelected ? 'full-width' : ''}`}>
        <div className="knowledge-main">
          <div className="document-section">
            <div className="section-header">
              <h3>📄 文档列表</h3>
              <span className="doc-count">{filteredDocs.length} 个文档</span>
            </div>

            {loading ? (
              <div className="loading"><div className="spinner"></div></div>
            ) : filteredDocs.length === 0 ? (
              <div className="empty-state">
                <h3>暂无知识资料</h3>
                <p>点击"添加"按钮创建知识文档</p>
              </div>
            ) : (
              <div className="document-list">
                {filteredDocs.map((doc) => (
                  <div key={doc.id} className="document-item">
                    <div className="document-header">
                      <div className="document-info">
                        <span className="document-icon">📄</span>
                        {editingDocId === doc.id ? (
                          <input
                            className="form-input document-title-input"
                            value={editingTitle}
                            onChange={(event) => setEditingTitle(event.target.value)}
                          />
                        ) : (
                          <span className="document-title">{doc.title}</span>
                        )}
                      </div>
                      <div className="document-actions">
                        {editingDocId === doc.id ? (
                          <>
                            <button className="btn-link" onClick={() => saveTitle(doc.id)}>保存标题</button>
                            <button className="btn-link" onClick={cancelEditTitle}>取消</button>
                          </>
                        ) : (
                          <button className="btn-link" onClick={() => startEditTitle(doc)}>编辑标题</button>
                        )}
                        <button
                          className="btn-danger-small"
                          onClick={() => handleDelete(doc.id)}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    <div className="document-meta">
                      <span>来源: {doc.sourceType}</span>
                      {showAgentSource && <span className="meta-agent">{getDocumentAgentName(doc)}</span>}
                      <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="document-overview">
                      总览: {doc.overview || '暂无总览'}
                    </div>
                    <div className="document-preview">
                      {doc.content?.substring(0, 150)}...
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {!isAllAgentsSelected && (
          <div className="knowledge-sidebar">
            <h3>📥 导入历史</h3>
            <div className="import-history">
              {importHistory.length === 0 ? (
                <div className="empty-hint">暂无导入记录</div>
              ) : (
                importHistory.map((item) => (
                  <div key={item.id} className={`import-item ${item.status}`}>
                    <div className="import-status">{getStatusIcon(item.status)}</div>
                    <div className="import-content">
                      <div className="import-filename">{item.filename}</div>
                      <div className="import-message">
                        {item.status === 'success' ? '成功' :
                         item.status === 'failed' ? (item.message || '导入失败') : '处理中'}
                      </div>
                      <div className="import-time">
                        {new Date(item.importedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {showUploadResultModal && uploadResult && (
        <div className="modal-overlay" onClick={() => setShowUploadResultModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">本次导入结果</div>
            <div className="modal-body">
              <div className="upload-result-summary">
                <span>总计: {uploadResult.total}</span>
                <span className="success">成功: {uploadResult.successCount}</span>
                <span className="failed">失败: {uploadResult.failedCount}</span>
              </div>
              <div className="upload-result-list">
                {uploadResult.items.map((item, index) => (
                  <div key={`${item.fileName}-${index}`} className={`upload-result-item ${item.status}`}>
                    <div className="upload-result-title">
                      <span>{item.status === 'success' ? '✓' : '⚠️'}</span>
                      <span>{item.fileName}</span>
                    </div>
                    {item.status === 'success' ? (
                      <div className="upload-result-detail">导入成功{item.title ? `，标题: ${item.title}` : ''}</div>
                    ) : (
                      <div className="upload-result-detail error">失败原因: {item.error || '未知错误'}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setShowUploadResultModal(false)}>知道了</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default KnowledgePage;
