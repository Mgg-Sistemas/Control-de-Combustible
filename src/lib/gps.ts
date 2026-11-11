// 📡 GPS DE LOS VEHÍCULOS (iTrackSafeX) — 10-nov-2026, a pedido: «conectar la ubicación GPS
// que envía iTrackSafeX… saber su ubicación cuando la necesite, sin que impacte la base de datos
// ni ponga lento el sistema»; «habrá como 30 camiones… si le doy a actualizar, que solo en ese
// momento me traiga la ubicación de uno, de varios o de los que necesite en el mapa».
//
// CÓMO FUNCIONA (sin la clave de la cuenta):
//   · iTrackSafeX es la plataforma GPS51 con otra marca. Su app comparte la ubicación de un
//     equipo con un ENLACE («Compartir», de 1 hora a 1 año). El enlace lleva un `authcode`.
//   · La misma página del enlace le pregunta la última posición a `web.itracksafe.com`
//     (action=sharetracklastposition) con ese authcode. Su servidor acepta que lo pregunte
//     otro sitio (CORS abierto), así que el TELÉFONO o la PC le preguntan DIRECTO:
//     Supabase no recibe ni guarda ni una posición (cero escrituras, cero tráfico por consulta).
//   · En la base solo vive la lista de enlaces (public.gps_enlaces, una fila por vehículo),
//     visible únicamente con el permiso «GPS».
//   · Solo se consulta cuando alguien toca «Actualizar»: nada en segundo plano ni en bucle.
//     Varios a la vez se piden DE 5 EN 5 para no saturar a iTrackSafeX.
//
// Si un día iTrackSafeX cambia esa dirección, la consulta falla con un mensaje claro y el
// enlace se puede seguir abriendo en su página (que siempre funciona).
// La prueba de esta librería: scripts/test-gps.mjs.

/** El servidor de iTrackSafeX (custom/config.js de itracksafe.com: hostDomain). */
export const GPS_HOST = 'https://web.itracksafe.com';
export const GPS_ACCION = 'webapi?action=sharetracklastposition';
/** Cuántas consultas a la vez cuando se actualizan varios. */
export const GPS_TANDA = 5;
/** Más viejo que esto, el punto sale en GRIS: «fuera de línea, esta es la última que reportó». */
export const GPS_VIEJO_MIN = 60;
/** Para «En línea»: reportó hace menos de esto. */
export const GPS_EN_LINEA_MIN = 30;
/** Se avisa cuando al enlace le quedan menos de estos días. */
export const GPS_AVISO_DIAS = 15;

export type EnlaceLeido = {
  /** El nombre que viene en el texto que copia la app («Click to view Fordterritory track…»). */
  nombre: string | null;
  authcode: string;
  serverid: string;
  /** El enlace tal cual, para abrirlo en la página de iTrackSafeX. */
  url: string;
};

const RX_AUTH = /authcode=([0-9a-fA-F]{16,64})/;

/**
 * Lee UNO O VARIOS enlaces pegados juntos, tal como los copia la app:
 *   «Click to view Fordterritory track,share duration 1D： http://itracksafe.com/#/tracking?authcode=…»
 * Repetidos (mismo authcode) salen una sola vez. Lo que no tenga authcode se ignora.
 */
export function leerEnlaces(texto: string): EnlaceLeido[] {
  const out: EnlaceLeido[] = [];
  const vistos = new Set<string>();
  const src = String(texto ?? '');
  const rxUrl = /(https?:\/\/[^\s"'<>]+)/g;
  let m: RegExpExecArray | null;
  let desde = 0;
  while ((m = rxUrl.exec(src))) {
    const url = m[1].replace(/[),.;]+$/, '');
    const a = RX_AUTH.exec(url);
    const antes = src.slice(desde, m.index);
    desde = m.index + m[0].length;
    if (!a || !urlSegura(url)) continue; // solo enlaces de itracksafe.com
    const authcode = a[1].toLowerCase();
    if (vistos.has(authcode)) continue;
    vistos.add(authcode);
    const sv = /serverid=(\d{1,4})(?!\d)/.exec(url);
    const serverid = sv ? sv[1] : '0';
    // El nombre: lo que hay entre «view» y «track» en el texto de ANTES del enlace.
    const n = /view\s+(.+?)\s+track/i.exec(antes) ?? /ver\s+(?:el\s+)?(?:recorrido\s+de\s+)?(.+?)\s*[,:：]/i.exec(antes);
    // 🔒 Lo pegado NO se guarda tal cual: el enlace se REARMA con el código y el servidor.
    out.push({ nombre: n ? n[1].trim().slice(0, 80) : null, authcode, serverid, url: urlDeEnlace(authcode, serverid) });
  }
  return out;
}

/** La dirección para abrir el enlace en la página de iTrackSafeX (si no se guardó el original). */
export const urlDeEnlace = (authcode: string, serverid = '0') =>
  `http://itracksafe.com/#/tracking?authcode=${encodeURIComponent(authcode)}&language=es&serverid=${encodeURIComponent(serverid)}`;

/**
 * 🔒 Solo direcciones http(s) de itracksafe.com. Todo enlace que se pinta o se abre pasa por
 * aquí: un «javascript:» o una página ajena guardados en la base no llegan a la pantalla.
 */
export function urlSegura(u: string | null | undefined): string | null {
  try {
    const x = new URL(String(u ?? ''));
    return (x.protocol === 'https:' || x.protocol === 'http:') && /(^|\.)itracksafe\.com$/i.test(x.hostname) ? x.href : null;
  } catch { return null; }
}

/** Lo que se abre al tocar «Abrir en iTrackSafeX»: el guardado si es seguro; si no, se rearma. */
export const urlParaAbrir = (e: { url?: string | null; authcode: string; serverid?: string | null }) =>
  urlSegura(e.url) ?? urlDeEnlace(e.authcode, e.serverid ?? '0');

export type PosicionGps = {
  ok: true;
  deviceId: string | null;
  nombre: string | null;
  lat: number;
  lng: number;
  /** km/h */
  velocidad: number;
  rumbo: number | null;
  enMarcha: boolean;
  /** Cuándo reportó el equipo (ms). */
  reporte: number | null;
  /** Cuándo tuvo su última posición VÁLIDA de GPS (ms). */
  posicionValida: number | null;
  /** «Motor apagado hace 1d 1h 35m · Batería 12,97 V» (traducido de lo que manda la plataforma). */
  estadoTexto: string | null;
  /** Hasta cuándo vale el enlace (ms), según iTrackSafeX. */
  vence: number | null;
};
export type FalloGps = { ok: false; motivo: 'vencido' | 'sin_posicion' | 'red' | 'respuesta'; mensaje: string; vence?: number | null; nombre?: string | null; deviceId?: string | null };
export type ResultadoGps = PosicionGps | FalloGps;

const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** «ACC Off 1D1H35M/Voltage 12.97V» → «Motor apagado hace 1d 1h 35m · Batería 12,97 V». */
export function traducirEstado(s: unknown): string | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  return t
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p
      .replace(/^ACC\s*On\s*/i, 'Motor encendido hace ')
      .replace(/^ACC\s*Off\s*/i, 'Motor apagado hace ')
      .replace(/^Voltage\s*([\d.]+)\s*V/i, (_x, v) => `Batería ${String(v).replace('.', ',')} V`)
      .replace(/(\d+)D/g, '$1d ').replace(/(\d+)H/g, '$1h ').replace(/(\d+)M(?![a-z])/g, '$1m ').replace(/(\d+)S/g, '$1s ')
      .replace(/hace\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim())
    .join(' · ');
}

/** Lo que responde iTrackSafeX → lo que el sistema muestra. Nunca lanza. */
export function leerRespuesta(d: any): ResultadoGps {
  if (!d || typeof d !== 'object') return { ok: false, motivo: 'respuesta', mensaje: 'iTrackSafeX respondió algo que no se entiende.' };
  const vence = num(d.expire) || null;
  const nombre = d.devicename ? String(d.devicename) : null;
  const deviceId = d.deviceid ? String(d.deviceid) : null;
  if (Number(d.status) !== 0) return { ok: false, motivo: 'respuesta', mensaje: `iTrackSafeX: ${d.cause || 'error'}`, vence, nombre, deviceId };
  if (Number(d.isvalid) !== 1) return { ok: false, motivo: 'vencido', mensaje: 'El enlace está vencido o fue cancelado en la app. Comparte uno nuevo y pégalo aquí.', vence, nombre, deviceId };
  const r = Array.isArray(d.records) ? d.records[0] : null;
  const lat = num(r?.callat);
  const lng = num(r?.callon);
  if (!r || lat == null || lng == null || (lat === 0 && lng === 0)) return { ok: false, motivo: 'sin_posicion', mensaje: 'El equipo todavía no tiene una posición para mostrar.', vence, nombre, deviceId };
  return {
    ok: true,
    deviceId: deviceId ?? (r.deviceid ? String(r.deviceid) : null),
    nombre,
    lat, lng,
    velocidad: Math.max(0, num(r.speed) ?? 0),
    rumbo: num(r.course),
    enMarcha: Number(r.moving) === 1 || (num(r.speed) ?? 0) > 3,
    reporte: num(r.devicetime) || num(r.arrivedtime) || null,
    posicionValida: num(r.validpoistiontime) || null,
    estadoTexto: traducirEstado(r.strstatusen),
    vence,
  };
}

/**
 * Pregunta la última posición de UN enlace. `fetcher` se puede cambiar en la prueba.
 * Directo del teléfono/PC a iTrackSafeX: no pasa por Supabase.
 */
export async function consultarPosicion(authcode: string, fetcher: typeof fetch = fetch, timeoutMs = 12000): Promise<ResultadoGps> {
  let timer: any = null;
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctrl) timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetcher(`${GPS_HOST}/${GPS_ACCION}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authcode, lastquerypositiontime: 0 }),
      signal: ctrl?.signal,
    } as any);
    if (!res.ok) return { ok: false, motivo: 'red', mensaje: `iTrackSafeX no respondió bien (${res.status}).` };
    return leerRespuesta(await res.json());
  } catch (e: any) {
    const aborto = e?.name === 'AbortError';
    return { ok: false, motivo: 'red', mensaje: aborto ? 'iTrackSafeX tardó demasiado en responder.' : 'No se pudo conectar con iTrackSafeX (¿sin internet?).' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Corre `fn` sobre todos, pero de `tanda` en `tanda` (para no pedir 30 de golpe). */
export async function enTandas<T, R>(items: T[], tanda: number, fn: (x: T) => Promise<R>, alAvanzar?: (hechos: number) => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  let hechos = 0;
  const n = Math.max(1, Math.min(tanda, items.length || 1));
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
      hechos++;
      alAvanzar?.(hechos);
    }
  }));
  return out;
}

/** «hace 3 min», «hace 2 h 10 min», «hace 1 d 4 h». */
export function haceCuanto(ms: number | null | undefined, ahora: number): string {
  if (!ms) return 'sin dato';
  const min = Math.max(0, Math.round((ahora - ms) / 60000));
  if (min < 1) return 'hace menos de 1 min';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  const d = Math.floor(h / 24);
  return `hace ${d} d${h % 24 ? ` ${h % 24} h` : ''}`;
}

export type Frescura = 'en_linea' | 'reciente' | 'viejo';
/** En línea (< 30 min), reciente (< 1 h) o viejo (gris: es la última que reportó). */
export function frescura(ms: number | null | undefined, ahora: number): Frescura {
  if (!ms) return 'viejo';
  const min = (ahora - ms) / 60000;
  return min < GPS_EN_LINEA_MIN ? 'en_linea' : min < GPS_VIEJO_MIN ? 'reciente' : 'viejo';
}

/** Días que le quedan al enlace (negativo = vencido). null si no se sabe. */
export function diasParaVencer(vence: number | string | null | undefined, ahora: number): number | null {
  const ms = typeof vence === 'string' ? Date.parse(vence) : vence ?? NaN;
  if (!Number.isFinite(ms)) return null;
  return Math.floor(((ms as number) - ahora) / 86400000);
}

export type EquipoCatalogo = { id: string; code?: string | null; plate?: string | null; marca?: string | null; modelo?: string | null; clasificacion?: string | null };
const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const compacto = (s: unknown) => norm(s).replace(/\s+/g, '');

/**
 * El vehículo del catálogo que más se parece al nombre del GPS («Gandola Trakker Iveco»,
 * «EP-1000 Encava Blanca»). Solo PROPONE: la persona confirma o corrige.
 * Puntos: placa o código escritos tal cual valen mucho; cada palabra de 3+ letras suma 1.
 */
export function sugerirEquipo(nombreGps: string | null | undefined, catalogo: EquipoCatalogo[]): EquipoCatalogo | null {
  const n = norm(nombreGps);
  if (!n) return null;
  const nc = compacto(nombreGps);
  const palabras = [...new Set(n.split(' ').filter((p) => p.length >= 3))];
  let mejor: EquipoCatalogo | null = null;
  let puntos = 0;
  for (const e of catalogo ?? []) {
    let p = 0;
    const placa = compacto(e.plate);
    const codigo = compacto(e.code);
    if (placa.length >= 5 && nc.includes(placa)) p += 10;
    if (codigo.length >= 3 && nc.includes(codigo)) p += 6;
    const texto = ` ${norm([e.code, e.plate, e.marca, e.modelo, e.clasificacion].filter(Boolean).join(' '))} `;
    for (const w of palabras) if (texto.includes(` ${w} `) || texto.includes(` ${w}`)) p += 1;
    if (p > puntos) { puntos = p; mejor = e; }
  }
  return puntos >= 2 ? mejor : null;
}

/** Cómo se llama el vehículo en pantalla: el del catálogo si está vinculado; si no, el del GPS. */
export const nombreVehiculo = (enlace: { nombre?: string | null; equipo?: { code?: string | null; plate?: string | null } | null }) =>
  enlace.equipo?.code
    ? `${enlace.equipo.code}${enlace.equipo.plate ? ` · ${enlace.equipo.plate}` : ''}`
    : (enlace.nombre || 'Vehículo');
