import React, { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Plus, Trash2, Save } from 'lucide-react';
import api from '../../api/axios';
import { useNavigate, useParams } from 'react-router-dom';
import { notify } from '../../utils/notification';

interface Ledger {
    id: string;
    name: string;
    state?: string;
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

export const InvoiceEntry: React.FC<{ type?: 'SALES' | 'PURCHASE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' }> = ({ type: initialType }) => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const [type, setType] = useState<'SALES' | 'PURCHASE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | undefined>(initialType);

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

    const [formData, setFormData] = useState({
        partyLedgerId: '',
        salesLedgerId: '',
        invoiceNumber: '',
        date: new Date().toISOString().split('T')[0],
        dueDate: '',
        notes: '',
        discountPercent: 0,
        originalInvoiceNumber: '',
        originalInvoiceDate: ''
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
                    date: new Date(invoice.date).toISOString().split('T')[0],
                    dueDate: invoice.due_date ? new Date(invoice.due_date).toISOString().split('T')[0] : '',
                    notes: invoice.notes || '',
                    discountPercent: Number(invoice.discount_percent),
                    originalInvoiceNumber: invoice.original_invoice_number || '',
                    originalInvoiceDate: invoice.original_invoice_date ? new Date(invoice.original_invoice_date).toISOString().split('T')[0] : ''
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
                notify.error('Failed to load invoice details');
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
                item.rate = type === 'SALES' ? Number(selectedItem.sales_rate) : Number(selectedItem.purchase_rate);
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

    const calculateTotals = () => {
        const subtotal = invoiceItems.reduce((sum, item) => sum + item.taxableAmount, 0);
        const totalTax = invoiceItems.reduce((sum, item) => sum + item.taxAmount, 0);
        const invoiceDiscount = (subtotal * Number(formData.discountPercent)) / 100;
        const grandTotal = subtotal + totalTax - invoiceDiscount;

        return { subtotal, totalTax, invoiceDiscount, grandTotal };
    };

    const getGSTBreakdown = () => {
        const partyState = ledgers.find(l => l.id === formData.partyLedgerId)?.state || '';
        const isInterState = companyState !== partyState || !companyState || !partyState;

        const totalTax = invoiceItems.reduce((sum, item) => sum + item.taxAmount, 0);

        if (isInterState) {
            return { igst: totalTax, cgst: 0, sgst: 0, isInterState: true };
        } else {
            return { igst: 0, cgst: totalTax / 2, sgst: totalTax / 2, isInterState: false };
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCompany || !type) return;
        setLoading(true);

        const payload = {
            companyId: selectedCompany.id,
            type,
            ...formData,
            items: invoiceItems.map(item => ({
                itemId: item.itemId,
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
                notify.success('Invoice updated successfully!');
            } else {
                await api.post('/invoices', payload);
                alert('Invoice saved successfully!');
            }
            navigate('/invoices');
        } catch (error: any) {
            console.error('Failed to save invoice', error);
            alert(error.response?.data?.message || 'Failed to save invoice');
        } finally {
            setLoading(false);
        }
    };

    const { subtotal, totalTax, invoiceDiscount, grandTotal } = calculateTotals();
    const gst = getGSTBreakdown();

    if (!type && !id) return <div>Loading...</div>; // Should not happen if routed correctly

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">
                {id ? 'Edit' : 'New'} {type === 'SALES' ? 'Sales Invoice' : type === 'PURCHASE' ? 'Purchase Invoice' : type === 'CREDIT_NOTE' ? 'Credit Note' : 'Debit Note'}
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
                            {type === 'SALES' ? 'Sales' : 'Purchase'} Ledger
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
                        label="Invoice No."
                        value={formData.invoiceNumber}
                        onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                        required
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
                    {(type === 'CREDIT_NOTE' || type === 'DEBIT_NOTE') && (
                        <>
                            <Input
                                label="Original Invoice No."
                                value={formData.originalInvoiceNumber}
                                onChange={(e) => setFormData({ ...formData, originalInvoiceNumber: e.target.value })}
                            />
                            <Input
                                label="Original Invoice Date"
                                type="date"
                                value={formData.originalInvoiceDate}
                                onChange={(e) => setFormData({ ...formData, originalInvoiceDate: e.target.value })}
                            />
                        </>
                    )}
                </div>

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
                                    <td className="p-2 text-right font-mono text-slate-700">
                                        {item.amount.toFixed(2)}
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
                                    <td className="p-2 text-right font-mono text-slate-700">
                                        {item.taxableAmount.toFixed(2)}
                                    </td>
                                    <td className="p-2 text-right text-slate-600">
                                        {item.taxRate}%
                                    </td>
                                    <td className="p-2 text-right font-mono text-slate-700">
                                        {item.taxAmount.toFixed(2)}
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
                        <div className="w-1/2">
                            <Input
                                label="Invoice Discount %"
                                type="number"
                                value={formData.discountPercent}
                                onChange={(e) => setFormData({ ...formData, discountPercent: Number(e.target.value) })}
                                min="0"
                                max="100"
                                step="0.01"
                            />
                        </div>
                        <div className="w-96 space-y-2">
                            <div className="flex justify-between text-slate-600">
                                <span>Subtotal:</span>
                                <span className="font-mono">₹{subtotal.toFixed(2)}</span>
                            </div>

                            {/* GST Breakdown */}
                            {gst.isInterState ? (
                                <div className="flex justify-between text-slate-600">
                                    <span>IGST:</span>
                                    <span className="font-mono">₹{gst.igst.toFixed(2)}</span>
                                </div>
                            ) : (
                                <>
                                    <div className="flex justify-between text-slate-600">
                                        <span>CGST:</span>
                                        <span className="font-mono">₹{gst.cgst.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between text-slate-600">
                                        <span>SGST:</span>
                                        <span className="font-mono">₹{gst.sgst.toFixed(2)}</span>
                                    </div>
                                </>
                            )}

                            {invoiceDiscount > 0 && (
                                <div className="flex justify-between text-slate-600">
                                    <span>Invoice Discount ({formData.discountPercent}%):</span>
                                    <span className="font-mono">-₹{invoiceDiscount.toFixed(2)}</span>
                                </div>
                            )}

                            <div className="flex justify-between font-bold text-lg text-slate-800 border-t border-slate-300 pt-2">
                                <span>Grand Total:</span>
                                <span className="font-mono">₹{grandTotal.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                    <div className="mt-6 flex justify-end gap-4">
                        <Button type="button" variant="secondary" onClick={() => navigate('/invoices')}>
                            Cancel
                        </Button>
                        <Button type="submit" isLoading={loading}>
                            <Save className="w-4 h-4" />
                            {id ? 'Update Invoice' : 'Save Invoice'}
                        </Button>
                    </div>
                </div>
            </form>
        </div>
    );
};
