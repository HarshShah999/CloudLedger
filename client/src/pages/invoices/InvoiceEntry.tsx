import React, { useEffect, useRef, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Plus, Trash2, Save } from 'lucide-react';
import api, { apiError } from '../../api/axios';
import { useNavigate, useParams } from 'react-router-dom';
import { calculateInvoice, isInterStateSupply } from '../../lib/invoiceCalc';
import { DocType, docInfo } from '../../lib/docTypes';
import { useGstMeta } from '../../lib/gstMeta';
import { notify } from '../../utils/notification';
import { amount, inr } from '../../lib/format';

interface Ledger {
    id: string;
    name: string;
    state?: string;
    gst_registration_type?: string | null;
}

interface Item {
    id: string;
    name: string;
    sales_rate: number;
    purchase_rate: number;
    tax_rate: number;
    unit_symbol: string;
}

interface InvoiceItem {
    itemId: string;
    description: string;
    quantity: number;
    rate: number;
    taxRate: number;
    discountPercent: number;
    amount: number;
    discountAmount: number;
    taxableAmount: number;
    taxAmount: number;
}

/** What the document's number is called on the form. */
const NUMBER_LABEL: Partial<Record<string, string>> = {
    SALES: 'Invoice No.',
    PURCHASE: "Supplier's Bill No.",
    CREDIT_NOTE: 'Credit Note No.',
    DEBIT_NOTE: 'Debit Note No.',
    QUOTATION: 'Quotation No.',
    SALES_ORDER: 'Order No.',
    PURCHASE_ORDER: 'PO No.',
};

export const InvoiceEntry: React.FC<{ type?: DocType }> = ({ type: initialType }) => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const [type, setType] = useState<DocType | undefined>(initialType);

    // Update type when prop changes (for navigation between different Create routes)
    useEffect(() => {
        if (initialType) {
            setType(initialType);
        }
    }, [initialType]);

    const [ledgers, setLedgers] = useState<Ledger[]>([]);
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(false);
    const [companyState, setCompanyState] = useState('');

    const gstMeta = useGstMeta();
    const [formData, setFormData] = useState({
        partyLedgerId: '',
        salesLedgerId: '',
        invoiceNumber: '',
        date: new Date().toISOString().split('T')[0],
        dueDate: '',
        notes: '',
        discountPercent: 0,
        originalInvoiceNumber: '',
        originalInvoiceDate: '',
        validUntil: '',
        placeOfSupply: '',
        supplyType: '',
        reverseCharge: false,
        tdsSection: '',
        tdsRate: 0,
        shippingBillNumber: '',
        shippingBillDate: '',
        portCode: '',
        transportMode: '',
        transportDistanceKm: '',
        vehicleNumber: '',
        transporterId: '',
        transporterName: ''
    });

    const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([
        {
            itemId: '', description: '', quantity: 1, rate: 0, taxRate: 18, discountPercent: 0,
            amount: 0, discountAmount: 0, taxableAmount: 0, taxAmount: 0
        }
    ]);

    // Fetch Master Data
    useEffect(() => {
        const fetchData = async () => {
            if (!selectedCompany) return;
            try {
                const [ledgersRes, itemsRes, companyRes] = await Promise.all([
                    api.get(`/ledgers?companyId=${selectedCompany.id}`),
                    api.get(`/inventory/items?companyId=${selectedCompany.id}`),
                    api.get(`/companies/${selectedCompany.id}`)
                ]);
                setLedgers(ledgersRes.data.data.ledgers);
                setItems(itemsRes.data.data.items);
                setCompanyState(companyRes.data.data.company.state || '');
            } catch (error) {
                console.error('Failed to fetch data', error);
            }
        };
        fetchData();
    }, [selectedCompany]);

    // Suggest the next number from the company's series (new documents only).
    // A number the user typed by hand is never overwritten.
    const lastSuggested = useRef('');
    useEffect(() => {
        if (id || !selectedCompany || !type) return;
        api.get('/invoices/next-number', { params: { companyId: selectedCompany.id, type, date: formData.date } })
            .then((res) => {
                const suggested: string = res.data.data.number;
                setFormData((f) => {
                    if (f.invoiceNumber && f.invoiceNumber !== lastSuggested.current) return f;
                    lastSuggested.current = suggested;
                    return { ...f, invoiceNumber: suggested };
                });
            })
            .catch(() => undefined);
    }, [id, selectedCompany, type, formData.date]);

    // Fetch Invoice Data for Edit
    useEffect(() => {
        const fetchInvoice = async () => {
            if (!id) return;
            try {
                const res = await api.get(`/invoices/${id}`);
                const invoice = res.data.data.invoice;
                const items = res.data.data.items;

                setType(invoice.type);
                setFormData({
                    partyLedgerId: invoice.party_ledger_id,
                    salesLedgerId: invoice.sales_ledger_id,
                    invoiceNumber: invoice.invoice_number,
                    date: String(invoice.date).slice(0, 10),
                    dueDate: invoice.due_date ? String(invoice.due_date).slice(0, 10) : '',
                    notes: invoice.notes || '',
                    discountPercent: Number(invoice.discount_percent),
                    originalInvoiceNumber: invoice.original_invoice_number || '',
                    originalInvoiceDate: invoice.original_invoice_date ? String(invoice.original_invoice_date).slice(0, 10) : '',
                    placeOfSupply: invoice.place_of_supply || '',
                    supplyType: invoice.supply_type && invoice.supply_type !== 'NORMAL' ? invoice.supply_type : '',
                    reverseCharge: !!invoice.reverse_charge,
                    tdsSection: invoice.tds_section || '',
                    tdsRate: Number(invoice.tds_rate || 0),
                    shippingBillNumber: invoice.shipping_bill_number || '',
                    shippingBillDate: invoice.shipping_bill_date ? String(invoice.shipping_bill_date).slice(0, 10) : '',
                    portCode: invoice.port_code || '',
                    transportMode: invoice.transport_mode || '',
                    transportDistanceKm: invoice.transport_distance_km ?? '',
                    vehicleNumber: invoice.vehicle_number || '',
                    transporterId: invoice.transporter_id || '',
                    transporterName: invoice.transporter_name || '',
                    validUntil: invoice.valid_until ? String(invoice.valid_until).slice(0, 10) : ''
                });

                setInvoiceItems(items.map((item: any) => ({
                    itemId: item.item_id,
                    description: item.description,
                    quantity: Number(item.quantity),
                    rate: Number(item.rate),
                    taxRate: Number(item.tax_rate || 0), // Use stored tax_rate
                    discountPercent: Number(item.discount_percent || 0),
                    amount: Number(item.amount),
                    discountAmount: Number(item.discount_amount || 0),
                    taxableAmount: Number(item.taxable_amount),
                    taxAmount: Number(item.cgst_amount + item.sgst_amount + item.igst_amount)
                })));

            } catch (error) {
                console.error('Failed to fetch invoice details', error);
                notify.error(apiError(error, 'Could not load this document'));
            }
        };
        fetchInvoice();
    }, [id]);

    const handleItemChange = (index: number, field: keyof InvoiceItem, value: any) => {
        const newItems = [...invoiceItems];
        const item = newItems[index];

        if (field === 'itemId') {
            const selectedItem = items.find(i => i.id === value);
            if (selectedItem) {
                item.itemId = value;
                item.description = selectedItem.name;
                item.rate = docInfo(type || 'SALES').sales ? Number(selectedItem.sales_rate) : Number(selectedItem.purchase_rate);
                item.taxRate = Number(selectedItem.tax_rate);
            }
        } else {
            (item as any)[field] = value;
        }

        // Recalculate
        item.amount = Number(item.quantity) * Number(item.rate);
        item.discountAmount = (item.amount * Number(item.discountPercent)) / 100;
        item.taxableAmount = item.amount - item.discountAmount;
        item.taxAmount = (item.taxableAmount * Number(item.taxRate)) / 100;

        setInvoiceItems(newItems);
    };

    const addItemRow = () => {
        setInvoiceItems([...invoiceItems, {
            itemId: '', description: '', quantity: 1, rate: 0, taxRate: 18, discountPercent: 0,
            amount: 0, discountAmount: 0, taxableAmount: 0, taxAmount: 0
        }]);
    };

    const removeItemRow = (index: number) => {
        setInvoiceItems(invoiceItems.filter((_, i) => i !== index));
    };

    // Same maths as the server, so what you see is exactly what gets saved.
    const party = ledgers.find(l => l.id === formData.partyLedgerId);
    const partyState = party?.state || '';
    const info = docInfo(type || 'SALES');
    const supply = formData.supplyType || (info.sales && party?.gst_registration_type === 'SEZ' ? 'SEZ_WPAY' : info.sales && party?.gst_registration_type === 'OVERSEAS' ? 'EXPORT_WPAY' : 'NORMAL');
    const isExport = supply.startsWith('EXPORT');
    const isInterState = (supply !== 'NORMAL' && supply !== 'DEEMED_EXPORT') ||
        isInterStateSupply(companyState, formData.placeOfSupply || (isExport ? 'Foreign Country' : partyState || companyState));
    const rcm = type === 'PURCHASE' && formData.reverseCharge;
    // Same maths as the server, so what you see is exactly what gets saved.
    const preview = (() => {
        try {
            const roundOff = selectedCompany?.round_off_invoices ?? true;
            const calc = calculateInvoice(
                invoiceItems.filter(i => Number(i.quantity) > 0),
                {
                    isInterState,
                    invoiceDiscountPercent: formData.discountPercent,
                    roundOff: roundOff && !rcm,
                    withoutPayment: supply === 'SEZ_WOPAY' || supply === 'EXPORT_WOPAY',
                }
            );
            if (!rcm) return calc;
            // Reverse charge: the supplier is paid without GST
            const payable = calc.subtotal;
            const rounded = roundOff ? Math.round(payable) : payable;
            return { ...calc, roundOff: Math.round((rounded - payable) * 100) / 100, grandTotal: rounded };
        } catch {
            return null;
        }
    })();
    const tdsAmount = type === 'PURCHASE' && Number(formData.tdsRate) > 0 && preview ? Math.round((preview.subtotal * Number(formData.tdsRate)) / 100) : 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCompany || !type) return;
        setLoading(true);

        const payload = {
            companyId: selectedCompany.id,
            type,
            ...formData,
            supplyType: formData.supplyType || null,
            tdsRate: Number(formData.tdsRate || 0),
            transportMode: formData.transportMode || null,
            transportDistanceKm: formData.transportDistanceKm === '' ? null : Number(formData.transportDistanceKm),
            items: invoiceItems.map(item => ({
                itemId: item.itemId || null,
                description: item.description,
                quantity: item.quantity,
                rate: item.rate,
                taxRate: item.taxRate,
                discountPercent: item.discountPercent
            }))
        };

        try {
            if (id) {
                await api.put(`/invoices/${id}`, payload);
                notify.success(`${info.label} updated`);
            } else {
                await api.post('/invoices', payload);
                notify.success(`${info.label} saved`);
            }
            navigate(`/invoices?type=${type}`);
        } catch (error: any) {
            console.error('Failed to save document', error);
            notify.error(apiError(error, `Could not save the ${info.label.toLowerCase()}`));
        } finally {
            setLoading(false);
        }
    };

    const subtotal = preview ? preview.gross - preview.lineDiscount : 0;
    const invoiceDiscount = preview?.invoiceDiscount ?? 0;
    const grandTotal = preview?.grandTotal ?? 0;
    const gst = { isInterState, igst: preview?.igst ?? 0, cgst: preview?.cgst ?? 0, sgst: preview?.sgst ?? 0 };

    if (!type && !id) return <div>Loading...</div>; // Should not happen if routed correctly

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">
                {id ? 'Edit' : 'New'} {docInfo(type || 'SALES').label}
            </h1>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Header Details */}
                <div className="card grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Party A/c Name</label>
                        <select
                            className="input-field"
                            value={formData.partyLedgerId}
                            onChange={(e) => setFormData({ ...formData, partyLedgerId: e.target.value })}
                            required
                        >
                            <option value="">Select Party</option>
                            {ledgers.map(l => (
                                <option key={l.id} value={l.id}>{l.name} {l.state ? `(${l.state})` : ''}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            {docInfo(type || 'SALES').sales ? 'Sales' : 'Purchase'} Ledger
                        </label>
                        <select
                            className="input-field"
                            value={formData.salesLedgerId}
                            onChange={(e) => setFormData({ ...formData, salesLedgerId: e.target.value })}
                            required
                        >
                            <option value="">Select Ledger</option>
                            {ledgers.map(l => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                        </select>
                    </div>
                    <Input
                        label={NUMBER_LABEL[type ?? 'SALES'] ?? `${info.label} No.`}
                        value={formData.invoiceNumber}
                        onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                        placeholder="Auto"
                        maxLength={type === 'PURCHASE' || type === 'PURCHASE_ORDER' ? 50 : 16}
                    />
                    <Input
                        label="Date"
                        type="date"
                        value={formData.date}
                        onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                        required
                    />
                    <Input
                        label="Due Date"
                        type="date"
                        value={formData.dueDate}
                        onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                    />
                    {type === 'QUOTATION' && (
                        <Input
                            label="Valid Until"
                            type="date"
                            value={formData.validUntil}
                            onChange={(e) => setFormData({ ...formData, validUntil: e.target.value })}
                        />
                    )}
                    {(type === 'CREDIT_NOTE' || type === 'DEBIT_NOTE') && (
                        <>
                            <Input
                                label={type === 'DEBIT_NOTE' ? 'Original Bill No.' : 'Original Invoice No.'}
                                value={formData.originalInvoiceNumber}
                                onChange={(e) => setFormData({ ...formData, originalInvoiceNumber: e.target.value })}
                            />
                            <Input
                                label={type === 'DEBIT_NOTE' ? 'Original Bill Date' : 'Original Invoice Date'}
                                type="date"
                                value={formData.originalInvoiceDate}
                                onChange={(e) => setFormData({ ...formData, originalInvoiceDate: e.target.value })}
                            />
                        </>
                    )}
                </div>

                {/* GST & TDS */}
                <div className="card grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">Place of supply</label>
                        <select className="input-field" value={formData.placeOfSupply} onChange={(e) => setFormData({ ...formData, placeOfSupply: e.target.value })}>
                            <option value="">{isExport ? 'Foreign Country (export)' : `Party's state${partyState ? ` (${partyState})` : ''}`}</option>
                            {gstMeta.states.map((st) => (
                                <option key={st.code} value={st.name}>{st.code} – {st.name}</option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-slate-500">{isInterState ? 'Inter-state: IGST' : 'Intra-state: CGST + SGST'}</p>
                    </div>
                    {info.sales && (
                        <div>
                            <label className="mb-1 block text-sm font-medium text-slate-700">Type of supply</label>
                            <select className="input-field" value={formData.supplyType || supply} onChange={(e) => setFormData({ ...formData, supplyType: e.target.value === 'NORMAL' ? '' : e.target.value })}>
                                <option value="NORMAL">Regular (domestic)</option>
                                <option value="SEZ_WPAY">SEZ – with payment of IGST</option>
                                <option value="SEZ_WOPAY">SEZ – without payment (LUT)</option>
                                <option value="EXPORT_WPAY">Export – with payment of IGST</option>
                                <option value="EXPORT_WOPAY">Export – without payment (LUT)</option>
                                <option value="DEEMED_EXPORT">Deemed export</option>
                            </select>
                        </div>
                    )}
                    {isExport && (
                        <>
                            <Input label="Shipping bill no." value={formData.shippingBillNumber} onChange={(e) => setFormData({ ...formData, shippingBillNumber: e.target.value })} />
                            <Input label="Shipping bill date" type="date" value={formData.shippingBillDate} onChange={(e) => setFormData({ ...formData, shippingBillDate: e.target.value })} />
                            <Input label="Port code" placeholder="INNSA1" value={formData.portCode} onChange={(e) => setFormData({ ...formData, portCode: e.target.value.toUpperCase() })} />
                        </>
                    )}
                    {type === 'PURCHASE' && (
                        <>
                            <label className="flex items-center gap-2 self-center text-sm text-slate-700">
                                <input type="checkbox" checked={formData.reverseCharge} onChange={(e) => setFormData({ ...formData, reverseCharge: e.target.checked })} />
                                Reverse charge (we pay the GST)
                            </label>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-slate-700">TDS</label>
                                <select
                                    className="input-field"
                                    value={formData.tdsSection}
                                    onChange={(e) => {
                                        const sec = gstMeta.tdsSections.find((t) => t.code === e.target.value);
                                        setFormData({ ...formData, tdsSection: e.target.value, tdsRate: sec ? sec.rate : 0 });
                                    }}
                                >
                                    <option value="">No TDS</option>
                                    {gstMeta.tdsSections.map((t) => (
                                        <option key={t.code} value={t.code}>{t.label}</option>
                                    ))}
                                </select>
                            </div>
                            {formData.tdsSection && (
                                <Input label="TDS rate %" type="number" step="0.001" min="0" max="30" value={formData.tdsRate} onChange={(e) => setFormData({ ...formData, tdsRate: Number(e.target.value) })} />
                            )}
                        </>
                    )}
                </div>

                {/* Transport (for the e-way bill) */}
                {(type === 'SALES' || type === 'SALES_ORDER') && (
                    <details className="card" open={!!formData.transportMode}>
                        <summary className="cursor-pointer text-sm font-medium text-slate-700">Transport details (needed for an e-way bill when goods are worth more than ₹50,000)</summary>
                        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-slate-700">Mode</label>
                                <select className="input-field" value={formData.transportMode} onChange={(e) => setFormData({ ...formData, transportMode: e.target.value })}>
                                    <option value="">Not specified</option>
                                    <option value="ROAD">Road</option>
                                    <option value="RAIL">Rail</option>
                                    <option value="AIR">Air</option>
                                    <option value="SHIP">Ship</option>
                                </select>
                            </div>
                            <Input label="Vehicle number" placeholder="MH12AB1234" value={formData.vehicleNumber} onChange={(e) => setFormData({ ...formData, vehicleNumber: e.target.value.toUpperCase() })} />
                            <Input label="Distance (km, 0 = auto)" type="number" min="0" value={formData.transportDistanceKm} onChange={(e) => setFormData({ ...formData, transportDistanceKm: e.target.value })} />
                            <Input label="Transporter ID" value={formData.transporterId} onChange={(e) => setFormData({ ...formData, transporterId: e.target.value.toUpperCase() })} />
                            <Input label="Transporter name" value={formData.transporterName} onChange={(e) => setFormData({ ...formData, transporterName: e.target.value })} />
                        </div>
                    </details>
                )}

                {/* Items Table */}
                <div className="card overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[1000px]">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                                <th className="py-2 px-3 w-1/5">Item</th>
                                <th className="py-2 px-3 w-20 text-right">Qty</th>
                                <th className="py-2 px-3 w-24 text-right">Rate</th>
                                <th className="py-2 px-3 w-24 text-right">Amount</th>
                                <th className="py-2 px-3 w-20 text-right">Disc %</th>
                                <th className="py-2 px-3 w-24 text-right">Taxable</th>
                                <th className="py-2 px-3 w-20 text-right">Tax %</th>
                                <th className="py-2 px-3 w-24 text-right">Tax Amt</th>
                                <th className="py-2 px-3 w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoiceItems.map((item, index) => (
                                <tr key={index} className="border-b border-slate-100">
                                    <td className="p-2">
                                        <select
                                            className="input-field py-1"
                                            value={item.itemId}
                                            onChange={(e) => handleItemChange(index, 'itemId', e.target.value)}
                                            required
                                        >
                                            <option value="">Select Item</option>
                                            {items.map(i => (
                                                <option key={i.id} value={i.id}>{i.name}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <input
                                            type="number"
                                            className="input-field py-1 text-right"
                                            value={item.quantity}
                                            onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                                            min="0.001"
                                            step="0.001"
                                            required
                                        />
                                    </td>
                                    <td className="p-2">
                                        <input
                                            type="number"
                                            className="input-field py-1 text-right"
                                            value={item.rate}
                                            onChange={(e) => handleItemChange(index, 'rate', Number(e.target.value))}
                                            min="0"
                                            step="0.01"
                                            required
                                        />
                                    </td>
                                    <td className="p-2 text-right tabular-nums text-slate-700">
                                        {amount(item.amount)}
                                    </td>
                                    <td className="p-2">
                                        <input
                                            type="number"
                                            className="input-field py-1 text-right"
                                            value={item.discountPercent}
                                            onChange={(e) => handleItemChange(index, 'discountPercent', Number(e.target.value))}
                                            min="0"
                                            max="100"
                                            step="0.01"
                                        />
                                    </td>
                                    <td className="p-2 text-right tabular-nums text-slate-700">
                                        {amount(item.taxableAmount)}
                                    </td>
                                    <td className="p-2 text-right text-slate-600">
                                        {item.taxRate}%
                                    </td>
                                    <td className="p-2 text-right tabular-nums text-slate-700">
                                        {amount(item.taxAmount)}
                                    </td>
                                    <td className="p-2 text-center">
                                        <button
                                            type="button"
                                            onClick={() => removeItemRow(index)}
                                            className="text-slate-400 hover:text-red-500"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="mt-4">
                        <Button type="button" variant="secondary" onClick={addItemRow}>
                            <Plus className="w-4 h-4" /> Add Item
                        </Button>
                    </div>
                </div>

                {/* Footer / Totals */}
                <div className="card bg-slate-50">
                    <div className="flex justify-between items-start">
                        <div className="w-full sm:w-1/2">
                            <Input
                                label="Overall Discount %"
                                type="number"
                                value={formData.discountPercent}
                                onChange={(e) => setFormData({ ...formData, discountPercent: Number(e.target.value) })}
                                min="0"
                                max="100"
                                step="0.01"
                            />
                        </div>
                        <div className="w-full sm:w-96 space-y-2">
                            <div className="flex justify-between text-slate-600">
                                <span>Subtotal:</span>
                                <span className="tabular-nums">{inr(subtotal)}</span>
                            </div>
                            {invoiceDiscount > 0 && (
                                <>
                                    <div className="flex justify-between text-slate-600">
                                        <span>Overall Discount ({formData.discountPercent}%):</span>
                                        <span className="tabular-nums">-{inr(invoiceDiscount)}</span>
                                    </div>
                                    <div className="flex justify-between text-slate-600">
                                        <span>Taxable Value:</span>
                                        <span className="tabular-nums">{inr((preview?.subtotal ?? 0))}</span>
                                    </div>
                                </>
                            )}

                            {/* GST Breakdown */}
                            {gst.isInterState ? (
                                <div className="flex justify-between text-slate-600">
                                    <span>IGST:</span>
                                    <span className="tabular-nums">{inr(gst.igst)}</span>
                                </div>
                            ) : (
                                <>
                                    <div className="flex justify-between text-slate-600">
                                        <span>CGST:</span>
                                        <span className="tabular-nums">{inr(gst.cgst)}</span>
                                    </div>
                                    <div className="flex justify-between text-slate-600">
                                        <span>SGST:</span>
                                        <span className="tabular-nums">{inr(gst.sgst)}</span>
                                    </div>
                                </>
                            )}


                            {preview && preview.roundOff !== 0 && (
                                <div className="flex justify-between text-slate-600">
                                    <span>Round Off:</span>
                                    <span className="tabular-nums">{preview.roundOff > 0 ? '+' : '-'}{inr(Math.abs(preview.roundOff))}</span>
                                </div>
                            )}
                            <div className="flex justify-between font-bold text-lg text-slate-800 border-t border-slate-300 pt-2">
                                <span>Grand Total:</span>
                                <span className="tabular-nums">{inr(grandTotal)}</span>
                            </div>
                            {rcm && preview && (
                                <p className="text-xs text-amber-700">GST of {inr(preview.taxTotal)} is payable by you under reverse charge (not paid to the supplier).</p>
                            )}
                            {tdsAmount > 0 && (
                                <>
                                    <div className="flex justify-between text-slate-600">
                                        <span>Less TDS ({formData.tdsSection} @ {formData.tdsRate}%):</span>
                                        <span className="tabular-nums">-{inr(tdsAmount)}</span>
                                    </div>
                                    <div className="flex justify-between font-semibold text-slate-800">
                                        <span>Payable to supplier:</span>
                                        <span className="tabular-nums">{inr((grandTotal - tdsAmount))}</span>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="mt-6 flex justify-end gap-4">
                        <Button type="button" variant="secondary" onClick={() => navigate(`/invoices?type=${type}`)}>
                            Cancel
                        </Button>
                        <Button type="submit" isLoading={loading}>
                            <Save className="w-4 h-4" />
                            {id ? `Update ${info.label}` : `Save ${info.label}`}
                        </Button>
                    </div>
                </div>
            </form>
        </div>
    );
};
