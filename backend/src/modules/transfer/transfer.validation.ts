import { z } from 'zod';

export const transferBodySchema = z.object({
  recipientId: z
    .string({ required_error: 'Recipient ID is required' })
    .uuid('Recipient ID must be a valid UUID'),
  amount: z
    .number({ required_error: 'Amount is required' })
    .int('Amount must be a whole integer in paise')
    .positive('Amount must be strictly greater than 0 paise')
    .max(100000000, 'Amount exceeds maximum permitted limit (₹10,00,000)'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .default('INR')
    .refine((val) => val === 'INR', { message: 'Only INR currency is currently supported' }),
  description: z
    .string()
    .trim()
    .max(255, 'Description cannot exceed 255 characters')
    .optional()
    .default('P2P Transfer'),
});

export const transactionQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().min(1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 15))
    .pipe(z.number().int().min(1).max(100)),
  status: z
    .enum(['PENDING', 'COMPLETED', 'FAILED', 'REVERSED'])
    .optional(),
  direction: z
    .enum(['INCOMING', 'OUTGOING'])
    .optional(),
});
