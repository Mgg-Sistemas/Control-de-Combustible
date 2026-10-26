// ⚙️ CONTROL DE HORÓMETROS (02-oct-2026) — el apartado hermano de Control de
// jornadas, pero pagando por HORÓMETRO de trabajo.
//
// Pedido del cliente: «crear otro apartado como el de control de las jornadas,
// pero para los horómetros, para colocar los precios (…) que los dos existan y
// que puedan usar los dos sin que choque (…) asignar los precios también en un
// rango en específico (…) y un reporte aparte de los pagos en base a los
// horómetros».
//
// ⭐ NO TOCA NADA DE CONTROL DE JORNADAS. Lee las lecturas del horómetro de
//    trabajo y SUS PROPIOS precios (`horometro_precios`); no lee ni escribe
//    rondas, cierres ni el precio de la jornada. Se abre desde Control con un
//    botón y vive en su propio panel: quien no lo abra, no nota ningún cambio.
//
// Las reglas del cálculo están en `src/lib/pagoHorometro.ts` (puro y probado).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Screen, Card, SectionTitle } from './ui';
import { DateField } from './DateField';
import { Plegable } from './Plegable';
import { Toggle } from './CubicajeTab';
import { HorometroAjusteModal } from './HorometroAjusteModal';
import { HorometroCambioModal } from './HorometroCambioModal';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { caracasBusinessToday } from '../lib/caracasDay';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { LecturaTrabajo } from '../lib/horometroTrabajo';
import { cargarLecturasHorometro } from '../lib/horometroTrabajoDb';
import {
  AjusteHorometro, AgruparPagoHorometro, COLUMNAS_PAGO_HOROMETRO, CSS_PAGO_HOROMETRO, OPCIONES_PAGO_HOROMETRO, OpcionesPagoHorometro, PASTILLAS_PAGO_HOROMETRO,
  PrecioHorometro, CambioHorometro, MaquinaPago, cuerpoPagoHorometro, filasPagoHorometro, fmtHoras, gruposPagoHorometro, motivoAlertaDia, pagoPorEmpresa,
  sufijoArchivoPagoHorometro, textoPrecioHorometro, totalPagoHorometro, usd, validarPrecioHorometro,
  CierreHorometro, cierresSolapados, filasDeCierre, validarCierreHorometro,
} from '../lib/pagoHorometro';
import {
  MaquinaConReferencia, anularPrecioHorometro, cargarAjustesHorometro, cargarCambiosHorometro, cargarMaquinasPagoHorometro, cargarPreciosHorometro,
  crearPrecioHorometro, cargarCierresHorometro, crearCierreHorometro, reabrirCierreHorometro,
} from '../lib/pagoHorometroDb';

/** Cuántas máquinas se ofrecen de una vez en el selector (el resto, acotando con el buscador). */
const TOPE_MAQ = 40;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Puede poner y anular precios (escritura en Control y no ser analista). */
  canEdit: boolean;
  /** Puede CAMBIAR la lectura del inspector (módulo horómetros con escritura;
   *  admin = full). Sin esto igual puede ajustar «solo para horómetros». */
  puedeCorregirHoro: boolean;
};

type Logos = { bcv: boolean; sos: boolean; golden: boolean; renace: boolean; jhenzaen: boolean };

const dmy = (iso: string) => String(iso ?? '').slice(0, 10).split('-').reverse().join('/');
const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesDe = (iso: string) => sumarDias(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const aNumero = (t: string) => Number(String(t).replace(',', '.'));

export function ControlHorometrosPanel({ visible, onClose, canEdit, puedeCorregirHoro }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const hoy = caracasBusinessToday();

  const [desde, setDesde] = useState(() => lunesDe(hoy));
  const [hasta, setHasta] = useState(hoy);
  const [maquinas, setMaquinas] = useState<MaquinaConReferencia[]>([]);
  const [lecturas, setLecturas] = useState<LecturaTrabajo[]>([]);
  const [precios, setPrecios] = useState<PrecioHorometro[]>([]);
  // 🧾 Ajustes «solo para Control de horómetros»: mandan sobre la lectura del inspector.
  const [ajustes, setAjustes] = useState<AjusteHorometro[]>([]);
  // 🔒 Cierres: los días de un cierre activo se leen de su foto (no se recalculan).
  const [cierres, setCierres] = useState<CierreHorometro[]>([]);
  const [faltaCierres, setFaltaCierres] = useState(false);
  const [cierreNota, setCierreNota] = useState('');
  const [cerrando, setCerrando] = useState(false);
  const [reabrirId, setReabrirId] = useState<string | null>(null);
  const [reabrirMotivo, setReabrirMotivo] = useState('');
  // ➕ Listar también las máquinas operativas que no tienen lecturas en el rango.
  const [incluirSin, setIncluirSin] = useState(false);
  const [faltaSql, setFaltaSql] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  // Filtros (cambian QUÉ máquinas entran: el papel lo dice).
  const [busca, setBusca] = useState('');
  const [empresasSel, setEmpresasSel] = useState<Set<string>>(new Set());
  const [soloAlertas, setSoloAlertas] = useState(false);
  // 🚜 MÁQUINA EN ESPECÍFICO (11-oct-2026, a pedido: «no lo puedo sacar por
  //    máquina o por empresa?»). El buscador de texto de arriba ya acotaba, pero
  //    no dejaba elegir VARIAS máquinas sueltas que no comparten texto. Mismo
  //    patrón que los reportes de Reportes: se despliega, se busca y se marcan
  //    con casillas; las marcadas se ven SIEMPRE arriba, aunque el buscador no
  //    las traiga — un filtro que no se ve es un filtro que saca a escondidas.
  //    Vacío = todas. ⚠️ Esto SÍ cambia el total: el papel sale FILTRADO.
  const [maqSel, setMaqSel] = useState<Set<string>>(new Set());
  const [maqOpen, setMaqOpen] = useState(false);
  const [maqQ, setMaqQ] = useState('');
  // Editor de precio (se abre dentro de la fila de la máquina).
  const [abierta, setAbierta] = useState<string | null>(null);
  const [pPrecio, setPPrecio] = useState('');
  const [pDesde, setPDesde] = useState(hoy);
  const [pBlindar, setPBlindar] = useState(false);
  const [pHasta, setPHasta] = useState(hoy);
  const [pNota, setPNota] = useState('');
  const [pTodaEmpresa, setPTodaEmpresa] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [anularId, setAnularId] = useState<string | null>(null);
  const [anularMotivo, setAnularMotivo] = useState('');
  // Acomodar el horómetro de un día: solo para este módulo, o cambiando la del inspector.
  const [editLectura, setEditLectura] = useState<{ machineryId: string; code: string; fecha: string } | null>(null);
  // 🔁 Cambio de horómetro FÍSICO (10-oct-2026): aparato nuevo que sienta base.
  const [cambios, setCambios] = useState<CambioHorometro[]>([]);
  const [faltaCambios, setFaltaCambios] = useState(true);
  const [editCambio, setEditCambio] = useState<{ machineryId: string; code: string; fecha: string } | null>(null);
  // El PDF.
  const [opciones, setOpciones] = useState<OpcionesPagoHorometro>({ ...OPCIONES_PAGO_HOROMETRO });
  const [logos, setLogos] = useState<Logos>({ bcv: true, sos: true, golden: false, renace: false, jhenzaen: false });
  const [pdfBusy, setPdfBusy] = useState(false);

  const rangoInvalido = hasta < desde;

  const cargar = useCallback(async () => {
    if (rangoInvalido) return;
    setCargando(true); setError(null);
    try {
      const [ms, ls, ps, as, cs, cb] = await Promise.all([
        cargarMaquinasPagoHorometro(),
        cargarLecturasHorometro(desde, hasta),
        cargarPreciosHorometro(),
        cargarAjustesHorometro(desde, hasta),
        cargarCierresHorometro(),
        cargarCambiosHorometro(desde, hasta),
      ]);
      setMaquinas(ms); setLecturas(ls); setPrecios(ps.precios); setAjustes(as.ajustes);
      setCierres(cs.cierres); setFaltaCierres(cs.missing);
      // 🔁 Sin la tabla, el botón del cambio ni aparece y todo sigue como hoy.
      setCambios(cb.cambios); setFaltaCambios(cb.missing);
      setFaltaSql(ps.missing || as.missing);
      if (ps.error && !ps.missing) setError(ps.error);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, rangoInvalido]);

  useEffect(() => { if (visible) void cargar(); }, [visible, cargar, recarga]);

  // Las máquinas que Control de jornadas listaría: operativas y no «en espera».
  const activasIds = useMemo(() => new Set(maquinas.filter((m) => m.activa).map((m) => m.id)), [maquinas]);
  // Lo que de verdad se paga (y lo que se CIERRA): solo máquinas con algo en el rango.
  const filasConAlgo = useMemo(
    () => filasPagoHorometro({ maquinas, lecturas, precios, desde, hasta, ajustes, cierres, cambios }),
    [maquinas, lecturas, precios, desde, hasta, ajustes, cierres, cambios],
  );
  // Lo que se VE: lo anterior, más las máquinas sin lecturas si se pidió incluirlas.
  const filasTodas = useMemo(
    () => (incluirSin
      ? filasPagoHorometro({ maquinas, lecturas, precios, desde, hasta, ajustes, cierres, cambios, incluirSinLectura: activasIds })
      : filasConAlgo),
    [incluirSin, filasConAlgo, maquinas, lecturas, precios, desde, hasta, ajustes, cierres, cambios, activasIds],
  );
  const cierresDelRango = useMemo(() => cierresSolapados(cierres, desde, hasta), [cierres, desde, hasta]);
  const diasCerrados = useMemo(() => {
    const s = new Set<string>();
    filasConAlgo.forEach((f) => f.dias.forEach((d) => { if (d.cerrado) s.add(d.fecha); }));
    return s.size;
  }, [filasConAlgo]);
  const empresasDisp = useMemo(() => pagoPorEmpresa(filasTodas).map((e) => ({ nombre: e.empresa, maquinas: e.total.maquinas })), [filasTodas]);
  // Las máquinas que se pueden marcar: las del rango, acotadas por la empresa ya
  // elegida (si marcas una empresa, no tiene sentido ofrecer las de las otras) y
  // por lo que se escriba en el buscador del propio selector.
  const maqsDisp = useMemo(() => {
    const q = norm(maqQ).trim();
    return filasTodas
      .map((f) => f.maquina)
      .filter((m) => (empresasSel.size === 0 || empresasSel.has(m.empresa))
        && (!q || norm(`${m.code} ${m.placa} ${m.empresa} ${m.marca} ${m.modelo}`).includes(q)))
      .sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
  }, [filasTodas, maqQ, empresasSel]);
  // Las marcadas salen siempre, vengan o no en la búsqueda de arriba.
  const maqMarcadas = useMemo(
    () => filasTodas.map((f) => f.maquina).filter((m) => maqSel.has(m.id)).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true })),
    [filasTodas, maqSel],
  );
  const alternarMaq = (id: string) => setMaqSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const etiquetaMaq = (m: MaquinaPago) => [m.code, m.placa].filter(Boolean).join(' · ');
  const filas = useMemo(() => {
    const q = norm(busca).trim();
    return filasTodas.filter((f) =>
      (empresasSel.size === 0 || empresasSel.has(f.maquina.empresa))
      && (maqSel.size === 0 || maqSel.has(f.maquina.id))
      && (!soloAlertas || f.alertas > 0)
      && (!q || norm(`${f.maquina.code} ${f.maquina.placa} ${f.maquina.empresa} ${f.maquina.marca} ${f.maquina.modelo}`).includes(q)));
  }, [filasTodas, busca, empresasSel, maqSel, soloAlertas]);
  const tot = useMemo(() => totalPagoHorometro(filas), [filas]);
  // 👤 Los bloques de la pantalla y del papel: por empresa (hoy) o por encargado.
  //    Agrupar NO filtra: las mismas máquinas, el mismo total, otros subtotales.
  const agruparPor = opciones.agruparPor;
  const grupos = useMemo(() => gruposPagoHorometro(filas, agruparPor), [filas, agruparPor]);
  const filtrado = empresasSel.size > 0 || maqSel.size > 0 || !!busca.trim() || soloAlertas;
  const referencia = useMemo(() => new Map(maquinas.map((m) => [m.id, m.precioJornada])), [maquinas]);
  // La ficha de hoy por id: completa encargado/placa/serial en la foto de un cierre viejo.
  const fichas = useMemo(() => new Map<string, MaquinaPago>(maquinas.map((m) => [m.id, m])), [maquinas]);

  const abrirPrecio = (id: string, vigente: number | null) => {
    if (abierta === id) { setAbierta(null); return; }
    setAbierta(id);
    setPPrecio(vigente != null ? String(vigente) : '');
    setPDesde(desde); setPBlindar(false); setPHasta(hasta); setPNota(''); setPTodaEmpresa(false);
    setAnularId(null); setAnularMotivo('');
  };

  const guardarPrecio = async (id: string, empresa: string) => {
    if (guardando) return;
    const precio = aNumero(pPrecio);
    const malo = validarPrecioHorometro({ precio, desde: pDesde, hasta: pBlindar ? pHasta : null });
    if (malo) { toast.error(malo); return; }
    const ids = pTodaEmpresa ? filas.filter((f) => f.maquina.empresa === empresa).map((f) => f.maquina.id) : [id];
    setGuardando(true);
    const r = await crearPrecioHorometro({ machineryIds: ids, precioHora: precio, desde: pDesde, hasta: pBlindar ? pHasta : null, nota: pNota });
    setGuardando(false);
    if (r.error) { toast.error(r.error); return; }
    toast.success(`${usd(precio)}/h para ${r.guardadas} máquina(s) ${pBlindar ? `del ${dmy(pDesde)} al ${dmy(pHasta)} (blindado)` : `desde el ${dmy(pDesde)}`}. Lo anterior a esa fecha no cambia.`);
    setAbierta(null);
    setRecarga((n) => n + 1);
  };

  const anular = async () => {
    if (!anularId) return;
    const r = await anularPrecioHorometro(anularId, anularMotivo);
    if (r.error) { toast.error(r.error); return; }
    toast.success('Precio anulado. Los días que cubría vuelven al precio anterior (o quedan sin precio).');
    setAnularId(null); setAnularMotivo('');
    setRecarga((n) => n + 1);
  };

  /** 🔒 Cierra el rango: guarda la FOTO de todo lo que se paga (sin filtros). */
  const cerrarRango = async () => {
    if (cerrando) return;
    const malo = validarCierreHorometro({ desde, hasta, filas: filasConAlgo }, cierres);
    if (malo) { toast.error(malo); return; }
    const t0 = totalPagoHorometro(filasConAlgo);
    const ok = await confirm({
      title: 'Cerrar el rango',
      message:
        `Se va a CERRAR del ${dmy(desde)} al ${dmy(hasta)}: ${t0.maquinas} máquina(s), ${fmtHoras(t0.horas)} h, ${usd(t0.monto)}.` +
        '\n\nQueda guardada la foto de ese pago. Desde ahora, cambiar un precio, una lectura o un ajuste NO mueve esos días.' +
        (t0.alertas ? `\n\n⚠️ Hay ${t0.alertas} día(s) por revisar que hoy valen $0. Si cierras así, quedan en $0 en el cierre.` : '') +
        (filtrado || incluirSin ? '\n\nOJO: el cierre incluye TODAS las máquinas con lecturas del rango, no solo las que estás viendo con el filtro.' : '') +
        '\n\nSe puede reabrir después, con motivo.',
      confirmText: '🔒 Cerrar',
    });
    if (!ok) return;
    setCerrando(true);
    const r = await crearCierreHorometro({ desde, hasta, filas: filasConAlgo, nota: cierreNota });
    setCerrando(false);
    if (r.error) { toast.error(r.error); return; }
    toast.success(`🔒 Rango cerrado: ${usd(t0.monto)}. Está en el histórico de cierres.`);
    setCierreNota('');
    setRecarga((n) => n + 1);
  };

  const reabrir = async () => {
    if (!reabrirId) return;
    const r = await reabrirCierreHorometro(reabrirId, reabrirMotivo);
    if (r.error) { toast.error(r.error); return; }
    toast.success('Cierre reabierto: esos días vuelven a calcularse con los datos de hoy.');
    setReabrirId(null); setReabrirMotivo('');
    setRecarga((n) => n + 1);
  };

  /** El PDF de un cierre del histórico: sale de su FOTO, no de los datos de hoy. */
  const pdfDeCierre = async (c: CierreHorometro) => {
    try {
      const html = pdfDocument({
        title: 'Pago por horómetro · Cierre',
        subtitle: `Cierre del ${dmy(c.desde)} al ${dmy(c.hasta)} · cerrado el ${dmy(String(c.created_at ?? ''))}${c.created_by_nombre ? ` por ${c.created_by_nombre}` : ''}${c.anulada_at ? ' · REABIERTO' : ''}`,
        extraCss: CSS_PAGO_HOROMETRO,
        // El precio de Control es el de HOY (referencia viva): un cierre viejo lo
        // muestra como dato de hoy, no como foto del cierre. Los montos no cambian.
        body: cuerpoPagoHorometro({ desde: c.desde, hasta: c.hasta, filas: filasDeCierre(c, fichas) }, opciones, referencia),
        logos,
        marcaTexto: false,
      });
      await exportPdf(html, `Cierre de horometro ${dmy(c.desde)} a ${dmy(c.hasta)}${sufijoArchivoPagoHorometro(opciones)}`.replace(/\//g, '-'));
    } catch (e: any) {
      toast.error(`No se pudo generar el PDF: ${String(e?.message ?? e)}`);
    }
  };

  const descargarPdf = async () => {
    if (pdfBusy || !filas.length) return;
    setPdfBusy(true);
    try {
      const html = pdfDocument({
        title: 'Pago por horómetro',
        // El FILTRO sí se dice (cambia el total). Lo OCULTO con pastillas, no: no deja rastro.
        subtitle: `Del ${dmy(desde)} al ${dmy(hasta)} · por horómetro de trabajo${filtrado ? ' · FILTRADO' : ''}`,
        extraCss: CSS_PAGO_HOROMETRO,
        body: cuerpoPagoHorometro({ desde, hasta, filas }, opciones, referencia),
        logos,
        marcaTexto: false,
      });
      await exportPdf(html, `Pago por horometro ${dmy(desde)} a ${dmy(hasta)}${filtrado ? ' (filtrado)' : ''}${sufijoArchivoPagoHorometro(opciones)}`.replace(/\//g, '-'));
    } catch (e: any) {
      toast.error(`No se pudo generar el PDF: ${String(e?.message ?? e)}`);
    } finally {
      setPdfBusy(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const chip = (on: boolean, aviso = false) => ({ paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : aviso ? colors.warning : colors.border, backgroundColor: on ? colors.brand : colors.surface });
  const chipTxt = (on: boolean) => ({ color: on ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });
  const atajo = (label: string, d: string, h: string) => {
    const on = desde === d && hasta === h;
    return (
      <TouchableOpacity key={label} onPress={() => { setDesde(d); setHasta(h); }} style={chip(on)}>
        <Text style={chipTxt(on)}>{label}</Text>
      </TouchableOpacity>
    );
  };
  const alternarEmpresa = (n: string) => setEmpresasSel((prev) => { const s = new Set(prev); if (s.has(n)) s.delete(n); else s.add(n); return s; });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <TouchableOpacity onPress={onClose} style={{ paddingVertical: spacing.xs, marginBottom: spacing.xs }}>
          <Text style={{ color: colors.brandText, fontWeight: '800' }}>← Volver a Control de jornadas</Text>
        </TouchableOpacity>
        <SectionTitle>⚙️ Control de horómetros</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          Lo que corresponde pagar por las HORAS DE HORÓMETRO de cada máquina (final − inicial de cada turno), con su
          propio precio por hora. Es independiente de Control de jornadas: no lee ni cambia sus horas, sus precios ni sus
          cierres. Cada día se paga con el precio que regía ese día.
        </Text>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {faltaSql ? (
            <View style={{ borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
              <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>
                ⚠️ Todavía no existen en la base las tablas de precios y de ajustes de horómetro. Las horas ya se ven; los
                precios, los montos y los ajustes aparecen en cuanto el administrador las cree.
              </Text>
            </View>
          ) : null}
          {error ? <Text style={{ color: colors.danger, fontWeight: '700', marginBottom: spacing.sm }}>⚠️ {error}</Text> : null}

          <Card>
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
            <TextInput value={busca} onChangeText={setBusca} placeholder="🔎 Buscar máquina: código, placa, serial, empresa, marca…" placeholderTextColor={colors.muted} autoCorrect={false} style={{ ...input, marginTop: spacing.sm }} />
            {empresasDisp.length > 1 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                <TouchableOpacity onPress={() => setEmpresasSel(new Set())} style={chip(empresasSel.size === 0)}>
                  <Text style={chipTxt(empresasSel.size === 0)}>✅ Todas las empresas</Text>
                </TouchableOpacity>
                {empresasDisp.map((e) => (
                  <TouchableOpacity key={e.nombre} onPress={() => alternarEmpresa(e.nombre)} style={chip(empresasSel.has(e.nombre))}>
                    <Text style={chipTxt(empresasSel.has(e.nombre))}>{e.nombre} ({e.maquinas})</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {/* 👤 Agrupar por empresa o por encargado (26-oct-2026). No filtra: mismo total. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800' }}>Agrupar por:</Text>
              {([['empresa', '🏢 Empresa'], ['encargado', '👤 Encargado']] as [AgruparPagoHorometro, string][]).map(([k, label]) => (
                <TouchableOpacity key={k} onPress={() => setOpciones((o) => ({ ...o, agruparPor: k }))} style={chip(agruparPor === k)}>
                  <Text style={chipTxt(agruparPor === k)}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* 🚜 Máquina en específico: el mismo selector de los reportes de Reportes. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setMaqOpen((v) => !v)} style={chip(maqOpen || maqSel.size > 0)}>
                <Text style={chipTxt(maqOpen || maqSel.size > 0)}>
                  {maqOpen ? '▾' : '▸'} 🚜 Buscar máquina en específico (marca una o varias){maqSel.size ? ` · ${maqSel.size} marcada(s)` : ''}
                </Text>
              </TouchableOpacity>
              {maqSel.size > 0 ? (
                <TouchableOpacity onPress={() => setMaqSel(new Set())}>
                  <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>Limpiar ({maqSel.size})</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {maqMarcadas.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                {maqMarcadas.map((m) => (
                  <TouchableOpacity key={'sel' + m.id} onPress={() => alternarMaq(m.id)} style={chip(true)}>
                    <Text style={chipTxt(true)}>☑ {etiquetaMaq(m)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {maqOpen ? (
              <>
                <TextInput value={maqQ} onChangeText={setMaqQ} placeholder="Buscar por código, placa, serial o marca…" placeholderTextColor={colors.muted} autoCorrect={false} style={{ ...input, marginTop: spacing.xs }} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                  {maqsDisp.slice(0, TOPE_MAQ).map((m) => (
                    <TouchableOpacity key={m.id} onPress={() => alternarMaq(m.id)} style={chip(maqSel.has(m.id))}>
                      <Text style={chipTxt(maqSel.has(m.id))}>{maqSel.has(m.id) ? '☑' : '☐'} {etiquetaMaq(m)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                  {maqsDisp.length === 0 ? 'Ninguna máquina coincide.' : maqsDisp.length > TOPE_MAQ ? `Se muestran ${TOPE_MAQ} de ${maqsDisp.length}: escribe para acotar.` : `${maqsDisp.length} máquina(s).`}
                </Text>
              </>
            ) : null}
            {maqSel.size > 0 ? (
              <Text style={{ color: colors.warning, fontSize: 11, marginTop: 4 }}>
                ⚠️ Esto SÍ saca máquinas y cambia el total: el papel sale marcado FILTRADO. El cierre 🔒 no se filtra: siempre guarda la foto de todas.
              </Text>
            ) : null}
            <Toggle on={soloAlertas} label="⚠️ Solo las máquinas con días por revisar" ayuda="Lecturas inválidas o incompletas, y horas sin precio." onPress={() => setSoloAlertas((v) => !v)} />
            <Toggle on={incluirSin} label="➕ Incluir las máquinas sin lecturas en el rango" ayuda="Las operativas que lista Control (no las que están en espera). Salen con 0 h, para ponerles precio o acomodarles un día. No entran al total ni al cierre." onPress={() => setIncluirSin((v) => !v)} />
          </Card>

          <View style={{ backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.brandContrast, fontSize: 11, fontWeight: '800' }}>TOTAL A PAGAR POR HORÓMETRO{filtrado ? ' · FILTRADO' : ''}</Text>
            <Text style={{ color: colors.brandContrast, fontSize: 22, fontWeight: '900' }}>{usd(tot.monto)}</Text>
            <Text style={{ color: colors.brandContrast, fontSize: 12 }}>
              {fmtHoras(tot.horas)} h · {tot.maquinas} máquina(s){tot.alertas ? ` · ⚠️ ${tot.alertas} día(s) por revisar` : ''}{tot.sinPrecio ? ` · ${tot.sinPrecio} sin precio` : ''}
            </Text>
          </View>

          {diasCerrados > 0 ? (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>🔒 {diasCerrados} día(s) de este rango están CERRADOS</Text>
              <Text style={{ color: colors.muted, fontSize: 11 }}>Sus horas y montos salen de la foto del cierre y no cambian aunque se toque un precio, una lectura o un ajuste. Para modificarlos hay que reabrir el cierre.</Text>
            </View>
          ) : null}

          {canEdit && !faltaCierres ? (
            <Plegable
              titulo="🔒 Cerrar este rango"
              resumen={cierresDelRango.length ? 'este rango ya tiene días cerrados' : `${dmy(desde)} al ${dmy(hasta)} · ${usd(totalPagoHorometro(filasConAlgo).monto)}`}
              alerta={cierresDelRango.length > 0}
            >
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                Cerrar guarda la FOTO del pago del {dmy(desde)} al {dmy(hasta)} (todas las máquinas con lecturas, sin filtros) y la deja en el
                histórico. Desde ahí esos días no cambian aunque después se toque un precio, una lectura o un ajuste. Se puede reabrir con motivo.
              </Text>
              <TextInput value={cierreNota} onChangeText={setCierreNota} placeholder="Nota del cierre (opcional)" placeholderTextColor={colors.muted} style={{ ...input, marginTop: spacing.sm }} />
              <TouchableOpacity onPress={cerrarRango} disabled={cerrando || rangoInvalido}
                style={{ marginTop: spacing.sm, backgroundColor: colors.danger, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: cerrando || rangoInvalido ? 0.5 : 1 }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>{cerrando ? 'Cerrando…' : `🔒 Cerrar del ${dmy(desde)} al ${dmy(hasta)}`}</Text>
              </TouchableOpacity>
            </Plegable>
          ) : null}

          {!faltaCierres ? (
            <Plegable
              titulo="🗂️ Histórico de cierres"
              resumen={cierres.length ? `${cierres.filter((c) => !c.anulada_at).length} cierre(s) vigente(s) · ${cierres.filter((c) => c.anulada_at).length} reabierto(s)` : 'todavía no hay cierres'}
            >
              {cierres.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>Todavía no se ha cerrado ningún rango.</Text>
              ) : cierres.map((c) => (
                <View key={c.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1, paddingRight: spacing.sm }}>
                      <Text style={{ color: c.anulada_at ? colors.muted : colors.text, fontWeight: '800', fontSize: 13, textDecorationLine: c.anulada_at ? 'line-through' : 'none' }}>
                        {c.anulada_at ? '↺' : '🔒'} {dmy(c.desde)} al {dmy(c.hasta)} · {usd(Number(c.total_monto))}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>
                        {c.maquinas} máquina(s) · {fmtHoras(Number(c.total_horas))} h · cerrado el {dmy(String(c.created_at ?? ''))}{c.created_by_nombre ? ` por ${c.created_by_nombre}` : ''}
                      </Text>
                      {c.nota ? <Text style={{ color: colors.muted, fontSize: 11 }}>{c.nota}</Text> : null}
                      {c.anulada_at ? <Text style={{ color: colors.warning, fontSize: 11 }}>Reabierto: {c.anulada_motivo || 'sin motivo'}</Text> : null}
                    </View>
                    <TouchableOpacity onPress={() => pdfDeCierre(c)} style={{ paddingHorizontal: spacing.sm }}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>📄 PDF</Text>
                    </TouchableOpacity>
                    {canEdit && !c.anulada_at ? (
                      <TouchableOpacity onPress={() => { setReabrirId(reabrirId === c.id ? null : c.id); setReabrirMotivo(''); }}>
                        <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>↺ Reabrir</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {reabrirId === c.id ? (
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
                      <TextInput value={reabrirMotivo} onChangeText={setReabrirMotivo} placeholder="Motivo para reabrir (obligatorio)" placeholderTextColor={colors.muted} style={{ ...input, flex: 1 }} />
                      <TouchableOpacity onPress={reabrir} style={{ backgroundColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' }}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Reabrir</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              ))}
            </Plegable>
          ) : null}

          <Plegable
            titulo="📄 Reporte de pago por horómetro"
            resumen={`${tot.maquinas} máquina(s) · ${usd(tot.monto)}${filtrado ? ' · filtrado' : ''}`}
          >
            {/* 📋 Columnas de la ficha (26-oct-2026): pastillas POSITIVAS, encendida = sale. */}
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>📋 QUÉ COLUMNAS DE LA MÁQUINA LLEVA (encendida = sale)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {COLUMNAS_PAGO_HOROMETRO.map((p) => (
                <TouchableOpacity key={p.key} onPress={() => setOpciones((o) => ({ ...o, [p.key]: !o[p.key] }))} style={chip(!opciones[p.key])}>
                  <Text style={chipTxt(!opciones[p.key])}>{opciones[p.key] ? '☐' : '☑'} {p.chip}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, marginBottom: spacing.sm }}>Placa, Serial y Encargado nacen apagadas. Lo apagado no deja rastro en el papel: va al nombre del archivo.</Text>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>🖨️ ¿QUÉ SE OCULTA EN EL PDF?</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {PASTILLAS_PAGO_HOROMETRO.map((p) => (
                <TouchableOpacity key={p.key} onPress={() => setOpciones((o) => ({ ...o, [p.key]: !o[p.key] }))} style={chip(opciones[p.key])}>
                  <Text style={chipTxt(opciones[p.key])}>{p.chip}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Encendida = NO sale. Ocultar no cambia el total; filtrar sí.</Text>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm }}>🏷️ QUÉ LOGOS LLEVA EL MEMBRETE</Text>
            {([['bcv', '🏦 Banco Central de Venezuela'], ['sos', '🛟 SOS La Guaira'], ['golden', '✨ Golden Touch'], ['renace', '🇻🇪 Plan Venezuela Renace'], ['jhenzaen', '🏗️ Jhenzaen 2.012 C.A']] as const).map(([k, label]) => (
              <Toggle key={k} on={logos[k]} label={label} onPress={() => setLogos((l) => ({ ...l, [k]: !l[k] }))} />
            ))}
            <TouchableOpacity onPress={descargarPdf} disabled={pdfBusy || !filas.length}
              style={{ marginTop: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: pdfBusy || !filas.length ? 0.5 : 1 }}>
              <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{pdfBusy ? 'Generando…' : '📄 PDF del pago por horómetro'}</Text>
            </TouchableOpacity>
          </Plegable>

          {cargando && !filas.length ? <Text style={{ color: colors.muted, marginTop: spacing.sm }}>Cargando…</Text> : null}
          {!cargando && !filas.length && !rangoInvalido ? (
            <Card>
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {filasTodas.length ? 'Ninguna máquina coincide con el filtro.' : 'No hay lecturas de horómetro en ese rango. Las cargan los inspectores al iniciar y finalizar la jornada.'}
              </Text>
            </Card>
          ) : null}

          {grupos.map((g) => (
            <Card key={g.key}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '900', flex: 1 }}>{agruparPor === 'encargado' ? '👤' : '🏢'} {g.label}</Text>
                <Text style={{ color: colors.brandText, fontWeight: '900' }}>{usd(g.total.monto)}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{g.total.maquinas} máquina(s) · {fmtHoras(g.total.horas)} h</Text>
              {g.filas.map((f) => {
                const m = f.maquina;
                const dias = f.dias.filter((d) => d.estado !== 'sin_lectura');
                const histo = precios.filter((p) => p.machinery_id === m.id).sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
                const ref = referencia.get(m.id) ?? null;
                return (
                  <View key={m.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ flex: 1, paddingRight: spacing.sm }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{m.code}{m.placa ? ` · ${m.placa}` : ''}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>
                          {[m.marca, m.modelo].filter(Boolean).join(' ') || ' '}
                          {/* 👤 Por encargado, cada fila recuerda su empresa; por empresa, su encargado. */}
                          {agruparPor === 'encargado' ? `  ·  🏢 ${m.empresa}` : m.encargado ? `  ·  👤 ${m.encargado}` : ''}
                          {'  '}{f.precioVigente != null ? `💲 ${usd(f.precioVigente)}/h${f.variosPrecios ? ' (cambió en el rango)' : ''}` : '⚠️ sin precio por hora'}
                          {/* 19-oct-2026: el precio ya colocado en Control (por jornada de 12 h),
                              visible para todos como referencia — antes solo salía dentro del editor. */}
                          {(() => { const p = referencia.get(m.id); return p != null && p > 0 ? `  ·  📋 Control: ${usd(p)}/jornada (${usd(p / 12)}/h)` : ''; })()}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>{usd(f.monto)}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{fmtHoras(f.horas)} h</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {dias.map((d) => {
                        const aviso = !!motivoAlertaDia(d);
                        return (
                          <TouchableOpacity key={d.fecha} disabled={!canEdit || faltaSql || d.cerrado}
                            onPress={() => setEditLectura({ machineryId: m.id, code: m.code, fecha: d.fecha })}
                            style={chip(false, aviso)}>
                            <Text style={{ color: aviso ? colors.warning : colors.text, fontWeight: '700', fontSize: 11 }}>
                              {d.cerrado ? '🔒 ' : ''}{aviso ? '⚠️ ' : ''}{d.ajustado ? '🧾 ' : ''}{d.cambio ? '🔁 ' : ''}{dmy(d.fecha).slice(0, 5)} · {fmtHoras(d.horas)} h{d.precio != null && d.horas > 0 ? ` · ${usd(d.monto)}` : ''}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {f.alertas > 0 ? (
                      <Text style={{ color: colors.warning, fontSize: 11, marginTop: 2 }}>
                        {dias.map((d) => { const mo = motivoAlertaDia(d); return mo ? `${dmy(d.fecha).slice(0, 5)}: ${mo}` : ''; }).filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                    {canEdit && !faltaSql ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: 4 }}>
                        <TouchableOpacity onPress={() => abrirPrecio(m.id, f.precioVigente)}>
                          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>{abierta === m.id ? '▲ Cerrar precio' : '💲 Poner / cambiar precio por hora'}</Text>
                        </TouchableOpacity>
                        {/* 🧾 Acomodar un día cualquiera (también uno SIN lectura del inspector). */}
                        <TouchableOpacity onPress={() => setEditLectura({ machineryId: m.id, code: m.code, fecha: hasta })}>
                          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>🧾 Acomodar el horómetro de un día</Text>
                        </TouchableOpacity>
                        {/* 🔁 Cambio de horómetro FÍSICO: exige el permiso de corregir horómetros
                            (escribe la lectura del día con reinicio) y que exista la tabla. */}
                        {puedeCorregirHoro && !faltaCambios ? (
                          <TouchableOpacity onPress={() => setEditCambio({ machineryId: m.id, code: m.code, fecha: hasta })}>
                            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>🔁 Cambio de horómetro</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : null}

                    {abierta === m.id ? (
                      <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginTop: spacing.xs }}>
                        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Precio por HORA de horómetro (USD)</Text>
                        <TextInput value={pPrecio} onChangeText={setPPrecio} keyboardType="numeric" inputMode="decimal" placeholder="0,00" placeholderTextColor={colors.muted} style={input} />
                        {aNumero(pPrecio) > 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Equivale a {usd(aNumero(pPrecio) * 12)} por 12 horas de horómetro.</Text>
                        ) : null}
                        {ref != null ? (
                          <TouchableOpacity onPress={() => setPPrecio(String(Math.round((ref / 12) * 100) / 100))}>
                            <Text style={{ color: colors.brandText, fontSize: 11, marginTop: 2 }}>
                              Referencia: en Control de jornadas la jornada vale {usd(ref)} → {usd(ref / 12)}/h · tocar para usarlo
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Rige desde</Text>
                        <DateField value={pDesde} onChange={setPDesde} />
                        <Toggle on={pBlindar} label="🔒 Blindar a un rango de fechas" ayuda="Rige SOLO entre esas fechas y manda sobre el precio abierto. Apagado: rige desde esa fecha en adelante." onPress={() => setPBlindar((v) => !v)} />
                        {pBlindar ? (
                          <View>
                            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Hasta (inclusive)</Text>
                            <DateField value={pHasta} onChange={setPHasta} />
                          </View>
                        ) : null}
                        <TextInput value={pNota} onChangeText={setPNota} placeholder="Nota (opcional)" placeholderTextColor={colors.muted} style={{ ...input, marginTop: spacing.sm }} />
                        <Toggle on={pTodaEmpresa} label={`Aplicar a TODAS las máquinas de ${m.empresa} que se ven (${filas.filter((x) => x.maquina.empresa === m.empresa).length})`} onPress={() => setPTodaEmpresa((v) => !v)} />
                        <TouchableOpacity onPress={() => guardarPrecio(m.id, m.empresa)} disabled={guardando}
                          style={{ backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', marginTop: spacing.xs, opacity: guardando ? 0.6 : 1 }}>
                          <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{guardando ? 'Guardando…' : '💾 Guardar precio'}</Text>
                        </TouchableOpacity>
                        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Un precio nuevo no cambia los días anteriores a su fecha. No se edita ni se borra: se anula.</Text>

                        {histo.length ? (
                          <View style={{ marginTop: spacing.sm }}>
                            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>HISTORIAL DE PRECIOS DE ESTA MÁQUINA</Text>
                            {histo.map((p) => (
                              <View key={p.id} style={{ paddingVertical: 3, borderTopWidth: 1, borderTopColor: colors.border }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                  <Text style={{ color: p.anulada_at ? colors.muted : colors.text, fontSize: 12, flex: 1, textDecorationLine: p.anulada_at ? 'line-through' : 'none' }}>
                                    {textoPrecioHorometro(p)}{p.created_by_nombre ? ` · ${p.created_by_nombre}` : ''}
                                  </Text>
                                  {!p.anulada_at ? (
                                    <TouchableOpacity onPress={() => { setAnularId(anularId === p.id ? null : p.id); setAnularMotivo(''); }}>
                                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>Anular</Text>
                                    </TouchableOpacity>
                                  ) : null}
                                </View>
                                {p.anulada_at ? <Text style={{ color: colors.muted, fontSize: 11 }}>Anulado: {p.anulada_motivo || 'sin motivo'}</Text> : null}
                                {p.nota ? <Text style={{ color: colors.muted, fontSize: 11 }}>{p.nota}</Text> : null}
                                {anularId === p.id ? (
                                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
                                    <TextInput value={anularMotivo} onChangeText={setAnularMotivo} placeholder="Motivo de la anulación (obligatorio)" placeholderTextColor={colors.muted} style={{ ...input, flex: 1 }} />
                                    <TouchableOpacity onPress={anular} style={{ backgroundColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' }}>
                                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Anular</Text>
                                    </TouchableOpacity>
                                  </View>
                                ) : null}
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          ))}
          <View style={{ height: spacing.lg }} />
        </ScrollView>

        {editLectura ? (
          <HorometroAjusteModal
            code={editLectura.code}
            machineryId={editLectura.machineryId}
            roundDate={editLectura.fecha}
            lecturas={lecturas.filter((l) => l.machineryId === editLectura.machineryId)}
            ajustes={ajustes.filter((a) => a.machinery_id === editLectura.machineryId)}
            puedeCambiarInspector={puedeCorregirHoro}
            onClose={() => setEditLectura(null)}
            onSaved={(mensaje) => { toast.success(mensaje); setRecarga((n) => n + 1); }}
          />
        ) : null}
        {editCambio ? (
          <HorometroCambioModal
            code={editCambio.code}
            machineryId={editCambio.machineryId}
            roundDate={editCambio.fecha}
            lecturas={lecturas.filter((l) => l.machineryId === editCambio.machineryId)}
            cambios={cambios.filter((c) => c.machinery_id === editCambio.machineryId)}
            onClose={() => setEditCambio(null)}
            onSaved={(mensaje) => { toast.success(mensaje); setRecarga((n) => n + 1); }}
          />
        ) : null}
      </Screen>
    </Modal>
  );
}
