// Edge Function: 📡 puente con los servicios web de DETEKTOR (GPS de las máquinas). 12-nov-2026.
//
// ⭐ El usuario y la clave de Detektor viven SOLO aquí (secretos DETEKTOR_USUARIO y DETEKTOR_CLAVE):
//    nunca llegan al teléfono ni a la PC. Quien llama tiene que tener sesión y el permiso «GPS»
//    (función gps_puede_ver), y solo se consultan las placas VINCULADAS en la tabla gps_vehiculos
//    (que lee con SU sesión: la RLS decide). Descubrir los vehículos de la cuenta pide escritura.
//
// Acciones (POST JSON { accion, ... }):
//   · vehiculos                      → los vehículos de la cuenta (placa y alias), para vincular.
//   · ubicacion   { placas[] }       → las detenciones de las últimas 36 h (la app saca la última).
//   · resumen     { placas[], desde, hasta } (AAAA-MM-DD, hasta 31 días) → resumen de actividad diaria.
//   · detenciones { placa, desde, hasta } (AAAA-MM-DD, hasta 7 días)     → detenciones con lat/lng.
//   · estadistico { placas[], motivo, desde, hasta } (hasta 31 días)    → datos por motivo y día.
// Las respuestas se guardan 60 s en memoria: varias personas mirando lo mismo = 1 consulta a Detektor.
//
// Desplegar:  supabase functions deploy gps-detektor
// Secretos:   supabase secrets set DETEKTOR_USUARIO=... DETEKTOR_CLAVE=...
//             (opcional) DETEKTOR_URL=https://ve.detektorgps.com/gps_ve/framework/servicios
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const BASE = (Deno.env.get('DETEKTOR_URL') || 'https://ve.detektorgps.com/gps_ve/framework/servicios').replace(/\/+$/, '');
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

/** Le pregunta a Detektor (formulario POST, como su manual). Devuelve la lista o lanza con su mensaje. */
async function detektor(servicio: string, params: Record<string, string>): Promise<unknown[]> {
  const usuario = Deno.env.get('DETEKTOR_USUARIO');
  const pass = Deno.env.get('DETEKTOR_CLAVE');
  if (!usuario || !pass) throw new Error('Falta configurar el usuario y la clave de Detektor en Supabase (DETEKTOR_USUARIO y DETEKTOR_CLAVE).');
  const clave = `${servicio}|${JSON.stringify(params)}`;
  const c = cache.get(clave);
  if (c && Date.now() - c.t < CACHE_MS) return c.filas;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(`${BASE}/${servicio}/datos.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ usuario, pass, ...params }).toString(),
      signal: ctrl.signal,
    });
    const texto = await res.text();
    if (!res.ok) throw new Error(`Detektor respondió ${res.status}.`);
    let d: any;
    try { d = JSON.parse(texto); } catch { throw new Error('Detektor respondió algo que no es JSON.'); }
    if (!Array.isArray(d)) {
      if (d?.status === 'fail') throw new Error(`Detektor: ${d.info || 'error'}`);
      if (Array.isArray(d?.data)) d = d.data; else throw new Error('Detektor respondió algo que no se entiende.');
    }
    cache.set(clave, { t: Date.now(), filas: d });
    return d;
  } catch (e) {
    if ((e as any)?.name === 'AbortError') throw new Error('Detektor tardó demasiado en responder.');
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

    if (accion === 'vehiculos') {
      const hoy = fechaVe(Date.now()).slice(0, 10);
      const ayer = fechaVe(Date.now() - 86_400_000).slice(0, 10);
      const filas = await detektor('wsResumenActividadDiaria', { fechainicio: ayer, fechafinal: hoy, placa_alias: '*', tiempodetencion: '5' });
      return json({ ok: true, filas: filas.map((r: any) => ({ placa: r?.placa ?? '', alias: r?.alias ?? '' })) });
    }

    if (accion === 'ubicacion') {
      const placas = await soloVinculadas(body?.placas);
      if (!placas.length) return json({ ok: true, filas: [] });
      const ahora = Date.now();
      const filas = await detektor('wsDetenciones', { placas_alias: placas.join(','), fechainicio: fechaVe(ahora - 36 * 3600_000), fechafinal: fechaVe(ahora) });
      return json({ ok: true, filas });
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
      return json({ ok: true, filas: filas.filter((r: any) => ok.has(norm(r?.placa)) || ok.has(norm(r?.alias))) });
    }

    if (accion === 'detenciones') {
      if (diasEntre(desde, hasta) > 7) return json({ error: 'Las detenciones son de hasta 7 días.' }, 400);
      const placas = await soloVinculadas([body?.placa]);
      if (!placas.length) return json({ error: 'Esa placa no está vinculada en el sistema.' }, 400);
      const filas = await detektor('wsDetenciones', { placas_alias: placas[0], fechainicio: `${desde} 00:00:00`, fechafinal: `${hasta} 23:59:59` });
      return json({ ok: true, filas });
    }

    if (accion === 'estadistico') {
      if (diasEntre(desde, hasta) > 31) return json({ error: 'Las estadísticas son de hasta 31 días.' }, 400);
      const motivo = String(body?.motivo ?? '').trim();
      if (!/^\d{1,5}$/.test(motivo)) return json({ error: 'Motivo no válido (el código del catálogo de motivos).' }, 400);
      const placas = await soloVinculadas(body?.placas);
      if (!placas.length) return json({ ok: true, filas: [] });
      const filas = await detektor('wsEstadisticoREST', { motivo, placas_alias: placas.join(','), fechainicio: `${desde} 00:00:00`, fechafinal: `${hasta} 23:59:59`, tipoconsulta: 'completo' });
      return json({ ok: true, filas });
    }

    return json({ error: 'Acción no válida.' }, 400);
  } catch (e) {
    // Nunca se devuelve ni se registra el usuario o la clave: solo el mensaje.
    return json({ error: (e as Error)?.message || 'Error inesperado' }, 502);
  }
});
