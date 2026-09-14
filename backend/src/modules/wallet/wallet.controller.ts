import { Request, Response, NextFunction } from 'express';
import { walletService, WalletService } from './wallet.service';
import { sendSuccess } from '../../utils/response';
import { UnauthorizedError } from '../../utils/errors';

export class WalletController {
  constructor(private walletServ: WalletService = walletService) {}

  /**
   * GET /api/v1/wallets/me
   */
  getMyWallet = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.userId) {
        throw new UnauthorizedError('Authentication required');
      }
      const wallet = await this.walletServ.getWalletByUserId(req.user.userId);
      sendSuccess(res, wallet, 'Wallet retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/wallets/me/deposit
   */
  deposit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.userId) {
        throw new UnauthorizedError('Authentication required');
      }
      const result = await this.walletServ.deposit(req.user.userId, req.body);
      sendSuccess(res, result, 'Demo deposit completed successfully');
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/wallets/me/ledger
   */
  getMyLedger = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.userId) {
        throw new UnauthorizedError('Authentication required');
      }
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const ledger = await this.walletServ.getUserLedger(req.user.userId, page, limit);
      sendSuccess(res, ledger, 'Ledger history retrieved successfully');
    } catch (error) {
      next(error);
    }
  };
}

export const walletController = new WalletController();
