import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { RootState } from '../../store';
import { api } from '../../api/client';
import { walletService } from '../wallet/walletService';
import { WalletData } from '../wallet/walletTypes';
import { useToast } from '../../components/ToastContext';
import { Skeleton } from '../../components/Skeleton';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  PlusCircle,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  Layers,
  Sparkles,
} from 'lucide-react';

interface AdminUserData {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, accessToken } = useSelector((state: RootState) => state.auth);
  const { toast } = useToast();

  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [walletLoading, setWalletLoading] = useState<boolean>(true);
  const [adminTestResult, setAdminTestResult] = useState<string | null>(null);
  const [adminTestStatus, setAdminTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [adminTesting, setAdminTesting] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshSuccessMessage, setRefreshSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    walletService.getMyWallet()
      .then(setWallet)
      .catch((err) => {
        console.error('Failed to load wallet:', err);
      })
      .finally(() => setWalletLoading(false));
  }, []);

  const handleTestAdminRoute = async () => {
    setAdminTestStatus('idle');
    setAdminTestResult(null);
    setAdminTesting(true);
    try {
      const res = await api.get<{ data: AdminUserData[] }>('/users');
      setAdminTestStatus('success');
      const msg = `RBAC Authorization Succeeded: Retrieved ${res.data.data.length} registered system users from GET /api/v1/users`;
      setAdminTestResult(msg);
      toast.success(msg, 'Admin Guard Verified');
    } catch (err: unknown) {
      setAdminTestStatus('error');
      let msg = 'Failed to access admin endpoint';
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const axErr = err as { response?: { status: number; data?: { message?: string } } };
        msg = `HTTP ${axErr.response?.status} - ${axErr.response?.data?.message || 'Access Denied: Insufficient Role Permissions'}`;
      }
      setAdminTestResult(msg);
      toast.error(msg, 'RBAC Access Denied');
    } finally {
      setAdminTesting(false);
    }
  };

  const handleTriggerRefresh = async () => {
    setIsRefreshing(true);
    setRefreshSuccessMessage(null);
    try {
      await api.post('/auth/refresh');
      const msg = 'Access token refreshed & refresh cookie rotated successfully!';
      setRefreshSuccessMessage(msg);
      toast.success(msg, 'Session Rotated');
    } catch {
      const errMsg = 'Token refresh failed or session expired';
      setRefreshSuccessMessage(errMsg);
      toast.error(errMsg, 'Rotation Failed');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* 1. Top Welcome Banner */}
      <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h2 className="text-page-title">
              Welcome back, {user?.fullName?.split(' ')[0]}
            </h2>
            <span className="badge badge-success" style={{ gap: '0.25rem' }}>
              <CheckCircle2 size={12} /> Active
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Manage your simulated digital wallet, transactions, and RBAC authorization profile.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            padding: '0.45rem 0.85rem',
            backgroundColor: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)'
          }}>
            Account ID: {user?.id ? `${user.id.substring(0, 8)}...` : 'N/A'}
          </div>
        </div>
      </section>

      {/* 2. Hero Balance Card & Quick Actions */}
      <section className="hero-balance-card">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1.5rem', position: 'relative', zIndex: 2 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Wallet size={18} style={{ color: '#818cf8' }} />
              <span className="text-card-title" style={{ color: '#94a3b8' }}>Available Digital Balance</span>
              <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>INR (₹)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', minHeight: '3.5rem' }}>
              {walletLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem' }}>
                  <Skeleton width="220px" height="2.75rem" borderRadius="var(--radius-md)" />
                  <Skeleton width="130px" height="0.875rem" />
                </div>
              ) : (
                <>
                  <span className="financial-amount" style={{ fontSize: '2.75rem', color: 'white' }}>
                    {wallet?.formattedBalance || '₹0.00'}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    ({wallet?.balance?.toLocaleString('en-IN') || '0'} paise)
                  </span>
                </>
              )}
            </div>

            <p style={{ fontSize: '0.775rem', color: '#818cf8', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Sparkles size={14} /> Real-time double-entry settlement engine active
            </p>
          </div>

          {/* Quick Action Triggers */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <button
              onClick={() => navigate('/wallet')}
              className="btn btn-primary"
              style={{ gap: '0.45rem' }}
            >
              <PlusCircle size={17} />
              <span>Add Money</span>
            </button>

            <button
              onClick={() => navigate('/transfers')}
              className="btn btn-secondary"
              style={{ gap: '0.45rem' }}
            >
              <ArrowUpRight size={17} />
              <span>Send Money</span>
            </button>

            <button
              onClick={() => navigate('/wallet')}
              className="btn btn-secondary"
              style={{ gap: '0.45rem' }}
            >
              <Receipt size={17} />
              <span>Statement</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3. Stat Overview Grid */}
      <section className="stat-grid">
        <div className="card stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="text-card-title">Monthly Volume</span>
            <div style={{ padding: '0.35rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--success-subtle)', color: 'var(--success)' }}>
              <ArrowDownLeft size={16} />
            </div>
          </div>
          <span className="financial-amount" style={{ fontSize: '1.5rem' }}>₹0.00</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Simulated Demo Volume</span>
        </div>

        <div className="card stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="text-card-title">Completed Transfers</span>
            <div style={{ padding: '0.35rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--primary-subtle)', color: 'var(--primary)' }}>
              <ArrowUpRight size={16} />
            </div>
          </div>
          <span className="financial-amount" style={{ fontSize: '1.5rem' }}>0</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>0 pending verification</span>
        </div>

        <div className="card stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="text-card-title">Daily Risk Limit</span>
            <div style={{ padding: '0.35rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--warning-subtle)', color: 'var(--warning)' }}>
              <Sparkles size={16} />
            </div>
          </div>
          <span className="financial-amount" style={{ fontSize: '1.5rem' }}>₹50,000.00</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Enforced by Risk Rule Engine</span>
        </div>
      </section>

      {/* 4. Recent Transactions & Ledger Activity */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 className="text-section-title">Recent Ledger Transactions</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Immutable append-only debit and credit entries
            </p>
          </div>
          <span className="badge badge-neutral">Phase 2 Activation</span>
        </div>

        {/* Empty State Presentation */}
        <div style={{
          padding: '3rem 1.5rem',
          textAlign: 'center',
          backgroundColor: 'rgba(11, 17, 30, 0.4)',
          borderRadius: 'var(--radius-md)',
          border: '1px dashed var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            backgroundColor: 'var(--bg-surface-elevated)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)'
          }}>
            <Receipt size={22} />
          </div>
          <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
            No Financial Transactions Recorded
          </p>
          <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', maxWidth: '400px' }}>
            Your digital wallet is provisioned. In Phase 2, all deposits and transfers will register balanced double-entry ledger rows here.
          </p>
        </div>
      </section>

      {/* 5. Security & Interactive RBAC Verification Card */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h3 className="text-section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Layers size={18} style={{ color: 'var(--primary)' }} />
              Security Architecture & RBAC Verifier
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Live verification of Phase 1 stateless JWT access tokens, HttpOnly refresh cookies, and RBAC authorization guards.
            </p>
          </div>

          <button
            onClick={handleTriggerRefresh}
            disabled={isRefreshing}
            className="btn btn-secondary btn-sm"
            style={{ gap: '0.4rem' }}
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            <span>Test Token Rotation</span>
          </button>
        </div>

        {refreshSuccessMessage && (
          <div style={{
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--success-subtle)',
            border: '1px solid var(--success-border)',
            color: '#6ee7b7',
            fontSize: '0.825rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <CheckCircle2 size={16} />
            <span>{refreshSuccessMessage}</span>
          </div>
        )}

        {/* Security Token Specs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          <div style={{ padding: '1rem', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              In-Memory Access Token
            </p>
            <p style={{ fontSize: '0.825rem', color: 'var(--success)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <CheckCircle2 size={14} /> Stateless JWT (15-min lifespan)
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '0.4rem', wordBreak: 'break-all' }}>
              Bearer {accessToken ? `${accessToken.substring(0, 32)}...` : 'None'}
            </p>
          </div>

          <div style={{ padding: '1rem', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              HttpOnly Refresh Token
            </p>
            <p style={{ fontSize: '0.825rem', color: '#c7d2fe', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <CheckCircle2 size={14} /> Stateful SHA-256 in PostgreSQL
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
              Stored in secure cookie. Protected from XSS. Automatic replay compromise detection enabled.
            </p>
          </div>
        </div>

        {/* Live RBAC Test */}
        <div style={{
          padding: '1.25rem',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'rgba(13, 19, 34, 0.6)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem'
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Test Endpoint: <code style={{ color: '#a5b4fc', fontFamily: 'var(--font-mono)' }}>GET /api/v1/users</code>
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                Protected by <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>requireRole("ADMIN")</code>. If logged in as <strong>{user?.role}</strong>, verify the gatekeeper response.
              </p>
            </div>

            <button
              id="test-rbac-btn"
              onClick={handleTestAdminRoute}
              disabled={adminTesting}
              className="btn btn-primary btn-sm"
              style={{ minWidth: '140px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem' }}
            >
              {adminTesting ? (
                <>
                  <div className="spinner spinner-sm"></div>
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Test Admin Guard</span>
              )}
            </button>
          </div>

          {adminTestResult && (
            <div style={{
              padding: '0.85rem 1rem',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: adminTestStatus === 'success' ? 'var(--success-subtle)' : 'var(--danger-subtle)',
              border: `1px solid ${adminTestStatus === 'success' ? 'var(--success-border)' : 'var(--danger-border)'}`,
              color: adminTestStatus === 'success' ? '#6ee7b7' : '#fda4af',
              fontSize: '0.825rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem'
            }}>
              {adminTestStatus === 'success' ? (
                <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
              ) : (
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
              )}
              <div>
                <p style={{ fontWeight: 700 }}>
                  {adminTestStatus === 'success' ? 'Access Granted (RBAC OK)' : 'Access Denied (RBAC Protected)'}
                </p>
                <p style={{ fontSize: '0.775rem', marginTop: '0.2rem', fontFamily: 'var(--font-mono)', opacity: 0.9 }}>
                  {adminTestResult}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
