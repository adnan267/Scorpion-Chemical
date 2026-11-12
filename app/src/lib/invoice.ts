import { Platform } from 'react-native';

import { fmtDate, num, prettyPhone } from './format';
import type { Company, OrderDetail } from './types';

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function invoiceHtml(o: OrderDetail, company: Company | null): string {
  const rows = o.items
    .map(
      (i, n) => `<tr>
        <td>${n + 1}</td><td>${esc(i.product_name)}</td>
        <td class="r">${i.qty}</td><td class="r">${num(i.unit_price)}</td>
        <td class="r">${Number(i.discount_pct) ? num(i.discount_pct) + '%' : ''}</td>
        <td class="r">${num(i.line_total)}</td></tr>`
    )
    .join('');
  const paidRows =
    o.status === 'delivered'
      ? `<tr><td>Paid</td><td class="r">Rs. ${num(o.paid)}</td></tr>
         <tr class="total"><td>Remaining</td><td class="r">Rs. ${num(o.remaining ?? 0)}</td></tr>`
      : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${esc(o.order_no)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #16283A; margin: 28px; font-size: 13px; }
  h1 { font-size: 22px; margin: 0; color: #0B5CAD; }
  .head { display: flex; justify-content: space-between; border-bottom: 3px solid #0B5CAD; padding-bottom: 12px; }
  .muted { color: #56667A; }
  .meta { display: flex; justify-content: space-between; margin: 16px 0; gap: 24px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #0B5CAD; color: #fff; text-align: left; padding: 7px 8px; font-size: 12px; }
  td { padding: 7px 8px; border-bottom: 1px solid #DDE4EC; }
  .r { text-align: right; }
  .sum { width: 280px; margin-left: auto; margin-top: 10px; }
  .sum td { border: none; padding: 4px 8px; }
  .sum .total td { font-weight: bold; font-size: 15px; border-top: 2px solid #16283A; }
  .foot { margin-top: 28px; font-size: 11px; color: #56667A; }
</style></head><body>
  <div class="head">
    <div>
      <h1>${esc(company?.name ?? 'Scorpion Chemical')}</h1>
      <div class="muted">${esc(company?.address ?? '')}</div>
      <div class="muted">${esc(company?.phone ?? '')}${company?.email ? ' | ' + esc(company.email) : ''}</div>
    </div>
    <div class="r">
      <div style="font-size:18px;font-weight:bold">Invoice</div>
      <div>${esc(o.order_no)}</div>
      <div class="muted">${fmtDate(o.delivered_at ?? o.created_at)}</div>
    </div>
  </div>
  <div class="meta">
    <div>
      <div class="muted">Bill to</div>
      <div style="font-weight:bold;font-size:15px">${esc(o.customer.name)}</div>
      <div>${esc([o.customer.address, o.customer.city].filter(Boolean).join(', '))}</div>
      <div>${esc(prettyPhone(o.customer.phone))}</div>
    </div>
    <div class="r">
      <div class="muted">Order taken by</div><div>${esc(o.created_by_name)}</div>
      ${o.due_date ? `<div class="muted" style="margin-top:6px">Payment due</div><div style="font-weight:bold">${fmtDate(o.due_date)}</div>` : ''}
    </div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Product</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Disc.</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="sum">
    <tr><td>Subtotal</td><td class="r">Rs. ${num(o.subtotal)}</td></tr>
    <tr><td>Discount</td><td class="r">- Rs. ${num(o.discount_total)}</td></tr>
    <tr class="total"><td>Total</td><td class="r">Rs. ${num(o.total)}</td></tr>
    ${paidRows}
  </table>
  ${o.notes ? `<p><span class="muted">Note:</span> ${esc(o.notes)}</p>` : ''}
  <div class="foot">This is a computer-generated invoice.</div>
</body></html>`;
}

/** Phone: makes a PDF and opens the share sheet (WhatsApp etc). Web: opens the print dialog. */
export async function shareInvoice(o: OrderDetail, company: Company | null): Promise<void> {
  const html = invoiceHtml(o, company);
  if (Platform.OS === 'web') {
    const w = window.open('', '_blank');
    if (!w) throw new Error('Allow pop-ups for this site to print the invoice.');
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
    return;
  }
  const Print = await import('expo-print');
  const Sharing = await import('expo-sharing');
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Invoice ${o.order_no}`, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}
