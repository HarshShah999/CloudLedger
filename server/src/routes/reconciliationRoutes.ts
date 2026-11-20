
import express from 'express';
import { protect } from '../middleware/auth';
import { requireResource } from '../middleware/companyAccess';
import { getBankTransactions, updateReconciliation } from '../controllers/reconciliationController';

const router = express.Router();

router.use(protect);

router.get('/ledger/:ledgerId', requireResource('ledgers', 'viewer', 'ledgerId'), getBankTransactions);
router.patch('/transaction/:id', requireResource('voucher_entries', 'accountant'), updateReconciliation);

export default router;
