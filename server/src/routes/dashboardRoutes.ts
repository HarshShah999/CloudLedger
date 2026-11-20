import { Router } from 'express';
import { getDashboardStats } from '../controllers/dashboardController';
import { protect } from '../middleware/auth';
import { requireCompany } from '../middleware/companyAccess';

const router = Router();

router.get('/stats', protect, requireCompany('viewer'), getDashboardStats);

export default router;
