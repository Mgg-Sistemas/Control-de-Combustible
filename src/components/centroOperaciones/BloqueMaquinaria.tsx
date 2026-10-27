// 🏭 CENTRO DE OPERACIONES — 📅 PARTE DIARIO · 🚜 MAQUINARIA (PD4 24-oct-2026; con inspección, M4 26-oct-2026).
//
// Las unidades ACTIVAS del sitio con su estado, agrupadas (🔧 Averiadas · ✅ Disponibles ·
// ⛔ No disponibles (oficina) · ❔ Sin dato) y los conteos arriba.
//
// ⭐ QUIÉN MANDA lo decide UNA regla, `estadoDelSitio` (vía `filasDelSitio`), nunca la marca
//    guardada a mano: en las unidades del sitio, su marca; en las vinculadas al catálogo, lo que
//    dice INSPECCIÓN, salvo que el sitio las haya marcado y todavía no haya un hecho nuevo de
//    inspección; en espera / retirada / transferida, la oficina (pastillas apagadas).
// ⭐ CARGA EN DOS TIEMPOS: primero la flota del módulo (lo del sitio se ve siempre); después,
//    SOLO si hay vinculadas, lo que dice inspección (`cargarEstadoInspeccion`). Si esa lectura
//    falla, las vinculadas sin marca salen «❔ Sin dato» (nunca «Disponible») y las marcadas,
//    «sin verificar», con «🔄 Reintentar». Sin Realtime: al enfocar, al deslizar y con «↻».
// ⭐ LA MARCA VIVE SOLO EN EL MÓDULO (`cop_unidades`): no toca Control de Maquinaria, el catálogo
//    ni a los inspectores. Tocar ✅/🔧 abre el editor y `modoAlTocar` decide si es solo la nota
//    (`guardarNotaMarca`) o una marca NUEVA (`guardarMarcaUnidad`, con la guardia: si inspección
//    registró algo después de lo último que ella VIO —la lectura de la pantalla, la última buena,
//    el aviso ya mostrado o su marca anterior (`referenciaDeGuardia`, lote 6 B1)—, no se guarda
//    y se avisa, sin perder la nota). «↩️ Que mande inspección» suelta la marca
//    (`soltarMarcaUnidad`; en una superada, «🧹 Quitarla»). Lo vigila
//    scripts/test-centro-operaciones-maquinaria-bloques.mjs.
// ⭐ TOPES Y FRESCURA (lote 6 R1, B10): la lectura de inspección vence a los 15 s («no respondió
//    a tiempo», con 🔄 Reintentar) y una lectura buena de hace menos de 10 s se reutiliza al
//    volver a la pantalla (la flota se recarga dos veces por foco), salvo ↻, Reintentar o
//    después de guardar o soltar. Mientras se lee por PRIMERA vez, las pastillas de las
//    vinculadas van apagadas (A6/B3): no se marca sin saber qué dice la oficina.
// ⭐ «📲 AVISAR A INSPECCIÓN» (por fila y en lote) abre WhatsApp con el texto de lo que no
//    coincide (`textoAvisoInspeccion`); ella elige el chat. No escribe nada.
// ⭐ PERMISOS: Lectura y Escritura ven todo y pueden avisar; SOLO FULL marca y suelta, igual que
//    la RLS de `cop_unidades` (Full administra la flota).
// ⭐ El estado es el de AHORA: la fecha del Parte diario no lo cambia (se avisa si se está mirando
//    otra jornada). Si cambia el turno con la pantalla abierta, se pide actualizar.
// ⭐ Va DENTRO del bloque «6 · 🚜 Maquinaria» del Parte diario: sin tarjeta ni título propios
//    (lote 5 B18); le avisa sus conteos (`alConteo`) para el encabezado plegado y el grupo de cada
//    unidad (`alEstados`) para el 🔧 del selector de las salidas (M8).
// ⭐ «✏️ SIN GUARDAR» (B-M7): el editor abierto con otra marca u otra nota se le avisa al Parte
//    diario (`alSinGuardar`). Abrir otra máquina o «Cancelar» con una nota escrita pregunta (B-M2).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets, PermLevel } from '../../lib/permissions';
import { caracasBusinessToday } from '../../lib/caracasDay';
import { conTope } from '../../lib/centroOperaciones';
import type { EstadoUnidad, Sitio, Unidad } from '../../lib/centroOperaciones';
import { dmy, secuenciaDePedidos } from '../../lib/centroOperacionesCarga';
import {
  NO_SE_GUARDO,
  cargarEstadoInspeccion,
  cargarUnidades,
  esCambioDeInspeccion,
  guardarMarcaUnidad,
  guardarNotaMarca,
  soltarMarcaUnidad,
} from '../../lib/centroOperacionesDb';
import type { EstadoInspeccion } from '../../lib/centroOperacionesDb';
import {
  GRUPO_SITIO_INFO,
  MARCA_INFO,
  ORDEN_GRUPOS_SITIO,
  conteoDelSitio,
  edicionSinGuardar,
  filasDelSitio,
  modoAlTocar,
  textoAvisoInspeccion,
  textoConteoDelSitio,
  vinculadasParaInspeccion,
} from '../../lib/centroOperacionesMaquinariaBloques';
import type { ConteoDelSitio, EdicionEstado, FilaDelSitio, GrupoSitio } from '../../lib/centroOperacionesMaquinariaBloques';
import {
  FRESCURA_LECTURA_MS,
  TOPE_LECTURA_BLOQUE_MS,
  cambioElTurno,
  dialogoSoltar,
  editorDeMarca,
  gruposParaSalidas,
  lineasDeFila,
  notaEscritaSinGuardar,
  pideloAQuienAdministra,
  referenciaDeGuardia,
  textoExitoMarca,
  textoInspeccionLeida,
} from './pantallaParteDiario';
import type { LecturaInspeccion } from './pantallaParteDiario';

const ESTADOS: EstadoUnidad[] = ['disponible', 'averiada'];

/** Los conteos que el Parte diario muestra en el encabezado plegado (null = no se sabe). */
export type ConteoMaquinaria = ConteoDelSitio | null;

/** El grupo EFECTIVO de cada unidad (por id), para el 🔧 del selector de las salidas (null = no se sabe). */
export type EstadosMaquinaria = Record<string, GrupoSitio> | null;

/** Cada cuánto se mira el reloj (el «hoy», el «quedó atrás» y el cambio de turno). */
const CADA_MINUTO = 60_000;

export function BloqueMaquinaria({ sitio, nivel, fecha, alConteo, alSinGuardar, alEstados }: {
  sitio: Sitio;
  nivel: PermLevel;
  fecha: string;
  /** Avisa los conteos al Parte diario (encabezado plegado, lote 5 B10). */
  alConteo?: (c: ConteoMaquinaria) => void;
  /** Avisa si la nota (o la marca) quedó elegida sin guardar (revisión final B-M7). */
  alSinGuardar?: (sinGuardar: boolean) => void;
  /** Avisa el grupo efectivo de cada unidad (el 🔧 del selector de las salidas, M8). */
  alEstados?: (e: EstadosMaquinaria) => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  // ⭐ Solo Full marca y suelta: la RLS de `cop_unidades` no deja a nadie más.
  const puedeCambiar = levelMeets(nivel, 'full');

  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Lo que dice inspección (null = sin leer) y cómo va su lectura.
  const [insp, setInsp] = useState<EstadoInspeccion | null>(null);
  const [lectura, setLectura] = useState<LecturaInspeccion>('sin_vinculadas');
  const [errorInsp, setErrorInsp] = useState<string | null>(null);
  const [reloj, setReloj] = useState(() => Date.now());
  const [edicion, setEdicion] = useState<EdicionEstado | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [soloNoCoinciden, setSoloNoCoinciden] = useState(false);
  /** El candado de verdad contra el doble toque (el estado tarda un render en llegar). */
  const enVuelo = useRef(false);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  // ⭐ B1: la hora de la última lectura BUENA de inspección (no se borra si falla una relectura: la
  //    guardia la usa de referencia). B10: hasta cuándo esa lectura es «fresca» y de qué vinculadas
  //    era; qué pedido de inspección está en vuelo.
  const ultimaLeidaBuena = useRef<string | null>(null);
  const frescaHasta = useRef(0);
  const claveBuena = useRef('');
  const inspEnVuelo = useRef<number | null>(null);

  // Otro sitio: lo leído de inspección y el editor eran del otro.
  useEffect(() => {
    setInsp(null); setLectura('sin_vinculadas'); setErrorInsp(null); setEdicion(null); setErrorGuardar(null); setSoloNoCoinciden(false);
    ultimaLeidaBuena.current = null; frescaHasta.current = 0; claveBuena.current = ''; inspEnVuelo.current = null;
  }, [sitio.id]);

  // El reloj de la pantalla: el «hoy», el «quedó atrás» (dura la jornada) y el cambio de turno.
  useEffect(() => {
    const t = setInterval(() => setReloj(Date.now()), CADA_MINUTO);
    return () => clearInterval(t);
  }, []);

  // ⭐ Una respuesta vieja no pisa a la nueva (cada carga pide su número).
  const pedidos = useRef(secuenciaDePedidos()).current;
  const pedidosInsp = useRef(secuenciaDePedidos()).current;

  /** El segundo tiempo: lo que dice inspección de las VINCULADAS (sin vinculadas no consulta).
   *  `forzar` (↻, Reintentar, después de guardar o soltar) salta la frescura de B10. */
  const leerInspeccion = useCallback(async (us: Unidad[], forzar = false) => {
    const vinculadas = vinculadasParaInspeccion(us);
    if (vinculadas.length === 0) {
      pedidosInsp.nuevo();
      setInsp(null);
      setErrorInsp(null);
      setLectura('sin_vinculadas');
      return;
    }
    // ⭐ B10: al volver a la pantalla la flota se recarga y esto correría dos veces seguidas: una
    //    lectura buena de las MISMAS vinculadas con menos de FRESCURA_LECTURA_MS (o una ya en
    //    vuelo) se reutiliza, salvo pedido explícito.
    const clave = vinculadas.map((v) => `${v.machineryId}|${v.estadoAt ?? ''}`).join(',');
    if (!forzar && clave === claveBuena.current && (Date.now() < frescaHasta.current || inspEnVuelo.current !== null)) return;
    const n = pedidosInsp.nuevo();
    inspEnVuelo.current = n;
    claveBuena.current = clave;
    frescaHasta.current = 0;
    // Mientras se vuelve a leer, lo leído antes sigue a la vista (con «Leyendo…» arriba).
    setLectura('cargando');
    try {
      // ⭐ R1: con tope. Sin él, con mala señal «Leyendo…» (y las pastillas apagadas) duraría minutos.
      const r = await conTope(cargarEstadoInspeccion(vinculadas), TOPE_LECTURA_BLOQUE_MS, 'No se pudo leer el estado de inspección: no respondió a tiempo.');
      if (!pedidosInsp.vigente(n)) return;
      ultimaLeidaBuena.current = r.leidaAt;
      frescaHasta.current = Date.now() + FRESCURA_LECTURA_MS;
      setInsp(r);
      setErrorInsp(null);
      setLectura('ok');
      setReloj(Date.now());
    } catch (e: any) {
      if (!pedidosInsp.vigente(n)) return;
      // ⭐ Sin lectura no se supone nada: ❔ Sin dato / «sin verificar».
      setInsp(null);
      setErrorInsp(e?.message || 'No se pudo leer el estado de inspección.');
      setLectura('error');
    } finally {
      if (inspEnVuelo.current === n) inspEnVuelo.current = null;
    }
  }, [pedidosInsp]);

  /** El primer tiempo: la flota del módulo (y después, inspección). */
  const cargar = useCallback(async () => {
    const n = pedidos.nuevo();
    let us: Unidad[] | null = null;
    try {
      us = await cargarUnidades(sitio.id);
      if (!pedidos.vigente(n)) return;
      setUnidades(us);
      setError(null);
      setReloj(Date.now());
    } catch (e: any) {
      if (!pedidos.vigente(n)) return;
      const msg = e?.message || 'No se pudieron cargar las unidades.';
      setError(msg);
      toast.error(msg);
    } finally {
      if (pedidos.vigente(n)) setCargando(false);
    }
    if (us && pedidos.vigente(n)) await leerInspeccion(us);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio, leerInspeccion]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // ⭐ LA regla: cada unidad activa con su estado en el sitio, en el orden del bloque.
  const filas = useMemo(() => filasDelSitio(unidades, insp, reloj), [unidades, insp, reloj]);
  const conteo = useMemo(() => conteoDelSitio(filas), [filas]);
  const otraJornada = !!fecha && fecha !== caracasBusinessToday();
  const hayVinculadas = filas.some((f) => f.estado.vinculada);
  // ⭐ A6/B3: inspección leyéndose por PRIMERA vez (nada a la vista todavía): las vinculadas sin marca
  //    no son «sin dato» (eso es «falló») y sus pastillas van apagadas hasta que se lea (con el tope
  //    R1 dura poco).
  const leyendo = lectura === 'cargando' && !insp;

  // El encabezado plegado y el selector de las salidas: sin datos (cargando, la carga fallida sin
  // nada a la vista, o inspección leyéndose por primera vez) no se inventan.
  const sinUnidades = cargando || (!!error && unidades.length === 0);
  const sinDatos = sinUnidades || leyendo;
  const firmaConteo = sinDatos ? '' : JSON.stringify(conteo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { alConteo?.(sinDatos ? null : conteo); }, [firmaConteo, alConteo]);
  const grupos = useMemo(() => gruposParaSalidas(filas), [filas]);
  const firmaGrupos = sinUnidades ? '' : JSON.stringify(grupos);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { alEstados?.(sinUnidades ? null : grupos); }, [firmaGrupos, alEstados]);

  // El editor abierto: lo decide la marca VIGENTE (`modoAlTocar`), nunca la guardada.
  const filaAbierta = edicion ? filas.find((f) => f.unidad.id === edicion.id) ?? null : null;
  const editor = edicion && filaAbierta ? editorDeMarca(filaAbierta, edicion.estado, !!edicion.soloNota) : null;
  // B-M7: una marca nueva elegida, o una nota distinta de la guardada, es «✏️ sin guardar».
  const sinGuardar = !!edicion && (editor?.modo === 'marca' || edicionSinGuardar(edicion, unidades));
  useEffect(() => { alSinGuardar?.(sinGuardar); }, [sinGuardar, alSinGuardar]);

  /** «🔄 Reintentar» (B12): en web deslizar no hace nada. */
  const reintentar = () => { setCargando(true); cargar(); };
  /** «↻» / «🔄 Reintentar» de inspección: solo el segundo tiempo (pedido explícito: sin frescura). */
  const releerInspeccion = () => { leerInspeccion(unidades, true); };

  // ⭐ B6: el filtro «⚠️ n no coinciden» se apaga solo cuando ya no queda ninguna (si no, se quedaba
  //    pegado y volvía a filtrar solo con la próxima ⚠️).
  const cuantasNoCoinciden = filas.filter((f) => f.estado.noCoincide).length;
  useEffect(() => { if (cuantasNoCoinciden === 0) setSoloNoCoinciden(false); }, [cuantasNoCoinciden]);

  const codigoDe = (id: string) => unidades.find((x) => x.id === id)?.codigo ?? 'otra unidad';

  /** B-M2: con una nota escrita sin guardar, se pregunta antes de tirarla. */
  const preguntarDescartar = (mensaje: string) => confirm({
    title: 'Hay una nota escrita sin guardar',
    message: mensaje,
    confirmText: 'Descartar',
    cancelText: 'Seguir escribiendo',
    danger: true,
  });

  /** Abre el editor: con una pastilla (marca nueva o nota, según `modoAlTocar`) o con el enlace
   *  «📝 nota» (`soloNota`: solo la nota de la marca que manda, también «sin verificar», B1). */
  const abrir = (f: FilaDelSitio, estado: EstadoUnidad, soloNota = false) => {
    if (!puedeCambiar || enVuelo.current) return;
    const ed = editorDeMarca(f, estado, soloNota);
    if (!ed.modo) return; // en espera, retirada o transferida: lo maneja la oficina.
    const id = f.unidad.id;
    const poner = () => {
      if (!vivo.current || enVuelo.current) return;
      setErrorGuardar(null);
      // En la MISMA máquina, cambiar de pastilla no tira la nota que ya se escribió. El grupo en
      // que se abrió se recuerda (B7): la fila no se muda de grupo mientras escribe.
      setEdicion((prev) => (prev && prev.id === id && notaEscritaSinGuardar(prev, unidades)
        ? { ...prev, estado, soloNota }
        : { id, estado, nota: ed.nota, soloNota, grupo: f.estado.grupo }));
    };
    if (edicion && edicion.id !== id && notaEscritaSinGuardar(edicion, unidades)) {
      preguntarDescartar(`La nota de ${codigoDe(edicion.id)} no se guardó. ¿Descartarla y abrir ${f.unidad.codigo}?`)
        .then((descartar) => { if (descartar) poner(); });
      return;
    }
    poner();
  };

  const cancelar = () => {
    if (enVuelo.current || !edicion) return;
    const cerrar = () => {
      if (!vivo.current || enVuelo.current) return;
      setEdicion(null);
      setErrorGuardar(null);
    };
    if (!notaEscritaSinGuardar(edicion, unidades)) { cerrar(); return; }
    preguntarDescartar(`La nota que escribiste para ${codigoDe(edicion.id)} no se guardó. ¿Descartarla?`)
      .then((descartar) => { if (descartar) cerrar(); });
  };

  const guardar = async () => {
    if (!edicion || enVuelo.current || !puedeCambiar) return;
    const f = filas.find((x) => x.unidad.id === edicion.id);
    if (!f) { setEdicion(null); return; }
    // ⭐ Todo se fija AHORA, con la regla de AHORA (inspección pudo releerse con el editor abierto).
    const ed = { ...edicion };
    const modo = ed.soloNota ? (modoAlTocar(f.estado, ed.estado, true) === 'nota' ? 'nota' : null) : modoAlTocar(f.estado, ed.estado, !!ed.soloNota);
    if (!modo) {
      // Con «📝 nota» abierto, el enlace nunca se vuelve una marca nueva (la marca pudo dejar de mandar con una relectura).
      setErrorGuardar(ed.soloNota ? 'Tu marca ya no manda: cierra y, si hace falta, vuelve a marcarla.' : (f.estado.porQueNo ?? 'El estado de esta máquina no se cambia desde el sitio.'));
      return;
    }
    // ⭐ A6: mientras inspección se lee por primera vez no se marca una vinculada (iría sin guardia
    //    y, quizá, sobre una que la oficina tiene retirada o en espera).
    if (modo === 'marca' && f.estado.vinculada && leyendo) {
      setErrorGuardar('Espera a que se lea inspección (unos segundos).');
      return;
    }
    const codigo = f.unidad.codigo;
    const machineryId = String(f.unidad.machineryId ?? '').trim();
    // ⭐ La guardia (D2, B1): en una vinculada, desde lo último que ella YA VIO de esa máquina (la
    //    lectura vigente, la última buena aunque la relectura haya fallado, el hecho que la guardia
    //    ya le mostró o su marca anterior). Sin ninguna referencia se marca a ciegas (el editor lo dice, B2).
    const referencia = modo === 'marca' && f.estado.vinculada && machineryId ? referenciaDeGuardia(f.unidad, insp, ultimaLeidaBuena.current, ed.vistoHasta) : null;
    const guardia = referencia ? { machineryId, leidaAt: referencia.leidaAt, motivo: referencia.motivo } : undefined;
    enVuelo.current = true;
    setGuardando(true);
    setErrorGuardar(null);
    try {
      if (modo === 'nota') await guardarNotaMarca(ed.id, ed.nota);
      else await guardarMarcaUnidad(ed.id, { estado: ed.estado, nota: ed.nota }, guardia);
      if (!vivo.current) return;
      // B11: si lo marcado no coincide con inspección, el toast manda a 📲 (el resto del sistema no se entera).
      toast.success(modo === 'nota' ? `${codigo}: nota guardada.` : textoExitoMarca(f, ed.estado));
      setEdicion(null);
      enVuelo.current = false;
      setGuardando(false);
      await cargar();
    } catch (e: any) {
      if (!vivo.current) return;
      // La nota escrita NO se pierde: el editor queda abierto con ella.
      const msg = e?.message || NO_SE_GUARDO;
      setErrorGuardar(msg);
      toast.error(msg);
      // D2: inspección registró algo nuevo: se relee para que ella lo vea antes de volver a marcar.
      // B1: ese hecho ya se le mostró: queda como «visto hasta» (su HORA) y la guardia no vuelve a
      // frenar por él, solo por uno más nuevo (aunque la relectura falle).
      if (esCambioDeInspeccion(e)) {
        const vistoHasta = new Date(e.novedad.ms).toISOString();
        setEdicion((p) => (p && p.id === ed.id ? { ...p, vistoHasta } : p));
        releerInspeccion();
      }
    } finally {
      enVuelo.current = false;
      if (vivo.current) setGuardando(false);
    }
  };

  /** «↩️ Que mande inspección» / «🧹 Quitarla» (superada) / quitar la marca (fuera del catálogo):
   *  la misma puerta (`soltarMarcaUnidad`), con el diálogo que corresponde (B5, B8). */
  const soltar = async (f: FilaDelSitio) => {
    if (!puedeCambiar || enVuelo.current || !f.estado.puedeSoltar || !f.estado.marca) return;
    const d = dialogoSoltar(f, reloj);
    if (!d) return;
    const si = await confirm({ title: d.titulo, message: d.mensaje, confirmText: d.confirmar });
    if (!si || enVuelo.current || !vivo.current) return;
    enVuelo.current = true;
    setGuardando(true);
    try {
      await soltarMarcaUnidad(f.unidad.id);
      if (!vivo.current) return;
      toast.success(f.estado.marcaEstado === 'superada' ? `${f.unidad.codigo}: marca quitada.` : `${f.unidad.codigo}: manda inspección.`);
      if (edicion?.id === f.unidad.id) { setEdicion(null); setErrorGuardar(null); }
      enVuelo.current = false;
      setGuardando(false);
      await cargar();
    } catch (e: any) {
      if (vivo.current) toast.error(e?.message || NO_SE_GUARDO);
    } finally {
      enVuelo.current = false;
      if (vivo.current) setGuardando(false);
    }
  };

  /** 📲 Abre WhatsApp con el texto de lo que no coincide (ella elige el chat; no se guarda nada). */
  const avisar = async (lista: FilaDelSitio[]) => {
    const texto = textoAvisoInspeccion(lista, Date.now(), sitio.nombre);
    if (!texto) { toast.info('No hay diferencias con inspección para avisar.'); return; }
    try {
      await Linking.openURL('https://wa.me/?text=' + encodeURIComponent(texto));
    } catch {
      toast.error('No se pudo abrir WhatsApp.');
    }
  };

  // ── Lo que se ve ──
  const noCoinciden = filas.filter((f) => f.estado.noCoincide);
  const filtrando = soloNoCoinciden && noCoinciden.length > 0;
  const visibles = filtrando ? noCoinciden : filas;
  const textoConteo = textoConteoDelSitio(conteo, 'largo', { leyendo });
  /** B7: la fila abierta se pinta en el grupo en que se abrió (si inspección la mueve, el campo no se desmonta). */
  const grupoDeFila = (f: FilaDelSitio): GrupoSitio => (edicion && edicion.id === f.unidad.id && edicion.grupo ? edicion.grupo : f.estado.grupo);
  const turnoViejo = lectura === 'ok' && cambioElTurno(insp?.leidaAt, reloj);

  // ── Estilos ──
  const ayuda = { color: colors.muted, fontSize: 12 };
  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text,
  } as const;
  const pastilla = (on: boolean, estado: EstadoUnidad, apagada: boolean) => ({
    paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1,
    borderColor: on ? (estado === 'averiada' ? colors.danger : colors.success) : colors.border,
    backgroundColor: on ? (estado === 'averiada' ? colors.danger : colors.success) : colors.surface,
    opacity: guardando || apagada ? 0.5 : 1,
  });
  const textoPastilla = (on: boolean) => ({ color: on ? '#ffffff' : colors.text, fontWeight: '800' as const, fontSize: 12 });
  const boton = (principal: boolean) => ({
    borderWidth: 1, borderColor: principal ? colors.primary : colors.border,
    backgroundColor: principal ? colors.primary : colors.surface,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6, opacity: guardando ? 0.5 : 1,
  });
  const enlace = { color: colors.brandText, fontSize: 12, fontWeight: '700' as const };
  const colorDeGrupo = (g: GrupoSitio) => (g === 'averiada' ? colors.danger : g === 'disponible' ? colors.success : g === 'oficina' ? colors.warning : colors.muted);

  return (
    // Sin tarjeta propia: ya va dentro del bloque del Parte diario (B18).
    <View style={{ gap: spacing.xs }}>
      {textoConteo ? <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{textoConteo}</Text> : null}

      {/* ── Lo que dice inspección: cuándo se leyó, o por qué no ── */}
      {lectura === 'ok' && insp ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
          <Text style={ayuda}>{textoInspeccionLeida(insp.leidaAt, reloj)}</Text>
          <TouchableOpacity onPress={releerInspeccion} accessibilityLabel="Volver a leer inspección">
            <Text style={enlace}>↻ Actualizar</Text>
          </TouchableOpacity>
        </View>
      ) : lectura === 'cargando' ? (
        <Text style={ayuda}>🔎 Leyendo lo que dice inspección…</Text>
      ) : null}
      {turnoViejo ? (
        <TouchableOpacity onPress={releerInspeccion} style={{ alignSelf: 'flex-start' }}>
          <Text style={[enlace, { color: colors.warning }]}>↻ Cambió el turno: toca aquí para actualizar lo que dice inspección.</Text>
        </TouchableOpacity>
      ) : null}
      {lectura === 'error' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
          <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700', flex: 1, minWidth: 180 }}>
            ⚠️ {errorInsp} Las del catálogo sin tu marca salen «❔ Sin dato» y las marcadas, «sin verificar» — toca Reintentar (o desliza hacia abajo en el teléfono).
          </Text>
          <TouchableOpacity onPress={releerInspeccion} style={{ ...boton(false), borderColor: colors.warning }}>
            <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>🔄 Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ── Lo que no coincide: filtrarlo y avisarlo ── */}
      {noCoinciden.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
          <TouchableOpacity onPress={() => setSoloNoCoinciden((v) => !v)} style={{ ...boton(false), borderColor: colors.warning, backgroundColor: filtrando ? colors.warningSoftBg : colors.surface }}>
            <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>
              {filtrando ? 'Ver todas' : `⚠️ ${noCoinciden.length} ${noCoinciden.length === 1 ? 'no coincide' : 'no coinciden'} con inspección`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => avisar(noCoinciden)} style={boton(false)}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
              📲 {noCoinciden.length === 1 ? 'Enviar la diferencia a inspección' : `Enviar las ${noCoinciden.length} diferencias a inspección`}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text style={ayuda}>
        El estado que marques vive solo en este módulo: no le llega a inspección, ni a Control de Maquinaria, ni al catálogo del sistema, ni a las horas ni al pago de los operadores.
        {hayVinculadas ? ' En las máquinas del catálogo tu marca vale hasta que inspección registre algo nuevo de esa máquina.' : ''}
      </Text>
      {otraJornada ? (
        <Text style={[ayuda, { color: colors.warning, fontWeight: '700' }]}>
          Estás viendo la jornada del {dmy(fecha)}: el estado de las máquinas es el de ahora.
        </Text>
      ) : null}
      {!puedeCambiar ? (
        <Text style={[ayuda, { marginTop: 2 }]}>Solo quien tiene Full en el módulo cambia el estado (avisar a inspección sí puedes).</Text>
      ) : null}

      {error ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
          <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', flex: 1, minWidth: 180 }}>
            ⚠️ No se pudieron cargar las unidades: {error} — toca Reintentar (o desliza hacia abajo en el teléfono).
          </Text>
          <TouchableOpacity onPress={reintentar} disabled={cargando} style={{ ...boton(false), borderColor: colors.danger, opacity: cargando ? 0.5 : 1 }}>
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>{cargando ? 'Cargando…' : '🔄 Reintentar'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {cargando ? (
        <Text style={[ayuda, { marginTop: spacing.xs }]}>Cargando la maquinaria…</Text>
      ) : error && unidades.length === 0 ? null : filas.length === 0 ? (
        <Text style={[ayuda, { marginTop: spacing.xs }]}>
          No hay unidades activas en este sitio. Las unidades se agregan en 🚛 Flota.{pideloAQuienAdministra(nivel)}
        </Text>
      ) : ORDEN_GRUPOS_SITIO.map((g) => {
        const delGrupo = visibles.filter((f) => grupoDeFila(f) === g);
        if (delGrupo.length === 0) return null;
        const info = GRUPO_SITIO_INFO[g];
        // B3: mientras se lee por primera vez, las vinculadas sin marca no son «❔ Sin dato» (eso es «falló»).
        const titulo = leyendo && g === 'sin_dato' ? '🔎 Leyendo inspección' : `${info.icono} ${info.titulo}`;
        return (
          <View key={g} style={{ marginTop: spacing.sm }}>
            <Text style={{ color: colorDeGrupo(g), fontWeight: '900', fontSize: 13 }}>{titulo} · {delGrupo.length}</Text>
            {delGrupo.map((f) => {
              const u = f.unidad;
              const e = f.estado;
              const l = lineasDeFila(f, reloj, lectura);
              const abierta = edicion?.id === u.id ? edicion : null;
              const editorAbierto = abierta ? editor : null;
              // «📝 nota»: solo la nota de la marca que manda, también «sin verificar» (B1).
              const modoNota = !!e.encendida && modoAlTocar(e, e.encendida, true) === 'nota';
              const soltarDlg = puedeCambiar && e.puedeSoltar ? dialogoSoltar(f, reloj) : null;
              return (
                <View key={u.id} style={{ paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, gap: 2, marginTop: spacing.xs }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs }}>
                    <View style={{ flex: 1, minWidth: 150 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
                        🚛 {u.codigo}{u.placa ? ` · ${u.placa}` : ''}
                      </Text>
                      <Text style={ayuda}>
                        {l.origen}
                        {e.noCoincide ? <Text style={{ color: colors.warning, fontWeight: '800' }}>   ⚠️ no coincide con inspección</Text> : null}
                      </Text>
                      {u.descripcion || u.chofer ? (
                        <Text style={ayuda}>{[u.descripcion, u.chofer ? `👷 ${u.chofer}` : ''].filter(Boolean).join(' · ')}</Text>
                      ) : null}
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      {ESTADOS.map((s) => {
                        // ⭐ Encendida = la marca que MANDA (o la elegida en el editor); nunca la guardada a secas.
                        const on = (abierta ? abierta.estado : e.encendida) === s;
                        // A6: una vinculada no se marca mientras inspección se lee por primera vez.
                        const apagada = !puedeCambiar || !e.puedeMarcar || (e.vinculada && leyendo);
                        const m = MARCA_INFO[s];
                        return (
                          <TouchableOpacity key={s} disabled={apagada || guardando} onPress={() => abrir(f, s)} style={pastilla(on, s, apagada)}>
                            <Text style={textoPastilla(on)}>{m.icono} {m.etiqueta}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                  <Text style={{ color: colorDeGrupo(e.grupo), fontSize: 12, fontWeight: '800' }}>{l.estado}</Text>
                  {l.inspeccion ? <Text style={ayuda}>{l.inspeccion}</Text> : null}
                  {l.aviso ? <Text style={{ color: colors.warning, fontSize: 12 }}>{l.aviso}</Text> : null}
                  {l.nota && !abierta ? <Text style={{ color: colors.text, fontSize: 12, fontStyle: 'italic' }}>📝 {l.nota}</Text> : null}
                  {/* B4: «lo maneja la oficina» ya lo dice la línea de estado (§4.1); acá solo la salida. */}
                  {l.porQueNo ? <Text style={{ color: colors.muted, fontSize: 11 }}>Si sigue trabajando en el sitio, se da de baja y se agrega como propia en 🚛 Flota.{pideloAQuienAdministra(nivel)}</Text> : null}

                  {!abierta && ((puedeCambiar && (modoNota || soltarDlg)) || e.noCoincide) ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: 2 }}>
                      {puedeCambiar && modoNota && e.encendida ? (
                        <TouchableOpacity disabled={guardando} onPress={() => abrir(f, e.encendida as EstadoUnidad, true)}>
                          <Text style={enlace}>📝 {l.nota ? 'Cambiar la nota' : 'Agregar nota'}</Text>
                        </TouchableOpacity>
                      ) : null}
                      {soltarDlg ? (
                        <TouchableOpacity disabled={guardando} onPress={() => soltar(f)}>
                          <Text style={enlace}>{soltarDlg.enlace}</Text>
                        </TouchableOpacity>
                      ) : null}
                      {e.noCoincide ? (
                        <TouchableOpacity onPress={() => avisar([f])}>
                          <Text style={enlace}>📲 Avisar a inspección</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}

                  {abierta && editorAbierto ? (
                    <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>{editorAbierto.titulo}</Text>
                      {editorAbierto.aviso ? <Text style={[ayuda, { color: editorAbierto.modo ? colors.muted : colors.warning }]}>{editorAbierto.aviso}</Text> : null}
                      <TextInput
                        value={abierta.nota}
                        onChangeText={(v) => setEdicion((p) => (p ? { ...p, nota: v } : p))}
                        placeholder={abierta.estado === 'averiada' ? 'Nota (opcional): qué le pasa, desde cuándo…' : 'Nota (opcional)'}
                        placeholderTextColor={colors.muted}
                        style={input}
                        multiline
                      />
                      {errorGuardar ? <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>⚠️ {errorGuardar}</Text> : null}
                      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                        <TouchableOpacity disabled={guardando || !editorAbierto.modo} onPress={guardar} style={boton(true)}>
                          <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{guardando ? 'Guardando…' : '💾 Guardar'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity disabled={guardando} onPress={cancelar} style={boton(false)}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>Cancelar</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

export default BloqueMaquinaria;
