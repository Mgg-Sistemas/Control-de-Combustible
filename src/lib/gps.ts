// 📡 GPS DE LAS MÁQUINAS — DETEKTOR (12-nov-2026; reemplaza lo de iTrackSafeX).
//
// Pedido: conectar los trackers con el sistema usando los servicios web de Detektor (su manual
// «Web Services Datos Estadísticos»). Dirección comprobada el 12-nov: la ruta de Venezuela es
//   https://ve.detektorgps.com/gps_ve/framework/servicios/<servicio>/datos.php
// (con «gt.» y «gps_ve» da 404). POST con formulario (x-www-form-urlencoded); sin usuario responde
// {"status":"fail","info":"Se requiere Autenticacion para continuar"}.
//
// ⭐ EL USUARIO Y LA CLAVE DE DETEKTOR NUNCA LLEGAN AL TELÉFONO NI A LA PC: viven escondidos en el
//    puente de Supabase (Edge Function `gps-detektor`), que revisa el permiso «GPS» de quien pide y
//    solo consulta las placas VINCULADAS en el sistema (tabla gps_vehiculos).
//
// Detektor no tiene «posición en vivo»: tiene DETENCIONES (dónde y cuánto se detuvo, con lat/lng),
// el RESUMEN DE ACTIVIDAD DIARIA (primer encendido, último apagado, tiempo efectivo, km…) y
// ESTADÍSTICAS por motivo (horómetro, distancia, ralentí…). La ubicación que se muestra es la de su
// ÚLTIMA DETENCIÓN: si sigue ahí, «detenida aquí desde…»; si ya salió, «en movimiento: su última
// parada fue…».
//
// Esta librería es PURA (sin pantalla ni base): la prueba es scripts/test-gps.mjs.

/** La base de los servicios (también la usa el puente; allá se puede cambiar con DETEKTOR_URL). */
export const DETEKTOR_BASE = 'https://ve.detektorgps.com/gps_ve/framework/servicios';
export const SERVICIOS_DETEKTOR = {
  estadistico: 'wsEstadisticoREST',
  resumen: 'wsResumenActividadDiaria',
  detenciones: 'wsDetenciones',
} as const;

/** Si la última detención terminó hace menos de esto, «sigue detenida ahí». */
export const GPS_SIGUE_AHI_MIN = 15;
/** Más vieja que esto, el punto sale en GRIS (sin noticias recientes del equipo). */
export const GPS_VIEJO_MIN = 6 * 60;

// ── Fechas: Detektor habla en hora local de Venezuela (UTC−4) ────────────────────

/** «2026-11-12 07:30:05» (hora de Caracas) → ms. NaN si no se entiende. */
export function msDeFechaDetektor(s: unknown): number {
  const m = String(s ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return NaN;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}-04:00`);
}

/** ms → «2026-11-12 07:30:05» en hora de Caracas (lo que pide Detektor). */
export function fechaDetektor(ms: number): string {
  const d = new Date(ms - 4 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** «11:22:08» o «0:00» → horas (11.369). null si no se entiende. */
export function horasDeDuracion(v: unknown): number | null {
  const m = String(v ?? '').trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60 + Number(m[3] ?? 0) / 3600;
}

/** «hace 3 min», «hace 2 h 10 min», «hace 1 d 3 h». */
export function haceCuanto(ms: number | null | undefined, ahora: number): string {
  if (!ms || !Number.isFinite(ms)) return 'sin dato';
  const min = Math.max(0, Math.round((ahora - ms) / 60000));
  if (min < 1) return 'hace menos de 1 min';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  const d = Math.floor(h / 24);
  return `hace ${d} d${h % 24 ? ` ${h % 24} h` : ''}`;
}

/** «2 h 15 min» de segundos. */
export function textoDuracion(seg: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seg) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

// ── Placas ─────────────────────────────────────────────────────────────────────

/** Mayúsculas y solo letras y números: «ab12-cd 3e» → «AB12CD3E». */
export const normalizarPlaca = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** «1234 - [alias-1234]» (como viene en detenciones) → { placa, alias }. */
export function placaYAlias(campo: unknown): { placa: string; alias: string } {
  const t = String(campo ?? '').trim();
  const m = t.match(/^(.*?)\s*-\s*\[(.*)\]\s*$/);
  return m ? { placa: m[1].trim(), alias: m[2].trim() } : { placa: t, alias: '' };
}

/** ¿Esta fila de Detektor es de ese vehículo (por placa o por alias, sin importar guiones ni espacios)? */
export function esDelVehiculo(fila: { placa?: string; alias?: string }, placaAlias: string): boolean {
  const q = normalizarPlaca(placaAlias);
  return !!q && (normalizarPlaca(fila.placa) === q || normalizarPlaca(fila.alias) === q);
}

// ── Respuestas ─────────────────────────────────────────────────────────────────

/** Una respuesta de Detektor: la lista, o el error que mandó («Se requiere Autenticacion…»). */
export function leerRespuestaDetektor(d: unknown): { filas: any[]; error: string | null } {
  if (Array.isArray(d)) return { filas: d, error: null };
  if (d && typeof d === 'object') {
    const o = d as any;
    if (o.status === 'fail' || o.error) return { filas: [], error: `Detektor: ${o.info || o.error || 'error'}` };
    if (Array.isArray(o.data)) return { filas: o.data, error: null };
  }
  return { filas: [], error: 'Detektor respondió algo que no se entiende.' };
}

export type Detencion = {
  placa: string;
  alias: string;
  inicioMs: number;
  finMs: number;
  lat: number;
  lng: number;
  /** «A 1036 M (ESCUINTLA, ESCUINTLA)» (sin el código del final). */
  lugar: string;
  segundos: number;
  motorEncendido: boolean;
};

/** Las detenciones de wsDetenciones, limpias (las que no traen coordenadas válidas no sirven). */
export function leerDetenciones(filas: any[]): Detencion[] {
  const out: Detencion[] = [];
  for (const r of filas ?? []) {
    const { placa, alias } = placaYAlias(r?.placa);
    const lat = Number(r?.latitud);
    const lng = Number(r?.longitud);
    const inicioMs = msDeFechaDetektor(r?.fechainicio);
    const finMs = msDeFechaDetektor(r?.fechafinal);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0) || !Number.isFinite(finMs)) continue;
    out.push({
      placa, alias, inicioMs: Number.isFinite(inicioMs) ? inicioMs : finMs, finMs, lat, lng,
      lugar: String(r?.georeferencia ?? '').replace(/\s*-\s*\[[^\]]*\]\s*$/, '').trim(),
      segundos: Number(r?.tiempo) || 0,
      motorEncendido: String(r?.ignicion ?? '') === '1',
    });
  }
  return out.sort((a, b) => a.finMs - b.finMs);
}

export type UbicacionGps = {
  placaAlias: string;
  lat: number;
  lng: number;
  lugar: string;
  /** ¿Sigue detenida ahí? (su última detención termina hace menos de 15 min). */
  detenida: boolean;
  /** Desde cuándo está detenida ahí (o cuándo llegó a su última parada). */
  desdeMs: number;
  /** Cuándo terminó su última parada (si ya salió). */
  hastaMs: number;
  motorEncendido: boolean;
};

/** ⭐ La ÚLTIMA posición conocida de un vehículo: su detención más reciente. null si no hay. */
export function ultimaUbicacion(dets: Detencion[], placaAlias: string, ahoraMs: number): UbicacionGps | null {
  const suyas = (dets ?? []).filter((d) => esDelVehiculo(d, placaAlias));
  if (!suyas.length) return null;
  const u = suyas.reduce((a, b) => (b.finMs >= a.finMs ? b : a));
  return {
    placaAlias, lat: u.lat, lng: u.lng, lugar: u.lugar, desdeMs: u.inicioMs, hastaMs: u.finMs, motorEncendido: u.motorEncendido,
    detenida: ahoraMs - u.finMs < GPS_SIGUE_AHI_MIN * 60000,
  };
}

/** Las líneas de la ventanita del punto en el mapa. */
export function lineasUbicacion(u: UbicacionGps, ahoraMs: number): string[] {
  const hora = (ms: number) => { const d = new Date(ms - 4 * 3600 * 1000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  return u.detenida
    ? [`⏸️ Detenida aquí desde las ${hora(u.desdeMs)} (${textoDuracion((ahoraMs - u.desdeMs) / 1000)})`, u.motorEncendido ? '🟢 Motor encendido' : '⚫ Motor apagado', ...(u.lugar ? [`📍 ${u.lugar}`] : [])]
    : [`🚚 En movimiento: su última parada fue aquí, de ${hora(u.desdeMs)} a ${hora(u.hastaMs)} (${haceCuanto(u.hastaMs, ahoraMs)})`, ...(u.lugar ? [`📍 ${u.lugar}`] : [])];
}

/** Gris = sin noticias en las últimas 6 h. */
export const ubicacionVieja = (u: UbicacionGps, ahoraMs: number) => ahoraMs - u.hastaMs > GPS_VIEJO_MIN * 60000;

// ── Resumen de actividad diaria ────────────────────────────────────────────────

export type ActividadDia = {
  fecha: string;
  placa: string;
  alias: string;
  primerEncendido: string | null;
  ultimoApagado: string | null;
  /** Horas entre el primer encendido y el último apagado. */
  horasEncendidoApagado: number | null;
  /** Horas detenida con el motor apagado / encendido (ralentí). */
  horasDetenidoApagado: number | null;
  horasDetenidoEncendido: number | null;
  /** Horas de trabajo efectivo (en movimiento). */
  horasEfectivas: number | null;
  km: number | null;
};

/** Las filas de wsResumenActividadDiaria (una por motivo y día) → una fila por vehículo y día. */
export function leerResumenDiario(filas: any[]): ActividadDia[] {
  const mapa = new Map<string, ActividadDia>();
  for (const r of filas ?? []) {
    const fecha = String(r?.fecha ?? '').slice(0, 10);
    const placa = String(r?.placa ?? '').trim();
    if (!fecha || !placa) continue;
    const k = `${normalizarPlaca(placa)}|${fecha}`;
    if (!mapa.has(k)) mapa.set(k, { fecha, placa, alias: String(r?.alias ?? '').trim(), primerEncendido: null, ultimoApagado: null, horasEncendidoApagado: null, horasDetenidoApagado: null, horasDetenidoEncendido: null, horasEfectivas: null, km: null });
    const a = mapa.get(k)!;
    const motivo = String(r?.motivo ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const valor = String(r?.valor ?? '').trim();
    // «Tiempo entre Primer Encendido y Ult. Apagado» va PRIMERO: también dice «primer encendido».
    if (/tiempo entre/.test(motivo)) a.horasEncendidoApagado = horasDeDuracion(valor);
    else if (/primer encendido/.test(motivo)) a.primerEncendido = valor || null;
    else if (/ultimo apagado/.test(motivo)) a.ultimoApagado = valor || null;
    else if (/motor apagado/.test(motivo)) a.horasDetenidoApagado = horasDeDuracion(valor);
    else if (/motor encendido/.test(motivo)) a.horasDetenidoEncendido = horasDeDuracion(valor);
    else if (/efectivo/.test(motivo)) a.horasEfectivas = horasDeDuracion(valor);
    else if (/kilometraje/.test(motivo)) { const n = Number(valor.replace(',', '.')); a.km = Number.isFinite(n) ? n : null; }
  }
  return [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.placa.localeCompare(b.placa));
}

/** Los vehículos de la cuenta (placa y alias), de cualquier respuesta de Detektor. */
export function vehiculosDeLaCuenta(filas: any[]): { placa: string; alias: string }[] {
  const vistos = new Map<string, { placa: string; alias: string }>();
  for (const r of filas ?? []) {
    const pa = String(r?.placa ?? '').includes('[') ? placaYAlias(r.placa) : { placa: String(r?.placa ?? '').trim(), alias: String(r?.alias ?? '').trim() };
    const k = normalizarPlaca(pa.placa) || normalizarPlaca(pa.alias);
    if (k && !vistos.has(k)) vistos.set(k, pa);
  }
  return [...vistos.values()].sort((a, b) => a.placa.localeCompare(b.placa, 'es', { numeric: true }));
}

// ── Vincular con el Catálogo ───────────────────────────────────────────────────

export type EquipoCatalogo = { id: string; code?: string | null; plate?: string | null; marca?: string | null; modelo?: string | null; clasificacion?: string | null; empresa?: string | null };

/**
 * La máquina del Catálogo que corresponde a una placa/alias de Detektor: por PLACA (o un pedazo de
 * «CHUTO/LOWBOY») o por CÓDIGO, escritos igual. Solo PROPONE: la persona confirma o corrige.
 */
export function sugerirEquipo(v: { placa: string; alias: string }, catalogo: EquipoCatalogo[]): EquipoCatalogo | null {
  const claves = [normalizarPlaca(v.placa), normalizarPlaca(v.alias)].filter((x) => x.length >= 3);
  if (!claves.length) return null;
  for (const e of catalogo ?? []) {
    const pedazos = String(e.plate ?? '').split(/[\/,;]/).map(normalizarPlaca).filter((x) => x.length >= 3);
    if (pedazos.some((p) => claves.includes(p))) return e;
  }
  for (const e of catalogo ?? []) {
    const c = normalizarPlaca(e.code);
    if (c.length >= 3 && claves.includes(c)) return e;
  }
  return null;
}

/** Cómo se llama el vehículo en pantalla: el código del Catálogo (con su placa); si no, la placa del GPS. */
export const nombreVehiculo = (v: { placaAlias?: string | null; equipo?: { code?: string | null; plate?: string | null } | null }) =>
  v.equipo?.code ? `${v.equipo.code}${v.equipo.plate ? ` · ${v.equipo.plate}` : ''}` : (v.placaAlias || 'Vehículo');
