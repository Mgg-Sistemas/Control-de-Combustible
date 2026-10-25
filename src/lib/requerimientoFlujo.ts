// 📦 Lógica de Flujo de Estatus y Asignación de Proveedores para Requerimientos de Compra
// Implementa:
// 1) Asignación individual de proveedores por renglón (compras consolidadas multi-proveedor).
// 2) Flujo dinámico de estados:
//    - "esperando proveedor" si falta proveedor en la orden/ítems.
//    - "esperando pago" si ya tiene cotización y proveedor para montos <= $1,000 USD.
//    - "esperando aprobación del gerente general" si supera los $1,000 USD (filtro de seguridad).
import type { InventoryRequirement, RequirementLine, Supplier } from '../types/database.ts';

export const LIMITE_MONTO_GERENTE_GENERAL_USD = 1000;

export type CodigoEstadoDinamico =
  | 'esperando_proveedor'
  | 'esperando_cotizacion'
  | 'esperando_aprobacion_gg'
  | 'esperando_pago'
  | 'aprobado'
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
}

/**
 * Calcula el monto total en USD de una lista de renglones de requerimiento
 */
export function calcularTotalReqUsd(items: RequirementLine[], rateBcv?: number | null): number {
  if (!items || items.length === 0) return 0;
  const rate = Number(rateBcv) || 1;
  return items.reduce((sum, it) => {
    const qty = Number(it.qty) || 0;
    const estPrice = Number(it.est_price) || 0;
    const priceUsd = it.currency === 'USD' ? estPrice : estPrice / rate;
    return sum + priceUsd * qty;
  }, 0);
}

/**
 * Evalúa si un renglón tiene proveedor asignado (directamente o heredado de la cabecera)
 */
export function obtenerProveedorDeLinea(
  line: RequirementLine,
  supplierIdGeneral?: string | null,
  supplierNameGeneral?: string | null
): { supplier_id: string | null; supplier_name: string | null } {
  if (line.supplier_id) {
    return {
      supplier_id: line.supplier_id,
      supplier_name: line.supplier_name || 'Proveedor asignado',
    };
  }
  if (supplierIdGeneral) {
    return {
      supplier_id: supplierIdGeneral,
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
  proveedorGeneral?: Supplier | null
): InfoEstadoRequerimiento {
  const totalUSD = calcularTotalReqUsd(r.items || [], rateBcv);

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

  if (r.status === 'rechazado') {
    return {
      codigo: 'rechazado',
      label: '❌ Rechazado',
      short: 'Rechazado',
      color: '#DC2626',
      bg: '#FEE2E2',
      icon: '❌',
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

  // 2. Analizar proveedores y cotizaciones de los renglones
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

  // 3. Si falta proveedor en el sistema
  if (!tieneProveedorCompleto) {
    return {
      codigo: 'esperando_proveedor',
      label: '🔍 Esperando Proveedor',
      short: 'Esperando Prov.',
      color: '#4B5563',
      bg: '#F3F4F6',
      icon: '🔍',
      requiereAprobacionGG: false,
      totalUSD,
      tieneProveedorCompleto: false,
      tieneCotizacionCompleta,
      proveedoresNombres,
      esMultiProveedor,
    };
  }

  // 4. Si tiene proveedor pero falta cotización/precio
  if (!tieneCotizacionCompleta) {
    return {
      codigo: 'esperando_cotizacion',
      label: '📋 Esperando Cotización / Precios',
      short: 'Esperando Cot.',
      color: '#D97706',
      bg: '#FEF3C7',
      icon: '📋',
      requiereAprobacionGG: false,
      totalUSD,
      tieneProveedorCompleto: true,
      tieneCotizacionCompleta: false,
      proveedoresNombres,
      esMultiProveedor,
    };
  }

  // 5. Tiene Proveedor Y Cotización cargada:
  // Aplicar Regla de Negocio de Seguridad por Monto (> $1,000 USD)
  const superaLimiteGG = totalUSD > LIMITE_MONTO_GERENTE_GENERAL_USD;
  const yaAprobadoGG = Boolean(r.gerente_aprobado || (r.status === 'aprobado' && r.decided_by));

  if (superaLimiteGG && !yaAprobadoGG) {
    return {
      codigo: 'esperando_aprobacion_gg',
      label: '👔 Esperando Aprobación del Gerente General (> $1,000 USD)',
      short: 'Aprobación GG (> $1k)',
      color: '#7C3AED',
      bg: '#F5F3FF',
      icon: '👔',
      requiereAprobacionGG: true,
      totalUSD,
      tieneProveedorCompleto: true,
      tieneCotizacionCompleta: true,
      proveedoresNombres,
      esMultiProveedor,
    };
  }

  // 6. Si ya fue autorizado o el monto es <= $1,000 USD: pasa a "esperando pago"
  if (r.status !== 'aprobado' && !r.decided_by) {
    return {
      codigo: 'esperando_pago',
      label: '💳 Esperando Pago / Respuesta de Pago',
      short: 'Esperando Pago',
      color: '#2563EB',
      bg: '#EFF6FF',
      icon: '💳',
      requiereAprobacionGG: false,
      totalUSD,
      tieneProveedorCompleto: true,
      tieneCotizacionCompleta: true,
      proveedoresNombres,
      esMultiProveedor,
    };
  }

  // 7. Si está formalmente aprobado
  return {
    codigo: 'aprobado',
    label: superaLimiteGG ? '✅ Aprobado por GG / En Gestión de Pago' : '✅ Aprobado / En Gestión de Pago',
    short: 'Aprobado',
    color: '#059669',
    bg: '#ECFDF5',
    icon: '✅',
    requiereAprobacionGG: false,
    totalUSD,
    tieneProveedorCompleto: true,
    tieneCotizacionCompleta: true,
    proveedoresNombres,
    esMultiProveedor,
  };
}
