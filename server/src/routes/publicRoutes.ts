import express from 'express';
import rateLimit from 'express-rate-limit';
import { getSharedDocument, getSharedPdf } from '../controllers/publicController';

/** Unauthenticated routes for documents shared by link. */
const router = express.Router();

router.use(
    rateLimit({
        windowMs: 60 * 1000,
        limit: process.env.NODE_ENV === 'test' ? 10_000 : 60,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { status: 'fail', message: 'Too many requests, please slow down' },
    })
);

router.get('/d/:token', getSharedDocument);
router.get('/d/:token/pdf', getSharedPdf);

export default router;
