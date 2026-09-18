// EL REPORTE DE COMIDAS, CON OPCIONES (18-sep-2026).
//
// Pedido del cliente: «desde la vista de teléfono poder imprimir los pdf, para
// empresa, para personas, para cualquier día que filtre, para un tipo de comida,
// o poder seleccionar varias opciones para poder imprimir, poder imprimirlo con
// monto y sin monto, con todas las opciones como en reportes/conteo de equipos,
// que a esos reportes se les puede quitar o colocar algo al reporte con un solo
// botón».
//
// Copia el patrón que ya está en producción: hoja inferior con su scroll,
// filtros con casillas ☑️/⬜ que se encienden VARIAS a la vez, las pastillas 🚫
// del Conteo de equipos, una frase en criollo que dice qué va a salir ANTES de
// generar, y UN SOLO botón grande. Todo con `flexWrap`, que es como se lee bien
// en el teléfono.
//
// ⚠️ DOS COSAS DISTINTAS, Y SE DICEN DISTINTO:
//    · ARRIBA los FILTROS (☑️, color de marca): cambian los totales.
//    · ABAJO las PASTILLAS (🚫, color de aviso): ocultan columnas y cuadros; los
//      totales NO cambian.
//    Si se vieran iguales, nadie sabría cuál de las dos le quitó comidas al
//    papel. Por eso el cuadro de alcance del PDF escribe siempre los filtros.
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { DateField } from './DateField';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { COMPANY_MEALS } from '../lib/foodCompanyMeals';
import { FoodCompanyMeal, FoodDistribution } from '../types/database';
import { PrecioComida } from '../lib/cobroComidas';
import {
  OPCIONES_COMIDA_COMO_ANTES, PASTILLAS_COMIDA, alternarComida, comidaSinContenido,
  ocultosComidaEnPalabras, sufijoArchivoComida, OpcionesComida,
} from '../lib/comidaReporteOpciones';
import {
  FiltroComida, acotarFiltro, agruparEmpresas, agruparPersonas, alcanceEnPalabras, cedulasPorClave,
  claveEmpresa, clavePersona, filtrarComidas, filtroSinEntregas, lineasDetalle, totalesDeGrupos,
} from '../lib/comidaReporte';
import { CSS_REPORTE_COMIDA, cuerpoReporteComida, nombreArchivoComida, subtituloReporteComida } from '../lib/comidaReporteHtml';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Todas las entregas ya cargadas del rango que ve la pantalla. */
  entregasEmpresa: FoodCompanyMeal[];
  entregasPersona: FoodDistribution[];
  /** Precios vigentes, para los montos. Null = todavía no cargaron. */
  precios: PrecioComida[] | null;
  /** Si no se pueden ver montos, la pastilla de montos se fuerza encendida. */
  puedeVerMontos: boolean;
  desdeInicial: string;
  hastaInicial: string;
  hoy: string;
  /** El filtro de empresa de la pantalla: 'all' o la clave de una empresa. */
  empresaInicial: string;
};

const CATALOGO_COMIDAS = COMPANY_MEALS.map((m) => ({ key: String(m.key), label: m.label }));

export function ComidaReporteModal({
  visible, onClose, entregasEmpresa, entregasPersona, precios, puedeVerMontos, desdeInicial, hastaInicial, hoy, empresaInicial,
}: Props) {
  const { colors } = useTheme();

  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hastaInicial);
  const [empresasSel, setEmpresasSel] = useState<Set<string>>(new Set());
  const [personasSel, setPersonasSel] = useState<Set<string>>(new Set());
  const [comidasSel, setComidasSel] = useState<Set<string>>(new Set());
  const [conEmpresas, setConEmpresas] = useState(true);
  const [conPersonas, setConPersonas] = useState(true);
  const [opciones, setOpciones] = useState<OpcionesComida>(OPCIONES_COMIDA_COMO_ANTES);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [notaCarnet, setNotaCarnet] = useState(false);

  // Al ABRIR, el modal arranca con lo que muestra la pantalla: el mismo rango y,
  // si arriba hay una empresa elegida, esa empresa sola y SIN lo de carnet.
  //
  // ⚠️ Es lo que hacía el PDF viejo, y la revisión lo cazó cuando se perdió: con
  //    la pantalla filtrada en una empresa, el papel salía con TODAS las empresas
  //    y la lista de personas con cédula. Esa hoja se le entrega a la empresa:
  //    no puede llevar lo que comieron las demás ni los datos de terceros.
  //
  //    Las selecciones se limpian cada vez: una marca que sobrevive de la vez
  //    anterior filtra sin verse (su empresa puede ya no estar en el rango).
  React.useEffect(() => {
    if (!visible) return;
    setDesde(desdeInicial);
    setHasta(hastaInicial);
    setAviso(null);
    setNotaCarnet(false);
    setPersonasSel(new Set());
    setComidasSel(new Set());
    const unaEmpresa = empresaInicial && empresaInicial !== 'all';
    setEmpresasSel(unaEmpresa ? new Set([empresaInicial]) : new Set());
    setConEmpresas(true);
    setConPersonas(!unaEmpresa);
  }, [visible, desdeInicial, hastaInicial, empresaInicial]);

  // Sin permiso de cobro no hay montos posibles: la pastilla queda encendida y
  // no se puede apagar, en vez de sacar un papel con todo en $0,00.
  const opcionesReales: OpcionesComida = useMemo(
    () => (puedeVerMontos ? opciones : { ...opciones, sinMontos: true }),
    [opciones, puedeVerMontos],
  );

  // Las empresas y personas que EXISTEN en lo cargado, para ofrecerlas.
  const empresasDisponibles = useMemo(() => {
    const m = new Map<string, string>();
    entregasEmpresa.forEach((r) => m.set(claveEmpresa(r), r.company_name));
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [entregasEmpresa]);

  const personasDisponibles = useMemo(() => {
    const m = new Map<string, string>();
    entregasPersona.forEach((r) => m.set(clavePersona(r), r.employee_name));
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [entregasPersona]);

  // ⚠️ El filtro se ACOTA a lo cargado ANTES de usarse (`acotarFiltro`): en la PC
  //    la fecha se puede escribir fuera del calendario, y el papel no puede
  //    decir «del 1 al 18» con un solo día adentro.
  const filtro: FiltroComida = useMemo(() => acotarFiltro(
    {
      desde, hasta,
      empresas: Array.from(empresasSel),
      personas: Array.from(personasSel),
      comidas: Array.from(comidasSel),
      conEmpresas, conPersonas,
    },
    {
      desde: desdeInicial,
      hasta: hastaInicial < hoy ? hastaInicial : hoy,
      empresas: empresasDisponibles.map((e) => e.id),
      personas: personasDisponibles.map((p) => p.id),
    },
  ), [desde, hasta, empresasSel, personasSel, comidasSel, conEmpresas, conPersonas, desdeInicial, hastaInicial, hoy, empresasDisponibles, personasDisponibles]);

  // Elegir una EMPRESA apaga lo de carnet la primera vez: las entregas por
  // carnet no dicen de qué empresa son, y dejarlas encendidas metería en el papel
  // de esa empresa lo que comió todo el mundo. Se avisa, y se puede volver a
  // encender.
  const alternarEmpresa = (clave: string) => {
    const n = new Set(empresasSel);
    if (n.has(clave)) n.delete(clave); else n.add(clave);
    if (empresasSel.size === 0 && n.size > 0 && conPersonas && personasSel.size === 0) {
      setConPersonas(false);
      setNotaCarnet(true);
    }
    setEmpresasSel(n);
  };

  const nombres = useMemo(() => ({
    empresas: new Map(empresasDisponibles.map((e) => [e.id, e.name])),
    personas: new Map(personasDisponibles.map((p) => [p.id, p.name])),
    comidas: new Map(CATALOGO_COMIDAS.map((c) => [c.key, c.label])),
  }), [empresasDisponibles, personasDisponibles]);

  // Se calcula en vivo para poder decir CUÁNTO va a salir antes de generar: un
  // botón que produce una hoja vacía se toca dos veces y se pierde la confianza.
  const previo = useMemo(() => {
    const e = filtrarComidas({ empresas: entregasEmpresa, personas: entregasPersona }, filtro);
    const gE = agruparEmpresas(e.empresas, precios);
    const gP = agruparPersonas(e.personas, precios);
    return { e, gE, gP, totales: totalesDeGrupos(gE, gP), vacio: filtroSinEntregas(e) };
  }, [entregasEmpresa, entregasPersona, filtro, precios]);

  const alternarEn = (set: Set<string>, poner: (s: Set<string>) => void, clave: string) => {
    const n = new Set(set);
    if (n.has(clave)) n.delete(clave); else n.add(clave);
    poner(n);
  };

  const generar = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      const e = previo.e;
      const gE = previo.gE;
      const gP = previo.gP;
      const cuerpo = cuerpoReporteComida({
        filtro,
        opciones: opcionesReales,
        comidas: CATALOGO_COMIDAS,
        gruposEmpresas: gE,
        gruposPersonas: gP,
        cedulas: cedulasPorClave(e.personas),
        // Solo se arma si va a salir: con miles de entregas es lo más pesado.
        lineas: opcionesReales.sinDetalle ? [] : lineasDetalle(e, precios),
        totales: previo.totales,
        nombres,
      });
      const html = pdfDocument({
        title: '🍽️ Control de entregas de comida',
        subtitle: subtituloReporteComida(filtro),
        body: cuerpo,
        extraCss: CSS_REPORTE_COMIDA,
      });
      await exportPdf(html, nombreArchivoComida(filtro, sufijoArchivoComida(opcionesReales)));
    } catch (err: any) {
      setAviso('❌ No se pudo armar el reporte: ' + (err?.message ?? 'revisa la conexión'));
    } finally {
      setOcupado(false);
    }
  };

  const casilla = (clave: string, texto: string, encendida: boolean, onPress: () => void) => (
    <TouchableOpacity
      key={clave}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: encendida ? colors.brand : colors.border, backgroundColor: encendida ? colors.brand + '18' : colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 }}
    >
      <Text style={{ fontSize: 13 }}>{encendida ? '☑️' : '⬜'}</Text>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{texto}</Text>
    </TouchableOpacity>
  );

  const rotulo = (texto: string) => (
    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>{texto}</Text>
  );

  const sinContenido = comidaSinContenido(opcionesReales);
  const noSePuede = sinContenido || previo.vacio || (!conEmpresas && !conPersonas);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '90%', padding: spacing.lg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, flex: 1 }} numberOfLines={2}>📄 Reporte de comidas</Text>
            <TouchableOpacity onPress={onClose} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>Cerrar ✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            {/* ⚠️ LAS FECHAS NO PUEDEN SALIRSE DE LO QUE LA PANTALLA CARGÓ. El
                modal filtra sobre las entregas ya traídas del rango de arriba: si
                dejara ampliar las fechas, el papel saldría INCOMPLETO diciendo
                «del 1 al 30» con solo una semana adentro, y nadie lo notaría al
                leerlo. Por eso el calendario solo deja achicar, nunca ampliar. */}
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 2 }}>DESDE</Text>
            <DateField value={desde} onChange={setDesde} minISO={desdeInicial} maxISO={hasta} />
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm, marginBottom: 2 }}>HASTA</Text>
            <DateField value={hasta} onChange={setHasta} minISO={desde} maxISO={hastaInicial < hoy ? hastaInicial : hoy} />
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
              Aquí solo se puede achicar el rango. Para otras fechas, cámbialas primero en el rango de arriba y vuelve a abrir esto.
            </Text>

            {rotulo('🍽️ Qué entra')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {casilla('qr', '🏢 Entregas por empresa (QR)', conEmpresas, () => setConEmpresas((v) => !v))}
              {casilla('carnet', '👤 Entregas por carnet', conPersonas, () => { setConPersonas((v) => !v); setNotaCarnet(false); })}
            </View>
            {notaCarnet || (!conPersonas && empresasSel.size > 0) ? (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                Con una empresa elegida, lo de carnet queda fuera: las entregas por carnet no dicen de qué empresa son, y el papel de esa empresa llevaría lo que comió todo el mundo. Enciéndelo si de verdad lo quieres.
              </Text>
            ) : null}

            {rotulo('🍳 Comidas (vacío = todas)')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {CATALOGO_COMIDAS.map((c) =>
                casilla('c' + c.key, c.label, comidasSel.has(c.key), () => alternarEn(comidasSel, setComidasSel, c.key)),
              )}
            </View>

            {conEmpresas && empresasDisponibles.length > 0 ? (
              <>
                {rotulo(`🏢 Empresas (vacío = todas · ${empresasDisponibles.length})`)}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {empresasDisponibles.map((e) =>
                    casilla('e' + e.id, e.name, empresasSel.has(e.id), () => alternarEmpresa(e.id)),
                  )}
                </View>
              </>
            ) : null}

            {conPersonas && personasDisponibles.length > 0 ? (
              <>
                {rotulo(`👤 Personas (vacío = todas · ${personasDisponibles.length})`)}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {personasDisponibles.map((p) =>
                    casilla('p' + p.id, p.name, personasSel.has(p.id), () => alternarEn(personasSel, setPersonasSel, p.id)),
                  )}
                </View>
              </>
            ) : null}

            {/* Las pastillas del Conteo de equipos: ocultan, no filtran. */}
            {rotulo('🖨️ ¿Qué se oculta en el PDF?')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {PASTILLAS_COMIDA.map((p) => {
                const forzada = p.key === 'sinMontos' && !puedeVerMontos;
                const on = opcionesReales[p.key];
                return (
                  <TouchableOpacity
                    key={p.key}
                    disabled={forzada}
                    onPress={() => setOpciones((o) => alternarComida(o, p.key))}
                    style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.warning : colors.border, backgroundColor: on ? colors.warning : colors.surface, paddingHorizontal: spacing.md, paddingVertical: 6, opacity: forzada ? 0.6 : 1 }}
                  >
                    <Text style={{ color: on ? '#FFFFFF' : colors.text, fontSize: 12, fontWeight: '700' }}>{p.chip}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
              {ocultosComidaEnPalabras(opcionesReales)}
              {puedeVerMontos ? '' : ' Los montos no salen porque no tienes permiso completo de Comida.'}
            </Text>

            {/* Lo que va a salir, ANTES de generar. */}
            <View style={{ marginTop: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, marginBottom: 2 }}>Va a salir</Text>
              <Text style={{ color: colors.muted, fontSize: 11 }}>
                {previo.totales.total} comida(s) · {previo.totales.empresas} empresa(s) · {previo.totales.personas} persona(s)
                {opcionesReales.sinMontos ? '' : ` · $${previo.totales.monto.toFixed(2)}`}
              </Text>
              {alcanceEnPalabras(filtro, nombres).map((l) => (
                <Text key={l} style={{ color: colors.muted, fontSize: 11 }}>• {l}</Text>
              ))}
            </View>

            {/* Con permiso y sin precios leídos, un papel «con montos» saldría todo
                «sin precio» y parecería que las comidas no valen nada. */}
            {puedeVerMontos && !opcionesReales.sinMontos && precios === null ? (
              <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '700', marginTop: spacing.xs }}>
                ⚠️ No se pudieron leer los precios: los montos saldrían como «sin precio». Cierra, desliza hacia abajo para recargar y vuelve a abrir, o enciende «🚫 Montos ($)».
              </Text>
            ) : null}
            {sinContenido ? (
              <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700', marginTop: spacing.xs }}>
                ⚠️ Así el reporte queda sin ningún cuadro y sin listado. Enciende al menos uno.
              </Text>
            ) : null}
            {previo.vacio ? (
              <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700', marginTop: spacing.xs }}>
                ⚠️ Con esos filtros no queda ni una entrega. Quita alguno.
              </Text>
            ) : null}
            {aviso ? (
              <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>{aviso}</Text>
            ) : null}

            <TouchableOpacity
              onPress={generar}
              disabled={ocupado || noSePuede}
              activeOpacity={0.85}
              style={{ marginTop: spacing.lg, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', opacity: ocupado || noSePuede ? 0.5 : 1 }}
            >
              <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 14 }}>{ocupado ? 'Generando…' : '📄 Generar reporte'}</Text>
            </TouchableOpacity>
            <View style={{ height: spacing.xl }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
