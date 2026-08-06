// Módulo de Fabricación (MRP) — Fase 2: Recetas de producción (Bill of
// Materials). Cada producto terminado del inventario puede tener varias
// versiones de receta; solo una puede estar "activa" a la vez (lo hace
// cumplir un índice único parcial en la BD sobre bom_versions). Reutiliza el
// mismo módulo de permisos que ManguerasScreen ('mangueras' = "Fabricación").
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { BomLinesEditor } from '../components/BomLinesEditor';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { norm, cmpText } from '../lib/text';
import { useAuth } from '../context/AuthContext';
import { levelMeets } from '../lib/permissions';
import { useToast } from '../components/ToastProvider';
import { InventoryItem, BomVersion, BomVersionStatus, BomComponentLine } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type Tone = 'info' | 'warning' | 'danger' | 'success';
function toneSoft(colors: any, tone: Tone) {
  switch (tone) {
    case 'success': return { bg: colors.successSoftBg, border: colors.successSoftBorder, text: colors.successSoftText };
    case 'warning': return { bg: colors.warningSoftBg, border: colors.warningSoftBorder, text: colors.warningSoftText };
    case 'danger': return { bg: colors.dangerSoftBg, border: colors.dangerSoftBorder, text: colors.dangerSoftText };
    default: return { bg: colors.infoSoftBg, border: colors.infoSoftBorder, text: colors.infoSoftText };
  }
}
function Pill({ label, tone, colors }: { label: string; tone: Tone; colors: any }) {
  const t = toneSoft(colors, tone);
  return (
    <View style={{ backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: t.text, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </View>
  );
}

const STATUS_INFO: Record<BomVersionStatus, { label: string; tone: Tone }> = {
  borrador: { label: '🟡 Borrador', tone: 'warning' },
  activa: { label: '🟢 Activa', tone: 'success' },
  obsoleta: { label: '⚪ Obsoleta', tone: 'info' },
};

const fmtFecha = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso);
};

export default function BomScreen() {
  const { colors } = useTheme();
  const { moduleLevel, session } = useAuth();
  const toast = useToast();
  const level = moduleLevel('mangueras');

  if (level === 'none') {
    return (
      <Screen>
        <SectionTitle>Recetas (BoM)</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }
  // Activar una receta usa el mismo nivel que crear/editar: no hay una capa de
  // aprobación aparte para esto (a diferencia del pago de mangueras).
  const canWrite = levelMeets(level, 'escritura');

  const { data: items, loading: loadingItems } = useTable<InventoryItem>('inventory_items', { orderBy: 'name' });
  const { data: versions, loading: loadingVersions, refetch: refetchVersions } = useTable<BomVersion>('bom_versions', { orderBy: 'created_at', ascending: false });

  const productItems = useMemo(
    () => items.filter((i) => i.item_kind === 'producto_terminado').slice().sort((a, b) => cmpText(a.name, b.name)),
    [items]
  );

  // ── Selector de producto ────────────────────────────────────────────────
  const [productId, setProductId] = useState<string | null>(null);
  const [productOpen, setProductOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const product = productId ? items.find((i) => i.id === productId) : undefined;

  const productOptions = useMemo(() => {
    const q = norm(productQuery);
    const list = q ? productItems.filter((p) => norm(`${p.name} ${p.sku ?? ''}`).includes(q)) : productItems;
    return list.slice(0, 30);
  }, [productItems, productQuery]);

  const versionsForProduct = useMemo(() => {
    if (!productId) return [];
    return versions
      .filter((v) => v.product_item_id === productId)
      .slice()
      .sort((a, b) => b.version_no - a.version_no);
  }, [versions, productId]);

  // ── Edición de una versión ──────────────────────────────────────────────
  const [editing, setEditing] = useState<BomVersion | null>(null);
  const [outputQty, setOutputQty] = useState('1');
  const [outputUnit, setOutputUnit] = useState('');
  const [components, setComponents] = useState<BomComponentLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);

  const openEdit = (v: BomVersion) => {
    setEditing(v);
    setOutputQty(v.output_qty != null ? String(v.output_qty) : '1');
    setOutputUnit(v.output_unit ?? '');
    setComponents(v.components ?? []);
  };
  const closeEdit = () => setEditing(null);

  const [creating, setCreating] = useState(false);
  const nuevaVersion = async () => {
    if (!productId) return;
    setCreating(true);
    const maxNo = versionsForProduct.reduce((m, v) => Math.max(m, v.version_no || 0), 0);
    const { data, error } = await supabase
      .from('bom_versions')
      .insert({
        product_item_id: productId,
        version_no: maxNo + 1,
        status: 'borrador',
        output_qty: 1,
        output_unit: product?.unit ?? null,
        components: [],
        created_by: session?.user?.id ?? null,
      })
      .select()
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error(error?.message || 'No se pudo crear la versión.');
      return;
    }
    refetchVersions();
    openEdit(data as BomVersion);
  };

  const guardar = async () => {
    if (!editing) return;
    setSaving(true);
    const { error } = await supabase
      .from('bom_versions')
      .update({
        output_qty: Number(outputQty) || 0,
        output_unit: outputUnit.trim().toUpperCase() || null,
        components,
      })
      .eq('id', editing.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Receta guardada.');
    refetchVersions();
    closeEdit();
  };

  const activar = async () => {
    if (!editing) return;
    setActivating(true);
    // Guarda primero los cambios pendientes y luego activa, para no perder ediciones.
    const { error: saveErr } = await supabase
      .from('bom_versions')
      .update({ output_qty: Number(outputQty) || 0, output_unit: outputUnit.trim().toUpperCase() || null, components })
      .eq('id', editing.id);
    if (saveErr) {
      setActivating(false);
      toast.error(saveErr.message);
      return;
    }
    const { error } = await supabase
      .from('bom_versions')
      .update({ status: 'activa', activated_by: session?.user?.id ?? null, activated_at: new Date().toISOString() })
      .eq('id', editing.id);
    setActivating(false);
    if (error) {
      // La BD rechaza una segunda receta activa para el mismo producto (índice único parcial).
      if ((error as any).code === '23505' || /duplicate key|unique/i.test(error.message)) {
        toast.error('Ya hay una receta activa para este producto — desactívala primero.');
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success('Receta activada.');
    refetchVersions();
    closeEdit();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  if ((loadingItems && items.length === 0) || (loadingVersions && versions.length === 0)) {
    return <Screen><Loading /></Screen>;
  }

  return (
    <Screen>
      <SectionTitle>📋 Recetas (BoM)</SectionTitle>

      {/* Selector de producto terminado */}
      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🏷️ Producto</Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>Busca el producto terminado para ver o crear sus recetas.</Text>
        <TouchableOpacity onPress={() => setProductOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }} numberOfLines={1}>
            {product ? product.name : 'Seleccionar producto…'}
          </Text>
          <Text style={{ color: colors.brandText, fontWeight: '800' }}>{productOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {productOpen ? (
          <View style={{ marginTop: spacing.xs }}>
            <TextInput value={productQuery} onChangeText={setProductQuery} placeholder="🔎 Buscar por nombre o SKU…" placeholderTextColor={colors.muted} style={input} />
            <View style={{ maxHeight: 240, marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
              {productOptions.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.sm }}>
                  {productItems.length === 0 ? 'Sin productos terminados registrados en el inventario.' : 'Sin resultados.'}
                </Text>
              ) : productOptions.map((p) => (
                <TouchableOpacity key={p.id} onPress={() => { setProductId(p.id); setProductOpen(false); setProductQuery(''); }} style={{ paddingVertical: 8, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{p.name}</Text>
                  {p.sku ? <Text style={{ color: colors.muted, fontSize: 11 }}>SKU {p.sku}</Text> : null}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}
      </Card>

      {productId ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
            <SectionTitle>Versiones de receta</SectionTitle>
            {canWrite ? (
              <TouchableOpacity onPress={nuevaVersion} disabled={creating} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, opacity: creating ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{creating ? 'Creando…' : '+ Nueva versión'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {versionsForProduct.length === 0 ? (
            <EmptyState title="Sin recetas" subtitle="Este producto todavía no tiene ninguna versión de receta." />
          ) : (
            versionsForProduct.map((v) => {
              const st = STATUS_INFO[v.status] ?? STATUS_INFO.borrador;
              return (
                <TouchableOpacity key={v.id} onPress={() => openEdit(v)} activeOpacity={0.8}>
                  <Card>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>Versión {v.version_no}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          Rinde {v.output_qty ?? 0} {v.output_unit || ''} · {(v.components || []).length} componente(s)
                        </Text>
                      </View>
                      <Pill label={st.label} tone={st.tone} colors={colors} />
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Creada el {fmtFecha(v.created_at)}</Text>
                  </Card>
                </TouchableOpacity>
              );
            })
          )}
        </>
      ) : null}

      {/* Editor de una versión */}
      <Modal visible={!!editing} animationType="slide" onRequestClose={closeEdit}>
        <Screen>
          <ScrollView>
            {editing ? (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <SectionTitle>Receta — Versión {editing.version_no}</SectionTitle>
                  <Pill label={(STATUS_INFO[editing.status] ?? STATUS_INFO.borrador).label} tone={(STATUS_INFO[editing.status] ?? STATUS_INFO.borrador).tone} colors={colors} />
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>{product?.name}</Text>

                <Card>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Cantidad de salida</Text>
                  <TextInput value={outputQty} editable={canWrite} onChangeText={setOutputQty} keyboardType="numeric" placeholder="1" placeholderTextColor={colors.muted} style={input} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Unidad de salida</Text>
                  <TextInput value={outputUnit} editable={canWrite} onChangeText={(t) => setOutputUnit(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. UND, KG, L" placeholderTextColor={colors.muted} style={input} />
                </Card>

                <Card>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Componentes</Text>
                  <BomLinesEditor value={components} onChange={setComponents} items={items} readOnly={!canWrite} />
                </Card>

                {canWrite ? (
                  <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <TouchableOpacity onPress={closeEdit} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={guardar} disabled={saving} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: saving ? 0.6 : 1 }}>
                        <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{saving ? 'Guardando…' : 'Guardar'}</Text>
                      </TouchableOpacity>
                    </View>
                    {editing.status === 'borrador' ? (
                      <TouchableOpacity onPress={activar} disabled={activating} style={{ backgroundColor: colors.successSoftBg, borderWidth: 1, borderColor: colors.successSoftBorder, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: activating ? 0.6 : 1 }}>
                        <Text style={{ color: colors.successSoftText, fontWeight: '800' }}>{activating ? 'Activando…' : '✅ Activar receta'}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : (
                  <TouchableOpacity onPress={closeEdit} style={{ marginTop: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : null}
          </ScrollView>
        </Screen>
      </Modal>

      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
