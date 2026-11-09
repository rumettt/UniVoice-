import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { requireAdmin } from '../../middlewares/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createCategory,
  listCategories,
  getCategoryById,
  updateCategory,
  setCategoryStatus,
} from '../../controllers/category.controller';

const categoryRouter = Router();

// Category endpoints
categoryRouter.post('/', authenticate, requireAdmin, asyncHandler(createCategory));
categoryRouter.get('/', authenticate, asyncHandler(listCategories));
categoryRouter.get('/:id', authenticate, asyncHandler(getCategoryById));
categoryRouter.patch('/:id', authenticate, requireAdmin, asyncHandler(updateCategory));
categoryRouter.patch('/:id/status', authenticate, requireAdmin, asyncHandler(setCategoryStatus));

export default categoryRouter;
