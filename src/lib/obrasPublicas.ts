// ============================================================================
// Módulo OBRAS PÚBLICAS — capa de datos AISLADA (tablas op_*).
// El "Supervisor Externo Obras Públicas" gestiona jornadas/averías/paradas/visitas
// de SUS máquinas sin tocar el módulo de inspectores. Este archivo solo habla con
// las tablas op_* y con `machinery` (catálogo/ubicación, que sí es compartida).
// ============================================================================
import { supabase } from './supabase';

/** Un supervisor de obras públicas (usuario con el rol dinámico correspondiente). */
export type OpSupervisor = { id: string; full_name: string };

/** Asignación vigente máquina → supervisor. */
export type OpAssignment = { machinery_id: string; supervisor_id: string; supervisor_name: string };

/**
 * Usuarios que son "Supervisor Externo Obras Públicas": los perfiles cuyo
 * `app_role_id` apunta a un rol dinámico que tiene el módulo `obras_publicas`.
 * No se hardcodea el id del rol — se resuelve por el módulo, así sigue andando
 * si se crea/renombra otro rol de obras públicas.
 */
export async function listOpSupervisors(): Promise<OpSupervisor[]> {
  // Un usuario es "de obras públicas" si tiene el módulo `obras_publicas` por
  // CUALQUIERA de las dos vías de acceso de la app (ver AuthContext):
  //   1) su ROL (dinámico) lo incluye  → app_roles.modules['obras_publicas'] != 'none'
  //   2) un PERMISO por-usuario         → module_permissions(module='obras_publicas', level!='none')
  // Antes solo se miraba (1), así que los usuarios habilitados solo por permiso
  // por-usuario NO aparecían en la lista. Ahora se unen ambas fuentes.
  const [rolesRes, permsRes] = await Promise.all([
    supabase.from('app_roles').select('id, modules'),
    supabase.from('module_permissions').select('user_id, level').eq('module', 'obras_publicas').neq('level', 'none'),
  ]);
  if (rolesRes.error) throw rolesRes.error;
  if (permsRes.error) throw permsRes.error;

  const roleIds = (rolesRes.data ?? [])
    .filter((r: any) => r?.modules && r.modules['obras_publicas'] && r.modules['obras_publicas'] !== 'none')
    .map((r: any) => r.id as string);
  const permUserIds = (permsRes.data ?? []).map((p: any) => p.user_id as string);
  if (!roleIds.length && !permUserIds.length) return [];

  // Perfiles por rol y por permiso (dos consultas, luego se unen sin duplicar).
  const [byRole, byPerm] = await Promise.all([
    roleIds.length
      ? supabase.from('profiles').select('id, full_name, active').in('app_role_id', roleIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    permUserIds.length
      ? supabase.from('profiles').select('id, full_name, active').in('id', permUserIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (byRole.error) throw byRole.error;
  if (byPerm.error) throw byPerm.error;

  const seen = new Set<string>();
  const out: OpSupervisor[] = [];
  [...(byRole.data ?? []), ...(byPerm.data ?? [])].forEach((p: any) => {
    if (p.active === false || seen.has(p.id)) return;
    seen.add(p.id);
    out.push({ id: p.id as string, full_name: (p.full_name as string) ?? '(sin nombre)' });
  });
  out.sort((a, b) => a.full_name.localeCompare(b.full_name, 'es', { sensitivity: 'base' }));
  return out;
}

/** Asignaciones vigentes (una por máquina), con el nombre del supervisor. */
export async function listOpAssignments(): Promise<Map<string, OpAssignment>> {
  const { data, error } = await supabase
    .from('op_machine_supervisors')
    .select('machinery_id, supervisor_id, active, profiles:supervisor_id(full_name)')
    .eq('active', true);
  if (error) throw error;
  const m = new Map<string, OpAssignment>();
  (data ?? []).forEach((r: any) => {
    m.set(r.machinery_id as string, {
      machinery_id: r.machinery_id as string,
      supervisor_id: r.supervisor_id as string,
      supervisor_name: (r.profiles?.full_name as string) ?? '',
    });
  });
  return m;
}

/**
 * Asigna un supervisor a una o varias máquinas (por lote o individual). Cada
 * máquina tiene UN supervisor activo: primero se desactiva el anterior y luego se
 * inserta el nuevo (respeta el índice único parcial `una activa por máquina`).
 */
export async function assignOpSupervisor(
  machineryIds: string[],
  supervisorId: string,
  assignedBy?: string | null,
): Promise<number> {
  const ids = Array.from(new Set(machineryIds.filter(Boolean)));
  if (!ids.length) return 0;
  // 1) Baja las asignaciones activas anteriores de esas máquinas.
  const { error: offErr } = await supabase
    .from('op_machine_supervisors')
    .update({ active: false })
    .in('machinery_id', ids)
    .eq('active', true);
  if (offErr) throw offErr;
  // 2) Inserta la nueva asignación activa.
  const rows = ids.map((machinery_id) => ({
    machinery_id, supervisor_id: supervisorId, assigned_by: assignedBy ?? null, active: true,
  }));
  const { error: insErr } = await supabase.from('op_machine_supervisors').insert(rows);
  if (insErr) throw insErr;
  return ids.length;
}

/** Quita el supervisor de obras públicas de una máquina (deja de reflejarse). */
export async function clearOpAssignment(machineryId: string): Promise<void> {
  const { error } = await supabase
    .from('op_machine_supervisors')
    .update({ active: false })
    .eq('machinery_id', machineryId)
    .eq('active', true);
  if (error) throw error;
}

// ── Vista del supervisor (teléfono): sus máquinas + acciones aisladas ────────

/** IDs de las máquinas asignadas a un supervisor (asignación vigente). */
export async function listMyOpMachineIds(supervisorId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('op_machine_supervisors')
    .select('machinery_id')
    .eq('supervisor_id', supervisorId)
    .eq('active', true);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.machinery_id as string);
}

/** Máquina asignada a un supervisor, con su ficha mínima (para pickers). */
export type OpMyMachine = { id: string; code: string; plate: string | null; serial: string | null };
/** Máquinas asignadas (vigentes) a un supervisor, con código/placa/serial. */
export async function listMyOpMachines(supervisorId: string): Promise<OpMyMachine[]> {
  const ids = await listMyOpMachineIds(supervisorId);
  if (!ids.length) return [];
  const { data, error } = await supabase.from('machinery').select('id, code, plate, serial').in('id', ids);
  if (error) throw error;
  return (data ?? []).map((r: any): OpMyMachine => ({ id: r.id, code: r.code ?? '—', plate: r.plate ?? null, serial: r.serial ?? null }));
}

/**
 * Máquinas EXTERNAS de Obras Públicas (no están en el catálogo `machinery`): las
 * del supervisor + las globales (supervisor_id null). Para el picker de "maquinaria
 * por requerimiento". Ver supabase/op_external_machines.sql.
 */
export async function listOpExternalMachines(supervisorId?: string | null): Promise<OpMyMachine[]> {
  let q = supabase.from('op_external_machines').select('id, code').eq('active', true);
  if (supervisorId) q = q.or(`supervisor_id.eq.${supervisorId},supervisor_id.is.null`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any): OpMyMachine => ({ id: `ext:${r.id}`, code: r.code ?? '—', plate: null, serial: null }));
}

/** Agrega una máquina externa (no toca el catálogo). Devuelve el código guardado. */
export async function addOpExternalMachine(code: string, supervisorId?: string | null): Promise<string | null> {
  const c = (code ?? '').trim();
  if (!c) return null;
  const { error } = await supabase.from('op_external_machines').insert({ code: c, supervisor_id: supervisorId ?? null });
  // 23505 = duplicado (ya existe esa máquina externa) → no es error para el usuario.
  if (error && (error as any).code !== '23505') throw error;
  return c;
}

export type OpRound = {
  machinery_id: string; round_date: string; day_hours: number; night_hours: number;
  jornada_start_at: string | null; jornada_shift: 'day' | 'night' | null;
  m3: number; // m³ removidos por esa máquina ese día (total del día)
};

/** Jornadas op_* de una fecha para un conjunto de máquinas. */
export async function fetchOpRounds(machineryIds: string[], roundDate: string): Promise<Record<string, OpRound>> {
  if (!machineryIds.length) return {};
  const { data, error } = await supabase
    .from('op_machine_rounds')
    .select('machinery_id, round_date, day_hours, night_hours, jornada_start_at, jornada_shift, m3')
    .in('machinery_id', machineryIds).eq('round_date', roundDate);
  if (error) throw error;
  const m: Record<string, OpRound> = {};
  (data ?? []).forEach((r: any) => {
    m[r.machinery_id] = {
      machinery_id: r.machinery_id, round_date: r.round_date,
      day_hours: Number(r.day_hours) || 0, night_hours: Number(r.night_hours) || 0,
      jornada_start_at: r.jornada_start_at, jornada_shift: r.jornada_shift,
      m3: Number(r.m3) || 0,
    };
  });
  return m;
}

/** Suma `delta` m³ al total del día de una máquina (atómico). Devuelve el nuevo total. */
export async function opAddM3(machineryId: string, roundDate: string, delta: number): Promise<number> {
  const { data, error } = await supabase.rpc('op_add_m3', { p_machinery_id: machineryId, p_round_date: roundDate, p_delta: delta });
  if (error) throw error;
  return Number(data) || 0;
}

/** Fija (corrige) el total de m³ del día de una máquina. Devuelve el total guardado. */
export async function opSetM3(machineryId: string, roundDate: string, total: number): Promise<number> {
  const { data, error } = await supabase.rpc('op_set_m3', { p_machinery_id: machineryId, p_round_date: roundDate, p_total: total });
  if (error) throw error;
  return Number(data) || 0;
}

/** m³ TOTALES acumulados (todas las fechas) de un conjunto de máquinas. */
export async function fetchOpM3Total(machineryIds: string[]): Promise<number> {
  if (!machineryIds.length) return 0;
  const { data, error } = await supabase
    .from('op_machine_rounds')
    .select('m3')
    .in('machinery_id', machineryIds);
  if (error) throw error;
  return (data ?? []).reduce((acc: number, r: any) => acc + (Number(r.m3) || 0), 0);
}

// ============================================================================
// M³ REMOVIDOS POR EDIFICIO (13-ago-2026) — reemplaza la captura por máquina.
// "removidos hoy" es manual por edificio; el "acumulado" se fija manual la 1ª vez
// (base) y luego crece con los removidos de días POSTERIORES a la fecha base:
//   acumulado(edif) = base_m3 + Σ removidos(fecha > base_date)
// Ver supabase/op_edificio_removidos.sql.
// ============================================================================
export type OpEdificioResumen = {
  edificio: string;
  removido_hoy: number;            // m³ removidos de la fecha consultada
  acumulado: number;               // base + Σ removidos (fecha > base_date)
  tiene_base: boolean;             // ya tiene un acumulado base fijado
  base_m3: number;
  base_date: string | null;
  supervisor_name: string | null;  // quién registró el removido de hoy
};

/**
 * Resumen por edificio para una fecha: removido del día + acumulado (base+suma).
 * Devuelve un mapa edificio → resumen con TODOS los edificios que tienen base o
 * algún removido (histórico o de hoy).
 */
export async function fetchEdificioResumen(date: string): Promise<Record<string, OpEdificioResumen>> {
  const [rem, bas] = await Promise.all([
    supabase.from('op_edificio_removidos').select('edificio, report_date, m3, supervisor_name'),
    supabase.from('op_edificio_base').select('edificio, base_m3, base_date'),
  ]);
  if (rem.error) throw rem.error;
  if (bas.error) throw bas.error;

  const bases = new Map<string, { base_m3: number; base_date: string }>();
  (bas.data ?? []).forEach((b: any) => bases.set(b.edificio, { base_m3: Number(b.base_m3) || 0, base_date: String(b.base_date) }));

  const porEdif = new Map<string, any[]>();
  (rem.data ?? []).forEach((r: any) => {
    if (!porEdif.has(r.edificio)) porEdif.set(r.edificio, []);
    porEdif.get(r.edificio)!.push(r);
  });

  const out: Record<string, OpEdificioResumen> = {};
  new Set<string>([...porEdif.keys(), ...bases.keys()]).forEach((edif) => {
    const rows = porEdif.get(edif) ?? [];
    const base = bases.get(edif);
    const hoy = rows.filter((r) => r.report_date === date);
    const removido_hoy = hoy.reduce((a, r) => a + (Number(r.m3) || 0), 0);
    const acumulado = base
      ? base.base_m3 + rows.filter((r) => r.report_date > base.base_date).reduce((a, r) => a + (Number(r.m3) || 0), 0)
      : rows.reduce((a, r) => a + (Number(r.m3) || 0), 0);
    out[edif] = {
      edificio: edif, removido_hoy, acumulado,
      tiene_base: !!base, base_m3: base?.base_m3 ?? 0, base_date: base?.base_date ?? null,
      supervisor_name: hoy[0]?.supervisor_name ?? null,
    };
  });
  return out;
}

// Campos del REPORTE DETALLADO por edificio (Fase 2): maquinaria, acarreo, viajes,
// avance, cuerpos, actividades y si el frente fue entregado. Todos opcionales.
export type OpEdificioDetalle = {
  m3_acarreados?: number;
  viajes?: number;
  avance?: number | null;
  maq_en_uso?: string | null;
  maq_inoperativo?: string | null;
  maq_requerimiento?: string | null;
  supervivientes?: number;
  fallecidos?: number;
  actividades?: string | null;
  entregado?: boolean;
};

/** Registro completo por edificio+fecha (removidos + detalle + acumulado calculado). */
export type OpEdificioReporte = OpEdificioDetalle & {
  edificio: string;
  report_date: string;
  m3: number;                    // removidos hoy
  supervisor_name: string | null;
  sub_sector: string | null;     // del catálogo de edificios
  acumulado: number;             // base + Σ removidos posteriores
};

/**
 * Registra/corrige los m³ removidos de un edificio en una fecha (uno por
 * edificio+fecha). Si `base` viene definido, además fija/actualiza el acumulado
 * base del edificio con esa fecha como fecha base (típicamente la 1ª vez).
 * `detalle` (opcional) agrega los campos del reporte detallado (Fase 2).
 */
export async function saveEdificioRemovido(p: {
  edificio: string; date: string; m3: number; base?: number | null;
  supervisorId?: string | null; supervisorName?: string | null;
  detalle?: OpEdificioDetalle;
}): Promise<void> {
  const edificio = (p.edificio ?? '').trim();
  if (!edificio) throw new Error('Falta el edificio.');
  const nowIso = new Date().toISOString();
  const payload: Record<string, any> = {
    edificio, report_date: p.date, m3: p.m3,
    supervisor_id: p.supervisorId ?? null, supervisor_name: p.supervisorName ?? null, updated_at: nowIso,
  };
  if (p.detalle) {
    const d = p.detalle;
    Object.assign(payload, {
      m3_acarreados: d.m3_acarreados ?? 0,
      viajes: d.viajes ?? 0,
      avance: d.avance ?? null,
      maq_en_uso: (d.maq_en_uso ?? '').trim() || null,
      maq_inoperativo: (d.maq_inoperativo ?? '').trim() || null,
      maq_requerimiento: (d.maq_requerimiento ?? '').trim() || null,
      supervivientes: d.supervivientes ?? 0,
      fallecidos: d.fallecidos ?? 0,
      actividades: (d.actividades ?? '').trim() || null,
      entregado: !!d.entregado,
    });
  }
  const { error } = await supabase.from('op_edificio_removidos').upsert(payload, { onConflict: 'edificio,report_date' });
  if (error) throw error;
  if (p.base != null && isFinite(p.base)) {
    const { error: be } = await supabase.from('op_edificio_base').upsert({
      edificio, base_m3: p.base, base_date: p.date, updated_at: nowIso,
    }, { onConflict: 'edificio' });
    if (be) throw be;
  }
}

/**
 * Reporte COMPLETO por edificio de una fecha (todos los campos + sub-sector +
 * acumulado calculado). Para editar el detalle y para el export de WhatsApp.
 */
export async function fetchEdificioReportesDia(date: string): Promise<OpEdificioReporte[]> {
  const [rowsRes, resumen, edifRes] = await Promise.all([
    supabase.from('op_edificio_removidos').select('*').eq('report_date', date),
    fetchEdificioResumen(date),
    supabase.from('edificios').select('name, sub_sector'),
  ]);
  if (rowsRes.error) throw rowsRes.error;
  const sectores = new Map<string, string | null>();
  (edifRes.data ?? []).forEach((e: any) => sectores.set(e.name, (e.sub_sector ?? null) as string | null));
  return (rowsRes.data ?? []).map((r: any): OpEdificioReporte => ({
    edificio: r.edificio, report_date: r.report_date,
    m3: Number(r.m3) || 0,
    m3_acarreados: Number(r.m3_acarreados) || 0,
    viajes: Number(r.viajes) || 0,
    avance: r.avance == null ? null : Number(r.avance),
    maq_en_uso: r.maq_en_uso ?? null,
    maq_inoperativo: r.maq_inoperativo ?? null,
    maq_requerimiento: r.maq_requerimiento ?? null,
    supervivientes: Number(r.supervivientes) || 0,
    fallecidos: Number(r.fallecidos) || 0,
    actividades: r.actividades ?? null,
    entregado: !!r.entregado,
    supervisor_name: r.supervisor_name ?? null,
    sub_sector: sectores.get(r.edificio) ?? null,
    acumulado: resumen[r.edificio]?.acumulado ?? (Number(r.m3) || 0),
  }));
}

/** Borra el removido de un edificio en una fecha (no toca la base/acumulado). */
export async function deleteEdificioRemovido(edificio: string, date: string): Promise<void> {
  const { error } = await supabase.from('op_edificio_removidos').delete().eq('edificio', edificio).eq('report_date', date);
  if (error) throw error;
}

export type OpMaint = { machinery_id: string; tipo: 'averia' | 'parada'; motivo: string | null };

/** Averías/paradas op_* PENDIENTES (avería real gana a la parada). */
export async function fetchOpMaintPending(machineryIds: string[]): Promise<Record<string, OpMaint>> {
  if (!machineryIds.length) return {};
  const { data, error } = await supabase
    .from('op_maintenance')
    .select('machinery_id, material, notes, created_at')
    .in('machinery_id', machineryIds).eq('status', 'pendiente')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const m: Record<string, OpMaint> = {};
  (data ?? []).forEach((r: any) => {
    const tipo = r.material === 'MÁQUINA PARADA' ? 'parada' : 'averia';
    const prev = m[r.machinery_id];
    // avería real tiene prioridad; si ya hay avería no la pisa una parada.
    if (!prev || (prev.tipo === 'parada' && tipo === 'averia')) {
      m[r.machinery_id] = { machinery_id: r.machinery_id, tipo, motivo: r.notes ?? (tipo === 'averia' ? r.material : null) };
    }
  });
  return m;
}

// ── Panel de ADMIN/COORDINADOR: agrega TODO obras públicas (todos los supervisores) ──

/** Máquina de obras públicas con su ficha, ubicación y supervisor asignado. */
export type OpDashMachine = {
  id: string; code: string; plate: string | null; serial: string | null;
  marca: string | null; modelo: string | null; tipo: string | null;
  company_name: string | null; parroquia: string | null; sector: string | null;
  edificio: string | null; // machinery.referencia = EDIFICIO (campo unificado)
  latitude: number | null; longitude: number | null; location_at: string | null;
  supervisor_id: string | null; supervisor_name: string | null;
};
/** Una fila de ronda (para la serie "por día"). */
export type OpDashRoundRow = { machinery_id: string; round_date: string; day_hours: number; night_hours: number; jornada_start_at: string | null };
/** Una visita registrada (para la tabla + serie por día). */
export type OpDashVisit = { machinery_id: string; supervisor_name: string | null; status: string | null; visit_date: string; note: string | null };
/** Todo lo que el dashboard necesita, en una sola carga. */
export type OpDashboard = {
  machines: OpDashMachine[];
  rounds: Record<string, OpRound>;   // jornadas de HOY (roundDate)
  maint: Record<string, OpMaint>;    // averías/paradas PENDIENTES
  roundsRange: OpDashRoundRow[];      // rondas desde fromDate (para la gráfica por día)
  visits: OpDashVisit[];             // visitas desde fromDate, más recientes primero
};

/**
 * Carga AGREGADA para el panel de admin/coordinador de Obras Públicas: reúne TODAS
 * las máquinas asignadas (a cualquier supervisor), sus jornadas de hoy, averías/
 * paradas pendientes, la serie de rondas del rango y las visitas del rango. Todo
 * sale de las tablas op_* + el catálogo `machinery` (compartido solo para ficha/ubicación).
 */
export async function fetchOpDashboard(roundDate: string, fromDate: string): Promise<OpDashboard> {
  const assigns = await listOpAssignments();
  const ids = Array.from(assigns.keys());
  if (!ids.length) return { machines: [], rounds: {}, maint: {}, roundsRange: [], visits: [] };
  const { data: macRows, error: mErr } = await supabase
    .from('machinery')
    .select('id, code, plate, serial, marca, modelo, tipo, parroquia, sector, referencia, latitude, longitude, location_at, company:company_id(name)')
    .in('id', ids);
  if (mErr) throw mErr;
  const machines: OpDashMachine[] = (macRows ?? []).map((r: any) => {
    const a = assigns.get(r.id);
    return {
      id: r.id, code: r.code ?? '—', plate: r.plate ?? null, serial: r.serial ?? null,
      marca: r.marca ?? null, modelo: r.modelo ?? null, tipo: r.tipo ?? null,
      company_name: r.company?.name ?? null, parroquia: r.parroquia ?? null, sector: r.sector ?? null,
      edificio: r.referencia ?? null,
      latitude: r.latitude != null ? Number(r.latitude) : null, longitude: r.longitude != null ? Number(r.longitude) : null,
      location_at: r.location_at ?? null,
      supervisor_id: a?.supervisor_id ?? null, supervisor_name: a?.supervisor_name ?? null,
    };
  });
  const [rounds, maint, rangeRes, visitRes] = await Promise.all([
    fetchOpRounds(ids, roundDate),
    fetchOpMaintPending(ids),
    supabase.from('op_machine_rounds').select('machinery_id, round_date, day_hours, night_hours, jornada_start_at').in('machinery_id', ids).gte('round_date', fromDate),
    supabase.from('op_supervisor_visits').select('machinery_id, supervisor_name, status, visit_date, note').in('machinery_id', ids).gte('visit_date', fromDate).order('visit_date', { ascending: false }).limit(300),
  ]);
  if (rangeRes.error) throw rangeRes.error;
  if (visitRes.error) throw visitRes.error;
  const roundsRange: OpDashRoundRow[] = (rangeRes.data ?? []).map((r: any) => ({
    machinery_id: r.machinery_id, round_date: r.round_date,
    day_hours: Number(r.day_hours) || 0, night_hours: Number(r.night_hours) || 0, jornada_start_at: r.jornada_start_at,
  }));
  const visits: OpDashVisit[] = (visitRes.data ?? []).map((r: any) => ({
    machinery_id: r.machinery_id, supervisor_name: r.supervisor_name ?? null, status: r.status ?? null,
    visit_date: r.visit_date, note: r.note ?? null,
  }));
  return { machines, rounds, maint, roundsRange, visits };
}

// ── Reporte diario de actividades (por supervisora) + base acumulada ─────────

export type OpDailyReport = {
  id?: string;
  report_date: string;
  supervisor_id: string | null;
  supervisor_name: string | null;
  reporte_no: number | null;
  edificio: string | null;
  m3_removidos_dia: number;
  m3_acarreo_dia: number;
  cuerpos_dia: number;
  traslado_camion_dia: number;
  observacion: string | null;
};

export type OpReportSettings = { base_m3: number; base_cuerpos: number; base_date: string | null };

const emptyDaily = (report_date: string, supervisorId: string | null, supervisorName: string | null): OpDailyReport => ({
  report_date, supervisor_id: supervisorId, supervisor_name: supervisorName, reporte_no: null, edificio: null,
  m3_removidos_dia: 0, m3_acarreo_dia: 0, cuerpos_dia: 0, traslado_camion_dia: 0, observacion: null,
});

const rowToDaily = (r: any): OpDailyReport => ({
  id: r.id, report_date: r.report_date, supervisor_id: r.supervisor_id ?? null, supervisor_name: r.supervisor_name ?? null,
  reporte_no: r.reporte_no != null ? Number(r.reporte_no) : null, edificio: r.edificio ?? null,
  m3_removidos_dia: Number(r.m3_removidos_dia) || 0, m3_acarreo_dia: Number(r.m3_acarreo_dia) || 0,
  cuerpos_dia: Number(r.cuerpos_dia) || 0, traslado_camion_dia: Number(r.traslado_camion_dia) || 0,
  observacion: r.observacion ?? null,
});

/** Reporte del día de una supervisora (o vacío si aún no existe). */
export async function fetchMyDailyReport(supervisorId: string | null, reportDate: string, supervisorName?: string | null): Promise<OpDailyReport> {
  if (!supervisorId) return emptyDaily(reportDate, null, supervisorName ?? null);
  const { data, error } = await supabase
    .from('op_daily_reports')
    .select('*')
    .eq('supervisor_id', supervisorId).eq('report_date', reportDate)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToDaily(data) : emptyDaily(reportDate, supervisorId, supervisorName ?? null);
}

/** Crea/actualiza el reporte del día de una supervisora (upsert por supervisor+fecha). */
export async function saveDailyReport(rep: OpDailyReport, userId?: string | null): Promise<OpDailyReport> {
  const payload = {
    report_date: rep.report_date, supervisor_id: rep.supervisor_id, supervisor_name: rep.supervisor_name,
    reporte_no: rep.reporte_no, edificio: rep.edificio, m3_removidos_dia: rep.m3_removidos_dia, m3_acarreo_dia: rep.m3_acarreo_dia,
    cuerpos_dia: rep.cuerpos_dia, traslado_camion_dia: rep.traslado_camion_dia, observacion: rep.observacion,
    recorded_by: userId ?? null, updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('op_daily_reports')
    .upsert(payload, { onConflict: 'supervisor_id,report_date' })
    .select('*').single();
  if (error) throw error;
  return rowToDaily(data);
}

/** Reportes diarios (de todas las supervisoras) desde una fecha, para el dashboard. */
export async function fetchOpDailyReports(fromDate: string): Promise<OpDailyReport[]> {
  const { data, error } = await supabase
    .from('op_daily_reports')
    .select('*')
    .gte('report_date', fromDate)
    .order('report_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToDaily);
}

/** Acumulados "desde inicio" = base + suma de reportes con fecha > base_date. */
export function computeOpAccumulated(reports: OpDailyReport[], settings: OpReportSettings): { m3: number; cuerpos: number } {
  const cut = settings.base_date;
  let m3 = settings.base_m3, cuerpos = settings.base_cuerpos;
  reports.forEach((r) => {
    if (cut && r.report_date <= cut) return;
    m3 += (r.m3_removidos_dia + r.m3_acarreo_dia);
    cuerpos += r.cuerpos_dia;
  });
  return { m3: Math.round(m3 * 10) / 10, cuerpos };
}

/** Base acumulada de arranque (una fila). */
export async function fetchOpReportSettings(): Promise<OpReportSettings> {
  const { data, error } = await supabase
    .from('op_report_settings')
    .select('base_m3, base_cuerpos, base_date')
    .eq('id', 1).maybeSingle();
  if (error) throw error;
  return {
    base_m3: Number(data?.base_m3) || 0,
    base_cuerpos: Number(data?.base_cuerpos) || 0,
    base_date: data?.base_date ?? null,
  };
}

/** Guarda la base acumulada (solo admin/coordinador). */
export async function saveOpReportSettings(s: OpReportSettings, userId?: string | null): Promise<void> {
  const { error } = await supabase.from('op_report_settings').upsert(
    { id: 1, base_m3: s.base_m3, base_cuerpos: s.base_cuerpos, base_date: s.base_date, updated_by: userId ?? null, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

/** Inicia la jornada op_* de una máquina (turno según la hora). */
export async function opStartJornada(machineryId: string, roundDate: string, shift: 'day' | 'night', userId?: string | null): Promise<void> {
  const { error } = await supabase.from('op_machine_rounds').upsert(
    { machinery_id: machineryId, round_date: roundDate, round_no: 1, jornada_shift: shift, jornada_start_at: new Date().toISOString(), jornada_marked_at: new Date().toISOString(), recorded_by: userId ?? null },
    { onConflict: 'machinery_id,round_date,round_no' },
  );
  if (error) throw error;
}

/** Finaliza la jornada op_* abierta: banca las horas del turno y cierra. */
export async function opFinishJornada(round: OpRound, userId?: string | null): Promise<void> {
  if (!round.jornada_start_at) return;
  const horas = Math.max(0, Math.round(((Date.now() - new Date(round.jornada_start_at).getTime()) / 3600000) * 100) / 100);
  const key = round.jornada_shift === 'night' ? 'night_hours' : 'day_hours';
  const base = round.jornada_shift === 'night' ? round.night_hours : round.day_hours;
  const { error } = await supabase.from('op_machine_rounds').update(
    { [key]: Math.round((base + horas) * 100) / 100, jornada_start_at: null },
  ).eq('machinery_id', round.machinery_id).eq('round_date', round.round_date).eq('round_no', 1);
  if (error) throw error;
}

/** Marca avería (o parada) op_* de una máquina. `material='MÁQUINA PARADA'` = parada. */
export async function opMarkMaint(machineryId: string, material: string, notes: string, shift: 'day' | 'night', roundDate: string, userId?: string | null): Promise<void> {
  const { error } = await supabase.from('op_maintenance').insert({
    machinery_id: machineryId, material, notes: notes || null, status: 'pendiente', shift, round_date: roundDate, requested_by: userId ?? null,
  });
  if (error) throw error;
}

/** Pone la máquina OPERATIVA: resuelve TODAS sus averías/paradas pendientes (op_*).
 *  `fetchOpMaintPending` filtra status='pendiente', así que basta con sacarla de ese
 *  estado (usamos 'resuelto') para que la máquina deje de aparecer averiada/parada. */
export async function opClearMaint(machineryId: string): Promise<void> {
  const { error } = await supabase.from('op_maintenance')
    .update({ status: 'resuelto' })
    .eq('machinery_id', machineryId).eq('status', 'pendiente');
  if (error) throw error;
}

/** Registra una visita/check-in op_* con GPS. */
export async function opRegistrarVisita(inp: { machineryId: string; supervisorId?: string | null; supervisorName?: string | null; visitDate: string; status: string; lat: number | null; lng: number | null; note?: string | null; machineLat?: number | null; machineLng?: number | null }): Promise<void> {
  const { error } = await supabase.from('op_supervisor_visits').insert({
    machinery_id: inp.machineryId, supervisor_id: inp.supervisorId ?? null, supervisor_name: inp.supervisorName ?? null,
    visit_date: inp.visitDate, status: inp.status, lat: inp.lat, lng: inp.lng, note: inp.note ?? null,
    machine_lat: inp.machineLat ?? null, machine_lng: inp.machineLng ?? null,
  });
  if (error) throw error;
}

/**
 * Actualiza la ubicación de la máquina — ÚNICA cosa que este módulo comparte con el
 * resto del sistema. Usa el MISMO RPC que el inspector (`update_machine_location`),
 * que además fija `location_at = now()` y registra el punto en `machinery_locations`.
 * Así la nueva ubicación se ve EN VIVO en el Catálogo (📍 UTM + "hace un momento") y
 * en el Mapa (ambos leen `machinery.latitude/longitude`). Jornada/avería/parada de
 * este módulo NO se comparten (viven en op_*).
 */
export async function updateMachineLocation(machineryId: string, lat: number, lng: number): Promise<void> {
  const { error } = await supabase.rpc('update_machine_location', { p_id: machineryId, p_lat: lat, p_lng: lng });
  if (error) throw error;
}
