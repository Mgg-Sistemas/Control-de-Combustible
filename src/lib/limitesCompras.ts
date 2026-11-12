// ============================================================================
// 📊 LÍMITE MÁXIMO AJUSTABLE DE ÍTEMS (COSAS / RENGLONES) DENTRO DE UNA
//    SOLICITUD O REQUERIMIENTO (12-nov-2026)
//
// Permite al administrador colocar y manipular cuando lo necesite un límite
// máximo de cosas/ítems para todos los usuarios (y excepciones opcionales por
// usuario):
//  1) Solicitudes (`Pedir Material / Repuestos` y `Compras → Solicitudes`):
//     máximo de productos/renglones (`maxItemsPorSolicitud`, 0 = Sin límite / ∞).
//  2) Requerimientos (`Compras → Requerimientos`):
//     máximo de productos/renglones (`maxItemsPorRequerimiento`, 0 = Sin límite / ∞)
//     y monto máximo opcional en USD (`maxMontoUsdRequerimiento`, 0 = Sin límite).
//  3) Visualización en bandejas: cantidad máxima ajustable de tarjetas visibles
//     en pantalla (aplicado SIEMPRE después de los filtros de búsqueda/estado/
//     empresa/fecha para no esconder resultados al buscar).
//
// Reglas blindadas (consenso y refutaciones de los 8 agentes):
//  - JAMÁS se bloquea a un usuario por la cantidad de solicitudes o requerimientos
//    creados: el límite controla exclusivamente cuántas COSAS / ÍTEMS van dentro
//    de cada solicitud o requerimiento.
//  - `0`, `null`, `""` o `<= 0` significa SIEMPRE «Sin límite» (`0`), evitando
//    que una comparación `0 >= 0` bloquee por accidente el sistema.
//  - Regla de Derechos Adquiridos ("Grandfathering" en edición): si una solicitud
//    o requerimiento existente se creó cuando el límite era mayor (ej. tenía 12
//    ítems y hoy el límite se bajó a 5), al editarlo para corregir precios,
//    proveedor, notas, responder aclaratorias o quitar renglones se permite
//    guardar mientras `cantidadItems <= Math.max(maxItems, cantidadItemsOriginales)`.
//    Solo se impide AGREGAR nuevos ítems por encima del tope vigente.
//  - En `Pedir Material`, aumentar la cantidad (`qty`) de un mismo ítem de almacén
//    que ya está en la lista fusiona el renglón y NO consume un ítem extra.
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
  /** null/undefined = usa el general; 0 = sin límite de ítems para este usuario; >0 = tope propio de ítems por solicitud */
  maxItemsSolicitud?: number | null;
  /** null/undefined = usa el general; 0 = sin límite de ítems para este usuario; >0 = tope propio de ítems por requerimiento */
  maxItemsRequerimiento?: number | null;
  /** Alias legado para compatibilidad de lectura/escritura */
  maxSolicitudes?: number | null;
  maxRequerimientos?: number | null;
  maxMontoUsd?: number | null;
}

export interface ConfigLimitesCompras {
  activo: boolean;
  /** Máximo de productos/renglones (cosas) dentro de cada Solicitud (0 = sin límite / ∞; default 0 = sin límite o configurable). */
  maxItemsPorSolicitud: number;
  /** Máximo de productos/renglones (cosas) dentro de cada Requerimiento (0 = sin límite / ∞). */
  maxItemsPorRequerimiento: number;
  /** Monto máximo en USD ($) por Requerimiento al crearlo/guardarlo (0 = sin límite). */
  maxMontoUsdRequerimiento: number;
  /** Cantidad máxima de tarjetas visibles por defecto en las bandejas (0 = todas; default 50). */
  maxTarjetasVisibles: number;
  /** Si true, el límite de ítems también aplica a los usuarios con rol admin. Default false. */
  aplicarAAdmins: boolean;
  /** Excepciones opcionales para usuarios puntuales (userId -> ExcepcionLimiteUsuario). */
  excepcionesPorUsuario: Record<string, ExcepcionLimiteUsuario>;
  /** Campos informativos/legados conservados en 0 (nunca bloquean por cantidad de documentos). */
  maxSolicitudesPorUsuario: number;
  modoConteoSolicitudes: ModoConteoLimite;
  maxRequerimientosPorUsuario: number;
  modoConteoRequerimientos: ModoConteoLimite;
}

export const CONFIG_LIMITES_COMPRAS_DEFAULT: ConfigLimitesCompras = {
  activo: true,
  maxItemsPorSolicitud: 50,
  maxItemsPorRequerimiento: 50,
  maxMontoUsdRequerimiento: 0,
  maxTarjetasVisibles: 50,
  aplicarAAdmins: false,
  excepcionesPorUsuario: {},
  maxSolicitudesPorUsuario: 0,
  modoConteoSolicitudes: 'activos',
  maxRequerimientosPorUsuario: 0,
  modoConteoRequerimientos: 'activos',
};

export const OPCIONES_RAPIDAS_TOPE = [0, 1, 2, 3, 5, 10, 15, 20, 30, 50] as const;
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

function normalizarCampoExcepcionEntero(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  return normalizarTopeEntero(raw, 500);
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
    const maxItemsSol =
      v.maxItemsSolicitud !== undefined
        ? normalizarCampoExcepcionEntero(v.maxItemsSolicitud)
        : normalizarCampoExcepcionEntero(v.maxSolicitudes);
    const maxItemsReq =
      v.maxItemsRequerimiento !== undefined
        ? normalizarCampoExcepcionEntero(v.maxItemsRequerimiento)
        : normalizarCampoExcepcionEntero(v.maxRequerimientos);
    const maxMonto =
      v.maxMontoUsd === null || v.maxMontoUsd === undefined || v.maxMontoUsd === ''
        ? v.maxMontoUsdRequerimiento === null ||
          v.maxMontoUsdRequerimiento === undefined ||
          v.maxMontoUsdRequerimiento === ''
          ? null
          : normalizarTopeMontoUsd(v.maxMontoUsdRequerimiento)
        : normalizarTopeMontoUsd(v.maxMontoUsd);

    excepcionesPorUsuario[uid] = {
      userId: uid,
      userName: v.userName ? String(v.userName) : v.nombre ? String(v.nombre) : null,
      maxItemsSolicitud: maxItemsSol,
      maxItemsRequerimiento: maxItemsReq,
      maxSolicitudes: maxItemsSol,
      maxRequerimientos: maxItemsReq,
      maxMontoUsd: maxMonto,
    };
  }

  return {
    activo: raw.activo !== false,
    maxItemsPorSolicitud:
      raw.maxItemsPorSolicitud === undefined
        ? CONFIG_LIMITES_COMPRAS_DEFAULT.maxItemsPorSolicitud
        : normalizarTopeEntero(raw.maxItemsPorSolicitud, 500),
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
    maxSolicitudesPorUsuario: normalizarTopeEntero(raw.maxSolicitudesPorUsuario),
    modoConteoSolicitudes: normalizarModoConteo(raw.modoConteoSolicitudes),
    maxRequerimientosPorUsuario: normalizarTopeEntero(raw.maxRequerimientosPorUsuario),
    modoConteoRequerimientos: normalizarModoConteo(raw.modoConteoRequerimientos),
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
  maxItemsSolicitud: number;
  maxItemsRequerimiento: number;
  maxMontoUsdRequerimiento: number;
  maxTarjetasVisibles: number;
  /** Campos legados informativos */
  maxSolicitudes: number;
  modoConteoSolicitudes: ModoConteoLimite;
  maxRequerimientos: number;
  modoConteoRequerimientos: ModoConteoLimite;
}

/** Resuelve el límite de ítems efectivo para un usuario dado (aplicando excepción individual si existe). */
export function resolverLimitesParaUsuario(
  cfg: ConfigLimitesCompras,
  userId?: string | null,
  isAdmin?: boolean,
): LimitesEfectivosUsuario {
  const norm = normalizarConfigLimitesCompras(cfg);
  const exc = userId ? norm.excepcionesPorUsuario[userId] : undefined;
  const excItemsSol =
    exc?.maxItemsSolicitud !== undefined && exc?.maxItemsSolicitud !== null
      ? exc.maxItemsSolicitud
      : exc?.maxSolicitudes;
  const excItemsReq =
    exc?.maxItemsRequerimiento !== undefined && exc?.maxItemsRequerimiento !== null
      ? exc.maxItemsRequerimiento
      : exc?.maxRequerimientos;

  const tieneExcepcionPersonal = Boolean(
    exc &&
      ((excItemsSol !== null && excItemsSol !== undefined) ||
        (excItemsReq !== null && excItemsReq !== undefined) ||
        (exc.maxMontoUsd !== null && exc.maxMontoUsd !== undefined)),
  );
  const exentoPorRol = Boolean(isAdmin && !norm.aplicarAAdmins);

  const maxItemsSolicitud =
    excItemsSol !== null && excItemsSol !== undefined
      ? normalizarTopeEntero(excItemsSol, 500)
      : norm.maxItemsPorSolicitud;

  const maxItemsRequerimiento =
    excItemsReq !== null && excItemsReq !== undefined
      ? normalizarTopeEntero(excItemsReq, 500)
      : norm.maxItemsPorRequerimiento;

  return {
    activo: norm.activo,
    exentoPorRol,
    tieneExcepcionPersonal,
    maxItemsSolicitud,
    maxItemsRequerimiento,
    maxMontoUsdRequerimiento:
      exc && exc.maxMontoUsd !== null && exc.maxMontoUsd !== undefined
        ? normalizarTopeMontoUsd(exc.maxMontoUsd)
        : norm.maxMontoUsdRequerimiento,
    maxTarjetasVisibles: norm.maxTarjetasVisibles,
    maxSolicitudes: maxItemsSolicitud,
    modoConteoSolicitudes: norm.modoConteoSolicitudes,
    maxRequerimientos: maxItemsRequerimiento,
    modoConteoRequerimientos: norm.modoConteoRequerimientos,
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

/** Conteo informativo de solicitudes del usuario (no bloquea la creación de solicitudes). */
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

/** Conteo informativo de requerimientos del usuario (no bloquea la creación de requerimientos). */
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
  /** Cantidad de ítems actualmente en borrador (si se proporciona) */
  usados: number;
  /** Límite máximo de ítems por solicitud/requerimiento (0 = sin límite / ∞) */
  limite: number;
  disponibles: number;
  porcentaje: number;
  enTope: boolean;
  cercaDelTope: boolean;
  exentoPorRol: boolean;
  tieneExcepcionPersonal: boolean;
  /** Siempre true para abrir el formulario; el límite controla cuántos ítems caben dentro */
  permitidoCrear: boolean;
  maxItems: number;
  maxMontoUsd: number;
  etiquetaModo: string;
  resumenCorto: string;
  motivoBloqueo: string | null;
}

/**
 * Evalúa el límite de ítems por Solicitud para el usuario actual.
 * `itemsActualesCount` (opcional) permite reflejar cuántos ítems lleva en su lista actual.
 */
export function evaluarCupoSolicitudes(params: {
  reqs?: Partial<InventoryRequirement>[];
  cfg: ConfigLimitesCompras;
  userId?: string | null;
  isAdmin?: boolean;
  ahoraRef?: Date;
  itemsActualesCount?: number;
}): EstadoCupoOperativo {
  const eff = resolverLimitesParaUsuario(params.cfg, params.userId, params.isAdmin);
  const maxItems = eff.activo ? eff.maxItemsSolicitud : 0;
  const usados = Math.max(0, Math.floor(Number(params.itemsActualesCount ?? 0) || 0));
  const disponibles = maxItems > 0 ? Math.max(0, maxItems - usados) : Number.POSITIVE_INFINITY;
  const porcentaje = maxItems > 0 ? Math.min(100, Math.round((usados / maxItems) * 100)) : 0;
  const alcanzoTopeItems = eff.activo && maxItems > 0 && usados >= maxItems;
  const enTope = alcanzoTopeItems && !eff.exentoPorRol;
  const cercaDelTope = eff.activo && maxItems > 0 && !alcanzoTopeItems && usados / maxItems >= 0.8;

  const resumenCorto =
    maxItems > 0
      ? params.itemsActualesCount !== undefined
        ? `Ítems en esta solicitud: ${usados} de ${maxItems} máx. · Disponibles: ${disponibles}`
        : `Máximo permitido por solicitud: ${maxItems} ${maxItems === 1 ? 'ítem / producto' : 'ítems / productos'}`
      : params.itemsActualesCount !== undefined
      ? `Ítems en esta solicitud: ${usados} · Sin límite de ítems (∞)`
      : `Máximo por solicitud: Sin límite de ítems (∞)`;

  const motivoBloqueo = enTope
    ? `Alcanzaste el límite máximo de ${maxItems} ${maxItems === 1 ? 'ítem/producto' : 'ítems/productos'} dentro de una misma solicitud (${usados}/${maxItems}).`
    : null;

  return {
    tipo: 'solicitud',
    activo: eff.activo,
    modo: eff.modoConteoSolicitudes,
    usados,
    limite: maxItems,
    disponibles,
    porcentaje,
    enTope,
    cercaDelTope,
    exentoPorRol: eff.exentoPorRol,
    tieneExcepcionPersonal: eff.tieneExcepcionPersonal,
    permitidoCrear: true,
    maxItems,
    maxMontoUsd: 0,
    etiquetaModo: 'por solicitud',
    resumenCorto,
    motivoBloqueo,
  };
}

/**
 * Evalúa el límite de ítems por Requerimiento para el usuario actual.
 * `itemsActualesCount` (opcional) permite reflejar cuántos ítems lleva en el formulario actual.
 */
export function evaluarCupoRequerimientos(params: {
  reqs?: Partial<InventoryRequirement>[];
  cfg: ConfigLimitesCompras;
  userId?: string | null;
  isAdmin?: boolean;
  ahoraRef?: Date;
  itemsActualesCount?: number;
}): EstadoCupoOperativo {
  const eff = resolverLimitesParaUsuario(params.cfg, params.userId, params.isAdmin);
  const maxItems = eff.activo ? eff.maxItemsRequerimiento : 0;
  const usados = Math.max(0, Math.floor(Number(params.itemsActualesCount ?? 0) || 0));
  const disponibles = maxItems > 0 ? Math.max(0, maxItems - usados) : Number.POSITIVE_INFINITY;
  const porcentaje = maxItems > 0 ? Math.min(100, Math.round((usados / maxItems) * 100)) : 0;
  const alcanzoTopeItems = eff.activo && maxItems > 0 && usados >= maxItems;
  const enTope = alcanzoTopeItems && !eff.exentoPorRol;
  const cercaDelTope = eff.activo && maxItems > 0 && !alcanzoTopeItems && usados / maxItems >= 0.8;

  const resumenCorto =
    maxItems > 0
      ? params.itemsActualesCount !== undefined
        ? `Ítems en este requerimiento: ${usados} de ${maxItems} máx. · Disponibles: ${disponibles}`
        : `Máximo permitido por requerimiento: ${maxItems} ${maxItems === 1 ? 'ítem / producto' : 'ítems / productos'}`
      : params.itemsActualesCount !== undefined
      ? `Ítems en este requerimiento: ${usados} · Sin límite de ítems (∞)`
      : `Máximo por requerimiento: Sin límite de ítems (∞)`;

  const motivoBloqueo = enTope
    ? `Alcanzaste el límite máximo de ${maxItems} ${maxItems === 1 ? 'ítem/producto' : 'ítems/productos'} dentro de un mismo requerimiento (${usados}/${maxItems}).`
    : null;

  return {
    tipo: 'requerimiento',
    activo: eff.activo,
    modo: eff.modoConteoRequerimientos,
    usados,
    limite: maxItems,
    disponibles,
    porcentaje,
    enTope,
    cercaDelTope,
    exentoPorRol: eff.exentoPorRol,
    tieneExcepcionPersonal: eff.tieneExcepcionPersonal,
    permitidoCrear: true,
    maxItems,
    maxMontoUsd: eff.activo ? eff.maxMontoUsdRequerimiento : 0,
    etiquetaModo: 'por requerimiento',
    resumenCorto,
    motivoBloqueo,
  };
}

/**
 * Calcula el tope efectivo de ítems respetando Derechos Adquiridos ("Grandfathering"):
 * Si se está editando una solicitud o requerimiento que ya tenía `cantidadItemsOriginales`
 * mayor al límite actual, permite conservar o reducir esa cantidad sin bloquear el guardado.
 */
export function calcularTopeEfectivoItems(
  maxItemsConfigurado: number,
  esEdicion?: boolean,
  cantidadItemsOriginales?: number,
): number {
  const max = normalizarTopeEntero(maxItemsConfigurado, 500);
  if (max <= 0) return 0; // 0 = Sin límite (∞)
  if (esEdicion && (cantidadItemsOriginales ?? 0) > max) {
    return Math.floor(Number(cantidadItemsOriginales));
  }
  return max;
}

/**
 * Verifica si se puede agregar 1 ítem más en vivo dentro de un formulario
 * (carrito de Pedir Material, modal de Editar Solicitud o modal de Nuevo/Editar Requerimiento).
 */
export function verificarPuedeAgregarItem(params: {
  tipo: 'solicitud' | 'requerimiento';
  itemsActualesCount: number;
  esEdicion?: boolean;
  cantidadItemsOriginales?: number;
  esFusionDeStockExistente?: boolean;
  cfg: ConfigLimitesCompras;
  userId?: string | null;
  isAdmin?: boolean;
}): {
  ok: boolean;
  maxItems: number;
  topeEfectivo: number;
  disponibles: number;
  error?: string;
} {
  const cupo =
    params.tipo === 'solicitud'
      ? evaluarCupoSolicitudes({ ...params, itemsActualesCount: params.itemsActualesCount })
      : evaluarCupoRequerimientos({ ...params, itemsActualesCount: params.itemsActualesCount });

  if (!cupo.activo || cupo.exentoPorRol || cupo.maxItems <= 0) {
    return {
      ok: true,
      maxItems: cupo.maxItems,
      topeEfectivo: 0,
      disponibles: Number.POSITIVE_INFINITY,
    };
  }

  // Si en Pedir Material está sumando más cantidad a un ítem de stock que ya está en la lista,
  // no agrega un renglón nuevo: siempre se permite.
  if (params.esFusionDeStockExistente) {
    return {
      ok: true,
      maxItems: cupo.maxItems,
      topeEfectivo: cupo.maxItems,
      disponibles: Math.max(0, cupo.maxItems - params.itemsActualesCount),
    };
  }

  const topeEfectivo = calcularTopeEfectivoItems(
    cupo.maxItems,
    params.esEdicion,
    params.cantidadItemsOriginales,
  );

  if (topeEfectivo > 0 && params.itemsActualesCount >= topeEfectivo) {
    const docLabel = params.tipo === 'solicitud' ? 'solicitud' : 'requerimiento';
    return {
      ok: false,
      maxItems: cupo.maxItems,
      topeEfectivo,
      disponibles: 0,
      error: `Límite alcanzado: máximo ${cupo.maxItems} ${
        cupo.maxItems === 1 ? 'ítem/producto' : 'ítems/productos'
      } dentro de una misma ${docLabel} (llevas ${params.itemsActualesCount}). Quita un ítem, envía primero esta ${docLabel} o pide al administrador subir el máximo.`,
    };
  }

  return {
    ok: true,
    maxItems: cupo.maxItems,
    topeEfectivo,
    disponibles: Math.max(0, topeEfectivo - params.itemsActualesCount),
  };
}

/**
 * Valida antes de guardar una Solicitud o un Requerimiento.
 *
 * Reglas blindadas (Consenso de los 8 Agentes):
 * - NUNCA bloquea por cantidad de solicitudes o requerimientos creados por el usuario.
 * - Valida que la cantidad de cosas/ítems (`cantidadItems`) no supere el máximo configurado
 *   (`maxItemsPorSolicitud` / `maxItemsPorRequerimiento`).
 * - Si `esEdicion === true`, respeta `cantidadItemsOriginales` (Grandfathering): si el
 *   registro ya tenía 10 ítems y el límite bajó a 5, permite editar precios, proveedor o
 *   quitar renglones (`<= 10`), bloqueando únicamente si intenta subir a 11.
 */
export function validarOperacionConLimite(params: {
  tipo: 'solicitud' | 'requerimiento';
  esEdicion?: boolean;
  cantidadItems: number;
  cantidadItemsOriginales?: number;
  montoTotalUsd?: number;
  reqs?: Partial<InventoryRequirement>[];
  cfg: ConfigLimitesCompras;
  userId?: string | null;
  isAdmin?: boolean;
  ahoraRef?: Date;
}): { ok: boolean; error?: string; cupo: EstadoCupoOperativo } {
  const cupo =
    params.tipo === 'solicitud'
      ? evaluarCupoSolicitudes({ ...params, itemsActualesCount: params.cantidadItems })
      : evaluarCupoRequerimientos({ ...params, itemsActualesCount: params.cantidadItems });

  if (!cupo.activo || cupo.exentoPorRol) {
    return { ok: true, cupo };
  }

  // 1. Tope de productos / renglones (cosas) dentro de la solicitud o requerimiento
  const topeEfectivo = calcularTopeEfectivoItems(
    cupo.maxItems,
    params.esEdicion,
    params.cantidadItemsOriginales,
  );
  if (topeEfectivo > 0 && params.cantidadItems > topeEfectivo) {
    const docLabel = params.tipo === 'solicitud' ? 'solicitud' : 'requerimiento';
    return {
      ok: false,
      error: `El límite máximo es de ${cupo.maxItems} productos/renglones por ${docLabel} (intentas guardar ${params.cantidadItems}). Reduce los renglones o pide al administrador subir el máximo.`,
      cupo,
    };
  }

  // 2. Tope opcional de monto en USD (para requerimientos cuando maxMontoUsd > 0)
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
 * búsqueda, empresa, estado, prioridad y fecha.
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
