import { Platform } from 'react-native';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export type ReportCol = { label: string; right?: boolean; width?: string; blank?: boolean };
export type ReportTable = { heading?: string; cols: ReportCol[]; rows: (string | number | null)[][]; foot?: (string | number | null)[] };
export type Company = { name?: string | null; address?: string | null; phone?: string | null } | null | undefined;

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, "Segoe UI", Arial, sans-serif; color: #111827; margin: 0; font-size: 12.5px; }
  @page { size: A4; margin: 12mm; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0B5CAD; padding-bottom: 8px; margin-bottom: 12px; }
  .co { font-size: 18px; font-weight: 700; color: #0B5CAD; }
  .muted { color: #6B7280; }
  h1 { font-size: 17px; margin: 0; text-align: right; }
  h2 { font-size: 14px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th { background: #EEF3FA; text-align: left; padding: 6px 6px; font-size: 11.5px; border-bottom: 1px solid #C9D6E8; }
  td { padding: 7px 6px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
  .r { text-align: right; }
  .blank { border-bottom: 2px dotted #374151; padding-top: 14px; padding-bottom: 14px; }
  tfoot td { font-weight: 700; border-top: 1.5px solid #111827; border-bottom: none; }
  .note { margin-top: 14px; color: #374151; }
  .sign { display: flex; gap: 40px; margin-top: 40px; }
  .sign div { flex: 1; border-top: 1px solid #111827; padding-top: 4px; text-align: center; color: #374151; }
`;

/** A plain printable A4 report: company heading, title, tables, optional signature lines. */
export function reportHtml(o: { title: string; subtitle?: string; company?: Company; tables: ReportTable[]; note?: string; signLines?: string[] }): string {
  const table = (t: ReportTable) => `
    ${t.heading ? `<h2>${esc(t.heading)}</h2>` : ''}
    <table>
      <thead><tr>${t.cols.map((c) => `<th class="${c.right ? 'r' : ''}" style="${c.width ? `width:${c.width}` : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows
        .map((r) => `<tr>${r.map((v, i) => `<td class="${t.cols[i]?.right ? 'r' : ''} ${t.cols[i]?.blank ? 'blank' : ''}">${t.cols[i]?.blank ? '&nbsp;' : esc(v)}</td>`).join('')}</tr>`)
        .join('')}</tbody>
      ${t.foot ? `<tfoot><tr>${t.foot.map((v, i) => `<td class="${t.cols[i]?.right ? 'r' : ''}">${esc(v)}</td>`).join('')}</tr></tfoot>` : ''}
    </table>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title><style>${CSS}</style></head><body>
<div class="head">
  <div><div class="co">${esc(o.company?.name || 'Scorpion Chemical')}</div><div class="muted">${esc([o.company?.address, o.company?.phone].filter(Boolean).join(' | '))}</div></div>
  <div><h1>${esc(o.title)}</h1>${o.subtitle ? `<div class="muted" style="text-align:right">${esc(o.subtitle)}</div>` : ''}</div>
</div>
${o.tables.map(table).join('')}
${o.note ? `<div class="note">${esc(o.note)}</div>` : ''}
${o.signLines?.length ? `<div class="sign">${o.signLines.map((s) => `<div>${esc(s)}</div>`).join('')}</div>` : ''}
</body></html>`;
}

/** Opens the print dialog for an HTML page (web: hidden frame; phone: Android print, which can also save a PDF). */
export async function printDoc(html: string): Promise<void> {
  if (Platform.OS === 'web') {
    const f = document.createElement('iframe');
    f.style.position = 'fixed';
    f.style.right = '0';
    f.style.bottom = '0';
    f.style.width = '0';
    f.style.height = '0';
    f.style.border = '0';
    document.body.appendChild(f);
    const d = f.contentWindow!.document;
    d.open();
    d.write(html);
    d.close();
    await new Promise((r) => setTimeout(r, 300));
    f.contentWindow!.focus();
    f.contentWindow!.print();
    setTimeout(() => f.remove(), 60_000);
    return;
  }
  const Print = await import('expo-print');
  await Print.printAsync({ html });
}
