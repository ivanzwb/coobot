import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { format } from 'date-fns';

interface TaskReport {
  task: {
    id: string;
    status: string;
    complexityDecisionSummary?: string;
    arrangementStatus?: string;
    degradationSummary?: string;
    supplementUpdates?: Array<{
      id: string;
      content: string;
      arrivedAt: string;
      stepSummary?: string;
    }>;
    outputStage?: string;
    finalOutputReady?: boolean;
    createdAt: string;
    completedAt?: string;
    intakeInputSummary?: string;
  };
  steps: any[];
  outputs: any[];
  events: any[];
  summary: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    finalOutputReady: boolean;
  };
  memoryScope?: {
    persistentMemories: Array<{ title: string; date: string }>;
    knowledgeSources: Array<{ title: string }>;
  };
  permissionDecisions?: Array<{
    action: string;
    target: string;
    decision: string;
    policySource?: string;
  }>;
}

export function ResultPage({ taskId: propTaskId }: { taskId?: string }) {
  const params = useParams<{ taskId: string }>();
  const taskId = propTaskId || params.taskId || '';
  const [report, setReport] = useState<TaskReport | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (taskId) {
      loadReport();
    }
  }, [taskId]);

  const loadReport = async () => {
    if (!taskId) return;
    try {
      setLoading(true);
      const data = await api.getTaskReport(taskId);
      setReport(data as TaskReport);
    } catch (error) {
      console.error('Failed to load report:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="result-page">
        <div className="loading"><div className="spinner"></div></div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="result-page">
        <div className="empty-state">
          <h3>未找到任务</h3>
        </div>
      </div>
    );
  }

  const isArrangedOnly = report.task?.arrangementStatus === 'TaskArrangementCompleted' && !report.task?.finalOutputReady;
  const isInterventionOnly = report.task?.status === 'intervention_required' && !report.task?.finalOutputReady;
  const taskCompleted = report.task?.status === 'completed' || report.task?.status === 'TaskCompleted';
  const taskPartialFailed = report.summary.failedSteps > 0 && report.summary.finalOutputReady;

  return (
    <div className="result-page">
      <ResultBanner 
        task={report.task} 
        summary={report.summary}
        isCompleted={taskCompleted}
        isPartialFailed={taskPartialFailed}
        isArrangedOnly={isArrangedOnly}
        isInterventionOnly={isInterventionOnly}
        onBack={() => navigate('/tasks')}
        onAddToKnowledge={() => console.log('Add to knowledge')}
        onExport={() => console.log('Export')}
      />
      
      {report.task?.complexityDecisionSummary && (
        <ResultSummarySection summary={report.task.complexityDecisionSummary} />
      )}

      {(report.summary.failedSteps > 0 || report.task?.degradationSummary) && (
        <DegradationSection 
          summary={report.task?.degradationSummary}
          failedSteps={report.summary.failedSteps}
          totalSteps={report.summary.totalSteps}
        />
      )}
      
      {report.outputs.length > 0 && (
        <ResultOutputSection outputs={report.outputs} />
      )}
      
      {report.memoryScope && (
        <MemoryScopeSection scope={report.memoryScope} />
      )}
      
      {report.permissionDecisions && report.permissionDecisions.length > 0 && (
        <PermissionSummarySection decisions={report.permissionDecisions} />
      )}
      
      <ResultReferenceSection />
      
      {report.task?.supplementUpdates && report.task.supplementUpdates.length > 0 && (
        <SupplementSection updates={report.task.supplementUpdates} />
      )}
    </div>
  );
}

interface ResultBannerProps {
  task: any;
  summary: any;
  isCompleted?: boolean;
  isPartialFailed?: boolean;
  isArrangedOnly: boolean;
  isInterventionOnly: boolean;
  onBack: () => void;
  onAddToKnowledge: () => void;
  onExport: () => void;
}

function ResultBanner({ task, summary, isCompleted, isPartialFailed, isArrangedOnly, isInterventionOnly, onBack, onAddToKnowledge, onExport }: ResultBannerProps) {
  const completed = isCompleted ?? (task?.status === 'completed' || task?.status === 'TaskCompleted');
  const partialFailed = isPartialFailed ?? (summary.failedSteps > 0 && summary.finalOutputReady);
  
  return (
    <div className="result-banner">
      <div className="banner-header">
        <button className="btn-back" onClick={onBack}>← 返回</button>
        <h2>任务结果</h2>
      </div>
      
      <div className={`banner-status ${completed ? 'completed' : partialFailed ? 'partial' : 'failed'}`}>
        {isArrangedOnly && '📋 任务已安排完成'}
        {isInterventionOnly && '⚠️ 任务需人工介入'}
        {!isArrangedOnly && !isInterventionOnly && (completed ? '✅ 任务已完成' : '❌ 任务未完成')}
      </div>
      
      {task?.intakeInputSummary && (
        <div className="banner-summary">{task.intakeInputSummary}</div>
      )}
      
      <div className="banner-stats">
        <div className="stat-item">
          <span className="stat-value">{summary.totalSteps}</span>
          <span className="stat-label">总步骤</span>
        </div>
        <div className="stat-item completed">
          <span className="stat-value">{summary.completedSteps}</span>
          <span className="stat-label">已完成</span>
        </div>
        <div className="stat-item failed">
          <span className="stat-value">{summary.failedSteps}</span>
          <span className="stat-label">失败</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{summary.finalOutputReady ? '是' : '否'}</span>
          <span className="stat-label">最终输出</span>
        </div>
      </div>
      
      <div className="banner-actions">
        <button className="btn btn-secondary" onClick={onAddToKnowledge}>
          加入知识库
        </button>
        <button className="btn btn-secondary" onClick={onExport}>
          📤 导出
        </button>
      </div>
    </div>
  );
}

function ResultSummarySection({ summary }: { summary: string }) {
  return (
    <div className="result-section">
      <h3>📋 任务清单摘要</h3>
      <div className="section-content">
        <p>{summary}</p>
      </div>
    </div>
  );
}

interface DegradationSectionProps {
  summary?: string;
  failedSteps: number;
  totalSteps: number;
}

function DegradationSection({ summary, failedSteps, totalSteps }: DegradationSectionProps) {
  return (
    <div className="result-section degradation">
      <h3>⚠️ 降级交付说明</h3>
      <div className="section-content">
        <p>{failedSteps} 个步骤失败 ({Math.round((failedSteps / totalSteps) * 100)}%)</p>
        {summary && <p>{summary}</p>}
      </div>
    </div>
  );
}

function ResultOutputSection({ outputs }: { outputs: any[] }) {
  return (
    <div className="result-section">
      <h3>📖 输出物</h3>
      <div className="output-grid">
        {outputs.map((output) => (
          <div key={output.id} className="output-card">
            <div className="output-header">
              <span className="output-icon">📄</span>
              <span className="output-type">{output.type}</span>
            </div>
            {output.summary && <div className="output-summary">{output.summary}</div>}
            {output.content && <div className="output-content">{output.content}</div>}
            <div className="output-footer">
              <span className="output-time">
                {format(new Date(output.createdAt), 'yyyy-MM-dd HH:mm:ss')}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface MemoryScopeSectionProps {
  scope: {
    persistentMemories: Array<{ title: string; date: string }>;
    knowledgeSources: Array<{ title: string }>;
  };
}

function MemoryScopeSection({ scope }: MemoryScopeSectionProps) {
  return (
    <div className="result-section">
      <h3>🧠 记忆加载范围</h3>
      <div className="section-content">
        {scope.persistentMemories.length > 0 && (
          <div className="memory-group">
            <h4>持久记忆:</h4>
            <ul>
              {scope.persistentMemories.map((mem, idx) => (
                <li key={idx}>{mem.title} ({mem.date})</li>
              ))}
            </ul>
          </div>
        )}
        {scope.knowledgeSources.length > 0 && (
          <div className="memory-group">
            <h4>知识库:</h4>
            <ul>
              {scope.knowledgeSources.map((kb, idx) => (
                <li key={idx}>{kb.title}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

interface PermissionSummarySectionProps {
  decisions: Array<{
    action: string;
    target: string;
    decision: string;
    policySource?: string;
  }>;
}

function PermissionSummarySection({ decisions }: PermissionSummarySectionProps) {
  return (
    <div className="result-section">
      <h3>🔐 权限决策摘要</h3>
      <div className="section-content">
        {decisions.map((dec, idx) => (
          <div key={idx} className="permission-decision">
            <span className={`decision-badge ${dec.decision === 'allowed' ? 'allowed' : 'denied'}`}>
              {dec.decision === 'allowed' ? '✓' : '✗'}
            </span>
            <span className="decision-action">{dec.action}</span>
            <span className="decision-target">{dec.target}</span>
            {dec.policySource && (
              <span className="decision-policy">- {dec.policySource}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultReferenceSection() {
  return (
    <div className="result-section">
      <h3>📚 引用与参考</h3>
      <div className="section-content">
        <p className="empty-text">暂无引用</p>
      </div>
    </div>
  );
}

interface SupplementSectionProps {
  updates: Array<{
    id: string;
    content: string;
    arrivedAt: string;
    stepSummary?: string;
  }>;
}

function SupplementSection({ updates }: SupplementSectionProps) {
  return (
    <div className="result-section supplement">
      <h3>📥 补充更新</h3>
      {updates.map((update) => (
        <div key={update.id} className="supplement-item">
          <div className="supplement-header">
            <span className="supplement-time">
              {format(new Date(update.arrivedAt), 'yyyy-MM-dd HH:mm')}
            </span>
          </div>
          <div className="supplement-content">
            {update.stepSummary && <p className="supplement-step">{update.stepSummary}</p>}
            <p>{update.content}</p>
          </div>
          <button className="btn-link">查看详情</button>
        </div>
      ))}
    </div>
  );
}

export default ResultPage;
