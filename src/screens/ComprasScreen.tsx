import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Image, Linking, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, ExpandableCard, AccordionGroup, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { CuentasTab, CUENTAS_TABS } from './CuentasScreen';
import { RequerimientoTab } from './RequerimientoTab';
import { pickAndUploadDocFile } from '../lib/photo';
import { Supplier, PurchaseRequest, PurchaseOrder, PurchaseLine, Company, InventoryLevel, HoseService, Encargado, HoseEmpresa, DirectPurchase } from '../types/database';
import { generalCompanies } from '../lib/companies';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { norm, cmpText } from '../lib/text';

const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function parseNum(t: string): number { const n = Number(String(t ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
const nowISO = () => new Date().toISOString();
const linesTotal = (items: PurchaseLine[]) => (items || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);

// ── Ayudantes de fecha para los reportes de gasto ────────────────────────────
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Lunes de la semana de la fecha dada. */
function mondayOf(d: Date) { const x = startOfDay(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; }
/** Clave + etiqueta del bucket de una fecha según el período elegido. */
function bucketFor(iso: string, period: 'dia' | 'semana' | 'mes') {
  const d = new Date(iso);
  if (period === 'dia') return { key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, label: `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}` };
  if (period === 'mes') return { key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, label: `${MESES[d.getMonth()]} ${d.getFullYear()}` };
  const m = mondayOf(d); return { key: `${m.getFullYear()}-${pad2(m.getMonth() + 1)}-${pad2(m.getDate())}`, label: `Semana del ${pad2(m.getDate())}/${pad2(m.getMonth() + 1)}` };
}

// Tono semántico del estado → se resuelve a las variantes Soft del tema (buen
// contraste en claro y oscuro). El badge NO cambia su lógica, solo su color.
type Tone = 'info' | 'warning' | 'danger' | 'success';
const REQ_STATUS: Record<string, { label: string; tone: Tone }> = {
  solicitada: { label: '📝 Solicitada', tone: 'warning' },
  aprobada: { label: '✅ Aprobada', tone: 'info' },
  rechazada: { label: '⛔ Rechazada', tone: 'danger' },
  ordenada: { label: '🧾 Ordenada', tone: 'success' },
};
const ORD_STATUS: Record<string, { label: string; tone: Tone }> = {
  borrador: { label: '📝 Borrador', tone: 'warning' },
  aprobada: { label: '✅ Aprobada', tone: 'info' },
  recibida: { label: '📦 Recibida', tone: 'success' },
  anulada: { label: '⛔ Anulada', tone: 'danger' },
};
/** Resuelve un tono de estado a su terna Soft (fondo · borde · texto) del tema. */
function toneSoft(colors: any, tone: Tone) {
  switch (tone) {
    case 'success': return { bg: colors.successSoftBg, border: colors.successSoftBorder, text: colors.successSoftText };
    case 'warning': return { bg: colors.warningSoftBg, border: colors.warningSoftBorder, text: colors.warningSoftText };
    case 'danger': return { bg: colors.dangerSoftBg, border: colors.dangerSoftBorder, text: colors.dangerSoftText };
    default: return { bg: colors.infoSoftBg, border: colors.infoSoftBorder, text: colors.infoSoftText };
  }
}

// ── Categorías de compra (para clasificar y reportar el gasto) ───────────────
const CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: 'repuestos', label: 'Repuestos / Maquinaria', icon: '🔧' },
  { key: 'oficina', label: 'Oficina / Administrativo', icon: '🏢' },
  { key: 'limpieza', label: 'Limpieza / Aseo', icon: '🧹' },
  { key: 'herramientas', label: 'Herramientas', icon: '🛠️' },
  { key: 'servicios', label: 'Servicios', icon: '⚡' },
  { key: 'otros', label: 'Otros', icon: '📦' },
];
const catInfo = (key: string | null) => CATEGORIES.find((c) => c.key === key) || { key: key || 'otros', label: key ? key.toUpperCase() : 'Sin categoría', icon: '📦' };

/** Agrupa una lista por empresa (company_id) para el acordeón. */
function groupByCompany<T extends { company_id: string | null }>(items: T[], nameOf: (id: string | null) => string) {
  const m = new Map<string, { key: string; name: string; items: T[] }>();
  items.forEach((it) => {
    const k = it.company_id ?? '__none__';
    const g = m.get(k) ?? { key: k, name: nameOf(it.company_id), items: [] };
    g.items.push(it);
    m.set(k, g);
  });
  return [...m.values()].sort((a, b) => cmpText(a.name, b.name));
}

/** Etiqueta de estado (badge Soft): fondo tenue + borde + texto legible. */
function Pill({ label, bg, border, text }: { label: string; bg: string; border: string; text: string }) {
  return (
    <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: text, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </View>
  );
}

// ── Editor de renglones (descripción · cantidad · unidad · precio) ───────────
function LineEditor({ items, setItems, priceLabel, readOnly, catalog, noPrice }: { items: PurchaseLine[]; setItems: (l: PurchaseLine[]) => void; priceLabel: string; readOnly?: boolean; catalog?: InventoryLevel[]; noPrice?: boolean }) {
  const { colors } = useTheme();
  const [focus, setFocus] = useState<number | null>(null);
  const upd = (i: number, patch: Partial<PurchaseLine>) => setItems(items.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const inputStyle = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, color: colors.text, fontSize: 13 } as const;
  const pick = (i: number, it: InventoryLevel) => { upd(i, { description: it.name, unit: it.unit || '', item_id: it.id, price: Number(it.avg_cost) || items[i]?.price || 0 }); setFocus(null); };
  return (
    <View style={{ gap: spacing.xs }}>
      {items.map((l, i) => {
        const q = norm(l.description);
        const sugs = (!readOnly && catalog && focus === i && q.length >= 2 && !l.item_id)
          ? catalog.filter((c) => norm(c.name).includes(q)).slice(0, 6) : [];
        return (
        <View key={i} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: 6, backgroundColor: colors.surfaceAlt }}>
          <TextInput value={l.description} editable={!readOnly} onFocus={() => setFocus(i)} onChangeText={(t) => upd(i, { description: t.toUpperCase(), item_id: null })} placeholder="Descripción (ej. FILTRO DE ACEITE)" placeholderTextColor={colors.muted} autoCapitalize="characters" style={inputStyle} />
          {l.item_id ? <Text style={{ color: colors.success, fontSize: 11, fontWeight: '700' }}>✓ Producto del inventario</Text> : null}
          {sugs.length > 0 ? (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' }}>
              {sugs.map((s) => (
                <TouchableOpacity key={s.id} onPress={() => pick(i, s)} style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{s.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>Stock: {s.stock} {s.unit || ''} · PMP {usd(s.avg_cost)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput value={l.qty ? String(l.qty) : ''} editable={!readOnly} onChangeText={(t) => upd(i, { qty: parseNum(t) })} keyboardType="numeric" placeholder="Cant." placeholderTextColor={colors.muted} style={[inputStyle, { flex: 1 }]} />
            <TextInput value={l.unit ?? ''} editable={!readOnly} onChangeText={(t) => upd(i, { unit: t.toUpperCase() })} placeholder="Unidad" placeholderTextColor={colors.muted} autoCapitalize="characters" style={[inputStyle, { flex: 1 }]} />
            {!noPrice ? (
              <TextInput value={l.price ? String(l.price) : ''} editable={!readOnly} onChangeText={(t) => upd(i, { price: parseNum(t) })} keyboardType="numeric" placeholder={priceLabel} placeholderTextColor={colors.muted} style={[inputStyle, { flex: 1 }]} />
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            {!noPrice ? <Text style={{ color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] as any }}>Subtotal: {usd((Number(l.qty) || 0) * (Number(l.price) || 0))}</Text> : <View />}
            {!readOnly ? (
              <TouchableOpacity onPress={() => setItems(items.filter((_, j) => j !== i))}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>Quitar</Text></TouchableOpacity>
            ) : null}
          </View>
        </View>
        );
      })}
      {!readOnly ? (
        <TouchableOpacity onPress={() => setItems([...items, { description: '', qty: 1, unit: '', price: 0 }])} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13 }}>+ Agregar renglón</Text>
        </TouchableOpacity>
      ) : null}
      {!noPrice ? <Text style={{ color: colors.brandText, fontWeight: '800', textAlign: 'right', marginTop: 2, fontVariant: ['tabular-nums'] as any }}>Total: {usd(linesTotal(items))}</Text> : null}
    </View>
  );
}

function CompanyPicker({ companies, value, onChange, colors }: { companies: Company[]; value: string; onChange: (id: string) => void; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      {companies.map((c) => {
        const on = value === c.id;
        return (
          <TouchableOpacity key={c.id} onPress={() => onChange(c.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.name}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function CategoryPicker({ value, onChange, colors }: { value: string; onChange: (k: string) => void; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      {CATEGORIES.map((c) => {
        const on = value === c.key;
        return (
          <TouchableOpacity key={c.key} onPress={() => onChange(c.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            <Text style={{ fontSize: 13 }}>{c.icon}</Text>
            <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Proveedores ──────────────────────────────────────────────────────────────
// Lista con COLORES del tema (antes el texto salía negro/invisible en oscuro),
// ETIQUETAS de rubro por proveedor (VÍVERES, REPUESTOS…) y FILTRO por etiqueta/búsqueda.
function ProveedoresTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: suppliers, loading, refetch } = useTable<Supplier>('suppliers', { orderBy: 'name' });

  const [q, setQ] = useState('');
  const [tagFiltro, setTagFiltro] = useState('');

  const allTags = useMemo(() => {
    const s = new Set<string>();
    suppliers.forEach((p) => (p.tags ?? []).forEach((t) => t && s.add(t)));
    return [...s].sort((a, b) => cmpText(a, b));
  }, [suppliers]);

  const shown = useMemo(() => suppliers.filter((p) => {
    if (tagFiltro && !(p.tags ?? []).includes(tagFiltro)) return false;
    if (q.trim()) {
      const n = norm(q);
      const hay = norm(p.name).includes(n) || norm(p.rif ?? '').includes(n) || (p.tags ?? []).some((t) => norm(t).includes(n));
      if (!hay) return false;
    }
    return true;
  }), [suppliers, q, tagFiltro]);

  // Editor (alta/edición)
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [name, setName] = useState('');
  const [rif, setRif] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  // Error EN LÍNEA dentro del Modal: el toast queda TAPADO por el Modal a pantalla
  // completa (web), así el usuario no veía por qué "no deja registrar". Ver la
  // memoria confirm-dentro-de-modal-web / el mismo arreglo en RequerimientoTab.
  const [formErr, setFormErr] = useState<string | null>(null);

  const abrir = (s: Supplier | null) => {
    setEditing(s); setFormErr(null);
    setName(s?.name ?? ''); setRif(s?.rif ?? ''); setPhone(s?.phone ?? ''); setEmail(s?.email ?? ''); setAddress(s?.address ?? '');
    setTags(s?.tags ?? []); setTagInput('');
    setOpen(true);
  };
  const addTag = (raw?: string) => {
    const t = (raw ?? tagInput).trim().toUpperCase();
    if (!t) return;
    setTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagInput('');
  };
  const guardar = async () => {
    setFormErr(null);
    if (!name.trim()) { setFormErr('El nombre es obligatorio.'); return; }
    setBusy(true);
    const payload = {
      name: name.trim().toUpperCase(), rif: rif.trim() || null, phone: phone.trim() || null,
      email: email.trim() || null, address: address.trim() || null, tags: tags.length ? tags : null,
    };
    const { error } = editing
      ? await supabase.from('suppliers').update(payload).eq('id', editing.id)
      : await supabase.from('suppliers').insert(payload);
    setBusy(false);
    if (error) { setFormErr(error.message); toast.error(error.message); return; }
    setOpen(false); refetch();
  };
  const borrar = async () => {
    if (!editing) return;
    const ok = await confirm({ title: 'Eliminar proveedor', message: `¿Eliminar a "${editing.name}"?`, confirmText: 'Eliminar', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('suppliers').delete().eq('id', editing.id);
    if (error) return toast.error(error.message);
    setOpen(false); refetch();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: 14 } as const;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Proveedores</SectionTitle>
        {canWrite ? (
          <TouchableOpacity onPress={() => abrir(null)} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nuevo</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Filtro: búsqueda + etiquetas de rubro */}
      <Card>
        <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar por nombre, RIF o etiqueta…" placeholderTextColor={colors.muted} style={input} />
        {allTags.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {['', ...allTags].map((t) => {
                const on = tagFiltro === t;
                return (
                  <TouchableOpacity key={t || '__all'} onPress={() => setTagFiltro(t)} style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: on ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.brand : colors.border }}>
                    <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{t ? `🏷️ ${t}` : 'Todos'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        ) : null}
      </Card>

      {loading ? <Loading /> : shown.length === 0 ? (
        <EmptyState title={q || tagFiltro ? 'Sin resultados' : 'Sin proveedores'} subtitle={q || tagFiltro ? 'Prueba con otro filtro.' : 'Registra a quién le compras.'} />
      ) : shown.map((s) => (
        <TouchableOpacity key={s.id} activeOpacity={canWrite ? 0.7 : 1} onPress={() => canWrite && abrir(s)}>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{s.name}</Text>
            {s.rif ? <Text style={{ color: colors.muted, fontSize: 13 }}>RIF {s.rif}</Text> : null}
            {s.phone ? <Text style={{ color: colors.muted, fontSize: 13 }}>{s.phone}</Text> : null}
            {(s.tags ?? []).length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: spacing.xs }}>
                {(s.tags ?? []).map((t) => (
                  <View key={t} style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                    <Text style={{ color: colors.brandContrast, fontSize: 11, fontWeight: '800' }}>🏷️ {t}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {canWrite ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Toca para editar</Text> : null}
          </Card>
        </TouchableOpacity>
      ))}
      <View style={{ height: spacing.xl }} />

      {/* Modal alta/edición */}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '90%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, marginBottom: spacing.sm }}>{editing ? 'Editar proveedor' : 'Nuevo proveedor'}</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Nombre *</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Nombre o razón social" placeholderTextColor={colors.muted} style={input} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>RIF</Text>
              <TextInput value={rif} onChangeText={setRif} placeholder="J-000000000" placeholderTextColor={colors.muted} style={input} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Teléfono</Text>
              <TextInput value={phone} onChangeText={setPhone} placeholder="04xx…" placeholderTextColor={colors.muted} style={input} keyboardType="phone-pad" />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Correo</Text>
              <TextInput value={email} onChangeText={setEmail} placeholder="correo@…" placeholderTextColor={colors.muted} style={input} autoCapitalize="none" keyboardType="email-address" />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Dirección</Text>
              <TextInput value={address} onChangeText={setAddress} placeholder="Dirección" placeholderTextColor={colors.muted} style={input} />

              {/* Etiquetas de rubro */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Etiquetas (rubro que vende)</Text>
              {tags.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: spacing.xs }}>
                  {tags.map((t) => (
                    <TouchableOpacity key={t} onPress={() => setTags((prev) => prev.filter((x) => x !== t))} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: colors.brandContrast, fontSize: 12, fontWeight: '800' }}>🏷️ {t}</Text>
                      <Text style={{ color: colors.brandContrast, fontSize: 12, fontWeight: '900' }}>✕</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <TextInput value={tagInput} onChangeText={setTagInput} onSubmitEditing={() => addTag()} placeholder="Ej.: VÍVERES" placeholderTextColor={colors.muted} style={[input, { flex: 1 }]} autoCapitalize="characters" />
                <TouchableOpacity onPress={() => addTag()} style={{ paddingHorizontal: spacing.md, justifyContent: 'center', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.brandText, fontWeight: '800' }}>➕ Agregar</Text>
                </TouchableOpacity>
              </View>
              {allTags.filter((t) => !tags.includes(t)).length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: spacing.xs }}>
                  {allTags.filter((t) => !tags.includes(t)).map((t) => (
                    <TouchableOpacity key={t} onPress={() => addTag(t)} style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>+ {t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              {formErr ? (
                <View style={{ marginTop: spacing.md, backgroundColor: colors.dangerSoftBg, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.danger }}>
                  <Text style={{ color: colors.dangerSoftText, fontWeight: '800', fontSize: 13 }}>⚠️ {formErr}</Text>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                <TouchableOpacity onPress={() => setOpen(false)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={guardar} disabled={busy} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: busy ? 0.6 : 1 }}>
                  <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : 'Guardar'}</Text>
                </TouchableOpacity>
              </View>
              {editing ? (
                <TouchableOpacity onPress={borrar} style={{ marginTop: spacing.sm, padding: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ color: colors.danger, fontWeight: '800' }}>Eliminar proveedor</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

// ── Compras directas ─────────────────────────────────────────────────────────
// Compra YA hecha (con factura) que entra DIRECTO al inventario al crearla y genera
// su cuenta por pagar (todo lo hace el trigger de la base, ver compras_directas.sql).
// Reemplaza al viejo flujo de "Solicitudes de pedido" (pedir sin precio → aprobar
// → orden): eso lo cubre la pestaña "Requerimiento".
function ComprasDirectasTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const toast = useToast();
  const { data: compras, loading, refetch } = useTable<DirectPurchase>('direct_purchases', { orderBy: 'created_at', ascending: false, realtimeFrom: 'direct_purchases' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const { data: suppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });
  const { data: catalog } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name' });
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa');
  const supplierName = (id: string | null) => (id ? suppliers.find((s) => s.id === id)?.name ?? '—' : '—');

  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState('');
  const [supplier, setSupplier] = useState('');
  const [category, setCategory] = useState('repuestos');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<PurchaseLine[]>([{ description: '', qty: 1, unit: '', price: 0 }]);
  const [factura, setFactura] = useState<{ url: string; kind: 'image' | 'pdf'; name: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [busy, setBusy] = useState(false);
  // Carpeta de Storage para la factura de ESTA compra en edición (la fila aún no
  // existe al subir; el path solo organiza el archivo, no depende del id real).
  const [draftId] = useState(() => (globalThis as any)?.crypto?.randomUUID?.() ?? String(Date.now()));
  // Vista de la factura ya cargada (imagen o PDF).
  const [preview, setPreview] = useState<DirectPurchase | null>(null);

  const resetForm = () => { setOpen(false); setCompany(''); setSupplier(''); setCategory('repuestos'); setNote(''); setItems([{ description: '', qty: 1, unit: '', price: 0 }]); setFactura(null); };

  const adjuntarFactura = async () => {
    setSubiendo(true);
    try {
      const res = await pickAndUploadDocFile('compras-directas', draftId);
      if (!res.ok) { if (res.error) toast.error(res.error); return; }
      setFactura({ url: res.url!, kind: res.kind ?? 'image', name: res.name ?? 'factura' });
      toast.success('Factura adjuntada.');
    } finally { setSubiendo(false); }
  };

  const crear = async () => {
    if (!company) return toast.error('Elige la empresa.');
    if (!supplier) return toast.error('Elige el proveedor (a quién se le paga).');
    // La compra directa SÍ lleva precio: entra al inventario con su costo.
    const clean = items.filter((l) => l.description.trim() && Number(l.qty) > 0);
    if (!clean.length) return toast.error('Agrega al menos un renglón con producto y cantidad.');
    setBusy(true);
    const { error } = await supabase.from('direct_purchases').insert({
      company_id: company, supplier_id: supplier, category,
      items: clean, total: linesTotal(clean),
      factura_url: factura?.url ?? null, factura_type: factura?.kind ?? null, factura_name: factura?.name ?? null,
      note: note.trim().toUpperCase() || null, created_by: session?.user?.id ?? null,
    });
    setBusy(false);
    if (error) {
      if (/direct_purchases|relation|does not exist|column/i.test(error.message)) { toast.error('Corre "compras_directas.sql" en Supabase para habilitar Compras Directas.'); return; }
      return toast.error(error.message);
    }
    resetForm();
    refetch();
    toast.success('Compra directa registrada: los productos entraron al inventario y se generó la cuenta por pagar.');
  };

  const verFactura = (c: DirectPurchase) => {
    if (!c.factura_url) return;
    if (Platform.OS === 'web') { setPreview(c); return; }
    Linking.openURL(c.factura_url);
  };

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Compras directas</SectionTitle>
        {canWrite ? (
          <TouchableOpacity onPress={() => setOpen(true)} style={{ backgroundColor: colors.accent, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>+ Nueva</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Compra ya hecha con su factura: al guardarla entra DIRECTO al inventario (entrada con su precio) y genera la cuenta por pagar al proveedor.</Text>

      {loading ? <Loading /> : compras.length === 0 ? (
        <EmptyState title="Sin compras directas" subtitle="Registra una compra directa: producto, precio y factura → entra al inventario." />
      ) : groupByCompany(compras, companyName).map((grp) => (
        <AccordionGroup key={grp.key} title={grp.name} count={grp.items.length}>
          {grp.items.map((c) => (
            <ExpandableCard
              key={c.id}
              summary={
                <View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                    <Text style={{ fontWeight: '800', fontSize: 15, color: colors.brandText, flex: 1 }} numberOfLines={1}>🛒 {c.code}</Text>
                    <Text style={{ color: colors.brandText, fontSize: 14, fontWeight: '800' }}>{usd(c.total)}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{catInfo(c.category).icon} {catInfo(c.category).label} · {(c.items || []).length} renglón(es) · 🏭 {supplierName(c.supplier_id)}</Text>
                </View>
              }
              detail={
                <>
                  {(c.items || []).map((l, i) => (
                    <Text key={i} style={{ color: colors.muted, fontSize: 12 }}>• {l.qty} {l.unit || ''} {l.description} — {usd((Number(l.qty) || 0) * (Number(l.price) || 0))}</Text>
                  ))}
                  {c.note ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Nota: {c.note}</Text> : null}
                  <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700', marginTop: 2 }}>✓ Cargada al inventario · cuenta por pagar generada</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                    {c.factura_url ? (
                      <TouchableOpacity onPress={() => verFactura(c)} style={{ flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>📎 Ver factura{c.factura_type === 'pdf' ? ' (PDF)' : ''}</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={{ color: colors.muted, fontSize: 12 }}>Sin factura adjunta.</Text>
                    )}
                  </View>
                </>
              }
            />
          ))}
        </AccordionGroup>
      ))}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Screen>
          <ScrollView>
            <SectionTitle>Nueva compra directa</SectionTitle>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Empresa</Text>
              <CompanyPicker companies={generalCompanies(companies)} value={company} onChange={setCompany} colors={colors} />
            </Card>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Proveedor (a quién se le paga)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {suppliers.map((s) => {
                  const on = supplier === s.id;
                  return (
                    <TouchableOpacity key={s.id} onPress={() => setSupplier(s.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{s.name}</Text>
                    </TouchableOpacity>
                  );
                })}
                {suppliers.length === 0 ? <Text style={{ color: colors.muted, fontSize: 13 }}>Registra proveedores en su pestaña.</Text> : null}
              </View>
            </Card>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Categoría del gasto</Text>
              <CategoryPicker value={category} onChange={setCategory} colors={colors} />
            </Card>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Renglones (producto · cantidad · precio)</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>Cada renglón entra al inventario como ENTRADA con su precio. Al escribir, se sugieren productos ya registrados.</Text>
              <LineEditor items={items} setItems={setItems} priceLabel="Precio unit." catalog={catalog} />
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 14, marginTop: spacing.xs, textAlign: 'right' }}>Total: {usd(linesTotal(items))}</Text>
            </Card>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Factura</Text>
              <TouchableOpacity onPress={adjuntarFactura} disabled={subiendo} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: subiendo ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>{subiendo ? '⏳ Subiendo…' : factura ? `📎 ${factura.name} · Cambiar` : '📎 Adjuntar factura (imagen o PDF)'}</Text>
              </TouchableOpacity>
            </Card>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Nota (opcional)</Text>
              <TextInput value={note} onChangeText={(t) => setNote(t.toUpperCase())} autoCapitalize="characters" placeholder="OBSERVACIÓN…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
            </Card>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={resetForm} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={crear} disabled={busy} style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : 'Registrar compra directa'}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* Ver factura (web): imagen o PDF embebido. En nativo se abre con Linking. */}
      <Modal visible={!!preview} animationType="slide" transparent onRequestClose={() => setPreview(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>📎 {preview?.factura_name || 'Factura'} · {preview?.code}</Text>
              <TouchableOpacity onPress={() => setPreview(null)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill }}><Text style={{ color: colors.text, fontWeight: '800' }}>Cerrar</Text></TouchableOpacity>
            </View>
            {preview?.factura_url ? (
              preview.factura_type === 'pdf' ? (
                Platform.OS === 'web'
                  ? React.createElement('iframe', { src: preview.factura_url, style: { width: '100%', height: '70vh', border: 'none', borderRadius: 8 } })
                  : <Text style={{ color: colors.muted }}>Abriendo PDF…</Text>
              ) : (
                <Image source={{ uri: preview.factura_url }} style={{ width: '100%', height: 460, borderRadius: radius.md }} resizeMode="contain" />
              )
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

// ── Órdenes ──────────────────────────────────────────────────────────────────
function OrdenesTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const { data: orders, loading, refetch } = useTable<PurchaseOrder>('purchase_orders', { orderBy: 'created_at', ascending: false });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const { data: suppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });
  const { data: catalog, refetch: refetchCatalog } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name' });
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa');
  const supplierName = (id: string | null) => (id ? suppliers.find((s) => s.id === id)?.name ?? '—' : '—');

  const [sel, setSel] = useState<PurchaseOrder | null>(null);
  const [supplier, setSupplier] = useState('');
  const [items, setItems] = useState<PurchaseLine[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const openEdit = (o: PurchaseOrder) => { setSel(o); setSupplier(o.supplier_id ?? ''); setItems(o.items || []); setNote(o.note ?? ''); };
  const readOnly = sel ? sel.status !== 'borrador' : false;

  const guardar = async () => {
    if (!sel) return;
    setBusy(true);
    await supabase.from('purchase_orders').update({ supplier_id: supplier || null, items, total: linesTotal(items), note: note.trim().toUpperCase() || null }).eq('id', sel.id);
    setBusy(false); setSel(null); refetch();
  };

  const aprobar = async () => {
    if (!sel) return;
    if (!supplier) return toast.error('Elige el proveedor antes de aprobar.');
    const ok = await confirm({ title: 'Aprobar orden', message: `Aprobar la orden a ${supplierName(supplier)} por ${usd(linesTotal(items))}?`, confirmText: 'Aprobar' });
    if (!ok) return;
    await supabase.from('purchase_orders').update({ supplier_id: supplier, items, total: linesTotal(items), note: note.trim().toUpperCase() || null, status: 'aprobada', approved_by: session?.user?.id ?? null, approved_at: nowISO() }).eq('id', sel.id);
    setSel(null); refetch();
  };

  const recibir = async (o: PurchaseOrder) => {
    const ok = await confirm({ title: 'Recibir orden', message: `¿Confirmas que llegó la orden a ${supplierName(o.supplier_id)}? Cada renglón se cargará al inventario como ENTRADA y se recalculará el PMP.`, confirmText: 'Recibir y cargar' });
    if (!ok) return;
    try {
      // 1) Resolver o crear el producto de cada renglón y registrar la entrada (trazabilidad con la orden).
      const { data: existing } = await supabase.from('inventory_items').select('id,name');
      const findId = (name: string) => (existing || []).find((r: any) => norm(r.name) === norm(name))?.id as string | undefined;
      const createdCache: Record<string, string> = {};
      for (const line of (o.items || [])) {
        const name = (line.description || '').trim();
        if (!name || !(Number(line.qty) > 0)) continue;
        let itemId = line.item_id || findId(name) || createdCache[norm(name)];
        if (!itemId) {
          const { data: ins, error } = await supabase.from('inventory_items')
            .insert({ name: name.toUpperCase(), category: o.category ?? null, unit: line.unit ?? null, company_id: o.company_id ?? null })
            .select('id').single();
          if (error) throw error;
          itemId = ins.id; createdCache[norm(name)] = itemId;
        }
        const { error: mErr } = await supabase.from('inventory_movements').insert({
          item_id: itemId, kind: 'entrada', qty: Number(line.qty) || 0, unit_cost: Number(line.price) || 0,
          order_id: o.id, company_id: o.company_id ?? null, reason: 'COMPRA', created_by: session?.user?.id ?? null,
        });
        if (mErr) throw mErr;
      }
      // 2) Marcar la orden como recibida.
      await supabase.from('purchase_orders').update({ status: 'recibida', received_at: nowISO() }).eq('id', o.id);
      refetch(); refetchCatalog();
      toast.success('Orden recibida y cargada al inventario. El PMP de cada producto se actualizó.');
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo cargar al inventario.');
    }
  };

  // ANULAR una orden YA APROBADA: el mismo gerente la deja sin efecto. Si nació de un
  // Requerimiento, se rechaza el requerimiento y el trigger (req_sync_compra) anula la
  // orden + la cuenta por pagar dejando todo consistente; si es una orden de solicitud
  // directa, se anula la orden y su cuenta por pagar pendiente (si existe).
  const anular = async (o: PurchaseOrder) => {
    const ok = await confirm({
      title: 'Anular orden',
      message: `¿Anular la orden a ${supplierName(o.supplier_id)} por ${usd(o.total)}?\n\nQuedará ANULADA y su cuenta por pagar pendiente (si existe) también. No revierte lo ya recibido.`,
      confirmText: 'Anular', cancelText: 'Cancelar', danger: true,
    });
    if (!ok) return;
    if (o.inventory_requirement_id) {
      const { error } = await supabase.from('inventory_requirements')
        .update({ status: 'rechazado', decided_by: session?.user?.id ?? null, decided_at: nowISO() })
        .eq('id', o.inventory_requirement_id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from('purchase_orders').update({ status: 'anulada' }).eq('id', o.id);
      if (error) return toast.error(error.message);
      await supabase.from('cuentas').update({ estado: 'anulada', updated_at: nowISO() }).eq('order_id', o.id).eq('estado', 'pendiente');
    }
    refetch();
    toast.success('Orden anulada.');
  };

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Órdenes de compra</SectionTitle>
      {loading ? <Loading /> : orders.length === 0 ? (
        <EmptyState title="Sin órdenes" subtitle="Las órdenes se generan desde una solicitud aprobada." />
      ) : groupByCompany(orders, companyName).map((grp) => (
        <AccordionGroup key={grp.key} title={grp.name} count={grp.items.length}>
          {grp.items.map((o) => {
            const st = ORD_STATUS[o.status] ?? ORD_STATUS.borrador;
            return (
              <ExpandableCard
                key={o.id}
                summary={
                  <View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                      <Text style={{ fontWeight: '800', fontSize: 14, color: colors.brandText, flex: 1, fontVariant: ['tabular-nums'] as any }} numberOfLines={1}>{usd(o.total)} · {supplierName(o.supplier_id)}</Text>
                      <Pill label={st.label} {...toneSoft(colors, st.tone)} />
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{catInfo(o.category).icon} {catInfo(o.category).label}</Text>
                  </View>
                }
                detail={
                  <>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Proveedor: {supplierName(o.supplier_id)}</Text>
                    <Text style={{ color: colors.brandText, fontSize: 14, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] as any }}>Total: {usd(o.total)}</Text>
                    {canWrite ? (
                      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                        {o.status === 'borrador' ? (
                          <TouchableOpacity onPress={() => openEdit(o)} style={{ flexGrow: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 13 }}>✎ Completar / Aprobar</Text></TouchableOpacity>
                        ) : o.status === 'aprobada' ? (
                          <>
                            <TouchableOpacity onPress={() => recibir(o)} style={{ flexGrow: 1, backgroundColor: colors.successSoftBg, borderWidth: 1, borderColor: colors.successSoftBorder, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.successSoftText, fontWeight: '800', fontSize: 13 }}>📦 Marcar recibida</Text></TouchableOpacity>
                            {/* El mismo gerente puede anular una orden ya aprobada. */}
                            <TouchableOpacity onPress={() => anular(o)} style={{ flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 13 }}>⛔ Anular</Text></TouchableOpacity>
                          </>
                        ) : (
                          <TouchableOpacity onPress={() => openEdit(o)} style={{ flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>👁 Ver</Text></TouchableOpacity>
                        )}
                      </View>
                    ) : null}
                  </>
                }
              />
            );
          })}
        </AccordionGroup>
      ))}

      <Modal visible={!!sel} animationType="slide" onRequestClose={() => setSel(null)}>
        <Screen>
          <ScrollView>
            <SectionTitle>{readOnly ? 'Orden de compra' : 'Completar orden'}</SectionTitle>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Proveedor</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {suppliers.map((s) => {
                  const on = supplier === s.id;
                  return (
                    <TouchableOpacity key={s.id} disabled={readOnly} onPress={() => setSupplier(s.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{s.name}</Text>
                    </TouchableOpacity>
                  );
                })}
                {suppliers.length === 0 ? <Text style={{ color: colors.muted, fontSize: 13 }}>Registra proveedores en su pestaña.</Text> : null}
              </View>
            </Card>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Renglones (precio unitario)</Text>
              <LineEditor items={items} setItems={setItems} priceLabel="Precio unit." readOnly={readOnly} catalog={catalog} />
            </Card>
            {!readOnly ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <TouchableOpacity onPress={guardar} disabled={busy} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Guardar borrador</Text></TouchableOpacity>
                <TouchableOpacity onPress={aprobar} disabled={busy} style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: colors.accentContrast, fontWeight: '800' }}>✅ Aprobar</Text></TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setSel(null)} style={{ marginTop: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text></TouchableOpacity>
            )}
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

// ── Resumen / Reportes de gasto ──────────────────────────────────────────────
function ResumenTab() {
  const { colors } = useTheme();
  const { data: orders, loading, refetch } = useTable<PurchaseOrder>('purchase_orders', { orderBy: 'created_at', ascending: false });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa');

  const [period, setPeriod] = useState<'dia' | 'semana' | 'mes'>('mes');
  const [catFilter, setCatFilter] = useState('');       // '' = todas
  const [companyFilter, setCompanyFilter] = useState(''); // '' = todas

  // Gasto real = órdenes aprobadas o recibidas (compromiso de dinero). Fecha base: aprobación o creación.
  const spend = useMemo(() => {
    const now = new Date();
    const todayKey = bucketFor(now.toISOString(), 'dia').key;
    const weekKey = bucketFor(now.toISOString(), 'semana').key;
    const monthKey = bucketFor(now.toISOString(), 'mes').key;
    let total = 0, count = 0, hoy = 0, semana = 0, mes = 0;
    const series = new Map<string, { label: string; total: number }>();
    const byCompany = new Map<string, number>();
    const byCat = new Map<string, number>();

    for (const o of orders) {
      if (o.status !== 'aprobada' && o.status !== 'recibida') continue;
      if (catFilter && (o.category ?? 'otros') !== catFilter) continue;
      if (companyFilter && o.company_id !== companyFilter) continue;
      const amount = Number(o.total) || 0;
      const iso = o.approved_at || o.created_at;
      total += amount; count += 1;
      if (bucketFor(iso, 'dia').key === todayKey) hoy += amount;
      if (bucketFor(iso, 'semana').key === weekKey) semana += amount;
      if (bucketFor(iso, 'mes').key === monthKey) mes += amount;
      const b = bucketFor(iso, period);
      const prev = series.get(b.key); series.set(b.key, { label: b.label, total: (prev?.total || 0) + amount });
      const ck = o.company_id || 'nada'; byCompany.set(ck, (byCompany.get(ck) || 0) + amount);
      const cat = o.category ?? 'otros'; byCat.set(cat, (byCat.get(cat) || 0) + amount);
    }
    const seriesArr = [...series.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([, v]) => v);
    const companyArr = [...byCompany.entries()].map(([id, t]) => ({ id, name: companyName(id === 'nada' ? null : id), total: t })).sort((a, b) => b.total - a.total);
    const catArr = [...byCat.entries()].map(([k, t]) => ({ ...catInfo(k), total: t })).sort((a, b) => b.total - a.total);
    return { total, count, hoy, semana, mes, seriesArr, companyArr, catArr };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, period, catFilter, companyFilter, companies]);

  const maxSeries = Math.max(1, ...spend.seriesArr.map((s) => s.total));
  const maxCompany = Math.max(1, ...spend.companyArr.map((s) => s.total));

  const Quick = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt }}>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>{label}</Text>
      <Text style={{ color, fontSize: 16, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] as any }}>{usd(value)}</Text>
    </View>
  );

  if (loading) return <Screen><SkeletonList /></Screen>;

  return (
    <Screen onRefresh={refetch} refreshing={loading}>
      <ConfigBanner />
      <SectionTitle>Resumen de gastos</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Incluye órdenes aprobadas y recibidas (gasto comprometido).</Text>

      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        <Quick label="HOY" value={spend.hoy} color={colors.brandText} />
        <Quick label="ESTA SEMANA" value={spend.semana} color={colors.accentSoftText} />
        <Quick label="ESTE MES" value={spend.mes} color={colors.successSoftText} />
      </View>

      {/* Filtros */}
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Agrupar por</Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
          {([['dia', 'Diario'], ['semana', 'Semanal'], ['mes', 'Mensual']] as const).map(([k, lbl]) => {
            const on = period === k;
            return (
              <TouchableOpacity key={k} onPress={() => setPeriod(k)} style={{ flex: 1, alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingVertical: spacing.xs }}>
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{lbl}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Categoría</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
          {[{ key: '', label: 'Todas', icon: '🗂️' }, ...CATEGORIES].map((c) => {
            const on = catFilter === c.key;
            return (
              <TouchableOpacity key={c.key || 'all'} onPress={() => setCatFilter(c.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                <Text style={{ fontSize: 12 }}>{c.icon}</Text>
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Empresa</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {[{ id: '', name: 'Todas' }, ...generalCompanies(companies)].map((c) => {
            const on = companyFilter === c.id;
            return (
              <TouchableOpacity key={c.id || 'all'} onPress={() => setCompanyFilter(c.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>{c.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {/* Total del filtro — banda de marca */}
      <View style={{ backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ color: colors.brandContrast, opacity: 0.85, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 }}>TOTAL FILTRADO</Text>
          <Text style={{ color: colors.brandContrast, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{usd(spend.total)}</Text>
        </View>
        <Text style={{ color: colors.brandContrast, opacity: 0.75, fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] as any }}>{spend.count} orden(es) · promedio {usd(spend.count ? spend.total / spend.count : 0)}</Text>
      </View>

      {/* Serie por período */}
      <SectionTitle>Gasto por {period === 'dia' ? 'día' : period === 'semana' ? 'semana' : 'mes'}</SectionTitle>
      {spend.seriesArr.length === 0 ? (
        <EmptyState title="Sin gasto registrado" subtitle="Aprueba órdenes de compra para ver el gasto aquí." />
      ) : (
        <Card>
          {spend.seriesArr.map((s, i) => (
            <View key={i} style={{ marginBottom: i === spend.seriesArr.length - 1 ? 0 : spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{s.label}</Text>
                <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>{usd(s.total)}</Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
                <View style={{ width: `${(s.total / maxSeries) * 100}%`, height: 8, backgroundColor: colors.brand }} />
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* Ranking por empresa */}
      {spend.companyArr.length > 0 ? (
        <>
          <SectionTitle>Qué empresa genera más gasto</SectionTitle>
          <Card>
            {spend.companyArr.map((c, i) => (
              <View key={c.id} style={{ marginBottom: i === spend.companyArr.length - 1 ? 0 : spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{i + 1}. {c.name}</Text>
                  <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>{usd(c.total)}</Text>
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
                  <View style={{ width: `${(c.total / maxCompany) * 100}%`, height: 8, backgroundColor: colors.success }} />
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {/* Ranking por categoría */}
      {spend.catArr.length > 0 ? (
        <>
          <SectionTitle>Gasto por categoría</SectionTitle>
          <Card>
            {spend.catArr.map((c, i) => (
              <View key={c.key} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{c.icon} {c.label}</Text>
                <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] as any }}>{usd(c.total)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

// ── Mangueras por aprobar ────────────────────────────────────────────────────
// Espejo de aprobación del módulo Mangueras (Taller) DENTRO de Compras: el
// gerente aprueba aquí los pagos pendientes sin entrar al otro módulo. La
// manguera se sigue creando en su módulo; acá SOLO se envía a autorización y se
// aprueba el pago. Réplica del flujo de `ManguerasScreen.tsx`.
const HOSE_INSTALL: Record<string, { label: string; tone: Tone }> = {
  en_proceso: { label: '🟡 En proceso', tone: 'warning' },
  instalada: { label: '🟢 Instalada', tone: 'success' },
};
const HOSE_PAYMENT: Record<string, { label: string; tone: Tone }> = {
  pendiente: { label: '⏳ Pendiente', tone: 'warning' },
  en_proceso_autorizacion: { label: '📤 Pendiente por autorización', tone: 'info' },
  pagado: { label: '✅ Pagado', tone: 'success' },
};

function ManguerasAprobarTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const { data: hoses, loading, refetch } = useTable<HoseService>('hose_services', { orderBy: 'created_at', ascending: false, realtimeFrom: 'hose_services' });
  // Empresa a cobrar: LISTA PROPIA de mangueras (hose_empresas), no el catálogo companies.
  const { data: hoseEmpresas } = useTable<HoseEmpresa>('hose_empresas', { orderBy: 'name' });
  const { data: encargados } = useTable<Encargado>('encargados', { orderBy: 'name' });
  const { data: machinery } = useTable<{ id: string; code: string; serial: string | null; plate: string | null }>('machinery', { select: 'id, code, serial, plate', orderBy: 'code' });

  const empresaName = (id: string | null) => (id ? hoseEmpresas.find((e) => e.id === id)?.name ?? '—' : '—');
  const encargadoName = (id: string | null) => (id ? encargados.find((e) => e.id === id)?.name ?? '—' : '—');
  const machineLabel = (id: string | null) => {
    if (!id) return '—';
    const m = machinery.find((x) => x.id === id);
    if (!m) return '—';
    return [m.code, m.serial ? `Serial ${m.serial}` : '', m.plate ? `Placa ${m.plate}` : ''].filter(Boolean).join(' · ');
  };

  const [busy, setBusy] = useState<string | null>(null);
  // Selección para APROBAR EN LOTE (solo mangueras INSTALADAS se pueden pagar).
  const [selMang, setSelMang] = useState<Set<string>>(new Set());
  const toggleSelMang = (id: string) => setSelMang((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const pendientes = useMemo(
    () => hoses
      .filter((h) => h.payment_status === 'pendiente' || h.payment_status === 'en_proceso_autorizacion')
      .sort((a, b) => cmpText(a.code, b.code)),
    [hoses],
  );

  const enviarAutorizacion = async (h: HoseService) => {
    const ok = await confirm({ title: 'Enviar a autorización', message: `¿Enviar la manguera ${h.code} a autorización de pago?`, confirmText: 'Enviar' });
    if (!ok) return;
    setBusy(h.id + '-auth');
    const { error } = await supabase.from('hose_services').update({ payment_status: 'en_proceso_autorizacion' }).eq('id', h.id);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success('Enviada a autorización.');
    refetch();
  };

  const aprobarPago = async (h: HoseService) => {
    // No se puede pagar una manguera que aún no está instalada (evita pagar un
    // trabajo que nunca se llegó a hacer). El botón se deshabilita en ese caso,
    // pero se valida también aquí por si el estado cambió justo antes de pulsar.
    if (h.install_status !== 'instalada') {
      return toast.error('No se puede pagar una manguera que no está instalada.');
    }
    const ok = await confirm({ title: 'Aprobar pago', message: `¿Aprobar el pago de la manguera ${h.code} por ${usd(h.cost_usd)}?`, confirmText: 'Aprobar' });
    if (!ok) return;
    setBusy(h.id + '-approve');
    const { error } = await supabase.from('hose_services').update({
      payment_status: 'pagado',
      approved_by: session?.user?.id ?? null,
      approved_at: nowISO(),
    }).eq('id', h.id);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success('Pago aprobado.');
    refetch();
  };

  // APROBACIÓN EN LOTE: el gerente marca (☑) varias mangueras y aprueba el pago de
  // todas de un click. Solo las INSTALADAS son pagables; las no instaladas se avisan
  // y se saltan (no se puede pagar un trabajo que no se hizo).
  const aprobarLote = async () => {
    const sel = pendientes.filter((h) => selMang.has(h.id));
    const pagables = sel.filter((h) => h.install_status === 'instalada');
    const noInst = sel.length - pagables.length;
    if (!pagables.length) return toast.error('Marca (☑) mangueras INSTALADAS para aprobar el pago en lote.');
    const ok = await confirm({ title: 'Aprobar pago en lote', message: `¿Aprobar el pago de ${pagables.length} manguera(s)?` + (noInst ? `\n\n${noInst} no está(n) instalada(s) y se omitirá(n).` : ''), confirmText: `Aprobar ${pagables.length}` });
    if (!ok) return;
    setBusy('lote');
    const { error } = await supabase.from('hose_services').update({
      payment_status: 'pagado',
      approved_by: session?.user?.id ?? null,
      approved_at: nowISO(),
    }).in('id', pagables.map((h) => h.id));
    setBusy(null);
    if (error) return toast.error(error.message);
    setSelMang(new Set());
    toast.success(`${pagables.length} pago(s) aprobados en lote.`);
    refetch();
  };

  // 🗑️ Eliminar una manguera que AÚN NO fue aprobada/pagada. Borra primero su cuenta
  // ligada NO pagada (el FK es `on delete set null` → si no, quedaría huérfana).
  const eliminarManguera = async (h: HoseService) => {
    if (h.payment_status === 'pagado') { toast.error('No se puede eliminar: ya fue aprobada/pagada.'); return; }
    const ok = await confirm({ title: 'Eliminar manguera', message: `¿Eliminar la manguera ${h.code}? Se borrará también su cuenta pendiente asociada. No se puede deshacer.`, confirmText: 'Eliminar', danger: true });
    if (!ok) return;
    setBusy(h.id + '-del');
    await supabase.from('cuentas').delete().eq('hose_service_id', h.id).neq('estado', 'pagada');
    const { error } = await supabase.from('hose_services').delete().eq('id', h.id);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success('Manguera eliminada.');
    refetch();
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen onRefresh={refetch} refreshing={loading}>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>🔧 Mangueras por aprobar</SectionTitle>
        <View style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
          <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12, fontVariant: ['tabular-nums'] as any }}>{pendientes.length} pendiente(s)</Text>
        </View>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Las mangueras se crean en su módulo (Taller). Aquí el gerente aprueba los pagos pendientes. Marca (☑) varias y usa "Aprobar pago en lote".</Text>

      {/* APROBACIÓN EN LOTE: aparece cuando hay ≥1 manguera INSTALADA marcada. */}
      {canWrite && (() => {
        const nPag = pendientes.filter((h) => selMang.has(h.id) && h.install_status === 'instalada').length;
        if (!nPag) return null;
        return (
          <TouchableOpacity onPress={aprobarLote} disabled={busy === 'lote'} style={{ backgroundColor: colors.successSoftBg, borderWidth: 1, borderColor: colors.successSoftBorder, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', marginBottom: spacing.sm, opacity: busy === 'lote' ? 0.6 : 1 }}>
            <Text style={{ color: colors.successSoftText, fontWeight: '900', fontSize: 14 }}>✅ Aprobar pago en lote ({nPag})</Text>
          </TouchableOpacity>
        );
      })()}

      {pendientes.length === 0 ? (
        <EmptyState title="Sin mangueras por aprobar" subtitle="No hay pagos de mangueras pendientes de autorización." />
      ) : pendientes.map((h) => {
        const inst = HOSE_INSTALL[h.install_status] ?? HOSE_INSTALL.en_proceso;
        const pay = HOSE_PAYMENT[h.payment_status] ?? HOSE_PAYMENT.pendiente;
        const puedePagar = h.install_status === 'instalada';
        const mSel = selMang.has(h.id);
        return (
          <View key={h.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs }}>
            {canWrite ? (
              <TouchableOpacity onPress={() => toggleSelMang(h.id)} style={{ paddingTop: spacing.md }}>
                <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: mSel ? colors.brand : colors.border, backgroundColor: mSel ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {mSel ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
                </View>
              </TouchableOpacity>
            ) : null}
            <View style={{ flex: 1 }}>
          <ExpandableCard
            key={h.id}
            summary={
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                  <Text style={{ fontWeight: '800', fontSize: 15, color: colors.brandText, flex: 1 }} numberOfLines={1}>🔧 {h.code}</Text>
                  <Text style={{ color: colors.brandText, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>{usd(h.cost_usd)}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' }}>
                  <Pill label={inst.label} {...toneSoft(colors, inst.tone)} />
                  <Pill label={pay.label} {...toneSoft(colors, pay.tone)} />
                </View>
              </View>
            }
            detail={
              <>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Máquina: {h.is_external ? `🏭 ${h.external_client || 'Externa'} (externa)` : machineLabel(h.machinery_id)}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Empresa a cobrar: {empresaName(h.hose_empresa_id)}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Encargado: {encargadoName(h.encargado_id)}</Text>
                {h.description ? <Text style={{ color: colors.muted, fontSize: 13 }}>Trabajo: {h.description}</Text> : null}
                <Text style={{ color: colors.brandText, fontSize: 14, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] as any }}>Costo: {usd(h.cost_usd)}</Text>
                {canWrite ? (
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                    {h.payment_status === 'pendiente' ? (
                      <TouchableOpacity disabled={busy === h.id + '-auth'} onPress={() => enviarAutorizacion(h)} style={{ flexGrow: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy === h.id + '-auth' ? 0.6 : 1 }}>
                        <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 13 }}>📤 Enviar a autorización</Text>
                      </TouchableOpacity>
                    ) : null}
                    {puedePagar ? (
                      <TouchableOpacity disabled={busy === h.id + '-approve'} onPress={() => aprobarPago(h)} style={{ flexGrow: 1, backgroundColor: colors.successSoftBg, borderWidth: 1, borderColor: colors.successSoftBorder, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy === h.id + '-approve' ? 0.6 : 1 }}>
                        <Text style={{ color: colors.successSoftText, fontWeight: '800', fontSize: 13 }}>✅ Aprobar pago</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={{ flexGrow: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: 0.6 }}>
                        <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 13 }}>✅ Aprobar pago</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>Debe estar instalada para poder pagar</Text>
                      </View>
                    )}
                    {/* Eliminar: solo mientras NO haya sido aprobada/pagada. */}
                    {h.payment_status !== 'pagado' ? (
                      <TouchableOpacity disabled={busy === h.id + '-del'} onPress={() => eliminarManguera(h)} style={{ flexGrow: 1, backgroundColor: colors.dangerSoftBg, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy === h.id + '-del' ? 0.6 : 1 }}>
                        <Text style={{ color: colors.dangerSoftText, fontWeight: '800', fontSize: 13 }}>🗑️ Eliminar</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </>
            }
          />
            </View>
          </View>
        );
      })}
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

// ── Contenedor con sub-pestañas ──────────────────────────────────────────────
export default function ComprasScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const canWrite = levelMeets(moduleLevel('compras'), 'escritura');

  // Cuentas por pagar / por cobrar viven ACÁ dentro (pedido del cliente,
  // 17-ago-2026: "en compras estén las cuentas por cobrar y cuentas por pagar"),
  // pero con permiso PROPIO: las políticas RLS de `cuentas` consultan
  // `cuentas_nivel()`, así que abrirlas con el permiso de compras solo lograría
  // que las pestañas salieran vacías. Sin el permiso, ni se muestran.
  const veCuentas = levelMeets(moduleLevel('cuentas'), 'lectura');
  const cuentasWrite = levelMeets(moduleLevel('cuentas'), 'escritura');

  const TABS = [
    { key: 'requerimiento', label: 'Requerimiento', icon: '📝' },
    { key: 'directas', label: 'Compras directas', icon: '🛒' },
    { key: 'ordenes', label: 'Órdenes', icon: '🧾' },
    { key: 'proveedores', label: 'Proveedores', icon: '🏭' },
    { key: 'resumen', label: 'Resumen', icon: '📊' },
    { key: 'mangueras', label: 'Mangueras', icon: '🔧' },
    ...(veCuentas ? CUENTAS_TABS : []),
  ];
  const [active, setActive] = useState('requerimiento');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.sm }}>
          {TABS.map((t) => {
            const on = t.key === active;
            return (
              <TouchableOpacity key={t.key} onPress={() => setActive(t.key)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt }}>
                <Text style={{ fontSize: 15 }}>{t.icon}</Text>
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ flex: 1 }}>
        {active === 'por_pagar' || active === 'por_cobrar' ? (
          // `key` fuerza remontar al cambiar de tipo: cada uno arranca con su
          // propio buscador y formulario limpios.
          <CuentasTab key={active} tipo={active} canWrite={cuentasWrite} />
        ) : active === 'requerimiento' ? <RequerimientoTab canWrite={canWrite} /> : active === 'directas' ? <ComprasDirectasTab canWrite={canWrite} /> : active === 'ordenes' ? <OrdenesTab canWrite={canWrite} /> : active === 'resumen' ? <ResumenTab /> : active === 'mangueras' ? <ManguerasAprobarTab canWrite={canWrite} /> : <ProveedoresTab canWrite={canWrite} />}
      </View>
    </View>
  );
}
