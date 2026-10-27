// 🏭 CENTRO DE OPERACIONES — 📅 PARTE DIARIO: LAS SALIDAS (24-oct-2026).
//
// Tres bloques, en el orden de su hoja:
//   · 🪨 AGREGADOS: material (con su factor; sin factor, 1,2), cantidad en m³, t o kg
//     con la conversión EN VIVO («12,00 m³ · 14,40 t · 14.400 kg»), destino con sus km
//     (se congelan en la salida), vehículo NUESTRO (unidad de la flota, o su placa: el
//     chofer sale solo) o EXTERNO (solo la compañía), viajes 1.
//   · 🔩 ACERO: quién se lo lleva (las empresas de la lista de transportistas del sitio
//     salen como botón, más «Nosotros»; u otra escrita), el camión y los m³. Sale
//     «esperando pesaje» y SIN toneladas; la lista «Pendientes de pesaje» (todas las
//     fechas, este sitio) tiene «Completar toneladas».
//   · ♻️ ALUMINIO Y PLÁSTICO (y otros de la lista): t o kg (los kg se pasan a t),
//     empresa (nosotros u otra) y destino.
// Debajo de cada bloque, las salidas de ESE día de ese bloque, con ✏️ y 🗑️.
//
// ⭐ UNA SOLA CARGA (lote 5 B11): el Parte diario llama `useDatosSalidas` UNA vez y les
//    pasa los datos a `SalidasAgregados`, `SalidasAcero` y `SalidasAluminioPlastico`
//    (un solo toast si la carga falla). `BloqueSalidas` pinta los tres con su propia carga
//    y `BloqueAgregados`, `BloqueAcero` y `BloqueAluminioPlastico` sirven sueltos.
// ⭐ LAS REGLAS NO VIVEN ACÁ: conversión, km congelados, vehículo, placa, de qué bloque es
//    cada salida, pendientes y «Completar toneladas» están en `./salidasParteDiario.ts`
//    (pura, probada sola). Esta pantalla pinta.
// ⭐ LOS CUIDADOS DE ✍️ CARGAR: un solo guardado a la vez (ni doble toque); lo que se
//    edita se fija AL TOCAR Guardar (✏️ y 🗑️ se apagan mientras viaja), así nunca se
//    escribe sobre otro renglón; si la base rechaza (RLS o conexión) lo escrito QUEDA en
//    el formulario, el aviso va al toast y a la tarjeta, y la lista se recarga por si sí
//    entró. Cambiar de sitio deja todo en blanco (la unidad elegida era de otro sitio).
//    Cambiar de día con una salida a medio editar: sin cambios, la edición se cierra; con
//    cambios, se pregunta (descartar o seguir editando; se guarda en SU día) — lote 5 B8.
// ⭐ SIN LISTAS NO SE ANOTA (lote 5 B6): si la flota y las listas no cargaron nunca, el
//    factor sería 1,2 y los km nada; los tres bloques esperan a que carguen.
// ⭐ LO DE ✍️ CARGA LIBRE se ve en la lista (con su empresa y su estado) pero ✏️ se apaga:
//    se corrige allá (lote 5 B4 y R1).
// ⭐ PERMISOS: Lectura ve las listas, sin formularios (lote 5 B9); Escritura/Full anotan,
//    editan y completan toneladas; 🗑️ solo Full y con confirmación. Los avisos que mandan
//    a ⚙️ Ajustes o a 🚛 Flota le dicen a quien no tiene Full que lo pida (revisión final B-M5).
// ⭐ LO ESCRITO NO SE TIRA SIN PREGUNTAR (revisión final): tocar ✏️ en otra salida con algo
//    escrito sin guardar pregunta antes (B-M2); y las toneladas escritas en «Pendientes de
//    pesaje» también cuentan como «✏️ sin guardar» (B-M7).
// ⭐ EL 🔧 DEL SELECTOR DE UNIDAD (mesa de maquinaria M8) sale del estado EFECTIVO que le pasa el
//    bloque 🚜 (`gruposUnidades`, con inspección), no de la marca guardada: `averiadaEnSalidas`.
// ⭐ EL FACTOR al editar una salida guardada es el de ESA salida (t ÷ m³) mientras no cambien el
//    material, la cifra ni la unidad (`factorDelFormulario`): el mismo que dan sus cifras.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from '../ui';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets, PermLevel } from '../../lib/permissions';
import { cmpText, norm } from '../../lib/text';
import type { ItemLista, Movimiento, Sitio, Unidad } from '../../lib/centroOperaciones';
import { cifraDeCampo, dmy, secuenciaDePedidos, sugerenciasDeLista, textoDeUnidad } from '../../lib/centroOperacionesCarga';
import type { ValorLista } from '../../lib/centroOperacionesCarga';
import {
  NO_SE_GUARDO,
  borrarMovimiento,
  cargarListas,
  cargarMovimientos,
  cargarSalidasEsperandoPesaje,
  cargarUnidades,
  guardarMovimiento,
} from '../../lib/centroOperacionesDb';
import { CampoSugerido } from './CampoSugerido';
import { averiadaEnSalidas, pideloAQuienAdministra } from './pantallaParteDiario';
import type { GrupoSitio } from '../../lib/centroOperacionesMaquinariaBloques';
import {
  ClaseSalida,
  FormAcero,
  FormAgregado,
  FormAluminio,
  MATERIAL_ALUMINIO,
  MATERIAL_PLASTICO,
  NOSOTROS,
  Resultado,
  UNIDADES_AGREGADOS,
  avisoKg,
  cantidadesAgregado,
  claseDeSalida,
  completarPesaje,
  editableEnParteDiario,
  elegirQuienAcero,
  elegirUnidadSalida,
  escribirPlacaSalida,
  esNosotros,
  factorDelFormulario,
  formAceroDesde,
  formAceroNuevo,
  formAgregadoDesde,
  formAgregadoNuevo,
  formAluminioDesde,
  formAluminioNuevo,
  kmCongelado,
  lineasSalida,
  materialesPara,
  mismoFormulario,
  pastillasQuienAcero,
  pendientesDePesaje,
  salidasDeClase,
  soltarUnidadSalida,
  textoEnVivoAgregado,
  toneladasAluminio,
  validarAcero,
  validarAgregado,
  validarAluminio,
} from './salidasParteDiario';

type Props = { sitio: Sitio; nivel: PermLevel; fecha: string };

/** Lo que recibe cada sección: los datos (una sola carga) y cómo se muestra. */
type PropsSeccion = Props & {
  datos: DatosSalidas;
  /** Dentro del Parte diario: sin tarjeta propia ni título repetido (lote 5 B18). */
  incrustado?: boolean;
  /** Avisa si quedó algo escrito sin guardar (el encabezado plegado lo dice, B10). */
  alSinGuardar?: (sinGuardar: boolean) => void;
  /** M8: el grupo EFECTIVO de cada unidad (el bloque 🚜, con inspección): el 🔧 del selector sale de acá. */
  gruposUnidades?: Record<string, GrupoSitio> | null;
};

/** Cuántas unidades de la flota se ofrecen como pastilla (las demás, buscando). */
const MAX_FLOTA = 12;

const fmt = (n: number, dec = 2): string => n.toLocaleString('es-VE', { maximumFractionDigits: dec });

/** Por qué no se anota sin las listas (lote 5 B6). */
const SIN_LISTAS = 'No se pudieron cargar las listas y la flota (factor, km y unidades): toca 🔄 Actualizar antes de anotar.';

// ═══════════════════════════ Los datos (una sola carga) ═══════════════════════════

export type DatosSalidas = {
  unidades: Unidad[];
  listas: ItemLista[];
  /** Todo lo anotado en el sitio ese día (cada bloque toma lo suyo). */
  delDia: Movimiento[];
  /** Las salidas del sitio que esperan pesaje, de cualquier fecha. */
  pendientes: Movimiento[];
  cargando: boolean;
  errorDatos: string | null;
  /** ¿La flota y las listas cargaron al menos una vez en este sitio? Sin ellas no se anota (B6). */
  listasCargadas: boolean;
  recargar: () => void;
};

/**
 * La flota, las listas, lo del día y los pendientes de pesaje. Refresca al enfocarse la
 * pantalla y cuando cambian el sitio o el día; una respuesta vieja no pisa a la nueva.
 * El Parte diario la llama UNA vez para los tres bloques (lote 5 B11).
 */
export function useDatosSalidas(sitio: Sitio, fecha: string): DatosSalidas {
  const toast = useToast();
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [listas, setListas] = useState<ItemLista[]>([]);
  const [delDia, setDelDia] = useState<Movimiento[]>([]);
  const [pendientes, setPendientes] = useState<Movimiento[]>([]);
  const [cargando, setCargando] = useState(false);
  const [errorDatos, setErrorDatos] = useState<string | null>(null);
  const [listasCargadas, setListasCargadas] = useState(false);

  // Otro sitio u otro día: lo de antes se quita YA (nunca se ve lo de otro día o sitio).
  useEffect(() => { setDelDia([]); }, [sitio.id, fecha]);
  useEffect(() => { setUnidades([]); setListas([]); setPendientes([]); setListasCargadas(false); }, [sitio.id]);

  const pedidos = useRef(secuenciaDePedidos()).current;
  const recargar = useCallback(async () => {
    const n = pedidos.nuevo();
    setCargando(true);
    setErrorDatos(null);
    try {
      const [u, l, dia, pend] = await Promise.all([
        cargarUnidades(sitio.id),
        cargarListas(sitio.id),
        cargarMovimientos(sitio.id, fecha, fecha),
        cargarSalidasEsperandoPesaje(sitio.id),
      ]);
      if (!pedidos.vigente(n)) return; // llegó otra respuesta más nueva
      setUnidades(u);
      setListas(l);
      setDelDia(dia);
      setPendientes(pend);
      setListasCargadas(true);
    } catch (e: any) {
      if (!pedidos.vigente(n)) return;
      const msg = e?.message || 'No se pudieron cargar las salidas.';
      setErrorDatos(msg);
      toast.error(msg);
    } finally {
      if (pedidos.vigente(n)) setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio, fecha]);
  useFocusEffect(useCallback(() => { recargar(); }, [recargar]));

  return { unidades, listas, delDia, pendientes, cargando, errorDatos, listasCargadas, recargar };
}

// ═══════════════════════════ El formulario de un bloque ═══════════════════════════

type OpSeccion<F> = {
  sitio: Sitio;
  nivel: PermLevel;
  fecha: string;
  datos: DatosSalidas;
  nuevo: () => F;
  desde: (m: Movimiento) => F;
  validar: (f: F, fecha: string, listas: ItemLista[], editando: Movimiento | null) => Resultado;
  alSinGuardar?: (sinGuardar: boolean) => void;
};

type Seccion<F> = {
  form: F;
  setForm: React.Dispatch<React.SetStateAction<F>>;
  cambiar: (c: Partial<F>) => void;
  editando: Movimiento | null;
  guardando: boolean;
  error: string | null;
  /** El nivel de quien mira (los avisos le dicen a quién pedir lo que no puede: B-M5). */
  nivel: PermLevel;
  puedeEscribir: boolean;
  esFull: boolean;
  /** Quedó algo escrito en el formulario y sin guardar. */
  sinGuardar: boolean;
  editar: (m: Movimiento) => void;
  cancelar: () => void;
  guardar: () => Promise<void>;
  borrar: (m: Movimiento) => Promise<void>;
};

/** Anotar, editar y borrar con los cuidados de ✍️ Cargar (ver la cabecera). */
function useSeccion<F>({ sitio, nivel, fecha, datos, nuevo, desde, validar, alSinGuardar }: OpSeccion<F>): Seccion<F> {
  const toast = useToast();
  const confirm = useConfirm();
  const puedeEscribir = levelMeets(nivel, 'escritura');
  const esFull = nivel === 'full';

  const [form, setForm] = useState<F>(() => nuevo());
  const [editando, setEditandoEstado] = useState<Movimiento | null>(null);
  const editandoRef = useRef<Movimiento | null>(null);
  const setEditando = (m: Movimiento | null) => { editandoRef.current = m; setEditandoEstado(m); };
  const [guardando, setGuardando] = useState(false);
  /** El candado de verdad contra el doble toque (el estado tarda un render en llegar). */
  const enVuelo = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  // Otro sitio: todo en blanco (la unidad o el destino elegidos eran de otro sitio).
  const sitioPrevio = useRef(sitio.id);
  useEffect(() => {
    if (sitioPrevio.current === sitio.id) return;
    sitioPrevio.current = sitio.id;
    setEditando(null);
    setForm(nuevo());
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio.id]);
  // Otro día con una salida a medio editar (lote 5 B8): la salida NO se muda de día (se
  // guarda en el suyo). Sin cambios, la edición se cierra (no hay nada que perder); con
  // cambios, se pregunta: descartarlos o seguir editando. Lo que se estaba escribiendo
  // como NUEVO se queda: se anota en el día elegido arriba.
  const fechaPrevia = useRef(fecha);
  useEffect(() => {
    if (fechaPrevia.current === fecha) return;
    fechaPrevia.current = fecha;
    const ed = editandoRef.current;
    if (!ed || enVuelo.current) return;
    const cerrar = () => {
      if (!vivo.current || enVuelo.current || editandoRef.current?.id !== ed.id) return;
      setEditando(null);
      setForm(nuevo());
      setError(null);
    };
    if (mismoFormulario(form, desde(ed))) { cerrar(); return; }
    confirm({
      title: 'Salida a medio editar',
      message: `Cambiaste de día con la salida del ${dmy(ed.fecha)} a medio editar. Si sigues editándola, se guarda en su día (${dmy(ed.fecha)}). ¿Descartar los cambios?`,
      confirmText: 'Descartar cambios',
      cancelText: 'Seguir editando',
      danger: true,
    }).then((descartar) => { if (descartar) cerrar(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  // ¿Quedó algo escrito sin guardar? (el encabezado plegado del Parte diario lo dice)
  const sinGuardar = !mismoFormulario(form, editando ? desde(editando) : nuevo());
  useEffect(() => { alSinGuardar?.(sinGuardar); }, [sinGuardar, alSinGuardar]);

  const cambiar = (c: Partial<F>) => setForm((f) => ({ ...f, ...c }));

  const guardar = async () => {
    if (enVuelo.current || !puedeEscribir) return;
    if (!datos.listasCargadas) {
      // Sin listas el factor sería 1,2 y los km nada: no se guarda una cifra equivocada (B6).
      setError(SIN_LISTAS);
      toast.error(SIN_LISTAS);
      return;
    }
    // ⭐ Todo se fija AHORA: lo que pase en pantalla mientras viaja no cambia qué se guarda.
    const f = form;
    const ed = editandoRef.current;
    const sitioId = sitio.id;
    const { errores, datos: d } = validar(f, fecha, datos.listas, ed);
    if (errores.length) {
      setError(errores.join('\n'));
      toast.error(errores[0]);
      return;
    }
    enVuelo.current = true;
    setGuardando(true);
    setError(null);
    try {
      await guardarMovimiento(ed ? { ...d, id: ed.id } : { ...d, sitioId });
    } catch (e: any) {
      enVuelo.current = false;
      if (!vivo.current) return;
      const msg = e?.message || NO_SE_GUARDO;
      setGuardando(false);
      setError(`${msg} Lo escrito sigue en el formulario.`);
      toast.error(msg);
      // Puede que la base SÍ lo haya guardado y se perdiera solo la respuesta: que la
      // lista lo muestre, para no anotarlo doble.
      datos.recargar();
      return;
    }
    enVuelo.current = false;
    if (!vivo.current) return;
    setGuardando(false);
    toast.success(ed ? 'Cambios guardados.' : 'Salida anotada.');
    setEditando(null);
    setForm(nuevo());
    datos.recargar();
  };

  const editar = (m: Movimiento) => {
    if (enVuelo.current || !puedeEscribir || !editableEnParteDiario(m)) return;
    if (editandoRef.current?.id === m.id) return;
    const abrir = () => {
      if (enVuelo.current || !vivo.current) return;
      setEditando(m);
      setError(null);
      setForm(desde(m));
    };
    // B-M2: con algo escrito sin guardar, ✏️ no lo tira sin preguntar.
    if (!sinGuardar) { abrir(); return; }
    const ed = editandoRef.current;
    confirm({
      title: 'Hay algo escrito sin guardar',
      message: ed
        ? `La salida del ${dmy(ed.fecha)} que estás editando tiene cambios sin guardar. ¿Descartarlos y editar esta otra?`
        : 'Lo que escribiste para una salida nueva todavía no se anotó. ¿Descartarlo y editar esta salida?',
      confirmText: 'Descartar',
      cancelText: 'Seguir escribiendo',
      danger: true,
    }).then((descartar) => { if (descartar) abrir(); });
  };

  const cancelar = () => {
    if (enVuelo.current) return;
    setEditando(null);
    setError(null);
    setForm(nuevo());
  };

  const borrar = async (m: Movimiento) => {
    if (enVuelo.current || nivel !== 'full') return;
    const l = lineasSalida(m);
    const ok = await confirm({
      title: 'Borrar salida',
      message: `¿Borrar la salida de ${l.titulo} del ${dmy(m.fecha)}${l.cifras ? ` (${l.cifras})` : ''}? No se puede deshacer.`,
      confirmText: 'Borrar',
      danger: true,
    });
    if (!ok || enVuelo.current) return;
    try {
      await borrarMovimiento(m.id);
      if (!vivo.current) return;
      toast.success('Salida borrada.');
      if (editandoRef.current?.id === m.id) { setEditando(null); setForm(nuevo()); setError(null); }
    } catch (e: any) {
      if (!vivo.current) return;
      toast.error(e?.message || 'No se borró la salida.');
    } finally {
      // Si ya no existía, que la lista lo diga (si no, el renglón fantasma sigue ahí).
      if (vivo.current) datos.recargar();
    }
  };

  return { form, setForm, cambiar, editando, guardando, error, nivel, puedeEscribir, esFull, sinGuardar, editar, cancelar, guardar, borrar };
}

// ═══════════════════════════ Piezas de pantalla ═══════════════════════════

function useEstilos() {
  const { colors } = useTheme();
  return useMemo(() => ({
    colors,
    input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: 4 } as const,
    etiqueta: { color: colors.muted, fontSize: 11, fontWeight: '800' as const, marginTop: spacing.xs },
    ayuda: { color: colors.muted, fontSize: 11, marginTop: 2 } as const,
    pastilla: (on: boolean) => ({
      paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1,
      borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface,
    }),
    textoPastilla: (on: boolean) => ({ color: on ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 }),
  }), [colors]);
}

/** Una fila de pastillas (una sola elegida). */
function Pastillas<T extends string>({ opciones, valor, onChange }: {
  opciones: { key: T; label: string }[];
  valor: T | null;
  onChange: (v: T) => void;
}) {
  const e = useEstilos();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
      {opciones.map((o) => {
        const on = valor === o.key;
        return (
          <TouchableOpacity key={o.key} onPress={() => onChange(o.key)} style={e.pastilla(on)}>
            <Text style={e.textoPastilla(on)}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** El encabezado del formulario: el título (fuera del Parte diario) o «Editando…» con Cancelar. */
function Encabezado<F>({ titulo, s, incrustado }: { titulo: string; s: Seccion<F>; incrustado?: boolean }) {
  const { colors } = useTheme();
  if (!s.editando) {
    // Dentro del Parte diario el título ya está en el encabezado del bloque (B18).
    return incrustado ? null : <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>{titulo}</Text>;
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, flex: 1 }}>✏️ Editando la salida del {dmy(s.editando.fecha)}</Text>
      <TouchableOpacity onPress={s.cancelar} disabled={s.guardando}
        style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cancelar</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Viajes y observación (los tres bloques los llevan igual). */
function ViajesYObservacion({ viajes, observacion, onChange }: {
  viajes: string;
  observacion: string;
  onChange: (c: { viajes?: string; observacion?: string }) => void;
}) {
  const e = useEstilos();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      <View style={{ width: 110 }}>
        <Text style={e.etiqueta}>VIAJES</Text>
        <TextInput value={viajes} onChangeText={(v) => onChange({ viajes: v })} keyboardType="number-pad" placeholder="1" placeholderTextColor={e.colors.muted} style={e.input} />
      </View>
      <View style={{ flex: 1, minWidth: 180 }}>
        <Text style={e.etiqueta}>OBSERVACIÓN</Text>
        <TextInput value={observacion} onChangeText={(v) => onChange({ observacion: v })} placeholder="Opcional" placeholderTextColor={e.colors.muted} style={e.input} />
      </View>
    </View>
  );
}

/** El error que quedó, el botón de guardar y en qué jornada se anota (solo Escritura/Full). */
function PieGuardar<F>({ s, fecha }: { s: Seccion<F>; fecha: string }) {
  const { colors } = useTheme();
  return (
    <>
      {s.error ? (
        <View style={{ backgroundColor: colors.dangerSoftBg, borderColor: colors.dangerSoftBorder, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.xs }}>
          <Text style={{ color: colors.dangerSoftText, fontSize: 12, fontWeight: '700' }}>⚠️ {s.error}</Text>
        </View>
      ) : null}
      <TouchableOpacity onPress={s.guardar} disabled={s.guardando}
        style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm, opacity: s.guardando ? 0.6 : 1 }}>
        <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>{s.guardando ? 'Guardando…' : s.editando ? '💾 Guardar cambios' : '💾 Anotar salida'}</Text>
      </TouchableOpacity>
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
        {s.editando ? `Sigue en la jornada del ${dmy(s.editando.fecha)}.` : `Se anota en la jornada del ${dmy(fecha)}.`}
      </Text>
    </>
  );
}

/** Una salida en la lista: material, cifras, destino, vehículo y su estado si no está confirmada. */
function FilaSalida({ m, mostrarFecha, onEditar, onBorrar, nota, children }: {
  m: Movimiento;
  mostrarFecha?: boolean;
  onEditar?: () => void;
  onBorrar?: () => void;
  /** Una línea chica debajo (p. ej. «se corrige en ✍️ Carga libre»). */
  nota?: string;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const l = lineasSalida(m);
  return (
    <View style={{ paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{mostrarFecha ? `${dmy(m.fecha)} · ` : ''}{l.titulo}</Text>
          {l.cifras ? <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>{l.cifras}</Text> : null}
          {l.estado ? <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '800' }}>{l.estado}</Text> : null}
          {l.destino ? <Text style={{ color: colors.text, fontSize: 12 }}>📍 {l.destino}</Text> : null}
          {l.vehiculo ? <Text style={{ color: colors.text, fontSize: 12 }}>{l.vehiculo}</Text> : null}
          {m.observacion ? <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>📝 {m.observacion}</Text> : null}
          {nota ? <Text style={{ color: colors.muted, fontSize: 11 }}>{nota}</Text> : null}
        </View>
        {onEditar ? (
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
      {children}
    </View>
  );
}

/** Las salidas de ESE día de un bloque, con ✏️ (Escritura; no en lo de ✍️ Carga libre) y 🗑️ (solo Full). */
function ListaDelDia<F>({ titulo, clase, fecha, datos, s }: {
  titulo: string;
  clase: ClaseSalida;
  fecha: string;
  datos: DatosSalidas;
  s: Seccion<F>;
}) {
  const { colors } = useTheme();
  const filas = useMemo(() => salidasDeClase(datos.delDia, clase), [datos.delDia, clase]);
  return (
    <View style={{ marginTop: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13, flex: 1 }}>📋 {titulo} del {dmy(fecha)}</Text>
        <TouchableOpacity onPress={datos.recargar}>
          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>🔄 Actualizar</Text>
        </TouchableOpacity>
      </View>
      {datos.cargando && !filas.length ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando…</Text>
      ) : filas.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>{datos.errorDatos && !datos.listasCargadas ? 'No se sabe todavía (la carga falló).' : 'Todavía no hay ninguna ese día.'}</Text>
      ) : (
        // Mientras se guarda, ✏️ y 🗑️ se apagan: el guardado no puede caer en otro renglón.
        // Lo de ✍️ Carga libre se ve, pero ✏️ se apaga: se corrige allá (B4, R1).
        filas.map((m) => (
          <FilaSalida
            key={m.id}
            m={m}
            onEditar={!s.guardando && s.puedeEscribir && editableEnParteDiario(m) ? () => s.editar(m) : undefined}
            onBorrar={!s.guardando && s.esFull ? () => s.borrar(m) : undefined}
            nota={s.puedeEscribir && !editableEnParteDiario(m) ? '✍️ Anotada en Carga libre: se corrige en ✍️ Carga libre.' : undefined}
          />
        ))
      )}
    </View>
  );
}

/** Elegir una unidad de NUESTRA flota (las activas; con muchas, se busca). */
function SelectorUnidad({ unidadId, unidades, grupos, cargada, nivel, onElegir, onSoltar }: {
  unidadId: string | null;
  unidades: Unidad[];
  /** M8: el estado EFECTIVO de cada unidad (sin él, solo las del sitio o marcadas 🔧). */
  grupos?: Record<string, GrupoSitio> | null;
  /** ¿La flota cargó? (si no, no se dice «vacía», B6) */
  cargada: boolean;
  /** Quien no tiene Full no llena la flota: se le dice que lo pida (B-M5). */
  nivel: PermLevel;
  onElegir: (u: Unidad) => void;
  onSoltar: () => void;
}) {
  const e = useEstilos();
  const [buscar, setBuscar] = useState('');
  const activas = useMemo(() => unidades.filter((u) => u.activo).sort((a, b) => cmpText(textoDeUnidad(a), textoDeUnidad(b))), [unidades]);
  const elegida = unidadId ? unidades.find((u) => u.id === unidadId) ?? null : null;
  const visibles = useMemo(() => {
    const q = norm(buscar.trim());
    const lista = q ? activas.filter((u) => norm([u.codigo, u.descripcion, u.placa, u.chofer].join(' ')).includes(q)) : activas;
    return { mostradas: lista.slice(0, MAX_FLOTA), resto: Math.max(0, lista.length - MAX_FLOTA) };
  }, [activas, buscar]);

  if (unidadId) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 }}>
        <Text style={{ color: e.colors.success, fontSize: 12, fontWeight: '800', flex: 1 }}>
          🔗 {elegida ? `${textoDeUnidad(elegida)}${elegida.placa ? ` · ${elegida.placa}` : ''}${averiadaEnSalidas(elegida, grupos) ? ' · 🔧 averiada' : ''}` : 'Unidad de la flota'}
        </Text>
        <TouchableOpacity onPress={onSoltar}>
          <Text style={{ color: e.colors.primary, fontSize: 11, fontWeight: '700' }}>Cambiar</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (activas.length === 0) {
    return (
      <Text style={e.ayuda}>
        {cargada
          ? `La flota del sitio está vacía: escribe la placa abajo. Las unidades se agregan en 🚛 Flota.${pideloAQuienAdministra(nivel)}`
          : 'La flota no cargó todavía: toca 🔄 Actualizar.'}
      </Text>
    );
  }
  return (
    <View style={{ marginTop: 4 }}>
      {activas.length > MAX_FLOTA ? (
        <TextInput value={buscar} onChangeText={setBuscar} placeholder="Buscar por código, placa o chofer" placeholderTextColor={e.colors.muted} style={e.input} />
      ) : null}
      <Text style={e.ayuda}>{visibles.mostradas.length ? 'Toca la unidad que salió (o escribe su placa abajo):' : 'Ninguna unidad coincide.'}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
        {visibles.mostradas.map((u) => (
          <TouchableOpacity key={u.id} onPress={() => onElegir(u)} style={e.pastilla(false)}>
            <Text style={e.textoPastilla(false)}>
              🚛 {textoDeUnidad(u)}{u.placa && norm(u.placa) !== norm(textoDeUnidad(u)) ? ` · ${u.placa}` : ''}{averiadaEnSalidas(u, grupos) ? ' 🔧' : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {visibles.resto > 0 ? <Text style={e.ayuda}>+{visibles.resto} más: búscala por su código o placa.</Text> : null}
    </View>
  );
}

/**
 * Nuestra unidad: elegirla de la flota o escribir su placa (lote 5 B3: la placa de una
 * unidad activa la vincula y trae el chofer; corregirla la suelta). El chofer se puede corregir.
 */
function VehiculoNuestro<F extends { unidadId: string | null; unidadTexto: string; placa: string; chofer: string; vehiculo: FormAgregado['vehiculo'] }>({ s, datos, grupos }: {
  s: Seccion<F>;
  datos: DatosSalidas;
  grupos?: Record<string, GrupoSitio> | null;
}) {
  const e = useEstilos();
  return (
    <>
      <SelectorUnidad
        unidadId={s.form.unidadId}
        unidades={datos.unidades}
        grupos={grupos}
        cargada={datos.listasCargadas}
        nivel={s.nivel}
        onElegir={(u) => s.setForm((f) => elegirUnidadSalida(f, u, datos.unidades))}
        onSoltar={() => s.setForm((f) => soltarUnidadSalida(f, datos.unidades))}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 120 }}>
          <Text style={e.etiqueta}>PLACA</Text>
          <TextInput value={s.form.placa} onChangeText={(v) => s.setForm((f) => escribirPlacaSalida(f, v, datos.unidades))} placeholder="Placa" placeholderTextColor={e.colors.muted} autoCapitalize="characters" style={e.input} />
        </View>
        <View style={{ flex: 1, minWidth: 150 }}>
          <Text style={e.etiqueta}>CHOFER</Text>
          <TextInput value={s.form.chofer} onChangeText={(v) => s.cambiar({ chofer: v } as Partial<F>)} placeholder="Sale de la unidad (se puede corregir)" placeholderTextColor={e.colors.muted} style={e.input} />
        </View>
      </View>
    </>
  );
}

/** Debajo del destino: sus km (los que se congelan en la salida). */
function AyudaKm({ destino, datos, editando, nivel }: { destino: ValorLista; datos: DatosSalidas; editando: Movimiento | null; nivel: PermLevel }) {
  const e = useEstilos();
  if (!destino.texto.trim()) return null;
  if (!datos.listasCargadas) return <Text style={e.ayuda}>📍 La lista de destinos no cargó: todavía no se saben sus km.</Text>;
  const km = kmCongelado(destino, datos.listas, editando);
  return (
    <Text style={e.ayuda}>
      {km !== null
        ? `📍 ${fmt(km, 1)} km desde el sitio (quedan guardados en la salida).`
        : `📍 Ese destino no tiene km en la lista: la salida queda sin km. Los km se ponen en ⚙️ Ajustes.${pideloAQuienAdministra(nivel)}`}
    </Text>
  );
}

/** El error de carga, con «🔄 Reintentar» (lote 5 B12). */
function AvisoDatos({ datos }: { datos: DatosSalidas }) {
  const { colors } = useTheme();
  if (!datos.errorDatos) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
      <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', flex: 1, minWidth: 180 }}>
        ⚠️ {datos.errorDatos} — toca Reintentar (o desliza hacia abajo en el teléfono).
        {!datos.listasCargadas ? ' Mientras no carguen la flota y las listas no se puede anotar.' : ''}
      </Text>
      <TouchableOpacity onPress={datos.recargar} disabled={datos.cargando}
        style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger, opacity: datos.cargando ? 0.5 : 1 }}>
        <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>{datos.cargando ? 'Cargando…' : '🔄 Reintentar'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ═══════════════════════════ 🪨 AGREGADOS ═══════════════════════════

export function SalidasAgregados({ sitio, nivel, fecha, datos, incrustado, alSinGuardar, gruposUnidades }: PropsSeccion) {
  const e = useEstilos();
  const s = useSeccion<FormAgregado>({ sitio, nivel, fecha, datos, nuevo: formAgregadoNuevo, desde: formAgregadoDesde, validar: validarAgregado, alSinGuardar });
  const { listas } = datos;
  const sugMaterial = useMemo(() => materialesPara(listas, 'agregados'), [listas]);
  const sugDestino = useMemo(() => sugerenciasDeLista(listas, ['destino']), [listas]);
  const sugEmpresa = useMemo(() => sugerenciasDeLista(listas, ['transportista']), [listas]);
  const items = (clase: ItemLista['clase']) => listas.filter((i) => i.clase === clase);
  // El factor de la salida que se edita (t ÷ m³ guardados) mientras no cambien material, cifra ni unidad.
  const factor = factorDelFormulario(s.form, listas);
  const enVivo = textoEnVivoAgregado(s.form, listas);
  const cifra = cifraDeCampo(s.form.cantidad, { mayorQueCero: true });
  const c = cantidadesAgregado(s.form, listas);
  const daCero = !cifra.error && (cifra.valor ?? 0) > 0 && (c.m3 === 0 || c.t === 0);
  const aviso = avisoKg(s.form.cantidad, s.form.unidad);
  const Caja = incrustado ? View : Card;

  return (
    <Caja style={{ gap: spacing.xs }}>
      <AvisoDatos datos={datos} />
      {s.puedeEscribir ? (
        <>
          <Encabezado titulo="🪨 Salida de agregados" s={s} incrustado={incrustado} />
          <CampoSugerido etiqueta="Material" valor={s.form.material} onChange={(v) => s.cambiar({ material: v })}
            sugerencias={sugMaterial} items={items('material')} placeholder="Triturado, arrocillo, polvillo…" />
          {s.form.material.texto.trim() ? (
            <Text style={e.ayuda}>
              {!datos.listasCargadas
                ? 'La lista de materiales no cargó: todavía no se sabe su factor.'
                : factor.guardado ? `Factor ${fmt(factor.factor, 3)} t por m³ (el guardado en esta salida; si cambias el material, la cifra o la unidad, se usa el de ahora).`
                  : factor.deLista ? `Factor ${fmt(factor.factor, 3)} t por m³ (de la lista).` : `Sin factor en la lista: se usa ${fmt(factor.factor, 3)} t por m³.`}
            </Text>
          ) : null}

          <Text style={e.etiqueta}>CANTIDAD</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
            <TextInput value={s.form.cantidad} onChangeText={(v) => s.cambiar({ cantidad: v })} keyboardType="decimal-pad" placeholder="0,00"
              placeholderTextColor={e.colors.muted} style={[e.input, { flex: 1, minWidth: 120 }]} />
            <Pastillas opciones={UNIDADES_AGREGADOS} valor={s.form.unidad} onChange={(u) => s.cambiar({ unidad: u })} />
          </View>
          <Text style={{ fontSize: 12, marginTop: 2, fontWeight: '800', color: cifra.error || daCero ? e.colors.danger : enVivo ? e.colors.success : e.colors.muted }}>
            {cifra.error
              ? `⚠️ ${cifra.error}`
              : daCero ? `⚠️ = ${enVivo}: la cantidad convertida da 0 (revisa la cifra y la unidad).`
                : enVivo ? `= ${enVivo}` : 'Escribe la cifra en m³, t o kg: el sistema saca las otras dos.'}
          </Text>
          {aviso ? <Text style={{ fontSize: 12, fontWeight: '800', color: e.colors.warning }}>{aviso}</Text> : null}

          <CampoSugerido etiqueta="Destino" valor={s.form.destino} onChange={(v) => s.cambiar({ destino: v })}
            sugerencias={sugDestino} items={items('destino')} placeholder="Cantera, obra, planta…" />
          <AyudaKm destino={s.form.destino} datos={datos} editando={s.editando} nivel={nivel} />

          <Text style={e.etiqueta}>VEHÍCULO</Text>
          <Pastillas opciones={[{ key: 'propio', label: '🚛 Nuestro' }, { key: 'externo', label: '🏢 Externo' }]}
            valor={s.form.vehiculo} onChange={(v) => s.cambiar({ vehiculo: v })} />
          {s.form.vehiculo === 'propio' ? (
            <VehiculoNuestro s={s} datos={datos} grupos={gruposUnidades} />
          ) : (
            <CampoSugerido etiqueta="Compañía" valor={s.form.empresa} onChange={(v) => s.cambiar({ empresa: v })}
              sugerencias={sugEmpresa} items={items('transportista')} placeholder="Nombre de la compañía" />
          )}

          <ViajesYObservacion viajes={s.form.viajes} observacion={s.form.observacion} onChange={(c2) => s.cambiar(c2)} />
          <PieGuardar s={s} fecha={fecha} />
        </>
      ) : null}
      <ListaDelDia titulo="Salidas de agregados" clase="agregados" fecha={fecha} datos={datos} s={s} />
    </Caja>
  );
}

// ═══════════════════════════ 🔩 ACERO ═══════════════════════════

/** «Pendientes de pesaje»: acero de cualquier fecha sin toneladas, con «Completar toneladas». */
function PendientesPesaje({ sitio, datos, s, alEscribir }: {
  sitio: Sitio;
  datos: DatosSalidas;
  s: Seccion<FormAcero>;
  /** B-M7: avisa si hay toneladas escritas y sin completar (cuentan como «✏️ sin guardar»). */
  alEscribir?: (hay: boolean) => void;
}) {
  const e = useEstilos();
  const toast = useToast();
  const lista = useMemo(() => pendientesDePesaje(datos.pendientes, sitio.id), [datos.pendientes, sitio.id]);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [completando, setCompletando] = useState<string | null>(null);
  const enVuelo = useRef(false);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => { setTextos({}); }, [sitio.id]);
  // Solo lo escrito en las que SIGUEN pendientes (una completada en otro equipo ya no cuenta).
  const hayEscrito = lista.some((m) => (textos[m.id] ?? '').trim() !== '');
  useEffect(() => { alEscribir?.(hayEscrito); }, [hayEscrito, alEscribir]);

  const completar = async (m: Movimiento) => {
    if (enVuelo.current || !s.puedeEscribir) return;
    const { error, cambio } = completarPesaje(m, textos[m.id] ?? '');
    if (error || !cambio) { toast.error(error || 'No se pudo completar.'); return; }
    enVuelo.current = true;
    setCompletando(m.id);
    try {
      await guardarMovimiento(cambio);
      if (!vivo.current) return;
      toast.success('Toneladas completadas: la salida quedó confirmada.');
      setTextos((t) => { const { [m.id]: _fuera, ...resto } = t; return resto; });
    } catch (err: any) {
      if (!vivo.current) return;
      // Lo escrito se queda en su campo para volver a intentarlo.
      toast.error(err?.message || NO_SE_GUARDO);
    } finally {
      enVuelo.current = false;
      if (vivo.current) { setCompletando(null); datos.recargar(); }
    }
  };

  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={{ color: e.colors.text, fontWeight: '900', fontSize: 13 }}>⚖️ Pendientes de pesaje ({lista.length})</Text>
      <Text style={e.ayuda}>Acero de cualquier día que espera la nota de entrega. Al completar las toneladas, la salida queda confirmada.</Text>
      {lista.length === 0 ? (
        <Text style={{ color: e.colors.muted, fontSize: 12, marginTop: 2 }}>
          {datos.cargando ? 'Cargando…' : datos.errorDatos && !datos.listasCargadas ? 'No se sabe todavía (la carga falló).' : 'Ninguna: todo el acero tiene sus toneladas.'}
        </Text>
      ) : lista.map((m) => {
        const editandoEsta = s.editando?.id === m.id;
        const t = cifraDeCampo(textos[m.id] ?? '', { mayorQueCero: true });
        return (
          <FilaSalida key={m.id} m={m} mostrarFecha>
            {!s.puedeEscribir ? null : editandoEsta ? (
              <Text style={e.ayuda}>✏️ Se está editando arriba: guarda o cancela antes de completar sus toneladas.</Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', marginTop: 4 }}>
                <TextInput
                  value={textos[m.id] ?? ''}
                  onChangeText={(v) => setTextos((x) => ({ ...x, [m.id]: v }))}
                  keyboardType="decimal-pad"
                  placeholder="Toneladas de la nota"
                  placeholderTextColor={e.colors.muted}
                  style={[e.input, { flex: 1, minWidth: 140, marginTop: 0 }]}
                />
                <TouchableOpacity onPress={() => completar(m)} disabled={completando !== null}
                  style={{ backgroundColor: e.colors.accent, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, opacity: completando !== null ? 0.6 : 1 }}>
                  <Text style={{ color: e.colors.accentContrast, fontWeight: '800', fontSize: 12 }}>{completando === m.id ? 'Guardando…' : '✅ Completar toneladas'}</Text>
                </TouchableOpacity>
                {t.error ? <Text style={{ color: e.colors.danger, fontSize: 11, fontWeight: '700', width: '100%' }}>⚠️ {t.error}</Text> : null}
              </View>
            )}
          </FilaSalida>
        );
      })}
    </View>
  );
}

export function SalidasAcero({ sitio, nivel, fecha, datos, incrustado, alSinGuardar, gruposUnidades }: PropsSeccion) {
  const e = useEstilos();
  // El aviso «sin guardar» de acero junta el formulario y las toneladas de «Pendientes de pesaje» (B-M7).
  const s = useSeccion<FormAcero>({ sitio, nivel, fecha, datos, nuevo: formAceroNuevo, desde: formAceroDesde, validar: validarAcero });
  const [pendientesSinGuardar, setPendientesSinGuardar] = useState(false);
  const sinGuardarAcero = s.sinGuardar || pendientesSinGuardar;
  useEffect(() => { alSinGuardar?.(sinGuardarAcero); }, [sinGuardarAcero, alSinGuardar]);
  const { listas } = datos;
  // B19: las empresas que se llevan el acero salen de la LISTA del sitio (las que ya se lo
  // llevaron primero), nunca de un nombre fijo en el código.
  const usados = useMemo(() => [...datos.pendientes, ...datos.delDia]
    .filter((m) => claseDeSalida(m) === 'acero' && !!m.transportista)
    .map((m) => m.transportista as string), [datos.pendientes, datos.delDia]);
  const rapidas = useMemo(() => pastillasQuienAcero(listas, sitio.id, usados), [listas, sitio.id, usados]);
  const sugQuien = useMemo(() => sugerenciasDeLista(listas, ['transportista'], [NOSOTROS]), [listas]);
  const nuestro = esNosotros(s.form.quien.texto);
  const elegirQuien = (texto: string) => {
    const item = listas.find((i) => i.activo && i.clase === 'transportista' && norm(i.nombre.trim()) === norm(texto.trim())) ?? null;
    s.setForm((f) => elegirQuienAcero(f, { texto, listaId: item?.id ?? null }));
  };
  const elegidaRapida = rapidas.find((n) => norm(n) === norm(s.form.quien.texto.trim())) ?? null;
  const Caja = incrustado ? View : Card;

  return (
    <Caja style={{ gap: spacing.xs }}>
      <AvisoDatos datos={datos} />
      {s.puedeEscribir ? (
        <>
          <Encabezado titulo="🔩 Salida de acero" s={s} incrustado={incrustado} />
          <Text style={e.etiqueta}>QUIÉN SE LO LLEVA</Text>
          <Pastillas
            opciones={[...rapidas.map((n) => ({ key: n, label: `🏢 ${n}` })), { key: NOSOTROS, label: `🚛 ${NOSOTROS}` }]}
            valor={nuestro ? NOSOTROS : elegidaRapida}
            onChange={elegirQuien}
          />
          {datos.listasCargadas && rapidas.length === 0 ? (
            <Text style={e.ayuda}>Las empresas de la lista de transportistas del sitio salen aquí como botón. Se agregan en ⚙️ Ajustes → 📚 Listas.{pideloAQuienAdministra(nivel)}</Text>
          ) : null}
          <CampoSugerido etiqueta="U otra empresa" valor={s.form.quien}
            onChange={(v) => s.setForm((f) => elegirQuienAcero(f, v))}
            sugerencias={sugQuien} items={listas.filter((i) => i.clase === 'transportista')} placeholder="Quién se lo lleva" />

          {nuestro ? (
            <>
              <Text style={e.etiqueta}>NUESTRA UNIDAD</Text>
              <VehiculoNuestro s={s} datos={datos} grupos={gruposUnidades} />
            </>
          ) : (
            <>
              <Text style={e.etiqueta}>CAMIÓN</Text>
              <TextInput value={s.form.unidadTexto} onChangeText={(v) => s.cambiar({ unidadTexto: v })} placeholder="Placa o cómo se llama el camión"
                placeholderTextColor={e.colors.muted} style={e.input} />
            </>
          )}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 130 }}>
              <Text style={e.etiqueta}>m³ AL SALIR</Text>
              <TextInput value={s.form.m3} onChangeText={(v) => s.cambiar({ m3: v })} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={e.colors.muted} style={e.input} />
            </View>
            {s.editando ? (
              <View style={{ flex: 1, minWidth: 130 }}>
                <Text style={e.etiqueta}>TONELADAS (NOTA DE ENTREGA)</Text>
                <TextInput value={s.form.toneladas} onChangeText={(v) => s.cambiar({ toneladas: v })} keyboardType="decimal-pad" placeholder="Vacío = pendiente" placeholderTextColor={e.colors.muted} style={e.input} />
              </View>
            ) : null}
          </View>
          <Text style={e.ayuda}>
            {s.editando ? 'Con toneladas queda confirmada; sin ellas sigue esperando la nota de entrega.' : '⚖️ Sale «esperando pesaje» y sin toneladas: se completan abajo cuando llegue la nota de entrega.'}
          </Text>

          <ViajesYObservacion viajes={s.form.viajes} observacion={s.form.observacion} onChange={(c2) => s.cambiar(c2)} />
          <PieGuardar s={s} fecha={fecha} />
        </>
      ) : null}
      <ListaDelDia titulo="Salidas de acero" clase="acero" fecha={fecha} datos={datos} s={s} />
      <PendientesPesaje sitio={sitio} datos={datos} s={s} alEscribir={setPendientesSinGuardar} />
    </Caja>
  );
}

// ═══════════════════════════ ♻️ ALUMINIO Y PLÁSTICO ═══════════════════════════

export function SalidasAluminioPlastico({ sitio, nivel, fecha, datos, incrustado, alSinGuardar }: PropsSeccion) {
  const e = useEstilos();
  const s = useSeccion<FormAluminio>({ sitio, nivel, fecha, datos, nuevo: formAluminioNuevo, desde: formAluminioDesde, validar: validarAluminio, alSinGuardar });
  const { listas } = datos;
  const items = (clase: ItemLista['clase']) => listas.filter((i) => i.clase === clase);
  const sugMaterial = useMemo(() => materialesPara(listas, 'aluminioPlastico'), [listas]);
  const sugEmpresa = useMemo(() => sugerenciasDeLista(listas, ['transportista'], [NOSOTROS]), [listas]);
  const sugDestino = useMemo(() => sugerenciasDeLista(listas, ['destino']), [listas]);
  const fijarMaterial = (texto: string) => s.cambiar({ material: { texto, listaId: items('material').find((i) => i.activo && norm(i.nombre.trim()) === norm(texto))?.id ?? null } });
  const t = toneladasAluminio(s.form);
  const cifra = cifraDeCampo(s.form.cantidad, { mayorQueCero: true });
  const daCero = !cifra.error && (cifra.valor ?? 0) > 0 && t === 0;
  const aviso = avisoKg(s.form.cantidad, s.form.unidad);
  const materialPastilla = norm(s.form.material.texto.trim());
  const Caja = incrustado ? View : Card;

  return (
    <Caja style={{ gap: spacing.xs }}>
      <AvisoDatos datos={datos} />
      {s.puedeEscribir ? (
        <>
          <Encabezado titulo="♻️ Salida de aluminio y plástico" s={s} incrustado={incrustado} />
          <Text style={e.etiqueta}>MATERIAL</Text>
          <Pastillas
            opciones={[{ key: MATERIAL_ALUMINIO, label: MATERIAL_ALUMINIO }, { key: MATERIAL_PLASTICO, label: MATERIAL_PLASTICO }]}
            valor={materialPastilla === norm(MATERIAL_ALUMINIO) ? MATERIAL_ALUMINIO : materialPastilla === norm(MATERIAL_PLASTICO) ? MATERIAL_PLASTICO : null}
            onChange={fijarMaterial}
          />
          <CampoSugerido etiqueta="U otro de la lista" valor={s.form.material} onChange={(v) => s.cambiar({ material: v })}
            sugerencias={sugMaterial} items={items('material')} placeholder="Material" />

          <Text style={e.etiqueta}>CANTIDAD</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
            <TextInput value={s.form.cantidad} onChangeText={(v) => s.cambiar({ cantidad: v })} keyboardType="decimal-pad" placeholder="0,00"
              placeholderTextColor={e.colors.muted} style={[e.input, { flex: 1, minWidth: 120 }]} />
            <Pastillas opciones={[{ key: 't' as const, label: 't' }, { key: 'kg' as const, label: 'kg' }]} valor={s.form.unidad} onChange={(u) => s.cambiar({ unidad: u })} />
          </View>
          <Text style={{ fontSize: 12, marginTop: 2, fontWeight: '800', color: cifra.error || daCero ? e.colors.danger : t !== null ? e.colors.success : e.colors.muted }}>
            {cifra.error
              ? `⚠️ ${cifra.error}`
              : daCero ? '⚠️ = 0 t: la cantidad convertida da 0 (revisa la cifra y la unidad).'
                : t !== null ? `= ${fmt(t, 3)} t` : 'En toneladas o en kg (los kg se pasan a toneladas).'}
          </Text>
          {aviso ? <Text style={{ fontSize: 12, fontWeight: '800', color: e.colors.warning }}>{aviso}</Text> : null}

          <Text style={e.etiqueta}>EMPRESA</Text>
          <Pastillas opciones={[{ key: NOSOTROS, label: `🚛 ${NOSOTROS}` }]} valor={esNosotros(s.form.empresa.texto) ? NOSOTROS : null}
            onChange={() => s.cambiar({ empresa: { texto: NOSOTROS, listaId: null } })} />
          <CampoSugerido etiqueta="U otra empresa" valor={s.form.empresa} onChange={(v) => s.cambiar({ empresa: v })}
            sugerencias={sugEmpresa} items={items('transportista')} placeholder="Empresa compradora o que se lo lleva" />

          <CampoSugerido etiqueta="Destino (opcional)" valor={s.form.destino} onChange={(v) => s.cambiar({ destino: v })}
            sugerencias={sugDestino} items={items('destino')} placeholder="A dónde va" />
          <AyudaKm destino={s.form.destino} datos={datos} editando={s.editando} nivel={nivel} />

          <ViajesYObservacion viajes={s.form.viajes} observacion={s.form.observacion} onChange={(c2) => s.cambiar(c2)} />
          <PieGuardar s={s} fecha={fecha} />
        </>
      ) : null}
      <ListaDelDia titulo="Salidas de aluminio y plástico" clase="aluminioPlastico" fecha={fecha} datos={datos} s={s} />
    </Caja>
  );
}

// ═══════════════════════════ Los bloques sueltos (cada uno con su carga) ═══════════════════════════

/** Las tres salidas (agregados, acero, aluminio y plástico) con UNA carga. */
export function BloqueSalidas({ sitio, nivel, fecha }: Props) {
  const datos = useDatosSalidas(sitio, fecha);
  return (
    <View style={{ gap: spacing.sm }}>
      <SalidasAgregados sitio={sitio} nivel={nivel} fecha={fecha} datos={datos} />
      <SalidasAcero sitio={sitio} nivel={nivel} fecha={fecha} datos={datos} />
      <SalidasAluminioPlastico sitio={sitio} nivel={nivel} fecha={fecha} datos={datos} />
    </View>
  );
}

/** Solo las salidas de agregados. */
export function BloqueAgregados({ sitio, nivel, fecha }: Props) {
  const datos = useDatosSalidas(sitio, fecha);
  return <SalidasAgregados sitio={sitio} nivel={nivel} fecha={fecha} datos={datos} />;
}

/** Solo el acero (con sus «Pendientes de pesaje»). */
export function BloqueAcero({ sitio, nivel, fecha }: Props) {
  const datos = useDatosSalidas(sitio, fecha);
  return <SalidasAcero sitio={sitio} nivel={nivel} fecha={fecha} datos={datos} />;
}

/** Solo el aluminio y el plástico. */
export function BloqueAluminioPlastico({ sitio, nivel, fecha }: Props) {
  const datos = useDatosSalidas(sitio, fecha);
  return <SalidasAluminioPlastico sitio={sitio} nivel={nivel} fecha={fecha} datos={datos} />;
}

export default BloqueSalidas;
