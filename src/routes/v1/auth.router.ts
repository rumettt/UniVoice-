import { Router } from 'express';
import {
  login,
  refresh,
  logout,
  me,
} from '../../controllers/auth.controller';
import { authenticate } from '../../middlewares/authenticate';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

router.post('/login', asyncHandler(login));
router.post('/refresh', asyncHandler(refresh));
router.post('/logout', asyncHandler(logout));
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  me(req, res);
}));

export default router;
