import { Request, Response, NextFunction } from 'express';
import { transferService, TransferService } from './transfer.service';
import { sendSuccess } from '../../utils/response';
import { BadRequestError } from '../../utils/errors';

export class TransferController {
  constructor(private transferServ: TransferService = transferService) {}

  /**
   * Initiate atomic P2P money transfer
   * POST /api/v1/transfers
   */
  createTransfer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const senderUserId = req.user!.userId;
      const idempotencyKey = req.headers['idempotency-key'] as string;

      if (!idempotencyKey) {
        throw new BadRequestError('Idempotency-Key header is required for transfers', 'MISSING_IDEMPOTENCY_KEY');
      }

      const receipt = await this.transferServ.executeTransfer(senderUserId, {
        recipientId: req.body.recipientId,
        amount: req.body.amount,
        currency: req.body.currency,
        description: req.body.description,
        idempotencyKey,
      });

      sendSuccess(res, receipt, 'P2P Transfer completed successfully', 200);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Fetch authenticated user's paginated transactions
   * GET /api/v1/transactions
   */
  getTransactions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 15;
      const status = req.query.status as string | undefined;
      const direction = req.query.direction as 'INCOMING' | 'OUTGOING' | undefined;

      const result = await this.transferServ.getTransactionHistory(userId, {
        page,
        limit,
        status,
        direction,
      });

      sendSuccess(res, result, 'Transaction history fetched successfully', 200);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Fetch single transfer detail
   * GET /api/v1/transfers/:id
   */
  getTransferDetail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const transactionId = req.params.id;

      const detail = await this.transferServ.getTransferById(userId, transactionId);
      sendSuccess(res, detail, 'Transfer detail retrieved successfully', 200);
    } catch (error) {
      next(error);
    }
  };
}

export const transferController = new TransferController();
