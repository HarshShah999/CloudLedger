import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { requestContext } from './config/requestContext';
import { errorHandler, AppError } from './middleware/errorHandler';
import authRoutes from './routes/authRoutes';
import companyRoutes from './routes/companyRoutes';
import ledgerRoutes from './routes/ledgerRoutes';
import ledgerStatementRoutes from './routes/ledgerStatementRoutes';
import voucherRoutes from './routes/voucherRoutes';
import reportRoutes from './routes/reportRoutes';
import userRoutes from './routes/userRoutes';
import financialYearRoutes from './routes/financialYearRoutes';
import exportRoutes from './routes/exportRoutes';
import inventoryRoutes from './routes/inventoryRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import paymentRoutes from './routes/paymentRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import backupRoutes from './routes/backupRoutes';
import recurringInvoiceRoutes from './routes/recurringInvoiceRoutes';
import reconciliationRoutes from './routes/reconciliationRoutes';
import gstRoutes from './routes/gstRoutes';
import publicRoutes from './routes/publicRoutes';
import auditRoutes from './routes/auditRoutes';
import receiptRoutes from './routes/receiptRoutes';
import reminderRoutes from './routes/reminderRoutes';
import importRoutes from './routes/importRoutes';

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
    cors({
        origin: env.clientUrl.split(',').map((s) => s.trim()),
        credentials: true,
        exposedHeaders: ['Content-Disposition'],
    })
);
// Who is acting (filled in by `protect`); used by the audit trail
app.use((req, _res, next) => requestContext.run({ ip: req.ip }, next));

// Tally / Excel files arrive base64-encoded: a few years of Day Book can be large
app.use('/api/import', express.json({ limit: '120mb' }));
// Company imports can be large JSON documents
app.use(express.json({ limit: '25mb' }));

if (env.nodeEnv !== 'test') {
    app.use((req, _res, next) => {
        console.log(`📨 ${req.method} ${req.path}`);
        next();
    });
}

// Brute-force protection on login/register (per IP)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.nodeEnv === 'test' ? 10_000 : 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { status: 'fail', message: 'Too many attempts, please try again in a few minutes' },
});

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});

// Only credential endpoints are rate-limited; /auth/me runs on every page load.
app.use(['/api/auth/login', '/api/auth/register'], authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/ledgers', ledgerRoutes);
app.use('/api/ledgers', ledgerStatementRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/financial-years', financialYearRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/recurring-invoices', recurringInvoiceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/reconciliation', reconciliationRoutes);
app.use('/api/gst', gstRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/import', importRoutes);

app.get('/', (_req, res) => {
    res.send('CloudLedger API is running');
});

app.use((req, _res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(errorHandler);

export default app;
