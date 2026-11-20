import express from 'express';
import Joi from 'joi';
import { protect } from '../middleware/auth';
import { requireCompany, requireResource } from '../middleware/companyAccess';
import { validate, uuid, isoDate } from '../middleware/validate';
import {
    getFinancialYears, getActiveFinancialYear, createFinancialYear, activateFinancialYear,
    closeFinancialYear, reopenFinancialYear, deleteFinancialYear,
} from '../controllers/financialYearController';

const router = express.Router();

const createSchema = Joi.object({
    companyId: uuid().required(),
    name: Joi.string().trim().max(50).required(),
    startDate: isoDate().required(),
    endDate: isoDate().required(),
});

router.use(protect);

router.get('/', requireCompany('viewer'), getFinancialYears);
router.get('/active', requireCompany('viewer'), getActiveFinancialYear);
router.post('/', validate(createSchema), requireCompany('accountant'), createFinancialYear);
router.put('/:id/activate', validate(Joi.object({ companyId: uuid() })), requireResource('financial_years', 'admin'), activateFinancialYear);
router.put('/:id/close', validate(Joi.object({ companyId: uuid() })), requireResource('financial_years', 'admin'), closeFinancialYear);
router.put('/:id/reopen', validate(Joi.object({ companyId: uuid() })), requireResource('financial_years', 'admin'), reopenFinancialYear);
router.delete('/:id', requireResource('financial_years', 'admin'), deleteFinancialYear);

export default router;
