export type DocType = 'SALES' | 'PURCHASE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'QUOTATION' | 'SALES_ORDER' | 'PURCHASE_ORDER';

export const DOC_TYPES: { type: DocType; label: string; plural: string; slug: string; posting: boolean; sales: boolean }[] = [
    { type: 'QUOTATION', label: 'Quotation', plural: 'Quotations', slug: 'quotation', posting: false, sales: true },
    { type: 'SALES_ORDER', label: 'Sales Order', plural: 'Sales Orders', slug: 'sales-order', posting: false, sales: true },
    { type: 'SALES', label: 'Sales Invoice', plural: 'Sales', slug: 'sales', posting: true, sales: true },
    { type: 'CREDIT_NOTE', label: 'Credit Note', plural: 'Credit Notes', slug: 'credit-note', posting: true, sales: true },
    { type: 'PURCHASE_ORDER', label: 'Purchase Order', plural: 'Purchase Orders', slug: 'purchase-order', posting: false, sales: false },
    { type: 'PURCHASE', label: 'Purchase Bill', plural: 'Purchases', slug: 'purchase', posting: true, sales: false },
    { type: 'DEBIT_NOTE', label: 'Debit Note', plural: 'Debit Notes', slug: 'debit-note', posting: true, sales: false },
];

export const docInfo = (t: string) => DOC_TYPES.find((d) => d.type === t) ?? DOC_TYPES[2];
export const isPostingType = (t: string) => docInfo(t).posting;

/** Next documents a quotation/order can become. */
export const CONVERSIONS: Partial<Record<DocType, DocType[]>> = {
    QUOTATION: ['SALES_ORDER', 'SALES'],
    SALES_ORDER: ['SALES'],
    PURCHASE_ORDER: ['PURCHASE'],
};

export const STATUS_OPTIONS: Partial<Record<DocType, string[]>> = {
    QUOTATION: ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED'],
    SALES_ORDER: ['OPEN', 'CLOSED'],
    PURCHASE_ORDER: ['OPEN', 'CLOSED'],
};

export const STATUS_STYLE: Record<string, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    SENT: 'bg-blue-100 text-blue-700',
    ACCEPTED: 'bg-green-100 text-green-700',
    DECLINED: 'bg-red-100 text-red-700',
    OPEN: 'bg-amber-100 text-amber-700',
    CLOSED: 'bg-slate-100 text-slate-700',
    CONVERTED: 'bg-indigo-100 text-indigo-700',
};
