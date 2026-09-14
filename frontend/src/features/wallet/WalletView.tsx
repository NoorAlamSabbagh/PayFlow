import React, { useState, useEffect, useCallback } from 'react';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  RefreshCw,
  ShieldCheck,
  Building2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ReceiptText,
} from 'lucide-react';
import { walletService } from './walletService';
import { WalletData, LedgerEntry } from './walletTypes';
import { AddMoneyModal } from '../payment/AddMoneyModal';

export const WalletView: React.FC = () => {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Add Money Modal State
  const [isDepositModalOpen, setIsDepositModalOpen] = useState<boolean>(false);

  const loadData = useCallback(async (page = 1, showRefreshSpinner = false) => {
    try {
      if (showRefreshSpinner) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const [walletData, ledgerData] = await Promise.all([
        walletService.getMyWallet(),
        walletService.getMyLedger(page, 10),
      ]);

      setWallet(walletData);
      setLedgerEntries(ledgerData.entries);
      setPagination(ledgerData.pagination);
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to load wallet data. Please check your connection.';
      setError(errorMsg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(1);
  }, [loadData]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      loadData(newPage);
    }
  };

  return (
    <div className="app-content">
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="text-page-title">Digital Wallet</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Primary settlement account backed by immutable double-entry ledger
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => loadData(pagination.page, true)}
            className="btn btn-secondary btn-sm"
            disabled={refreshing || loading}
            title="Refresh balance and ledger"
          >
            <RefreshCw size={16} className={refreshing ? 'spinner' : ''} />
            <span>Sync</span>
          </button>

          <button
            onClick={() => setIsDepositModalOpen(true)}
            className="btn btn-primary btn-sm"
            id="btn-open-deposit-modal"
          >
            <Plus size={16} />
            <span>Add Demo Money</span>
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          backgroundColor: 'var(--danger-subtle)',
          border: '1px solid var(--danger-border)',
          color: '#fda4af',
          padding: '1rem 1.25rem',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Hero Balance Card */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(26, 36, 54, 0.9) 0%, rgba(17, 24, 39, 0.95) 100%)',
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-xl)',
        padding: '2rem',
        marginBottom: '2rem',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-card)'
      }}>
        {/* Decorative backdrop glow */}
        <div style={{
          position: 'absolute',
          top: '-30px',
          right: '-30px',
          width: '240px',
          height: '240px',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%)',
          pointerEvents: 'none'
        }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', position: 'relative' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
              <span className="badge badge-primary">Primary Wallet</span>
              <span className="badge badge-success">
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }}></span>
                {wallet?.status || 'ACTIVE'}
              </span>
              <span className="badge badge-neutral">{wallet?.currency || 'INR'}</span>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Available Balance
            </p>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginTop: '0.25rem' }}>
              <h2 className="financial-amount" style={{ fontSize: '2.5rem', color: 'var(--text-primary)' }}>
                {loading ? '...' : (wallet?.formattedBalance || '₹0.00')}
              </h2>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem', fontFamily: 'var(--font-mono)' }}>
                ({loading ? '...' : (wallet?.balance?.toLocaleString('en-IN') || '0')} paise)
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={() => setIsDepositModalOpen(true)}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem' }}
            >
              <Plus size={18} />
              <span>+ Add Money</span>
            </button>

            <button
              disabled
              className="btn btn-secondary"
              title="P2P Transfers are scheduled for Phase 3"
              style={{ opacity: 0.6, cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <ArrowUpRight size={18} />
              <span>Transfer</span>
              <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', borderRadius: '4px', backgroundColor: 'rgba(255, 255, 255, 0.1)' }}>Phase 3</span>
            </button>
          </div>
        </div>

        {/* Technical Accounting Spec Row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1.25rem',
          marginTop: '2rem',
          paddingTop: '1.5rem',
          borderTop: '1px solid var(--border-subtle)'
        }}>
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Account Type</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
              <Building2 size={16} color="var(--primary)" />
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>USER SETTLEMENT</span>
            </div>
          </div>

          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Accounting Engine</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
              <ShieldCheck size={16} color="var(--success)" />
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>DOUBLE-ENTRY (ACID)</span>
            </div>
          </div>

          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Storage Precision</p>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              64-BIT INTEGER PAISE
            </span>
          </div>

          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Wallet ID</p>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }} title={wallet?.walletId || ''}>
              {wallet?.walletId ? `${wallet.walletId.substring(0, 14)}...` : 'Loading...'}
            </span>
          </div>
        </div>
      </div>

      {/* Ledger History Section */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <ReceiptText size={20} color="var(--primary)" />
            <h3 className="text-section-title">Double-Entry Ledger Audit Trail</h3>
            <span className="badge badge-neutral">{pagination.total} Records</span>
          </div>

          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Immutable append-only entries verified by PostgreSQL triggers
          </p>
        </div>

        {loading ? (
          <div style={{ padding: '3rem 0', textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading immutable ledger records...</p>
          </div>
        ) : ledgerEntries.length === 0 ? (
          <div style={{ padding: '3.5rem 1.5rem', textAlign: 'center', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'var(--primary-subtle)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem'
            }}>
              <Wallet size={24} />
            </div>
            <h4 style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.35rem' }}>No Ledger Activity Yet</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', maxWidth: '360px', margin: '0 auto 1.25rem' }}>
              Your wallet is ready. Use the demo deposit primitive to credit funds and inspect the resulting double-entry accounting records.
            </p>
            <button
              onClick={() => setIsDepositModalOpen(true)}
              className="btn btn-primary btn-sm"
            >
              <Plus size={16} />
              <span>Make First Demo Deposit</span>
            </button>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Reference ID</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th style={{ textAlign: 'right' }}>Balance After</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerEntries.map((entry) => {
                    const isCredit = entry.entryType === 'CREDIT';
                    return (
                      <tr key={entry.id}>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {new Date(entry.createdAt).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td>
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.75rem',
                            color: '#c7d2fe',
                            backgroundColor: 'rgba(99, 102, 241, 0.08)',
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            border: '1px solid rgba(99, 102, 241, 0.2)'
                          }}>
                            {entry.referenceId}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${isCredit ? 'badge-success' : 'badge-danger'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                            {isCredit ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
                            {entry.entryType}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                          {entry.description}
                        </td>
                        <td style={{
                          textAlign: 'right',
                          fontWeight: 700,
                          color: isCredit ? '#34d399' : '#f87171',
                          fontVariantNumeric: 'tabular-nums'
                        }}>
                          {isCredit ? '+' : '-'}{entry.formattedAmount}
                        </td>
                        <td style={{
                          textAlign: 'right',
                          fontWeight: 600,
                          color: 'var(--text-secondary)',
                          fontVariantNumeric: 'tabular-nums'
                        }}>
                          {entry.formattedBalanceAfter}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {pagination.totalPages > 1 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '1.25rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: '0.85rem'
              }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  Page {pagination.page} of {pagination.totalPages}
                </span>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page <= 1 || loading}
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '0.35rem 0.75rem' }}
                  >
                    <ChevronLeft size={16} />
                    <span>Previous</span>
                  </button>
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages || loading}
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '0.35rem 0.75rem' }}
                  >
                    <span>Next</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Phase 4 Payment Gateway External Ingestion Modal */}
      <AddMoneyModal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
        onSuccess={() => loadData(1, true)}
      />
    </div>
  );
};

export default WalletView;
