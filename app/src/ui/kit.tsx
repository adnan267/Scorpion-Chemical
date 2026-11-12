import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';

import { addDays, fmtDate, inputToIso, isoToInput, money } from '@/lib/format';
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from '@/lib/format';

import { C, F, ORDER_TONE, PAYMENT_TONE, R, S, Tone, TONES, WIDE } from './theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ---------- text ----------
type Variant = 'title' | 'h2' | 'h3' | 'body' | 'strong' | 'small' | 'smallStrong' | 'figure';
const TEXT: Record<Variant, TextStyle> = {
  title: { fontFamily: F.bold, fontSize: 24, lineHeight: 30, color: C.ink },
  h2: { fontFamily: F.bold, fontSize: 19, lineHeight: 25, color: C.ink },
  h3: { fontFamily: F.semi, fontSize: 16, lineHeight: 22, color: C.ink },
  body: { fontFamily: F.regular, fontSize: 15, lineHeight: 21, color: C.ink },
  strong: { fontFamily: F.semi, fontSize: 15, lineHeight: 21, color: C.ink },
  small: { fontFamily: F.regular, fontSize: 13, lineHeight: 18, color: C.sub },
  smallStrong: { fontFamily: F.semi, fontSize: 13, lineHeight: 18, color: C.sub },
  figure: { fontFamily: F.bold, fontSize: 28, lineHeight: 34, color: C.ink },
};

export function T({
  v = 'body',
  color,
  style,
  ...rest
}: React.ComponentProps<typeof Text> & { v?: Variant; color?: string }) {
  return <Text {...rest} style={[TEXT[v], color ? { color } : null, style]} />;
}

// ---------- buttons ----------
type BtnKind = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Btn({
  title,
  onPress,
  kind = 'primary',
  icon,
  loading,
  disabled,
  small,
  style,
}: {
  title: string;
  onPress?: () => void;
  kind?: BtnKind;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  const bg = kind === 'primary' ? C.blue : kind === 'danger' ? C.red : kind === 'secondary' ? C.surface : 'transparent';
  const fg = kind === 'primary' || kind === 'danger' ? C.white : kind === 'secondary' ? C.blue : C.blue;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        st.btn,
        small && st.btnSmall,
        { backgroundColor: bg },
        kind === 'secondary' && { borderWidth: 1, borderColor: C.blue },
        pressed && !off && { opacity: 0.8 },
        off && { opacity: 0.5 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={small ? 16 : 18} color={fg} /> : null}
          <Text style={{ fontFamily: F.semi, fontSize: small ? 14 : 16, color: fg }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconBtn({ icon, onPress, label, color = C.ink, badge }: { icon: IconName; onPress?: () => void; label: string; color?: string; badge?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed }) => [st.iconBtn, pressed && { backgroundColor: C.graySoft }]}>
      <Ionicons name={icon} size={22} color={color} />
      {badge ? (
        <View style={st.badge}>
          <Text style={st.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ---------- inputs ----------
export function Field({
  label,
  hint,
  error,
  prefix,
  style,
  ...input
}: TextInputProps & { label?: string; hint?: string; error?: string | null; prefix?: string }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={[{ gap: 6 }, style as any]}>
      {label ? <T v="smallStrong" color={C.ink}>{label}</T> : null}
      <View style={[st.inputWrap, focus && { borderColor: C.blue }, !!error && { borderColor: C.red }, input.editable === false && { backgroundColor: C.paper }]}>
        {prefix ? <T color={C.sub}>{prefix}</T> : null}
        <TextInput
          placeholderTextColor={C.faint}
          {...input}
          onFocus={(e) => {
            setFocus(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            input.onBlur?.(e);
          }}
          style={[st.input, input.multiline && { minHeight: 76, textAlignVertical: 'top', paddingTop: 10 }]}
        />
      </View>
      {error ? <T v="small" color={C.red}>{error}</T> : hint ? <T v="small">{hint}</T> : null}
    </View>
  );
}

export function SelectField<V extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose',
  hint,
}: {
  label?: string;
  value: V | null | undefined;
  options: { value: V; label: string; sub?: string }[];
  onChange: (v: V) => void;
  placeholder?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      {label ? <T v="smallStrong" color={C.ink}>{label}</T> : null}
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={[st.inputWrap, { justifyContent: 'space-between', paddingVertical: 11 }]}>
        <T color={current ? C.ink : C.faint}>{current ? current.label : placeholder}</T>
        <Ionicons name="chevron-down" size={18} color={C.sub} />
      </Pressable>
      {hint ? <T v="small">{hint}</T> : null}
      <Sheet visible={open} title={label ?? placeholder} onClose={() => setOpen(false)}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => {
              onChange(o.value);
              setOpen(false);
            }}
            style={({ pressed }) => [st.option, pressed && { backgroundColor: C.paper }]}>
            <View style={{ flex: 1 }}>
              <T v={o.value === value ? 'strong' : 'body'}>{o.label}</T>
              {o.sub ? <T v="small">{o.sub}</T> : null}
            </View>
            {o.value === value ? <Ionicons name="checkmark" size={20} color={C.blue} /> : null}
          </Pressable>
        ))}
        {options.length === 0 ? <T v="small" style={{ padding: S.lg }}>Nothing to choose from yet.</T> : null}
      </Sheet>
    </View>
  );
}

/** Date typed as DD/MM/YYYY, with shortcuts. `value` is ISO (YYYY-MM-DD) or null. */
export function DateField({
  label,
  value,
  onChange,
  presets = [7, 15, 30],
  hint,
}: {
  label?: string;
  value: string | null;
  onChange: (iso: string | null) => void;
  presets?: number[];
  hint?: string;
}) {
  const [text, setText] = useState(isoToInput(value));
  const [bad, setBad] = useState(false);
  const shown = value && inputToIso(text) === value ? text : value ? isoToInput(value) : text;
  return (
    <View style={{ gap: 6 }}>
      <Field
        label={label}
        value={shown}
        placeholder="DD/MM/YYYY"
        keyboardType="numbers-and-punctuation"
        onChangeText={(t) => {
          setText(t);
          if (t.trim() === '') {
            setBad(false);
            onChange(null);
            return;
          }
          const iso = inputToIso(t);
          setBad(!iso);
          onChange(iso);
        }}
        error={bad ? 'Write the date as day/month/year, e.g. 25/11/2026' : null}
        hint={value ? fmtDate(value) : hint}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
        {presets.map((d) => (
          <Pressable
            key={d}
            onPress={() => {
              const iso = addDays(d);
              setText(isoToInput(iso));
              setBad(false);
              onChange(iso);
            }}
            style={st.preset}>
            <T v="smallStrong" color={C.blue}>{d === 0 ? 'Today' : `In ${d} days`}</T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
      <View style={[st.toggle, value && { backgroundColor: C.blue }]}>
        <View style={[st.knob, value && { alignSelf: 'flex-end' }]} />
      </View>
      <View style={{ flex: 1 }}>
        <T v="strong">{label}</T>
        {hint ? <T v="small">{hint}</T> : null}
      </View>
    </Pressable>
  );
}

// ---------- containers ----------
export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [st.card, pressed && { backgroundColor: '#FAFBFD' }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[st.card, style]}>{children}</View>;
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ gap: S.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 }}>
        <T v="h3">{title}</T>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Line() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.line }} />;
}

export function KV({ k, v, strong, color }: { k: string; v: React.ReactNode; strong?: boolean; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md, paddingVertical: 5 }}>
      <T v="body" color={C.sub}>{k}</T>
      {typeof v === 'string' || typeof v === 'number' ? (
        <T v={strong ? 'strong' : 'body'} color={color} style={{ flexShrink: 1, textAlign: 'right' }}>{v}</T>
      ) : (
        v
      )}
    </View>
  );
}

// ---------- tags ----------
export function Tag({ label, tone = 'gray' }: { label: string; tone?: Tone }) {
  const t = TONES[tone];
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: R.tag, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ fontFamily: F.semi, fontSize: 12, color: t.fg }}>{label}</Text>
    </View>
  );
}

export function OrderTag({ status }: { status: string }) {
  return <Tag label={ORDER_STATUS_LABEL[status] ?? status} tone={ORDER_TONE[status] ?? 'gray'} />;
}

export function PaymentTag({ status }: { status: string }) {
  return <Tag label={PAYMENT_STATUS_LABEL[status] ?? status} tone={PAYMENT_TONE[status] ?? 'gray'} />;
}

/** The blue block from the printed rate list: pack size on a solid blue tag. */
export function PackTag({ text }: { text: string }) {
  return (
    <View style={{ backgroundColor: C.blue, borderRadius: R.tag, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ fontFamily: F.bold, fontSize: 13, color: C.white }}>{text}</Text>
    </View>
  );
}

// ---------- filters ----------
export function Chips<V extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string; count?: number }[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm, paddingVertical: 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)} style={[st.chip, on && { backgroundColor: C.ink, borderColor: C.ink }]}>
            <Text style={{ fontFamily: F.semi, fontSize: 14, color: on ? C.white : C.sub }}>
              {o.label}
              {o.count ? ` ${o.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function SearchBox({ value, onChangeText, placeholder }: { value: string; onChangeText: (t: string) => void; placeholder: string }) {
  return (
    <View style={[st.inputWrap, { gap: 8 }]}>
      <Ionicons name="search" size={18} color={C.faint} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={C.faint} style={st.input} autoCapitalize="none" autoCorrect={false} />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={18} color={C.faint} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- states ----------
export function Loading() {
  return (
    <View style={{ padding: S.xxl, alignItems: 'center' }}>
      <ActivityIndicator color={C.blue} />
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card style={{ borderColor: C.red, gap: S.md }}>
      <T color={C.red}>{message}</T>
      {onRetry ? <Btn title="Try again" kind="secondary" small onPress={onRetry} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card>
  );
}

export function Empty({ icon = 'file-tray-outline', title, hint, action }: { icon?: IconName; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: S.xxl, paddingHorizontal: S.xl, gap: S.sm }}>
      <Ionicons name={icon} size={36} color={C.faint} />
      <T v="h3" style={{ textAlign: 'center' }}>{title}</T>
      {hint ? <T v="small" style={{ textAlign: 'center', maxWidth: 320 }}>{hint}</T> : null}
      {action ? <View style={{ marginTop: S.sm }}>{action}</View> : null}
    </View>
  );
}

// ---------- numbers ----------
export function Stat({ label, value, tone, onPress, sub }: { label: string; value: string; tone?: Tone; onPress?: () => void; sub?: string }) {
  const fg = tone ? TONES[tone].fg : C.ink;
  return (
    <Card onPress={onPress} style={{ flexGrow: 1, flexBasis: 150, gap: 2, paddingVertical: S.md }}>
      <T v="small">{label}</T>
      <Text style={{ fontFamily: F.bold, fontSize: 22, lineHeight: 28, color: fg }}>{value}</Text>
      {sub ? <T v="small">{sub}</T> : null}
    </Card>
  );
}

export function Amount({ value, size = 15, color = C.ink, bold = true }: { value: number | string | null | undefined; size?: number; color?: string; bold?: boolean }) {
  return <Text style={{ fontFamily: bold ? F.bold : F.medium, fontSize: size, color }}>{money(value)}</Text>;
}

/**
 * Quantity control. Typing never removes a line by accident: the number is kept as typed
 * while the box is focused, and an empty box goes back to the last quantity on blur.
 * `typeMin` is the smallest number that typing may set (0 only where 0 means "remove").
 */
export function Stepper({ value, onChange, min = 0, typeMin = 1 }: { value: number; onChange: (v: number) => void; min?: number; typeMin?: number }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.blue, borderRadius: R.input, overflow: 'hidden' }}>
      <Pressable accessibilityLabel="Decrease quantity" onPress={() => { setText(null); onChange(Math.max(min, value - 1)); }} style={st.stepBtn}>
        <Ionicons name="remove" size={18} color={C.blue} />
      </Pressable>
      <TextInput
        accessibilityLabel="Quantity"
        value={text ?? String(value)}
        onFocus={() => setText(String(value))}
        onChangeText={(t) => {
          const digits = t.replace(/\D/g, '').slice(0, 5);
          setText(digits);
          const n = parseInt(digits, 10);
          if (!isNaN(n) && n >= typeMin) onChange(n);
        }}
        onBlur={() => setText(null)}
        keyboardType="number-pad"
        selectTextOnFocus
        style={{ width: 52, textAlign: 'center', fontFamily: F.bold, fontSize: 15, color: C.ink, paddingVertical: 6, outlineStyle: 'none' as any }}
      />
      <Pressable accessibilityLabel="Increase quantity" onPress={() => { setText(null); onChange(value + 1); }} style={st.stepBtn}>
        <Ionicons name="add" size={18} color={C.blue} />
      </Pressable>
    </View>
  );
}

// ---------- sheet (bottom sheet on phones, centred box on wide screens) ----------
export function Sheet({ visible, title, onClose, children, footer }: { visible: boolean; title?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  const wide = width >= WIDE;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[st.backdrop, wide ? { justifyContent: 'center', alignItems: 'center' } : { justifyContent: 'flex-end' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[st.sheet, wide ? { width: 460, borderRadius: R.card, maxHeight: height * 0.8 } : { maxHeight: height * 0.85 }]}>
          {title ? (
            <View style={st.sheetHead}>
              <T v="h3" style={{ flex: 1 }}>{title}</T>
              <IconBtn icon="close" label="Close" onPress={onClose} />
            </View>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: S.md }}>
            {children}
          </ScrollView>
          {footer ? <View style={{ padding: S.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  btn: { minHeight: 48, paddingHorizontal: S.lg, borderRadius: R.input, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnSmall: { minHeight: 36, paddingHorizontal: S.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { fontFamily: F.bold, fontSize: 10, color: C.white },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.line, borderRadius: R.input, backgroundColor: C.surface, paddingHorizontal: S.md },
  input: { flex: 1, fontFamily: F.regular, fontSize: 16, color: C.ink, paddingVertical: 11, minWidth: 0, outlineStyle: 'none' as any },
  option: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.lg, paddingVertical: 14, gap: S.md },
  preset: { borderWidth: 1, borderColor: C.line, borderRadius: R.input, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.surface },
  toggle: { width: 46, height: 28, borderRadius: 14, backgroundColor: C.line, padding: 3, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.white },
  card: { backgroundColor: C.surface, borderRadius: R.card, borderWidth: 1, borderColor: C.line, padding: S.lg },
  chip: { borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7 },
  stepBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blueSoft },
  backdrop: { flex: 1, backgroundColor: 'rgba(22,40,58,0.45)' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 14, borderTopRightRadius: 14, overflow: 'hidden' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingLeft: S.lg, paddingRight: S.sm, paddingVertical: S.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
});
