// 🏭 CENTRO DE OPERACIONES — ✍️ CARGAR (24-oct-2026).
//
// Donde ella anota lo que ENTRA, se MUEVE y SALE del sitio, un renglón por
// anotación: una pesada (viajes = 1) o el total del día en un solo renglón
// (viajes = n). Pastillas de tipo; fecha de jornada (7am a 7am, por defecto
// `caracasBusinessToday()`); hora opcional; la unidad desde la flota o escrita
// (si la placa escrita es de una unidad activa, se vincula sola y lo dice);
// transportista, origen, destino y material con sugerencias; capacidad, viajes,
// toneladas, m³ (si se deja vacío, se muestra el calculado), estado y observación.
//
// ⭐ LAS REGLAS NO VIVEN ACÁ: leer cifras, la hora y los viajes, vincular por
//    placa, «Guardar y otro» y armar el renglón están en
//    `src/lib/centroOperacionesCarga.ts` (probados solos). Esta pantalla pinta.
//
// ⭐ EL BORRADOR: si guardar falla (conexión o permiso), lo escrito queda en el
//    equipo con la clave `cop_borrador_<sitioId>` y se recupera al volver. Se
//    borra SOLO después de guardar con éxito ESE formulario (el que falló o el
//    recuperado; no otro renglón guardado después de un ✏️). Todo acceso al
//    almacenamiento va en try/catch: en una ventana privada puede fallar, y la
//    pantalla sigue (y el aviso no dice que quedó un borrador si no quedó).
//
// ⭐ PERMISOS: anotar y editar piden «escritura»; 🗑️ borrar, solo Full y con
//    confirmación. Si la base rechaza (RLS), la capa de datos lanza el aviso en
//    español: va al toast y queda escrito en la tarjeta (un toast puede quedar
//    tapado), y el formulario NO se borra.
//
// También se usa desde 📋 Registros para el ✏️: con `movimientoAEditar` se abre
// ya cargado, sin «Guardar y otro», sin borrador y sin la lista del día.
//
// ⭐ REVISIÓN FINAL (25-oct-2026):
//   · cada renglón se corrige DONDE NACIÓ (A#1): lo del 📅 Parte diario (bloques y
//     salidas con vehículo) no lleva ✏️ aquí, la fila dice dónde (`dondeSeCorrige`);
//   · lo escrito no se tira sin preguntar (B-M2): ✏️ en otro renglón o «Cancelar» con algo
//     sin guardar piden «Descartar» / «Seguir aquí» (`formularioSinGuardar`);
//   · «Lo cargado el …» guarda DE QUÉ DÍA es (B-M1): al cambiar el día no se ven las filas
//     del anterior, y si la carga falla la tarjeta lo dice;
//   · no se anota en una jornada futura (B-M8): el calendario no pasa de hoy y
//     `validarCarga` tampoco lo acepta.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from '../ui';
import { DateField } from '../DateField';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets, PermLevel } from '../../lib/permissions';
import { caracasBusinessToday } from '../../lib/caracasDay';
import { cmpText, norm } from '../../lib/text';
import { cmpMovimientoJornada, m3De, textoViajes, totalesDe } from '../../lib/centroOperaciones';
import type { ItemLista, Movimiento, Sitio, Unidad } from '../../lib/centroOperaciones';
import {
  ESTADOS_MOV,
  ETIQUETAS_TIPO,
  TIPOS_MOV,
  FormCarga,
  Lectura,
  avisoFalloGuardar,
  avisoPesaje,
  cifraDeCampo,
  clasesOrigenDestino,
  dmy,
  elegirUnidad,
  escribirPlaca,
  etiquetaEstado,
  etiquetaTipo,
  formularioDesdeMovimiento,
  formularioNuevo,
  formularioSinGuardar,
  formularioTrasGuardar,
  horaDeCampo,
  m3Calculado,
  normalizarPlaca,
  secuenciaDePedidos,
  sugerenciasDeLista,
  sugerenciasOrigenDestino,
  textoBloques,
  textoDeUnidad,
  textoViajesRenglon,
  validarCarga,
  viajesDeCampo,
} from '../../lib/centroOperacionesCarga';
import {
  NO_SE_GUARDO,
  borrarMovimiento,
  cargarListas,
  cargarMovimientos,
  cargarUnidades,
  guardarMovimiento,
  sugerenciasDelSistema,
} from '../../lib/centroOperacionesDb';
import { CampoSugerido } from './CampoSugerido';
import { dondeSeCorrige } from './salidasParteDiario';

type Props = {
  sitio: Sitio;
  nivel: PermLevel;
  /** Desde 📋 Registros (✏️): el renglón a corregir. */
  movimientoAEditar?: Movimiento;
  /** Desde 📋 Registros: al guardar (true) o cancelar (false). */
  onTerminado?: (guardado: boolean) => void;
  /** Desde 📋 Registros: si quedó algo escrito sin guardar (para preguntar en «← Volver»). */
  alSinGuardar?: (sinGuardar: boolean) => void;
};

/** La pregunta antes de tirar lo escrito (revisión final B-M2). */
const DESCARTAR = {
  title: 'Descartar lo escrito',
  message: 'Lo escrito en el formulario no se ha guardado. ¿Descartarlo?',
  confirmText: 'Descartar',
  cancelText: 'Seguir aquí',
  danger: true,
};

/** Cuántas unidades de la flota se ofrecen como pastilla (las demás, escribiendo). */
const MAX_FLOTA = 12;

const fmt = (n: number): string => n.toLocaleString('es-VE', { maximumFractionDigits: 2 });

// ═══════════════════════════ Un renglón en una lista ═══════════════════════════

/** Un renglón pintado en una línea corta (lo usan la lista del día y 📋 Registros).
 *  ⭐ Lote 5 A4: la producción sale «🧱 Producción» con sus piezas («120 bloques»), una
 *     venta de bloques con las suyas, y «viajes por confirmar» solo si lo está.
 *  ⭐ Lo que se anotó en el 📅 Parte diario (los bloques y, revisión final A#1, las salidas
 *     con vehículo) NO lleva ✏️ aquí: la fila dice dónde se corrige (`dondeSeCorrige`). */
export function FilaMovimiento({ m, mostrarFecha, onEditar, onBorrar, seleccionado, onSeleccionar }: {
  m: Movimiento;
  mostrarFecha?: boolean;
  onEditar?: () => void;
  onBorrar?: () => void;
  seleccionado?: boolean;
  onSeleccionar?: () => void;
}) {
  const { colors } = useTheme();
  const tipo = ETIQUETAS_TIPO.find((t) => t.key === m.tipo);
  const estado = ESTADOS_MOV.find((e) => e.key === m.estado);
  const dondeCorregir = dondeSeCorrige(m);
  const piezas = typeof m.cantidad === 'number' && Number.isFinite(m.cantidad) ? m.cantidad : null;
  const hora = horaDeCampo(m.hora ?? '').valor;
  const unidad = (m.unidadTexto ?? '').trim();
  const placa = (m.placa ?? '').trim();
  const m3 = m3De(m);
  const cabeza = [
    mostrarFecha ? dmy(m.fecha) : '',
    hora ?? '',
    `${tipo?.ico ?? ''} ${etiquetaTipo(m.tipo)}`,
  ].filter(Boolean).join(' · ');
  const quien = `${m.unidadId ? '🔗 ' : ''}${unidad || 'Sin unidad'}${placa && norm(placa) !== norm(unidad) ? ` (${placa})` : ''}`;
  const ruta = [m.transportista, `${m.origen || '—'} → ${m.destino || '—'}`, m.material].filter((x) => x && String(x).trim()).join(' · ');
  const cifras = [
    piezas !== null ? textoBloques(piezas) : '',
    textoViajesRenglon(m),
    m.toneladas !== null ? `${fmt(m.toneladas)} t` : '',
    m3 !== null ? `${fmt(m3)} m³${m.m3 === null ? ' (calc.)' : ''}` : '',
    `${estado?.ico ?? ''} ${etiquetaEstado(m.estado)}`,
  ].filter(Boolean).join(' · ');

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
      {onSeleccionar ? (
        <TouchableOpacity onPress={onSeleccionar} style={{ paddingTop: 2 }}>
          <Text style={{ fontSize: 16 }}>{seleccionado ? '☑️' : '⬜'}</Text>
        </TouchableOpacity>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>{cabeza}</Text>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{quien}</Text>
        {ruta ? <Text style={{ color: colors.text, fontSize: 12 }}>{ruta}</Text> : null}
        <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>{cifras}</Text>
        {m.observacion ? <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>📝 {m.observacion}</Text> : null}
        {onEditar && dondeCorregir ? <Text style={{ color: colors.muted, fontSize: 11 }}>{dondeCorregir}</Text> : null}
      </View>
      {onEditar && !dondeCorregir ? (
        <TouchableOpacity onPress={onEditar} style={{ padding: 6 }}>
          <Text style={{ fontSize: 16 }}>✏️</Text>
        </TouchableOpacity>
      ) : null}
      {onBorrar ? (
        <TouchableOpacity onPress={onBorrar} style={{ padding: 6 }}>
          <Text style={{ fontSize: 16 }}>🗑️</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ═══════════════════════════ La pestaña ═══════════════════════════

export function CargarTab({ sitio, nivel, movimientoAEditar, onTerminado, alSinGuardar }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const incrustado = !!movimientoAEditar;
  const puedeEscribir = levelMeets(nivel, 'escritura');
  const esFull = nivel === 'full';
  const claveBorrador = `cop_borrador_${sitio.id}`;

  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [listas, setListas] = useState<ItemLista[]>([]);
  const [frentes, setFrentes] = useState<string[]>([]);
  const [errorDatos, setErrorDatos] = useState<string | null>(null);

  const [form, setForm] = useState<FormCarga>(() =>
    movimientoAEditar ? formularioDesdeMovimiento(movimientoAEditar) : formularioNuevo(caracasBusinessToday()));
  const [editando, setEditando] = useState<Movimiento | null>(movimientoAEditar ?? null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [borradorRecuperado, setBorradorRecuperado] = useState(false);
  /** Lo cargado ese día y DE QUÉ DÍA es (B-M1): mientras llega otro, no se muestra. */
  const [delDia, setDelDia] = useState<{ fecha: string; movs: Movimiento[] } | null>(null);
  const [errorDia, setErrorDia] = useState<string | null>(null);
  const [cargandoDia, setCargandoDia] = useState(false);
  /** El formulario «de partida» (B-M2): el que se puso al abrir, al tocar ✏️, al cancelar o
   *  tras guardar. Lo que difiere de él es lo escrito sin guardar. (Un borrador recuperado
   *  NO es partida: es justo lo que no se guardó.) */
  const partida = useRef<FormCarga>(form);
  /** Ya escribió algo: un borrador que llega tarde no le pisa lo escrito. */
  const tocado = useRef(false);
  /** Lo que está en el formulario ES el borrador del equipo (el renglón nuevo que no se
   *  pudo guardar, o el que se recuperó). Solo entonces un guardado con éxito lo borra:
   *  si ella tocó ✏️ en otro renglón, el borrador pendiente se queda para después. */
  const formEsBorrador = useRef(false);

  const cambiar = (cambio: Partial<FormCarga>) => {
    tocado.current = true;
    setForm((f) => ({ ...f, ...cambio }));
  };

  // ── El borrador en el equipo (siempre en try/catch) ──
  /** Deja lo escrito en el equipo. Dice si quedó: el aviso no puede decir que sí si no. */
  const guardarBorrador = async (f: FormCarga): Promise<boolean> => {
    try {
      await AsyncStorage.setItem(claveBorrador, JSON.stringify(f));
      return true;
    } catch {
      // Sin almacenamiento (ventana privada, equipo lleno): el formulario sigue escrito.
      return false;
    }
  };
  const borrarBorrador = async () => {
    try {
      await AsyncStorage.removeItem(claveBorrador);
    } catch {
      // Si no se pudo borrar, al volver se ofrece de nuevo: molesto, pero no se pierde nada.
    }
  };

  // ── La flota, las listas y lo que sugiere el sistema ──
  // ⭐ Depende del objeto `sitio` (no de `sitio.id`) y corre al enfocarse: la pantalla
  //    lo vuelve a crear al entrar y al deslizar, así esta pestaña refresca con ella
  //    (spec §8: «refresca al entrar y al deslizar»), igual que 🚛 Flota y ⚙️ Ajustes.
  // ⭐ Una respuesta vieja no pisa a la nueva (cada carga pide su número).
  const pedidosDatos = useRef(secuenciaDePedidos()).current;
  const cargarDatos = useCallback(async () => {
    const n = pedidosDatos.nuevo();
    setErrorDatos(null);
    try {
      // Solo frentes y obras: el catálogo de máquinas no se usa acá (y pesa).
      const [u, l, s] = await Promise.all([cargarUnidades(sitio.id), cargarListas(sitio.id), sugerenciasDelSistema({ maquinas: false })]);
      if (!pedidosDatos.vigente(n)) return; // llegó otra respuesta más nueva
      setUnidades(u);
      setListas(l);
      setFrentes([...s.frentes, ...s.obras.map((o) => o.nombre)]);
    } catch (e: any) {
      if (!pedidosDatos.vigente(n)) return;
      const msg = e?.message || 'No se pudieron cargar la flota y las listas.';
      setErrorDatos(msg);
      toast.error(msg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio]);
  useFocusEffect(useCallback(() => { cargarDatos(); }, [cargarDatos]));

  // ── Al entrar: si quedó un borrador sin guardar, se recupera ──
  useEffect(() => {
    if (incrustado) return;
    let vivo = true;
    (async () => {
      try {
        const crudo = await AsyncStorage.getItem(claveBorrador);
        if (!vivo || !crudo || tocado.current) return;
        const b = JSON.parse(crudo);
        if (!b || typeof b !== 'object') return;
        const base = formularioNuevo(caracasBusinessToday());
        const lista = (v: any) => (v && typeof v === 'object' ? { texto: String(v.texto ?? ''), listaId: v.listaId ?? null } : { texto: '', listaId: null });
        setForm({
          ...base, ...b,
          transportista: lista(b.transportista), origen: lista(b.origen), destino: lista(b.destino), material: lista(b.material),
        });
        formEsBorrador.current = true;
        setBorradorRecuperado(true);
      } catch {
        // Un borrador ilegible no detiene la pantalla.
      }
    })();
    return () => { vivo = false; };
  }, [claveBorrador, incrustado]);

  // ── Lo cargado ese día ──
  // ⭐ Si cambia el día (o se recarga) antes de que vuelva la respuesta anterior, esa
  //    respuesta vieja se descarta: la lista nunca muestra lo de otro día.
  const pedidosDia = useRef(secuenciaDePedidos()).current;
  const recargarDia = useCallback(async () => {
    if (incrustado) return;
    const n = pedidosDia.nuevo();
    const fecha = form.fecha;
    setCargandoDia(true);
    setErrorDia(null);
    try {
      const movs = await cargarMovimientos(sitio.id, fecha, fecha);
      if (!pedidosDia.vigente(n)) return;
      // En el orden de la JORNADA: la madrugada (antes de las 7:00) después de las 23:00.
      setDelDia({ fecha, movs: [...movs].sort(cmpMovimientoJornada) });
    } catch (e: any) {
      if (!pedidosDia.vigente(n)) return;
      // Queda escrito en la tarjeta (un toast puede quedar tapado) y no se ve lo de otro día.
      const msg = e?.message || 'No se pudo cargar lo del día.';
      setErrorDia(msg);
      toast.error(msg);
    } finally {
      if (pedidosDia.vigente(n)) setCargandoDia(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio, form.fecha, incrustado]);
  // Al entrar, al deslizar (la pantalla recrea `sitio`) y al cambiar el día.
  useFocusEffect(useCallback(() => { recargarDia(); }, [recargarDia]));

  // ── Sugerencias ──
  const activas = useMemo(() => unidades.filter((u) => u.activo).sort((a, b) => cmpText(textoDeUnidad(a), textoDeUnidad(b))), [unidades]);
  const clases = clasesOrigenDestino(form.tipo);
  const sugOD = useMemo(() => sugerenciasOrigenDestino(form.tipo, listas, frentes), [form.tipo, listas, frentes]);
  const sugTransportista = useMemo(() => sugerenciasDeLista(listas, ['transportista'], activas.map((u) => u.dueno ?? '')), [listas, activas]);
  const sugMaterial = useMemo(() => sugerenciasDeLista(listas, ['material']), [listas]);
  const itemsDe = (cl: string[]) => listas.filter((i) => cl.includes(i.clase));

  const unidadVinculada = form.unidadId ? unidades.find((u) => u.id === form.unidadId) ?? null : null;
  const flotaVisible = useMemo(() => {
    const q = norm(form.unidadTexto.trim());
    const p = normalizarPlaca(form.placa);
    const lista = !q && !p ? activas : activas.filter((u) =>
      (q && norm([u.codigo, u.descripcion, u.placa, u.dueno].join(' ')).includes(q)) || (p && normalizarPlaca(u.placa).includes(p)));
    return { mostradas: lista.slice(0, MAX_FLOTA), resto: Math.max(0, lista.length - MAX_FLOTA) };
  }, [activas, form.unidadTexto, form.placa]);

  // ── Lecturas en vivo (se ve el número que se leyó ANTES de guardar) ──
  const hora = horaDeCampo(form.hora);
  const viajes = viajesDeCampo(form.viajes);
  const toneladas = cifraDeCampo(form.toneladas);
  const m3 = cifraDeCampo(form.m3);
  const capacidad = cifraDeCampo(form.capacidad, { mayorQueCero: true });
  const calculado = m3Calculado(form);
  const pesaje = avisoPesaje(form);

  // ── ¿Quedó algo escrito sin guardar? (B-M2) 📋 Registros lo pregunta en «← Volver» ──
  const sinGuardar = formularioSinGuardar(form, partida.current, !!editando);
  useEffect(() => { alSinGuardar?.(sinGuardar); }, [sinGuardar, alSinGuardar]);

  // ── Guardar ──
  const guardar = async (otro: boolean) => {
    if (guardando || !puedeEscribir) return;
    // Sin jornadas futuras (B-M8): como el 📅 Parte diario.
    const { errores, datos } = validarCarga(form, caracasBusinessToday());
    if (errores.length) {
      setErrorGuardar(errores.join('\n'));
      toast.error(errores[0]);
      return;
    }
    setGuardando(true);
    setErrorGuardar(null);
    try {
      await guardarMovimiento(editando ? { ...datos, id: editando.id } : { ...datos, sitioId: sitio.id });
    } catch (e: any) {
      // Conexión o permiso (RLS): lo escrito NO se borra; si es nuevo, queda de borrador
      // (y el aviso dice la verdad sobre si quedó o no).
      const msg = e?.message || NO_SE_GUARDO;
      const quedo = !editando && await guardarBorrador(form);
      if (!editando) formEsBorrador.current = true;
      const aviso = avisoFalloGuardar(msg, !!editando, quedo);
      setErrorGuardar(aviso);
      toast.error(aviso);
      setGuardando(false);
      // Puede que la base SÍ lo haya guardado y se perdiera solo la respuesta: que «Lo
      // cargado el …» lo muestre, para no volver a guardarlo doble.
      recargarDia();
      return;
    }
    setGuardando(false);
    // ✅ Se guardó: recién ahora el borrador sobra, y SOLO si lo guardado era el borrador.
    if (!editando && formEsBorrador.current) await borrarBorrador();
    if (!editando) formEsBorrador.current = false;
    setBorradorRecuperado(false);
    toast.success(editando ? 'Cambios guardados.' : otro ? 'Guardado. Sigue con el próximo.' : 'Renglón guardado.');
    if (incrustado) { onTerminado?.(true); return; }
    tocado.current = false;
    // ⭐ Siempre fuera de «editando», y el siguiente formulario sale de lo que se guardó
    //    (el `form` de este guardado), nunca de lo que haya quedado en pantalla.
    setEditando(null);
    setForm(formularioTrasGuardar(form, !!editando, otro));
    partida.current = formularioTrasGuardar(form, !!editando, otro);
    recargarDia();
  };

  const editarDelDia = async (m: Movimiento) => {
    // Mientras viaja un guardado, ✏️ no hace nada: el guardado terminaría pisando el
    // formulario y dejaría «Editando X» con los datos de otro renglón.
    if (guardando) return;
    // Lo anotado en el 📅 Parte diario (una producción, una venta de bloques —lote 5 A4— o
    // una salida con vehículo —revisión final A#1—) no se corrige aquí: este formulario la
    // convertiría en otra cosa. La fila ni siquiera ofrece ✏️; esto es por si acaso.
    if (dondeSeCorrige(m)) return;
    // ⭐ B-M2: lo escrito y sin guardar no se tira sin preguntar.
    if (formularioSinGuardar(form, partida.current, !!editando) && !(await confirm(DESCARTAR))) return;
    tocado.current = true;
    // El formulario deja de ser el borrador: si había uno pendiente, se queda en el equipo.
    formEsBorrador.current = false;
    setEditando(m);
    setErrorGuardar(null);
    setForm(formularioDesdeMovimiento(m));
    partida.current = formularioDesdeMovimiento(m);
  };

  const cancelarEdicion = async () => {
    // ⭐ B-M2: «Cancelar» con cambios pregunta (también desde 📋 Registros).
    if (formularioSinGuardar(form, partida.current, !!editando) && !(await confirm(DESCARTAR))) return;
    setErrorGuardar(null);
    formEsBorrador.current = false;
    if (incrustado) { onTerminado?.(false); return; }
    setEditando(null);
    setForm(formularioNuevo(form.fecha));
    partida.current = formularioNuevo(form.fecha);
  };

  const borrar = async (m: Movimiento) => {
    if (guardando || nivel !== 'full') return;
    const ok = await confirm({
      title: 'Borrar renglón',
      message: `¿Borrar el renglón de ${(m.unidadTexto || m.placa || 'sin unidad').trim()} del ${dmy(m.fecha)}? No se puede deshacer.`,
      confirmText: 'Borrar',
      danger: true,
    });
    if (!ok) return;
    try {
      await borrarMovimiento(m.id);
      toast.success('Renglón borrado.');
      if (editando?.id === m.id) {
        // Se borró el que se estaba editando: ya no hay nada que guardar en él.
        setEditando(null);
        setForm(formularioNuevo(form.fecha));
        partida.current = formularioNuevo(form.fecha);
      }
      recargarDia();
    } catch (e: any) {
      toast.error(e?.message || 'No se borró el renglón.');
      // Si ya no existía, que la lista lo diga (si no, el renglón fantasma sigue ahí).
      recargarDia();
    }
  };

  // ── Estilos ──
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: 4 } as const;
  const etiqueta = { color: colors.muted, fontSize: 11, fontWeight: '800' as const, marginTop: spacing.xs };
  const pastilla = (on: boolean) => ({
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1,
    borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface,
  });
  const textoPastilla = (on: boolean) => ({ color: on ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });

  /** Lo que se leyó del campo, debajo de él: el número, el error o la ayuda. */
  const leido = (l: Lectura<number>, unidad: string, vacio: string) => (
    <Text style={{ fontSize: 11, marginTop: 2, fontWeight: '700', color: l.error ? colors.danger : l.valor !== null ? colors.success : colors.muted }}>
      {l.error ? `⚠️ ${l.error}` : l.valor !== null ? `= ${fmt(l.valor)} ${unidad}` : vacio}
    </Text>
  );

  // ⭐ B-M1: solo lo de ESTE día (y sin error): nunca las filas del día anterior bajo el título del nuevo.
  const listoDia = !!delDia && delDia.fecha === form.fecha && !errorDia;
  const filasDia = listoDia && delDia ? delDia.movs : [];
  const totalesDia = totalesDe(filasDia);

  return (
    <View style={{ gap: spacing.sm }}>
      <Card>
        {editando ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, flex: 1 }}>✏️ Editando el renglón del {dmy(editando.fecha)}</Text>
            <TouchableOpacity onPress={cancelarEdicion} style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          // El sitio a la vista: así nunca se carga sin saber en cuál.
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>✍️ Nuevo renglón · 📍 {sitio.nombre}</Text>
        )}

        {borradorRecuperado && !editando ? (
          <View style={{ backgroundColor: colors.infoSoftBg, borderColor: colors.infoSoftBorder, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm }}>
            <Text style={{ color: colors.infoSoftText, fontSize: 12, fontWeight: '700' }}>
              📝 Se recuperó lo que no se pudo guardar la última vez. Revisa lo cargado ese día (abajo) antes de guardarlo: si aquel guardado sí entró, quedaría doble.
            </Text>
          </View>
        ) : null}

        {errorDatos ? (
          <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>⚠️ {errorDatos} (se puede escribir igual)</Text>
        ) : null}

        {/* ── TIPO ── */}
        <Text style={etiqueta}>TIPO</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
          {TIPOS_MOV.map((t) => {
            const on = form.tipo === t.key;
            return (
              <TouchableOpacity key={t.key} onPress={() => cambiar({ tipo: t.key })} style={pastilla(on)}>
                <Text style={textoPastilla(on)}>{t.ico} {t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── FECHA Y HORA ── */}
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 150 }}>
            <Text style={etiqueta}>FECHA (JORNADA 7AM A 7AM)</Text>
            <View style={{ marginTop: 4 }}>
              {/* B-M8: una jornada que no ha empezado no existe todavía (como en el 📅 Parte diario). */}
              <DateField value={form.fecha} onChange={(f) => cambiar({ fecha: f })} maxISO={caracasBusinessToday()} />
            </View>
          </View>
          <View style={{ width: 120 }}>
            <Text style={etiqueta}>HORA (OPCIONAL)</Text>
            <TextInput
              value={form.hora}
              onChangeText={(v) => cambiar({ hora: v })}
              placeholder="HH:MM"
              placeholderTextColor={colors.muted}
              keyboardType="numbers-and-punctuation"
              maxLength={8}
              style={input}
            />
          </View>
        </View>
        {hora.error ? (
          <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>⚠️ {hora.error}</Text>
        ) : hora.valor && hora.valor < '07:00' ? (
          <Text style={{ color: colors.muted, fontSize: 11 }}>🌙 Antes de las 7:00: es la madrugada siguiente, dentro de la jornada del {dmy(form.fecha)}.</Text>
        ) : null}

        {/* ── UNIDAD ── */}
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <View style={{ flex: 2, minWidth: 150 }}>
            <Text style={etiqueta}>UNIDAD</Text>
            <TextInput
              value={form.unidadTexto}
              onChangeText={(v) => cambiar({ unidadTexto: v })}
              placeholder="Código o nombre (o elígela abajo)"
              placeholderTextColor={colors.muted}
              style={input}
            />
          </View>
          <View style={{ flex: 1, minWidth: 110 }}>
            <Text style={etiqueta}>PLACA</Text>
            <TextInput
              value={form.placa}
              onChangeText={(v) => { tocado.current = true; setForm((f) => escribirPlaca(f, v, unidades)); }}
              placeholder="Placa"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              style={input}
            />
          </View>
        </View>
        {form.unidadId ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 }}>
            <Text style={{ color: colors.success, fontSize: 12, fontWeight: '800', flex: 1 }}>
              🔗 Vinculada a {unidadVinculada ? `${textoDeUnidad(unidadVinculada)}${unidadVinculada.placa ? ` · ${unidadVinculada.placa}` : ''}` : 'una unidad de la flota'}
            </Text>
            <TouchableOpacity onPress={() => { tocado.current = true; setForm((f) => elegirUnidad(f, null)); }}>
              <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>Desvincular</Text>
            </TouchableOpacity>
          </View>
        ) : activas.length > 0 ? (
          <View style={{ marginTop: 4 }}>
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              {flotaVisible.mostradas.length ? 'De la flota (toca para elegir):' : 'Ninguna unidad de la flota coincide: queda escrita a mano.'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
              {flotaVisible.mostradas.map((u) => (
                <TouchableOpacity key={u.id} onPress={() => { tocado.current = true; setForm((f) => elegirUnidad(f, u)); }} style={pastilla(false)}>
                  <Text style={textoPastilla(false)}>🚛 {textoDeUnidad(u)}{u.placa && norm(u.placa) !== norm(textoDeUnidad(u)) ? ` · ${u.placa}` : ''}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {flotaVisible.resto > 0 ? (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>+{flotaVisible.resto} más: escribe el código o la placa para encontrarla.</Text>
            ) : null}
          </View>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>La flota del sitio está vacía: la unidad queda escrita a mano.</Text>
        )}

        {/* ── TRANSPORTISTA, ORIGEN, DESTINO, MATERIAL ── */}
        <CampoSugerido etiqueta="Transportista" valor={form.transportista} onChange={(v) => cambiar({ transportista: v })}
          sugerencias={sugTransportista} items={itemsDe(['transportista'])} />
        <CampoSugerido etiqueta="Origen" valor={form.origen} onChange={(v) => cambiar({ origen: v })}
          sugerencias={sugOD.origen} items={itemsDe(clases.origen)}
          placeholder={form.tipo === 'entrada' ? 'Frente u obra' : form.tipo === 'otro' ? 'Escribe o elige' : 'Patio'} />
        <CampoSugerido etiqueta="Destino" valor={form.destino} onChange={(v) => cambiar({ destino: v })}
          sugerencias={sugOD.destino} items={itemsDe(clases.destino)}
          placeholder={form.tipo === 'salida' ? 'Destino externo' : form.tipo === 'otro' ? 'Escribe o elige' : 'Patio'} />
        <CampoSugerido etiqueta="Material" valor={form.material} onChange={(v) => cambiar({ material: v })}
          sugerencias={sugMaterial} items={itemsDe(['material'])} />

        {/* ── CIFRAS ── */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <View style={{ flex: 1, minWidth: 120 }}>
            <Text style={etiqueta}>CAPACIDAD (m³)</Text>
            <TextInput value={form.capacidad} onChangeText={(v) => cambiar({ capacidad: v })} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={colors.muted} style={input} />
            {leido(capacidad, 'm³', 'Sin capacidad')}
          </View>
          <View style={{ flex: 1, minWidth: 120 }}>
            <Text style={etiqueta}>VIAJES</Text>
            <TextInput value={form.viajes} onChangeText={(v) => cambiar({ viajes: v })} keyboardType="number-pad" placeholder="1" placeholderTextColor={colors.muted} style={input} />
            {leido(viajes, viajes.valor === 1 ? 'viaje' : 'viajes', form.estado === 'por_confirmar' ? 'Vacío: por confirmar' : '⚠️ Falta (vacío solo si está por confirmar)')}
          </View>
          <View style={{ flex: 1, minWidth: 120 }}>
            <Text style={etiqueta}>TONELADAS</Text>
            <TextInput value={form.toneladas} onChangeText={(v) => cambiar({ toneladas: v })} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={colors.muted} style={input} />
            {leido(toneladas, 't', 'Sin toneladas')}
          </View>
          <View style={{ flex: 1, minWidth: 120 }}>
            <Text style={etiqueta}>m³</Text>
            <TextInput value={form.m3} onChangeText={(v) => cambiar({ m3: v })} keyboardType="decimal-pad" placeholder={calculado !== null ? fmt(calculado) : '0,00'} placeholderTextColor={colors.muted} style={input} />
            {leido(m3, 'm³', calculado !== null ? `Calculado: ${fmt(calculado)} m³ (viajes × capacidad)` : 'Sin m³ (falta capacidad o viajes)')}
          </View>
        </View>

        {/* ── ESTADO ── */}
        <Text style={etiqueta}>ESTADO</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
          {ESTADOS_MOV.map((e) => {
            const on = form.estado === e.key;
            return (
              <TouchableOpacity key={e.key} onPress={() => cambiar({ estado: e.key })} style={pastilla(on)}>
                <Text style={textoPastilla(on)}>{e.ico} {e.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {pesaje ? (
          <View style={{ backgroundColor: colors.warningSoftBg, borderColor: colors.warningSoftBorder, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, marginTop: 4, gap: 4 }}>
            <Text style={{ color: colors.warningSoftText, fontSize: 12, fontWeight: '700' }}>
              ⚖️ Escribiste toneladas pero el renglón está «Esperando pesaje»: esas toneladas no suman hasta que se confirme.
            </Text>
            <TouchableOpacity onPress={() => cambiar({ estado: 'confirmado' })} style={{ alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
              <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 12 }}>✅ Pasar a confirmado</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ── OBSERVACIÓN ── */}
        <Text style={etiqueta}>OBSERVACIÓN</Text>
        <TextInput value={form.observacion} onChangeText={(v) => cambiar({ observacion: v })} placeholder="Opcional" placeholderTextColor={colors.muted} multiline style={[input, { minHeight: 56, textAlignVertical: 'top' }]} />

        {errorGuardar ? (
          <View style={{ backgroundColor: colors.dangerSoftBg, borderColor: colors.dangerSoftBorder, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.xs }}>
            <Text style={{ color: colors.dangerSoftText, fontSize: 12, fontWeight: '700' }}>⚠️ {errorGuardar}</Text>
          </View>
        ) : null}

        {/* ── BOTONES ── */}
        {puedeEscribir ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            <TouchableOpacity onPress={() => guardar(false)} disabled={guardando}
              style={{ flex: 1, minWidth: 140, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: guardando ? 0.6 : 1 }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>{guardando ? 'Guardando…' : editando ? '💾 Guardar cambios' : '💾 Guardar'}</Text>
            </TouchableOpacity>
            {!editando ? (
              <TouchableOpacity onPress={() => guardar(true)} disabled={guardando}
                style={{ flex: 1, minWidth: 140, backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: guardando ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>➕ Guardar y otro</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Solo lectura: tu permiso no deja anotar.</Text>
        )}
        {!editando && puedeEscribir ? (
          <Text style={{ color: colors.muted, fontSize: 11 }}>«Guardar y otro» deja todo puesto menos viajes, toneladas, m³ y observación.</Text>
        ) : null}
      </Card>

      {/* ── LO CARGADO ESE DÍA ── */}
      {!incrustado ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14, flex: 1 }}>📋 Lo cargado el {dmy(form.fecha)}</Text>
            <TouchableOpacity onPress={recargarDia}>
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>{cargandoDia ? 'Cargando…' : '🔄 Actualizar'}</Text>
            </TouchableOpacity>
          </View>
          {errorDia ? (
            <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>⚠️ No se pudo cargar lo del {dmy(form.fecha)}: {errorDia} Toca 🔄 Actualizar.</Text>
          ) : !listoDia ? (
            <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando…</Text>
          ) : filasDia.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12 }}>Todavía no hay nada anotado ese día.</Text>
          ) : (
            <>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {filasDia.length} {filasDia.length === 1 ? 'renglón' : 'renglones'} · {textoViajes(totalesDia)} viajes · {fmt(totalesDia.toneladas)} t · {fmt(totalesDia.m3)} m³
              </Text>
              {/* Mientras se guarda, ✏️ y 🗑️ se apagan (ver editarDelDia). */}
              {filasDia.map((m) => (
                <FilaMovimiento
                  key={m.id}
                  m={m}
                  onEditar={!guardando && levelMeets(nivel, 'escritura') ? () => editarDelDia(m) : undefined}
                  onBorrar={!guardando && esFull ? () => borrar(m) : undefined}
                />
              ))}
            </>
          )}
        </Card>
      ) : null}
    </View>
  );
}

export default CargarTab;
