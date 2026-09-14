import React, { useState, useEffect, useRef } from 'react';
import { paymentService } from './paymentService';
import { walletService } from '../wallet/walletService';
import { PaymentIntentData } from './paymentTypes';
import { useToast } from '../../components/ToastContext';
import {
  X,
  CreditCard,
  Zap,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Lock,
} from 'lucide-react';

interface AddMoneyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type DepositMode = 'GATEWAY' | 'INSTANT';
type Step = 'AMOUNT_INPUT' | 'CHECKOUT' | 'VERIFYING' | 'SUCCESS' | 'FAILED';

export const AddMoneyModal: React.FC<AddMoneyModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { toast } = useToast();
  const [mode, setMode] = useState<DepositMode>('GATEWAY');
  const [step, setStep] = useState<Step>('AMOUNT_INPUT');
  const [amountRupees, setAmountRupees] = useState<string>('1000');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<PaymentIntentData | null>(null);
  const pollingRef = useRef<number | null>(null);

  // Clean up polling interval on unmount or close
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const quickAmounts = [500, 1000, 2500, 5000];

  const handleResetAndClose = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setStep('AMOUNT_INPUT');
    setAmountRupees('1000');
    setError(null);
    setIntent(null);
    onClose();
  };

  // 1. Instant Demo Deposit Primitive (Phase 2)
  const handleInstantDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedRupees = parseFloat(amountRupees);
    if (isNaN(parsedRupees) || parsedRupees <= 0) {
      const msg = 'Please enter a valid deposit amount greater than ₹0.';
      setError(msg);
      toast.warning(msg, 'Invalid Amount');
      return;
    }

    const amountPaise = Math.round(parsedRupees * 100);
    setLoading(true);

    try {
      const res = await walletService.deposit({
        amount: amountPaise,
        description: `Direct Demo Deposit ₹${parsedRupees.toLocaleString('en-IN')}`,
      });

      toast.success(
        `Added ${res.formattedAmount} to your wallet! Balanced ledger entries recorded.`,
        'Deposit Complete'
      );
      onSuccess();
      handleResetAndClose();
    } catch (err: any) {
      const errMsg = err.response?.data?.message || 'Failed to complete deposit.';
      setError(errMsg);
      toast.error(errMsg, 'Deposit Failed');
    } finally {
      setLoading(false);
    }
  };

  // 2. Gateway Payment Intent Flow (Phase 4)
  const handleCreateIntent = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedRupees = parseFloat(amountRupees);
    if (isNaN(parsedRupees) || parsedRupees <= 0) {
      const msg = 'Please enter a valid deposit amount greater than ₹0.';
      setError(msg);
      toast.warning(msg, 'Invalid Amount');
      return;
    }

    if (parsedRupees > 100000) {
      const msg = 'Maximum deposit allowed per transaction is ₹1,00,000.';
      setError(msg);
      toast.warning(msg, 'Amount Exceeds Limit');
      return;
    }

    const amountPaise = Math.round(parsedRupees * 100);
    const idempotencyKey = crypto.randomUUID();

    setLoading(true);
    try {
      const createdIntent = await paymentService.createIntent(
        amountPaise,
        idempotencyKey,
        'MOCK_GATEWAY'
      );
      setIntent(createdIntent);
      setStep('CHECKOUT');
      toast.info(`Payment order initialized for ₹${parsedRupees.toLocaleString('en-IN')}`, 'Gateway Session Ready');
    } catch (err: any) {
      const errMsg = err.response?.data?.message || 'Failed to initialize payment order. Please try again.';
      setError(errMsg);
      toast.error(errMsg, 'Checkout Initialization Failed');
    } finally {
      setLoading(false);
    }
  };

  const startAuthoritativePolling = (intentId: string) => {
    setStep('VERIFYING');

    let attempts = 0;
    const maxAttempts = 20; // 30 seconds max (20 * 1500ms)

    pollingRef.current = (setInterval(async () => {
      attempts++;
      try {
        const latest = await paymentService.getIntentStatus(intentId);
        setIntent(latest);

        if (latest.status === 'SUCCESS') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setStep('SUCCESS');
          toast.success(
            `₹${(latest.amount / 100).toLocaleString('en-IN')} deposited to your wallet via verified webhook!`,
            'Payment Settled'
          );
          onSuccess();
        } else if (latest.status === 'FAILED' || latest.status === 'CANCELLED') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setStep('FAILED');
          toast.error('Payment was declined or cancelled by the payment gateway', 'Deposit Failed');
        } else if (attempts >= maxAttempts) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          const timeoutMsg = 'Payment confirmation is taking longer than expected. Please check your history.';
          setError(timeoutMsg);
          toast.warning(timeoutMsg, 'Polling Timeout');
          setStep('CHECKOUT');
        }
      } catch (err) {
        // Retry polling silently
      }
    }, 1500) as unknown as number);
  };

  const handleSimulatePayment = async (shouldFail = false) => {
    if (!intent) return;
    setLoading(true);
    setError(null);

    try {
      // Trigger verified webhook out-of-band with HMAC-SHA256 signature
      await paymentService.triggerMockWebhook({
        orderId: intent.gatewayOrderId,
        amountPaise: intent.amount,
        eventType: shouldFail ? 'PAYMENT_FAILED' : 'PAYMENT_SUCCESS',
        failureReason: shouldFail ? 'Card declined by issuing bank (Simulation)' : undefined,
      });

      // Begin polling backend for authoritative confirmation
      startAuthoritativePolling(intent.id);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to simulate payment callback.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-popover)',
          width: '100%',
          maxWidth: '520px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'fadeIn 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-surface-elevated)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, var(--primary) 0%, #4338ca 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
              }}
            >
              <CreditCard size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Add Funds to Wallet
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Backed by Double-Entry Ledger Clearing
              </p>
            </div>
          </div>

          <button
            onClick={handleResetAndClose}
            className="toast-close-btn"
            style={{ width: '32px', height: '32px' }}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Deposit Method Tabs */}
        {step === 'AMOUNT_INPUT' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              padding: '0.75rem 1.5rem 0 1.5rem',
              gap: '0.5rem',
            }}
          >
            <button
              type="button"
              onClick={() => setMode('GATEWAY')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                padding: '0.65rem 0.5rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid',
                borderColor: mode === 'GATEWAY' ? 'var(--primary)' : 'var(--border-subtle)',
                backgroundColor: mode === 'GATEWAY' ? 'var(--primary-subtle)' : 'transparent',
                color: mode === 'GATEWAY' ? 'var(--primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <ShieldCheck size={15} />
              <span>Gateway (Phase 4)</span>
            </button>

            <button
              type="button"
              onClick={() => setMode('INSTANT')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                padding: '0.65rem 0.5rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid',
                borderColor: mode === 'INSTANT' ? 'var(--success)' : 'var(--border-subtle)',
                backgroundColor: mode === 'INSTANT' ? 'var(--success-subtle)' : 'transparent',
                color: mode === 'INSTANT' ? 'var(--success)' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <Zap size={15} />
              <span>Instant Top-up (Phase 2)</span>
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {error && (
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--danger-subtle)',
                border: '1px solid var(--danger-border)',
                color: '#fda4af',
                fontSize: '0.825rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* STEP 1: AMOUNT INPUT */}
          {step === 'AMOUNT_INPUT' && (
            <form onSubmit={mode === 'GATEWAY' ? handleCreateIntent : handleInstantDeposit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                  Deposit Amount (₹ INR)
                </label>
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: '14px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '1.25rem',
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                    }}
                  >
                    ₹
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="100000"
                    step="1"
                    value={amountRupees}
                    onChange={(e) => setAmountRupees(e.target.value)}
                    className="input-field"
                    style={{
                      paddingLeft: '2.25rem',
                      width: '100%',
                      fontSize: '1.5rem',
                      fontWeight: 800,
                      fontFamily: 'var(--font-mono)',
                    }}
                    placeholder="1000"
                    required
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <span>Stored as integer paise:</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: '#818cf8', fontWeight: 600 }}>
                    {Math.round((parseFloat(amountRupees) || 0) * 100).toLocaleString('en-IN')} paise
                  </span>
                </div>
              </div>

              {/* Quick Amount Chips */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                {quickAmounts.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setAmountRupees(amt.toString())}
                    style={{
                      padding: '0.5rem',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid',
                      borderColor: amountRupees === amt.toString() ? 'var(--primary)' : 'var(--border-subtle)',
                      backgroundColor: amountRupees === amt.toString() ? 'var(--primary-subtle)' : 'var(--bg-input)',
                      color: amountRupees === amt.toString() ? '#c7d2fe' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    +₹{amt.toLocaleString('en-IN')}
                  </button>
                ))}
              </div>

              {/* Mode Specific Architecture Notes */}
              <div
                style={{
                  padding: '0.85rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.775rem',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, color: mode === 'GATEWAY' ? 'var(--primary)' : 'var(--success)' }}>
                  {mode === 'GATEWAY' ? <ShieldCheck size={15} /> : <Zap size={15} />}
                  <span>{mode === 'GATEWAY' ? 'Phase 4 HMAC-SHA256 Webhook Settlement' : 'Phase 2 Double-Entry ACID Deposit'}</span>
                </div>
                <p style={{ fontSize: '0.725rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {mode === 'GATEWAY'
                    ? 'Creates an external Payment Intent. The server will only credit your wallet and write ledger entries when the cryptographic HMAC-SHA256 webhook arrives.'
                    : 'Directly executes the double-entry transaction: DEBIT SYSTEM_GATEWAY_CLEARING, CREDIT USER_WALLET inside an atomic PostgreSQL transaction.'}
                </p>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className={mode === 'GATEWAY' ? 'btn btn-primary' : 'btn btn-success'}
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                }}
              >
                {loading ? (
                  <>
                    <div className="spinner spinner-sm"></div>
                    <span>Processing...</span>
                  </>
                ) : mode === 'GATEWAY' ? (
                  <>
                    <span>Proceed to Gateway Checkout</span>
                    <ArrowRight size={17} />
                  </>
                ) : (
                  <>
                    <span>Credit ₹{parseFloat(amountRupees) || 0} Instantly</span>
                    <Zap size={17} />
                  </>
                )}
              </button>
            </form>
          )}

          {/* STEP 2: CHECKOUT SIMULATION (PHASE 4) */}
          {step === 'CHECKOUT' && intent && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div
                style={{
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-medium)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                  fontSize: '0.825rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Gateway Order ID:</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#818cf8' }}>{intent.gatewayOrderId}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>PayFlow Intent ID:</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{intent.id.substring(0, 16)}...</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Amount Payable:</span>
                  <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'white' }}>₹{(intent.amount / 100).toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Gateway Status:</span>
                  <span className="badge badge-warning" style={{ gap: '0.25rem' }}>
                    <Lock size={12} /> {intent.status} (Wallet Uncredited)
                  </span>
                </div>
              </div>

              <div
                style={{
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(99, 102, 241, 0.05)',
                  border: '1px solid rgba(99, 102, 241, 0.15)',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.4,
                }}
              >
                <strong style={{ color: '#c7d2fe' }}>Authoritative Security Rule:</strong> The browser never confirms payment. Clicking below simulates the payment gateway firing an HMAC-SHA256 signed webhook directly to the backend.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => handleSimulatePayment(false)}
                  disabled={loading}
                  className="btn btn-primary"
                  style={{
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <CheckCircle2 size={16} />
                  <span>Authorize & Pay</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSimulatePayment(true)}
                  disabled={loading}
                  className="btn btn-secondary"
                  style={{
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    color: '#fda4af',
                    borderColor: 'rgba(244, 63, 94, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <X size={16} />
                  <span>Simulate Decline</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: VERIFYING STATE */}
          {step === 'VERIFYING' && (
            <div style={{ padding: '2rem 1rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  border: '2px solid rgba(99, 102, 241, 0.3)',
                  borderTopColor: 'var(--primary)',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <div>
                <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Awaiting Webhook Confirmation
                </h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem', maxWidth: '340px' }}>
                  Authoritative webhook received. Polling settlement state from PostgreSQL double-entry engine...
                </p>
              </div>
              <span
                style={{
                  fontSize: '0.725rem',
                  color: 'var(--primary)',
                  fontFamily: 'var(--font-mono)',
                  backgroundColor: 'var(--primary-subtle)',
                  padding: '0.25rem 0.65rem',
                  borderRadius: '100px',
                  border: '1px solid var(--primary-border)',
                }}
              >
                Polling /payments/{intent?.id.substring(0, 8)}...
              </span>
            </div>
          )}

          {/* STEP 4: SUCCESS RECEIPT */}
          {step === 'SUCCESS' && intent && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center', alignItems: 'center' }}>
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--success-subtle)',
                  border: '1px solid var(--success-border)',
                  color: 'var(--success)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CheckCircle2 size={28} />
              </div>

              <div>
                <h4 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Funds Credited Successfully!
                </h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--success)', marginTop: '0.2rem', fontWeight: 600 }}>
                  Double-Entry Ledger Audit Record Created
                </p>
              </div>

              <div
                style={{
                  width: '100%',
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  fontSize: '0.8rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Credited Amount:</span>
                  <span style={{ fontWeight: 800, color: '#34d399', fontSize: '0.95rem' }}>₹{(intent.amount / 100).toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Gateway Order:</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{intent.gatewayOrderId}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Ledger Invariant:</span>
                  <span style={{ color: '#34d399', fontFamily: 'var(--font-mono)', fontSize: '0.725rem' }}>
                    DEBIT CLEARING / CREDIT WALLET
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleResetAndClose}
                className="btn btn-primary"
                style={{ width: '100%', padding: '0.75rem' }}
              >
                Done
              </button>
            </div>
          )}

          {/* STEP 5: FAILED STATE */}
          {step === 'FAILED' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center', alignItems: 'center' }}>
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--danger-subtle)',
                  border: '1px solid var(--danger-border)',
                  color: 'var(--danger)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AlertTriangle size={28} />
              </div>

              <div>
                <h4 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Payment Authorization Declined
                </h4>
                <p style={{ fontSize: '0.8rem', color: '#fda4af', marginTop: '0.2rem' }}>
                  Simulated bank refusal. Wallet balance and ledger remain completely untouched.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setStep('AMOUNT_INPUT')}
                className="btn btn-secondary"
                style={{ width: '100%', padding: '0.75rem' }}
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddMoneyModal;