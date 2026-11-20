import express from 'express';
import { protect } from '../middleware/auth';
import { requireCompany, requireResource } from '../middleware/companyAccess';
import { validate, createInvoiceSchema, updateInvoiceSchema, emailSchema } from '../middleware/validate';
import {
    createInvoice, getInvoices, getInvoiceById, updateInvoice, deleteInvoice,
    downloadInvoicePDF, sendInvoiceEmail, getNextNumber,
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

export default router;
