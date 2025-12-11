import express from 'express';
import { createVoucher, getVouchers, getVoucherTypes, getVoucherById, updateVoucher, deleteVoucher } from '../controllers/voucherController';
import { protect } from '../middleware/auth';
import { validate } from '../middleware/validate';
import Joi from 'joi';

const router = express.Router();

const voucherSchema = Joi.object({
    companyId: Joi.string().uuid(),
    voucherTypeId: Joi.string().uuid().required(),
    voucherNumber: Joi.string().required(),
    date: Joi.date().required(),
    narration: Joi.string().allow('', null),
    entries: Joi.array().items(
        Joi.object({
            ledgerId: Joi.string().uuid().required(),
            amount: Joi.number().positive().required(),
            type: Joi.string().valid('Dr', 'Cr').required(),
        })
    ).min(2).required(),
});

const createVoucherSchema = voucherSchema.keys({
    companyId: Joi.string().uuid().required(),
});

router.use(protect);

router.route('/')
    .get(getVouchers)
    .post(validate(createVoucherSchema), createVoucher);

router.route('/types')
    .get(getVoucherTypes);

router.route('/:id')
    .get(getVoucherById)
    .put(validate(voucherSchema), updateVoucher)
    .delete(deleteVoucher);

export default router;
