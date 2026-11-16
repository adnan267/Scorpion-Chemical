import React, { useCallback, useRef, useState } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';

import { useDialog } from '@/ctx/dialog';
import { printHtml, sharePdf } from '@/lib/invoice';

import { HtmlView, HtmlViewHandle } from './HtmlView';
import { Btn, T } from './kit';
import { C, S } from './theme';

/** Preview of a printable document with Print and Share/Download buttons. */
export function InvoicePreview({ html, name }: { html: string; name: string }) {
  const dialog = useDialog();
  const { height } = useWindowDimensions();
  const handle = useRef<HtmlViewHandle | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const onHandle = useCallback((h: HtmlViewHandle | null) => {
    handle.current = h;
  }, []);
  const web = Platform.OS === 'web';

  async function print() {
    if (web) {
      handle.current?.print();
      return;
    }
    setBusy('print');
    try {
      await printHtml(html);
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    setBusy('share');
    try {
      await sharePdf(html, name);
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: S.md }}>
      <View style={{ flexDirection: 'row', gap: S.md }}>
        <Btn title="Print" icon="print-outline" onPress={print} loading={busy === 'print'} style={{ flex: 1 }} />
        {web ? null : <Btn title="Share PDF" icon="share-social-outline" kind="secondary" onPress={share} loading={busy === 'share'} style={{ flex: 1 }} />}
      </View>
      {web ? <T v="small">To download, press Print and choose "Save as PDF".</T> : <T v="small">Print also lets you choose "Save as PDF".</T>}
      <HtmlView html={html} height={Math.max(480, Math.round(height * 0.72))} onHandle={onHandle} />
      <T v="small" color={C.faint}>This is how the invoice will print.</T>
    </View>
  );
}
