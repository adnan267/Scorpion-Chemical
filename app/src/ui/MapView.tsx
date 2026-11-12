// Android: the Leaflet page runs inside a WebView.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';

import { MapData, mapHtml } from '@/lib/mapHtml';

import { C, R } from './theme';

// the package's class typings do not line up with React 19 here; the runtime API is unchanged
const WebView = RNWebView as unknown as React.ComponentType<any>;

export function MapView({ data, height, onMarker }: { data: MapData; height: number; onMarker?: (id: string) => void }) {
  const ref = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => mapHtml(), []);

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.setData(${JSON.stringify(data)}); true;`);
  }, [ready, data]);

  return (
    <View style={{ height, borderRadius: R.card, overflow: 'hidden', borderWidth: 1, borderColor: C.line }}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://scorpion-chemical-app.vercel.app/' }}
        onMessage={(e: { nativeEvent: { data: string } }) => {
          try {
            const m = JSON.parse(e.nativeEvent.data);
            if (m.type === 'ready') setReady(true);
            if (m.type === 'marker' && onMarker) onMarker(m.id);
          } catch {
            // ignore
          }
        }}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        nestedScrollEnabled
        style={{ backgroundColor: '#E9EEF3' }}
      />
    </View>
  );
}
