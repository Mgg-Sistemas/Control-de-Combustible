// ── Módulo de Cotizaciones y Multi-Moneda ──────────────────────────────────────
// Soporte para cotizar en USD ($), VES (Bs.), EUR (€), COP ($) u otra divisa,
// con comparativa multi-oferta y cálculo de equivalencia en USD para toma de decisiones.

export type MonedaCotizacion = 'USD' | 'VES' | 'EUR' | 'COP' | string;

export interface MonedaConfig {
  codigo: string;
  simbolo: string;
  nombre: string;
  bandera: string;
  esFijaBcv?: boolean;
}

export const MONEDAS_COMUNES: MonedaConfig[] = [
  { codigo: 'USD', simbolo: '$', nombre: 'Dólares Americanos', bandera: '🇺🇸' },
  { codigo: 'VES', simbolo: 'Bs.', nombre: 'Bolívares Digitales', bandera: '🇻🇪', esFijaBcv: true },
  { codigo: 'EUR', simbolo: '€', nombre: 'Euros', bandera: '🇪🇺' },
  { codigo: 'COP', simbolo: 'COP $', nombre: 'Pesos Colombianos', bandera: '🇨🇴' },
];

export interface ArchivoPresupuestoCotizacion {
  id: string;
  url: string;
  name: string;
  kind?: 'image' | 'pdf';
}

export interface PresupuestoLineaCotizacion {
  id: string;
  item_index?: number | null; // Índice del objeto en el requerimiento (si aplica)
  descripcion: string;        // Nombre del objeto o concepto del presupuesto
  qty: number;                // Cantidad de objetos
  unit?: string | null;       // Unidad (UND, CAJA, etc.)
  modo_precio: 'unidad' | 'total'; // Si el precio se colocó por unidad o total
  precio_unitario: number;    // Precio por 1 unidad en la moneda de la cotización
  precio_total: number;       // Precio total por las `qty` unidades
  precio_bs_unitario?: number;// Equivalente/monto en Bs por unidad
  precio_bs_total?: number;   // Equivalente/monto en Bs total
  proveedor_sub?: string | null; // Proveedor o referencia del presupuesto específico
  file_url?: string | null;   // Archivo/foto específico de este presupuesto
  file_name?: string | null;
}

export interface CotizacionAlternativa {
  id: string;
  supplier_id?: string | null;
  supplier_name: string;
  price: number; // Monto total de la cotización (suma de presupuestos o monto directo)
  modo_precio?: 'unidad' | 'total'; // Si se ingresó por unidad o por total
  unit_price?: number; // Precio unitario si aplica a un objeto
  qty_total?: number;  // Cantidad considerada
  currency: MonedaCotizacion;
  exchange_rate?: number; // Tasa de conversión a USD si no es USD
  price_usd_equiv: number; // Precio equivalente normalizado a USD
  price_bs_equiv?: number; // Precio equivalente o pactado en Bolívares
  delivery_days?: string | null; // Tiempo de entrega (ej. "Inmediata", "3 días", "15 días")
  payment_terms?: string | null; // Términos de pago (ej. "Contado", "Crédito 15 días")
  metodo_pago?: string | null;   // Método de pago (Efectivo USD, Pago Móvil, Zelle, etc.)
  file_url?: string | null; // Archivo / Foto principal del presupuesto del proveedor (compatibilidad)
  file_name?: string | null;
  files?: ArchivoPresupuestoCotizacion[]; // Uno o varios archivos de presupuestos adjuntos
  presupuestos?: PresupuestoLineaCotizacion[]; // Uno o varios presupuestos / objetos cotizados dentro de la cotización
  is_selected?: boolean; // Oferta ganadora/seleccionada
  notes?: string | null;
  created_at: string;
  created_by?: string | null;
}

/**
 * Calcula el monto equivalente en USD dado un monto, moneda y tasas disponibles.
 */
export function calcularEquivalenteUsd(
  monto: number,
  moneda: MonedaCotizacion,
  tasaBcv: number = 0,
  tasaManual: number = 0
): number {
  const m = Number(monto) || 0;
  if (m <= 0) return 0;
  const curr = String(moneda || 'USD').toUpperCase().trim();

  if (curr === 'USD') return m;

  if (curr === 'VES' || curr === 'BS' || curr === 'BOLIVARES') {
    if (tasaBcv > 0) return Math.round((m / tasaBcv) * 100) / 100;
    if (tasaManual > 0) return Math.round((m / tasaManual) * 100) / 100;
    return m;
  }

  // Si tiene tasa manual directa (ej: COP por USD o EUR a USD)
  if (tasaManual > 0) {
    if (curr === 'EUR') {
      // 1 EUR = tasaManual USD (o viceversa según se exprese, asumimos EUR/USD ej: 1.08)
      return Math.round((m * (tasaManual >= 1 ? tasaManual : (1 / tasaManual))) * 100) / 100;
    }
    // Si la tasa es ej. 4000 COP por 1 USD
    if (tasaManual > 10) {
      return Math.round((m / tasaManual) * 100) / 100;
    }
    return Math.round((m * tasaManual) * 100) / 100;
  }

  return m;
}

/**
 * Formatea un monto con el símbolo correspondiente de su divisa.
 */
export function formatearMoneda(monto: number, moneda: MonedaCotizacion): string {
  const m = Number(monto) || 0;
  const numStr = m.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const curr = String(moneda || 'USD').toUpperCase().trim();

  switch (curr) {
    case 'USD':
      return `$ ${numStr}`;
    case 'VES':
    case 'BS':
      return `Bs. ${numStr}`;
    case 'EUR':
      return `€ ${numStr}`;
    case 'COP':
      return `COP $ ${numStr}`;
    default:
      return `${curr} ${numStr}`;
  }
}

/**
 * Obtiene el símbolo abreviado de una moneda.
 */
export function simboloMoneda(moneda: MonedaCotizacion): string {
  const curr = String(moneda || 'USD').toUpperCase().trim();
  switch (curr) {
    case 'USD': return '$';
    case 'VES':
    case 'BS': return 'Bs';
    case 'EUR': return '€';
    case 'COP': return 'COP';
    default: return curr.slice(0, 4);
  }
}

/**
 * Empaqueta la lista de cotizaciones en la nota u observaciones para asegurar
 * persistencia transparente sin requerir nuevas columnas SQL obligatorias.
 */
const TAG_COTIZACIONES_INICIO = '[[COTIZACIONES_COMPLETAS:';
const TAG_COTIZACIONES_FIN = ':FIN_COTIZACIONES]]';

export function empaquetarCotizacionesEnTexto(
  textoOriginal: string | null | undefined,
  cotizaciones: CotizacionAlternativa[]
): string {
  const base = limpiarTextoDeCotizaciones(textoOriginal);
  if (!cotizaciones || cotizaciones.length === 0) return base;
  const payload = JSON.stringify(cotizaciones);
  const bloque = `${TAG_COTIZACIONES_INICIO}${payload}${TAG_COTIZACIONES_FIN}`;
  return base ? `${base}\n\n${bloque}` : bloque;
}

export function limpiarTextoDeCotizaciones(texto: string | null | undefined): string {
  if (!texto) return '';
  const regex = new RegExp(`\\s*${escapeRegExp(TAG_COTIZACIONES_INICIO)}[\\s\\S]*?${escapeRegExp(TAG_COTIZACIONES_FIN)}\\s*`, 'g');
  return texto.replace(regex, '').trim();
}

export function extraerCotizacionesDeTexto(texto: string | null | undefined): CotizacionAlternativa[] {
  if (!texto) return [];
  const regex = new RegExp(`${escapeRegExp(TAG_COTIZACIONES_INICIO)}([\\s\\S]*?)${escapeRegExp(TAG_COTIZACIONES_FIN)}`);
  const match = texto.match(regex);
  if (!match || !match[1]) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
