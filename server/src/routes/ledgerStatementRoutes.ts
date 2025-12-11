import express from 'express';
import { getLedgerStatement } from '../controllers/ledgerStatementController';
import { protect } from '../middleware/auth';

const router = express.Router();

// Get ledger statement/transactions
router.get('/:ledgerId/statement', protect, getLedgerStatement);

export default router;
