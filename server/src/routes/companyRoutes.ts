import express from 'express';
import Joi from 'joi';
import { protect } from '../middleware/auth';
import { requireCompany } from '../middleware/companyAccess';
import { validate, gstin, isoDate, addMemberSchema, updateMemberSchema, uuid } from '../middleware/validate';
import {
    createCompany, getCompanies, getCompany, updateCompany, uploadCompanyAsset, removeCompanyAsset, getCompanyAsset,
} from '../controllers/companyController';
import { listMembers, addMember, updateMember, removeMember, sendMemberPasswordReset } from '../controllers/userController';

const router = express.Router();

const createCompanySchema = Joi.object({
    name: Joi.string().trim().max(255).required(),
    address: Joi.string().allow('', null).max(1000),
    email: Joi.string().email().allow('', null),
    phone: Joi.string().allow('', null).max(30),
    currency: Joi.string().default('INR'),
    financialYear: Joi.object({
        name: Joi.string().required(),
        startDate: isoDate().required(),
        endDate: isoDate().required(),
    }).optional(),
    gstin: gstin(),
    state: Joi.string().trim().max(100).required(),
});

const updateCompanySchema = Joi.object({
    name: Joi.string().trim().max(255),
    address: Joi.string().allow('', null).max(1000),
    email: Joi.string().email().allow('', null),
    phone: Joi.string().allow('', null).max(30),
    gstin: gstin(),
    state: Joi.string().trim().max(100),
    roundOffInvoices: Joi.boolean(),
    pan: Joi.string().trim().uppercase().pattern(/^[A-Z]{5}[0-9]{4}[A-Z]$/).allow('', null).messages({ 'string.pattern.base': 'Invalid PAN' }),
    website: Joi.string().trim().max(255).allow('', null),
    upiId: Joi.string().trim().pattern(/^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/).allow('', null).messages({ 'string.pattern.base': 'Invalid UPI ID (e.g. name@okhdfcbank)' }),
    bankName: Joi.string().trim().max(150).allow('', null),
    bankAccountName: Joi.string().trim().max(150).allow('', null),
    bankAccountNumber: Joi.string().trim().pattern(/^[0-9A-Za-z]{6,40}$/).allow('', null).messages({ 'string.pattern.base': 'Invalid bank account number' }),
    bankIfsc: Joi.string().trim().uppercase().pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/).allow('', null).messages({ 'string.pattern.base': 'Invalid IFSC code' }),
    bankBranch: Joi.string().trim().max(150).allow('', null),
    invoiceTerms: Joi.string().max(3000).allow('', null),
    shareMessageTemplate: Joi.string().max(2000).allow('', null),
    shareLinkDays: Joi.number().integer().min(1).max(365),
    brandColor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).messages({ 'string.pattern.base': 'Colour must look like #4338CA' }),
    printCopyLabels: Joi.boolean(),
    city: Joi.string().trim().max(100).allow('', null),
    pincode: Joi.string().trim().pattern(/^[1-9]\d{5}$/).allow('', null).messages({ 'string.pattern.base': 'PIN code must be 6 digits' }),
    einvoiceEnabled: Joi.boolean(),
    remindersEnabled: Joi.boolean(),
    reminderDays: Joi.string().trim().pattern(/^-?\d{1,3}(,-?\d{1,3})*$/).messages({ 'string.pattern.base': 'Reminder days look like -3,0,7,15' }),
    reminderChannels: Joi.string().valid('EMAIL', 'WHATSAPP', 'EMAIL,WHATSAPP'),
    whatsappPhoneNumberId: Joi.string().trim().pattern(/^\d{6,30}$/).allow('', null),
    whatsappToken: Joi.string().trim().max(1000).allow('', null),
    whatsappTemplate: Joi.string().trim().max(100).allow('', null),
    whatsappTemplateLang: Joi.string().trim().max(10),
});

router.use(protect);

router.route('/').get(getCompanies).post(validate(createCompanySchema), createCompany);

router.get('/:companyId', requireCompany('viewer'), getCompany);
router.put('/:companyId', validate(updateCompanySchema), requireCompany('admin'), updateCompany);

// Logo and signature images printed on invoices
router.get('/:companyId/assets/:kind', requireCompany('viewer'), getCompanyAsset);
router.put(
    '/:companyId/assets/:kind',
    // An image as a data URL, at most ~1.5 MB once decoded
    validate(Joi.object({ companyId: uuid(), dataUrl: Joi.string().max(2_100_000).pattern(/^data:image\/(png|jpe?g|webp);base64,/).allow(null, '') })),
    requireCompany('admin'),
    uploadCompanyAsset
);
router.delete('/:companyId/assets/:kind', requireCompany('admin'), removeCompanyAsset);

// Members (people who can access this company)
router.get('/:companyId/members', requireCompany('viewer'), listMembers);
router.post('/:companyId/members', validate(addMemberSchema), requireCompany('admin'), addMember);
router.put('/:companyId/members/:userId', validate(updateMemberSchema), requireCompany('admin'), updateMember);
router.delete('/:companyId/members/:userId', requireCompany('admin'), removeMember);
router.post('/:companyId/members/:userId/password-reset', validate(Joi.object({ companyId: uuid() })), requireCompany('admin'), sendMemberPasswordReset);

export default router;
