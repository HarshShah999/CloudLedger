import express from 'express';
import Joi from 'joi';
import { protect } from '../middleware/auth';
import { requireCompany, requireResource } from '../middleware/companyAccess';
import { validate, uuid, gstin } from '../middleware/validate';
import { getGroups, createGroup, getLedgers, createLedger, updateLedger, deleteLedger } from '../controllers/ledgerController';

const router = express.Router();

const createGroupSchema = Joi.object({
    companyId: uuid().required(),
    name: Joi.string().trim().max(255).required(),
    parentId: uuid().allow(null, '').optional(),
    type: Joi.string().valid('Asset', 'Liability', 'Income', 'Expense').required(),
});

const ledgerFields = {
    groupId: uuid(),
    name: Joi.string().trim().max(255),
    openingBalance: Joi.number().min(0).precision(2),
    openingBalanceType: Joi.string().valid('Dr', 'Cr'),
    gstin: gstin(),
    state: Joi.string().trim().max(100).allow('', null),
    email: Joi.string().trim().email().allow('', null),
    phone: Joi.string().trim().max(30).allow('', null),
    address: Joi.string().max(1000).allow('', null),
    city: Joi.string().trim().max(100).allow('', null),
    pincode: Joi.string().trim().pattern(/^[1-9]\d{5}$/).allow('', null).messages({ 'string.pattern.base': 'PIN code must be 6 digits' }),
    gstRegistrationType: Joi.string().valid('REGULAR', 'COMPOSITION', 'UNREGISTERED', 'CONSUMER', 'SEZ', 'OVERSEAS').allow('', null),
    pan: Joi.string().trim().uppercase().pattern(/^[A-Z]{5}[0-9]{4}[A-Z]$/).allow('', null).messages({ 'string.pattern.base': 'Invalid PAN' }),
};

const createLedgerSchema = Joi.object({
    companyId: uuid().required(),
    ...ledgerFields,
    groupId: uuid().required(),
    name: Joi.string().trim().max(255).required(),
});
const updateLedgerSchema = Joi.object({ companyId: uuid(), ...ledgerFields });

router.use(protect);

router.get('/groups', requireCompany('viewer'), getGroups);
router.post('/groups', validate(createGroupSchema), requireCompany('accountant'), createGroup);

router.get('/', requireCompany('viewer'), getLedgers);
router.post('/', validate(createLedgerSchema), requireCompany('accountant'), createLedger);
router.put('/:id', validate(updateLedgerSchema), requireResource('ledgers', 'accountant'), updateLedger);
router.delete('/:id', requireResource('ledgers', 'accountant'), deleteLedger);

export default router;
