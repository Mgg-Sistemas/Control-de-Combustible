// ============================================================================
// 🧾 SERVICIOS — la pestaña donde el encargado deja constancia de lo que se le
// hizo a una máquina, con el formato del formulario en papel del cliente
// («Ficha técnica Jumbo con martillo 0488»).
//
// ⚠️ LA FRONTERA. Esta pantalla NO escribe en `machinery` ni en
//    `maintenance_requests`. Registrar un servicio deja el registro y nada más:
//    no pone la máquina operativa ni cierra la avería. Quien saca una máquina de
//    averiada es el coordinador por QR o Control de Maquinaria, que son los que
//    de verdad la ven. Así una pila de reportes sin cerrar no arrastra a la flota.
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
} from '../lib/machineService';
import { generateMachineServiceReport, MaquinaFicha, ServicioImprimible } from '../lib/machineServiceReport';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const todayISO = () => caracasParts(new Date()).iso;
const fmtDMY = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('T')[0].split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso);
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

  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // ── Filtros ────────────────────────────────────────────────────────────────
  const [fMaquina, setFMaquina] = useState<string>('');   // '' = todas
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState('');

  // ── Formulario ─────────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [fecha, setFecha] = useState(todayISO());
  const [maquinaId, setMaquinaId] = useState('');
  const [origen, setOrigen] = useState<ServiceOrigen>('interno');
  const [tecnico, setTecnico] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [intervs, setIntervs] = useState<string[]>([]);
  const [problema, setProblema] = useState('');
  const [acciones, setAcciones] = useState('');
  const [averiaId, setAveriaId] = useState('');
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
    setOrdenes((data ?? []) as Orden[]);
    setLoading(false);
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

  // Averías pendientes de la máquina elegida, para el desplegable del formulario.
  const averiasDe = useMemo(
    () => reqs.filter((r) => r.machinery_id === maquinaId && r.status === 'pendiente'),
    [reqs, maquinaId]
  );

  const limpiarForm = () => {
    setFecha(todayISO()); setMaquinaId(''); setOrigen('interno');
    setTecnico(''); setProveedor(''); setIntervs([]);
    setProblema(''); setAcciones(''); setAveriaId('');
    setFotos([]); setRenglones([{ ...RENGLON_VACIO }]);
    setFormError(null);
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
    const partes: ServicePartInput[] = renglones.map((r) => ({
      quantity: r.quantity, description: r.description, estado: r.estado,
    }));
    const r = await guardarServicio(supabase as any, inp, partes);
    setBusy(false);
    if (r.error) return setFormError(r.error);
    // El aviso dice la frontera EN EL MOMENTO en que importa: justo cuando el
    // encargado acaba de registrar y podría suponer que la máquina ya se activó.
    toast.success('Servicio registrado. No cambia el estado de la máquina.');
    setFormOpen(false); limpiarForm(); cargar();
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
  const exportar = async () => {
    if (!visibles.length) return toast.error('No hay servicios en el filtro para exportar.');
    setBusy(true);
    try {
      const ids = Array.from(new Set(visibles.map((o) => o.machinery_id)));

      // La ficha técnica necesita campos que la pantalla madre no carga (foto,
      // marca, modelo, lubricación). Se piden SOLO para las máquinas del filtro.
      const { data: fichas } = await supabase
        .from('machinery')
        .select('id, code, plate, serial, identifier, tipo, marca, modelo, photo_url, encargado, last_horometro, horometro_base, oil_type, oil_capacity_l, oil_notes, company:company_id(name)')
        .in('id', ids);
      const fichaById = new Map<string, MaquinaFicha>(
        (fichas ?? []).map((f: any) => [f.id, { ...f, companyName: f.company?.name ?? null }])
      );

      // Los expedientes viejos del taller entran al mismo PDF, marcados como
      // tales: traen menos datos porque no los guardaban.
      const { data: viejos } = await supabase
        .from('machinery_repairs')
        .select('id, machinery_id, out_at, work_done')
        .eq('tipo', 'correctivo')
        .in('machinery_id', ids);

      const dentro = (d?: string | null) => {
        const s = String(d ?? '').slice(0, 10);
        if (!s) return false;
        if (fDesde && s < fDesde) return false;
        if (fHasta && s > fHasta) return false;
        return true;
      };

      const maquinas = ids.map((id) => {
        const nuevos: ServicioImprimible[] = visibles
          .filter((o) => o.machinery_id === id)
          .map((o) => ({
            id: o.id, service_date: o.service_date, origen: o.origen,
            technician: o.technician, provider: o.provider,
            // Al PDF se le mandan los NOMBRES ya resueltos, no las claves: el
            // reporte solo conoce los cuatro de siempre, así que un tipo nuevo
            // («Soldadura») saldría crudo. Resuelto acá, sale bien sin tocar
            // `machineServiceReport.ts` (que ya hace `LABEL[k] ?? k`).
            intervenciones: (o.intervenciones ?? []).map((k) => etiquetaIntervencion(k, tiposParaEtiquetar)),
            problem: o.problem, work_done: o.work_done,
            parts: (o.parts ?? []).slice().sort((a, b) => a.position - b.position)
              .map((p) => ({ quantity: p.quantity, description: p.description, estado: p.estado })),
            averia: o.maintenance_request_id
              ? textoAveria(reqById.get(o.maintenance_request_id)) : null,
          }));
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

      await generateMachineServiceReport({ maquinas, desde: fDesde || undefined, hasta: fHasta || undefined });
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
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}><Boton colors={colors} disabled={busy} label="📄 Exportar PDF" onPress={exportar} /></View>
          {canWrite ? (
            <View style={{ flex: 1 }}><Boton colors={colors} disabled={busy} label="➕ Registrar servicio" tone="brand" onPress={() => { limpiarForm(); setFormOpen(true); }} /></View>
          ) : null}
        </View>
        {canWrite ? (
          <View style={{ marginTop: spacing.sm }}>
            <Boton colors={colors} disabled={busy} label="⚙️ Tipos de intervención" onPress={abrirTipos} />
          </View>
        ) : null}
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>
          ℹ️ Este módulo lleva el registro del trabajo. No cambia el estado de las máquinas ni cierra averías —
          para eso, Control de Maquinaria o el panel QR del coordinador.
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

            {canWrite ? (
              <TouchableOpacity onPress={() => borrar(o)} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
                <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>🗑 Borrar</Text>
              </TouchableOpacity>
            ) : null}
          </Card>
        );
      })}

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
              <SectionTitle>🔧 Registrar servicio</SectionTitle>

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
                  {averiasDe.map((r) => (
                    <TouchableOpacity key={r.id} onPress={() => setAveriaId(r.id)} style={{ paddingVertical: 6 }}>
                      <Text style={{ color: averiaId === r.id ? colors.brand : colors.muted, fontSize: 12, fontWeight: averiaId === r.id ? '800' : '400' }}>
                        {averiaId === r.id ? '◉' : '○'} {fmtDMY(r.created_at)} · {r.material}{r.notes ? ` · ${r.notes}` : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>
                    Enlazarla deja constancia de que se atendió. No la cierra en el resto del sistema.
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
                <View style={{ flex: 1 }}><Boton colors={colors} disabled={busy} label="Cancelar" onPress={() => setFormOpen(false)} /></View>
                <View style={{ flex: 1 }}><Boton colors={colors} disabled={busy} label={busy ? 'Guardando…' : '💾 Guardar'} tone="brand" onPress={guardar} /></View>
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
