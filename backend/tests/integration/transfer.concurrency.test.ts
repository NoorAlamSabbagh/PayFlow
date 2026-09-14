import { getClient } from '../../src/database';
import { walletService } from '../../src/modules/wallet/wallet.service';
import { transferService } from '../../src/modules/transfer/transfer.service';
import { userRepository } from '../../src/modules/user/user.repository';
import bcrypt from 'bcryptjs';

describe('Phase 3 P2P Transfer, Concurrency & Idempotency Integration Tests', () => {
  jest.setTimeout(35000);

  let userAliceId: string;
  let userBobId: string;
  let userCharlieId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('TestPass123', 10);

    // Create Alice
    const userA = await userRepository.createUser({
      email: `alice_trf_${Date.now()}@payflow.internal`,
      passwordHash,
      fullName: 'Alice Walker',
      role: 'USER',
    });
    userAliceId = userA.id;

    // Create Bob
    const userB = await userRepository.createUser({
      email: `bob_trf_${Date.now()}@payflow.internal`,
      passwordHash,
      fullName: 'Bob Smith',
      role: 'USER',
    });
    userBobId = userB.id;

    // Create Charlie (Unauthorized third-party)
    const userC = await userRepository.createUser({
      email: `charlie_trf_${Date.now()}@payflow.internal`,
      passwordHash,
      fullName: 'Charlie Davis',
      role: 'USER',
    });
    userCharlieId = userC.id;

    // Provision wallets
    await walletService.getOrCreateUserWallet(userAliceId);
    await walletService.getOrCreateUserWallet(userBobId);
    await walletService.getOrCreateUserWallet(userCharlieId);
  }, 25000);

  afterAll(async () => {
    // Cleanup created users
    const client = await getClient();
    try {
      await client.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [
        userAliceId,
        userBobId,
        userCharlieId,
      ]);
    } catch {
      // Ignore test cleanup errors
    } finally {
      client.release();
    }
  });

  describe('1. Atomic P2P Money Transfer Execution', () => {
    it('should successfully execute transfer, update balances, write double-entry ledger & emit outbox event', async () => {
      // 1. Initial funding: Alice ₹1,000 (100,000 paise), Bob ₹500 (50,000 paise)
      await walletService.deposit(userAliceId, { amount: 100000, description: 'Alice Seed Funding' });
      await walletService.deposit(userBobId, { amount: 50000, description: 'Bob Seed Funding' });

      const aliceInitial = await walletService.getWalletByUserId(userAliceId);
      const bobInitial = await walletService.getWalletByUserId(userBobId);

      // 2. Transfer ₹300 (30,000 paise) from Alice to Bob
      const transferAmount = 30000;
      const idempotencyKey = `idemp-transfer-${Date.now()}`;

      const receipt = await transferService.executeTransfer(userAliceId, {
        recipientId: userBobId,
        amount: transferAmount,
        currency: 'INR',
        description: 'Dinner Split with Bob',
        idempotencyKey,
      });

      expect(receipt.status).toBe('COMPLETED');
      expect(receipt.amount).toBe(transferAmount);

      // 3. Verify Balances: Alice = ₹700, Bob = ₹800
      const aliceAfter = await walletService.getWalletByUserId(userAliceId);
      const bobAfter = await walletService.getWalletByUserId(userBobId);

      expect(aliceAfter.balance).toBe(aliceInitial.balance - transferAmount);
      expect(bobAfter.balance).toBe(bobInitial.balance + transferAmount);

      // 4. Verify Double-Entry Ledger entries in DB
      const client = await getClient();
      try {
        const { rows: ledgerRows } = await client.query(
          'SELECT wallet_id, entry_type, amount, balance_after FROM ledger_entries WHERE transaction_id = $1 ORDER BY entry_type ASC;',
          [receipt.transactionId]
        );

        expect(ledgerRows.length).toBe(2);

        const creditEntry = ledgerRows.find((r) => r.entry_type === 'CREDIT');
        const debitEntry = ledgerRows.find((r) => r.entry_type === 'DEBIT');

        expect(creditEntry).toBeDefined();
        expect(debitEntry).toBeDefined();
        expect(creditEntry.amount).toBe(transferAmount.toString());
        expect(debitEntry.amount).toBe(transferAmount.toString());

        // 5. Verify Transactional Outbox event created within same transaction
        const { rows: outboxRows } = await client.query(
          "SELECT aggregate_id, event_type, status FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'TRANSFER_COMPLETED';",
          [receipt.transactionId]
        );

        expect(outboxRows.length).toBe(1);
        expect(outboxRows[0].status).toBe('PENDING');
      } finally {
        client.release();
      }
    }, 20000);
  });

  describe('2. Balance Sufficiency Guard & Rollback', () => {
    it('should reject transfer when sender has insufficient balance without any mutations', async () => {
      const aliceWallet = await walletService.getWalletByUserId(userAliceId);
      const bobWallet = await walletService.getWalletByUserId(userBobId);

      const excessiveAmount = aliceWallet.balance + 500000; // Over budget by ₹5,000

      await expect(
        transferService.executeTransfer(userAliceId, {
          recipientId: userBobId,
          amount: excessiveAmount,
          currency: 'INR',
          description: 'Excessive Transfer',
          idempotencyKey: `idemp-fail-${Date.now()}`,
        })
      ).rejects.toThrow(/Insufficient wallet balance/i);

      // Verify zero balance mutation
      const aliceAfter = await walletService.getWalletByUserId(userAliceId);
      const bobAfter = await walletService.getWalletByUserId(userBobId);

      expect(aliceAfter.balance).toBe(aliceWallet.balance);
      expect(bobAfter.balance).toBe(bobWallet.balance);
    });
  });

  describe('3. Idempotency Replay & Parameter Tampering Guard', () => {
    it('should return cached transfer result on duplicate submission without double-debiting', async () => {
      const initialWallet = await walletService.getWalletByUserId(userAliceId);
      const idempotencyKey = `idemp-dup-${Date.now()}`;
      const amount = 5000; // ₹50

      // First execution
      const receipt1 = await transferService.executeTransfer(userAliceId, {
        recipientId: userBobId,
        amount,
        currency: 'INR',
        description: 'First idempotent run',
        idempotencyKey,
      });

      // Second duplicate execution with exact same key & payload
      const receipt2 = await transferService.executeTransfer(userAliceId, {
        recipientId: userBobId,
        amount,
        currency: 'INR',
        description: 'First idempotent run',
        idempotencyKey,
      });

      expect(receipt2.transactionId).toBe(receipt1.transactionId);
      expect(receipt2.referenceId).toBe(receipt1.referenceId);

      // Alice should only have been debited ONCE
      const finalWallet = await walletService.getWalletByUserId(userAliceId);
      expect(finalWallet.balance).toBe(initialWallet.balance - amount);
    });

    it('should reject duplicate idempotency key with modified amount with 409 Conflict', async () => {
      const idempotencyKey = `idemp-tamper-${Date.now()}`;

      // First run: ₹50
      await transferService.executeTransfer(userAliceId, {
        recipientId: userBobId,
        amount: 5000,
        currency: 'INR',
        description: 'Original amount',
        idempotencyKey,
      });

      // Tampered run: Attempting ₹100 on same key
      await expect(
        transferService.executeTransfer(userAliceId, {
          recipientId: userBobId,
          amount: 10000,
          currency: 'INR',
          description: 'Tampered amount',
          idempotencyKey,
        })
      ).rejects.toThrow(/Idempotency-Key has already been used with a different transfer payload/i);
    });
  });

  describe('4. High Concurrency Race Condition Safety', () => {
    it('should handle concurrent transfers safely and prevent balance from becoming negative', async () => {
      // Ensure Alice has exact balance of ₹1,000 (100,000 paise)
      const currentAlice = await walletService.getWalletByUserId(userAliceId);
      const targetBalance = 100000;
      if (currentAlice.balance < targetBalance) {
        await walletService.deposit(userAliceId, {
          amount: targetBalance - currentAlice.balance,
          description: 'Topup for race test',
        });
      }

      const balanceBefore = (await walletService.getWalletByUserId(userAliceId)).balance;

      // Two concurrent transfers: ₹800 (80,000 paise) and ₹700 (70,000 paise)
      // Total ₹1,500 > balance ₹1,000 -> ONLY ONE CAN SUCCEED
      const req1 = transferService.executeTransfer(userAliceId, {
        recipientId: userBobId,
        amount: 80000,
        currency: 'INR',
        description: 'Concurrent Transfer A',
        idempotencyKey: `idemp-conc-A-${Date.now()}`,
      });

      const req2 = transferService.executeTransfer(userAliceId, {
        recipientId: userBobId,
        amount: 70000,
        currency: 'INR',
        description: 'Concurrent Transfer B',
        idempotencyKey: `idemp-conc-B-${Date.now()}`,
      });

      const results = await Promise.allSettled([req1, req2]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly one succeeds, one rejected due to insufficient funds
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Final balance is strictly non-negative
      const balanceAfter = (await walletService.getWalletByUserId(userAliceId)).balance;
      expect(balanceAfter).toBeGreaterThanOrEqual(0);
      expect(balanceAfter).toBeLessThan(balanceBefore);
    }, 25000);
  });

  describe('5. Deadlock Prevention in Bi-Directional Transfers', () => {
    it('should execute simultaneous Alice->Bob and Bob->Alice transfers without 40P01 deadlock', async () => {
      // Ensure both have funds
      await walletService.deposit(userAliceId, { amount: 50000, description: 'Alice Deadlock Seed' });
      await walletService.deposit(userBobId, { amount: 50000, description: 'Bob Deadlock Seed' });

      // Alice sends ₹100 to Bob while Bob sends ₹100 to Alice concurrently
      const aliceToBob = transferService.executeTransfer(userAliceId, {
        recipientId: userBobId,
        amount: 10000,
        currency: 'INR',
        description: 'Alice to Bob Concurrent',
        idempotencyKey: `idemp-bi-1-${Date.now()}`,
      });

      const bobToAlice = transferService.executeTransfer(userBobId, {
        recipientId: userAliceId,
        amount: 10000,
        currency: 'INR',
        description: 'Bob to Alice Concurrent',
        idempotencyKey: `idemp-bi-2-${Date.now()}`,
      });

      // Both must complete without deadlock errors
      const results = await Promise.all([aliceToBob, bobToAlice]);
      expect(results[0].status).toBe('COMPLETED');
      expect(results[1].status).toBe('COMPLETED');
    }, 25000);
  });

  describe('6. Authorization Security Guard', () => {
    it('should block unauthorized users from querying other users transfers', async () => {
      // Create a transfer between Alice and Bob
      const receipt = await transferService.executeTransfer(userAliceId, {
        recipientId: userBobId,
        amount: 5000,
        currency: 'INR',
        description: 'Alice to Bob Secret Transfer',
        idempotencyKey: `idemp-sec-${Date.now()}`,
      });

      // Charlie (unauthorized) attempts to inspect it
      await expect(
        transferService.getTransferById(userCharlieId, receipt.transactionId)
      ).rejects.toThrow(/You are not authorized to view this transaction/i);
    });
  });
});
