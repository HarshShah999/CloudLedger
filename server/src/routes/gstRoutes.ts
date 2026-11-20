
import express from 'express';
import { getGSTR1, getGSTR3B } from '../controllers/gstController';
import { protect } from '../middleware/auth';
import { requireCompany } from '../middleware/companyAccess';

const router = express.Router();

router.use(protect);

router.get('/gstr1/:companyId', requireCompany('viewer'), getGSTR1);
router.get('/gstr3b/:companyId', requireCompany('viewer'), getGSTR3B);

export default router;
