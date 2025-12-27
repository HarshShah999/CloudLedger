import express from 'express';
import { createCompany, getCompanies, getCompany } from '../controllers/companyController';
import { protect } from '../middleware/auth';
import { validate } from '../middleware/validate';
import Joi from 'joi';

const router = express.Router();

const createCompanySchema = Joi.object({
    name: Joi.string().required(),
    address: Joi.string().allow('', null),
    email: Joi.string().email().allow('', null),
    phone: Joi.string().allow('', null),
    currency: Joi.string().default('INR'),
    financialYear: Joi.object({
        name: Joi.string().required(),
        startDate: Joi.date().required(),
        endDate: Joi.date().required(),
    }).optional(),
       gstin: Joi.string()
        .pattern(/^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
        .length(15)
        .allow(null, '')
        .messages({
            'string.pattern.base': 'Invalid GSTIN format',
            'string.length': 'GSTIN must be exactly 15 characters',
        }),
       state:Joi.string().required(),
});

router.use(protect);

router.route('/')
    .get(getCompanies)
    .post(validate(createCompanySchema), createCompany);

router.route('/:id')
    .get(getCompany);

export default router;
