import express from 'express';
import Joi from 'joi';
import { protect } from '../middleware/auth';
import { requireCompany, requireResource } from '../middleware/companyAccess';
import { validate, uuid, money } from '../middleware/validate';
import {
    createUnit, getUnits, deleteUnit, createItem, getItems, updateItem, deleteItem,
} from '../controllers/inventoryController';

const router = express.Router();

const unitSchema = Joi.object({
    companyId: uuid().required(),
    name: Joi.string().trim().max(50).required(),
    symbol: Joi.string().trim().max(20).required(),
    uqc: Joi.string().trim().uppercase().max(3).allow('', null),
});

const itemFields = {
    name: Joi.string().trim().max(255).required(),
    hsnCode: Joi.string().trim().max(50).allow('', null),
    unitId: uuid().allow('', null),
    taxRate: Joi.number().min(0).max(100).default(0),
    salesRate: money().default(0),
    purchaseRate: money().default(0),
    description: Joi.string().max(1000).allow('', null),
    itemType: Joi.string().valid('GOODS', 'SERVICES').default('GOODS'),
};
const createItemSchema = Joi.object({
    companyId: uuid().required(),
    ...itemFields,
    openingQuantity: Joi.number().min(0).default(0),
    openingRate: money().allow(null),
});
const updateItemSchema = Joi.object({
    companyId: uuid(),
    ...itemFields,
    openingQuantity: Joi.number().min(0),
    openingRate: money().allow(null),
});

router.use(protect);

router.get('/units', requireCompany('viewer'), getUnits);
router.post('/units', validate(unitSchema), requireCompany('accountant'), createUnit);
router.delete('/units/:id', requireResource('units', 'accountant'), deleteUnit);

router.get('/items', requireCompany('viewer'), getItems);
router.post('/items', validate(createItemSchema), requireCompany('accountant'), createItem);
router.put('/items/:id', validate(updateItemSchema), requireResource('items', 'accountant'), updateItem);
router.delete('/items/:id', requireResource('items', 'accountant'), deleteItem);

export default router;
