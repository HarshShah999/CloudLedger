import express from 'express';
import { protect } from '../middleware/auth';
import { requireCompany, requireResource } from '../middleware/companyAccess';
import Joi from 'joi';
import { validate, createInvoiceSchema, updateInvoiceSchema, emailSchema, isoDate, uuid } from '../middleware/validate';
import {
    createInvoice, getInvoices, getInvoiceById, updateInvoice, deleteInvoice, cancelInvoice,
    downloadInvoicePDF, sendInvoiceEmail, getNextNumber,
    createInvoiceShare, revokeInvoiceShares, logInvoiceShare, getInvoiceCommunications,
    convertInvoice, updateDocumentStatus,
    getEinvoice, getEinvoiceBulk, postIrn, postCancelIrn, getEwayBill, postEwayBillBulk, postEwayBillNumber,
} from '../controllers/invoiceController';

const router = express.Router();
router.use(protect);

router.get('/', requireCompany('viewer'), getInvoices);
router.post('/', validate(createInvoiceSchema), requireCompany('accountant'), createInvoice);
router.get('/next-number', requireCompany('viewer'), getNextNumber);
router.get('/einvoice/bulk', requireCompany('viewer'), getEinvoiceBulk);
router.post('/ewaybill/bulk', validate(Joi.object({ companyId: uuid().required(), invoiceIds: Joi.array().items(uuid()).min(1).max(200).required() })), requireCompany('viewer'), postEwayBillBulk);

router.get('/:id', requireResource('invoices', 'viewer'), getInvoiceById);
router.put('/:id', validate(updateInvoiceSchema), requireResource('invoices', 'accountant'), updateInvoice);
router.delete('/:id', requireResource('invoices', 'accountant'), deleteInvoice);
router.post('/:id/cancel', validate(Joi.object({ companyId: uuid(), reason: Joi.string().trim().max(255).allow('', null) })), requireResource('invoices', 'accountant'), cancelInvoice);
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
router.get('/:id/einvoice', requireResource('invoices', 'viewer'), getEinvoice);
router.post(
    '/:id/irn',
    validate(Joi.object({
        companyId: uuid(),
        irn: Joi.string().trim().length(64).required(),
        ackNo: Joi.string().trim().max(20).required(),
        ackDate: Joi.string().trim().max(30).required(),
        signedQr: Joi.string().max(5000).allow('', null),
    })),
    requireResource('invoices', 'accountant'),
    postIrn
);
router.post('/:id/irn/cancel', requireResource('invoices', 'admin'), postCancelIrn);
router.get('/:id/ewaybill', requireResource('invoices', 'viewer'), getEwayBill);
router.post(
    '/:id/ewaybill',
    validate(Joi.object({ companyId: uuid(), ewbNumber: Joi.string().trim().required(), ewbDate: Joi.string().trim().max(30).required(), validUntil: Joi.string().trim().max(30).allow('', null) })),
    requireResource('invoices', 'accountant'),
    postEwayBillNumber
);
router.patch('/:id/status', validate(Joi.object({ companyId: uuid(), status: Joi.string().required() })), requireResource('invoices', 'accountant'), updateDocumentStatus);

export default router;
