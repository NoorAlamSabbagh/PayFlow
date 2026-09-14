import winston from 'winston';
import { config } from './index';

// Fields that must never be written to logs
const SENSITIVE_FIELDS = ['password', 'password_hash', 'token', 'refreshToken', 'accessToken', 'secret', 'authorization'];

function sanitizeObject(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.includes(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

const sanitizeFormat = winston.format((info) => {
  return sanitizeObject(info) as winston.Logform.TransformableInfo;
});

export const logger = winston.createLogger({
  level: config.env === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    sanitizeFormat(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'payflow-api' },
  transports: [
    new winston.transports.Console({
      format: config.env === 'production'
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
              const metaString = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
              return `[${timestamp}] [${level}] [${service}]: ${message}${metaString}`;
            })
          ),
    }),
  ],
});
