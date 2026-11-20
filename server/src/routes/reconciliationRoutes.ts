import Joi from 'joi';

import express from 'express';
import { protect } from '../middleware/auth';
import { requireResource } from '../middleware/companyAccess';
import { getBankTransactions, updateReconciliation } from '../controllers/reconciliationController';
import { validate, uuid, isoDate } from '../middleware/validate';

const router = express.Router();

router.use(protect);

router.get('/ledger/:ledgerId', requireResource('ledgers', 'viewer', 'ledgerId'), getBankTransactions);
router.patch('/transaction/:id', validate(Joi.object({ companyId: uuid(), bankAllocationDate: isoDate().allow(null, '') })), requireResource('voucher_entries', 'accountant'), updateReconciliation);

export default router;
