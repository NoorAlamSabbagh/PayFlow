import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { logger } from './config/logger';
import { errorHandler } from './middleware/errorHandler';
import { NotFoundError } from './utils/errors';
import { sendSuccess } from './utils/response';
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/user/user.routes';
import walletRoutes from './modules/wallet/wallet.routes';
import transferRoutes from './modules/transfer/transfer.routes';
import transactionRoutes from './modules/transfer/transaction.routes';
import paymentRoutes from './modules/payment/payment.routes';
import webhookRoutes from './modules/webhook/webhook.routes';
import swaggerDocument from './docs/swagger.json';

export function createApp(): Express {
  const app = express();

  // 1. Security Headers
  app.use(helmet());

  // 2. CORS configuration with credentials enabled for HttpOnly cookies
  app.use(
    cors({
      origin: config.clientUrl,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Requested-With'],
    })
  );

  // 3. Body and Cookie Parsers (Preserve rawBuffer for Webhook signature verification)
  app.use(
    express.json({
      limit: '1mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // 4. Request Logging Middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    next();
  });

  // 5. Interactive Swagger Documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

  // 6. System Health Check Endpoint
  app.get('/health', (_req: Request, res: Response) => {
    sendSuccess(
      res,
      {
        status: 'UP',
        timestamp: new Date().toISOString(),
        service: 'payflow-core-api',
        environment: config.env,
      },
      'Service is healthy'
    );
  });

  // 7. Mount Domain API Modules
  app.use(`${config.apiPrefix}/auth`, authRoutes);
  app.use(`${config.apiPrefix}/users`, userRoutes);
  app.use(`${config.apiPrefix}/wallets`, walletRoutes);
  app.use(`${config.apiPrefix}/transfers`, transferRoutes);
  app.use(`${config.apiPrefix}/transactions`, transactionRoutes);
  app.use(`${config.apiPrefix}/payments`, paymentRoutes);
  app.use(`${config.apiPrefix}/webhooks`, webhookRoutes);

  // 8. 404 Route Not Found Handler
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} does not exist`));
  });

  // 9. Centralized Error Handler Middleware (MUST be registered last)
  app.use(errorHandler);

  return app;
}
