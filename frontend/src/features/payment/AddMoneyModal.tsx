import React, { useState, useEffect, useRef } from 'react';
import { paymentService } from './paymentService';
import { PaymentIntentData } from './paymentTypes';

interface AddMoneyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'AMOUNT_INPUT' | 'CHECKOUT' | 'VERIFYING' | 'SUCCESS' | 'FAILED';

export const AddMoneyModal: React.FC<AddMoneyModalProps> = ({ isOpen, onClose, onSuccess }) => {
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

  const handleCreateIntent = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedRupees = parseFloat(amountRupees);
    if (isNaN(parsedRupees) || parsedRupees <= 0) {
      setError('Please enter a valid deposit amount greater than ₹0.');
      return;
    }

    if (parsedRupees > 100000) {
      setError('Maximum deposit allowed per transaction is ₹1,00,000.');
      return;
    }

    // Convert INR rupees to integer paise (₹1 = 100 paise)
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
    } catch (err: any) {
      setError(
        err.response?.data?.message || 'Failed to initialize payment order. Please try again.'
      );
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
          onSuccess();
        } else if (latest.status === 'FAILED' || latest.status === 'CANCELLED') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setStep('FAILED');
        } else if (attempts >= maxAttempts) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setError('Payment confirmation is taking longer than expected. Please check your history.');
          setStep('CHECKOUT');
        }
      } catch (err) {
        // Polling retry
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

  const handleResetAndClose = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setStep('AMOUNT_INPUT');
    setAmountRupees('1000');
    setError(null);
    setIntent(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg overflow-hidden border shadow-2xl bg-surface-900 border-surface-700/80 rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-800 bg-surface-800/40">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-500 text-white shadow-lg shadow-brand-500/20">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Add Money to Wallet</h3>
              <p className="text-xs text-surface-400">External Gateway Ingestion & Double-Entry Clearing</p>
            </div>
          </div>
          <button
            onClick={handleResetAndClose}
            className="p-2 text-surface-400 hover:text-white rounded-lg hover:bg-surface-800 transition"
            title="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {error && (
            <div className="p-3.5 mb-5 text-sm text-red-300 border rounded-xl bg-red-950/40 border-red-800/60 flex items-start gap-2.5">
              <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Step 1: Amount Input */}
          {step === 'AMOUNT_INPUT' && (
            <form onSubmit={handleCreateIntent} className="space-y-5">
              <div>
                <label className="block mb-2 text-xs font-semibold uppercase tracking-wider text-surface-400">
                  Select or Enter Amount
                </label>
                <div className="relative">
                  <span className="absolute text-2xl font-bold -translate-y-1/2 left-4 top-1/2 text-surface-400">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="100000"
                    step="1"
                    value={amountRupees}
                    onChange={(e) => setAmountRupees(e.target.value)}
                    className="w-full py-3.5 pl-10 pr-4 text-2xl font-bold text-white transition border bg-surface-950/60 border-surface-700 rounded-xl focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    placeholder="0"
                    required
                  />
                </div>
                <p className="mt-1.5 text-xs text-surface-400 flex items-center justify-between">
                  <span>Standard integer representation:</span>
                  <span className="font-mono text-brand-400 font-semibold">
                    {Math.round((parseFloat(amountRupees) || 0) * 100).toLocaleString()} paise
                  </span>
                </p>
              </div>

              {/* Quick Select Buttons */}
              <div className="grid grid-cols-4 gap-2">
                {quickAmounts.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setAmountRupees(amt.toString())}
                    className={`py-2 text-xs font-medium rounded-lg border transition ${amountRupees === amt.toString()
                      ? 'bg-brand-600/30 border-brand-500 text-brand-300 font-semibold'
                      : 'bg-surface-800/60 border-surface-700 text-surface-300 hover:bg-surface-700/60'
                      }`}
                  >
                    +₹{amt.toLocaleString()}
                  </button>
                ))}
              </div>

              {/* Architecture Info Callout */}
              <div className="p-3.5 border rounded-xl bg-surface-800/30 border-surface-700/50 text-xs text-surface-300 space-y-1.5">
                <div className="flex items-center gap-2 text-brand-400 font-semibold">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Dual-Layer Idempotency Protected</span>
                </div>
                <p className="text-surface-400 text-[11px] leading-relaxed">
                  Initiating an order generates a cryptographically random <code className="text-surface-200">Idempotency-Key</code>. Funds are never credited until the server verifies the external HMAC-SHA256 webhook signature.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 font-semibold text-white transition rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 shadow-lg shadow-brand-600/30 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                    </svg>
                    <span>Creating Payment Intent...</span>
                  </>
                ) : (
                  <span>Continue to Payment (₹{parseFloat(amountRupees) || 0})</span>
                )}
              </button>
            </form>
          )}

          {/* Step 2: Checkout Simulation View */}
          {step === 'CHECKOUT' && intent && (
            <div className="space-y-5 animate-fadeIn">
              <div className="p-4 border rounded-xl bg-surface-950/70 border-surface-700/80 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-surface-800">
                  <span className="text-xs text-surface-400">Payment Order ID:</span>
                  <span className="font-mono text-xs font-semibold text-brand-400">{intent.gatewayOrderId}</span>
                </div>
                <div className="flex items-center justify-between pb-2 border-b border-surface-800">
                  <span className="text-xs text-surface-400">PayFlow Intent ID:</span>
                  <span className="font-mono text-xs text-surface-300">{intent.id.slice(0, 18)}...</span>
                </div>
                <div className="flex items-center justify-between pb-2 border-b border-surface-800">
                  <span className="text-xs text-surface-400">Amount Due:</span>
                  <span className="text-lg font-bold text-white">₹{(intent.amount / 100).toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-surface-400">Gateway Status:</span>
                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold text-amber-300 bg-amber-950/60 border border-amber-700/60 rounded-md">
                    {intent.status} (Wallet Unchanged)
                  </span>
                </div>
              </div>

              <div className="p-3 text-xs text-surface-400 border border-surface-800 rounded-xl bg-surface-800/30">
                <span className="font-semibold text-surface-200">Authoritative Rule:</span> Client callbacks cannot confirm payment. Clicking below simulates the external gateway sending an authoritative HMAC-SHA256 signed webhook directly to <code className="text-surface-300">/api/v1/webhooks/payment-gateway</code>.
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleSimulatePayment(false)}
                  disabled={loading}
                  className="py-3 px-4 font-semibold text-white transition rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-lg shadow-emerald-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Pay & Authorize</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulatePayment(true)}
                  disabled={loading}
                  className="py-3 px-4 font-medium text-red-300 transition rounded-xl bg-red-950/50 border border-red-800/60 hover:bg-red-900/50 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>Simulate Decline</span>
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Verifying State (Authoritative Server Polling) */}
          {step === 'VERIFYING' && (
            <div className="py-8 text-center space-y-5 animate-fadeIn">
              <div className="relative inline-flex items-center justify-center w-20 h-20">
                <div className="absolute inset-0 rounded-full bg-brand-500/20 animate-ping"></div>
                <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-surface-950 border border-brand-500/40 text-brand-400">
                  <svg className="w-8 h-8 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                  </svg>
                </div>
              </div>
              <div className="space-y-1">
                <h4 className="text-lg font-bold text-white">Payment Verification in Progress</h4>
                <p className="text-xs text-surface-400 max-w-sm mx-auto">
                  Awaiting authoritative server confirmation from the payment gateway webhook...
                </p>
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 text-xs text-brand-300 bg-brand-950/50 border border-brand-800/60 rounded-full font-mono">
                <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse"></span>
                <span>Polling GET /payments/{intent?.id.slice(0, 8)}...</span>
              </div>
            </div>
          )}

          {/* Step 4: Authoritative Success Receipt */}
          {step === 'SUCCESS' && intent && (
            <div className="py-4 text-center space-y-5 animate-fadeIn">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 shadow-xl shadow-emerald-500/20">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="space-y-1">
                <h4 className="text-xl font-bold text-white">Funds Added Successfully</h4>
                <p className="text-xs text-emerald-400 font-medium">Authoritative Double-Entry Ledger Settled</p>
              </div>

              <div className="p-4 text-left border rounded-xl bg-surface-950/70 border-surface-700/80 space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-surface-800">
                  <span className="text-surface-400">Credited Amount:</span>
                  <span className="font-bold text-emerald-400 text-sm">₹{(intent.amount / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-surface-800">
                  <span className="text-surface-400">Payment Intent:</span>
                  <span className="font-mono text-surface-300">{intent.id.slice(0, 16)}...</span>
                </div>
                <div className="flex justify-between py-1 border-b border-surface-800">
                  <span className="text-surface-400">Gateway Order:</span>
                  <span className="font-mono text-surface-300">{intent.gatewayOrderId}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-surface-400">Accounting Record:</span>
                  <span className="text-emerald-400 font-mono font-medium">DEBIT CLEARING / CREDIT WALLET</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleResetAndClose}
                className="w-full py-3 font-semibold text-white transition rounded-xl bg-surface-800 hover:bg-surface-700 border border-surface-700"
              >
                Done
              </button>
            </div>
          )}

          {/* Step 5: Failed Receipt */}
          {step === 'FAILED' && (
            <div className="py-4 text-center space-y-5 animate-fadeIn">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/20 border border-red-500/40 text-red-400 shadow-xl shadow-red-500/20">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div className="space-y-1">
                <h4 className="text-xl font-bold text-white">Payment Failed</h4>
                <p className="text-xs text-red-400 font-medium">
                  {intent?.errorMessage || 'The payment could not be authorized by the processor.'}
                </p>
              </div>
              <p className="text-xs text-surface-400 max-w-sm mx-auto">
                No money was deducted from your wallet. Double-entry ledger remains completely unchanged.
              </p>

              <button
                type="button"
                onClick={() => setStep('AMOUNT_INPUT')}
                className="w-full py-3 font-semibold text-white transition rounded-xl bg-surface-800 hover:bg-surface-700 border border-surface-700"
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