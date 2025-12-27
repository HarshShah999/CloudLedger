import { Request, Response, NextFunction } from 'express';
import BaseJoi from 'joi';
import JoiDate from '@joi/date';
import { AppError } from './errorHandler';

const Joi = BaseJoi.extend(JoiDate);


export const validate = (schema:BaseJoi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true   // 👈 REQUIRED for dates
    });

    if (error) {
      const message = error.details
        .map((detail: any) => detail.message)
        .join(', ');
      return next(new AppError(message, 400));
    }

    req.body = value; // 👈 IMPORTANT (dates become JS Date)
    next();
  };
};

export const registerSchema = Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    role:Joi.string().valid('admin', 'viewer','accountant').required(),
});

export const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
});

export const createInvoiceSchema = Joi.object({
  companyId: Joi.string().required(),

  partyLedgerId: Joi.string().required(),
  salesLedgerId: Joi.string().required(),

  invoiceNumber: Joi.string().trim().required(),

   date: Joi.date().format('YYYY-MM-DD').required(),  // 👈 frontend string OK
  dueDate: Joi.date().format('YYYY-MM-DD').required(),

  type: Joi.string()
    .valid('SALES', 'PURCHASE', 'CREDIT_NOTE', 'DEBIT_NOTE')
    .required(),

  items: Joi.array()
    .items(
      Joi.object({
          itemId: Joi.string().required(),
          description: Joi.string().required(),
          quantity: Joi.number().positive().required(),
          rate: Joi.number().positive().required(),
          taxRate: Joi.number().min(0).required(),
        discountPercent: Joi.number().min(0).max(100).required(),
      })
    )
    .min(1)
    .required(),

    notes: Joi.string().allow('', null),
    discountPercent: Joi.number().min(0).max(100).required(),
    originalInvoiceNumber: Joi.string().allow('', null),
  originalInvoiceDate: Joi.date()
    .format('YYYY-MM-DD')
    .optional()
    .allow(null, ''),
});

