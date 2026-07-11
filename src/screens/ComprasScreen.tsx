import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { ListScreen } from '../components/ListScreen';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { Supplier, PurchaseRequest, PurchaseOrder, PurchaseLine, Company, InventoryLevel } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { norm } from '../lib/text';

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

const REQ_STATUS: Record<string, { label: string; color: string }> = {
  solicitada: { label: '📝 Solicitada', color: '#F59E0B' },
  aprobada: { label: '✅ Aprobada', color: '#2563EB' },
  rechazada: { label: '⛔ Rechazada', color: '#DC2626' },
  ordenada: { label: '🧾 Ordenada', color: '#16A34A' },
};
const ORD_STATUS: Record<string, { label: string; color: string }> = {
  borrador: { label: '📝 Borrador', color: '#F59E0B' },
  aprobada: { label: '✅ Aprobada', color: '#2563EB' },
  recibida: { label: '📦 Recibida', color: '#16A34A' },
  anulada: { label: '⛔ Anulada', color: '#DC2626' },
};

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

/** Etiqueta de estado con su color. */
function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
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
          {l.item_id ? <Text style={{ color: '#16A34A', fontSize: 11, fontWeight: '700' }}>✓ Producto del inventario</Text> : null}
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
            {!noPrice ? <Text style={{ color: colors.muted, fontSize: 12 }}>Subtotal: {usd((Number(l.qty) || 0) * (Number(l.price) || 0))}</Text> : <View />}
            {!readOnly ? (
              <TouchableOpacity onPress={() => setItems(items.filter((_, j) => j !== i))}><Text style={{ color: '#DC2626', fontWeight: '700', fontSize: 12 }}>Quitar</Text></TouchableOpacity>
            ) : null}
          </View>
        </View>
        );
      })}
      {!readOnly ? (
        <TouchableOpacity onPress={() => setItems([...items, { description: '', qty: 1, unit: '', price: 0 }])} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>+ Agregar renglón</Text>
        </TouchableOpacity>
      ) : null}
      {!noPrice ? <Text style={{ color: colors.text, fontWeight: '800', textAlign: 'right', marginTop: 2 }}>Total: {usd(linesTotal(items))}</Text> : null}
    </View>
  );
}

function CompanyPicker({ companies, value, onChange, colors }: { companies: Company[]; value: string; onChange: (id: string) => void; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      {companies.map((c) => {
        const on = value === c.id;
        return (
          <TouchableOpacity key={c.id} onPress={() => onChange(c.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.name}</Text>
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
          <TouchableOpacity key={c.key} onPress={() => onChange(c.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            <Text style={{ fontSize: 13 }}>{c.icon}</Text>
            <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Proveedores ──────────────────────────────────────────────────────────────
function ProveedoresTab() {
  return (
    <ListScreen<Supplier>
      title="Proveedores"
      table="suppliers"
      orderBy="name"
      editable
      emptyTitle="Sin proveedores"
      emptySubtitle="Registra a quién le compras."
      formTitle="Nuevo proveedor"
      formFields={[
        { key: 'name', label: 'Nombre', type: 'text', required: true },
        { key: 'rif', label: 'RIF', type: 'text' },
        { key: 'phone', label: 'Teléfono', type: 'text' },
        { key: 'email', label: 'Correo', type: 'text' },
        { key: 'address', label: 'Dirección', type: 'text' },
      ]}
      renderItem={(s) => (
        <>
          <Text style={{ fontWeight: '700', fontSize: 16 }}>{s.name}</Text>
          {s.rif ? <Text style={{ opacity: 0.7, fontSize: 13 }}>RIF {s.rif}</Text> : null}
          {s.phone ? <Text style={{ opacity: 0.7, fontSize: 13 }}>{s.phone}</Text> : null}
        </>
      )}
    />
  );
}

// ── Solicitudes ──────────────────────────────────────────────────────────────
function SolicitudesTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const confirm = useConfirm();
  const { data: reqs, loading, refetch } = useTable<PurchaseRequest>('purchase_requests', { orderBy: 'created_at' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const { data: catalog } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name' });
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa');

  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState('');
  const [category, setCategory] = useState('repuestos');
  const [neededFor, setNeededFor] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<PurchaseLine[]>([{ description: '', qty: 1, unit: '', price: 0 }]);
  const [busy, setBusy] = useState(false);

  const crear = async () => {
    if (!company) return Alert.alert('Aviso', 'Elige la empresa.');
    // La solicitud NO lleva precio: solo qué y cuánto. El precio va en la Orden de Compra.
    const clean = items.filter((l) => l.description.trim()).map((l) => ({ ...l, price: 0 }));
    if (!clean.length) return Alert.alert('Aviso', 'Agrega al menos un renglón con descripción.');
    setBusy(true);
    const { error } = await supabase.from('purchase_requests').insert({
      company_id: company, requested_by: session?.user?.id ?? null, category, needed_for: neededFor.trim().toUpperCase() || null,
      note: note.trim().toUpperCase() || null, items: clean, estimated_total: 0, status: 'solicitada',
    });
    setBusy(false);
    if (error) return Alert.alert('Aviso', error.message);
    setOpen(false); setCompany(''); setCategory('repuestos'); setNeededFor(''); setNote(''); setItems([{ description: '', qty: 1, unit: '', price: 0 }]);
    refetch();
  };

  const setStatus = async (r: PurchaseRequest, status: 'aprobada' | 'rechazada') => {
    const ok = await confirm({ title: status === 'aprobada' ? 'Aprobar solicitud' : 'Rechazar solicitud', message: `¿${status === 'aprobada' ? 'Aprobar' : 'Rechazar'} la solicitud de ${companyName(r.company_id)}?`, confirmText: status === 'aprobada' ? 'Aprobar' : 'Rechazar' });
    if (!ok) return;
    await supabase.from('purchase_requests').update({ status, approved_by: session?.user?.id ?? null, approved_at: nowISO() }).eq('id', r.id);
    refetch();
  };

  const generarOrden = async (r: PurchaseRequest) => {
    const ok = await confirm({ title: 'Generar orden de compra', message: 'Se creará una orden en borrador con estos renglones. Luego eliges proveedor y precios en la pestaña Órdenes.', confirmText: 'Generar' });
    if (!ok) return;
    await supabase.from('purchase_orders').insert({ request_id: r.id, company_id: r.company_id, category: r.category ?? null, items: r.items, total: linesTotal(r.items || []), status: 'borrador', created_by: session?.user?.id ?? null });
    await supabase.from('purchase_requests').update({ status: 'ordenada' }).eq('id', r.id);
    refetch();
    Alert.alert('Listo', 'Orden creada en borrador. Ve a la pestaña "Órdenes" para completarla.');
  };

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Solicitudes de pedido</SectionTitle>
        {canWrite ? (
          <TouchableOpacity onPress={() => setOpen(true)} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nueva</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? <Loading /> : reqs.length === 0 ? (
        <EmptyState title="Sin solicitudes" subtitle="Crea una solicitud de pedido para iniciar una compra." />
      ) : reqs.map((r) => {
        const st = REQ_STATUS[r.status] ?? REQ_STATUS.solicitada;
        return (
          <Card key={r.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', fontSize: 15, color: colors.text }}>{companyName(r.company_id)}</Text>
              <Pill label={st.label} color={st.color} />
            </View>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{catInfo(r.category).icon} {catInfo(r.category).label}</Text>
            {r.needed_for ? <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>Para: {r.needed_for}</Text> : null}
            <Text style={{ color: colors.text, fontSize: 13, marginTop: 4 }}>{(r.items || []).length} renglón(es)</Text>
            {(r.items || []).slice(0, 4).map((l, i) => (
              <Text key={i} style={{ color: colors.muted, fontSize: 12 }}>• {l.qty} {l.unit || ''} {l.description}</Text>
            ))}
            {canWrite ? (
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                {r.status === 'solicitada' ? (
                  <>
                    <TouchableOpacity onPress={() => setStatus(r, 'aprobada')} style={{ flexGrow: 1, backgroundColor: '#16A34A', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>✅ Aprobar</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => setStatus(r, 'rechazada')} style={{ flexGrow: 1, backgroundColor: '#DC2626', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>⛔ Rechazar</Text></TouchableOpacity>
                  </>
                ) : r.status === 'aprobada' ? (
                  <TouchableOpacity onPress={() => generarOrden(r)} style={{ flexGrow: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 13 }}>🧾 Generar orden</Text></TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </Card>
        );
      })}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Screen>
          <ScrollView>
            <SectionTitle>Nueva solicitud</SectionTitle>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Empresa</Text>
              <CompanyPicker companies={companies} value={company} onChange={setCompany} colors={colors} />
            </Card>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Categoría del gasto</Text>
              <CategoryPicker value={category} onChange={setCategory} colors={colors} />
            </Card>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>¿Para qué / destino? (opcional)</Text>
              <TextInput value={neededFor} onChangeText={(t) => setNeededFor(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. MÁQUINA 010, ALMACÉN…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Nota (opcional)</Text>
              <TextInput value={note} onChangeText={(t) => setNote(t.toUpperCase())} autoCapitalize="characters" placeholder="OBSERVACIÓN…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
            </Card>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Renglones (qué se necesita)</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>Solo qué y cuánto. El precio se coloca en la Orden de Compra. Al escribir, se sugieren productos ya registrados en inventario.</Text>
              <LineEditor items={items} setItems={setItems} priceLabel="" catalog={catalog} noPrice />
            </Card>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setOpen(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={crear} disabled={busy} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{busy ? 'Guardando…' : 'Guardar solicitud'}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

// ── Órdenes ──────────────────────────────────────────────────────────────────
function OrdenesTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const confirm = useConfirm();
  const { data: orders, loading, refetch } = useTable<PurchaseOrder>('purchase_orders', { orderBy: 'created_at' });
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
    if (!supplier) return Alert.alert('Aviso', 'Elige el proveedor antes de aprobar.');
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
      Alert.alert('Listo', 'Orden recibida y cargada al inventario. El PMP de cada producto se actualizó.');
    } catch (e: any) {
      Alert.alert('Aviso', e?.message || 'No se pudo cargar al inventario.');
    }
  };

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Órdenes de compra</SectionTitle>
      {loading ? <Loading /> : orders.length === 0 ? (
        <EmptyState title="Sin órdenes" subtitle="Las órdenes se generan desde una solicitud aprobada." />
      ) : orders.map((o) => {
        const st = ORD_STATUS[o.status] ?? ORD_STATUS.borrador;
        return (
          <Card key={o.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', fontSize: 15, color: colors.text }}>{companyName(o.company_id)}</Text>
              <Pill label={st.label} color={st.color} />
            </View>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{catInfo(o.category).icon} {catInfo(o.category).label}</Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>Proveedor: {supplierName(o.supplier_id)}</Text>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 2 }}>{usd(o.total)}</Text>
            {canWrite ? (
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                {o.status === 'borrador' ? (
                  <TouchableOpacity onPress={() => openEdit(o)} style={{ flexGrow: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 13 }}>✎ Completar / Aprobar</Text></TouchableOpacity>
                ) : o.status === 'aprobada' ? (
                  <TouchableOpacity onPress={() => recibir(o)} style={{ flexGrow: 1, backgroundColor: '#16A34A', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>📦 Marcar recibida</Text></TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => openEdit(o)} style={{ flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>👁 Ver</Text></TouchableOpacity>
                )}
              </View>
            ) : null}
          </Card>
        );
      })}

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
                    <TouchableOpacity key={s.id} disabled={readOnly} onPress={() => setSupplier(s.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{s.name}</Text>
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
                <TouchableOpacity onPress={guardar} disabled={busy} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Guardar borrador</Text></TouchableOpacity>
                <TouchableOpacity onPress={aprobar} disabled={busy} style={{ flex: 1, backgroundColor: '#16A34A', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: '#fff', fontWeight: '700' }}>✅ Aprobar</Text></TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setSel(null)} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text></TouchableOpacity>
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
  const { data: orders, loading } = useTable<PurchaseOrder>('purchase_orders', { orderBy: 'created_at' });
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
      <Text style={{ color, fontSize: 16, fontWeight: '800', marginTop: 2 }}>{usd(value)}</Text>
    </View>
  );

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Resumen de gastos</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Incluye órdenes aprobadas y recibidas (gasto comprometido).</Text>

      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        <Quick label="HOY" value={spend.hoy} color="#2563EB" />
        <Quick label="ESTA SEMANA" value={spend.semana} color="#7C3AED" />
        <Quick label="ESTE MES" value={spend.mes} color="#16A34A" />
      </View>

      {/* Filtros */}
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Agrupar por</Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
          {([['dia', 'Diario'], ['semana', 'Semanal'], ['mes', 'Mensual']] as const).map(([k, lbl]) => {
            const on = period === k;
            return (
              <TouchableOpacity key={k} onPress={() => setPeriod(k)} style={{ flex: 1, alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingVertical: spacing.xs }}>
                <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{lbl}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Categoría</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
          {[{ key: '', label: 'Todas', icon: '🗂️' }, ...CATEGORIES].map((c) => {
            const on = catFilter === c.key;
            return (
              <TouchableOpacity key={c.key || 'all'} onPress={() => setCatFilter(c.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                <Text style={{ fontSize: 12 }}>{c.icon}</Text>
                <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 11 }}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Empresa</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {[{ id: '', name: 'Todas' }, ...companies].map((c) => {
            const on = companyFilter === c.id;
            return (
              <TouchableOpacity key={c.id || 'all'} onPress={() => setCompanyFilter(c.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 11 }}>{c.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {/* Total del filtro */}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700' }}>TOTAL FILTRADO</Text>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '900' }}>{usd(spend.total)}</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{spend.count} orden(es) · promedio {usd(spend.count ? spend.total / spend.count : 0)}</Text>
      </Card>

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
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{usd(s.total)}</Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
                <View style={{ width: `${(s.total / maxSeries) * 100}%`, height: 8, backgroundColor: colors.primary }} />
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
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{usd(c.total)}</Text>
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
                  <View style={{ width: `${(c.total / maxCompany) * 100}%`, height: 8, backgroundColor: '#16A34A' }} />
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
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{usd(c.total)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

// ── Contenedor con sub-pestañas ──────────────────────────────────────────────
export default function ComprasScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const canWrite = levelMeets(moduleLevel('compras'), 'escritura');
  const TABS = [
    { key: 'solicitudes', label: 'Solicitudes', icon: '📝' },
    { key: 'ordenes', label: 'Órdenes', icon: '🧾' },
    { key: 'proveedores', label: 'Proveedores', icon: '🏭' },
    { key: 'resumen', label: 'Resumen', icon: '📊' },
  ];
  const [active, setActive] = useState('solicitudes');

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
        {active === 'solicitudes' ? <SolicitudesTab canWrite={canWrite} /> : active === 'ordenes' ? <OrdenesTab canWrite={canWrite} /> : active === 'resumen' ? <ResumenTab /> : <ProveedoresTab />}
      </View>
    </View>
  );
}
