import React, { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Plus, Trash2, Save } from 'lucide-react';
import api from '../../api/axios';
import { useNavigate, useParams } from 'react-router-dom';

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
        cronExpression: '0 0 1 * *', // Default: 1st of every month
        nextInvoiceDate: new Date().toISOString().split('T')[0],
        partyLedgerId: '',
        salesLedgerId: '',
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
                // We need to implement GET /recurring-invoices/:id in backend first or filter from list
                // For now, assuming we can get it from the list endpoint or a specific endpoint
                // Let's use the list endpoint with a filter if needed, or better, add a specific endpoint.
                // Actually, I didn't add GET /recurring-invoices/:id in the backend plan explicitly, 
                // but I should have. Let's assume I can fetch it. 
                // Wait, I only added GET /recurring-invoices (list). 
                // I should probably add GET /recurring-invoices/:id to backend or just filter client side if list is small.
                // For robustness, I'll filter from the list endpoint for now to avoid backend changes if possible, 
                // but fetching by ID is better. 
                // Let's try to fetch all and find.
                const res = await api.get(`/recurring-invoices?companyId=${selectedCompany?.id}`);
                const invoice = res.data.data.recurringInvoices.find((r: any) => r.id === id);

                if (invoice) {
                    setFormData({
                        profileName: invoice.profile_name,
                        cronExpression: invoice.cron_expression,
                        nextInvoiceDate: new Date(invoice.next_invoice_date).toISOString().split('T')[0],
                        partyLedgerId: invoice.party_ledger_id,
                        salesLedgerId: invoice.sales_ledger_id,
                        isActive: invoice.is_active
                    });
                    // Note: The list endpoint might not return items. 
                    // If items are missing, we can't edit properly. 
                    // I should check if I need to update the backend to return items or add a detail endpoint.
                    // The `getRecurringInvoices` controller does join items.
                    // Let's check the controller code.
                    // It does: `const itemsResult = await client.query('SELECT * FROM recurring_invoice_items WHERE recurring_invoice_id = ANY($1)', [ids]);`
                    // So it returns items attached to the invoice object? 
                    // The controller maps them: `...inv, items: invoiceItems`
                    // Yes, it returns items.

                    setInvoiceItems(invoice.items.map((item: any) => ({
                        itemId: item.item_id,
                        description: item.description,
                        quantity: Number(item.quantity),
                        rate: Number(item.rate),
                        taxRate: Number(item.tax_rate || 18),
                        discountPercent: Number(item.discount_percent || 0),
                        amount: Number(item.amount)
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
                // Update not fully implemented in backend yet? 
                // I added `updateRecurringInvoice` in controller.
                // Route is PATCH /recurring-invoices/:id for status, but maybe I need PUT for full update?
                // The controller has `updateRecurringInvoice` which handles full update.
                // Route: `router.put('/:id', protect, updateRecurringInvoice);`
                // Wait, did I add PUT?
                // In `recurringInvoiceRoutes.ts`: `router.put('/:id', protect, updateRecurringInvoice);`
                // Yes, I did.
                await api.put(`/recurring-invoices/${id}`, payload);
                alert('Recurring invoice updated successfully!');
            } else {
                await api.post('/recurring-invoices', payload);
                alert('Recurring invoice created successfully!');
            }
            navigate('/recurring-invoices');
        } catch (error: any) {
            console.error('Failed to save recurring invoice', error);
            alert(error.response?.data?.message || 'Failed to save recurring invoice');
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
                        required
                    />
                    <Input
                        label="Cron Expression"
                        value={formData.cronExpression}
                        onChange={(e) => setFormData({ ...formData, cronExpression: e.target.value })}
                        placeholder="0 0 1 * * (At 00:00 on day-of-month 1)"
                        required
                    />
                    <p className="text-xs text-slate-500 col-span-2">
                        Common examples: "0 0 1 * *" (Monthly on 1st), "0 0 * * 1" (Weekly on Monday), "0 0 1 1 *" (Yearly on Jan 1st)
                    </p>
                    <Input
                        label="Next Invoice Date"
                        type="date"
                        value={formData.nextInvoiceDate}
                        onChange={(e) => setFormData({ ...formData, nextInvoiceDate: e.target.value })}
                        required
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
                                    <td className="p-2 text-right font-mono text-slate-700">
                                        {item.amount.toFixed(2)}
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
