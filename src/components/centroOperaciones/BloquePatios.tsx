// 🏭 CENTRO DE OPERACIONES — 📅 PARTE DIARIO · 2) ENTRADA POR PATIO (24-oct-2026).
//
// Ella dice cuántos viajes entraron por cada patio entre las 7am y las 7pm: un campo
// por patio de su lista (la clase `terraza`, que acá se llama «Patio»). Debajo, la suma
// y la diferencia contra el total del Reporte General de ese día:
//   «Patios 250 · Reporte 238 · diferencia +12»
//
// ⭐ LA DIFERENCIA ES INFORMACIÓN, NO UN ERROR: solo ella sabe por qué patio entró cada
//    camión, y su conteo no tiene por qué coincidir con el reporte. Nada se pinta en rojo.
// ⭐ SE GUARDA SOLO LO QUE ELLA CAMBIÓ: «Guardar patios» manda a `guardarPatiosDelDia`
//    los patios cuyo campo tocó y quedó distinto de lo guardado (vacío = 0). Lo demás no
//    viaja: si otro equipo anotó otro patio mientras tanto, no se lo pisa. Y no se puede
//    guardar hasta que lo guardado de ESE día esté a la vista (si no, «vacío» no
//    significaría nada).
// ⭐ LO ESCRITO NO SE PIERDE: lo que tecleó se guarda en pantalla POR JORNADA: refrescar
//    o ir a otro día y volver no lo borra; si la base rechaza, sigue escrito y el aviso
//    queda en la tarjeta. Se limpia solo después de guardar con éxito.
//
// ⭐ LO DE ✍️ CARGA LIBRE VA APARTE (lote 5, A1): una entrada con unidad, toneladas,
//    transportista, nota… hacia un patio NO es su conteo por patio (la regla es
//    `esRenglonDePatio` de la librería, la misma de `guardarPatiosDelDia`): no va en el
//    campo ni en la suma, «Guardar patios» no la toca, y debajo del patio se dice
//    «+N viajes de ✍️ Carga libre hacia este patio (no van en este campo ni se suman)».
// ⭐ UN ERROR DE CARGA SE PUEDE REINTENTAR (lote 5, B12/B14): «🔄 Reintentar» junto al
//    aviso (en web deslizar no hace nada); y si el Reporte General no se pudo cargar, la
//    comparación lo dice en vez de quedarse en «cargando…».
// ⭐ «✏️ SIN GUARDAR» (revisión final B-M7): le avisa al Parte diario (`alSinGuardar`) si
//    hay patios por guardar, un campo con error o patios escritos en OTRA jornada (no se
//    ven, pero también se perderían al salir del Parte diario: se dice en la tarjeta).
//    Escribir lo mismo que está guardado no cuenta.
//
// Lectura ve los números; Escritura y Full los cambian. El Reporte General del día lo
// carga ParteDiarioTab y llega por props (el mismo que muestra el bloque 1), con su error.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useToast } from '../ToastProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets, PermLevel } from '../../lib/permissions';
import type { ItemLista, Movimiento, PatioDelDia, ReporteGeneralGuardado, Sitio } from '../../lib/centroOperaciones';
import { dmy, secuenciaDePedidos, viajesDeCampo } from '../../lib/centroOperacionesCarga';
import { NO_SE_GUARDO, cargarListas, cargarMovimientos, guardarPatiosDelDia } from '../../lib/centroOperacionesDb';
import { patiosDeLista, patiosGuardados, sumaPatios, textoCargaLibrePatio, textoPatiosVsReporte } from './parteDiario';
import { jornadasConPatiosEscritos, pideloAQuienAdministra } from './pantallaParteDiario';

type Props = {
  sitio: Sitio;
  nivel: PermLevel;
  /** La jornada elegida arriba, «YYYY-MM-DD». */
  fecha: string;
  /** El Reporte General guardado de esa jornada (lo carga ParteDiarioTab). */
  reporte: ReporteGeneralGuardado | null;
  cargandoReporte: boolean;
  /** Lote 5 B14: el error al cargar ese Reporte General (si falló), para decirlo en vez de «cargando…». */
  errorReporte?: string | null;
  /** Lote 5 B12/B14: cómo volver a pedir el Reporte General (lo da ParteDiarioTab). */
  alReintentarReporte?: () => void;
  /** Revisión final B-M7: avisa si quedó algo escrito sin guardar (el encabezado y la salida del Parte diario). */
  alSinGuardar?: (sinGuardar: boolean) => void;
};

const fmtEntero = (n: number): string => n.toLocaleString('es-VE', { maximumFractionDigits: 0 });

export function BloquePatios({ sitio, nivel, fecha, reporte, cargandoReporte, errorReporte, alReintentarReporte, alSinGuardar }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const puedeEscribir = levelMeets(nivel, 'escritura');

  const [listas, setListas] = useState<ItemLista[]>([]);
  /** Los renglones de la jornada y de CUÁL jornada son (mientras llega otra, no se muestran). */
  const [delDia, setDelDia] = useState<{ fecha: string; movs: Movimiento[] } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  /** Lo tecleado y sin guardar, por jornada y por id del patio. */
  const [editados, setEditados] = useState<Record<string, Record<string, string>>>({});
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  // ── La lista de patios y los renglones del día ──
  // ⭐ Depende del objeto `sitio` (la pantalla lo recrea al entrar y al deslizar) y corre
  //    al enfocarse; una respuesta vieja no pisa a la nueva (cada carga pide su número).
  const pedidos = useRef(secuenciaDePedidos()).current;
  const recargar = useCallback(async () => {
    const n = pedidos.nuevo();
    setCargando(true);
    setErrorCarga(null);
    try {
      const [l, movs] = await Promise.all([cargarListas(sitio.id), cargarMovimientos(sitio.id, fecha, fecha)]);
      if (!pedidos.vigente(n)) return;
      setListas(l);
      setDelDia({ fecha, movs });
    } catch (e: any) {
      if (!pedidos.vigente(n)) return;
      const msg = e?.message || 'No se pudieron cargar los patios del día.';
      setErrorCarga(msg);
      toast.error(msg);
    } finally {
      if (pedidos.vigente(n)) setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio, fecha]);
  useFocusEffect(useCallback(() => { recargar(); }, [recargar]));

  const patios = useMemo(() => patiosDeLista(listas), [listas]);
  const listo = !!delDia && delDia.fecha === fecha && !errorCarga;
  const guardados = useMemo(() => patiosGuardados(listo ? delDia!.movs : [], patios), [listo, delDia, patios]);
  const misEditados = editados[fecha] ?? {};

  /** Lo que se ve en el campo: lo tecleado o, si no lo tocó, lo guardado. */
  const textoDe = (id: string): string => {
    if (id in misEditados) return misEditados[id];
    const g = guardados.porPatio[id];
    return g == null ? '' : String(g);
  };
  const cambiar = (id: string, txt: string) => {
    // B-M7: escribir lo mismo que está guardado no deja un «sin guardar» fantasma.
    const g = guardados.porPatio[id];
    const comoGuardado = g == null ? '' : String(g);
    setEditados((e) => {
      const delDia = { ...(e[fecha] ?? {}) };
      if (txt === comoGuardado) delete delDia[id];
      else delDia[id] = txt;
      return { ...e, [fecha]: delDia };
    });
  };

  // ── Lecturas en vivo: cada campo, la suma y los cambios por guardar ──
  const lecturas = patios.map((p) => ({ patio: p, lectura: viajesDeCampo(textoDe(p.id)) }));
  const suma = sumaPatios(lecturas.map((x) => x.lectura.valor));
  const conError = lecturas.filter((x) => x.lectura.error);
  const cambios: PatioDelDia[] = lecturas
    .filter((x) => x.patio.id in misEditados && !x.lectura.error)
    .filter((x) => {
      const nuevo = x.lectura.valor ?? 0;
      const antes = guardados.porPatio[x.patio.id];
      return antes == null ? nuevo !== 0 : nuevo !== antes;
    })
    .map((x) => ({ patio: x.patio.nombre, patioListaId: x.patio.id, viajes: x.lectura.valor ?? 0 }));
  const hayCambios = cambios.length > 0;
  // ¿Quedó algo escrito sin guardar? (B-M7: el encabezado plegado lo dice y salir del Parte diario pregunta)
  const otrasJornadas = jornadasConPatiosEscritos(editados, fecha);
  const sinGuardar = hayCambios || conError.length > 0 || otrasJornadas.length > 0;
  useEffect(() => { alSinGuardar?.(sinGuardar); }, [sinGuardar, alSinGuardar]);

  const guardar = async () => {
    if (guardando || !puedeEscribir) return;
    if (!listo) { toast.error('Espera a que carguen los patios de este día.'); return; }
    if (conError.length) {
      const msg = `Revisa ${conError.map((x) => `«${x.patio.nombre}»`).join(', ')}: ${conError[0].lectura.error}`;
      setErrorGuardar(msg);
      toast.error(msg);
      return;
    }
    if (!hayCambios) { toast.info('No hay cambios que guardar.'); return; }
    const delaFecha = fecha;
    /** Lo tecleado que se mandó: al terminar se quita SOLO eso (si siguió escribiendo, queda). */
    const enviados = { ...misEditados };
    setGuardando(true);
    setErrorGuardar(null);
    try {
      await guardarPatiosDelDia(sitio.id, delaFecha, cambios);
    } catch (e: any) {
      // Permiso o conexión: lo tecleado se queda; puede que una parte sí haya entrado (el
      // aviso dice cuántos patios, lote 5 A5), por eso se vuelve a leer y «por guardar» se
      // recalcula contra lo nuevo: lo que entró deja de verse como cambio.
      const msg = e?.message || NO_SE_GUARDO;
      setErrorGuardar(`${msg} Se volvió a leer lo guardado: lo que no entró sigue escrito.`);
      toast.error(msg);
      setGuardando(false);
      recargar();
      return;
    }
    setGuardando(false);
    toast.success('Patios guardados.');
    // ✅ Se guardó. Primero se vuelve a leer (así los campos no muestran un instante lo
    //    viejo) y recién después se quita lo tecleado que se mandó.
    await recargar();
    setEditados((e) => {
      const actuales = { ...(e[delaFecha] ?? {}) };
      for (const [id, txt] of Object.entries(enviados)) if (actuales[id] === txt) delete actuales[id];
      const { [delaFecha]: _quitado, ...resto } = e;
      return Object.keys(actuales).length ? { ...resto, [delaFecha]: actuales } : resto;
    });
  };

  // ── Estilos ──
  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, color: colors.text, width: 110, textAlign: 'right' as const, fontSize: 15,
  };
  // ⭐ Sin el Reporte General a la vista: si su carga FALLÓ se dice (lote 5 B14); si no, se
  //    espera. Con el último bueno de ese mismo día, se compara contra él.
  const sinReporteVisible = !reporte;
  const comparacion = errorReporte && sinReporteVisible
    ? `Patios ${fmtEntero(suma)} · no se pudo cargar el Reporte General`
    : cargandoReporte && sinReporteVisible
      ? `Patios ${fmtEntero(suma)} · cargando el Reporte General…`
      : textoPatiosVsReporte(suma, reporte?.viajesTotal ?? null, !!reporte);
  const botonReintentar = {
    alignSelf: 'flex-start' as const, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 4, backgroundColor: colors.surface,
  };

  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.muted, fontSize: 12 }}>Viajes que entraron por cada patio el {dmy(fecha)}, de 7am a 7pm.</Text>
      {otrasJornadas.length ? (
        <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700' }}>
          ✏️ Hay patios escritos sin guardar en {otrasJornadas.length === 1 ? 'la jornada del' : 'las jornadas del'} {otrasJornadas.map(dmy).join(', ')}: vuelve a ese día para guardarlos.
        </Text>
      ) : null}

      {errorCarga ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>⚠️ {errorCarga} — toca Reintentar (o desliza hacia abajo en el teléfono).</Text>
          <TouchableOpacity onPress={() => { recargar(); }} disabled={cargando} style={[botonReintentar, { opacity: cargando ? 0.5 : 1 }]}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>{cargando ? 'Cargando…' : '🔄 Reintentar'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!listo && !errorCarga ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando…</Text>
      ) : listo && patios.length === 0 ? (
        <View style={{ backgroundColor: colors.infoSoftBg, borderColor: colors.infoSoftBorder, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm }}>
          <Text style={{ color: colors.infoSoftText, fontSize: 12, fontWeight: '700' }}>
            Este sitio todavía no tiene patios. Se crean en ⚙️ Ajustes → 📚 Listas de apoyo, en la lista de patios (⛰️ Patios): Patio A, Patio B…
            {pideloAQuienAdministra(nivel)}
          </Text>
        </View>
      ) : listo ? (
        <View>
          {lecturas.map(({ patio, lectura }) => (
            <View key={patio.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🚪 {patio.nombre}</Text>
                {lectura.error ? <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>⚠️ {lectura.error}</Text> : null}
                {patio.id in misEditados && !lectura.error ? (
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {guardados.porPatio[patio.id] == null ? 'sin guardar' : `guardado: ${fmtEntero(guardados.porPatio[patio.id] as number)}`}
                  </Text>
                ) : null}
                {textoCargaLibrePatio(guardados.cargaLibre[patio.id]) ? (
                  <Text style={{ color: colors.infoSoftText, fontSize: 11 }}>{textoCargaLibrePatio(guardados.cargaLibre[patio.id])}</Text>
                ) : null}
              </View>
              {puedeEscribir ? (
                <TextInput
                  value={textoDe(patio.id)}
                  onChangeText={(t) => cambiar(patio.id, t)}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  style={{ ...input, borderColor: lectura.error ? colors.danger : colors.border }}
                />
              ) : (
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, minWidth: 60, textAlign: 'right' }}>
                  {lectura.valor == null ? '—' : fmtEntero(lectura.valor)}
                </Text>
              )}
            </View>
          ))}

          {/* La comparación: neutra (es información, no un error). */}
          <View style={{ backgroundColor: colors.infoSoftBg, borderColor: colors.infoSoftBorder, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.xs }}>
            <Text style={{ color: colors.infoSoftText, fontSize: 13, fontWeight: '900' }}>{comparacion}</Text>
            <Text style={{ color: colors.infoSoftText, fontSize: 11, marginTop: 2 }}>
              {hayCambios ? 'Con lo escrito sin guardar. ' : ''}El conteo por patio es tuyo: una diferencia con el reporte es información, no un error.
            </Text>
            {errorReporte && sinReporteVisible && alReintentarReporte ? (
              <TouchableOpacity onPress={() => { alReintentarReporte(); }} style={[botonReintentar, { marginTop: 4 }]}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>🔄 Reintentar el Reporte General</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {guardados.otros.length ? (
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
              También hay entradas sueltas ese día hacia {guardados.otros.map((o) => `${o.destino} (${fmtEntero(o.viajes)})`).join(', ')}: no son patios de la lista y no se suman (se ven y corrigen en ✍️ Carga libre).
            </Text>
          ) : null}

          {puedeEscribir ? (
            <TouchableOpacity
              onPress={guardar}
              disabled={guardando || !hayCambios}
              style={{
                marginTop: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center',
                backgroundColor: !guardando && hayCambios ? colors.accent : colors.border,
              }}
            >
              <Text style={{ color: !guardando && hayCambios ? colors.accentContrast : colors.muted, fontWeight: '900' }}>
                {guardando ? 'Guardando…' : hayCambios ? `💾 Guardar patios (${cambios.length})` : '💾 Guardar patios'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {errorGuardar ? (
            <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>⚠️ {errorGuardar}</Text>
          ) : null}
        </View>
      ) : null}
      {cargando && listo ? <Text style={{ color: colors.muted, fontSize: 11 }}>Actualizando…</Text> : null}
    </View>
  );
}

export default BloquePatios;
