// ============================================================================
// 💰 VENTAS — se vende MATERIAL (sale del inventario, con su precio referencial
// editable) y SERVICIOS (catálogo que se va llenando solo).
//
// Cada venta se documenta como FACTURA o NOTA DE ENTREGA —las dos con PRECIO, lo
// elige el usuario— y puede ser de CONTADO (con su método de pago) o a CRÉDITO,
// que genera sola su cuenta por cobrar en el módulo de Cuentas.
//
// El IVA es OPCIONAL por venta. Los montos van en $ y se muestra el equivalente
// en Bs a la tasa del BCV, que queda CONGELADA en la venta: un papel entregado
// ayer no cambia de monto porque hoy cambió el dólar.
//
// ⚠️ Las pestañas son componentes de NIVEL DE MÓDULO (no anidados): declarar un
//    componente con TextInput dentro de otro lo remonta en cada tecla y se pierde
//    el foco al escribir.
//
// Requiere correr `supabase/ventas.sql`.
// ============================================================================
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, ExpandableCard, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { SalesClient, SalesService, Sale, InventoryLevel } from '../types/database';
import {
  METODOS_PAGO, DOC_KINDS, DOC_LETRAS, IVA_PCT, MetodoPago, VentaDocKind, VentaItem,
  metodoLabel, docKindLabel, docCanonico, docValido, docTipoLabel, docDuplicado,
  buscarClientes, buscarServicios, lineaTotal, cuentaDe, bsDeUsd,
  filtrarVentas, totalesVentas, porCliente, VentaFiltro,
} from '../lib/ventas';
import { ventaDocumentoHtml } from '../lib/ventaDocumento';
import { useBcvRate, fmtUsd, fmtBs } from '../lib/bcv';
import { exportPdf } from '../lib/pdf';
import { norm } from '../lib/text';
import { leerNumero } from '../lib/numeros';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const todayISO = () => new Date().toISOString().slice(0, 10);
const dmy = (iso: string) => { const [y, m, d] = String(iso ?? '').slice(0, 10).split('-'); return d ? `${d}/${m}/${y}` : ''; };
const nowISO = () => new Date().toISOString();

// ============================================================================
// PESTAÑA 1 · VENTAS (lista + nueva venta)
// ============================================================================
function VentasTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session, fullName } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { rate } = useBcvRate();

  const { data: ventas, loading, refetch } = useTable<Sale>('sales', { orderBy: 'created_at', ascending: false, realtimeFrom: 'sales' });
  const { data: clientes, refetch: refetchClientes } = useTable<SalesClient>('sales_clients', { orderBy: 'name' });
  const { data: servicios, refetch: refetchServicios } = useTable<SalesService>('sales_services', { orderBy: 'name' });
  const { data: inventario } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name' });

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Formulario
  const [clientId, setClientId] = useState('');
  const [docKind, setDocKind] = useState<VentaDocKind>('nota_entrega');
  const [saleDate, setSaleDate] = useState(todayISO());
  const [items, setItems] = useState<VentaItem[]>([]);
  const [conIva, setConIva] = useState(false);
  const [condicion, setCondicion] = useState<'contado' | 'credito'>('contado');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo_usd');
  const [note, setNote] = useState('');
  // Selectores
  const [pickMat, setPickMat] = useState(false);
  const [pickSrv, setPickSrv] = useState(false);
  const [pickCli, setPickCli] = useState(false);
  const [q, setQ] = useState('');
  const [nuevoSrv, setNuevoSrv] = useState('');

  const cliente = clientes.find((c) => c.id === clientId) || null;
  const cuenta = useMemo(() => cuentaDe(items, conIva, IVA_PCT), [items, conIva]);
  const totalBs = bsDeUsd(cuenta.total, rate || 0);

  const reset = () => {
    setOpen(false); setClientId(''); setDocKind('nota_entrega'); setSaleDate(todayISO());
    setItems([]); setConIva(false); setCondicion('contado'); setMetodo('efectivo_usd'); setNote('');
  };

  const setItem = (i: number, patch: Partial<VentaItem>) =>
    setItems((prev) => prev.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, k) => k !== i));

  const addMaterial = (m: InventoryLevel) => {
    setItems((prev) => [...prev, {
      kind: 'material', item_id: m.id, service_id: null,
      name: m.name, unit: m.unit ?? '', qty: 1, price: Number(m.avg_cost) || 0,
    }]);
    setPickMat(false); setQ('');
  };
  const addServicio = (s: SalesService) => {
    setItems((prev) => [...prev, {
      kind: 'servicio', item_id: null, service_id: s.id,
      name: s.name, unit: 'SERV', qty: 1, price: Number(s.price) || 0,
    }]);
    setPickSrv(false); setQ(''); setNuevoSrv('');
  };
  // Un servicio nuevo se guarda en el catálogo la PRIMERA vez y luego se elige.
  const crearServicio = async () => {
    const name = nuevoSrv.trim();
    if (!name) return;
    const { data, error } = await supabase.from('sales_services').insert({ name }).select().single();
    if (error) { toast.error(/duplicate|unique/i.test(error.message) ? 'Ese servicio ya está en el catálogo.' : error.message); return; }
    await refetchServicios();
    addServicio(data as SalesService);
    toast.success('Servicio agregado al catálogo.');
  };

  const guardar = async () => {
    if (!items.length) return toast.error('Agrega al menos un material o servicio.');
    if (condicion === 'credito' && !clientId) return toast.error('Una venta a crédito necesita un cliente (es a quien se le cobra).');
    if (!clientId) return toast.error('Elige el cliente.');
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
    reset();
    await refetch();
    toast.success(`Venta ${(data as Sale).code} registrada.`);
    const quiere = await confirm({ title: 'Venta registrada', message: `¿Imprimir la ${docKindLabel(docKind).toLowerCase()} ${(data as Sale).doc_number}?`, confirmText: 'Imprimir' });
    if (quiere) imprimir(data as Sale, clientes);
  };

  const imprimir = async (v: Sale, lista: SalesClient[]) => {
    const c = lista.find((x) => x.id === v.client_id);
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

  const anular = async (v: Sale) => {
    const ok = await confirm({ title: 'Borrar venta', message: `¿Borrar ${v.code} (${v.doc_number})?\n\nSe devuelve el material al inventario. Si fue a crédito, su cuenta por cobrar queda sin enlace.`, confirmText: 'Borrar', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('sales').delete().eq('id', v.id);
    if (error) return toast.error(error.message);
    await refetch();
    toast.success('Venta borrada.');
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const matFiltrado = useMemo(() => {
    const t = norm(q);
    return inventario.filter((m) => !t || norm(`${m.name} ${m.unit ?? ''} ${m.sku ?? ''} ${m.category ?? ''}`).includes(t)).slice(0, 80);
  }, [inventario, q]);
  const srvFiltrado = useMemo(() => buscarServicios(servicios, q).slice(0, 80), [servicios, q]);
  const cliFiltrado = useMemo(() => buscarClientes(clientes, q).slice(0, 80), [clientes, q]);

  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      {canWrite ? (
        <TouchableOpacity onPress={() => setOpen(true)} style={{ backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
          <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 15 }}>＋ Nueva venta</Text>
        </TouchableOpacity>
      ) : null}

      <SectionTitle>Últimas ventas</SectionTitle>
      {ventas.length === 0 ? (
        <EmptyState title="Sin ventas" subtitle="Registra la primera venta con el botón de arriba." />
      ) : ventas.slice(0, 40).map((v) => (
        <ExpandableCard
          key={v.id}
          summary={
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
                  {v.doc_kind === 'factura' ? '🧾' : '📄'} {v.doc_number} · {v.client_name}
                </Text>
                <Text style={{ color: colors.brandText, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{fmtUsd(v.total)}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {dmy(v.sale_date)} · {v.condicion === 'credito' ? '🟠 Crédito' : `🟢 Contado · ${metodoLabel(v.payment_method)}`} · {(v.items ?? []).length} renglón(es)
              </Text>
            </View>
          }
          detail={
            <View style={{ gap: 4 }}>
              {(v.items ?? []).map((it, i) => (
                <Text key={i} style={{ color: colors.muted, fontSize: 12 }}>
                  {it.kind === 'servicio' ? '🧰' : '📦'} {it.name} · {it.qty} {it.unit ?? ''} × {fmtUsd(it.price)} = {fmtUsd(lineaTotal(it))}
                </Text>
              ))}
              <Text style={{ color: colors.text, fontSize: 12, marginTop: 4 }}>
                Subtotal {fmtUsd(v.subtotal)}{v.con_iva ? ` · IVA ${v.iva_pct}% ${fmtUsd(v.iva_monto)}` : ' · exento de IVA'} · TOTAL {fmtUsd(v.total)}
                {Number(v.total_bs) > 0 ? ` · ${fmtBs(v.total_bs)}` : ''}
              </Text>
              {v.note ? <Text style={{ color: colors.muted, fontSize: 12 }}>📝 {v.note}</Text> : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                <TouchableOpacity onPress={() => imprimir(v, clientes)} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>🖨️ Imprimir {docKindLabel(v.doc_kind)}</Text>
                </TouchableOpacity>
                {canWrite ? (
                  <TouchableOpacity onPress={() => anular(v)} style={{ paddingHorizontal: spacing.md, justifyContent: 'center' }}>
                    <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑️ Borrar</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          }
        />
      ))}

      {/* ── Formulario de nueva venta ─────────────────────────────────────── */}
      <Modal visible={open} animationType="slide" onRequestClose={reset}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>Nueva venta</SectionTitle>

            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Cliente</Text>
              <TouchableOpacity onPress={() => { setQ(''); setPickCli(true); }} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                <Text style={{ color: cliente ? colors.text : colors.muted, fontSize: 14, fontWeight: cliente ? '700' : '400' }}>
                  {cliente ? `👤 ${cliente.name} · ${docCanonico(cliente.doc_letter, cliente.doc_number)}` : 'Busca el cliente (nombre, cédula, RIF, teléfono…)'}
                </Text>
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

            {/* Renglones */}
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Renglones (material del inventario y/o servicios)</Text>
              {items.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>Todavía no hay renglones. Agrega abajo.</Text>
              ) : items.map((it, i) => (
                <View key={i} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.xs }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>
                      {it.kind === 'servicio' ? '🧰' : '📦'} {it.name}
                    </Text>
                    <TouchableOpacity onPress={() => removeItem(i)}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕</Text></TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4, alignItems: 'flex-end' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Cantidad</Text>
                      <TextInput value={String(it.qty)} onChangeText={(t) => setItem(i, { qty: leerNumero(t) })} keyboardType="decimal-pad" inputMode="decimal" style={input} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Precio $ (referencial, editable)</Text>
                      <TextInput value={String(it.price)} onChangeText={(t) => setItem(i, { price: leerNumero(t) })} keyboardType="decimal-pad" inputMode="decimal" style={input} />
                    </View>
                    <View style={{ minWidth: 78, alignItems: 'flex-end', paddingBottom: spacing.sm }}>
                      <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13 }}>{fmtUsd(lineaTotal(it))}</Text>
                    </View>
                  </View>
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <TouchableOpacity onPress={() => { setQ(''); setPickMat(true); }} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>＋ 📦 Material</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setQ(''); setNuevoSrv(''); setPickSrv(true); }} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>＋ 🧰 Servicio</Text>
                </TouchableOpacity>
              </View>
            </Card>

            {/* Totales */}
            <Card>
              <TouchableOpacity onPress={() => setConIva((v) => !v)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 15 }}>{conIva ? '☑️' : '⬜'}</Text>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 }}>Cobrar IVA ({IVA_PCT}%)</Text>
              </TouchableOpacity>
              <View style={{ marginTop: spacing.sm, gap: 3 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>Subtotal</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{fmtUsd(cuenta.subtotal)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>{conIva ? `IVA ${IVA_PCT}%` : 'Exento de IVA'}</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{conIva ? fmtUsd(cuenta.iva) : '—'}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4 }}>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '900' }}>TOTAL</Text>
                  <Text style={{ color: colors.brandText, fontSize: 16, fontWeight: '900' }}>{fmtUsd(cuenta.total)}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'right' }}>
                  {rate && rate > 0 ? `${fmtBs(totalBs)} · tasa BCV Bs ${rate}/$` : 'Sin tasa BCV: no se puede mostrar el equivalente en Bs'}
                </Text>
              </View>
            </Card>

            {/* Condición y pago */}
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Condición de la venta</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {([['contado', '🟢 Contado'], ['credito', '🟠 Crédito']] as const).map(([k, l]) => {
                  const on = condicion === k;
                  return (
                    <TouchableOpacity key={k} onPress={() => setCondicion(k)} style={{ flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingVertical: spacing.sm, alignItems: 'center' }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{l}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {condicion === 'credito' ? (
                <Text style={{ color: colors.warning, fontSize: 12, marginTop: spacing.xs, fontWeight: '700' }}>
                  Se generará sola una CUENTA POR COBRAR a {cliente?.name ?? 'el cliente'} por {fmtUsd(cuenta.total)}.
                </Text>
              ) : (
                <>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Método de pago</Text>
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
                  {(metodo === 'bs' || metodo === 'pago_movil') && rate && rate > 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
                      A cobrar en bolívares: <Text style={{ fontWeight: '900', color: colors.text }}>{fmtBs(totalBs)}</Text>
                    </Text>
                  ) : null}
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
                <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>{busy ? 'Guardando…' : `💰 Registrar venta · ${fmtUsd(cuenta.total)}`}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* Selector de CLIENTE */}
          <Modal visible={pickCli} animationType="slide" onRequestClose={() => setPickCli(false)}>
            <Screen>
              <SectionTitle>Elegir cliente</SectionTitle>
              <TextInput value={q} onChangeText={setQ} placeholder="Busca por nombre, cédula, RIF, teléfono, correo…" placeholderTextColor={colors.muted} style={input} />
              <ScrollView style={{ marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
                {cliFiltrado.map((c) => (
                  <TouchableOpacity key={c.id} onPress={() => { setClientId(c.id); setPickCli(false); setQ(''); }} style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{c.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {docTipoLabel(c.doc_letter)} {docCanonico(c.doc_letter, c.doc_number)}{c.phone ? ` · ${c.phone}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
                {cliFiltrado.length === 0 ? <Text style={{ color: colors.muted, marginTop: spacing.md }}>Sin resultados. Crea el cliente en la pestaña 👥 Clientes.</Text> : null}
              </ScrollView>
              <TouchableOpacity onPress={() => setPickCli(false)} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text></TouchableOpacity>
            </Screen>
          </Modal>

          {/* Selector de MATERIAL del inventario */}
          <Modal visible={pickMat} animationType="slide" onRequestClose={() => setPickMat(false)}>
            <Screen>
              <SectionTitle>Material del inventario</SectionTitle>
              <TextInput value={q} onChangeText={setQ} placeholder="Busca el material…" placeholderTextColor={colors.muted} style={input} />
              <ScrollView style={{ marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
                {matFiltrado.map((m) => (
                  <TouchableOpacity key={m.id} onPress={() => addMaterial(m)} style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{m.name}</Text>
                    <Text style={{ color: (Number(m.stock) || 0) > 0 ? colors.muted : colors.danger, fontSize: 12 }}>
                      Existencia {Number(m.stock) || 0} {m.unit ?? ''} · precio referencial {fmtUsd(m.avg_cost)}
                    </Text>
                  </TouchableOpacity>
                ))}
                {matFiltrado.length === 0 ? <Text style={{ color: colors.muted, marginTop: spacing.md }}>Sin resultados.</Text> : null}
              </ScrollView>
              <TouchableOpacity onPress={() => setPickMat(false)} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text></TouchableOpacity>
            </Screen>
          </Modal>

          {/* Selector de SERVICIO (catálogo que se va llenando solo) */}
          <Modal visible={pickSrv} animationType="slide" onRequestClose={() => setPickSrv(false)}>
            <Screen>
              <SectionTitle>Servicio</SectionTitle>
              <TextInput value={q} onChangeText={setQ} placeholder="Busca el servicio…" placeholderTextColor={colors.muted} style={input} />
              <ScrollView style={{ marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
                {srvFiltrado.map((s) => (
                  <TouchableOpacity key={s.id} onPress={() => addServicio(s)} style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{s.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{s.description ? `${s.description} · ` : ''}{fmtUsd(s.price)}</Text>
                  </TouchableOpacity>
                ))}
                {srvFiltrado.length === 0 ? <Text style={{ color: colors.muted, marginTop: spacing.md }}>Sin resultados: escribe el servicio abajo y quedará guardado.</Text> : null}
              </ScrollView>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Es un servicio nuevo? Escríbelo y queda en el catálogo:</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
                <TextInput value={nuevoSrv} onChangeText={setNuevoSrv} placeholder="Ej. Traslado de maquinaria" placeholderTextColor={colors.muted} style={[input, { flex: 1 }]} />
                <TouchableOpacity onPress={crearServicio} disabled={!nuevoSrv.trim()} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: nuevoSrv.trim() ? 1 : 0.5 }}>
                  <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>＋ Crear</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setPickSrv(false)} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text></TouchableOpacity>
            </Screen>
          </Modal>
        </Screen>
      </Modal>
    </Screen>
  );
}

// ============================================================================
// PESTAÑA 2 · HISTORIAL (filtrable por fechas y por todas las características)
// ============================================================================
function HistorialTab() {
  const { colors } = useTheme();
  const toast = useToast();
  const { data: ventas, loading } = useTable<Sale>('sales', { orderBy: 'sale_date', ascending: false, realtimeFrom: 'sales' });
  const { data: clientes } = useTable<SalesClient>('sales_clients', { orderBy: 'name' });

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [texto, setTexto] = useState('');
  const [docKind, setDocKind] = useState<VentaDocKind | 'todas'>('todas');
  const [condicion, setCondicion] = useState<'contado' | 'credito' | 'todas'>('todas');
  const [metodo, setMetodo] = useState<MetodoPago | 'todos'>('todos');
  const [clientId, setClientId] = useState<string>('');
  const [pdfBusy, setPdfBusy] = useState(false);

  const filtro: VentaFiltro = { desde, hasta, texto, docKind, condicion, metodo, clientId: clientId || null };
  const rows = useMemo(() => filtrarVentas(ventas, filtro), [ventas, desde, hasta, texto, docKind, condicion, metodo, clientId]);
  const tot = useMemo(() => totalesVentas(rows), [rows]);
  const grupos = useMemo(() => porCliente(rows), [rows]);

  const limpiar = () => { setDesde(''); setHasta(''); setTexto(''); setDocKind('todas'); setCondicion('todas'); setMetodo('todos'); setClientId(''); };

  const pdf = async () => {
    setPdfBusy(true);
    try {
      const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
      const filas = rows.map((v) => `<tr>
        <td>${esc(dmy(v.sale_date))}</td><td>${esc(v.doc_number)}</td><td>${esc(docKindLabel(v.doc_kind))}</td>
        <td class="l">${esc(v.client_name)}</td><td>${esc(v.client_doc ?? '')}</td>
        <td>${v.condicion === 'credito' ? 'Crédito' : 'Contado'}</td><td>${esc(v.condicion === 'contado' ? metodoLabel(v.payment_method) : '—')}</td>
        <td class="r">${esc(fmtUsd(v.total))}</td><td class="r">${esc(fmtBs(v.total_bs))}</td></tr>`).join('');
      const porCli = grupos.map((g) => `<tr><td class="l">${esc(g.name)}</td><td>${esc(g.doc)}</td><td class="c">${g.ventas.length}</td><td class="r">${esc(fmtUsd(g.usd))}</td><td class="r">${esc(fmtUsd(g.credito))}</td></tr>`).join('');
      const rango = desde || hasta ? `${desde ? dmy(desde) : '…'} a ${hasta ? dmy(hasta) : '…'}` : 'Todo el histórico';
      await exportPdf(`
        <style>
          *{font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
          h1{font-size:18px;margin:0;color:#16324F} .sub{color:#555;font-size:12px;margin:2px 0 12px}
          table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:14px}
          th,td{border:1px solid #ccc;padding:5px 6px;text-align:center}
          th{background:#16324F;color:#fff} td.l{text-align:left} td.r{text-align:right;font-weight:700} td.c{text-align:center}
          .sect{font-size:13px;font-weight:800;color:#16324F;margin:14px 0 6px}
          .kpis{display:flex;gap:10px;margin-bottom:12px}
          .kpi{flex:1;border:1px solid #E2E8F0;border-radius:8px;padding:8px;text-align:center}
          .kpi b{display:block;font-size:16px;color:#16324F}
        </style>
        <h1>💰 Historial de ventas</h1>
        <div class="sub">${esc(rango)} · ${rows.length} venta(s)</div>
        <div class="kpis">
          <div class="kpi"><b>${rows.length}</b>Ventas</div>
          <div class="kpi"><b>${esc(fmtUsd(tot.usd))}</b>Total</div>
          <div class="kpi"><b>${esc(fmtUsd(tot.contado))}</b>Contado</div>
          <div class="kpi"><b>${esc(fmtUsd(tot.credito))}</b>Crédito</div>
        </div>
        <div class="sect">Ventas</div>
        <table><thead><tr><th>Fecha</th><th>Documento</th><th>Tipo</th><th class="l">Cliente</th><th>C.I./RIF</th><th>Condición</th><th>Método</th><th>Total $</th><th>Total Bs</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="9">Sin ventas en el filtro.</td></tr>'}</tbody></table>
        <div class="sect">Resumen por cliente</div>
        <table><thead><tr><th class="l">Cliente</th><th>C.I./RIF</th><th>Ventas</th><th>Total $</th><th>A crédito $</th></tr></thead>
        <tbody>${porCli || '<tr><td colspan="5">—</td></tr>'}</tbody></table>
      `, `Historial de ventas (${desde || 'inicio'} a ${hasta || 'hoy'})`);
    } catch (e: any) { toast.error('No se pudo generar el PDF: ' + (e?.message ?? e)); }
    finally { setPdfBusy(false); }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const chip = (label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={label} onPress={onPress} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );

  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', marginBottom: spacing.xs }}>FILTROS</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
            <DateField value={desde} onChange={setDesde} placeholder="Inicio" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
            <DateField value={hasta} onChange={setHasta} placeholder="Hoy" />
          </View>
        </View>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm, marginBottom: 2 }}>Buscar (cliente, documento, renglón, método…)</Text>
        <TextInput value={texto} onChangeText={setTexto} placeholder="🔎 Escribe cualquier característica…" placeholderTextColor={colors.muted} style={input} />

        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm, marginBottom: 2 }}>Documento</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {chip('Todas', docKind === 'todas', () => setDocKind('todas'))}
          {DOC_KINDS.map((d) => chip(`${d.icon} ${d.label}`, docKind === d.key, () => setDocKind(d.key)))}
        </View>

        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm, marginBottom: 2 }}>Condición</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {chip('Todas', condicion === 'todas', () => setCondicion('todas'))}
          {chip('🟢 Contado', condicion === 'contado', () => setCondicion('contado'))}
          {chip('🟠 Crédito', condicion === 'credito', () => setCondicion('credito'))}
        </View>

        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm, marginBottom: 2 }}>Método de pago</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {chip('Todos', metodo === 'todos', () => setMetodo('todos'))}
          {METODOS_PAGO.map((m) => chip(`${m.icon} ${m.label}`, metodo === m.key, () => setMetodo(m.key)))}
        </View>

        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm, marginBottom: 2 }}>Cliente</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {chip('Todos', !clientId, () => setClientId(''))}
          {clientes.slice(0, 30).map((c) => chip(c.name, clientId === c.id, () => setClientId(c.id)))}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <TouchableOpacity onPress={limpiar} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>✕ Limpiar</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={pdf} disabled={pdfBusy} style={{ flex: 2, backgroundColor: '#B91C1C', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: pdfBusy ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{pdfBusy ? 'Generando…' : '📄 Descargar PDF'}</Text>
          </TouchableOpacity>
        </View>
      </Card>

      {/* Totales */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        {[
          { k: 'Ventas', v: String(tot.ventas), c: colors.text },
          { k: 'Total', v: fmtUsd(tot.usd), c: colors.brandText },
          { k: 'Contado', v: fmtUsd(tot.contado), c: colors.success },
          { k: 'Crédito', v: fmtUsd(tot.credito), c: colors.warning },
        ].map((x) => (
          <Card key={x.k} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm }}>
            <Text style={{ color: x.c, fontWeight: '900', fontSize: 15 }}>{x.v}</Text>
            <Text style={{ color: colors.muted, fontSize: 10 }}>{x.k}</Text>
          </Card>
        ))}
      </View>

      <SectionTitle>Por cliente</SectionTitle>
      {grupos.length === 0 ? (
        <EmptyState title="Sin ventas" subtitle="Ajusta los filtros o registra una venta." />
      ) : grupos.map((g) => (
        <ExpandableCard
          key={g.key}
          summary={
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>👤 {g.name}</Text>
                <Text style={{ color: colors.brandText, fontWeight: '900' }}>{fmtUsd(g.usd)}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {g.doc ? `${g.doc} · ` : ''}{g.ventas.length} venta(s){g.credito > 0 ? ` · 🟠 a crédito ${fmtUsd(g.credito)}` : ''}
              </Text>
            </View>
          }
          detail={
            <View style={{ gap: 4 }}>
              {g.ventas.map((v) => (
                <Text key={v.id} style={{ color: colors.muted, fontSize: 12 }}>
                  {dmy(v.sale_date)} · {v.doc_number} · {docKindLabel(v.doc_kind)} · {v.condicion === 'credito' ? 'Crédito' : metodoLabel(v.payment_method)} · <Text style={{ fontWeight: '800', color: colors.text }}>{fmtUsd(v.total)}</Text>
                </Text>
              ))}
            </View>
          }
        />
      ))}
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

// ============================================================================
// PESTAÑA 3 · CLIENTES (catálogo amarrado a CÉDULA o RIF, sin duplicados)
// ============================================================================
function ClientesTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: clientes, loading, refetch } = useTable<SalesClient>('sales_clients', { orderBy: 'name', realtimeFrom: 'sales_clients' });

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [letra, setLetra] = useState('V');
  const [numero, setNumero] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [esProv, setEsProv] = useState(false);
  const [busy, setBusy] = useState(false);

  const lista = useMemo(() => buscarClientes(clientes, q), [clientes, q]);
  const choca = docDuplicado(clientes as any, letra, numero, editId);

  const abrirNuevo = () => { setEditId(null); setName(''); setLetra('V'); setNumero(''); setPhone(''); setEmail(''); setAddress(''); setEsProv(false); setOpen(true); };
  const abrirEditar = (c: SalesClient) => {
    setEditId(c.id); setName(c.name); setLetra(c.doc_letter); setNumero(c.doc_number);
    setPhone(c.phone ?? ''); setEmail(c.email ?? ''); setAddress(c.address ?? ''); setEsProv(!!c.es_proveedor); setOpen(true);
  };

  const guardar = async () => {
    if (!name.trim()) return toast.error('Escribe el nombre.');
    if (!docValido(letra, numero)) return toast.error('El documento no es válido (mínimo 6 dígitos).');
    if (choca) return toast.error(`Ese ${docTipoLabel(letra).toLowerCase()} ya está registrado a nombre de "${choca.name}".`);
    setBusy(true);
    const fila = {
      name: name.trim().toUpperCase(), doc_letter: letra, doc_number: numero.replace(/[^0-9]/g, ''),
      phone: phone.trim() || null, email: email.trim() || null, address: address.trim() || null,
      es_proveedor: esProv,
    };
    const { error } = editId
      ? await supabase.from('sales_clients').update(fila).eq('id', editId)
      : await supabase.from('sales_clients').insert({ ...fila, created_by: session?.user?.id ?? null });
    setBusy(false);
    if (error) {
      if (/sales_clients|relation|does not exist/i.test(error.message)) return toast.error('Corre "ventas.sql" en Supabase para habilitar Ventas.');
      return toast.error(/duplicate|unique/i.test(error.message) ? 'Ese documento ya está registrado.' : error.message);
    }
    setOpen(false); await refetch();
    toast.success(editId ? 'Cliente actualizado.' : 'Cliente registrado.');
  };

  const borrar = async (c: SalesClient) => {
    const ok = await confirm({ title: 'Eliminar cliente', message: `¿Eliminar a "${c.name}"?\n\nNo se puede si tiene ventas o cuentas registradas.`, confirmText: 'Eliminar', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('sales_clients').delete().eq('id', c.id);
    if (error) return toast.error(/foreign key|violates/i.test(error.message) ? 'No se puede: ese cliente ya tiene ventas o cuentas.' : error.message);
    await refetch(); toast.success('Cliente eliminado.');
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Busca por nombre, cédula, RIF, teléfono, correo, dirección…" placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.sm }]} />
      {canWrite ? (
        <TouchableOpacity onPress={abrirNuevo} style={{ backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
          <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>＋ Nuevo cliente</Text>
        </TouchableOpacity>
      ) : null}

      {lista.length === 0 ? (
        <EmptyState title={q ? 'Sin resultados' : 'Sin clientes'} subtitle={q ? 'Prueba con otro dato.' : 'Registra a quién le vendes.'} />
      ) : lista.map((c) => (
        <Card key={c.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{c.name}{c.es_proveedor ? ' · 🏭' : ''}</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {docTipoLabel(c.doc_letter)} {docCanonico(c.doc_letter, c.doc_number)}
                {c.phone ? ` · 📞 ${c.phone}` : ''}{c.email ? ` · ✉️ ${c.email}` : ''}
              </Text>
              {c.address ? <Text style={{ color: colors.muted, fontSize: 12 }}>📍 {c.address}</Text> : null}
            </View>
            {canWrite ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TouchableOpacity onPress={() => abrirEditar(c)}><Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>✏️</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => borrar(c)}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑️</Text></TouchableOpacity>
              </View>
            ) : null}
          </View>
        </Card>
      ))}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>{editId ? 'Editar cliente' : 'Nuevo cliente'}</SectionTitle>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Nombre o razón social</Text>
              <TextInput value={name} onChangeText={(t) => setName(t.toUpperCase())} autoCapitalize="characters" placeholder="NOMBRE DEL CLIENTE" placeholderTextColor={colors.muted} style={input} />

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Documento (la cédula o el RIF no se puede repetir)</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: 4 }}>
                {DOC_LETRAS.map((l) => {
                  const on = letra === l;
                  return (
                    <TouchableOpacity key={l} onPress={() => setLetra(l)} style={{ flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingVertical: spacing.xs, alignItems: 'center' }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{l}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput value={numero} onChangeText={(t) => setNumero(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" inputMode="numeric" placeholder="Solo los números" placeholderTextColor={colors.muted}
                style={[input, { borderColor: choca ? colors.danger : colors.border }]} />
              <Text style={{ color: choca ? colors.danger : colors.muted, fontSize: 11, marginTop: 3, fontWeight: choca ? '800' : '400' }}>
                {choca
                  ? `⚠️ Ese ${docTipoLabel(letra).toLowerCase()} ya está registrado a nombre de "${choca.name}".`
                  : `Quedará como ${docCanonico(letra, numero) || `${letra}-…`} · ${docTipoLabel(letra)}`}
              </Text>

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Teléfono</Text>
              <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="0414-1112233" placeholderTextColor={colors.muted} style={input} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Correo</Text>
              <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="correo@ejemplo.com" placeholderTextColor={colors.muted} style={input} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Dirección</Text>
              <TextInput value={address} onChangeText={setAddress} placeholder="Dirección fiscal / de entrega" placeholderTextColor={colors.muted} style={input} />

              <TouchableOpacity onPress={() => setEsProv((v) => !v)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm }}>
                <Text style={{ fontSize: 15 }}>{esProv ? '☑️' : '⬜'}</Text>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 }}>🏭 También es proveedor (le compramos)</Text>
              </TouchableOpacity>
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardar} disabled={busy || !!choca} style={{ flex: 2, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy || choca ? 0.5 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>{busy ? 'Guardando…' : editId ? 'Guardar cambios' : 'Registrar cliente'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

// ============================================================================
// PESTAÑA 4 · SERVICIOS (catálogo buscable, se llena solo desde la venta)
// ============================================================================
function ServiciosVentaTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: servicios, loading, refetch } = useTable<SalesService>('sales_services', { orderBy: 'name', realtimeFrom: 'sales_services' });

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  const lista = useMemo(() => buscarServicios(servicios, q), [servicios, q]);

  const abrirNuevo = () => { setEditId(null); setName(''); setDescription(''); setPrice(''); setOpen(true); };
  const abrirEditar = (s: SalesService) => { setEditId(s.id); setName(s.name); setDescription(s.description ?? ''); setPrice(String(s.price ?? '')); setOpen(true); };

  const guardar = async () => {
    if (!name.trim()) return toast.error('Escribe el servicio.');
    setBusy(true);
    const fila = { name: name.trim(), description: description.trim() || null, price: leerNumero(price) };
    const { error } = editId
      ? await supabase.from('sales_services').update(fila).eq('id', editId)
      : await supabase.from('sales_services').insert(fila);
    setBusy(false);
    if (error) {
      if (/sales_services|relation|does not exist/i.test(error.message)) return toast.error('Corre "ventas.sql" en Supabase para habilitar Ventas.');
      return toast.error(/duplicate|unique/i.test(error.message) ? 'Ese servicio ya existe.' : error.message);
    }
    setOpen(false); await refetch();
    toast.success(editId ? 'Servicio actualizado.' : 'Servicio agregado.');
  };

  const borrar = async (s: SalesService) => {
    const ok = await confirm({ title: 'Eliminar servicio', message: `¿Eliminar "${s.name}" del catálogo?`, confirmText: 'Eliminar', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('sales_services').delete().eq('id', s.id);
    if (error) return toast.error(error.message);
    await refetch(); toast.success('Servicio eliminado.');
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Busca por nombre, descripción o precio…" placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.sm }]} />
      {canWrite ? (
        <TouchableOpacity onPress={abrirNuevo} style={{ backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
          <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>＋ Nuevo servicio</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
        También se agregan solos: al vender un servicio que no está, lo escribes una vez y queda acá para elegirlo después.
      </Text>

      {lista.length === 0 ? (
        <EmptyState title={q ? 'Sin resultados' : 'Sin servicios'} subtitle={q ? 'Prueba con otro dato.' : 'Agrega el primer tipo de servicio.'} />
      ) : lista.map((s) => (
        <Card key={s.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🧰 {s.name}</Text>
              {s.description ? <Text style={{ color: colors.muted, fontSize: 12 }}>{s.description}</Text> : null}
              <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '800', marginTop: 2 }}>{fmtUsd(s.price)}</Text>
            </View>
            {canWrite ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TouchableOpacity onPress={() => abrirEditar(s)}><Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>✏️</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => borrar(s)}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑️</Text></TouchableOpacity>
              </View>
            ) : null}
          </View>
        </Card>
      ))}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>{editId ? 'Editar servicio' : 'Nuevo servicio'}</SectionTitle>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Tipo de servicio</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Ej. Traslado de maquinaria" placeholderTextColor={colors.muted} style={input} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Descripción (opcional)</Text>
              <TextInput value={description} onChangeText={setDescription} placeholder="Detalle del servicio…" placeholderTextColor={colors.muted} style={input} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Precio referencial ($)</Text>
              <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" inputMode="decimal" placeholder="0.00" placeholderTextColor={colors.muted} style={input} />
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>Es solo la referencia: en cada venta se puede cambiar.</Text>
            </Card>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardar} disabled={busy} style={{ flex: 2, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>{busy ? 'Guardando…' : editId ? 'Guardar cambios' : 'Agregar servicio'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

// ============================================================================
// PANTALLA
// ============================================================================
const TABS = [
  { key: 'ventas', label: 'Ventas', icon: '💰' },
  { key: 'historial', label: 'Historial', icon: '📊' },
  { key: 'clientes', label: 'Clientes', icon: '👥' },
  { key: 'servicios', label: 'Servicios', icon: '🧰' },
];

export default function VentasScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const canWrite = levelMeets(moduleLevel('ventas'), 'escritura');
  const [active, setActive] = useState('ventas');

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
        {active === 'ventas' ? <VentasTab canWrite={canWrite} />
          : active === 'historial' ? <HistorialTab />
          : active === 'clientes' ? <ClientesTab canWrite={canWrite} />
          : <ServiciosVentaTab canWrite={canWrite} />}
      </View>
    </View>
  );
}
