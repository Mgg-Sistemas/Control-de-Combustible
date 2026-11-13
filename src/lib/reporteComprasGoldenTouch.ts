// 📊 REPORTE DE COMPRAS - ESTILO INSTITUCIONAL GOLDEN TOUCH 1127 C.A.
// Generador puro (sin dependencias de red/UI) para reportes consolidados de compras y órdenes
// Replicación milimétrica del formato ejecutivo de compras con bimonetarismo (USD / Bs BCV).

import { GOLDEN_TOUCH_LOGO_DATA_URI } from './logoGoldenTouchData';
import { LOGO_DATA_URI as SOS_LOGO_DATA_URI } from './logoData';
import { BCV_LOGO_DATA_URI } from './logoBcvData';
import { RENACE_LOGO_DATA_URI } from './logoRenaceData';
import { JHENZAEN_LOGO_DATA_URI } from './logoJhenzaenData';

export type LogoReporteCompras = 'golden' | 'sos' | 'bcv' | 'renace' | 'jhenzaen';

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
  tipo: 'requerimiento' | 'orden' | 'directa' | 'servicio' | 'manguera';
  codigo: string;                     // ej: REQ-0230, CD-0041, OC-2026-0230
  fecha: string;                      // YYYY-MM-DD o DD/MM/AAAA
  departamento: string;               // Area/Frente (MINA PERAMANAL, TRANSPORTE, etc.)
  destinoMaquinaria?: string | null;  // Maquinaria vinculada (incluye PLACA obligatoria)
  proveedorNombre: string;            // Nombre de proveedor o 'Sin proveedor'
  proveedorRif?: string | null;
  analistaNombre: string;             // Analista/Comprador o '—'
  solicitanteNombre?: string | null;
  prioridad?: 'alta' | 'media' | 'baja' | string;
  status: string;                     // 'borrador' | 'pendiente' | 'aprobada' | 'recibida' | 'pagada' | 'anulada'
  statusLabel: string;                // 'Confirmada pagar', 'Recibida', 'Pendiente por aprobar', etc.
  items: CompraItemLinea[];
  totalUsd: number;
  totalBs?: number;
  montoPagadoUsd?: number;
  saldoPendienteUsd?: number;
  observacion?: string | null;
}

export interface OpcionesReporteCompras {
  periodoLabel: string;
  fechaDesde?: string;
  fechaHasta?: string;
  ambitoLabel?: string;               // 'ÓRDENES DE COMPRA', 'TODAS LAS COMPRAS', etc.
  agrupacionLabel?: string;           // 'DEPARTAMENTO', 'PROVEEDOR', etc.
  tasaBcv: number;
  logo?: LogoReporteCompras;
  // Modulares "¿Qué se oculta?"
  sinKpis?: boolean;
  sinDistribucionDept?: boolean;
  sinRankingDept?: boolean;
  sinTopCategorias?: boolean;
  sinPendientes?: boolean;
  sinTrazabilidad?: boolean;
  sinLogos?: boolean;
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

/** Escapa caracteres HTML para prevenir XSS y rotura de etiquetas */
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
  const entConPunto = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${entConPunto},${dec}`;
}

export function fmtUsd(n: number): string {
  return `$ ${fmtMontoVe(n)}`;
}

export function fmtBs(n: number): string {
  return `Bs ${fmtMontoVe(n)}`;
}

/**
 * Enriquecer cualquier mención de maquinaria para asegurar que incluya su PLACA
 * cumpliendo estrictamente con la regla de negocio del proyecto.
 */
export function enriquecerMaquinariaConPlaca(
  texto: string | null | undefined,
  machineryList: Array<{ code?: string | null; plate?: string | null; name?: string | null }>
): string {
  const txt = String(texto ?? '').trim();
  if (!txt) return '—';
  if (/placa/i.test(txt)) return txt; // ya tiene placa
  const mach = machineryList.find((m) => {
    const c = (m.code || '').trim().toUpperCase();
    const n = (m.name || '').trim().toUpperCase();
    const t = txt.toUpperCase();
    return (c && t.includes(c)) || (n && t.includes(n));
  });
  if (mach && mach.plate) {
    return `${txt} [Placa: ${mach.plate}]`;
  }
  return txt;
}

/**
 * Transforma y agrupa la data cruda de compras calculando métricas,
 * ranking de departamentos, top categorías e ítems, y compras pendientes.
 */
export function transformarDatosReporteCompras(
  compras: CompraParaReporte[],
  config: OpcionesReporteCompras
): ReporteComprasTransformado {
  const tasa = config.tasaBcv > 0 && Number.isFinite(config.tasaBcv) ? config.tasaBcv : 0;

  let totalComprasUsd = 0;
  let comprasFinalizadasUsd = 0;
  let comprasFinalizadasCount = 0;
  let comprasPendientesUsd = 0;
  let comprasPendientesCount = 0;
  let totalPagadoUsd = 0;

  const deptsMap = new Map<string, { count: number; usd: number }>();
  const catMap = new Map<string, number>();
  const itemsMap = new Map<string, { cantidad: number; unit: string; usd: number }>();
  const pendientesList: CompraParaReporte[] = [];

  for (const c of compras) {
    const usd = Number(c.totalUsd) || 0;
    const pagado = Number(c.montoPagadoUsd ?? 0);
    const bs = tasa > 0 ? usd * tasa : 0;
    c.totalBs = bs;

    totalComprasUsd += usd;
    totalPagadoUsd += pagado;

    // Clasificación de Finalizada vs Pendiente
    const st = (c.status || '').toLowerCase();
    const esFinalizada = st === 'recibida' || st === 'despachado' || (st === 'pagada' && (c.saldoPendienteUsd ?? 0) <= 0);

    if (esFinalizada) {
      comprasFinalizadasUsd += usd;
      comprasFinalizadasCount++;
    } else if (st !== 'anulada') {
      comprasPendientesUsd += usd;
      comprasPendientesCount++;
      pendientesList.push(c);
    }

    // Agrupación por Departamento
    const dpto = (c.departamento || 'Sin Departamento').trim().toUpperCase();
    const currD = deptsMap.get(dpto) || { count: 0, usd: 0 };
    currD.count++;
    currD.usd += usd;
    deptsMap.set(dpto, currD);

    // Agrupación por Categorías e Ítems
    const renglones = Array.isArray(c.items) ? c.items : [];
    if (renglones.length === 0) {
      // Si no tiene ítems estructurados, agrupar bajo General / Sin categoría
      const cat = 'Servicios / sin categoría';
      catMap.set(cat, (catMap.get(cat) || 0) + usd);
      const descItem = (c.observacion || c.codigo || 'Compra general').slice(0, 60);
      const currIt = itemsMap.get(descItem) || { cantidad: 0, unit: 'u.', usd: 0 };
      currIt.cantidad += 1;
      currIt.usd += usd;
      itemsMap.set(descItem, currIt);
    } else {
      for (const it of renglones) {
        const cat = (it.category || 'Insumos y Consumibles').trim();
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
      totalBs: tasa > 0 ? d.usd * tasa : 0,
      porcentaje: totalComprasUsd > 0 ? (d.usd / totalComprasUsd) * 100 : 0,
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

  const mayorDepartamento = rankingDepartamentos[0] || { nombre: 'N/A', totalUsd: 0, porcentaje: 0 };

  return {
    kpis: {
      totalComprasCount: compras.length,
      totalComprasUsd,
      totalComprasBs: tasa > 0 ? totalComprasUsd * tasa : 0,
      comprasFinalizadasCount,
      comprasFinalizadasUsd,
      comprasFinalizadasBs: tasa > 0 ? comprasFinalizadasUsd * tasa : 0,
      comprasPendientesCount,
      comprasPendientesUsd,
      comprasPendientesBs: tasa > 0 ? comprasPendientesUsd * tasa : 0,
      totalPagadoUsd,
      totalPagadoBs: tasa > 0 ? totalPagadoUsd * tasa : 0,
      mayorDepartamento: {
        name: mayorDepartamento.nombre,
        usd: mayorDepartamento.totalUsd,
        pct: mayorDepartamento.porcentaje,
      },
    },
    distribucionDept,
    rankingDepartamentos,
    topCategorias,
    topItems,
    comprasPendientes: pendientesList,
    todasCompras: compras,
  };
}

/**
 * Genera el documento HTML completo idéntico al PDF de Golden Touch
 */
export function generarReporteComprasHtml(
  datos: ReporteComprasTransformado,
  config: OpcionesReporteCompras
): string {
  const { kpis, distribucionDept, rankingDepartamentos, topCategorias, topItems, comprasPendientes, todasCompras } = datos;
  const tasa = config.tasaBcv > 0 && Number.isFinite(config.tasaBcv) ? config.tasaBcv : 0;
  const tasaTexto = tasa > 0 ? `Bs ${fmtMontoVe(tasa)}/$` : 'No disp.';

  // Logo institucional
  let logoUri = GOLDEN_TOUCH_LOGO_DATA_URI;
  if (config.logo === 'sos') logoUri = SOS_LOGO_DATA_URI;
  else if (config.logo === 'bcv') logoUri = BCV_LOGO_DATA_URI;
  else if (config.logo === 'renace') logoUri = RENACE_LOGO_DATA_URI;
  else if (config.logo === 'jhenzaen') logoUri = JHENZAEN_LOGO_DATA_URI;

  const ahoraStr = new Date().toLocaleString('es-VE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // 1. KPI Cards HTML
  const kpisHtml = config.sinKpis ? '' : `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">TOTAL DE COMPRAS</div>
        <div class="kpi-main">${kpis.totalComprasCount}</div>
        <div class="kpi-sub">${fmtUsd(kpis.totalComprasUsd)} · ${fmtBs(kpis.totalComprasBs)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">COMPRAS FINALIZADAS</div>
        <div class="kpi-main">${kpis.comprasFinalizadasCount}</div>
        <div class="kpi-sub">${fmtUsd(kpis.comprasFinalizadasUsd)} · ${fmtBs(kpis.comprasFinalizadasBs)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">COMPRAS PENDIENTES</div>
        <div class="kpi-main">${kpis.comprasPendientesCount}</div>
        <div class="kpi-sub">${fmtUsd(kpis.comprasPendientesUsd)} · ${fmtBs(kpis.comprasPendientesBs)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">TOTAL PAGADO / ABONADO</div>
        <div class="kpi-main">${fmtUsd(kpis.totalPagadoUsd)}</div>
        <div class="kpi-sub">${fmtBs(kpis.totalPagadoBs)} · Mayor: ${escHtml(kpis.mayorDepartamento.name)}</div>
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
            <span class="dept-pill-bs">${fmtBs(d.bs)}</span>
          </div>
          <div class="dept-pill-footer">
            <span>Gasto operativo consolidado</span>
            <span>Participación: ${d.pct.toFixed(1)}%</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // 3. Sección 1: Ranking de Departamentos por Gasto
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
          <th style="width: 140px;" class="text-right">Total Bs (BCV)</th>
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
            <td class="text-right font-mono">${fmtBs(d.totalBs)}</td>
            <td class="text-right font-bold">${d.porcentaje.toFixed(1)} %</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2" class="font-bold">TOTAL DEPARTAMENTOS</td>
          <td class="text-center font-bold">${kpis.totalComprasCount} cotizaciones</td>
          <td class="text-right font-mono font-bold">${fmtUsd(kpis.totalComprasUsd)}</td>
          <td class="text-right font-mono font-bold">${fmtBs(kpis.totalComprasBs)}</td>
          <td class="text-right font-bold">100.0 %</td>
        </tr>
      </tfoot>
    </table>
    <div class="table-footnote">* No incluye las compras directas, que se agrupan por categoría de gasto.</div>
  `;

  // 4. Sección 2: Top Categorías e Ítems con Mayor Inversión
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
          <th>Top Ítems Registrados</th>
          <th style="width: 100px;" class="text-center">Cantidad</th>
          <th style="width: 180px;" class="text-right">Total Invertido USD ($)</th>
        </tr>
      </thead>
      <tbody>
        ${topItems.map((it, idx) => `
          <tr>
            <td class="text-center font-bold">${idx + 1}</td>
            <td>${escHtml(it.nombre)}</td>
            <td class="text-center">${it.cantidad} ${escHtml(it.unit || 'u.')}</td>
            <td class="text-right font-mono font-bold">${fmtUsd(it.totalUsd)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // 5. Sección 3: Listado de Compras Pendientes
  const pendientesHtml = config.sinPendientes ? '' : `
    <div class="page-break"></div>
    <div class="section-title-box">
      <b>3. Listado de Compras Pendientes (${comprasPendientes.length} órdenes)</b>
      <span class="section-subtitle-note">Órdenes de compra y compras en proceso o pendientes de pago · Total pendiente: ${fmtUsd(kpis.comprasPendientesUsd)} · ${fmtBs(kpis.comprasPendientesBs)}</span>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th style="width: 24px;" class="text-center">#</th>
          <th style="width: 90px;">Código</th>
          <th style="width: 75px;">Fecha</th>
          <th style="width: 130px;">Departamento</th>
          <th>Proveedor</th>
          <th style="width: 110px;">Analista</th>
          <th style="width: 120px;">Estado</th>
          <th style="width: 95px;" class="text-right">Monto ($)</th>
          <th style="width: 105px;" class="text-right">Monto (Bs)</th>
        </tr>
      </thead>
      <tbody>
        ${comprasPendientes.length === 0 ? `
          <tr><td colspan="9" class="text-center py-4">No hay compras pendientes en este período.</td></tr>
        ` : comprasPendientes.map((c, idx) => `
          <tr>
            <td class="text-center">${idx + 1}</td>
            <td class="font-bold">${escHtml(c.codigo)}</td>
            <td>${escHtml(c.fecha)}</td>
            <td>${escHtml(c.departamento || '—')}</td>
            <td>${escHtml(c.proveedorNombre || 'Sin proveedor')}</td>
            <td class="font-bold">${escHtml(c.analistaNombre || '—')}</td>
            <td><span class="status-badge">${escHtml(c.statusLabel || c.status)}</span></td>
            <td class="text-right font-mono font-bold">${fmtUsd(c.totalUsd)}</td>
            <td class="text-right font-mono">${fmtBs(c.totalBs ?? (tasa > 0 ? c.totalUsd * tasa : 0))}</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="7" class="font-bold">TOTAL PENDIENTES</td>
          <td class="text-right font-mono font-bold">${fmtUsd(kpis.comprasPendientesUsd)}</td>
          <td class="text-right font-mono font-bold">${fmtBs(kpis.comprasPendientesBs)}</td>
        </tr>
      </tfoot>
    </table>
  `;

  // 6. Sección 4: Trazabilidad Consolidada de Todas las Compras
  const trazabilidadHtml = config.sinTrazabilidad ? '' : `
    <div class="page-break"></div>
    <div class="section-title-box">
      <b>4. Trazabilidad Consolidada de Todas las Compras (Ítems y Notas)</b>
      <span class="section-subtitle-note">Auditoría exhaustiva de todas las compras del período con desglose puntual de ítems y notas · Total registros: ${todasCompras.length}</span>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th style="width: 20px;" class="text-center">#</th>
          <th style="width: 75px;">Código</th>
          <th style="width: 65px;">Fecha</th>
          <th style="width: 100px;">Departamento</th>
          <th style="width: 110px;">Proveedor</th>
          <th style="width: 90px;">Analista</th>
          <th style="width: 90px;">Estado</th>
          <th style="width: 180px;">Ítems Comprados</th>
          <th>Nota / Observación</th>
          <th style="width: 85px;" class="text-right">Monto ($)</th>
          <th style="width: 95px;" class="text-right">Monto (Bs)</th>
        </tr>
      </thead>
      <tbody>
        ${todasCompras.map((c, idx) => {
          const itemsTexto = (c.items || []).map((it) => `• ${it.quantity} ${it.unit || 'u.'} ${it.name} (${fmtUsd(it.total)})`).join('<br>');
          const notaLimpia = (c.observacion || '—').replace(/\[\[HISTORIAL_COMPRA:.*?\]\]/g, '').trim() || '—';
          return `
            <tr>
              <td class="text-center">${idx + 1}</td>
              <td class="font-bold font-mono">${escHtml(c.codigo)}</td>
              <td>${escHtml(c.fecha)}</td>
              <td>${escHtml(c.departamento || '—')}</td>
              <td>${escHtml(c.proveedorNombre || 'Sin proveedor')}</td>
              <td class="font-bold">${escHtml(c.analistaNombre || '—')}</td>
              <td><span class="status-badge">${escHtml(c.statusLabel || c.status)}</span></td>
              <td class="items-cell">${itemsTexto ? itemsTexto : escHtml(c.observacion || 'Compra general')}</td>
              <td class="note-cell">${escHtml(notaLimpia)}</td>
              <td class="text-right font-mono font-bold">${fmtUsd(c.totalUsd)}</td>
              <td class="text-right font-mono">${fmtBs(c.totalBs ?? (tasa > 0 ? c.totalUsd * tasa : 0))}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="9" class="font-bold">TOTAL GENERAL DE COMPRAS (${todasCompras.length} compras)</td>
          <td class="text-right font-mono font-bold">${fmtUsd(kpis.totalComprasUsd)}</td>
          <td class="text-right font-mono font-bold">${fmtBs(kpis.totalComprasBs)}</td>
        </tr>
      </tfoot>
    </table>
  `;

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Reporte de Compras - Golden Touch 1127 C.A.</title>
  <style>
    @page {
      size: letter portrait;
      margin: 1.2cm 1cm 1.4cm 1cm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 8.5px;
      color: #1e293b;
      margin: 0;
      padding: 0;
      background: #ffffff;
      line-height: 1.3;
    }
    @media screen {
      body { padding: 20px; max-width: 960px; margin: auto; }
    }

    /* Membrete */
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
      font-size: 13px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: 0.3px;
    }
    .company-subtitle {
      font-size: 8.5px;
      font-weight: 700;
      color: #334155;
      text-transform: uppercase;
    }
    .company-meta {
      font-size: 8px;
      color: #64748b;
    }
    .orange-badge-title {
      background: #f97316;
      color: #ffffff;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 900;
      text-align: center;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      border-radius: 3px;
      display: inline-block;
      min-width: 190px;
    }
    .meta-box-right {
      text-align: right;
      font-size: 8px;
      color: #334155;
      line-height: 1.35;
    }

    /* Sub-cintillo Alcance */
    .alcance-bar {
      border-top: 2px solid #f97316;
      border-bottom: 1px solid #cbd5e1;
      background: #fafafa;
      padding: 4px 8px;
      font-size: 8px;
      color: #334155;
      margin-bottom: 10px;
    }
    .alcance-bar b {
      color: #0f172a;
    }

    /* 4 KPI Cards */
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
      color: #0f172a;
      line-height: 1.1;
    }
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
      color: #0f172a;
      text-transform: uppercase;
      border-left: 3px solid #f97316;
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
      color: #0f172a;
    }
    .dept-pill-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 110px;
    }
    .dept-pill-pct {
      color: #475569;
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
      background: #f97316;
    }
    .dept-pill-montos {
      display: flex;
      justify-content: space-between;
      font-size: 8.5px;
      font-weight: 800;
    }
    .dept-pill-usd {
      color: #ea580c;
    }
    .dept-pill-bs {
      color: #166534;
      font-size: 8px;
    }
    .dept-pill-footer {
      display: flex;
      justify-content: space-between;
      font-size: 6.8px;
      color: #64748b;
      margin-top: 3px;
    }

    /* Secciones y Tablas */
    .section-title-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left: 3px solid #f97316;
      padding: 4px 8px;
      font-size: 8.5px;
      color: #0f172a;
      margin-bottom: 4px;
      margin-top: 10px;
    }
    .report-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7.8px;
      margin-bottom: 4px;
    }
    .report-table th {
      background: #f97316;
      color: #ffffff;
      font-size: 7.8px;
      font-weight: 800;
      padding: 4px 5px;
      text-align: left;
      text-transform: uppercase;
      border: 1px solid #ea580c;
    }
    .report-table thead {
      display: table-header-group;
    }
    .report-table td {
      padding: 3.5px 5px;
      border: 1px solid #e2e8f0;
      vertical-align: top;
    }
    .report-table tr {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .report-table tfoot {
      display: table-row-group; /* Totales una sola vez */
    }
    .report-table tfoot td {
      background: #f1f5f9;
      font-weight: 900;
      border-top: 2px solid #0f172a;
      color: #0f172a;
    }
    .table-footnote {
      font-size: 7.2px;
      color: #64748b;
      font-style: italic;
      margin-bottom: 10px;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .font-bold { font-weight: 800; }
    .font-mono { font-family: monospace; }
    .status-badge {
      display: inline-block;
      font-size: 7px;
      font-weight: 800;
      text-transform: uppercase;
      color: #0f172a;
    }
    .items-cell {
      font-size: 7.2px;
      color: #334155;
      line-height: 1.25;
    }
    .note-cell {
      font-size: 7px;
      color: #475569;
      line-height: 1.2;
    }
    .page-break {
      page-break-before: always;
      break-before: always;
    }

    /* Pie de página */
    .footer-note {
      border-top: 1px solid #cbd5e1;
      padding-top: 6px;
      margin-top: 16px;
      display: flex;
      justify-content: space-between;
      font-size: 7.2px;
      color: #64748b;
    }
  </style>
</head>
<body>

  <!-- Membrete Superior -->
  <table class="header-table">
    <tr>
      <td style="width: 60px;">
        <img class="company-logo" src="${logoUri}" alt="Logo"/>
      </td>
      <td style="padding-left: 10px;">
        <div class="company-title">GOLDEN TOUCH 1127 C.A.</div>
        <div class="company-subtitle">EXPLOTACIÓN Y BENEFICIO DE MINERALES</div>
        <div class="company-meta">RIF: J-50129993-5 · Mina Peramanal</div>
        <div class="company-meta">EL CALLAO · ESTADO BOLÍVAR · VENEZUELA</div>
      </td>
      <td style="width: 220px; text-align: right;">
        <div class="orange-badge-title">REPORTE DE COMPRAS</div>
        <div class="meta-box-right" style="margin-top: 6px;">
          <div><b>EMITIDO:</b> ${ahoraStr}</div>
          <div><b>PERÍODO:</b> ${escHtml(config.periodoLabel)}</div>
          <div><b>REGISTROS:</b> ${todasCompras.length} compras (${todasCompras.length} en listado)</div>
        </div>
      </td>
    </tr>
  </table>

  <!-- Sub-cintillo Alcance -->
  <div class="alcance-bar">
    <b>ALCANCE DEL REPORTE:</b> Ámbito: <b>${escHtml(config.ambitoLabel || 'ÓRDENES DE COMPRA')}</b> · Agrupación: <b>${escHtml(config.agrupacionLabel || 'DEPARTAMENTO')}</b> · Formato: <b>CONSOLIDADO</b> · Tasa BCV: <b>${tasaTexto}</b>
  </div>

  <!-- 4 KPI Cards -->
  ${kpisHtml}

  <!-- Distribución puntual Top Gasto -->
  ${distDeptHtml}

  <!-- 1. Ranking de Departamentos -->
  ${rankingHtml}

  <!-- 2. Top Categorías e Ítems -->
  ${topInversionHtml}

  <!-- 3. Listado de Compras Pendientes -->
  ${pendientesHtml}

  <!-- 4. Trazabilidad Consolidada de Todas las Compras -->
  ${trazabilidadHtml}

  <!-- Pie de página institucional -->
  <div class="footer-note">
    <span>Documento generado por el sistema · Reporte de Compras · GOLDEN TOUCH 1127 C.A. · RIF J-50129993-5</span>
    <span>Página 1 de 1</span>
  </div>

</body>
</html>
  `.trim();
}
