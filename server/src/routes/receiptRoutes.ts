import express from 'express';
import Joi from 'joi';
import { protect } from '../middleware/auth';
import { requireCompany, requireResource } from '../middleware/companyAccess';
import { validate, uuid, isoDate } from '../middleware/validate';
import { getReceipts, postReceipt, postAllocation, removeReceipt, getOpenInvoices } from '../controllers/receiptController';

const router = express.Router();

const allocations = Joi.array()
    .items(Joi.object({ invoiceId: uuid().required(), amount: Joi.number().positive().precision(2).required() }))
    .default([]);

const createSchema = Joi.object({
    companyId: uuid().required(),
    partyLedgerId: uuid().required(),
    direction: Joi.string().valid('RECEIPT', 'PAYMENT').required(),
    date: isoDate().required(),
    amount: Joi.number().positive().precision(2).required(),
    depositLedgerId: uuid().allow(null, ''),
    paymentMode: Joi.string().max(50).allow('', null),
    referenceNumber: Joi.string().max(100).allow('', null),
    notes: Joi.string().max(2000).allow('', null),
    allocations,
});

router.use(protect);

router.get('/', requireCompany('viewer'), getReceipts);
router.get('/open-invoices', requireCompany('viewer'), getOpenInvoices);
router.post('/', validate(createSchema), requireCompany('accountant'), postReceipt);
router.post('/:id/allocate', validate(Joi.object({ companyId: uuid(), allocations: allocations.min(1) })), requireResource('receipts', 'accountant'), postAllocation);
router.delete('/:id', requireResource('receipts', 'accountant'), removeReceipt);

export default router;
