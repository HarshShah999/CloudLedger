
import express from 'express';
import { protect } from '../middleware/auth';
import { getBankTransactions, updateReconciliation } from '../controllers/reconciliationController';

const router = express.Router();

router.use(protect);

router.get('/ledger/:ledgerId', getBankTransactions);
router.patch('/transaction/:id', updateReconciliation);

export default router;
