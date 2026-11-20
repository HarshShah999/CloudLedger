import express from 'express';
import Joi from 'joi';
import { protect } from '../middleware/auth';
import { requireCompany } from '../middleware/companyAccess';
import { validate, gstin, isoDate, addMemberSchema, updateMemberSchema } from '../middleware/validate';
import { createCompany, getCompanies, getCompany, updateCompany } from '../controllers/companyController';
import { listMembers, addMember, updateMember, removeMember } from '../controllers/userController';

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
});

router.use(protect);

router.route('/').get(getCompanies).post(validate(createCompanySchema), createCompany);

router.get('/:companyId', requireCompany('viewer'), getCompany);
router.put('/:companyId', validate(updateCompanySchema), requireCompany('admin'), updateCompany);

// Members (people who can access this company)
router.get('/:companyId/members', requireCompany('viewer'), listMembers);
router.post('/:companyId/members', validate(addMemberSchema), requireCompany('admin'), addMember);
router.put('/:companyId/members/:userId', validate(updateMemberSchema), requireCompany('admin'), updateMember);
router.delete('/:companyId/members/:userId', requireCompany('admin'), removeMember);

export default router;
