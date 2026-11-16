import { Platform } from 'react-native';

import { fmtDate, num, prettyPhone } from './format';
import type { InvoiceSettings, OrderDetail } from './types';

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #16283A; margin: 0; font-size: 12.5px; background: #fff; }
  .page { padding: 26px 28px; }
  .page + .page { page-break-before: always; break-before: page; }
  h1 { font-size: 21px; margin: 0; color: #0B5CAD; }
  .head { display: flex; justify-content: space-between; border-bottom: 3px solid #0B5CAD; padding-bottom: 10px; gap: 16px; }
  .muted { color: #56667A; }
  .meta { display: flex; justify-content: space-between; margin: 14px 0; gap: 24px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #0B5CAD; color: #fff; text-align: left; padding: 6px 7px; font-size: 11.5px; }
  td { padding: 6px 7px; border-bottom: 1px solid #DDE4EC; vertical-align: top; }
  .r { text-align: right; }
  .sum { width: 290px; margin-left: auto; margin-top: 8px; }
  .sum td { border: none; padding: 3px 7px; }
  .sum .total td { font-weight: bold; font-size: 14px; border-top: 2px solid #16283A; }
  .ret { color: #C3352B; }
  .warranty { margin-top: 26px; border-top: 1px solid #DDE4EC; padding-top: 10px; display: flex; gap: 24px; align-items: flex-end; justify-content: space-between; }
  .warranty .w { flex: 1; font-size: 11.5px; line-height: 1.45; }
  .warranty .w b { display: block; margin-bottom: 3px; font-size: 12px; text-decoration: underline; }
  .sign { width: 210px; text-align: center; font-size: 11px; }
  .sign img { max-width: 200px; max-height: 80px; display: block; margin: 0 auto 2px; }
  .sign .line { border-top: 1px solid #16283A; padding-top: 3px; }
  .foot { margin-top: 14px; font-size: 10.5px; color: #56667A; }
  @page { size: A4; margin: 10mm; }
  @media print { .page { padding: 0; } }
`;

function invoicePage(o: OrderDetail, s: InvoiceSettings | null): string {
  const company = s?.company;
  const inv = s?.invoice;
  const rows = o.items
    .map(
      (i, n) => `<tr>
        <td>${n + 1}</td><td>${esc(i.product_name)}</td>
        <td class="r">${i.qty}</td><td class="r">${num(i.unit_price)}</td>
        <td class="r">${Number(i.discount_pct) ? num(i.discount_pct) + '%' : ''}</td>
        <td class="r">${num(i.line_total)}</td></tr>`
    )
    .join('');
  const returned = Number(o.returned || 0);
  const net = Number(o.total) - returned;
  const returnRows = returned
    ? `<tr class="ret"><td>Less: goods returned</td><td class="r">- Rs. ${num(returned)}</td></tr>
       <tr class="total"><td>Net total</td><td class="r">Rs. ${num(net)}</td></tr>`
    : '';
  const paidRows =
    o.status === 'delivered' && o.paid !== null
      ? `<tr><td>Paid</td><td class="r">Rs. ${num(o.paid)}</td></tr>
         <tr class="total"><td>Remaining</td><td class="r">Rs. ${num(o.remaining ?? 0)}</td></tr>`
      : '';
  const c = o.customer;
  const licence = c.licence_no
    ? `<div style="margin-top:4px"><span class="muted">Licence no.</span> ${esc(c.licence_no)}</div>
       ${c.licence_issued ? `<div><span class="muted">Issued</span> ${fmtDate(c.licence_issued)}</div>` : ''}
       ${c.licence_expiry ? `<div><span class="muted">Expires</span> ${fmtDate(c.licence_expiry)}</div>` : ''}`
    : '';
  const sign = inv?.signature
    ? `<img src="${esc(inv.signature)}" alt="Signature">`
    : '<div style="height:56px"></div>';
  return `<div class="page">
  <div class="head">
    <div>
      <h1>${esc(company?.name ?? 'Scorpion Chemical')}</h1>
      <div class="muted">${esc(company?.address ?? '')}</div>
      <div class="muted">${esc(company?.phone ?? '')}${company?.email ? ' | ' + esc(company.email) : ''}</div>
    </div>
    <div class="r">
      <div style="font-size:17px;font-weight:bold">Invoice</div>
      <div style="font-size:14px">${esc(o.order_no)}</div>
      <div class="muted">${fmtDate(o.delivered_at ?? o.created_at)}</div>
    </div>
  </div>
  <div class="meta">
    <div>
      <div class="muted">Bill to</div>
      <div style="font-weight:bold;font-size:14px">${esc(c.name)}</div>
      <div>${esc([c.address, c.city].filter(Boolean).join(', '))}</div>
      <div>${esc(prettyPhone(c.phone))}</div>
      ${licence}
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
    ${returnRows}
    ${paidRows}
  </table>
  ${o.notes ? `<p><span class="muted">Note:</span> ${esc(o.notes)}</p>` : ''}
  <div class="warranty">
    <div class="w">${inv?.warranty ? `<b>WARRANTY:</b>${esc(inv.warranty)}` : ''}</div>
    <div class="sign">${sign}<div class="line">${esc(inv?.signer || 'Signature')}</div></div>
  </div>
  <div class="foot">This is a computer-generated invoice.</div>
</div>`;
}

/** One or more invoices in one printable HTML document (each on its own page). */
export function invoicesHtml(orders: OrderDetail[], settings: InvoiceSettings | null, title = 'Invoices'): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>${orders.map((o) => invoicePage(o, settings)).join('')}</body></html>`;
}

/** Phone: PDF to share (WhatsApp etc). */
export async function sharePdf(html: string, name: string): Promise<void> {
  if (Platform.OS === 'web') throw new Error('Use Print and choose "Save as PDF".');
  const Print = await import('expo-print');
  const Sharing = await import('expo-sharing');
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: name, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}

/** Phone: system print dialog (printer or "Save as PDF"). */
export async function printHtml(html: string): Promise<void> {
  const Print = await import('expo-print');
  await Print.printAsync({ html });
}
