import { useState, useEffect } from 'react';
import { api } from '../api/client';

interface PermissionRequest {
  id: string;
  taskId: string;
  stepId?: string;
  action: string;
  target: string;
  description?: string;
  status: string;
  createdAt: string;
}

interface PermissionConfirmModalProps {
  request: PermissionRequest;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onClose: () => void;
}

export function PermissionConfirmModal({ request, onApprove, onDeny, onClose }: PermissionConfirmModalProps) {
  const [countdown, setCountdown] = useState(300);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      read: '读取',
      write: '写入',
      execute: '执行'
    };
    return labels[action] || action;
  };

  const handleApprove = async () => {
    setLoading(true);
    try {
      await onApprove(request.id);
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = async () => {
    setLoading(true);
    try {
      await onDeny(request.id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ color: '#f59e0b' }}>⚠️</span>
          <span style={{ marginLeft: 8 }}>权限确认请求</span>
        </div>
        
        <div className="modal-body">
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>
              操作类型
            </div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>
              {getActionLabel(request.action)}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>
              目标资源
            </div>
            <div style={{ fontSize: 14, fontFamily: 'monospace', background: '#f3f4f6', padding: 8, borderRadius: 4 }}>
              {request.target}
            </div>
          </div>

          {request.description && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>
                描述
              </div>
              <div style={{ fontSize: 14 }}>
                {request.description}
              </div>
            </div>
          )}

          <div style={{ padding: 12, background: '#fef3c7', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
            ⚠️ 此操作可能对系统产生影响，请在确认安全后授权
          </div>

          <div style={{ marginTop: 16, fontSize: 12, color: countdown === 0 ? '#ef4444' : '#6b7280' }}>
            {countdown === 0 ? '请求已超时' : `超时倒计时: ${formatTime(countdown)}`}
          </div>
        </div>

        <div className="modal-footer">
          <button 
            className="btn btn-secondary" 
            onClick={handleDeny}
            disabled={loading || countdown === 0}
          >
            拒绝
          </button>
          <button 
            className="btn btn-primary" 
            onClick={handleApprove}
            disabled={loading || countdown === 0}
          >
            {loading ? '处理中...' : '批准'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PermissionPanel() {
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPermissions();
  }, []);

  const loadPermissions = async () => {
    setLoading(true);
    try {
      // Would need an API endpoint for this
      // const data = await api.getPendingPermissions();
      // setPermissions(data);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    await api.grantPermission(id);
    setPermissions(prev => prev.filter(p => p.id !== id));
  };

  const handleDeny = async (id: string) => {
    await api.denyPermission(id);
    setPermissions(prev => prev.filter(p => p.id !== id));
  };

  if (loading) {
    return null;
  }

  if (permissions.length === 0) {
    return null;
  }

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1000 }}>
      {permissions.slice(0, 1).map(request => (
        <PermissionConfirmModal
          key={request.id}
          request={request}
          onApprove={handleApprove}
          onDeny={handleDeny}
          onClose={() => setPermissions([])}
        />
      ))}
    </div>
  );
}
