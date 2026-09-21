// PAGO DE VIAJES · lo que hay que pagar (15-sep-2026).
//
// Tarjeta del panel de información de Viajes de camiones. Por rango de fechas (por
// jornada, 7am a 7am): cada empresa con sus viajes pagados, los que no facturaron, los
// que quedaron sin pagar y el total. Tocar una empresa abre el detalle por camión y por
// viaje (PagoViajesDetalle), donde se marca «facturó / no facturó».
//
// ⭐ Vive SOLO en este módulo: no toca jornadas, Control de Maquinaria ni Control de Pagos.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
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
  obrasDisponibles, ocultosPagoEnPalabras, sufijoArchivoPago, totalDeLineas,
} from '../lib/pagoViajesReporte';

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
  const [ejePdf, setEjePdf] = useState<EjePago>('empresa');
  const [opcionesPdf, setOpcionesPdf] = useState<OpcionesPagoViajes>(OPCIONES_PAGO_COMO_ANTES);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await cargarDatosPagoViajes());
      setError(null);
    } catch (e: any) {
      setError(`No se pudo leer el pago de viajes (${e?.message ?? 'revisa la conexión'}). No se muestran montos a medias: toca «Actualizar».`);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

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
  // Acotado a lo que hay en el rango: una obra marcada que ya no está no puede seguir
  // filtrando sin verse.
  const filtroPdf = useMemo(
    () => acotarFiltroPago({ empresas: Array.from(empresasSel), obras: Array.from(obrasSel) }, { empresas: empresasPdf.map((e) => e.id), obras: obrasPdf.map((x) => x.id) }),
    [empresasSel, obrasSel, empresasPdf, obrasPdf],
  );
  const lineasPdf = useMemo(() => filtrarLineasPago(lineasTodas, filtroPdf), [lineasTodas, filtroPdf]);
  const totPdf = useMemo(() => totalDeLineas(lineasPdf), [lineasPdf]);
  const pdfFiltrado = filtroPdf.empresas.length > 0 || filtroPdf.obras.length > 0;

  const rangoInvalido = hasta < desde;
  const rangoAntesDelInicio = hasta < INICIO_PAGO_VIAJES;

  const descargarPdf = async () => {
    // Camiones con viajes que no entran al pago: lo que NO se está pagando. Solo en el
    // papel SIN filtrar: esa lista es de todo el rango, y en el papel de una obra o de
    // una empresa hablaría de camiones que no tienen nada que ver.
    const fuera = !pdfFiltrado && fueraDelPago.length ? `
      <h3>🚫 Camiones que no entran al pago (${viajesFuera} viaje(s))</h3>
      <table><thead><tr><th>Camión</th><th>Empresa</th><th class="r">Viajes</th><th>Situación</th></tr></thead>
      <tbody>${fueraDelPago.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.companyId ? datos?.empresas.get(c.companyId) ?? 'Empresa' : 'Sin empresa')}</td><td class="r">${c.viajes}</td><td>${c.sinConfigurar ? 'Nunca se puso en el pago' : 'Se le quitó el pago por viaje'}</td></tr>`).join('')}</tbody></table>` : '';
    const html = pdfDocument({
      title: 'Pago de viajes de camiones',
      subtitle: `Del ${dmy(desde)} al ${dmy(hasta)} · por jornada (7am a 7am)${ejePdf === 'obra' ? ' · por obra' : ''}${pdfFiltrado ? ' · FILTRADO' : ''}`,
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
        resumen={error ? '⚠️ no se pudo leer' : `${tot.pagados} viaje(s) · ${usd(tot.monto)} · ${dmy(desde)} al ${dmy(hasta)}`}
        alerta={!!error || tot.pendientes > 0}
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
            resumen={`${pdfFiltrado ? 'filtrado · ' : ''}${totPdf.pagados} viaje(s) · ${usd(totPdf.monto)} · por ${ejePdf === 'obra' ? 'obra' : 'empresa'}`}
            alerta={pdfFiltrado}
          >
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              Esto cambia SOLO el papel. Lo de arriba sigue siendo el pago completo del rango. Sin marcar nada, entran todas.
            </Text>

            {rotuloPdf('AGRUPAR POR')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {pastilla('eje-e', '🏢 Empresa', ejePdf === 'empresa', () => setEjePdf('empresa'))}
              {pastilla('eje-o', '📍 Obra / ubicación', ejePdf === 'obra', () => setEjePdf('obra'))}
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
              {tot.pagados} viaje(s) pagados{tot.noFacturados ? ` · ${tot.noFacturados} no facturó` : ''}{tot.pendientes ? ` · ${tot.pendientes} sin pagar` : ''}
            </Text>
            {motivos.length ? (
              <Text style={{ color: colors.brandContrast, opacity: 0.85, fontSize: 11 }}>
                Sin pagar: {motivos.map(([m, n]) => `${n} ${etiquetaMotivoSinPago(m).toLowerCase()}`).join(' · ')}
              </Text>
            ) : null}
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
                  {g.pagados} pagado(s){g.noFacturados ? ` · ${g.noFacturados} no facturó` : ''}{g.pendientes ? ` · ⚠️ ${g.pendientes} sin pagar` : ''} · {open ? '▲ ocultar' : '▼ ver detalle'}
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
