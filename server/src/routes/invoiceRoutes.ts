import express from 'express';
import { createInvoice, getInvoices, getInvoiceById, deleteInvoice, downloadInvoicePDF, updateInvoice, sendInvoiceEmail } from '../controllers/invoiceController';
import { protect } from '../middleware/auth';
import { createInvoiceSchema, validate } from '../middleware/validate';


const router = express.Router();

router.use(protect);

router.route('/')
    .post(validate(createInvoiceSchema),createInvoice)
    .get(getInvoices);

router.route('/:id')
    .get(getInvoiceById)
    .put(updateInvoice)
    .delete(deleteInvoice);

router.get('/:id/pdf', downloadInvoicePDF);
router.post('/:id/email', sendInvoiceEmail);

export default router;



