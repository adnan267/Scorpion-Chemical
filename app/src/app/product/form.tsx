import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useDialog } from '@/ctx/dialog';
import { rpc, useRpc } from '@/lib/api';
import { toNumber } from '@/lib/format';
import type { Product } from '@/lib/types';
import { pickImage, Picked, productImageUrl, uploadProductImage } from '@/lib/upload';
import { Btn, Field, Loading, T, Toggle } from '@/ui/kit';
import { goBack, Screen } from '@/ui/Shell';
import { C, R, S } from '@/ui/theme';

export default function ProductForm() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? String(params.id) : null;
  const dialog = useDialog();
  const all = useRpc<Product[]>('products_list', { p_include_inactive: true }, !!id);
  const existing = all.data?.find((p) => p.id === id);

  const [name, setName] = useState('');
  const [pack, setPack] = useState('');
  const [category, setCategory] = useState('');
  const [retail, setRetail] = useState('');
  const [rate, setRate] = useState('');
  const [packing, setPacking] = useState('');
  const [low, setLow] = useState('0');
  const [initial, setInitial] = useState('');
  const [active, setActive] = useState(true);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Picked | null>(null);
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing && !filled) {
      setName(existing.name);
      setPack(existing.pack_size ?? '');
      setCategory(existing.category ?? '');
      setRetail(existing.retail_price !== null ? String(Number(existing.retail_price)) : '');
      setRate(String(Number(existing.net_rate)));
      setPacking(existing.packing ?? '');
      setLow(String(existing.low_stock_level ?? 0));
      setActive(existing.is_active);
      setImagePath(existing.image_path);
      setFilled(true);
    }
  }, [existing, filled]);

  async function choose(source: 'camera' | 'library') {
    try {
      const p = await pickImage(source);
      if (p) setPhoto(p);
    } catch (e: any) {
      dialog.toast(e.message, 'error');
    }
  }

  async function save() {
    setError(null);
    const r = toNumber(rate);
    if (!name.trim()) return setError('Enter the product name');
    if (isNaN(r) || r < 0) return setError('Enter the net rate');
    if (retail.trim() && isNaN(toNumber(retail))) return setError('Retail price must be a number');
    setBusy(true);
    try {
      const path = photo ? await uploadProductImage(photo) : imagePath;
      const newId = await rpc<string>('product_save', {
        p: {
          id,
          name,
          pack_size: pack,
          category,
          retail_price: retail.trim() ? toNumber(retail) : null,
          net_rate: r,
          packing,
          image_path: path,
          low_stock_level: parseInt(low || '0', 10) || 0,
          initial_stock: id ? null : parseInt(initial || '0', 10) || 0,
          is_active: active,
        },
      });
      dialog.toast(id ? 'Product saved' : 'Product added');
      if (id) goBack('/catalog');
      else router.replace(`/product/stock?id=${newId}` as any);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (id && !existing) {
    return (
      <Screen title="Edit product" back="/catalog">
        {all.error ? <T color={C.red}>{all.error}</T> : all.loading ? <Loading /> : <T>This product was not found.</T>}
      </Screen>
    );
  }

  const shown = photo?.uri ?? productImageUrl(imagePath);

  return (
    <Screen title={id ? 'Edit product' : 'Add product'} back="/catalog" footer={<Btn title={id ? 'Save changes' : 'Add product'} onPress={save} loading={busy} />}>
      <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'center' }}>
        <View style={{ width: 96, height: 96, borderRadius: R.card, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, overflow: 'hidden' }}>
          {shown ? <Image source={{ uri: shown }} style={{ width: 96, height: 96 }} contentFit="contain" /> : null}
        </View>
        <View style={{ flex: 1, gap: S.sm }}>
          <Btn title="Take photo" icon="camera-outline" kind="secondary" small onPress={() => choose('camera')} />
          <Btn title="Choose photo" icon="image-outline" kind="secondary" small onPress={() => choose('library')} />
        </View>
      </View>
      <Field label="Product name" value={name} onChangeText={setName} placeholder="e.g. Methylated Spirit" />
      <Field label="Pack size" value={pack} onChangeText={setPack} placeholder="e.g. 120ml" hint="Shown on the blue tag next to the name." />
      <Field label="Category (optional)" value={category} onChangeText={setCategory} placeholder="e.g. Spirit, Masks, Cleaners" />
      <View style={{ flexDirection: 'row', gap: S.md }}>
        <Field label="Net rate" prefix="Rs." value={rate} onChangeText={setRate} keyboardType="decimal-pad" style={{ flex: 1 }} hint="Before the customer's discount" />
        <Field label="Retail price (optional)" prefix="Rs." value={retail} onChangeText={setRetail} keyboardType="decimal-pad" style={{ flex: 1 }} />
      </View>
      <Field label="Packing (optional)" value={packing} onChangeText={setPacking} placeholder="e.g. 100 pc per carton" />
      <View style={{ flexDirection: 'row', gap: S.md }}>
        {!id ? <Field label="Stock now" value={initial} onChangeText={setInitial} keyboardType="number-pad" placeholder="0" style={{ flex: 1 }} /> : null}
        <Field label="Warn me when stock reaches" value={low} onChangeText={setLow} keyboardType="number-pad" style={{ flex: 1 }} />
      </View>
      <Toggle label="Show to customers" value={active} onChange={setActive} hint="Turn off to hide the product without deleting it." />
      {id ? <Btn title="Stock and history" icon="layers-outline" kind="secondary" onPress={() => router.push(`/product/stock?id=${id}` as any)} /> : null}
      {error ? <T color={C.red}>{error}</T> : null}
    </Screen>
  );
}
