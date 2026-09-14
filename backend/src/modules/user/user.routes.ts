import { Router } from 'express';
import { userController } from './user.controller';
import { requireAuth } from '../../middleware/authMiddleware';
import { requireRole } from '../../middleware/rbacMiddleware';

const router = Router();

// Authenticated user profile
router.get('/me', requireAuth, userController.getMe);

// List active counterparties for transfer recipient selection
router.get('/counterparties', requireAuth, userController.getCounterparties);

// Admin-only protected route for verifying RBAC enforcement
router.get('/', requireAuth, requireRole('ADMIN'), userController.getAllUsers);

export default router;
