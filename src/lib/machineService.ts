// ============================================================================
// SERVICIO DE MAQUINARIA — el registro de lo que se le hizo a una máquina.
//
// Sigue el formulario en papel del cliente («Ficha técnica Jumbo con martillo
// 0488», Golden Touch 1127 C.A.): datos generales, tipo de intervención,
// descripción del problema, acciones realizadas y repuestos utilizados.
//
// ⚠️ SIN DINERO. Este módulo no lleva costos, pagos ni autorizaciones — decisión
//    explícita del cliente (18-ago-2026). Eso lo lleva otra persona por fuera.
//
// ⚠️ LA FRONTERA. `guardarServicio` recibe el cliente Supabase COMO PARÁMETRO,
//    no lo importa. No es un capricho: es lo que permite que
//    `scripts/test-servicio.mjs` le pase un cliente falso y compruebe que
//    guardar un servicio NO escribe en `machinery` ni en `maintenance_requests`.
//    Esa prueba es la razón de ser de la forma de este archivo.
//
//    Los módulos del taller reciben los avisos de avería pero no mueven el
//    estado de la flota: quien saca una máquina de averiada es el coordinador
//    por QR o Control de Maquinaria, que son los que de verdad la ven. Así una
//    pila de reportes sin cerrar no arrastra a las máquinas.
//
// Ver `docs/superpowers/specs/2026-08-18-servicio-maquinaria-design.md`.
// Blindado por `scripts/test-servicio.mjs` (`npm run test:servicio`).
// ============================================================================

/** Quién hizo el trabajo: el equipo de la empresa, o alguien de afuera. */
export type ServiceOrigen = 'interno' | 'externo';

/** «2. Tipo de intervención» del formulario. Se puede marcar más de una. */
export type Intervencion = 'mecanica' | 'electricidad' | 'mangueras' | 'servicio';

export const INTERVENCION_LABEL: Record<Intervencion, string> = {
  mecanica: 'Mecánica',
  electricidad: 'Electricidad',
  mangueras: 'Mangueras / Hidráulica',
  servicio: 'Servicio',
};

/** Lo que ofrece el selector de estado del repuesto. La base NO tiene `check`
 *  sobre esa columna a propósito: si mañana hace falta otro, se agrega acá y
 *  ya — sin migración para poder escribir una palabra. */
export const ESTADOS_REPUESTO = ['Nuevo', 'Usado', 'Reparado', 'Reacondicionado'];

export type ServicePartInput = {
  quantity?: number | string | null;
  description: string;
  estado?: string | null;
};

export type ServiceOrderInput = {
  machineryId: string;
  serviceDate: string;              // AAAA-MM-DD
  origen: ServiceOrigen;
  technician?: string | null;       // obligatorio si origen = 'interno'
  provider?: string | null;         // obligatorio si origen = 'externo'
  intervenciones?: Intervencion[] | null;
  problem?: string | null;
  workDone?: string | null;
  photos?: string[] | null;
  notes?: string | null;
  /** La avería que este trabajo atiende. OPCIONAL, y apuntar a ella NO la modifica. */
  maintenanceRequestId?: string | null;
  createdBy?: string | null;
};

/** Lo mínimo del cliente Supabase que este archivo necesita. Se recibe como
 *  parámetro para que la prueba pueda inyectar uno falso y vigilar la frontera. */
export type SupabaseLike = { from: (tabla: string) => any };

const txt = (v: unknown): string => String(v ?? '').trim();
const txtOrNull = (v: unknown): string | null => txt(v) || null;
const num = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return isFinite(n) && txt(v) !== '' ? n : null;
};

/**
 * ¿Se puede guardar? Devuelve el primer problema EN CRISTIANO, o `null` si está
 * bien. El texto va tal cual a la pantalla: quien lo lee es el encargado del
 * taller, no un programador.
 */
export function validarServicio(inp: ServiceOrderInput): string | null {
  if (!txt(inp.machineryId)) return 'Falta la máquina.';
  if (!txt(inp.serviceDate)) return 'Selecciona la fecha del servicio.';
  if (inp.origen !== 'interno' && inp.origen !== 'externo') return 'Indica si el servicio fue interno o externo.';
  if (inp.origen === 'interno' && !txt(inp.technician)) return 'Indica quién lo hizo (operador / técnico).';
  if (inp.origen === 'externo' && !txt(inp.provider)) return 'Indica el nombre de la persona o taller externo.';
  // Un registro sin problema ni acciones no sirve de nada: no dice qué pasó.
  if (!txt(inp.problem) && !txt(inp.workDone)) return 'Escribe al menos el problema o lo que se hizo.';
  return null;
}

/**
 * Deja los repuestos listos para guardar: descarta los renglones en blanco (el
 * formulario siempre tiene uno vacío al final) y numera el orden, porque sin
 * `position` Postgres los devuelve en cualquier orden y la lista se ve distinta
 * cada vez que se abre.
 */
export function limpiarRepuestos(
  parts: ServicePartInput[] | null | undefined
): { quantity: number | null; description: string; estado: string | null; position: number }[] {
  return (parts ?? [])
    .filter((p) => txt(p?.description) !== '')
    .map((p, i) => ({
      quantity: num(p.quantity),
      description: txt(p.description),
      estado: txtOrNull(p.estado),
      position: i,
    }));
}

/** Arma la fila de `machinery_service_orders`. PURA: no escribe nada. */
export function filaServicio(inp: ServiceOrderInput): Record<string, any> {
  return {
    machinery_id: inp.machineryId,
    maintenance_request_id: txtOrNull(inp.maintenanceRequestId),
    service_date: inp.serviceDate,
    origen: inp.origen,
    // Cada origen guarda SOLO su nombre: si alguien llenó los dos campos y
    // cambió de opinión, no queda un dato fantasma contradiciendo al otro.
    technician: inp.origen === 'interno' ? txtOrNull(inp.technician) : null,
    provider: inp.origen === 'externo' ? txtOrNull(inp.provider) : null,
    intervenciones: inp.intervenciones ?? [],
    problem: txtOrNull(inp.problem),
    work_done: txtOrNull(inp.workDone),
    photos: inp.photos ?? [],
    notes: txtOrNull(inp.notes),
    created_by: txtOrNull(inp.createdBy),
  };
}

/** Quién hizo el trabajo, en una línea, para listas y PDF. */
export function quienLoHizo(o: { origen: ServiceOrigen; technician?: string | null; provider?: string | null }): string {
  return o.origen === 'externo'
    ? `🤝 Externo${txt(o.provider) ? ` · ${txt(o.provider)}` : ''}`
    : `🏭 Interno${txt(o.technician) ? ` · ${txt(o.technician)}` : ''}`;
}

/**
 * Guarda el servicio y sus repuestos. **Solo escribe en las dos tablas del
 * módulo.** Si alguna vez alguien agrega acá un `update` a `machinery` o a
 * `maintenance_requests`, la prueba de la frontera lo atrapa.
 */
export async function guardarServicio(
  db: SupabaseLike,
  inp: ServiceOrderInput,
  parts: ServicePartInput[] = []
): Promise<{ error?: string; id?: string }> {
  const problema = validarServicio(inp);
  if (problema) return { error: problema };

  const { data, error } = await db
    .from('machinery_service_orders')
    .insert(filaServicio(inp))
    .select('id')
    .single();
  if (error) return { error: error.message };

  const id = data?.id as string;
  const limpios = limpiarRepuestos(parts);
  if (limpios.length) {
    const { error: ep } = await db
      .from('machinery_service_parts')
      .insert(limpios.map((p) => ({ ...p, service_order_id: id })));
    // El servicio YA quedó guardado. Si fallan los repuestos se avisa pero no se
    // borra nada: perder el registro del trabajo sería peor que perder su lista
    // de piezas, que se puede volver a cargar.
    if (ep) return { id, error: `El servicio se guardó, pero los repuestos no: ${ep.message}` };
  }
  return { id };
}
