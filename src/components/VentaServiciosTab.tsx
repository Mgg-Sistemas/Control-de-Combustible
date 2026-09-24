// ============================================================================
// 🧰 VENTAS DE SERVICIO — la venta completa, atada a una MÁQUINA, con su histórico.
//
// Pedido del cliente, textual: «vuelve esto como ventas, pero sera ventas de
// servicios, con todo el formato pero servicio, atado a una maquina, con su
// historico, con todo».
//
// TIENE TODO EL FORMATO DE UNA VENTA: a quién se le factura (cliente, proveedor o
// empresa del catálogo), factura o nota de entrega con su correlativo, renglones
// con cantidad y precio, IVA opcional, contado con su método o crédito —que genera
// su cuenta por cobrar sola—, equivalente en Bs congelado a la tasa del día, y el
// papel imprimible. Lo que cambia es que acá SOLO se venden servicios y CADA
// renglón lleva su máquina.
//
// ⭐ SE GUARDA EN `sales`, LA MISMA TABLA DE SIEMPRE. Una segunda tabla de ventas
//    sería un segundo correlativo (dos FAC-0001 el mismo mes), una segunda cuenta
//    por cobrar del mismo cliente y dos totales que nunca cuadran. Acá cambia la
//    PANTALLA, no la contabilidad.
//
// ⚠️ LA MÁQUINA ES OBLIGATORIA. Es lo que se pidió y es lo que hace que el
//    histórico sirva: un renglón sin máquina no aparece en el histórico de ninguna.
//    Un servicio que de verdad no va contra una máquina se factura en 💰 Ventas.
//
// La regla vive en src/lib/ventaServicios.ts (sin React ni Supabase).
// ============================================================================
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, ExpandableCard, SkeletonList } from './ui';
import { ConfigBanner } from './ConfigBanner';
import { DateField } from './DateField';
import { ContactoPicker } from './ContactoPicker';
import { MaquinaPicker } from './MaquinaPicker';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { useTable } from '../hooks/useTable';
import { Sale, SalesService, SalesClient, Contacto, ContactoMaquina, Machinery, Company } from '../types/database';
import {
  METODOS_PAGO, DOC_KINDS, IVA_PCT, MetodoPago, VentaDocKind, VentaItem,
  docKindLabel, docCanonico, buscarServicios, lineaTotal, cuentaDe, bsDeUsd,
} from '../lib/ventas';
import { rolesDe } from '../lib/contactos';
import { MaquinaContacto, maquinaDeRenglon } from '../lib/contactoMaquinas';
import {
  GrupoMaquina, claveMaquina, filtrarVentasServicio, lineasDeServicio, porMaquina,
  porTipoDeServicio, renglonServicio, renglonesDeServicio, totalesServicio, validarVentaServicio,
} from '../lib/ventaServicios';
import { ventaDocumentoHtml } from '../lib/ventaDocumento';
import { useBcvRate, fmtUsd, fmtBs } from '../lib/bcv';
import { exportPdf } from '../lib/pdf';
import { leerNumero } from '../lib/numeros';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const todayISO = () => new Date().toISOString().slice(0, 10);
const dmy = (iso: string) => { const [y, m, d] = String(iso ?? '').slice(0, 10).split('-'); return d ? `${d}/${m}/${y}` : ''; };

/** Qué se está mirando del histórico. */
type Vista = 'ventas' | 'maquinas' | 'servicios' | 'catalogo';
const VISTAS: { key: Vista; label: string }[] = [
  { key: 'ventas', label: '📋 Ventas' },
  { key: 'maquinas', label: '🚜 Por máquina' },
  { key: 'servicios', label: '🧰 Por servicio' },
  { key: 'catalogo', label: '⚙️ Tipos de servicio' },
];

export function VentaServiciosTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session, fullName } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { rate } = useBcvRate();

  const { data: ventas, loading, refetch } =
    useTable<Sale>('sales', { orderBy: 'created_at', ascending: false, realtimeFrom: 'sales' });
  const { data: contactos, refetch: refetchContactos } = useTable<Contacto>('contactos', { orderBy: 'name' });
  const { data: servicios, refetch: refetchServicios } =
    useTable<SalesService>('sales_services', { orderBy: 'name', realtimeFrom: 'sales_services' });
  const { data: maquinasContacto, refetch: refetchMaquinas } =
    useTable<ContactoMaquina>('contacto_maquinas', { orderBy: 'codigo' });
  const { data: machinery } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: empresas } = useTable<Company>('companies', { orderBy: 'name' });

  // ── Histórico ─────────────────────────────────────────────────────────────
  const [vista, setVista] = useState<Vista>('ventas');
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  /** La máquina a la que se le está viendo el histórico (clave de `claveMaquina`). */
  const [maqFiltro, setMaqFiltro] = useState<GrupoMaquina | null>(null);

  // ── Nueva venta de servicio ───────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState('');
  const [docKind, setDocKind] = useState<VentaDocKind>('nota_entrega');
  const [saleDate, setSaleDate] = useState(todayISO());
  const [items, setItems] = useState<VentaItem[]>([]);
  const [conIva, setConIva] = useState(false);
  const [condicion, setCondicion] = useState<'contado' | 'credito'>('contado');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo_usd');
  const [note, setNote] = useState('');
  const [pickCli, setPickCli] = useState(false);
  const [pickSrv, setPickSrv] = useState(false);
  const [pickMaq, setPickMaq] = useState<number | null>(null);
  const [qSrv, setQSrv] = useState('');
  const [nuevoSrv, setNuevoSrv] = useState('');

  // ── Catálogo de tipos de servicio ─────────────────────────────────────────
  const [openTipo, setOpenTipo] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [tName, setTName] = useState('');
  const [tDesc, setTDesc] = useState('');
  const [tPrice, setTPrice] = useState('');

  const cliente = contactos.find((c) => c.id === clientId) || null;
  const cuenta = useMemo(() => cuentaDe(items, conIva, IVA_PCT), [items, conIva]);
  const totalBs = bsDeUsd(cuenta.total, rate || 0);

  const filtradas = useMemo(
    () => filtrarVentasServicio(ventas as any, { desde, hasta, texto: q, maquina: maqFiltro?.clave ?? null }) as Sale[],
    [ventas, desde, hasta, q, maqFiltro],
  );
  const totales = useMemo(() => totalesServicio(filtradas), [filtradas]);
  const grupos = useMemo(() => porMaquina(filtradas), [filtradas]);
  const porTipo = useMemo(() => porTipoDeServicio(filtradas), [filtradas]);
  const lineas = useMemo(() => lineasDeServicio(filtradas).slice(0, 200), [filtradas]);
  // ⭐ «Cada servicio nuevo se volverá una lista desplegable buscable»: el
  //    desplegable de la venta busca por nombre, descripción y precio, y lo que se
  //    acaba de crear ya sale ahí. Es la MISMA lista que se administra en ⚙️ Tipos.
  const srvFiltrado = useMemo(() => buscarServicios(servicios, qSrv).slice(0, 80), [servicios, qSrv]);
  const tiposFiltrados = useMemo(() => buscarServicios(servicios, q), [servicios, q]);

  const reset = () => {
    setOpen(false); setClientId(''); setDocKind('nota_entrega'); setSaleDate(todayISO());
    setItems([]); setConIva(false); setCondicion('contado'); setMetodo('efectivo_usd'); setNote('');
  };

  const setItem = (i: number, patch: Partial<VentaItem>) =>
    setItems((prev) => prev.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, k) => k !== i));

  const addServicio = (s: SalesService) => {
    setItems((prev) => [...prev, renglonServicio(s)]);
    setPickSrv(false); setQSrv(''); setNuevoSrv('');
  };

  // Un servicio nuevo se guarda en el catálogo la PRIMERA vez y luego se elige.
  const crearServicioRapido = async () => {
    const name = nuevoSrv.trim();
    if (!name) return;
    const { data, error } = await supabase.from('sales_services').insert({ name }).select().single();
    if (error) return toast.error(/duplicate|unique/i.test(error.message) ? 'Ese servicio ya está en el catálogo.' : error.message);
    if (!data) return toast.error('No se guardó: te falta permiso de escritura.');
    await refetchServicios();
    addServicio(data as SalesService);
    toast.success('Servicio agregado al catálogo.');
  };

  const guardar = async () => {
    const motivo = validarVentaServicio({ clientId, items, condicion });
    if (motivo) return toast.error(motivo);
    setBusy(true);
    const payload = {
      doc_kind: docKind,
      client_id: clientId,
      client_name: cliente?.name ?? '',
      client_doc: cliente ? docCanonico(cliente.doc_letter, cliente.doc_number) : null,
      sale_date: saleDate,
      items,
      subtotal: cuenta.subtotal,
      con_iva: conIva,
      iva_pct: conIva ? IVA_PCT : 0,
      iva_monto: cuenta.iva,
      total: cuenta.total,
      condicion,
      payment_method: condicion === 'contado' ? metodo : null,
      rate_bs: rate || 0,
      total_bs: totalBs,
      note: note.trim() || null,
      created_by: session?.user?.id ?? null,
      created_by_name: fullName ?? null,
    };
    const { data, error } = await supabase.from('sales').insert(payload).select().single();
    setBusy(false);
    if (error) {
      if (/sales|relation|does not exist|column/i.test(error.message)) return toast.error('Corre "ventas.sql" en Supabase para habilitar Ventas.');
      return toast.error(error.message);
    }
    // ⚠️ Con RLS, un «no tienes permiso» llega como 0 filas y SIN error.
    if (!data) return toast.error('No se guardó: te falta permiso de escritura en Ventas.');
    reset();
    await refetch();
    toast.success(`Venta de servicio ${(data as Sale).code} registrada.`);
    const quiere = await confirm({
      title: 'Venta registrada',
      message: `¿Imprimir la ${docKindLabel(docKind).toLowerCase()} ${(data as Sale).doc_number}?`,
      confirmText: 'Imprimir',
    });
    if (quiere) imprimir(data as Sale);
  };

  const imprimir = async (v: Sale) => {
    const c = contactos.find((x) => x.id === v.client_id);
    await exportPdf(ventaDocumentoHtml({
      docKind: v.doc_kind, numero: v.doc_number ?? '', codigo: v.code, fecha: dmy(v.sale_date),
      cliente: {
        nombre: v.client_name, documento: v.client_doc,
        telefono: c?.phone ?? null, direccion: c?.address ?? null, email: c?.email ?? null,
      },
      items: (v.items ?? []) as VentaItem[],
      subtotal: Number(v.subtotal) || 0, conIva: !!v.con_iva, ivaPct: Number(v.iva_pct) || 0,
      ivaMonto: Number(v.iva_monto) || 0, total: Number(v.total) || 0,
      tasaBs: Number(v.rate_bs) || 0, totalBs: Number(v.total_bs) || 0,
      condicion: v.condicion, metodo: v.payment_method, vendedor: v.created_by_name, nota: v.note,
    }), `${docKindLabel(v.doc_kind)} ${v.doc_number} - ${v.client_name}`);
  };

  const borrarVenta = async (v: Sale) => {
    const ok = await confirm({
      title: 'Borrar venta de servicio',
      message: `¿Borrar ${v.code} (${v.doc_number})?\n\nSi fue a crédito, su cuenta por cobrar queda sin enlace.`,
      confirmText: 'Borrar', danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('sales').delete().eq('id', v.id);
    if (error) return toast.error(error.message);
    await refetch();
    toast.success('Venta borrada.');
  };

  // ── Catálogo de tipos ─────────────────────────────────────────────────────
  const abrirNuevoTipo = () => { setEditId(null); setTName(''); setTDesc(''); setTPrice(''); setOpenTipo(true); };
  const abrirEditarTipo = (s: SalesService) => {
    setEditId(s.id); setTName(s.name); setTDesc(s.description ?? ''); setTPrice(String(s.price ?? '')); setOpenTipo(true);
  };
  const guardarTipo = async () => {
    if (!tName.trim()) return toast.error('Escribe el servicio.');
    setBusy(true);
    const fila = { name: tName.trim(), description: tDesc.trim() || null, price: leerNumero(tPrice) };
    const { error } = editId
      ? await supabase.from('sales_services').update(fila).eq('id', editId)
      : await supabase.from('sales_services').insert(fila);
    setBusy(false);
    if (error) {
      if (/sales_services|relation|does not exist/i.test(error.message)) return toast.error('Corre "ventas.sql" en Supabase para habilitar Ventas.');
      return toast.error(/duplicate|unique/i.test(error.message) ? 'Ese servicio ya existe.' : error.message);
    }
    setOpenTipo(false); await refetchServicios();
    toast.success(editId ? 'Servicio actualizado.' : 'Servicio agregado.');
  };
  const borrarTipo = async (s: SalesService) => {
    const ok = await confirm({ title: 'Eliminar servicio', message: `¿Eliminar "${s.name}" del catálogo?\n\nLas ventas ya hechas conservan su nombre.`, confirmText: 'Eliminar', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('sales_services').delete().eq('id', s.id);
    if (error) return toast.error(error.message);
    await refetchServicios(); toast.success('Servicio eliminado.');
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  return (
    <Screen>
      <ConfigBanner />

      {canWrite ? (
        <TouchableOpacity onPress={() => { reset(); setOpen(true); }} style={{ backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
          <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 15 }}>＋ Nueva venta de servicio</Text>
        </TouchableOpacity>
      ) : null}

      {/* La máquina a la que se le está mirando el histórico. */}
      {maqFiltro ? (
        <TouchableOpacity onPress={() => setMaqFiltro(null)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>🚜 {maqFiltro.maquina}</Text>
          <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>← Ver todas las máquinas</Text>
        </TouchableOpacity>
      ) : null}

      <TextInput
        value={q} onChangeText={setQ}
        placeholder={vista === 'catalogo'
          ? '🔎 Busca el tipo de servicio por nombre, descripción o precio…'
          : '🔎 Servicio, máquina, serial, placa, cliente, documento…'}
        placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.xs }]}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
          <DateField value={desde} onChange={setDesde} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
          <DateField value={hasta} onChange={setHasta} />
        </View>
      </View>

      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <View><Text style={{ color: colors.muted, fontSize: 11 }}>Ventas</Text><Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>{totales.ventas}</Text></View>
          <View><Text style={{ color: colors.muted, fontSize: 11 }}>Servicios</Text><Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>{totales.renglones}</Text></View>
          <View><Text style={{ color: colors.muted, fontSize: 11 }}>Máquinas</Text><Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>{totales.maquinas}</Text></View>
          <View><Text style={{ color: colors.muted, fontSize: 11 }}>Facturado</Text><Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 16 }}>{fmtUsd(totales.usd)}</Text></View>
          <View><Text style={{ color: colors.muted, fontSize: 11 }}>A crédito</Text><Text style={{ color: colors.danger, fontWeight: '900', fontSize: 16 }}>{fmtUsd(totales.credito)}</Text></View>
        </View>
      </Card>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {VISTAS.map((v) => {
            const on = vista === v.key;
            return (
              <TouchableOpacity
                key={v.key} onPress={() => setVista(v.key)}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}
              >
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{v.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* ── 📋 LAS VENTAS ──────────────────────────────────────────────────── */}
      {vista === 'ventas' ? (
        filtradas.length === 0 ? (
          <EmptyState title="Sin ventas de servicio" subtitle={q || desde || hasta || maqFiltro ? 'Prueba con otro filtro.' : 'Registra la primera con el botón de arriba.'} />
        ) : filtradas.slice(0, 60).map((v) => (
          <ExpandableCard
            key={v.id}
            summary={
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, flex: 1 }}>
                    {v.doc_kind === 'factura' ? '🧾' : '📄'} {v.doc_number} · {v.client_name}
                  </Text>
                  <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 14 }}>{fmtUsd(v.total)}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {dmy(v.sale_date)} · {v.condicion === 'credito' ? '🟠 Crédito' : '🟢 Contado'} ·{' '}
                  {renglonesDeServicio(v as any).length} servicio(s)
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>
                  🚜 {renglonesDeServicio(v as any).map((it) => it.maquina).filter(Boolean).join(' · ') || 'sin máquina'}
                </Text>
              </View>
            }
            detail={
              <View>
                {renglonesDeServicio(v as any).map((it, i) => (
                  <View key={i} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.xs }}>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>🧰 {it.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      🚜 {it.maquina || 'sin máquina'}
                      {it.maquina_serial ? ` · Serial ${it.maquina_serial}` : ''}
                      {it.maquina_placa ? ` · Placa ${it.maquina_placa}` : ''}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {it.qty} × {fmtUsd(it.price)} = <Text style={{ color: colors.text, fontWeight: '800' }}>{fmtUsd(lineaTotal(it))}</Text>
                    </Text>
                  </View>
                ))}
                {v.note ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs, fontStyle: 'italic' }}>{v.note}</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                  {v.con_iva ? `IVA ${v.iva_pct}% · ${fmtUsd(v.iva_monto)}` : 'Exento de IVA'} · {fmtBs(v.total_bs)}
                  {v.created_by_name ? ` · ${v.created_by_name}` : ''}
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <TouchableOpacity onPress={() => imprimir(v)} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>🖨️ Imprimir</Text>
                  </TouchableOpacity>
                  {canWrite ? (
                    <TouchableOpacity onPress={() => borrarVenta(v)} style={{ paddingHorizontal: spacing.md, justifyContent: 'center' }}>
                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑️ Borrar</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            }
          />
        ))
      ) : null}

      {/* ── 🚜 EL HISTÓRICO POR MÁQUINA ────────────────────────────────────── */}
      {vista === 'maquinas' ? (
        grupos.length === 0 ? (
          <EmptyState title="Sin máquinas" subtitle="Ningún servicio vendido todavía en este filtro." />
        ) : (
          <>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>
              Toca una máquina para ver SOLO lo suyo.
            </Text>
            {grupos.map((g) => (
              <TouchableOpacity key={g.clave || g.maquina} onPress={() => { setMaqFiltro(g); setVista('ventas'); }}>
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🚜 {g.maquina}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>
                        {[g.serial ? `Serial ${g.serial}` : '', g.placa ? `Placa ${g.placa}` : ''].filter(Boolean).join(' · ') || 'Sin serial ni placa'}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                        {g.renglones} servicio(s) en {g.ventas} venta(s) · último {dmy(g.ultima)}
                      </Text>
                    </View>
                    <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 15 }}>{fmtUsd(g.usd)}</Text>
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
          </>
        )
      ) : null}

      {/* ── 🧰 POR TIPO DE SERVICIO ────────────────────────────────────────── */}
      {vista === 'servicios' ? (
        porTipo.length === 0 ? (
          <EmptyState title="Sin servicios vendidos" subtitle="Ninguno en este filtro." />
        ) : (
          <>
            {porTipo.map((t) => (
              <Card key={t.nombre}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🧰 {t.nombre}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{t.renglones} vez/veces · último {dmy(t.ultima)}</Text>
                  </View>
                  <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 15 }}>{fmtUsd(t.usd)}</Text>
                </View>
              </Card>
            ))}
            <SectionTitle>Renglón por renglón</SectionTitle>
            {lineas.map((l, i) => (
              <View key={`${l.venta.id}-${i}`} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
                  🧰 {l.item.name} · <Text style={{ color: colors.brandText }}>{fmtUsd(l.total)}</Text>
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {dmy(l.fecha)} · 🚜 {l.item.maquina || 'sin máquina'} · {l.venta.client_name} · {l.venta.doc_number}
                </Text>
              </View>
            ))}
          </>
        )
      ) : null}

      {/* ── ⚙️ EL CATÁLOGO DE TIPOS DE SERVICIO ────────────────────────────── */}
      {vista === 'catalogo' ? (
        <>
          {canWrite ? (
            <TouchableOpacity onPress={abrirNuevoTipo} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ color: colors.brandText, fontWeight: '900' }}>＋ Nuevo tipo de servicio</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
            Son los TIPOS que se ofrecen, no las ventas. También se agregan solos: al vender uno que no está,
            lo escribes una vez y queda acá para elegirlo después.
          </Text>
          {tiposFiltrados.length === 0 ? (
            <EmptyState title={q ? 'Sin resultados' : 'Sin tipos de servicio'} subtitle={q ? 'Prueba con otro dato.' : 'Agrega el primero.'} />
          ) : tiposFiltrados.map((s) => (
            <Card key={s.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🧰 {s.name}</Text>
                  {s.description ? <Text style={{ color: colors.muted, fontSize: 12 }}>{s.description}</Text> : null}
                  <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '800', marginTop: 2 }}>{fmtUsd(s.price)}</Text>
                </View>
                {canWrite ? (
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <TouchableOpacity onPress={() => abrirEditarTipo(s)}><Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>✏️</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => borrarTipo(s)}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑️</Text></TouchableOpacity>
                  </View>
                ) : null}
              </View>
            </Card>
          ))}
        </>
      ) : null}

      <View style={{ height: spacing.xl }} />

      {/* ══ NUEVA VENTA DE SERVICIO ══════════════════════════════════════════ */}
      <Modal visible={open} animationType="slide" onRequestClose={reset}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>Nueva venta de servicio</SectionTitle>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Cliente o proveedor</Text>
              <TouchableOpacity onPress={() => setPickCli(true)} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                <Text style={{ color: cliente ? colors.text : colors.muted, fontSize: 14, fontWeight: cliente ? '700' : '400' }}>
                  {cliente
                    ? `${cliente.es_proveedor && !cliente.es_cliente ? '🏭' : '👤'} ${cliente.name} · ${docCanonico(cliente.doc_letter, cliente.doc_number)}`
                    : 'Busca el cliente o proveedor (nombre, cédula, RIF, teléfono…)'}
                </Text>
                {cliente ? (
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {rolesDe(cliente as any)}{(cliente as any).company_id ? ' · 🏢 empresa interna' : ''}
                  </Text>
                ) : null}
              </TouchableOpacity>
            </Card>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>¿Qué documento se emite?</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {DOC_KINDS.map((d) => {
                  const on = docKind === d.key;
                  return (
                    <TouchableOpacity key={d.key} onPress={() => setDocKind(d.key)} style={{ flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingVertical: spacing.sm, alignItems: 'center' }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{on ? '☑' : '☐'} {d.icon} {d.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Las dos llevan precio. La nota de entrega no es documento fiscal.</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Fecha</Text>
              <DateField value={saleDate} onChange={setSaleDate} />
            </Card>

            {/* Renglones · CADA UNO CON SU MÁQUINA */}
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                Servicios · cada uno va atado a una máquina
              </Text>
              {items.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>Todavía no hay servicios. Agrega abajo.</Text>
              ) : items.map((it, i) => (
                <View key={i} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.xs }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>🧰 {it.name}</Text>
                    <TouchableOpacity onPress={() => removeItem(i)}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕</Text></TouchableOpacity>
                  </View>

                  {/* 🚜 OBLIGATORIA: sin máquina el renglón no entra al histórico de
                      ninguna, y un servicio que no dice a cuál máquina fue es lo que
                      después no se puede cobrar ni reclamar. */}
                  <TouchableOpacity
                    onPress={() => {
                      if (!clientId) return toast.error('Elige primero el cliente o proveedor: las máquinas son suyas.');
                      setPickMaq(i);
                    }}
                    style={{ marginTop: 4, paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderStyle: it.maquina ? 'solid' : 'dashed', borderColor: it.maquina ? colors.border : colors.danger, backgroundColor: colors.surfaceAlt }}
                  >
                    <Text style={{ color: it.maquina ? colors.text : colors.danger, fontSize: 12, fontWeight: '700' }}>
                      {it.maquina ? `🚜 ${it.maquina}` : '🚜 ¿A cuál máquina? (obligatorio)'}
                    </Text>
                    {it.maquina && (it.maquina_serial || it.maquina_placa) ? (
                      <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                        {[it.maquina_serial ? `Serial ${it.maquina_serial}` : '', it.maquina_placa ? `Placa ${it.maquina_placa}` : ''].filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                  </TouchableOpacity>

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4, alignItems: 'flex-end' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Cantidad</Text>
                      <TextInput value={String(it.qty)} onChangeText={(t) => setItem(i, { qty: leerNumero(t) })} keyboardType="decimal-pad" inputMode="decimal" style={input} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Precio $ (editable)</Text>
                      <TextInput value={String(it.price)} onChangeText={(t) => setItem(i, { price: leerNumero(t) })} keyboardType="decimal-pad" inputMode="decimal" style={input} />
                    </View>
                    <View style={{ minWidth: 78, alignItems: 'flex-end', paddingBottom: spacing.sm }}>
                      <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13 }}>{fmtUsd(lineaTotal(it))}</Text>
                    </View>
                  </View>
                </View>
              ))}
              <TouchableOpacity onPress={() => { setQSrv(''); setNuevoSrv(''); setPickSrv(true); }} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.sm }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>＋ 🧰 Agregar servicio</Text>
              </TouchableOpacity>
            </Card>

            <Card>
              <TouchableOpacity onPress={() => setConIva((v) => !v)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 16 }}>{conIva ? '☑️' : '⬜'}</Text>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Cobrar IVA ({IVA_PCT}%)</Text>
              </TouchableOpacity>
              <View style={{ marginTop: spacing.sm, gap: 2 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Subtotal: <Text style={{ color: colors.text, fontWeight: '700' }}>{fmtUsd(cuenta.subtotal)}</Text></Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>IVA: <Text style={{ color: colors.text, fontWeight: '700' }}>{fmtUsd(cuenta.iva)}</Text></Text>
                <Text style={{ color: colors.brandText, fontSize: 17, fontWeight: '900' }}>TOTAL {fmtUsd(cuenta.total)}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{rate && rate > 0 ? `Equivalente: ${fmtBs(totalBs)} (tasa ${fmtBs(rate)}/$)` : 'Sin tasa BCV registrada hoy.'}</Text>
              </View>
            </Card>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Condición</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {(['contado', 'credito'] as const).map((c) => {
                  const on = condicion === c;
                  return (
                    <TouchableOpacity key={c} onPress={() => setCondicion(c)} style={{ flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingVertical: spacing.sm, alignItems: 'center' }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>
                        {on ? '☑' : '☐'} {c === 'contado' ? '🟢 Contado' : '🟠 Crédito'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {condicion === 'credito' ? (
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                  Genera sola su cuenta por cobrar en 💲 Cuentas.
                </Text>
              ) : (
                <>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>¿Cómo pagó?</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    {METODOS_PAGO.map((m) => {
                      const on = metodo === m.key;
                      return (
                        <TouchableOpacity key={m.key} onPress={() => setMetodo(m.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                          <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{m.icon} {m.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </Card>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Nota (opcional)</Text>
              <TextInput value={note} onChangeText={setNote} placeholder="Observación…" placeholderTextColor={colors.muted} style={input} />
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={reset} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardar} disabled={busy} style={{ flex: 2, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>{busy ? 'Guardando…' : `🧰 Registrar venta · ${fmtUsd(cuenta.total)}`}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* A quién se le factura: el MISMO selector de 💰 Ventas. */}
          <ContactoPicker
            visible={pickCli}
            contactos={contactos}
            empresas={empresas}
            machinery={machinery}
            canWrite={canWrite}
            usuarioId={session?.user?.id ?? null}
            onCerrar={() => setPickCli(false)}
            onCambio={refetchContactos}
            onElegir={(id) => { setClientId(id); setPickCli(false); }}
          />

          {/* 🚜 La máquina del renglón: las del cliente ya guardadas, las del
              catálogo de equipos de su empresa interna, o una que no existe. */}
          <MaquinaPicker
            visible={pickMaq !== null}
            contactoId={clientId || null}
            contactoNombre={cliente?.name ?? null}
            companyId={(cliente as any)?.company_id ?? null}
            companies={empresas as any}
            maquinas={maquinasContacto.filter((m) => m.contacto_id === clientId)}
            machinery={machinery as any}
            usuarioId={session?.user?.id ?? null}
            onCerrar={() => setPickMaq(null)}
            onCambio={refetchMaquinas}
            onEmpresaEnlazada={refetchContactos}
            onElegir={(m: MaquinaContacto) => {
              if (pickMaq !== null) setItem(pickMaq, maquinaDeRenglon(m) ?? {});
              setPickMaq(null);
            }}
          />

          {/* El servicio del catálogo, buscable, con «se agrega solo» abajo. */}
          <Modal visible={pickSrv} animationType="slide" onRequestClose={() => setPickSrv(false)}>
            <Screen>
              <SectionTitle>Servicio</SectionTitle>
              <TextInput value={qSrv} onChangeText={setQSrv} placeholder="🔎 Busca el servicio por nombre, descripción o precio…" placeholderTextColor={colors.muted} style={input} />
              <ScrollView style={{ marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
                {srvFiltrado.map((s) => (
                  <TouchableOpacity key={s.id} onPress={() => addServicio(s)} style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{s.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{s.description || 'Sin descripción'} · {fmtUsd(s.price)}</Text>
                  </TouchableOpacity>
                ))}
                {srvFiltrado.length === 0 ? <Text style={{ color: colors.muted, marginTop: spacing.md }}>Sin resultados: escríbelo abajo y queda guardado.</Text> : null}
              </ScrollView>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Es un servicio nuevo? Escríbelo y queda en el catálogo:</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                <TextInput value={nuevoSrv} onChangeText={setNuevoSrv} placeholder="Ej. Traslado de maquinaria" placeholderTextColor={colors.muted} style={[input, { flex: 1 }]} />
                <TouchableOpacity onPress={crearServicioRapido} disabled={!nuevoSrv.trim()} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: nuevoSrv.trim() ? 1 : 0.5 }}>
                  <Text style={{ color: colors.brandContrast, fontWeight: '900' }}>Agregar</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setPickSrv(false)} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
              </TouchableOpacity>
            </Screen>
          </Modal>
        </Screen>
      </Modal>

      {/* ══ EL TIPO DE SERVICIO (catálogo) ═══════════════════════════════════ */}
      <Modal visible={openTipo} animationType="slide" onRequestClose={() => setOpenTipo(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>{editId ? 'Editar tipo de servicio' : 'Nuevo tipo de servicio'}</SectionTitle>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Tipo de servicio</Text>
              <TextInput value={tName} onChangeText={setTName} placeholder="Ej. Traslado de maquinaria" placeholderTextColor={colors.muted} style={input} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Descripción (opcional)</Text>
              <TextInput value={tDesc} onChangeText={setTDesc} placeholder="Detalle del servicio…" placeholderTextColor={colors.muted} style={input} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Precio referencial ($)</Text>
              <TextInput value={tPrice} onChangeText={setTPrice} keyboardType="decimal-pad" inputMode="decimal" placeholder="0.00" placeholderTextColor={colors.muted} style={input} />
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>Es solo la referencia: en cada venta se puede cambiar.</Text>
            </Card>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => setOpenTipo(false)} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardarTipo} disabled={busy} style={{ flex: 2, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>{busy ? 'Guardando…' : editId ? 'Guardar cambios' : 'Agregar servicio'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}
