// Web: the Leaflet page runs inside an iframe.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { MapData, mapHtml } from '@/lib/mapHtml';

import { C, R } from './theme';

export function MapView({ data, height, onMarker }: { data: MapData; height: number; onMarker?: (id: string) => void }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => mapHtml(), []);
  const markerCb = useRef(onMarker);
  markerCb.current = onMarker;

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      try {
        const m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (m.type === 'ready') setReady(true);
        if (m.type === 'marker') markerCb.current?.(m.id);
      } catch {
        // ignore
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage(JSON.stringify({ __map: true, data }), '*');
  }, [ready, data]);

  return (
    <View style={{ height, borderRadius: R.card, overflow: 'hidden', borderWidth: 1, borderColor: C.line }}>
      {React.createElement('iframe', {
        ref: frame,
        srcDoc: html,
        title: 'Map',
        style: { border: 0, width: '100%', height: '100%' },
      })}
    </View>
  );
}
