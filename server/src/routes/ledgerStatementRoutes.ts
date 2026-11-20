import express from 'express';
import { getLedgerStatement } from '../controllers/ledgerStatementController';
import { protect } from '../middleware/auth';
import { requireResource } from '../middleware/companyAccess';

const router = express.Router();

// Get ledger statement/transactions
router.get('/:ledgerId/statement', protect, requireResource('ledgers', 'viewer', 'ledgerId'), getLedgerStatement);

export default router;
