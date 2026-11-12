import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, usePathname } from 'expo-router';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/ctx/auth';
import { ROLE_LABEL } from '@/lib/format';
import type { Role } from '@/lib/types';

import { IconBtn, IconName, T } from './kit';
import { C, CONTENT_MAX, F, S, WIDE } from './theme';

type NavItem = { href: string; label: string; icon: IconName; iconOn: IconName };

const HOME: NavItem = { href: '/', label: 'Home', icon: 'home-outline', iconOn: 'home' };
const ORDERS: NavItem = { href: '/orders', label: 'Orders', icon: 'receipt-outline', iconOn: 'receipt' };
const PAYMENTS: NavItem = { href: '/payments', label: 'Payments', icon: 'wallet-outline', iconOn: 'wallet' };
const PRODUCTS: NavItem = { href: '/catalog', label: 'Products', icon: 'cube-outline', iconOn: 'cube' };
const CUSTOMERS: NavItem = { href: '/customers', label: 'Customers', icon: 'storefront-outline', iconOn: 'storefront' };
const USERS: NavItem = { href: '/users', label: 'Staff logins', icon: 'people-outline', iconOn: 'people' };
const MAP: NavItem = { href: '/team-map', label: 'Live map', icon: 'map-outline', iconOn: 'map' };
const MORE: NavItem = { href: '/more', label: 'More', icon: 'menu-outline', iconOn: 'menu' };

export function navFor(role: Role, wide: boolean): NavItem[] {
  if (role === 'admin') {
    return wide ? [HOME, ORDERS, PAYMENTS, PRODUCTS, CUSTOMERS, MAP, USERS, MORE] : [HOME, ORDERS, PAYMENTS, PRODUCTS, MORE];
  }
  if (role === 'order_taker') return [HOME, CUSTOMERS, ORDERS, PAYMENTS, MORE];
  return [HOME, PRODUCTS, ORDERS, PAYMENTS, MORE];
}

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
}

export function goBack(fallback: string = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as any);
}

export function Screen({
  title,
  subtitle,
  top,
  back,
  right,
  footer,
  children,
  onRefresh,
  refreshing,
  scroll = true,
}: {
  title: string;
  subtitle?: string;
  /** A main screen reached from the navigation bar (shows the bar instead of a back arrow). */
  top?: boolean;
  /** Where the back arrow goes when there is no history (e.g. the page was opened directly). */
  back?: string;
  right?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  scroll?: boolean;
}) {
  const { profile, unread } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const wide = width >= WIDE;
  const items = profile ? navFor(profile.role, wide) : [];

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={st.content}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.blue} colors={[C.blue]} /> : undefined}>
      <View style={st.inner}>{children}</View>
    </ScrollView>
  ) : (
    <View style={[st.content, { flex: 1 }]}>
      <View style={[st.inner, { flex: 1 }]}>{children}</View>
    </View>
  );

  const header = (
    <View style={[st.header, { paddingTop: insets.top + 6 }]}>
      <View style={st.headerRow}>
        {!top ? (
          <IconBtn icon="arrow-back" label="Back" onPress={() => goBack(back)} />
        ) : !wide ? (
          <Image source={require('@/assets/images/splash-icon.png')} style={{ width: 30, height: 30 }} contentFit="contain" />
        ) : null}
        <View style={{ flex: 1, marginLeft: top && wide ? 0 : 6 }}>
          <T v="h2" numberOfLines={1}>{title}</T>
          {subtitle ? <T v="small" numberOfLines={1}>{subtitle}</T> : null}
        </View>
        {right}
        <IconBtn icon="notifications-outline" label="Notifications" badge={unread} onPress={() => router.push('/notifications')} />
      </View>
    </View>
  );

  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.paper }}>
        <View style={st.side}>
          <Image source={require('@/assets/images/logo.png')} style={{ width: 150, height: 66, marginBottom: S.lg }} contentFit="contain" />
          {items.map((it) => {
            const on = isActive(pathname, it.href);
            return (
              <Pressable key={it.href} accessibilityRole="link" onPress={() => router.replace(it.href as any)} style={({ pressed }) => [st.sideItem, on && { backgroundColor: C.blueSoft }, pressed && { opacity: 0.7 }]}>
                <Ionicons name={on ? it.iconOn : it.icon} size={20} color={on ? C.blue : C.sub} />
                <T v={on ? 'strong' : 'body'} color={on ? C.blue : C.ink}>{it.label}</T>
              </Pressable>
            );
          })}
          <View style={{ flex: 1 }} />
          {profile ? (
            <View style={{ paddingHorizontal: S.sm, gap: 2 }}>
              <T v="strong" numberOfLines={1}>{profile.customer?.name ?? profile.full_name}</T>
              <T v="small">{ROLE_LABEL[profile.role]}</T>
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          {header}
          {body}
          {footer ? <View style={st.footer}><View style={st.inner}>{footer}</View></View> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      {header}
      {body}
      {footer ? <View style={[st.footer, !top && { paddingBottom: Math.max(insets.bottom, S.md) }]}><View style={st.inner}>{footer}</View></View> : null}
      {top ? (
        <View style={[st.tabs, { paddingBottom: Math.max(insets.bottom, 6) }]}>
          {items.map((it) => {
            const on = isActive(pathname, it.href);
            return (
              <Pressable key={it.href} accessibilityRole="link" accessibilityLabel={it.label} onPress={() => (on ? null : router.replace(it.href as any))} style={st.tab}>
                <Ionicons name={on ? it.iconOn : it.icon} size={22} color={on ? C.blue : C.faint} />
                <T v="small" style={{ fontFamily: on ? F.semi : F.medium, fontSize: 12 }} color={on ? C.blue : C.sub}>{it.label}</T>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  header: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.line, paddingHorizontal: S.md, paddingBottom: 6 },
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 2, width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' },
  content: { padding: S.lg, alignItems: 'center' },
  inner: { width: '100%', maxWidth: CONTENT_MAX, gap: S.lg },
  footer: { backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line, padding: S.md, alignItems: 'center' },
  tabs: { flexDirection: 'row', backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
  side: { width: 220, backgroundColor: C.surface, borderRightWidth: 1, borderRightColor: C.line, padding: S.lg, gap: 4 },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingHorizontal: S.md, paddingVertical: 10, borderRadius: 8 },
});
