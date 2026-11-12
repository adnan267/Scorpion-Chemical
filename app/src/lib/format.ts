const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function num(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  const neg = v < 0;
  const fixed = Math.abs(v).toFixed(2);
  let [whole, frac] = fixed.split('.');
  whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + whole + (frac === '00' ? '' : '.' + frac);
}

export function money(n: number | string | null | undefined): string {
  return 'Rs. ' + num(n);
}

/** 2026-11-13 or a full timestamp -> 13 Nov 2026 */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const dt = d.length <= 10 ? new Date(d + 'T00:00:00') : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  let h = dt.getHours();
  const m = String(dt.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${fmtDate(d)}, ${h}:${m} ${ap}`;
}

export function timeAgo(d: string): string {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
}

export function isoDate(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(days: number, from: Date = new Date()): string {
  const dt = new Date(from);
  dt.setDate(dt.getDate() + days);
  return isoDate(dt);
}

/** 2026-11-13 -> 13/11/2026 */
export function isoToInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** 13/11/2026 -> 2026-11-13, or null when it is not a real date */
export function inputToIso(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return isoDate(dt);
}

/** 0300-7334811, +92 300 7334811 -> 03007334811 */
export function normPhone(p: string): string {
  let d = (p ?? '').replace(/\D/g, '');
  if (d.startsWith('0092')) d = d.slice(4);
  else if (d.startsWith('92') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('3')) d = '0' + d;
  return d;
}

export function isValidPhone(p: string): boolean {
  return /^03\d{9}$/.test(normPhone(p));
}

export function prettyPhone(p: string | null | undefined): string {
  if (!p) return '';
  return p.length === 11 ? `${p.slice(0, 4)}-${p.slice(4)}` : p;
}

export const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'jazzcash', label: 'JazzCash' },
  { value: 'easypaisa', label: 'EasyPaisa' },
  { value: 'other', label: 'Other' },
];

export function methodLabel(m: string): string {
  return METHODS.find((x) => x.value === m)?.label ?? m;
}

export const CUSTOMER_TYPES = [
  { value: 'store', label: 'Medical store', plural: 'Medical stores' },
  { value: 'distributor', label: 'Distributor', plural: 'Distributors' },
  { value: 'wholesaler', label: 'Wholesaler', plural: 'Wholesalers' },
  { value: 'retailer', label: 'Retailer', plural: 'Retailers' },
  { value: 'clinic', label: 'Clinic', plural: 'Clinics' },
  { value: 'hospital', label: 'Hospital', plural: 'Hospitals' },
] as const;

export type CustomerType = (typeof CUSTOMER_TYPES)[number]['value'];

export function customerTypeLabel(t: string | null | undefined): string {
  return CUSTOMER_TYPES.find((x) => x.value === t)?.label ?? 'Customer';
}

/** The login role for a customer of this type. */
export function loginRoleFor(t: string): 'distributor' | 'store' {
  return t === 'distributor' ? 'distributor' : 'store';
}

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  order_taker: 'Order Taker',
  store: 'Customer',
  distributor: 'Distributor',
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function toNumber(text: string): number {
  const v = Number(String(text).replace(/,/g, '').trim());
  return isFinite(v) ? v : NaN;
}
