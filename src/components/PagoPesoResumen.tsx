// PAGO POR PESO · lo que hay que pagar (03-oct-2026).
//
// Tarjeta hermana de «💰 Pago de viajes» en el panel de información de Viajes de
// camiones, calcada de PagoViajesResumen. Pedido del cliente: «un reporte aparte del
// de viajes (…) uno por peso; de normal se paga por el peso que cargue el camión».
// Por rango de fechas (por jornada, 7am a 7am): cada empresa con sus viajes pagados
// por el NETO de la romana (bruto − tara) × el precio por tonelada o por kilo que
// rija ese día. Tocar una empresa abre el detalle por camión y por viaje.
//
// ⭐ TODO camión entra (no hay «modo» como en el pago por viaje). Un viaje sin peso
//    sale «sin peso» y no se paga. La marca «no facturó» del pago por viaje se
//    respeta: acá NO se marca (eso se hace en «💰 Pago de viajes»).
// ⭐ Vive SOLO en este módulo: no toca jornadas, Control de Maquinaria ni Control de Pagos.
// ⭐ Las reglas de dinero están en src/lib/pagoPeso.ts; acá solo se pinta y se llama.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Plegable } from './Plegable';
import { DateField } from './DateField';
import { Toggle } from './CubicajeTab';
import { PagoPesoPanel } from './PagoPesoPanel';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { exportPdf, pdfDocument } from '../lib/pdf';
import {
  CSS_PAGO_PESO,
  EjePeso,
  FiltroPeso,
  LineaPeso,
  MotivoSinPagoPeso,
  OPCIONES_PESO_POR_DEFECTO,
  OpcionesPagoPeso,
  PASTILLAS_PESO,
  UnidadTarifaPeso,
  acotarFiltroPeso,
  alternarPeso,
  bloquesPeso,
  calcularPagoPeso,
  cuerpoPagoPeso,
  empresasDisponiblesPeso,
  etiquetaMotivoSinPagoPeso,
  filtrarLineasPeso,
  filtroPesoActivo,
  frentesDisponiblesPeso,
  indexarMarcasPeso,
  jornadaDeInstantePeso,
  maquinaDeLineaPeso,
  maquinasDisponiblesPeso,
  obrasDisponiblesPeso,
  ocultosPesoEnPalabras,
  pesoTexto,
  renglonesPorCamionPeso,
  sufijoArchivoPeso,
  tarjetasResumenPeso,
  textoPrecioPeso,
  totalPeso,
  usd,
  viajesPesoEnRango,
} from '../lib/pagoPeso';
import { cargarDatosPagoPeso, DatosPagoPeso, INICIO_PAGO_PESO } from '../lib/pagoPesoDb';

type Props = {
  canEdit: boolean;
  usuarioId: string | null;
};

const dmy = (iso: string) => {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesDe = (iso: string) => sumarDias(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
const primeroDelMes = (iso: string) => `${iso.slice(0, 7)}-01`;
// Hora de Caracas (UTC−4 fijo) de un instante ISO, para el detalle viaje por viaje.
const horaCaracas = (iso: string) => {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t - 4 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

type Logos = { bcv: boolean; sos: boolean; golden: boolean };
// 🏷️ Regla de la casa en Viajes de camiones: el papel nace SIN logos y sin la marca
//    en texto «BCV / SOS»; el que lo necesite enciende el logo.
const LOGOS_POR_DEFECTO: Logos = { bcv: false, sos: false, golden: false };
const LOGOS: { k: keyof Logos; label: string }[] = [
  { k: 'bcv', label: '🏦 Banco Central de Venezuela' },
  { k: 'sos', label: '🛟 SOS La Guaira' },
  { k: 'golden', label: '✨ Golden Touch' },
];

export function PagoPesoResumen({ canEdit, usuarioId }: Props) {
  const { colors } = useTheme();
  const hoy = jornadaDeInstantePeso(new Date().toISOString());
  const [desde, setDesde] = useState(() => lunesDe(hoy));
  const [hasta, setHasta] = useState(hoy);
  const [datos, setDatos] = useState<DatosPagoPeso | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [camionAbierto, setCamionAbierto] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // ⚖️ Unidad de PANTALLA y de PAPEL: toneladas (lo normal) o kilos. No cambia el
  //    cálculo (todo se lleva en kilos por dentro), solo cómo se lee.
  const [unidad, setUnidad] = useState<UnidadTarifaPeso>('ton');
  // ── Opciones del PDF ── filtran SOLO el papel: la tarjeta de arriba sigue
  //    mostrando el pago completo del rango, y el papel dice que está filtrado.
  const [empresasSel, setEmpresasSel] = useState<Set<string>>(new Set());
  const [obrasSel, setObrasSel] = useState<Set<string>>(new Set());
  const [frentesSel, setFrentesSel] = useState<Set<string>>(new Set());
  const [maquinasSel, setMaquinasSel] = useState<Set<string>>(new Set());
  const [buscaMaq, setBuscaMaq] = useState('');
  const [ejePdf, setEjePdf] = useState<EjePeso>('empresa');
  const [opcionesPdf, setOpcionesPdf] = useState<OpcionesPagoPeso>(OPCIONES_PESO_POR_DEFECTO);
  const [logos, setLogos] = useState<Logos>(LOGOS_POR_DEFECTO);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await cargarDatosPagoPeso());
      setError(null);
    } catch (e: any) {
      setError(`No se pudo leer el pago por peso (${e?.message ?? 'revisa la conexión'}). No se muestran montos a medias: toca «Actualizar».`);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Todo sale de ESTAS líneas: la pantalla, el total y el papel. El papel no recalcula.
  const lineas = useMemo<LineaPeso[]>(() => {
    if (!datos || error) return [];
    return calcularPagoPeso({
      viajes: viajesPesoEnRango(datos.viajes, desde, hasta),
      tarifas: datos.tarifas,
      marcas: indexarMarcasPeso(datos.marcas),
    });
  }, [datos, error, desde, hasta]);
  const tot = useMemo(() => totalPeso(lineas), [lineas]);
  const tarjetas = useMemo(() => tarjetasResumenPeso(tot, unidad), [tot, unidad]);

  // Por qué quedaron sin pagar (sin peso, sin tarifa, sin empresa…): «N sin pagar» a
  // secas no dice qué arreglar. Los «no facturó» van aparte, que esos son a propósito.
  const motivos = useMemo(() => {
    const m = new Map<MotivoSinPagoPeso, number>();
    lineas.forEach((l) => {
      if (l.motivoSinPago && l.motivoSinPago !== 'no_facturo') m.set(l.motivoSinPago, (m.get(l.motivoSinPago) ?? 0) + 1);
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [lineas]);

  const bloquesEmpresa = useMemo(() => bloquesPeso(lineas, 'empresa', datos?.empresas), [lineas, datos]);

  const empresasPdf = useMemo(() => empresasDisponiblesPeso(lineas, datos?.empresas), [lineas, datos]);
  const obrasPdf = useMemo(() => obrasDisponiblesPeso(lineas), [lineas]);
  const frentesPdf = useMemo(() => frentesDisponiblesPeso(lineas), [lineas]);
  const maquinasPdf = useMemo(() => maquinasDisponiblesPeso(lineas, datos?.fichas, datos?.empresas), [lineas, datos]);
  // El buscador recorta lo que se ve, no lo que está marcado: una máquina marcada
  // que no coincide con la búsqueda sigue filtrando el papel (por eso se cuentan aparte).
  const maquinasVistas = useMemo(() => {
    const q = buscaMaq.trim().toLowerCase();
    if (!q) return maquinasPdf;
    return maquinasPdf.filter((m) => `${m.code} ${m.placa} ${m.empresa}`.toLowerCase().includes(q));
  }, [maquinasPdf, buscaMaq]);
  // Acotado a lo que hay en el rango: una obra o máquina marcada que ya no está no
  // puede seguir filtrando sin verse.
  const filtroPdf = useMemo<FiltroPeso>(
    () => acotarFiltroPeso(
      { empresas: Array.from(empresasSel), obras: Array.from(obrasSel), maquinas: Array.from(maquinasSel), frentes: Array.from(frentesSel) },
      { empresas: empresasPdf.map((e) => e.id), obras: obrasPdf.map((x) => x.id), maquinas: maquinasPdf.map((x) => x.id), frentes: frentesPdf.map((x) => x.id) },
    ),
    [empresasSel, obrasSel, maquinasSel, frentesSel, empresasPdf, obrasPdf, maquinasPdf, frentesPdf],
  );
  const lineasPdf = useMemo(() => filtrarLineasPeso(lineas, filtroPdf), [lineas, filtroPdf]);
  const totPdf = useMemo(() => totalPeso(lineasPdf), [lineasPdf]);
  const pdfFiltrado = filtroPesoActivo(filtroPdf);

  const rangoInvalido = hasta < desde;
  const rangoAntesDelInicio = hasta < INICIO_PAGO_PESO;
  const faltaSql = !!datos?.faltaSql;
  const nombreEje = (e: EjePeso) => (e === 'obra' ? 'obra' : e === 'frente' ? 'frente' : e === 'maquina' ? 'camión' : 'empresa');

  const descargarPdf = async () => {
    const html = pdfDocument({
      title: 'Pago por peso de los viajes de camiones',
      subtitle: `Del ${dmy(desde)} al ${dmy(hasta)} · por jornada (7am a 7am) · en ${unidad === 'kg' ? 'kilos' : 'toneladas'}${ejePdf !== 'empresa' ? ` · por ${nombreEje(ejePdf)}` : ''}${pdfFiltrado ? ' · FILTRADO' : ''}`,
      extraCss: CSS_PAGO_PESO,
      logos,
      // Regla de la casa en este módulo: sin la marca en texto «BCV / SOS».
      marcaTexto: false,
      body: cuerpoPagoPeso({
        lineas: lineasPdf,
        eje: ejePdf,
        filtro: filtroPdf,
        // Un papel filtrado SIEMPRE dice que lo está, aunque hayan apagado el alcance:
        // un total parcial que se lee como el pago completo es el error más caro posible.
        opciones: pdfFiltrado ? { ...opcionesPdf, sinAlcance: false } : opcionesPdf,
        unidad,
        nombresEmpresa: datos?.empresas ?? new Map(),
        fichas: datos?.fichas,
      }),
    });
    await exportPdf(html, `Pago por peso ${dmy(desde)} a ${dmy(hasta)}${sufijoArchivoPeso(filtroPdf, ejePdf, opcionesPdf)}`.replace(/\//g, '-'));
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
        titulo="⚖️ Pago por peso"
        resumen={error ? '⚠️ no se pudo leer' : `${tot.pagados} viaje(s) · ${pesoTexto(tot.kg, unidad)} · ${usd(tot.monto)} · ${dmy(desde)} al ${dmy(hasta)}`}
        alerta={!!error || tot.pendientes > 0}
      >
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          Lo que se le paga a cada empresa por lo que cargaron sus camiones: el neto de la romana (bruto − tara) por el
          precio por tonelada o por kilo que rija ese día (el de todos, o el especial de su empresa, grupo o camión).
          TODO camión entra. Un viaje sin peso sale «sin peso» y no se paga. Se respeta la marca «no facturó» del
          pago por viaje. Se cuenta por jornada (7am a 7am); hay pesos desde el {dmy(INICIO_PAGO_PESO)}.
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
          {atajo('Este mes', primeroDelMes(hoy), hoy)}
        </View>
        {rangoInvalido ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>La fecha «hasta» no puede ser anterior a «desde».</Text> : null}

        {/* ⚖️ Unidad: cómo se leen los pesos en pantalla y en el papel. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Pesos en:</Text>
          {pastilla('u-ton', 'Ton', unidad === 'ton', () => setUnidad('ton'))}
          {pastilla('u-kg', 'Kg', unidad === 'kg', () => setUnidad('kg'))}
        </View>

        {faltaSql ? (
          <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoftBg, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 13 }}>
              ⚠️ Falta correr el SQL de las tarifas por peso en la base; mientras, todo sale «sin tarifa».
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.sm }}>
          {boton('⚙️ Tarifas por peso', () => setPanelOpen(true), false, faltaSql)}
          {boton(cargando ? 'Actualizando…' : '↻ Actualizar', cargar, false, cargando)}
          {boton('📄 PDF', descargarPdf, true, !!error || rangoInvalido || !lineasPdf.length)}
        </View>

        {/* RESUMEN EJECUTIVO (pedido expreso): las mismas tarjetas que abren el papel. */}
        {!error && lineas.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
            {tarjetas.map((t) => (
              <View key={t.k} style={{ flexGrow: 1, flexBasis: 130, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
                <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' }}>{t.titulo}</Text>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, fontVariant: ['tabular-nums'] as any }}>{t.valor}</Text>
                {t.nota ? <Text style={{ color: colors.muted, fontSize: 11 }}>{t.nota}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}

        {!error ? (
          <View style={{ marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brand, padding: spacing.sm }}>
            <Text style={{ color: colors.brandContrast, opacity: 0.85, fontSize: 11, fontWeight: '800' }}>TOTAL A PAGAR</Text>
            <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 20, fontVariant: ['tabular-nums'] as any }}>{usd(tot.monto)}</Text>
            <Text style={{ color: colors.brandContrast, fontSize: 12 }}>
              {tot.pagados} viaje(s) a pagar · {pesoTexto(tot.kg, unidad)}{tot.noFacturados ? ` · ${tot.noFacturados} no facturó` : ''}{tot.pendientes ? ` · ${tot.pendientes} pendientes` : ''}
            </Text>
            {motivos.length ? (
              <Text style={{ color: colors.brandContrast, opacity: 0.85, fontSize: 11 }}>
                Pendientes: {motivos.map(([m, n]) => `${n} ${etiquetaMotivoSinPagoPeso(m).toLowerCase()}`).join(' · ')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {!error && lineas.length ? (
          <Plegable
            titulo="📄 Opciones del PDF"
            resumen={`${pdfFiltrado ? 'filtrado · ' : ''}${totPdf.pagados} viaje(s) · ${pesoTexto(totPdf.kg, unidad)} · ${usd(totPdf.monto)} · por ${nombreEje(ejePdf)}`}
            alerta={pdfFiltrado}
          >
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              Esto cambia SOLO el papel. Lo de arriba sigue siendo el pago completo del rango. Sin marcar nada, entran todos.
            </Text>

            {rotuloPdf('AGRUPAR POR')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {pastilla('eje-e', '🏢 Empresa', ejePdf === 'empresa', () => setEjePdf('empresa'))}
              {pastilla('eje-o', '📍 Obra / ubicación', ejePdf === 'obra', () => setEjePdf('obra'))}
              {pastilla('eje-f', '⛏️ Frente de trabajo', ejePdf === 'frente', () => setEjePdf('frente'))}
              {pastilla('eje-m', '🚛 Camión', ejePdf === 'maquina', () => setEjePdf('maquina'))}
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

            {rotuloPdf(`⛏️ FRENTES (vacío = todos · ${frentesPdf.length})`)}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {pastilla('f-todos', '✅ Todos', filtroPdf.frentes.length === 0, () => setFrentesSel(new Set()))}
              {frentesPdf.map((x) => pastilla('f' + x.id, `${x.name} (${x.viajes})`, filtroPdf.frentes.includes(x.id), () => alternarSel(frentesSel, setFrentesSel, x.id)))}
            </View>

            {/* 🚜 CAMIONES: buscador + selección de uno o varios, para sacar el papel
                solo de esos. Se cruza con lo de arriba (todo lo marcado tiene que cumplirse). */}
            {rotuloPdf(`🚜 CAMIONES (vacío = todos · ${maquinasPdf.length})`)}
            <TextInput
              value={buscaMaq}
              onChangeText={setBuscaMaq}
              placeholder="🔎 Buscar camión: código, placa o empresa…"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, color: colors.text, marginBottom: 4 }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {pastilla('m-todas', '✅ Todos', filtroPdf.maquinas.length === 0, () => { setMaquinasSel(new Set()); setBuscaMaq(''); })}
              {maquinasVistas.map((x) => pastilla(
                'm' + x.id,
                `${x.code}${x.placa ? ` · ${x.placa}` : ''} (${x.viajes})`,
                filtroPdf.maquinas.includes(x.id),
                () => alternarSel(maquinasSel, setMaquinasSel, x.id),
              ))}
            </View>
            {maquinasVistas.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Ningún camión coincide con la búsqueda.</Text>
            ) : null}
            {/* Si el buscador esconde camiones marcados, se dice — para que nadie
                crea que dejó de filtrar por lo que no ve. */}
            {filtroPdf.maquinas.length > maquinasVistas.filter((x) => filtroPdf.maquinas.includes(x.id)).length ? (
              <Text style={{ color: colors.warning, fontSize: 11, marginTop: 2 }}>
                Hay {filtroPdf.maquinas.length} camión(es) marcado(s); la búsqueda oculta algunos, pero siguen filtrando el papel.
              </Text>
            ) : null}

            {rotuloPdf('🖨️ ¿QUÉ SE OCULTA EN EL PDF?')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {PASTILLAS_PESO.map((p) => pastilla('p' + p.key, p.chip, opcionesPdf[p.key], () => setOpcionesPdf((o) => alternarPeso(o, p.key))))}
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
              Encendida = NO sale. {ocultosPesoEnPalabras(opcionesPdf)} Ocultar no cambia el total; filtrar sí.
            </Text>

            {rotuloPdf('🏷️ QUÉ LOGOS LLEVA EL MEMBRETE')}
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>
              Este papel nace SIN logos y sin el pie «Banco Central de Venezuela / SOS La Guaira». Enciende el que necesites.
            </Text>
            {LOGOS.map((l) => (
              <Toggle key={l.k} on={logos[l.k]} label={l.label} onPress={() => setLogos((p) => ({ ...p, [l.k]: !p[l.k] }))} />
            ))}

            <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: pdfFiltrado ? colors.warning : colors.border, borderRadius: radius.md, padding: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                Va a salir: {totPdf.pagados} viaje(s) a pagar · {pesoTexto(totPdf.kg, unidad)} · {usd(totPdf.monto)}
              </Text>
              {pdfFiltrado ? (
                <Text style={{ color: colors.warning, fontSize: 12 }}>
                  ⚠️ Filtrado: es una parte de los {usd(tot.monto)} del rango, y el papel lo dice.
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

        {!error && !cargando && datos && !lineas.length && !rangoInvalido ? (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
            {rangoAntesDelInicio
              ? `No hay nada que pagar: los pesos de romana existen desde el ${dmy(INICIO_PAGO_PESO)} y el rango que elegiste es anterior.`
              : 'No hay viajes en ese rango.'}
          </Text>
        ) : null}

        {!error && lineas.length ? (
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>
            Acá no se marca «no facturó»: eso se hace en «💰 Pago de viajes» y este apartado lo respeta.
          </Text>
        ) : null}

        {/* Lista por EMPRESA: cada bloque abre sus camiones, y cada camión sus viajes. */}
        {bloquesEmpresa.map((b) => {
          const open = abierta === b.clave;
          const renglones = open ? renglonesPorCamionPeso(b.lineas, datos?.fichas, datos?.empresas) : [];
          return (
            <View key={b.clave} style={{ marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => { setAbierta(open ? null : b.clave); setCamionAbierto(null); }}
                style={{ borderWidth: 1, borderColor: b.total.pendientes ? colors.warning : colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>🏢 {b.nombre}</Text>
                  <Text style={{ color: colors.brandText, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{usd(b.total.monto)}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {b.total.pagados} a pagar · {pesoTexto(b.total.kg, unidad)}{b.total.noFacturados ? ` · ${b.total.noFacturados} no facturó` : ''}{b.total.pendientes ? ` · ⚠️ ${b.total.pendientes} pendientes` : ''} · {open ? '▲ ocultar' : '▼ ver detalle'}
                </Text>
              </TouchableOpacity>
              {open ? (
                <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: colors.border, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs, backgroundColor: colors.surfaceAlt }}>
                  {renglones.map((r) => {
                    const claveCamion = `${b.clave}|${r.machineryId}`;
                    const openCamion = camionAbierto === claveCamion;
                    const viajesCamion = openCamion ? b.lineas.filter((l) => maquinaDeLineaPeso(l) === r.machineryId) : [];
                    return (
                      <View key={claveCamion} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6, marginTop: 4 }}>
                        <TouchableOpacity onPress={() => setCamionAbierto(openCamion ? null : claveCamion)}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>
                              🚛 {r.code}{r.placa ? ` · ${r.placa}` : ''}
                            </Text>
                            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] as any }}>{usd(r.monto)}</Text>
                          </View>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>
                            {r.pagados}{r.viajes > r.pagados ? ` de ${r.viajes}` : ''} viaje(s) a pagar · {pesoTexto(r.kg, unidad)} · {r.tarifa}{r.pendientes ? ` · ⚠️ ${r.pendientes} pendientes` : ''} · {openCamion ? '▲' : '▼ viajes'}
                          </Text>
                        </TouchableOpacity>
                        {openCamion ? viajesCamion.map((l) => (
                          <View key={l.viaje.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 3, paddingLeft: spacing.sm }}>
                            <Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>
                              #{l.viaje.folio ?? '—'} · {dmy(l.jornada)} {horaCaracas(l.viaje.registered_at)} · {l.kg > 0 ? pesoTexto(l.kg, unidad) : 'sin peso'}
                              <Text style={{ color: l.motivoSinPago ? colors.warning : colors.muted }}>
                                {' · '}{l.motivoSinPago ? etiquetaMotivoSinPagoPeso(l.motivoSinPago) : textoPrecioPeso(l.tarifa)}
                              </Text>
                            </Text>
                            <Text style={{ color: l.monto > 0 ? colors.text : colors.muted, fontWeight: '700', fontSize: 12, fontVariant: ['tabular-nums'] as any }}>
                              {l.monto > 0 ? usd(l.monto) : '—'}
                            </Text>
                          </View>
                        )) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </Plegable>

      <PagoPesoPanel
        visible={panelOpen}
        onClose={() => setPanelOpen(false)}
        canEdit={canEdit}
        usuarioId={usuarioId}
        onChanged={cargar}
      />
    </>
  );
}
