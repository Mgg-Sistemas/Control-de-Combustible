// ============================================================================
// 🧰 CAJA — el dinero del día.
//
// LA REGLA QUE MANDA (textual del cliente): «todo lo que entra es por ventas».
// Acá NO hay un botón para agregar un ingreso, y no es un olvido:
//
//   · La VENTA DE CONTADO entra sola el día de la venta, por su método de pago.
//   · La VENTA A CRÉDITO entra el día que se cobra el abono en Cuentas, y solo
//     por lo abonado. Si el cliente no paga, la caja no miente.
//   · Lo único que se carga a mano es un EGRESO.
//
// Los ingresos los meten TRIGGERS en la base (`supabase/caja.sql`). Hacerlo
// desde la pantalla exigiría permiso del módulo Caja a quien vende, y si ese
// permiso faltara la venta quedaría grabada y el dinero no — la peor de las dos
// mitades. La misma regla está escrita tres veces: acá, en un CHECK y en la
// política de RLS.
//
// ⚠️ Las pestañas son componentes de NIVEL DE MÓDULO (no anidados): declarar un
//    componente con TextInput dentro de otro lo remonta en cada tecla y se
//    pierde el foco al escribir.
//
// Requiere correr `supabase/caja.sql` (y `supabase/ventas.sql` antes).
// ============================================================================
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { Card, SectionTitle, EmptyState, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { METODOS_PAGO, MetodoPago, metodoLabel } from '../lib/ventas';
import {
  MovimientoRow, SesionRow, LineaArqueo, TipoMov, OrigenMov,
  ORIGEN_LABEL, MONEDA_METODO, esEfectivo,
  totalesPorMetodo, esperadoDe, arqueoDe, resumenCaja, porCategoria,
  filtrarMovs, validarEgreso, filaEgreso, actaCierreHtml,
  tarjetasDeDinero, totalDisponible, resumenEntradas, entradasPorMetodo,
  money, fmtUsd, fmtBs, dmy,
} from '../lib/caja';
import { useBcvRate } from '../lib/bcv';
import { exportPdf } from '../lib/pdf';
import { COMPANY_NAME } from '../lib/company';
import { norm } from '../lib/text';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const todayISO = () => new Date().toISOString().slice(0, 10);

type Sesion = SesionRow & { id: string };
type Mov = MovimientoRow & { id: string };
type Categoria = { id: string; name: string; icon: string | null; active: boolean };

/** El monto en la moneda del método, ya formateado. */
const fmtMetodo = (m: MetodoPago, v: any) => (MONEDA_METODO[m] === 'bs' ? fmtBs(v) : fmtUsd(v));

// ============================================================================
// PESTAÑA 1 · LA CAJA DE HOY
// ============================================================================
function CajaTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session, fullName } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { rate } = useBcvRate();

  const { data: sesiones, loading, refetch } = useTable<Sesion>('caja_sesiones', {
    orderBy: 'opened_at', ascending: false, realtimeFrom: 'caja_sesiones',
  });
  const { data: movs, refetch: refetchMovs } = useTable<Mov>('caja_movimientos', {
    orderBy: 'created_at', ascending: false, realtimeFrom: 'caja_movimientos',
  });
  const { data: cats } = useTable<Categoria>('caja_categorias', { orderBy: 'name' });

  const abierta = useMemo(() => sesiones.find((s) => s.estado === 'abierta') ?? null, [sesiones]);

  // Los movimientos de la sesión abierta. Los que entraron con la caja cerrada
  // (sesion_id null) se muestran aparte: son plata real que todavía no tiene
  // dueño, y la próxima apertura se los lleva.
  const deLaCaja = useMemo(
    () => (abierta ? movs.filter((m) => m.sesion_id === abierta.id) : []),
    [movs, abierta]
  );
  const sueltos = useMemo(() => movs.filter((m) => !m.sesion_id), [movs]);

  const resumen = useMemo(() => resumenCaja(deLaCaja), [deLaCaja]);
  const esperado = useMemo(() => esperadoDe(abierta, deLaCaja), [abierta, deLaCaja]);
  // 💵 Cuánto dinero hay, por bolsillo, y lo que entró por ventas (24-sep-2026).
  const tarjetas = useMemo(() => tarjetasDeDinero(abierta, deLaCaja), [abierta, deLaCaja]);
  const total = useMemo(() => totalDisponible(abierta, deLaCaja, rate), [abierta, deLaCaja, rate]);
  const entradas = useMemo(() => resumenEntradas(deLaCaja), [deLaCaja]);
  const porMetodoEntradas = useMemo(() => entradasPorMetodo(deLaCaja), [deLaCaja]);
  // Qué se está mirando en la lista de abajo.
  const [verMovs, setVerMovs] = useState<'todo' | 'venta' | 'cobranza' | 'egreso'>('todo');
  const movsVistos = useMemo(() => {
    if (verMovs === 'todo') return deLaCaja;
    if (verMovs === 'egreso') return deLaCaja.filter((m) => m.tipo === 'egreso');
    return deLaCaja.filter((m) => m.tipo === 'ingreso' && m.origen === verMovs);
  }, [deLaCaja, verMovs]);

  // ── Abrir caja ──────────────────────────────────────────────────────────
  const [abrirOpen, setAbrirOpen] = useState(false);
  const [apUsd, setApUsd] = useState('');
  const [apBs, setApBs] = useState('');
  const [busy, setBusy] = useState(false);

  const abrirCaja = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.from('caja_sesiones').insert({
        apertura_usd: money(apUsd), apertura_bs: money(apBs), rate_bs: money(rate),
        opened_by: session?.user?.id ?? null, opened_by_name: fullName ?? null,
      });
      if (error) return toast.error(error.message);
      setAbrirOpen(false); setApUsd(''); setApBs('');
      refetch(); refetchMovs();
      toast.success('Caja abierta.');
    } finally { setBusy(false); }
  };

  // ── Egreso ──────────────────────────────────────────────────────────────
  const [egOpen, setEgOpen] = useState(false);
  const [egConcepto, setEgConcepto] = useState('');
  const [egCategoria, setEgCategoria] = useState('');
  const [egMetodo, setEgMetodo] = useState<MetodoPago>('efectivo_usd');
  const [egMonto, setEgMonto] = useState('');
  const [egFecha, setEgFecha] = useState(todayISO());
  const [egNota, setEgNota] = useState('');
  const [egError, setEgError] = useState<string | null>(null);

  const limpiarEgreso = () => {
    setEgConcepto(''); setEgCategoria(''); setEgMetodo('efectivo_usd');
    setEgMonto(''); setEgFecha(todayISO()); setEgNota(''); setEgError(null);
  };

  const guardarEgreso = async () => {
    const inp = { concepto: egConcepto, categoria: egCategoria, metodo: egMetodo, monto: egMonto, fecha: egFecha, nota: egNota };
    const problema = validarEgreso(inp);
    // El aviso va DENTRO del formulario: un toast se dibuja en la pantalla de
    // atrás y este modal lo tapa justo cuando aparece.
    if (problema) return setEgError(problema);
    setBusy(true);
    try {
      const fila = filaEgreso(inp, rate, session?.user?.id ?? null);
      const { error } = await supabase.from('caja_movimientos').insert({ ...fila, sesion_id: abierta?.id ?? null });
      if (error) return setEgError(error.message);
      setEgOpen(false); limpiarEgreso(); refetchMovs();
      toast.success('Egreso registrado.');
    } finally { setBusy(false); }
  };

  const borrarEgreso = async (m: Mov) => {
    if (!(await confirm(`¿Borrar el egreso «${m.concepto}» por ${fmtUsd(m.monto)}?`))) return;
    const { error } = await supabase.from('caja_movimientos').delete().eq('id', m.id);
    if (error) return toast.error(error.message);
    refetchMovs();
    toast.success('Egreso borrado.');
  };

  // ── Cerrar caja (arqueo) ────────────────────────────────────────────────
  const [cerrarOpen, setCerrarOpen] = useState(false);
  const [conteo, setConteo] = useState<Partial<Record<MetodoPago, string>>>({});
  const [notaCierre, setNotaCierre] = useState('');
  const lineas = useMemo(() => arqueoDe(abierta, deLaCaja, conteo), [abierta, deLaCaja, conteo]);

  // Los métodos que tienen saldo esperado y nadie contó. Se avisan EN LÍNEA,
  // dentro del propio modal, y NO con : este proyecto ya documenta
  // que un  disparado desde adentro de un Modal a pantalla
  // completa se dibuja DEBAJO y nadie lo ve — la pantalla se quedaría colgada
  // esperando una respuesta a una pregunta invisible.
  const sinContar = useMemo(() => lineas.filter((l) => !l.seConto && l.esperado !== 0), [lineas]);

  const cerrarCaja = async () => {
    if (!abierta) return;
    setBusy(true);
    try {
      const limpio: Record<string, number> = {};
      lineas.filter((l) => l.seConto).forEach((l) => { limpio[l.metodo] = l.contado; });
      const { error } = await supabase.from('caja_sesiones').update({
        estado: 'cerrada', closed_at: new Date().toISOString(),
        closed_by: session?.user?.id ?? null, closed_by_name: fullName ?? null,
        conteo: limpio, rate_bs: money(rate), nota: notaCierre.trim() || null,
      }).eq('id', abierta.id);
      if (error) return toast.error(error.message);

      // El acta sale con los datos que se acaban de guardar, no con los que
      // tenía la fila antes del update (que todavía dice «abierta»).
      await exportPdf(actaCierreHtml({
        sesion: { ...abierta, estado: 'cerrada', closed_at: new Date().toISOString(), closed_by_name: fullName, rate_bs: money(rate), nota: notaCierre.trim() || null, conteo: limpio },
        movimientos: deLaCaja, conteo: limpio, empresa: COMPANY_NAME, conDetalle: true,
      }), `Acta de cierre ${abierta.code ?? ''}`);

      setCerrarOpen(false); setConteo({}); setNotaCierre('');
      refetch(); refetchMovs();
      toast.success('Caja cerrada.');
    } finally { setBusy(false); }
  };

  if (loading) return <SkeletonList />;

  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 14,
  };

  // ── CAJA CERRADA ────────────────────────────────────────────────────────
  if (!abierta) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.md }}>
        <ConfigBanner />
        <EmptyState title="No hay una caja abierta" subtitle="Ábrela para empezar a registrar el día." />
        {sueltos.length ? (
          <Card style={{ marginTop: spacing.md, borderLeftWidth: 4, borderLeftColor: colors.warning ?? colors.brand }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
              {sueltos.length} movimiento(s) entraron con la caja cerrada
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
              Suman {fmtUsd(resumenCaja(sueltos).saldo)}. No se pierden: al abrir la caja entran en esta sesión y salen en su arqueo.
            </Text>
          </Card>
        ) : null}
        {canWrite ? (
          <TouchableOpacity onPress={() => setAbrirOpen(true)} activeOpacity={0.85}
            style={{ marginTop: spacing.lg, backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 14 }}>🔓 Abrir caja</Text>
          </TouchableOpacity>
        ) : null}

        <Modal visible={abrirOpen} transparent animationType="slide" onRequestClose={() => setAbrirOpen(false)}>
          <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: spacing.lg }}>
              <SectionTitle>🔓 Abrir caja</SectionTitle>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
                El fondo con el que arranca la gaveta. Solo el efectivo: una transferencia no se «abre con saldo», se cuadra contra el banco.
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>EFECTIVO EN DÓLARES</Text>
              <TextInput value={apUsd} onChangeText={setApUsd} keyboardType="numeric" placeholder="$ 0,00"
                placeholderTextColor={colors.muted} style={{ ...input, marginTop: 3 }} />
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm }}>EFECTIVO EN BOLÍVARES</Text>
              <TextInput value={apBs} onChangeText={setApBs} keyboardType="numeric" placeholder="Bs 0,00"
                placeholderTextColor={colors.muted} style={{ ...input, marginTop: 3 }} />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                <TouchableOpacity onPress={() => setAbrirOpen(false)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={busy} onPress={abrirCaja} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                  <Text style={{ color: colors.brandContrast, fontWeight: '900' }}>{busy ? 'Abriendo…' : 'Abrir'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    );
  }

  // ── CAJA ABIERTA ────────────────────────────────────────────────────────
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md }}>
      <ConfigBanner />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>🔓 {abierta.code}</Text>
            <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>
              Abrió {abierta.opened_by_name || '—'} · {String(abierta.opened_at ?? '').slice(0, 10).split('-').reverse().join('/')}
            </Text>
          </View>
          <View style={{ backgroundColor: colors.successSoftBg ?? colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill }}>
            <Text style={{ color: colors.success, fontWeight: '900', fontSize: 11 }}>ABIERTA</Text>
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.sm }} />

        <Text style={{ color: colors.muted, fontSize: 12 }}>
          Entró {fmtUsd(resumen.ingresos)} · Salió {fmtUsd(resumen.egresos)}
        </Text>
        <Text style={{ color: colors.text, fontWeight: '900', fontSize: 22, marginTop: 2 }}>{fmtUsd(resumen.saldo)}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtBs(resumen.saldoBs)}</Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
          {resumen.porVenta} venta(s) de contado · {resumen.porCobranza} cobro(s) de crédito · {resumen.movimientos - resumen.porVenta - resumen.porCobranza} egreso(s)
        </Text>
      </Card>

      {/* ── 💵 CUÁNTO DINERO HAY ──────────────────────────────────────────
          Pedido del cliente (24-sep-2026): «que se refleje con tarjetas cuánto
          dinero hay».

          ⚠️ Cuatro tarjetas y no un solo número: la plata está en cuatro sitios
          distintos y cada uno se busca en un lugar distinto cuando falta. Un
          total único escondería que hay $300 en Zelle y CERO en la gaveta, que
          es justo lo que hay que saber antes de pagar algo en efectivo. */}
      <SectionTitle>💵 Cuánto dinero hay</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {tarjetas.map((t) => (
          <Card key={t.key} style={{ flexGrow: 1, flexBasis: '46%', minWidth: 150 }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>
              {t.icon} {t.label.toUpperCase()}
            </Text>
            <Text style={{ color: t.disponible > 0 ? colors.text : colors.muted, fontWeight: '900', fontSize: 19, marginTop: 2 }}>
              {t.moneda === 'bs' ? fmtBs(t.disponible) : fmtUsd(t.disponible)}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 2 }}>
              {t.hubo
                ? `${t.apertura ? `fondo ${t.moneda === 'bs' ? fmtBs(t.apertura) : fmtUsd(t.apertura)} · ` : ''}entró ${t.moneda === 'bs' ? fmtBs(t.ingresos) : fmtUsd(t.ingresos)}${t.egresos ? ` · salió ${t.moneda === 'bs' ? fmtBs(t.egresos) : fmtUsd(t.egresos)}` : ''}`
                : 'sin movimientos'}
            </Text>
          </Card>
        ))}
      </View>
      <Card style={{ marginTop: spacing.sm, borderLeftWidth: 4, borderLeftColor: colors.brand }}>
        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>EN TOTAL HAY</Text>
        <Text style={{ color: colors.text, fontWeight: '900', fontSize: 20, marginTop: 2 }}>
          {fmtUsd(total.usd)}{total.bs ? ` + ${fmtBs(total.bs)}` : ''}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 2 }}>
          {/* ⚠️ La conversión es una REFERENCIA, no un arqueo: el arqueo sigue
              siendo método por método en su propia moneda. */}
          {total.tasa
            ? `≈ ${fmtUsd(total.totalUsd)} a la tasa de hoy (${fmtBs(total.tasa)}/$) · es una referencia, el arqueo va moneda por moneda`
            : 'Sin tasa BCV de hoy: los bolívares no se convierten para no inventar un número.'}
        </Text>
      </Card>

      {/* ── 💰 LO QUE ENTRÓ POR VENTAS ────────────────────────────────────
          Pedido del cliente (24-sep-2026): «se verán las entradas de dinero que
          vengan de las ventas». Acá NO entra nada de otro lado: el contado entra
          el día de la venta y el crédito el día que se cobra el abono. */}
      <SectionTitle>💰 Entradas por ventas</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Ventas de contado</Text>
            <Text style={{ color: colors.success, fontWeight: '900', fontSize: 16 }}>{fmtUsd(entradas.ventasUsd)}</Text>
            <Text style={{ color: colors.muted, fontSize: 10.5 }}>{entradas.ventas} venta(s)</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Cobros de crédito</Text>
            <Text style={{ color: colors.success, fontWeight: '900', fontSize: 16 }}>{fmtUsd(entradas.cobrosUsd)}</Text>
            <Text style={{ color: colors.muted, fontSize: 10.5 }}>{entradas.cobros} cobro(s)</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Total entrado</Text>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>{fmtUsd(entradas.totalUsd)}</Text>
            <Text style={{ color: colors.muted, fontSize: 10.5 }}>{fmtBs(entradas.totalBs)}</Text>
          </View>
        </View>
        {porMetodoEntradas.length ? (
          <>
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.sm }} />
            {porMetodoEntradas.map((e) => (
              <View key={e.metodo} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
                <Text style={{ color: colors.text, fontSize: 12.5, flex: 1 }}>{metodoLabel(e.metodo)}</Text>
                <Text style={{ color: colors.muted, fontSize: 11, marginRight: spacing.sm }}>{e.veces}×</Text>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5 }}>{fmtMetodo(e.metodo, e.nativo)}</Text>
              </View>
            ))}
          </>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: spacing.sm }}>
            Todavía no ha entrado plata por ventas en esta caja. Entra sola: al cobrar una venta de
            contado en 💰 Ventas o 🧰 Ventas de servicio, y al registrar un abono de una venta a
            crédito en 💲 Cuentas.
          </Text>
        )}
      </Card>

      {/* Saldo esperado por método */}
      <SectionTitle>Saldo por método</SectionTitle>
      <Card>
        {esperado.map((e, i) => (
          <View key={e.metodo} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{metodoLabel(e.metodo)}</Text>
              <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                {e.apertura ? `fondo ${fmtMetodo(e.metodo, e.apertura)} · ` : ''}
                entró {fmtMetodo(e.metodo, e.ingresos)}{e.egresos ? ` · salió ${fmtMetodo(e.metodo, e.egresos)}` : ''}
              </Text>
            </View>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13.5 }}>{fmtMetodo(e.metodo, e.esperado)}</Text>
          </View>
        ))}
        <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: spacing.sm }}>
          Cada método se cuadra en su propia moneda: el efectivo en $ se cuenta en $; bolívares, pago móvil y transferencia se cuadran en Bs contra el banco.
        </Text>
      </Card>

      {/* Acciones */}
      {canWrite ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <TouchableOpacity onPress={() => { limpiarEgreso(); setEgOpen(true); }} activeOpacity={0.85}
            style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>➖ Registrar egreso</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setConteo({}); setCerrarOpen(true); }} activeOpacity={0.85}
            style={{ flex: 1, backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13 }}>🔒 Cerrar caja</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: spacing.sm, textAlign: 'center' }}>
        No hay botón para agregar un ingreso: todo lo que entra viene de Ventas (contado al vender, crédito al cobrar el abono).
      </Text>

      {/* Movimientos de la sesión */}
      <SectionTitle>Movimientos de esta caja</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {([
            { key: 'todo' as const, label: `Todo (${deLaCaja.length})` },
            { key: 'venta' as const, label: `💰 Ventas (${entradas.ventas})` },
            { key: 'cobranza' as const, label: `🧾 Cobros (${entradas.cobros})` },
            { key: 'egreso' as const, label: `➖ Egresos (${deLaCaja.filter((m) => m.tipo === 'egreso').length})` },
          ]).map((p) => {
            const on = verMovs === p.key;
            return (
              <TouchableOpacity
                key={p.key} onPress={() => setVerMovs(p.key)}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}
              >
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
      {movsVistos.length === 0 ? (
        <EmptyState
          title={verMovs === 'todo' ? 'Todavía no se ha movido nada' : 'Nada por acá'}
          subtitle={verMovs === 'egreso' ? 'No se ha registrado ningún egreso.' : 'Las ventas de contado y los cobros entran solos.'}
        />
      ) : movsVistos.map((m) => (
        <Card key={m.id} style={{ marginBottom: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
            <Text style={{ fontSize: 17 }}>{m.tipo === 'ingreso' ? (m.origen === 'cobranza' ? '🧾' : '💰') : '➖'}</Text>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{m.concepto}</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 1 }}>
                {dmy(m.fecha)} · {metodoLabel(m.metodo)}{m.categoria ? ` · ${m.categoria}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: m.tipo === 'ingreso' ? colors.success : colors.danger, fontWeight: '900', fontSize: 14 }}>
                {m.tipo === 'ingreso' ? '+' : '−'}{fmtUsd(m.monto)}
              </Text>
              {MONEDA_METODO[m.metodo] === 'bs' ? (
                <Text style={{ color: colors.muted, fontSize: 10.5 }}>{fmtBs(m.monto_bs)}</Text>
              ) : null}
            </View>
            {canWrite && m.tipo === 'egreso' ? (
              <TouchableOpacity onPress={() => borrarEgreso(m)} style={{ paddingLeft: spacing.xs }}>
                <Text style={{ color: colors.danger, fontSize: 15 }}>🗑</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </Card>
      ))}

      {/* ── Modal: egreso ── */}
      <Modal visible={egOpen} transparent animationType="slide" onRequestClose={() => setEgOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '92%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              <SectionTitle>➖ Registrar egreso</SectionTitle>

              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>¿EN QUÉ SE GASTÓ?</Text>
              <TextInput value={egConcepto} onChangeText={setEgConcepto} placeholder="Tornillos y tacos para el taller"
                placeholderTextColor={colors.muted} style={{ ...input, marginTop: 3 }} />

              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.md }}>CATEGORÍA</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                {cats.filter((c) => c.active).map((c) => {
                  const on = norm(c.name) === norm(egCategoria);
                  return (
                    <TouchableOpacity key={c.id} onPress={() => setEgCategoria(on ? '' : c.name)} activeOpacity={0.7}
                      style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>
                        {c.icon ? `${c.icon} ` : ''}{c.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.md }}>¿CON QUÉ SE PAGÓ?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                {METODOS_PAGO.map((m) => {
                  const on = m.key === egMetodo;
                  return (
                    <TouchableOpacity key={m.key} onPress={() => setEgMetodo(m.key)} activeOpacity={0.7}
                      style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{m.icon} {m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.md }}>MONTO EN DÓLARES</Text>
              <TextInput value={egMonto} onChangeText={setEgMonto} keyboardType="numeric" placeholder="$ 0,00"
                placeholderTextColor={colors.muted} style={{ ...input, marginTop: 3 }} />
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>
                {money(rate) > 0 ? `Equivale a ${fmtBs(money(egMonto) * money(rate))} (tasa ${fmtBs(rate)} / $)`
                  : 'Sin tasa BCV registrada: el equivalente en Bs quedará en cero.'}
              </Text>

              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.md }}>FECHA</Text>
              <DateField value={egFecha} onChange={setEgFecha} />

              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.md }}>NOTA (OPCIONAL)</Text>
              <TextInput value={egNota} onChangeText={setEgNota} placeholder="Nº de factura, a quién se le pagó…"
                placeholderTextColor={colors.muted} style={{ ...input, marginTop: 3 }} />

              {egError ? (
                <TouchableOpacity activeOpacity={0.85} onPress={() => setEgError(null)}
                  style={{ marginTop: spacing.md, backgroundColor: colors.dangerSoftBg, borderWidth: 1, borderColor: colors.dangerSoftBorder, borderRadius: radius.md, padding: spacing.sm }}>
                  <Text style={{ color: colors.dangerSoftText, fontWeight: '800', fontSize: 12.5 }}>⚠️ No se pudo guardar</Text>
                  <Text style={{ color: colors.dangerSoftText, fontSize: 12, marginTop: 2 }}>{egError}</Text>
                </TouchableOpacity>
              ) : null}

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                <TouchableOpacity onPress={() => setEgOpen(false)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={busy} onPress={guardarEgreso} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                  <Text style={{ color: colors.brandContrast, fontWeight: '900' }}>{busy ? 'Guardando…' : '💾 Guardar'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Modal: cierre con arqueo ── */}
      <Modal visible={cerrarOpen} transparent animationType="slide" onRequestClose={() => setCerrarOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '92%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              <SectionTitle>🔒 Cerrar caja · arqueo</SectionTitle>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
                Cuenta lo que hay y escríbelo. Lo que dejes vacío sale como «sin contar», no como faltante.
              </Text>

              {lineas.map((l) => (
                <View key={l.metodo} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs, backgroundColor: colors.surface }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{metodoLabel(l.metodo)}</Text>
                      <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                        Esperado {fmtMetodo(l.metodo, l.esperado)} · {esEfectivo(l.metodo) ? 'cuenta el efectivo' : 'cuadra contra el banco'}
                      </Text>
                    </View>
                    <TextInput
                      value={conteo[l.metodo] ?? ''} keyboardType="numeric"
                      placeholder={MONEDA_METODO[l.metodo] === 'bs' ? 'Bs' : '$'}
                      placeholderTextColor={colors.muted}
                      onChangeText={(v) => setConteo((p) => ({ ...p, [l.metodo]: v }))}
                      style={{ width: 108, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, textAlign: 'right' }}
                    />
                  </View>
                  <Text style={{
                    marginTop: 4, fontSize: 12, fontWeight: '800',
                    color: !l.seConto ? colors.muted : l.diferencia === 0 ? colors.success : l.diferencia > 0 ? colors.warning ?? colors.text : colors.danger,
                  }}>
                    {!l.seConto ? 'Sin contar'
                      : l.diferencia === 0 ? '✓ Cuadra'
                      : l.diferencia > 0 ? `Sobra ${fmtMetodo(l.metodo, l.diferencia)}`
                      : `Falta ${fmtMetodo(l.metodo, Math.abs(l.diferencia))}`}
                  </Text>
                </View>
              ))}

              {sinContar.length ? (
                <View style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: colors.warning ?? colors.brand, borderRadius: radius.md, padding: spacing.sm }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5 }}>
                    {sinContar.length} método(s) sin contar
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>
                    {sinContar.map((l) => metodoLabel(l.metodo)).join(', ')}. En el acta saldrán como «sin contar», NO como faltante. Puedes cerrar igual.
                  </Text>
                </View>
              ) : null}

              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.md }}>NOTA DEL CIERRE (OPCIONAL)</Text>
              <TextInput value={notaCierre} onChangeText={setNotaCierre} multiline
                placeholder="Explica cualquier diferencia" placeholderTextColor={colors.muted}
                style={{ ...input, marginTop: 3, minHeight: 66, textAlignVertical: 'top' }} />

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                <TouchableOpacity onPress={() => setCerrarOpen(false)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={busy} onPress={cerrarCaja} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                  <Text style={{ color: colors.brandContrast, fontWeight: '900' }}>{busy ? 'Cerrando…' : '🔒 Cerrar y emitir acta'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ============================================================================
// PESTAÑA 2 · HISTORIAL DE MOVIMIENTOS
// ============================================================================
function MovimientosTab() {
  const { colors } = useTheme();
  const { data: movs, loading } = useTable<Mov>('caja_movimientos', {
    orderBy: 'fecha', ascending: false, realtimeFrom: 'caja_movimientos',
  });

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [tipo, setTipo] = useState<TipoMov | ''>('');
  const [origen, setOrigen] = useState<OrigenMov | ''>('');
  const [metodo, setMetodo] = useState<MetodoPago | ''>('');
  const [texto, setTexto] = useState('');

  const filtrados = useMemo(
    () => filtrarMovs(movs, { desde, hasta, tipo, origen, metodo, texto }),
    [movs, desde, hasta, tipo, origen, metodo, texto]
  );
  const r = useMemo(() => resumenCaja(filtrados), [filtrados]);
  const cats = useMemo(() => porCategoria(filtrados), [filtrados]);
  const ent = useMemo(() => resumenEntradas(filtrados), [filtrados]);
  const porMetodo = useMemo(() => totalesPorMetodo(filtrados), [filtrados]);

  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 14,
  };
  const Chip = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{ paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 11.5, fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );

  if (loading) return <SkeletonList />;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md }}>
      <TextInput value={texto} onChangeText={setTexto} placeholder="🔎 Concepto, cliente, categoría, método, fecha…"
        placeholderTextColor={colors.muted} style={input} />

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}><DateField value={desde} onChange={setDesde} placeholder="Desde" /></View>
        <View style={{ flex: 1 }}><DateField value={hasta} onChange={setHasta} placeholder="Hasta" /></View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
        <Chip on={tipo === ''} label="Todo" onPress={() => setTipo('')} />
        <Chip on={tipo === 'ingreso'} label="Entradas" onPress={() => setTipo('ingreso')} />
        <Chip on={tipo === 'egreso'} label="Salidas" onPress={() => setTipo('egreso')} />
        <Chip on={origen === 'venta'} label="De ventas" onPress={() => setOrigen(origen === 'venta' ? '' : 'venta')} />
        <Chip on={origen === 'cobranza'} label="De cobros" onPress={() => setOrigen(origen === 'cobranza' ? '' : 'cobranza')} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
        {METODOS_PAGO.map((m) => (
          <Chip key={m.key} on={metodo === m.key} label={`${m.icon} ${m.label}`} onPress={() => setMetodo(metodo === m.key ? '' : m.key)} />
        ))}
      </View>

      <Card style={{ marginTop: spacing.md }}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {r.movimientos} movimiento(s) · entró {fmtUsd(r.ingresos)} · salió {fmtUsd(r.egresos)}
        </Text>
        <Text style={{ color: colors.text, fontWeight: '900', fontSize: 20, marginTop: 2 }}>{fmtUsd(r.saldo)}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtBs(r.saldoBs)}</Text>

        {/* 💰 DE DÓNDE VINO LA PLATA. Acá solo hay dos fuentes posibles: una
            venta de contado o el cobro de una venta a crédito. Verlo separado
            dice si el día se hizo vendiendo o cobrando lo viejo. */}
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.sm }} />
        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>ENTRADAS POR VENTAS</Text>
        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: 3 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 10.5 }}>Ventas de contado ({ent.ventas})</Text>
            <Text style={{ color: colors.success, fontWeight: '900', fontSize: 14 }}>{fmtUsd(ent.ventasUsd)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 10.5 }}>Cobros de crédito ({ent.cobros})</Text>
            <Text style={{ color: colors.success, fontWeight: '900', fontSize: 14 }}>{fmtUsd(ent.cobrosUsd)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 10.5 }}>Total</Text>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>{fmtUsd(ent.totalUsd)}</Text>
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.sm }} />
        {porMetodo.filter((t) => t.ingresos || t.egresos).map((t) => (
          <View key={t.metodo} style={{ flexDirection: 'row', paddingVertical: 3 }}>
            <Text style={{ flex: 1, color: colors.muted, fontSize: 11.5 }}>{metodoLabel(t.metodo)}</Text>
            <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '800' }}>{fmtMetodo(t.metodo, t.neto)}</Text>
          </View>
        ))}
        {cats.length ? (
          <>
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.sm }} />
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>EGRESOS POR CATEGORÍA</Text>
            {cats.map((c) => (
              <View key={c.categoria} style={{ flexDirection: 'row', paddingVertical: 3 }}>
                <Text style={{ flex: 1, color: colors.muted, fontSize: 11.5 }}>{c.categoria} ({c.veces})</Text>
                <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '800' }}>{fmtUsd(c.usd)}</Text>
              </View>
            ))}
          </>
        ) : null}
      </Card>

      <SectionTitle>Movimientos</SectionTitle>
      {filtrados.length === 0 ? (
        <EmptyState title="Nada con esos filtros" subtitle="Prueba ampliando el rango de fechas." />
      ) : filtrados.map((m) => (
        <Card key={m.id} style={{ marginBottom: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
            <Text style={{ fontSize: 17 }}>{m.tipo === 'ingreso' ? (m.origen === 'cobranza' ? '🧾' : '💰') : '➖'}</Text>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{m.concepto}</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 1 }}>
                {dmy(m.fecha)} · {ORIGEN_LABEL[m.origen]} · {metodoLabel(m.metodo)}{m.categoria ? ` · ${m.categoria}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: m.tipo === 'ingreso' ? colors.success : colors.danger, fontWeight: '900', fontSize: 14 }}>
                {m.tipo === 'ingreso' ? '+' : '−'}{fmtUsd(m.monto)}
              </Text>
              {MONEDA_METODO[m.metodo] === 'bs' ? (
                <Text style={{ color: colors.muted, fontSize: 10.5 }}>{fmtBs(m.monto_bs)}</Text>
              ) : null}
            </View>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

// ============================================================================
// PESTAÑA 3 · CIERRES
// ============================================================================
function CierresTab() {
  const { colors } = useTheme();
  const toast = useToast();
  const { data: sesiones, loading } = useTable<Sesion>('caja_sesiones', {
    orderBy: 'opened_at', ascending: false, realtimeFrom: 'caja_sesiones',
  });
  const { data: movs } = useTable<Mov>('caja_movimientos', { orderBy: 'fecha', realtimeFrom: 'caja_movimientos' });
  const [busy, setBusy] = useState(false);

  const cerradas = useMemo(() => sesiones.filter((s) => s.estado === 'cerrada'), [sesiones]);

  const reimprimir = async (s: Sesion) => {
    setBusy(true);
    try {
      await exportPdf(actaCierreHtml({
        sesion: s, movimientos: movs.filter((m) => m.sesion_id === s.id),
        conteo: s.conteo, empresa: COMPANY_NAME, conDetalle: true,
      }), `Acta de cierre ${s.code ?? ''}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo generar el acta.');
    } finally { setBusy(false); }
  };

  if (loading) return <SkeletonList />;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md }}>
      {cerradas.length === 0 ? (
        <EmptyState title="Todavía no se ha cerrado ninguna caja" subtitle="Al cerrar, el acta queda acá para reimprimir." />
      ) : cerradas.map((s) => {
        const suyos = movs.filter((m) => m.sesion_id === s.id);
        const r = resumenCaja(suyos);
        const lineas: LineaArqueo[] = arqueoDe(s, suyos, s.conteo);
        const descuadre = lineas.filter((l) => l.seConto && l.diferencia !== 0);
        return (
          <Card key={s.id} style={{ marginBottom: spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>{s.code}</Text>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 1 }}>
                  {String(s.opened_at ?? '').slice(0, 10).split('-').reverse().join('/')} · cerró {s.closed_by_name || '—'}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {r.movimientos} movimiento(s) · saldo {fmtUsd(r.saldo)}
                </Text>
                {descuadre.length ? (
                  <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '800', marginTop: 2 }}>
                    ⚠️ Descuadre en {descuadre.map((l) => metodoLabel(l.metodo)).join(', ')}
                  </Text>
                ) : (
                  <Text style={{ color: colors.success, fontSize: 11, fontWeight: '800', marginTop: 2 }}>✓ Cuadró</Text>
                )}
              </View>
              <TouchableOpacity disabled={busy} onPress={() => reimprimir(s)}
                style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.brand, fontWeight: '800', fontSize: 12 }}>📄 Acta</Text>
              </TouchableOpacity>
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}

// ============================================================================
// PESTAÑA 4 · CATEGORÍAS DE EGRESO
// ============================================================================
function CategoriasTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const toast = useToast();
  const { data: cats, loading, refetch } = useTable<Categoria>('caja_categorias', {
    orderBy: 'name', realtimeFrom: 'caja_categorias',
  });
  const [nueva, setNueva] = useState('');
  const [busy, setBusy] = useState(false);

  const crear = async () => {
    const name = nueva.trim();
    if (!name) return;
    if (cats.some((c) => norm(c.name) === norm(name))) return toast.error('Esa categoría ya existe.');
    setBusy(true);
    try {
      const { error } = await supabase.from('caja_categorias').insert({ name });
      if (error) return toast.error(error.message);
      setNueva(''); refetch();
      toast.success('Categoría agregada.');
    } finally { setBusy(false); }
  };

  // «Borrar» = desactivar. Un egreso viejo no puede quedarse sin nombre porque
  // alguien limpió el catálogo.
  const alternar = async (c: Categoria) => {
    const { error } = await supabase.from('caja_categorias').update({ active: !c.active }).eq('id', c.id);
    if (error) return toast.error(error.message);
    refetch();
  };

  if (loading) return <SkeletonList />;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md }}>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Con qué se clasifica cada egreso. Desactivar una no toca los egresos ya cargados: conservan su nombre.
      </Text>

      {canWrite ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TextInput value={nueva} onChangeText={setNueva} placeholder="Nueva categoría" placeholderTextColor={colors.muted}
            style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          <TouchableOpacity disabled={busy} onPress={crear}
            style={{ paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.brand, opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '900' }}>Agregar</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <SectionTitle>Categorías</SectionTitle>
      {cats.map((c) => (
        <Card key={c.id} style={{ marginBottom: spacing.xs, opacity: c.active ? 1 : 0.5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ fontSize: 17 }}>{c.icon || '🏷️'}</Text>
            <Text style={{ flex: 1, color: colors.text, fontWeight: '700', fontSize: 13 }}>{c.name}</Text>
            {canWrite ? (
              <TouchableOpacity onPress={() => alternar(c)}>
                <Text style={{ color: c.active ? colors.danger : colors.success, fontWeight: '800', fontSize: 12 }}>
                  {c.active ? 'Desactivar' : 'Activar'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

// ============================================================================
// PANTALLA
// ============================================================================
const TABS = [
  { key: 'caja', label: 'Caja', icon: '💵' },
  { key: 'movimientos', label: 'Movimientos', icon: '📜' },
  { key: 'cierres', label: 'Cierres', icon: '📁' },
  { key: 'categorias', label: 'Categorías', icon: '🏷️' },
];

export default function CajaScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const canWrite = levelMeets(moduleLevel('caja'), 'escritura');
  const [active, setActive] = useState('caja');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.sm }}>
          {TABS.map((t) => {
            const on = t.key === active;
            return (
              <TouchableOpacity key={t.key} onPress={() => setActive(t.key)} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt }}>
                <Text style={{ fontSize: 15 }}>{t.icon}</Text>
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ flex: 1 }}>
        {active === 'caja' ? <CajaTab canWrite={canWrite} />
          : active === 'movimientos' ? <MovimientosTab />
          : active === 'cierres' ? <CierresTab />
          : <CategoriasTab canWrite={canWrite} />}
      </View>
    </View>
  );
}
