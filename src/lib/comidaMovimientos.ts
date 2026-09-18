// QUIÉN TOCÓ LAS COMIDAS Y CUÁNDO (18-sep-2026).
//
// Pedido del cliente: «que quede un registro de quién borró y cuándo borró
// cualquier registro de las comidas, o quién creó el nuevo modo de comida o algo
// por el estilo».
//
// ⭐ EL REGISTRO YA EXISTÍA: el trigger `trg_audit` escribe en `audit_log` cada
//    alta, cambio y borrado de `food_distributions` y `food_company_meals`, con
//    quién (auth.uid + nombre), cuándo, y —esto es lo importante— la FILA
//    COMPLETA en `changes` cuando es un borrado (ver supabase/audit_detalle.sql).
//    Lo que faltaba no era guardarlo: era PODER VERLO desde el módulo, porque
//    hasta hoy solo se llegaba por la pantalla de Auditoría, que exige `can_audit`.
//
// Lo que sí faltaba de verdad en la base: `food_extra_items` —el catálogo de
// platos «Otros», que es literalmente «el nuevo modo de comida» del pedido— NO
// tenía trigger. Se agrega en el .sql de esta tanda.
//
// ⚠️ `audit_log.row_label` viene VACÍO para las comidas. El trigger lo resuelve
//    buscando columnas `code`/`name`/`full_name`/`plate`, y estas tablas tienen
//    `company_name` y `employee_name`, que no están en esa lista. Por eso el
//    renglón legible se arma ACÁ, a partir de `changes`, en vez de confiar en la
//    etiqueta de la base.
//
// Sin React ni Supabase: se prueba sola (scripts/test-comida-movimientos.mjs).

/** Una fila de `audit_log`, tal como la devuelve la base. */
export type FilaAuditoria = {
  id?: number | string;
  at: string;
  user_name?: string | null;
  action?: string | null;
  table_name?: string | null;
  row_id?: string | null;
  changes?: Record<string, any> | null;
};

/** Un renglón listo para pintar o imprimir. */
export type MovimientoComida = {
  clave: string;
  /** 'alta' | 'cambio' | 'borrado' */
  tipo: 'alta' | 'cambio' | 'borrado';
  icono: string;
  /** «Agregó», «Corrigió», «Borró». */
  verbo: string;
  quien: string;
  cuando: string;
  /** De qué se trata: «12 almuerzos · COSTA BRAVA · del 14/09». */
  titulo: string;
  /** Qué cambió, cuando es un cambio. Vacío en altas y borrados. */
  detalle: string;
  /** Para ordenar y filtrar sin volver a leer la fecha. */
  at: string;
};

export const SIN_NOMBRE = 'Usuario sin nombre';

/** Las tablas de comida que vigila esta bitácora. */
export const TABLAS_COMIDA = [
  'food_company_meals',
  'food_distributions',
  'food_extra_items',
  'comida_precios',
  'comida_cuentas_config',
] as const;

const limpio = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

const ETIQUETA_COMIDA: Record<string, string> = {
  desayuno: 'desayuno', almuerzo: 'almuerzo', lunch: 'lunch', cena: 'cena', otros: 'otros',
};

/** Fecha corta del día de una comida: 14/09. */
function diaCorto(iso: unknown): string {
  const s = limpio(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}/${m}` : s;
}

/**
 * FECHA Y HORA DE CARACAS, escrita.
 *
 * ⚠️ La zona va puesta, no se toma la del teléfono: una bitácora en UTC dice que
 *    alguien borró a mediodía lo que borró a las 8 de la mañana, y la hora es
 *    justo el dato que se va a discutir cuando falte una comida.
 */
export function fechaHoraCaracas(iso: unknown): string {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '—';
  const f = new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const h = new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
  return `${f} · ${h}`;
}

/** En un UPDATE `changes` es {campo:{de,a}}; en alta/borrado es la fila entera. */
const esCambioPorCampos = (c: Record<string, any> | null | undefined): boolean => {
  if (!c) return false;
  const vals = Object.values(c);
  return vals.length > 0 && vals.every((v) => v && typeof v === 'object' && !Array.isArray(v) && ('de' in v || 'a' in v));
};

/** El valor de un campo, venga de una fila entera o de un {de,a}. */
const valorDespues = (c: Record<string, any> | null | undefined, campo: string): unknown => {
  if (!c) return undefined;
  const v = c[campo];
  if (v && typeof v === 'object' && !Array.isArray(v) && ('de' in v || 'a' in v)) return (v as any).a;
  return v;
};
const valorAntes = (c: Record<string, any> | null | undefined, campo: string): unknown => {
  if (!c) return undefined;
  const v = c[campo];
  if (v && typeof v === 'object' && !Array.isArray(v) && ('de' in v || 'a' in v)) return (v as any).de;
  return v;
};

/** De la categoría `plato_…` de un precio al nombre del plato (lo arma comidaPlatos.ts). */
export type NombreCategoria = ((categoria: string) => string | null) | null | undefined;

/** El nombre que se lee en el renglón, por tabla. */
function tituloDe(f: FilaAuditoria, nombreCategoria?: NombreCategoria): string {
  const c = f.changes;
  const t = limpio(f.table_name);
  const leer = (campo: string) => valorDespues(c, campo) ?? valorAntes(c, campo);

  if (t === 'food_company_meals') {
    const n = Number(leer('delivered') ?? 0) || 0;
    const comida = ETIQUETA_COMIDA[limpio(leer('meal_type'))] ?? limpio(leer('meal_type'));
    const plato = limpio(leer('item_label'));
    const emp = limpio(leer('company_name')) || 'empresa sin nombre';
    const dia = diaCorto(leer('meal_date'));
    const que = plato ? `${comida} (${plato})` : comida;
    return `${n} ${que || 'comida(s)'} · 🏢 ${emp}${dia ? ` · del ${dia}` : ''}`;
  }

  if (t === 'food_distributions') {
    const n = Number(leer('meals') ?? 0) || 0;
    const comida = ETIQUETA_COMIDA[limpio(leer('meal_type'))] ?? limpio(leer('meal_type'));
    const per = limpio(leer('employee_name')) || 'persona sin nombre';
    const dia = diaCorto(leer('distribution_date'));
    return `${n} ${comida || 'comida(s)'} · 👤 ${per}${dia ? ` · del ${dia}` : ''}`;
  }

  if (t === 'food_extra_items') {
    return `🍰 Plato «${limpio(leer('name')) || 'sin nombre'}»`;
  }

  if (t === 'comida_precios') {
    // El precio de un plato se guarda como `plato_…` (la columna no admite su
    // nombre): sin traducirlo, la bitácora diría «Precio de plato_3f2a…».
    const raw = limpio(leer('categoria'));
    const nombre = raw ? nombreCategoria?.(raw) : null;
    const cat = nombre ? `🧾 ${nombre}` : raw.startsWith('plato_') ? 'un plato' : raw || 'comida';
    const p = leer('precio');
    return `💲 Precio de ${cat}${p !== undefined && p !== null ? ` · $${p}` : ''}`;
  }

  if (t === 'comida_cuentas_config') {
    const clave = limpio(leer('clave')) || 'cuenta';
    return `👤 Cuenta ${clave}`;
  }

  return `Registro ${limpio(f.row_id).slice(0, 8)}`;
}

const CAMPO: Record<string, string> = {
  delivered: 'platos', meals: 'comidas', unit_cost: 'costo por plato', item_label: 'nombre del plato',
  note: 'nota', meal_type: 'comida', meal_date: 'día', distribution_date: 'día',
  company_name: 'empresa', employee_name: 'persona', cedula: 'cédula', name: 'nombre',
  active: 'en la lista de la cocina', precio: 'precio', categoria: 'categoría', desde: 'desde', hasta: 'hasta',
  se_cobra: 'se cobra', encargado_id: 'encargado', anulada_at: 'anulada',
};

const legible = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '(vacío)';
  if (v === true) return 'sí';
  if (v === false) return 'no';
  return limpio(v);
};

/** «platos: 12 → 9 · nota: (vacío) → llegaron tarde». */
function detalleDe(f: FilaAuditoria): string {
  const c = f.changes;
  if (!esCambioPorCampos(c)) return '';
  return Object.entries(c!)
    // `delivered_at` cambia solo con la fila y no dice nada de lo que se corrigió.
    .filter(([k]) => k !== 'delivered_at' && k !== 'created_at')
    .map(([k, v]) => `${CAMPO[k] ?? k}: ${legible((v as any).de)} → ${legible((v as any).a)}`)
    .join(' · ');
}

const VERBO: Record<string, { verbo: string; icono: string; tipo: MovimientoComida['tipo'] }> = {
  INSERT: { verbo: 'Agregó', icono: '➕', tipo: 'alta' },
  UPDATE: { verbo: 'Corrigió', icono: '✏️', tipo: 'cambio' },
  DELETE: { verbo: 'Borró', icono: '🗑️', tipo: 'borrado' },
};

/**
 * LOS RENGLONES DE LA BITÁCORA, del más reciente al más viejo.
 *
 * Solo pasan las tablas de comida: `audit_log` recibe una fila por CADA
 * escritura de unas 34 tablas de todo el sistema, y sin este filtro la tarjeta
 * mostraría jornadas y despachos de combustible.
 */
export function movimientosDeComida(filas: readonly FilaAuditoria[] | null | undefined, nombreCategoria?: NombreCategoria): MovimientoComida[] {
  return (filas ?? [])
    .filter((f) => (TABLAS_COMIDA as readonly string[]).includes(limpio(f.table_name)))
    .map((f, i) => {
      const v = VERBO[limpio(f.action).toUpperCase()] ?? { verbo: limpio(f.action) || 'Tocó', icono: '•', tipo: 'cambio' as const };
      return {
        clave: String(f.id ?? `${f.at}-${i}`),
        tipo: v.tipo,
        icono: v.icono,
        verbo: v.verbo,
        quien: limpio(f.user_name) || SIN_NOMBRE,
        cuando: fechaHoraCaracas(f.at),
        titulo: tituloDe(f, nombreCategoria),
        detalle: detalleDe(f),
        at: String(f.at ?? ''),
      };
    })
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** El resumen de arriba: cuántas altas, cuántos cambios, cuántos borrados. */
export function resumenMovimientos(movs: readonly MovimientoComida[]): string {
  if (!movs.length) return 'Nadie ha agregado, corregido ni borrado comidas en estas fechas.';
  const n = (t: MovimientoComida['tipo']) => movs.filter((m) => m.tipo === t).length;
  const partes: string[] = [];
  const altas = n('alta'); const cambios = n('cambio'); const borrados = n('borrado');
  if (altas) partes.push(`${altas} agregada(s)`);
  if (cambios) partes.push(`${cambios} corregida(s)`);
  if (borrados) partes.push(`${borrados} borrada(s)`);
  const personas = new Set(movs.map((m) => m.quien.toLowerCase())).size;
  return `${partes.join(' · ')} · ${personas} ${personas === 1 ? 'persona' : 'personas'}`;
}

/** Filtra por tipo, para las pastillas de la tarjeta. */
export function soloDelTipo(movs: readonly MovimientoComida[], tipo: MovimientoComida['tipo'] | 'todo'): MovimientoComida[] {
  return tipo === 'todo' ? [...movs] : movs.filter((m) => m.tipo === tipo);
}
