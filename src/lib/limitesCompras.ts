// ============================================================================
// 📊 LÍMITES AJUSTABLES PARA SOLICITUDES DE COMPRA Y REQUERIMIENTOS (12-nov-2026)
//
// Permite al administrador colocar y manipular cuando lo necesite un límite
// máximo para todos los usuarios (y excepciones opcionales por usuario):
//  1) Solicitudes de Compra: máximo por usuario (en curso / pendientes o por
//     jornada 7am–7am Caracas) y máximo de renglones (ítems) por solicitud.
//  2) Requerimientos: máximo por usuario (en curso / pendientes o por jornada
//     7am–7am Caracas), máximo de renglones (ítems) y monto máximo en USD ($).
//  3) Visualización en bandejas: cantidad máxima ajustable de tarjetas visibles
//     en pantalla (aplicado SIEMPRE después de los filtros de búsqueda/estado/
//     empresa/fecha para no esconder resultados al buscar).
//
// Reglas blindadas (consenso de los 8 agentes):
//  - `0`, `null`, `""` o `<= 0` significa SIEMPRE «Sin límite» (`0`), evitando
//    que una comparación `0 >= 0` bloquee por accidente el sistema.
//  - El tope de cantidad de solicitudes/requerimientos SOLO aplica al CREAR un
//    registro nuevo: JAMÁS bloquea editar uno existente, cancelar, responder
//    aclaratorias técnicas, convertir una Solicitud en Requerimiento, pasar a
//    Por Pagar ni recibir en Almacén.
// ============================================================================
import type { InventoryRequirement } from '../types/database';
import { leerNumero } from './numeros';
import { caracasBusinessToday, jornadaDeFecha, jornadaWindowISO } from './caracasDay';
import {
  esSolicitudDeCompra,
  estaSolicitudConvertidaEnRequerimiento,
  esRequerimientoVisibleEnBandejaRequerimientos,
} from './requerimientoFlujo';

export const KEY_FEATURE_LIMITES_COMPRAS = 'compras_limites_usuarios';
export const STORAGE_KEY_LIMITES_COMPRAS = 'compras_limites_usuarios_v1';

export type ModoConteoLimite = 'activos' | 'jornada';

export interface ExcepcionLimiteUsuario {
  userId: string;
  userName?: string | null;
  /** null/undefined = usa el general; 0 = sin límite para este usuario; >0 = tope propio */
  maxSolicitudes?: number | null;
  maxRequerimientos?: number | null;
  maxMontoUsd?: number | null;
}

export interface ConfigLimitesCompras {
  activo: boolean;
  /** Máximo de Solicitudes de Compra por usuario (0 = sin límite / ∞). */
  maxSolicitudesPorUsuario: number;
  /** 'activos' (en curso pendientes) o 'jornada' (día de trabajo 7am–7am Caracas). */
  modoConteoSolicitudes: ModoConteoLimite;
  /** Máximo de productos/renglones por Solicitud de Compra (0 = sin límite; default 50). */
  maxItemsPorSolicitud: number;
  /** Máximo de Requerimientos por usuario (0 = sin límite / ∞). */
  maxRequerimientosPorUsuario: number;
  /** 'activos' (pendientes de enviar a Por Pagar) o 'jornada' (7am–7am Caracas). */
  modoConteoRequerimientos: ModoConteoLimite;
  /** Máximo de productos/renglones por Requerimiento (0 = sin límite; default 50). */
  maxItemsPorRequerimiento: number;
  /** Monto máximo en USD ($) por Requerimiento al crearlo/guardarlo (0 = sin límite). */
  maxMontoUsdRequerimiento: number;
  /** Cantidad máxima de tarjetas visibles por defecto en las bandejas (0 = todas; default 50). */
  maxTarjetasVisibles: number;
  /** Si true, el límite también aplica a los usuarios con rol admin. Default false. */
  aplicarAAdmins: boolean;
  /** Excepciones opcionales para usuarios puntuales (userId -> ExcepcionLimiteUsuario). */
  excepcionesPorUsuario: Record<string, ExcepcionLimiteUsuario>;
}

export const CONFIG_LIMITES_COMPRAS_DEFAULT: ConfigLimitesCompras = {
  activo: true,
  maxSolicitudesPorUsuario: 0,
  modoConteoSolicitudes: 'activos',
  maxItemsPorSolicitud: 50,
  maxRequerimientosPorUsuario: 0,
  modoConteoRequerimientos: 'activos',
  maxItemsPorRequerimiento: 50,
  maxMontoUsdRequerimiento: 0,
  maxTarjetasVisibles: 50,
  aplicarAAdmins: false,
  excepcionesPorUsuario: {},
};

export const OPCIONES_RAPIDAS_TOPE = [0, 3, 5, 10, 15, 20, 30, 50] as const;
export const OPCIONES_TARJETAS_VISIBLES = [20, 30, 50, 100, 200, 0] as const;

let memoriaConfigLimites: ConfigLimitesCompras = { ...CONFIG_LIMITES_COMPRAS_DEFAULT };

/**
 * Normaliza un tope numérico entero.
 * `0`, vacío, `null`, `NaN` o negativos devuelven `0` («Sin límite»).
 */
export function normalizarTopeEntero(raw: unknown, maxPermitido = 10000): number {
  if (raw === null || raw === undefined || raw === '' || raw === false) return 0;
  if (typeof raw === 'string' && /^(todos|todas|all|sin\s*l[ií]mite|infinito|∞)$/i.test(raw.trim())) {
    return 0;
  }
  const n = typeof raw === 'number' ? raw : leerNumero(String(raw));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(maxPermitido, Math.max(1, Math.floor(n)));
}

/**
 * Normaliza un tope de monto en USD ($).
 * `0`, vacío, `null`, `NaN` o negativos devuelven `0` («Sin límite»).
 */
export function normalizarTopeMontoUsd(raw: unknown, maxPermitido = 10000000): number {
  if (raw === null || raw === undefined || raw === '' || raw === false) return 0;
  const n = typeof raw === 'number' ? raw : leerNumero(String(raw));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(maxPermitido, Math.round(n * 100) / 100);
}

export function normalizarModoConteo(raw: unknown): ModoConteoLimite {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'jornada' || s === 'diario' || s === 'dia' || s === 'día') return 'jornada';
  return 'activos';
}

export function normalizarConfigLimitesCompras(
  raw?: Partial<ConfigLimitesCompras> | Record<string, any> | null,
): ConfigLimitesCompras {
  if (!raw || typeof raw !== 'object') {
    return { ...CONFIG_LIMITES_COMPRAS_DEFAULT, excepcionesPorUsuario: {} };
  }
  const excRaw =
    raw.excepcionesPorUsuario && typeof raw.excepcionesPorUsuario === 'object'
      ? raw.excepcionesPorUsuario
      : {};
  const excepcionesPorUsuario: Record<string, ExcepcionLimiteUsuario> = {};
  for (const [uid, val] of Object.entries(excRaw)) {
    if (!uid || !val || typeof val !== 'object') continue;
    const v = val as any;
    excepcionesPorUsuario[uid] = {
      userId: uid,
      userName: v.userName ? String(v.userName) : null,
      maxSolicitudes:
        v.maxSolicitudes === null || v.maxSolicitudes === undefined || v.maxSolicitudes === ''
          ? null
          : normalizarTopeEntero(v.maxSolicitudes),
      maxRequerimientos:
        v.maxRequerimientos === null || v.maxRequerimientos === undefined || v.maxRequerimientos === ''
          ? null
          : normalizarTopeEntero(v.maxRequerimientos),
      maxMontoUsd:
        v.maxMontoUsd === null || v.maxMontoUsd === undefined || v.maxMontoUsd === ''
          ? null
          : normalizarTopeMontoUsd(v.maxMontoUsd),
    };
  }

  return {
    activo: raw.activo !== false,
    maxSolicitudesPorUsuario: normalizarTopeEntero(raw.maxSolicitudesPorUsuario),
    modoConteoSolicitudes: normalizarModoConteo(raw.modoConteoSolicitudes),
    maxItemsPorSolicitud:
      raw.maxItemsPorSolicitud === undefined
        ? CONFIG_LIMITES_COMPRAS_DEFAULT.maxItemsPorSolicitud
        : normalizarTopeEntero(raw.maxItemsPorSolicitud, 500),
    maxRequerimientosPorUsuario: normalizarTopeEntero(raw.maxRequerimientosPorUsuario),
    modoConteoRequerimientos: normalizarModoConteo(raw.modoConteoRequerimientos),
    maxItemsPorRequerimiento:
      raw.maxItemsPorRequerimiento === undefined
        ? CONFIG_LIMITES_COMPRAS_DEFAULT.maxItemsPorRequerimiento
        : normalizarTopeEntero(raw.maxItemsPorRequerimiento, 500),
    maxMontoUsdRequerimiento: normalizarTopeMontoUsd(raw.maxMontoUsdRequerimiento),
    maxTarjetasVisibles:
      raw.maxTarjetasVisibles === undefined
        ? CONFIG_LIMITES_COMPRAS_DEFAULT.maxTarjetasVisibles
        : normalizarTopeEntero(raw.maxTarjetasVisibles, 5000),
    aplicarAAdmins: Boolean(raw.aplicarAAdmins),
    excepcionesPorUsuario,
  };
}

/** Lee la configuración desde caché local / memoria (síncrono para inicializar estados React). */
export function obtenerConfigLimitesCompras(): ConfigLimitesCompras {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEY_LIMITES_COMPRAS);
      if (raw) {
        const parsed = JSON.parse(raw);
        memoriaConfigLimites = normalizarConfigLimitesCompras(parsed);
        return memoriaConfigLimites;
      }
    }
  } catch {
    // Fallback a memoria
  }
  return memoriaConfigLimites;
}

/** Guarda la configuración en caché local / memoria. */
export function guardarConfigLimitesComprasLocal(cfg: Partial<ConfigLimitesCompras>): ConfigLimitesCompras {
  const normalizada = normalizarConfigLimitesCompras({
    ...memoriaConfigLimites,
    ...cfg,
  });
  memoriaConfigLimites = normalizada;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY_LIMITES_COMPRAS, JSON.stringify(normalizada));
    }
  } catch {
    // Ignorar error de quota en navegador
  }
  return normalizada;
}

export interface LimitesEfectivosUsuario {
  activo: boolean;
  exentoPorRol: boolean;
  tieneExcepcionPersonal: boolean;
  maxSolicitudes: number;
  modoConteoSolicitudes: ModoConteoLimite;
  maxItemsSolicitud: number;
  maxRequerimientos: number;
  modoConteoRequerimientos: ModoConteoLimite;
  maxItemsRequerimiento: number;
  maxMontoUsdRequerimiento: number;
  maxTarjetasVisibles: number;
}

/** Resuelve el límite efectivo para un usuario dado (aplicando excepción individual si existe). */
export function resolverLimitesParaUsuario(
  cfg: ConfigLimitesCompras,
  userId?: string | null,
  isAdmin?: boolean,
): LimitesEfectivosUsuario {
  const norm = normalizarConfigLimitesCompras(cfg);
  const exc = userId ? norm.excepcionesPorUsuario[userId] : undefined;
  const tieneExcepcionPersonal = Boolean(
    exc &&
      (exc.maxSolicitudes !== null && exc.maxSolicitudes !== undefined ||
        exc.maxRequerimientos !== null && exc.maxRequerimientos !== undefined ||
        exc.maxMontoUsd !== null && exc.maxMontoUsd !== undefined),
  );
  const exentoPorRol = Boolean(isAdmin && !norm.aplicarAAdmins);

  return {
    activo: norm.activo,
    exentoPorRol,
    tieneExcepcionPersonal,
    maxSolicitudes:
      exc && exc.maxSolicitudes !== null && exc.maxSolicitudes !== undefined
        ? normalizarTopeEntero(exc.maxSolicitudes)
        : norm.maxSolicitudesPorUsuario,
    modoConteoSolicitudes: norm.modoConteoSolicitudes,
    maxItemsSolicitud: norm.maxItemsPorSolicitud,
    maxRequerimientos:
      exc && exc.maxRequerimientos !== null && exc.maxRequerimientos !== undefined
        ? normalizarTopeEntero(exc.maxRequerimientos)
        : norm.maxRequerimientosPorUsuario,
    modoConteoRequerimientos: norm.modoConteoRequerimientos,
    maxItemsRequerimiento: norm.maxItemsPorRequerimiento,
    maxMontoUsdRequerimiento:
      exc && exc.maxMontoUsd !== null && exc.maxMontoUsd !== undefined
        ? normalizarTopeMontoUsd(exc.maxMontoUsd)
        : norm.maxMontoUsdRequerimiento,
    maxTarjetasVisibles: norm.maxTarjetasVisibles,
  };
}

function estaCanceladaORechazada(r: Partial<InventoryRequirement>): boolean {
  const st = String(r.status ?? '').toLowerCase();
  if (st === 'rechazado' || st === 'cancelado' || st === 'anulado') return true;
  const obs = `${r.observaciones ?? ''} ${r.decision_note ?? ''}`;
  if (/\[SOLICITUD CANCELADA/i.test(obs)) return true;
  return false;
}

function perteneceAUsuario(r: Partial<InventoryRequirement>, userId?: string | null): boolean {
  if (!userId) return false;
  return r.requested_by === userId || (r as any).solicitante_id === userId;
}

function caeEnJornadaActual(createdAt?: string | null, ahoraRef?: Date): boolean {
  if (!createdAt) return false;
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) return false;
  const diaNegocio = ahoraRef ? jornadaDeFecha(ahoraRef) : caracasBusinessToday();
  const { desdeISO, hastaExclusivoISO } = jornadaWindowISO(diaNegocio);
  const desdeMs = Date.parse(desdeISO);
  const hastaMs = Date.parse(hastaExclusivoISO);
  return ts >= desdeMs && ts < hastaMs;
}

/**
 * Cuenta cuántas Solicitudes de Compra computables tiene el usuario según el modo configurado:
 * - 'activos': Solicitudes de compra aún no convertidas en requerimiento y en estado
 *              'pendiente' o 'aclaratoria_solicitada' (excluye rechazadas/canceladas).
 * - 'jornada': Solicitudes de compra creadas por el usuario en la jornada actual
 *              (7:00 AM a 7:00 AM hora Caracas), excluyendo canceladas y rechazadas.
 */
export function contarSolicitudesDeUsuario(
  reqs: Partial<InventoryRequirement>[],
  userId?: string | null,
  modo: ModoConteoLimite = 'activos',
  ahoraRef?: Date,
): number {
  if (!userId || !Array.isArray(reqs)) return 0;
  let total = 0;
  for (const r of reqs) {
    if (!r || !perteneceAUsuario(r, userId)) continue;
    if (!esSolicitudDeCompra(r)) continue;
    if (estaCanceladaORechazada(r)) continue;
    if (modo === 'jornada') {
      if (caeEnJornadaActual(r.created_at, ahoraRef)) total++;
    } else {
      if (estaSolicitudConvertidaEnRequerimiento(r)) continue;
      const st = String(r.status ?? 'pendiente').toLowerCase();
      if (st === 'pendiente' || st === 'aclaratoria_solicitada') total++;
    }
  }
  return total;
}

/**
 * Cuenta cuántos Requerimientos computables tiene el usuario según el modo configurado:
 * - 'activos': Requerimientos en bandeja de Requerimientos con estado 'pendiente'
 *              o 'aclaratoria_solicitada' (pendientes de enviar a Por Pagar).
 * - 'jornada': Requerimientos creados en la jornada actual (7:00 AM a 7:00 AM Caracas),
 *              excluyendo rechazados/cancelados.
 */
export function contarRequerimientosDeUsuario(
  reqs: Partial<InventoryRequirement>[],
  userId?: string | null,
  modo: ModoConteoLimite = 'activos',
  ahoraRef?: Date,
): number {
  if (!userId || !Array.isArray(reqs)) return 0;
  let total = 0;
  for (const r of reqs) {
    if (!r || !perteneceAUsuario(r, userId)) continue;
    if (!esRequerimientoVisibleEnBandejaRequerimientos(r)) continue;
    if (estaCanceladaORechazada(r)) continue;
    if (modo === 'jornada') {
      if (caeEnJornadaActual(r.created_at, ahoraRef)) total++;
    } else {
      const st = String(r.status ?? 'pendiente').toLowerCase();
      if (st === 'pendiente' || st === 'aclaratoria_solicitada') total++;
    }
  }
  return total;
}

export interface EstadoCupoOperativo {
  tipo: 'solicitud' | 'requerimiento';
  activo: boolean;
  modo: ModoConteoLimite;
  usados: number;
  limite: number; // 0 = sin límite
  disponibles: number; // Infinity cuando no hay límite
  porcentaje: number; // 0 a 100
  enTope: boolean;
  cercaDelTope: boolean;
  exentoPorRol: boolean;
  permitidoCrear: boolean;
  maxItems: number;
  maxMontoUsd: number;
  etiquetaModo: string;
  resumenCorto: string;
  motivoBloqueo: string | null;
}

/** Evalúa el estado del cupo de Solicitudes de Compra para el usuario actual. */
export function evaluarCupoSolicitudes(params: {
  reqs: Partial<InventoryRequirement>[];
  cfg: ConfigLimitesCompras;
  userId?: string | null;
  isAdmin?: boolean;
  ahoraRef?: Date;
}): EstadoCupoOperativo {
  const eff = resolverLimitesParaUsuario(params.cfg, params.userId, params.isAdmin);
  const usados = contarSolicitudesDeUsuario(
    params.reqs,
    params.userId,
    eff.modoConteoSolicitudes,
    params.ahoraRef,
  );
  const limite = eff.activo ? eff.maxSolicitudes : 0;
  const disponibles = limite > 0 ? Math.max(0, limite - usados) : Number.POSITIVE_INFINITY;
  const porcentaje = limite > 0 ? Math.min(100, Math.round((usados / limite) * 100)) : 0;
  const alcanzotopeBruto = eff.activo && limite > 0 && usados >= limite;
  const enTope = alcanzotopeBruto && !eff.exentoPorRol;
  const cercaDelTope = eff.activo && limite > 0 && !alcanzotopeBruto && usados / limite >= 0.75;
  const etiquetaModo = eff.modoConteoSolicitudes === 'jornada' ? 'hoy (jornada)' : 'en curso';

  const resumenCorto =
    limite > 0
      ? `Solicitudes ${etiquetaModo}: ${usados} de ${limite} · Disponibles: ${disponibles}`
      : `Solicitudes ${etiquetaModo}: ${usados} · Sin límite máximo (∞)`;

  const motivoBloqueo = enTope
    ? `Alcanzaste el límite máximo permitido de ${limite} solicitud(es) de compra ${etiquetaModo} (${usados}/${limite}). Espera a que se procese alguna de las anteriores, cancela una que no necesites o pide al administrador que amplíe el límite.`
    : null;

  return {
    tipo: 'solicitud',
    activo: eff.activo,
    modo: eff.modoConteoSolicitudes,
    usados,
    limite,
    disponibles,
    porcentaje,
    enTope,
    cercaDelTope,
    exentoPorRol: eff.exentoPorRol,
    permitidoCrear: !enTope,
    maxItems: eff.activo ? eff.maxItemsSolicitud : 0,
    maxMontoUsd: 0,
    etiquetaModo,
    resumenCorto,
    motivoBloqueo,
  };
}

/** Evalúa el estado del cupo de Requerimientos para el usuario actual. */
export function evaluarCupoRequerimientos(params: {
  reqs: Partial<InventoryRequirement>[];
  cfg: ConfigLimitesCompras;
  userId?: string | null;
  isAdmin?: boolean;
  ahoraRef?: Date;
}): EstadoCupoOperativo {
  const eff = resolverLimitesParaUsuario(params.cfg, params.userId, params.isAdmin);
  const usados = contarRequerimientosDeUsuario(
    params.reqs,
    params.userId,
    eff.modoConteoRequerimientos,
    params.ahoraRef,
  );
  const limite = eff.activo ? eff.maxRequerimientos : 0;
  const disponibles = limite > 0 ? Math.max(0, limite - usados) : Number.POSITIVE_INFINITY;
  const porcentaje = limite > 0 ? Math.min(100, Math.round((usados / limite) * 100)) : 0;
  const alcanzoTopeBruto = eff.activo && limite > 0 && usados >= limite;
  const enTope = alcanzoTopeBruto && !eff.exentoPorRol;
  const cercaDelTope = eff.activo && limite > 0 && !alcanzoTopeBruto && usados / limite >= 0.75;
  const etiquetaModo = eff.modoConteoRequerimientos === 'jornada' ? 'hoy (jornada)' : 'en curso';

  const resumenCorto =
    limite > 0
      ? `Requerimientos ${etiquetaModo}: ${usados} de ${limite} · Disponibles: ${disponibles}`
      : `Requerimientos ${etiquetaModo}: ${usados} · Sin límite máximo (∞)`;

  const motivoBloqueo = enTope
    ? `Alcanzaste el límite máximo permitido de ${limite} requerimiento(s) ${etiquetaModo} (${usados}/${limite}). Envía o procesa los pendientes o pide al administrador que amplíe el límite.`
    : null;

  return {
    tipo: 'requerimiento',
    activo: eff.activo,
    modo: eff.modoConteoRequerimientos,
    usados,
    limite,
    disponibles,
    porcentaje,
    enTope,
    cercaDelTope,
    exentoPorRol: eff.exentoPorRol,
    permitidoCrear: !enTope,
    maxItems: eff.activo ? eff.maxItemsRequerimiento : 0,
    maxMontoUsd: eff.activo ? eff.maxMontoUsdRequerimiento : 0,
    etiquetaModo,
    resumenCorto,
    motivoBloqueo,
  };
}

/**
 * Valida antes de crear o editar una Solicitud de Compra o un Requerimiento.
 *
 * ⚠️ Regla de oro (Refutación Agente 5):
 * - Si `esEdicion === true`, JAMÁS bloquea por la cantidad de solicitudes/requerimientos
 *   en curso (`usados >= limite`), para no impedir corregir una solicitud, responder
 *   una aclaratoria o editar un requerimiento existente.
 * - Sí valida el tope de renglones (`maxItems`) y, en requerimientos, el tope de
 *   monto en USD (`maxMontoUsd`) si están configurados (> 0) y el usuario no está exento.
 */
export function validarOperacionConLimite(params: {
  tipo: 'solicitud' | 'requerimiento';
  esEdicion?: boolean;
  cantidadItems: number;
  montoTotalUsd?: number;
  reqs: Partial<InventoryRequirement>[];
  cfg: ConfigLimitesCompras;
  userId?: string | null;
  isAdmin?: boolean;
  ahoraRef?: Date;
}): { ok: boolean; error?: string; cupo: EstadoCupoOperativo } {
  const cupo =
    params.tipo === 'solicitud'
      ? evaluarCupoSolicitudes(params)
      : evaluarCupoRequerimientos(params);

  if (!cupo.activo || cupo.exentoPorRol) {
    return { ok: true, cupo };
  }

  // 1. Tope de cantidad de solicitudes / requerimientos (SOLO al crear uno nuevo)
  if (!params.esEdicion && cupo.enTope && cupo.motivoBloqueo) {
    return { ok: false, error: cupo.motivoBloqueo, cupo };
  }

  // 2. Tope de productos / renglones por documento
  if (cupo.maxItems > 0 && params.cantidadItems > cupo.maxItems) {
    const docLabel = params.tipo === 'solicitud' ? 'solicitud de compra' : 'requerimiento';
    return {
      ok: false,
      error: `El límite máximo es de ${cupo.maxItems} productos/renglones por ${docLabel} (intentas guardar ${params.cantidadItems}). Reduce los renglones o pide al administrador subir el máximo.`,
      cupo,
    };
  }

  // 3. Tope de monto en USD (para requerimientos cuando maxMontoUsd > 0)
  if (
    params.tipo === 'requerimiento' &&
    cupo.maxMontoUsd > 0 &&
    Number(params.montoTotalUsd ?? 0) > cupo.maxMontoUsd + 0.005
  ) {
    const montoFmt = Number(params.montoTotalUsd ?? 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const maxFmt = cupo.maxMontoUsd.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return {
      ok: false,
      error: `El monto del requerimiento ($${montoFmt} USD) supera el límite máximo permitido por requerimiento ($${maxFmt} USD). Ajusta el monto o pide al administrador ampliar el máximo.`,
      cupo,
    };
  }

  return { ok: true, cupo };
}

export interface ResultadoRecorteVisible<T> {
  visibles: T[];
  totalFiltrados: number;
  ocultosPorLimite: number;
  hayMas: boolean;
  limiteAplicado: number; // 0 = mostrando todos
}

/**
 * Aplica el límite ajustable de tarjetas visibles DESPUÉS de haber filtrado por
 * búsqueda, empresa, estado, prioridad y fecha (Invariante Agente 8).
 */
export function aplicarLimiteTarjetasVisibles<T>(
  listaFiltrada: T[],
  limiteTarjetas: unknown,
): ResultadoRecorteVisible<T> {
  const arr = Array.isArray(listaFiltrada) ? listaFiltrada : [];
  const totalFiltrados = arr.length;
  const lim = normalizarTopeEntero(limiteTarjetas, 5000);
  if (lim <= 0 || lim >= totalFiltrados) {
    return {
      visibles: arr,
      totalFiltrados,
      ocultosPorLimite: 0,
      hayMas: false,
      limiteAplicado: lim,
    };
  }
  return {
    visibles: arr.slice(0, lim),
    totalFiltrados,
    ocultosPorLimite: totalFiltrados - lim,
    hayMas: true,
    limiteAplicado: lim,
  };
}

