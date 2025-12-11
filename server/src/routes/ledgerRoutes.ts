import express from 'express';
import { getGroups, createGroup, getLedgers, createLedger, updateLedger, deleteLedger } from '../controllers/ledgerController';
import { protect } from '../middleware/auth';
import { validate } from '../middleware/validate';
import Joi from 'joi';

const router = express.Router();

const createGroupSchema = Joi.object({
    companyId: Joi.string().uuid().required(),
    name: Joi.string().required(),
    parentId: Joi.string().uuid().allow(null).optional(),
    type: Joi.string().valid('Asset', 'Liability', 'Income', 'Expense').required(),
});

const createLedgerSchema = Joi.object({
    companyId: Joi.string().uuid().required(),
    groupId: Joi.string().uuid().required(),
    name: Joi.string().required(),
    openingBalance: Joi.number().optional(),
    openingBalanceType: Joi.string().valid('Dr', 'Cr').optional(),
});

router.use(protect);

router.route('/groups')
    .get(getGroups)
    .post(validate(createGroupSchema), createGroup);

router.route('/')
    .get(getLedgers)
    .post(validate(createLedgerSchema), createLedger);

router.route('/:id')
    .put(updateLedger)
    .delete(deleteLedger);

export default router;
