import React, { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Plus, Search, Edit2, Trash2, Package } from 'lucide-react';
import api from '../../api/axios';

interface Unit {
    id: string;
    name: string;
    symbol: string;
}

interface Item {
    id: string;
    name: string;
    hsn_code: string;
    unit_id: string;
    unit_symbol: string;
    tax_rate: number;
    sales_rate: number;
    purchase_rate: number;
    current_quantity: number;
}

export const ItemMaster: React.FC = () => {
    const { selectedCompany } = useCompany();
    const [items, setItems] = useState<Item[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const [loading, setLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [showUnitModal, setShowUnitModal] = useState(false);
    const [editingItem, setEditingItem] = useState<Item | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        hsnCode: '',
        unitId: '',
        taxRate: 18,
        salesRate: 0,
        purchaseRate: 0,
        openingQuantity: 0
    });

    const [unitFormData, setUnitFormData] = useState({
        name: '',
        symbol: ''
    });

    const fetchData = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const [itemsRes, unitsRes] = await Promise.all([
                api.get(`/inventory/items?companyId=${selectedCompany.id}`),
                api.get(`/inventory/units?companyId=${selectedCompany.id}`)
            ]);
            console.log("items", itemsRes);
            console.log("units", unitsRes);
            setItems(itemsRes.data.data.items);
            setUnits(unitsRes.data.data.units);
            console.log(units);
            if (unitsRes.data.data.units.length > 0) {
                setFormData(prev => ({ ...prev, unitId: unitsRes.data.data.units[0].id }));
            }
        } catch (error) {
            console.error('Failed to fetch data', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [selectedCompany]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCompany) return;

        try {
            if (editingItem) {
                await api.put(`/inventory/items/${editingItem.id}`, {
                    ...formData,
                    companyId: selectedCompany.id
                });
            } else {
                await api.post('/inventory/items', {
                    ...formData,
                    companyId: selectedCompany.id
                });
            }
            await fetchData();
            handleCloseModal();
        } catch (error) {
            console.error('Failed to save item', error);
            alert('Failed to save item');
        }
    };

    const handleUnitSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCompany) return;

        try {
            const response = await api.post('/inventory/units', {
                ...unitFormData,
                companyId: selectedCompany.id
            });

            const newUnit = response.data.data.unit;
            setUnits([...units, newUnit]);
            setFormData({ ...formData, unitId: newUnit.id });
            setShowUnitModal(false);
            setUnitFormData({ name: '', symbol: '' });
            alert('Unit created successfully!');
        } catch (error) {
            console.error('Failed to create unit', error);
            alert('Failed to create unit');
        }
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingItem(null);
        setFormData({
            name: '',
            hsnCode: '',
            unitId: units[0]?.id || '',
            taxRate: 18,
            salesRate: 0,
            purchaseRate: 0,
            openingQuantity: 0
        });
    };

    const handleEdit = (item: Item) => {
        setEditingItem(item);
        setFormData({
            name: item.name,
            hsnCode: item.hsn_code,
            unitId: item.unit_id,
            taxRate: Number(item.tax_rate),
            salesRate: Number(item.sales_rate),
            purchaseRate: Number(item.purchase_rate),
            openingQuantity: 0 // Cannot edit opening qty after creation usually
        });
        setShowModal(true);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Inventory Items</h1>
                <Button onClick={() => setShowModal(true)}>
                    <Plus className="w-4 h-4" />
                    New Item
                </Button>
            </div>

            <div className="card overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="py-3 px-4 font-semibold text-slate-600">Item Name</th>
                            <th className="py-3 px-4 font-semibold text-slate-600">HSN/SAC</th>
                            <th className="py-3 px-4 font-semibold text-slate-600 text-right">Stock</th>
                            <th className="py-3 px-4 font-semibold text-slate-600 text-right">Rate</th>
                            <th className="py-3 px-4 font-semibold text-slate-600 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr><td colSpan={5} className="text-center py-8 text-slate-500">No items found</td></tr>
                        ) : (
                            items.map((item) => (
                                <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                                    <td className="py-3 px-4 font-medium text-slate-800">
                                        <div className="flex items-center gap-2">
                                            <Package className="w-4 h-4 text-slate-400" />
                                            {item.name}
                                        </div>
                                    </td>
                                    <td className="py-3 px-4 text-slate-600">{item.hsn_code}</td>
                                    <td className="py-3 px-4 text-right font-mono">
                                        {Number(item.current_quantity)} {item.unit_symbol}
                                    </td>
                                    <td className="py-3 px-4 text-right font-mono">
                                        ₹{Number(item.sales_rate).toLocaleString()}
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                        <button onClick={() => handleEdit(item)} className="p-1 text-slate-400 hover:text-primary">
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Item Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6">
                        <h2 className="text-xl font-bold text-slate-800 mb-4">
                            {editingItem ? 'Edit Item' : 'Create New Item'}
                        </h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <Input
                                        label="Item Name"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        required
                                    />
                                </div>
                                <Input
                                    label="HSN/SAC Code"
                                    value={formData.hsnCode}
                                    onChange={(e) => setFormData({ ...formData, hsnCode: e.target.value })}
                                />
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
                                    <div className="flex gap-2">
                                        <select
                                            className="input-field flex-1"
                                            value={formData.unitId}
                                            onChange={(e) => setFormData({ ...formData, unitId: e.target.value })}
                                            required
                                        >
                                            {units.length === 0 && <option value="">No units available</option>}
                                            {units.map(u => (
                                                <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>
                                            ))}
                                        </select>
                                        <button
                                            type="button"
                                            onClick={() => setShowUnitModal(true)}
                                            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors flex items-center gap-1"
                                            title="Add new unit"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                                <Input
                                    label="Tax Rate (%)"
                                    type="number"
                                    value={formData.taxRate}
                                    onChange={(e) => setFormData({ ...formData, taxRate: Number(e.target.value) })}
                                />
                                <Input
                                    label="Sales Rate"
                                    type="number"
                                    value={formData.salesRate}
                                    onChange={(e) => setFormData({ ...formData, salesRate: Number(e.target.value) })}
                                />
                                <Input
                                    label="Purchase Rate"
                                    type="number"
                                    value={formData.purchaseRate}
                                    onChange={(e) => setFormData({ ...formData, purchaseRate: Number(e.target.value) })}
                                />
                                {!editingItem && (
                                    <Input
                                        label="Opening Quantity"
                                        type="number"
                                        value={formData.openingQuantity}
                                        onChange={(e) => setFormData({ ...formData, openingQuantity: Number(e.target.value) })}
                                    />
                                )}
                            </div>

                            <div className="flex justify-end gap-3 mt-6">
                                <Button type="button" variant="secondary" onClick={handleCloseModal}>
                                    Cancel
                                </Button>
                                <Button type="submit">
                                    {editingItem ? 'Update Item' : 'Create Item'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Quick Add Unit Modal */}
            {showUnitModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-slate-800 mb-4">Create New Unit</h2>
                        <form onSubmit={handleUnitSubmit} className="space-y-4">
                            <Input
                                label="Unit Name"
                                placeholder="e.g., Pieces, Kilograms"
                                value={unitFormData.name}
                                onChange={(e) => setUnitFormData({ ...unitFormData, name: e.target.value })}
                                required
                            />
                            <Input
                                label="Symbol"
                                placeholder="e.g., Pcs, Kg"
                                value={unitFormData.symbol}
                                onChange={(e) => setUnitFormData({ ...unitFormData, symbol: e.target.value })}
                                required
                            />
                            <div className="flex justify-end gap-3 mt-6">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => {
                                        setShowUnitModal(false);
                                        setUnitFormData({ name: '', symbol: '' });
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button type="submit">
                                    Create Unit
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
