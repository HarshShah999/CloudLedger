import express from 'express';
import { protect } from '../middleware/auth';
import { requireCompany } from '../middleware/companyAccess';
import { getAuditLog, getRecordHistory } from '../controllers/auditController';

const router = express.Router();
router.use(protect);

router.get('/', requireCompany('accountant'), getAuditLog);
router.get('/record/:recordId', requireCompany('viewer'), getRecordHistory);

export default router;
