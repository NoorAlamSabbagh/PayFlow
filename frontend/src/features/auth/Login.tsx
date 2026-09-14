import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../../store';
import { loginUser, clearError } from './authSlice';
import { useToast } from '../../components/ToastContext';
import {
  Lock,
  Mail,
  ArrowRight,
  ShieldCheck,
  Eye,
  EyeOff,
  AlertCircle,
  Database,
  Layers,
  Cpu,
  Sparkles,
} from 'lucide-react';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { status, error } = useSelector((state: RootState) => state.auth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    dispatch(clearError());
    const result = await dispatch(loginUser({ email, password }));
    if (loginUser.fulfilled.match(result)) {
      toast.success(`Welcome back, ${result.payload.user.fullName}!`, 'Authentication Successful');
      navigate('/dashboard');
    } else if (loginUser.rejected.match(result)) {
      const errorMsg = (result.payload as string) || 'Invalid email or password';
      toast.error(errorMsg, 'Login Failed');
    }
  };

  const handlePreFill = (role: 'USER' | 'ADMIN') => {
    if (role === 'ADMIN') {
      setEmail('admin@payflow.internal');
      setPassword('AdminSecurePass123');
    } else {
      setEmail('alice@payflow.internal');
      setPassword('AliceSecurePass123');
    }
  };

  return (
    <div className="auth-split-layout">
      {/* =========================================================================
          Left Panel: 3D Fintech Showcase & Architectural Highlights
          ========================================================================= */}
      <div className="auth-hero-panel">
        {/* Brand Top Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, var(--primary) 0%, #4338ca 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            boxShadow: '0 4px 16px rgba(99, 102, 241, 0.4)'
          }}>
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              PayFlow
            </h1>
            <span style={{ fontSize: '0.675rem', color: '#818cf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Payment Processing Platform
            </span>
          </div>
        </div>

        {/* Center: Hero Image & Value Proposition */}
        <div style={{ margin: '2.5rem 0', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
          {/* 3D Fintech Image Showcase */}
          <div style={{
            position: 'relative',
            borderRadius: 'var(--radius-xl)',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(99, 102, 241, 0.25)',
            maxHeight: '340px'
          }}>
            <img
              src="/images/fintech_hero.jpg"
              alt="PayFlow Digital Banking & Ledger Architecture"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                transition: 'transform 0.4s ease'
              }}
            />
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, rgba(9, 14, 29, 0.1) 0%, rgba(9, 14, 29, 0.75) 100%)',
              pointerEvents: 'none'
            }} />
            <div style={{
              position: 'absolute',
              bottom: '1rem',
              left: '1.25rem',
              right: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span className="badge badge-primary" style={{ backgroundColor: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)' }}>
                <Sparkles size={11} /> Double-Entry Core
              </span>
              <span style={{ fontSize: '0.75rem', color: '#cbd5e1', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                ACID Engine
              </span>
            </div>
          </div>

          <div>
            <h2 style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.25 }}>
              Engineered for high-volume, auditable digital payments.
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.925rem', marginTop: '0.5rem', lineHeight: 1.6 }}>
              A simulated production-grade neobank platform demonstrating distributed idempotency, row-level locking, and asynchronous SQS event pipelines.
            </p>
          </div>

          {/* Architectural Value Pillars */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            <div style={{
              padding: '0.85rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid var(--border-subtle)'
            }}>
              <Database size={18} style={{ color: '#818cf8', marginBottom: '0.35rem' }} />
              <p style={{ fontSize: '0.775rem', fontWeight: 700, color: 'var(--text-primary)' }}>Double-Entry</p>
              <p style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>Zero-sum ledger balances</p>
            </div>

            <div style={{
              padding: '0.85rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid var(--border-subtle)'
            }}>
              <Cpu size={18} style={{ color: '#34d399', marginBottom: '0.35rem' }} />
              <p style={{ fontSize: '0.775rem', fontWeight: 700, color: 'var(--text-primary)' }}>Idempotency</p>
              <p style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>Zero double-spend risk</p>
            </div>

            <div style={{
              padding: '0.85rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid var(--border-subtle)'
            }}>
              <Layers size={18} style={{ color: '#fbbf24', marginBottom: '0.35rem' }} />
              <p style={{ fontSize: '0.775rem', fontWeight: 700, color: 'var(--text-primary)' }}>Token Family</p>
              <p style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>Replay breach detection</p>
            </div>
          </div>
        </div>

        {/* Bottom Trust Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          paddingTop: '1.25rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          fontSize: '0.75rem',
          color: 'var(--text-muted)'
        }}>
          <span>PostgreSQL 16</span>
          <span>•</span>
          <span>Redis 7 Mutex</span>
          <span>•</span>
          <span>AWS SQS Ready</span>
        </div>
      </div>

      {/* =========================================================================
          Right Panel: Sleek Authentication Form
          ========================================================================= */}
      <div className="auth-form-panel">
        <div style={{ width: '100%', maxWidth: '420px' }}>
          {/* Header */}
          <div style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span className="badge badge-primary" style={{ gap: '0.25rem' }}>
                <ShieldCheck size={12} /> Secure Auth
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Phase 1 Core</span>
            </div>
            <h1 style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.025em' }}>
              Sign in to Wallet
            </h1>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
              Enter your credentials to access your PayFlow account.
            </p>
          </div>

          {/* Error Feedback */}
          {error && (
            <div style={{
              padding: '0.85rem 1rem',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--danger-subtle)',
              border: '1px solid var(--danger-border)',
              color: '#fda4af',
              fontSize: '0.825rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '1.5rem'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="input-group">
              <label className="input-label" htmlFor="email-input">Email Address</label>
              <div className="input-wrapper">
                <Mail size={17} className="input-icon" />
                <input
                  id="email-input"
                  type="email"
                  className="input-field has-icon"
                  placeholder="alice@payflow.internal"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="input-label" htmlFor="password-input">Password</label>
              </div>
              <div className="input-wrapper">
                <Lock size={17} className="input-icon" />
                <input
                  id="password-input"
                  type={showPassword ? 'text' : 'password'}
                  className="input-field has-icon has-right-icon"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="input-icon-right"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.8rem', marginTop: '0.5rem' }}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? (
                <div className="spinner"></div>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Pre-fill helper */}
          <div style={{
            marginTop: '1.75rem',
            paddingTop: '1.25rem',
            borderTop: '1px solid var(--border-subtle)',
            textAlign: 'center'
          }}>
            <p style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: '0.75rem'
            }}>
              Portfolio Demo Quick Fill
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => handlePreFill('USER')}
                className="btn btn-secondary btn-sm"
                style={{ flex: 1 }}
              >
                Fill Alice (User)
              </button>
              <button
                type="button"
                onClick={() => handlePreFill('ADMIN')}
                className="btn btn-secondary btn-sm"
                style={{ flex: 1 }}
              >
                Fill Admin
              </button>
            </div>
          </div>

          {/* Footer Registration Link */}
          <div style={{ textAlign: 'center', marginTop: '1.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Don't have an account yet?{' '}
            <Link to="/register" style={{ color: '#818cf8', fontWeight: 600, textDecoration: 'none' }}>
              Create Account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
