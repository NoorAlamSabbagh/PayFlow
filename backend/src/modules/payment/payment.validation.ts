import { z } from 'zod';

export const createPaymentIntentSchema = z.object({
  amount: z
    .number({
      required_error: 'Amount is required',
      invalid_type_error: 'Amount must be an integer number of paise',
    })
    .int('Amount must be an integer (in paise/cents), floating-point money is strictly forbidden')
    .positive('Amount must be greater than zero')
    .min(100, 'Minimum top-up amount is 100 paise (₹1.00)')
    .max(10000000, 'Maximum top-up amount is 10,000,000 paise (₹100,000.00) per transaction'),
  currency: z
    .string()
    .length(3, 'Currency must be a 3-letter ISO code')
    .toUpperCase()
    .default('INR'),
  provider: z.string().optional(),
});

export const listPaymentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum(['CREATED', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'])
    .optional(),
});
