// 📜 Histórico y Trazabilidad Completa de Compras (Solicitudes -> Requerimientos -> Por Pagar -> Almacén)
// Diseñado con compatibilidad 100% en columnas existentes (`observaciones` y `nota`) sin requerir
// migraciones destructivas ni columnas inexistentes en Supabase.

import type {
  InventoryRequirement,
  RequirementLine,
  Cuenta,
  CuentaAbono,
  PurchaseOrder,
  Machinery,
  Vehicle,
  Company,
  Supplier,
} from '../types/database';
import { machineLabel } from './machineLabel';
import {
  extraerFactura,
  extraerReciboPago,
  extraerDespacho,
  extraerProveedorSugerido,
} from './requerimientoExpediente';
import {
  extraerAprobacionCxp,
  extraerFacturaCuenta,
  extraerReciboPagoCuenta,
} from './cuentasPago';
import {
  esSolicitudDeCompra,
  estaSolicitudConvertidaEnRequerimiento,
  resolverEmpresaRequerimiento,
  ID_SIN_EMPRESA_REQ,
} from './requerimientoFlujo';
import { resolverEmpresaDeCuenta } from './cuentasEmpresa';

export type ModuloEventoCompra = 'Solicitudes' | 'Requerimientos' | 'Por Pagar' | 'Almacén';

export type TipoEventoCompra =
  | 'solicitud_creada'
  | 'solicitud_editada'
  | 'convertido_req'
  | 'req_creado'
  | 'estado_flujo'
  | 'aclaratoria_pedida'
  | 'aclaratoria_respondida'
  | 'cotizacion_registrada'
  | 'enviado_por_pagar'
  | 'aprobado_gerencia_cxp'
  | 'aprobacion_gerencial'
  | 'items_modificados'
  | 'factura_registrada'
  | 'factura_adjuntada'
  | 'abono_registrado'
  | 'pago_registrado'
  | 'pago_completado'
  | 'pagado_completo'
  | 'recepcion_almacen'
  | 'despacho_almacen'
  | 'rechazado_o_anulado'
  | 'reabierto'
  | 'reabierto_pendiente'
  | 'condicion_actualizada';

export interface CambioItemDetalle {
  accion: 'agregado' | 'eliminado' | 'modificado';
  nombre: string;
  antes?: {
    qty: number;
    unit: string;
    priceUsd: number;
    subtotalUsd: number;
    supplier?: string | null;
  };
  despues?: {
    qty: number;
    unit: string;
    priceUsd: number;
    subtotalUsd: number;
    supplier?: string | null;
  };
  resumen: string;
}

export interface EventoHistorialCompra {
  id: string;
  at: string; // ISO timestamp (fecha y hora)
  by: string; // Nombre del usuario
  byId?: string | null;
  modulo: ModuloEventoCompra;
  tipo: TipoEventoCompra;
  titulo: string;
  detalle: string;
  motivo?: string | null;
  montoAntesUsd?: number | null;
  montoDespuesUsd?: number | null;
  cambiosItems?: CambioItemDetalle[];
  // Metadatos de contexto para el feed global de Histórico de Compras
  reqId?: string | null;
  reqCode?: string | null;
  cuentaId?: string | null;
  empresaNombre?: string | null;
  proveedorNombre?: string | null;
  solicitanteNombre?: string | null;
  destinoTexto?: string | null;
  areaTexto?: string | null;
}

export interface EnvioCxpInfo {
  enviadoPor: string | null;
  enviadoPorId?: string | null;
  fecha: string; // ISO timestamp
  origen?: string | null;
}

const REGEX_BLOQUE_HISTORIAL = /\[\[HISTORIAL_COMPRA:([\s\S]*?):FIN_HISTORIAL\]\]/i;
const REGEX_REMOVE_HISTORIAL = /\[\[HISTORIAL_COMPRA:[\s\S]*?:FIN_HISTORIAL\]\]/gi;
const REGEX_TAG_ENVIADO_CXP = /\[ENVIADO_CXP:\s*Por:\s*([^|]*)\|\s*Id:\s*([^|]*)\|\s*Fecha:\s*([^|\]]*)(?:\|\s*Origen:\s*([^\]]*))?\]/i;
const REGEX_REMOVE_ENVIADO_CXP = /\[ENVIADO_CXP:[^\]]*\]/gi;

function cleanTagVal(s?: string | null): string {
  return String(s ?? '')
    .replace(/\|/g, '/')
    .replace(/\]/g, ')')
    .replace(/\r?\n/g, ' ')
    .trim();
}

export function fmtFechaHora(iso?: string | null): string {
  if (!iso) return '—';
  const raw = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-');
    return `${d}/${m}/${y}`;
  }
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  const h24 = dt.getHours();
  const ampm = h24 >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h24 % 12 || 12;
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(h12)}:${p(dt.getMinutes())} ${ampm}`;
}

export function toLocalYMD(isoOrDate?: string | Date | null): string {
  if (!isoOrDate) return '';
  if (typeof isoOrDate === 'string') {
    const trimmed = isoOrDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return trimmed.slice(0, 10);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  if (isNaN(isoOrDate.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${isoOrDate.getFullYear()}-${p(isoOrDate.getMonth() + 1)}-${p(isoOrDate.getDate())}`;
}

// ── 1. Etiqueta de Envío a Por Pagar [ENVIADO_CXP: ...] ──────────────────────

export function extraerEnvioCxp(texto?: string | null): EnvioCxpInfo | null {
  if (!texto) return null;
  const m = String(texto).match(REGEX_TAG_ENVIADO_CXP);
  if (!m) return null;
  const enviadoPor = m[1]?.trim() || 'Compras';
  const enviadoPorId = m[2]?.trim() || null;
  const fecha = m[3]?.trim() || '';
  const origen = m[4]?.trim() || null;
  if (!fecha && !enviadoPor) return null;
  return { enviadoPor, enviadoPorId, fecha, origen };
}

export function inyectarEnvioCxpEnTexto(
  textoActual: string | null | undefined,
  info: EnvioCxpInfo | null
): string | null {
  const base = String(textoActual ?? '').replace(REGEX_REMOVE_ENVIADO_CXP, '').trim();
  if (!info) return base || null;
  const tag = `[ENVIADO_CXP: Por: ${cleanTagVal(info.enviadoPor || 'Compras')} | Id: ${cleanTagVal(info.enviadoPorId)} | Fecha: ${cleanTagVal(info.fecha || new Date().toISOString())} | Origen: ${cleanTagVal(info.origen || 'requerimiento')}]`;
  return base ? `${base}\n${tag}` : tag;
}

// ── 2. Bloque [[HISTORIAL_COMPRA:...:FIN_HISTORIAL]] ─────────────────────────

export function extraerBloqueHistorialRaw(texto?: string | null): string | null {
  if (!texto) return null;
  const m = String(texto).match(REGEX_BLOQUE_HISTORIAL);
  return m ? m[0] : null;
}

export function limpiarHistorialYEnvioDeTexto(texto?: string | null): string {
  if (!texto) return '';
  return String(texto)
    .replace(REGEX_REMOVE_HISTORIAL, '')
    .replace(REGEX_REMOVE_ENVIADO_CXP, '')
    .trim();
}

export function extraerEventosHistorial(texto?: string | null): EventoHistorialCompra[] {
  if (!texto) return [];
  const m = String(texto).match(REGEX_BLOQUE_HISTORIAL);
  if (!m || !m[1]) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(m[1].trim()));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((ev) => ev && typeof ev === 'object' && ev.at && ev.titulo);
  } catch {
    return [];
  }
}

export function empaquetarEventosHistorialEnTexto(
  textoActual: string | null | undefined,
  eventos: EventoHistorialCompra[]
): string | null {
  const sinBloque = String(textoActual ?? '').replace(REGEX_REMOVE_HISTORIAL, '').trim();
  const limpios = (eventos || []).slice(-80); // Límite sano de 80 eventos por registro
  if (limpios.length === 0) return sinBloque || null;
  try {
    const encoded = encodeURIComponent(JSON.stringify(limpios));
    const tag = `[[HISTORIAL_COMPRA:${encoded}:FIN_HISTORIAL]]`;
    return sinBloque ? `${sinBloque}\n${tag}` : tag;
  } catch {
    return sinBloque || null;
  }
}

export interface EntradaEventoHistorialCompra {
  id?: string;
  at?: string;
  fecha?: string;
  by?: string | null;
  usuarioNombre?: string | null;
  byId?: string | null;
  usuarioId?: string | null;
  modulo?: ModuloEventoCompra;
  origen?: 'por_pagar' | 'requerimientos' | 'solicitudes' | 'almacen' | string;
  tipo: TipoEventoCompra;
  titulo: string;
  detalle: string;
  motivo?: string | null;
  montoAntesUsd?: number | null;
  montoAntes?: number | null;
  montoDespuesUsd?: number | null;
  montoDespues?: number | null;
  cambiosItems?: CambioItemDetalle[];
  reqId?: string | null;
  reqCode?: string | null;
  cuentaId?: string | null;
  empresaNombre?: string | null;
  proveedorNombre?: string | null;
  solicitanteNombre?: string | null;
  destinoTexto?: string | null;
  areaTexto?: string | null;
}

export function anexarEventoHistorial(
  textoActual: string | null | undefined,
  nuevo: EntradaEventoHistorialCompra
): string {
  const actuales = extraerEventosHistorial(textoActual);
  const ahoraIso = nuevo.at || nuevo.fecha || new Date().toISOString();
  const id = nuevo.id || `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const byNorm = (nuevo.by || nuevo.usuarioNombre || 'Usuario').trim() || 'Usuario';
  const byIdNorm = nuevo.byId ?? nuevo.usuarioId ?? null;
  const moduloNorm: ModuloEventoCompra =
    nuevo.modulo ||
    (nuevo.origen === 'por_pagar'
      ? 'Por Pagar'
      : nuevo.origen === 'solicitudes'
        ? 'Solicitudes'
        : nuevo.origen === 'almacen'
          ? 'Almacén'
          : 'Requerimientos');
  const montoAntesUsd = nuevo.montoAntesUsd ?? nuevo.montoAntes ?? null;
  const montoDespuesUsd = nuevo.montoDespuesUsd ?? nuevo.montoDespues ?? null;

  // Evitar duplicados exactos en menos de 3 segundos
  const ultimo = actuales[actuales.length - 1];
  if (
    ultimo &&
    ultimo.tipo === nuevo.tipo &&
    ultimo.detalle === nuevo.detalle &&
    Math.abs(new Date(ahoraIso).getTime() - new Date(ultimo.at).getTime()) < 3000
  ) {
    return empaquetarEventosHistorialEnTexto(textoActual, actuales) || '';
  }

  const eventoNorm: EventoHistorialCompra = {
    id,
    at: ahoraIso,
    by: byNorm,
    byId: byIdNorm,
    modulo: moduloNorm,
    tipo: nuevo.tipo,
    titulo: nuevo.titulo,
    detalle: nuevo.detalle,
    ...(nuevo.motivo != null ? { motivo: nuevo.motivo } : {}),
    ...(montoAntesUsd != null ? { montoAntesUsd } : {}),
    ...(montoDespuesUsd != null ? { montoDespuesUsd } : {}),
    ...(nuevo.cambiosItems ? { cambiosItems: nuevo.cambiosItems } : {}),
    ...(nuevo.reqId != null ? { reqId: nuevo.reqId } : {}),
    ...(nuevo.reqCode != null ? { reqCode: nuevo.reqCode } : {}),
    ...(nuevo.cuentaId != null ? { cuentaId: nuevo.cuentaId } : {}),
    ...(nuevo.empresaNombre != null ? { empresaNombre: nuevo.empresaNombre } : {}),
    ...(nuevo.proveedorNombre != null ? { proveedorNombre: nuevo.proveedorNombre } : {}),
    ...(nuevo.solicitanteNombre != null ? { solicitanteNombre: nuevo.solicitanteNombre } : {}),
    ...(nuevo.destinoTexto != null ? { destinoTexto: nuevo.destinoTexto } : {}),
    ...(nuevo.areaTexto != null ? { areaTexto: nuevo.areaTexto } : {}),
  };

  const lista = [...actuales, eventoNorm];
  return empaquetarEventosHistorialEnTexto(textoActual, lista) || '';
}

export function preservarHistorialYEnvioEnTexto(
  textoOriginal: string | null | undefined,
  textoNuevo: string | null | undefined
): string | null {
  let res = String(textoNuevo ?? '').trim();
  const envOrig = extraerEnvioCxp(textoOriginal);
  if (envOrig && !extraerEnvioCxp(res)) {
    res = inyectarEnvioCxpEnTexto(res, envOrig) || '';
  }
  const evOrig = extraerEventosHistorial(textoOriginal);
  const evNuevo = extraerEventosHistorial(res);
  if (evOrig.length > 0 && evNuevo.length === 0) {
    res = empaquetarEventosHistorialEnTexto(res, evOrig) || '';
  }
  return res || null;
}

// ── 3. Cálculo de Diff Detallado de Ítems (Quitar / Agregar / Modificar) ────

function precioUnitarioUsdDeItem(it: RequirementLine): number {
  const qty = Math.max(0.0001, Number(it.qty) || 1);
  if (it.modo_precio === 'total' && Number(it.total_usd) > 0) {
    return Math.round((Number(it.total_usd) / qty) * 10000) / 10000;
  }
  if (it.price_usd != null && Number(it.price_usd) > 0) {
    return Number(it.price_usd);
  }
  return Number(it.est_price) || 0;
}

function subtotalUsdDeItem(it: RequirementLine): number {
  const qty = Number(it.qty) || 0;
  if (it.modo_precio === 'total' && Number(it.total_usd) > 0) {
    return Math.round(Number(it.total_usd) * 100) / 100;
  }
  return Math.round(qty * precioUnitarioUsdDeItem(it) * 100) / 100;
}

function fmtUsd(n: number): string {
  return `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function calcularTotalConIvaUsd(items: RequirementLine[], alicuotaIva?: number | null): number {
  const sub = (items || []).reduce((acc, it) => acc + subtotalUsdDeItem(it), 0);
  const alic = Number(alicuotaIva ?? 0);
  if (!(alic > 0)) return Math.round(sub * 100) / 100;
  const baseImp = (items || []).reduce((acc, it) => acc + (it.exento ? 0 : subtotalUsdDeItem(it)), 0);
  const iva = Math.round(baseImp * (alic / 100) * 100) / 100;
  return Math.round((sub + iva) * 100) / 100;
}

export interface ResultadoDiffItemsCompra {
  hayCambios: boolean;
  huboCambios: boolean;
  cambiosItems: CambioItemDetalle[];
  cambios: CambioItemDetalle[];
  montoAntesUsd: number;
  montoAntes: number;
  montoDespuesUsd: number;
  montoDespues: number;
  resumenDetalle: string;
  resumenTexto: string;
}

export function calcularDiffItemsCompra(
  arg1:
    | RequirementLine[]
    | {
        itemsAntes: RequirementLine[];
        itemsDespues: RequirementLine[];
        autor?: string | null;
        modulo?: ModuloEventoCompra;
        motivo?: string | null;
        ivaAntes?: number | null;
        ivaDespues?: number | null;
      },
  arg2?: RequirementLine[],
  arg3?: {
    autor?: string | null;
    modulo?: ModuloEventoCompra;
    motivo?: string | null;
    ivaAntes?: number | null;
    ivaDespues?: number | null;
  }
): ResultadoDiffItemsCompra {
  const params = Array.isArray(arg1)
    ? {
        itemsAntes: arg1,
        itemsDespues: Array.isArray(arg2) ? arg2 : [],
        autor: arg3?.autor || 'Usuario autorizado',
        modulo: arg3?.modulo || ('Por Pagar' as ModuloEventoCompra),
        motivo: arg3?.motivo ?? null,
        ivaAntes: arg3?.ivaAntes ?? null,
        ivaDespues: arg3?.ivaDespues ?? null,
      }
    : {
        itemsAntes: Array.isArray(arg1?.itemsAntes) ? arg1.itemsAntes : [],
        itemsDespues: Array.isArray(arg1?.itemsDespues) ? arg1.itemsDespues : [],
        autor: arg1?.autor || 'Usuario autorizado',
        modulo: arg1?.modulo || ('Por Pagar' as ModuloEventoCompra),
        motivo: arg1?.motivo ?? null,
        ivaAntes: arg1?.ivaAntes ?? null,
        ivaDespues: arg1?.ivaDespues ?? null,
      };
  const antes = params.itemsAntes;
  const despues = params.itemsDespues;
  const montoAntesUsd = calcularTotalConIvaUsd(antes, params.ivaAntes);
  const montoDespuesUsd = calcularTotalConIvaUsd(despues, params.ivaDespues ?? params.ivaAntes);

  const usadosDespues = new Set<number>();
  const cambios: CambioItemDetalle[] = [];

  const normKey = (s?: string | null) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  // 1. Buscar cada ítem de "antes" en "despues"
  antes.forEach((itA, idxA) => {
    const keyA = normKey(itA.name);
    let matchIdx = -1;

    // Primero por product_id o nombre exacto no usado
    matchIdx = despues.findIndex(
      (itD, idxD) =>
        !usadosDespues.has(idxD) &&
        ((itA.product_id && itD.product_id && itA.product_id === itD.product_id) ||
          (keyA && normKey(itD.name) === keyA))
    );

    // Si se renombró en la misma posición y la cantidad de filas es igual
    if (matchIdx === -1 && antes.length === despues.length && !usadosDespues.has(idxA)) {
      matchIdx = idxA;
    }

    const qA = Number(itA.qty) || 0;
    const uA = (itA.unit || 'UND').toUpperCase();
    const pA = precioUnitarioUsdDeItem(itA);
    const subA = subtotalUsdDeItem(itA);

    if (matchIdx === -1) {
      // Eliminado
      cambios.push({
        accion: 'eliminado',
        nombre: itA.name || 'Ítem sin nombre',
        antes: { qty: qA, unit: uA, priceUsd: pA, subtotalUsd: subA, supplier: itA.supplier_name },
        resumen: `Quitó «${itA.name}» (${qA} ${uA} × ${fmtUsd(pA)} = ${fmtUsd(subA)})`,
      });
    } else {
      usadosDespues.add(matchIdx);
      const itD = despues[matchIdx];
      const qD = Number(itD.qty) || 0;
      const uD = (itD.unit || 'UND').toUpperCase();
      const pD = precioUnitarioUsdDeItem(itD);
      const subD = subtotalUsdDeItem(itD);
      const nombreCambio = normKey(itA.name) !== normKey(itD.name);
      const qtyCambio = Math.abs(qA - qD) > 0.0001 || uA !== uD;
      const priceCambio = Math.abs(pA - pD) > 0.005 || Math.abs(subA - subD) > 0.005;
      const supCambio = normKey(itA.supplier_name) !== normKey(itD.supplier_name) && Boolean(itA.supplier_name || itD.supplier_name);

      if (nombreCambio || qtyCambio || priceCambio || supCambio) {
        const partes: string[] = [];
        if (nombreCambio) partes.push(`nombre «${itA.name}» → «${itD.name}»`);
        if (qtyCambio) partes.push(`cantidad ${qA} ${uA} → ${qD} ${uD}`);
        if (priceCambio) partes.push(`precio ${fmtUsd(pA)} → ${fmtUsd(pD)} c/u (subtotal ${fmtUsd(subA)} → ${fmtUsd(subD)})`);
        if (supCambio) partes.push(`proveedor «${itA.supplier_name || 'Sin asignar'}» → «${itD.supplier_name || 'Sin asignar'}»`);

        cambios.push({
          accion: 'modificado',
          nombre: itD.name || itA.name || 'Ítem',
          antes: { qty: qA, unit: uA, priceUsd: pA, subtotalUsd: subA, supplier: itA.supplier_name },
          despues: { qty: qD, unit: uD, priceUsd: pD, subtotalUsd: subD, supplier: itD.supplier_name },
          resumen: `Modificó «${itD.name || itA.name}»: ${partes.join(' · ')}`,
        });
      }
    }
  });

  // 2. Ítems en "despues" que no estaban en "antes" -> Agregados
  despues.forEach((itD, idxD) => {
    if (usadosDespues.has(idxD)) return;
    const qD = Number(itD.qty) || 0;
    const uD = (itD.unit || 'UND').toUpperCase();
    const pD = precioUnitarioUsdDeItem(itD);
    const subD = subtotalUsdDeItem(itD);
    cambios.push({
      accion: 'agregado',
      nombre: itD.name || 'Nuevo ítem',
      despues: { qty: qD, unit: uD, priceUsd: pD, subtotalUsd: subD, supplier: itD.supplier_name },
      resumen: `Agregó «${itD.name}» (${qD} ${uD} × ${fmtUsd(pD)} = ${fmtUsd(subD)})`,
    });
  });

  const ivaCambio =
    params.ivaAntes != null &&
    params.ivaDespues != null &&
    Number(params.ivaAntes) !== Number(params.ivaDespues);

  const hayCambios = cambios.length > 0 || ivaCambio || Math.abs(montoAntesUsd - montoDespuesUsd) >= 0.01;

  const frases = cambios.map((c) => c.resumen);
  if (ivaCambio) {
    frases.push(`IVA ajustado de ${Number(params.ivaAntes || 0)}% a ${Number(params.ivaDespues || 0)}%`);
  }
  if (Math.abs(montoAntesUsd - montoDespuesUsd) >= 0.01) {
    frases.push(`Monto total pasó de ${fmtUsd(montoAntesUsd)} a ${fmtUsd(montoDespuesUsd)} USD`);
  }
  if (params.motivo && params.motivo.trim()) {
    frases.push(`Motivo: ${params.motivo.trim()}`);
  }

  const resumenDetalle =
    frases.length > 0
      ? `${params.autor} desde ${params.modulo}: ${frases.join(' · ')}.`
      : `${params.autor} actualizó los ítems en ${params.modulo}.`;

  return {
    hayCambios,
    huboCambios: hayCambios,
    cambiosItems: cambios,
    cambios,
    montoAntesUsd,
    montoAntes: montoAntesUsd,
    montoDespuesUsd,
    montoDespues: montoDespuesUsd,
    resumenDetalle,
    resumenTexto: resumenDetalle,
  };
}

// ── 4. Resolución de Trazabilidad Completa (Requerimientos <-> Por Pagar) ────

export interface TrazabilidadPorPagar {
  req: InventoryRequirement | null;
  reqVinculado: InventoryRequirement | null;
  items: RequirementLine[];
  reqCode: string | null;
  tituloReq: string | null;
  solicitadoPor: string;
  registradoPor: string | null;
  autorizadoPor: string | null;
  responsableAlmacen: string | null;
  motorizadoNombre: string | null;
  fechaSolicitudIso: string | null;
  fechaSolicitudSoloDia: string | null;
  fechaHoraSolicitudTexto: string;
  destinoTexto: string | null; // SIEMPRE incluye código + nombre + PLACA si es maquinaria/vehículo
  areaTexto: string | null;
  frenteTexto: string | null;
  empresaNombre: string;
  empresaPagadoraNombre: string | null;
  proveedorNombre: string;
  enviadoPorPagarPor: string;
  fechaEnviadoPorPagarIso: string | null;
  fechaEnvioSoloDia: string | null;
  fechaHoraEnviadoPorPagarTexto: string;
  aprobadoGerenciaPor: string | null;
  fechaHoraAprobadoGerenciaTexto: string | null;
  modificacionesItemsCount: number;
}

/**
 * Enriquecedor que garantiza que si el texto de destino menciona una maquinaria o vehículo,
 * SIEMPRE lleve también su PLACA / Serial (cumpliendo la regla estricta de GEMINI.md).
 */
export function enriquecerDestinoConPlaca(
  textoBase: string | null | undefined,
  machines?: readonly Machinery[] | null,
  vehicles?: readonly Vehicle[] | null
): string {
  const raw = String(textoBase ?? '').trim();
  if (!raw) return '';

  const normStr = (s?: string | null) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const rawNorm = normStr(raw);

  if (Array.isArray(machines) && machines.length > 0) {
    for (const m of machines) {
      const codeN = normStr(m.code);
      const plateN = normStr(m.plate);
      if (
        (codeN && codeN.length >= 3 && rawNorm.includes(codeN)) ||
        (plateN && plateN.length >= 4 && rawNorm.includes(plateN))
      ) {
        const lbl = machineLabel(m);
        if (m.plate && !rawNorm.includes(plateN)) {
          return `${raw} [Placa: ${m.plate}]`;
        }
        return raw || lbl;
      }
    }
  }

  if (Array.isArray(vehicles) && vehicles.length > 0) {
    for (const v of vehicles) {
      const codeN = normStr(v.code);
      const plateN = normStr(v.plate);
      if (
        (codeN && codeN.length >= 3 && rawNorm.includes(codeN)) ||
        (plateN && plateN.length >= 4 && rawNorm.includes(plateN))
      ) {
        if (v.plate && !rawNorm.includes(plateN)) {
          return `${raw} [Placa: ${v.plate}]`;
        }
        return raw;
      }
    }
  }

  return raw;
}

export function extraerDestinoDeRequerimiento(
  r?: Partial<InventoryRequirement> | null,
  machines?: readonly Machinery[] | null,
  vehicles?: readonly Vehicle[] | null
): string | null {
  if (!r) return null;
  let dest = '';
  const despacho = extraerDespacho(r as InventoryRequirement);
  if (despacho?.maquinariaCodigo) {
    dest = `${despacho.maquinariaCodigo}${despacho.maquinariaPlaca ? ` [Placa: ${despacho.maquinariaPlaca}]` : ''}`;
  } else if (r.title && r.title.includes('para ')) {
    dest = r.title.split('para ').slice(1).join('para ').trim();
  } else if (r.observaciones && r.observaciones.includes('para ')) {
    const primeraLinea = r.observaciones.split('\n')[0] || '';
    if (primeraLinea.includes('para ')) {
      dest = primeraLinea.split('para ').slice(1).join('para ').trim();
    }
  } else if (r.destino_tipo === 'maquinaria') {
    dest = 'Maquinaria';
  } else if (r.destino_tipo === 'vehiculo') {
    dest = 'Vehículo';
  } else if (r.area) {
    dest = r.area;
  }

  // Limpiar cualquier tag accidental al final del destino
  dest = dest.replace(/\[[^\]]*\]/g, (m) => (m.toLowerCase().includes('placa') || m.toLowerCase().includes('serial') ? m : '')).trim();
  if (!dest) return null;
  return enriquecerDestinoConPlaca(dest, machines, vehicles);
}

export function resolverRequerimientoVinculadoACuenta(
  c: Partial<Cuenta> | null | undefined,
  requirements?: readonly InventoryRequirement[] | null,
  orders?: readonly PurchaseOrder[] | null
): InventoryRequirement | null {
  if (!c || !Array.isArray(requirements) || requirements.length === 0) return null;
  if (c.inventory_requirement_id) {
    const byId = requirements.find((r) => r.id === c.inventory_requirement_id);
    if (byId) return byId;
  }
  if (c.order_id) {
    const directReq = requirements.find((r) => r.id === c.order_id);
    if (directReq) return directReq;
    if (Array.isArray(orders)) {
      const ord = orders.find((o) => o.id === c.order_id);
      if (ord?.inventory_requirement_id) {
        const byOrd = requirements.find((r) => r.id === ord.inventory_requirement_id);
        if (byOrd) return byOrd;
      }
    }
  }
  const haystack = `${c.documento || ''} ${c.concepto || ''} ${c.nota || ''}`;
  const matchCode = haystack.match(/\b(REQ-\d+)\b/i);
  if (matchCode) {
    const codeUp = matchCode[1].toUpperCase();
    const byCode = requirements.find((r) => String(r.code || '').toUpperCase() === codeUp);
    if (byCode) return byCode;
  }
  return null;
}

export interface OpcionesTrazabilidadPorPagar {
  cuenta?: Partial<Cuenta>;
  requirements?: readonly InventoryRequirement[] | null;
  orders?: readonly PurchaseOrder[] | null;
  companies?: readonly Company[] | null;
  suppliers?: readonly Supplier[] | null;
  machines?: readonly Machinery[] | null;
  machinery?: readonly Machinery[] | null;
  vehicles?: readonly Vehicle[] | null;
  usuariosMap?: ReadonlyMap<string, string> | null;
  contraparteFallback?: string;
  empresaNombreFallback?: string;
}

export function resolverTrazabilidadPorPagar(
  arg1: Partial<Cuenta> | OpcionesTrazabilidadPorPagar,
  arg2?: OpcionesTrazabilidadPorPagar
): TrazabilidadPorPagar {
  const esFirmaDosArgs =
    arg2 !== undefined ||
    (arg1 && typeof arg1 === 'object' && !('cuenta' in arg1));
  const cuenta: Partial<Cuenta> = esFirmaDosArgs
    ? ((arg1 as Partial<Cuenta>) || {})
    : ((arg1 as OpcionesTrazabilidadPorPagar)?.cuenta || {});
  const params: OpcionesTrazabilidadPorPagar = esFirmaDosArgs
    ? (arg2 || {})
    : ((arg1 as OpcionesTrazabilidadPorPagar) || {});

  const { requirements, orders, companies, suppliers, vehicles, usuariosMap } = params;
  const machines = params.machines || params.machinery || null;

  const req = resolverRequerimientoVinculadoACuenta(cuenta, requirements, orders);
  const ord = cuenta?.order_id && Array.isArray(orders) ? orders.find((o) => o.id === cuenta.order_id) || null : null;

  const userFromId = (id?: string | null) => (id && usuariosMap ? usuariosMap.get(String(id)) || null : null);

  // 1. Solicitado por y Registrado por
  const solicitadoPor =
    req?.solicitante_nombre?.trim() ||
    req?.requested_by_name?.trim() ||
    userFromId(req?.requested_by) ||
    userFromId(cuenta?.created_by) ||
    'Departamento de Compras';

  const registradoPorRaw =
    req?.requested_by_name?.trim() ||
    userFromId(req?.requested_by) ||
    userFromId(cuenta?.created_by) ||
    null;

  const registradoPor =
    registradoPorRaw && registradoPorRaw.toLowerCase() !== solicitadoPor.toLowerCase()
      ? registradoPorRaw
      : registradoPorRaw;

  // 2. Fecha y hora de solicitud
  const fechaSolicitudIso = req?.created_at || ord?.created_at || cuenta?.created_at || cuenta?.fecha_emision || null;
  const fechaSolicitudSoloDia = toLocalYMD(fechaSolicitudIso) || null;
  const fechaHoraSolicitudTexto = fmtFechaHora(fechaSolicitudIso);

  // 3. Destino (para quién es) + Área + Empresa
  let destinoTexto = extraerDestinoDeRequerimiento(req, machines, vehicles);
  if (!destinoTexto && cuenta?.concepto && cuenta.concepto.includes('para ')) {
    destinoTexto = enriquecerDestinoConPlaca(
      cuenta.concepto.split('para ').slice(1).join('para ').trim(),
      machines,
      vehicles
    );
  }

  const areaTexto = req?.area?.trim() || null;
  const frenteTexto = (req as any)?.frente_nombre?.trim() || null;

  let empresaNombre = params.empresaNombreFallback || '';
  if (!empresaNombre && companies && companies.length > 0 && cuenta) {
    const empCta = resolverEmpresaDeCuenta(cuenta as Cuenta, {
      companies: companies as Company[],
      requirements: (requirements as InventoryRequirement[]) || [],
      orders: (orders as PurchaseOrder[]) || [],
    });
    empresaNombre = empCta.name;
  }
  if (!empresaNombre && req && companies) {
    const empReq = resolverEmpresaRequerimiento(req, companies as Company[]);
    if (empReq.id !== ID_SIN_EMPRESA_REQ) empresaNombre = empReq.name;
  }
  if (!empresaNombre) empresaNombre = 'Sin empresa asignada';

  const proveedorNombre =
    params.contraparteFallback ||
    (cuenta?.supplier_id && suppliers ? suppliers.find((s) => s.id === cuenta.supplier_id)?.name : null) ||
    (req?.supplier_id && suppliers ? suppliers.find((s) => s.id === req.supplier_id)?.name : null) ||
    cuenta?.contraparte ||
    'Proveedor';

  // 4. Quién lo envió a Por Pagar y en qué fecha/hora
  const envioCta = extraerEnvioCxp(cuenta?.nota);
  const envioReq = extraerEnvioCxp(req?.observaciones);
  const envioInfo = envioCta || envioReq;
  const apCta = extraerAprobacionCxp(cuenta?.nota);
  const apReq = extraerAprobacionCxp(req?.observaciones);
  const apInfo = apCta?.estado === 'aprobado' ? apCta : apReq?.estado === 'aprobado' ? apReq : apCta || apReq || null;

  const enviadoPorPagarPor =
    envioInfo?.enviadoPor ||
    req?.decided_by_name?.trim() ||
    userFromId(req?.decided_by) ||
    userFromId(cuenta?.created_by) ||
    'Compras / Administración';

  const fechaEnviadoPorPagarIso =
    envioInfo?.fecha ||
    req?.decided_at ||
    (apCta?.estado === 'pendiente' ? apCta.fecha : null) ||
    (apReq?.estado === 'pendiente' ? apReq.fecha : null) ||
    cuenta?.created_at ||
    cuenta?.fecha_emision ||
    null;

  const fechaEnvioSoloDia = toLocalYMD(fechaEnviadoPorPagarIso) || null;
  const fechaHoraEnviadoPorPagarTexto = fmtFechaHora(fechaEnviadoPorPagarIso);

  const aprobadoGerenciaPor =
    apInfo?.estado === 'aprobado' ? apInfo.aprobadoPor || 'Gerencia General' : null;
  const fechaHoraAprobadoGerenciaTexto =
    apInfo?.estado === 'aprobado' && apInfo.fecha ? fmtFechaHora(apInfo.fecha) : null;

  const evReq = extraerEventosHistorial(req?.observaciones);
  const evCta = extraerEventosHistorial(cuenta?.nota);
  const modsIds = new Set<string>();
  [...evReq, ...evCta].forEach((ev) => {
    if (ev.tipo === 'items_modificados') modsIds.add(ev.id);
  });

  const itemsResueltos: RequirementLine[] =
    req && Array.isArray(req.items)
      ? req.items
      : ord && Array.isArray((ord as any).items)
        ? (ord as any).items
        : [];

  return {
    req,
    reqVinculado: req,
    items: itemsResueltos,
    reqCode: req?.code || (cuenta?.documento?.startsWith('REQ-') ? cuenta.documento : null),
    tituloReq: req?.title || cuenta?.concepto || null,
    solicitadoPor,
    registradoPor,
    autorizadoPor: req?.autorizado_nombre?.trim() || null,
    responsableAlmacen: req?.responsable_nombre?.trim() || null,
    motorizadoNombre: req?.motorizado_nombre?.trim() || null,
    fechaSolicitudIso,
    fechaSolicitudSoloDia,
    fechaHoraSolicitudTexto,
    destinoTexto,
    areaTexto,
    frenteTexto,
    empresaNombre,
    empresaPagadoraNombre: req?.empresa_pagadora_nombre?.trim() || null,
    proveedorNombre,
    enviadoPorPagarPor,
    fechaEnviadoPorPagarIso,
    fechaEnvioSoloDia,
    fechaHoraEnviadoPorPagarTexto,
    aprobadoGerenciaPor,
    fechaHoraAprobadoGerenciaTexto,
    modificacionesItemsCount: modsIds.size,
  };
}

// ── 5. Reconstrucción de la Línea de Tiempo de un Expediente ─────────────────

export function construirTimelineExpediente(params: {
  req?: InventoryRequirement | null;
  cuenta?: Partial<Cuenta> | null;
  abonos?: readonly CuentaAbono[] | null;
  companies?: readonly Company[] | null;
  suppliers?: readonly Supplier[] | null;
  machines?: readonly Machinery[] | null;
  machinery?: readonly Machinery[] | null;
  vehicles?: readonly Vehicle[] | null;
  usuariosMap?: ReadonlyMap<string, string> | null;
}): EventoHistorialCompra[] {
  const { req, cuenta, abonos, companies, suppliers, vehicles, usuariosMap } = params;
  const machines = params.machines || params.machinery || null;
  const mapaEventos = new Map<string, EventoHistorialCompra>();

  const reqCode = req?.code || (cuenta?.documento?.startsWith('REQ-') ? cuenta.documento : null);
  const destinoTexto = extraerDestinoDeRequerimiento(req, machines, vehicles);
  const areaTexto = req?.area || null;
  const solicitanteNombre =
    req?.solicitante_nombre || req?.requested_by_name || 'Personal de Campo';

  let empresaNombre = '';
  if (req && companies) {
    const empReq = resolverEmpresaRequerimiento(req, companies as Company[]);
    if (empReq.id !== ID_SIN_EMPRESA_REQ) empresaNombre = empReq.name;
  }
  if (!empresaNombre && cuenta && companies) {
    const empCta = resolverEmpresaDeCuenta(cuenta as Cuenta, {
      companies: companies as Company[],
      requirements: req ? [req] : [],
      orders: [],
    });
    empresaNombre = empCta.name;
  }

  const proveedorNombre =
    (cuenta?.supplier_id && suppliers ? suppliers.find((s) => s.id === cuenta.supplier_id)?.name : null) ||
    (req?.supplier_id && suppliers ? suppliers.find((s) => s.id === req.supplier_id)?.name : null) ||
    cuenta?.contraparte ||
    req?.items?.find((it) => it.supplier_name)?.supplier_name ||
    null;

  // 1. Cargar eventos explícitos guardados en [[HISTORIAL_COMPRA:...:FIN_HISTORIAL]]
  const explicitos = [
    ...extraerEventosHistorial(req?.observaciones),
    ...extraerEventosHistorial(cuenta?.nota),
  ];
  explicitos.forEach((ev) => {
    mapaEventos.set(ev.id, {
      ...ev,
      reqId: ev.reqId || req?.id || cuenta?.inventory_requirement_id || null,
      reqCode: ev.reqCode || reqCode,
      cuentaId: ev.cuentaId || cuenta?.id || null,
      empresaNombre: ev.empresaNombre || empresaNombre || null,
      proveedorNombre: ev.proveedorNombre || proveedorNombre || null,
      solicitanteNombre: ev.solicitanteNombre || solicitanteNombre,
      destinoTexto: ev.destinoTexto || destinoTexto,
      areaTexto: ev.areaTexto || areaTexto,
    });
  });

  const tieneTipo = (t: TipoEventoCompra) =>
    Array.from(mapaEventos.values()).some((e) => e.tipo === t);

  // 2. Síntesis automática de hitos para todos los registros (históricos y actuales)
  if (req) {
    const esSol = esSolicitudDeCompra(req);
    if (!tieneTipo('solicitud_creada') && !tieneTipo('req_creado')) {
      const itemsResumen = (req.items || [])
        .slice(0, 4)
        .map((it) => `${it.qty} ${it.unit || 'UND'} ${it.name}`)
        .join(', ');
      const masItems = (req.items?.length || 0) > 4 ? ` (+${req.items.length - 4} más)` : '';
      const idCreacion = `syn-create-${req.id}`;
      mapaEventos.set(idCreacion, {
        id: idCreacion,
        at: req.created_at,
        by: req.requested_by_name || req.solicitante_nombre || 'Solicitante',
        modulo: esSol ? 'Solicitudes' : 'Requerimientos',
        tipo: esSol ? 'solicitud_creada' : 'req_creado',
        titulo: esSol ? 'Solicitud de compra creada' : 'Requerimiento de compra registrado',
        detalle: `Solicitado por ${solicitanteNombre}${req.requested_by_name && req.requested_by_name !== solicitanteNombre ? ` (registró: ${req.requested_by_name})` : ''}${destinoTexto ? ` · Para: ${destinoTexto}` : ''}${areaTexto ? ` · Área: ${areaTexto}` : ''}. Renglones (${req.items?.length || 0}): ${itemsResumen}${masItems}.`,
        reqId: req.id,
        reqCode,
        cuentaId: cuenta?.id || null,
        empresaNombre: empresaNombre || null,
        proveedorNombre,
        solicitanteNombre,
        destinoTexto,
        areaTexto,
      });
    }

    if (esSol && estaSolicitudConvertidaEnRequerimiento(req) && !tieneTipo('convertido_req')) {
      const idConv = `syn-conv-${req.id}`;
      const fechaConv = new Date(new Date(req.created_at).getTime() + 1000).toISOString();
      mapaEventos.set(idConv, {
        id: idConv,
        at: fechaConv,
        by: 'Analista de Compras',
        modulo: 'Requerimientos',
        tipo: 'convertido_req',
        titulo: 'Convertida en Requerimiento oficial',
        detalle: `La solicitud ${reqCode || ''} pasó a la bandeja de Requerimientos para gestión de proveedor y precios.`,
        reqId: req.id,
        reqCode,
        cuentaId: cuenta?.id || null,
        empresaNombre: empresaNombre || null,
        proveedorNombre,
        solicitanteNombre,
        destinoTexto,
        areaTexto,
      });
    }

    if (req.aclaratoria_motivo && req.aclaratoria_fecha_solicitud && !tieneTipo('aclaratoria_pedida')) {
      const idAcl = `syn-acl-ask-${req.id}`;
      mapaEventos.set(idAcl, {
        id: idAcl,
        at: req.aclaratoria_fecha_solicitud,
        by: req.aclaratoria_solicitada_por || 'Compras',
        modulo: 'Requerimientos',
        tipo: 'aclaratoria_pedida',
        titulo: 'Aclaratoria técnica solicitada',
        detalle: `Pregunta: ${req.aclaratoria_motivo}`,
        reqId: req.id,
        reqCode,
        cuentaId: cuenta?.id || null,
        empresaNombre: empresaNombre || null,
        proveedorNombre,
        solicitanteNombre,
        destinoTexto,
        areaTexto,
      });
    }

    if (req.aclaratoria_respuesta && req.aclaratoria_fecha_respuesta && !tieneTipo('aclaratoria_respondida')) {
      const idAclRes = `syn-acl-ans-${req.id}`;
      mapaEventos.set(idAclRes, {
        id: idAclRes,
        at: req.aclaratoria_fecha_respuesta,
        by: solicitanteNombre,
        modulo: 'Solicitudes',
        tipo: 'aclaratoria_respondida',
        titulo: 'Respuesta técnica registrada',
        detalle: `Respuesta: ${req.aclaratoria_respuesta}`,
        reqId: req.id,
        reqCode,
        cuentaId: cuenta?.id || null,
        empresaNombre: empresaNombre || null,
        proveedorNombre,
        solicitanteNombre,
        destinoTexto,
        areaTexto,
      });
    }
  }

  // 3. Envío a Por Pagar
  const envInfo = extraerEnvioCxp(cuenta?.nota) || extraerEnvioCxp(req?.observaciones);
  if (
    !tieneTipo('enviado_por_pagar') &&
    (envInfo || (req && (req.status === 'aprobado' || req.status === 'esperando_recepcion' || req.status === 'recibido')) || cuenta)
  ) {
    const fechaEnv =
      envInfo?.fecha ||
      req?.decided_at ||
      cuenta?.created_at ||
      cuenta?.fecha_emision ||
      req?.created_at ||
      new Date().toISOString();
    const enviadoPor =
      envInfo?.enviadoPor ||
      req?.decided_by_name ||
      (req?.decided_by && usuariosMap ? usuariosMap.get(req.decided_by) : null) ||
      (cuenta?.created_by && usuariosMap ? usuariosMap.get(String(cuenta.created_by)) : null) ||
      'Analista de Compras';
    const montoTotal =
      cuenta?.monto != null && Number(cuenta.monto) > 0
        ? Number(cuenta.monto)
        : req
          ? calcularTotalConIvaUsd(req.items || [], req.iva_alicuota)
          : 0;
    const idEnv = `syn-env-cxp-${req?.id || cuenta?.id}`;
    mapaEventos.set(idEnv, {
      id: idEnv,
      at: fechaEnv,
      by: enviadoPor,
      modulo: 'Por Pagar',
      tipo: 'enviado_por_pagar',
      titulo: 'Enviado a Cuentas por Pagar',
      detalle: `Marcado para Por Pagar por ${enviadoPor}${proveedorNombre ? ` · Proveedor: ${proveedorNombre}` : ''}${montoTotal > 0 ? ` · Monto: ${fmtUsd(montoTotal)} USD` : ''}.`,
      montoDespuesUsd: montoTotal > 0 ? montoTotal : null,
      reqId: req?.id || cuenta?.inventory_requirement_id || null,
      reqCode,
      cuentaId: cuenta?.id || null,
      empresaNombre: empresaNombre || null,
      proveedorNombre,
      solicitanteNombre,
      destinoTexto,
      areaTexto,
    });
  }

  // 4. Autorización Gerencial en Por Pagar
  const apCta = extraerAprobacionCxp(cuenta?.nota);
  const apReq = extraerAprobacionCxp(req?.observaciones);
  const apOk = apCta?.estado === 'aprobado' ? apCta : apReq?.estado === 'aprobado' ? apReq : null;
  if (apOk && !tieneTipo('aprobado_gerencia_cxp')) {
    const idAp = `syn-ap-cxp-${req?.id || cuenta?.id}`;
    mapaEventos.set(idAp, {
      id: idAp,
      at: apOk.fecha || cuenta?.updated_at || new Date().toISOString(),
      by: apOk.aprobadoPor || 'Gerencia General',
      modulo: 'Por Pagar',
      tipo: 'aprobado_gerencia_cxp',
      titulo: 'Pago autorizado por Gerencia / Aprobador',
      detalle: `Autorizado para pago por ${apOk.aprobadoPor || 'Gerencia General'}. Estado: Esperando Pago.`,
      reqId: req?.id || cuenta?.inventory_requirement_id || null,
      reqCode,
      cuentaId: cuenta?.id || null,
      empresaNombre: empresaNombre || null,
      proveedorNombre,
      solicitanteNombre,
      destinoTexto,
      areaTexto,
    });
  }

  // 5. Factura registrada
  const fac = extraerFacturaCuenta(cuenta) || (req ? extraerFactura(req) : null);
  if (fac && (fac.url || fac.numero || (fac.archivos && fac.archivos.length > 0)) && !tieneTipo('factura_registrada')) {
    const idFac = `syn-fac-${req?.id || cuenta?.id}`;
    const nFotos = fac.archivos?.length || (fac.url ? 1 : 0);
    mapaEventos.set(idFac, {
      id: idFac,
      at: fac.subidaAt || fac.fecha || cuenta?.updated_at || req?.created_at || new Date().toISOString(),
      by: fac.subidaPor || 'Tesorería / Por Pagar',
      modulo: 'Por Pagar',
      tipo: 'factura_registrada',
      titulo: 'Factura fiscal / comercial cargada',
      detalle: `Factura N° ${fac.numero || 'S/N'}${fac.empresa ? ` (${fac.empresa})` : ''}${nFotos > 0 ? ` · ${nFotos} archivo(s)/foto(s) adjunto(s)` : ''}${fac.nota ? ` · Nota: ${fac.nota}` : ''}.`,
      reqId: req?.id || cuenta?.inventory_requirement_id || null,
      reqCode,
      cuentaId: cuenta?.id || null,
      empresaNombre: empresaNombre || null,
      proveedorNombre,
      solicitanteNombre,
      destinoTexto,
      areaTexto,
    });
  }

  // 6. Abonos registrados
  if (Array.isArray(abonos) && abonos.length > 0) {
    abonos.forEach((ab) => {
      const idAb = `syn-abono-${ab.id}`;
      if (!mapaEventos.has(idAb)) {
        mapaEventos.set(idAb, {
          id: idAb,
          at: ab.created_at || ab.fecha,
          by: (ab.created_by && usuariosMap ? usuariosMap.get(ab.created_by) : null) || 'Tesorería',
          modulo: 'Por Pagar',
          tipo: 'abono_registrado',
          titulo: `Abono parcial registrado (${fmtUsd(Number(ab.monto) || 0)})`,
          detalle: `Abono de ${fmtUsd(Number(ab.monto) || 0)} USD${ab.metodo ? ` vía ${ab.metodo}` : ''}${ab.referencia ? ` · Ref: ${ab.referencia}` : ''}.`,
          montoDespuesUsd: Number(ab.monto) || 0,
          reqId: req?.id || cuenta?.inventory_requirement_id || null,
          reqCode,
          cuentaId: cuenta?.id || ab.cuenta_id,
          empresaNombre: empresaNombre || null,
          proveedorNombre,
          solicitanteNombre,
          destinoTexto,
          areaTexto,
        });
      }
    });
  }

  // 7. Comprobante de pago / Cuenta pagada
  const rec = extraerReciboPagoCuenta(cuenta) || (req ? extraerReciboPago(req) : null);
  const estaPagada = cuenta?.estado === 'pagada' || req?.status === 'esperando_recepcion' || req?.status === 'recibido';
  if ((rec || estaPagada) && !tieneTipo('pago_completado')) {
    const idPago = `syn-pago-${req?.id || cuenta?.id}`;
    const nComp = rec?.archivos?.length || (rec?.url ? 1 : 0);
    const fechaPago =
      rec?.subidoAt ||
      cuenta?.settled_at ||
      rec?.fecha ||
      cuenta?.updated_at ||
      new Date().toISOString();
    const pagadoPor =
      rec?.subidoPor ||
      (cuenta?.settled_by && usuariosMap ? usuariosMap.get(String(cuenta.settled_by)) : null) ||
      'Tesorería / Por Pagar';
    mapaEventos.set(idPago, {
      id: idPago,
      at: fechaPago,
      by: pagadoPor,
      modulo: 'Por Pagar',
      tipo: 'pago_completado',
      titulo: estaPagada ? 'Pago liquidado en Por Pagar' : 'Comprobante de pago adjuntado',
      detalle: `${estaPagada ? 'Cuenta marcada como PAGADA' : 'Comprobante cargado'}${rec?.metodo ? ` · Método: ${rec.metodo}` : ''}${rec?.referencia ? ` · Ref: ${rec.referencia}` : ''}${nComp > 0 ? ` · ${nComp} comprobante(s) adjunto(s)` : ''}.`,
      montoDespuesUsd: Number(cuenta?.monto || rec?.monto || 0) || null,
      reqId: req?.id || cuenta?.inventory_requirement_id || null,
      reqCode,
      cuentaId: cuenta?.id || null,
      empresaNombre: empresaNombre || null,
      proveedorNombre,
      solicitanteNombre,
      destinoTexto,
      areaTexto,
    });
  }

  // 8. Recepción y Despacho en Almacén
  if (req?.status === 'recibido' && req.received_at && !tieneTipo('recepcion_almacen')) {
    const idRec = `syn-rec-${req.id}`;
    mapaEventos.set(idRec, {
      id: idRec,
      at: req.received_at,
      by: (req as any).received_by_name || req.decided_by_name || 'Almacén',
      modulo: 'Almacén',
      tipo: 'recepcion_almacen',
      titulo: 'Recibido en Almacén',
      detalle: `Mercancía ingresada al inventario de almacén.`,
      reqId: req.id,
      reqCode,
      cuentaId: cuenta?.id || null,
      empresaNombre: empresaNombre || null,
      proveedorNombre,
      solicitanteNombre,
      destinoTexto,
      areaTexto,
    });
  }

  if (req) {
    const desp = extraerDespacho(req);
    if (desp && desp.estado === 'retirado' && !tieneTipo('despacho_almacen')) {
      const idDesp = `syn-desp-${req.id}`;
      mapaEventos.set(idDesp, {
        id: idDesp,
        at: desp.fecha || req.received_at || req.created_at,
        by: desp.despachadoPor || 'Almacén',
        modulo: 'Almacén',
        tipo: 'despacho_almacen',
        titulo: 'Retirado de Almacén / Entregado',
        detalle: `Retirado por ${desp.retiradoPor || 'Personal'}${desp.retiradoCedula ? ` (C.I. ${desp.retiradoCedula})` : ''}${desp.maquinariaCodigo ? ` · Máquina: ${desp.maquinariaCodigo}${desp.maquinariaPlaca ? ` [Placa: ${desp.maquinariaPlaca}]` : ''}` : ''}.`,
        reqId: req.id,
        reqCode,
        cuentaId: cuenta?.id || null,
        empresaNombre: empresaNombre || null,
        proveedorNombre,
        solicitanteNombre,
        destinoTexto,
        areaTexto,
      });
    }
  }

  // 9. Rechazo / Anulación
  if ((req?.status === 'rechazado' || cuenta?.estado === 'anulada') && !tieneTipo('rechazado_o_anulado')) {
    const idRech = `syn-rech-${req?.id || cuenta?.id}`;
    mapaEventos.set(idRech, {
      id: idRech,
      at: req?.decided_at || cuenta?.updated_at || req?.created_at || new Date().toISOString(),
      by: req?.decided_by_name || 'Gerencia / Compras',
      modulo: cuenta?.estado === 'anulada' ? 'Por Pagar' : 'Requerimientos',
      tipo: 'rechazado_o_anulado',
      titulo: cuenta?.estado === 'anulada' ? 'Cuenta por Pagar anulada' : 'Requerimiento rechazado',
      detalle: req?.decision_note || 'Marcado como anulado / rechazado.',
      reqId: req?.id || cuenta?.inventory_requirement_id || null,
      reqCode,
      cuentaId: cuenta?.id || null,
      empresaNombre: empresaNombre || null,
      proveedorNombre,
      solicitanteNombre,
      destinoTexto,
      areaTexto,
    });
  }

  return Array.from(mapaEventos.values()).sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );
}
