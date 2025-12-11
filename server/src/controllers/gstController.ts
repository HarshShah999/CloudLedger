
import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

export const getGSTR1 = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId } = req.params;
    const { fromDate, toDate } = req.query;

    if (!fromDate || !toDate) {
        return next(new AppError('From date and To date are required', 400));
    }

    try {
        // Fetch Sales Invoices with Party Details and Items
        const invoicesQuery = `
            SELECT 
                i.id, i.invoice_number, i.date, i.grand_total, i.tax_total, i.subtotal,
                l.name as party_name, l.gstin as party_gstin, l.state as party_state,
                c.state as company_state,
                (
                    SELECT json_agg(json_build_object(
                        'taxable_amount', ii.taxable_amount,
                        'tax_rate', ii.tax_rate,
                        'cgst_amount', ii.cgst_amount,
                        'sgst_amount', ii.sgst_amount,
                        'igst_amount', ii.igst_amount
                    ))
                    FROM invoice_items ii
                    WHERE ii.invoice_id = i.id
                ) as items
            FROM invoices i
            LEFT JOIN ledgers l ON i.party_ledger_id = l.id
            LEFT JOIN companies c ON i.company_id = c.id
            WHERE i.company_id = $1 
            AND i.type = 'SALES'
            AND i.date BETWEEN $2 AND $3
            ORDER BY i.date DESC
        `;

        const result = await query(invoicesQuery, [companyId, fromDate, toDate]);
        const invoices = result.rows;

        // Process data for GSTR-1
        const b2b: any[] = [];
        const b2cLarge: any[] = [];
        const b2cSmall: any[] = [];

        invoices.forEach(inv => {
            const isInterState = inv.party_state && inv.company_state && inv.party_state !== inv.company_state;
            const hasGSTIN = !!inv.party_gstin;
            const grandTotal = Number(inv.grand_total);

            if (hasGSTIN) {
                // B2B: Registered Party
                b2b.push(inv);
            } else if (isInterState && grandTotal > 250000) {
                // B2C Large: Unregistered, Inter-state, > 2.5 Lakhs
                b2cLarge.push(inv);
            } else {
                // B2C Small: Everyone else
                b2cSmall.push(inv);
            }
        });

        res.status(200).json({
            status: 'success',
            data: {
                b2b,
                b2cLarge,
                b2cSmall
            }
        });

    } catch (error) {
        next(error);
    }
};

export const getGSTR3B = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId } = req.params;
    const { fromDate, toDate } = req.query;

    if (!fromDate || !toDate) {
        return next(new AppError('From date and To date are required', 400));
    }

    try {
        // 3.1 Outward Supplies (Sales)
        const salesStatsQuery = `
            SELECT 
                SUM(i.subtotal) as taxable_value,
                SUM(ii.igst_amount) as igst,
                SUM(ii.cgst_amount) as cgst,
                SUM(ii.sgst_amount) as sgst
            FROM invoices i
            JOIN invoice_items ii ON i.id = ii.invoice_id
            WHERE i.company_id = $1 
            AND i.type = 'SALES'
            AND i.date BETWEEN $2 AND $3
        `;

        const salesResult = await query(salesStatsQuery, [companyId, fromDate, toDate]);
        const outwardSupplies = salesResult.rows[0];

        // 4.0 Eligible ITC (Purchases)
        const purchaseStatsQuery = `
            SELECT 
                SUM(i.subtotal) as taxable_value,
                SUM(ii.igst_amount) as igst,
                SUM(ii.cgst_amount) as cgst,
                SUM(ii.sgst_amount) as sgst
            FROM invoices i
            JOIN invoice_items ii ON i.id = ii.invoice_id
            WHERE i.company_id = $1 
            AND i.type = 'PURCHASE'
            AND i.date BETWEEN $2 AND $3
        `;

        const purchaseResult = await query(purchaseStatsQuery, [companyId, fromDate, toDate]);
        const eligibleITC = purchaseResult.rows[0];

        res.status(200).json({
            status: 'success',
            data: {
                outward_supplies: {
                    taxable_value: Number(outwardSupplies.taxable_value || 0),
                    igst: Number(outwardSupplies.igst || 0),
                    cgst: Number(outwardSupplies.cgst || 0),
                    sgst: Number(outwardSupplies.sgst || 0)
                },
                eligible_itc: {
                    taxable_value: Number(eligibleITC.taxable_value || 0),
                    igst: Number(eligibleITC.igst || 0),
                    cgst: Number(eligibleITC.cgst || 0),
                    sgst: Number(eligibleITC.sgst || 0)
                }
            }
        });

    } catch (error) {
        next(error);
    }
};
