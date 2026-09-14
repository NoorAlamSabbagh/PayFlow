import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';

export const Forbidden: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.auth);

  return (
    <div className="auth-wrapper">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div style={{
          width: '54px',
          height: '54px',
          borderRadius: 'var(--radius-lg)',
          backgroundColor: 'var(--danger-subtle)',
          border: '1px solid var(--danger-border)',
          color: 'var(--danger)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.25rem'
        }}>
          <ShieldAlert size={30} />
        </div>

        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          403 – Access Forbidden
        </h1>

        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.65rem', lineHeight: 1.6 }}>
          Your current account role <span className="badge badge-warning">{user?.role || 'GUEST'}</span> does not have the required permissions to access this administrative resource.
        </p>

        <button
          onClick={() => navigate('/dashboard')}
          className="btn btn-primary"
          style={{ width: '100%', marginTop: '1.75rem', gap: '0.5rem' }}
        >
          <ArrowLeft size={16} />
          <span>Return to Dashboard</span>
        </button>
      </div>
    </div>
  );
};
