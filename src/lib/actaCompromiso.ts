// ACTA DE COMPROMISO Y ENTREGA DE HERRAMIENTAS / IMPLEMENTOS DE TRABAJO (04-nov-2026)
//
// Hermana de `src/lib/amonestacion.ts`, diseñada para el proceso de ingreso/entrevista
// o asignación de implementos de un trabajador, y asociada a su expediente.
//
// Incluye:
// - Tabla de herramientas, equipos e implementos entregados (o renglones en blanco
//   si se imprime como planilla física para llenar a mano en campo).
// - Cláusulas obligatorias:
//   1. Uso adecuado y exclusivo para las labores asignadas.
//   2. Cuidado, custodia, mantenimiento y reporte oportuno de fallas/desgaste.
//   3. Aceptación de responsabilidad y obligación de devolución.
//   4. Autorización expresa de deducción salarial en caso de daño o extravío
//      atribuible al trabajador.
// - Soporte de firma digital del trabajador y de quien entrega (incrustada en el
//   documento si se firmó en pantalla) o raya en blanco para firma manuscrita,
//   más casilla de testigo.

import { LOGO_DATA_URI } from './logoData';
import { COMPANY_NAME } from './company';
import { CommitmentToolItem, EstadoRetornoHerramienta, ResultadoRecepcionActa } from '../types/database';
import { leerNumero } from './numeros';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hoyLargo(): string {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export function fechaLargaActa(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return '';
  return `${d} de ${MESES[m - 1] ?? ''} de ${y}`;
}

function selloImpresion(): string {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const fecha = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  let h = d.getHours();
  const ampm = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12 || 12;
  return `${fecha}, ${p2(h)}:${p2(d.getMinutes())} ${ampm}`;
}

/** Herramientas e implementos sugeridos para agregar con un toque durante el ingreso. */
export const HERRAMIENTAS_SUGERIDAS: readonly { nombre: string; estado: string }[] = [
  { nombre: 'Casco de seguridad', estado: 'Nuevo / Operativo' },
  { nombre: 'Par de botas de seguridad', estado: 'Nuevo / Operativo' },
  { nombre: 'Chaleco reflectivo', estado: 'Nuevo / Operativo' },
  { nombre: 'Lentes de protección', estado: 'Nuevo / Operativo' },
  { nombre: 'Par de guantes de carnaza / seguridad', estado: 'Nuevo / Operativo' },
  { nombre: 'Protector auditivo', estado: 'Nuevo / Operativo' },
  { nombre: 'Impermeable / encauchado', estado: 'Operativo' },
  { nombre: 'Radio transmisor portátil con cargador', estado: 'Operativo' },
  { nombre: 'Juego de llaves combinadas', estado: 'Operativo' },
  { nombre: 'Juego de destornilladores', estado: 'Operativo' },
  { nombre: 'Alicate de presión / mecánico', estado: 'Operativo' },
  { nombre: 'Cinta métrica', estado: 'Operativo' },
  { nombre: 'Linterna de trabajo', estado: 'Operativo' },
  { nombre: 'Carnet de identificación corporativo', estado: 'Nuevo' },
];

export type ActaCompromisoData = {
  codigo?: string | null;
  fullName: string;
  cedula?: string | null;
  cargo?: string | null;
  department?: string | null;
  fichaNumber?: string | null;
  hireDate?: string | null;
  city?: string | null;
  state?: string | null;
  lugar?: string | null;
  fechaEntrega?: string | null; // ISO YYYY-MM-DD (o fecha de recepción en actas de recepción)
  items?: readonly CommitmentToolItem[] | null;
  clausulasAdicionales?: string | null;
  observaciones?: string | null;
  entregadoPor?: string | null;
  entregadoCargo?: string | null;
  testigoNombre?: string | null;
  testigoCedula?: string | null;
  firmaTrabajadorDataUri?: string | null;
  firmaEntregaDataUri?: string | null;
  mostrarLogo?: boolean;
  companyName?: string | null;
  logoDataUri?: string | null;
  // Campos específicos de Acta de Recepción / Devolución:
  tipoActa?: 'entrega' | 'recepcion' | null;
  actaOrigenCodigo?: string | null;
  fechaEntregaOrigen?: string | null;
  motivoRecepcion?: string | null;
  resultadoRecepcion?: ResultadoRecepcionActa | null;
  soporteUrl?: string | null;
};

/** Estados físicos en que puede regresar una herramienta o implemento al recibirlo de vuelta. */
export const ESTADOS_RETORNO_HERRAMIENTA: readonly {
  key: EstadoRetornoHerramienta;
  label: string;
  shortLabel: string;
  color: string;
  bg: string;
  requiereNovedad: boolean;
}[] = [
  { key: 'BUENO / OPERATIVO', label: '🟢 Bueno / Operativo', shortLabel: 'BUENO / OPERATIVO', color: '#15803D', bg: '#DCFCE7', requiereNovedad: false },
  { key: 'DESGASTE NORMAL', label: '🟡 Desgaste normal por uso', shortLabel: 'DESGASTE NORMAL', color: '#B45309', bg: '#FEF3C7', requiereNovedad: false },
  { key: 'INCOMPLETO', label: '🟠 Incompleto / Faltan piezas', shortLabel: 'INCOMPLETO', color: '#C2410C', bg: '#FFEDD5', requiereNovedad: true },
  { key: 'DAÑADO / AVERIADO', label: '🔴 Dañado / Averiado', shortLabel: 'DAÑADO / AVERIADO', color: '#B91C1C', bg: '#FEE2E2', requiereNovedad: true },
  { key: 'EXTRAVIADO / NO DEVUELTO', label: '⚫ Extraviado / No devuelto', shortLabel: 'EXTRAVIADO / NO DEVUELTO', color: '#7F1D1D', bg: '#FEE2E2', requiereNovedad: true },
];

/** Motivos frecuentes de recepción / devolución de herramientas e implementos. */
export const MOTIVOS_RECEPCION_ACTA: readonly string[] = [
  'Fin de relación laboral / Liquidación',
  'Cambio de cargo o departamento',
  'Cierre de jornada / Entrega de guardia',
  'Cambio por deterioro o reposición',
  'Vacaciones / Permiso / Reposo',
  'Auditoría / Control de almacén',
];

/** Normaliza el estado de retorno de una herramienta al catálogo oficial. */
export function normalizarEstadoRetorno(raw?: string | null): EstadoRetornoHerramienta {
  const up = String(raw ?? '').trim().toUpperCase();
  if (up.includes('EXTRAVI') || up.includes('NO DEVUELT') || up.includes('PERDID') || up.includes('NO ENTREG')) {
    return 'EXTRAVIADO / NO DEVUELTO';
  }
  if (up.includes('DAÑ') || up.includes('DANAD') || up.includes('AVERI') || up.includes('ROTO') || up.includes('MALO')) {
    return 'DAÑADO / AVERIADO';
  }
  if (up.includes('INCOMPLET') || up.includes('PARCIAL') || up.includes('FALTA')) {
    return 'INCOMPLETO';
  }
  if (up.includes('DESGASTE') || up.includes('REGULAR') || up.includes('USADO')) {
    return 'DESGASTE NORMAL';
  }
  return 'BUENO / OPERATIVO';
}

/** Genera un código correlativo legible para el acta de entrega: `AC-HER-2026-001`. */
export function generarCodigoActaCompromiso(secuencia = 1, fechaIso?: string | null): string {
  const year = fechaIso && /^\d{4}/.test(fechaIso) ? fechaIso.slice(0, 4) : String(new Date().getFullYear());
  const num = Math.max(1, Math.floor(Number(secuencia) || 1));
  return `AC-HER-${year}-${String(num).padStart(3, '0')}`;
}

/** Genera un código correlativo legible para el acta de recepción/devolución: `AR-HER-2026-001`. */
export function generarCodigoActaRecepcion(secuencia = 1, fechaIso?: string | null): string {
  const year = fechaIso && /^\d{4}/.test(fechaIso) ? fechaIso.slice(0, 4) : String(new Date().getFullYear());
  const num = Math.max(1, Math.floor(Number(secuencia) || 1));
  return `AR-HER-${year}-${String(num).padStart(3, '0')}`;
}

/** Detecta si un acta o conjunto de datos corresponde a un Acta de Recepción / Devolución. */
export function esActaRecepcion(
  input?: {
    codigo?: string | null;
    tipoActa?: string | null;
    tipo_acta?: string | null;
    items?: readonly Partial<CommitmentToolItem>[] | null;
  } | null
): boolean {
  if (!input) return false;
  if (input.tipoActa === 'recepcion' || input.tipo_acta === 'recepcion') return true;
  if (input.tipoActa === 'entrega' || input.tipo_acta === 'entrega') return false;
  const cod = String(input.codigo ?? '').trim().toUpperCase();
  if (cod.startsWith('AR-HER-') || cod.startsWith('AR-')) return true;
  if (Array.isArray(input.items) && input.items.some((it) => it?.tipo_acta === 'recepcion' || Boolean(it?.estado_retorno))) {
    return true;
  }
  return false;
}

/** Limpia y normaliza la lista de herramientas antes de guardar o imprimir. */
export function limpiarItemsActa(items?: readonly Partial<CommitmentToolItem>[] | null): CommitmentToolItem[] {
  if (!Array.isArray(items)) return [];
  const out: CommitmentToolItem[] = [];
  for (const it of items) {
    const nombre = String(it?.nombre ?? '').replace(/\s+/g, ' ').trim();
    if (!nombre) continue;
    const cantRaw = leerNumero(it?.cantidad ?? 1);
    const cantidad = cantRaw !== null && cantRaw > 0 ? cantRaw : 1;
    const serial = String(it?.serial ?? '').trim() || null;
    const estado = String(it?.estado ?? '').trim() || 'Operativo';
    const valRaw = it?.valor_usd != null && String(it.valor_usd).trim() !== '' ? leerNumero(it.valor_usd) : null;
    const valor_usd = valRaw != null && valRaw > 0 ? Math.round(valRaw * 100) / 100 : null;

    const clean: CommitmentToolItem = { nombre, cantidad, serial, estado, valor_usd };

    if (it?.cantidad_devuelta !== undefined && it?.cantidad_devuelta !== null && String(it.cantidad_devuelta).trim() !== '') {
      const devRaw = leerNumero(it.cantidad_devuelta);
      if (devRaw !== null && devRaw >= 0) {
        clean.cantidad_devuelta = devRaw;
      }
    }
    if (it?.estado_retorno !== undefined && it?.estado_retorno !== null && String(it.estado_retorno).trim() !== '') {
      clean.estado_retorno = normalizarEstadoRetorno(it.estado_retorno);
    }
    if (it?.observacion_retorno !== undefined && it?.observacion_retorno !== null && String(it.observacion_retorno).trim() !== '') {
      clean.observacion_retorno = String(it.observacion_retorno).replace(/\s+/g, ' ').trim();
    }
    if (it?.cargo_usd !== undefined && it?.cargo_usd !== null && String(it.cargo_usd).trim() !== '') {
      const cargoRaw = leerNumero(it.cargo_usd);
      if (cargoRaw !== null && cargoRaw >= 0) {
        clean.cargo_usd = Math.round(cargoRaw * 100) / 100;
      }
    }
    if (it?.tipo_acta === 'entrega' || it?.tipo_acta === 'recepcion') {
      clean.tipo_acta = it.tipo_acta;
    }
    if (it?.acta_origen_id && String(it.acta_origen_id).trim()) {
      clean.acta_origen_id = String(it.acta_origen_id).trim();
    }
    if (it?.acta_origen_codigo && String(it.acta_origen_codigo).trim()) {
      clean.acta_origen_codigo = String(it.acta_origen_codigo).trim();
    }
    if (it?.fecha_entrega_origen && String(it.fecha_entrega_origen).trim()) {
      clean.fecha_entrega_origen = String(it.fecha_entrega_origen).trim().slice(0, 10);
    }
    if (it?.motivo_recepcion && String(it.motivo_recepcion).trim()) {
      clean.motivo_recepcion = String(it.motivo_recepcion).trim();
    }
    if (it?.resultado_recepcion && ['CONFORME', 'CON_NOVEDAD', 'PARCIAL'].includes(String(it.resultado_recepcion))) {
      clean.resultado_recepcion = it.resultado_recepcion as ResultadoRecepcionActa;
    }
    if (it?.entregado_cargo && String(it.entregado_cargo).trim()) {
      clean.entregado_cargo = String(it.entregado_cargo).trim();
    }

    out.push(clean);
  }
  return out;
}

/** Suma el valor total de reposición en USD de los implementos que tengan valor declarado. */
export function totalValorReposicionUsd(items?: readonly Partial<CommitmentToolItem>[] | null): number {
  const limpios = limpiarItemsActa(items);
  let total = 0;
  for (const it of limpios) {
    if (it.valor_usd && it.valor_usd > 0) {
      total += (Number(it.cantidad) || 1) * it.valor_usd;
    }
  }
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

/** Calcula el cargo sugerido en USD para un ítem según su estado de retorno y unidades devueltas. */
export function calcularCargoSugeridoItem(it: {
  cantidad?: number | string | null;
  cantidad_devuelta?: number | string | null;
  estado_retorno?: string | null;
  valor_usd?: number | string | null;
}): number {
  const val = it.valor_usd != null && String(it.valor_usd).trim() !== '' ? leerNumero(it.valor_usd) : null;
  if (!val || val <= 0) return 0;
  const cant = Math.max(1, leerNumero(it.cantidad ?? 1) || 1);
  const devRaw = it.cantidad_devuelta != null && String(it.cantidad_devuelta).trim() !== '' ? leerNumero(it.cantidad_devuelta) : cant;
  const dev = devRaw != null && devRaw >= 0 ? devRaw : cant;
  const est = normalizarEstadoRetorno(it.estado_retorno);

  if (est === 'EXTRAVIADO / NO DEVUELTO') {
    const faltantes = dev <= 0 ? cant : Math.max(1, cant - dev);
    return Math.round((faltantes * val + Number.EPSILON) * 100) / 100;
  }
  if (est === 'DAÑADO / AVERIADO') {
    const afectadas = dev < cant ? cant : cant;
    return Math.round((afectadas * val + Number.EPSILON) * 100) / 100;
  }
  if (est === 'INCOMPLETO' || dev < cant) {
    const faltantes = Math.max(0, cant - dev);
    if (faltantes > 0) {
      return Math.round((faltantes * val + Number.EPSILON) * 100) / 100;
    }
  }
  return 0;
}

/** Suma el total de cargos por daño, faltante o extravío en un Acta de Recepción (en USD). */
export function totalCargoReposicionUsd(items?: readonly Partial<CommitmentToolItem>[] | null): number {
  const limpios = limpiarItemsActa(items);
  let total = 0;
  for (const it of limpios) {
    if (it.cargo_usd != null && it.cargo_usd > 0) {
      total += it.cargo_usd;
    }
  }
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

/** Resume cuántos renglones regresaron en cada estado y cuántas unidades se devolvieron vs entregaron. */
export function resumenEstadosRetorno(items?: readonly Partial<CommitmentToolItem>[] | null): {
  buenos: number;
  desgaste: number;
  incompletos: number;
  danados: number;
  extraviados: number;
  totalEntregados: number;
  totalDevueltos: number;
} {
  const limpios = limpiarItemsActa(items);
  let buenos = 0;
  let desgaste = 0;
  let incompletos = 0;
  let danados = 0;
  let extraviados = 0;
  let totalEntregados = 0;
  let totalDevueltos = 0;

  for (const it of limpios) {
    const cant = Number(it.cantidad) || 1;
    const est = normalizarEstadoRetorno(it.estado_retorno);
    const dev =
      it.cantidad_devuelta !== undefined && it.cantidad_devuelta !== null
        ? Number(it.cantidad_devuelta)
        : est === 'EXTRAVIADO / NO DEVUELTO'
          ? 0
          : cant;
    totalEntregados += cant;
    totalDevueltos += Math.max(0, dev);

    if (est === 'EXTRAVIADO / NO DEVUELTO') extraviados++;
    else if (est === 'DAÑADO / AVERIADO') danados++;
    else if (est === 'INCOMPLETO') incompletos++;
    else if (est === 'DESGASTE NORMAL') desgaste++;
    else buenos++;
  }

  return { buenos, desgaste, incompletos, danados, extraviados, totalEntregados, totalDevueltos };
}

/** Evalúa automáticamente el resultado global de la recepción según el estado de cada ítem. */
export function evaluarResultadoRecepcion(items?: readonly Partial<CommitmentToolItem>[] | null): ResultadoRecepcionActa {
  const limpios = limpiarItemsActa(items);
  if (limpios.length === 0) return 'CONFORME';
  const res = resumenEstadosRetorno(limpios);
  const cargos = totalCargoReposicionUsd(limpios);
  if (res.danados > 0 || res.extraviados > 0 || res.incompletos > 0 || cargos > 0) {
    return 'CON_NOVEDAD';
  }
  if (res.totalDevueltos < res.totalEntregados) {
    return 'PARCIAL';
  }
  return 'CONFORME';
}

/** Convierte los ítems de un Acta de Entrega en ítems listos para inspeccionar su recepción/devolución. */
export function prepararItemsParaRecepcion(itemsEntrega?: readonly Partial<CommitmentToolItem>[] | null): CommitmentToolItem[] {
  const limpios = limpiarItemsActa(itemsEntrega);
  return limpios.map((it) => ({
    nombre: it.nombre,
    cantidad: it.cantidad,
    cantidad_devuelta: it.cantidad,
    serial: it.serial || null,
    estado: it.estado || 'Operativo',
    estado_retorno: 'BUENO / OPERATIVO',
    observacion_retorno: null,
    valor_usd: it.valor_usd ?? null,
    cargo_usd: null,
    tipo_acta: 'recepcion',
  }));
}

/**
 * Genera el HTML imprimible / firmable del Acta de Compromiso y Entrega de Herramientas.
 * Cabe en una (1) hoja tamaño carta para uso normal.
 */
export function actaCompromisoHtml(d: ActaCompromisoData): string {
  if (esActaRecepcion(d)) {
    return actaRecepcionHerramientasHtml(d);
  }
  const linea = '________________________';
  const nombre = esc(d.fullName || linea);
  const ci = esc(d.cedula || linea);
  const cargo = esc(d.cargo || linea);
  const empresa = String(d.companyName ?? '').trim() || 'SOS LA GUAIRA';
  const lugar = esc(String(d.lugar ?? '').trim() || [d.city, d.state].filter(Boolean).join(', ') || 'La Guaira, Venezuela');
  const fechaTexto = esc(fechaLargaActa(d.fechaEntrega) || hoyLargo());
  const impreso = esc(selloImpresion());
  const codigo = esc(String(d.codigo ?? '').trim() || generarCodigoActaCompromiso(1, d.fechaEntrega));
  const logoSrc = d.logoDataUri !== undefined ? d.logoDataUri : LOGO_DATA_URI;

  const filaOpc = (et: string, v?: string | null) =>
    String(v ?? '').trim() ? `<tr><th>${esc(et)}</th><td>${esc(String(v).trim())}</td></tr>` : '';

  const itemsLimpios = limpiarItemsActa(d.items);
  const hayValores = itemsLimpios.some((x) => x.valor_usd != null && x.valor_usd > 0);
  const totalRepo = totalValorReposicionUsd(itemsLimpios);

  let tablaHerramientasHtml = '';
  if (itemsLimpios.length > 0) {
    const filas = itemsLimpios
      .map((it, idx) => {
        const valCell = hayValores
          ? `<td class="r">${it.valor_usd ? `$${it.valor_usd.toFixed(2)}` : '—'}</td>`
          : '';
        return `<tr>
          <td class="c">${idx + 1}</td>
          <td><b>${esc(it.nombre)}</b></td>
          <td class="c">${esc(it.cantidad)}</td>
          <td>${esc(it.serial || '—')}</td>
          <td>${esc(it.estado || 'Operativo')}</td>
          ${valCell}
        </tr>`;
      })
      .join('');
    const pieTotal = hayValores
      ? `<tfoot><tr><td colspan="5" class="r"><b>VALOR TOTAL ESTIMADO DE REPOSICIÓN (USD)</b></td><td class="r"><b>$${totalRepo.toFixed(2)}</b></td></tr></tfoot>`
      : '';
    tablaHerramientasHtml = `
      <table class="tools">
        <thead>
          <tr>
            <th class="c" style="width:28px">#</th>
            <th>Herramienta / Implemento / Equipo</th>
            <th class="c" style="width:52px">Cant.</th>
            <th style="width:120px">Serial / Marca / Talla</th>
            <th style="width:110px">Estado de entrega</th>
            ${hayValores ? '<th class="r" style="width:82px">Valor Unit.</th>' : ''}
          </tr>
        </thead>
        <tbody>${filas}</tbody>
        ${pieTotal}
      </table>`;
  } else {
    // Planilla en blanco para llenar a mano en entrevista/campo
    const filasBlanco = [1, 2, 3, 4, 5]
      .map(
        (n) => `<tr>
          <td class="c">${n}</td>
          <td style="height:20px"></td>
          <td class="c"></td>
          <td></td>
          <td></td>
        </tr>`
      )
      .join('');
    tablaHerramientasHtml = `
      <table class="tools">
        <thead>
          <tr>
            <th class="c" style="width:28px">#</th>
            <th>Herramienta / Implemento / Equipo</th>
            <th class="c" style="width:52px">Cant.</th>
            <th style="width:130px">Serial / Marca / Talla</th>
            <th style="width:115px">Estado de entrega</th>
          </tr>
        </thead>
        <tbody>${filasBlanco}</tbody>
      </table>`;
  }

  const obs = String(d.observaciones ?? '').trim();
  const bloqueObs = obs
    ? `<div class="texto">${esc(obs).replace(/\n/g, '<br/>')}</div>`
    : `<div class="renglones"><span></span><span></span></div>`;

  const entregadoPor = esc(String(d.entregadoPor ?? '').trim());
  const entregadoCargo = esc(String(d.entregadoCargo ?? '').trim() || 'Almacén / Seguridad / RRHH');
  const testigoNombre = esc(String(d.testigoNombre ?? '').trim());
  const testigoCedula = esc(String(d.testigoCedula ?? '').trim());
  const testigoPie = testigoCedula ? `C.I. ${testigoCedula}` : 'C.I.';

  const firmaTrabImg = d.firmaTrabajadorDataUri
    ? `<div class="sig-img-wrap"><img src="${esc(d.firmaTrabajadorDataUri)}" class="sig-img" alt="Firma trabajador"/></div>`
    : `<div class="sig-space"></div>`;
  const firmaEntImg = d.firmaEntregaDataUri
    ? `<div class="sig-img-wrap"><img src="${esc(d.firmaEntregaDataUri)}" class="sig-img" alt="Firma entrega"/></div>`
    : `<div class="sig-space"></div>`;

  const mostrarLogo = d.mostrarLogo !== false;

  return `<!doctype html><html><head><meta charset="utf-8"/><title>Acta de Compromiso - ${nombre}</title>
  <style>
    @page{ margin:1.6cm 1.8cm; size:letter }
    *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact }
    html,body{ margin:0; padding:0 }
    body{ font-family:Tahoma, Geneva, Verdana, sans-serif; color:#1a1a1a; font-size:9.3pt; line-height:1.35; display:flex; flex-direction:column; min-height:100vh }
    @media screen{ body{ padding:18px 26px; background:#fff } }
    .head{ display:flex; align-items:center; justify-content:space-between; border-bottom:2.5px solid #1E3A5F; padding-bottom:6px; margin-bottom:8px }
    .head-left{ display:flex; align-items:center; gap:10px }
    .head img{ height:42px; width:auto }
    .head .co{ color:#1E3A5F; font-weight:800; font-size:10pt; letter-spacing:.2px }
    .head .cod{ background:#EEF2F7; border:1px solid #CBD5E1; border-radius:4px; padding:3px 8px; font-size:8.5pt; font-weight:800; color:#1E3A5F }
    h1{ font-size:12.5pt; text-align:center; color:#1E3A5F; margin:3px 0 1px; text-transform:uppercase; letter-spacing:.8px }
    .sub{ text-align:center; font-weight:700; color:#475569; font-size:8.8pt; text-transform:uppercase; letter-spacing:.4px; margin-bottom:6px }
    p{ text-align:justify; margin:5px 0 }
    .fill{ font-weight:700 }
    table.datos{ width:100%; border-collapse:collapse; margin:6px 0; font-size:9pt }
    table.datos th, table.datos td{ border:1px solid #CBD5E1; padding:3px 7px; text-align:left; vertical-align:middle }
    table.datos th{ background:#F1F5F9; color:#1E3A5F; width:28%; font-weight:700 }
    .bloque{ margin:6px 0 }
    .bt{ background:#1E3A5F; color:#fff; font-weight:700; font-size:8.8pt; text-transform:uppercase; letter-spacing:.4px; padding:3px 7px }
    .bc{ border:1px solid #CBD5E1; border-top:0; padding:6px }
    table.tools{ width:100%; border-collapse:collapse; font-size:8.8pt; margin:0 }
    table.tools th{ background:#1E3A5F; color:#fff; padding:4px 6px; text-align:left; font-weight:700; border:1px solid #1E3A5F }
    table.tools td{ border:1px solid #CBD5E1; padding:4px 6px; vertical-align:middle }
    table.tools tbody tr:nth-child(even) td{ background:#F8FAFC }
    table.tools tfoot td{ background:#EEF2F7; border:1px solid #1E3A5F; padding:4px 6px; color:#1E3A5F }
    .c{ text-align:center }
    .r{ text-align:right; font-variant-numeric:tabular-nums }
    .clausulas{ border:1px solid #CBD5E1; border-left:4px solid #1E3A5F; background:#F8FAFC; padding:6px 9px; margin:6px 0; font-size:8.6pt; line-height:1.34 }
    .clausulas ol{ margin:3px 0 0 16px; padding:0 }
    .clausulas li{ margin-bottom:3.5px; text-align:justify }
    .texto{ text-align:justify; white-space:normal }
    .renglones span{ display:block; border-bottom:1px solid #CBD5E1; height:16px }
    .renglones span:last-child{ border-bottom:0 }
    .cierre{ margin-top:5px; font-size:8.8pt }
    .sign-block{ margin-top:auto; padding-top:12px }
    table.firmas{ width:100%; border-collapse:collapse }
    table.firmas td{ width:33.33%; text-align:center; vertical-align:bottom; padding:0 6px }
    .sig-space{ height:42px }
    .sig-img-wrap{ height:42px; display:flex; align-items:flex-end; justify-content:center; padding-bottom:2px }
    .sig-img{ max-height:40px; max-width:150px; object-fit:contain }
    table.firmas .line{ border-top:1px solid #1a1a1a; padding-top:4px }
    table.firmas .rol{ font-weight:700; color:#1E3A5F; font-size:8.8pt; text-transform:uppercase; letter-spacing:.3px }
    table.firmas .nom{ color:#333; font-size:8.8pt; margin-top:1px }
    table.firmas .ci{ color:#777; font-size:8pt; margin-top:1px }
    .huella-box{ display:inline-block; width:46px; height:54px; border:1px dashed #64748B; border-radius:4px; margin-top:4px; font-size:7pt; color:#64748B; line-height:52px; text-align:center }
    .foot{ margin-top:8px; text-align:center; color:#9aa4b2; font-size:7.8pt; border-top:1px solid #e5e7eb; padding-top:4px }
  </style></head><body>
    <div class="head">
      <div class="head-left">
        ${mostrarLogo && logoSrc ? `<img src="${logoSrc}"/>` : ''}
        <div class="co">${esc(empresa)}</div>
      </div>
      <div class="cod">ACTA N.° ${codigo}</div>
    </div>

    <h1>Acta de Compromiso y Entrega de Herramientas</h1>
    <div class="sub">Asignación de Equipos, Implementos de Trabajo y Protección Personal</div>

    <table class="datos">
      <tr><th>Trabajador(a)</th><td><b>${nombre}</b></td></tr>
      <tr><th>Cédula de identidad</th><td>${ci}</td></tr>
      <tr><th>Cargo</th><td>${cargo}</td></tr>
      ${filaOpc('Departamento', d.department)}
      ${filaOpc('N.° de ficha', d.fichaNumber)}
      ${filaOpc('Fecha de ingreso', fechaLargaActa(d.hireDate))}
      <tr><th>Fecha de entrega</th><td>${fechaTexto}</td></tr>
    </table>

    <p>Por medio de la presente se deja constancia de que <span class="fill">${esc(empresa)}</span> hace entrega formal al trabajador(a) arriba identificado(a) de los implementos, equipos y/o herramientas de trabajo descritos a continuación, en buenas condiciones operativas:</p>

    <div class="bloque">
      <div class="bt">Detalle de herramientas e implementos entregados</div>
      ${tablaHerramientasHtml}
    </div>

    <div class="clausulas">
      <b>CLÁUSULAS DE COMPROMISO, CUSTODIA Y RESPONSABILIDAD:</b>
      <ol>
        <li><b>Uso adecuado y exclusivo:</b> El trabajador(a) se compromete a utilizar las herramientas, equipos e implementos recibidos única y exclusivamente para el desempeño de las funciones inherentes a su cargo dentro de <span class="fill">${esc(empresa)}</span>, cumpliendo las normas operativas y de seguridad industrial.</li>
        <li><b>Cuidado, guarda y mantenimiento:</b> El trabajador(a) asume la custodia directa de los implementos entregados, obligándose a velar por su buen estado de conservación y a reportar de inmediato a su supervisor o al área de Almacén cualquier falla técnica o deterioro por uso normal.</li>
        <li><b>Aceptación de responsabilidad y devolución:</b> Los equipos e implementos detallados son propiedad exclusiva de la empresa. El trabajador(a) se obliga a presentarlos para auditoría cuando le sea requerido y a devolverlos íntegramente al cambiar de funciones o al finalizar la relación laboral.</li>
        <li><b>Autorización de deducción salarial por daño o extravío:</b> En caso de pérdida, extravío, hurto por descuido o daño atribuible a negligencia, mal uso o dolo del trabajador(a), éste(a) asume la responsabilidad de su reposición y <b>autoriza expresamente a la empresa a efectuar el descuento o deducción salarial</b> correspondiente al costo de reposición sobre sus pagos de nómina, bonificaciones y/o liquidación final, conforme a la normativa laboral vigente.</li>
      </ol>
    </div>

    <div class="bloque">
      <div class="bt">Observaciones adicionales / Estado de recepción</div>
      <div class="bc">${bloqueObs}</div>
    </div>

    <p class="cierre">Leído el presente documento y conforme con todas sus cláusulas, se suscribe en ${lugar}, a la fecha ${fechaTexto}, en dos (2) ejemplares de un mismo tenor y a un solo efecto: uno para el expediente laboral y otro para el trabajador(a).</p>

    <div class="sign-block">
      <table class="firmas"><tr>
        <td>
          ${firmaTrabImg}
          <div class="line">
            <div class="rol">Recibí conforme — Trabajador(a)</div>
            <div class="nom">${nombre}</div>
            <div class="ci">C.I. ${ci} · Firma y huella</div>
          </div>
        </td>
        <td>
          ${firmaEntImg}
          <div class="line">
            <div class="rol">Entregado por</div>
            <div class="nom">${entregadoPor || '&nbsp;'}</div>
            <div class="ci">${entregadoCargo}</div>
          </div>
        </td>
        <td>
          <div class="sig-space"></div>
          <div class="line">
            <div class="rol">Testigo / RRHH</div>
            <div class="nom">${testigoNombre || '&nbsp;'}</div>
            <div class="ci">${testigoPie}</div>
          </div>
        </td>
      </tr></table>
    </div>

    <div class="foot">${esc(COMPANY_NAME)} · Expediente Laboral · Impreso el ${impreso}</div>
  </body></html>`;
}

function badgeEstadoRetornoHtml(estado?: string | null): string {
  const norm = normalizarEstadoRetorno(estado);
  const meta = ESTADOS_RETORNO_HERRAMIENTA.find((e) => e.key === norm) || ESTADOS_RETORNO_HERRAMIENTA[0];
  return `<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-weight:800;font-size:7.8pt;background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}44;">${esc(meta.shortLabel)}</span>`;
}

/**
 * Genera el HTML imprimible / firmable del Acta de Recepción y Devolución de Herramientas.
 * Deja constancia formal de los implementos que el trabajador devuelve, la cantidad devuelta,
 * el estado físico en que regresó cada uno, observaciones por renglón, solvencia (Paz y Salvo
 * o novedad) y eventuales cargos por daño o extravío.
 */
export function actaRecepcionHerramientasHtml(d: ActaCompromisoData): string {
  const linea = '________________________';
  const nombre = esc(d.fullName || linea);
  const ci = esc(d.cedula || linea);
  const cargo = esc(d.cargo || linea);
  const empresa = String(d.companyName ?? '').trim() || 'SOS LA GUAIRA';
  const lugar = esc(String(d.lugar ?? '').trim() || [d.city, d.state].filter(Boolean).join(', ') || 'La Guaira, Venezuela');
  const fechaTexto = esc(fechaLargaActa(d.fechaEntrega) || hoyLargo());
  const impreso = esc(selloImpresion());
  const codigo = esc(String(d.codigo ?? '').trim() || generarCodigoActaRecepcion(1, d.fechaEntrega));
  const logoSrc = d.logoDataUri !== undefined ? d.logoDataUri : LOGO_DATA_URI;

  const itemsLimpios = limpiarItemsActa(d.items);
  const primerItem = itemsLimpios[0];
  const actaOrigenCodigo = String(d.actaOrigenCodigo ?? primerItem?.acta_origen_codigo ?? '').trim();
  const fechaEntregaOrigen = String(d.fechaEntregaOrigen ?? primerItem?.fecha_entrega_origen ?? '').trim();
  const motivoRecepcion = String(d.motivoRecepcion ?? primerItem?.motivo_recepcion ?? '').trim();
  const resultado: ResultadoRecepcionActa =
    d.resultadoRecepcion || primerItem?.resultado_recepcion || evaluarResultadoRecepcion(itemsLimpios);

  const filaOpc = (et: string, v?: string | null) =>
    String(v ?? '').trim() ? `<tr><th>${esc(et)}</th><td>${esc(String(v).trim())}</td></tr>` : '';

  const origenTexto = actaOrigenCodigo
    ? `${actaOrigenCodigo}${fechaEntregaOrigen ? ` (${fechaLargaActa(fechaEntregaOrigen) || fechaEntregaOrigen})` : ''}`
    : '';

  const hayCargos = itemsLimpios.some((x) => (x.cargo_usd != null && x.cargo_usd > 0) || (x.valor_usd != null && x.valor_usd > 0));
  const totalCargos = totalCargoReposicionUsd(itemsLimpios);
  const resumen = resumenEstadosRetorno(itemsLimpios);

  let badgeSolvenciaHtml = '';
  if (resultado === 'CONFORME') {
    badgeSolvenciaHtml = `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-weight:800;font-size:8.4pt;background:#DCFCE7;color:#15803D;border:1px solid #86EFAC;">✓ CONFORME / PAZ Y SALVO (SIN CARGOS PENDIENTES)</span>`;
  } else if (resultado === 'PARCIAL') {
    badgeSolvenciaHtml = `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-weight:800;font-size:8.4pt;background:#FEF3C7;color:#B45309;border:1px solid #FCD34D;">⏳ DEVOLUCIÓN PARCIAL (PENDIENTE POR COMPLETAR)</span>`;
  } else {
    badgeSolvenciaHtml = `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-weight:800;font-size:8.4pt;background:#FEE2E2;color:#B91C1C;border:1px solid #FCA5A5;">⚠️ RECEPCIÓN CON NOVEDAD (DAÑO, INCOMPLETO O EXTRAVÍO)</span>`;
  }

  let tablaRecepcionHtml = '';
  if (itemsLimpios.length > 0) {
    const filas = itemsLimpios
      .map((it, idx) => {
        const cantEnt = Number(it.cantidad) || 1;
        const estRet = normalizarEstadoRetorno(it.estado_retorno);
        const cantDev =
          it.cantidad_devuelta !== undefined && it.cantidad_devuelta !== null
            ? Number(it.cantidad_devuelta)
            : estRet === 'EXTRAVIADO / NO DEVUELTO'
              ? 0
              : cantEnt;
        const obsRet = String(it.observacion_retorno ?? '').trim() || 'Sin novedad';
        const cargoCell = hayCargos
          ? `<td class="r">${it.cargo_usd && it.cargo_usd > 0 ? `<b style="color:#B91C1C">$${it.cargo_usd.toFixed(2)}</b>` : '$0.00'}</td>`
          : '';
        return `<tr>
          <td class="c">${idx + 1}</td>
          <td><b>${esc(it.nombre)}</b></td>
          <td>${esc(it.serial || '—')}</td>
          <td class="c">${esc(cantEnt)}</td>
          <td class="c"><b>${esc(cantDev)}</b></td>
          <td>${esc(it.estado || 'Operativo')}</td>
          <td>${badgeEstadoRetornoHtml(estRet)}</td>
          <td>${esc(obsRet)}</td>
          ${cargoCell}
        </tr>`;
      })
      .join('');
    const pieTotal = hayCargos
      ? `<tfoot><tr><td colspan="8" class="r"><b>TOTAL CARGO POR DAÑO / FALTANTE / REPOSICIÓN (USD)</b></td><td class="r"><b>$${totalCargos.toFixed(2)}</b></td></tr></tfoot>`
      : '';
    tablaRecepcionHtml = `
      <table class="tools">
        <thead>
          <tr>
            <th class="c" style="width:24px">#</th>
            <th>Herramienta / Implemento / Equipo</th>
            <th style="width:95px">Serial / Marca</th>
            <th class="c" style="width:52px">Entreg.</th>
            <th class="c" style="width:52px">Devuelto</th>
            <th style="width:76px">Est. Inicial</th>
            <th style="width:125px">Estado en que regresó</th>
            <th>Observación / Estado físico al recibir</th>
            ${hayCargos ? '<th class="r" style="width:70px">Cargo ($)</th>' : ''}
          </tr>
        </thead>
        <tbody>${filas}</tbody>
        ${pieTotal}
      </table>`;
  } else {
    // Planilla en blanco de recepción para llenar a mano en campo/almacén
    const filasBlanco = [1, 2, 3, 4, 5]
      .map(
        (n) => `<tr>
          <td class="c">${n}</td>
          <td style="height:22px"></td>
          <td></td>
          <td class="c"></td>
          <td class="c"></td>
          <td></td>
          <td></td>
        </tr>`
      )
      .join('');
    tablaRecepcionHtml = `
      <table class="tools">
        <thead>
          <tr>
            <th class="c" style="width:24px">#</th>
            <th>Herramienta / Implemento / Equipo</th>
            <th style="width:105px">Serial / Marca</th>
            <th class="c" style="width:52px">Entreg.</th>
            <th class="c" style="width:55px">Devuelto</th>
            <th style="width:135px">Estado en que regresó</th>
            <th>Observación / Diagnóstico de recepción</th>
          </tr>
        </thead>
        <tbody>${filasBlanco}</tbody>
      </table>`;
  }

  const obs = String(d.observaciones ?? '').trim();
  const bloqueObs = obs
    ? `<div class="texto">${esc(obs).replace(/\n/g, '<br/>')}</div>`
    : `<div class="renglones"><span></span><span></span></div>`;

  const recibidoPor = esc(String(d.entregadoPor ?? '').trim());
  const recibidoCargo = esc(String(d.entregadoCargo ?? primerItem?.entregado_cargo ?? '').trim() || 'Almacén / Seguridad / RRHH');
  const testigoNombre = esc(String(d.testigoNombre ?? '').trim());
  const testigoCedula = esc(String(d.testigoCedula ?? '').trim());
  const testigoPie = testigoCedula ? `C.I. ${testigoCedula}` : 'C.I.';

  const firmaTrabImg = d.firmaTrabajadorDataUri
    ? `<div class="sig-img-wrap"><img src="${esc(d.firmaTrabajadorDataUri)}" class="sig-img" alt="Firma trabajador"/></div>`
    : `<div class="sig-space"></div>`;
  const firmaRecImg = d.firmaEntregaDataUri
    ? `<div class="sig-img-wrap"><img src="${esc(d.firmaEntregaDataUri)}" class="sig-img" alt="Firma receptor"/></div>`
    : `<div class="sig-space"></div>`;

  const mostrarLogo = d.mostrarLogo !== false;

  const resumenConteoHtml =
    itemsLimpios.length > 0
      ? `<div style="margin-top:4px;font-size:8.2pt;color:#334155;">
          <b>Resumen de inspección:</b> ${resumen.totalDevueltos} de ${resumen.totalEntregados} und. devueltas ·
          🟢 Buenos/Operativos: <b>${resumen.buenos}</b> ·
          🟡 Desgaste normal: <b>${resumen.desgaste}</b> ·
          🟠 Incompletos: <b>${resumen.incompletos}</b> ·
          🔴 Dañados: <b>${resumen.danados}</b> ·
          ⚫ Extraviados/No devueltos: <b>${resumen.extraviados}</b>
        </div>`
      : '';

  return `<!doctype html><html><head><meta charset="utf-8"/><title>Acta de Recepción de Herramientas - ${nombre}</title>
  <style>
    @page{ margin:1.6cm 1.8cm; size:letter }
    *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact }
    html,body{ margin:0; padding:0 }
    body{ font-family:Tahoma, Geneva, Verdana, sans-serif; color:#1a1a1a; font-size:9.2pt; line-height:1.34; display:flex; flex-direction:column; min-height:100vh }
    @media screen{ body{ padding:18px 26px; background:#fff } }
    .head{ display:flex; align-items:center; justify-content:space-between; border-bottom:2.5px solid #0F766E; padding-bottom:6px; margin-bottom:8px }
    .head-left{ display:flex; align-items:center; gap:10px }
    .head img{ height:42px; width:auto }
    .head .co{ color:#0F766E; font-weight:800; font-size:10pt; letter-spacing:.2px }
    .head .cod{ background:#F0FDFA; border:1px solid #99F6E4; border-radius:4px; padding:3px 8px; font-size:8.5pt; font-weight:800; color:#0F766E }
    h1{ font-size:12.4pt; text-align:center; color:#0F766E; margin:3px 0 1px; text-transform:uppercase; letter-spacing:.7px }
    .sub{ text-align:center; font-weight:700; color:#475569; font-size:8.6pt; text-transform:uppercase; letter-spacing:.4px; margin-bottom:6px }
    p{ text-align:justify; margin:5px 0 }
    .fill{ font-weight:700 }
    table.datos{ width:100%; border-collapse:collapse; margin:6px 0; font-size:8.9pt }
    table.datos th, table.datos td{ border:1px solid #CBD5E1; padding:3px 7px; text-align:left; vertical-align:middle }
    table.datos th{ background:#F0FDFA; color:#0F766E; width:28%; font-weight:700 }
    .bloque{ margin:6px 0 }
    .bt{ background:#0F766E; color:#fff; font-weight:700; font-size:8.7pt; text-transform:uppercase; letter-spacing:.4px; padding:3px 7px }
    .bc{ border:1px solid #CBD5E1; border-top:0; padding:6px }
    table.tools{ width:100%; border-collapse:collapse; font-size:8.5pt; margin:0 }
    table.tools th{ background:#0F766E; color:#fff; padding:4px 5px; text-align:left; font-weight:700; border:1px solid #0F766E }
    table.tools td{ border:1px solid #CBD5E1; padding:4px 5px; vertical-align:middle }
    table.tools tbody tr:nth-child(even) td{ background:#F8FAFC }
    table.tools tfoot td{ background:#F0FDFA; border:1px solid #0F766E; padding:4px 5px; color:#0F766E }
    .c{ text-align:center }
    .r{ text-align:right; font-variant-numeric:tabular-nums }
    .clausulas{ border:1px solid #CBD5E1; border-left:4px solid #0F766E; background:#F8FAFC; padding:6px 9px; margin:6px 0; font-size:8.5pt; line-height:1.33 }
    .clausulas ol{ margin:3px 0 0 16px; padding:0 }
    .clausulas li{ margin-bottom:3px; text-align:justify }
    .texto{ text-align:justify; white-space:normal }
    .renglones span{ display:block; border-bottom:1px solid #CBD5E1; height:16px }
    .renglones span:last-child{ border-bottom:0 }
    .cierre{ margin-top:5px; font-size:8.7pt }
    .sign-block{ margin-top:auto; padding-top:12px }
    table.firmas{ width:100%; border-collapse:collapse }
    table.firmas td{ width:33.33%; text-align:center; vertical-align:bottom; padding:0 6px }
    .sig-space{ height:42px }
    .sig-img-wrap{ height:42px; display:flex; align-items:flex-end; justify-content:center; padding-bottom:2px }
    .sig-img{ max-height:40px; max-width:150px; object-fit:contain }
    table.firmas .line{ border-top:1px solid #1a1a1a; padding-top:4px }
    table.firmas .rol{ font-weight:700; color:#0F766E; font-size:8.7pt; text-transform:uppercase; letter-spacing:.3px }
    table.firmas .nom{ color:#333; font-size:8.8pt; margin-top:1px }
    table.firmas .ci{ color:#777; font-size:8pt; margin-top:1px }
    .foot{ margin-top:8px; text-align:center; color:#9aa4b2; font-size:7.8pt; border-top:1px solid #e5e7eb; padding-top:4px }
  </style></head><body>
    <div class="head">
      <div class="head-left">
        ${mostrarLogo && logoSrc ? `<img src="${logoSrc}"/>` : ''}
        <div class="co">${esc(empresa)}</div>
      </div>
      <div class="cod">ACTA RECEPCIÓN N.° ${codigo}</div>
    </div>

    <h1>Acta de Recepción y Devolución de Herramientas</h1>
    <div class="sub">Control de Retorno, Estado Físico de Recepción y Solvencia de Implementos Asignados</div>

    <table class="datos">
      <tr><th>Trabajador(a) que devuelve</th><td><b>${nombre}</b></td></tr>
      <tr><th>Cédula de identidad</th><td>${ci}</td></tr>
      <tr><th>Cargo</th><td>${cargo}</td></tr>
      ${filaOpc('Departamento', d.department)}
      ${filaOpc('N.° de ficha', d.fichaNumber)}
      <tr><th>Fecha de recepción</th><td>${fechaTexto}</td></tr>
      ${filaOpc('Motivo de devolución / recepción', motivoRecepcion)}
      ${filaOpc('Acta de entrega de referencia', origenTexto)}
      ${itemsLimpios.length > 0 ? `<tr><th>Resultado / Estatus de solvencia</th><td>${badgeSolvenciaHtml}</td></tr>` : ''}
    </table>

    <p>Por medio de la presente se deja constancia de que <span class="fill">${esc(empresa)}</span> recibe de parte del trabajador(a) arriba identificado(a) las herramientas, equipos y/o implementos de trabajo detallados a continuación, habiéndose verificado físicamente la cantidad devuelta y el estado en que regresa cada uno:</p>

    <div class="bloque">
      <div class="bt">Detalle de herramientas e implementos recibidos y estado en que regresaron</div>
      ${tablaRecepcionHtml}
      ${resumenConteoHtml}
    </div>

    <div class="clausulas">
      <b>CONSTANCIA DE INSPECCIÓN FÍSICA, RECEPCIÓN Y SOLVENCIA:</b>
      <ol>
        <li><b>Verificación del estado de retorno:</b> Las partes declaran que los equipos, herramientas e implementos listados fueron revisados físicamente en este acto, asentándose en la columna <i>«Estado en que regresó»</i> la condición real verificada al momento de la devolución.</li>
        <li><b>Liberación de custodia (Paz y Salvo):</b> El trabajador(a) queda liberado(a) del compromiso de custodia respecto a los ítems efectivamente devueltos y recibidos bajo condición <b>Bueno / Operativo</b> o con <b>Desgaste normal por uso</b>.</li>
        <li><b>Tratamiento de daños, faltantes o extravíos:</b> En caso de asentarse implementos con estado <b>Incompleto</b>, <b>Dañado / Averiado</b> por mal uso o <b>Extraviado / No devuelto</b>, queda registrada la novedad y, de corresponder, el cargo de reposición conforme a la autorización suscrita en el Acta de Compromiso y Entrega.</li>
      </ol>
    </div>

    <div class="bloque">
      <div class="bt">Observaciones generales de la recepción / Novedades adicionales</div>
      <div class="bc">${bloqueObs}</div>
    </div>

    <p class="cierre">En señal de conformidad con la revisión física y el estado de recepción asentado, firman las partes en ${lugar}, a la fecha ${fechaTexto}, en dos (2) ejemplares de un mismo tenor: uno para el expediente laboral y otro para el trabajador(a).</p>

    <div class="sign-block">
      <table class="firmas"><tr>
        <td>
          ${firmaTrabImg}
          <div class="line">
            <div class="rol">Entregado por — Trabajador(a)</div>
            <div class="nom">${nombre}</div>
            <div class="ci">C.I. ${ci} · Firma y huella</div>
          </div>
        </td>
        <td>
          ${firmaRecImg}
          <div class="line">
            <div class="rol">Recibido conforme por</div>
            <div class="nom">${recibidoPor || '&nbsp;'}</div>
            <div class="ci">${recibidoCargo}</div>
          </div>
        </td>
        <td>
          <div class="sig-space"></div>
          <div class="line">
            <div class="rol">Testigo / RRHH</div>
            <div class="nom">${testigoNombre || '&nbsp;'}</div>
            <div class="ci">${testigoPie}</div>
          </div>
        </td>
      </tr></table>
    </div>

    <div class="foot">${esc(COMPANY_NAME)} · Expediente Laboral · Impreso el ${impreso}</div>
  </body></html>`;
}


