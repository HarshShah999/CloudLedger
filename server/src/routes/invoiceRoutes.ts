import express from 'express';
import { protect } from '../middleware/auth';
import { requireCompany, requireResource } from '../middleware/companyAccess';
import Joi from 'joi';
import { validate, createInvoiceSchema, updateInvoiceSchema, emailSchema, isoDate, uuid } from '../middleware/validate';
import {
    createInvoice, getInvoices, getInvoiceById, updateInvoice, deleteInvoice,
    downloadInvoicePDF, sendInvoiceEmail, getNextNumber,
    createInvoiceShare, revokeInvoiceShares, logInvoiceShare, getInvoiceCommunications,
    convertInvoice, updateDocumentStatus,
} from '../controllers/invoiceController';

const router = express.Router();
router.use(protect);

router.get('/', requireCompany('viewer'), getInvoices);
router.post('/', validate(createInvoiceSchema), requireCompany('accountant'), createInvoice);
router.get('/next-number', requireCompany('viewer'), getNextNumber);

router.get('/:id', requireResource('invoices', 'viewer'), getInvoiceById);
router.put('/:id', validate(updateInvoiceSchema), requireResource('invoices', 'accountant'), updateInvoice);
router.delete('/:id', requireResource('invoices', 'accountant'), deleteInvoice);
router.get('/:id/pdf', requireResource('invoices', 'viewer'), downloadInvoicePDF);
router.post('/:id/email', validate(emailSchema), requireResource('invoices', 'viewer'), sendInvoiceEmail);
router.post('/:id/share', requireResource('invoices', 'viewer'), createInvoiceShare);
router.delete('/:id/share', requireResource('invoices', 'accountant'), revokeInvoiceShares);
router.post('/:id/share-log', requireResource('invoices', 'viewer'), logInvoiceShare);
router.get('/:id/communications', requireResource('invoices', 'viewer'), getInvoiceCommunications);
router.post(
    '/:id/convert',
    validate(Joi.object({
        companyId: uuid(),
        to: Joi.string().valid('SALES_ORDER', 'SALES', 'PURCHASE').required(),
        date: isoDate().allow('', null),
        dueDate: isoDate().allow('', null),
        invoiceNumber: Joi.string().trim().max(50).allow('', null),
    })),
    requireResource('invoices', 'accountant'),
    convertInvoice
);
router.patch('/:id/status', validate(Joi.object({ companyId: uuid(), status: Joi.string().required() })), requireResource('invoices', 'accountant'), updateDocumentStatus);

export default router;
