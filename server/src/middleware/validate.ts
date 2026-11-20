import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { AppError } from './errorHandler';

/** Validates and cleans req.body (unknown keys are stripped). */
export const validate = (schema: Joi.ObjectSchema) => (req: Request, _res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body ?? {}, { abortEarly: false, stripUnknown: true, convert: true });
    if (error) return next(new AppError(error.details.map((d) => d.message.replace(/"/g, '')).join(', '), 400));
    req.body = value;
    next();
};

/* ---------- shared field types ---------- */

/** Calendar date as 'YYYY-MM-DD' (accepts full ISO timestamps and trims them). */
export const isoDate = () =>
    Joi.string()
        .trim()
        .replace(/T.*$/, '')
        .pattern(/^\d{4}-\d{2}-\d{2}$/)
        .messages({ 'string.pattern.base': '{{#label}} must be a date in YYYY-MM-DD format' });

export const uuid = () => Joi.string().guid({ version: ['uuidv4', 'uuidv1', 'uuidv5'] });
export const money = () => Joi.number().precision(2).min(0).max(1e13);

export const GSTIN_RE = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const gstin = () =>
    Joi.string()
        .trim()
        .uppercase()
        .pattern(GSTIN_RE)
        .allow(null, '')
        .messages({ 'string.pattern.base': 'Invalid GSTIN format' });

/* ---------- auth ---------- */

export const registerSchema = Joi.object({
    name: Joi.string().trim().max(255).required(),
    email: Joi.string().trim().email().required(),
    password: Joi.string().min(8).max(128).required(),
});

export const loginSchema = Joi.object({
    email: Joi.string().trim().email().required(),
    password: Joi.string().required(),
});

/* ---------- invoices ---------- */

const invoiceBase = {
    partyLedgerId: uuid().required(),
    salesLedgerId: uuid().required(),
    invoiceNumber: Joi.string().trim().max(50).allow('', null),
    date: isoDate().required(),
    dueDate: isoDate().allow('', null),
    type: Joi.string().valid('SALES', 'PURCHASE', 'CREDIT_NOTE', 'DEBIT_NOTE').required(),
    placeOfSupply: Joi.string().trim().max(100).allow('', null),
    items: Joi.array()
        .items(
            Joi.object({
                itemId: uuid().allow(null, ''),
                description: Joi.string().allow('', null).max(1000),
                quantity: Joi.number().positive().required(),
                rate: money().required(),
                taxRate: Joi.number().min(0).max(100).default(0),
                discountPercent: Joi.number().min(0).max(100).default(0),
            })
        )
        .min(1)
        .required(),
    notes: Joi.string().allow('', null).max(2000),
    discountPercent: Joi.number().min(0).max(100).default(0),
    originalInvoiceNumber: Joi.string().trim().max(50).allow('', null),
    originalInvoiceDate: isoDate().allow('', null),
};

export const createInvoiceSchema = Joi.object({ companyId: uuid().required(), ...invoiceBase });
export const updateInvoiceSchema = Joi.object({ companyId: uuid(), ...invoiceBase });

export const emailSchema = Joi.object({
    companyId: uuid(),
    startDate: isoDate(),
    endDate: isoDate(),
    to: Joi.string().trim().email().allow('', null),
    cc: Joi.string().trim().email().allow('', null),
    subject: Joi.string().max(300).allow('', null),
    message: Joi.string().max(5000).allow('', null),
});

/* ---------- payments ---------- */

export const createPaymentSchema = Joi.object({
    companyId: uuid().required(),
    invoiceId: uuid().required(),
    paymentDate: isoDate().required(),
    amount: Joi.number().positive().precision(2).required(),
    depositLedgerId: uuid().allow(null, ''),
    paymentMode: Joi.string().max(50).allow('', null),
    referenceNumber: Joi.string().max(100).allow('', null),
    notes: Joi.string().max(2000).allow('', null),
});

/* ---------- vouchers ---------- */

const voucherBase = {
    voucherTypeId: uuid().required(),
    voucherNumber: Joi.string().trim().max(50).allow('', null),
    date: isoDate().required(),
    narration: Joi.string().allow('', null).max(2000),
    entries: Joi.array()
        .items(
            Joi.object({
                ledgerId: uuid().required(),
                amount: Joi.number().positive().precision(2).required(),
                type: Joi.string().valid('Dr', 'Cr').required(),
                instrumentNumber: Joi.string().max(50).allow('', null),
                instrumentDate: isoDate().allow('', null),
            })
        )
        .min(2)
        .required(),
};
export const createVoucherSchema = Joi.object({ companyId: uuid().required(), ...voucherBase });
export const updateVoucherSchema = Joi.object({ companyId: uuid(), ...voucherBase });

/* ---------- members ---------- */

export const addMemberSchema = Joi.object({
    companyId: uuid(),
    name: Joi.string().trim().max(255).allow('', null),
    email: Joi.string().trim().email().required(),
    password: Joi.string().min(8).max(128).allow('', null),
    role: Joi.string().valid('admin', 'accountant', 'viewer').required(),
});
export const updateMemberSchema = Joi.object({
    companyId: uuid(),
    role: Joi.string().valid('admin', 'accountant', 'viewer').required(),
});
