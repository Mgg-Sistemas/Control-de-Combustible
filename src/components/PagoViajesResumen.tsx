// PAGO DE VIAJES · lo que hay que pagar (15-sep-2026).
//
// Tarjeta del panel de información de Viajes de camiones. Por rango de fechas (por
// jornada, 7am a 7am): cada empresa con sus viajes pagados, los que no facturaron, los
// que quedaron sin pagar y el total. Tocar una empresa abre el detalle por camión y por
// viaje (PagoViajesDetalle), donde se marca «facturó / no facturó».
//
// ⭐ Vive SOLO en este módulo: no toca jornadas, Control de Maquinaria ni Control de Pagos.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Plegable } from './Plegable';
import { DateField } from './DateField';
import { PagoViajesPanel } from './PagoViajesPanel';
import { PagoViajesDetalle } from './PagoViajesDetalle';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { cmpText } from '../lib/text';
import { exportPdf, pdfDocument } from '../lib/pdf';
import {
  calcularPagoViajes,
  etiquetaMotivoSinPago,
  indexarMarcas,
  indexarModos,
  INICIO_PAGO_VIAJES,
  jornadaDeInstante,
  viajesEnRango,
  viajesFueraDelPago,
  MotivoSinPago,
  PagoViajesGrupo,
} from '../lib/pagoViajes';
import { cargarDatosPagoViajes, DatosPagoViajes } from '../lib/pagoViajesDb';
import {
  CSS_PAGO_VIAJES, EjePago, OPCIONES_PAGO_COMO_ANTES, OpcionesPagoViajes, PASTILLAS_PAGO,
  acotarFiltroPago, alternarPago, cuerpoPagoViajes, empresasDisponibles, filtrarLineasPago, lineasDeGrupos,
  maquinasDisponiblesPago, obrasDisponibles, ocultosPagoEnPalabras, sufijoArchivoPago, totalDeLineas,
} from '../lib/pagoViajesReporte';
// 🔒 Cierres del pago (06-oct-2026): el cliente preguntó «¿cómo defino que ya
// pagaron viajes?, ¿desde dónde?». Desde aquí: se marca el rango como PAGADO y
// queda la constancia con su foto (pagoViajesCierres.ts tiene las reglas).
import {
  CierrePagoViajes, CSS_CIERRE_PAGO, armarFotoCierrePago, cierrePagoDelRango, cierresPagoSolapados,
  cuerpoCierrePago, textoConfirmarCierrePago, usdCierre, validarCierrePago,
} from '../lib/pagoViajesCierres';
import { cargarCierresPago, crearCierrePago, reabrirCierrePago } from '../lib/pagoViajesCierresDb';

type Props = {
  canEdit: boolean;
  usuarioId: string | null;
  /** id del camión → m³ de UN viaje, de Cubicaje. Solo para la columna opcional del PDF. */
  m3PorViaje?: Map<string, number> | null;
};

const usd = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesDe = (iso: string) => sumarDias(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 🔒 ¿SE PUEDE MARCAR UN RANGO COMO «PAGADO»? — APAGADO (06-oct-2026).
 *
 * El 05-oct el cliente preguntó «¿cómo defino que ya pagaron viajes?» y se
 * construyó la constancia con su foto; al día siguiente lo revirtió: «quita lo
 * de pagado, NO SE VA A CONFIRMAR QUE SE PAGÓ DESDE EL SISTEMA». Este módulo
 * solo lleva el registro de CUÁNTO HAY QUE PAGAR.
 *
 * ⚠️ NO SE BORRÓ NADA (regla de la casa: ocultar no es eliminar). El cálculo,
 *    la capa de datos (pagoViajesCierres.ts y su Db) y sus pruebas siguen
 *    enteros: poner esto en true devuelve la banda, el botón y el histórico
 *    tal como estaban. La tabla viaje_pago_cierres nunca se creó en la base.
 */
const CIERRES_PAGO_VISIBLES = false;

export function PagoViajesResumen({ canEdit, usuarioId, m3PorViaje }: Props) {
  const { colors } = useTheme();
  const hoy = jornadaDeInstante(new Date().toISOString());
  const [desde, setDesde] = useState(() => lunesDe(hoy));
  const [hasta, setHasta] = useState(hoy);
  const [datos, setDatos] = useState<DatosPagoViajes | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // ── Opciones del PDF (21-sep-2026) ── por empresa(s), por obra(s), agrupado por
  //    empresa o por obra, y las pastillas 🚫. Filtran SOLO el papel: la tarjeta de
  //    arriba sigue mostrando el pago completo del rango, y el papel dice que está filtrado.
  const [empresasSel, setEmpresasSel] = useState<Set<string>>(new Set());
  const [obrasSel, setObrasSel] = useState<Set<string>>(new Set());
  // 🚜 Selección y buscador de máquinas del reporte (30-sep-2026, a pedido).
  const [maquinasSel, setMaquinasSel] = useState<Set<string>>(new Set());
  const [buscaMaq, setBuscaMaq] = useState('');
  const [ejePdf, setEjePdf] = useState<EjePago>('empresa');
  const [opcionesPdf, setOpcionesPdf] = useState<OpcionesPagoViajes>(OPCIONES_PAGO_COMO_ANTES);
  // ── Cierres «ya se pagó» (06-oct-2026, pedido del cliente) ──
  const [cierres, setCierres] = useState<CierrePagoViajes[]>([]);
  /** La tabla viaje_pago_cierres no existe todavía (falta correr el SQL). */
  const [faltaCierres, setFaltaCierres] = useState(false);
  const [errorCierres, setErrorCierres] = useState<string | null>(null);
  /** Confirmación EN LÍNEA de «marcar pagado» (nada de confirm() del navegador). */
  const [confirmandoPago, setConfirmandoPago] = useState(false);
  const [notaCierre, setNotaCierre] = useState('');
  /** Confirmación EN LÍNEA de reabrir: qué cierre, y su motivo (obligatorio). */
  const [reabriendo, setReabriendo] = useState<{ id: string } | null>(null);
  const [motivoReabrir, setMotivoReabrir] = useState('');
  const [guardandoCierre, setGuardandoCierre] = useState(false);
  /** Aviso del último intento (validación rechazada, permiso, o el «listo»). */
  const [avisoCierre, setAvisoCierre] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  // Recarga SOLO los cierres (tras marcar o reabrir, sin releer todo el pago).
  const recargarCierres = useCallback(async () => {
    if (!CIERRES_PAGO_VISIBLES) return;
    const r = await cargarCierresPago();
    setCierres(r.cierres);
    setFaltaCierres(r.missing);
    setErrorCierres(r.error ?? null);
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      // Los cierres se cargan junto con los datos: la banda de «ya está pagado»
      // tiene que salir con el mismo «Actualizar» de la tarjeta.
      const [d, c] = await Promise.all([
        cargarDatosPagoViajes(),
        // Apagado: ni se consulta (la tabla no existe y nadie la va a usar).
        CIERRES_PAGO_VISIBLES ? cargarCierresPago() : Promise.resolve({ cierres: [], missing: false, error: undefined }),
      ]);
      setDatos(d);
      setCierres(c.cierres);
      setFaltaCierres(c.missing);
      setErrorCierres(c.error ?? null);
      setError(null);
    } catch (e: any) {
      setError(`No se pudo leer el pago de viajes (${e?.message ?? 'revisa la conexión'}). No se muestran montos a medias: toca «Actualizar».`);
    } finally {
      setCargando(false);
    }
  }, []);

  /**
   * 💤 NO SE CONSULTA HASTA QUE ABRAS LA TARJETA (06-oct-2026, «el sistema va
   * lento»). Antes, esta tarjeta y la de peso pedían CADA UNA todos los viajes
   * desde el 14-sep al abrir Viajes de camiones —4.082 filas en 6 viajes de
   * red— aunque las dos estuvieran cerradas y nadie las mirara. Y esa ventana
   * crece sola: en seis meses serían 16.000 filas en cada apertura.
   * Ahora se carga al abrirla, y queda cargada mientras no salgas.
   */
  const [yaPedido, setYaPedido] = useState(false);
  useEffect(() => { if (yaPedido) cargar(); }, [yaPedido, cargar]);

  const empresas = useMemo(() => {
    if (!datos || error) return [] as { clave: string; nombre: string; g: PagoViajesGrupo }[];
    const grupos = calcularPagoViajes({
      viajes: viajesEnRango(datos.viajes, desde, hasta),
      modos: indexarModos(datos.modos),
      tarifas: datos.tarifas,
      marcas: indexarMarcas(datos.marcas),
      semanaDe: () => 'rango',
    });
    return Array.from(grupos.entries())
      .map(([clave, g]) => ({ clave, g, nombre: g.companyId ? datos.empresas.get(g.companyId) || 'Empresa' : 'Sin empresa (fuera del catálogo)' }))
      .sort((a, b) => cmpText(a.nombre, b.nombre));
  }, [datos, error, desde, hasta]);

  const tot = useMemo(() => empresas.reduce(
    (a, { g }) => ({ monto: a.monto + g.montoUSD, viajes: a.viajes + g.viajes, pagados: a.pagados + g.pagados, noFacturados: a.noFacturados + g.noFacturados, pendientes: a.pendientes + g.pendientes }),
    { monto: 0, viajes: 0, pagados: 0, noFacturados: 0, pendientes: 0 },
  ), [empresas]);

  // Por qué quedaron sin pagar (sin zona, sin tarifa, sin empresa…): «N sin pagar» a secas
  // no dice qué arreglar. Los «no facturó» van aparte, que esos son a propósito.
  const motivos = useMemo(() => {
    const m = new Map<MotivoSinPago, number>();
    empresas.forEach(({ g }) => g.lineas.forEach((l) => {
      if (l.motivoSinPago && l.motivoSinPago !== 'no_facturo') m.set(l.motivoSinPago, (m.get(l.motivoSinPago) ?? 0) + 1);
    }));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [empresas]);

  // Camiones que hicieron viajes SIN estar en el pago: el cálculo los descarta y no
  // aparecerían en ninguna parte.
  const fueraDelPago = useMemo(() => {
    if (!datos || error) return [];
    return viajesFueraDelPago({ viajes: viajesEnRango(datos.viajes, desde, hasta), modos: indexarModos(datos.modos) });
  }, [datos, error, desde, hasta]);
  const viajesFuera = useMemo(() => fueraDelPago.reduce((a, c) => a + c.viajes, 0), [fueraDelPago]);

  // Todo sale de LAS MISMAS líneas de la tarjeta: el papel no recalcula un centavo.
  const lineasTodas = useMemo(() => lineasDeGrupos(empresas.map((e) => e.g)), [empresas]);
  const empresasPdf = useMemo(() => empresasDisponibles(lineasTodas, datos?.empresas), [lineasTodas, datos]);
  const obrasPdf = useMemo(() => obrasDisponibles(lineasTodas), [lineasTodas]);
  const maquinasPdf = useMemo(() => maquinasDisponiblesPago(lineasTodas, datos?.fichas, datos?.empresas), [lineasTodas, datos]);
  // El buscador recorta lo que se ve, no lo que está marcado: una máquina marcada
  // que no coincide con la búsqueda sigue filtrando el papel (por eso se cuentan aparte).
  const maquinasVistas = useMemo(() => {
    const q = buscaMaq.trim().toLowerCase();
    if (!q) return maquinasPdf;
    return maquinasPdf.filter((m) => `${m.code} ${m.placa} ${m.empresa}`.toLowerCase().includes(q));
  }, [maquinasPdf, buscaMaq]);
  // Acotado a lo que hay en el rango: una obra o máquina marcada que ya no está no
  // puede seguir filtrando sin verse.
  const filtroPdf = useMemo(
    () => acotarFiltroPago(
      { empresas: Array.from(empresasSel), obras: Array.from(obrasSel), maquinas: Array.from(maquinasSel) },
      { empresas: empresasPdf.map((e) => e.id), obras: obrasPdf.map((x) => x.id), maquinas: maquinasPdf.map((x) => x.id) },
    ),
    [empresasSel, obrasSel, maquinasSel, empresasPdf, obrasPdf, maquinasPdf],
  );
  const lineasPdf = useMemo(() => filtrarLineasPago(lineasTodas, filtroPdf), [lineasTodas, filtroPdf]);
  const totPdf = useMemo(() => totalDeLineas(lineasPdf), [lineasPdf]);
  const pdfFiltrado = filtroPdf.empresas.length > 0 || filtroPdf.obras.length > 0 || filtroPdf.maquinas.length > 0;

  const rangoInvalido = hasta < desde;
  const rangoAntesDelInicio = hasta < INICIO_PAGO_VIAJES;

  // ── Derivados de los cierres (06-oct-2026) ──
  /** El cierre ACTIVO que contiene el rango entero = «este rango ya está pagado». */
  const pagado = useMemo(() => cierrePagoDelRango(cierres, desde, hasta), [cierres, desde, hasta]);
  /** Cierres activos que tocan el rango a medias (para el aviso ámbar). */
  const solapados = useMemo(() => cierresPagoSolapados(cierres, desde, hasta), [cierres, desde, hasta]);
  // ⭐ La foto SIEMPRE de lineasTodas (el pago COMPLETO del rango), NUNCA de
  //    lineasPdf: una constancia de un pago filtrado que se lea como total es
  //    el error más caro posible.
  const fotoCierre = useMemo(() => armarFotoCierrePago(lineasTodas, datos?.empresas), [lineasTodas, datos]);
  /** dd/mm/yyyy de un timestamp (created_at trae hora; el dmy local no la corta). */
  const dmyTs = (iso?: string | null) => dmy(String(iso ?? '').slice(0, 10));
  /** dd/mm cortico, para los renglones del histórico. */
  const dmCorto = (iso?: string | null) => {
    const [, m, d] = String(iso ?? '').slice(0, 10).split('-');
    return d && m ? `${d}/${m}` : '';
  };

  /** Guarda el cierre tras la confirmación en línea (valida ANTES de escribir). */
  const marcarPagado = async () => {
    const rechazo = validarCierrePago({ desde, hasta, foto: fotoCierre }, cierres);
    if (rechazo) { setAvisoCierre({ tipo: 'error', texto: rechazo }); return; }
    setGuardandoCierre(true);
    try {
      const r = await crearCierrePago({ desde, hasta, foto: fotoCierre, nota: notaCierre });
      if (r.error) { setAvisoCierre({ tipo: 'error', texto: r.error }); return; }
      await recargarCierres();
      setConfirmandoPago(false);
      setNotaCierre('');
      setAvisoCierre({ tipo: 'ok', texto: `✔️ Listo: el pago del ${dmy(desde)} al ${dmy(hasta)} quedó marcado como PAGADO, con su constancia en el histórico.` });
    } finally {
      setGuardandoCierre(false);
    }
  };

  /** Reabre (anula) una constancia con su motivo obligatorio. */
  const confirmarReabrir = async (id: string) => {
    const motivo = motivoReabrir.trim();
    if (!motivo) { setAvisoCierre({ tipo: 'error', texto: 'Para reabrir hay que escribir el motivo.' }); return; }
    setGuardandoCierre(true);
    try {
      const r = await reabrirCierrePago(id, motivo, usuarioId);
      if (r.error) { setAvisoCierre({ tipo: 'error', texto: r.error }); return; }
      await recargarCierres();
      setReabriendo(null);
      setMotivoReabrir('');
      setAvisoCierre({ tipo: 'ok', texto: '↺ Pago reabierto: la constancia quedó sin efecto, pero sigue en el histórico.' });
    } finally {
      setGuardandoCierre(false);
    }
  };

  /** El papel de una constancia sale de la FOTO guardada, nunca de los datos vivos. */
  const pdfCierre = async (c: CierrePagoViajes) => {
    const html = pdfDocument({
      title: 'Constancia de pago de viajes',
      subtitle: `Del ${dmy(c.desde)} al ${dmy(c.hasta)}${c.anulada_at ? ' · REABIERTA (sin efecto)' : ''}`,
      extraCss: CSS_CIERRE_PAGO,
      body: cuerpoCierrePago(c),
      marcaTexto: false,
    });
    await exportPdf(html, `Constancia pago viajes ${dmy(c.desde)} a ${dmy(c.hasta)}`.replace(/\//g, '-'));
  };

  const descargarPdf = async () => {
    // Camiones con viajes que no entran al pago: lo que NO se está pagando. Solo en el
    // papel SIN filtrar: esa lista es de todo el rango, y en el papel de una obra o de
    // una empresa hablaría de camiones que no tienen nada que ver.
    // 🚜 La placa también en este bloque (30-sep-2026, a pedido): sale cuando el
    //    check «Serial / Placa» está encendido, igual que en el listado de arriba.
    //    Antes esta tabla no tenía columna de placa y el check no la afectaba.
    const conPlaca = !opcionesPdf.sinPlaca;
    const placaFuera = (c: { machineryId: string }) => {
      const f = datos?.fichas?.get(c.machineryId);
      return (f?.placa || f?.serial || '—');
    };
    const fuera = !pdfFiltrado && fueraDelPago.length ? `
      <h3>🚫 Camiones que no entran al pago (${viajesFuera} viaje(s))</h3>
      <table><thead><tr><th>Camión</th><th>Empresa</th>${conPlaca ? '<th>Serial / Placa</th>' : ''}<th class="r">Viajes</th><th>Situación</th></tr></thead>
      <tbody>${fueraDelPago.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.companyId ? datos?.empresas.get(c.companyId) ?? 'Empresa' : 'Sin empresa')}</td>${conPlaca ? `<td>${esc(placaFuera(c))}</td>` : ''}<td class="r">${c.viajes}</td><td>${c.sinConfigurar ? 'Nunca se puso en el pago' : 'Se le quitó el pago por viaje'}</td></tr>`).join('')}</tbody></table>` : '';
    const html = pdfDocument({
      title: 'Pago de viajes de camiones',
      // 🔒 Si el rango ya está marcado como pagado, el papel lo dice (06-oct-2026).
      subtitle: `Del ${dmy(desde)} al ${dmy(hasta)} · por jornada (7am a 7am)${ejePdf === 'obra' ? ' · por obra' : ejePdf === 'frente' ? ' · por frente' : ''}${pdfFiltrado ? ' · FILTRADO' : ''}${CIERRES_PAGO_VISIBLES && pagado ? ` · PAGADO el ${dmyTs(pagado.created_at)}` : ''}`,
      extraCss: CSS_PAGO_VIAJES,
      body: cuerpoPagoViajes({
        lineas: lineasPdf,
        eje: ejePdf,
        filtro: filtroPdf,
        // Un papel filtrado SIEMPRE dice que lo está, aunque hayan apagado el alcance:
        // un total parcial que se lee como el pago completo es el error más caro posible.
        opciones: pdfFiltrado ? { ...opcionesPdf, sinAlcance: false } : opcionesPdf,
        nombresEmpresa: datos?.empresas ?? new Map(),
        fichas: datos?.fichas,
        m3PorViaje,
        etiquetaMotivo: etiquetaMotivoSinPago,
        htmlFueraDelPago: fuera,
      }),
    });
    await exportPdf(html, `Pago de viajes ${dmy(desde)} a ${dmy(hasta)}${sufijoArchivoPago(filtroPdf, ejePdf, opcionesPdf)}`.replace(/\//g, '-'));
  };

  const alternarSel = (set: Set<string>, poner: (x: Set<string>) => void, k: string) => {
    const n = new Set(set);
    if (n.has(k)) n.delete(k); else n.add(k);
    poner(n);
  };
  const pastilla = (key: string, label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} onPress={onPress}
      style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
  const rotuloPdf = (t: string) => <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm, marginBottom: 4 }}>{t}</Text>;

  const atajo = (label: string, d: string, h: string) => {
    const on = desde === d && hasta === h;
    return (
      <TouchableOpacity key={label} onPress={() => { setDesde(d); setHasta(h); }}
        style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
      </TouchableOpacity>
    );
  };
  const boton = (label: string, onPress: () => void, principal = false, disabled = false) => (
    <TouchableOpacity key={label} disabled={disabled} onPress={onPress}
      style={{ flexGrow: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: principal ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: principal ? colors.brand : colors.border, opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: principal ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <>
      <Plegable
        titulo="💰 Pago de viajes"
        // Cerrada y sin pedir todavía, NO se inventa un total: lo dice.
        resumen={error ? '⚠️ no se pudo leer'
          : !yaPedido ? 'toca para calcular el pago del rango'
            : `${tot.pagados} viaje(s) · ${usd(tot.monto)} · ${dmy(desde)} al ${dmy(hasta)}`}
        alerta={!!error || (yaPedido && tot.pendientes > 0)}
        onAbrir={(abierta) => { if (abierta) setYaPedido(true); }}
      >
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          Lo que se le paga a cada empresa por los viajes de sus camiones, con la tarifa que le toque (la de la zona
          del CDT, o la especial de su empresa, grupo o camión). Se cuenta
          por jornada (7am a 7am). El pago por viaje arranca el {dmy(INICIO_PAGO_VIAJES)}.
        </Text>

        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Desde</Text>
            <DateField value={desde} onChange={setDesde} />
          </View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Hasta</Text>
            <DateField value={hasta} onChange={setHasta} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.sm }}>
          {atajo('Esta semana', lunesDe(hoy), hoy)}
          {atajo('Semana pasada', sumarDias(lunesDe(hoy), -7), sumarDias(lunesDe(hoy), -1))}
          {atajo('Hoy', hoy, hoy)}
        </View>
        {rangoInvalido ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>La fecha «hasta» no puede ser anterior a «desde».</Text> : null}

        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.sm }}>
          {boton('⚙️ Tarifas y camiones', () => setPanelOpen(true))}
          {boton(cargando ? 'Actualizando…' : '↻ Actualizar', cargar, false, cargando)}
          {boton('📄 PDF', descargarPdf, true, !!error || rangoInvalido || !lineasPdf.length)}
        </View>

        {!error && empresas.length ? (
          <Plegable
            titulo="📄 Opciones del PDF"
            resumen={`${pdfFiltrado ? 'filtrado · ' : ''}${totPdf.pagados} viaje(s) · ${usd(totPdf.monto)} · por ${ejePdf === 'obra' ? 'obra' : ejePdf === 'frente' ? 'frente' : 'empresa'}`}
            alerta={pdfFiltrado}
          >
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              Esto cambia SOLO el papel. Lo de arriba sigue siendo el pago completo del rango. Sin marcar nada, entran todas.
            </Text>

            {rotuloPdf('AGRUPAR POR')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {pastilla('eje-e', '🏢 Empresa', ejePdf === 'empresa', () => setEjePdf('empresa'))}
              {pastilla('eje-o', '📍 Obra / ubicación', ejePdf === 'obra', () => setEjePdf('obra'))}
              {pastilla('eje-f', '⛏️ Frente de trabajo', ejePdf === 'frente', () => setEjePdf('frente'))}
            </View>

            {rotuloPdf(`📍 OBRAS (vacío = todas · ${obrasPdf.length})`)}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {pastilla('o-todas', '✅ Todas', filtroPdf.obras.length === 0, () => setObrasSel(new Set()))}
              {obrasPdf.map((x) => pastilla('o' + x.id, `${x.name} (${x.viajes})`, filtroPdf.obras.includes(x.id), () => alternarSel(obrasSel, setObrasSel, x.id)))}
            </View>

            {rotuloPdf(`🏢 EMPRESAS (vacío = todas · ${empresasPdf.length})`)}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {pastilla('e-todas', '✅ Todas', filtroPdf.empresas.length === 0, () => setEmpresasSel(new Set()))}
              {empresasPdf.map((x) => pastilla('e' + x.id, `${x.name} (${x.viajes})`, filtroPdf.empresas.includes(x.id), () => alternarSel(empresasSel, setEmpresasSel, x.id)))}
            </View>

            {/* 🚜 MÁQUINAS (30-sep-2026, a pedido): buscador + selección de una o
                varias, para sacar el papel solo de esos camiones. Se cruza con las
                empresas y obras de arriba (todo lo marcado tiene que cumplirse). */}
            {rotuloPdf(`🚜 MÁQUINAS (vacío = todas · ${maquinasPdf.length})`)}
            <TextInput
              value={buscaMaq}
              onChangeText={setBuscaMaq}
              placeholder="🔎 Buscar máquina: código, placa o empresa…"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, color: colors.text, marginBottom: 4 }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {pastilla('m-todas', '✅ Todas', filtroPdf.maquinas.length === 0, () => { setMaquinasSel(new Set()); setBuscaMaq(''); })}
              {maquinasVistas.map((x) => pastilla(
                'm' + x.id,
                `${x.code}${x.placa ? ` · ${x.placa}` : ''} (${x.viajes})`,
                filtroPdf.maquinas.includes(x.id),
                () => alternarSel(maquinasSel, setMaquinasSel, x.id),
              ))}
            </View>
            {maquinasVistas.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Ninguna máquina coincide con la búsqueda.</Text>
            ) : null}
            {/* Si el buscador esconde máquinas marcadas, se dice — para que nadie
                crea que dejó de filtrar por lo que no ve. */}
            {filtroPdf.maquinas.length > maquinasVistas.filter((x) => filtroPdf.maquinas.includes(x.id)).length ? (
              <Text style={{ color: colors.warning, fontSize: 11, marginTop: 2 }}>
                Hay {filtroPdf.maquinas.length} máquina(s) marcada(s); la búsqueda oculta algunas, pero siguen filtrando el papel.
              </Text>
            ) : null}

            {rotuloPdf('🖨️ ¿QUÉ SE OCULTA EN EL PDF?')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {PASTILLAS_PAGO.map((p) => pastilla('p' + p.key, p.chip, opcionesPdf[p.key], () => setOpcionesPdf((o) => alternarPago(o, p.key))))}
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
              Encendida = NO sale. {ocultosPagoEnPalabras(opcionesPdf)} Ocultar no cambia el total; filtrar sí.
            </Text>

            <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: pdfFiltrado ? colors.warning : colors.border, borderRadius: radius.md, padding: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                Va a salir: {totPdf.pagados} viaje(s) pagados · {usd(totPdf.monto)}
              </Text>
              {pdfFiltrado ? (
                <Text style={{ color: colors.warning, fontSize: 12 }}>
                  ⚠️ Filtrado: es una parte de los {usd(tot.monto)} del rango, y el papel lo dice. La lista de camiones que no entran al pago solo sale en el papel sin filtrar.
                </Text>
              ) : null}
              {!lineasPdf.length ? <Text style={{ color: colors.danger, fontSize: 12 }}>Con ese filtro no hay ningún viaje: no se puede sacar el papel.</Text> : null}
            </View>
          </Plegable>
        ) : null}

        {error ? (
          <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoftBg, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>⚠️ {error}</Text>
          </View>
        ) : null}

        {!error ? (
          <View style={{ marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brand, padding: spacing.sm }}>
            <Text style={{ color: colors.brandContrast, opacity: 0.85, fontSize: 11, fontWeight: '800' }}>TOTAL A PAGAR</Text>
            <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 20, fontVariant: ['tabular-nums'] as any }}>{usd(tot.monto)}</Text>
            <Text style={{ color: colors.brandContrast, fontSize: 12 }}>
              {tot.pagados} viaje(s) con tarifa{tot.noFacturados ? ` · ${tot.noFacturados} no facturó` : ''}{tot.pendientes ? ` · ${tot.pendientes} sin tarifa` : ''}
            </Text>
            {motivos.length ? (
              <Text style={{ color: colors.brandContrast, opacity: 0.85, fontSize: 11 }}>
                No entran al total: {motivos.map(([m, n]) => `${n} ${etiquetaMotivoSinPago(m).toLowerCase()}`).join(' · ')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* 🔒 «¿Ya se pagó?» (06-oct-2026, pedido del cliente: «¿cómo yo decido o
            cómo defino que ya pagaron viajes?, ¿desde dónde hago eso?»). Debajo
            del total: la banda si el rango ya está pagado, el aviso si lo está a
            medias, y el botón para dejar la constancia. No tranca ni cambia nada
            del pago: es la marca con su foto. */}
        {!error && CIERRES_PAGO_VISIBLES ? (
          <View style={{ marginTop: spacing.sm }}>
            {pagado ? (
              <View style={{ borderWidth: 1, borderColor: colors.success, backgroundColor: colors.successSoftBg, borderRadius: radius.md, padding: spacing.sm }}>
                <Text style={{ color: colors.success, fontWeight: '800', fontSize: 13 }}>
                  ✔️ Este rango ya está marcado como PAGADO — constancia del {dmyTs(pagado.created_at)}{pagado.created_by_nombre ? ` por ${pagado.created_by_nombre}` : ''}{pagado.nota ? ` · ${pagado.nota}` : ''}
                </Text>
              </View>
            ) : solapados.length ? (
              <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 12 }}>
                ⚠️ Parte de este rango ya está marcada como pagada (del {dmy(solapados[0].desde)} al {dmy(solapados[0].hasta)}).
              </Text>
            ) : null}

            {faltaCierres ? (
              <Text style={{ color: colors.warning, fontSize: 12, marginTop: spacing.xs }}>
                Para marcar pagos hace falta correr el SQL de los cierres en la base.
              </Text>
            ) : null}
            {errorCierres ? (
              <Text style={{ color: colors.danger, fontSize: 12, marginTop: spacing.xs }}>
                ⚠️ No se pudieron leer los pagos marcados ({errorCierres}). Toca «↻ Actualizar».
              </Text>
            ) : null}

            {!pagado && !faltaCierres && canEdit && tot.pagados > 0 && !rangoInvalido && !confirmandoPago ? (
              <View style={{ flexDirection: 'row', marginTop: spacing.xs }}>
                {boton('🔒 Marcar este rango como PAGADO', () => { setAvisoCierre(null); setConfirmandoPago(true); })}
              </View>
            ) : null}

            {/* Confirmación EN LÍNEA (estilo de la casa, nada de confirm() del
                navegador), con lo que de verdad va a quedar en la constancia. */}
            {confirmandoPago && !pagado ? (
              <View style={{ marginTop: spacing.xs, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoftBg, borderRadius: radius.md, padding: spacing.sm }}>
                <Text style={{ color: colors.warningSoftText, fontSize: 12, fontWeight: '700' }}>
                  {textoConfirmarCierrePago(desde, hasta, fotoCierre)}
                </Text>
                <TextInput
                  value={notaCierre}
                  onChangeText={setNotaCierre}
                  placeholder="Nota (opcional): n° de transferencia, quién pagó…"
                  placeholderTextColor={colors.muted}
                  autoCorrect={false}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, color: colors.text, marginTop: spacing.xs }}
                />
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                  {boton(guardandoCierre ? 'Guardando…' : '✅ Sí, ya se pagó', marcarPagado, true, guardandoCierre)}
                  {boton('✕ Cancelar', () => { setConfirmandoPago(false); setNotaCierre(''); }, false, guardandoCierre)}
                </View>
              </View>
            ) : null}

            {avisoCierre ? (
              <Text style={{ color: avisoCierre.tipo === 'ok' ? colors.success : colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>
                {avisoCierre.texto}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* 🗂️ El histórico de constancias: cada papel sale de la FOTO guardada,
            no de los datos vivos (si falta el SQL no hay nada que listar). */}
        {!error && CIERRES_PAGO_VISIBLES && (cierres.length > 0 || !faltaCierres) ? (
          <View style={{ marginTop: spacing.sm }}>
            <Plegable
              titulo="🗂️ Pagos marcados (histórico)"
              resumen={`${cierres.length} pago(s) marcado(s)`}
            >
              {!cierres.length ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Todavía no hay ningún rango marcado como pagado.
                </Text>
              ) : null}
              {cierres.map((c) => {
                const activo = !c.anulada_at;
                return (
                  <View key={c.id} style={{ marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface, opacity: activo ? 1 : 0.6 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                      {activo ? '✔️' : '↺'} del {dmy(c.desde)} al {dmy(c.hasta)} · {usdCierre(Number(c.total_monto) || 0)} · {c.pagados} viaje(s)
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      constancia de {c.created_by_nombre || '—'} · {dmCorto(c.created_at)}{c.nota ? ` · ${c.nota}` : ''}
                    </Text>
                    {!activo ? (
                      <Text style={{ color: colors.warning, fontSize: 11 }}>
                        ↺ reabierto el {dmCorto(c.anulada_at)}{c.anulada_motivo ? ` · ${c.anulada_motivo}` : ''}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                      {boton('📄 PDF', () => pdfCierre(c))}
                      {activo && canEdit ? boton('↺ Reabrir', () => { setAvisoCierre(null); setMotivoReabrir(''); setReabriendo({ id: c.id }); }) : null}
                    </View>
                    {/* Confirmación EN LÍNEA de reabrir, con motivo OBLIGATORIO. */}
                    {reabriendo?.id === c.id ? (
                      <View style={{ marginTop: spacing.xs, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoftBg, borderRadius: radius.md, padding: spacing.sm }}>
                        <Text style={{ color: colors.warningSoftText, fontSize: 12, fontWeight: '700' }}>
                          Reabrir deja esta constancia SIN efecto (queda en el histórico) y el rango vuelve a quedar sin marcar. El motivo es obligatorio.
                        </Text>
                        <TextInput
                          value={motivoReabrir}
                          onChangeText={setMotivoReabrir}
                          placeholder="Motivo (obligatorio): por qué se reabre…"
                          placeholderTextColor={colors.muted}
                          autoCorrect={false}
                          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, color: colors.text, marginTop: spacing.xs }}
                        />
                        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                          {boton(guardandoCierre ? 'Guardando…' : '↺ Sí, reabrir', () => confirmarReabrir(c.id), true, guardandoCierre || !motivoReabrir.trim())}
                          {boton('✕ Cancelar', () => { setReabriendo(null); setMotivoReabrir(''); }, false, guardandoCierre)}
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </Plegable>
          </View>
        ) : null}

        {!error && fueraDelPago.length ? (
          <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
            <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 13 }}>
              🚫 {viajesFuera} viaje(s) de camiones que no entran al pago
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>
              No suman ni salen arriba. Para pagarlos, ponlos «🚛 Por viaje» en «⚙️ Tarifas y camiones».
            </Text>
            {fueraDelPago.map((c) => (
              <Text key={c.machineryId} style={{ color: colors.text, fontSize: 12 }}>
                • {c.code} · {c.companyId ? datos?.empresas.get(c.companyId) ?? 'Empresa' : 'Sin empresa'} · {c.viajes} viaje(s)
                <Text style={{ color: colors.muted }}>{c.sinConfigurar ? ' · nunca se puso en el pago' : ' · se le quitó el pago por viaje'}</Text>
              </Text>
            ))}
          </View>
        ) : null}

        {!error && !cargando && datos && !empresas.length && !rangoInvalido ? (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
            {rangoAntesDelInicio
              ? `No hay nada que pagar: el pago por viaje arranca el ${dmy(INICIO_PAGO_VIAJES)} y el rango que elegiste es anterior.`
              : 'No hay viajes para pagar en ese rango. Revisa que los camiones estén marcados «por viaje» en «⚙️ Tarifas y camiones».'}
          </Text>
        ) : null}

        {empresas.map(({ clave, nombre, g }) => {
          const open = abierta === clave;
          return (
            <View key={clave} style={{ marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setAbierta(open ? null : clave)}
                style={{ borderWidth: 1, borderColor: g.pendientes ? colors.warning : colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>🏢 {nombre}</Text>
                  <Text style={{ color: colors.brandText, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{usd(g.montoUSD)}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {g.pagados} con tarifa{g.noFacturados ? ` · ${g.noFacturados} no facturó` : ''}{g.pendientes ? ` · ⚠️ ${g.pendientes} sin tarifa` : ''} · {open ? '▲ ocultar' : '▼ ver detalle'}
                </Text>
              </TouchableOpacity>
              {open ? <PagoViajesDetalle grupo={g} canEdit={canEdit} onChanged={cargar} /> : null}
            </View>
          );
        })}
      </Plegable>

      <PagoViajesPanel
        visible={panelOpen}
        onClose={() => setPanelOpen(false)}
        canEdit={canEdit}
        usuarioId={usuarioId}
        onChanged={cargar}
      />
    </>
  );
}
