import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeftRight,
  ArrowUpRight,
  ArrowDownLeft,
  Send,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Search,
  ReceiptText,
  Clock,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { transferService } from './transferService';
import { walletService } from '../wallet/walletService';
import {
  TransferResult,
  TransactionItem,
  CounterpartyOption,
} from './transferTypes';
import { WalletData } from '../wallet/walletTypes';
import { useToast } from '../../components/ToastContext';
import { Skeleton } from '../../components/Skeleton';

export const TransferView: React.FC = () => {
  const { toast } = useToast();
  // Wallet balance state
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loadingWallet, setLoadingWallet] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Counterparty options state
  const [counterparties, setCounterparties] = useState<CounterpartyOption[]>([]);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Send Money form state
  const [rupeeAmount, setRupeeAmount] = useState<string>('');
  const [description, setDescription] = useState<string>('P2P Transfer');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<TransferResult | null>(null);

  // Transaction history state
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'INCOMING' | 'OUTGOING'>('ALL');
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Fetch current user wallet balance
  const loadWallet = useCallback(async () => {
    try {
      setLoadingWallet(true);
      const data = await walletService.getMyWallet();
      setWallet(data);
    } catch (err: unknown) {
      console.error('Failed to load wallet:', err);
    } finally {
      setLoadingWallet(false);
    }
  }, []);

  // Fetch available recipients
  const loadCounterparties = useCallback(async () => {
    try {
      const data = await transferService.getCounterparties();
      setCounterparties(data);
      if (data.length > 0 && !selectedRecipientId) {
        setSelectedRecipientId(data[0].id);
      }
    } catch (err: unknown) {
      console.error('Failed to fetch counterparties:', err);
    }
  }, [selectedRecipientId]);

  // Fetch paginated transactions
  const loadTransactions = useCallback(async (targetPage = 1) => {
    try {
      setLoadingHistory(true);
      const filterDirection = directionFilter === 'ALL' ? undefined : directionFilter;
      const data = await transferService.getTransactions(targetPage, 10, undefined, filterDirection);
      setTransactions(data.transactions);
      setPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages);
      setTotalCount(data.pagination.total);
    } catch (err: unknown) {
      console.error('Failed to load transactions:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [directionFilter]);

  // Initial load
  useEffect(() => {
    loadWallet();
    loadCounterparties();
    loadTransactions(1);
  }, [loadWallet, loadCounterparties, loadTransactions]);

  // Handle transfer submission
  const handleSendMoney = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const parsedRupees = parseFloat(rupeeAmount);
    if (isNaN(parsedRupees) || parsedRupees <= 0) {
      const msg = 'Please enter a valid transfer amount greater than ₹0.00';
      setErrorMsg(msg);
      toast.warning(msg, 'Invalid Amount');
      return;
    }

    const amountPaise = Math.round(parsedRupees * 100);

    if (!selectedRecipientId) {
      const msg = 'Please select a valid recipient for this transfer';
      setErrorMsg(msg);
      toast.warning(msg, 'Recipient Required');
      return;
    }

    if (wallet && amountPaise > wallet.balance) {
      const msg = `Insufficient balance! Your available balance is ${wallet.formattedBalance}, but you entered ₹${parsedRupees.toFixed(2)}`;
      setErrorMsg(msg);
      toast.error(msg, 'Insufficient Funds');
      return;
    }

    try {
      setSubmitting(true);
      // Client generates unique idempotency key for exactly-once execution guarantee
      const idempotencyKey = crypto.randomUUID();

      const receipt = await transferService.createTransfer(
        {
          recipientId: selectedRecipientId,
          amount: amountPaise,
          currency: 'INR',
          description: description.trim() || 'P2P Transfer',
        },
        idempotencyKey
      );

      setLastReceipt(receipt);
      setRupeeAmount('');
      setDescription('P2P Transfer');

      toast.success(
        `Transferred ₹${parsedRupees.toLocaleString('en-IN')} to ${receipt.recipientName || 'recipient'} successfully!`,
        'Transfer Completed'
      );

      // Refresh wallet balance and transactions timeline
      await Promise.all([loadWallet(), loadTransactions(1)]);
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string } } };
      const message = errorResponse?.response?.data?.message || 'Transfer failed. Please check balance and try again.';
      setErrorMsg(message);
      toast.error(message, 'Transfer Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredCounterparties = counterparties.filter(
    (c) =>
      c.fullName.toLowerCase().includes(searchFilter.toLowerCase()) ||
      c.email.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, #10b981 0%, #047857 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white'
            }}>
              <ArrowLeftRight size={18} />
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: 0 }}>
              P2P Money Transfers
            </h1>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Deterministic Row-Level Locked Peer-to-Peer Transfers with Dual-Layer Idempotency Guard
          </p>
        </div>

        <button
          onClick={async () => {
            setRefreshing(true);
            try {
              await Promise.all([loadWallet(), loadTransactions(page)]);
              toast.success('Wallet balance & transaction history refreshed', 'Sync Complete');
            } catch {
              toast.error('Failed to refresh data', 'Sync Failed');
            } finally {
              setRefreshing(false);
            }
          }}
          disabled={refreshing || loadingWallet || loadingHistory}
          className="btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.85rem', fontSize: '0.85rem' }}
        >
          <RefreshCw size={15} className={refreshing ? 'spinner spinner-sm' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Top Stats: Wallet Balance & Idempotency Shield */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
        {/* Balance Card */}
        <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '-15px', right: '-15px', width: '100px', height: '100px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%)', pointerEvents: 'none' }} />
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Available Wallet Balance
            </span>
            <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-sm)', background: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#818cf8' }}>
              <Wallet size={16} />
            </div>
          </div>

          <div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '-0.03em', minHeight: '2.5rem', display: 'flex', alignItems: 'center' }}>
              {loadingWallet && !wallet ? (
                <Skeleton width="180px" height="2.25rem" />
              ) : (
                wallet?.formattedBalance || '₹0.00'
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
              <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>
                {wallet?.status || 'ACTIVE'}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Currency: <strong style={{ color: 'var(--text-secondary)' }}>{wallet?.currency || 'INR'}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Concurrency & Idempotency Spec Card */}
        <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Financial Safety Guarantees
            </span>
            <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-sm)', background: 'rgba(56, 189, 248, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38bdf8' }}>
              <ShieldCheck size={16} />
            </div>
          </div>

          <div style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
              <span style={{ color: '#10b981' }}>✓</span> <strong>Deterministic Locking:</strong> <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>ORDER BY id ASC</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
              <span style={{ color: '#10b981' }}>✓</span> <strong>Dual-Layer Idempotency:</strong> Redis Mutex + Postgres L2
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ color: '#10b981' }}>✓</span> <strong>Double-Entry Invariant:</strong> <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>Σ Debits = Σ Credits</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Send Money Form (Left) & Transaction Timeline (Right) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* Send Money Form Card */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', paddingBottom: '0.85rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <Send size={18} style={{ color: 'var(--primary)' }} />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Send Money Instantly
            </h2>
          </div>

          {/* Success Receipt Banner */}
          {lastReceipt && (
            <div style={{
              padding: '1rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              marginBottom: '1.25rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10b981', fontWeight: 700, marginBottom: '0.35rem' }}>
                <CheckCircle2 size={16} />
                <span>Transfer Successful!</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem 0' }}>
                Sent <strong>{lastReceipt.formattedAmount}</strong> to <strong>{lastReceipt.recipientName || 'Recipient'}</strong>.
              </p>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Ref: {lastReceipt.referenceId}
              </div>
            </div>
          )}

          {/* Error Alert */}
          {errorMsg && (
            <div style={{
              padding: '0.85rem 1rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(244, 63, 94, 0.1)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.6rem',
              marginBottom: '1.25rem',
              color: '#fda4af',
              fontSize: '0.825rem'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSendMoney} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
            {/* Recipient Selection */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                Select Recipient
              </label>

              {/* Recipient Search Filter */}
              {counterparties.length > 5 && (
                <div style={{ position: 'relative', marginBottom: '0.4rem' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filter by name or email..."
                    style={{
                      width: '100%',
                      padding: '0.45rem 0.5rem 0.45rem 2rem',
                      fontSize: '0.8rem',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)'
                    }}
                  />
                </div>
              )}

              {filteredCounterparties.length > 0 ? (
                <select
                  value={selectedRecipientId}
                  onChange={(e) => setSelectedRecipientId(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', cursor: 'pointer' }}
                  required
                >
                  {filteredCounterparties.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName} ({c.email})
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.5rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                  No active recipients found. Ensure other users have registered.
                </div>
              )}
            </div>

            {/* Amount in Rupees */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Transfer Amount (₹)
                </label>
                {rupeeAmount && !isNaN(parseFloat(rupeeAmount)) && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    = {(parseFloat(rupeeAmount) * 100).toFixed(0)} paise
                  </span>
                )}
              </div>

              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: 'var(--text-muted)' }}>
                  ₹
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={rupeeAmount}
                  onChange={(e) => setRupeeAmount(e.target.value)}
                  className="input-field"
                  style={{ paddingLeft: '1.85rem', width: '100%', fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
                  required
                />
              </div>

              {/* Quick Amount Chips */}
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                {['100', '500', '1000', '2500'].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setRupeeAmount(chip)}
                    className="btn-ghost"
                    style={{
                      padding: '0.2rem 0.6rem',
                      fontSize: '0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)'
                    }}
                  >
                    +₹{chip}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                Transfer Note / Description
              </label>
              <input
                type="text"
                placeholder="e.g. Dinner split, Rent, Freelance invoice"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="input-field"
                maxLength={255}
                style={{ width: '100%' }}
              />
            </div>

            {/* Idempotency Footer Info */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5rem 0.75rem',
              backgroundColor: 'rgba(99, 102, 241, 0.05)',
              border: '1px solid rgba(99, 102, 241, 0.15)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.725rem',
              color: '#a5b4fc'
            }}>
              <ShieldCheck size={14} style={{ flexShrink: 0 }} />
              <span>Network safe: Automatically protected with unique UUIDv4 Idempotency Key</span>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting || counterparties.length === 0}
              className="btn-primary"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.75rem',
                fontSize: '0.95rem',
                fontWeight: 700,
                marginTop: '0.5rem'
              }}
            >
              {submitting ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Processing Transfer...</span>
                </>
              ) : (
                <>
                  <Send size={16} />
                  <span>Send {rupeeAmount ? `₹${rupeeAmount}` : 'Money'}</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Transaction History Card */}
        <div className="card" style={{ padding: '1.5rem' }}>
          {/* Header & Filter Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem', paddingBottom: '0.85rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ReceiptText size={18} style={{ color: 'var(--text-secondary)' }} />
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Transaction History
              </h2>
              <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                {totalCount} Total
              </span>
            </div>

            {/* Direction Filter Tabs */}
            <div style={{ display: 'flex', gap: '0.25rem', backgroundColor: 'var(--bg-surface)', padding: '0.2rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
              {(['ALL', 'INCOMING', 'OUTGOING'] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => setDirectionFilter(dir)}
                  style={{
                    padding: '0.25rem 0.65rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: directionFilter === dir ? 'var(--primary)' : 'transparent',
                    color: directionFilter === dir ? 'white' : 'var(--text-muted)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {dir === 'ALL' ? 'All' : dir === 'INCOMING' ? 'Received' : 'Sent'}
                </button>
              ))}
            </div>
          </div>

          {/* Transactions List */}
          {loadingHistory ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {Array.from({ length: 4 }).map((_, idx) => (
                <div
                  key={`skel-tx-${idx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.85rem 1rem',
                    backgroundColor: 'var(--bg-surface)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                    <Skeleton width="34px" height="34px" borderRadius="var(--radius-sm)" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
                      <Skeleton width="45%" height="0.9rem" />
                      <Skeleton width="30%" height="0.75rem" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                    <Skeleton width="70px" height="1.1rem" />
                    <Skeleton width="50px" height="0.7rem" />
                  </div>
                </div>
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Sparkles size={32} style={{ margin: '0 auto 0.75rem auto', opacity: 0.3 }} />
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>No transactions found</p>
              <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                Initiate your first P2P money transfer using the form on the left!
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {transactions.map((tx) => {
                const isOut = tx.direction === 'OUTGOING';
                return (
                  <div
                    key={tx.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.85rem 1rem',
                      backgroundColor: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      transition: 'border-color 0.15s ease',
                      gap: '0.75rem'
                    }}
                  >
                    {/* Left: Direction Icon & Details */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
                      <div style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: isOut ? 'rgba(244, 63, 94, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isOut ? '#f43f5e' : '#10b981',
                        flexShrink: 0
                      }}>
                        {isOut ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {tx.counterpartyName}
                          </span>
                          <span className={`badge ${tx.status === 'COMPLETED' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.625rem', padding: '0.1rem 0.4rem' }}>
                            {tx.status}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <span>{tx.description}</span>
                          <span>•</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                            <Clock size={11} />
                            {new Date(tx.createdAt).toLocaleDateString('en-IN', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Amount & Reference ID */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{
                        fontSize: '1rem',
                        fontWeight: 800,
                        fontFamily: 'var(--font-mono)',
                        color: isOut ? '#f43f5e' : '#10b981'
                      }}>
                        {tx.formattedAmount}
                      </div>
                      <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '0.15rem' }}>
                        {tx.referenceId}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1.25rem', paddingTop: '0.85rem', borderTop: '1px solid var(--border-subtle)', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>
                Page {page} of {totalPages}
              </span>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => loadTransactions(page - 1)}
                  disabled={page <= 1}
                  className="btn-secondary"
                  style={{ padding: '0.35rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem' }}
                >
                  <ChevronLeft size={14} />
                  <span>Previous</span>
                </button>
                <button
                  type="button"
                  onClick={() => loadTransactions(page + 1)}
                  disabled={page >= totalPages}
                  className="btn-secondary"
                  style={{ padding: '0.35rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem' }}
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
