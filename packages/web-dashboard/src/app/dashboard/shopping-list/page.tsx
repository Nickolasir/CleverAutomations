"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useShoppingList } from "@/hooks/useShoppingList";

export default function ShoppingListPage() {
  const { tenantId } = useAuth();
  const {
    uncheckedItems,
    checkedItems,
    loading,
    error,
    addItem,
    removeItem,
    checkItem,
    uncheckItem,
    clearChecked,
  } = useShoppingList(tenantId);

  const [newItemName, setNewItemName] = useState("");
  const [newItemQty, setNewItemQty] = useState(1);
  const [showChecked, setShowChecked] = useState(false);

  const handleAddItem = async () => {
    const name = newItemName.trim();
    if (!name) return;
    await addItem(name, newItemQty);
    setNewItemName("");
    setNewItemQty(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      void handleAddItem();
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Shopping List</h1>
        <div className="animate-pulse text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Shopping List</h1>
        <span className="text-sm text-slate-400">
          {uncheckedItems.length} item{uncheckedItems.length !== 1 ? "s" : ""} remaining
        </span>
      </div>

      {error && (
        <div className="rounded-lg bg-red-900/20 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Quick Add */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Add item to shopping list..."
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 rounded-lg bg-card-bg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
        <input
          type="number"
          min="1"
          value={newItemQty}
          onChange={(e) => setNewItemQty(parseInt(e.target.value) || 1)}
          className="w-16 rounded-lg bg-card-bg px-3 py-2.5 text-sm text-white text-center"
        />
        <button
          onClick={() => void handleAddItem()}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Add
        </button>
      </div>

      {/* Unchecked Items */}
      <div className="space-y-1">
        {uncheckedItems.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-lg bg-card-bg px-4 py-3 hover:bg-white/5"
          >
            <button
              onClick={() => void checkItem(item.id)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-500 hover:border-brand-500"
            />
            <div className="flex-1">
              <span className="text-sm text-white">{item.name}</span>
              {item.quantity > 1 && (
                <span className="ml-2 text-xs text-slate-400">
                  x{item.quantity}
                </span>
              )}
            </div>
            <span className="text-xs text-slate-500 capitalize">
              {item.added_via === "auto_restock" ? "auto" : item.added_via}
            </span>
            <button
              onClick={() => void removeItem(item.id)}
              className="text-slate-500 hover:text-red-400"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}

        {uncheckedItems.length === 0 && (
          <div className="rounded-lg bg-card-bg px-4 py-8 text-center text-slate-400 text-sm">
            Your shopping list is empty. Add items above or say &quot;Hey
            CleverHub, add milk to the shopping list.&quot;
          </div>
        )}
      </div>

      {/* Checked Items */}
      {checkedItems.length > 0 && (
        <div>
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowChecked(!showChecked)}
              className="text-sm text-slate-400 hover:text-white"
            >
              {showChecked ? "Hide" : "Show"} purchased ({checkedItems.length})
            </button>
            <button
              onClick={() => void clearChecked()}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Clear purchased
            </button>
          </div>

          {showChecked && (
            <div className="mt-2 space-y-1">
              {checkedItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg bg-card-bg/50 px-4 py-2.5"
                >
                  <button
                    onClick={() => void uncheckItem(item.id)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-brand-500 bg-brand-600"
                  >
                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </button>
                  <span className="flex-1 text-sm text-slate-500 line-through">
                    {item.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
