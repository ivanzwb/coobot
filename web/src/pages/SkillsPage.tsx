import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../api/client';

interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  runtimeLanguage?: RuntimeLanguage | null;
  version?: string | null;
  tools?: string | null;
  permissions?: string | null;
  status: string;
  createdAt: string;
}

type RuntimeLanguage = 'javascript' | 'python' | 'ruby' | 'bash' | 'powershell';
type LifecycleStatus = 'not_installed' | 'installing' | 'installed' | 'validation_failed' | 'uninstalling';

type PermissionDecision = 'allow' | 'ask' | 'deny';

interface ToolPermissionDeclaration {
  name: string;
  description: string;
  permissions: {
    read: PermissionDecision;
    write: PermissionDecision;
    execute: PermissionDecision;
  };
}

interface SkillStatusPayload {
  skillId: string;
  hasInstallScript: boolean;
  hasUninstallScript: boolean;
  installScriptLanguage?: RuntimeLanguage;
  uninstallScriptLanguage?: RuntimeLanguage;
  isInstalled: boolean;
  lifecycleStatus: LifecycleStatus;
  validation: {
    valid: boolean;
    code: string;
    message: string;
    declaredLanguage?: RuntimeLanguage;
    detectedLanguages: RuntimeLanguage[];
    dimensions: {
      scripts: boolean;
      dependencies: boolean;
      executor: boolean;
    };
  };
}

interface SkillLifecycleActionResult {
  success?: boolean;
  error?: string;
  errorCode?: string;
  message?: string;
}

interface SkillPackagePreviewMetadata {
  name: string;
  description: string;
  version: string;
  author: string;
}

function mapSkillErrorMessage(apiError: ApiError): string {
  if (apiError.code === 'SKILL_PACKAGE_REQUIRED') {
    return '请选择有效的 Skill 安装包';
  }
  if (apiError.code === 'SKILL_IMPORT_FAILED') {
    return apiError.message || 'Skill 安装包导入失败';
  }
  if (apiError.code === 'SKILL_RUNTIME_LANGUAGE_REQUIRED') {
    return '请先声明 Skill 运行时语言';
  }
  if (apiError.code === 'SKILL_RUNTIME_LANGUAGE_INVALID') {
    return 'runtimeLanguage 取值无效';
  }
  if (apiError.code === 'SKILL_MULTIPLE_LANGUAGES_NOT_ALLOWED') {
    return '同一 Skill 包不能同时包含多种语言的生命周期脚本或依赖文件';
  }
  if (apiError.code === 'SKILL_RUNTIME_LANGUAGE_MISMATCH') {
    return '声明语言与实际脚本 / 依赖文件 / 执行器目录不一致，请修正 SKILL.md 或包内容';
  }
  return apiError.message || '操作失败';
}

export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, SkillStatusPayload>>({});
  const [transientStatus, setTransientStatus] = useState<Record<string, LifecycleStatus>>({});
  const [skillActionErrors, setSkillActionErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'installing'>('all');
  const [errorMessage, setErrorMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [uploadingPackage, setUploadingPackage] = useState(false);
  const [selectedPackageFile, setSelectedPackageFile] = useState<File | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMetadata, setPreviewMetadata] = useState<SkillPackagePreviewMetadata | null>(null);
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      setLoading(true);
      setErrorMessage('');
      const data = await api.getSkills();
      const skillRows = data as Skill[];
      setSkills(skillRows);

      const statusEntries = await Promise.all(
        skillRows.map(async (skill) => {
          try {
            const status = await api.getSkillStatus(skill.id) as SkillStatusPayload;
            return [skill.id, status] as const;
          } catch {
            return [
              skill.id,
              {
                skillId: skill.id,
                hasInstallScript: false,
                hasUninstallScript: false,
                isInstalled: false,
                lifecycleStatus: 'validation_failed' as LifecycleStatus,
                validation: {
                  valid: false,
                  code: 'SKILL_STATUS_LOAD_FAILED',
                  message: '状态读取失败，请稍后重试',
                  detectedLanguages: [],
                  dimensions: {
                    scripts: false,
                    dependencies: false,
                    executor: false
                  }
                }
              } as SkillStatusPayload
            ] as const;
          }
        })
      );

      setStatusMap(Object.fromEntries(statusEntries));
    } catch (error) {
      console.error('Failed to load skills:', error);
      setErrorMessage('Skills 列表加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleImportPackage = async () => {
    if (!selectedPackageFile) {
      setErrorMessage('请先从文件系统选择 Skill zip 安装包');
      return;
    }

    if (!selectedPackageFile.name.toLowerCase().endsWith('.zip')) {
      setErrorMessage('仅支持 zip 格式安装包');
      return;
    }

    if (!previewMetadata) {
      setErrorMessage('请先完成安装包元数据预读取后再导入');
      return;
    }

    try {
      setErrorMessage('');
      setUploadingPackage(true);
      const importResult = await api.importSkillPackage(selectedPackageFile) as { skillId?: string };

      if (importResult.skillId) {
        await api.installSkill(importResult.skillId);
        await refreshSkillStatus(importResult.skillId);
      }

      setShowForm(false);
      setSelectedPackageFile(null);
      setPreviewMetadata(null);
      setPreviewError('');
      await loadSkills();
    } catch (error) {
      console.error('Failed to import skill package:', error);
      const apiError = error as ApiError;
      setErrorMessage(mapSkillErrorMessage(apiError));
    } finally {
      setUploadingPackage(false);
    }
  };

  const refreshSkillStatus = async (skillId: string) => {
    try {
      const status = await api.getSkillStatus(skillId) as SkillStatusPayload;
      setStatusMap((current) => ({ ...current, [skillId]: status }));
    } catch {
      setStatusMap((current) => ({
        ...current,
        [skillId]: {
          ...(current[skillId] || {
            skillId,
            hasInstallScript: false,
            hasUninstallScript: false,
            isInstalled: false,
            lifecycleStatus: 'validation_failed'
          }),
          validation: {
            valid: false,
            code: 'SKILL_STATUS_LOAD_FAILED',
            message: '状态读取失败，请稍后重试',
            detectedLanguages: [],
            dimensions: {
              scripts: false,
              dependencies: false,
              executor: false
            }
          }
        } as SkillStatusPayload
      }));
    }
  };

  const handleSelectPackage = async (file: File | null) => {
    setSelectedPackageFile(file);
    setPreviewMetadata(null);
    setPreviewError('');
    setErrorMessage('');

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith('.zip')) {
      setPreviewError('仅支持 zip 格式安装包');
      return;
    }

    try {
      setPreviewLoading(true);
      const preview = await api.previewSkillPackage(file) as {
        metadata?: SkillPackagePreviewMetadata;
      };
      setPreviewMetadata(preview.metadata || null);
    } catch (error) {
      const apiError = error as ApiError;
      const message = mapSkillErrorMessage(apiError);
      setPreviewError(message);
      setErrorMessage(message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleUninstall = async (skillId: string) => {
    try {
      setSkillActionErrors((current) => {
        const { [skillId]: _, ...rest } = current;
        return rest;
      });
      setTransientStatus((current) => ({ ...current, [skillId]: 'uninstalling' }));
      const result = await api.uninstallSkill(skillId) as SkillLifecycleActionResult;
      if (result && result.success === false) {
        throw new ApiError(result.error || 'Skill 卸载失败', result.errorCode);
      }
      setSkills((current) => current.filter((skill) => skill.id !== skillId));
      setStatusMap((current) => {
        const { [skillId]: _, ...rest } = current;
        return rest;
      });
      setSkillActionErrors((current) => {
        const { [skillId]: _, ...rest } = current;
        return rest;
      });
    } catch (error) {
      const apiError = error as ApiError;
      setSkillActionErrors((current) => ({
        ...current,
        [skillId]: mapSkillErrorMessage(apiError)
      }));
      await refreshSkillStatus(skillId);
    } finally {
      setTransientStatus((current) => {
        const { [skillId]: _, ...rest } = current;
        return rest;
      });
    }
  };

  const handleActivate = async (skillId: string) => {
    try {
      setErrorMessage('');
      await api.activateSkill(skillId);
      setSkills((current) => current.map((skill) => (
        skill.id === skillId
          ? { ...skill, status: 'active' }
          : skill
      )));
      await refreshSkillStatus(skillId);
    } catch (error) {
      console.error('Failed to activate:', error);
      const apiError = error as ApiError;
      setErrorMessage(mapSkillErrorMessage(apiError));
    }
  };

  const handleDeactivate = async (skillId: string) => {
    try {
      setErrorMessage('');
      await api.updateSkill(skillId, { status: 'inactive' });
      setSkills((current) => current.map((skill) => (
        skill.id === skillId
          ? { ...skill, status: 'inactive' }
          : skill
      )));
      await refreshSkillStatus(skillId);
    } catch (error) {
      const apiError = error as ApiError;
      setErrorMessage(mapSkillErrorMessage(apiError));
    }
  };

  const getLifecycleStatus = (skillId: string): LifecycleStatus => {
    return transientStatus[skillId] || statusMap[skillId]?.lifecycleStatus || 'not_installed';
  };

  const isActivationBlocked = (skillId: string) => {
    const lifecycleStatus = getLifecycleStatus(skillId);
    return lifecycleStatus === 'validation_failed' || lifecycleStatus === 'installing' || lifecycleStatus === 'uninstalling';
  };

  const getStatusBadge = (status: LifecycleStatus) => {
    const textMap: Record<LifecycleStatus, string> = {
      not_installed: '未安装',
      installing: '安装中',
      installed: '已安装',
      validation_failed: '校验失败',
      uninstalling: '卸载中'
    };
    const classMap: Record<LifecycleStatus, string> = {
      not_installed: 'badge-info',
      installing: 'badge-warning',
      installed: 'badge-success',
      validation_failed: 'badge-error',
      uninstalling: 'badge-warning'
    };

    return <span className={`badge ${classMap[status]}`}>{textMap[status]}</span>;
  };

  const filteredSkills = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();

    return skills.filter((skill) => {
      const lifecycleStatus = getLifecycleStatus(skill.id);
      const matchesKeyword = !keyword || [
        skill.name,
        skill.description || '',
        skill.runtimeLanguage || '',
        skill.version || ''
      ].join(' ').toLowerCase().includes(keyword);

      const matchesFilter =
        statusFilter === 'all'
          ? true
          : statusFilter === 'enabled'
            ? skill.status === 'active'
            : lifecycleStatus === 'installing';

      return matchesKeyword && matchesFilter;
    });
  }, [skills, searchKeyword, statusFilter, statusMap, transientStatus]);

  return (
    <div className="content">
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Skills 管理</h2>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? '取消' : '+ 安装 Skill'}
          </button>
        </div>

        {errorMessage && (
          <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: '#fef2f2', color: '#991b1b', fontSize: 13 }}>
            {errorMessage}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            className="form-input"
            style={{ maxWidth: 360 }}
            placeholder="搜索名称 / 描述 / 运行时 / 版本"
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
          />
          <button className={`btn ${statusFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusFilter('all')}>全部</button>
          <button className={`btn ${statusFilter === 'enabled' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusFilter('enabled')}>启用</button>
          <button className={`btn ${statusFilter === 'installing' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusFilter('installing')}>安装中</button>
        </div>

        {showForm && (
          <div style={{ marginBottom: 24, padding: 16, background: '#f9fafb', borderRadius: 8 }}>
            <div className="form-group">
              <label className="form-label">选择 Skill 安装包（zip）</label>
              <input
                type="file"
                className="form-input"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={(event) => {
                  void handleSelectPackage(event.target.files?.[0] || null);
                }}
              />
              <p style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                从文件系统中选择 Skill zip 安装包，系统将自动导入并执行安装；重复导入同一 Skill 视为更新。
              </p>
              {previewLoading && (
                <p style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                  正在读取 SKILL.md 元数据...
                </p>
              )}
              {previewMetadata && (
                <div style={{ marginTop: 8, padding: 10, borderRadius: 6, background: '#f8fafc', border: '1px solid #e5e7eb', fontSize: 12 }}>
                  <div><strong>名称:</strong> {previewMetadata.name || '-'}</div>
                  <div><strong>描述:</strong> {previewMetadata.description || '-'}</div>
                  <div><strong>版本:</strong> {previewMetadata.version || '-'}</div>
                  <div><strong>Author:</strong> {previewMetadata.author || '-'}</div>
                </div>
              )}
              {previewError && (
                <p style={{ marginTop: 6, fontSize: 12, color: '#991b1b' }}>
                  {previewError}
                </p>
              )}
            </div>
            <button
              className="btn btn-primary"
              onClick={handleImportPackage}
              disabled={uploadingPackage || previewLoading || !selectedPackageFile || !previewMetadata}
            >
              {uploadingPackage ? '导入安装中...' : '导入并安装'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : filteredSkills.length === 0 ? (
          <div className="empty-state">
            <h3>暂无 Skills</h3>
            <p>创建您的第一个 Skill</p>
          </div>
        ) : (
          <div className="task-list">
            {filteredSkills.map((skill) => {
              const lifecycleStatus = getLifecycleStatus(skill.id);
              const statusPayload = statusMap[skill.id];
              const detectedLanguageLabel = statusPayload?.validation?.detectedLanguages?.length
                ? statusPayload.validation.detectedLanguages.join(', ')
                : '';
              const blockedReason = lifecycleStatus === 'validation_failed'
                ? (statusPayload?.validation.message || '运行时校验失败')
                : lifecycleStatus === 'installing'
                  ? 'Skill 正在安装中'
                  : lifecycleStatus === 'uninstalling'
                    ? 'Skill 正在卸载中'
                    : '';

              return (
              <div key={skill.id} className="task-item">
                <div className="task-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{skill.name}</span>
                    <span className={`badge ${skill.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
                      {skill.status === 'active' ? '启用' : '停用'}
                    </span>
                    {getStatusBadge(lifecycleStatus)}
                    {skill.runtimeLanguage && <span className="badge badge-info">{skill.runtimeLanguage}</span>}
                    {skill.version && <span className="badge badge-info">{skill.version}</span>}
                    {detectedLanguageLabel && <span className="badge badge-info">检测到语言: {detectedLanguageLabel}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {skill.status === 'active' ? (
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: 12 }}
                        onClick={() => handleDeactivate(skill.id)}
                        disabled={lifecycleStatus === 'installing' || lifecycleStatus === 'uninstalling'}
                      >
                        停用
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 8px', fontSize: 12 }}
                        onClick={() => handleActivate(skill.id)}
                        disabled={isActivationBlocked(skill.id)}
                        title={blockedReason}
                      >
                        启用
                      </button>
                    )}
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                      onClick={() => handleUninstall(skill.id)}
                      disabled={lifecycleStatus === 'installing' || lifecycleStatus === 'uninstalling'}
                    >
                      卸载
                    </button>
                  </div>
                </div>
                <div className="task-summary">{skill.description}</div>

                {skillActionErrors[skill.id] && (
                  <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: '#fef2f2', color: '#991b1b', fontSize: 12 }}>
                    卸载失败: {skillActionErrors[skill.id]}
                  </div>
                )}

                {skill.tools && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#4b5563' }}>
                    需要权限声明: {(() => {
                      try {
                        const tools = JSON.parse(skill.tools) as ToolPermissionDeclaration[];
                        if (!Array.isArray(tools) || tools.length === 0) {
                          return '无';
                        }
                        return tools.map((item) => `${item.name}(r:${item.permissions.read}, w:${item.permissions.write}, x:${item.permissions.execute})`).join(' ; ');
                      } catch {
                        return '无';
                      }
                    })()}
                  </div>
                )}
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
            );})}
          </div>
        )}
      </div>
    </div>
  );
}
