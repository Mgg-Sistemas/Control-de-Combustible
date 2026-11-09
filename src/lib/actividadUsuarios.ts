// 👥 ACTIVIDAD DE USUARIOS (09-nov-2026, a pedido: «saber quiénes y dónde está activo el usuario
// de x persona, y llevar esas métricas como en el sistema de Golden Touch»).
//
// Calcado de Golden Touch (`modules/usuarios/actividadUsuarios.ts` + latido del AppShell), con
// dos cambios para no pesar:
//   · LATIDO cada 60 s (solo con la pestaña visible) a la función `latido_sesion`: prolonga la
//     sesión de ESE equipo o abre una nueva si hubo ausencia (>5 min). Una escritura chiquita
//     por minuto; la tabla `sesiones_usuario` NO va a la auditoría ni al tiempo real.
//   · El RESUMEN se calcula EN LA BASE (`auditoria_actividad`): por la red viaja solo el
//     resumen (conectados, totales por usuario, por día y acciones por tabla), nunca la
//     bitácora completa. Solo lo ve quien ve la auditoría (admin o can_audit); la tabla no se
//     lee directo (sin políticas: solo por las funciones).
//   · «Conectado» = su último latido es de hace menos de 3 minutos.
//   · «Por día» corta de 7am a 7am (la jornada), como todo el sistema.
//   · Se guarda: tipo de equipo, navegador, pantalla actual y versión de la app. NO GPS ni IP.
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { caracasBusinessToday } from './caracasDay';
import { moduloDeFila, MODULO_OTRO } from './auditModulos';

// ═══════════════════════════ El equipo ═══════════════════════════

export type Dispositivo = 'android' | 'iphone' | 'ipad' | 'pc' | 'mac' | 'otro';

/** Qué equipo es, por el «user agent» del navegador (o la plataforma en la app nativa). */
export function dispositivoDeUA(ua: string | null | undefined, plataforma?: string): Dispositivo {
  const u = String(ua ?? '');
  if (/iPad/i.test(u)) return 'ipad';
  if (/iPhone|iPod/i.test(u)) return 'iphone';
  if (/Android/i.test(u)) return 'android';
  if (/Windows/i.test(u)) return 'pc';
  if (/Macintosh|Mac OS X/i.test(u)) return 'mac';
  if (/Linux|CrOS/i.test(u)) return 'pc';
  if (plataforma === 'android') return 'android';
  if (plataforma === 'ios') return 'iphone';
  return 'otro';
}

export function navegadorDeUA(ua: string | null | undefined, plataforma?: string): string {
  const u = String(ua ?? '');
  if (!u) return plataforma && plataforma !== 'web' ? 'app' : '';
  if (/Edg\//i.test(u)) return 'edge';
  if (/OPR\/|Opera/i.test(u)) return 'opera';
  if (/SamsungBrowser/i.test(u)) return 'samsung';
  if (/Firefox\//i.test(u)) return 'firefox';
  if (/Chrome\//i.test(u)) return 'chrome';
  if (/Safari\//i.test(u)) return 'safari';
  return 'otro';
}

export function etiquetaDispositivo(d: string | null | undefined): string {
  switch (d) {
    case 'android': return '📱 Android';
    case 'iphone': return '📱 iPhone';
    case 'ipad': return '📱 iPad';
    case 'pc': return '💻 PC';
    case 'mac': return '💻 Mac';
    default: return '🖥️ Otro';
  }
}

// ═══════════════════════════ La pantalla actual ═══════════════════════════

let pantallaActual = '';
/** Lo llama la navegación cada vez que cambia de pantalla (solo se guarda el nombre). */
export function setPantallaActual(nombre: string | null | undefined): void { pantallaActual = String(nombre ?? '').slice(0, 60); }
export function getPantallaActual(): string { return pantallaActual; }

/** El nombre de la pantalla más adentro del estado de la navegación. */
export function pantallaDeEstado(state: any): string {
  let s = state;
  let nombre = '';
  for (let i = 0; i < 12 && s && Array.isArray(s.routes); i++) {
    const r = s.routes[typeof s.index === 'number' ? s.index : s.routes.length - 1];
    if (!r) break;
    nombre = String(r.name ?? nombre);
    s = r.state;
  }
  return nombre;
}

// ═══════════════════════════ El latido ═══════════════════════════

/** La huella de la versión cargada (el bundle de la web), para avisar quién quedó atrás. */
export function versionCargada(): string {
  try {
    const scripts = Array.from((globalThis as any).document?.querySelectorAll?.('script[src]') ?? []) as any[];
    for (const s of scripts) {
      const m = String(s?.src ?? '').match(/index-[a-f0-9]+\.js/);
      if (m) return m[0];
    }
  } catch { /* nativo o sin documento */ }
  return String(process.env.EXPO_PUBLIC_BUILD_ID ?? '') || Platform.OS;
}

/**
 * Un latido. Silencioso a propósito: es presencia en segundo plano; si falla (sin señal),
 * el siguiente minuto vuelve a intentar y nadie tiene que enterarse.
 */
export async function enviarLatido(): Promise<void> {
  try {
    const ua = String((globalThis as any).navigator?.userAgent ?? '');
    await supabase.rpc('latido_sesion', {
      p_dispositivo: dispositivoDeUA(ua, Platform.OS),
      p_navegador: navegadorDeUA(ua, Platform.OS),
      p_pantalla: getPantallaActual() || null,
      p_version: versionCargada() || null,
    });
  } catch { /* sin señal: el próximo latido lo intenta */ }
}

export const LATIDO_MS = 60_000;
export const VENTANA_CONECTADO_MIN = 3;

// ═══════════════════════════ Los períodos (jornada de 7am a 7am) ═══════════════════════════

export type Periodo = 'hoy' | '7d' | 'mes' | 'todo' | 'rango';

const sumarDias = (iso: string, n: number): string => {
  const d = new Date(iso + 'T12:00:00-04:00');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Inicio de la jornada «YYYY-MM-DD» (7am Caracas) como ISO. */
export const inicioJornada = (iso: string): string => new Date(`${iso}T07:00:00-04:00`).toISOString();

/** El rango [desde, hasta) en instantes, y su texto. Jornadas enteras de 7am a 7am. */
export function rangoDePeriodo(p: Periodo, hoy: string = caracasBusinessToday(), desde?: string, hasta?: string): { desde: string; hasta: string; texto: string } {
  const fin = (iso: string) => inicioJornada(sumarDias(iso, 1));
  if (p === 'hoy') return { desde: inicioJornada(hoy), hasta: fin(hoy), texto: `Hoy (${fechaCorta(hoy)})` };
  if (p === '7d') return { desde: inicioJornada(sumarDias(hoy, -6)), hasta: fin(hoy), texto: `Últimos 7 días (${fechaCorta(sumarDias(hoy, -6))} – ${fechaCorta(hoy)})` };
  if (p === 'mes') { const ini = hoy.slice(0, 8) + '01'; return { desde: inicioJornada(ini), hasta: fin(hoy), texto: `Este mes (desde ${fechaCorta(ini)})` }; }
  if (p === 'todo') return { desde: new Date('2026-01-01T07:00:00-04:00').toISOString(), hasta: fin(hoy), texto: 'Todo el historial' };
  const d = desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : hoy;
  const h = hasta && /^\d{4}-\d{2}-\d{2}$/.test(hasta) && hasta >= d ? hasta : d;
  return { desde: inicioJornada(d), hasta: fin(h), texto: d === h ? fechaCorta(d) : `Del ${fechaCorta(d)} al ${fechaCorta(h)}` };
}

export const fechaCorta = (iso: string): string => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);

// ═══════════════════════════ El resumen ═══════════════════════════

export type Conectado = { user_id: string; nombre: string; inicio: string; ultimo_latido: string; dispositivo: string | null; navegador: string | null; pantalla: string | null; version: string | null };
export type UsuarioResumen = { user_id: string; nombre: string; rol: string | null; sesiones: number; minutos: number; acciones: number; ultima: string | null };
export type AccionesTabla = { tabla: string; accion: string; n: number };
export type DiaResumen = { dia: string; minutos: number; acciones: number; usuarios: number };
export type ResumenActividad = { ahora: string; conectados: Conectado[]; usuarios: UsuarioResumen[]; acciones_por_tabla: AccionesTabla[]; por_dia: DiaResumen[] };

const num = (v: unknown): number => { const n = typeof v === 'string' ? Number(v) : (v as number); return Number.isFinite(n) ? n : 0; };

/** Lo que manda la base, saneado (números en texto, nulos). */
export function normalizarResumen(r: any): ResumenActividad {
  return {
    ahora: String(r?.ahora ?? new Date().toISOString()),
    conectados: (Array.isArray(r?.conectados) ? r.conectados : []).map((c: any) => ({
      user_id: String(c?.user_id ?? ''), nombre: String(c?.nombre ?? '—'), inicio: String(c?.inicio ?? ''), ultimo_latido: String(c?.ultimo_latido ?? ''),
      dispositivo: c?.dispositivo ?? null, navegador: c?.navegador ?? null, pantalla: c?.pantalla ?? null, version: c?.version ?? null,
    })),
    usuarios: (Array.isArray(r?.usuarios) ? r.usuarios : []).map((u: any) => ({
      user_id: String(u?.user_id ?? ''), nombre: String(u?.nombre ?? '—'), rol: u?.rol ?? null,
      sesiones: num(u?.sesiones), minutos: num(u?.minutos), acciones: num(u?.acciones), ultima: u?.ultima ?? null,
    })),
    acciones_por_tabla: (Array.isArray(r?.acciones_por_tabla) ? r.acciones_por_tabla : []).map((a: any) => ({ tabla: String(a?.tabla ?? ''), accion: String(a?.accion ?? ''), n: num(a?.n) })),
    por_dia: (Array.isArray(r?.por_dia) ? r.por_dia : []).map((d: any) => ({ dia: String(d?.dia ?? '').slice(0, 10), minutos: num(d?.minutos), acciones: num(d?.acciones), usuarios: num(d?.usuarios) })),
  };
}

export async function cargarActividad(desde: string, hasta: string): Promise<ResumenActividad> {
  const { data, error } = await supabase.rpc('auditoria_actividad', { p_desde: desde, p_hasta: hasta });
  if (error) {
    if (/does not exist|could not find/i.test(error.message)) throw new Error('El panel de usuarios todavía no está activado en la base de datos.');
    throw new Error(`No se pudo cargar la actividad: ${error.message}`);
  }
  return normalizarResumen(data);
}

export type SesionDetalle = { inicio: string; ultimo_latido: string; dispositivo: string | null; navegador: string | null; pantalla: string | null; version: string | null };
export type DetalleUsuario = { sesiones: SesionDetalle[]; acciones_por_tabla: AccionesTabla[]; ultimas: { at: string; action: string; table_name: string; row_label: string | null }[] };

export async function cargarActividadUsuario(userId: string, desde: string, hasta: string): Promise<DetalleUsuario> {
  const { data, error } = await supabase.rpc('auditoria_actividad_usuario', { p_user: userId, p_desde: desde, p_hasta: hasta });
  if (error) throw new Error(`No se pudo cargar el detalle: ${error.message}`);
  const d: any = data ?? {};
  return {
    sesiones: Array.isArray(d.sesiones) ? d.sesiones : [],
    acciones_por_tabla: (Array.isArray(d.acciones_por_tabla) ? d.acciones_por_tabla : []).map((a: any) => ({ tabla: String(a?.tabla ?? ''), accion: String(a?.accion ?? ''), n: num(a?.n) })),
    ultimas: Array.isArray(d.ultimas) ? d.ultimas : [],
  };
}

// ═══════════════════════════ Cuentas para pintar ═══════════════════════════

/** «2h 15m» / «45m». */
export function fmtDuracion(min: number): string {
  const m = Math.max(0, Math.round(num(min)));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Minutos desde `desde` hasta `ahora` (para «conectado hace…»). */
export const minutosEntre = (desde: string, ahora: string): number => Math.max(0, (new Date(ahora).getTime() - new Date(desde).getTime()) / 60000);

/** Acciones por módulo (la misma regla de la bitácora: `moduloDeFila`), de mayor a menor. */
export function accionesPorModulo(filas: AccionesTabla[]): { modulo: string; n: number }[] {
  const m = new Map<string, number>();
  for (const f of filas ?? []) {
    const mod = moduloDeFila({ table_name: f.tabla, action: f.accion });
    const k = mod ? `${mod.icon} ${mod.label}` : MODULO_OTRO;
    m.set(k, (m.get(k) ?? 0) + num(f.n));
  }
  return [...m.entries()].map(([modulo, n]) => ({ modulo, n })).sort((a, b) => b.n - a.n || a.modulo.localeCompare(b.modulo, 'es'));
}

/** Totales de las tarjetas de arriba. */
export function totalesActividad(r: ResumenActividad): { conectados: number; minutos: number; sesiones: number; activos: number; acciones: number } {
  const us = r.usuarios ?? [];
  return {
    conectados: (r.conectados ?? []).length,
    minutos: us.reduce((s, u) => s + u.minutos, 0),
    sesiones: us.reduce((s, u) => s + u.sesiones, 0),
    activos: us.filter((u) => u.sesiones > 0 || u.acciones > 0).length,
    acciones: us.reduce((s, u) => s + u.acciones, 0),
  };
}

/** ¿Ese equipo quedó con una versión anterior a la que se está viendo? (solo web) */
export function versionVieja(version: string | null | undefined, actual: string): boolean {
  const v = String(version ?? '');
  return /^index-[a-f0-9]+\.js$/.test(v) && /^index-[a-f0-9]+\.js$/.test(actual) && v !== actual;
}

/** Nombre corto para las barras: «DORIANNE PEREZ» → «DORIANNE PEREZ» (sin cambiar), limitado. */
export const nombreCorto = (n: string): string => (String(n ?? '').length > 26 ? String(n).slice(0, 25) + '…' : String(n ?? '—'));
