import { Request, Response, NextFunction } from 'express';
import { webhookService, WebhookService } from './webhook.service';
import { sendSuccess } from '../../utils/response';

export class WebhookController {
  constructor(private webhookServ: WebhookService = webhookService) {}

  handleGatewayWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // Use rawBody buffer preserved by express.json verify callback
      const rawBody: Buffer | string =
        (req as any).rawBody ||
        (Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)));

      const result = await this.webhookServ.processWebhook(rawBody, req.headers);
      sendSuccess(res, result, 'Webhook event acknowledged and processed');
    } catch (err) {
      next(err);
    }
  };
}

export const webhookController = new WebhookController();
