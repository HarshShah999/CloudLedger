import express from 'express';
import {
    createUnit, getUnits, deleteUnit,
    createItem, getItems, updateItem, deleteItem
} from '../controllers/inventoryController';
import { protect } from '../middleware/auth';

const router = express.Router();

router.use(protect);

// Units Routes
router.route('/units')
    .post(createUnit)
    .get(getUnits);

router.route('/units/:id')
    .delete(deleteUnit);

// Items Routes
router.route('/items')
    .post(createItem)
    .get(getItems);

router.route('/items/:id')
    .put(updateItem)
    .delete(deleteItem);

export default router;
