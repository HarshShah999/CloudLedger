import express from 'express';
import Joi from 'joi';
import { protect } from '../middleware/auth';
import { requireCompany, requireResource } from '../middleware/companyAccess';
import { validate, uuid, isoDate, money } from '../middleware/validate';
import {
    getRecurringInvoices, getRecurringInvoice, createRecurringInvoice, updateRecurringInvoice,
    setRecurringActive, deleteRecurringInvoice, runRecurringNow,
} from '../controllers/recurringInvoiceController';

const router = express.Router();

const fields = {
    profileName: Joi.string().trim().max(255).allow('', null),
    partyLedgerId: uuid().required(),
    salesLedgerId: uuid().required(),
    type: Joi.string().valid('SALES', 'PURCHASE').default('SALES'),
    frequency: Joi.string().valid('WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY').required(),
    startDate: isoDate().required(),
    endDate: isoDate().allow('', null),
    nextInvoiceDate: isoDate().allow('', null),
    discountPercent: Joi.number().min(0).max(100).default(0),
    notes: Joi.string().max(2000).allow('', null),
    isActive: Joi.boolean().default(true),
    items: Joi.array()
        .items(
            Joi.object({
                itemId: uuid().allow('', null),
                description: Joi.string().max(1000).allow('', null),
                quantity: Joi.number().positive().required(),
                rate: money().required(),
                taxRate: Joi.number().min(0).max(100).allow(null),
                discountPercent: Joi.number().min(0).max(100).default(0),
            })
        )
        .min(1)
        .required(),
};

router.use(protect);

router.get('/', requireCompany('viewer'), getRecurringInvoices);
router.post('/', validate(Joi.object({ companyId: uuid().required(), ...fields })), requireCompany('accountant'), createRecurringInvoice);
router.get('/:id', requireResource('recurring_invoices', 'viewer'), getRecurringInvoice);
router.put('/:id', validate(Joi.object({ companyId: uuid(), ...fields })), requireResource('recurring_invoices', 'accountant'), updateRecurringInvoice);
router.patch('/:id', requireResource('recurring_invoices', 'accountant'), setRecurringActive);
router.delete('/:id', requireResource('recurring_invoices', 'accountant'), deleteRecurringInvoice);
router.post('/:id/run', requireResource('recurring_invoices', 'accountant'), runRecurringNow);

export default router;
