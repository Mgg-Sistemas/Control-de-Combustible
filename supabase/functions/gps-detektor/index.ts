// Edge Function: 📡 puente con los servicios web de DETEKTOR (GPS de las máquinas). 13-nov-2026.
//
// ⭐ El usuario y la clave de Detektor viven SOLO aquí (secretos DETEKTOR_USUARIO y DETEKTOR_CLAVE):
//    nunca llegan al teléfono ni a la PC. Quien llama tiene que tener sesión y el permiso «GPS»
//    (función gps_puede_ver), y solo se consultan las placas VINCULADAS en la tabla gps_vehiculos
//    (que lee con SU sesión: la RLS decide). Descubrir los vehículos de la cuenta pide escritura.
//
// Soporta tanto los 3 servicios REST del manual («Web Services Datos Estadísticos Detektor»):
//   · https://ve.detektorgps.com/gps_ve/framework/servicios/wsResumenActividadDiaria/datos.php
//   · https://ve.detektorgps.com/gps_ve/framework/servicios/wsDetenciones/datos.php
//   · https://ve.detektorgps.com/gps_ve/framework/servicios/wsEstadisticoREST/datos.php
// como el servicio SOAP de último punto (`ultimo_punto` en `VehiculosCercanosWSDL`):
//   · https://ve.detektorgps.com/gps_ve/ws/servicio_v3.php (activo en Venezuela)
//   · https://ve.detektorgps.com/gps_ve/ws/servicio_v2.php?wsdl
// (Si DETEKTOR_URL viene con `gt.detektorgps.com` o `gps_gt`, se corrige solo a `ve.detektorgps.com` y `gps_ve`).
//
// Acciones (POST JSON { accion, ... }):
//   · vehiculos                      → los vehículos de la cuenta (placa y alias), para vincular.
//   · ubicacion   { placas[] }       → último punto SOAP y/o detenciones de las últimas 36 h (con respaldo a resumen diario).
//   · resumen     { placas[], desde, hasta } (AAAA-MM-DD, hasta 31 días) → resumen de actividad diaria.
//   · detenciones { placa, desde, hasta } (AAAA-MM-DD, hasta 7 días)     → detenciones con lat/lng.
//   · estadistico { placas[], motivo, desde, hasta } (hasta 31 días)    → datos por motivo y día.
// Las respuestas se guardan 60 s en memoria: varias personas mirando lo mismo = 1 consulta a Detektor.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function normalizarUrlVe(raw: string): string {
  return raw
    .replace(/\/\/gt\.detektorgps\.com\b/gi, '//ve.detektorgps.com')
    .replace(/\/\/gt\.skytrack\.detektorgps\.com\b/gi, '//ve.skytrack.detektorgps.com')
    .replace(/\/gps_gt(\/|$)/gi, '/gps_ve$1')
    .replace(/\/+$/, '');
}

const RAW_BASE = normalizarUrlVe(Deno.env.get('DETEKTOR_URL') || 'https://ve.detektorgps.com/gps_ve/framework/servicios');
// Si alguien puso la URL del WSDL (ws/servicio_v2.php?wsdl) en DETEKTOR_URL, derivamos igual la base REST de framework/servicios:
const BASE = RAW_BASE.includes('/ws/servicio_v')
  ? RAW_BASE.replace(/\/ws\/servicio_v\d+\.php.*$/i, '/framework/servicios')
  : RAW_BASE;
const RAIZ_VE = BASE.replace(/\/framework\/servicios.*$/i, '');
const SOAP_V3_URL = `${RAIZ_VE}/ws/servicio_v3.php`;
const SOAP_V2_URL = `${RAIZ_VE}/ws/servicio_v2.php`;

const CACHE_MS = 60_000;
const cache = new Map<string, { t: number; filas: unknown[] }>();

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const diasEntre = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** ms → «AAAA-MM-DD HH:MM:SS» en hora de Caracas (UTC−4). */
function fechaVe(ms: number): string {
  const d = new Date(ms - 4 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Lo que Detektor contestó, recortado y SIN el usuario ni la clave (para el registro y el aviso). */
function recorte(texto: string, uSec: string, pSec: string): string {
  let t = texto.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const variantesSecretas = [
    uSec, pSec,
    encodeURIComponent(uSec), encodeURIComponent(pSec),
    uSec.slice(0, 15), pSec.slice(0, 15),
  ].filter((x) => x && x.length >= 3);
  for (const s of variantesSecretas) t = t.split(s).join('***');
  return t.slice(0, 240);
}

function escaparXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c));
}

function desescaparXml(s: string): string {
  return s
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&apos;|&#0*39;/gi, "'")
    .replace(/&quot;|&#0*34;/gi, '"')
    .replace(/&amp;/gi, '&');
}

/** Parsea `<xml_dat>` de SOAP `ultimo_punto` (`servicio_v3.php` / `servicio_v2.php`). */
function parsearUltimoPuntoSoap(xmlTexto: string): { filas: any[]; error: string | null } {
  const mXmlDat = xmlTexto.match(/<xml_dat[^>]*>([\s\S]*?)<\/xml_dat>/i);
  const interno = desescaparXml(mXmlDat ? mXmlDat[1] : xmlTexto);
  const moviles = [...interno.matchAll(/<movil\b([^>]*)>([\s\S]*?)<\/movil>/gi)];
  if (!moviles.length) {
    const fault = interno.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
    return { filas: [], error: fault ? fault[1].trim() : 'Respuesta SOAP sin <movil>.' };
  }
  const tag = (bloque: string, nombres: string[]): string => {
    for (const n of nombres) {
      const m = bloque.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)<\\/${n}>`, 'i'));
      if (m && m[1].trim() !== '') return desescaparXml(m[1].trim());
    }
    return '';
  };
  const attr = (attrs: string, nombre: string): string => {
    const m = attrs.match(new RegExp(`\\b${nombre}\\s*=\\s*['"]([^'"]*)['"]`, 'i'));
    return m ? m[1].trim() : '';
  };
  const filas: any[] = [];
  const errores: string[] = [];
  for (const m of moviles) {
    const attrs = m[1] ?? '';
    const cuerpo = m[2] ?? '';
    const estado = tag(cuerpo, ['estado', 'error', 'mensaje']);
    if (/^error\b/i.test(estado)) {
      errores.push(estado);
      continue;
    }
    const placa = attr(attrs, 'placa') || tag(cuerpo, ['placa', 'patente', 'unidad']);
    const alias = attr(attrs, 'alias') || tag(cuerpo, ['alias', 'nombre']);
    const latitud = tag(cuerpo, ['latitud', 'lat', 'latitude']) || attr(attrs, 'latitud') || attr(attrs, 'lat');
    const longitud = tag(cuerpo, ['longitud', 'lon', 'lng', 'longitude']) || attr(attrs, 'longitud') || attr(attrs, 'lon');
    const fecha = tag(cuerpo, ['fecha_hora', 'fechahora', 'fecha', 'fechafinal', 'fechapunto', 'ultimopunto']);
    const hora = tag(cuerpo, ['hora']);
    const fechaCompleta = fecha && hora && !/ \d{2}:/.test(fecha) ? `${fecha} ${hora}` : fecha;
    const georeferencia = tag(cuerpo, ['georeferencia', 'ubicacion', 'direccion', 'lugar']);
    const ignRaw = tag(cuerpo, ['ignicion', 'motor', 'encendido', 'estado_motor']);
    const velRaw = tag(cuerpo, ['velocidad', 'vel', 'speed']);
    const ignicion = /^(1|on|true|si|sí|encendido|activo)$/i.test(ignRaw) ? '1' : (/^(0|off|false|no|apagado|inactivo)$/i.test(ignRaw) ? '0' : ignRaw);
    filas.push({
      placa: alias && !placa.includes('[') ? `${placa} - [${alias}]` : placa,
      alias,
      fechainicio: fechaCompleta,
      fechafinal: fechaCompleta,
      latitud,
      longitud,
      georeferencia,
      tiempo: '0',
      ignicion,
      velocidad: velRaw !== '' ? Number(velRaw.replace(',', '.')) : null,
      fuente: 'ultimo_punto',
    });
  }
  return { filas, error: !filas.length && errores.length ? errores[0] : null };
}

/** Consulta el Web Service SOAP `ultimo_punto` en `ws/servicio_v3.php` (y respaldo `ws/servicio_v2.php`). */
async function consultarSoapUltimoPunto(placaParam: string, uSec: string, pSec: string): Promise<{ filas: any[]; error: string | null }> {
  const claveCache = `soap_ultimo_punto|${placaParam}`;
  const c = cache.get(claveCache);
  if (c && Date.now() - c.t < CACHE_MS) return { filas: c.filas as any[], error: null };

  const uXml = escaparXml(uSec);
  const pXml = escaparXml(pSec);
  const plXml = escaparXml(placaParam);

  const intentosSoap = [
    {
      url: SOAP_V3_URL,
      action: 'https://ve.skytrack.detektorgps.com:443/gps_ve/ws/servicio_v3.php#ultimo_punto',
      body: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="urn:VehiculosCercanosWSDL"><soap:Body><tns:ultimo_punto><tns:usuario>${uXml}</tns:usuario><tns:clave>${pXml}</tns:clave><tns:campos>*</tns:campos><tns:placa>${plXml}</tns:placa></tns:ultimo_punto></soap:Body></soap:Envelope>`,
    },
    {
      url: SOAP_V2_URL,
      action: 'https://ve.skytrack.detektorgps.com:443/gps_ve/ws/servicio_v2.php#ultimo_punto',
      body: `<?xml version="1.0" encoding="ISO-8859-1"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:UltimoPuntoVehiculoWSDL" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><SOAP-ENV:Body><ns1:ultimo_punto><usuario xsi:type="xsd:string">${uXml}</usuario><clave xsi:type="xsd:string">${pXml}</clave><campos xsi:type="xsd:string">*</campos><placa xsi:type="xsd:string">${plXml}</placa></ns1:ultimo_punto></SOAP-ENV:Body></SOAP-ENV:Envelope>`,
    },
  ];

  let ultimoErr: string | null = null;
  for (const it of intentosSoap) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    try {
      const res = await fetch(it.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: it.action },
        body: it.body,
        signal: ctrl.signal,
      });
      const texto = await res.text();
      if (!res.ok || !texto.trim()) {
        ultimoErr = `SOAP ${res.status} vacío`;
        continue;
      }
      const parsed = parsearUltimoPuntoSoap(texto);
      if (parsed.filas.length) {
        cache.set(claveCache, { t: Date.now(), filas: parsed.filas });
        return { filas: parsed.filas, error: null };
      }
      ultimoErr = parsed.error ? recorte(parsed.error, uSec, pSec) : 'Sin puntos en SOAP';
      // Si el servidor SOAP ya contestó con error de permisos de negocio, no hace falta probar v2 vacío.
      if (parsed.error && /sin permisos/i.test(parsed.error)) break;
    } catch (e) {
      ultimoErr = (e as Error)?.message || 'Error SOAP';
    } finally {
      clearTimeout(timer);
    }
  }
  return { filas: [], error: ultimoErr };
}

type Pedido = { params: Record<string, string>; nombre: string };

/** Las formas de pedir lo mismo, por si Detektor se cae (500) con la del manual:
 *  · un solo día calendario (00:00:00 a 23:59:59, como en el ejemplo Postman de la pág. 18 del manual),
 *  · pidiendo toda la cuenta («*») y filtrando aquí,
 *  · la placa con el otro nombre de campo (placa_alias / placas_alias) y «tiempodetencion»,
 *  · año de 2 dígitos (AA-MM-DD HH:MM:SS, tabla pág. 18 del manual). */
function variantesPedido(params: Record<string, string>): Pedido[] {
  const v: Pedido[] = [{ params, nombre: 'manual' }];
  const placa = params.placas_alias ?? params.placa_alias;
  const conHora = !!params.fechainicio && / \d{2}:/.test(params.fechainicio);
  const diaFin = (params.fechafinal ?? '').slice(0, 10);
  const diaIni = (params.fechainicio ?? '').slice(0, 10);

  if (placa === undefined) {
    if (conHora) v.push({ params: { ...params, fechainicio: diaIni, fechafinal: diaFin }, nombre: 'solo-dia' });
    return v;
  }

  // Pidiendo un único día completo (00:00:00 a 23:59:59) como en el ejemplo Postman de la pág. 18:
  if (conHora && diaFin) {
    v.push({ params: { ...params, placas_alias: '*', fechainicio: `${diaFin} 00:00:00`, fechafinal: `${diaFin} 23:59:59` }, nombre: 'dia-hoy-toda-cuenta' });
    v.push({ params: { ...params, fechainicio: `${diaFin} 00:00:00`, fechafinal: `${diaFin} 23:59:59` }, nombre: 'dia-hoy-placa' });
    if (diaIni && diaIni !== diaFin) {
      v.push({ params: { ...params, placas_alias: '*', fechainicio: `${diaIni} 00:00:00`, fechafinal: `${diaIni} 23:59:59` }, nombre: 'dia-ayer-toda-cuenta' });
    }
    // Año de 2 dígitos AA-MM-DD HH:MM:SS (como indica la tabla de la pág. 18 del manual):
    const yyFin = diaFin.slice(2);
    v.push({ params: { ...params, placas_alias: '*', fechainicio: `${yyFin} 00:00:00`, fechafinal: `${yyFin} 23:59:59` }, nombre: 'anio-2-digitos' });
  }

  const ambas = { ...params, placas_alias: placa, placa_alias: placa };
  v.push({ params: ambas, nombre: 'placa-dos-nombres' });
  v.push({ params: { ...ambas, tiempodetencion: '5' }, nombre: 'con-tiempodetencion' });
  if (conHora) v.push({ params: { ...ambas, tiempodetencion: '5', fechainicio: diaIni, fechafinal: diaFin }, nombre: 'solo-dia' });
  // Pidiendo TODA la cuenta («*»): quien llama filtra después y deja solo las vinculadas.
  v.push({ params: { ...params, placas_alias: '*' }, nombre: 'toda-la-cuenta' });
  // Por GET NO: el usuario y la clave quedarían en la dirección (y en los registros de los servidores).
  return v;
}

/** Le pregunta a Detektor (formulario POST, como su manual). Devuelve la lista o lanza con su mensaje.
 *  Si Detektor se cae (500) con la fecha completa, reintenta con otras formas de fecha y recuerda la que sirvió. */
const formaQueSirve = new Map<string, number>();
async function detektor(servicio: string, params: Record<string, string>): Promise<unknown[]> {
  const usuario = Deno.env.get('DETEKTOR_USUARIO');
  const pass = Deno.env.get('DETEKTOR_CLAVE');
  if (!usuario || !pass) throw new Error('Falta configurar el usuario y la clave de Detektor en Supabase (DETEKTOR_USUARIO y DETEKTOR_CLAVE).');
  const clave = `${servicio}|${JSON.stringify(params)}`;
  const c = cache.get(clave);
  if (c && Date.now() - c.t < CACHE_MS) return c.filas;
  const variantes = variantesPedido(params);
  const primero = formaQueSirve.get(servicio) ?? 0;
  const orden = [primero, ...variantes.map((_, i) => i).filter((i) => i !== primero)].filter((i) => i < variantes.length);
  let ultimo: Error | null = null;
  for (const i of orden) {
    try {
      const filas = await unaConsulta(servicio, variantes[i], usuario, pass);
      if (i !== 0) console.log(`[gps-detektor] ${servicio} funcionó con la forma «${variantes[i].nombre}»`);
      formaQueSirve.set(servicio, i);
      cache.set(clave, { t: Date.now(), filas });
      return filas;
    } catch (e) {
      ultimo = e as Error;
      if (!(e as any)?.reintentar) throw e;
    }
  }
  throw ultimo ?? new Error('Detektor no respondió.');
}

async function unaConsulta(servicio: string, pedido: Pedido, usuario: string, pass: string): Promise<unknown[]> {
  const { params } = pedido;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${BASE}/${servicio}/datos.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ usuario, pass, ...params }).toString(),
      signal: ctrl.signal,
    });
    const texto = await res.text();
    if (!res.ok) {
      const quePaso = recorte(texto, usuario, pass);
      const p = { ...params } as Record<string, string>;
      console.error(`[gps-detektor] ${servicio} → ${res.status} · forma ${pedido.nombre} · fechas ${p.fechainicio ?? ''} / ${p.fechafinal ?? ''} · placas ${p.placas_alias ?? p.placa_alias ?? ''} · respuesta: ${quePaso || '(vacía)'}`);
      const err = new Error(`Detektor respondió ${res.status}${quePaso ? ': ' + quePaso.slice(0, 120) : '.'}`);
      (err as any).reintentar = res.status >= 500;
      throw err;
    }
    let d: any;
    try { d = JSON.parse(texto); } catch {
      const err = new Error('Detektor respondió algo que no es JSON.');
      (err as any).reintentar = true;
      throw err;
    }
    if (!Array.isArray(d)) {
      if (d?.status === 'fail') throw new Error(`Detektor: ${d.info || 'error'}`);
      if (Array.isArray(d?.data)) d = d.data; else throw new Error('Detektor respondió algo que no se entiende.');
    }
    return d;
  } catch (e) {
    if ((e as any)?.name === 'AbortError') {
      const err = new Error('Detektor tardó demasiado en responder.');
      (err as any).reintentar = true;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Solo POST' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: who } = await caller.auth.getUser();
    if (!who?.user) return json({ error: 'No autenticado' }, 401);

    const body = await req.json().catch(() => ({}));
    const accion = String(body?.accion ?? '');
    const necesita = accion === 'vehiculos' ? 'gps_puede_editar' : 'gps_puede_ver';
    const { data: puede, error: ePerm } = await caller.rpc(necesita);
    if (ePerm) return json({ error: 'No se pudo revisar el permiso GPS (¿se corrió el SQL del GPS?).' }, 500);
    if (!puede) return json({ error: 'No tienes el permiso «GPS».' }, 403);

    // Las placas vinculadas que esta persona puede ver (con SU sesión: la RLS manda).
    const vinculadas = async (): Promise<string[]> => {
      const { data, error } = await caller.from('gps_vehiculos').select('placa_alias');
      if (error) throw new Error('No se pudieron leer los vehículos vinculados: ' + error.message);
      return (data ?? []).map((r: any) => String(r.placa_alias));
    };
    const soloVinculadas = async (pedidas: unknown): Promise<string[]> => {
      const ok = new Map((await vinculadas()).map((p) => [norm(p), p]));
      const lista = (Array.isArray(pedidas) ? pedidas : [pedidas]).map((p) => ok.get(norm(p))).filter(Boolean) as string[];
      return [...new Set(lista)].slice(0, 60);
    };

    // Solo las filas de las placas pedidas (la placa puede venir como «A01 - [alias]»).
    const soloDe = (filas: unknown[], placas: string[]) => {
      const ok = placas.map(norm).filter(Boolean);
      return filas.filter((r: any) => { const p = norm(r?.placa) + '|' + norm(r?.alias); return ok.some((x) => p.includes(x)); });
    };

    if (accion === 'vehiculos') {
      const hoy = fechaVe(Date.now()).slice(0, 10);
      const ayer = fechaVe(Date.now() - 86_400_000).slice(0, 10);
      const filas = await detektor('wsResumenActividadDiaria', { fechainicio: ayer, fechafinal: hoy, placa_alias: '*', tiempodetencion: '5' });
      const uSec = Deno.env.get('DETEKTOR_USUARIO') || '';
      const pSec = Deno.env.get('DETEKTOR_CLAVE') || '';
      const soap = uSec && pSec ? await consultarSoapUltimoPunto('*', uSec, pSec) : { filas: [] };
      const todas = [...filas, ...soap.filas];
      return json({ ok: true, filas: todas.map((r: any) => ({ placa: r?.placa ?? '', alias: r?.alias ?? '' })) });
    }

    if (accion === 'ubicacion') {
      const placas = await soloVinculadas(body?.placas);
      if (!placas.length) return json({ ok: true, filas: [] });
      const ahora = Date.now();
      const uSec = Deno.env.get('DETEKTOR_USUARIO') || '';
      const pSec = Deno.env.get('DETEKTOR_CLAVE') || '';

      // 1) Intentar primero el servicio SOAP de último punto (`ws/servicio_v3.php` / `ws/servicio_v2.php`):
      const filasAcumuladas: unknown[] = [];
      let errSoap: string | null = null;
      if (uSec && pSec) {
        const resSoap = await consultarSoapUltimoPunto(placas.length === 1 ? placas[0] : '*', uSec, pSec);
        if (resSoap.filas.length) {
          filasAcumuladas.push(...soloDe(resSoap.filas, placas));
        } else {
          errSoap = resSoap.error;
        }
      }

      // 2) Si aún faltan placas con coordenadas, consultar `wsDetenciones`:
      let errDetenciones: string | null = null;
      if (filasAcumuladas.length < placas.length) {
        try {
          const filasDet = await detektor('wsDetenciones', { placas_alias: placas.join(','), fechainicio: fechaVe(ahora - 36 * 3600_000), fechafinal: fechaVe(ahora) });
          filasAcumuladas.push(...soloDe(filasDet, placas));
        } catch (e) {
          errDetenciones = (e as Error)?.message || 'Error en wsDetenciones';
        }
      }

      if (filasAcumuladas.length > 0) {
        return json({ ok: true, filas: filasAcumuladas });
      }

      // 3) Si `wsDetenciones` dio HTTP 500 en Detektor y SOAP no devolvió coordenadas,
      //    consultamos `wsResumenActividadDiaria` de ayer y hoy para entregar el estado real del equipo sin romper con 502:
      const hoy = fechaVe(ahora).slice(0, 10);
      const ayer = fechaVe(ahora - 86_400_000).slice(0, 10);
      try {
        const filasRes = await detektor('wsResumenActividadDiaria', {
          fechainicio: ayer,
          fechafinal: hoy,
          placa_alias: placas.length === 1 ? placas[0] : '*',
          tiempodetencion: '5',
        });
        const ok = new Set(placas.map(norm));
        const mias = filasRes.filter((r: any) => ok.has(norm(r?.placa)) || ok.has(norm(r?.alias)));
        const detalleFallos = [
          errDetenciones ? `wsDetenciones: ${errDetenciones}` : null,
          errSoap ? `SOAP ultimo_punto: ${errSoap}` : null,
        ].filter(Boolean).join(' · ');
        return json({
          ok: true,
          filas: [],
          resumen: mias,
          aviso: `El servidor de Detektor reporta la actividad diaria del equipo, pero su servicio de coordenadas respondió error (${detalleFallos || 'sin coordenadas'}).`,
        });
      } catch {
        // Si incluso el resumen diario falló (ej. credenciales inválidas o caída total de Detektor):
        throw new Error(errDetenciones || errSoap || 'Detektor no respondió.');
      }
    }

    const desde = String(body?.desde ?? '');
    const hasta = String(body?.hasta ?? '');
    if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde) return json({ error: 'Fechas no válidas (AAAA-MM-DD, desde ≤ hasta).' }, 400);

    if (accion === 'resumen') {
      if (diasEntre(desde, hasta) > 31) return json({ error: 'El resumen es de hasta 31 días.' }, 400);
      const placas = await soloVinculadas(body?.placas);
      if (!placas.length) return json({ ok: true, filas: [] });
      // El servicio acepta UNA placa o «*»: con varias se pide «*» y se dejan solo las vinculadas.
      const filas = await detektor('wsResumenActividadDiaria', { fechainicio: desde, fechafinal: hasta, placa_alias: placas.length === 1 ? placas[0] : '*', tiempodetencion: String(Math.max(1, Math.min(60, Number(body?.tiempodetencion) || 5))) });
      const ok = new Set(placas.map(norm));
      const mias = filas.filter((r: any) => ok.has(norm(r?.placa)) || ok.has(norm(r?.alias)));
      // Diagnóstico (12-nov): cómo nombra Detektor cada dato y un valor de muestra del último día.
      const ultimoDia = mias.reduce((m: string, r: any) => (String(r?.fecha ?? '') > m ? String(r?.fecha ?? '') : m), '');
      const muestra = mias.filter((r: any) => String(r?.fecha ?? '') === ultimoDia).slice(0, 12)
        .map((r: any) => `${r?.motivo ?? '?'}=${r?.valor ?? '?'}`).join(' | ');
      if (muestra) console.log(`[gps-detektor] resumen ${ultimoDia} · campos: ${Object.keys(mias[0] ?? {}).join(',')} · ${muestra}`);
      return json({ ok: true, filas: mias });
    }

    if (accion === 'detenciones') {
      if (diasEntre(desde, hasta) > 7) return json({ error: 'Las detenciones son de hasta 7 días.' }, 400);
      const placas = await soloVinculadas([body?.placa]);
      if (!placas.length) return json({ error: 'Esa placa no está vinculada en el sistema.' }, 400);
      const filas = await detektor('wsDetenciones', { placas_alias: placas[0], fechainicio: `${desde} 00:00:00`, fechafinal: `${hasta} 23:59:59` });
      return json({ ok: true, filas: soloDe(filas, placas) });
    }

    if (accion === 'estadistico') {
      if (diasEntre(desde, hasta) > 31) return json({ error: 'Las estadísticas son de hasta 31 días.' }, 400);
      const motivo = String(body?.motivo ?? '').trim();
      if (!/^\d{1,5}$/.test(motivo)) return json({ error: 'Motivo no válido (el código del catálogo de motivos).' }, 400);
      const placas = await soloVinculadas(body?.placas);
      if (!placas.length) return json({ ok: true, filas: [] });
      const filas = await detektor('wsEstadisticoREST', { motivo, placas_alias: placas.join(','), fechainicio: `${desde} 00:00:00`, fechafinal: `${hasta} 23:59:59`, tipoconsulta: 'completo' });
      return json({ ok: true, filas: soloDe(filas, placas) });
    }

    return json({ error: 'Acción no válida.' }, 400);
  } catch (e) {
    // Nunca se devuelve ni se registra el usuario o la clave: solo el mensaje.
    return json({ error: (e as Error)?.message || 'Error inesperado' }, 502);
  }
});
