// Web: shows an HTML document (invoice preview) in an iframe and can print just that document.
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { C, R } from './theme';

export type HtmlViewHandle = { print: () => void };

export function HtmlView({ html, height, onHandle }: { html: string; height: number; onHandle?: (h: HtmlViewHandle | null) => void }) {
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    onHandle?.({
      print: () => {
        const w = frame.current?.contentWindow;
        if (!w) return;
        w.focus();
        w.print();
      },
    });
    return () => onHandle?.(null);
  }, [onHandle]);

  return (
    <View style={{ height, borderRadius: R.card, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: C.white }}>
      {React.createElement('iframe', {
        ref: frame,
        srcDoc: html,
        title: 'Invoice',
        style: { border: 0, width: '100%', height: '100%', background: '#fff' },
      })}
    </View>
  );
}
