// Android: shows an HTML document (invoice preview) inside a WebView.
import React from 'react';
import { View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';

import { C, R } from './theme';

const WebView = RNWebView as unknown as React.ComponentType<any>;

export type HtmlViewHandle = { print: () => void };

export function HtmlView({ html, height }: { html: string; height: number; onHandle?: (h: HtmlViewHandle | null) => void }) {
  return (
    <View style={{ height, borderRadius: R.card, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: C.white }}>
      <WebView originWhitelist={['*']} source={{ html }} scalesPageToFit setSupportMultipleWindows={false} nestedScrollEnabled style={{ backgroundColor: C.white }} />
    </View>
  );
}
