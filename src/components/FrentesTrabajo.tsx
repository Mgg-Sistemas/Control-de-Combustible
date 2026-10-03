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
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  FRENTES_VIAJES, type FuenteFrentes,
  type FrenteTrabajo, type AsignacionFrente,
} from '../lib/camionViajes';
import { exportPdf, pdfDocument } from '../lib/pdf';
import {
  ETIQUETA_CAMION, ETIQUETA_EQUIPO,
  frentesParaReporte, cuerpoFrentesDelDia, nombreArchivoFrentes,
  historialFrentes, CSS_FRENTES, FRENTES_POR_DEFECTO, LOGOS_FRENTES_POR_DEFECTO, EMPRESA_UNICA_SUGERIDA, necesitaDatosDelDia,
  // ✏️ El tablero editable (03-oct-2026): calcular la PREVISTA, contar los
  //    cambios y volver a cero. Nada de esto toca la base.
  resumenFrentes, EDICION_RESUMEN_VACIA, resumenEditado, cuentaEdicionResumen, edicionAlCambiarDeDia,
  type OpcionesFrentes, type LogosFrentes, type DiaHistorialFrentes,
  type EdicionResumen, type TarjetaPropia,
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
  // ── Para las columnas opcionales de la hoja (03-oct-2026). Lo que no venga,
  //    sale «—». Son datos FIJOS del equipo; lo del día llega por `datosDelDia`. ──
  /** «2,40 × 6,00 × 2,50 m», ya escrito. */
  medidas?: string | null;
  clasificacion?: string | null;
  /** Ubicación de la ficha (se usa si ese día no hay obra). */
  obra?: string | null;
  /** Estado de la ficha (se usa si ese día no hay otro). */
  estado?: string | null;
};

/** Lo que pasó con un equipo ESE día: sale de los viajes (camiones) o de la
 *  jornada (máquinas). Lo arma cada pantalla; este componente solo lo pinta. */
export type DatosDelDiaFrente = { obra?: string | null; chofer?: string | null; turno?: string | null; estado?: string | null; viajes?: number | null };

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
  /** A qué tablas va (02-oct-2026): viajes por defecto; la maquinaria tiene las suyas. */
  fuente?: FuenteFrentes;
  /**
   * 📊 Los datos DEL DÍA para la hoja (03-oct-2026): obra, chofer, turno, estado
   * y viajes de cada equipo en esa jornada. Se llama SOLO al sacar el PDF y SOLO
   * si alguna de esas opciones está encendida: con todo apagado, la hoja no lee
   * nada más que la asignación, como siempre.
   */
  datosDelDia?: (jornadaISO: string) => Promise<Map<string, DatosDelDiaFrente>>;
};

const norm = (s: unknown) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const dmy = (iso: string) => String(iso ?? '').slice(0, 10).split('-').reverse().join('/');

/** Cuántos días atrás mira el historial. Un mes y medio: más que eso ya es un
 *  reporte, y para eso está el PDF de cada día. */
const DIAS_HISTORIAL = 45;

/** Cuántas tarjetas propias se le pueden agregar al tablero (03-oct-2026). Seis
 *  es lo que entra en una fila del papel sin que las tarjetas queden como
 *  tiritas ilegibles; más que eso ya no es un resumen. */
const MAX_TARJETAS_PROPIAS = 6;

/** El día ISO que está `dias` días antes de `iso` (mediodía para que ningún
 *  cambio de hora mueva la fecha). */
function diasAntes(iso: string, dias: number): string {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

export function FrentesTrabajo({ frentes, faltaSql, canFull, camiones, jornadaHoy, uid, userName, onCambio, tipo = 'camiones', fuente = FRENTES_VIAJES, datosDelDia }: Props) {
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
  // ── 🏢 Una sola empresa para todos (03-oct-2026, a pedido: «que todas las
  //    máquinas salgan para Golden Touch (…) o que yo pueda elegir el nombre»).
  //    Nace APAGADA (lo nuevo entra apagado); al encenderla se ofrece Golden
  //    Touch y las empresas que hay en la lista, o se escribe cualquiera. Solo
  //    cambia lo que se IMPRIME en la columna Empresa: el catálogo no se toca.
  const [empresaUnicaOn, setEmpresaUnicaOn] = useState(false);
  const [empresaUnica, setEmpresaUnica] = useState(EMPRESA_UNICA_SUGERIDA);
  const opPapel: OpcionesFrentes = { ...op, empresaUnica: empresaUnicaOn ? empresaUnica : '' };
  // ── 👷 Operador / chofer puesto A MANO (03-oct-2026, a pedido: «tomar los
  //    datos del operador que maneja la máquina o que yo pueda colocar el
  //    operador»). Lo escrito MANDA sobre lo que venga de los viajes o de la
  //    jornada; en blanco, sale el automático. Es del papel de ESE día: se guarda
  //    por fecha y equipo mientras la pantalla esté abierta, no toca la base.
  const [operadores, setOperadores] = useState<Record<string, string>>({});
  const claveOperador = (machineryId: string) => `${fecha}|${machineryId}`;
  // ── ✏️ EL RESUMEN EJECUTIVO EDITABLE (03-oct-2026, a pedido: «que el resumen
  //    ejecutivo de ese reporte sea editable»). Igual que la empresa única y el
  //    operador a mano: es DEL PAPEL y vive en la pantalla, NO se guarda en la
  //    base. Nada de esto cambia una asignación, un viaje ni una ficha.
  const [edicionResumen, setEdicionResumen] = useState<EdicionResumen>(EDICION_RESUMEN_VACIA);
  // ⚠️ Al cambiar de día se van las CIFRAS escritas a mano (valores y tarjetas
  //    propias) y se queda la FORMA (lo escondido, los títulos, las notas): el
  //    papel de hoy no puede salir con el número de ayer. Ver
  //    edicionAlCambiarDeDia() en frentesReporte.ts.
  const diaEditado = useRef(fecha);
  useEffect(() => {
    if (diaEditado.current === fecha) return;
    diaEditado.current = fecha;
    setEdicionResumen((p) => edicionAlCambiarDeDia(p));
  }, [fecha]);
  const empresasSugeridas = useMemo(() => {
    const s = new Set<string>([EMPRESA_UNICA_SUGERIDA]);
    camiones.forEach((c) => { const n = String(c.companyName ?? '').trim(); if (n) s.add(n); });
    return Array.from(s);
  }, [camiones]);
  // ── 🕘 El historial ──
  const [historial, setHistorial] = useState<DiaHistorialFrentes[]>([]);

  useEffect(() => {
    let vivo = true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
    listAsignacionesFrente(fecha, fuente).then((r) => {
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
    listAsignacionesFrenteRango(diasAntes(jornadaHoy, DIAS_HISTORIAL), jornadaHoy, fuente).then((r) => {
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
    const { error } = await crearFrente(nuevo, uid, userName, fuente);
    setGuardando(false);
    if (error) { toast.error(error); return; }
    setNuevo('');
    toast.success('Frente creado.');
    onCambio();
  };

  const alternar = async (f: FrenteTrabajo) => {
    const { error } = await setActivoFrente(f.id, !f.activo, userName, fuente);
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
      const r = await asignarFrente(fecha, ids, fId, uid, userName, fuente);
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
    const { error } = await renombrarFrente(editando.id, editando.nombre, fuente);
    setGuardando(false);
    if (error) { toast.error(error); return; }
    setEditando(null);
    toast.success('Frente renombrado. Los viajes ya registrados conservan el nombre con el que se grabaron.');
    setRecarga((n) => n + 1);
    onCambio();
  };

  /** 🗑️ Borrar: primero se pregunta CUÁNTAS asignaciones se lleva por delante. */
  const pedirBorrar = async (f: FrenteTrabajo) => {
    const n = await contarAsignacionesFrente(f.id, fuente);
    setBorrando({ id: f.id, nombre: f.nombre, asignaciones: n });
  };

  const borrar = async () => {
    if (!borrando) return;
    setGuardando(true);
    const { error } = await borrarFrente(borrando.id, fuente);
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
      // Lo del día se lee SOLO si hace falta. Si la lectura falla, el papel no
      // sale con columnas vacías que parezcan «no hubo nada»: se avisa y se para.
      const delDia = datosDelDia && necesitaDatosDelDia(opPapel) ? await datosDelDia(fecha) : new Map<string, DatosDelDiaFrente>();
      const grupos = frentesParaReporte(
        asignaciones.map((a) => {
          const c = camiones.find((x) => x.id === a.machineryId);
          const d = delDia.get(a.machineryId);
          return {
            frenteNombre: a.frenteNombre,
            camion: {
              id: a.machineryId,
              code: c?.code ?? fueraTxt,
              placa: c?.plate || c?.serial || null,
              empresa: c?.companyName || null,
              marcaModelo: [c?.marca, c?.modelo].filter(Boolean).join(' ') || null,
              medidas: c?.medidas || null,
              clasificacion: c?.clasificacion || null,
              obra: d?.obra || c?.obra || null,
              chofer: String(operadores[claveOperador(a.machineryId)] ?? '').replace(/\s+/g, ' ').trim() || d?.chofer || null,
              turno: d?.turno || null,
              estado: d?.estado || c?.estado || null,
              viajes: esMaq ? null : (d?.viajes ?? 0),
            },
          };
        }),
        activos.map((f) => f.nombre),
        opPapel,
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
        // ✏️ Con la edición del tablero (03-oct-2026): lo oculto no sale, y lo
        //    que quedó en blanco sale con su valor automático.
        body: cuerpoFrentesDelDia(grupos, opPapel, E, edicionResumen),
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
    const { error } = await quitarAsignacionFrente(fecha, a.machineryId, a.frenteId, fuente);
    if (error) { toast.error(error); return; }
    setRecarga((n) => n + 1);
    onCambio();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text } as const;
  const codigoDe = (id: string) => {
    const c = camiones.find((x) => x.id === id);
    return c ? `${c.code}${c.plate ? ` · ${c.plate}` : c.serial ? ` · ${c.serial}` : ''}` : fueraTxt;
  };
  /** Los TextInput de la edición del tablero: compactos, que son muchos. */
  const inputResumen = { ...input, fontSize: 12, paddingVertical: 4 } as const;

  /**
   * ✏️ LA PREVISTA DEL TABLERO (03-oct-2026).
   *
   * ⚠️ ES UNA PREVISTA, NO EL PAPEL. Sirve para saber QUÉ TARJETAS Y CUÁDROS HAY
   *    —sus claves y sus títulos— y así poder editarlos. El papel se calcula de
   *    nuevo al exportar, ahí sí con los datos DEL DÍA (obra, chofer, turno,
   *    estado y viajes), que son asíncronos y no se pueden leer en pantalla.
   *
   * ⭐ POR ESO LOS VALORES AUTOMÁTICOS QUE SE VEN ACÁ PUEDEN DIFERIR DE LOS DEL
   *    PDF (acá los viajes van en 0 y el turno/chofer en blanco), y POR ESO
   *    EDITAR GUARDA TEXTO Y NO NÚMEROS: lo escrito sale tal cual, y lo que se
   *    deja en blanco sale con el valor que calcule el papel en ese momento.
   */
  const resumenPreview = useMemo(() => {
    const grupos = frentesParaReporte(
      asignaciones.map((a) => {
        const c = camiones.find((x) => x.id === a.machineryId);
        return {
          frenteNombre: a.frenteNombre,
          camion: {
            id: a.machineryId,
            code: c?.code ?? fueraTxt,
            placa: c?.plate || c?.serial || null,
            empresa: c?.companyName || null,
            marcaModelo: [c?.marca, c?.modelo].filter(Boolean).join(' ') || null,
            medidas: c?.medidas || null,
            clasificacion: c?.clasificacion || null,
            // Sin los datos del día: solo lo que tiene la ficha del equipo.
            obra: c?.obra || null,
            chofer: null,
            turno: null,
            estado: c?.estado || null,
            viajes: esMaq ? null : 0,
          },
        };
      }),
      activos.map((f) => f.nombre),
      opPapel,
    );
    return resumenFrentes(grupos, opPapel, E);
  }, [asignaciones, camiones, opPapel, activos, E]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Los retoques del tablero. Todos escriben en `edicionResumen` por CLAVE
  //    (`k`), que es estable: la misma tarjeta se reconoce otro día. ──
  const resumenOculto = (k: string) => (edicionResumen.ocultos ?? []).includes(k);
  const alternarOcultoResumen = (k: string) => setEdicionResumen((p) => {
    const ya = p.ocultos ?? [];
    return { ...p, ocultos: ya.includes(k) ? ya.filter((x) => x !== k) : [...ya, k] };
  });
  const escribirResumen = (campo: 'titulos' | 'valores' | 'notas', k: string, v: string) =>
    setEdicionResumen((p) => ({ ...p, [campo]: { ...(p[campo] ?? {}), [k]: v } }));
  const agregarTarjetaPropia = () => setEdicionResumen((p) => {
    const l = p.propias ?? [];
    if (l.length >= MAX_TARJETAS_PROPIAS) return p;
    return { ...p, propias: [...l, { titulo: '', valor: '', nota: '' }] };
  });
  const cambiarTarjetaPropia = (i: number, campo: keyof TarjetaPropia, v: string) =>
    setEdicionResumen((p) => ({ ...p, propias: (p.propias ?? []).map((x, j) => (j === i ? { ...x, [campo]: v } : x)) }));
  const quitarTarjetaPropia = (i: number) =>
    setEdicionResumen((p) => ({ ...p, propias: (p.propias ?? []).filter((_, j) => j !== i) }));
  const propias = edicionResumen.propias ?? [];
  // La línea del plegable cerrado: «plegado no es escondido», tiene que decir
  // qué lleva cambiado sin abrirlo.
  const cuentaResumen = cuentaEdicionResumen(edicionResumen);
  const resumenEdicionTxt = !resumenEditado(edicionResumen) ? 'sin cambios' : ([
    cuentaResumen.ocultos ? `${cuentaResumen.ocultos} oculto(s)` : '',
    cuentaResumen.cambiados ? `${cuentaResumen.cambiados} cambiado${cuentaResumen.cambiados === 1 ? '' : 's'}` : '',
    cuentaResumen.propias ? `${cuentaResumen.propias} propia${cuentaResumen.propias === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ') || 'sin cambios');

  const CHECKS: { k: Exclude<keyof OpcionesFrentes, 'empresaUnica'>; label: string; ayuda: string }[] = [
    { k: 'numeracion', label: `1️⃣ Numeración de los ${E.plural}`, ayuda: 'La columna Nº dentro de cada frente.' },
    { k: 'placa', label: '🔢 Placa / Serial', ayuda: `Cómo se identifica el ${E.singular} en el patio.` },
    { k: 'empresa', label: `🏢 Empresa del ${E.singular}`, ayuda: `A quién pertenece cada ${E.singular}.` },
    { k: 'marcaModelo', label: '🚚 Marca y modelo', ayuda: 'Dato de taller; normalmente no hace falta en la hoja de patio.' },
    // ── 03-oct-2026, a pedido: las opciones de la Lista completa. Nacen apagadas. ──
    { k: 'medidas', label: '📏 Alto, largo y ancho', ayuda: esMaq ? 'Las medidas de la ficha del equipo.' : 'Las medidas de la tolva, de Cubicaje.' },
    { k: 'clasificacion', label: '🔶 Clasificación por capacidad', ayuda: esMaq ? 'La clasificación de la ficha.' : 'Compacto, media o gran capacidad, según los m³ de la tolva.' },
    { k: 'obra', label: '🏗️ Obra / ubicación', ayuda: esMaq ? 'La ubicación de la ficha del equipo.' : 'En qué obra registró viajes ese día.' },
    { k: 'frente', label: '⛏️ Frente de trabajo en cada fila', ayuda: 'Repite el frente como columna, además del título del bloque.' },
    { k: 'chofer', label: esMaq ? '👷 Operador' : '👷 Chofer', ayuda: esMaq ? 'El operador de la jornada de ese día.' : 'El chofer anotado en los viajes de ese día.' },
    { k: 'turno', label: '🕘 Turno', ayuda: esMaq ? 'Día, noche o los dos, según la jornada de ese día.' : 'Día, noche o los dos, según la hora de sus viajes.' },
    { k: 'estado', label: '⚙️ Estado de la máquina', ayuda: esMaq ? 'El estado de la jornada de ese día, o el de la ficha.' : 'El estado anotado en los viajes de ese día, o el de la ficha.' },
    { k: 'resumen', label: '📊 Resumen ejecutivo (tablero arriba del reporte)', ayuda: `Tarjetas y cuadros: ${E.plural} asignados, frentes en uso, por tipo, por empresa${esMaq ? '' : ', viajes del día'} y los que tengas encendidos (estado, turno, clasificación, obra).` },
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
  // «Ocultos» cuenta solo lo que venía encendido de fábrica y se apagó; lo que
  // nace apagado (lo nuevo) se cuenta aparte como «extras encendidos».
  const ocultos = CHECKS.filter((c) => FRENTES_POR_DEFECTO[c.k] === true && !op[c.k]).length;
  const extrasOn = CHECKS.filter((c) => c.k !== 'sinCamiones' && FRENTES_POR_DEFECTO[c.k] !== true && !!op[c.k]).length;

  return (
    <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>⛏️ FRENTES DE TRABAJO · {activos.length}</Text>
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
        {esMaq
          ? 'El frente es DÓNDE TRABAJA cada equipo ese día (no es la ubicación/edificio que marca el inspector: eso es otra cosa). Asigna el frente del día a una máquina, a varias o a toda una empresa; abajo sale lo asignado, la hoja del día en PDF y el historial. Es independiente de Viajes de camiones: tiene su propia lista de frentes y sus propias asignaciones.'
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
                    resumen={`${ocultos === 0 ? 'todo' : `${ocultos} dato(s) oculto(s)`}${extrasOn ? ` · +${extrasOn} extra(s)` : ''} · ${logosPuestos === 0 ? 'sin logos' : `${logosPuestos} logo(s)`}${op.sinCamiones ? ' · con los frentes vacíos' : ''}${empresaUnicaOn && op.empresa ? ` · todo a nombre de ${empresaUnica.trim() || '…'}` : ''}`}
                  >
                    {CHECKS.map((c) => (
                      <Toggle
                        key={c.k}
                        on={!!op[c.k]}
                        label={c.label}
                        ayuda={c.ayuda}
                        onPress={() => setOp((p) => ({ ...p, [c.k]: !p[c.k] }))}
                      />
                    ))}
                    {/* ✏️ AJUSTAR EL RESUMEN EJECUTIVO (03-oct-2026, a pedido:
                        «que el resumen ejecutivo de ese reporte sea editable»).
                        Solo con el tablero encendido: sin él no hay nada que
                        ajustar y la sección sería un plegable vacío. */}
                    {op.resumen ? (
                      <Plegable titulo="✏️ Ajustar el resumen ejecutivo" resumen={resumenEdicionTxt}>
                        <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: spacing.xs }}>
                          Esto cambia SOLO el papel: no toca asignaciones, viajes ni fichas. Lo que dejes
                          en blanco sale con su valor automático, y lo que escribas sale tal cual. Los
                          valores que ves acá son una prevista: el papel los recalcula con los datos de
                          ese día al exportar.
                        </Text>

                        <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>TARJETAS</Text>
                        {resumenPreview.tarjetas.length === 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 11 }}>Con estos datos el tablero no lleva tarjetas.</Text>
                        ) : resumenPreview.tarjetas.map((x) => {
                          const off = resumenOculto(x.k);
                          return (
                            <View key={`tj-${x.k}`} style={{ marginTop: 4, opacity: off ? 0.5 : 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                                <TouchableOpacity onPress={() => alternarOcultoResumen(x.k)}>
                                  <Text style={{ fontSize: 13 }}>{off ? '🚫' : '👁️'}</Text>
                                </TouchableOpacity>
                                <TextInput
                                  value={edicionResumen.titulos?.[x.k] ?? ''}
                                  onChangeText={(v) => escribirResumen('titulos', x.k, v)}
                                  placeholder={x.titulo}
                                  placeholderTextColor={colors.muted}
                                  editable={!off}
                                  style={{ ...inputResumen, flex: 1.6 }}
                                />
                                <TextInput
                                  value={edicionResumen.valores?.[x.k] ?? ''}
                                  onChangeText={(v) => escribirResumen('valores', x.k, v)}
                                  placeholder={x.valor}
                                  placeholderTextColor={colors.muted}
                                  editable={!off}
                                  style={{ ...inputResumen, flex: 1 }}
                                />
                              </View>
                              <TextInput
                                value={edicionResumen.notas?.[x.k] ?? ''}
                                onChangeText={(v) => escribirResumen('notas', x.k, v)}
                                placeholder={x.nota ?? 'sin nota'}
                                placeholderTextColor={colors.muted}
                                editable={!off}
                                style={{ ...inputResumen, marginTop: 3, marginLeft: 22 }}
                              />
                            </View>
                          );
                        })}

                        {/* Los cuadros solo llevan título: sus filas son el
                            conteo y ese sí es un dato, no un texto. */}
                        <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800', marginTop: spacing.sm }}>CUADROS</Text>
                        {resumenPreview.cuadros.length === 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 11 }}>Con estos datos el tablero no lleva cuadros.</Text>
                        ) : resumenPreview.cuadros.map((q) => {
                          const off = resumenOculto(q.k);
                          return (
                            <View key={`cq-${q.k}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4, opacity: off ? 0.5 : 1 }}>
                              <TouchableOpacity onPress={() => alternarOcultoResumen(q.k)}>
                                <Text style={{ fontSize: 13 }}>{off ? '🚫' : '👁️'}</Text>
                              </TouchableOpacity>
                              <TextInput
                                value={edicionResumen.titulos?.[q.k] ?? ''}
                                onChangeText={(v) => escribirResumen('titulos', q.k, v)}
                                placeholder={q.titulo}
                                placeholderTextColor={colors.muted}
                                editable={!off}
                                style={{ ...inputResumen, flex: 1 }}
                              />
                            </View>
                          );
                        })}

                        {/* Tarjetas de cosecha propia: el dato que el sistema no
                            tiene («Supervisor», «Clima», lo que haga falta). */}
                        <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800', marginTop: spacing.sm }}>TARJETAS PROPIAS</Text>
                        <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>
                          Van al final del tablero, en este orden. Una sin título Y sin valor no sale.
                        </Text>
                        {propias.map((x, i) => (
                          <View key={`pr-${i}`} style={{ marginTop: 4 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                              <TextInput
                                value={x.titulo}
                                onChangeText={(v) => cambiarTarjetaPropia(i, 'titulo', v)}
                                placeholder="Título (ej. Supervisor)"
                                placeholderTextColor={colors.muted}
                                style={{ ...inputResumen, flex: 1.6 }}
                              />
                              <TextInput
                                value={x.valor}
                                onChangeText={(v) => cambiarTarjetaPropia(i, 'valor', v)}
                                placeholder="Valor"
                                placeholderTextColor={colors.muted}
                                style={{ ...inputResumen, flex: 1 }}
                              />
                              <TouchableOpacity onPress={() => quitarTarjetaPropia(i)}>
                                <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕</Text>
                              </TouchableOpacity>
                            </View>
                            <TextInput
                              value={x.nota ?? ''}
                              onChangeText={(v) => cambiarTarjetaPropia(i, 'nota', v)}
                              placeholder="Nota (opcional)"
                              placeholderTextColor={colors.muted}
                              style={{ ...inputResumen, marginTop: 3 }}
                            />
                          </View>
                        ))}
                        <TouchableOpacity
                          disabled={propias.length >= MAX_TARJETAS_PROPIAS}
                          onPress={agregarTarjetaPropia}
                          style={{ marginTop: spacing.xs, alignSelf: 'flex-start', opacity: propias.length >= MAX_TARJETAS_PROPIAS ? 0.5 : 1 }}
                        >
                          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>➕ Agregar tarjeta</Text>
                        </TouchableOpacity>
                        {propias.length >= MAX_TARJETAS_PROPIAS ? (
                          <Text style={{ color: colors.warning, fontSize: 10, marginTop: 2 }}>
                            Ya van {MAX_TARJETAS_PROPIAS}: es el máximo, porque más tarjetas no caben en
                            la fila del papel sin quedar ilegibles. Quita una para agregar otra.
                          </Text>
                        ) : null}

                        {/* Volver a cero: solo se ofrece si hay algo que deshacer. */}
                        {resumenEditado(edicionResumen) ? (
                          <TouchableOpacity onPress={() => setEdicionResumen(EDICION_RESUMEN_VACIA)} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
                            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>↺ Dejar el resumen como estaba</Text>
                          </TouchableOpacity>
                        ) : null}
                      </Plegable>
                    ) : null}
                    {/* 👷 Operador a mano (03-oct-2026, a pedido). Solo con la columna encendida. */}
                    {op.chofer ? (
                      <View style={{ marginTop: spacing.xs, paddingLeft: spacing.sm }}>
                        <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>{esMaq ? 'OPERADOR' : 'CHOFER'} DE CADA {E.singular.toUpperCase()} (OPCIONAL)</Text>
                        <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>
                          En blanco sale el que el sistema encuentre ({esMaq ? 'el operador de la jornada de ese día' : 'el chofer de sus viajes de ese día'}). Lo que escribas aquí manda en la hoja de este día.
                        </Text>
                        {Array.from(new Set(asignaciones.map((a) => a.machineryId))).map((id) => (
                          <View key={`op-${id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 3 }}>
                            <Text style={{ color: colors.text, fontSize: 11, flex: 1 }} numberOfLines={1}>🚜 {codigoDe(id)}</Text>
                            <TextInput
                              value={operadores[claveOperador(id)] ?? ''}
                              onChangeText={(v) => setOperadores((p) => ({ ...p, [claveOperador(id)]: v }))}
                              placeholder="automático"
                              placeholderTextColor={colors.muted}
                              style={{ ...input, flex: 1.2, paddingVertical: 4, fontSize: 12 }}
                            />
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {/* 🏢 Una sola empresa para todos (03-oct-2026, a pedido). */}
                    {op.empresa ? (
                      <View style={{ marginTop: spacing.xs }}>
                        <Toggle
                          on={empresaUnicaOn}
                          label="🏢 Toda la maquinaria a nombre de UNA sola empresa"
                          ayuda={`En la columna Empresa sale el mismo nombre para cada ${E.singular}, como si todos fueran de esa empresa. Solo en el papel: no cambia la ficha de nadie.`}
                          onPress={() => setEmpresaUnicaOn((v) => !v)}
                        />
                        {empresaUnicaOn ? (
                          <View style={{ paddingLeft: spacing.sm }}>
                            <TextInput
                              value={empresaUnica}
                              onChangeText={setEmpresaUnica}
                              placeholder="Nombre de la empresa que va a salir"
                              placeholderTextColor={colors.muted}
                              style={{ ...input, marginTop: 4 }}
                            />
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                              {empresasSugeridas.map((n) => {
                                const on = empresaUnica.trim() === n;
                                return (
                                  <TouchableOpacity key={n} onPress={() => setEmpresaUnica(n)}
                                    style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
                                    <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>{n}</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                            {!empresaUnica.trim() ? (
                              <Text style={{ color: colors.warning, fontSize: 10, marginTop: 2 }}>Sin nombre, cada {E.singular} sale con su propia empresa.</Text>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    ) : null}
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
