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
});

router.use(protect);

router.route('/')
    .get(getCompanies)
    .post(validate(createCompanySchema), createCompany);

router.route('/:id')
    .get(getCompany);

export default router;
