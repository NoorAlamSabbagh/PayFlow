import { getClient } from '../../src/database';
import { walletService } from '../../src/modules/wallet/wallet.service';
import { userRepository } from '../../src/modules/user/user.repository';
import bcrypt from 'bcryptjs';

describe('Phase 2 Financial & Concurrency Integration Tests', () => {
  let testUserId: string;

  beforeAll(async () => {
    // Create dedicated integration test user
    const testEmail = `fintech_test_${Date.now()}@payflow.internal`;
    const passwordHash = await bcrypt.hash('TestPass123', 10);
    const user = await userRepository.createUser({
      email: testEmail,
      passwordHash,
      fullName: 'Concurrency Test User',
      role: 'USER',
    });
    testUserId = user.id;

    // Ensure wallet is provisioned
    await walletService.getOrCreateUserWallet(testUserId);
  });

  afterAll(async () => {
    // Clean up test user & related transactions
    if (testUserId) {
      try {
        const client = await getClient();
        try {
          await client.query('DELETE FROM users WHERE id = $1', [testUserId]);
        } finally {
          client.release();
        }
      } catch {
        // Ignore test cleanup errors
      }
    }
  });

  describe('Ledger Immutability Trigger Enforcement', () => {
    it('should strictly reject UPDATE operations on ledger_entries via PostgreSQL trigger', async () => {
      // Create at least one ledger entry via deposit so a row exists
      await walletService.deposit(testUserId, {
        amount: 5000, // ₹50
        description: 'Immutability Test Deposit',
      });

      const client = await getClient();
      try {
        await expect(
          client.query("UPDATE ledger_entries SET description = 'Tampered'")
        ).rejects.toThrow(/immutable table/i);
      } finally {
        client.release();
      }
    });

    it('should strictly reject DELETE operations on ledger_entries via PostgreSQL trigger', async () => {
      const client = await getClient();
      try {
        await expect(
          client.query('DELETE FROM ledger_entries')
        ).rejects.toThrow(/immutable table/i);
      } finally {
        client.release();
      }
    });
  });

  describe('Concurrent Financial Deposits Under Row-Level Locking', () => {
    it('should process concurrent deposits without lost updates or race conditions', async () => {
      const depositCount = 3;
      const amountPerDeposit = 10000; // ₹100.00 each

      // Fetch initial balance
      const initialWallet = await walletService.getWalletByUserId(testUserId);
      const initialBalance = initialWallet.balance;

      // Dispatch concurrent deposits simultaneously
      const depositPromises = Array.from({ length: depositCount }).map((_, idx) =>
        walletService.deposit(testUserId, {
          amount: amountPerDeposit,
          description: `Concurrent Test Deposit #${idx + 1}`,
        })
      );

      const results = await Promise.all(depositPromises);

      // Verify each succeeded
      for (const res of results) {
        expect(res.status).toBe('COMPLETED');
      }

      // Verify final balance exactly equals initial + (depositCount * amountPerDeposit)
      const finalWallet = await walletService.getWalletByUserId(testUserId);
      const expectedBalance = initialBalance + depositCount * amountPerDeposit;

      expect(finalWallet.balance).toBe(expectedBalance);
    }, 20000);
  });
});