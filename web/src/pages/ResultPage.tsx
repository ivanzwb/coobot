import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { format } from 'date-fns';

interface TaskReport {
  task: any;
  steps: any[];
  outputs: any[];
  events: any[];
  summary: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    finalOutputReady: boolean;
  };
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

  return (
    <div className="result-page">
      <ResultBanner 
        task={report.task} 
        summary={report.summary}
        onBack={() => navigate('/tasks')}
      />
      
      {report.task?.complexityDecisionSummary && (
        <ResultSummarySection summary={report.task.complexityDecisionSummary} />
      )}
      
      {report.outputs.length > 0 && (
        <ResultOutputSection outputs={report.outputs} />
      )}
      
      <ResultReferenceSection />
      
      <ResultActionSection />
    </div>
  );
}

function ResultBanner({ task, summary, onBack }: { task: any; summary: any; onBack: () => void }) {
  const isCompleted = task?.status === 'completed';
  
  return (
    <div className="result-banner">
      <div className="banner-header">
        <button className="btn-back" onClick={onBack}>← 返回</button>
        <h2>任务结果</h2>
      </div>
      <div className={`banner-status ${isCompleted ? 'completed' : 'failed'}`}>
        {isCompleted ? '✅ 任务已完成' : '❌ 任务未完成'}
      </div>
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
    </div>
  );
}

function ResultSummarySection({ summary }: { summary: string }) {
  return (
    <div className="result-section">
      <h3>📋 任务摘要</h3>
      <div className="section-content">
        <p>{summary}</p>
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

function ResultActionSection() {
  return (
    <div className="result-actions">
      <button className="btn btn-secondary">加入知识库</button>
      <button className="btn btn-secondary">导出结果</button>
      <button className="btn btn-primary">新建相似任务</button>
    </div>
  );
}

export default ResultPage;
