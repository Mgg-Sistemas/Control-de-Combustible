// 📊 REPORTE MODIFICABLE DE EMPLEADOS (Nómina → Empleados).
// Arma el cuerpo HTML, estilos y resumen del reporte PDF permitiendo elegir
// qué columnas y bloques salen (incluyendo 🛠️ Habilidades).
import { limpiarHabilidades } from './empleadosHabilidades';

export type OpcionesReporteEmpleados = {
  /** 1️⃣ Columna «#» (numeración consecutiva). */
  numeracion: boolean;
  /** 🪪 Columna «Cédula». */
  cedula: boolean;
  /** 🔢 Columna «Ficha» (N° de carnet/ficha). */
  ficha: boolean;
  /** 🏷️ Columna «Cargo». */
  cargo: boolean;
  /** 🛠️ Columna «Habilidades» (muestra las habilidades cargadas o «—»). */
  habilidades: boolean;
  /** 🏢 Columna «Empresa filtro nómina». Si se apaga, tampoco sale en la cabecera. */
  empresa: boolean;
  /** 🏛️ Columna «Empresa contratista / real». */
  empresaReal: boolean;
  /** 🗂️ Columna «Departamento / Grupo». */
  departamento: boolean;
  /** ● Columna «Estado» (activo / inactivo / otro). */
  estado: boolean;
  /** 📞 Columna «Teléfono». */
  telefono: boolean;
  /** 🏦 Columna «Datos bancarios» (banco, cuenta, titular). */
  datosBancarios: boolean;
  /** 🔎 Bloque superior con los filtros aplicados (Estado, Empresa, Cargo, Búsqueda). */
  cabeceraFiltros: boolean;
  /** 📊 Tabla superior de «Resumen por cargo». */
  resumenCargo: boolean;
  /** 👥 Tabla principal con el listado de trabajadores. */
  listadoPersonas: boolean;
  /** 📝 Línea institucional en texto y pie del sistema en el membrete PDF. */
  marcaTexto: boolean;
};

export const OPCIONES_REPORTE_EMPLEADOS_DEFECTO: OpcionesReporteEmpleados = {
  numeracion: true,
  cedula: true,
  ficha: true,
  cargo: true,
  habilidades: true,
  empresa: true,
  empresaReal: false,
  departamento: false,
  estado: true,
  telefono: true,
  datosBancarios: false,
  cabeceraFiltros: true,
  resumenCargo: true,
  listadoPersonas: true,
  marcaTexto: true,
};

export type EmpleadoParaReporte = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  cedula?: string | null;
  ficha_number?: string | null;
  cargo?: string | null;
  department?: string | null;
  grupo?: string | null;
  status?: string | null;
  phone?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  bank_holder?: string | null;
  bank_cedula?: string | null;
  empresaNomina?: string | null;
  empresaContratista?: string | null;
  habilidades?: readonly string[] | string | null;
};

export type EntradaReporteEmpleados = {
  empleados: readonly EmpleadoParaReporte[];
  estadoTxt: string;
  empresaTxt: string;
  cargoTxt: string;
  busquedaTxt?: string | null;
  opciones?: Partial<OpcionesReporteEmpleados>;
};

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export function resolverOpcionesReporteEmpleados(
  parcial?: Partial<OpcionesReporteEmpleados>
): OpcionesReporteEmpleados {
  return {
    ...OPCIONES_REPORTE_EMPLEADOS_DEFECTO,
    ...(parcial ?? {}),
  };
}

/** Cuenta cuántas columnas están activas en la tabla de personas (incluyendo Empleado). */
export function contarColumnasActivasEmpleados(parcial?: Partial<OpcionesReporteEmpleados>): number {
  const op = resolverOpcionesReporteEmpleados(parcial);
  let n = 1; // Columna «Empleado» siempre presente
  if (op.numeracion) n++;
  if (op.cedula) n++;
  if (op.ficha) n++;
  if (op.cargo) n++;
  if (op.habilidades) n++;
  if (op.empresa) n++;
  if (op.empresaReal) n++;
  if (op.departamento) n++;
  if (op.estado) n++;
  if (op.telefono) n++;
  if (op.datosBancarios) n++;
  return n;
}

export const REPORTE_EMPLEADOS_CSS = `
  .meta{margin:6px 0 12px;padding:8px 12px;background:#F3F6FA;border-left:4px solid #1E3A5F;font-size:11px;color:#374151}
  .meta b{color:#1E3A5F}
  h3.sec{margin:14px 0 6px;font-size:12px;color:#1E3A5F;text-transform:uppercase;letter-spacing:.5px}
  table.sum{width:auto;min-width:280px;margin-bottom:14px}
  .r{text-align:right;font-variant-numeric:tabular-nums}
  .hab-chip{display:inline-block;background:#EEF2F7;border:1px solid #CBD5E1;border-radius:4px;padding:1px 6px;margin:1px 3px 1px 0;font-size:8.5pt;font-weight:700;color:#1E3A5F}
`;

export function cuerpoReporteEmpleados(input: EntradaReporteEmpleados): {
  body: string;
  extraCss: string;
  totalPersonas: number;
  totalCargos: number;
} {
  const op = resolverOpcionesReporteEmpleados(input.opciones);
  const lista = input.empleados ?? [];

  // Agrupación para el resumen por cargo
  const porCargoMap = new Map<string, number>();
  for (const e of lista) {
    const c = String(e.cargo ?? '').trim() || 'Sin cargo';
    porCargoMap.set(c, (porCargoMap.get(c) ?? 0) + 1);
  }
  const resumen = Array.from(porCargoMap.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );

  // 1) Cabecera de filtros (.meta)
  let metaHtml = '';
  if (op.cabeceraFiltros) {
    const partesMeta: string[] = [`<b>Estado:</b> ${esc(input.estadoTxt || 'Todos')}`];
    if (op.empresa) {
      partesMeta.push(`<b>Empresa filtro nómina:</b> ${esc(input.empresaTxt || 'Todas')}`);
    }
    partesMeta.push(`<b>Cargo:</b> ${esc(input.cargoTxt || 'Todos')}`);
    if (input.busquedaTxt && input.busquedaTxt.trim()) {
      partesMeta.push(`<b>Búsqueda:</b> «${esc(input.busquedaTxt.trim())}»`);
    }
    metaHtml = `<div class="meta">${partesMeta.join(' &nbsp;·&nbsp; ')}</div>`;
  }

  // 2) Tabla de resumen por cargo
  let resumenHtml = '';
  if (op.resumenCargo && resumen.length > 0) {
    const resumenRows = resumen
      .map(([c, n]) => `<tr><td>${esc(c)}</td><td class="r"><b>${n}</b></td></tr>`)
      .join('');
    resumenHtml = `
      <h3 class="sec">Resumen por cargo (${resumen.length})</h3>
      <table class="sum">
        <thead><tr><th>Cargo</th><th class="r">Personas</th></tr></thead>
        <tbody>${resumenRows}</tbody>
        <tfoot><tr><td>TOTAL</td><td class="r">${lista.length}</td></tr></tfoot>
      </table>`;
  }

  // 3) Tabla principal de empleados
  let listadoHtml = '';
  if (op.listadoPersonas) {
    const ths: string[] = [];
    if (op.numeracion) ths.push('<th>#</th>');
    ths.push('<th>Empleado</th>');
    if (op.cedula) ths.push('<th>Cédula</th>');
    if (op.ficha) ths.push('<th>Ficha</th>');
    if (op.cargo) ths.push('<th>Cargo</th>');
    if (op.habilidades) ths.push('<th>Habilidades</th>');
    if (op.empresa) ths.push('<th>Empresa filtro nómina</th>');
    if (op.empresaReal) ths.push('<th>Empresa contratista</th>');
    if (op.departamento) ths.push('<th>Departamento / Grupo</th>');
    if (op.estado) ths.push('<th>Estado</th>');
    if (op.telefono) ths.push('<th>Teléfono</th>');
    if (op.datosBancarios) ths.push('<th>Datos bancarios</th>');

    const numCols = ths.length;

    const rows = lista
      .map((e, i) => {
        const nombreCompleto = `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || '—';
        const habs = limpiarHabilidades(e.habilidades);
        const habsCell =
          habs.length > 0
            ? habs.map((h) => `<span class="hab-chip">${esc(h)}</span>`).join(' ')
            : '—';
        const deptoGrupo = [e.department, e.grupo].filter(Boolean).join(' · ') || '—';
        const bancoPartes = [
          e.bank_name,
          e.bank_account ? `CTA. ${e.bank_account}` : null,
          e.bank_holder,
          e.bank_cedula ? `C.I ${e.bank_cedula}` : null,
        ].filter(Boolean);
        const bancoTxt = bancoPartes.length > 0 ? bancoPartes.join(' · ') : '—';

        const tds: string[] = [];
        if (op.numeracion) tds.push(`<td class="r">${i + 1}</td>`);
        tds.push(`<td><b>${esc(nombreCompleto)}</b></td>`);
        if (op.cedula) tds.push(`<td>${esc(e.cedula || '—')}</td>`);
        if (op.ficha) tds.push(`<td>${esc(e.ficha_number || '—')}</td>`);
        if (op.cargo) tds.push(`<td>${esc(e.cargo || 'Sin cargo')}</td>`);
        if (op.habilidades) tds.push(`<td>${habsCell}</td>`);
        if (op.empresa) tds.push(`<td>${esc(e.empresaNomina || 'Sin empresa')}</td>`);
        if (op.empresaReal) tds.push(`<td>${esc(e.empresaContratista || 'Sin empresa')}</td>`);
        if (op.departamento) tds.push(`<td>${esc(deptoGrupo)}</td>`);
        if (op.estado) tds.push(`<td>${esc(e.status || '—')}</td>`);
        if (op.telefono) tds.push(`<td>${esc(e.phone || '—')}</td>`);
        if (op.datosBancarios) tds.push(`<td>${esc(bancoTxt)}</td>`);

        return `<tr>${tds.join('')}</tr>`;
      })
      .join('');

    const tbody = rows || `<tr><td colspan="${numCols}">Sin empleados</td></tr>`;
    listadoHtml = `
      <h3 class="sec">Listado (${lista.length})</h3>
      <table>
        <thead><tr>${ths.join('')}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>`;
  }

  const numColsActivas = contarColumnasActivasEmpleados(op);
  const extraCss =
    REPORTE_EMPLEADOS_CSS +
    (numColsActivas >= 9 ? '\n  @page { size: landscape; margin: 1.2cm; }\n  table { font-size: 9pt; }' : '');

  return {
    body: metaHtml + resumenHtml + listadoHtml,
    extraCss,
    totalPersonas: lista.length,
    totalCargos: resumen.length,
  };
}

