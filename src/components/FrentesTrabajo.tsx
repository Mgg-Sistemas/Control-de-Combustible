// ⛏️ FRENTES DE TRABAJO (28-sep-2026) — subsección de «🏗️ Obras y ubicaciones».
//
// El FRENTE es de DÓNDE recogen los camiones el material que después llevan a
// los CDT/CDF (las obras/ubicaciones son el destino; el frente, el origen).
// Pedido del cliente, con sus cuatro piezas:
//   1) CREAR frentes (y apagarlos sin borrar, como los tipos de viaje).
//   2) ASIGNAR el frente DEL DÍA a cada camión, a varios de una vez o a un
//      grupo — con BUSCADOR de camiones (placa, código, serial, empresa…).
//   3) Cada viaje de ese día TOMA el frente de su camión: los que se registran
//      después lo congelan, y los que ya estaban registrados SIN frente lo
//      toman solos al leerse (29-sep-2026, ver `src/lib/frentesAuto.ts`).
//   4) A un viaje YA HECHO el frente se le puede cambiar en ✏️ Editar (y lo que
//      se le pone ahí manda sobre la asignación del día).
//
// SEGUNDA VUELTA (29-sep-2026): el papel del día lleva sus CHECKS (qué columnas
// y qué líneas salen) y sus LOGOS, y debajo está el 🕘 HISTORIAL de qué frentes
// se asignaron cada día.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { DateField } from './DateField';
import { Plegable } from './Plegable';
import { Toggle } from './CubicajeTab';
import {
  listAsignacionesFrente, listAsignacionesFrenteRango, asignarFrente, quitarAsignacionFrente,
  crearFrente, setActivoFrente,
  type FrenteTrabajo, type AsignacionFrente,
} from '../lib/camionViajes';
import { exportPdf, pdfDocument } from '../lib/pdf';
import {
  frentesParaReporte, cuerpoFrentesDelDia, nombreArchivoFrentes, etiquetaOpcionesFrentes,
  historialFrentes, CSS_FRENTES, FRENTES_POR_DEFECTO, LOGOS_FRENTES_POR_DEFECTO,
  type OpcionesFrentes, type LogosFrentes, type DiaHistorialFrentes,
} from '../lib/frentesReporte';

/** Lo que hace falta de cada camión para el buscador de la asignación. */
export type CamionParaFrente = {
  id: string;
  code: string;
  plate?: string | null;
  serial?: string | null;
  companyName?: string | null;
  marca?: string | null;
  modelo?: string | null;
};

type Props = {
  frentes: FrenteTrabajo[];
  faltaSql: boolean;
  canFull: boolean;
  camiones: CamionParaFrente[];
  /** La jornada de HOY (negocio, 7am a 7am), para arrancar el día correcto. */
  jornadaHoy: string;
  uid: string | null;
  userName: string | null;
  /** Recarga los frentes Y las asignaciones que la pantalla congela al registrar. */
  onCambio: () => void;
};

const norm = (s: unknown) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const dmy = (iso: string) => String(iso ?? '').slice(0, 10).split('-').reverse().join('/');

/** Cuántos días atrás mira el historial. Un mes y medio: más que eso ya es un
 *  reporte, y para eso está el PDF de cada día. */
const DIAS_HISTORIAL = 45;

/** El día ISO que está `dias` días antes de `iso` (mediodía para que ningún
 *  cambio de hora mueva la fecha). */
function diasAntes(iso: string, dias: number): string {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

export function FrentesTrabajo({ frentes, faltaSql, canFull, camiones, jornadaHoy, uid, userName, onCambio }: Props) {
  const { colors } = useTheme();
  const toast = useToast();

  const [nuevo, setNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  // ── La asignación del día ──
  const [fecha, setFecha] = useState(jornadaHoy);
  const [frenteSel, setFrenteSel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [asignaciones, setAsignaciones] = useState<AsignacionFrente[]>([]);
  const [recarga, setRecarga] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  // ── 🖨️ Qué sale en la hoja (29-sep-2026, a pedido) ──
  const [op, setOp] = useState<OpcionesFrentes>({ ...FRENTES_POR_DEFECTO });
  const [logos, setLogos] = useState<LogosFrentes>({ ...LOGOS_FRENTES_POR_DEFECTO });
  // ── 🕘 El historial ──
  const [historial, setHistorial] = useState<DiaHistorialFrentes[]>([]);

  useEffect(() => {
    let vivo = true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
    listAsignacionesFrente(fecha).then((r) => {
      if (!vivo) return;
      setAsignaciones(r.asignaciones);
      if (r.error && !r.missing) console.warn('[frentes] no se pudo leer las asignaciones:', r.error);
    });
    return () => { vivo = false; };
  }, [fecha, recarga]);

  // 🕘 EL HISTORIAL: los últimos 45 días de asignaciones, agrupados por jornada.
  //    Se recarga cuando se asigna o se quita algo, para que lo que acabas de
  //    hacer se vea sin refrescar la pantalla.
  useEffect(() => {
    let vivo = true;
    if (!canFull) return;
    listAsignacionesFrenteRango(diasAntes(jornadaHoy, DIAS_HISTORIAL), jornadaHoy).then((r) => {
      if (!vivo) return;
      setHistorial(historialFrentes(r.asignaciones));
      if (r.error && !r.missing) console.warn('[frentes] no se pudo leer el historial:', r.error);
    });
    return () => { vivo = false; };
  }, [canFull, jornadaHoy, recarga]);

  const activos = useMemo(() => frentes.filter((f) => f.activo), [frentes]);
  const asignadoA = useMemo(() => new Map(asignaciones.map((a) => [a.machineryId, a])), [asignaciones]);

  // El buscador: por código, placa, serial, empresa, marca o modelo — el mismo
  // criterio del buscador de taras, porque el problema es el mismo (treinta
  // camiones que se llaman todos «CAMION VOLTEO TORONTO»).
  const camionesFiltrados = useMemo(() => {
    const q = norm(query).trim();
    if (!q) return camiones;
    return camiones.filter((c) =>
      [c.code, c.plate, c.serial, c.companyName, c.marca, c.modelo].some((v) => norm(v).includes(q)));
  }, [camiones, query]);

  const toggleCamion = (id: string) =>
    setMarcados((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const crear = async () => {
    setGuardando(true);
    const { error } = await crearFrente(nuevo, uid, userName);
    setGuardando(false);
    if (error) { toast.error(error); return; }
    setNuevo('');
    toast.success('Frente creado.');
    onCambio();
  };

  const alternar = async (f: FrenteTrabajo) => {
    const { error } = await setActivoFrente(f.id, !f.activo, userName);
    if (error) { toast.error(error); return; }
    toast.success(f.activo
      ? 'Frente desactivado: deja de ofrecerse, pero los viajes que ya lo llevan no cambian.'
      : 'Frente activado.');
    onCambio();
  };

  const asignar = async () => {
    if (!frenteSel) { toast.error('Elige primero el frente.'); return; }
    if (marcados.size === 0) { toast.error('Marca al menos un camión (usa el buscador).'); return; }
    setGuardando(true);
    const { error } = await asignarFrente(fecha, Array.from(marcados), frenteSel, uid, userName);
    setGuardando(false);
    if (error) { toast.error(error); return; }
    const nombre = activos.find((f) => f.id === frenteSel)?.nombre ?? '';
    // ⛏️ El aviso dice lo que de verdad pasa desde el 29-sep: TODOS los viajes
    //    de ese día que no tengan frente propio lo toman solos, los que ya
    //    estaban registrados y los que vengan.
    toast.success(`${marcados.size} camión(es) al frente «${nombre}» el ${dmy(fecha)}. Los viajes de ese día sin frente lo toman automáticamente.`);
    setMarcados(new Set());
    setRecarga((n) => n + 1);
    onCambio();
  };

  /**
   * 📄 EL PDF DE LOS FRENTES DEL DÍA (29-sep-2026, a pedido).
   *
   * ⚠️ SIN UNA SOLA CIFRA de operación (pedido explícito: «no es necesario que
   *    tenga toneladas, ni nada de eso»): es la hoja de ASIGNACIÓN — qué camión
   *    recoge en qué frente ese día. Las cantidades viven en el reporte de la
   *    Lista completa, que ya agrupa por frente.
   *
   * ⚠️ SIN «Banco Central de Venezuela / SOS La Guaira» (pedido del 29-sep: «ya
   *    no va»): ni en el pie (`marcaTexto: false`) ni de logo (nacen apagados).
   *    Se pueden volver a encender con los interruptores de 🏷️ logos.
   */
  const exportarPdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const grupos = frentesParaReporte(
        asignaciones.map((a) => {
          const c = camiones.find((x) => x.id === a.machineryId);
          return {
            frenteNombre: a.frenteNombre,
            camion: {
              code: c?.code ?? '(camión fuera del catálogo)',
              placa: c?.plate || c?.serial || null,
              empresa: c?.companyName || null,
              marcaModelo: [c?.marca, c?.modelo].filter(Boolean).join(' ') || null,
            },
          };
        }),
        activos.map((f) => f.nombre),
        op,
      );
      const html = pdfDocument({
        title: 'Frentes de trabajo',
        subtitle: `Asignación del ${dmy(fecha)} · de dónde recoge cada camión${etiquetaOpcionesFrentes(op)}`,
        extraCss: CSS_FRENTES,
        body: cuerpoFrentesDelDia(grupos, op),
        logos,
        // Igual que los demás papeles de viajes de camiones (28-sep-2026), y
        // además pedido de nuevo para esta hoja el 29-sep-2026.
        marcaTexto: false,
      });
      await exportPdf(html, nombreArchivoFrentes(fecha));
    } catch (e: any) {
      toast.error(`No se pudo generar el PDF: ${String(e?.message ?? e)}`);
    } finally {
      setPdfBusy(false);
    }
  };

  const quitar = async (a: AsignacionFrente) => {
    const { error } = await quitarAsignacionFrente(fecha, a.machineryId);
    if (error) { toast.error(error); return; }
    setRecarga((n) => n + 1);
    onCambio();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text } as const;
  const codigoDe = (id: string) => {
    const c = camiones.find((x) => x.id === id);
    return c ? `${c.code}${c.plate ? ` · ${c.plate}` : c.serial ? ` · ${c.serial}` : ''}` : '(camión fuera del catálogo)';
  };

  const CHECKS: { k: keyof OpcionesFrentes; label: string; ayuda: string }[] = [
    { k: 'numeracion', label: '1️⃣ Numeración de los camiones', ayuda: 'La columna Nº dentro de cada frente.' },
    { k: 'placa', label: '🔢 Placa / Serial', ayuda: 'Cómo se identifica el camión en el patio.' },
    { k: 'empresa', label: '🏢 Empresa del camión', ayuda: 'A quién pertenece cada camión.' },
    { k: 'marcaModelo', label: '🚚 Marca y modelo', ayuda: 'Dato de taller; normalmente no hace falta en la hoja de patio.' },
    { k: 'contador', label: '🔟 Cuántos camiones lleva cada frente', ayuda: 'El «N camión(es)» al lado del nombre del frente.' },
    { k: 'totales', label: '📋 Línea de totales arriba', ayuda: 'Camiones asignados y cuántos frentes se usaron.' },
    { k: 'sinCamiones', label: '⬜ Incluir los frentes SIN camiones', ayuda: 'Apagado (como pediste) salen SOLO los frentes asignados ese día. Encendido también los que quedaron vacíos.' },
  ];
  const LOGOS: { k: keyof LogosFrentes; label: string }[] = [
    { k: 'bcv', label: '🏦 Banco Central de Venezuela' },
    { k: 'sos', label: '🛟 SOS La Guaira' },
    { k: 'golden', label: '✨ Golden Touch' },
    { k: 'renace', label: '🇻🇪 Plan Venezuela Renace' },
    { k: 'jhenzaen', label: '🏗️ Jhenzaen 2.012 C.A' },
  ];
  const logosPuestos = LOGOS.filter((l) => logos[l.k]).length;
  const ocultos = CHECKS.filter((c) => c.k !== 'sinCamiones' && !op[c.k]).length;

  return (
    <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>⛏️ FRENTES DE TRABAJO · {activos.length}</Text>
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
        El frente es DE DÓNDE recogen los camiones lo que llevan a los CDT/CDF. Asigna el frente del
        día a cada camión (o a varios de una vez): TODOS los viajes de ese día que no tengan frente
        propio lo toman automáticamente, los que ya estaban registrados y los que vengan. A un viaje
        suelto se le puede poner otro frente en ✏️ Editar, y ese manda.
      </Text>

      {faltaSql ? (
        <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12, marginTop: spacing.xs }}>
          ⚠️ Falta correr el SQL de los frentes en la base. Avisa al administrador.
        </Text>
      ) : (
        <>
          {/* ── El catálogo ── */}
          {canFull ? (
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
              <TextInput
                value={nuevo}
                onChangeText={setNuevo}
                placeholder="Nombre del frente nuevo (ej. Frente norte)"
                placeholderTextColor={colors.muted}
                style={[input, { flex: 1 }]}
              />
              <TouchableOpacity disabled={guardando} onPress={crear}
                style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: guardando ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>+ Crear</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {frentes.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Todavía no hay frentes creados.</Text>
          ) : (
            <View style={{ marginTop: spacing.xs }}>
              {frentes.map((f) => (
                <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: f.activo ? colors.text : colors.muted, fontWeight: '700', fontSize: 12.5, flex: 1 }}>
                    ⛏️ {f.nombre}{f.activo ? '' : ' · DESACTIVADO'}
                  </Text>
                  {canFull ? (
                    <TouchableOpacity onPress={() => alternar(f)}>
                      <Text style={{ color: f.activo ? colors.danger : colors.success, fontWeight: '800', fontSize: 12 }}>
                        {f.activo ? '🚫 Desactivar' : '✓ Activar'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {/* ── La asignación del día ── */}
          {canFull && activos.length > 0 ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>ASIGNAR EL FRENTE DEL DÍA</Text>
              <View style={{ marginTop: spacing.xs }}>
                <DateField value={fecha} onChange={setFecha} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                {activos.map((f) => {
                  const on = frenteSel === f.id;
                  return (
                    <TouchableOpacity key={f.id} onPress={() => setFrenteSel(on ? null : f.id)}
                      style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>⛏️ {f.nombre}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="🔎 Buscar camión: placa, código, serial, empresa…"
                placeholderTextColor={colors.muted}
                style={[input, { marginTop: spacing.xs }]}
                autoCorrect={false}
              />
              <ScrollView style={{ maxHeight: 240, marginTop: spacing.xs }} nestedScrollEnabled>
                {camionesFiltrados.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Ningún camión coincide con la búsqueda.</Text>
                ) : camionesFiltrados.map((c) => {
                  const on = marcados.has(c.id);
                  const ya = asignadoA.get(c.id);
                  return (
                    <TouchableOpacity key={c.id} onPress={() => toggleCamion(c.id)}
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ fontSize: 14, width: 24 }}>{on ? '☑️' : '⬜'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>
                          🚜 {c.code}{c.plate ? ` · ${c.plate}` : c.serial ? ` · ${c.serial}` : ''}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                          {[c.companyName, [c.marca, c.modelo].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || ' '}
                          {ya ? `  · ya: ⛏️ ${ya.frenteNombre}` : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TouchableOpacity disabled={guardando} onPress={asignar}
                style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: guardando ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>
                  ⛏️ Asignar {marcados.size > 0 ? `${marcados.size} camión(es)` : ''} al frente
                </Text>
              </TouchableOpacity>

              {/* Lo asignado ese día, agrupado por frente, con su ✕. */}
              {asignaciones.length > 0 ? (
                <View style={{ marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', flex: 1 }}>ASIGNADOS ESE DÍA · {asignaciones.length}</Text>
                    {/* 📄 La hoja de asignación del día. Sin cifras: solo quién
                        recoge dónde (pedido explícito del cliente). */}
                    <TouchableOpacity disabled={pdfBusy} onPress={exportarPdf}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
                        {pdfBusy ? 'Generando…' : '📄 PDF del día'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {activos.filter((f) => asignaciones.some((a) => a.frenteId === f.id)).map((f) => (
                    <View key={`g-${f.id}`} style={{ marginTop: 4 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>⛏️ {f.nombre}</Text>
                      {asignaciones.filter((a) => a.frenteId === f.id).map((a) => (
                        <View key={a.machineryId} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.sm, paddingVertical: 2 }}>
                          <Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>🚜 {codigoDe(a.machineryId)}</Text>
                          <TouchableOpacity onPress={() => quitar(a)}>
                            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ))}

                  {/* 🖨️ QUÉ SALE EN LA HOJA (29-sep-2026, a pedido). Mismo
                      criterio que los demás reportes: el usuario decide. */}
                  <Plegable
                    titulo="🖨️ Qué sale en la hoja de frentes"
                    resumen={`${ocultos === 0 ? 'todo' : `${ocultos} dato(s) oculto(s)`} · ${logosPuestos === 0 ? 'sin logos' : `${logosPuestos} logo(s)`}${op.sinCamiones ? ' · con los frentes vacíos' : ''}`}
                  >
                    {CHECKS.map((c) => (
                      <Toggle
                        key={c.k}
                        on={op[c.k]}
                        label={c.label}
                        ayuda={c.ayuda}
                        onPress={() => setOp((p) => ({ ...p, [c.k]: !p[c.k] }))}
                      />
                    ))}
                    <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800', marginTop: spacing.sm }}>QUÉ LOGOS LLEVA EL MEMBRETE</Text>
                    <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>
                      Esta hoja nace SIN logos y sin el pie de «Banco Central de Venezuela / SOS La
                      Guaira», como pediste. Enciende el que necesites.
                    </Text>
                    {LOGOS.map((l) => (
                      <Toggle
                        key={l.k}
                        on={logos[l.k]}
                        label={l.label}
                        onPress={() => setLogos((p) => ({ ...p, [l.k]: !p[l.k] }))}
                      />
                    ))}
                  </Plegable>
                </View>
              ) : (
                <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: spacing.sm }}>
                  Ese día todavía no hay ningún camión asignado a un frente.
                </Text>
              )}

              {/* 🕘 EL HISTORIAL (29-sep-2026, a pedido: «que haya un historial
                  de frentes de trabajo ahí mismo en ese apartado»). Toca un día
                  para abrirlo arriba: se ve su asignación y se puede imprimir. */}
              <Plegable
                titulo="🕘 Historial de frentes de trabajo"
                resumen={historial.length === 0
                  ? `sin asignaciones en los últimos ${DIAS_HISTORIAL} días`
                  : `${historial.length} día(s) con asignación · últimos ${DIAS_HISTORIAL} días`}
              >
                {historial.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    No hay asignaciones registradas en los últimos {DIAS_HISTORIAL} días.
                  </Text>
                ) : historial.map((d) => (
                  <TouchableOpacity key={d.jornada} onPress={() => setFecha(d.jornada)}
                    style={{ paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: d.jornada === fecha ? colors.brandText : colors.text, fontWeight: '800', fontSize: 12.5 }}>
                      📅 {dmy(d.jornada)}{d.jornada === jornadaHoy ? ' · HOY' : ''} · {d.camiones} camión(es)
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      {d.frentes.map((f) => `⛏️ ${f.nombre} (${f.camiones})`).join('  ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </Plegable>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
