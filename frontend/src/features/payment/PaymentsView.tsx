import React, { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  Plus,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Building2,
  Copy,
  Check,
} from 'lucide-react';
import { paymentService } from './paymentService';
import { walletService } from '../wallet/walletService';
import { PaymentIntentData, PaymentStatus } from './paymentTypes';
import { WalletData } from '../wallet/walletTypes';
import { AddMoneyModal } from './AddMoneyModal';
import { useToast } from '../../components/ToastContext';
import { Skeleton } from '../../components/Skeleton';

export const PaymentsView: React.FC = () => {
  const { toast } = useToast();

  // Data state
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [payments, setPayments] = useState<PaymentIntentData[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | 'ALL'>('ALL');

  // Loading & refresh state
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Add Money modal state
  const [isAddMoneyOpen, setIsAddMoneyOpen] = useState<boolean>(false);

  // Load wallet summary
  const loadWallet = useCallback(async () => {
    try {
      const data = await walletService.getMyWallet();
      setWallet(data);
    } catch (err) {
      console.error('Failed to load wallet in PaymentsView:', err);
    }
  }, []);

  // Load payment history
  const loadPayments = useCallback(
    async (page = 1, showRefreshToast = false) => {
      try {
        if (showRefreshToast) setRefreshing(true);
        else setLoading(true);

        const filter = statusFilter === 'ALL' ? undefined : statusFilter;
        const res = await paymentService.listPayments(page, 10, filter);

        setPayments(res.payments);
        setPagination(res.pagination);

        if (showRefreshToast) {
          toast.success('Payment intents and status synchronized with database', 'Refreshed');
        }
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Failed to load payment history.';
        toast.error(msg, 'Sync Error');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [statusFilter, toast]
  );

  // Initial load
  useEffect(() => {
    loadWallet();
    loadPayments(1);
  }, [loadWallet, loadPayments]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.info('Copied to clipboard', 'Clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      loadPayments(newPage);
    }
  };

  const formatPaiseToRupees = (paise: number) => {
    return (paise / 100).toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    });
  };

  // Metrics computation
  const successCount = payments.filter((p) => p.status === 'SUCCESS').length;
  const processingCount = payments.filter((p) => p.status === 'PROCESSING' || p.status === 'CREATED').length;
  const failedCount = payments.filter((p) => p.status === 'FAILED' || p.status === 'CANCELLED').length;

  const renderStatusBadge = (status: PaymentStatus) => {
    switch (status) {
      case 'SUCCESS':
        return (
          <span className="badge badge-success">
            <CheckCircle2 size={12} /> Success
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="badge badge-warning">
            <Clock size={12} /> Processing
          </span>
        );
      case 'CREATED':
        return (
          <span className="badge badge-primary">
            <Clock size={12} /> Initiated
          </span>
        );
      case 'FAILED':
        return (
          <span
            className="badge"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            <XCircle size={12} /> Declined
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="badge badge-neutral">
            <AlertTriangle size={12} /> Cancelled
          </span>
        );
      default:
        return <span className="badge badge-neutral">{status}</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* 1. Header Section */}
      <section
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h2 className="text-page-title">Payments & Top-Ups</h2>
            <span className="badge badge-primary">Phase 4 Active</span>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Authoritative gateway payment orders, HMAC-SHA256 webhooks & double-entry wallet settlement
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            className="btn btn-secondary"
            onClick={() => {
              loadWallet();
              loadPayments(pagination.page, true);
            }}
            disabled={refreshing || loading}
            title="Refresh payment records"
          >
            <RefreshCw size={16} className={refreshing ? 'spin-animation' : ''} />
            Refresh
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setIsAddMoneyOpen(true)}
          >
            <Plus size={16} />
            + Add Money
          </button>
        </div>
      </section>

      {/* 2. Top Summary Metric Cards */}
      <section className="stat-grid">
        {/* Wallet Balance Card */}
        <div className="card stat-card" style={{ borderLeft: '4px solid var(--primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="text-card-title">Current Wallet Balance</span>
            <div
              style={{
                padding: '0.35rem',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--primary-subtle)',
                color: 'var(--primary)',
              }}
            >
              <Building2 size={16} />
            </div>
          </div>
          <div className="financial-amount" style={{ fontSize: '1.75rem' }}>
            {wallet ? (
              formatPaiseToRupees(wallet.balance)
            ) : (
              <Skeleton width="140px" height="28px" />
            )}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Wallet ID: {wallet?.walletId ? `${wallet.walletId.substring(0, 14)}...` : 'Loading...'}
          </span>
        </div>

        {/* Successful Settlements Card */}
        <div className="card stat-card" style={{ borderLeft: '4px solid var(--success)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="text-card-title">Settled Payments</span>
            <div
              style={{
                padding: '0.35rem',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--success-subtle)',
                color: 'var(--success)',
              }}
            >
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div className="financial-amount" style={{ fontSize: '1.75rem' }}>
            {pagination.total} Orders
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {successCount} settled in current view
          </span>
        </div>

        {/* In-Flight Orders Card */}
        <div className="card stat-card" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="text-card-title">In-Flight / Pending</span>
            <div
              style={{
                padding: '0.35rem',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--warning-subtle)',
                color: 'var(--warning)',
              }}
            >
              <Clock size={16} />
            </div>
          </div>
          <div className="financial-amount" style={{ fontSize: '1.75rem' }}>
            {processingCount} Active
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Authoritative webhook polling
          </span>
        </div>

        {/* Gateway Security Card */}
        <div className="card stat-card" style={{ borderLeft: '4px solid #818cf8' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="text-card-title">Gateway Verification</span>
            <div
              style={{
                padding: '0.35rem',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--primary-subtle)',
                color: 'var(--primary)',
              }}
            >
              <ShieldCheck size={16} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem' }}>
            <span className="badge badge-success">HMAC-SHA256</span>
            <span className="badge badge-primary">MOCK + RZP</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Strict out-of-band webhook settlement ({failedCount} declined)
          </span>
        </div>
      </section>

      {/* 3. Filter Tabs & History Table */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div>
            <h3 className="text-section-title">Payment Intents History</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Every payment order created through MockPaymentGateway or Razorpay
            </p>
          </div>

          {/* Filter Tabs */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'rgba(11, 17, 30, 0.6)',
              padding: '0.25rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              gap: '0.25rem',
            }}
          >
            {(['ALL', 'SUCCESS', 'PROCESSING', 'FAILED'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                style={{
                  padding: '0.4rem 0.85rem',
                  fontSize: '0.775rem',
                  fontWeight: 600,
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: statusFilter === st ? 'var(--primary)' : 'transparent',
                  color: statusFilter === st ? '#ffffff' : 'var(--text-secondary)',
                  transition: 'all 0.15s ease',
                }}
              >
                {st === 'ALL' ? 'All Orders' : st}
              </button>
            ))}
          </div>
        </div>

        {/* Table / List Presentation */}
        {loading && payments.length === 0 ? (
          <div style={{ padding: '2rem 0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <Skeleton width="100%" height="48px" />
            <Skeleton width="100%" height="48px" />
            <Skeleton width="100%" height="48px" />
          </div>
        ) : payments.length === 0 ? (
          <div
            style={{
              padding: '3.5rem 1.5rem',
              textAlign: 'center',
              backgroundColor: 'rgba(11, 17, 30, 0.4)',
              borderRadius: 'var(--radius-md)',
              border: '1px dashed var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: 'var(--bg-surface-elevated)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
              }}
            >
              <CreditCard size={24} />
            </div>
            <div>
              <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                No payment intents found
              </h4>
              <p
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                  marginTop: '0.25rem',
                  maxWidth: '400px',
                }}
              >
                {statusFilter !== 'ALL'
                  ? `No payment orders matching filter "${statusFilter}".`
                  : 'You have not initialized any payment orders yet. Click below to simulate your first gateway deposit.'}
              </p>
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: '0.5rem' }}
              onClick={() => setIsAddMoneyOpen(true)}
            >
              <Plus size={16} />
              Add Money Now
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Gateway Order ID</th>
                  <th>Provider</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Created At</th>
                  <th>Completed At</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '0.825rem',
                            color: 'var(--text-primary)',
                            fontWeight: 600,
                          }}
                        >
                          {item.gatewayOrderId || item.id.substring(0, 18)}
                        </span>
                        <button
                          onClick={() => handleCopy(item.gatewayOrderId || item.id, item.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '0.2rem',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          title="Copy Order ID"
                        >
                          {copiedId === item.id ? (
                            <Check size={14} color="var(--success)" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                      {item.gatewayPaymentId && (
                        <div
                          style={{
                            fontSize: '0.725rem',
                            color: 'var(--text-muted)',
                            fontFamily: 'monospace',
                            marginTop: '0.15rem',
                          }}
                        >
                          Payment ID: {item.gatewayPaymentId}
                        </div>
                      )}
                    </td>

                    <td>
                      <span
                        className="badge"
                        style={{
                          backgroundColor:
                            item.provider === 'RAZORPAY'
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'rgba(139, 92, 246, 0.15)',
                          color: item.provider === 'RAZORPAY' ? '#93c5fd' : '#c4b5fd',
                          border: `1px solid ${
                            item.provider === 'RAZORPAY'
                              ? 'rgba(59, 130, 246, 0.3)'
                              : 'rgba(139, 92, 246, 0.3)'
                          }`,
                        }}
                      >
                        {item.provider}
                      </span>
                    </td>

                    <td>
                      <span
                        className="financial-amount"
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 700,
                          color: item.status === 'SUCCESS' ? 'var(--success)' : 'var(--text-primary)',
                        }}
                      >
                        {formatPaiseToRupees(item.amount)}
                      </span>
                    </td>

                    <td>{renderStatusBadge(item.status)}</td>

                    <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {new Date(item.createdAt).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {item.completedAt ? (
                        new Date(item.completedAt).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      ) : (
                        <span style={{ fontStyle: 'italic', opacity: 0.6 }}>Pending settlement</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 4. Pagination Bar */}
        {pagination.totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '0.75rem',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} total orders)
            </span>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                disabled={pagination.page <= 1}
                onClick={() => handlePageChange(pagination.page - 1)}
              >
                <ChevronLeft size={16} /> Prev
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => handlePageChange(pagination.page + 1)}
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 5. Add Money Modal (Phase 4 Simulation & Phase 2 Top-Up) */}
      <AddMoneyModal
        isOpen={isAddMoneyOpen}
        onClose={() => setIsAddMoneyOpen(false)}
        onSuccess={() => {
          loadWallet();
          loadPayments(1);
        }}
      />
    </div>
  );
};

export default PaymentsView;
