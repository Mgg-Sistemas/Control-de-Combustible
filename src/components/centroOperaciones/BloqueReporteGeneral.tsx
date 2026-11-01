// 🏭 CENTRO DE OPERACIONES — 📅 PARTE DIARIO · 1) REPORTE GENERAL (24-oct-2026).
//
// El Reporte General le llega por WhatsApp; ella lo COPIA y lo PEGA aquí («no es que
// me va a poner residencia por residencia a transcribir»):
//   pegar → «Leer» → se ve lo leído (fecha y jornada, hora de corte, totales, la tabla
//   de empresas y la de frentes con viajes y t), los AVISOS (sumas que no cuadran, con
//   sus números) y las líneas que no se entendieron → «Guardar».
//
// ⭐ HAY UNO POR SITIO Y JORNADA: si ese día ya tiene uno, se pregunta «Ya hay un
//    Reporte General de ese día: ¿reemplazarlo?» (se le pregunta a la BASE justo antes
//    de guardar: otro equipo pudo pegarlo mientras tanto), diciendo lo guardado y lo
//    nuevo con su corte y sus cifras, y si el nuevo es de un corte ANTERIOR (lote 5 B13
//    y A9: un mensaje viejo de las 19:00 no pisa sin decirlo al de las 07:00).
// ⭐ SOLO SE GUARDA UN REPORTE GENERAL DE VERDAD (lote 5 B13): un mensaje del que solo se
//    leyó la fecha no se guarda (ni reemplaza uno bueno). Tampoco una jornada posterior a
//    hoy (B7: fecha mal escrita en el mensaje). Las reglas: `./reporteGeneralDelDia.ts`.
// ⭐ SE GUARDA EN LA JORNADA DEL REPORTE (la que dice su fecha de corte; un corte a las
//    07:00 cierra la jornada anterior, R28), no en la elegida arriba. Si no coinciden se
//    dice, y se ofrece cambiar la fecha de arriba; al guardarlo, la fecha se cambia sola
//    para que se vea lo guardado.
// ⭐ LO PEGADO NO SE PIERDE: si la base rechaza (permiso, conexión), el texto y lo leído
//    siguen en pantalla y el aviso queda escrito (un toast puede quedar tapado). Solo se
//    limpia después de guardar con éxito.
//
// Lectura ve lo guardado; Escritura y Full pegan y reemplazan; 🗑️ borrar, solo Full y
// con confirmación. El guardado del día lo carga ParteDiarioTab (lo usa también
// BloquePatios para la diferencia): este bloque avisa con `alCambiar` al guardar o borrar.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets, PermLevel } from '../../lib/permissions';
import { caracasBusinessToday } from '../../lib/caracasDay';
import type { FilaReporteDia, ReporteGeneralGuardado, Sitio } from '../../lib/centroOperaciones';
import { leerReporteGeneral, reporteCuadra } from '../../lib/centroOperacionesReporteGeneral';
import type { ReporteGeneral } from '../../lib/centroOperacionesReporteGeneral';
import { dmy } from '../../lib/centroOperacionesCarga';
import {
  NO_SE_BORRO,
  NO_SE_GUARDO,
  borrarReporteGeneral,
  cargarReportesGenerales,
  guardarReporteGeneral,
} from '../../lib/centroOperacionesDb';
import {
  avisoJornadaDistinta,
  jornadaDistinta,
  notaCorteMadrugada,
  sumaPatios,
  textoSelloReporte,
  textoToneladasRg,
  textoViajesRg,
} from './parteDiario';
import { jornadaFutura, reporteReconocido, textoReemplazo } from './reporteGeneralDelDia';

type Props = {
  sitio: Sitio;
  nivel: PermLevel;
  /** La jornada elegida arriba, «YYYY-MM-DD». */
  fecha: string;
  /** El Reporte General guardado de esa jornada (lo carga ParteDiarioTab). */
  guardado: ReporteGeneralGuardado | null;
  cargandoGuardado: boolean;
  errorGuardado: string | null;
  /** Que ParteDiarioTab vuelva a leer el guardado (después de guardar o borrar). */
  alCambiar: () => void;
  /** Cambiar la jornada de arriba (cuando el reporte pegado es de otra). */
  alCambiarFecha: (fecha: string) => void;
  /** Avisa si quedó algo pegado sin guardar (el encabezado plegado lo dice, lote 5 B10). */
  alSinGuardar?: (sinGuardar: boolean) => void;
};

const fmtEntero = (n: number): string => n.toLocaleString('es-VE', { maximumFractionDigits: 0 });
const fmtTon = (n: number): string => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Lo que se dice de un texto del que solo se leyó la fecha (lote 5 B13). */
const NO_RECONOCIDO = 'No se reconoció un Reporte General (no trae los totales ni las tablas de empresas y frentes): revisa que copiaste el mensaje correcto.';

// ═══════════════════════════ Una tabla: empresas o frentes ═══════════════════════════

function TablaReporte({ titulo, filas }: { titulo: string; filas: FilaReporteDia[] }) {
  const { colors } = useTheme();
  const celda = { color: colors.text, fontSize: 12 } as const;
  const num = { ...celda, width: 64, textAlign: 'right' as const };
  const ton = { ...celda, width: 92, textAlign: 'right' as const };
  const fila = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs, paddingVertical: 3, borderTopWidth: 1, borderTopColor: colors.border };
  const viajes = sumaPatios(filas.map((f) => f.viajes));
  const toneladas = filas.reduce((s, f) => s + (Number.isFinite(f.toneladas) ? f.toneladas : 0), 0);
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>{titulo.toUpperCase()} ({filas.length})</Text>
      {filas.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>Ninguna línea.</Text>
      ) : (
        <View style={{ marginTop: 2 }}>
          <View style={{ ...fila, borderTopWidth: 0 }}>
            <Text style={{ ...celda, flex: 1, color: colors.muted, fontWeight: '800' }}>Nombre</Text>
            <Text style={{ ...num, color: colors.muted, fontWeight: '800' }}>Viajes</Text>
            <Text style={{ ...ton, color: colors.muted, fontWeight: '800' }}>t</Text>
          </View>
          {filas.map((f, i) => (
            <View key={`${i}-${f.nombre}`} style={fila}>
              <Text style={{ ...celda, flex: 1 }}>{f.nombre}</Text>
              <Text style={num}>{fmtEntero(f.viajes)}</Text>
              <Text style={ton}>{fmtTon(f.toneladas)}</Text>
            </View>
          ))}
          <View style={fila}>
            <Text style={{ ...celda, flex: 1, fontWeight: '900' }}>Suma</Text>
            <Text style={{ ...num, fontWeight: '900' }}>{fmtEntero(viajes)}</Text>
            <Text style={{ ...ton, fontWeight: '900' }}>{fmtTon(toneladas)}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ═══════════════════════════ Lo leído o lo guardado ═══════════════════════════

type DatosVista = {
  /** Fecha escrita en el corte (solo en lo leído; lo guardado guarda la jornada). */
  fechaCorte?: string | null;
  jornada: string | null;
  horaCorte: string | null;
  viajesTotal: number | null;
  toneladasTotal: number | null;
  empresas: FilaReporteDia[];
  frentes: FilaReporteDia[];
};

/** La cabecera con la jornada, el corte y los totales, más las dos tablas. */
function VistaReporte({ d, cuadra }: { d: DatosVista; cuadra: boolean }) {
  const { colors } = useTheme();
  const corte = [d.fechaCorte ? dmy(d.fechaCorte) : '', d.horaCorte ?? ''].filter(Boolean).join(' · ');
  return (
    <View>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '900' }}>
        📅 Jornada {d.jornada ? dmy(d.jornada) : 'sin fecha'}{corte ? ` · corte ${corte}` : ''}
      </Text>
      <Text style={{ color: colors.brandText, fontSize: 15, fontWeight: '900', marginTop: 2 }}>
        {textoViajesRg(d.viajesTotal)} · {textoToneladasRg(d.toneladasTotal)}
      </Text>
      <Text style={{ fontSize: 12, fontWeight: '700', marginTop: 2, color: cuadra ? colors.success : colors.warning }}>
        {cuadra ? '✅ Empresas y frentes suman el total.' : '⚠️ Las sumas no cuadran con el total (mira los avisos).'}
      </Text>
      <TablaReporte titulo="Por empresa" filas={d.empresas} />
      <TablaReporte titulo="Por frente" filas={d.frentes} />
    </View>
  );
}

/** Una caja de aviso (amarilla) con una lista de líneas. */
function CajaAvisos({ titulo, lineas, tono }: { titulo: string; lineas: string[]; tono: 'aviso' | 'info' }) {
  const { colors } = useTheme();
  if (!lineas.length) return null;
  const bg = tono === 'aviso' ? colors.warningSoftBg : colors.infoSoftBg;
  const borde = tono === 'aviso' ? colors.warningSoftBorder : colors.infoSoftBorder;
  const texto = tono === 'aviso' ? colors.warningSoftText : colors.infoSoftText;
  return (
    <View style={{ backgroundColor: bg, borderColor: borde, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.sm, gap: 2 }}>
      <Text style={{ color: texto, fontSize: 12, fontWeight: '900' }}>{titulo}</Text>
      {lineas.map((l, i) => (
        <Text key={i} style={{ color: texto, fontSize: 12 }}>• {l}</Text>
      ))}
    </View>
  );
}

// ═══════════════════════════ El bloque ═══════════════════════════

export function BloqueReporteGeneral({ sitio, nivel, fecha, guardado, cargandoGuardado, errorGuardado, alCambiar, alCambiarFecha, alSinGuardar }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const puedeEscribir = levelMeets(nivel, 'escritura');
  const esFull = nivel === 'full';

  const [texto, setTexto] = useState('');
  /** Lo leído y el texto del que salió (si ella lo cambia después, hay que volver a leer). */
  const [leido, setLeido] = useState<{ r: ReporteGeneral; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [borrando, setBorrando] = useState(false);

  const textoCambio = !!leido && leido.texto !== texto;
  const jornadaLeida = leido?.r.jornada ?? null;
  const distinta = !!leido && jornadaDistinta(leido.r, fecha);
  const hoy = caracasBusinessToday();
  /** ¿Lo leído es un Reporte General? (la fecha sola no alcanza, B13) */
  const reconocido = !!leido && reporteReconocido(leido.r);
  /** ¿La jornada del reporte es posterior a hoy? (fecha mal escrita, B7) */
  const futura = jornadaFutura(jornadaLeida, hoy);

  // Lo pegado y no guardado: el encabezado plegado del Parte diario lo dice (B10).
  const sinGuardar = !!texto.trim();
  useEffect(() => { alSinGuardar?.(sinGuardar); }, [sinGuardar, alSinGuardar]);

  const leer = () => {
    if (!texto.trim()) return;
    setLeido({ r: leerReporteGeneral(texto), texto });
    setErrorGuardar(null);
  };

  const limpiar = () => {
    if (guardando) return;
    setTexto('');
    setLeido(null);
    setErrorGuardar(null);
  };

  const guardar = async () => {
    if (!leido || guardando || !puedeEscribir) return;
    if (textoCambio) { toast.error('El texto cambió después de leerlo: toca «Leer» otra vez.'); return; }
    const jornada = leido.r.jornada;
    if (!jornada) { toast.error('No se encontró la fecha de corte: sin ella no se sabe de qué jornada es.'); return; }
    if (!reporteReconocido(leido.r)) { toast.error(NO_RECONOCIDO); return; }
    if (jornadaFutura(jornada, hoy)) { toast.error(`La fecha del reporte (jornada del ${dmy(jornada)}) es posterior a hoy: revisa el mensaje.`); return; }
    setGuardando(true);
    setErrorGuardar(null);
    try {
      // ¿Ya hay uno de esa jornada? Se le pregunta a la base ahora: otro equipo pudo pegarlo.
      const existentes = await cargarReportesGenerales(sitio.id, jornada, jornada);
      const otraJornada = jornada !== fecha;
      if (existentes.length > 0) {
        const ok = await confirm({
          title: `Reemplazar el Reporte General del ${dmy(jornada)}`,
          message: `${otraJornada ? `Ojo: es de la jornada del ${dmy(jornada)}, no de la elegida arriba (${dmy(fecha)}). ` : ''}`
            + 'Ya hay un Reporte General de ese día: ¿reemplazarlo?\n\n'
            + textoReemplazo(existentes[0], { jornada, horaCorte: leido.r.horaCorte, viajesTotal: leido.r.viajesTotal, toneladasTotal: leido.r.toneladasTotal }),
          confirmText: 'Reemplazar',
          danger: true,
        });
        if (!ok) { setGuardando(false); return; }
      } else if (otraJornada) {
        const ok = await confirm({
          title: 'Es de otra jornada',
          message: `Este reporte es de la jornada del ${dmy(jornada)} y arriba está elegida la del ${dmy(fecha)}. Se guarda en la del ${dmy(jornada)}. ¿Seguir?`,
          confirmText: 'Guardar',
        });
        if (!ok) { setGuardando(false); return; }
      }
      await guardarReporteGeneral(sitio.id, leido.r, leido.texto);
    } catch (e: any) {
      // Permiso (RLS) o conexión: lo pegado y lo leído se quedan en pantalla.
      const msg = e?.message || NO_SE_GUARDO;
      setErrorGuardar(`${msg} Lo pegado sigue aquí: puedes intentar de nuevo.`);
      toast.error(msg);
      setGuardando(false);
      // Puede que la base SÍ lo haya guardado y se perdiera solo la respuesta: que se vea.
      alCambiar();
      return;
    }
    setGuardando(false);
    // ✅ Se guardó: recién ahora sobra lo pegado.
    setTexto('');
    setLeido(null);
    if (jornada !== fecha) {
      toast.success(`Reporte General guardado en la jornada del ${dmy(jornada)} (se cambió la fecha de arriba).`);
      alCambiarFecha(jornada);
    } else {
      toast.success('Reporte General guardado.');
      alCambiar();
    }
  };

  const borrar = async () => {
    if (!guardado || !esFull || borrando) return;
    const ok = await confirm({
      title: 'Borrar Reporte General',
      message: `¿Borrar el Reporte General de la jornada del ${dmy(guardado.fecha)}? No se puede deshacer (se puede volver a pegar).`,
      confirmText: 'Borrar',
      danger: true,
    });
    if (!ok) return;
    setBorrando(true);
    try {
      await borrarReporteGeneral(guardado.id);
      toast.success('Reporte General borrado.');
    } catch (e: any) {
      toast.error(e?.message || NO_SE_BORRO);
    } finally {
      setBorrando(false);
      alCambiar();
    }
  };

  // ── Estilos ──
  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, color: colors.text, marginTop: 4, minHeight: 140, fontSize: 13,
  } as const;
  const etiqueta = { color: colors.muted, fontSize: 11, fontWeight: '800' as const, marginTop: spacing.xs };
  const boton = (activo: boolean, color: string) => ({
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center' as const,
    backgroundColor: activo ? color : colors.border,
  });
  const botonBorde = {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center' as const,
    borderWidth: 1, borderColor: colors.border,
  };

  const puedeGuardar = !!leido && !textoCambio && !!jornadaLeida && !guardando && reconocido && !futura;
  const notaMadrugada = leido ? notaCorteMadrugada(leido.r) : null;
  const avisoOtra = leido ? avisoJornadaDistinta(leido.r, fecha) : null;

  return (
    <View style={{ gap: spacing.xs }}>
      {/* ── PEGAR Y LEER (Escritura y Full) ── */}
      {puedeEscribir ? (
        <View>
          <Text style={etiqueta}>PEGA AQUÍ EL REPORTE GENERAL DE WHATSAPP</Text>
          <TextInput
            value={texto}
            onChangeText={setTexto}
            multiline
            textAlignVertical="top"
            placeholder={'Pega aquí el Reporte General de WhatsApp\n(fecha de corte, viajes totales, total neto, por empresa y por frente)'}
            placeholderTextColor={colors.muted}
            style={input}
          />
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
            <TouchableOpacity onPress={leer} disabled={!texto.trim() || guardando} style={boton(!!texto.trim() && !guardando, colors.brand)}>
              <Text style={{ color: texto.trim() && !guardando ? colors.brandContrast : colors.muted, fontWeight: '900' }}>🔎 Leer</Text>
            </TouchableOpacity>
            {texto || leido ? (
              <TouchableOpacity onPress={limpiar} disabled={guardando} style={botonBorde}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Limpiar</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {leido ? (
            <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>LO QUE SE LEYÓ (TODAVÍA NO ESTÁ GUARDADO)</Text>
              {textoCambio ? (
                <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '800', marginBottom: 4 }}>
                  ⚠️ El texto cambió después de leerlo: toca «Leer» otra vez antes de guardar.
                </Text>
              ) : null}
              <VistaReporte
                d={{ ...leido.r, fechaCorte: leido.r.fecha }}
                cuadra={reporteCuadra(leido.r)}
              />
              {notaMadrugada ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>🕖 {notaMadrugada}</Text> : null}
              {!jornadaLeida ? (
                <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '800', marginTop: spacing.xs }}>
                  ⚠️ No se encontró la fecha de corte: sin ella no se sabe de qué jornada es y no se puede guardar. Revisa que copiaste el mensaje completo.
                </Text>
              ) : null}
              {jornadaLeida && !reconocido ? (
                <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '800', marginTop: spacing.xs }}>⚠️ {NO_RECONOCIDO}</Text>
              ) : null}
              {futura && jornadaLeida ? (
                <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '800', marginTop: spacing.xs }}>
                  ⚠️ La fecha del reporte (jornada del {dmy(jornadaLeida)}) es posterior a hoy: revisa el mensaje. No se puede guardar en un día que no ha empezado.
                </Text>
              ) : null}
              <CajaAvisos titulo={`⚠️ Avisos (${leido.r.avisos.length})`} lineas={leido.r.avisos} tono="aviso" />
              <CajaAvisos
                titulo={`📝 Líneas que no se leyeron (${leido.r.lineasNoLeidas.length}): revísalas, no entraron en las tablas`}
                lineas={leido.r.lineasNoLeidas}
                tono="info"
              />
              {distinta && avisoOtra && jornadaLeida && !futura ? (
                <View style={{ backgroundColor: colors.warningSoftBg, borderColor: colors.warningSoftBorder, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.sm, gap: spacing.xs }}>
                  <Text style={{ color: colors.warningSoftText, fontSize: 12, fontWeight: '800' }}>📅 {avisoOtra}</Text>
                  <TouchableOpacity onPress={() => alCambiarFecha(jornadaLeida)} style={{ ...botonBorde, borderColor: colors.warningSoftBorder, alignSelf: 'flex-start' }}>
                    <Text style={{ color: colors.warningSoftText, fontWeight: '900', fontSize: 12 }}>Cambiar arriba a la jornada del {dmy(jornadaLeida)}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <TouchableOpacity onPress={guardar} disabled={!puedeGuardar} style={{ ...boton(puedeGuardar, colors.accent), marginTop: spacing.sm }}>
                <Text style={{ color: puedeGuardar ? colors.accentContrast : colors.muted, fontWeight: '900' }}>
                  {guardando
                    ? 'Guardando…'
                    : !jornadaLeida
                      ? '💾 Guardar'
                      // Si ya se ve uno guardado de esa misma jornada, el botón lo dice (igual se confirma).
                      : guardado && guardado.fecha === jornadaLeida
                        ? `💾 Reemplazar el de la jornada del ${dmy(jornadaLeida)}`
                        : `💾 Guardar en la jornada del ${dmy(jornadaLeida)}`}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {errorGuardar ? (
            <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>⚠️ {errorGuardar}</Text>
          ) : null}
        </View>
      ) : null}

      {/* ── LO GUARDADO DE LA JORNADA ELEGIDA ── */}
      <View style={{ marginTop: puedeEscribir ? spacing.md : 0 }}>
        <Text style={etiqueta}>GUARDADO EN LA JORNADA DEL {dmy(fecha)}</Text>
        {errorGuardado ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', flex: 1, minWidth: 180 }}>
              ⚠️ {errorGuardado} — toca Reintentar (o desliza hacia abajo en el teléfono).
            </Text>
            <TouchableOpacity onPress={alCambiar} style={{ ...botonBorde, borderColor: colors.danger }}>
              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🔄 Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : cargandoGuardado && !guardado ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando…</Text>
        ) : !guardado ? (
          <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>
            Todavía no hay Reporte General de esta jornada.{puedeEscribir ? ' Pégalo arriba y toca «Leer».' : ''}
          </Text>
        ) : (
          <View style={{ marginTop: 4 }}>
            <VistaReporte
              d={{ jornada: guardado.fecha, horaCorte: guardado.horaCorte, viajesTotal: guardado.viajesTotal, toneladasTotal: guardado.toneladasTotal, empresas: guardado.empresas, frentes: guardado.frentes }}
              cuadra={reporteCuadra({
                titulo: null, sitioTexto: null, fecha: guardado.fecha, horaCorte: guardado.horaCorte, jornada: guardado.fecha,
                viajesTotal: guardado.viajesTotal, toneladasTotal: guardado.toneladasTotal,
                empresas: guardado.empresas, frentes: guardado.frentes, avisos: [], lineasNoLeidas: [],
              })}
            />
            <CajaAvisos titulo={`⚠️ Avisos que traía al pegarlo (${guardado.avisos.length})`} lineas={guardado.avisos} tono="aviso" />
            {textoSelloReporte(guardado) ? (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>🕓 {textoSelloReporte(guardado)}</Text>
            ) : null}
            {esFull ? (
              <TouchableOpacity onPress={borrar} disabled={borrando} style={{ ...botonBorde, borderColor: colors.danger, alignSelf: 'flex-start', marginTop: spacing.xs }}>
                <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>{borrando ? 'Borrando…' : '🗑️ Borrar'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

export default BloqueReporteGeneral;
