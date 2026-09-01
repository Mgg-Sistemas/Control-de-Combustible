// ============================================================================
// 🧾 SERVICIOS — la pestaña donde el encargado deja constancia de lo que se le
// hizo a una máquina, con el formato del formulario en papel del cliente
// («Ficha técnica Jumbo con martillo 0488»).
//
// ⚠️ LA FRONTERA. Esta pantalla NO escribe NUNCA en `machinery`. Registrar un
//    servicio no pone la máquina operativa ni la saca de averiada: eso lo
//    deciden el coordinador por QR y Control de Maquinaria, que son los que de
//    verdad la ven. Así una pila de reportes sin cerrar no arrastra a la flota.
//
//    Lo que SÍ puede hacer desde el 01-sep-2026 es cerrar EL PAPEL: la avería
//    (`maintenance_requests`). Son dos preguntas distintas —«¿alguien atendió
//    este reporte?» y «¿la máquina sirve hoy?»— y hasta ahora el módulo no podía
//    contestar ni la primera: quedaban dos botones del MISMO módulo con reglas
//    opuestas, en «⏳ Averías» el «✓ Realizado» cerraba, y aquí registrar el
//    trabajo completo, con repuestos y fotos, no. Y siempre a través de
//    `cerrarAveriaPorServicio`, nunca con un `.update` escrito a mano acá: esa
//    función es la que sabe no pisar una avería que ya estaba cerrada.
//
//    Por eso cada servicio enlazado a una avería muestra LAS DOS VERDADES juntas
//    ("atendida en taller" / "el sistema la sigue viendo pendiente"): no son
//    contradicción, son dos preguntas distintas, y verlas juntas evita que
//    alguien crea que el sistema se equivoca.
//
// ⚠️ SIN DINERO: acá no se pide ni se muestra ningún costo.
//
// Vive dentro de `MantenimientoMaquinariaScreen` (sección Servicio) pero en su
// propio archivo: esa pantalla ya pasa de las 1.700 líneas.
//
// Ver `docs/superpowers/specs/2026-08-18-servicio-maquinaria-design.md`.
// ============================================================================
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Image } from 'react-native';
import { Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { DateField } from '../components/DateField';
import { supabase, selectAllRows } from '../lib/supabase';
import { captureAndUploadPhoto } from '../lib/photo';
import { caracasParts } from '../lib/jornada';
import { machineLabel as etiquetaMaquina, machineMatches } from '../lib/machineLabel';
import {
  guardarServicio, validarServicio, ESTADOS_REPUESTO,
  quienLoHizo, ServiceOrigen, ServicePartInput,
  resolverIntervenciones, etiquetaIntervencion, validarTipoIntervencion, claveDesdeTexto,
  editarServicio, cambiosServicio, resumenCambios, filaServicio, Cambio,
  cerrarAveriaPorServicio,
} from '../lib/machineService';
import { useAuth } from '../context/AuthContext';
import { generateMachineServiceReport, generateServicioHojaPdf, MaquinaFicha, ServicioImprimible } from '../lib/machineServiceReport';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const todayISO = () => caracasParts(new Date()).iso;
/** El día de AYER en Caracas, para el atajo del filtro. Se calcula desde el ISO
 *  de hoy (mediodía, para que ningún desfase de zona lo corra un día). */
const ayerISO = () => {
  const d = new Date(`${todayISO()}T12:00:00-04:00`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const fmtDMY = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('T')[0].split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso);
};
/** Fecha Y HORA de Caracas. La bitácora sin hora no sirve: dos ediciones del
 *  mismo día se verían iguales y no se sabría cuál fue la última. */
const fmtFechaHora = (ts?: string | null) => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  const p = caracasParts(d);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const mm = String(p.minute).padStart(2, '0');
  return `${fmtDMY(p.iso)} ${h12}:${mm} ${p.hour < 12 ? 'a.m.' : 'p.m.'}`;
};

/** Lo que la pantalla madre ya cargó — no se vuelve a consultar. */
type Mach = {
  id: string; code: string; plate: string | null; serial: string | null;
  tipo: string | null; company: string; operational: boolean;
};
type Req = {
  id: string; machinery_id: string; material: string; notes: string | null;
  status: string; created_at: string; code: string;
};

type Orden = {
  id: string; machinery_id: string; maintenance_request_id: string | null;
  service_date: string; origen: ServiceOrigen; technician: string | null; provider: string | null;
  intervenciones: string[] | null; problem: string | null; work_done: string | null;
  photos: string[] | null; notes: string | null; created_at: string;
  parts?: { id: string; quantity: number | null; description: string; estado: string | null; position: number }[];
  // ⭐ Las dos columnas de `supabase/servicio_editar.sql`. Van OPCIONALES a
  //    propósito: mientras ese SQL no se corra a mano, la consulta con `*` ni
  //    siquiera las trae y llegan `undefined`. Nada puede reventar por eso.
  updated_at?: string | null;
  updated_by?: string | null;
};

/** Una edición guardada, tal como sale de `machinery_service_edits`. */
type FilaEdicion = {
  id: string;
  edited_by: string | null;
  edited_by_name: string | null;
  edited_at: string;
  changes: Cambio[] | null;
};

/** Una fila del catálogo `service_intervention_types` (ver
 *  `supabase/servicio_tipos_intervencion.sql`). Mientras ese SQL no se corra a
 *  mano, esta tabla NO EXISTE y la pantalla trabaja con los cuatro de siempre. */
type FilaTipo = { id: string; key: string; label: string; sort_order: number | null; active: boolean };

/** Un renglón del formulario de repuestos (el último siempre va vacío). */
type Renglon = { quantity: string; description: string; estado: string };
const RENGLON_VACIO: Renglon = { quantity: '', description: '', estado: ESTADOS_REPUESTO[0] };

/**
 * ⚠️ `Boton` y `Entrada` viven AQUÍ ARRIBA, FUERA del componente, A PROPÓSITO.
 * NO los metas adentro para tener `colors` y `busy` a mano sin pasarlos.
 *
 * BUG DEL CLIENTE (19-ago-2026): «cada que intento escribir o doy un espacio deja de
 * escribir». Estaban declarados DENTRO de `ServicioRegistroTab`, así que en CADA render
 * eran una función NUEVA — y para React, una función distinta es un COMPONENTE distinto.
 * Al teclear una letra cambiaba el estado, se re-renderizaba la pantalla, React veía
 * "otro" componente y DESMONTABA el <TextInput> para montar uno nuevo: el campo perdía
 * el foco y el teclado se cerraba a cada tecla. Declarados a nivel de módulo la
 * identidad es estable, no hay desmontaje y el campo conserva el foco.
 *
 * REGLA GENERAL: un componente declarado dentro de otro NUNCA debe contener un campo de
 * texto.
 */
function Boton({ label, onPress, tone = 'surface', disabled, colors }: {
  label: string; onPress: () => void; tone?: 'surface' | 'brand'; disabled?: boolean; colors: AppColors;
}) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled}
      style={{ backgroundColor: tone === 'brand' ? colors.brand : colors.surfaceAlt, borderWidth: 1,
        borderColor: tone === 'brand' ? colors.brand : colors.border, borderRadius: radius.md,
        paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: 'center', opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: tone === 'brand' ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );
}

function Entrada(p: {
  label: string; value: string; onChange: (s: string) => void;
  multiline?: boolean; placeholder?: string; colors: AppColors;
}) {
  const { colors } = p;
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 3 }}>{p.label}</Text>
      <TextInput value={p.value} onChangeText={p.onChange} placeholder={p.placeholder}
        placeholderTextColor={colors.muted} multiline={p.multiline}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
          paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, color: colors.text,
          minHeight: p.multiline ? 64 : undefined, textAlignVertical: p.multiline ? 'top' : 'center' }} />
    </View>
  );
}

export default function ServicioRegistroTab(
  { machines, reqs, canWrite, uid }: { machines: Mach[]; reqs: Req[]; canWrite: boolean; uid: string | null }
) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  // El nombre se COPIA a la bitácora al editar, no se resuelve después por
  // JOIN: si mañana se borra el perfil, el registro tiene que seguir diciendo
  // quién fue. Mismo criterio que `audit_log.user_name`.
  const { fullName } = useAuth();

  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // ── Filtros ────────────────────────────────────────────────────────────────
  const [fMaquina, setFMaquina] = useState<string>('');   // '' = todas
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState('');
  /**
   * ¿El PDF arrastra también los expedientes VIEJOS del taller
   * (`machinery_repairs`, los de antes de esta pestaña)?
   *
   * ⭐ Sale ENCENDIDO para no cambiarle el documento a nadie de un día para otro
   *    —hasta hoy siempre venían—, pero ahora se puede apagar: era parte de la
   *    queja de «me los arroja los dos». Ver `exportar`.
   */
  const [conViejos, setConViejos] = useState(true);

  // ── Formulario ─────────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  /**
   * `null` = se está REGISTRANDO uno nuevo. Con un id = se está EDITANDO ese.
   *
   * Es el mismo formulario para las dos cosas —igual que en Compras directas
   * (`ComprasScreen.tsx:420`) y en Mangueras—, porque son exactamente los mismos
   * campos: tener dos formularios gemelos garantiza que un día se arregle uno y
   * se olvide el otro.
   */
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(todayISO());
  const [maquinaId, setMaquinaId] = useState('');
  const [origen, setOrigen] = useState<ServiceOrigen>('interno');
  const [tecnico, setTecnico] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [intervs, setIntervs] = useState<string[]>([]);
  const [problema, setProblema] = useState('');
  const [acciones, setAcciones] = useState('');
  const [averiaId, setAveriaId] = useState('');
  /**
   * ¿Al guardar, la avería enlazada queda dada por atendida?
   *
   * Sale MARCADA porque es lo que pasa casi siempre: si el mecánico se sentó a
   * llenar la hoja de un trabajo, ese trabajo se hizo. Se desmarca para el caso
   * contrario, que también existe: la máquina volvió con el mismo problema y el
   * reporte tiene que seguir vivo hasta que de verdad se resuelva.
   *
   * ⚠️ Marcarla NO toca el estado de la máquina. Cierra el PAPEL y nada más.
   */
  const [cerrarAveria, setCerrarAveria] = useState(true);
  const [fotos, setFotos] = useState<string[]>([]);
  const [renglones, setRenglones] = useState<Renglon[]>([{ ...RENGLON_VACIO }]);
  const [pickMaquinaForm, setPickMaquinaForm] = useState(false);
  // Lo que salió mal al guardar, para mostrarlo DENTRO del formulario. Un `toast`
  // no sirve acá: se dibuja en la pantalla de atrás y la ventana del formulario lo
  // tapa por completo — el error existía pero nadie lo veía.
  const [formError, setFormError] = useState<string | null>(null);

  // ── Tipos de intervención (catálogo administrable) ────────────────────────
  // `null` = no se pudo leer el catálogo (lo normal mientras no se corra el SQL).
  const [filasTipos, setFilasTipos] = useState<FilaTipo[] | null>(null);
  const [faltaTablaTipos, setFaltaTablaTipos] = useState(false);
  const [tiposOpen, setTiposOpen] = useState(false);
  const [tiposError, setTiposError] = useState<string | null>(null);
  const [tiposOk, setTiposOk] = useState<string | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevaClave, setNuevaClave] = useState('');
  // Lo que se está escribiendo en cada renglón del catálogo, sin tocar la base
  // hasta que se toque 💾. Clave = id del tipo.
  const [borradores, setBorradores] = useState<Record<string, { label: string; orden: string }>>({});

  // ── El rastro de las ediciones ────────────────────────────────────────────
  // id de perfil → nombre y apellido. Solo para poder escribir «editado por
  // Fulano» sin que cada tarjeta se ponga a consultar la base por su cuenta.
  const [nombres, setNombres] = useState<Record<string, string>>({});
  // El servicio cuya bitácora se está mirando, con lo que se pudo leer de ella.
  const [historial, setHistorial] = useState<
    { orden: Orden; filas: FilaEdicion[] | null; error: string | null } | null
  >(null);

  const machById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);
  const reqById = useMemo(() => new Map(reqs.map((r) => [r.id, r])), [reqs]);

  // Las casillas del formulario: solo los ACTIVOS, en su orden. Sin catálogo,
  // los cuatro de siempre — la decisión la toma la función pura, no la pantalla.
  const tipos = useMemo(() => resolverIntervenciones(filasTipos), [filasTipos]);
  // Para PONERLE NOMBRE a lo que ya está guardado se usan TODOS los tipos,
  // incluidos los desactivados: un servicio viejo que marcó «Soldadura» tiene
  // que seguir diciendo «Soldadura», no `soldadura`.
  const tiposParaEtiquetar = useMemo(
    () => resolverIntervenciones((filasTipos ?? []).map((f) => ({ ...f, active: true }))),
    [filasTipos]
  );
  // El catálogo como se administra: activos primero, y dentro, por orden.
  const listaTipos = useMemo(() => (filasTipos ?? []).slice().sort((a, b) =>
    Number(!a.active) - Number(!b.active)
    || (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
    || String(a.label).localeCompare(String(b.label), 'es')
  ), [filasTipos]);

  /**
   * Trae el catálogo de tipos de intervención.
   *
   * ⚠️ TOLERANTE A PROPÓSITO — NO LE PONGAS UN `toast.error` NI UN `console.error`.
   *    La tabla `service_intervention_types` nace de correr A MANO
   *    `supabase/servicio_tipos_intervencion.sql`. Mientras nadie lo corra, esta
   *    consulta responde `42P01 · relation does not exist`, y eso NO es una falla
   *    que el encargado del taller pueda arreglar ni tenga por qué ver: la
   *    pantalla cae sin ruido a los cuatro tipos de siempre y funciona igual que
   *    antes. Lo único que avisa es el modal de administración, donde sí importa.
   */
  const cargarTipos = async () => {
    try {
      const { data, error } = await supabase
        .from('service_intervention_types')
        .select('id, key, label, sort_order, active')
        .order('sort_order', { ascending: true });
      if (error) { setFilasTipos(null); setFaltaTablaTipos(true); return; }
      setFilasTipos((data ?? []) as FilaTipo[]);
      setFaltaTablaTipos(false);
    } catch {
      setFilasTipos(null); setFaltaTablaTipos(true);
    }
  };

  const cargar = async () => {
    setLoading(true);
    const data = await selectAllRows(
      'machinery_service_orders',
      '*, parts:machinery_service_parts(*)',
      (q) => q.order('service_date', { ascending: false })
    ).catch(() => [] as any[]);
    const filas = (data ?? []) as Orden[];
    setOrdenes(filas);
    setLoading(false);

    // Los nombres de quienes editaron. Va DESPUÉS de pintar la lista y en su
    // propio try: si falla (o si todavía no existe la columna `updated_by`
    // porque no se corrió el SQL), la pestaña tiene que seguir funcionando
    // igual — simplemente no dirá el nombre.
    const ids = Array.from(new Set(filas.map((o) => o.updated_by).filter(Boolean))) as string[];
    if (!ids.length) return;
    try {
      const { data: perfiles } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      const mapa: Record<string, string> = {};
      ((perfiles ?? []) as any[]).forEach((p) => { if (p?.id && p?.full_name) mapa[p.id] = p.full_name; });
      setNombres((prev) => ({ ...prev, ...mapa }));
    } catch { /* sin nombres, pero la lista ya está en pantalla */ }
  };
  useEffect(() => { cargar(); cargarTipos(); }, []);

  // ── Lo que se ve, después de los filtros ──────────────────────────────────
  const visibles = useMemo(() => ordenes.filter((o) => {
    if (fMaquina && o.machinery_id !== fMaquina) return false;
    const d = String(o.service_date ?? '').slice(0, 10);
    if (fDesde && d < fDesde) return false;
    if (fHasta && d > fHasta) return false;
    return true;
  }), [ordenes, fMaquina, fDesde, fHasta]);

  /**
   * Las averías de la máquina elegida, para el desplegable del formulario.
   *
   * ⭐ TAMBIÉN LAS YA CERRADAS, y no es un descuido. Antes esta lista solo traía
   *    las `pendiente`, y eso dejaba trabajo huérfano para siempre: el orden real
   *    del taller es que el inspector cierra la avería en campo el MARTES y el
   *    mecánico se sienta a llenar la hoja el MIÉRCOLES — para entonces la avería
   *    ya no salía en el desplegable, la hoja se guardaba sin enlazar y nadie
   *    podía volver a saber qué reporte había atendido ese trabajo.
   *
   *    Enlazar una avería cerrada no la reabre ni le cambia quién la cerró:
   *    `cerrarAveriaPorServicio` solo escribe sobre las pendientes.
   *
   * El orden importa tanto como el contenido: primero las pendientes (que es lo
   * que el mecánico viene a buscar el 99% de las veces) y dentro de cada grupo
   * las más nuevas arriba, para que las cerradas de hace meses no empujen hacia
   * abajo el reporte de ayer.
   */
  const averiasDe = useMemo(
    () => reqs
      .filter((r) => r.machinery_id === maquinaId)
      .sort((a, b) =>
        Number(a.status !== 'pendiente') - Number(b.status !== 'pendiente')
        || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
      ),
    [reqs, maquinaId]
  );

  /**
   * La avería que está elegida ahora mismo, y si todavía está pendiente.
   *
   * De aquí sale si la casilla «dar por atendida» se puede tocar: sobre una
   * avería que YA está cerrada no hay nada que cerrar, así que la casilla sale
   * apagada y deshabilitada en vez de prometer algo que no va a pasar.
   */
  const averiaSel = useMemo(() => (averiaId ? reqById.get(averiaId) : undefined), [averiaId, reqById]);
  const averiaSelPendiente = averiaSel?.status === 'pendiente';
  /** ¿Este guardado va a cerrar el papel? Lo miran los tres caminos de `guardar`. */
  const vaACerrarAveria = !!averiaId && cerrarAveria && averiaSelPendiente;

  const limpiarForm = () => {
    setFecha(todayISO()); setMaquinaId(''); setOrigen('interno');
    setTecnico(''); setProveedor(''); setIntervs([]);
    setProblema(''); setAcciones(''); setAveriaId(''); setCerrarAveria(true);
    setFotos([]); setRenglones([{ ...RENGLON_VACIO }]);
    setFormError(null);
    setEditandoId(null);
  };

  /** Abre el MISMO formulario, pero cargado con lo que ya tiene el servicio. */
  const abrirEditar = (o: Orden) => {
    setFecha(String(o.service_date ?? '').slice(0, 10));
    setMaquinaId(o.machinery_id ?? '');
    setOrigen(o.origen === 'externo' ? 'externo' : 'interno');
    setTecnico(o.technician ?? '');
    setProveedor(o.provider ?? '');
    setIntervs((o.intervenciones ?? []).slice());
    setProblema(o.problem ?? '');
    setAcciones(o.work_done ?? '');
    setAveriaId(o.maintenance_request_id ?? '');
    // La casilla arranca marcada también al editar: el caso que trae aquí a la
    // gente es justamente el de la hoja que se guardó sin enlazar la avería, y
    // se vuelve a abrir para enlazarla. Si la avería ya está cerrada, la casilla
    // se apaga sola (`averiaSelPendiente`) y no hay nada que pisar.
    setCerrarAveria(true);
    setFotos((o.photos ?? []).slice());
    // Los repuestos, en su orden, más el renglón vacío del final que el
    // formulario siempre tiene para poder agregar otro sin tocar nada.
    const rs = (o.parts ?? []).slice().sort((a, b) => a.position - b.position).map((p) => ({
      quantity: p.quantity == null ? '' : String(p.quantity),
      description: p.description ?? '',
      estado: p.estado || ESTADOS_REPUESTO[0],
    }));
    setRenglones([...rs, { ...RENGLON_VACIO }]);
    setFormError(null);
    setEditandoId(o.id);
    setFormOpen(true);
  };

  /**
   * Da por atendida la avería enlazada, si el usuario dejó marcada la casilla.
   * Devuelve el aviso que hay que decir en voz alta, o `null` si todo bien.
   *
   * ⚠️ NUNCA DESHACE NADA. Cuando esto corre, el servicio YA está guardado.
   *    Si el cierre falla, el trabajo se queda registrado igual y lo único que
   *    pasa es que la avería sigue pendiente — y se dice, no se disimula.
   *    Devolver el registro del trabajo por no haber podido cerrar un reporte
   *    sería cambiar un problema chico por uno grande: la hoja tiene repuestos,
   *    fotos y un texto que nadie va a volver a escribir igual.
   */
  const cerrarPapelSiTocaba = async (): Promise<string | null> => {
    if (!vaACerrarAveria) return null;
    const { error } = await cerrarAveriaPorServicio(supabase as any, averiaId, uid);
    return error
      ? `El trabajo QUEDÓ REGISTRADO, pero la avería no se pudo cerrar y sigue pendiente: ${error}`
      : null;
  };

  const guardar = async () => {
    setFormError(null);
    const inp = {
      machineryId: maquinaId, serviceDate: fecha, origen,
      technician: tecnico, provider: proveedor,
      intervenciones: intervs, problem: problema, workDone: acciones,
      photos: fotos, maintenanceRequestId: averiaId || null, createdBy: uid,
    };
    const problemaTxt = validarServicio(inp);
    // ⚠️ El error va a un aviso DENTRO del formulario, no a un `toast`. El toast se
    // dibuja en la pantalla de atrás y CUALQUIER ventana abierta lo tapa, así que
    // desde acá dentro nunca se vería: el encargado tocaba 💾 Guardar, fallaba y no
    // pasaba NADA a la vista — «no se guarda» sin decir por qué (19-ago-2026).
    if (problemaTxt) return setFormError(problemaTxt);

    setBusy(true);
    /**
     * ⚠️ DE AQUÍ HASTA EL `finally` VA TODO ADENTRO DEL `try`, Y NO ES ADORNO.
     *
     * `busy` deshabilita los botones del pie del formulario. Antes los tres
     * `setBusy(false)` estaban sueltos en los caminos normales, así que
     * cualquier reventón en el medio —la red que se cae a mitad del `await`, un
     * `null` inesperado— dejaba el bloqueo puesto PARA SIEMPRE: el encargado
     * quedaba encerrado en la ventana, sin poder guardar ni cancelar, con todo
     * lo que había escrito adentro, y la única salida era recargar la app y
     * volver a llenar la hoja completa. Con el `finally`, pase lo que pase el
     * bloqueo se levanta y por lo menos se puede volver a intentar o salir.
     */
    try {
      const partes: ServicePartInput[] = renglones.map((r) => ({
        quantity: r.quantity, description: r.description, estado: r.estado,
      }));

      // ── EDITANDO uno que ya existe ────────────────────────────────────────
      if (editandoId) {
        const original = ordenes.find((x) => x.id === editandoId);
        // El «qué cambió» se calcula comparando las DOS FILAS tal como van a la
        // base, no los estados de la pantalla: así un espacio de más al final de
        // un texto no aparece como un cambio de verdad.
        const cambios = cambiosServicio({
          antes: original as any,
          despues: filaServicio(inp),
          repuestosAntes: (original?.parts ?? []).slice().sort((a, b) => a.position - b.position),
          repuestosDespues: partes,
          nombres: {
            maquina: (id) => etiquetaMaquina(machById.get(id)) || id.slice(0, 8),
            intervencion: (k) => etiquetaIntervencion(k, tiposParaEtiquetar),
            averia: (id) => {
              const r0 = reqById.get(id);
              return r0 ? `${r0.material}${r0.notes ? ` · ${r0.notes}` : ''}` : id.slice(0, 8);
            },
          },
        });

        // Si no se movió nada, no se escribe: una bitácora llena de ediciones
        // vacías esconde las que sí importan. Pero la casilla de dar por
        // atendida SÍ se atiende igual: puede ser lo único que el mecánico vino
        // a hacer, y no cerrarla en silencio sería el mismo bug de antes con
        // otra cara.
        if (!cambios.length) {
          const aviso = await cerrarPapelSiTocaba();
          const cerroElPapel = vaACerrarAveria && !aviso;
          setFormOpen(false); limpiarForm();
          if (aviso) return toast.error(aviso);
          return toast.success(cerroElPapel
            ? 'Avería dada por atendida. Los datos del servicio no cambiaron.'
            : 'No cambiaste nada, así que no se guardó ninguna edición.');
        }

        const re = await editarServicio(supabase as any, editandoId, inp, partes, {
          id: uid, nombre: fullName, cambios,
        });
        if (re.error) return setFormError(re.error);
        const aviso = await cerrarPapelSiTocaba();
        const cerroElPapel = vaACerrarAveria && !aviso;
        setFormOpen(false); limpiarForm(); cargar();
        // Los avisos de problema pesan más que el ✅: si el rastro de la edición
        // no quedó, o la avería no se pudo cerrar, hay que decirlo — no dar por
        // bueno lo que no lo está.
        const avisos = [re.avisoBitacora, aviso].filter(Boolean) as string[];
        if (avisos.length) return toast.error(avisos.join(' · '));
        return toast.success(`Servicio actualizado: ${resumenCambios(cambios)}.`
          + (cerroElPapel ? ' La avería quedó dada por atendida.' : ''));
      }

      // ── REGISTRANDO uno nuevo ─────────────────────────────────────────────
      const r = await guardarServicio(supabase as any, inp, partes);
      if (r.error) return setFormError(r.error);
      const aviso = await cerrarPapelSiTocaba();
      const cerroElPapel = vaACerrarAveria && !aviso;
      setFormOpen(false); limpiarForm(); cargar();
      if (aviso) return toast.error(aviso);
      // El aviso dice la frontera EN EL MOMENTO en que importa: justo cuando el
      // encargado acaba de registrar y podría suponer que la máquina ya se activó.
      toast.success(cerroElPapel
        ? 'Servicio registrado y avería dada por atendida. El estado de la máquina no cambia.'
        : 'Servicio registrado. No cambia el estado de la máquina.');
    } finally {
      setBusy(false);
    }
  };

  /** Abre la bitácora de UN servicio: quién lo editó, cuándo y qué tocó. */
  const verCambios = async (o: Orden) => {
    setHistorial({ orden: o, filas: null, error: null });
    const { data, error } = await supabase
      .from('machinery_service_edits')
      .select('id, edited_by, edited_by_name, edited_at, changes')
      .eq('service_order_id', o.id)
      .order('edited_at', { ascending: false });
    if (error) {
      // Lo normal mientras no se corra el SQL: la tabla no existe. Se dice en
      // criollo y con el nombre del archivo, no con el código de Postgres.
      const falta = /does not exist|42P01|schema cache/i.test(error.message);
      return setHistorial({
        orden: o, filas: null,
        error: falta
          ? 'Todavía no se está guardando el detalle de las ediciones. Hay que correr «supabase/servicio_editar.sql» en Supabase.'
          : error.message,
      });
    }
    setHistorial({ orden: o, filas: (data ?? []) as FilaEdicion[], error: null });
  };

  const borrar = async (o: Orden) => {
    const va = await confirm({
      title: 'Borrar este servicio',
      message: `${fmtDMY(o.service_date)} · ${etiquetaMaquina(machById.get(o.machinery_id)) || '—'}\n\nSe borra el registro y sus repuestos. No afecta a la máquina ni a ninguna avería.`,
      confirmText: 'Borrar', danger: true,
    });
    if (!va) return;
    // Solo su propia tabla: los repuestos se van solos por `on delete cascade`.
    const { error } = await supabase.from('machinery_service_orders').delete().eq('id', o.id);
    if (error) return toast.error(error.message);
    toast.success('Servicio borrado.');
    cargar();
  };

  // ── Administrar los tipos de intervención ─────────────────────────────────
  // ⚠️ Los avisos de este modal van DENTRO del modal (`tiposError` / `tiposOk`),
  //    no a un `toast`: el toast se dibuja en la pantalla de atrás y cualquier
  //    ventana abierta lo tapa. Mismo motivo que `formError`.
  const abrirTipos = () => {
    setTiposError(null); setTiposOk(null); setBorradores({});
    setNuevoNombre(''); setNuevaClave('');
    setTiposOpen(true);
    cargarTipos();
  };

  const borradorDe = (t: FilaTipo) =>
    borradores[t.id] ?? { label: t.label, orden: String(t.sort_order ?? 100) };

  const crearTipo = async () => {
    setTiposError(null); setTiposOk(null);
    const problema = validarTipoIntervencion({ key: nuevaClave, label: nuevoNombre }, filasTipos ?? []);
    if (problema) return setTiposError(problema);
    const key = claveDesdeTexto(nuevaClave || nuevoNombre);
    // Va de último: quien lo agrega decide después si lo sube de puesto.
    const orden = Math.max(0, ...(filasTipos ?? []).map((f) => Number(f.sort_order) || 0)) + 10;

    setBusy(true);
    const { error } = await supabase
      .from('service_intervention_types')
      .insert({ key, label: nuevoNombre.trim(), sort_order: orden });
    setBusy(false);
    if (error) return setTiposError(error.message);
    setNuevoNombre(''); setNuevaClave('');
    setTiposOk('Tipo agregado. Ya sale en el formulario de servicios.');
    cargarTipos();
  };

  const guardarTipo = async (t: FilaTipo) => {
    setTiposError(null); setTiposOk(null);
    const b = borradorDe(t);
    const label = b.label.trim();
    if (!label) return setTiposError('Escribe el nombre del tipo de intervención.');
    const orden = Number(b.orden);

    setBusy(true);
    const { error } = await supabase
      .from('service_intervention_types')
      // La CLAVE no se toca nunca: es lo que quedó guardado dentro de cada
      // servicio. Cambiarla dejaría a los registros viejos apuntando al vacío.
      .update({ label, sort_order: isFinite(orden) ? Math.trunc(orden) : 100 })
      .eq('id', t.id);
    setBusy(false);
    if (error) return setTiposError(error.message);
    setBorradores((p) => { const q = { ...p }; delete q[t.id]; return q; });
    setTiposOk(`Guardado: ${label}.`);
    cargarTipos();
  };

  const cambiarActivo = async (t: FilaTipo) => {
    setTiposError(null); setTiposOk(null);
    if (t.active) {
      const va = await confirm({
        title: 'Desactivar este tipo',
        message: `«${t.label}» deja de salir en el formulario: nadie lo podrá marcar en un servicio nuevo.\n\nLos servicios YA registrados que lo usan lo SIGUEN mostrando con su nombre — por eso no se borra de verdad. Puedes reactivarlo cuando quieras.`,
        confirmText: 'Desactivar', danger: true,
      });
      if (!va) return;
    }
    setBusy(true);
    const { error } = await supabase
      .from('service_intervention_types')
      .update({ active: !t.active })
      .eq('id', t.id);
    setBusy(false);
    if (error) return setTiposError(error.message);
    setTiposOk(t.active
      ? `«${t.label}» quedó desactivado. Los servicios viejos lo siguen mostrando.`
      : `«${t.label}» volvió al formulario.`);
    cargarTipos();
  };

  // ── El PDF ────────────────────────────────────────────────────────────────

  /**
   * La ficha de unas máquinas. La pantalla madre no carga foto, marca ni modelo,
   * así que se piden aparte — SOLO para las máquinas que hagan falta.
   */
  /**
   * Los expedientes VIEJOS del taller (`machinery_repairs`) que entran al PDF.
   *
   * ⚠️ EL RANGO DE FECHAS SE APLICA EN EL SERVIDOR, no solo en la pantalla.
   *    Antes esta consulta se traía TODO el histórico correctivo de la flota
   *    —una tabla que existe desde que arrancó el sistema— y recién después
   *    `dentro()` descartaba lo que no entraba en el rango. Con los filtros
   *    vacíos eso son miles de filas viajando para nada, y era una de las
   *    razones de que la vista previa tardara tanto (26-ago-2026).
   *
   * ⚠️ Y AHORA PAGINA. Antes era un `.select()` pelado, así que PostgREST lo
   *    cortaba en ~1000 filas EN SILENCIO: con más correctivos que eso, el PDF
   *    salía incompleto y nadie se enteraba.
   *
   * ⚠️⚠️ EL RANGO DEL SERVIDOR VA ESTIRADO UN DÍA POR LADO, A PROPÓSITO.
   *    `dentro()` compara `out_at.slice(0,10)`, o sea la fecha en UTC. Postgres,
   *    en cambio, interpreta `'2026-08-20'` en la zona horaria de la sesión. Si
   *    esa zona no es UTC (Caracas es UTC-4), las dos cuentas se corren hasta
   *    cuatro horas y un `gte` exacto DEJARÍA FUERA reparaciones que la pantalla
   *    sí cuenta — el PDF saldría con menos filas y nadie sabría por qué.
   *    Estirando el rango, el servidor devuelve de más y `dentro()` hace el
   *    corte fino: el resultado es EL MISMO de antes, byte por byte, pero sin
   *    arrastrar el histórico completo. La prueba lo vigila.
   */
  const masDias = (iso: string, n: number) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const traerViejos = async (ids: string[]): Promise<any[]> =>
    selectAllRows('machinery_repairs', 'id, machinery_id, out_at, work_done', (q) => {
      let x = q.eq('tipo', 'correctivo').in('machinery_id', ids);
      if (fDesde) x = x.gte('out_at', masDias(fDesde, -1));
      if (fHasta) x = x.lt('out_at', masDias(fHasta, 2));
      return x;
    }).catch(() => [] as any[]);

  const traerFichas = async (ids: string[]): Promise<Map<string, MaquinaFicha>> => {
    const { data } = await supabase
      .from('machinery')
      .select('id, code, plate, serial, identifier, tipo, marca, modelo, photo_url, encargado, last_horometro, horometro_base, oil_type, oil_capacity_l, oil_notes, company:company_id(name)')
      .in('id', ids);
    return new Map<string, MaquinaFicha>(
      (data ?? []).map((f: any) => [f.id, { ...f, companyName: f.company?.name ?? null }])
    );
  };

  /** Lo que hace falta de UN servicio para imprimirlo. */
  const imprimible = (o: Orden): ServicioImprimible => ({
    id: o.id, service_date: o.service_date, origen: o.origen,
    technician: o.technician, provider: o.provider,
    intervenciones: o.intervenciones ?? [],
    problem: o.problem, work_done: o.work_done,
    parts: (o.parts ?? []).slice().sort((a, b) => a.position - b.position)
      .map((p) => ({ quantity: p.quantity, description: p.description, estado: p.estado })),
    averia: o.maintenance_request_id ? textoAveria(reqById.get(o.maintenance_request_id)) : null,
  });

  /**
   * ⭐ UNA SOLA HOJA — la de ESTE servicio y nada más.
   *
   * Es la respuesta a la queja del taller: «me los arroja los dos, el que ya
   * monté y el de prueba». El botón de arriba exporta TODO lo que haya en el
   * filtro; este exporta exactamente el servicio que se está mirando.
   */
  const exportarUna = async (o: Orden) => {
    setBusy(true);
    try {
      const ficha = (await traerFichas([o.machinery_id])).get(o.machinery_id);
      // ⚠️ Sin ficha (la consulta falló, o RLS esconde la fila) la hoja sale
      //    MUTILADA —sin foto, sin serial, sin marca ni modelo— y antes salía
      //    así calladita. El respaldo usa los campos SUELTOS de la pantalla
      //    madre, no la etiqueta ya armada: metiéndola entera en `code`, el
      //    «Equipo» salía con el separador repetido.
      const m0 = machById.get(o.machinery_id);
      if (!ficha) {
        // ⚠️ `confirm` y NO `toast`: la vista previa del PDF se monta encima con
        //    z-index 99999 y tapa el toast justo cuando aparece (este archivo ya
        //    documenta esa trampa dos veces). Un aviso que nadie ve es el mismo
        //    silencio que se vino a quitar — y encima hay que poder NO generarla.
        const igual = await confirm('No se pudieron leer los datos de la máquina. La hoja saldría sin foto, sin marca ni modelo y sin la empresa. ¿La generas igual?');
        if (!igual) return;
      }
      await generateServicioHojaPdf({
        m: ficha ?? ({ code: m0?.code ?? '—', plate: m0?.plate ?? null, serial: m0?.serial ?? null, tipo: m0?.tipo ?? null } as MaquinaFicha),
        servicio: imprimible(o),
        tiposIntervencion: tipos,
        tiposConocidos: tiposParaEtiquetar,
      });
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo generar el PDF.');
    } finally {
      setBusy(false);
    }
  };

  const exportar = async () => {
    if (!visibles.length) return toast.error('No hay servicios en el filtro para exportar.');
    setBusy(true);
    try {
      const ids = Array.from(new Set(visibles.map((o) => o.machinery_id)));

      // ⭐ LAS DOS CONSULTAS A LA VEZ, no una esperando a la otra. Son
      //    independientes: la segunda no necesita nada de la primera. En serie
      //    se pagaban dos viajes de red completos antes de empezar a armar el
      //    PDF (26-ago-2026, «la vista previa tarda muchísimo»).
      const [fichaById, viejos] = await Promise.all([
        traerFichas(ids),
        // Los expedientes viejos del taller entran al mismo PDF, marcados como
        // tales: traen menos datos porque no los guardaban. Se pueden dejar fuera
        // con el interruptor «🧰 Traer también los expedientes viejos».
        conViejos ? traerViejos(ids) : Promise.resolve([] as any[]),
      ]);

      const dentro = (d?: string | null) => {
        const s = String(d ?? '').slice(0, 10);
        if (!s) return false;
        if (fDesde && s < fDesde) return false;
        if (fHasta && s > fHasta) return false;
        return true;
      };

      const maquinas = ids.map((id) => {
        // ⚠️ Al PDF se le mandan las CLAVES CRUDAS de las intervenciones, no los
        //    nombres (ver `imprimible`): el reporte las cruza por clave.
        const nuevos: ServicioImprimible[] = visibles
          .filter((o) => o.machinery_id === id)
          .map(imprimible);
        const antiguos: ServicioImprimible[] = (viejos ?? [])
          .filter((v: any) => v.machinery_id === id && dentro(v.out_at))
          .map((v: any) => ({
            id: v.id, service_date: v.out_at, origen: 'interno' as ServiceOrigen,
            technician: null, intervenciones: [], problem: null, work_done: v.work_done,
            parts: [], esRegistroAnterior: true,
          }));
        return {
          m: fichaById.get(id) ?? ({ code: '—' } as MaquinaFicha),
          servicios: [...nuevos, ...antiguos].sort((a, b) => (a.service_date < b.service_date ? 1 : -1)),
        };
      });

      await generateMachineServiceReport({
        maquinas, desde: fDesde || undefined, hasta: fHasta || undefined,
        // Las CASILLAS del PDF son las mismas que las del formulario en pantalla
        // (`tipos`: solo los activos, en su orden). `tiposConocidos` incluye los
        // desactivados y sirve solo para ponerle nombre a un tipo que un servicio
        // viejo marcó y que ya salió del catálogo.
        tiposIntervencion: tipos,
        tiposConocidos: tiposParaEtiquetar,
      });
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo generar el PDF.');
    } finally {
      setBusy(false);
    }
  };

  const textoAveria = (r?: Req): string | null =>
    r ? `Avería del ${fmtDMY(r.created_at)} · ${r.material}${r.notes ? ` · ${r.notes}` : ''}` : null;


  if (loading) return <Loading />;

  return (
    <View>
      {/* ── Filtros y acciones ── */}
      <Card>
        <SectionTitle>🔎 Filtrar</SectionTitle>
        <TouchableOpacity onPress={() => setPickerOpen(true)}
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
            borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
            🚜 {fMaquina ? etiquetaMaquina(machById.get(fMaquina)) : 'Todas las máquinas'}
          </Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}><DateField value={fDesde} onChange={setFDesde} placeholder="Desde" /></View>
          <View style={{ flex: 1 }}><DateField value={fHasta} onChange={setFHasta} placeholder="Hasta" /></View>
        </View>

        {/* ⭐ ATAJOS DE DÍA. Los dos campos de fecha arrancan VACÍOS, y sin
            fechas «Exportar PDF» saca TODO lo registrado — que es justo la queja
            del taller: «me los arroja los dos, el que ya monté y el de prueba».
            Con «Hoy» se acota a un día de un toque. */}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Boton colors={colors} disabled={busy} label="📅 Hoy"
              onPress={() => { const h = todayISO(); setFDesde(h); setFHasta(h); }} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton colors={colors} disabled={busy} label="📅 Ayer"
              onPress={() => { const a = ayerISO(); setFDesde(a); setFHasta(a); }} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton colors={colors} disabled={busy} label="✕ Sin fecha"
              onPress={() => { setFDesde(''); setFHasta(''); }} />
          </View>
        </View>

        {/* El interruptor de los expedientes viejos del taller. */}
        <TouchableOpacity onPress={() => setConViejos((v) => !v)} activeOpacity={0.8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm }}>
          <Text style={{ fontSize: 15 }}>{conViejos ? '☑️' : '⬜'}</Text>
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
            🧰 Traer también los expedientes viejos del taller
          </Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            {/* ⚠️ SE CUENTAN SERVICIOS, NUNCA PÁGINAS NI «HOJAS».
                Contado en PDFs de verdad: con UNA sola máquina el reporte
                antepone su ficha técnica en página aparte, así que «3 hojas»
                entregaba 4 páginas; y una hoja con muchos repuestos ocupa dos.
                Prometer un número de páginas es imposible de cumplir, y era
                EXACTAMENTE la sorpresa que este cambio vino a quitar. Se cuenta
                lo único que sí se sabe: cuántos servicios van. */}
            <Boton colors={colors} disabled={busy}
              label={`📄 Exportar ${visibles.length} servicio${visibles.length === 1 ? '' : 's'}${conViejos ? ' + viejos' : ''}`}
              onPress={exportar} />
          </View>
          {canWrite ? (
            <View style={{ flex: 1 }}><Boton colors={colors} disabled={busy} label="➕ Registrar servicio" tone="brand" onPress={() => { limpiarForm(); setFormOpen(true); }} /></View>
          ) : null}
        </View>
        {canWrite ? (
          <View style={{ marginTop: spacing.sm }}>
            <Boton colors={colors} disabled={busy} label="⚙️ Tipos de intervención" onPress={abrirTipos} />
          </View>
        ) : null}
        {/* Decir ANTES de tocar el botón qué va a salir. La queja del taller
            fue recibir un PDF con más hojas de las que esperaba. */}
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>
          {(() => {
            const n = visibles.length;
            const cuantos = n === 1 ? 'un servicio' : `${n} servicios`;
            // «los que caigan en el rango» y no «uno por cada»: los viejos se
            // filtran por las mismas fechas y los que no tienen fecha de salida
            // se descartan, así que pueden ser cero.
            const mas = conViejos
              ? ', más los expedientes viejos del taller que caigan en el rango (apaga la casilla para dejarlos fuera)'
              : '';
            // La ficha técnica es una PÁGINA de más, y solo aparece con una máquina.
            const ficha = fMaquina ? ' Empieza con la ficha técnica de la máquina, en su propia página.' : '';
            return !fDesde && !fHasta
              ? `⚠️ Sin fechas: van TODOS los servicios registrados (${n})${mas}.${ficha} Toca «📅 Hoy» para sacar solo el día, o «📄 Solo esta hoja» en el servicio que quieras.`
              : `Van ${cuantos} del filtro${mas}.${ficha}`;
          })()}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>
          ℹ️ Este módulo lleva el registro del trabajo. Al guardar puede dar por atendida la avería que atendió,
          pero NO cambia el estado de las máquinas — para eso, Control de Maquinaria o el panel QR del coordinador.
        </Text>
      </Card>

      {/* ── La lista ── */}
      {!visibles.length ? (
        <EmptyState title="Sin servicios" subtitle="No hay trabajos registrados con este filtro." />
      ) : visibles.map((o) => {
        const m = machById.get(o.machinery_id);
        const av = o.maintenance_request_id ? reqById.get(o.maintenance_request_id) : undefined;
        return (
          <Card key={o.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14, flex: 1 }}>
                🚜 {etiquetaMaquina(m) || '—'}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>{fmtDMY(o.service_date)}</Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{quienLoHizo(o)}</Text>

            {(o.intervenciones ?? []).length ? (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>
                {(o.intervenciones ?? []).map((k) => etiquetaIntervencion(k, tiposParaEtiquetar)).join(' · ')}
              </Text>
            ) : null}
            {o.problem ? <Text style={{ color: colors.text, fontSize: 12, marginTop: 4 }}>⚠️ {o.problem}</Text> : null}
            {o.work_done ? <Text style={{ color: colors.text, fontSize: 12, marginTop: 2 }}>🔧 {o.work_done}</Text> : null}

            {(o.parts ?? []).length ? (
              <View style={{ marginTop: spacing.xs }}>
                {(o.parts ?? []).slice().sort((a, b) => a.position - b.position).map((p) => (
                  <Text key={p.id} style={{ color: colors.muted, fontSize: 11 }}>
                    🔩 {p.quantity ?? '—'} · {p.description}{p.estado ? ` (${p.estado})` : ''}
                  </Text>
                ))}
              </View>
            ) : null}

            {/* LAS DOS VERDADES, juntas. Ver la cabecera del archivo. */}
            {av ? (
              <View style={{ marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                <Text style={{ color: colors.successSoftText, fontSize: 11, fontWeight: '800' }}>
                  ✅ Atendida en taller — avería del {fmtDMY(av.created_at)}
                </Text>
                {av.status === 'pendiente' ? (
                  <Text style={{ color: colors.warningSoftText, fontSize: 11 }}>
                    ⏳ El sistema la sigue viendo pendiente
                  </Text>
                ) : null}
              </View>
            ) : null}

            {(o.photos ?? []).length ? (
              <ScrollView horizontal style={{ marginTop: spacing.xs }}>
                {(o.photos ?? []).map((u) => (
                  <Image key={u} source={{ uri: u }} style={{ width: 68, height: 68, borderRadius: radius.sm, marginRight: 6 }} />
                ))}
              </ScrollView>
            ) : null}

            {/* ⭐ QUIÉN LO EDITÓ DE ÚLTIMO. Solo aparece si de verdad se editó
                alguna vez (`updated_at` en NULL = nadie lo ha tocado). No se
                inventa una línea «editado por —» para los que están intactos. */}
            {o.updated_at ? (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs, fontStyle: 'italic' }}>
                ✏️ Última edición: {(o.updated_by ? nombres[o.updated_by] : '') || 'alguien'} · {fmtFechaHora(o.updated_at)}
              </Text>
            ) : null}

            {/* ⭐ UNA SOLA HOJA — la de ESTE servicio. Lo pidió el taller: el botón
                de arriba saca todo lo del filtro; este saca exactamente lo que se
                está mirando, sin ficha técnica y sin arrastrar nada más. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => exportarUna(o)} disabled={busy} style={{ opacity: busy ? 0.5 : 1 }}>
                <Text style={{ color: colors.brand, fontSize: 12, fontWeight: '800' }}>📄 Solo esta hoja</Text>
              </TouchableOpacity>
              {canWrite ? (
                <TouchableOpacity onPress={() => abrirEditar(o)} disabled={busy} style={{ opacity: busy ? 0.5 : 1 }}>
                  <Text style={{ color: colors.brand, fontSize: 12, fontWeight: '800' }}>✏️ Editar</Text>
                </TouchableOpacity>
              ) : null}
              {/* El historial lo puede ver CUALQUIERA que entre a la pestaña,
                  tenga o no permiso de escribir: saber quién cambió un registro
                  es justamente lo que necesita el que solo mira. */}
              {o.updated_at ? (
                <TouchableOpacity onPress={() => verCambios(o)}>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800' }}>🕓 Ver cambios</Text>
                </TouchableOpacity>
              ) : null}
              {canWrite ? (
                <TouchableOpacity onPress={() => borrar(o)}>
                  <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>🗑 Borrar</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </Card>
        );
      })}

      {/* ── 🕓 La bitácora de un servicio ── */}
      <Modal visible={!!historial} transparent animationType="slide" onRequestClose={() => setHistorial(null)}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, maxHeight: '85%' }}>
            <SectionTitle>🕓 Cambios de este servicio</SectionTitle>
            {historial ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
                🚜 {etiquetaMaquina(machById.get(historial.orden.machinery_id)) || '—'} · {fmtDMY(historial.orden.service_date)}
              </Text>
            ) : null}

            <ScrollView>
              {historial?.error ? (
                <Text style={{ color: colors.warningSoftText, fontSize: 12, fontWeight: '700' }}>⚠️ {historial.error}</Text>
              ) : historial?.filas == null ? (
                <Loading />
              ) : !historial.filas.length ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Este servicio se editó, pero el detalle de esa edición no quedó guardado.
                </Text>
              ) : historial.filas.map((f) => (
                <Card key={f.id}>
                  <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
                    ✏️ {f.edited_by_name || (f.edited_by ? nombres[f.edited_by] : '') || 'Alguien'}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>{fmtFechaHora(f.edited_at)}</Text>
                  {(f.changes ?? []).map((c, i) => (
                    <View key={`${f.id}-${i}`} style={{ marginTop: 3 }}>
                      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>{c.etiqueta}</Text>
                      {/* Rojo lo que decía, verde lo que dice ahora: el mismo
                          código de colores que usa la pantalla de Auditoría. */}
                      <Text style={{ fontSize: 12 }}>
                        <Text style={{ color: colors.danger }}>{c.de}</Text>
                        <Text style={{ color: colors.muted }}>{'  →  '}</Text>
                        <Text style={{ color: colors.successSoftText }}>{c.a}</Text>
                      </Text>
                    </View>
                  ))}
                </Card>
              ))}
            </ScrollView>

            <View style={{ marginTop: spacing.sm, marginBottom: spacing.md }}>
              <Boton colors={colors} label="Cerrar" onPress={() => setHistorial(null)} />
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Selector de máquina (filtro) ── */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, maxHeight: '80%' }}>
            <TextInput value={pickerQ} onChangeText={setPickerQ} placeholder="🔎 Nombre, placa o serial…"
              placeholderTextColor={colors.muted}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
            <ScrollView style={{ marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => { setFMaquina(''); setPickerOpen(false); }} style={{ paddingVertical: spacing.sm }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>Todas las máquinas</Text>
              </TouchableOpacity>
              {machines.filter((m) => machineMatches(m, pickerQ)).map((m) => (
                <TouchableOpacity key={m.id} onPress={() => { setFMaquina(m.id); setPickerOpen(false); }} style={{ paddingVertical: spacing.sm }}>
                  <Text style={{ color: colors.text }}>{etiquetaMaquina(m)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Boton colors={colors} disabled={busy} label="Cerrar" onPress={() => setPickerOpen(false)} />
          </View>
        </View>
      </Modal>

      {/* ── El formulario, en el orden del papel ── */}
      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, maxHeight: '92%' }}>
            <ScrollView>
              <SectionTitle>{editandoId ? '✏️ Editar servicio' : '🔧 Registrar servicio'}</SectionTitle>

              {/* 1. DATOS GENERALES */}
              <Text style={{ color: colors.brand, fontWeight: '900', fontSize: 12, marginTop: spacing.sm }}>1. DATOS GENERALES</Text>
              <View style={{ marginTop: spacing.xs }}><DateField value={fecha} onChange={setFecha} placeholder="Fecha" /></View>
              <TouchableOpacity onPress={() => setPickMaquinaForm(true)}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                  🚜 {maquinaId ? etiquetaMaquina(machById.get(maquinaId)) : 'Escoge la máquina…'}
                </Text>
              </TouchableOpacity>

              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: spacing.sm }}>¿Quién lo hizo?</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                {([['interno', '🏭 Interno'], ['externo', '🤝 Externo']] as [ServiceOrigen, string][]).map(([k, label]) => (
                  <TouchableOpacity key={k} onPress={() => setOrigen(k)} style={{ flex: 1, paddingVertical: spacing.sm, alignItems: 'center',
                    borderRadius: radius.md, borderWidth: 1,
                    borderColor: origen === k ? colors.brand : colors.border,
                    backgroundColor: origen === k ? colors.brand : colors.surface }}>
                    <Text style={{ color: origen === k ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {origen === 'interno'
                ? <Entrada colors={colors} label="Operador / Técnico" value={tecnico} onChange={setTecnico} placeholder="Quién de la empresa lo hizo" />
                : <Entrada colors={colors} label="Persona o taller externo" value={proveedor} onChange={setProveedor} placeholder="Nombre de quien lo hizo" />}

              {/* 2. TIPO DE INTERVENCIÓN */}
              <Text style={{ color: colors.brand, fontWeight: '900', fontSize: 12, marginTop: spacing.md }}>2. TIPO DE INTERVENCIÓN</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                {tipos.map((t) => {
                  const on = intervs.includes(t.key);
                  return (
                    <TouchableOpacity key={t.key}
                      onPress={() => setIntervs((prev) => on ? prev.filter((x) => x !== t.key) : [...prev, t.key])}
                      style={{ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1,
                        borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>
                        {on ? '☑ ' : '☐ '}{t.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {canWrite ? (
                // El formulario NO se cierra: lo escrito se conserva y el catálogo
                // se abre ENCIMA (en web gana el último modal montado).
                <TouchableOpacity onPress={abrirTipos} style={{ marginTop: spacing.xs }}>
                  <Text style={{ color: colors.brand, fontWeight: '800', fontSize: 11.5 }}>⚙️ Administrar los tipos…</Text>
                </TouchableOpacity>
              ) : null}

              {/* 3. DESCRIPCIÓN DEL PROBLEMA */}
              <Text style={{ color: colors.brand, fontWeight: '900', fontSize: 12, marginTop: spacing.md }}>3. DESCRIPCIÓN DEL PROBLEMA</Text>
              <Entrada colors={colors} label="" value={problema} onChange={setProblema} multiline placeholder="Qué le pasaba a la máquina" />

              {averiasDe.length ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>¿Atiende una avería reportada? (opcional)</Text>
                  <TouchableOpacity onPress={() => setAveriaId('')} style={{ paddingVertical: 6 }}>
                    <Text style={{ color: !averiaId ? colors.brand : colors.muted, fontSize: 12, fontWeight: !averiaId ? '800' : '400' }}>
                      {!averiaId ? '◉' : '○'} Ninguna
                    </Text>
                  </TouchableOpacity>
                  {/* Las YA CERRADAS van marcadas con todas sus letras. Salen en
                      la lista a propósito (ver `averiasDe`: el inspector cierra el
                      martes y el mecánico llena la hoja el miércoles), pero quien
                      elige tiene que ver de un vistazo cuál sigue abierta y cuál
                      no — si no, el desplegable se vuelve una trampa. */}
                  {averiasDe.map((r) => {
                    const cerrada = r.status !== 'pendiente';
                    return (
                      <TouchableOpacity key={r.id} onPress={() => setAveriaId(r.id)} style={{ paddingVertical: 6 }}>
                        <Text style={{ color: averiaId === r.id ? colors.brand : colors.muted, fontSize: 12, fontWeight: averiaId === r.id ? '800' : '400' }}>
                          {averiaId === r.id ? '◉' : '○'} {cerrada ? '✓ (ya cerrada) ' : ''}{fmtDMY(r.created_at)} · {r.material}{r.notes ? ` · ${r.notes}` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  {/* ⭐ LA CASILLA QUE CIERRA EL PAPEL —y SOLO el papel.
                      Sale marcada porque es lo que pasa casi siempre: si el
                      mecánico se sentó a llenar la hoja, el trabajo se hizo.
                      Se apaga para el caso contrario, que también existe: la
                      máquina volvió con el mismo problema y el reporte tiene que
                      seguir vivo hasta que de verdad se resuelva.
                      Sobre una avería que YA está cerrada no hay nada que cerrar,
                      así que ahí la casilla ni se marca ni se deja tocar: prometer
                      algo que no va a pasar es peor que no ofrecerlo. */}
                  {averiaId ? (
                    <TouchableOpacity onPress={() => setCerrarAveria((v) => !v)} activeOpacity={0.8}
                      disabled={!averiaSelPendiente}
                      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: spacing.xs,
                        opacity: averiaSelPendiente ? 1 : 0.55 }}>
                      <Text style={{ fontSize: 15 }}>{vaACerrarAveria ? '☑️' : '⬜'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
                          ✓ Dar por atendida esta avería
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 2 }}>
                          {averiaSelPendiente
                            ? 'No cambia el estado de la máquina. Eso lo sigue decidiendo Control de Maquinaria o el coordinador por QR.'
                            : 'Esta avería ya está cerrada: no hay nada que cerrar. Enlazarla solo deja constancia de qué trabajo la atendió.'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ) : null}

                  <Text style={{ color: colors.muted, fontSize: 10, marginTop: spacing.xs }}>
                    Enlazarla deja constancia de cuál trabajo atendió ese reporte. La máquina no cambia de estado por esto.
                  </Text>
                </View>
              ) : null}

              {/* 4. ACCIONES REALIZADAS */}
              <Text style={{ color: colors.brand, fontWeight: '900', fontSize: 12, marginTop: spacing.md }}>4. ACCIONES REALIZADAS</Text>
              <Entrada colors={colors} label="" value={acciones} onChange={setAcciones} multiline placeholder="Qué se le hizo" />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
                <TouchableOpacity disabled={!maquinaId || busy}
                  onPress={async () => {
                    const r = await captureAndUploadPhoto(maquinaId, 'servicio');
                    // Mismo motivo que en `guardar`: dentro del formulario un toast no se ve.
                    if (r.ok && r.url) setFotos((p) => [...p, r.url!]); else if (r.error) setFormError(r.error);
                  }}
                  style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md,
                    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, opacity: maquinaId ? 1 : 0.5 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>📷 Foto de referencia</Text>
                </TouchableOpacity>
                {fotos.length ? <Text style={{ color: colors.muted, fontSize: 12 }}>{fotos.length} foto(s)</Text> : null}
              </View>

              {/* 5. REPUESTOS UTILIZADOS */}
              <Text style={{ color: colors.brand, fontWeight: '900', fontSize: 12, marginTop: spacing.md }}>5. REPUESTOS UTILIZADOS</Text>
              {renglones.map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, alignItems: 'center' }}>
                  <TextInput value={r.quantity} keyboardType="numeric" placeholder="Cant."
                    placeholderTextColor={colors.muted}
                    onChangeText={(v) => setRenglones((p) => p.map((x, j) => j === i ? { ...x, quantity: v } : x))}
                    style={{ width: 58, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                  <TextInput value={r.description} placeholder="Descripción del repuesto / insumo"
                    placeholderTextColor={colors.muted}
                    onChangeText={(v) => setRenglones((p) => p.map((x, j) => j === i ? { ...x, description: v } : x))}
                    style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                  <TouchableOpacity
                    onPress={() => setRenglones((p) => p.map((x, j) => j === i
                      ? { ...x, estado: ESTADOS_REPUESTO[(ESTADOS_REPUESTO.indexOf(x.estado) + 1) % ESTADOS_REPUESTO.length] } : x))}
                    style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>{r.estado}</Text>
                  </TouchableOpacity>
                  {renglones.length > 1 ? (
                    <TouchableOpacity onPress={() => setRenglones((p) => p.filter((_, j) => j !== i))}>
                      <Text style={{ color: colors.danger, fontSize: 16 }}>🗑</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
              <TouchableOpacity onPress={() => setRenglones((p) => [...p, { ...RENGLON_VACIO }])} style={{ marginTop: spacing.xs }}>
                <Text style={{ color: colors.brand, fontWeight: '800', fontSize: 12 }}>+ Agregar renglón</Text>
              </TouchableOpacity>

              {/* Lo que salió mal, JUSTO ENCIMA del botón que falló y sin desaparecer
                  solo: antes iba a un `toast` que la propia ventana tapaba, así que
                  guardar fallaba en silencio. Se toca para cerrarlo. */}
              {formError ? (
                <TouchableOpacity activeOpacity={0.85} onPress={() => setFormError(null)}
                  style={{ marginTop: spacing.md, backgroundColor: colors.dangerSoftBg, borderWidth: 1,
                    borderColor: colors.dangerSoftBorder, borderRadius: radius.md, padding: spacing.sm }}>
                  <Text style={{ color: colors.dangerSoftText, fontWeight: '800', fontSize: 12.5 }}>⚠️ No se pudo guardar</Text>
                  <Text style={{ color: colors.dangerSoftText, fontSize: 12, marginTop: 2 }}>{formError}</Text>
                  <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 4 }}>Toca este aviso para cerrarlo.</Text>
                </TouchableOpacity>
              ) : null}

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md }}>
                {/* ⚠️ CANCELAR NO LLEVA `disabled={busy}`, A PROPÓSITO. Lo llevaba,
                    y con eso los DOS botones se apagaban a la vez: si el guardado
                    se quedaba colgado, la única salida de la ventana era recargar
                    la app. Salir nunca puede estar bloqueado — lo peor que puede
                    pasar tocándolo mientras se guarda es que el guardado termine
                    igual (el `finally` levanta el bloqueo) y la lista se recargue
                    sola con lo que quedó. */}
                <View style={{ flex: 1 }}><Boton colors={colors} label="Cancelar" onPress={() => { setFormOpen(false); limpiarForm(); }} /></View>
                <View style={{ flex: 1 }}><Boton colors={colors} disabled={busy} label={busy ? 'Guardando…' : (editandoId ? '💾 Guardar cambios' : '💾 Guardar')} tone="brand" onPress={guardar} /></View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Selector de máquina (formulario) ── */}
      <Modal visible={pickMaquinaForm} transparent animationType="slide" onRequestClose={() => setPickMaquinaForm(false)}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, maxHeight: '80%' }}>
            <TextInput value={pickerQ} onChangeText={setPickerQ} placeholder="🔎 Nombre, placa o serial…"
              placeholderTextColor={colors.muted}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
            <ScrollView style={{ marginTop: spacing.sm }}>
              {machines.filter((m) => machineMatches(m, pickerQ)).map((m) => (
                <TouchableOpacity key={m.id} onPress={() => { setMaquinaId(m.id); setAveriaId(''); setPickMaquinaForm(false); }} style={{ paddingVertical: spacing.sm }}>
                  <Text style={{ color: colors.text }}>{etiquetaMaquina(m)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Boton colors={colors} disabled={busy} label="Cerrar" onPress={() => setPickMaquinaForm(false)} />
          </View>
        </View>
      </Modal>

      {/* ── ⚙️ Tipos de intervención (crear · renombrar · desactivar) ──
          Va DE ÚLTIMO en el archivo a propósito: en web todos los Modal salen
          con el mismo z-index y se apilan en el orden en que se montan, así que
          este entra encima del formulario si se abre desde ahí. */}
      <Modal visible={tiposOpen} transparent animationType="slide" onRequestClose={() => setTiposOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end', zIndex: 9999 }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, maxHeight: '92%' }}>
            <ScrollView>
              <SectionTitle>⚙️ Tipos de intervención</SectionTitle>
              <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>
                Son las casillas de «2. TIPO DE INTERVENCIÓN» del formulario de servicios.
                Lo que cambies aquí se ve de una vez en el formulario, en la lista y en el PDF.
              </Text>

              {faltaTablaTipos ? (
                /* La tabla nace de correr el SQL a mano. Mientras tanto la pantalla
                   trabaja igual con los cuatro de siempre — pero aquí sí hay que
                   decirlo, porque este es el sitio donde la gente viene a cambiarlos. */
                <View style={{ marginTop: spacing.md, backgroundColor: colors.warningSoftBg, borderWidth: 1,
                  borderColor: colors.warningSoftBorder, borderRadius: radius.md, padding: spacing.sm }}>
                  <Text style={{ color: colors.warningSoftText, fontWeight: '800', fontSize: 12.5 }}>
                    ⏳ Todavía no está creada la tabla de tipos de intervención
                  </Text>
                  <Text style={{ color: colors.warningSoftText, fontSize: 12, marginTop: 4 }}>
                    Pídele al administrador que corra `supabase/servicio_tipos_intervencion.sql`
                    en Supabase (SQL Editor). Es una sola vez.
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>
                    Mientras tanto no se pierde nada: el formulario sigue trabajando con los cuatro
                    tipos de siempre ({tipos.map((t) => t.label).join(' · ')}).
                  </Text>
                </View>
              ) : (
                <>
                  {!listaTipos.length ? (
                    <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: spacing.md }}>
                      El catálogo está vacío, así que el formulario está mostrando los cuatro tipos de
                      siempre ({tipos.map((t) => t.label).join(' · ')}). Agrégalos aquí abajo si quieres
                      administrarlos desde la app.
                    </Text>
                  ) : null}

                  {/* El catálogo, uno por renglón. Activos primero. */}
                  {listaTipos.map((t) => {
                    const b = borradorDe(t);
                    return (
                      <View key={t.id} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border,
                        borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface, opacity: t.active ? 1 : 0.62 }}>
                        <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                          <TextInput value={b.orden} keyboardType="numeric" placeholder="Nº"
                            placeholderTextColor={colors.muted}
                            onChangeText={(v) => setBorradores((p) => ({ ...p, [t.id]: { ...b, orden: v } }))}
                            style={{ width: 52, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
                              borderRadius: radius.md, padding: spacing.sm, color: colors.text, textAlign: 'center' }} />
                          <TextInput value={b.label} placeholder="Nombre del tipo"
                            placeholderTextColor={colors.muted}
                            onChangeText={(v) => setBorradores((p) => ({ ...p, [t.id]: { ...b, label: v } }))}
                            style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
                              borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 4 }}>
                          clave: {t.key}{t.active ? '' : ' · 🚫 desactivado, no sale en el formulario'}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                          <View style={{ flex: 1 }}>
                            <Boton colors={colors} disabled={busy} label="💾 Guardar" onPress={() => guardarTipo(t)} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Boton colors={colors} disabled={busy}
                              label={t.active ? '🚫 Desactivar' : '↩️ Reactivar'}
                              onPress={() => cambiarActivo(t)} />
                          </View>
                        </View>
                      </View>
                    );
                  })}

                  {/* Agregar uno nuevo */}
                  <Text style={{ color: colors.brand, fontWeight: '900', fontSize: 12, marginTop: spacing.md }}>➕ AGREGAR UN TIPO</Text>
                  <Entrada colors={colors} label="Nombre" value={nuevoNombre} onChange={setNuevoNombre}
                    placeholder="Ej.: Soldadura, Aire acondicionado…" />
                  <Entrada colors={colors} label="Clave (opcional)" value={nuevaClave} onChange={setNuevaClave}
                    placeholder={claveDesdeTexto(nuevoNombre) || 'se arma sola con el nombre'} />
                  <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 3 }}>
                    Se guardará con la clave «{claveDesdeTexto(nuevaClave || nuevoNombre) || '—'}». La clave no se puede
                    cambiar después: es lo que queda escrito dentro de cada servicio. El nombre sí, cuando quieras.
                  </Text>
                  <View style={{ marginTop: spacing.sm }}>
                    <Boton colors={colors} disabled={busy} tone="brand"
                      label={busy ? 'Guardando…' : '➕ Agregar tipo'} onPress={crearTipo} />
                  </View>

                  <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: spacing.sm }}>
                    ℹ️ Aquí no se borra nada de verdad: desactivar quita el tipo del formulario pero los servicios
                    que ya lo usaron lo siguen mostrando con su nombre. Si se borrara, esos registros quedarían
                    sin nombre.
                  </Text>
                </>
              )}

              {/* Los avisos van DENTRO del modal: un toast lo taparía esta misma ventana. */}
              {tiposError ? (
                <TouchableOpacity activeOpacity={0.85} onPress={() => setTiposError(null)}
                  style={{ marginTop: spacing.md, backgroundColor: colors.dangerSoftBg, borderWidth: 1,
                    borderColor: colors.dangerSoftBorder, borderRadius: radius.md, padding: spacing.sm }}>
                  <Text style={{ color: colors.dangerSoftText, fontWeight: '800', fontSize: 12.5 }}>⚠️ No se pudo</Text>
                  <Text style={{ color: colors.dangerSoftText, fontSize: 12, marginTop: 2 }}>{tiposError}</Text>
                  <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 4 }}>Toca este aviso para cerrarlo.</Text>
                </TouchableOpacity>
              ) : null}
              {tiposOk ? (
                <TouchableOpacity activeOpacity={0.85} onPress={() => setTiposOk(null)}
                  style={{ marginTop: spacing.sm, backgroundColor: colors.successSoftBg, borderWidth: 1,
                    borderColor: colors.successSoftBorder, borderRadius: radius.md, padding: spacing.sm }}>
                  <Text style={{ color: colors.successSoftText, fontSize: 12, fontWeight: '700' }}>✅ {tiposOk}</Text>
                </TouchableOpacity>
              ) : null}

              <View style={{ marginTop: spacing.lg, marginBottom: spacing.md }}>
                <Boton colors={colors} label="Cerrar" onPress={() => setTiposOpen(false)} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
