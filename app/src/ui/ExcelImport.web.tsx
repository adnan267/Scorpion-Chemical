import readXlsxFile from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';
import React, { useRef, useState } from 'react';
import { View } from 'react-native';

import { useDialog } from '@/ctx/dialog';
import { rpc } from '@/lib/api';
import { CUSTOMER_TYPES } from '@/lib/format';
import type { Product, UserRow } from '@/lib/types';
import { Btn, Card, Line, T } from '@/ui/kit';
import { C, S } from '@/ui/theme';

type Row = Record<string, string> & { row: string };
type Payload = { customers: Row[]; bills: Row[]; stock: Row[] };
type Result = { errors: { sheet: string; row: string; message: string }[]; committed: boolean; counts: { customers: number; bills: number; stock: number } };

const COLS = {
  customers: [
    ['name', 'Name'],
    ['type', 'Type'],
    ['owner_name', 'Owner name'],
    ['phone', 'Phone'],
    ['address', 'Address'],
    ['city', 'City'],
    ['order_taker', 'Order taker'],
    ['discount', 'Discount %'],
    ['credit_days', 'Credit days'],
    ['opening_balance', 'Opening balance'],
    ['licence_no', 'Licence no.'],
    ['licence_issued', 'Licence issue date'],
    ['licence_expiry', 'Licence expiry date'],
  ],
  bills: [
    ['customer', 'Customer'],
    ['bill_no', 'Bill no.'],
    ['date', 'Bill date'],
    ['amount', 'Amount'],
    ['paid', 'Already paid'],
    ['due_date', 'Due date'],
  ],
  stock: [
    ['product_id', 'Product ID'],
    ['product', 'Product'],
    ['pack_size', 'Pack size'],
    ['current', 'Stock now'],
    ['qty', 'New stock'],
  ],
} as const;

// other headings people may use for the same column
const ALIASES: Record<string, string> = {
  customername: 'name', customer: 'name', owner: 'owner_name', mobile: 'phone', mobilenumber: 'phone', phoneno: 'phone',
  booker: 'order_taker', ordertakername: 'order_taker', discount: 'discount', balance: 'opening_balance', amountdue: 'opening_balance',
  licencenumber: 'licence_no', licence: 'licence_no', issuedate: 'licence_issued', expirydate: 'licence_expiry',
  billnumber: 'bill_no', invoiceno: 'bill_no', date: 'date', billamount: 'amount', paid: 'paid', duedate: 'due_date',
  productname: 'product', packsize: 'pack_size', stock: 'qty', qty: 'qty', quantity: 'qty',
};

const norm = (s: string) => s.toLowerCase().replace(/license/g, 'licence').replace(/[^a-z0-9]/g, '');

function headerKey(kind: keyof typeof COLS, title: string): string | null {
  const n = norm(title);
  for (const [key, label] of COLS[kind]) if (norm(label) === n || norm(key) === n) return key;
  const a = ALIASES[n];
  if (a && COLS[kind].some(([k]) => k === a)) return a;
  if (kind === 'bills' && n === 'customer') return 'customer';
  if (kind === 'bills' && n === 'customername') return 'customer';
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Excel dates come as Date objects; typed dates are read day first (25/11/2026). */
function cellText(v: unknown, dateCol: boolean): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const s = String(v).trim();
  if (dateCol) {
    const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    }
  }
  return s;
}

const DATE_COLS = new Set(['licence_issued', 'licence_expiry', 'date', 'due_date']);

function readRows(kind: keyof typeof COLS, data: unknown[][]): Row[] {
  if (!data.length) return [];
  const keys = (data[0] ?? []).map((h) => (h === null || h === undefined ? null : headerKey(kind, String(h))));
  const out: Row[] = [];
  data.slice(1).forEach((cells, i) => {
    const r: Row = { row: String(i + 2) } as Row;
    let any = false;
    keys.forEach((k, c) => {
      if (!k || k === 'current') return;
      const t = cellText(cells?.[c], DATE_COLS.has(k));
      if (t !== '') any = true;
      r[k] = t;
    });
    // a stock row with only the product filled in means "leave it"
    if (kind === 'stock' && !(r.qty ?? '')) return;
    if (any) out.push(r);
  });
  return out;
}

export function ExcelImport() {
  const dialog = useDialog();
  const input = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function downloadTemplate() {
    setBusy('template');
    try {
      const [products, users] = await Promise.all([rpc<Product[]>('products_list', { p_customer_id: null }), rpc<UserRow[]>('users_list', {})]);
      const head = (cols: readonly (readonly [string, string])[]) => cols.map(([, label]) => ({ value: label, fontWeight: 'bold' as const, backgroundColor: '#E8EEF7' }));
      const takers = users.filter((u) => u.role === 'order_taker' && u.is_active);
      const help: (string | null)[][] = [
        ['How to fill this file'],
        [],
        ['Customers sheet: one row per customer who is not in the app yet. Only Name is required.'],
        ['  Opening balance: what they owed you before the app (use a minus sign for an advance).'],
        ['  Type: one of ' + CUSTOMER_TYPES.map((t) => t.label).join(', ') + '. Left blank, Consumer is used.'],
        ['  Order taker: the order taker\'s name or mobile number, exactly as below.'],
        ['  Dates: day/month/year, e.g. 25/11/2026.'],
        [],
        ['Old bills sheet: unpaid bills from before the app, one row per bill. Amount only, no products.'],
        ['  Customer must match a name on the Customers sheet or a customer already in the app.'],
        ['  Already paid: if part of the bill was paid before. Due date is optional.'],
        ['  Use either an opening balance or old bills for the same money, not both.'],
        [],
        ['Stock sheet: type the stock you have now in the New stock column. Leave it blank to keep the stock as it is.'],
        ['  Do not change the Product ID column.'],
        [],
        ['Order takers in the app:'],
        ...takers.map((u) => ['  ' + u.full_name + ', ' + u.phone]),
        ...(takers.length ? [] : [['  (none yet)']]),
      ];
      await writeXlsxFile(
        [
          { sheet: 'Customers', data: [head(COLS.customers)], columns: COLS.customers.map(([k]) => ({ width: k === 'name' || k === 'address' ? 28 : 16 })), stickyRowsCount: 1 },
          { sheet: 'Old bills', data: [head(COLS.bills)], columns: COLS.bills.map(([k]) => ({ width: k === 'customer' ? 28 : 16 })), stickyRowsCount: 1 },
          {
            sheet: 'Stock',
            data: [head(COLS.stock), ...products.map((p) => [p.id, p.name, p.pack_size ?? '', Number(p.stock_qty ?? 0), null])],
            columns: [{ width: 38 }, { width: 34 }, { width: 14 }, { width: 12 }, { width: 12 }],
            stickyRowsCount: 1,
          },
          { sheet: 'Help', data: help.map((r) => r.map((v) => v)), columns: [{ width: 110 }] },
        ] as any,
      ).toFile('Scorpion opening data.xlsx');
    } catch (e: any) {
      dialog.toast(e.message ?? 'Could not make the template', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File) {
    setBusy('read');
    setResult(null);
    setPayload(null);
    setFileName(file.name);
    try {
      const sheets = await readXlsxFile(file);
      const find = (name: string) => sheets.find((s) => norm(s.sheet) === norm(name))?.data ?? null;
      const c = find('Customers');
      const b = find('Old bills') ?? find('Bills');
      const s = find('Stock');
      const miss = [!c && 'Customers', !b && 'Old bills', !s && 'Stock'].filter(Boolean) as string[];
      setMissing(miss);
      if (miss.length === 3) throw new Error('This file has none of the sheets Customers, Old bills or Stock. Download the template and fill that in.');
      const p: Payload = { customers: c ? readRows('customers', c) : [], bills: b ? readRows('bills', b) : [], stock: s ? readRows('stock', s) : [] };
      if (!p.customers.length && !p.bills.length && !p.stock.length) throw new Error('The file has no rows to import.');
      const r = await rpc<Result>('import_opening', { p, p_commit: false });
      setPayload(p);
      setResult(r);
    } catch (e: any) {
      setFileName(null);
      dialog.toast(e.message ?? 'Could not read that file', 'error');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  async function commit() {
    if (!payload) return;
    const ok = await dialog.confirm({
      title: 'Import now?',
      message: 'Customers, balances, old bills and stock from this file will be added to the app. This cannot be undone in one step.',
      confirmLabel: 'Import',
    });
    if (!ok) return;
    setBusy('commit');
    try {
      const r = await rpc<Result>('import_opening', { p: payload, p_commit: true });
      setResult(r);
      if (r.committed) {
        dialog.toast('Opening data imported');
        setPayload(null);
      }
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  const c = result?.counts;
  return (
    <View style={{ gap: S.lg }}>
      <Card style={{ gap: 8 }}>
        <T v="h3">1. Download the template</T>
        <T color={C.sub}>It has sheets for customers with opening balances, old bills, and stock. The Stock sheet already lists your products.</T>
        <View style={{ flexDirection: 'row' }}>
          <Btn title="Download template" icon="download-outline" kind="secondary" onPress={downloadTemplate} loading={busy === 'template'} />
        </View>
      </Card>
      <Card style={{ gap: 8 }}>
        <T v="h3">2. Upload the filled file</T>
        <T color={C.sub}>The app checks every row first. Nothing is saved until you press Import.</T>
        <input
          ref={input}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) onFile(f);
          }}
        />
        <View style={{ flexDirection: 'row' }}>
          <Btn title={fileName ? 'Choose another file' : 'Choose Excel file'} icon="cloud-upload-outline" onPress={() => input.current?.click()} loading={busy === 'read'} />
        </View>
        {fileName ? <T v="small">{fileName}</T> : null}
      </Card>

      {result ? (
        <Card style={{ gap: 8 }}>
          {result.committed ? (
            <>
              <T v="h3" color={C.green}>Imported</T>
              <T>
                {c!.customers} customers, {c!.bills} old bills and stock for {c!.stock} products were added.
              </T>
            </>
          ) : (
            <>
              <T v="h3">3. Check and import</T>
              <T>
                Found {c!.customers} new {c!.customers === 1 ? 'customer' : 'customers'}, {c!.bills} old {c!.bills === 1 ? 'bill' : 'bills'} and new stock for {c!.stock}{' '}
                {c!.stock === 1 ? 'product' : 'products'}.
              </T>
              {missing.length ? <T v="small">Not in this file: {missing.join(', ')} sheet.</T> : null}
              {result.errors.length ? (
                <>
                  <T v="strong" color={C.red}>
                    Fix {result.errors.length === 1 ? 'this problem' : `these ${result.errors.length} problems`} in the file, then upload it again:
                  </T>
                  <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 8 }}>
                    {result.errors.slice(0, 200).map((e, n) => (
                      <View key={n}>
                        {n > 0 ? <Line /> : null}
                        <View style={{ flexDirection: 'row', gap: S.md, paddingVertical: 8, paddingHorizontal: S.md }}>
                          <T v="smallStrong" style={{ width: 130 }}>
                            {e.sheet}, row {e.row}
                          </T>
                          <T v="small" color={C.ink} style={{ flex: 1 }}>
                            {e.message}
                          </T>
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <View style={{ flexDirection: 'row' }}>
                  <Btn title="Import now" icon="checkmark" onPress={commit} loading={busy === 'commit'} />
                </View>
              )}
            </>
          )}
        </Card>
      ) : null}
    </View>
  );
}
