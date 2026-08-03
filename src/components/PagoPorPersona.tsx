import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Alert } from 'react-native';
import { Card, EmptyState, Loading } from './ui';
import { DateField } from './DateField';
import { supabase } from '../lib/supabase';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { onlyDecimal, norm, cmpText } from '../lib/text';
import { canonicalCargo } from '../lib/cargos';
import { useTable } from '../hooks/useTable';
import { useBcvRate, bsFromUsd, usdFromBs, fmtBs } from '../lib/bcv';
import { Employee, StaffPersonPayment } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { caracasParts } from '../lib/jornada';

// ── Utilidades ────────────────────────────────────────────────────────────────
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const usd = (n: number) => `$${round2(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Convierte texto a número aceptando AMBOS formatos: "199.99" (punto decimal, como
// lo genera el monto sugerido) y "28,57" o "19.999,00" (coma decimal estilo VE). Toma
// el ÚLTIMO separador (. o ,) como decimal y el resto como miles. Antes borraba todos
// los puntos y "199.99" se guardaba como 19999 (monto ×100 mal).
const parseNum = (t: string): number => {
  const s = String(t ?? '').trim().replace(/[^0-9.,\-]/g, '');
  if (!s) return 0;
  const dec = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (dec === -1) { const n = Number(s); return isFinite(n) ? n : 0; }
  const intPart = s.slice(0, dec).replace(/[.,]/g, '');
  const fracPart = s.slice(dec + 1).replace(/[.,]/g, '');
  const n = Number(`${intPart}.${fracPart}`);
  return isFinite(n) ? n : 0;
};
const fmtDMY = (iso?: string | null) => { const [y, m, d] = String(iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };
// Fecha de hoy en Caracas, independiente de la zona horaria del dispositivo.
const todayISO = () => caracasParts(new Date()).iso;
const addDaysISO = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`; };
const fullName = (e: Employee) => `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim();
/** Rango de días que abarca por defecto cada frecuencia (para sugerir el "Hasta"). */
const spanDias = (f: Frecuencia) => (f === 'semanal' ? 6 : f === 'quincenal' ? 14 : f === 'mensual' ? 29 : 0);
/** Texto del rango de fechas de un pago: "11/07 → 17/07" (o solo la fecha si no hay rango). */
const rangoFecha = (p: StaffPersonPayment) => (p.fecha_hasta && p.fecha_hasta !== p.fecha ? `${fmtDMY(p.fecha)} → ${fmtDMY(p.fecha_hasta)}` : fmtDMY(p.fecha));

type Frecuencia = StaffPersonPayment['frecuencia'];
type Jornada = 'dia' | 'noche';
const FRECS: { key: Frecuencia; label: string }[] = [
  { key: 'diario', label: 'Diario' }, { key: 'semanal', label: 'Semanal' },
  { key: 'quincenal', label: 'Quincenal' }, { key: 'mensual', label: 'Mensual' },
];
const FREC_LABEL: Record<Frecuencia, string> = { diario: 'Diario', semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' };
const METODOS = ['efectivo', 'pago móvil', 'transferencia', 'otro'];

/** Tarifa unitaria del empleado según la frecuencia (y jornada, si es diario). */
function tarifaFor(e: Employee, frec: Frecuencia, jornada: Jornada): number {
  if (frec === 'diario') return Number(jornada === 'noche' ? e.precio_noche : e.precio_dia) || 0;
  if (frec === 'semanal') return Number(e.precio_semana) || 0;
  if (frec === 'quincenal') return Number(e.precio_quincena) || 0;
  return Number(e.precio_mes) || 0; // mensual
}
/** Día/noche de un movimiento "diario" (con respaldo a los pagos viejos de jornada única). */
function dayNight(p: StaffPersonPayment) {
  const dc = Number(p.cantidad_dia) || (p.jornada !== 'noche' ? Number(p.cantidad) || 0 : 0);
  const nc = Number(p.cantidad_noche) || (p.jornada === 'noche' ? Number(p.cantidad) || 0 : 0);
  const dp = Number(p.precio_dia) || (p.jornada !== 'noche' ? Number(p.precio_unit) || 0 : 0);
  const np = Number(p.precio_noche) || (p.jornada === 'noche' ? Number(p.precio_unit) || 0 : 0);
  return { dc, nc, dp, np };
}
/** Texto legible: "Diario · ☀️ 3 × $45 · 🌙 2 × $50" o "Semanal · 1 × $200". */
function detalle(p: StaffPersonPayment): string {
  if (p.frecuencia === 'diario') {
    const { dc, nc, dp, np } = dayNight(p);
    const parts: string[] = [];
    if (dc) parts.push(`☀️ ${dc} × ${usd(dp)}`);
    if (nc) parts.push(`🌙 ${nc} × ${usd(np)}`);
    return `Diario · ${parts.join(' · ') || '—'}`;
  }
  return `${FREC_LABEL[p.frecuencia]} · ${Number(p.cantidad) || 0} × ${usd(p.precio_unit)}`;
}

export function PagoPorPersona({ canEdit }: { canEdit: boolean }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const confirm = useConfirm();
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const { data: employees, loading: empLoading } = useTable<Employee>('employees', { orderBy: 'first_name' });
  const { data: pays, loading: payLoading, refetch: refetchPays } = useTable<StaffPersonPayment>('staff_payments', { orderBy: 'fecha', ascending: false });
  const { rate: bcvRate } = useBcvRate();
  // Bs equivalente de un monto en US$ (o '' si no hay tasa del día).
  const bsTxt = (usdAmount: number) => (bcvRate ? fmtBs(bsFromUsd(usdAmount, bcvRate)) : '');

  const [q, setQ] = useState('');
  const [soloActivos, setSoloActivos] = useState(true);

  // Empleados filtrados por búsqueda + estado, ordenados A→Z.
  const shown = useMemo(() => {
    const nq = norm(q);
    return employees
      // Estado "otro" = NO entra al control de pago: se excluye siempre (aun en "Todos").
      .filter((e) => (e.status || '').toLowerCase() !== 'otro')
      .filter((e) => (!soloActivos || e.status === 'activo'))
      .filter((e) => !nq || norm(fullName(e)).includes(nq) || norm(e.cedula).includes(nq) || norm(e.cargo).includes(nq) || norm(e.ficha_number).includes(nq))
      .sort((a, b) => cmpText(fullName(a), fullName(b)));
  }, [employees, q, soloActivos]);

  // Movimientos por empleado (por id; respaldo por cédula).
  const paysOf = (e: Employee) => pays.filter((p) => (p.employee_id ? p.employee_id === e.id : norm(p.cedula) === norm(e.cedula)));
  const totalOf = (e: Employee) => round2(paysOf(e).reduce((s, p) => s + (Number(p.monto) || 0), 0));

  // ── Ficha de persona ─────────────────────────────────────────────────────────
  const [sel, setSel] = useState<Employee | null>(null);
  const selPays = sel ? paysOf(sel).slice().sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)) : [];
  const selTotal = round2(selPays.reduce((s, p) => s + (Number(p.monto) || 0), 0));

  // ── Generar / editar movimiento ────────────────────────────────────────────
  const [payOpen, setPayOpen] = useState(false);
  const [editing, setEditing] = useState<StaffPersonPayment | null>(null);
  const [fFecha, setFFecha] = useState(todayISO());   // Desde / fecha del pago
  const [fHasta, setFHasta] = useState(todayISO());   // Hasta (fin del período que cubre)
  const [fFrec, setFFrec] = useState<Frecuencia>('diario');
  // "Diario": día y noche JUNTOS.
  const [fDiaCant, setFDiaCant] = useState('1');
  const [fDiaPrecio, setFDiaPrecio] = useState('0');
  const [fNocheCant, setFNocheCant] = useState('0');
  const [fNochePrecio, setFNochePrecio] = useState('0');
  // Semanal/quincenal/mensual: cantidad × precio único.
  const [fCant, setFCant] = useState('1');
  const [fPrecio, setFPrecio] = useState('0');
  const [fMonto, setFMonto] = useState('0');
  const [montoTocado, setMontoTocado] = useState(false);
  // Moneda en la que se muestra/edita el campo "Monto": US$ (por defecto) o Bs (tasa BCV
  // del día). El monto SIEMPRE se guarda en US$; al escribir en Bs se convierte con
  // usdFromBs() al vuelo.
  const [montoCur, setMontoCur] = useState<'USD' | 'VES'>('USD');
  // Fija el monto SUGERIDO (cantidad × precio, calculado en US$) respetando la moneda activa.
  const setMontoFromUsd = (usdValue: number) => setFMonto(String(round2(montoCur === 'USD' ? usdValue : bsFromUsd(usdValue, bcvRate || 0))));
  const [fMetodo, setFMetodo] = useState('efectivo');
  const [fConcepto, setFConcepto] = useState('');
  const [fNota, setFNota] = useState('');
  const [saving, setSaving] = useState(false);

  const recalcSimple = (cant: string, precio: string) => { if (!montoTocado) setMontoFromUsd(parseNum(cant) * parseNum(precio)); };
  const recalcDiario = (dc: string, dp: string, nc: string, np: string) => { if (!montoTocado) setMontoFromUsd(parseNum(dc) * parseNum(dp) + parseNum(nc) * parseNum(np)); };

  // Nº de días que abarca el rango Desde→Hasta (inclusive). En "diario", día+noche
  // no puede pasar de este total (7 jornadas si el rango es de 7 días).
  const diasRango = useMemo(() => {
    const a = new Date(`${fFecha}T12:00:00`).getTime();
    const b = new Date(`${fHasta}T12:00:00`).getTime();
    if (!isFinite(a) || !isFinite(b) || b < a) return 1;
    return Math.round((b - a) / 86400000) + 1;
  }, [fFecha, fHasta]);
  // Fija la cantidad de día/noche respetando el tope (día+noche ≤ díasRango).
  const setDiaCant = (raw: string) => {
    const otras = parseNum(fNocheCant);
    let v = parseNum(onlyDecimal(raw));
    const max = Math.max(0, diasRango - otras);
    if (v > max) v = max;
    const s = String(v); setFDiaCant(s); recalcDiario(s, fDiaPrecio, fNocheCant, fNochePrecio);
  };
  const setNocheCant = (raw: string) => {
    const otras = parseNum(fDiaCant);
    let v = parseNum(onlyDecimal(raw));
    const max = Math.max(0, diasRango - otras);
    if (v > max) v = max;
    const s = String(v); setFNocheCant(s); recalcDiario(fDiaCant, fDiaPrecio, s, fNochePrecio);
  };
  // Aplica un rango Desde→Hasta y recorta día/noche para que no pasen del total de días.
  const aplicarRango = (desde: string, hasta: string) => {
    setFFecha(desde); setFHasta(hasta);
    const a = new Date(`${desde}T12:00:00`).getTime(), b = new Date(`${hasta}T12:00:00`).getTime();
    const nd = (!isFinite(a) || !isFinite(b) || b < a) ? 1 : Math.round((b - a) / 86400000) + 1;
    let d = parseNum(fDiaCant), n = parseNum(fNocheCant);
    if (d > nd) d = nd;
    if (d + n > nd) n = Math.max(0, nd - d);
    setFDiaCant(String(d)); setFNocheCant(String(n));
    if (!montoTocado) setMontoFromUsd(d * parseNum(fDiaPrecio) + n * parseNum(fNochePrecio));
  };

  const abrirNuevo = () => {
    if (!sel) return;
    // Recuerda las cantidades día/noche del ÚLTIMO pago diario de la persona.
    const last = paysOf(sel).filter((p) => p.frecuencia === 'diario').sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0];
    const dp = String(sel.precio_dia || 0), np = String(sel.precio_noche || 0);
    const tieneUlt = last && (Number(last.cantidad_dia) || Number(last.cantidad_noche));
    const dc = tieneUlt ? String(Number(last.cantidad_dia) || 0) : '1';
    const nc = tieneUlt ? String(Number(last.cantidad_noche) || 0) : '0';
    setEditing(null); setFFecha(todayISO()); setFHasta(todayISO()); setFFrec('diario'); setMontoCur('USD');
    setFDiaCant(dc); setFDiaPrecio(dp); setFNocheCant(nc); setFNochePrecio(np);
    setFCant('1'); setFPrecio(dp); setFMonto(String(round2(parseNum(dc) * parseNum(dp) + parseNum(nc) * parseNum(np)))); setMontoTocado(false);
    setFMetodo('efectivo'); setFConcepto(''); setFNota(''); setPayOpen(true);
  };
  const abrirEditar = (p: StaffPersonPayment) => {
    setEditing(p); setFFecha(p.fecha); setFHasta(p.fecha_hasta || p.fecha); setFFrec(p.frecuencia); setMontoCur('USD');
    const { dc, nc, dp, np } = dayNight(p);
    setFDiaCant(String(dc)); setFDiaPrecio(String(dp || sel?.precio_dia || 0)); setFNocheCant(String(nc)); setFNochePrecio(String(np || sel?.precio_noche || 0));
    setFCant(String(p.cantidad)); setFPrecio(String(p.precio_unit)); setFMonto(String(p.monto)); setMontoTocado(true);
    setFMetodo(p.metodo || 'efectivo'); setFConcepto(p.concepto || ''); setFNota(p.nota || ''); setPayOpen(true);
  };
  const cambiarFrec = (frec: Frecuencia) => {
    setFFrec(frec);
    aplicarRango(fFecha, addDaysISO(fFecha, spanDias(frec))); // sugiere el "Hasta" y recorta jornadas
    if (!sel) return;
    if (frec === 'diario') {
      const dp = String(sel.precio_dia || 0), np = String(sel.precio_noche || 0);
      setFDiaPrecio(dp); setFNochePrecio(np);
      if (!montoTocado) setMontoFromUsd(parseNum(fDiaCant) * parseNum(dp) + parseNum(fNocheCant) * parseNum(np));
    } else {
      const pr = tarifaFor(sel, frec, 'dia'); setFPrecio(String(pr));
      if (!montoTocado) setMontoFromUsd(parseNum(fCant) * pr);
    }
  };

  const guardar = async () => {
    if (!sel) return;
    // El monto siempre se guarda en US$: si el campo está en Bs, se convierte con la tasa BCV.
    const monto = round2(montoCur === 'USD' ? parseNum(fMonto) : usdFromBs(parseNum(fMonto), bcvRate || 0));
    if (monto <= 0) { Alert.alert('Monto', 'Indica un monto mayor a 0.'); return; }
    const esDiario = fFrec === 'diario';
    setSaving(true);
    const row = {
      employee_id: sel.id, cedula: sel.cedula, person_name: fullName(sel), cargo: sel.cargo ? canonicalCargo(sel.cargo) : null,
      fecha: fFecha, fecha_hasta: fHasta && fHasta !== fFecha ? fHasta : null, frecuencia: fFrec, jornada: null,
      cantidad: esDiario ? (parseNum(fDiaCant) + parseNum(fNocheCant)) : (parseNum(fCant) || 1),
      precio_unit: esDiario ? 0 : parseNum(fPrecio),
      cantidad_dia: esDiario ? parseNum(fDiaCant) : 0, cantidad_noche: esDiario ? parseNum(fNocheCant) : 0,
      precio_dia: esDiario ? parseNum(fDiaPrecio) : 0, precio_noche: esDiario ? parseNum(fNochePrecio) : 0,
      monto,
      metodo: fMetodo, banco: sel.bank_name, cuenta: sel.bank_account,
      concepto: fConcepto.trim() || null, nota: fNota.trim() || null, updated_at: new Date().toISOString(),
    };
    let error;
    if (editing) ({ error } = await supabase.from('staff_payments').update(row).eq('id', editing.id));
    else ({ error } = await supabase.from('staff_payments').insert({ ...row, created_by: session?.user?.id ?? null }));
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setPayOpen(false); await refetchPays();
  };

  const borrar = async (p: StaffPersonPayment) => {
    const ok = await confirm({ title: 'Borrar pago', message: `¿Borrar el pago de ${fmtDMY(p.fecha)} por ${usd(p.monto)}? No se puede deshacer.`, confirmText: 'Borrar', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('staff_payments').delete().eq('id', p.id);
    if (error) { Alert.alert('Error', error.message); return; }
    await refetchPays();
  };

  // ── Recibo (por movimiento) e Histórico (por persona) ──────────────────────
  const datosPersona = (e: Employee) => `
    <table class="kv"><tbody>
      <tr><td class="k">Nombre</td><td>${fullName(e) || '—'}</td><td class="k">Cédula</td><td>${e.cedula || '—'}</td></tr>
      <tr><td class="k">Ficha</td><td>${e.ficha_number || '—'}</td><td class="k">Cargo</td><td>${e.cargo ? canonicalCargo(e.cargo) : '—'}</td></tr>
      <tr><td class="k">Teléfono</td><td>${e.phone || '—'}</td><td class="k">Estado</td><td>${e.status || '—'}</td></tr>
    </tbody></table>`;
  const datosBanco = (e: Employee) => `
    <table class="kv"><tbody>
      <tr><td class="k">Banco</td><td>${e.bank_name || '—'}</td><td class="k">Cuenta</td><td>${e.bank_account || '—'}</td></tr>
      <tr><td class="k">Titular</td><td>${e.bank_holder || fullName(e) || '—'}</td><td class="k">C.I. titular</td><td>${e.bank_cedula || e.cedula || '—'}</td></tr>
    </tbody></table>`;

  const recibo = (e: Employee, p: StaffPersonPayment) => {
    const body = `
      <h3 class="sec">Datos del trabajador</h3>${datosPersona(e)}
      <h3 class="sec">Datos bancarios</h3>${datosBanco(e)}
      <h3 class="sec">Detalle del pago</h3>
      <table class="kv"><tbody>
        <tr><td class="k">Período</td><td>${rangoFecha(p)}</td><td class="k">Frecuencia</td><td>${detalle(p)}</td></tr>
        <tr><td class="k">Método</td><td>${p.metodo || '—'}</td><td class="k">Concepto</td><td>${p.concepto || '—'}</td></tr>
      </tbody></table>
      <div class="monto">MONTO PAGADO: <b>${usd(p.monto)}</b>${bcvRate ? `<br/><span style="font-size:13px">≈ ${fmtBs(bsFromUsd(p.monto, bcvRate))} (tasa BCV ${fmtBs(bcvRate)}/US$)</span>` : ''}</div>
      ${p.nota ? `<div class="nota"><b>Nota:</b> ${p.nota}</div>` : ''}
      <div class="firmas"><div class="firma">Recibí conforme<br/>${fullName(e)}</div><div class="firma">Entregó<br/>SOS LA GUAIRA</div></div>`;
    exportPdf(pdfDocument({ title: 'Recibo de pago', subtitle: `${fullName(e)} · ${fmtDMY(p.fecha)}`, body, extraCss: RECIBO_CSS }), `Recibo - ${fullName(e)} - ${p.fecha}`);
  };

  const historico = (e: Employee) => {
    const list = paysOf(e).slice().sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
    const total = round2(list.reduce((s, p) => s + (Number(p.monto) || 0), 0));
    const rows = list.map((p, i) => `<tr>
      <td class="c">${i + 1}</td><td class="c">${rangoFecha(p)}</td><td>${detalle(p)}</td>
      <td>${p.metodo || '—'}</td><td>${p.concepto || '—'}</td><td class="r">${usd(p.monto)}</td></tr>`).join('');
    const tasaTxt = bcvRate ? ` · Tasa BCV: ${fmtBs(bcvRate)}/US$ · Total ≈ ${fmtBs(bsFromUsd(total, bcvRate))}` : '';
    const body = `
      <h3 class="sec">Datos del trabajador</h3>${datosPersona(e)}
      <h3 class="sec">Datos bancarios</h3>${datosBanco(e)}
      <h3 class="sec">Historial de pagos${tasaTxt}</h3>
      <table class="hist"><thead><tr><th class="c">#</th><th class="c">Período</th><th>Detalle</th><th>Método</th><th>Concepto</th><th class="r">Monto</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">Sin pagos registrados</td></tr>'}</tbody>
        <tfoot><tr><td colspan="5" class="r"><b>TOTAL</b></td><td class="r"><b>${usd(total)}</b></td></tr></tfoot></table>`;
    exportPdf(pdfDocument({ title: 'Histórico de pagos', subtitle: `${fullName(e)} · ${list.length} pago(s)`, body, extraCss: HIST_CSS }), `Histórico - ${fullName(e)}`);
  };

  // ── UI ─────────────────────────────────────────────────────────────────────
  if ((empLoading || payLoading) && employees.length === 0) return <Loading />;

  return (
    <View>
      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar por nombre, cédula, ficha o cargo…" placeholderTextColor={colors.muted} style={input} />
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, marginBottom: spacing.sm }}>
        {[{ k: true, t: 'Solo activos' }, { k: false, t: 'Todos' }].map((o) => (
          <TouchableOpacity key={String(o.k)} onPress={() => setSoloActivos(o.k)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: soloActivos === o.k ? colors.primary : colors.border, backgroundColor: soloActivos === o.k ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: soloActivos === o.k ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{o.t}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <Text style={{ color: colors.muted, fontSize: 12, alignSelf: 'center' }}>{shown.length} persona(s)</Text>
      </View>

      {shown.length === 0 ? (
        <EmptyState title="Sin personal" subtitle="No hay empleados que coincidan con la búsqueda." />
      ) : shown.map((e) => {
        const n = paysOf(e).length;
        return (
          <TouchableOpacity key={e.id} activeOpacity={0.7} onPress={() => setSel(e)}>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>{fullName(e)}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.success, fontWeight: '800', fontSize: 14 }}>{usd(totalOf(e))}</Text>
                  {bcvRate ? <Text style={{ color: '#0F766E', fontSize: 11, fontWeight: '700' }}>{bsTxt(totalOf(e))}</Text> : null}
                </View>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{[e.cedula, e.cargo ? canonicalCargo(e.cargo) : ''].filter(Boolean).join(' · ') || '—'}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{n} pago(s)</Text>
              </View>
            </Card>
          </TouchableOpacity>
        );
      })}

      {/* Ficha de persona */}
      <Modal visible={!!sel} animationType="slide" onRequestClose={() => setSel(null)}>
        {sel ? (
          <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
            <TouchableOpacity onPress={() => setSel(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
              <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20 }}>{fullName(sel)}</Text>

            <Card>
              <Text style={{ color: colors.primary, fontWeight: '800', marginBottom: 4 }}>🪪 Datos personales</Text>
              <Text style={{ color: colors.text, fontSize: 13 }}>Cédula: {sel.cedula || '—'}   ·   Ficha: {sel.ficha_number || '—'}</Text>
              <Text style={{ color: colors.text, fontSize: 13 }}>Cargo: {sel.cargo ? canonicalCargo(sel.cargo) : '—'}</Text>
              <Text style={{ color: colors.text, fontSize: 13 }}>Teléfono: {sel.phone || '—'}   ·   Estado: {sel.status || '—'}</Text>
            </Card>
            <Card>
              <Text style={{ color: colors.primary, fontWeight: '800', marginBottom: 4 }}>🏦 Datos bancarios</Text>
              <Text style={{ color: colors.text, fontSize: 13 }}>Banco: {sel.bank_name || '—'}</Text>
              <Text style={{ color: colors.text, fontSize: 13 }}>Cuenta: {sel.bank_account || '—'}</Text>
              <Text style={{ color: colors.text, fontSize: 13 }}>Titular: {sel.bank_holder || fullName(sel)}   ·   C.I.: {sel.bank_cedula || sel.cedula || '—'}</Text>
            </Card>
            <Card>
              <Text style={{ color: colors.primary, fontWeight: '800', marginBottom: 4 }}>💲 Tarifas</Text>
              <Text style={{ color: colors.text, fontSize: 13 }}>☀️ Día {usd(sel.precio_dia || 0)}   ·   🌙 Noche {usd(sel.precio_noche || 0)}</Text>
              {bcvRate ? <Text style={{ color: '#0F766E', fontSize: 12 }}>☀️ Día {bsTxt(sel.precio_dia || 0)}   ·   🌙 Noche {bsTxt(sel.precio_noche || 0)}</Text> : null}
              <Text style={{ color: colors.text, fontSize: 13, marginTop: 2 }}>Semana {usd(sel.precio_semana || 0)}   ·   Quincena {usd(sel.precio_quincena || 0)}   ·   Mes {usd(sel.precio_mes || 0)}</Text>
              {bcvRate ? <Text style={{ color: '#0F766E', fontSize: 12 }}>Semana {bsTxt(sel.precio_semana || 0)}   ·   Quincena {bsTxt(sel.precio_quincena || 0)}   ·   Mes {bsTxt(sel.precio_mes || 0)}</Text> : null}
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Los precios se definen en el "🏷️ Tabulador" por cargo{bcvRate ? ` · Tasa BCV hoy: ${fmtBs(bcvRate)}/US$` : ''}.</Text>
            </Card>

            {canEdit ? (
              <TouchableOpacity onPress={abrirNuevo} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xs }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>➕ Generar pago</Text>
              </TouchableOpacity>
            ) : null}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg }}>
              <View>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>Historial · {usd(selTotal)}</Text>
                {bcvRate ? <Text style={{ color: '#0F766E', fontSize: 12, fontWeight: '700' }}>{bsTxt(selTotal)}</Text> : null}
              </View>
              {selPays.length ? (
                <TouchableOpacity onPress={() => historico(sel)} style={{ backgroundColor: '#0F766E', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>🖨️ Imprimir histórico</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {selPays.length === 0 ? (
              <EmptyState title="Sin pagos" subtitle={canEdit ? 'Toca “➕ Generar pago” para registrar el primero.' : 'Aún no hay pagos registrados.'} />
            ) : selPays.map((p) => (
              <Card key={p.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{rangoFecha(p)}</Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colors.success, fontWeight: '800', fontSize: 15 }}>{usd(p.monto)}</Text>
                    {bcvRate ? <Text style={{ color: '#0F766E', fontSize: 11, fontWeight: '700' }}>{bsTxt(p.monto)}</Text> : null}
                  </View>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{detalle(p)} · {p.metodo || '—'}{p.concepto ? ` · ${p.concepto}` : ''}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                  <TouchableOpacity onPress={() => recibo(sel, p)} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>📄 Recibo</Text>
                  </TouchableOpacity>
                  {canEdit ? (
                    <>
                      <TouchableOpacity onPress={() => abrirEditar(p)} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>✏️ Editar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => borrar(p)} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: '#DC2626', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                        <Text style={{ color: '#DC2626', fontWeight: '800', fontSize: 12 }}>🗑️ Borrar</Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                </View>
              </Card>
            ))}
            <View style={{ height: spacing.xl }} />
          </ScrollView>
        ) : null}

        {/* Generar / editar pago */}
        <Modal visible={payOpen} transparent animationType="slide" onRequestClose={() => setPayOpen(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '92%' }}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, marginBottom: spacing.sm }}>{editing ? 'Editar pago' : 'Generar pago'}{sel ? ` · ${fullName(sel)}` : ''}</Text>

                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Período que cubre el pago (rango de fechas)</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
                    <DateField value={fFecha} onChange={(v) => aplicarRango(v, addDaysISO(v, Math.max(0, diasRango - 1)))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
                    <DateField value={fHasta} onChange={(v) => aplicarRango(fFecha, v)} />
                  </View>
                </View>

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Frecuencia</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {FRECS.map((f) => {
                    const on = fFrec === f.key;
                    return (
                      <TouchableOpacity key={f.key} onPress={() => cambiarFrec(f.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{f.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {fFrec === 'diario' ? (
                  <>
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Jornadas de día y de noche (puedes cargar ambas juntas)</Text>
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>☀️ Días</Text>
                        <TextInput value={fDiaCant} onChangeText={setDiaCant} keyboardType="decimal-pad" style={input} />
                        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2, marginBottom: 2 }}>Precio día</Text>
                        <TextInput value={fDiaPrecio} onChangeText={(t) => { const v = onlyDecimal(t); setFDiaPrecio(v); recalcDiario(fDiaCant, v, fNocheCant, fNochePrecio); }} keyboardType="decimal-pad" style={input} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>🌙 Noches</Text>
                        <TextInput value={fNocheCant} onChangeText={setNocheCant} keyboardType="decimal-pad" style={input} />
                        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2, marginBottom: 2 }}>Precio noche</Text>
                        <TextInput value={fNochePrecio} onChangeText={(t) => { const v = onlyDecimal(t); setFNochePrecio(v); recalcDiario(fDiaCant, fDiaPrecio, fNocheCant, v); }} keyboardType="decimal-pad" style={input} />
                      </View>
                    </View>
                    <Text style={{ color: (parseNum(fDiaCant) + parseNum(fNocheCant)) >= diasRango ? colors.warning : colors.muted, fontSize: 11, marginTop: 4, fontWeight: '700' }}>
                      El rango Desde→Hasta cubre {diasRango} día(s). Días + noches = {parseNum(fDiaCant) + parseNum(fNocheCant)} / {diasRango} (no puede pasar del total).
                    </Text>
                    <View style={{ marginTop: spacing.sm }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>Monto ({montoCur === 'USD' ? 'US$' : 'Bs'})</Text>
                        <TouchableOpacity onPress={() => setMontoCur(montoCur === 'USD' ? 'VES' : 'USD')} style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 }}>
                          <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 11 }}>{montoCur === 'USD' ? '$→Bs' : 'Bs→$'}</Text>
                        </TouchableOpacity>
                      </View>
                      <TextInput value={fMonto} onChangeText={(t) => { setMontoTocado(true); setFMonto(onlyDecimal(t)); }} keyboardType="decimal-pad" style={{ ...input, fontWeight: '800' }} />
                      {bcvRate ? <Text style={{ color: '#0F766E', fontSize: 11, marginTop: 2 }}>≈ {montoCur === 'USD' ? bsTxt(parseNum(fMonto)) : usd(usdFromBs(parseNum(fMonto), bcvRate))}</Text> : null}
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Monto sugerido = (días × precio día) + (noches × precio noche). Editable. Las cantidades quedan guardadas para el próximo pago.</Text>
                  </>
                ) : (
                  <>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Cantidad</Text>
                        <TextInput value={fCant} onChangeText={(t) => { const v = onlyDecimal(t); setFCant(v); recalcSimple(v, fPrecio); }} keyboardType="decimal-pad" style={input} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Precio unit.</Text>
                        <TextInput value={fPrecio} onChangeText={(t) => { const v = onlyDecimal(t); setFPrecio(v); recalcSimple(fCant, v); }} keyboardType="decimal-pad" style={input} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                          <Text style={{ color: colors.muted, fontSize: 12 }}>Monto ({montoCur === 'USD' ? 'US$' : 'Bs'})</Text>
                          <TouchableOpacity onPress={() => setMontoCur(montoCur === 'USD' ? 'VES' : 'USD')} style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 }}>
                            <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 11 }}>{montoCur === 'USD' ? '$→Bs' : 'Bs→$'}</Text>
                          </TouchableOpacity>
                        </View>
                        <TextInput value={fMonto} onChangeText={(t) => { setMontoTocado(true); setFMonto(onlyDecimal(t)); }} keyboardType="decimal-pad" style={{ ...input, fontWeight: '800' }} />
                        {bcvRate ? <Text style={{ color: '#0F766E', fontSize: 11, marginTop: 2 }}>≈ {montoCur === 'USD' ? bsTxt(parseNum(fMonto)) : usd(usdFromBs(parseNum(fMonto), bcvRate))}</Text> : null}
                      </View>
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>El monto se sugiere solo (cantidad × precio); puedes cambiarlo a mano.</Text>
                  </>
                )}

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Método</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {METODOS.map((m) => {
                    const on = fMetodo === m;
                    return (
                      <TouchableOpacity key={m} onPress={() => setFMetodo(m)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{m}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Concepto (opcional)</Text>
                <TextInput value={fConcepto} onChangeText={setFConcepto} placeholder="Ej. Pago jornada, adelanto…" placeholderTextColor={colors.muted} style={input} />
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Nota (opcional)</Text>
                <TextInput value={fNota} onChangeText={setFNota} placeholder="Observaciones" placeholderTextColor={colors.muted} style={input} />

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                  <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setPayOpen(false)}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }} onPress={guardar} disabled={saving}>
                    <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar pago'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: spacing.lg }} />
              </ScrollView>
            </View>
          </View>
        </Modal>
      </Modal>
    </View>
  );
}

const RECIBO_CSS = `
  .sec{font-size:13px;color:#1E3A5F;margin:14px 0 6px;border-bottom:1px solid #E5E7EB;padding-bottom:3px}
  table.kv{width:100%;border-collapse:collapse;font-size:12px}
  table.kv td{padding:5px 8px;border:1px solid #E5E7EB;vertical-align:top}
  table.kv td.k{background:#F3F4F6;color:#374151;font-weight:700;width:16%;white-space:nowrap}
  .monto{margin:16px 0 6px;padding:12px 16px;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;font-size:16px;color:#065F46;text-align:right}
  .monto b{font-size:22px}
  .nota{font-size:12px;color:#374151;margin-top:4px}
  .firmas{display:flex;gap:40px;margin-top:46px}
  .firma{flex:1;text-align:center;border-top:1px solid #9CA3AF;padding-top:6px;font-size:12px;color:#374151}
`;
const HIST_CSS = `
  .sec{font-size:13px;color:#1E3A5F;margin:14px 0 6px;border-bottom:1px solid #E5E7EB;padding-bottom:3px}
  table.kv{width:100%;border-collapse:collapse;font-size:12px}
  table.kv td{padding:5px 8px;border:1px solid #E5E7EB}
  table.kv td.k{background:#F3F4F6;color:#374151;font-weight:700;width:16%;white-space:nowrap}
  table.hist{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}
  table.hist th,table.hist td{padding:6px 8px;border:1px solid #E5E7EB}
  table.hist thead th{background:#1E3A5F;color:#fff;text-align:left}
  table.hist .c{text-align:center}table.hist .r{text-align:right}
  table.hist tfoot td{background:#F3F4F6}
`;
