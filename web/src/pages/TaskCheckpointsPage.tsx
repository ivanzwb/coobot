import { useNavigate, useParams } from 'react-router-dom';

export function TaskCheckpointsPage() {
  const { taskId = '' } = useParams<{ taskId: string }>();
  const navigate = useNavigate();

  return (
    <div className="content">
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">任务检查点恢复</h2>
          <button className="btn btn-secondary" onClick={() => navigate(`/tasks/${taskId}`)}>返回任务详情</button>
        </div>

        <p style={{ color: '#4b5563', marginBottom: 16 }}>
          任务 ID: <strong>{taskId}</strong>
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-title">检查点列表</div>
            <ul style={{ margin: '8px 0 0 16px', color: '#4b5563' }}>
              <li>cp_001 - step_completed - valid</li>
              <li>cp_002 - permission_resolved - valid</li>
              <li>cp_003 - degrade_applied - invalid</li>
            </ul>
          </div>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-title">验证结果</div>
            <p style={{ color: '#4b5563' }}>
              展示完整性、幂等性、时效性验证结果，并提供恢复入口。
            </p>
            <button className="btn btn-primary">执行恢复</button>
          </div>
        </div>
      </div>
    </div>
  );
}
