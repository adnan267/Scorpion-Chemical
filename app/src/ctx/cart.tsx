import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { Product } from '@/lib/types';

export type CartLine = { product: Product; qty: number };

type CartState = {
  /** Who the order is for. Stores and distributors always order for themselves (null). */
  customer: { id: string; name: string } | null;
  lines: CartLine[];
  count: number;
  total: number;
  qtyOf: (productId: string) => number;
  setQty: (product: Product, qty: number) => void;
  setCustomer: (c: { id: string; name: string } | null) => void;
  clear: () => void;
};

const Ctx = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomerState] = useState<{ id: string; name: string } | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);

  const setQty = useCallback((product: Product, qty: number) => {
    setLines((prev) => {
      const rest = prev.filter((l) => l.product.id !== product.id);
      if (qty <= 0) return rest;
      const at = prev.findIndex((l) => l.product.id === product.id);
      if (at === -1) return [...prev, { product, qty }];
      const next = [...prev];
      next[at] = { product, qty };
      return next;
    });
  }, []);

  // prices differ per customer, so changing the customer starts a new order
  const setCustomer = useCallback((c: { id: string; name: string } | null) => {
    setCustomerState((prev) => {
      if ((prev?.id ?? null) !== (c?.id ?? null)) setLines([]);
      return c;
    });
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartState>(() => {
    const total = lines.reduce((s, l) => s + Math.round(l.qty * l.product.net_rate * (100 - l.product.discount_pct)) / 100, 0);
    return {
      customer,
      lines,
      count: lines.reduce((s, l) => s + l.qty, 0),
      total,
      qtyOf: (id) => lines.find((l) => l.product.id === id)?.qty ?? 0,
      setQty,
      setCustomer,
      clear,
    };
  }, [customer, lines, setQty, setCustomer, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): CartState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCart must be used inside CartProvider');
  return v;
}
