// ============================================================================
// 🧰 SERVICIOS — submódulo de Compras. Se maneja como una COMPRA DIRECTA, pero
// para servicios (recarga de bombonas, mantenimiento de aires, cambio de aceite…).
//
// Cada renglón: CATEGORÍA (reusable) · TIPO (reusable) · EQUIPO opcional (del
// catálogo, con buscador por todas sus características) · CANTIDAD · PRECIO, y
// OPCIONALMENTE consume un REPUESTO del inventario (check "usa repuesto" → se
// descuenta del stock; si no aplica —ej. limpieza de A/C— no toca inventario).
//
// Las categorías y tipos se guardan solos: la primera vez el usuario los escribe
// y quedan en la lista para elegirlos la próxima vez.
//
// Requiere correr `supabase/servicios.sql`.
// ============================================================================
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Image, Linking, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, ExpandableCard, AccordionGroup } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { Company, Supplier, ServicioRecord, ServicioItem, ServiceCategory, ServiceKind } from '../types/database';
import { generalCompanies } from '../lib/companies';
import { pickAndUploadDocFile } from '../lib/photo';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { cmpText, norm, onlyDecimal } from '../lib/text';
import { leerNumero, textoDeCampo } from '../lib/numeros';

const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// 19-sep-2026: la regla de lectura vive en src/lib/numeros.ts, una sola para todo Compras.
const parseNum = leerNumero;
const todayISO = () => new Date().toISOString().slice(0, 10);
const itemsTotal = (items: ServicioItem[]) => (items || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);

type Mach = { id: string; code: string; plate: string | null; serial: string | null; marca: string | null; modelo: string | null; clasificacion: string | null; encargado: string | null; company?: { name: string } | null };
type Inv = { id: string; name: string; unit: string | null };

const BLANK: ServicioItem = { categoria: '', tipo: '', machinery_id: null, machine_label: '', qty: 1, price: 0, usa_inventario: false, item_id: null, item_name: '', detalle: '' };

const machLabel = (m: Mach) => [m.code, m.plate, m.serial, m.company?.name].filter(Boolean).join(' · ');
// Buscador por TODAS las características: nombre, placa, serial, marca, modelo,
// clasificación, encargado y empresa.
const machHaystack = (m: Mach) => norm([m.code, m.plate, m.serial, m.marca, m.modelo, m.clasificacion, m.encargado, m.company?.name].filter(Boolean).join(' '));

export function ServiciosTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const toast = useToast();
  const { data: servicios, loading, refetch } = useTable<ServicioRecord>('servicios', { orderBy: 'created_at', ascending: false, realtimeFrom: 'servicios' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const { data: suppliers, refetch: refetchSuppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });
  const { data: cats, refetch: refetchCats } = useTable<ServiceCategory>('service_categories', { orderBy: 'name' });
  const { data: kinds, refetch: refetchKinds } = useTable<ServiceKind>('service_kinds', { orderBy: 'name' });
  const { data: machinery } = useTable<Mach>('machinery', { select: 'id, code, plate, serial, marca, modelo, clasificacion, encargado, company:company_id(name)', orderBy: 'code' });
  const { data: invItems } = useTable<Inv>('inventory_items', { select: 'id, name, unit', orderBy: 'name' });

  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa' : 'Sin empresa');
  const supplierName = (id: string | null) => (id ? suppliers.find((s) => s.id === id)?.name ?? '—' : '—');

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [company, setCompany] = useState('');
  const [supplier, setSupplier] = useState('');
  const [serviceDate, setServiceDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [items, setItems] = useState<ServicioItem[]>([{ ...BLANK }]);
  const [factura, setFactura] = useState<{ url: string; kind: 'image' | 'pdf'; name: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftId] = useState(() => (globalThis as any)?.crypto?.randomUUID?.() ?? String(Date.now()));
  const [preview, setPreview] = useState<ServicioRecord | null>(null);

  // Proveedor nuevo (en línea)
  const [nuevoProv, setNuevoProv] = useState('');
  const [creandoProv, setCreandoProv] = useState(false);
  const [provQ, setProvQ] = useState('');  // buscador de proveedores

  // Selectores (modales) por renglón
  const [pickMachFor, setPickMachFor] = useState<number | null>(null);
  const [machQ, setMachQ] = useState('');
  const [pickInvFor, setPickInvFor] = useState<number | null>(null);
  const [invQ, setInvQ] = useState('');
  // Desplegable de categoría / tipo de servicio (lista + buscar + crear nuevo)
  const [catPick, setCatPick] = useState<{ i: number; field: 'categoria' | 'tipo' } | null>(null);
  const [catQ, setCatQ] = useState('');

  const setItem = (i: number, patch: Partial<ServicioItem>) => setItems((prev) => prev.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  // ⭐ Texto crudo de cantidad y precio MIENTRAS se escribe (19-sep-2026). El renglón
  //    guarda el número; si el campo se pintara con String(numero), al teclear «12,» el
  //    número es 12, el campo se repinta «12» y la coma desaparece: no se podía escribir
  //    ningún decimal, ni con punto ni con coma. Mismo arreglo que el editor de renglones
  //    de Compras directas.
  const [crudo, setCrudo] = useState<Record<string, string>>({});
  const claveCrudo = (i: number, f: 'qty' | 'price') => `${i}:${f}`;
  const onNumero = (i: number, f: 'qty' | 'price', t: string) => {
    const limpio = onlyDecimal(t);
    setCrudo((r) => ({ ...r, [claveCrudo(i, f)]: limpio }));
    setItem(i, { [f]: parseNum(limpio) } as Partial<ServicioItem>);
  };
  const addLine = () => setItems((prev) => [...prev, { ...BLANK }]);
  // Al quitar un renglón los índices se corren: el texto crudo ya no corresponde.
  const removeLine = (i: number) => { setCrudo({}); setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, k) => k !== i))); };

  const resetForm = () => {
    setOpen(false); setEditingId(null); setCompany(''); setSupplier(''); setServiceDate(todayISO());
    setNote(''); setItems([{ ...BLANK }]); setCrudo({}); setFactura(null); setNuevoProv(''); setProvQ('');
  };
  const abrirNueva = () => { resetForm(); setOpen(true); };
  const abrirEditar = (s: ServicioRecord) => {
    setEditingId(s.id); setCompany(s.company_id ?? ''); setSupplier(s.supplier_id ?? '');
    setServiceDate(String(s.service_date ?? todayISO()).slice(0, 10)); setNote(s.note ?? '');
    setItems((s.items && s.items.length ? s.items : [{ ...BLANK }]).map((it) => ({ ...BLANK, ...it })));
    setCrudo({});
    setFactura(s.factura_url ? { url: s.factura_url, kind: (s.factura_type as any) ?? 'image', name: s.factura_name ?? 'factura' } : null);
    setOpen(true);
  };

  const crearProveedor = async () => {
    const nombre = nuevoProv.trim();
    if (!nombre) return;
    setCreandoProv(true);
    const { data, error } = await supabase.from('suppliers').insert({ name: nombre.toUpperCase() }).select('id').single();
    setCreandoProv(false);
    if (error) return toast.error(error.message);
    setNuevoProv('');
    await refetchSuppliers();
    if (data?.id) setSupplier(data.id);
    toast.success('Proveedor creado.');
  };

  const adjuntarFactura = async () => {
    setSubiendo(true);
    try {
      const res = await pickAndUploadDocFile('servicios', draftId);
      if (res?.url) { setFactura({ url: res.url, kind: (res.kind as any) ?? 'image', name: res.name ?? 'factura' }); toast.success('Factura adjuntada.'); }
    } finally { setSubiendo(false); }
  };

  // Guarda cualquier categoría/tipo nuevo en su catálogo, para reusarlo luego.
  const guardarNuevosCatalogos = async (rows: ServicioItem[]) => {
    const existCats = new Set(cats.map((c) => norm(c.name)));
    const existKinds = new Set(kinds.map((k) => norm(k.name)));
    const nuevasCats = Array.from(new Set(rows.map((r) => r.categoria.trim()).filter((v) => v && !existCats.has(norm(v)))));
    const nuevosKinds = Array.from(new Set(rows.map((r) => r.tipo.trim()).filter((v) => v && !existKinds.has(norm(v)))));
    if (nuevasCats.length) await supabase.from('service_categories').insert(nuevasCats.map((name) => ({ name }))).then(() => {}, () => {});
    if (nuevosKinds.length) await supabase.from('service_kinds').insert(nuevosKinds.map((name) => ({ name }))).then(() => {}, () => {});
    if (nuevasCats.length) refetchCats();
    if (nuevosKinds.length) refetchKinds();
  };

  // Elegir/crear una opción del desplegable (categoría o tipo). Si el nombre no
  // existe aún, lo inserta en el catálogo para que quede disponible de una vez.
  const elegirOpcion = async (field: 'categoria' | 'tipo', name: string) => {
    const clean = name.trim().toUpperCase();
    if (!clean) return;
    if (catPick) setItem(catPick.i, { [field]: clean } as Partial<ServicioItem>);
    setCatPick(null); setCatQ('');
    const tabla = field === 'categoria' ? 'service_categories' : 'service_kinds';
    const existe = (field === 'categoria' ? cats : kinds).some((o) => norm(o.name) === norm(clean));
    if (!existe) {
      await supabase.from(tabla).insert({ name: clean }).then(() => {}, () => {});
      field === 'categoria' ? refetchCats() : refetchKinds();
    }
  };

  const crear = async () => {
    if (!company) return toast.error('Elige la empresa.');
    const clean = items
      .map((it) => ({ ...it, categoria: it.categoria.trim(), tipo: it.tipo.trim(), qty: Number(it.qty) || 0, price: Number(it.price) || 0 }))
      .filter((it) => it.categoria && Number(it.qty) > 0);
    if (!clean.length) return toast.error('Agrega al menos un servicio con categoría y cantidad.');
    // Un renglón que "usa repuesto" tiene que tener el repuesto elegido.
    if (clean.some((it) => it.usa_inventario && !it.item_id)) return toast.error('Elige el repuesto del inventario en los renglones marcados, o desmarca "usa repuesto".');
    setBusy(true);
    const payload = {
      company_id: company, supplier_id: supplier || null, service_date: serviceDate,
      items: clean, total: itemsTotal(clean),
      factura_url: factura?.url ?? null, factura_type: factura?.kind ?? null, factura_name: factura?.name ?? null,
      note: note.trim().toUpperCase() || null,
    };
    await guardarNuevosCatalogos(clean);
    const { error } = editingId
      ? await supabase.from('servicios').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingId)
      : await supabase.from('servicios').insert({ ...payload, created_by: session?.user?.id ?? null });
    setBusy(false);
    if (error) {
      if (/servicios|relation|does not exist|column/i.test(error.message)) return toast.error('Corre "servicios.sql" en Supabase para habilitar Servicios.');
      return toast.error(error.message);
    }
    const editado = !!editingId;
    resetForm(); refetch();
    toast.success(editado ? 'Servicio actualizado.' : 'Servicio registrado.');
  };

  const verFactura = (s: ServicioRecord) => {
    if (!s.factura_url) return;
    if (Platform.OS === 'web') { setPreview(s); return; }
    Linking.openURL(s.factura_url);
  };

  const grupos = useMemo(() => {
    const m = new Map<string, { key: string; name: string; items: ServicioRecord[] }>();
    servicios.forEach((s) => {
      const k = s.company_id ?? '__none__';
      const g = m.get(k) ?? { key: k, name: companyName(s.company_id), items: [] };
      g.items.push(s); m.set(k, g);
    });
    return [...m.values()].sort((a, b) => cmpText(a.name, b.name));
  }, [servicios, companies]);

  const machFiltradas = useMemo(() => {
    const q = norm(machQ);
    const list = q ? machinery.filter((m) => machHaystack(m).includes(q)) : machinery;
    return list.slice(0, 60);
  }, [machinery, machQ]);
  const invFiltrados = useMemo(() => {
    const q = norm(invQ);
    const list = q ? invItems.filter((it) => norm(it.name).includes(q)) : invItems;
    return list.slice(0, 60);
  }, [invItems, invQ]);

  const chip = (label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
  const input = (value: string, onChangeText: (t: string) => void, placeholder: string, extra?: any) => (
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted}
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, color: colors.text }} {...extra} />
  );

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Servicios</SectionTitle>
        {canWrite ? (
          <TouchableOpacity onPress={abrirNueva} style={{ backgroundColor: colors.accent, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>+ Nuevo</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Servicios (recargas, mantenimientos…): categoría, tipo, equipo opcional, cantidad y precio. Si el servicio usa un repuesto del inventario, se descuenta del stock.</Text>

      {loading ? <Loading /> : servicios.length === 0 ? (
        <EmptyState title="Sin servicios" subtitle="Registra un servicio: categoría, tipo, equipo y precio." />
      ) : grupos.map((grp) => (
        <AccordionGroup key={grp.key} title={grp.name} count={grp.items.length}>
          {grp.items.map((s) => (
            <ExpandableCard
              key={s.id}
              summary={
                <View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                    <Text style={{ fontWeight: '800', fontSize: 15, color: colors.brandText, flex: 1 }} numberOfLines={1}>🧰 {s.code}</Text>
                    <Text style={{ color: colors.brandText, fontSize: 14, fontWeight: '800' }}>{usd(s.total)}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{(s.items || []).length} servicio(s) · 🏭 {supplierName(s.supplier_id)} · {String(s.service_date).slice(0, 10)}</Text>
                </View>
              }
              detail={
                <>
                  {(s.items || []).map((l, i) => (
                    <Text key={i} style={{ color: colors.muted, fontSize: 12 }}>
                      • {l.categoria}{l.tipo ? ` · ${l.tipo}` : ''}{l.machine_label ? ` · ${l.machine_label}` : ''} — {l.qty} × {usd(l.price)} = {usd((Number(l.qty) || 0) * (Number(l.price) || 0))}{l.usa_inventario && l.item_name ? ` · 📦 ${l.item_name}` : ''}
                    </Text>
                  ))}
                  {s.note ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Nota: {s.note}</Text> : null}
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                    {s.factura_url ? (
                      <TouchableOpacity onPress={() => verFactura(s)} style={{ flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>📎 Ver factura{s.factura_type === 'pdf' ? ' (PDF)' : ''}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {canWrite ? (
                      <TouchableOpacity onPress={() => abrirEditar(s)} style={{ flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>✏️ Editar</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </>
              }
            />
          ))}
        </AccordionGroup>
      ))}

      {/* ── Formulario ── */}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>{editingId ? 'Editar servicio' : 'Nuevo servicio'}</SectionTitle>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Empresa</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {generalCompanies(companies).map((c) => chip(c.name, company === c.id, () => setCompany(c.id)))}
              </View>
            </Card>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Proveedor (opcional · quién prestó el servicio)</Text>
              <View style={{ marginBottom: spacing.xs }}>{input(provQ, setProvQ, '🔎 Buscar proveedor…')}</View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {chip('— Ninguno', !supplier, () => setSupplier(''))}
                {(() => {
                  const q = provQ.trim().toLowerCase();
                  const shown = q ? suppliers.filter((s) => s.name.toLowerCase().includes(q) || supplier === s.id) : suppliers;
                  if (q && shown.length === 0) return <Text style={{ color: colors.muted, fontSize: 13, alignSelf: 'center' }}>Sin resultados para “{provQ.trim()}”.</Text>;
                  return shown.map((s) => chip(s.name, supplier === s.id, () => setSupplier(s.id)));
                })()}
              </View>
              {canWrite ? (
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                  <View style={{ flex: 1 }}>{input(nuevoProv, setNuevoProv, 'Nuevo proveedor…', { autoCapitalize: 'characters' })}</View>
                  <TouchableOpacity onPress={crearProveedor} disabled={creandoProv || !nuevoProv.trim()} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: creandoProv || !nuevoProv.trim() ? 0.5 : 1 }}>
                    <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{creandoProv ? '…' : '+ Crear'}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </Card>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Fecha</Text>
              {input(serviceDate, setServiceDate, 'AAAA-MM-DD')}
            </Card>

            {/* Renglones de servicio */}
            {items.map((it, i) => (
              <Card key={i}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 14 }}>Servicio #{i + 1}</Text>
                  {items.length > 1 ? (
                    <TouchableOpacity onPress={() => removeLine(i)}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕ Quitar</Text></TouchableOpacity>
                  ) : null}
                </View>

                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3 }}>Categoría del servicio *</Text>
                <TouchableOpacity onPress={() => { setCatQ(''); setCatPick({ i, field: 'categoria' }); }} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: it.categoria ? colors.text : colors.muted, fontSize: 13, fontWeight: it.categoria ? '700' : '400' }}>{it.categoria || 'Elige o crea la categoría…'}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>▾</Text>
                </TouchableOpacity>

                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3, marginTop: spacing.sm }}>Tipo de servicio</Text>
                <TouchableOpacity onPress={() => { setCatQ(''); setCatPick({ i, field: 'tipo' }); }} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: it.tipo ? colors.text : colors.muted, fontSize: 13, fontWeight: it.tipo ? '700' : '400' }}>{it.tipo || 'Elige o crea el tipo…'}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>▾</Text>
                </TouchableOpacity>

                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3, marginTop: spacing.sm }}>Equipo (opcional · Control de Maquinaria)</Text>
                <TouchableOpacity onPress={() => { setMachQ(''); setPickMachFor(i); }} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                  <Text style={{ color: it.machine_label ? colors.text : colors.muted, fontSize: 13, fontWeight: it.machine_label ? '700' : '400' }}>🚜 {it.machine_label || 'Busca el equipo / vehículo…'}</Text>
                </TouchableOpacity>
                {it.machine_label ? (
                  <TouchableOpacity onPress={() => setItem(i, { machinery_id: null, machine_label: '' })}><Text style={{ color: colors.danger, fontSize: 11, marginTop: 3 }}>Quitar equipo</Text></TouchableOpacity>
                ) : null}

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3 }}>Cantidad</Text>
                    {input(textoDeCampo(crudo[claveCrudo(i, 'qty')], it.qty), (t) => onNumero(i, 'qty', t), '1', { keyboardType: 'decimal-pad', inputMode: 'decimal' })}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3 }}>Precio unit.</Text>
                    {input(textoDeCampo(crudo[claveCrudo(i, 'price')], it.price), (t) => onNumero(i, 'price', t), '0', { keyboardType: 'decimal-pad', inputMode: 'decimal' })}
                  </View>
                </View>

                <TouchableOpacity onPress={() => setItem(i, { usa_inventario: !it.usa_inventario, item_id: null, item_name: '' })} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm }}>
                  <Text style={{ fontSize: 15 }}>{it.usa_inventario ? '☑️' : '⬜'}</Text>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', flex: 1 }}>📦 Este servicio usa un repuesto del inventario (se descuenta del stock)</Text>
                </TouchableOpacity>
                {it.usa_inventario ? (
                  <>
                    <TouchableOpacity onPress={() => { setInvQ(''); setPickInvFor(i); }} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs }}>
                      <Text style={{ color: it.item_name ? colors.text : colors.muted, fontSize: 13, fontWeight: it.item_name ? '700' : '400' }}>📦 {it.item_name || 'Busca el repuesto (caucho, filtro…)'}</Text>
                    </TouchableOpacity>
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>Se descuenta {it.qty || 0} del stock al guardar.</Text>
                  </>
                ) : null}

                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3, marginTop: spacing.sm }}>Detalle (opcional)</Text>
                {input(it.detalle, (t) => setItem(i, { detalle: t }), 'Observación…', { autoCapitalize: 'sentences' })}
              </Card>
            ))}

            <TouchableOpacity onPress={addLine} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>+ Agregar otro servicio (puede ser de otro tipo)</Text>
            </TouchableOpacity>

            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, textAlign: 'right', marginBottom: spacing.sm }}>Total: {usd(itemsTotal(items))}</Text>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Factura (opcional)</Text>
              <TouchableOpacity onPress={adjuntarFactura} disabled={subiendo} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: subiendo ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>{subiendo ? '⏳ Subiendo…' : factura ? `📎 ${factura.name} · Cambiar` : '📎 Adjuntar factura (imagen o PDF)'}</Text>
              </TouchableOpacity>
            </Card>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Nota (opcional)</Text>
              {input(note, (t) => setNote(t.toUpperCase()), 'OBSERVACIÓN…', { autoCapitalize: 'characters' })}
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={resetForm} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={crear} disabled={busy} style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Registrar servicio'}</Text></TouchableOpacity>
            </View>
          </ScrollView>

          {/* Selector de EQUIPO (buscador por todas las características) */}
          <Modal visible={pickMachFor !== null} animationType="slide" onRequestClose={() => setPickMachFor(null)}>
            <Screen>
              <SectionTitle>Elegir equipo</SectionTitle>
              {input(machQ, setMachQ, 'Busca por nombre, placa, serial, marca, modelo, empresa…')}
              <ScrollView style={{ marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
                {machFiltradas.map((m) => (
                  <TouchableOpacity key={m.id} onPress={() => { if (pickMachFor !== null) setItem(pickMachFor, { machinery_id: m.id, machine_label: machLabel(m) }); setPickMachFor(null); }}
                    style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{m.code}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{[m.plate && `Placa ${m.plate}`, m.serial && `Serial ${m.serial}`, m.marca, m.modelo, m.company?.name].filter(Boolean).join(' · ')}</Text>
                  </TouchableOpacity>
                ))}
                {machFiltradas.length === 0 ? <Text style={{ color: colors.muted, marginTop: spacing.md }}>Sin resultados.</Text> : null}
              </ScrollView>
              <TouchableOpacity onPress={() => setPickMachFor(null)} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text></TouchableOpacity>
            </Screen>
          </Modal>

          {/* Selector de REPUESTO del inventario */}
          <Modal visible={pickInvFor !== null} animationType="slide" onRequestClose={() => setPickInvFor(null)}>
            <Screen>
              <SectionTitle>Elegir repuesto del inventario</SectionTitle>
              {input(invQ, setInvQ, 'Busca el repuesto…')}
              <ScrollView style={{ marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
                {invFiltrados.map((it) => (
                  <TouchableOpacity key={it.id} onPress={() => { if (pickInvFor !== null) setItem(pickInvFor, { item_id: it.id, item_name: it.name }); setPickInvFor(null); }}
                    style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{it.name}</Text>
                    {it.unit ? <Text style={{ color: colors.muted, fontSize: 12 }}>{it.unit}</Text> : null}
                  </TouchableOpacity>
                ))}
                {invFiltrados.length === 0 ? <Text style={{ color: colors.muted, marginTop: spacing.md }}>Sin resultados.</Text> : null}
              </ScrollView>
              <TouchableOpacity onPress={() => setPickInvFor(null)} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text></TouchableOpacity>
            </Screen>
          </Modal>

          {/* Desplegable de CATEGORÍA / TIPO (lista completa + buscar + crear nuevo) */}
          <Modal visible={catPick !== null} animationType="slide" onRequestClose={() => setCatPick(null)}>
            <Screen>
              <SectionTitle>{catPick?.field === 'tipo' ? 'Tipo de servicio' : 'Categoría del servicio'}</SectionTitle>
              {input(catQ, (t) => setCatQ(t.toUpperCase()), 'Busca o escribe una nueva…', { autoCapitalize: 'characters' })}
              {(() => {
                const field = catPick?.field ?? 'categoria';
                const opciones = field === 'categoria' ? cats : kinds;
                const q = norm(catQ);
                const lista = q ? opciones.filter((o) => norm(o.name).includes(q)) : opciones;
                const hayExacto = opciones.some((o) => norm(o.name) === q);
                return (
                  <ScrollView style={{ marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
                    {catQ.trim() && !hayExacto ? (
                      <TouchableOpacity onPress={() => elegirOpcion(field, catQ)} style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 14 }}>+ Crear y usar «{catQ.trim()}»</Text>
                      </TouchableOpacity>
                    ) : null}
                    {lista.map((o) => (
                      <TouchableOpacity key={o.id} onPress={() => elegirOpcion(field, o.name)} style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{o.name}</Text>
                      </TouchableOpacity>
                    ))}
                    {lista.length === 0 && !catQ.trim() ? <Text style={{ color: colors.muted, marginTop: spacing.md }}>Aún no hay opciones. Escribe una arriba para crearla.</Text> : null}
                  </ScrollView>
                );
              })()}
              <TouchableOpacity onPress={() => setCatPick(null)} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text></TouchableOpacity>
            </Screen>
          </Modal>
        </Screen>
      </Modal>

      {/* Ver factura (web) */}
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
