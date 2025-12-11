import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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

dotenv.config();

const app = express();

// Middleware
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.path}`);
    next();
});


// Routes
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
import recurringInvoiceRoutes from './routes/recurringInvoiceRoutes';

// ... existing code ...

app.use('/api/recurring-invoices', recurringInvoiceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/backup', backupRoutes);


app.get('/', (req, res) => {
    res.send('CloudLedger API is running');
});

// 404 Handler - must be after all other routes
app.use((req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handler
app.use(errorHandler);

export default app;
