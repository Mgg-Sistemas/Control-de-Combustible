// 🏭 CENTRO DE OPERACIONES — 📅 PARTE DIARIO (24-oct-2026).
//
// La PRIMERA pestaña: la hoja diaria de la encargada del sitio. Arriba, la jornada
// (7am a 7am; por defecto `caracasBusinessToday()`, con ◀ ▶ de a un día y sin pasar de
// hoy, ni con el calendario: lote 5 B7); debajo, los bloques plegables EN EL ORDEN DE SU HOJA:
//   1) Reporte General (pegado de WhatsApp)      → BloqueReporteGeneral
//   2) Entrada por patio                          → BloquePatios
//   3) Salidas · 4) Acero · 5) Aluminio y plástico → SalidasAgregados / SalidasAcero /
//                                                   SalidasAluminioPlastico (./BloqueSalidas)
//   6) Maquinaria                                  → BloqueMaquinaria
//   7) Bloques                                     → BloqueBloques
//
// ⭐ LA JORNADA VIVE EN LA PANTALLA (lote 5 B2): la recibe como `fecha` y la cambia con
//    `alCambiarFecha`. Así ir a ⚙️ Ajustes (o a otro sitio) y volver no la devuelve sola
//    a hoy; al volver, los bloques se montan de nuevo y recargan (los km o el factor
//    recién puestos se ven). Si ella estaba «en hoy» y cambia el día, la pantalla la pasa
//    sola al nuevo hoy (revisión final B-I4; una fecha elegida a propósito se respeta).
// ⭐ EL REPORTE GENERAL DEL DÍA SE CARGA ACÁ, UNA VEZ: lo muestran el bloque 1 y el 2
//    (la diferencia «Patios 250 · Reporte 238 · diferencia +12»), así nunca se
//    contradicen. Refresca al enfocarse, al deslizar (la pantalla recrea `sitio`) y al
//    cambiar la jornada; una respuesta vieja no pisa a la nueva.
// ⭐ LAS SALIDAS SE CARGAN ACÁ, UNA VEZ (lote 5 B11): `useDatosSalidas` da la flota, las
//    listas, lo del día y los pendientes de pesaje a los bloques 3, 4 y 5 (un solo toast
//    si falla).
// ⭐ PLEGAR NO DESMONTA: un bloque cerrado sigue montado (solo se esconde), así lo pegado
//    o lo tecleado y sin guardar no se pierde por cerrar la tarjeta. (Por eso no se usa
//    `Plegable`, que desmonta lo de adentro.) El encabezado dice qué hay dentro (lote 5
//    B10): las cifras del Reporte General, cuántas salidas y cuántas esperan pesaje, los
//    conteos de la maquinaria y «✏️ sin guardar» si quedó algo escrito.
// ⭐ MAQUINARIA ↔ SALIDAS (mesa de maquinaria M8): el bloque 🚜 le pasa a la pestaña el grupo
//    EFECTIVO de cada unidad (con inspección) y la pestaña se lo da a las salidas: el 🔧 del
//    selector de unidad sale de ahí, no de la marca guardada.
// ⭐ Dentro de cada bloque no va otra tarjeta (lote 5 B18): los bloques van «incrustados».
// ⭐ SALIR CON ALGO SIN GUARDAR PREGUNTA (revisión final B-I1/B-M7): los siete bloques
//    (también los patios y la nota de la maquinaria) avisan si quedó algo escrito sin
//    guardar, y la pestaña se lo dice a la pantalla (`alSinGuardar`, con los bloques en el
//    orden de la hoja). La pantalla pregunta antes de cambiar de pestaña o de sitio: la
//    pestaña NO se deja montada y escondida (lote 5: rompía el refresco al volver).
//
// Lectura ve todo sin botones de cambio; Escritura y Full cargan; borrar, solo Full.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from '../ui';
import { DateField } from '../DateField';
import { useToast } from '../ToastProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets, PermLevel } from '../../lib/permissions';
import { caracasBusinessToday } from '../../lib/caracasDay';
import { fechaValida } from '../../lib/centroOperaciones';
import type { ReporteGeneralGuardado, Sitio } from '../../lib/centroOperaciones';
import { secuenciaDePedidos } from '../../lib/centroOperacionesCarga';
import { cargarReportesGenerales } from '../../lib/centroOperacionesDb';
import { BloqueReporteGeneral } from './BloqueReporteGeneral';
import { BloquePatios } from './BloquePatios';
import { SalidasAgregados, SalidasAcero, SalidasAluminioPlastico, useDatosSalidas } from './BloqueSalidas';
import type { DatosSalidas } from './BloqueSalidas';
import { BloqueMaquinaria } from './BloqueMaquinaria';
import type { ConteoMaquinaria, EstadosMaquinaria } from './BloqueMaquinaria';
import { textoConteoDelSitio } from '../../lib/centroOperacionesMaquinariaBloques';
import { BloqueBloques } from './BloqueBloques';
import { moverJornada, puedeAvanzar, textoToneladasRg, textoViajesRg } from './parteDiario';
import { resumenSalidas } from './salidasParteDiario';
import type { ClaseSalida } from './salidasParteDiario';
import { bloquesSinGuardar } from './pantallaParteDiario';
import type { ClaveSinGuardar } from './pantallaParteDiario';

type Props = {
  sitio: Sitio;
  nivel: PermLevel;
  /** La jornada elegida, «YYYY-MM-DD» (vive en la pantalla: lote 5 B2). */
  fecha: string;
  /** Cambiar la jornada (la pantalla la guarda). */
  alCambiarFecha: (fecha: string) => void;
  /** Revisión final B-I1: qué bloques quedaron con algo sin guardar (la pantalla pregunta antes de salir). */
  alSinGuardar?: (claves: ClaveSinGuardar[]) => void;
};

// ═══════════════════════════ Una tarjeta plegable que no desmonta ═══════════════════════════

function Bloque({ titulo, resumen, alerta, sinGuardar, abiertoPorDefecto = false, children }: {
  titulo: string;
  /** Lo que se ve SIN abrir (plegado no es escondido). */
  resumen?: string | null;
  alerta?: boolean;
  /** Quedó algo escrito sin guardar adentro: el encabezado lo dice. */
  sinGuardar?: boolean;
  abiertoPorDefecto?: boolean;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const [abierto, setAbierto] = useState(abiertoPorDefecto);
  const texto = [resumen ?? '', sinGuardar ? '✏️ sin guardar' : ''].filter(Boolean).join(' · ');
  const aviso = !!alerta || !!sinGuardar;
  return (
    <Card>
      <TouchableOpacity
        onPress={() => setAbierto((v) => !v)}
        activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>{titulo}</Text>
          {texto ? (
            <Text style={{ color: aviso ? colors.warning : colors.muted, fontSize: 12, fontWeight: aviso ? '800' : '400', marginTop: 2 }}>{texto}</Text>
          ) : null}
        </View>
        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15 }}>{abierto ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {/* Cerrado = escondido, NO desmontado: lo escrito adentro se conserva. */}
      <View style={{ marginTop: spacing.sm, display: abierto ? 'flex' : 'none' }}>{children}</View>
    </Card>
  );
}

/** Lo que dice plegado un bloque de salidas (mientras carga o si falló, no inventa cifras). */
function resumenDeSalidas(datos: DatosSalidas, clase: ClaseSalida, sitioId: string): { texto: string; alerta: boolean } {
  if (!datos.listasCargadas) {
    if (datos.errorDatos) return { texto: '⚠️ No se pudieron cargar las salidas', alerta: true };
    return { texto: 'Cargando…', alerta: false };
  }
  return resumenSalidas(datos.delDia, datos.pendientes, clase, sitioId);
}

// ═══════════════════════════ La pestaña ═══════════════════════════

export function ParteDiarioTab({ sitio, nivel, fecha, alCambiarFecha, alSinGuardar }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const puedeEscribir = levelMeets(nivel, 'escritura');
  const hoy = caracasBusinessToday();

  // ── El Reporte General de la jornada (uno por sitio y día) ──
  const [rg, setRg] = useState<{ fecha: string; reporte: ReporteGeneralGuardado | null } | null>(null);
  const [cargandoRg, setCargandoRg] = useState(false);
  const [errorRg, setErrorRg] = useState<string | null>(null);
  const pedidosRg = useRef(secuenciaDePedidos()).current;
  const recargarReporte = useCallback(async () => {
    const n = pedidosRg.nuevo();
    setCargandoRg(true);
    setErrorRg(null);
    try {
      const lista = await cargarReportesGenerales(sitio.id, fecha, fecha);
      if (!pedidosRg.vigente(n)) return; // llegó otra respuesta más nueva
      setRg({ fecha, reporte: lista[0] ?? null });
    } catch (e: any) {
      if (!pedidosRg.vigente(n)) return;
      const msg = e?.message || 'No se pudo cargar el Reporte General del día.';
      setErrorRg(msg);
      toast.error(msg);
    } finally {
      if (pedidosRg.vigente(n)) setCargandoRg(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio, fecha]);
  // Al entrar, al deslizar (la pantalla recrea `sitio`) y al cambiar la jornada.
  useFocusEffect(useCallback(() => { recargarReporte(); }, [recargarReporte]));

  // ── Las salidas (bloques 3, 4 y 5): UNA sola carga para los tres (B11) ──
  const salidas = useDatosSalidas(sitio, fecha);

  // ── Lo que dicen los encabezados plegados (B10) ──
  const [sucios, setSucios] = useState<Partial<Record<ClaveSinGuardar, boolean>>>({});
  const marcar = useMemo(() => {
    const de = (clave: ClaveSinGuardar) => (v: boolean) => setSucios((s) => (!!s[clave] === v ? s : { ...s, [clave]: v }));
    return {
      reporte: de('reporte'), patios: de('patios'), agregados: de('agregados'), acero: de('acero'),
      aluminio: de('aluminio'), maquinaria: de('maquinaria'), bloques: de('bloques'),
    };
  }, []);
  const [conteoMaq, setConteoMaq] = useState<ConteoMaquinaria>(null);
  // M8: el grupo EFECTIVO de cada unidad (lo decide el bloque 🚜 con inspección) para el 🔧 de las salidas.
  const [estadosMaq, setEstadosMaq] = useState<EstadosMaquinaria>(null);

  // ── B-I1: la pantalla sabe qué quedó sin guardar (pregunta antes de salir) ──
  const clavesSinGuardar = bloquesSinGuardar(sucios);
  const firmaSinGuardar = clavesSinGuardar.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { alSinGuardar?.(clavesSinGuardar); }, [firmaSinGuardar, alSinGuardar]);
  // Al desmontarse (salió, o cambió de sitio) ya no queda nada: no se pregunta por lo de antes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { return () => { alSinGuardar?.([]); }; }, []);

  // Mientras llega el de otra jornada, el anterior NO se muestra como si fuera de esta.
  const reporteDelDia = rg && rg.fecha === fecha ? rg.reporte : null;
  const cargandoReporte = cargandoRg || !rg || rg.fecha !== fecha;

  // ⭐ B7: nunca una jornada futura (ni con el calendario ni con un Reporte General mal fechado).
  const elegirFecha = (f: string) => { if (fechaValida(f)) alCambiarFecha(f > hoy ? hoy : f); };

  const resumenReporte = errorRg
    ? '⚠️ No se pudo cargar'
    : reporteDelDia
      ? [
        textoViajesRg(reporteDelDia.viajesTotal),
        textoToneladasRg(reporteDelDia.toneladasTotal),
        reporteDelDia.horaCorte ? `corte ${reporteDelDia.horaCorte}` : '',
        reporteDelDia.avisos.length ? `⚠️ ${reporteDelDia.avisos.length} aviso(s)` : '',
      ].filter(Boolean).join(' · ')
      : cargandoReporte ? 'Cargando…' : 'Sin Reporte General de esta jornada';

  const resAgregados = resumenDeSalidas(salidas, 'agregados', sitio.id);
  const resAcero = resumenDeSalidas(salidas, 'acero', sitio.id);
  const resAluminio = resumenDeSalidas(salidas, 'aluminioPlastico', sitio.id);
  // Mesa de maquinaria (F1b): «✅ n · 🔧 m» y, solo si hay, «· ⛔ k · ❔ j · ⚠️ d» (la misma regla del bloque).
  const resumenMaq = conteoMaq ? textoConteoDelSitio(conteoMaq, 'corto') : 'Disponible o averiada';
  // Con alguna que no coincide con inspección, o que no se pudo comparar (sin verificar / sin dato tras una
  // lectura fallida: el conteo llega null mientras se lee), el encabezado va en tono de aviso (lote 6 B9).
  const alertaMaq = (conteoMaq?.noCoinciden ?? 0) > 0 || (conteoMaq?.sinVerificar ?? 0) > 0 || (conteoMaq?.sinDato ?? 0) > 0;

  // ── Estilos ──
  const flecha = (activa: boolean) => ({
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface, opacity: activa ? 1 : 0.4,
  });

  return (
    <View style={{ gap: spacing.sm }}>
      {/* ── LA JORNADA ── */}
      <Card>
        <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>📅 Parte diario · 📍 {sitio.nombre}</Text>
        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.xs }}>JORNADA (7AM A 7AM)</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4 }}>
          <TouchableOpacity onPress={() => alCambiarFecha(moverJornada(fecha, -1, hoy))} style={flecha(true)} accessibilityLabel="Día anterior">
            <Text style={{ color: colors.text, fontWeight: '900' }}>◀</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <DateField value={fecha} onChange={elegirFecha} maxISO={hoy} />
          </View>
          <TouchableOpacity
            onPress={() => alCambiarFecha(moverJornada(fecha, 1, hoy))}
            disabled={!puedeAvanzar(fecha, hoy)}
            style={flecha(puedeAvanzar(fecha, hoy))}
            accessibilityLabel="Día siguiente"
          >
            <Text style={{ color: colors.text, fontWeight: '900' }}>▶</Text>
          </TouchableOpacity>
        </View>
        {fecha !== hoy ? (
          <TouchableOpacity onPress={() => alCambiarFecha(hoy)} style={{ alignSelf: 'flex-start', marginTop: spacing.xs }}>
            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>↩ Volver a hoy</Text>
          </TouchableOpacity>
        ) : null}
        {!puedeEscribir ? (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>👁️ Solo lectura: tu permiso es de Lectura.</Text>
        ) : null}
      </Card>

      {/* ── 1) REPORTE GENERAL ── */}
      <Bloque titulo="1 · 📊 Reporte General" resumen={resumenReporte} alerta={!!errorRg || !!reporteDelDia?.avisos.length} sinGuardar={sucios.reporte} abiertoPorDefecto>
        <BloqueReporteGeneral
          sitio={sitio}
          nivel={nivel}
          fecha={fecha}
          guardado={reporteDelDia}
          cargandoGuardado={cargandoReporte}
          errorGuardado={errorRg}
          alCambiar={recargarReporte}
          alCambiarFecha={elegirFecha}
          alSinGuardar={marcar.reporte}
        />
      </Bloque>

      {/* ── 2) ENTRADA POR PATIO ── */}
      <Bloque titulo="2 · 🚪 Entrada por patio" resumen="Viajes por patio, de 7am a 7pm" sinGuardar={sucios.patios} abiertoPorDefecto>
        <BloquePatios sitio={sitio} nivel={nivel} fecha={fecha} reporte={reporteDelDia} cargandoReporte={cargandoReporte} errorReporte={errorRg} alReintentarReporte={recargarReporte} alSinGuardar={marcar.patios} />
      </Bloque>

      {/* ── 3) SALIDAS ── */}
      <Bloque titulo="3 · 🚚 Salidas de agregados" resumen={resAgregados.texto} alerta={resAgregados.alerta} sinGuardar={sucios.agregados}>
        <SalidasAgregados sitio={sitio} nivel={nivel} fecha={fecha} datos={salidas} incrustado alSinGuardar={marcar.agregados} gruposUnidades={estadosMaq} />
      </Bloque>

      {/* ── 4) ACERO ── */}
      <Bloque titulo="4 · 🔩 Acero" resumen={resAcero.texto} alerta={resAcero.alerta} sinGuardar={sucios.acero}>
        <SalidasAcero sitio={sitio} nivel={nivel} fecha={fecha} datos={salidas} incrustado alSinGuardar={marcar.acero} gruposUnidades={estadosMaq} />
      </Bloque>

      {/* ── 5) ALUMINIO Y PLÁSTICO ── */}
      <Bloque titulo="5 · ♻️ Aluminio y plástico" resumen={resAluminio.texto} alerta={resAluminio.alerta} sinGuardar={sucios.aluminio}>
        <SalidasAluminioPlastico sitio={sitio} nivel={nivel} fecha={fecha} datos={salidas} incrustado alSinGuardar={marcar.aluminio} />
      </Bloque>

      {/* ── 6) MAQUINARIA ── */}
      <Bloque titulo="6 · 🚜 Maquinaria" resumen={resumenMaq} alerta={alertaMaq} sinGuardar={sucios.maquinaria}>
        <BloqueMaquinaria sitio={sitio} nivel={nivel} fecha={fecha} alConteo={setConteoMaq} alSinGuardar={marcar.maquinaria} alEstados={setEstadosMaq} />
      </Bloque>

      {/* ── 7) BLOQUES ── */}
      <Bloque titulo="7 · 🧱 Bloques" resumen="Producción del día, ventas e inventario disponible" sinGuardar={sucios.bloques}>
        <BloqueBloques sitio={sitio} nivel={nivel} fecha={fecha} alSinGuardar={marcar.bloques} />
      </Bloque>
    </View>
  );
}

export default ParteDiarioTab;
