import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, ExpandableCard, AccordionGroup } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { norm, onlyDecimal } from '../lib/text';
import { InventoryItem, InventoryLevel, InventoryMovement, Company, Machinery, Employee } from '../types/database';
import { exportPdf } from '../lib/pdf';
import { notaEntregaHtml, NotaItem } from '../lib/notaEntrega';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();
function parseNum(t: string): number { const n = Number(String(t ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
/** Siguiente SKU incremental "INV-0001" a partir de los SKU existentes. */
function nextSkuFrom(skus: (string | null | undefined)[]): string {
  let max = 0;
  skus.forEach((s) => { const m = String(s ?? '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } });
  return 'INV-' + String(max + 1).padStart(4, '0');
}
const nowISO = () => new Date().toISOString();
function fmtDate(iso: string) { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; }

// Categorías (misma taxonomía que Compras).
const CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: 'repuestos', label: 'Repuestos / Maquinaria', icon: '🔧' },
  { key: 'oficina', label: 'Oficina / Administrativo', icon: '🏢' },
  { key: 'limpieza', label: 'Limpieza / Aseo', icon: '🧹' },
  { key: 'herramientas', label: 'Herramientas', icon: '🛠️' },
  { key: 'servicios', label: 'Servicios', icon: '⚡' },
  { key: 'otros', label: 'Otros', icon: '📦' },
];
const catInfo = (key: string | null) => CATEGORIES.find((c) => c.key === key) || { key: key || 'otros', label: key ? key.toUpperCase() : 'Sin categoría', icon: '📦' };

/** Agrupa una lista por equipo (machinery_id) para el acordeón. */
function groupByMachine<T extends { machinery_id: string | null }>(items: T[], nameOf: (id: string | null) => string) {
  const m = new Map<string, { key: string; name: string; items: T[] }>();
  items.forEach((it) => {
    const k = it.machinery_id ?? '__none__';
    const g = m.get(k) ?? { key: k, name: nameOf(it.machinery_id), items: [] };
    g.items.push(it);
    m.set(k, g);
  });
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const MOV_KIND: Record<string, { label: string; color: string; sign: string }> = {
  entrada: { label: '📥 Entrada', color: '#16A34A', sign: '+' },
  salida: { label: '📤 Salida', color: '#DC2626', sign: '−' },
  consumo: { label: '🔥 Consumo', color: '#EA580C', sign: '−' },
  ajuste: { label: '🔧 Ajuste', color: '#2563EB', sign: '' },
};

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function CategoryPicker({ value, onChange, colors }: { value: string; onChange: (k: string) => void; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      {CATEGORIES.map((c) => {
        const on = value === c.key;
        return (
          <TouchableOpacity key={c.key} onPress={() => onChange(c.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            <Text style={{ fontSize: 13 }}>{c.icon}</Text>
            <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Existencias ──────────────────────────────────────────────────────────────
function ExistenciasTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const { data: levels, loading, refetch } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name', realtimeFrom: 'inventory_movements' });
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('repuestos');
  const [unit, setUnit] = useState('');
  const [sku, setSku] = useState('');
  const [minStock, setMinStock] = useState('');
  const [machineryId, setMachineryId] = useState('');
  const [machineQuery, setMachineQuery] = useState('');
  const [initStock, setInitStock] = useState('');
  const [initCost, setInitCost] = useState('');
  const [busy, setBusy] = useState(false);

  const machineLabel = (m: Machinery) => `${m.code}${m.serial ? ` · ${m.serial}` : ''}`;
  const machineName = (id: string | null) => { if (!id) return 'Sin equipo'; const m = machines.find((x) => x.id === id); return m ? machineLabel(m) : 'Equipo'; };
  const machineCompany = (id: string | null) => (id ? machines.find((x) => x.id === id)?.company_id ?? null : null);
  const nq = norm(q);
  const filtered = useMemo(() => levels.filter((it) => !nq || norm(it.name).includes(nq) || norm(it.category).includes(nq)), [levels, nq]);
  const totalValor = useMemo(() => levels.reduce((s, it) => s + (Number(it.stock) || 0) * (Number(it.avg_cost) || 0), 0), [levels]);
  const bajoMin = useMemo(() => levels.filter((it) => Number(it.stock) <= Number(it.min_stock) && Number(it.min_stock) > 0).length, [levels]);

  const crear = async () => {
    if (!name.trim()) return Alert.alert('Aviso', 'Escribe el nombre del material.');
    const cleanName = name.trim().toUpperCase();
    // Evita duplicados por nombre (mismo material ya registrado).
    if (levels.some((it) => norm(it.name) === norm(cleanName))) return Alert.alert('Aviso', 'Ya existe un material con ese nombre.');
    setBusy(true);
    // SKU incremental: se recalcula al vuelo (con los SKU actuales) para no chocar.
    const { data: skuRows } = await supabase.from('inventory_items').select('sku');
    const autoSku = nextSkuFrom((skuRows ?? []).map((r: any) => r.sku));
    // Inventario GENERAL: no se vincula a empresa ni equipo al crear.
    const { data: ins, error } = await supabase.from('inventory_items')
      .insert({ name: cleanName, category, unit: unit.trim().toUpperCase() || null, sku: autoSku, min_stock: parseNum(minStock), machinery_id: null, company_id: null })
      .select('id').single();
    if (error) { setBusy(false); return Alert.alert('Aviso', error.message); }
    // Stock inicial (opcional): registra una entrada que fija existencia y PMP de arranque.
    const qi = parseNum(initStock);
    if (qi > 0) {
      const { error: mErr } = await supabase.from('inventory_movements').insert({
        item_id: ins.id, kind: 'entrada', qty: qi, unit_cost: parseNum(initCost) || 0,
        reason: 'INVENTARIO INICIAL', company_id: null, created_by: session?.user?.id ?? null,
      });
      if (mErr) { setBusy(false); return Alert.alert('Aviso', mErr.message); }
    }
    setBusy(false);
    setOpen(false); setName(''); setCategory('repuestos'); setUnit(''); setSku(''); setMinStock(''); setMachineryId(''); setMachineQuery(''); setInitStock(''); setInitCost('');
    refetch();
  };

  // Abre el modal calculando el próximo SKU incremental para mostrarlo.
  const openCreate = async () => {
    const { data } = await supabase.from('inventory_items').select('sku');
    setSku(nextSkuFrom((data ?? []).map((r: any) => r.sku)));
    setOpen(true);
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>VALORIZACIÓN</Text>
          <Text style={{ color: '#16A34A', fontSize: 16, fontWeight: '800' }}>{usd(totalValor)}</Text>
        </View>
        <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>PRODUCTOS</Text>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>{levels.length}</Text>
        </View>
        <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>BAJO MÍN.</Text>
          <Text style={{ color: bajoMin ? '#DC2626' : colors.text, fontSize: 16, fontWeight: '800' }}>{bajoMin}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Buscar producto…" placeholderTextColor={colors.muted} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
        {canWrite ? (
          <TouchableOpacity onPress={openCreate} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Producto</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {filtered.length === 0 ? (
        <EmptyState title="Sin productos" subtitle="Agrega productos o recíbelos desde una orden de compra." />
      ) : filtered.map((it) => {
            const low = Number(it.stock) <= Number(it.min_stock) && Number(it.min_stock) > 0;
            return (
              <ExpandableCard
                key={it.id}
                summary={
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }} numberOfLines={1}>{it.name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{catInfo(it.category).icon} {catInfo(it.category).label}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '900' }}>{qtyFmt(it.stock)} {it.unit || ''}</Text>
                      {low ? <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: '700' }}>⚠ Bajo mínimo</Text> : null}
                    </View>
                  </View>
                }
                detail={
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <View>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>PMP (costo promedio)</Text>
                      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{usd(it.avg_cost)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>VALOR EN STOCK</Text>
                      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{usd((Number(it.stock) || 0) * (Number(it.avg_cost) || 0))}</Text>
                    </View>
                  </View>
                }
              />
            );
      })}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Screen>
          <ScrollView>
            <SectionTitle>Nuevo producto</SectionTitle>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Nombre</Text>
              <TextInput value={name} onChangeText={(t) => setName(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. BOMBILLO AMARILLO" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Categoría</Text>
              <CategoryPicker value={category} onChange={setCategory} colors={colors} />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Unidad</Text>
                  <TextInput value={unit} onChangeText={(t) => setUnit(t.toUpperCase())} autoCapitalize="characters" placeholder="UND, LT, KG…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>SKU (automático)</Text>
                  <View style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, justifyContent: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>{sku || 'INV-…'}</Text>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Stock mínimo</Text>
                  <TextInput value={minStock} onChangeText={(t) => setMinStock(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                </View>
              </View>
            </Card>
            <Text style={{ color: colors.muted, fontSize: 11 }}>📦 Inventario GENERAL. La máquina y los empleados se eligen al dar salida (Nota de entrega).</Text>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Existencia inicial (opcional)</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>Si ya tienes este material a mano, carga la cantidad y su costo unitario. Se registra como INVENTARIO INICIAL y fija el PMP de arranque.</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Cantidad</Text>
                  <TextInput value={initStock} onChangeText={(t) => setInitStock(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Costo unitario</Text>
                  <TextInput value={initCost} onChangeText={(t) => setInitCost(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0.00" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                </View>
              </View>
              {parseNum(initStock) > 0 ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Valor inicial: {usd(parseNum(initStock) * parseNum(initCost))}</Text> : null}
            </Card>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setOpen(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={crear} disabled={busy} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{busy ? 'Guardando…' : 'Guardar'}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

// ── Movimientos (trazabilidad) ───────────────────────────────────────────────
function MovimientosTab() {
  const { colors } = useTheme();
  const { data: movs, loading } = useTable<InventoryMovement>('inventory_movements', { orderBy: 'created_at', ascending: false });
  const { data: items } = useTable<InventoryItem>('inventory_items', { orderBy: 'name' });
  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? 'Producto';
  const itemUnit = (id: string) => items.find((i) => i.id === id)?.unit ?? '';

  const [filter, setFilter] = useState('');
  const shown = filter ? movs.filter((m) => m.kind === filter) : movs;

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Movimientos (traza)</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {[{ k: '', l: 'Todos' }, { k: 'entrada', l: '📥 Entradas' }, { k: 'salida', l: '📤 Salidas' }, { k: 'consumo', l: '🔥 Consumo' }, { k: 'ajuste', l: '🔧 Ajustes' }].map((f) => {
          const on = filter === f.k;
          return (
            <TouchableOpacity key={f.k || 'all'} onPress={() => setFilter(f.k)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
              <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{f.l}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {shown.length === 0 ? (
        <EmptyState title="Sin movimientos" subtitle="Las entradas, salidas y consumos aparecerán aquí." />
      ) : shown.map((m) => {
        const k = MOV_KIND[m.kind] ?? MOV_KIND.ajuste;
        return (
          <ExpandableCard
            key={m.id}
            summary={
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }} numberOfLines={1}>{itemName(m.item_id)}</Text>
                  <Text style={{ color: k.color, fontSize: 13, fontWeight: '800' }}>{k.sign}{qtyFmt(m.qty)} {itemUnit(m.item_id)}</Text>
                </View>
                <Pill label={k.label} color={k.color} />
              </View>
            }
            detail={
              <>
                {m.unit_cost != null ? <Text style={{ color: colors.muted, fontSize: 13 }}>Costo unitario: {usd(m.unit_cost)}</Text> : null}
                {m.reason ? <Text style={{ color: colors.text, fontSize: 13 }}>{m.reason}</Text> : null}
                {m.order_id ? <Text style={{ color: '#16A34A', fontSize: 13, fontWeight: '700' }}>🧾 Desde orden de compra</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtDate(m.created_at)}</Text>
              </>
            }
          />
        );
      })}
    </Screen>
  );
}

// ── Salidas de material ──────────────────────────────────────────────────────
function SalidasTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const confirm = useConfirm();
  const { data: levels, loading, refetch } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name', realtimeFrom: 'inventory_movements' });

  const [q, setQ] = useState('');
  const [sel, setSel] = useState<InventoryLevel | null>(null);
  const [kind, setKind] = useState<'salida' | 'consumo'>('consumo');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const nq = norm(q);
  const filtered = useMemo(() => levels.filter((it) => Number(it.stock) > 0 && (!nq || norm(it.name).includes(nq))), [levels, nq]);

  const registrar = async () => {
    if (!sel) return;
    const n = parseNum(qty);
    if (n <= 0) return Alert.alert('Aviso', 'Indica la cantidad a sacar.');
    if (n > Number(sel.stock)) return Alert.alert('Aviso', `No hay suficiente stock. Disponible: ${qtyFmt(sel.stock)} ${sel.unit || ''}.`);
    const ok = await confirm({ title: kind === 'consumo' ? 'Registrar consumo' : 'Registrar salida', message: `${kind === 'consumo' ? 'Consumir' : 'Sacar'} ${qtyFmt(n)} ${sel.unit || ''} de ${sel.name}?`, confirmText: 'Confirmar' });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('inventory_movements').insert({
      item_id: sel.id, kind, qty: n, unit_cost: Number(sel.avg_cost) || null,
      reason: reason.trim().toUpperCase() || null, company_id: sel.company_id ?? null, created_by: session?.user?.id ?? null,
    });
    setBusy(false);
    if (error) return Alert.alert('Aviso', error.message);
    setSel(null); setQty(''); setReason(''); setKind('consumo');
    refetch();
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Salidas de material</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Elige un producto para registrar una salida o consumo. Se valoriza al PMP actual.</Text>
      <TextInput value={q} onChangeText={setQ} placeholder="Buscar producto con stock…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }} />

      {filtered.length === 0 ? (
        <EmptyState title="Sin stock disponible" subtitle="No hay productos con existencia para dar salida." />
      ) : filtered.map((it) => (
        <Card key={it.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', fontSize: 15, color: colors.text }}>{it.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Stock: {qtyFmt(it.stock)} {it.unit || ''} · PMP {usd(it.avg_cost)}</Text>
            </View>
            {canWrite ? (
              <TouchableOpacity onPress={() => { setSel(it); setKind('consumo'); setQty(''); setReason(''); }} style={{ backgroundColor: '#EA580C', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Dar salida</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </Card>
      ))}

      <Modal visible={!!sel} animationType="slide" onRequestClose={() => setSel(null)}>
        <Screen>
          <ScrollView>
            <SectionTitle>Salida de material</SectionTitle>
            {sel ? (
              <>
                <Card>
                  <Text style={{ fontWeight: '800', fontSize: 16, color: colors.text }}>{sel.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>Disponible: {qtyFmt(sel.stock)} {sel.unit || ''} · PMP {usd(sel.avg_cost)}</Text>
                </Card>
                <Card>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Tipo</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
                    {([['consumo', '🔥 Consumo'], ['salida', '📤 Salida']] as const).map(([k, lbl]) => {
                      const on = kind === k;
                      return (
                        <TouchableOpacity key={k} onPress={() => setKind(k)} style={{ flex: 1, alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingVertical: spacing.xs }}>
                          <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{lbl}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Cantidad ({sel.unit || 'und'})</Text>
                  <TextInput value={qty} onChangeText={(t) => setQty(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Motivo / destino (opcional)</Text>
                  <TextInput value={reason} onChangeText={(t) => setReason(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. MÁQUINA 010, MANTENIMIENTO…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Valor de la salida: {usd(parseNum(qty) * (Number(sel.avg_cost) || 0))}</Text>
                </Card>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <TouchableOpacity onPress={() => setSel(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
                  <TouchableOpacity onPress={registrar} disabled={busy} style={{ flex: 1, backgroundColor: '#EA580C', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: '#fff', fontWeight: '700' }}>{busy ? 'Guardando…' : 'Registrar'}</Text></TouchableOpacity>
                </View>
              </>
            ) : null}
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

// ── Nota de salida / entrega ─────────────────────────────────────────────────
function NotaTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const confirm = useConfirm();
  const { data: levels, loading, refetch } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name', realtimeFrom: 'inventory_movements' });
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: employees } = useTable<Employee>('employees', { orderBy: 'first_name' });

  const [q, setQ] = useState('');
  const [cart, setCart] = useState<{ id: string; name: string; unit: string; qty: number; avg_cost: number; stock: number; company_id: string | null }[]>([]);
  const [destino, setDestino] = useState('');
  const [descontar, setDescontar] = useState(true); // registra la salida (descuenta stock)
  const [busy, setBusy] = useState(false);
  // Equipo y empleados que reciben (para la nota).
  const [machineryId, setMachineryId] = useState('');
  const [machineQuery, setMachineQuery] = useState('');
  const [machOpen, setMachOpen] = useState(false);
  const [empQuery, setEmpQuery] = useState('');
  const [empSel, setEmpSel] = useState<{ id: string; name: string }[]>([]);
  const [empOpen, setEmpOpen] = useState(false);

  const nq = norm(q);
  const filtered = useMemo(() => levels.filter((it) => Number(it.stock) > 0 && (!nq || norm(it.name).includes(nq))), [levels, nq]);
  const inCart = (id: string) => cart.find((c) => c.id === id);
  const machineLabel = (m: Machinery) => `${m.code}${m.serial ? ` · ${m.serial}` : ''}`;
  const machineName = (id: string) => { const m = machines.find((x) => x.id === id); return m ? machineLabel(m) : ''; };
  const empName = (e: Employee) => `${(e as any).first_name ?? ''} ${(e as any).last_name ?? ''}`.trim() || 'Sin nombre';
  const toggleEmp = (e: Employee) => setEmpSel((prev) => prev.some((x) => x.id === (e as any).id) ? prev.filter((x) => x.id !== (e as any).id) : [...prev, { id: (e as any).id, name: empName(e) }]);

  const addToCart = (it: InventoryLevel) => {
    if (inCart(it.id)) return;
    setCart((prev) => [...prev, { id: it.id, name: it.name, unit: it.unit || '', qty: 1, avg_cost: Number(it.avg_cost) || 0, stock: Number(it.stock) || 0, company_id: it.company_id ?? null }]);
  };
  const setQty = (id: string, t: string) => {
    const n = parseNum(onlyDecimal(t));
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty: n } : c)));
  };
  const removeFromCart = (id: string) => setCart((prev) => prev.filter((c) => c.id !== id));

  const todayDMY = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };

  const generar = async () => {
    if (cart.length === 0) return Alert.alert('Aviso', 'Agrega al menos un producto a la nota.');
    // Validación de cantidades y stock.
    for (const c of cart) {
      if (c.qty <= 0) return Alert.alert('Aviso', `Indica la cantidad de "${c.name}".`);
      if (descontar && c.qty > c.stock) return Alert.alert('Aviso', `No hay suficiente stock de "${c.name}". Disponible: ${qtyFmt(c.stock)} ${c.unit}.`);
    }
    const ok = await confirm({
      title: 'Generar nota de entrega',
      message: `${descontar ? 'Se registrará la SALIDA de ' : 'Se generará la nota de '} ${cart.length} producto(s)${descontar ? ' (descuenta del inventario)' : ' (sin descontar del inventario)'}. ¿Continuar?`,
      confirmText: 'Generar',
    });
    if (!ok) return;
    setBusy(true);
    // Registra la salida de cada producto (si se pidió descontar).
    if (descontar) {
      const rows = cart.map((c) => ({
        item_id: c.id, kind: 'salida' as const, qty: c.qty, unit_cost: c.avg_cost || null,
        reason: destino.trim().toUpperCase() ? `NOTA DE ENTREGA · ${destino.trim().toUpperCase()}` : 'NOTA DE ENTREGA',
        company_id: c.company_id, created_by: session?.user?.id ?? null,
      }));
      const { error } = await supabase.from('inventory_movements').insert(rows);
      if (error) { setBusy(false); return Alert.alert('Aviso', error.message); }
    }
    // Documento PDF.
    const items: NotaItem[] = cart.map((c) => ({ name: c.name, qty: c.qty, unit: c.unit }));
    try {
      await exportPdf(notaEntregaHtml({
        fecha: todayDMY(),
        destino: destino.trim() || null,
        maquina: machineryId ? machineName(machineryId) : null,
        empleados: empSel.map((e) => e.name),
        items,
      }), `Nota de entrega - ${todayDMY()}`);
    } catch (e: any) {
      setBusy(false);
      return Alert.alert('Aviso', 'No se pudo generar el PDF: ' + (e?.message ?? e));
    }
    setBusy(false);
    setCart([]); setDestino(''); setMachineryId(''); setMachineQuery(''); setEmpSel([]); setEmpQuery('');
    refetch();
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Nota de salida / entrega</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
        Agrega los productos que salen, indica la cantidad y genera el documento con logo, fecha y línea de firma autorizado.
      </Text>

      {/* Productos en la nota (carrito) */}
      {cart.length > 0 ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>🧾 Productos en la nota ({cart.length})</Text>
          {cart.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{c.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>Stock: {qtyFmt(c.stock)} {c.unit}</Text>
              </View>
              <TextInput value={String(c.qty)} onChangeText={(t) => setQty(c.id, t)} keyboardType="numeric" inputMode="decimal" style={{ width: 66, textAlign: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: (descontar && c.qty > c.stock) ? colors.danger : colors.border, borderRadius: radius.md, padding: spacing.xs, color: colors.text }} />
              <Text style={{ color: colors.muted, fontSize: 12, width: 34 }}>{c.unit}</Text>
              <TouchableOpacity onPress={() => removeFromCart(c.id)}><Text style={{ color: colors.danger, fontWeight: '800' }}>🗑</Text></TouchableOpacity>
            </View>
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
            <TouchableOpacity onPress={() => setDescontar((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 18 }}>{descontar ? '☑️' : '⬜'}</Text>
              <Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>Descontar del inventario (registrar salida)</Text>
            </TouchableOpacity>
          </View>
          {/* Máquina: lista desplegable/colapsable de TODAS las máquinas, filtrable. */}
          <TouchableOpacity onPress={() => setMachOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>🚜 Máquina: <Text style={{ color: machineryId ? colors.primary : colors.muted }}>{machineryId ? machineName(machineryId) : 'elegir…'}</Text></Text>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>{machOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {machOpen ? (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm }}>
              <TextInput value={machineQuery} onChangeText={setMachineQuery} placeholder="Filtrar por código o serial…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: 6 }} />
              {machineryId ? (
                <TouchableOpacity onPress={() => setMachineryId('')} style={{ paddingVertical: 6 }}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>✕ Quitar selección</Text></TouchableOpacity>
              ) : null}
              <View style={{ maxHeight: 200 }}>
                <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {machines.filter((m) => { const s = norm(machineQuery); return !s || norm(`${m.code} ${m.serial ?? ''}`).includes(s); }).map((m) => {
                    const on = machineryId === m.id;
                    return (
                      <TouchableOpacity key={m.id} onPress={() => { setMachineryId(m.id); setMachOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ fontSize: 15 }}>{on ? '🔘' : '⚪'}</Text>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{machineLabel(m)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          ) : null}

          {/* Empleados: lista desplegable/colapsable de TODA la nómina, filtrable, multi. */}
          <TouchableOpacity onPress={() => setEmpOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>👷 Entregado a: <Text style={{ color: empSel.length ? colors.primary : colors.muted }}>{empSel.length ? `${empSel.length} empleado(s)` : 'elegir…'}</Text></Text>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>{empOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {empSel.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {empSel.map((e) => (
                <TouchableOpacity key={e.id} onPress={() => setEmpSel((prev) => prev.filter((x) => x.id !== e.id))} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                  <Text style={{ color: colors.primaryContrast, fontSize: 12, fontWeight: '700' }}>{e.name}</Text>
                  <Text style={{ color: colors.primaryContrast, fontSize: 12 }}>✕</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {empOpen ? (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm, marginTop: 2 }}>
              <TextInput value={empQuery} onChangeText={setEmpQuery} placeholder="Filtrar por nombre…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: 6 }} />
              <View style={{ maxHeight: 220 }}>
                <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {employees.filter((e) => { const s = norm(empQuery); return !s || norm(empName(e)).includes(s); }).map((e) => {
                    const on = empSel.some((x) => x.id === (e as any).id);
                    return (
                      <TouchableOpacity key={(e as any).id} onPress={() => toggleEmp(e)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ fontSize: 16 }}>{on ? '☑️' : '⬜'}</Text>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{empName(e)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          ) : null}

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Destino / motivo (opcional)</Text>
          <TextInput value={destino} onChangeText={(t) => setDestino(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. OBRA CARABALLEDA, MANTENIMIENTO…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <TouchableOpacity onPress={generar} disabled={busy} style={{ marginTop: spacing.sm, backgroundColor: '#16324F', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>{busy ? 'Generando…' : '🧾 Generar nota (PDF)'}</Text>
          </TouchableOpacity>
        </Card>
      ) : null}

      <TextInput value={q} onChangeText={setQ} placeholder="Buscar producto con stock…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: spacing.sm, marginBottom: spacing.sm }} />

      {filtered.length === 0 ? (
        <EmptyState title="Sin stock disponible" subtitle="No hay productos con existencia para la nota." />
      ) : filtered.map((it) => {
        const added = !!inCart(it.id);
        return (
          <Card key={it.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', fontSize: 15, color: colors.text }}>{it.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Stock: {qtyFmt(it.stock)} {it.unit || ''}</Text>
              </View>
              {canWrite ? (
                <TouchableOpacity onPress={() => addToCart(it)} disabled={added} style={{ backgroundColor: added ? colors.surfaceAlt : colors.primary, borderWidth: added ? 1 : 0, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                  <Text style={{ color: added ? colors.muted : colors.primaryContrast, fontWeight: '700', fontSize: 13 }}>{added ? '✓ Agregado' : '+ Agregar'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

// ── Contenedor con sub-pestañas ──────────────────────────────────────────────
export default function InventarioScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const canWrite = levelMeets(moduleLevel('inventario'), 'escritura');
  const TABS = [
    { key: 'existencias', label: 'Existencias', icon: '📦' },
    { key: 'salidas', label: 'Salidas', icon: '📤' },
    { key: 'nota', label: 'Nota de entrega', icon: '🧾' },
    { key: 'movimientos', label: 'Movimientos', icon: '🔄' },
  ];
  const [active, setActive] = useState('existencias');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.sm }}>
          {TABS.map((t) => {
            const on = t.key === active;
            return (
              <TouchableOpacity key={t.key} onPress={() => setActive(t.key)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt }}>
                <Text style={{ fontSize: 15 }}>{t.icon}</Text>
                <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ flex: 1 }}>
        {active === 'existencias' ? <ExistenciasTab canWrite={canWrite} /> : active === 'salidas' ? <SalidasTab canWrite={canWrite} /> : active === 'nota' ? <NotaTab canWrite={canWrite} /> : <MovimientosTab />}
      </View>
    </View>
  );
}
