// 📦 Lógica de Flujo de Estatus y Asignación de Proveedores para Requerimientos de Compra
// Implementa:
// 1) Asignación individual de proveedores por renglón (compras consolidadas multi-proveedor).
// 2) Flujo dinámico de estados:
//    - "esperando proveedor" si falta proveedor en la orden/ítems.
//    - "esperando pago" si ya tiene cotización y proveedor para montos <= $1,000 USD.
//    - "esperando aprobación del gerente general" si supera los $1,000 USD (filtro de seguridad).
import type { InventoryRequirement, RequirementLine, Supplier } from '../types/database.ts';
import { extraerReciboPago } from './requerimientoExpediente';
import { extraerAprobacionCxp } from './cuentasPago';

export const LIMITE_MONTO_GERENTE_GENERAL_USD = 1000;

export interface ReglaAprobacionMonto {
  montoLimiteUSD: number;
  exigirEnTodos?: boolean; // true = todos los requerimientos deben ser aprobados primero por el usuario designado
  empresaId: string | null; // null = Todas las empresas
  empresaNombre?: string | null;
  aprobadoresIds: string[]; // Lista de IDs de usuarios autorizados (profiles.id)
  aprobadoresNombres: string[]; // Lista de nombres de personas/cargos autorizados
  activo?: boolean;
}

export const REGLA_APROBACION_DEFAULT: ReglaAprobacionMonto = {
  montoLimiteUSD: 0,
  exigirEnTodos: true,
  empresaId: null,
  empresaNombre: 'Todas las empresas',
  aprobadoresIds: [],
  aprobadoresNombres: ['Gerente General'],
  activo: true,
};

const STORAGE_KEY_REGLA_APROBACION = 'compras_regla_aprobacion_monto_v1';

let memoriaReglaAprobacion: ReglaAprobacionMonto = { ...REGLA_APROBACION_DEFAULT };

function normClean(s?: string | null): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Verifica de forma estricta si el usuario conectado es Anthony Mansilla o Angelica Solis.
 * Solo ellos dos pueden ver y abrir la configuración de quién aprueba los requerimientos.
 */
export function esUsuarioAutorizadoConfigAprobacion(params: {
  fullName?: string | null;
  username?: string | null;
  cedula?: string | null;
  email?: string | null;
}): boolean {
  const fn = normClean(params.fullName);
  const un = normClean(params.username);
  const ci = normClean(params.cedula).replace(/\D/g, '');
  const em = normClean(params.email);

  const esAnthony =
    (fn.includes('anthony') && fn.includes('mansilla')) ||
    un === 'sistemas2' ||
    (un.includes('anthony') && un.includes('mansilla')) ||
    (em.includes('anthony') && em.includes('mansilla')) ||
    em.startsWith('sistemas2@');

  const esAngelica =
    (fn.includes('angelica') && fn.includes('solis')) ||
    un === '27514385' ||
    ci === '27514385' ||
    (un.includes('angelica') && un.includes('solis')) ||
    (em.includes('angelica') && em.includes('solis')) ||
    em.startsWith('27514385@');

  return esAnthony || esAngelica;
}

/**
 * Identifica explícitamente al aprobador designado Jesús Lozada (lozcheli15 · C.I. 18162307).
 */
export function esUsuarioJesusLozada(params: {
  fullName?: string | null;
  username?: string | null;
  cedula?: string | null;
  email?: string | null;
}): boolean {
  const fn = normClean(params.fullName);
  const un = normClean(params.username);
  const ci = normClean(params.cedula).replace(/\D/g, '');
  const em = normClean(params.email);

  return (
    un === 'lozcheli15' ||
    ci === '18162307' ||
    un === '18162307' ||
    (fn.includes('jesus') && fn.includes('lozada')) ||
    em.startsWith('lozcheli15@') ||
    em.startsWith('18162307@')
  );
}

/**
 * Evalúa si el usuario actual está designado para aprobar requerimientos según la configuración activa.
 */
export function puedeUsuarioAprobarRequerimiento(params: {
  userId?: string | null;
  fullName?: string | null;
  username?: string | null;
  cedula?: string | null;
  email?: string | null;
  role?: string | null;
  appRoleName?: string | null;
  config?: ReglaAprobacionMonto | null;
}): boolean {
  const cfg = params.config || obtenerConfigAprobacionMonto();
  if (cfg.activo === false) {
    return params.role === 'admin' || esUsuarioJesusLozada(params);
  }

  // Jesús Lozada (lozcheli15 · C.I. 18162307) siempre está autorizado para aprobar y modificar en Por Pagar
  if (esUsuarioJesusLozada(params)) {
    return true;
  }

  const uid = String(params.userId ?? '').trim();
  const fn = normClean(params.fullName);
  const ar = normClean(params.appRoleName);
  const ids = Array.isArray(cfg.aprobadoresIds) ? cfg.aprobadoresIds.filter(Boolean) : [];
  const nombres = Array.isArray(cfg.aprobadoresNombres)
    ? cfg.aprobadoresNombres.map((n) => normClean(n)).filter(Boolean)
    : [];

  // 1. Si hay usuarios específicos seleccionados por ID, validar contra esa lista (o coincidencia exacta de nombre)
  if (ids.length > 0) {
    if (uid && ids.includes(uid)) return true;
    if (fn && nombres.some((nom) => nom === fn || (nom.length > 4 && fn.includes(nom)))) return true;
    return false;
  }

  // 2. Si solo hay nombres o cargos configurados (ej. "Gerente General" o el nombre de una persona)
  if (nombres.length > 0) {
    const matchNombre = Boolean(
      fn &&
        nombres.some(
          (nom) =>
            nom === fn ||
            (nom.length >= 4 && !nom.includes('geren') && (fn.includes(nom) || nom.includes(fn)))
        )
    );
    if (matchNombre) return true;

    const matchCargo = Boolean(
      ar &&
        nombres.some(
          (nom) =>
            nom === ar ||
            (nom.includes('gerente') && ar.includes('gerente')) ||
            (nom.includes('gerencia') && ar.includes('geren'))
        )
    );
    if (matchCargo) return true;

    // Si solo dice el genérico "Gerente General" / "Gerencia General" sin un nombre de persona específico,
    // cualquier usuario con rol admin o rol Gerente General puede aprobar hasta que se designe un usuario puntual.
    const soloGenericoGerente = nombres.every(
      (nom) => nom === 'gerente general' || nom === 'gerencia general' || nom === 'gerente'
    );
    if (soloGenericoGerente) {
      return params.role === 'admin' || ar.includes('gerente');
    }

    return false;
  }

  return params.role === 'admin';
}

export const ID_SIN_EMPRESA_REQ = '__sin_empresa__';

export interface EmpresaFiltroItem {
  id: string;
  name: string;
  count: number;
}

/**
 * Resuelve la empresa asociada a una Solicitud o Requerimiento (company_id o empresa_pagadora_id).
 */
export function resolverEmpresaRequerimiento(
  r: Partial<InventoryRequirement>,
  companies: Array<{ id: string; name: string }> = []
): { id: string; name: string } {
  if (r.company_id) {
    const found = companies.find((c) => c.id === r.company_id);
    if (found) return { id: found.id, name: found.name };
    return { id: r.company_id, name: 'Empresa asignada' };
  }
  if (r.empresa_pagadora_id) {
    const found = companies.find((c) => c.id === r.empresa_pagadora_id);
    if (found) return { id: found.id, name: found.name };
    if (r.empresa_pagadora_nombre) {
      return { id: r.empresa_pagadora_id, name: r.empresa_pagadora_nombre };
    }
  }
  if (r.empresa_pagadora_nombre && r.empresa_pagadora_nombre.trim()) {
    const clean = normClean(r.empresa_pagadora_nombre);
    const byName = companies.find((c) => normClean(c.name) === clean);
    if (byName) return { id: byName.id, name: byName.name };
    return { id: `nombre:${clean}`, name: r.empresa_pagadora_nombre.trim() };
  }
  return { id: ID_SIN_EMPRESA_REQ, name: 'Sin empresa' };
}

/**
 * Verifica si una Solicitud o Requerimiento pasa el filtro multi-empresa.
 * Si el conjunto está vacío, pasan todas.
 */
export function pasaFiltroEmpresasReq(
  r: Partial<InventoryRequirement>,
  empresaSel: Set<string> | string[],
  companies: Array<{ id: string; name: string }> = []
): boolean {
  if (!empresaSel) return true;
  const set = Array.isArray(empresaSel) ? new Set(empresaSel) : empresaSel;
  if (set.size === 0) return true;
  const info = resolverEmpresaRequerimiento(r, companies);
  if (set.has(info.id)) return true;
  if (r.company_id && set.has(r.company_id)) return true;
  if (r.empresa_pagadora_id && set.has(r.empresa_pagadora_id)) return true;
  return false;
}

/**
 * Calcula la lista de empresas con sus conteos para el filtro multi-empresa en Solicitudes y Requerimientos.
 */
export function calcularConteoEmpresasReq(
  reqs: Array<Partial<InventoryRequirement>>,
  companies: Array<{ id: string; name: string }> = []
): EmpresaFiltroItem[] {
  const map = new Map<string, EmpresaFiltroItem>();
  (companies || []).forEach((c) => {
    if (c && c.id && c.name) {
      map.set(c.id, { id: c.id, name: c.name, count: 0 });
    }
  });

  (reqs || []).forEach((r) => {
    const info = resolverEmpresaRequerimiento(r, companies);
    const prev = map.get(info.id) || { id: info.id, name: info.name, count: 0 };
    prev.count += 1;
    map.set(info.id, prev);
  });

  return Array.from(map.values())
    .filter((item) => item.id !== ID_SIN_EMPRESA_REQ || item.count > 0)
    .sort((a, b) => {
      if (a.id === ID_SIN_EMPRESA_REQ) return 1;
      if (b.id === ID_SIN_EMPRESA_REQ) return -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'es');
    });
}

export function obtenerConfigAprobacionMonto(): ReglaAprobacionMonto {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEY_REGLA_APROBACION);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.montoLimiteUSD === 'number' && parsed.montoLimiteUSD >= 0) {
          memoriaReglaAprobacion = {
            ...REGLA_APROBACION_DEFAULT,
            ...parsed,
            exigirEnTodos:
              typeof parsed.exigirEnTodos === 'boolean'
                ? parsed.exigirEnTodos
                : parsed.montoLimiteUSD === 0,
          };
          return memoriaReglaAprobacion;
        }
      }
    }
  } catch (e) {
    // Silencioso, usa memoria
  }
  return memoriaReglaAprobacion;
}

export function guardarConfigAprobacionMonto(regla: ReglaAprobacionMonto): void {
  memoriaReglaAprobacion = { ...regla };
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY_REGLA_APROBACION, JSON.stringify(regla));
    }
  } catch (e) {
    // Silencioso
  }
}

// ── Separación estricta de Fases: 📥 Solicitud → 📝 Requerimiento → 💸 Por Pagar ──
export const MARCADOR_ORIGEN_SOLICITUD = '[ORIGEN:SOLICITUD]';
export const MARCADOR_CONVERTIDO_EN_REQ = '[CONVERTIDO_EN_REQ]';

/**
 * Identifica si un registro de `inventory_requirements` nació como una Solicitud
 * (creada desde "Pedir Material / Repuesto" en campo/taller) y pertenece a la bandeja `📥 Solicitudes`.
 * Los requerimientos creados directamente en `📝 Requerimiento` (botón ➕ Nuevo) devuelven `false`.
 */
export function esSolicitudDeCompra(r: Partial<InventoryRequirement>): boolean {
  if (!r) return false;
  const title = normClean(r.title);
  const obs = normClean(r.observaciones);
  const note = normClean(r.note);
  const decNote = normClean(r.decision_note);
  const rawObs = String(r.observaciones ?? '');
  const rawNote = String(r.note ?? '');
  const rawDec = String(r.decision_note ?? '');

  if (
    rawObs.includes(MARCADOR_ORIGEN_SOLICITUD) ||
    rawObs.includes(MARCADOR_CONVERTIDO_EN_REQ) ||
    rawNote.includes(MARCADOR_ORIGEN_SOLICITUD) ||
    rawDec.includes(MARCADOR_CONVERTIDO_EN_REQ)
  ) {
    return true;
  }

  if (
    title.includes('pedido tecnico') ||
    obs.includes('portal tecnico') ||
    note.includes('solicitud tecnica con') ||
    decNote.includes('solicitud convertida') ||
    decNote.includes('cotizacion cargada en solicitudes')
  ) {
    return true;
  }

  if (normClean(r.area) === 'taller / mantenimiento' && Boolean(r.solicitante_nombre)) {
    return true;
  }

  return false;
}

/**
 * Determina si una Solicitud ya fue CONVERTIDA explícitamente en un Requerimiento
 * mediante el botón "🔄 Convertir a Requerimiento" en la pestaña `📥 Solicitudes`.
 * Mientras devuelva `false`, es únicamente una Solicitud y NO debe aparecer en `📝 Requerimiento`.
 */
export function estaSolicitudConvertidaEnRequerimiento(r: Partial<InventoryRequirement>): boolean {
  if (!r) return false;
  const rawObs = String(r.observaciones ?? '');
  const rawNote = String(r.note ?? '');
  const rawDec = String(r.decision_note ?? '');
  const decClean = normClean(r.decision_note);

  // 1. Marcador explícito de conversión a Requerimiento
  if (
    rawObs.includes(MARCADOR_CONVERTIDO_EN_REQ) ||
    rawNote.includes(MARCADOR_CONVERTIDO_EN_REQ) ||
    rawDec.includes(MARCADOR_CONVERTIDO_EN_REQ) ||
    decClean.includes('solicitud convertida') ||
    decClean.includes('cotizacion cargada en solicitudes')
  ) {
    return true;
  }

  // 2. Registros históricos que ya avanzaron a fases posteriores del requerimiento
  const st = String(r.status ?? '');
  if (st === 'aprobado' || st === 'esperando_recepcion' || st === 'recibido' || st === 'pagado') {
    return true;
  }

  // 3. Solicitudes históricas a las que ya se les asignó proveedor y precio en Compras
  const items = Array.isArray(r.items) ? r.items : [];
  const tieneProveedor = Boolean(r.supplier_id) || items.some((it) => Boolean(it?.supplier_id));
  const tienePrecio = items.some((it) => Number(it?.est_price) > 0);
  if (tieneProveedor && tienePrecio) {
    return true;
  }

  return false;
}

/**
 * Define qué registros pueden aparecer en la pestaña `📝 Requerimiento`:
 * - Requerimientos creados directamente en `📝 Requerimiento` (`!esSolicitudDeCompra(r)`): SIEMPRE visibles.
 * - Solicitudes de compra (`esSolicitudDeCompra(r)`): SOLO visibles cuando ya fueron convertidas en Requerimiento (`estaSolicitudConvertidaEnRequerimiento(r)`).
 */
export function esRequerimientoVisibleEnBandejaRequerimientos(r: Partial<InventoryRequirement>): boolean {
  if (!r) return false;
  if (!esSolicitudDeCompra(r)) return true;
  return estaSolicitudConvertidaEnRequerimiento(r);
}

/**
 * Asegura que las observaciones lleven el marcador de origen de Solicitud.
 */
export function marcarObservacionesComoSolicitud(observaciones?: string | null): string {
  const base = String(observaciones ?? '').trim();
  if (base.includes(MARCADOR_ORIGEN_SOLICITUD)) return base;
  return base ? `${MARCADOR_ORIGEN_SOLICITUD} ${base}` : MARCADOR_ORIGEN_SOLICITUD;
}

/**
 * Marca las observaciones de una Solicitud como convertida en Requerimiento oficial.
 */
export function marcarObservacionesComoConvertidaEnReq(observaciones?: string | null): string {
  let base = marcarObservacionesComoSolicitud(observaciones);
  if (!base.includes(MARCADOR_CONVERTIDO_EN_REQ)) {
    base = `${MARCADOR_CONVERTIDO_EN_REQ} ${base}`.trim();
  }
  return base;
}

/**
 * Al editar una Solicitud o un Requerimiento proveniente de Solicitud, preserva
 * los marcadores internos (`[ORIGEN:SOLICITUD]`, `[CONVERTIDO_EN_REQ]`) aunque el usuario edite el texto.
 */
export function preservarMarcadoresSolicitudEnObservaciones(
  observacionesOriginal?: string | null,
  nuevasObservaciones?: string | null
): string | null {
  const orig = String(observacionesOriginal ?? '');
  let res = String(nuevasObservaciones ?? '').trim();
  const teniaConvertido = orig.includes(MARCADOR_CONVERTIDO_EN_REQ);
  const teniaOrigen = orig.includes(MARCADOR_ORIGEN_SOLICITUD) || teniaConvertido;

  if (teniaOrigen && !res.includes(MARCADOR_ORIGEN_SOLICITUD)) {
    res = res ? `${MARCADOR_ORIGEN_SOLICITUD} ${res}` : MARCADOR_ORIGEN_SOLICITUD;
  }
  if (teniaConvertido && !res.includes(MARCADOR_CONVERTIDO_EN_REQ)) {
    res = res ? `${MARCADOR_CONVERTIDO_EN_REQ} ${res}` : MARCADOR_CONVERTIDO_EN_REQ;
  }
  const mEnv = orig.match(/\[ENVIADO_CXP:[^\]]*\]/i);
  if (mEnv && !/\[ENVIADO_CXP:[^\]]*\]/i.test(res)) {
    res = res ? `${res}\n${mEnv[0]}` : mEnv[0];
  }
  const mHist = orig.match(/\[\[HISTORIAL_COMPRA:[\s\S]*?:FIN_HISTORIAL\]\]/i);
  if (mHist && !/\[\[HISTORIAL_COMPRA:[\s\S]*?:FIN_HISTORIAL\]\]/i.test(res)) {
    res = res ? `${res}\n${mHist[0]}` : mHist[0];
  }
  return res || null;
}

/**
 * Limpia los marcadores internos de Solicitud para mostrar texto limpio en pantalla o PDF.
 */
export function limpiarMarcadoresSolicitudDeTexto(texto?: string | null): string {
  return String(texto ?? '')
    .replace(/\[ORIGEN:SOLICITUD\]/g, '')
    .replace(/\[CONVERTIDO_EN_REQ\]/g, '')
    .replace(/\[ENVIADO_CXP:[^\]]*\]/gi, '')
    .replace(/\[\[HISTORIAL_COMPRA:[\s\S]*?:FIN_HISTORIAL\]\]/gi, '')
    .trim();
}

export type CodigoEstadoDinamico =
  | 'esperando_proveedor'
  | 'esperando_cotizacion'
  | 'esperando_aprobacion_gg'
  | 'esperando_pago'
  | 'aprobado'
  | 'esperando_recepcion'
  | 'recibido'
  | 'rechazado'
  | 'aclaratoria_solicitada';

export interface InfoEstadoRequerimiento {
  codigo: CodigoEstadoDinamico;
  label: string;
  short: string;
  color: string;
  bg: string;
  icon: string;
  requiereAprobacionGG: boolean;
  totalUSD: number;
  tieneProveedorCompleto: boolean;
  tieneCotizacionCompleta: boolean;
  proveedoresNombres: string[];
  esMultiProveedor: boolean;
  montoLimiteAplicado?: number;
  empresaReglaAplicada?: string | null;
  aprobadoresNombres?: string[];
  aprobadoresIds?: string[];
}

/**
 * Calcula el monto total en USD de una lista de renglones de requerimiento,
 * considerando ítems exentos y alícuota de IVA si aplica.
 */
export function calcularTotalReqUsd(
  items: RequirementLine[],
  rateBcv?: number | null,
  alicuotaIva?: number | null
): number {
  if (!items || items.length === 0) return 0;
  const rate = Number(rateBcv) || 1;
  const lineTotalUsd = (it: RequirementLine) => {
    if (it.modo_precio === 'total' && it.total_usd != null && Number(it.total_usd) > 0) {
      return Number(it.total_usd);
    }
    const qty = Number(it.qty) || 0;
    const estPrice = Number(it.est_price) || 0;
    const priceUsd = it.currency === 'USD' ? estPrice : estPrice / rate;
    return priceUsd * qty;
  };
  const subtotal = items.reduce((sum, it) => sum + lineTotalUsd(it), 0);

  if (alicuotaIva === undefined || alicuotaIva === null) {
    return Math.round(subtotal * 100) / 100;
  }

  const baseImponible = items.reduce((sum, it) => {
    if (it.exento) return sum;
    return sum + lineTotalUsd(it);
  }, 0);

  const alic = Math.min(100, Math.max(0, Number(alicuotaIva) || 0));
  const iva = Math.round(baseImponible * (alic / 100) * 100) / 100;
  return Math.round((subtotal + iva) * 100) / 100;
}

/**
 * Evalúa si un renglón tiene proveedor asignado (directamente o heredado de la cabecera)
 */
export function obtenerProveedorDeLinea(
  line: RequirementLine,
  supplierIdGeneral?: string | null,
  supplierNameGeneral?: string | null
): { supplier_id: string | null; supplier_name: string | null } {
  if (line.supplier_id || (line.supplier_name && line.supplier_name.trim())) {
    return {
      supplier_id: line.supplier_id || line.supplier_name!.trim(),
      supplier_name: line.supplier_name || 'Proveedor asignado',
    };
  }
  if (supplierIdGeneral || (supplierNameGeneral && supplierNameGeneral.trim())) {
    return {
      supplier_id: supplierIdGeneral || supplierNameGeneral!.trim(),
      supplier_name: supplierNameGeneral || 'Proveedor principal',
    };
  }
  return { supplier_id: null, supplier_name: null };
}

/**
 * Calcula de manera reactiva e infalible el estatus del requerimiento de compra
 */
export function calcularEstadoRequerimiento(
  r: InventoryRequirement,
  rateBcv?: number | null,
  proveedorGeneral?: Supplier | null,
  configOverride?: ReglaAprobacionMonto | null,
  estaPagadoOverride?: boolean | null
): InfoEstadoRequerimiento {
  const totalUSD = calcularTotalReqUsd(r.items || [], rateBcv, r.iva_alicuota);

  // 1. Estados finales o de ciclo técnico que prevalecen
  if (r.status === 'recibido') {
    return {
      codigo: 'recibido',
      label: '📦 Recibido en Almacén',
      short: 'Recibido',
      color: '#16A34A',
      bg: '#DCFCE7',
      icon: '📦',
      requiereAprobacionGG: false,
      totalUSD,
      tieneProveedorCompleto: true,
      tieneCotizacionCompleta: true,
      proveedoresNombres: [],
      esMultiProveedor: false,
    };
  }

  if (r.status === 'rechazado' || (r.status as string) === 'cancelado') {
    const rawNota = String(r.decision_note || r.observaciones || '').trim();
    const esCanceladaPorSolicitante =
      (r.status as string) === 'cancelado' ||
      /^\[Cancelad[oa](?:\s+por(?:\s+(?:el\s+)?solicitante)?)?:/i.test(rawNota);

    return {
      codigo: 'rechazado',
      label: esCanceladaPorSolicitante ? '🚫 Cancelada por Solicitante' : '❌ Rechazado',
      short: esCanceladaPorSolicitante ? 'Cancelada' : 'Rechazado',
      color: esCanceladaPorSolicitante ? '#475569' : '#DC2626',
      bg: esCanceladaPorSolicitante ? '#F1F5F9' : '#FEE2E2',
      icon: esCanceladaPorSolicitante ? '🚫' : '❌',
      requiereAprobacionGG: false,
      totalUSD,
      tieneProveedorCompleto: true,
      tieneCotizacionCompleta: true,
      proveedoresNombres: [],
      esMultiProveedor: false,
    };
  }

  if (r.status === 'aclaratoria_solicitada') {
    return {
      codigo: 'aclaratoria_solicitada',
      label: '⚠️ Aclaratoria Técnica Solicitada',
      short: 'En Aclaratoria',
      color: '#EA580C',
      bg: '#FFF7ED',
      icon: '⚠️',
      requiereAprobacionGG: false,
      totalUSD,
      tieneProveedorCompleto: false,
      tieneCotizacionCompleta: false,
      proveedoresNombres: [],
      esMultiProveedor: false,
    };
  }

  // 2. Analizar si ya cuenta con recibo / comprobante de pago bancario o fue marcado como pagado en Cuentas por Pagar
  const reciboPago = extraerReciboPago(r);
  const tienePagoRegistrado =
    Boolean(reciboPago && (reciboPago.url || reciboPago.referencia)) ||
    estaPagadoOverride === true ||
    (r as any).pagado === true ||
    (r.status as string) === 'pagado' ||
    (r.status as string) === 'esperando_recepcion';

  // 3. Analizar proveedores y cotizaciones de los renglones
  const provNombresSet = new Set<string>();
  let faltanProveedores = false;
  let faltanPrecios = false;

  (r.items || []).forEach((it) => {
    const prov = obtenerProveedorDeLinea(it, r.supplier_id, proveedorGeneral?.name);
    if (!prov.supplier_id) {
      faltanProveedores = true;
    } else if (prov.supplier_name) {
      provNombresSet.add(prov.supplier_name);
    }
    if (!(Number(it.est_price) > 0)) {
      faltanPrecios = true;
    }
  });

  const proveedoresNombres = Array.from(provNombresSet);
  const esMultiProveedor = proveedoresNombres.length > 1;
  const tieneProveedorCompleto = !faltanProveedores && (Boolean(r.supplier_id) || proveedoresNombres.length > 0);
  const tieneCotizacionCompleta = !faltanPrecios && (r.items || []).length > 0;

  // 4. Si ya fue pagado (en Cuentas por Pagar o con comprobante bancario adjunto) pero no ha sido recibido físicamente
  const cfg = configOverride || obtenerConfigAprobacionMonto();
  const exigirTodos = cfg?.exigirEnTodos === true || Number(cfg?.montoLimiteUSD) === 0;
  const limiteUSD = exigirTodos
    ? 0
    : Number(cfg?.montoLimiteUSD) > 0
      ? Number(cfg!.montoLimiteUSD)
      : LIMITE_MONTO_GERENTE_GENERAL_USD;

  if (tienePagoRegistrado) {
    return {
      codigo: 'esperando_recepcion',
      label: '💳 Pagado · 📦 Esperando Recepción en Almacén',
      short: '💳 Pagado · Esperando Recepción',
      color: '#0D9488',
      bg: '#F0FDFA',
      icon: '💳',
      requiereAprobacionGG: false,
      totalUSD,
      tieneProveedorCompleto: true,
      tieneCotizacionCompleta: true,
      proveedoresNombres,
      esMultiProveedor,
      montoLimiteAplicado: limiteUSD,
      empresaReglaAplicada: cfg?.empresaNombre || null,
      aprobadoresNombres: cfg?.aprobadoresNombres || [],
      aprobadoresIds: cfg?.aprobadoresIds || [],
    };
  }

  // Evaluar Regla de Negocio Dinámica de Aprobación por Usuario Designado, Monto y Empresa
  // Nota: Cuando Compras pasa un requerimiento a 💸 Por Pagar (`status === 'aprobado'`),
  // entra en Por Pagar con estado 👔 Esperando Aprobación del Gerente General / Usuario Designado
  // hasta que él lo autorice en Por Pagar (`[APROBADO_CXP: Estado: aprobado ...]`).
  const aplicaEmpresa = !cfg?.empresaId || r.company_id === cfg.empresaId || r.empresa_pagadora_id === cfg.empresaId;
  const reglaActiva = cfg?.activo !== false;
  const superaLimiteGG = aplicaEmpresa && reglaActiva && (exigirTodos ? totalUSD >= 0 : totalUSD > limiteUSD);
  const apCxp = extraerAprobacionCxp(r.observaciones);
  const yaAprobadoGG = Boolean(
    apCxp?.estado === 'aprobado' ||
    (r.gerente_aprobado && apCxp?.estado !== 'pendiente') ||
    (r.status === 'aprobado' && r.decided_by && apCxp?.estado !== 'pendiente' && !reglaActiva)
  );

  const textoMonto = limiteUSD.toLocaleString('en-US');
  const sufijoEmpresa = cfg?.empresaId && cfg?.empresaNombre ? ` [${cfg.empresaNombre}]` : '';
  const aprobadoresTxt = (cfg?.aprobadoresNombres && cfg.aprobadoresNombres.length > 0)
    ? cfg.aprobadoresNombres.join(', ')
    : 'Gerente General';
  const sufijoCondicion = exigirTodos ? '' : ` (> $${textoMonto} USD)`;

  // 5. Si ya fue enviado a 💸 Por Pagar (`r.status === 'aprobado'`)
  if (r.status === 'aprobado') {
    if (superaLimiteGG && !yaAprobadoGG) {
      return {
        codigo: 'esperando_aprobacion_gg',
        label: `💸 En Por Pagar · 👔 Esperando Aprobación de ${aprobadoresTxt}${sufijoCondicion}${sufijoEmpresa}`,
        short: `En Por Pagar · 👔 ${aprobadoresTxt}`,
        color: '#7C3AED',
        bg: '#F5F3FF',
        icon: '👔',
        requiereAprobacionGG: true,
        totalUSD,
        tieneProveedorCompleto,
        tieneCotizacionCompleta,
        proveedoresNombres,
        esMultiProveedor,
        montoLimiteAplicado: limiteUSD,
        empresaReglaAplicada: cfg?.empresaNombre || null,
        aprobadoresNombres: cfg?.aprobadoresNombres || [],
        aprobadoresIds: cfg?.aprobadoresIds || [],
      };
    }

    return {
      codigo: 'aprobado',
      label: apCxp?.aprobadoPor
        ? `💸 En Por Pagar · ⏳ Esperando Pago (Autorizado por ${apCxp.aprobadoPor})`
        : superaLimiteGG && !exigirTodos
          ? `💸 En Por Pagar · ⏳ Esperando Pago (> $${textoMonto})`
          : '💸 En Por Pagar · ⏳ Esperando Pago',
      short: 'En Por Pagar · Esperando Pago',
      color: '#059669',
      bg: '#ECFDF5',
      icon: '⏳',
      requiereAprobacionGG: false,
      totalUSD,
      tieneProveedorCompleto,
      tieneCotizacionCompleta,
      proveedoresNombres,
      esMultiProveedor,
      montoLimiteAplicado: limiteUSD,
      empresaReglaAplicada: cfg?.empresaNombre || null,
      aprobadoresNombres: cfg?.aprobadoresNombres || [],
      aprobadoresIds: cfg?.aprobadoresIds || [],
    };
  }

  // 6. Si todavía está en 📝 Requerimiento (`status === 'pendiente'`): Compras está completando información
  if (!tieneProveedorCompleto) {
    return {
      codigo: 'esperando_proveedor',
      label: '🏢 Falta Proveedor',
      short: 'Falta Proveedor',
      color: '#4B5563',
      bg: '#F3F4F6',
      icon: '🏢',
      requiereAprobacionGG: false,
      totalUSD,
      tieneProveedorCompleto: false,
      tieneCotizacionCompleta,
      proveedoresNombres,
      esMultiProveedor,
      montoLimiteAplicado: limiteUSD,
      empresaReglaAplicada: cfg?.empresaNombre || null,
      aprobadoresNombres: cfg?.aprobadoresNombres || [],
      aprobadoresIds: cfg?.aprobadoresIds || [],
    };
  }

  if (!tieneCotizacionCompleta) {
    return {
      codigo: 'esperando_cotizacion',
      label: '💲 Falta Precio / Cotización',
      short: 'Falta Precio',
      color: '#D97706',
      bg: '#FEF3C7',
      icon: '💲',
      requiereAprobacionGG: false,
      totalUSD,
      tieneProveedorCompleto: true,
      tieneCotizacionCompleta: false,
      proveedoresNombres,
      esMultiProveedor,
      montoLimiteAplicado: limiteUSD,
      empresaReglaAplicada: cfg?.empresaNombre || null,
      aprobadoresNombres: cfg?.aprobadoresNombres || [],
      aprobadoresIds: cfg?.aprobadoresIds || [],
    };
  }

  // 7. Ya tiene proveedor y precios en 📝 Requerimiento, listo para que la analista de Compras lo envíe a 💸 Por Pagar
  return {
    codigo: 'esperando_pago',
    label: '✅ Listo para Enviar a Por Pagar',
    short: 'Listo para Por Pagar',
    color: '#2563EB',
    bg: '#EFF6FF',
    icon: '💸',
    requiereAprobacionGG: false,
    totalUSD,
    tieneProveedorCompleto: true,
    tieneCotizacionCompleta: true,
    proveedoresNombres,
    esMultiProveedor,
    montoLimiteAplicado: limiteUSD,
    empresaReglaAplicada: cfg?.empresaNombre || null,
    aprobadoresNombres: cfg?.aprobadoresNombres || [],
    aprobadoresIds: cfg?.aprobadoresIds || [],
  };
}
