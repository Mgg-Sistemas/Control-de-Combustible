// 📊 REPORTE CONSOLIDADO DE COMPRAS - S.O.S LA GUAIRA
// Generador puro de reportes ejecutivos de compras para web y móvil (sin dependencias de red).
// Paleta corporativa azul SOS La Guaira (#0A2540, #0284C7, #1E40AF), bimonetarismo (USD / Bs BCV),
// filtro de empresas, identificación estricta de maquinaria con PLACA, y opciones de qué se oculta.

import { LOGO_DATA_URI as SOS_LOGO_DATA_URI } from './logoData';
import { GOLDEN_TOUCH_LOGO_DATA_URI } from './logoGoldenTouchData';
import { BCV_LOGO_DATA_URI } from './logoBcvData';
import { RENACE_LOGO_DATA_URI } from './logoRenaceData';
import { JHENZAEN_LOGO_DATA_URI } from './logoJhenzaenData';

export type LogoReporteCompras = 'sos' | 'golden' | 'renace' | 'jhenzaen' | 'bcv' | 'ninguno';

export interface CompraItemLinea {
  name: string;
  category?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  total: number;
  exento?: boolean;
}

export interface CompraParaReporte {
  id: string;
  tipo: 'cuenta' | 'requerimiento' | 'orden' | 'directa' | 'servicio' | 'manguera';
  codigo: string;                     // ej: REQ-0230, CD-0041, CXP-8842, OC-2026-0230
  fecha: string;                      // YYYY-MM-DD o DD/MM/AAAA
  empresaNombre?: string;             // ej: S.O.S LA GUAIRA, GOBERNACIÓN, GOLDEN TOUCH
  empresaId?: string | null;
  departamento: string;               // Área/Frente (OPERACIONES, TRANSPORTE, TALLER, etc.)
  destinoMaquinaria?: string | null;  // Maquinaria vinculada (incluye CÓDIGO + PLACA obligatoria)
  proveedorNombre: string;            // Nombre del proveedor o 'Sin proveedor'
  proveedorRif?: string | null;
  analistaNombre: string;             // Analista / Comprador / Solicitante o '—'
  solicitanteNombre?: string | null;
  prioridad?: 'alta' | 'media' | 'baja' | string;
  status: 'pagada' | 'pendiente' | 'aprobada' | 'recibida' | 'anulada' | string;
  statusLabel: string;                // 'Pagada', 'Pendiente por pagar', 'Aprobada', etc.
  items: CompraItemLinea[];
  totalUsd: number;
  totalBs?: number;
  montoPagadoUsd?: number;
  saldoPendienteUsd?: number;
  observacion?: string | null;
}

export interface ColumnasVisiblesReporte {
  empresa?: boolean;
  proveedor?: boolean;
  maquinaria?: boolean;
  montoBs?: boolean;
  fecha?: boolean;
  estado?: boolean;
}

export interface OpcionesReporteCompras {
  periodoLabel: string;
  fechaDesde?: string;
  fechaHasta?: string;
  empresaFiltroLabel?: string;        // 'TODAS LAS EMPRESAS' o nombre de la empresa
  empresaFiltroId?: string | null;
  estadoFiltro?: 'todas' | 'pagadas' | 'pendientes';
  ambitoLabel?: string;               // 'TODAS LAS COMPRAS (CXP, REQ Y DIRECTAS)', etc.
  agrupacionLabel?: string;           // 'DEPARTAMENTO / ÁREA'
  tasaBcv: number;
  logo?: LogoReporteCompras;
  // Opciones modulares "¿Qué se oculta?"
  sinKpis?: boolean;
  sinDistribucionDept?: boolean;
  sinRankingDept?: boolean;
  sinTopCategorias?: boolean;
  sinPendientes?: boolean;
  sinTrazabilidad?: boolean;
  sinResumenEmpresas?: boolean;
  sinLogos?: boolean;
  // Columnas configurables de la tabla
  columnas?: ColumnasVisiblesReporte;
}

export interface ReporteComprasTransformado {
  kpis: {
    totalComprasCount: number;
    totalComprasUsd: number;
    totalComprasBs: number;
    comprasFinalizadasCount: number;
    comprasFinalizadasUsd: number;
    comprasFinalizadasBs: number;
    comprasPendientesCount: number;
    comprasPendientesUsd: number;
    comprasPendientesBs: number;
    totalPagadoUsd: number;
    totalPagadoBs: number;
    mayorDepartamento: { name: string; usd: number; pct: number };
  };
  distribucionDept: Array<{
    name: string;
    usd: number;
    bs: number;
    pct: number;
  }>;
  rankingDepartamentos: Array<{
    nombre: string;
    cotizacionesCount: number;
    totalUsd: number;
    totalBs: number;
    porcentaje: number;
  }>;
  resumenEmpresas: Array<{
    nombre: string;
    comprasCount: number;
    totalUsd: number;
    totalBs: number;
    porcentaje: number;
  }>;
  topCategorias: Array<{
    nombre: string;
    totalUsd: number;
  }>;
  topItems: Array<{
    nombre: string;
    cantidad: number;
    unit: string;
    totalUsd: number;
  }>;
  comprasPendientes: CompraParaReporte[];
  todasCompras: CompraParaReporte[];
}

/** Escapa caracteres HTML para prevenir inyecciones y fallos de formato */
export function escHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formatea número a moneda estilo venezolano: 1.605,75 */
export function fmtMontoVe(n: number): string {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0,00';
  const fijo = (Math.round(num * 100) / 100).toFixed(2);
  const [ent, dec] = fijo.split('.');
  const entFmt = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${entFmt},${dec}`;
}

/** Formatea monto en USD con símbolo: $ 1.605,75 */
export function fmtUsd(n: number): string {
  return `$ ${fmtMontoVe(n)}`;
}

/** Formatea monto en Bolívares con símbolo: Bs 1.605,75 */
export function fmtBs(n: number): string {
  return `Bs ${fmtMontoVe(n)}`;
}

/**
 * Enriquecedor de maquinaria para cumplir estrictamente la regla de GEMINI.md:
 * "Cada vez que se use o muestre maquinaria en cualquier pantalla, selector o reporte,
 * debe tener NO SOLO el nombre/código de la maquinaria, sino SIEMPRE también su PLACA".
 */
export function enriquecerMaquinariaConPlaca(
  textoMaquinaria: string | null | undefined,
  catalogoMaquinaria: Array<{ code?: string | null; plate?: string | null; name?: string | null }>
): string {
  if (!textoMaquinaria || !textoMaquinaria.trim()) return '—';
  const raw = textoMaquinaria.trim();

  // Si ya contiene la palabra [Placa: ...] o placa explícita, preservarla
  if (/\[\s*placa\s*:/i.test(raw) || /placa\s+[A-Z0-9-]+/i.test(raw)) {
    return raw;
  }

  // Buscar coincidencia exacta o por código en el catálogo
  const normalizar = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const rawNorm = normalizar(raw);

  const encontrada = catalogoMaquinaria.find((m) => {
    const codeNorm = m.code ? normalizar(m.code) : '';
    const nameNorm = m.name ? normalizar(m.name) : '';
    if (codeNorm && (rawNorm === codeNorm || rawNorm.includes(codeNorm))) return true;
    if (nameNorm && (rawNorm === nameNorm || rawNorm.includes(nameNorm))) return true;
    return false;
  });

  if (encontrada) {
    const placaLimpia = (encontrada.plate || '').trim();
    if (placaLimpia) {
      return `${raw} [Placa: ${placaLimpia}]`;
    }
    return `${raw} [Sin placa registrada]`;
  }

  return raw;
}

/**
 * Procesa la lista cruda de compras, calcula métricas, agrupaciones,
 * ranking de departamentos, ranking por empresa y categorías.
 */
export function transformarDatosReporteCompras(
  compras: CompraParaReporte[],
  tasaBcv: number
): ReporteComprasTransformado {
  const tasa = Number.isFinite(tasaBcv) && tasaBcv > 0 ? tasaBcv : 0;

  let totalComprasUsd = 0;
  let totalComprasBs = 0;
  let comprasFinalizadasCount = 0;
  let comprasFinalizadasUsd = 0;
  let comprasFinalizadasBs = 0;
  let comprasPendientesCount = 0;
  let comprasPendientesUsd = 0;
  let comprasPendientesBs = 0;
  let totalPagadoUsd = 0;
  let totalPagadoBs = 0;

  const deptsMap = new Map<string, { count: number; usd: number; bs: number }>();
  const empresasMap = new Map<string, { count: number; usd: number; bs: number }>();
  const catMap = new Map<string, number>();
  const itemsMap = new Map<string, { cantidad: number; unit: string; usd: number }>();
  const pendientesList: CompraParaReporte[] = [];

  for (const c of compras) {
    const usd = Number(c.totalUsd) || 0;
    // Si la compra trae su total en Bs histórico (calculado al día de pago), se respeta con fidelidad
    const bs = c.totalBs != null && c.totalBs > 0 ? Number(c.totalBs) : (tasa > 0 ? Math.round(usd * tasa * 100) / 100 : 0);
    const pagadoUsd = Number(c.montoPagadoUsd) || 0;
    const pagadoBs = c.status === 'pagada' ? bs : (usd > 0 ? Math.round(bs * (pagadoUsd / usd) * 100) / 100 : 0);

    totalComprasUsd += usd;
    totalComprasBs += bs;
    totalPagadoUsd += pagadoUsd;
    totalPagadoBs += pagadoBs;

    const esPagada = c.status === 'pagada' || (c.saldoPendienteUsd != null && c.saldoPendienteUsd <= 0.01 && usd > 0);
    if (esPagada) {
      comprasFinalizadasCount++;
      comprasFinalizadasUsd += usd;
      comprasFinalizadasBs += bs;
    } else {
      const saldoUsd = (c.saldoPendienteUsd != null ? Number(c.saldoPendienteUsd) : usd);
      const saldoBs = usd > 0 ? Math.round(bs * (saldoUsd / usd) * 100) / 100 : bs;
      comprasPendientesCount++;
      comprasPendientesUsd += saldoUsd;
      comprasPendientesBs += saldoBs;
      pendientesList.push(c);
    }

    // Agrupación por Departamento / Área
    const dpto = (c.departamento || 'OPERACIONES').trim().toUpperCase();
    const currD = deptsMap.get(dpto) || { count: 0, usd: 0, bs: 0 };
    currD.count++;
    currD.usd += usd;
    currD.bs += bs;
    deptsMap.set(dpto, currD);

    // Agrupación por Empresa
    const emp = (c.empresaNombre || 'S.O.S LA GUAIRA').trim().toUpperCase();
    const currE = empresasMap.get(emp) || { count: 0, usd: 0, bs: 0 };
    currE.count++;
    currE.usd += usd;
    currE.bs += bs;
    empresasMap.set(emp, currE);

    // Agrupación por Categorías e Ítems
    const renglones = Array.isArray(c.items) ? c.items : [];
    if (renglones.length === 0) {
      const cat = 'Insumos y Repuestos';
      catMap.set(cat, (catMap.get(cat) || 0) + usd);
      const descItem = (c.observacion || c.codigo || 'Compra general').slice(0, 60);
      const currIt = itemsMap.get(descItem) || { cantidad: 0, unit: 'u.', usd: 0 };
      currIt.cantidad += 1;
      currIt.usd += usd;
      itemsMap.set(descItem, currIt);
    } else {
      for (const it of renglones) {
        const cat = (it.category || 'Insumos y Repuestos').trim();
        catMap.set(cat, (catMap.get(cat) || 0) + (Number(it.total) || 0));

        const itName = (it.name || 'Ítem sin descripción').trim();
        const currIt = itemsMap.get(itName) || { cantidad: 0, unit: it.unit || 'u.', usd: 0 };
        currIt.cantidad += Number(it.quantity) || 1;
        currIt.usd += Number(it.total) || 0;
        if (it.unit) currIt.unit = it.unit;
        itemsMap.set(itName, currIt);
      }
    }
  }

  // Ranking de Departamentos ordenado descendente
  const rankingDepartamentos = Array.from(deptsMap.entries())
    .map(([nombre, d]) => ({
      nombre,
      cotizacionesCount: d.count,
      totalUsd: d.usd,
      totalBs: d.bs,
      porcentaje: totalComprasUsd > 0 ? (d.usd / totalComprasUsd) * 100 : 0,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd);

  // Resumen por Empresa
  const resumenEmpresas = Array.from(empresasMap.entries())
    .map(([nombre, e]) => ({
      nombre,
      comprasCount: e.count,
      totalUsd: e.usd,
      totalBs: e.bs,
      porcentaje: totalComprasUsd > 0 ? (e.usd / totalComprasUsd) * 100 : 0,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd);

  // Top Departamentos para distribución horizontal (hasta 4)
  const distribucionDept = rankingDepartamentos.slice(0, 4).map((d) => ({
    name: d.nombre,
    usd: d.totalUsd,
    bs: d.totalBs,
    pct: d.porcentaje,
  }));

  // Top Categorías ordenadas descendente
  const topCategorias = Array.from(catMap.entries())
    .map(([nombre, totalUsd]) => ({ nombre, totalUsd }))
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, 5);

  // Top Ítems ordenados descendente
  const topItems = Array.from(itemsMap.entries())
    .map(([nombre, d]) => ({
      nombre,
      cantidad: d.cantidad,
      unit: d.unit,
      totalUsd: d.usd,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, 5);

  const mayorDepartamento = rankingDepartamentos[0] || { nombre: 'OPERACIONES', totalUsd: 0, porcentaje: 0 };

  return {
    kpis: {
      totalComprasCount: compras.length,
      totalComprasUsd,
      totalComprasBs,
      comprasFinalizadasCount,
      comprasFinalizadasUsd,
      comprasFinalizadasBs,
      comprasPendientesCount,
      comprasPendientesUsd,
      comprasPendientesBs,
      totalPagadoUsd,
      totalPagadoBs,
      mayorDepartamento: {
        name: mayorDepartamento.nombre,
        usd: mayorDepartamento.totalUsd,
        pct: mayorDepartamento.porcentaje,
      },
    },
    distribucionDept,
    rankingDepartamentos,
    resumenEmpresas,
    topCategorias,
    topItems,
    comprasPendientes: pendientesList,
    todasCompras: compras,
  };
}

/**
 * Genera el documento HTML completo del Reporte de Compras con la estética
 * oficial de S.O.S La Guaira (azules #0A2540 / #0284C7 / #1E40AF), responsive y listo para imprimir.
 */
export function generarReporteComprasHtml(
  datos: ReporteComprasTransformado,
  config: OpcionesReporteCompras
): string {
  const { kpis, distribucionDept, rankingDepartamentos, resumenEmpresas, topCategorias, topItems, comprasPendientes, todasCompras } = datos;
  const tasa = config.tasaBcv > 0 && Number.isFinite(config.tasaBcv) ? config.tasaBcv : 0;
  const tasaTexto = tasa > 0 ? `Bs ${fmtMontoVe(tasa)}/$` : 'No disp.';

  // Logo institucional (SOS La Guaira por defecto)
  let logoUri = SOS_LOGO_DATA_URI;
  if (config.logo === 'golden') logoUri = GOLDEN_TOUCH_LOGO_DATA_URI;
  else if (config.logo === 'bcv') logoUri = BCV_LOGO_DATA_URI;
  else if (config.logo === 'renace') logoUri = RENACE_LOGO_DATA_URI;
  else if (config.logo === 'jhenzaen') logoUri = JHENZAEN_LOGO_DATA_URI;
  else if (config.logo === 'ninguno' || config.sinLogos) logoUri = '';

  const ahoraStr = new Date().toLocaleString('es-VE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const columnas = {
    empresa: config.columnas?.empresa !== false,
    proveedor: config.columnas?.proveedor !== false,
    maquinaria: config.columnas?.maquinaria !== false,
    montoBs: config.columnas?.montoBs !== false,
    fecha: config.columnas?.fecha !== false,
    estado: config.columnas?.estado !== false,
  };

  // 1. Tarjetas Resumen / KPIs
  const kpisHtml = config.sinKpis ? '' : `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">TOTAL DE COMPRAS</div>
        <div class="kpi-main">${kpis.totalComprasCount}</div>
        <div class="kpi-sub">${fmtUsd(kpis.totalComprasUsd)}${columnas.montoBs ? ` · ${fmtBs(kpis.totalComprasBs)}` : ''}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">COMPRAS PAGADAS / COMPRADAS</div>
        <div class="kpi-main kpi-success">${kpis.comprasFinalizadasCount}</div>
        <div class="kpi-sub">${fmtUsd(kpis.comprasFinalizadasUsd)}${columnas.montoBs ? ` · ${fmtBs(kpis.comprasFinalizadasBs)}` : ''}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">COMPRAS PENDIENTES</div>
        <div class="kpi-main kpi-warning">${kpis.comprasPendientesCount}</div>
        <div class="kpi-sub">${fmtUsd(kpis.comprasPendientesUsd)}${columnas.montoBs ? ` · ${fmtBs(kpis.comprasPendientesBs)}` : ''}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">TOTAL PAGADO / ABONADO</div>
        <div class="kpi-main kpi-primary">${fmtUsd(kpis.totalPagadoUsd)}</div>
        <div class="kpi-sub">${columnas.montoBs ? `${fmtBs(kpis.totalPagadoBs)} · ` : ''}Mayor: ${escHtml(kpis.mayorDepartamento.name)}</div>
      </div>
    </div>
  `;

  // 2. Distribución puntual por departamento (Top Gasto)
  const distDeptHtml = config.sinDistribucionDept || distribucionDept.length === 0 ? '' : `
    <div class="section-title-line">
      DISTRIBUCIÓN PUNTUAL POR DEPARTAMENTO · TOP GASTO
      <span class="section-subtitle-note">Unidades solicitantes con mayor volumen presupuestario en el período</span>
    </div>
    <div class="dept-pills-grid">
      ${distribucionDept.map((d) => `
        <div class="dept-pill-card">
          <div class="dept-pill-header">
            <span class="dept-pill-name" title="${escHtml(d.name)}">${escHtml(d.name)}</span>
            <span class="dept-pill-pct">${d.pct.toFixed(1)}%</span>
          </div>
          <div class="dept-pill-bar">
            <div class="dept-pill-fill" style="width: ${Math.min(100, Math.max(3, d.pct))}%;"></div>
          </div>
          <div class="dept-pill-montos">
            <span class="dept-pill-usd">${fmtUsd(d.usd)}</span>
            ${columnas.montoBs ? `<span class="dept-pill-bs">${fmtBs(d.bs)}</span>` : ''}
          </div>
          <div class="dept-pill-footer">
            <span>Gasto operativo consolidado</span>
            <span>Participación: ${d.pct.toFixed(1)}%</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // 3. Resumen por Empresa (si hay más de 1 o se desea ver)
  const resumenEmpresasHtml = config.sinResumenEmpresas || resumenEmpresas.length <= 1 ? '' : `
    <div class="section-title-box" style="margin-top: 14px;">
      <b>Distribución Presupuestaria por Empresa Contratista / Pagadora</b>
      <span class="section-subtitle-note">Volumen de compras asignadas por razón social</span>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th style="width: 32px;" class="text-center">#</th>
          <th>Empresa</th>
          <th style="width: 100px;" class="text-center">Compras</th>
          <th style="width: 140px;" class="text-right">Total USD ($)</th>
          ${columnas.montoBs ? '<th style="width: 150px;" class="text-right">Total Bs (BCV)</th>' : ''}
          <th style="width: 90px;" class="text-right">% Part.</th>
        </tr>
      </thead>
      <tbody>
        ${resumenEmpresas.map((e, idx) => `
          <tr>
            <td class="text-center font-bold">${idx + 1}</td>
            <td class="font-bold">${escHtml(e.nombre)}</td>
            <td class="text-center">${e.comprasCount}</td>
            <td class="text-right font-mono font-bold">${fmtUsd(e.totalUsd)}</td>
            ${columnas.montoBs ? `<td class="text-right font-mono">${fmtBs(e.totalBs)}</td>` : ''}
            <td class="text-right font-bold">${e.porcentaje.toFixed(1)} %</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // 4. Ranking de Departamentos
  const rankingHtml = config.sinRankingDept ? '' : `
    <div class="section-title-box">
      <b>1. Ranking de Departamentos por Gasto y Cotizaciones Movidas</b>
      <span class="section-subtitle-note">Distribución presupuestaria y actividad operativa por unidad solicitante</span>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th style="width: 32px;" class="text-center">#</th>
          <th>Departamento</th>
          <th style="width: 110px;" class="text-center">Cotizaciones</th>
          <th style="width: 130px;" class="text-right">Total USD ($)</th>
          ${columnas.montoBs ? '<th style="width: 140px;" class="text-right">Total Bs (BCV)</th>' : ''}
          <th style="width: 90px;" class="text-right">% del Gasto</th>
        </tr>
      </thead>
      <tbody>
        ${rankingDepartamentos.map((d, idx) => `
          <tr>
            <td class="text-center font-bold">${idx + 1}</td>
            <td class="font-bold">${escHtml(d.nombre)}</td>
            <td class="text-center">${d.cotizacionesCount} cotiz.</td>
            <td class="text-right font-mono">${fmtUsd(d.totalUsd)}</td>
            ${columnas.montoBs ? `<td class="text-right font-mono">${fmtBs(d.totalBs)}</td>` : ''}
            <td class="text-right font-bold">${d.porcentaje.toFixed(1)} %</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2" class="font-bold">TOTAL DEPARTAMENTOS</td>
          <td class="text-center font-bold">${kpis.totalComprasCount} cotizaciones</td>
          <td class="text-right font-mono font-bold">${fmtUsd(kpis.totalComprasUsd)}</td>
          ${columnas.montoBs ? `<td class="text-right font-mono font-bold">${fmtBs(kpis.totalComprasBs)}</td>` : ''}
          <td class="text-right font-bold">100.0 %</td>
        </tr>
      </tfoot>
    </table>
  `;

  // 5. Top Categorías e Ítems
  const topInversionHtml = config.sinTopCategorias ? '' : `
    <div class="section-title-box" style="margin-top: 14px;">
      <b>2. Top Categorías e Ítems con Mayor Inversión</b>
      <span class="section-subtitle-note">Concentración de compras por conceptos e inventario</span>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th style="width: 32px;" class="text-center">#</th>
          <th>Top Categorías de Inventario</th>
          <th style="width: 180px;" class="text-right">Total Invertido USD ($)</th>
        </tr>
      </thead>
      <tbody>
        ${topCategorias.map((c, idx) => `
          <tr>
            <td class="text-center font-bold">${idx + 1}</td>
            <td>${escHtml(c.nombre)}</td>
            <td class="text-right font-mono font-bold">${fmtUsd(c.totalUsd)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <table class="report-table" style="margin-top: 10px;">
      <thead>
        <tr>
          <th style="width: 32px;" class="text-center">#</th>
          <th>Top Ítems / Repuestos / Servicios Solicitados</th>
          <th style="width: 100px;" class="text-center">Cantidad</th>
          <th style="width: 180px;" class="text-right">Total Invertido USD ($)</th>
        </tr>
      </thead>
      <tbody>
        ${topItems.map((it, idx) => `
          <tr>
            <td class="text-center font-bold">${idx + 1}</td>
            <td>${escHtml(it.nombre)}</td>
            <td class="text-center">${it.cantidad} ${escHtml(it.unit)}</td>
            <td class="text-right font-mono font-bold">${fmtUsd(it.totalUsd)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // 6. Compras Pendientes (se oculta si el usuario eligió "Solo Pagadas" o si lo activó en conmutadores)
  const ocultarPendientes = config.sinPendientes || config.estadoFiltro === 'pagadas' || comprasPendientes.length === 0;
  const pendientesHtml = ocultarPendientes ? '' : `
    <div class="section-title-box" style="margin-top: 14px;">
      <b>3. Compras y Cuentas Pendientes por Pagar / Aprobar</b>
      <span class="section-subtitle-note">Compromisos vigentes pendientes de liquidación</span>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th style="width: 90px;">Código</th>
          ${columnas.fecha ? '<th style="width: 75px;">Fecha</th>' : ''}
          ${columnas.empresa ? '<th>Empresa</th>' : ''}
          <th>Departamento</th>
          ${columnas.proveedor ? '<th>Proveedor</th>' : ''}
          ${columnas.maquinaria ? '<th>Destino / Máquina</th>' : ''}
          <th style="width: 105px;" class="text-right">Total USD</th>
          <th style="width: 105px;" class="text-right">Saldo Deuda</th>
          ${columnas.estado ? '<th style="width: 90px;" class="text-center">Estado</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${comprasPendientes.map((c) => `
          <tr>
            <td class="font-bold">${escHtml(c.codigo)}</td>
            ${columnas.fecha ? `<td>${escHtml(c.fecha)}</td>` : ''}
            ${columnas.empresa ? `<td>${escHtml(c.empresaNombre || '—')}</td>` : ''}
            <td>${escHtml(c.departamento)}</td>
            ${columnas.proveedor ? `<td>${escHtml(c.proveedorNombre)}</td>` : ''}
            ${columnas.maquinaria ? `<td>${escHtml(c.destinoMaquinaria || '—')}</td>` : ''}
            <td class="text-right font-mono">${fmtUsd(c.totalUsd)}</td>
            <td class="text-right font-mono font-bold text-danger">${fmtUsd(c.saldoPendienteUsd != null ? c.saldoPendienteUsd : c.totalUsd)}</td>
            ${columnas.estado ? `<td class="text-center"><span class="badge-pend">${escHtml(c.statusLabel)}</span></td>` : ''}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // 7. Listado Detallado de Compras (filtrado estrictamente por estado)
  const comprasMostradasTabla = config.estadoFiltro === 'pagadas'
    ? todasCompras.filter((c) => c.status === 'pagada')
    : config.estadoFiltro === 'pendientes'
      ? todasCompras.filter((c) => c.status !== 'pagada')
      : todasCompras;

  const totalUsdTabla = comprasMostradasTabla.reduce((acc, c) => acc + (Number(c.totalUsd) || 0), 0);
  const totalBsTabla = comprasMostradasTabla.reduce((acc, c) => {
    const bsItem = c.totalBs != null && c.totalBs > 0 ? Number(c.totalBs) : (tasa > 0 ? (Number(c.totalUsd) || 0) * tasa : 0);
    return acc + bsItem;
  }, 0);

  const tituloSeccionTabla = config.estadoFiltro === 'pagadas'
    ? 'Listado Consolidado de Compras Pagadas (Lo efectivamente comprado)'
    : config.estadoFiltro === 'pendientes'
      ? 'Listado de Compras y Compromisos Pendientes por Pagar'
      : 'Listado Detallado de Compras del Período';

  const todasComprasHtml = `
    <div class="section-title-box" style="margin-top: 14px;">
      <b>${tituloSeccionTabla}</b>
      <span class="section-subtitle-note">${comprasMostradasTabla.length} registro(s) listado(s)</span>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th style="width: 85px;">Código</th>
          ${columnas.fecha ? '<th style="width: 75px;">Fecha</th>' : ''}
          ${columnas.empresa ? '<th>Empresa</th>' : ''}
          <th>Dpto / Área</th>
          ${columnas.proveedor ? '<th>Proveedor</th>' : ''}
          ${columnas.maquinaria ? '<th>Destino / Máquina (Placa)</th>' : ''}
          <th style="width: 105px;" class="text-right">Total USD</th>
          ${columnas.montoBs ? '<th style="width: 110px;" class="text-right">Total Bs</th>' : ''}
          ${columnas.estado ? '<th style="width: 85px;" class="text-center">Estado</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${comprasMostradasTabla.map((c) => {
          const esPagada = c.status === 'pagada';
          const totalBsFmt = c.totalBs ? fmtBs(c.totalBs) : (tasa > 0 ? fmtBs(c.totalUsd * tasa) : '—');
          return `
            <tr>
              <td class="font-bold">${escHtml(c.codigo)}</td>
              ${columnas.fecha ? `<td>${escHtml(c.fecha)}</td>` : ''}
              ${columnas.empresa ? `<td>${escHtml(c.empresaNombre || '—')}</td>` : ''}
              <td>${escHtml(c.departamento)}</td>
              ${columnas.proveedor ? `<td>${escHtml(c.proveedorNombre)}</td>` : ''}
              ${columnas.maquinaria ? `<td>${escHtml(c.destinoMaquinaria || '—')}</td>` : ''}
              <td class="text-right font-mono font-bold">${fmtUsd(c.totalUsd)}</td>
              ${columnas.montoBs ? `<td class="text-right font-mono">${totalBsFmt}</td>` : ''}
              ${columnas.estado ? `<td class="text-center"><span class="${esPagada ? 'badge-ok' : 'badge-pend'}">${escHtml(c.statusLabel)}</span></td>` : ''}
            </tr>
          `;
        }).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="${2 + (columnas.fecha ? 1 : 0) + (columnas.empresa ? 1 : 0) + (columnas.proveedor ? 1 : 0) + (columnas.maquinaria ? 1 : 0)}" class="font-bold">TOTAL MOSTRADO (${comprasMostradasTabla.length})</td>
          <td class="text-right font-mono font-bold">${fmtUsd(totalUsdTabla)}</td>
          ${columnas.montoBs ? `<td class="text-right font-mono font-bold">${fmtBs(totalBsTabla)}</td>` : ''}
          ${columnas.estado ? '<td></td>' : ''}
        </tr>
      </tfoot>
    </table>
  `;

  // Retornar HTML completo con estilos integrados
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte de Compras - S.O.S La Guaira</title>
  <style>
    @page {
      size: letter portrait;
      margin: 12mm 10mm 12mm 10mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 8.5px;
      line-height: 1.3;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
    }

    /* Membrete Oficial SOS La Guaira */
    .header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
    }
    .header-table td {
      vertical-align: middle;
      padding: 0;
    }
    .company-logo {
      height: 48px;
      max-width: 140px;
      object-fit: contain;
    }
    .company-title {
      font-size: 14px;
      font-weight: 900;
      color: #0A2540;
      letter-spacing: 0.3px;
    }
    .company-subtitle {
      font-size: 9px;
      font-weight: 700;
      color: #0284C7;
      text-transform: uppercase;
      letter-spacing: 0.2px;
    }
    .company-meta {
      font-size: 8px;
      color: #64748b;
    }
    .blue-badge-title {
      background: #0A2540;
      color: #ffffff;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 900;
      text-align: center;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      border-radius: 4px;
      display: inline-block;
      min-width: 200px;
      border-left: 4px solid #0284C7;
    }
    .meta-box-right {
      text-align: right;
      font-size: 8px;
      color: #334155;
      line-height: 1.35;
    }

    /* Sub-cintillo Alcance */
    .alcance-bar {
      border-top: 2px solid #0284C7;
      border-bottom: 1px solid #cbd5e1;
      background: #f0f9ff;
      padding: 5px 8px;
      font-size: 8px;
      color: #0369a1;
      margin-bottom: 10px;
      border-radius: 2px;
    }
    .alcance-bar b {
      color: #0A2540;
    }

    /* Tarjetas Resumen / KPIs */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 12px;
    }
    .kpi-card {
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 6px 8px;
      background: #ffffff;
      border-top: 3px solid #0284C7;
    }
    .kpi-label {
      font-size: 7.5px;
      font-weight: 800;
      color: #64748b;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .kpi-main {
      font-size: 15px;
      font-weight: 900;
      color: #0A2540;
      line-height: 1.1;
    }
    .kpi-primary { color: #0284C7; }
    .kpi-success { color: #166534; }
    .kpi-warning { color: #b45309; }
    .kpi-sub {
      font-size: 7.5px;
      color: #475569;
      margin-top: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Top Gasto por Departamento */
    .section-title-line {
      font-size: 9px;
      font-weight: 900;
      color: #0A2540;
      text-transform: uppercase;
      border-left: 3px solid #0284C7;
      padding-left: 6px;
      margin-bottom: 6px;
      margin-top: 10px;
    }
    .section-subtitle-note {
      font-size: 7.5px;
      font-weight: normal;
      color: #64748b;
      margin-left: 6px;
      text-transform: none;
    }
    .dept-pills-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      margin-bottom: 12px;
    }
    .dept-pill-card {
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 6px 8px;
      background: #f8fafc;
    }
    .dept-pill-header {
      display: flex;
      justify-content: space-between;
      font-size: 8px;
      font-weight: 800;
      color: #0A2540;
    }
    .dept-pill-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 110px;
    }
    .dept-pill-pct {
      color: #0284C7;
      font-weight: 800;
    }
    .dept-pill-bar {
      height: 4px;
      background: #e2e8f0;
      border-radius: 2px;
      margin: 4px 0;
      overflow: hidden;
    }
    .dept-pill-fill {
      height: 100%;
      background: #0284C7;
      border-radius: 2px;
    }
    .dept-pill-montos {
      display: flex;
      justify-content: space-between;
      font-size: 8px;
      font-weight: 700;
    }
    .dept-pill-usd { color: #0A2540; }
    .dept-pill-bs { color: #64748b; }
    .dept-pill-footer {
      display: flex;
      justify-content: space-between;
      font-size: 7px;
      color: #94a3b8;
      margin-top: 3px;
    }

    /* Caja de Título de Sección */
    .section-title-box {
      background: #0A2540;
      color: #ffffff;
      padding: 4px 8px;
      font-size: 8.5px;
      border-radius: 3px 3px 0 0;
      margin-top: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .section-title-box .section-subtitle-note {
      color: #bae6fd;
    }

    /* Tablas Institucionales */
    .report-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
      page-break-inside: auto;
    }
    .report-table thead {
      display: table-header-group;
    }
    .report-table tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }
    .report-table th {
      background: #1e3a8a;
      color: #ffffff;
      font-size: 7.5px;
      font-weight: 800;
      text-transform: uppercase;
      padding: 4px 6px;
      border: 1px solid #1e3a8a;
      text-align: left;
    }
    .report-table td {
      padding: 3.5px 6px;
      font-size: 8px;
      border: 1px solid #e2e8f0;
      color: #1e293b;
    }
    .report-table tbody tr:nth-child(even) {
      background-color: #f8fafc;
    }
    .report-table tbody tr:hover {
      background-color: #f0f9ff;
    }
    .report-table tfoot td {
      background: #f1f5f9;
      border-top: 2px solid #0A2540;
      border-bottom: 2px solid #0A2540;
      padding: 4px 6px;
      font-size: 8.5px;
    }

    /* Clases Utilitarias */
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .font-bold { font-weight: 800; }
    .font-mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }
    .text-danger { color: #dc2626; }
    .badge-ok {
      background: #dcfce7;
      color: #166534;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 7px;
      font-weight: 800;
      border: 1px solid #bbf7d0;
    }
    .badge-pend {
      background: #fef3c7;
      color: #92400e;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 7px;
      font-weight: 800;
      border: 1px solid #fde68a;
    }

    /* Pie de Página */
    .footer-box {
      margin-top: 14px;
      border-top: 1px solid #cbd5e1;
      padding-top: 6px;
      display: flex;
      justify-content: space-between;
      font-size: 7px;
      color: #64748b;
    }
  </style>
</head>
<body>

  <!-- Membrete -->
  <table class="header-table">
    <tr>
      <td style="width: 140px;">
        ${logoUri ? `<img src="${logoUri}" alt="Logo SOS" class="company-logo" />` : ''}
      </td>
      <td style="padding-left: 10px;">
        <div class="company-title">S.O.S LA GUAIRA</div>
        <div class="company-subtitle">Control Operativo · Maquinaria · Compras y Suministros</div>
        <div class="company-meta">Corporación de Servicios y Mantenimiento Vial · RIF J-50346387-9</div>
      </td>
      <td style="text-align: right; width: 220px;">
        <div class="blue-badge-title">REPORTE DE COMPRAS</div>
        <div class="meta-box-right" style="margin-top: 4px;">
          <b>Emisión:</b> ${ahoraStr}<br/>
          <b>Tasa Oficial BCV:</b> ${tasaTexto}
        </div>
      </td>
    </tr>
  </table>

  <!-- Cintillo de Alcance y Filtros -->
  <div class="alcance-bar">
    <b>ALCANCE:</b> ${escHtml(config.periodoLabel.toUpperCase())} &nbsp;|&nbsp;
    <b>EMPRESA:</b> ${escHtml((config.empresaFiltroLabel || 'TODAS LAS EMPRESAS').toUpperCase())} &nbsp;|&nbsp;
    <b>ESTADO:</b> ${config.estadoFiltro === 'pagadas' ? 'SOLO COMPRAS PAGADAS (EFECTIVAMENTE COMPRADAS)' : config.estadoFiltro === 'pendientes' ? 'SOLO COMPRAS PENDIENTES' : 'CONSOLIDADO GENERAL (PAGADAS Y PENDIENTES)'} &nbsp;|&nbsp;
    <b>REGISTROS:</b> ${todasCompras.length}
  </div>

  <!-- 1. KPIs -->
  ${kpisHtml}

  <!-- 2. Distribución Puntual por Departamento -->
  ${distDeptHtml}

  <!-- 3. Resumen por Empresa -->
  ${resumenEmpresasHtml}

  <!-- 4. Ranking de Departamentos -->
  ${rankingHtml}

  <!-- 5. Top Inversión (Categorías e Ítems) -->
  ${topInversionHtml}

  <!-- 6. Compras Pendientes -->
  ${pendientesHtml}

  <!-- 7. Listado Detallado de Compras -->
  ${todasComprasHtml}

  <!-- Pie de Página -->
  <div class="footer-box">
    <span>Reporte Oficial emitido por el Sistema de Control de Combustible y Compras · SOS La Guaira</span>
    <span>Documento de Control Interno · Confidencial</span>
  </div>

</body>
</html>
  `.trim();
}
