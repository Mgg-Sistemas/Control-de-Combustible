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
  crearFrente, setActivoFrente, renombrarFrente, borrarFrente, contarAsignacionesFrente,
  type FrenteTrabajo, type AsignacionFrente,
} from '../lib/camionViajes';
import { exportPdf, pdfDocument } from '../lib/pdf';
import {
  ETIQUETA_CAMION, ETIQUETA_EQUIPO,
  frentesParaReporte, cuerpoFrentesDelDia, nombreArchivoFrentes,
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
  /**
   * ⛏️ FRENTES PARA MAQUINARIA (02-oct-2026, a pedido: «un apartado en Reportes
   * para frentes, como el de viajes, que no choque ni rompa nada»). Con
   * 'maquinas' el mismo apartado se usa desde Reportes con TODAS las máquinas,
   * hablando de «equipos». Por defecto 'camiones': el de viajes, igual que siempre.
   *
   * ⚠️ LAS ASIGNACIONES SE ACOTAN A LA LISTA QUE RECIBE: viajes solo ve y cuenta
   *    sus camiones, y Reportes sus máquinas. Las tablas son las mismas (un frente
   *    es un frente; un equipo tiene UN frente por día), pero ninguno de los dos
   *    apartados muestra lo que asignó el otro como «fuera del catálogo».
   */
  tipo?: 'camiones' | 'maquinas';
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

export function FrentesTrabajo({ frentes, faltaSql, canFull, camiones, jornadaHoy, uid, userName, onCambio, tipo = 'camiones' }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const esMaq = tipo === 'maquinas';
  const E = esMaq ? ETIQUETA_EQUIPO : ETIQUETA_CAMION;
  const fueraTxt = esMaq ? '(equipo fuera de esta lista)' : '(camión fuera del catálogo)';
  // La lista como clave de texto: los efectos dependen de ELLA y no de la
  // identidad del arreglo, que puede cambiar en cada render de la pantalla.
  const claveLista = useMemo(() => camiones.map((c) => c.id).sort().join('|'), [camiones]);
  const idsLista = useMemo(() => new Set(claveLista ? claveLista.split('|') : []), [claveLista]);

  const [nuevo, setNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  // ── La asignación del día ──
  const [fecha, setFecha] = useState(jornadaHoy);
  // ⭐ VARIOS frentes a la vez (30-sep-2026): marcar 3 camiones y 2 frentes deja
  //    los 3 camiones recogiendo en los 2 frentes, sin repetir la operación.
  const [frenteSel, setFrenteSel] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  // ── ✏️ Editar y 🗑️ borrar un frente del catálogo (30-sep-2026) ──
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null);
  // La confirmación va EN LÍNEA, no en un `confirm()`: dentro de un Modal a
  // pantalla completa el diálogo del navegador queda tapado y parece colgado.
  const [borrando, setBorrando] = useState<{ id: string; nombre: string; asignaciones: number } | null>(null);
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
      // Solo lo de ESTA lista (ver `tipo` en Props).
      setAsignaciones(r.asignaciones.filter((a) => idsLista.has(a.machineryId)));
      if (r.error && !r.missing) console.warn('[frentes] no se pudo leer las asignaciones:', r.error);
    });
    return () => { vivo = false; };
  }, [fecha, recarga, claveLista]); // eslint-disable-line react-hooks/exhaustive-deps

  // 🕘 EL HISTORIAL: los últimos 45 días de asignaciones, agrupados por jornada.
  //    Se recarga cuando se asigna o se quita algo, para que lo que acabas de
  //    hacer se vea sin refrescar la pantalla.
  useEffect(() => {
    let vivo = true;
    if (!canFull) return;
    listAsignacionesFrenteRango(diasAntes(jornadaHoy, DIAS_HISTORIAL), jornadaHoy).then((r) => {
      if (!vivo) return;
      setHistorial(historialFrentes(r.asignaciones.filter((a) => idsLista.has(a.machineryId))));
      if (r.error && !r.missing) console.warn('[frentes] no se pudo leer el historial:', r.error);
    });
    return () => { vivo = false; };
  }, [canFull, jornadaHoy, recarga, claveLista]); // eslint-disable-line react-hooks/exhaustive-deps

  const activos = useMemo(() => frentes.filter((f) => f.activo), [frentes]);
  /** Los frentes de cada camión ese día: ahora son VARIOS, no uno. */
  const asignadoA = useMemo(() => {
    const m = new Map<string, AsignacionFrente[]>();
    asignaciones.forEach((a) => {
      const l = m.get(a.machineryId) ?? [];
      if (!l.some((x) => x.frenteId === a.frenteId)) l.push(a);
      m.set(a.machineryId, l);
    });
    return m;
  }, [asignaciones]);
  /** Camiones DISTINTOS asignados ese día (las filas son más: varios frentes). */
  const camionesAsignados = useMemo(() => asignadoA.size, [asignadoA]);

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

  /**
   * ⛏️ ASIGNAR: ahora SUMA en vez de pisar, y admite VARIOS frentes de una vez
   * (30-sep-2026). Marcar 3 camiones y 2 frentes deja 6 asignaciones.
   */
  const asignar = async () => {
    if (frenteSel.size === 0) { toast.error('Elige al menos un frente.'); return; }
    if (marcados.size === 0) { toast.error(`Marca al menos un ${E.singular} (usa el buscador).`); return; }
    setGuardando(true);
    const ids = Array.from(marcados);
    let agregados = 0, yaEstaban = 0;
    const fallos: string[] = [];
    for (const fId of frenteSel) {
      const r = await asignarFrente(fecha, ids, fId, uid, userName);
      if (r.error) fallos.push(`«${activos.find((f) => f.id === fId)?.nombre ?? fId}»: ${r.error}`);
      else { agregados += r.agregados ?? 0; yaEstaban += r.yaEstaban ?? 0; }
    }
    setGuardando(false);
    setRecarga((n) => n + 1);
    onCambio();
    // Se cuentan los fallos aparte: si un frente falló y otro no, decir solo
    // «listo» escondería que a medio camión no le quedó el frente puesto.
    if (fallos.length) { toast.error(`No se pudo asignar ${fallos.join(' · ')}`); return; }
    setMarcados(new Set());
    const nombres = Array.from(frenteSel).map((id) => activos.find((f) => f.id === id)?.nombre ?? '').filter(Boolean).join(' · ');
    const repe = yaEstaban > 0 ? ` (${yaEstaban} ya lo tenían)` : '';
    // ⛏️ El aviso dice lo que de verdad pasa: con UN frente los viajes sin
    //    frente lo toman solos; con VARIOS ya no se puede adivinar cuál.
    const auto = esMaq
      ? ''
      : frenteSel.size === 1
        ? 'Los viajes de ese día sin frente lo toman automáticamente.'
        : 'Ojo: a los camiones con VARIOS frentes ese día, los viajes ya no toman el frente solos — hay que elegirlo al registrar o en ✏️ Editar.';
    toast.success(`${agregados} asignación(es)${repe}: ⛏️ ${nombres} el ${dmy(fecha)}. ${auto}`);
  };

  /** ✏️ Renombrar un frente del catálogo. */
  const renombrar = async () => {
    if (!editando) return;
    setGuardando(true);
    const { error } = await renombrarFrente(editando.id, editando.nombre);
    setGuardando(false);
    if (error) { toast.error(error); return; }
    setEditando(null);
    toast.success('Frente renombrado. Los viajes ya registrados conservan el nombre con el que se grabaron.');
    setRecarga((n) => n + 1);
    onCambio();
  };

  /** 🗑️ Borrar: primero se pregunta CUÁNTAS asignaciones se lleva por delante. */
  const pedirBorrar = async (f: FrenteTrabajo) => {
    const n = await contarAsignacionesFrente(f.id);
    setBorrando({ id: f.id, nombre: f.nombre, asignaciones: n });
  };

  const borrar = async () => {
    if (!borrando) return;
    setGuardando(true);
    const { error } = await borrarFrente(borrando.id);
    setGuardando(false);
    if (error) { toast.error(error); return; }
    setBorrando(null);
    toast.success('Frente borrado. Los viajes ya registrados conservan el nombre del frente.');
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
              code: c?.code ?? fueraTxt,
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
        // ⭐ EL SUBTÍTULO NO DELATA LO QUE SE APAGÓ (29-sep-2026, corregido a
        //    pedido: «si activo o desactivo un check, no me salga esa
        //    información en el PDF»). Regla de la casa desde el 25-sep: lo
        //    oculto no aparece en NINGUNA parte del papel, tampoco en el
        //    subtítulo. El papel se lee como si ese dato no existiera.
        subtitle: esMaq ? `Asignación del ${dmy(fecha)} · frente de trabajo de cada equipo` : `Asignación del ${dmy(fecha)} · de dónde recoge cada camión`,
        extraCss: CSS_FRENTES,
        body: cuerpoFrentesDelDia(grupos, op, E),
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

  /** Quita ESE frente de ese camión — no todos los que tenga ese día. */
  const quitar = async (a: AsignacionFrente) => {
    const { error } = await quitarAsignacionFrente(fecha, a.machineryId, a.frenteId);
    if (error) { toast.error(error); return; }
    setRecarga((n) => n + 1);
    onCambio();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text } as const;
  const codigoDe = (id: string) => {
    const c = camiones.find((x) => x.id === id);
    return c ? `${c.code}${c.plate ? ` · ${c.plate}` : c.serial ? ` · ${c.serial}` : ''}` : fueraTxt;
  };

  const CHECKS: { k: keyof OpcionesFrentes; label: string; ayuda: string }[] = [
    { k: 'numeracion', label: `1️⃣ Numeración de los ${E.plural}`, ayuda: 'La columna Nº dentro de cada frente.' },
    { k: 'placa', label: '🔢 Placa / Serial', ayuda: `Cómo se identifica el ${E.singular} en el patio.` },
    { k: 'empresa', label: `🏢 Empresa del ${E.singular}`, ayuda: `A quién pertenece cada ${E.singular}.` },
    { k: 'marcaModelo', label: '🚚 Marca y modelo', ayuda: 'Dato de taller; normalmente no hace falta en la hoja de patio.' },
    { k: 'contador', label: `🔟 Cuántos ${E.plural} lleva cada frente`, ayuda: `El «N ${E.unidad}» al lado del nombre del frente.` },
    { k: 'totales', label: '📋 Línea de totales arriba', ayuda: 'Camiones asignados y cuántos frentes se usaron.' },
    { k: 'sinCamiones', label: `⬜ Incluir los frentes SIN ${E.plural}`, ayuda: 'Apagado (como pediste) salen SOLO los frentes asignados ese día. Encendido también los que quedaron vacíos.' },
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
        {esMaq
          ? 'El frente es DÓNDE TRABAJA cada equipo ese día (no es la ubicación/edificio que marca el inspector: eso es otra cosa). Asigna el frente del día a una máquina, a varias o a toda una empresa; abajo sale lo asignado, la hoja del día en PDF y el historial. Los frentes son los mismos que en Viajes de camiones: un frente es un frente.'
          : 'El frente es DE DÓNDE recogen los camiones lo que llevan a los CDT/CDF. Asigna el frente del día a cada camión (o a varios de una vez): TODOS los viajes de ese día que no tengan frente propio lo toman automáticamente, los que ya estaban registrados y los que vengan. A un viaje suelto se le puede poner otro frente en ✏️ Editar, y ese manda.'}
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
                <View key={f.id} style={{ paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  {/* ✏️ EDITANDO: el nombre se cambia aquí mismo, sin modal. */}
                  {editando?.id === f.id ? (
                    <View>
                      <TextInput
                        value={editando.nombre}
                        onChangeText={(t) => setEditando({ id: f.id, nombre: t })}
                        placeholder="Nombre del frente"
                        placeholderTextColor={colors.muted}
                        style={input}
                        autoFocus
                      />
                      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                        <TouchableOpacity disabled={guardando} onPress={renombrar} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 6, alignItems: 'center', opacity: guardando ? 0.6 : 1 }}>
                          <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>💾 Guardar nombre</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setEditando(null)} style={{ paddingHorizontal: spacing.md, paddingVertical: 6 }}>
                          <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 12 }}>Cancelar</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 2 }}>
                        Los viajes ya registrados conservan el nombre con el que se grabaron: un papel ya impreso no cambia.
                      </Text>
                    </View>
                  ) : borrando?.id === f.id ? (
                    /* 🗑️ BORRANDO: la confirmación va EN LÍNEA y dice qué se lleva. */
                    <View>
                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12.5 }}>
                        ¿Borrar «{f.nombre}»?
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                        {borrando.asignaciones > 0
                          ? `Se van también sus ${borrando.asignaciones} asignación(es) a camiones. `
                          : 'No está asignado a ningún camión. '}
                        Los viajes ya registrados CONSERVAN el nombre del frente, así que los reportes
                        no cambian. Si solo quieres dejar de ofrecerlo, usa 🚫 Desactivar.
                      </Text>
                      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                        <TouchableOpacity disabled={guardando} onPress={borrar} style={{ flex: 1, backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: 6, alignItems: 'center', opacity: guardando ? 0.6 : 1 }}>
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>🗑️ Sí, borrar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setBorrando(null)} style={{ paddingHorizontal: spacing.md, paddingVertical: 6 }}>
                          <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 12 }}>Cancelar</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ color: f.activo ? colors.text : colors.muted, fontWeight: '700', fontSize: 12.5, flex: 1 }}>
                        ⛏️ {f.nombre}{f.activo ? '' : ' · DESACTIVADO'}
                      </Text>
                      {canFull ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                          <TouchableOpacity onPress={() => { setBorrando(null); setEditando({ id: f.id, nombre: f.nombre }); }}>
                            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>✏️</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => alternar(f)}>
                            <Text style={{ color: f.activo ? colors.warning : colors.success, fontWeight: '800', fontSize: 12 }}>
                              {f.activo ? '🚫' : '✓'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => { setEditando(null); pedirBorrar(f); }}>
                            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑️</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  )}
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
                  const on = frenteSel.has(f.id);
                  return (
                    <TouchableOpacity key={f.id} onPress={() => setFrenteSel((p) => { const n = new Set(p); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })}
                      style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>⛏️ {f.nombre}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={esMaq ? '🔎 Buscar máquina: placa, código, serial, empresa, marca…' : '🔎 Buscar camión: placa, código, serial, empresa…'}
                placeholderTextColor={colors.muted}
                style={[input, { marginTop: spacing.xs }]}
                autoCorrect={false}
              />
              <ScrollView style={{ maxHeight: 240, marginTop: spacing.xs }} nestedScrollEnabled>
                {camionesFiltrados.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Ningún {E.singular} coincide con la búsqueda.</Text>
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
                          {ya && ya.length ? `  · ya: ⛏️ ${ya.map((a) => a.frenteNombre).join(' · ⛏️ ')}` : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TouchableOpacity disabled={guardando} onPress={asignar}
                style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: guardando ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>
                  ⛏️ Asignar {marcados.size > 0 ? `${marcados.size} ${E.unidad}` : ''} a {frenteSel.size > 1 ? `${frenteSel.size} frentes` : 'el frente'}
                </Text>
              </TouchableOpacity>

              {/* Lo asignado ese día, agrupado por frente, con su ✕. */}
              {asignaciones.length > 0 ? (
                <View style={{ marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    {/* Camiones DISTINTOS y, si hay alguno con varios frentes,
                        también cuántas asignaciones son en total. */}
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', flex: 1 }}>
                      ASIGNADOS ESE DÍA · {camionesAsignados} {E.unidad}
                      {asignaciones.length !== camionesAsignados ? ` · ${asignaciones.length} asignaciones` : ''}
                    </Text>
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
                        <View key={`${a.frenteId}-${a.machineryId}`} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.sm, paddingVertical: 2 }}>
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
                  Ese día todavía no hay ningún {E.singular} asignado a un frente.
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
                      📅 {dmy(d.jornada)}{d.jornada === jornadaHoy ? ' · HOY' : ''} · {d.camiones} {E.unidad}
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
