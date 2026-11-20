import express from 'express';
import { protect } from '../middleware/auth';
import { requireResource } from '../middleware/companyAccess';
import { validate, emailSchema } from '../middleware/validate';
import { getLedgerStatement } from '../controllers/ledgerStatementController';
import {
    downloadStatementPdf, createStatementShare, logStatementShare, emailStatement,
} from '../controllers/statementShareController';

const router = express.Router();
const ledger = (role: 'viewer' | 'accountant' = 'viewer') => requireResource('ledgers', role, 'ledgerId');

router.get('/:ledgerId/statement', protect, ledger(), getLedgerStatement);
router.get('/:ledgerId/statement/pdf', protect, ledger(), downloadStatementPdf);
router.post('/:ledgerId/statement/share', protect, ledger(), createStatementShare);
router.post('/:ledgerId/statement/share-log', protect, ledger(), logStatementShare);
router.post('/:ledgerId/statement/email', protect, validate(emailSchema), ledger(), emailStatement);

export default router;
