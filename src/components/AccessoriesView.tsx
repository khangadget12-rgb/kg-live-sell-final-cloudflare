import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Edit3, X } from 'lucide-react';
import type { AccessoryCategory, AccessoryRecord, UserPreferences, UserRole } from '../lib/types';
import { formatCurrency } from '../lib/formatters';
import { api } from '../services/api';

interface AccessoriesViewProps {
  accessories: AccessoryRecord[];
  userRole: UserRole;
  preferences: UserPreferences;
  onRefresh: () => Promise<void>;
}

const CATEGORIES: AccessoryCategory[] = ['RAM', 'SSD', 'Adapter', 'Bag', 'Accessory'];

export const AccessoriesView: React.FC<AccessoriesViewProps> = ({ accessories, userRole, preferences, onRefresh }) => {
  const canEdit = userRole !== 'staff';
  const [catFilter, setCatFilter] = useState<AccessoryCategory | 'ALL'>('ALL');
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<AccessoryRecord | null>(null);

  const [brand, setBrand] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<AccessoryCategory>('RAM');
  const [spec, setSpec] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [rg, setRg] = useState('0');
  const [nm, setNm] = useState('0');
  const [jsm, setJsm] = useState('0');
  const [cc, setCc] = useState('0');
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(
    () => accessories.filter((a) => catFilter === 'ALL' || a.category === catFilter),
    [accessories, catFilter]
  );

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createAccessory({
        brand,
        name,
        category,
        spec,
        unitPrice: Number(unitPrice || 0),
        rg: Number(rg || 0),
        nm: Number(nm || 0),
        jsm: Number(jsm || 0),
        cc: Number(cc || 0),
      });
      setAddOpen(false);
      setBrand('');
      setName('');
      setSpec('');
      setUnitPrice('');
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;
    setSaving(true);
    try {
      await api.updateAccessory(editItem.id, {
        unitPrice: editItem.unitPrice,
        rg: editItem.rg,
        nm: editItem.nm,
        jsm: editItem.jsm,
        cc: editItem.cc,
      });
      setEditItem(null);
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    await api.deleteAccessory(id);
    await onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setCatFilter('ALL')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
              catFilter === 'ALL' ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            All ({accessories.length})
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCatFilter(c)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                catFilter === c ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow-sm' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 hidden sm:inline">
            Catalog &amp; branch quantity management only (not sold via Live Sell)
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Catalog Item</span>
            </button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-500">
                <th className="py-3 px-4 font-semibold">Brand &amp; Item</th>
                <th className="py-3 px-3 font-semibold">Category</th>
                <th className="py-3 px-3 font-semibold">Specification</th>
                <th className="py-3 px-3 text-right font-semibold">Unit Price</th>
                <th className="py-3 px-2.5 text-right font-semibold">RG</th>
                <th className="py-3 px-2.5 text-right font-semibold">NM</th>
                <th className="py-3 px-2.5 text-right font-semibold">JSM</th>
                <th className="py-3 px-2.5 text-right font-semibold">CC</th>
                <th className="py-3 px-3 text-right font-semibold">Total</th>
                {canEdit && <th className="py-3 px-4 text-right font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                    {a.brand} {a.name}
                  </td>
                  <td className="py-3 px-3 text-slate-600 dark:text-slate-300">{a.category}</td>
                  <td className="py-3 px-3 text-slate-500">{a.spec}</td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums">
                    {formatCurrency(a.unitPrice, preferences.currencyFormat)}
                  </td>
                  <td className="py-3 px-2.5 text-right font-mono tabular-nums">{a.rg}</td>
                  <td className="py-3 px-2.5 text-right font-mono tabular-nums">{a.nm}</td>
                  <td className="py-3 px-2.5 text-right font-mono tabular-nums">{a.jsm}</td>
                  <td className="py-3 px-2.5 text-right font-mono tabular-nums">{a.cc}</td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums font-bold">{a.qty}</td>
                  {canEdit && (
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditItem(a)}
                          aria-label={`Edit ${a.name}`}
                          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(a.id)}
                          aria-label={`Delete ${a.name}`}
                          className="p-1.5 rounded-md border border-red-200 dark:border-red-900 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form onSubmit={handleAdd} className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-display font-bold text-base">Add Accessory / RAM / SSD</h3>
              <button type="button" onClick={() => setAddOpen(false)}><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Brand *</label>
                <input required value={brand} onChange={(e) => setBrand(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value as AccessoryCategory)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Item Name *</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Specification</label>
                <input value={spec} onChange={(e) => setSpec(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Unit Price (৳)</label>
                <input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div><label className="block text-xs mb-1">RG</label><input type="number" min={0} value={rg} onChange={(e) => setRg(e.target.value)} className="w-full px-2 py-1.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></div>
              <div><label className="block text-xs mb-1">NM</label><input type="number" min={0} value={nm} onChange={(e) => setNm(e.target.value)} className="w-full px-2 py-1.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></div>
              <div><label className="block text-xs mb-1">JSM</label><input type="number" min={0} value={jsm} onChange={(e) => setJsm(e.target.value)} className="w-full px-2 py-1.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></div>
              <div><label className="block text-xs mb-1">CC</label><input type="number" min={0} value={cc} onChange={(e) => setCc(e.target.value)} className="w-full px-2 py-1.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setAddOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-teal-600 text-white text-xs font-semibold">Add Item</button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Modal */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form onSubmit={handleSaveEdit} className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-display font-bold text-base">Update {editItem.brand} {editItem.name}</h3>
              <button type="button" onClick={() => setEditItem(null)}><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Unit Price (৳)</label>
              <input type="number" min={0} value={editItem.unitPrice} onChange={(e) => setEditItem({ ...editItem, unitPrice: Number(e.target.value) })} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div><label className="block text-xs mb-1">RG</label><input type="number" min={0} value={editItem.rg} onChange={(e) => setEditItem({ ...editItem, rg: Number(e.target.value) })} className="w-full px-2 py-1.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></div>
              <div><label className="block text-xs mb-1">NM</label><input type="number" min={0} value={editItem.nm} onChange={(e) => setEditItem({ ...editItem, nm: Number(e.target.value) })} className="w-full px-2 py-1.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></div>
              <div><label className="block text-xs mb-1">JSM</label><input type="number" min={0} value={editItem.jsm} onChange={(e) => setEditItem({ ...editItem, jsm: Number(e.target.value) })} className="w-full px-2 py-1.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></div>
              <div><label className="block text-xs mb-1">CC</label><input type="number" min={0} value={editItem.cc} onChange={(e) => setEditItem({ ...editItem, cc: Number(e.target.value) })} className="w-full px-2 py-1.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditItem(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-teal-600 text-white text-xs font-semibold">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
