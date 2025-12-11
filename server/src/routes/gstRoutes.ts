
import express from 'express';
import { getGSTR1, getGSTR3B } from '../controllers/gstController';
import { protect } from '../middleware/auth';

const router = express.Router();

router.use(protect);

router.get('/gstr1/:companyId', getGSTR1);
router.get('/gstr3b/:companyId', getGSTR3B);

export default router;
