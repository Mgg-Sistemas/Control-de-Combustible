// 📦 Lógica de Flujo de Estatus y Asignación de Proveedores para Requerimientos de Compra
// Implementa:
// 1) Asignación individual de proveedores por renglón (compras consolidadas multi-proveedor).
// 2) Flujo dinámico de estados:
//    - "esperando proveedor" si falta proveedor en la orden/ítems.
//    - "esperando pago" si ya tiene cotización y proveedor para montos <= $1,000 USD.
//    - "esperando aprobación del gerente general" si supera los $1,000 USD (filtro de seguridad).
import type { InventoryRequirement, RequirementLine, Supplier } from '../types/database.ts';
import { extraerReciboPago } from './requerimientoExpediente';

export const LIMITE_MONTO_GERENTE_GENERAL_USD = 1000;

export interface ReglaAprobacionMonto {
  montoLimiteUSD: number;
  empresaId: string | null; // null = Todas las empresas
  empresaNombre?: string | null;
  aprobadoresIds: string[]; // Lista de IDs de usuarios autorizados
  aprobadoresNombres: string[]; // Lista de nombres de personas/cargos autorizados
  activo?: boolean;
}

export const REGLA_APROBACION_DEFAULT: ReglaAprobacionMonto = {
  montoLimiteUSD: 1000,
  empresaId: null,
  empresaNombre: 'Todas las empresas',
  aprobadoresIds: [],
  aprobadoresNombres: ['Gerencia General'],
  activo: true,
};

const STORAGE_KEY_REGLA_APROBACION = 'compras_regla_aprobacion_monto_v1';

let memoriaReglaAprobacion: ReglaAprobacionMonto = { ...REGLA_APROBACION_DEFAULT };

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
  const limiteUSD = Number(cfg?.montoLimiteUSD) > 0 ? Number(cfg.montoLimiteUSD) : LIMITE_MONTO_GERENTE_GENERAL_USD;

  if (tienePagoRegistrado) {
    return {
      codigo: 'esperando_recepcion',
      label: '📦 Esperando Recepción en Almacén',
      short: 'Esperando Recepción',
      color: '#0D9488',
      bg: '#F0FDFA',
      icon: '📦',
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

  // 5. Si falta proveedor en el sistema
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

  // 6. Si tiene proveedor pero falta cotización/precio
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

  // 7. Tiene Proveedor Y Cotización cargada:
  // Aplicar Regla de Negocio Dinámica de Aprobación por Monto, Empresa y Personas
  const aplicaEmpresa = !cfg?.empresaId || r.company_id === cfg.empresaId;
  const reglaActiva = cfg?.activo !== false;
  const superaLimiteGG = aplicaEmpresa && reglaActiva && totalUSD > limiteUSD;
  const yaAprobadoGG = Boolean(r.gerente_aprobado || (r.status === 'aprobado' && r.decided_by));

  const textoMonto = limiteUSD.toLocaleString('en-US');
  const sufijoEmpresa = cfg?.empresaId && cfg?.empresaNombre ? ` [${cfg.empresaNombre}]` : '';
  const aprobadoresTxt = (cfg?.aprobadoresNombres && cfg.aprobadoresNombres.length > 0)
    ? cfg.aprobadoresNombres.join(', ')
    : 'Gerente General';

  if (superaLimiteGG && !yaAprobadoGG) {
    return {
      codigo: 'esperando_aprobacion_gg',
      label: `👔 Esperando Aprobación de ${aprobadoresTxt} (> $${textoMonto} USD)${sufijoEmpresa}`,
      short: `Aprobación (> $${textoMonto})${sufijoEmpresa}`,
      color: '#7C3AED',
      bg: '#F5F3FF',
      icon: '👔',
      requiereAprobacionGG: true,
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

  // 8. Si no está formalmente aprobado aún
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
      montoLimiteAplicado: limiteUSD,
      empresaReglaAplicada: cfg?.empresaNombre || null,
      aprobadoresNombres: cfg?.aprobadoresNombres || [],
      aprobadoresIds: cfg?.aprobadoresIds || [],
    };
  }

  // 9. Si está formalmente aprobado (pendiente por pago y recepción)
  return {
    codigo: 'aprobado',
    label: superaLimiteGG ? `✅ Aprobado / En Gestión de Pago (> $${textoMonto})` : '✅ Aprobado / En Gestión de Pago',
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
    montoLimiteAplicado: limiteUSD,
    empresaReglaAplicada: cfg?.empresaNombre || null,
    aprobadoresNombres: cfg?.aprobadoresNombres || [],
    aprobadoresIds: cfg?.aprobadoresIds || [],
  };
}
