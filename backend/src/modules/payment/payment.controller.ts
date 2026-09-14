import { Request, Response, NextFunction } from 'express';
import { paymentService, PaymentService } from './payment.service';
import {
  createPaymentIntentSchema,
  listPaymentsQuerySchema,
} from './payment.validation';
import { sendSuccess } from '../../utils/response';
import { BadRequestError } from '../../utils/errors';

export class PaymentController {
  constructor(private paymentServ: PaymentService = paymentService) {}

  createIntent = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const idempotencyKey = req.headers['idempotency-key'] as string;
      if (!idempotencyKey) {
        throw new BadRequestError(
          'Idempotency-Key header is required',
          'MISSING_IDEMPOTENCY_KEY'
        );
      }

      const validated = createPaymentIntentSchema.parse(req.body);
      const userId = (req as any).user.id;

      const result = await this.paymentServ.createPaymentIntent({
        userId,
        amount: validated.amount,
        currency: validated.currency,
        idempotencyKey,
        provider: validated.provider,
      });

      sendSuccess(res, result, 'Payment intent created successfully', 201);
    } catch (err) {
      next(err);
    }
  };

  getIntent = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { paymentIntentId } = req.params;
      const user = (req as any).user;

      const result = await this.paymentServ.getPaymentIntent(
        user.id,
        paymentIntentId,
        user.role
      );

      sendSuccess(res, result, 'Payment intent retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  listMyPayments = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const query = listPaymentsQuerySchema.parse(req.query);
      const userId = (req as any).user.id;

      const result = await this.paymentServ.listUserPayments(userId, query);
      sendSuccess(res, result, 'User payment history retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  listAdminPayments = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const query = listPaymentsQuerySchema.parse(req.query);
      const result = await this.paymentServ.listAdminPayments(query);
      sendSuccess(res, result, 'Admin payment records retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  reconcilePayment = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await this.paymentServ.reconcilePayment(id);
      sendSuccess(res, result, 'Payment reconciliation completed');
    } catch (err) {
      next(err);
    }
  };
}

export const paymentController = new PaymentController();
