import React, { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Plus, Trash2, Save } from 'lucide-react';
import api from '../../api/axios';
import { useNavigate, useParams } from 'react-router-dom';
import { notify } from '../../utils/notification';
import { amount } from '../../lib/format';

interface Ledger {
    id: string;
    name: string;
    state?: string;
}

interface Item {
    id: string;
    name: string;
    sales_rate: number;
    tax_rate: number;
}

interface InvoiceItem {
    itemId: string;
    description: string;
    quantity: number;
    rate: number;
    taxRate: number;
    discountPercent: number;
    amount: number;
}

export const RecurringInvoiceEntry: React.FC = () => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const [ledgers, setLedgers] = useState<Ledger[]>([]);
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState({
        profileName: '',
        frequency: 'MONTHLY',
        startDate: new Date().toISOString().split('T')[0],
        endDate: '',
        nextInvoiceDate: new Date().toISOString().split('T')[0],
        partyLedgerId: '',
        salesLedgerId: '',
        notes: '',
        discountPercent: 0,
        isActive: true
    });

    const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([
        {
            itemId: '', description: '', quantity: 1, rate: 0, taxRate: 18, discountPercent: 0,
            amount: 0
        }
    ]);

    useEffect(() => {
        const fetchData = async () => {
            if (!selectedCompany) return;
            try {
                const [ledgersRes, itemsRes] = await Promise.all([
                    api.get(`/ledgers?companyId=${selectedCompany.id}`),
                    api.get(`/inventory/items?companyId=${selectedCompany.id}`)
                ]);
                setLedgers(ledgersRes.data.data.ledgers);
                setItems(itemsRes.data.data.items);
            } catch (error) {
                console.error('Failed to fetch data', error);
            }
        };
        fetchData();
    }, [selectedCompany]);

    useEffect(() => {
        const fetchRecurringInvoice = async () => {
            if (!id) return;
            try {
                const res = await api.get(`/recurring-invoices/${id}`);
                const invoice = res.data.data.recurringInvoice;
                if (invoice) {
                    setFormData({
                        profileName: invoice.profile_name || '',
                        frequency: invoice.frequency,
                        startDate: invoice.start_date,
                        endDate: invoice.end_date || '',
                        nextInvoiceDate: invoice.next_invoice_date,
                        partyLedgerId: invoice.party_ledger_id,
                        salesLedgerId: invoice.sales_ledger_id,
                        notes: invoice.notes || '',
                        discountPercent: Number(invoice.discount_percent || 0),
                        isActive: invoice.is_active
                    });
                    setInvoiceItems(invoice.items.map((item: any) => ({
                        itemId: item.item_id || '',
                        description: item.description || '',
                        quantity: Number(item.quantity),
                        rate: Number(item.rate),
                        taxRate: Number(item.tax_rate ?? 0),
                        discountPercent: Number(item.discount_percent || 0),
                        amount: Number(item.quantity) * Number(item.rate)
                    })));
                }
            } catch (error) {
                console.error('Failed to fetch recurring invoice details', error);
            }
        };
        fetchRecurringInvoice();
    }, [id, selectedCompany]);

    const handleItemChange = (index: number, field: keyof InvoiceItem, value: any) => {
        const newItems = [...invoiceItems];
        const item = newItems[index];

        if (field === 'itemId') {
            const selectedItem = items.find(i => i.id === value);
            if (selectedItem) {
                item.itemId = value;
                item.description = selectedItem.name;
                item.rate = Number(selectedItem.sales_rate);
                item.taxRate = Number(selectedItem.tax_rate);
            }
        } else {
            (item as any)[field] = value;
        }

        item.amount = Number(item.quantity) * Number(item.rate);
        setInvoiceItems(newItems);
    };

    const addItemRow = () => {
        setInvoiceItems([...invoiceItems, {
            itemId: '', description: '', quantity: 1, rate: 0, taxRate: 18, discountPercent: 0,
            amount: 0
        }]);
    };

    const removeItemRow = (index: number) => {
        setInvoiceItems(invoiceItems.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCompany) return;
        setLoading(true);

        const payload = {
            companyId: selectedCompany.id,
            type: 'SALES',
            ...formData,
            endDate: formData.endDate || null,
            nextInvoiceDate: id ? formData.nextInvoiceDate : formData.startDate,
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
                // Update not fully implemented in backend yet? 
                // I added `updateRecurringInvoice` in controller.
                // Route is PATCH /recurring-invoices/:id for status, but maybe I need PUT for full update?
                // The controller has `updateRecurringInvoice` which handles full update.
                // Route: `router.put('/:id', protect, updateRecurringInvoice);`
                // Wait, did I add PUT?
                // In `recurringInvoiceRoutes.ts`: `router.put('/:id', protect, updateRecurringInvoice);`
                // Yes, I did.
                await api.put(`/recurring-invoices/${id}`, payload);
                notify.success('Recurring invoice updated successfully!');
            } else {
                await api.post('/recurring-invoices', payload);
                notify.success('Recurring invoice created successfully!');
            }
            navigate('/recurring-invoices');
        } catch (error: any) {
            console.error('Failed to save recurring invoice', error);
            notify.error(error.response?.data?.message || 'Failed to save recurring invoice');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">
                {id ? 'Edit' : 'New'} Recurring Invoice Template
            </h1>

            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="card grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                        label="Profile Name"
                        value={formData.profileName}
                        onChange={(e) => setFormData({ ...formData, profileName: e.target.value })}
                        placeholder="e.g., Monthly Maintenance"
                    />
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Repeat</label>
                        <select
                            className="input-field"
                            value={formData.frequency}
                            onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                        >
                            <option value="WEEKLY">Every week</option>
                            <option value="MONTHLY">Every month</option>
                            <option value="QUARTERLY">Every 3 months</option>
                            <option value="HALF_YEARLY">Every 6 months</option>
                            <option value="YEARLY">Every year</option>
                        </select>
                    </div>
                    <Input
                        label="First Invoice Date"
                        type="date"
                        value={formData.startDate}
                        onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                        required
                    />
                    {id && (
                        <Input
                            label="Next Invoice Date"
                            type="date"
                            value={formData.nextInvoiceDate}
                            onChange={(e) => setFormData({ ...formData, nextInvoiceDate: e.target.value })}
                            required
                        />
                    )}
                    <Input
                        label="End Date (optional)"
                        type="date"
                        value={formData.endDate}
                        onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    />
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
                        <label className="block text-sm font-medium text-slate-700 mb-1">Sales Ledger</label>
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
                </div>

                <div className="card overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                                <th className="py-2 px-3 w-1/4">Item</th>
                                <th className="py-2 px-3 w-24 text-right">Qty</th>
                                <th className="py-2 px-3 w-32 text-right">Rate</th>
                                <th className="py-2 px-3 w-32 text-right">Amount</th>
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

                <div className="flex justify-end gap-4">
                    <Button type="button" variant="secondary" onClick={() => navigate('/recurring-invoices')}>
                        Cancel
                    </Button>
                    <Button type="submit" isLoading={loading}>
                        <Save className="w-4 h-4" />
                        Save Template
                    </Button>
                </div>
            </form>
        </div>
    );
};
