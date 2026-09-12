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

/**
 * «2. Tipo de intervención» del formulario. Se puede marcar más de una.
 *
 * ⚠️ EL `(string & {})` NO ES UN ADORNO. Desde el 20-ago-2026 los tipos de
 *    intervención los administra el propio módulo (tabla
 *    `service_intervention_types`), así que una clave puede ser CUALQUIER texto
 *    — 'soldadura', 'aire_acondicionado', lo que el taller necesite. El tipo
 *    efectivo es `string`; los cuatro literales se dejan solo para que el editor
 *    siga sugiriendo los de siempre y para no romper el código que ya existía.
 */
export type Intervencion = 'mecanica' | 'electricidad' | 'mangueras' | 'servicio' | (string & {});

export const INTERVENCION_LABEL: Record<Intervencion, string> = {
  mecanica: 'Mecánica',
  electricidad: 'Electricidad',
  mangueras: 'Mangueras / Hidráulica',
  servicio: 'Servicio',
};

/** Un tipo de intervención tal como lo usa la pantalla (venga de la base o no). */
export type TipoIntervencion = { key: string; label: string; sort_order: number };

/**
 * LOS CUATRO DE SIEMPRE — el respaldo.
 *
 * ⚠️ ESTO ES LO QUE MANTIENE LA APP EN PIE. La tabla `service_intervention_types`
 *    se crea corriendo `supabase/servicio_tipos_intervencion.sql` A MANO. Mientras
 *    nadie lo corra, la consulta falla (`42P01 · relation does not exist`) y la
 *    pantalla tiene que seguir funcionando exactamente igual que antes: con estos
 *    cuatro. Lo mismo si la base no responde o si el catálogo quedó vacío.
 */
export const INTERVENCIONES_POR_DEFECTO: TipoIntervencion[] = [
  { key: 'mecanica', label: INTERVENCION_LABEL.mecanica, sort_order: 10 },
  { key: 'electricidad', label: INTERVENCION_LABEL.electricidad, sort_order: 20 },
  { key: 'mangueras', label: INTERVENCION_LABEL.mangueras, sort_order: 30 },
  { key: 'servicio', label: INTERVENCION_LABEL.servicio, sort_order: 40 },
];

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

// ============================================================================
// EL CATÁLOGO DE TIPOS DE INTERVENCIÓN — todo PURO, sin base de datos.
//
// La pantalla trae las filas de `service_intervention_types` como pueda (o no
// las trae) y estas funciones deciden qué mostrar. Nada de esto puede reventar:
// blindado por `scripts/test-tipos-intervencion.mjs`.
// ============================================================================

/** Acentos que hay que quitar para armar una clave. Sin `String.normalize`, que
 *  no todos los motores de React Native traen. */
const SIN_ACENTO: Record<string, string> = {
  'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'ã': 'a',
  'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e',
  'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
  'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'õ': 'o',
  'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u',
  'ñ': 'n', 'ç': 'c',
};

/**
 * Convierte un nombre en clave: «Aire Acondicionado» → `aire_acondicionado`.
 * La clave es lo que queda GUARDADO para siempre dentro de cada servicio, así
 * que va en minúsculas, sin espacios ni acentos: nada que dependa del teclado
 * de quien la escribió.
 */
export function claveDesdeTexto(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .trim()
    .replace(/[áàäâãéèëêíìïîóòöôõúùüûñç]/g, (c) => SIN_ACENTO[c] ?? c)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Qué tipos de intervención mostrar, a partir de lo que haya devuelto la base.
 *
 * ⚠️ SIN FILAS → LOS CUATRO DE SIEMPRE. Es el caso NORMAL mientras nadie haya
 *    corrido `supabase/servicio_tipos_intervencion.sql`: la consulta falla, la
 *    pantalla manda `null` y aquí no pasa nada raro — el formulario se ve igual
 *    que toda la vida.
 *
 * Con filas: se descartan las desactivadas y la basura (null, objetos a medias,
 * `key` en blanco) y se ordena por `sort_order`, desempatando por nombre.
 * Si al final no quedó NINGUNA (catálogo vacío o con todo desactivado) también
 * se devuelven los cuatro: dejar el formulario sin una sola casilla sería peor.
 */
export function resolverIntervenciones(filas?: unknown): TipoIntervencion[] {
  const limpias: TipoIntervencion[] = [];
  const vistas = new Set<string>();

  for (const f of Array.isArray(filas) ? filas : []) {
    if (!f || typeof f !== 'object') continue;         // null, 'texto', 7…
    const fila = f as Record<string, unknown>;
    if (fila.active === false) continue;               // «borrado» = desactivado
    const key = txt(fila.key);
    if (!key || vistas.has(key)) continue;             // sin clave no hay tipo
    vistas.add(key);
    const orden = Number(fila.sort_order);
    limpias.push({
      key,
      label: txt(fila.label) || key,                   // sin nombre, la clave cruda
      sort_order: isFinite(orden) ? orden : 100,
    });
  }

  if (!limpias.length) return INTERVENCIONES_POR_DEFECTO.map((t) => ({ ...t }));
  return limpias.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'es'));
}

/**
 * El nombre de una clave, para pintarla en la tarjeta o en el PDF.
 *
 * ⚠️ NUNCA devuelve vacío ni `undefined`: si la clave no está en el catálogo
 *    (porque la desactivaron, o porque el SQL todavía no se corrió) se muestra
 *    la clave cruda. Un servicio viejo tiene que seguir diciendo ALGO.
 */
export function etiquetaIntervencion(key: unknown, tipos?: TipoIntervencion[] | null): string {
  const k = txt(key);
  if (!k) return '';
  const enCatalogo = (tipos ?? []).find((t) => t && txt(t.key) === k);
  if (enCatalogo && txt(enCatalogo.label)) return txt(enCatalogo.label);
  const deSiempre = INTERVENCIONES_POR_DEFECTO.find((t) => t.key === k);
  return deSiempre ? deSiempre.label : k;
}

/**
 * ¿Se puede crear/renombrar este tipo? Devuelve el problema EN CRISTIANO o
 * `null` si está bien. Igual que `validarServicio`: el texto va tal cual a la
 * pantalla.
 *
 * Si no se escribe clave, se genera desde el nombre — es lo normal, casi nadie
 * va a querer inventarse una clave a mano.
 */
export function validarTipoIntervencion(
  t: { key?: string | null; label?: string | null } | null | undefined,
  existentes?: { key?: string | null }[] | null
): string | null {
  const label = txt(t?.label);
  if (!label) return 'Escribe el nombre del tipo de intervención.';

  const escrita = txt(t?.key);
  const key = escrita || claveDesdeTexto(label);
  if (!key) return 'El nombre no tiene letras ni números: no se puede armar una clave con él.';
  // Solo se revisa lo que el usuario escribió a mano; lo generado ya viene limpio.
  if (escrita && escrita !== claveDesdeTexto(escrita)) {
    return 'La clave va en minúsculas, sin espacios ni acentos (ejemplo: aire_acondicionado).';
  }
  if ((existentes ?? []).some((e) => txt(e?.key) === key)) {
    return `Ya existe un tipo con la clave «${key}». Usa otro nombre o reactiva el que ya está.`;
  }
  return null;
}

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

// ============================================================================
// EDITAR UN SERVICIO YA REGISTRADO — y dejar constancia de quién y de qué.
//
// Pedido del cliente (26-ago-2026, textual): «necesito la opcion de editar un
// servicio ya existente y que quede el registro de quien fue el ultimo que lo
// edito, y que fue lo que cambio».
//
// Necesita `supabase/servicio_editar.sql` corrido A MANO. Si no se corrió, el
// servicio se guarda igual y lo que falla es SOLO el rastro — y se avisa. Ver
// `editarServicio`.
//
// Todo lo de acá abajo es PURO menos `editarServicio`, para que
// `scripts/test-servicio.mjs` pueda probarlo sin base de datos.
// ============================================================================

/** Un campo que cambió, ya listo para pintar. `de`/`a` son texto para LEER. */
export type Cambio = { campo: string; etiqueta: string; de: string; a: string };

/**
 * Nombre visible de cada campo, en el orden del formulario en papel.
 *
 * ⚠️ El orden de las claves de este objeto ES el orden en que se listan los
 *    cambios. No es casualidad: quien lee la bitácora está viendo el mismo
 *    formulario que llenó, de arriba abajo.
 */
export const CAMPO_SERVICIO_LABEL: Record<string, string> = {
  service_date: 'Fecha del servicio',
  machinery_id: 'Máquina',
  origen: '¿Quién lo hizo?',
  technician: 'Operador / Técnico',
  provider: 'Persona o taller externo',
  intervenciones: 'Tipo de intervención',
  problem: 'Descripción del problema',
  maintenance_request_id: 'Avería que atiende',
  work_done: 'Acciones realizadas',
  photos: 'Fotos de referencia',
  notes: 'Notas',
  repuestos: 'Repuestos utilizados',
};

/** Lo que se muestra cuando un campo está vacío. Un guion, no la palabra "null". */
export const VACIO = '—';

/** AAAA-MM-DD → DD/MM/AAAA. Sin `new Date()`: una fecha suelta no tiene zona
 *  horaria, y construir un Date la corre un día en Venezuela (UTC-4). */
const fechaLegible = (v: unknown): string => {
  const s = txt(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s || VACIO;
};

/** Cómo se ve un repuesto en la bitácora: «2 · FILTRO DE ACEITE (Nuevo)». */
const repuestoLegible = (p: { quantity?: number | null; description?: string; estado?: string | null }): string => {
  const cant = p.quantity == null ? VACIO : String(p.quantity);
  const est = txt(p.estado);
  return `${cant} · ${txt(p.description)}${est ? ` (${est})` : ''}`;
};

const listaLegible = (xs: string[]): string => (xs.length ? xs.join(' · ') : VACIO);

/** Cuenta fotos en cristiano. Las URLs no le dicen nada a nadie. */
const fotosLegible = (xs: unknown): string => {
  const n = Array.isArray(xs) ? xs.length : 0;
  return n === 0 ? 'sin fotos' : n === 1 ? '1 foto' : `${n} fotos`;
};

/** Quién resuelve los ids a nombres. Sin esto se muestra el id recortado, que
 *  no sirve de mucho pero al menos no miente. */
export type NombresParaCambios = {
  maquina?: (id: string) => string;
  intervencion?: (key: string) => string;
  averia?: (id: string) => string;
};

const idCorto = (v: unknown): string => {
  const s = txt(v);
  return s ? s.slice(0, 8) : VACIO;
};

/**
 * ¿Qué cambió entre el servicio de antes y el de ahora?
 *
 * Recibe las DOS FILAS tal como van a la base (las que arma `filaServicio`),
 * no los estados del formulario: así se compara pera con pera y un cambio
 * cosmético en la pantalla no aparece como un cambio de datos.
 *
 * ⚠️ NO compara `created_by` ni `created_at` ni `id` ni `updated_*`: no son del
 *    usuario, son del sistema. Y `updated_at` cambia SIEMPRE, así que incluirlo
 *    haría que toda edición dijera «cambió la fecha de edición» — ruido puro.
 *    Es la misma exclusión que hace el trigger `audit_row()` en Postgres
 *    (`supabase/auditoria_quien_y_cambios.sql:90`).
 */
export function cambiosServicio(opts: {
  antes: Record<string, any> | null | undefined;
  despues: Record<string, any> | null | undefined;
  repuestosAntes?: ServicePartInput[] | null;
  repuestosDespues?: ServicePartInput[] | null;
  nombres?: NombresParaCambios;
}): Cambio[] {
  const a = opts.antes ?? {};
  const b = opts.despues ?? {};
  const n = opts.nombres ?? {};
  const out: Cambio[] = [];

  const push = (campo: string, de: string, aa: string) => {
    if (de === aa) return;
    out.push({ campo, etiqueta: CAMPO_SERVICIO_LABEL[campo] ?? campo, de, a: aa });
  };

  // ── Texto simple ──────────────────────────────────────────────────────────
  const simple = (campo: string, fmt: (v: unknown) => string = (v) => txt(v) || VACIO) => {
    const de = fmt(a[campo]);
    const aa = fmt(b[campo]);
    push(campo, de, aa);
  };

  simple('service_date', fechaLegible);
  simple('machinery_id', (v) => (txt(v) ? (n.maquina ? n.maquina(txt(v)) : idCorto(v)) : VACIO));
  simple('origen', (v) => (txt(v) === 'externo' ? '🤝 Externo' : txt(v) === 'interno' ? '🏭 Interno' : VACIO));
  simple('technician');
  simple('provider');

  // ── Tipos de intervención: se comparan como CONJUNTO ──────────────────────
  // Marcar y desmarcar la misma casilla deja el arreglo en otro orden pero con
  // el mismo contenido. Eso NO es un cambio, y decir que sí lo es llenaría la
  // bitácora de mentiras.
  const intervs = (v: unknown): string => {
    const xs = (Array.isArray(v) ? v : []).map((k) => txt(k)).filter(Boolean);
    const vistos = Array.from(new Set(xs)).sort();
    return listaLegible(vistos.map((k) => (n.intervencion ? n.intervencion(k) : k)));
  };
  push('intervenciones', intervs(a.intervenciones), intervs(b.intervenciones));

  simple('problem');
  simple('maintenance_request_id', (v) =>
    txt(v) ? (n.averia ? n.averia(txt(v)) : idCorto(v)) : 'ninguna'
  );
  simple('work_done');

  // ── Fotos: se detecta por CONTENIDO, se muestra por CANTIDAD ──────────────
  // Las URLs no le dicen nada a una persona; el número sí. Pero si se quitó una
  // y se puso otra, la cuenta no se mueve y el cambio quedaría invisible: por
  // eso, cuando el contenido cambia y la cuenta no, se dice con todas sus letras.
  const fa = (Array.isArray(a.photos) ? a.photos : []).map((x: unknown) => txt(x));
  const fb = (Array.isArray(b.photos) ? b.photos : []).map((x: unknown) => txt(x));
  if (fa.join('\u0000') !== fb.join('\u0000')) {
    const da = fotosLegible(fa);
    const db = fotosLegible(fb);
    out.push({
      campo: 'photos',
      etiqueta: CAMPO_SERVICIO_LABEL.photos,
      de: da,
      a: da === db ? `${db} (distintas)` : db,
    });
  }

  simple('notes');

  // ── Repuestos ─────────────────────────────────────────────────────────────
  // Se limpian los dos lados con la MISMA función que usa el guardado, para que
  // el renglón vacío del final del formulario no cuente como un repuesto que
  // aparece y desaparece en cada edición.
  const ra = limpiarRepuestos(opts.repuestosAntes).map(repuestoLegible);
  const rb = limpiarRepuestos(opts.repuestosDespues).map(repuestoLegible);
  push('repuestos', listaLegible(ra), listaLegible(rb));

  return out;
}

/** Resumen de una línea para la tarjeta: «Fecha del servicio, Repuestos y 2 más». */
export function resumenCambios(cambios: Cambio[] | null | undefined): string {
  const xs = (cambios ?? []).map((c) => c.etiqueta);
  if (!xs.length) return 'sin cambios';
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} y ${xs[1]}`;
  return `${xs[0]}, ${xs[1]} y ${xs.length - 2} más`;
}

/**
 * Arma la fila para EDITAR. Es `filaServicio` menos `created_by`, más el sello
 * de quién editó.
 *
 * ⚠️ `created_by` SE QUITA A PROPÓSITO. Si se mandara, el que edita se
 *    convertiría en el que registró el servicio y se perdería para siempre
 *    quién lo hizo de verdad. Es la misma regla que ya siguen Compras directas
 *    (`ComprasScreen.tsx:465-493`) e Inspecciones: el creador solo se escribe
 *    al crear. La prueba lo vigila.
 */
export function filaServicioEdicion(
  inp: ServiceOrderInput,
  editadoPor?: string | null,
  ahoraIso?: string
): Record<string, any> {
  const fila = filaServicio(inp);
  delete fila.created_by;
  return {
    ...fila,
    updated_by: txtOrNull(editadoPor),
    updated_at: ahoraIso ?? new Date().toISOString(),
  };
}

/** Lo que se le pasa a `editarServicio` sobre QUIÉN está editando. */
export type QuienEdita = {
  /** id del perfil. Va a `updated_by` y a la bitácora. */
  id?: string | null;
  /** Nombre y apellido. Se COPIA a la bitácora para que sobreviva al perfil. */
  nombre?: string | null;
  /** Los cambios ya calculados con `cambiosServicio`. Si va vacío no se
   *  escribe bitácora: una edición que no cambió nada no es una edición. */
  cambios?: Cambio[] | null;
  /** Solo para las pruebas: congela la hora. En producción se omite. */
  ahoraIso?: string;
};

/**
 * Guarda los cambios de un servicio que YA existe, y anota quién y qué.
 *
 * EL ORDEN DE LAS OPERACIONES NO ES CAPRICHOSO
 * ---------------------------------------------------------------------------
 * Los repuestos se REEMPLAZAN (no hay forma de casarlos uno a uno: el
 * formulario no guarda sus ids). Pero se hace al revés de lo que uno escribiría
 * primero:
 *
 *      1) leer los ids de los repuestos que hay hoy
 *      2) INSERTAR los nuevos
 *      3) BORRAR los viejos, por id
 *
 * y NO «borrar todo y luego insertar». Si se borrara primero y el insert
 * fallara (se cayó la red justo ahí), el servicio quedaría SIN repuestos y el
 * taller tendría que volver a escribirlos de memoria. Así, lo peor que puede
 * pasar es que queden repetidos —que se ven y se arreglan editando otra vez—
 * en lugar de perderse.
 *
 * SI FALLA LA BITÁCORA, EL SERVICIO IGUAL SE GUARDA
 * ---------------------------------------------------------------------------
 * Mientras no se corra `supabase/servicio_editar.sql`, la tabla de la bitácora
 * no existe y su insert falla con `42P01`. Eso NO puede tumbar la edición: el
 * trabajo del taller vale más que su rastro. Se devuelve en `avisoBitacora`
 * para que la pantalla lo diga en voz alta, en vez de fingir que quedó grabado.
 */
export async function editarServicio(
  db: SupabaseLike,
  id: string,
  inp: ServiceOrderInput,
  parts: ServicePartInput[] = [],
  quien: QuienEdita = {}
): Promise<{ error?: string; avisoBitacora?: string }> {
  if (!txt(id)) return { error: 'Falta el servicio que se va a editar.' };
  const problema = validarServicio(inp);
  if (problema) return { error: problema };

  // 1) Qué repuestos hay ahora mismo. Se leen de la base y no se confía en lo
  //    que traiga la pantalla: si otra persona editó el servicio mientras este
  //    tenía el formulario abierto, borrar por una lista vieja dejaría filas
  //    sueltas para siempre.
  const { data: viejos, error: eLeer } = await db
    .from('machinery_service_parts')
    .select('id')
    .eq('service_order_id', id);
  if (eLeer) return { error: eLeer.message };

  // 2) La orden.
  const { error: eOrden } = await db
    .from('machinery_service_orders')
    .update(filaServicioEdicion(inp, quien.id, quien.ahoraIso))
    .eq('id', id);
  if (eOrden) return { error: eOrden.message };

  // 3) Los repuestos nuevos, antes de tocar los viejos.
  const limpios = limpiarRepuestos(parts);
  if (limpios.length) {
    const { error: eIns } = await db
      .from('machinery_service_parts')
      .insert(limpios.map((p) => ({ ...p, service_order_id: id })));
    if (eIns) {
      return { error: `Se guardaron los datos del servicio, pero los repuestos no: ${eIns.message}` };
    }
  }

  // 4) Y ahora sí, fuera los viejos.
  const idsViejos = ((viejos ?? []) as any[]).map((r) => r?.id).filter(Boolean);
  if (idsViejos.length) {
    const { error: eDel } = await db
      .from('machinery_service_parts')
      .delete()
      .in('id', idsViejos);
    if (eDel) {
      return { error: `Se guardó el servicio, pero los repuestos viejos quedaron repetidos: ${eDel.message}` };
    }
  }

  // 5) La bitácora. Lo último, y sin poder tumbar nada de lo anterior.
  const cambios = quien.cambios ?? [];
  if (cambios.length) {
    const { error: eBit } = await db.from('machinery_service_edits').insert({
      service_order_id: id,
      edited_by: txtOrNull(quien.id),
      edited_by_name: txtOrNull(quien.nombre),
      changes: cambios,
      ...(quien.ahoraIso ? { edited_at: quien.ahoraIso } : {}),
    });
    if (eBit) {
      return {
        avisoBitacora: /does not exist|42P01|schema cache/i.test(eBit.message)
          ? 'El servicio se guardó, pero NO quedó registrado quién lo editó: falta correr «supabase/servicio_editar.sql» en Supabase.'
          : `El servicio se guardó, pero no se pudo anotar el cambio: ${eBit.message}`,
      };
    }
  }

  return {};
}

// ============================================================================
// CERRAR LA AVERÍA QUE EL TRABAJO ATENDIÓ
//
// LA REGLA, en una línea: **el taller manda sobre el PAPEL, nunca sobre la
// MÁQUINA.** Son tres cosas distintas y hasta ahora estaban enredadas en una:
//
//   · LA MÁQUINA  → ¿está operativa hoy? La deciden Control, el inspector y el
//                   coordinador QR. Este archivo NUNCA la toca. Esa pared se
//                   queda, y `scripts/test-servicio.mjs` la vigila.
//   · EL REPORTE  → ¿alguien atendió esta avería? Lo decide el taller. ACÁ.
//   · EL TRABAJO  → qué se hizo y con qué. Es el registro, no cambia.
//
// Por qué cambió (pedido del cliente, 01-sep-2026): el desacople del 18-ago
// cortó las dos cosas de un solo tajo, y quedaron dos botones del MISMO módulo
// con reglas opuestas — en «⏳ Averías» el botón «✓ Realizado» cerraba, y en
// «🧾 Servicios» registrar el trabajo completo, con repuestos y fotos, no. El
// miedo original («que marcar realizado en un reporte viejo no cambie la
// realidad de la máquina de hoy») lo resuelve la pared de `machinery`, no la de
// `maintenance_requests`: cerrar un papel no dice nada sobre si la máquina sirve.
// ============================================================================

/**
 * Los ÚNICOS tres campos que el taller le escribe a una avería. Está aparte y
 * es puro a propósito: la prueba compara esta fila contra la lista permitida,
 * así que agregarle un campo de más rompe una prueba en vez de romper un dato.
 */
export function filaCierreAveria(uid?: string | null): Record<string, any> {
  return {
    status: 'realizado',
    resolved_by: txtOrNull(uid),
    resolved_at: new Date().toISOString(),
  };
}

/**
 * Cierra la avería que este servicio atendió.
 *
 * ⭐ `.eq('status', 'pendiente')` NO es un detalle: es lo que permite enlazar una
 *    avería que YA está cerrada sin pisar nada. El orden real del taller es que
 *    el inspector cierra en campo el martes y el mecánico llena la hoja el
 *    miércoles; cuando eso pasa, esto no reabre ni reescribe quién la cerró — no
 *    encuentra fila que actualizar y se va en silencio, que es lo correcto.
 *
 * Nunca revienta hacia afuera: el servicio YA quedó guardado cuando esto corre,
 * y perder el registro del trabajo por no poder cerrar el papel sería peor.
 */
export async function cerrarAveriaPorServicio(
  db: SupabaseLike,
  requestId?: string | null,
  uid?: string | null,
): Promise<{ error?: string }> {
  const id = txt(requestId);
  if (!id) return {};
  const { error } = await db
    .from('maintenance_requests')
    .update(filaCierreAveria(uid))
    .eq('id', id)
    .eq('status', 'pendiente');
  return error ? { error: error.message } : {};
}

/**
 * ¿Cuáles de estas averías ya tienen hoja de servicio? Devuelve, por avería, la
 * fecha del trabajo más reciente.
 *
 * Es de SOLO LECTURA y va en la dirección contraria a todo lo demás: es
 * Mantenimiento leyendo lo del taller, para que la tarjeta de una avería pueda
 * decir «🧾 ya tiene hoja de servicio» sin que nadie tenga que saltar de pestaña
 * y volver. Si la consulta falla se devuelve vacío: la lista de averías se pinta
 * igual, solo que sin el aviso.
 */
export async function serviciosPorAveria(
  db: SupabaseLike,
  requestIds: string[],
): Promise<Record<string, string>> {
  const ids = [...new Set((requestIds ?? []).map(txt).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await db
    .from('machinery_service_orders')
    .select('id, service_date, maintenance_request_id')
    .in('maintenance_request_id', ids);
  if (error) return {};
  const out: Record<string, string> = {};
  ((data ?? []) as any[]).forEach((o) => {
    const k = txt(o?.maintenance_request_id);
    const f = txt(o?.service_date).slice(0, 10);
    if (!k || !f) return;
    if (!out[k] || f > out[k]) out[k] = f;   // la más reciente
  });
  return out;
}

// ============================================================================
// LA RAYA EN LA ARENA — los reportes viejos, aparte de los de hoy
//
// Pedido del cliente (01-sep-2026): hay averías de hace meses mezcladas con el
// trabajo del día. Se separan visualmente para que nadie las cierre por
// accidente y para que la lista de hoy sea la lista de hoy. No se borra ni se
// esconde nada: es una sección aparte, plegada.
// ============================================================================

/** Cuántos días tiene que tener un reporte para contar como viejo. */
export const DIAS_REPORTE_VIEJO = 30;

/**
 * ¿Este reporte es de los viejos? Sin fecha legible, NO lo es: ante la duda se
 * queda arriba, a la vista, que es el lado seguro del error.
 */
export function esReporteViejo(
  creadoISO?: string | null,
  hoy: Date = new Date(),
  dias: number = DIAS_REPORTE_VIEJO,
): boolean {
  const t = Date.parse(txt(creadoISO));
  if (!isFinite(t)) return false;
  return (hoy.getTime() - t) > dias * 24 * 60 * 60 * 1000;
}
