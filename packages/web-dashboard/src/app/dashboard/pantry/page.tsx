"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePantry } from "@/hooks/usePantry";
import type { PantryItemCategory, PantryLocation } from "@clever/shared";

const LOCATIONS: PantryLocation[] = ["pantry", "fridge", "freezer", "other"];
const CATEGORIES: PantryItemCategory[] = [
  "produce", "dairy", "meat", "seafood", "frozen", "canned",
  "dry_goods", "bakery", "beverages", "snacks", "condiments",
  "spices", "household", "personal_care", "other",
];

export default function PantryPage() {
  const { tenantId } = useAuth();
  const {
    items,
    loading,
    error,
    expiringItems,
    lowStockItems,
    addItem,
    removeItem,
    updateQuantity,
  } = usePantry(tenantId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [filterLocation, setFilterLocation] = useState<PantryLocation | "all">("all");
  const [newItem, setNewItem] = useState({
    name: "",
    quantity: 1,
    unit: "item",
    category: "other" as PantryItemCategory,
    location: "pantry" as PantryLocation,
    expiry_date: "",
  });

  const filteredItems =
    filterLocation === "all"
      ? items
      : items.filter((i) => i.location === filterLocation);

  const handleAddItem = async () => {
    if (!newItem.name.trim()) return;
    await addItem({
      ...newItem,
      expiry_date: newItem.expiry_date || undefined,
    });
    setNewItem({
      name: "",
      quantity: 1,
      unit: "item",
      category: "other",
      location: "pantry",
      expiry_date: "",
    });
    setShowAddForm(false);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">ePantry</h1>
        <div className="animate-pulse text-slate-400">Loading pantry...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">ePantry</h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + Add Item
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-900/20 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg bg-card-bg p-4">
          <p className="text-sm text-slate-400">Total Items</p>
          <p className="mt-1 text-2xl font-bold text-white">{items.length}</p>
        </div>
        <div className="rounded-lg bg-card-bg p-4">
          <p className="text-sm text-slate-400">Expiring Soon</p>
          <p className={`mt-1 text-2xl font-bold ${expiringItems.length > 0 ? "text-amber-400" : "text-white"}`}>
            {expiringItems.length}
          </p>
        </div>
        <div className="rounded-lg bg-card-bg p-4">
          <p className="text-sm text-slate-400">Low Stock</p>
          <p className={`mt-1 text-2xl font-bold ${lowStockItems.length > 0 ? "text-red-400" : "text-white"}`}>
            {lowStockItems.length}
          </p>
        </div>
      </div>

      {/* Expiring Items Alert */}
      {expiringItems.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-900/20 p-4">
          <h3 className="text-sm font-medium text-amber-400">
            Items Expiring Within 3 Days
          </h3>
          <ul className="mt-2 space-y-1">
            {expiringItems.map((item) => (
              <li key={item.id} className="text-sm text-amber-300">
                {item.name} — expires {item.expiry_date}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Add Item Form */}
      {showAddForm && (
        <div className="rounded-lg bg-card-bg p-4 space-y-3">
          <h3 className="text-sm font-medium text-white">Add Pantry Item</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input
              type="text"
              placeholder="Item name"
              value={newItem.name}
              onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
              className="col-span-2 rounded-lg bg-input-bg px-3 py-2 text-sm text-white placeholder-slate-500"
            />
            <input
              type="number"
              min="1"
              value={newItem.quantity}
              onChange={(e) => setNewItem({ ...newItem, quantity: parseInt(e.target.value) || 1 })}
              className="rounded-lg bg-input-bg px-3 py-2 text-sm text-white"
            />
            <input
              type="text"
              placeholder="Unit"
              value={newItem.unit}
              onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
              className="rounded-lg bg-input-bg px-3 py-2 text-sm text-white"
            />
            <select
              value={newItem.category}
              onChange={(e) => setNewItem({ ...newItem, category: e.target.value as PantryItemCategory })}
              className="rounded-lg bg-input-bg px-3 py-2 text-sm text-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <select
              value={newItem.location}
              onChange={(e) => setNewItem({ ...newItem, location: e.target.value as PantryLocation })}
              className="rounded-lg bg-input-bg px-3 py-2 text-sm text-white"
            >
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={newItem.expiry_date}
              onChange={(e) => setNewItem({ ...newItem, expiry_date: e.target.value })}
              className="rounded-lg bg-input-bg px-3 py-2 text-sm text-white"
            />
            <button
              onClick={() => void handleAddItem()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Location Filter */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilterLocation("all")}
          className={`rounded-lg px-3 py-1.5 text-sm ${filterLocation === "all" ? "bg-brand-600 text-white" : "bg-card-bg text-slate-400 hover:text-white"}`}
        >
          All
        </button>
        {LOCATIONS.map((loc) => (
          <button
            key={loc}
            onClick={() => setFilterLocation(loc)}
            className={`rounded-lg px-3 py-1.5 text-sm capitalize ${filterLocation === loc ? "bg-brand-600 text-white" : "bg-card-bg text-slate-400 hover:text-white"}`}
          >
            {loc}
          </button>
        ))}
      </div>

      {/* Items Table */}
      <div className="rounded-lg bg-card-bg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-slate-400">
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3 hidden sm:table-cell">Category</th>
              <th className="px-4 py-3 hidden sm:table-cell">Location</th>
              <th className="px-4 py-3 hidden md:table-cell">Expires</th>
              <th className="px-4 py-3 hidden md:table-cell">Source</th>
              <th className="px-4 py-3 w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredItems.map((item) => (
              <tr key={item.id} className="text-white hover:bg-white/5">
                <td className="px-4 py-3">
                  <div>
                    <span className="font-medium">{item.name}</span>
                    {item.brand && (
                      <span className="ml-1 text-slate-400 text-xs">({item.brand})</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void updateQuantity(item.id, item.quantity - 1)}
                      className="rounded bg-white/10 px-1.5 text-xs hover:bg-white/20"
                    >
                      -
                    </button>
                    <span className="min-w-[2rem] text-center">
                      {item.quantity} {item.unit}
                    </span>
                    <button
                      onClick={() => void updateQuantity(item.id, item.quantity + 1)}
                      className="rounded bg-white/10 px-1.5 text-xs hover:bg-white/20"
                    >
                      +
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs capitalize">
                    {item.category.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell capitalize text-slate-300">
                  {item.location}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-slate-300">
                  {item.expiry_date ?? "—"}
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">
                    {item.source.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => void removeItem(item.id)}
                    className="text-red-400 hover:text-red-300 text-xs"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {filteredItems.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  {items.length === 0
                    ? "Your pantry is empty. Add items manually, scan a receipt, or take a photo of your pantry."
                    : "No items in this location."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
