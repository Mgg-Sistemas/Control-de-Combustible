// 📊 REPORTE MODIFICABLE DE EMPLEADOS (Nómina → Empleados).
// Arma el cuerpo HTML, estilos y resumen del reporte PDF permitiendo elegir
// qué columnas y bloques salen (incluyendo 🛠️ Habilidades).
import { limpiarHabilidades } from './empleadosHabilidades';

export type OpcionesReporteEmpleados = {
  /** 1️⃣ Columna «#» (numeración consecutiva). */
  numeracion: boolean;
  /** 👤 Columna «Empleado» (nombre y apellido). */
  empleado: boolean;
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
  /** 🗂️ Columna «Departamento» (solo departamento, sin grupo ni dirección). */
  departamento: boolean;
  /** ● Columna «Estado» (activo / inactivo / otro). */
  estado: boolean;
  /** 📞 Columna «Teléfono». */
  telefono: boolean;
  /** 💵 Columna «Por Día» (cuánto gana por día: `precio_dia` o calculado desde semanal/quincenal/mensual). */
  salarioDiario: boolean;
  /** 💵 Columna «Por Semana» (cuánto gana por semana: `base_salary` / `precio_semana` o calculado). */
  salarioSemanal: boolean;
  /** 💵 Columna «Quincenal» (cuánto gana quincenal: `precio_quincena` o 2 semanas). */
  salarioQuincenal: boolean;
  /** 💵 Columna «Mensual» (cuánto gana mensual: `precio_mes` o 4 semanas). */
  salarioMensual: boolean;
  /** 🏦 Columna «Datos bancarios» (banco, cuenta, titular). */
  datosBancarios: boolean;
  /** 🧱 Cuadros superiores de resumen (Total empleados, Cargos, Departamentos, Empresas). */
  cuadrosResumen: boolean;
  /** 🔎 Bloque superior con los filtros aplicados (Estado, Empresa, Departamento, Cargo, Búsqueda). */
  cabeceraFiltros: boolean;
  /** 📊 Tabla superior de «Resumen por cargo». */
  resumenCargo: boolean;
  /** 🗂️ Tabla superior de «Resumen por departamento». */
  resumenDepartamento: boolean;
  /** 👥 Tabla principal con el listado de trabajadores. */
  listadoPersonas: boolean;
  /** 📝 Línea institucional en texto y pie del sistema en el membrete PDF. */
  marcaTexto: boolean;
  /** ✍️ Bloque de firmas al final del reporte (1 o más personas). */
  firmas: boolean;
};

export type FirmanteReporteEmpleados = {
  nombre: string;
  cargo?: string | null;
  cedula?: string | null;
};

export const FIRMANTE_EMPLEADOS_DEFECTO: FirmanteReporteEmpleados = {
  nombre: '',
  cargo: 'Recursos Humanos / Administración',
  cedula: '',
};

export const OPCIONES_REPORTE_EMPLEADOS_DEFECTO: OpcionesReporteEmpleados = {
  numeracion: true,
  empleado: true,
  cedula: true,
  ficha: true,
  cargo: true,
  habilidades: true,
  empresa: true,
  empresaReal: false,
  departamento: false,
  estado: true,
  telefono: true,
  salarioDiario: false,
  salarioSemanal: false,
  salarioQuincenal: false,
  salarioMensual: false,
  datosBancarios: false,
  cuadrosResumen: true,
  cabeceraFiltros: true,
  resumenCargo: true,
  resumenDepartamento: false,
  listadoPersonas: true,
  marcaTexto: true,
  firmas: false,
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
  base_salary?: number | string | null;
  precio_dia?: number | string | null;
  precio_noche?: number | string | null;
  precio_semana?: number | string | null;
  precio_quincena?: number | string | null;
  precio_mes?: number | string | null;
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
  departamentoTxt?: string | null;
  cargoTxt: string;
  busquedaTxt?: string | null;
  opciones?: Partial<OpcionesReporteEmpleados>;
  firmantes?: readonly FirmanteReporteEmpleados[] | null;
};

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Devuelve ÚNICAMENTE el departamento del empleado (`department`), sin mezclar
 * jamás el campo `grupo` ni la dirección/parroquia (ej. «CAMURI CHICO», «LA GUAIRA»).
 * Si algún registro tuviera pegado ` · <grupo>` al final del departamento, lo limpia.
 */
export function limpiarSoloDepartamento(
  department?: string | null,
  grupo?: string | null
): string {
  let d = String(department ?? '').replace(/\s+/g, ' ').trim();
  if (!d) return '';
  const g = String(grupo ?? '').replace(/\s+/g, ' ').trim();
  if (g) {
    const sufijos = [` · ${g}`, ` - ${g}`, ` / ${g}`, `, ${g}`];
    for (const s of sufijos) {
      if (d.toUpperCase().endsWith(s.toUpperCase())) {
        d = d.slice(0, d.length - s.length).trim();
      }
    }
  }
  return d;
}

export type SalariosEmpleadoReporte = {
  diario: number | null;
  semanal: number | null;
  quincenal: number | null;
  mensual: number | null;
};

const numPos = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const r2 = (n: number | null): number | null =>
  n !== null && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;

/**
 * Calcula cuánto gana un empleado en las 4 frecuencias del reporte:
 * - `diario` (Por Día): usa `precio_dia` (o `semanal / 7` si solo tiene semanal).
 * - `semanal` (Por Semana): usa `base_salary` o `precio_semana` (o `diario * 7` / `quincenal / 2` / `mensual / 4`).
 * - `quincenal` (Quincenal): usa `precio_quincena` (si es >= semanal) o `semanal * 2` (2 semanas).
 * - `mensual` (Mensual): usa `precio_mes` (si es > semanal) o `semanal * 4` (4 semanas).
 */
export function calcularSalariosEmpleadoReporte(e?: {
  base_salary?: number | string | null;
  precio_dia?: number | string | null;
  precio_semana?: number | string | null;
  precio_quincena?: number | string | null;
  precio_mes?: number | string | null;
} | null): SalariosEmpleadoReporte {
  if (!e) return { diario: null, semanal: null, quincenal: null, mensual: null };
  const rawBase = numPos(e.base_salary);
  const rawSem = numPos(e.precio_semana);
  const rawDia = numPos(e.precio_dia);
  const rawQuin = numPos(e.precio_quincena);
  const rawMes = numPos(e.precio_mes);

  const semDirecto = rawBase ?? rawSem;

  // Si `precio_dia` quedó inflado ×100 por un punto decimal omitido (ej. 3571 cuando sem=250 → 35.71)
  // o si alguien copió el sueldo semanal en `precio_dia` (ej. 300 y 300), se normaliza a la tarifa diaria real.
  let diaLimpio = rawDia;
  if (rawDia !== null && semDirecto !== null) {
    if (Math.abs(rawDia / 100 - semDirecto / 7) < 0.5) {
      diaLimpio = rawDia / 100;
    } else if (rawDia >= semDirecto && semDirecto > 0) {
      diaLimpio = semDirecto / 7;
    }
  } else if (rawDia !== null && rawQuin !== null && Math.abs(rawDia / 100 - rawQuin / 7) < 0.5) {
    diaLimpio = rawDia / 100;
  }

  const semanal =
    semDirecto !== null
      ? semDirecto
      : rawQuin !== null
      ? rawQuin / 2
      : rawMes !== null
      ? rawMes / 4
      : diaLimpio !== null
      ? diaLimpio * 7
      : null;

  const diario =
    diaLimpio !== null
      ? diaLimpio
      : semanal !== null
      ? semanal / 7
      : null;

  const quincenal =
    rawQuin !== null && (semanal === null || rawQuin >= semanal)
      ? rawQuin
      : semanal !== null
      ? semanal * 2
      : rawMes !== null
      ? rawMes / 2
      : diario !== null
      ? diario * 14
      : null;

  const mensual =
    rawMes !== null && (semanal === null || rawMes > semanal)
      ? rawMes
      : semanal !== null
      ? semanal * 4
      : quincenal !== null
      ? quincenal * 2
      : diario !== null
      ? diario * 28
      : null;

  return {
    diario: r2(diario),
    semanal: r2(semanal),
    quincenal: r2(quincenal),
    mensual: r2(mensual),
  };
}

/** Formatea un monto en dólares como `$200,00` o devuelve `'—'` si es `null`. */
export function formatearMontoSalarioReporte(val?: number | null): string {
  if (val === null || val === undefined || !Number.isFinite(val) || val <= 0) return '—';
  const [ent, dec] = val.toFixed(2).split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${miles},${dec}`;
}

export function leerSalarioDiarioEmpleado(e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0]): number | null {
  return calcularSalariosEmpleadoReporte(e).diario;
}

/**
 * Obtiene el Salario Semanal del trabajador: toma primero `base_salary` (campo
 * «Salario Semanal» de la ficha) y, si no está cargado, cae a `precio_semana`
 * (o convierte desde tarifa diaria/quincenal/mensual). Devuelve `null` si no tiene monto (> 0).
 */
export function leerSalarioSemanalEmpleado(e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0]): number | null {
  return calcularSalariosEmpleadoReporte(e).semanal;
}

export function leerSalarioQuincenalEmpleado(e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0]): number | null {
  return calcularSalariosEmpleadoReporte(e).quincenal;
}

export function leerSalarioMensualEmpleado(e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0]): number | null {
  return calcularSalariosEmpleadoReporte(e).mensual;
}

export function formatearSalarioDiarioReporte(e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0]): string {
  return formatearMontoSalarioReporte(leerSalarioDiarioEmpleado(e));
}

/** Formatea un monto de salario semanal como `$200,00` o devuelve `'—'` si no tiene. */
export function formatearSalarioSemanalReporte(e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0]): string {
  return formatearMontoSalarioReporte(leerSalarioSemanalEmpleado(e));
}

export function formatearSalarioQuincenalReporte(e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0]): string {
  return formatearMontoSalarioReporte(leerSalarioQuincenalEmpleado(e));
}

export function formatearSalarioMensualReporte(e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0]): string {
  return formatearMontoSalarioReporte(leerSalarioMensualEmpleado(e));
}

export function resolverOpcionesReporteEmpleados(
  parcial?: Partial<OpcionesReporteEmpleados>
): OpcionesReporteEmpleados {
  return {
    ...OPCIONES_REPORTE_EMPLEADOS_DEFECTO,
    ...(parcial ?? {}),
  };
}

/** Cuenta cuántas columnas están activas en la tabla de personas. */
export function contarColumnasActivasEmpleados(parcial?: Partial<OpcionesReporteEmpleados>): number {
  const op = resolverOpcionesReporteEmpleados(parcial);
  let n = 0;
  if (op.numeracion) n++;
  if (op.empleado) n++;
  if (op.cedula) n++;
  if (op.ficha) n++;
  if (op.cargo) n++;
  if (op.habilidades) n++;
  if (op.empresa) n++;
  if (op.empresaReal) n++;
  if (op.departamento) n++;
  if (op.estado) n++;
  if (op.telefono) n++;
  if (op.salarioDiario) n++;
  if (op.salarioSemanal) n++;
  if (op.salarioQuincenal) n++;
  if (op.salarioMensual) n++;
  if (op.datosBancarios) n++;
  return Math.max(1, n);
}

export const REPORTE_EMPLEADOS_CSS = `
  table{width:100%;border-collapse:collapse;font-size:10.5px;margin-top:6px;margin-bottom:14px}
  th{background:#1E3A5F;color:#fff;padding:6px 8px;text-align:left;font-size:10px;font-weight:800;border:1px solid #1E3A5F;letter-spacing:.3px}
  td{border:1px solid #CBD5E1;padding:5px 8px;vertical-align:middle;color:#1F2937}
  tbody tr:nth-child(even) td{background:#F8FAFC}
  tfoot td{border:1px solid #1E3A5F;border-top:2px solid #1E3A5F;background:#EEF2F7;font-weight:800;color:#1E3A5F;padding:6px 8px}
  .c{text-align:center;font-variant-numeric:tabular-nums}
  .r{text-align:right;font-variant-numeric:tabular-nums}
  .nw{white-space:nowrap}
  .tiles{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 12px}
  .tile{border:1px solid #CBD5E1;border-top:3px solid #1E3A5F;border-radius:6px;padding:8px 14px;background:#F8FAFC;min-width:125px}
  .tile .t{font-size:18px;font-weight:800;color:#1E3A5F;line-height:1.15;font-variant-numeric:tabular-nums}
  .tile .s{font-size:9.5px;font-weight:700;color:#4B5563;margin-top:2px}
  .meta{margin:6px 0 12px;padding:8px 12px;background:#F3F6FA;border:1px solid #CBD5E1;border-left:4px solid #1E3A5F;border-radius:6px;font-size:10.5px;color:#374151;line-height:1.5}
  .meta b{color:#1E3A5F}
  .sec-grid{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-bottom:8px}
  .sec-box{flex:1;min-width:260px}
  h3.sec{margin:12px 0 6px;padding:5px 10px;background:#EEF2F7;border:1px solid #CBD5E1;border-left:4px solid #1E3A5F;border-radius:4px;font-size:11px;font-weight:800;color:#1E3A5F;text-transform:uppercase;letter-spacing:.5px}
  table.sum{width:100%;margin-top:4px;margin-bottom:10px}
  .hab-chip{display:inline-block;background:#EEF2F7;border:1px solid #CBD5E1;border-radius:4px;padding:1px 6px;margin:1px 3px 1px 0;font-size:8.5pt;font-weight:700;color:#1E3A5F}
  .firmas-wrap{margin-top:34px;page-break-inside:avoid;break-inside:avoid}
  .firmas-grid{display:flex;flex-wrap:wrap;justify-content:space-around;gap:28px 32px;margin-top:16px}
  .firma-box{flex:1 1 180px;max-width:260px;min-width:160px;text-align:center;padding-top:38px}
  .firma-linea{border-top:1.5px solid #1E3A5F;padding-top:6px;margin:0 6px}
  .firma-nom{font-weight:800;color:#1E3A5F;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px}
  .firma-cargo{font-weight:700;color:#374151;font-size:9.5px;margin-top:2px}
  .firma-ci{color:#6B7280;font-size:9px;margin-top:1px}
`;

export function cuerpoReporteEmpleados(input: EntradaReporteEmpleados): {
  body: string;
  extraCss: string;
  totalPersonas: number;
  totalCargos: number;
  totalDepartamentos: number;
} {
  const op = resolverOpcionesReporteEmpleados(input.opciones);
  const lista = input.empleados ?? [];

  // Agrupación para el resumen por cargo
  const porCargoMap = new Map<string, number>();
  // Agrupación para el resumen por departamento (SOLO department, nunca grupo/dirección)
  const porDeptoMap = new Map<string, number>();
  const empresasSet = new Set<string>();
  let totalSalarioDiario = 0;
  let totalSalarioSemanal = 0;
  let totalSalarioQuincenal = 0;
  let totalSalarioMensual = 0;

  for (const e of lista) {
    const c = String(e.cargo ?? '').trim() || 'Sin cargo';
    porCargoMap.set(c, (porCargoMap.get(c) ?? 0) + 1);

    const d = limpiarSoloDepartamento(e.department, e.grupo) || 'Sin departamento';
    porDeptoMap.set(d, (porDeptoMap.get(d) ?? 0) + 1);

    const emp = String(e.empresaNomina ?? '').trim();
    if (emp && emp !== 'Sin empresa de filtro') empresasSet.add(emp);

    const sals = calcularSalariosEmpleadoReporte(e);
    if (sals.diario !== null) totalSalarioDiario += sals.diario;
    if (sals.semanal !== null) totalSalarioSemanal += sals.semanal;
    if (sals.quincenal !== null) totalSalarioQuincenal += sals.quincenal;
    if (sals.mensual !== null) totalSalarioMensual += sals.mensual;
  }
  totalSalarioDiario = Math.round(totalSalarioDiario * 100) / 100;
  totalSalarioSemanal = Math.round(totalSalarioSemanal * 100) / 100;
  totalSalarioQuincenal = Math.round(totalSalarioQuincenal * 100) / 100;
  totalSalarioMensual = Math.round(totalSalarioMensual * 100) / 100;

  const totalSalarioDiarioTxt = formatearMontoSalarioReporte(totalSalarioDiario);
  const totalSalarioSemanalTxt = formatearMontoSalarioReporte(totalSalarioSemanal);
  const totalSalarioQuincenalTxt = formatearMontoSalarioReporte(totalSalarioQuincenal);
  const totalSalarioMensualTxt = formatearMontoSalarioReporte(totalSalarioMensual);

  const resumen = Array.from(porCargoMap.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const resumenDepto = Array.from(porDeptoMap.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );

  // 0) Cuadros superiores de resumen (.tiles)
  let tilesHtml = '';
  if (op.cuadrosResumen) {
    const tiles: string[] = [
      `<div class="tile"><div class="t">${lista.length}</div><div class="s">Empleados en el reporte</div></div>`,
    ];
    if (op.cargo || op.resumenCargo) {
      tiles.push(`<div class="tile"><div class="t">${resumen.length}</div><div class="s">Cargo(s)</div></div>`);
    }
    if (op.departamento || op.resumenDepartamento || (input.departamentoTxt && input.departamentoTxt !== 'Todos')) {
      tiles.push(`<div class="tile"><div class="t">${resumenDepto.length}</div><div class="s">Departamento(s)</div></div>`);
    }
    if (op.empresa && empresasSet.size > 0) {
      tiles.push(`<div class="tile"><div class="t">${empresasSet.size}</div><div class="s">Empresa(s) nómina</div></div>`);
    }
    if (op.salarioDiario && totalSalarioDiario > 0) {
      tiles.push(`<div class="tile"><div class="t">${esc(totalSalarioDiarioTxt)}</div><div class="s">Total Por Día</div></div>`);
    }
    if (op.salarioSemanal && totalSalarioSemanal > 0) {
      tiles.push(`<div class="tile"><div class="t">${esc(totalSalarioSemanalTxt)}</div><div class="s">Total Por Semana</div></div>`);
    }
    if (op.salarioQuincenal && totalSalarioQuincenal > 0) {
      tiles.push(`<div class="tile"><div class="t">${esc(totalSalarioQuincenalTxt)}</div><div class="s">Total Quincenal</div></div>`);
    }
    if (op.salarioMensual && totalSalarioMensual > 0) {
      tiles.push(`<div class="tile"><div class="t">${esc(totalSalarioMensualTxt)}</div><div class="s">Total Mensual</div></div>`);
    }
    tilesHtml = `<div class="tiles">${tiles.join('')}</div>`;
  }

  // 1) Cabecera de filtros (.meta)
  let metaHtml = '';
  if (op.cabeceraFiltros) {
    const partesMeta: string[] = [`<b>Estado:</b> ${esc(input.estadoTxt || 'Todos')}`];
    if (op.empresa) {
      partesMeta.push(`<b>Empresa filtro nómina:</b> ${esc(input.empresaTxt || 'Todas')}`);
    }
    if (op.departamento || op.resumenDepartamento || (input.departamentoTxt && input.departamentoTxt !== 'Todos' && input.departamentoTxt !== 'Todos los departamentos')) {
      partesMeta.push(`<b>Departamento:</b> ${esc(input.departamentoTxt || 'Todos')}`);
    }
    if (op.cargo || op.resumenCargo) {
      partesMeta.push(`<b>Cargo:</b> ${esc(input.cargoTxt || 'Todos')}`);
    }
    if (input.busquedaTxt && input.busquedaTxt.trim()) {
      partesMeta.push(`<b>Búsqueda:</b> «${esc(input.busquedaTxt.trim())}»`);
    }
    metaHtml = `<div class="meta">${partesMeta.join(' &nbsp;·&nbsp; ')}</div>`;
  }

  // 2) Tablas de resumen en cuadros (Resumen por cargo y/o Resumen por departamento)
  const cajasResumen: string[] = [];
  if (op.resumenCargo && resumen.length > 0) {
    const resumenRows = resumen
      .map(([c, n]) => `<tr><td>${esc(c)}</td><td class="r nw"><b>${n}</b></td></tr>`)
      .join('');
    cajasResumen.push(`
      <div class="sec-box">
        <h3 class="sec">Resumen por cargo (${resumen.length})</h3>
        <table class="sum">
          <thead><tr><th>Cargo</th><th class="r nw" style="width:90px">Personas</th></tr></thead>
          <tbody>${resumenRows}</tbody>
          <tfoot><tr><td>TOTAL</td><td class="r nw">${lista.length}</td></tr></tfoot>
        </table>
      </div>`);
  }
  if (op.resumenDepartamento && resumenDepto.length > 0) {
    const deptoRows = resumenDepto
      .map(([d, n]) => `<tr><td>${esc(d)}</td><td class="r nw"><b>${n}</b></td></tr>`)
      .join('');
    cajasResumen.push(`
      <div class="sec-box">
        <h3 class="sec">Resumen por departamento (${resumenDepto.length})</h3>
        <table class="sum">
          <thead><tr><th>Departamento</th><th class="r nw" style="width:90px">Personas</th></tr></thead>
          <tbody>${deptoRows}</tbody>
          <tfoot><tr><td>TOTAL</td><td class="r nw">${lista.length}</td></tr></tfoot>
        </table>
      </div>`);
  }
  const resumenHtml = cajasResumen.length > 0 ? `<div class="sec-grid">${cajasResumen.join('')}</div>` : '';

  // 3) Tabla principal de empleados
  let listadoHtml = '';
  if (op.listadoPersonas) {
    const ths: string[] = [];
    if (op.numeracion) ths.push('<th class="r nw" style="width:34px">#</th>');
    if (op.empleado !== false) ths.push('<th>Empleado</th>');
    if (op.cedula) ths.push('<th class="nw">Cédula</th>');
    if (op.ficha) ths.push('<th class="nw">Ficha</th>');
    if (op.cargo) ths.push('<th>Cargo</th>');
    if (op.departamento) ths.push('<th>Departamento</th>');
    if (op.habilidades) ths.push('<th>Habilidades</th>');
    if (op.empresa) ths.push('<th>Empresa filtro nómina</th>');
    if (op.empresaReal) ths.push('<th>Empresa contratista</th>');
    if (op.estado) ths.push('<th class="c nw">Estado</th>');
    if (op.telefono) ths.push('<th class="nw">Teléfono</th>');
    if (op.salarioDiario) ths.push('<th class="r nw">Por Día</th>');
    if (op.salarioSemanal) ths.push('<th class="r nw">Por Semana</th>');
    if (op.salarioQuincenal) ths.push('<th class="r nw">Quincenal</th>');
    if (op.salarioMensual) ths.push('<th class="r nw">Mensual</th>');
    if (op.datosBancarios) ths.push('<th>Datos bancarios</th>');

    if (ths.length === 0) {
      ths.push('<th>Empleado</th>');
    }
    const numCols = ths.length;

    const rows = lista
      .map((e, i) => {
        const nombreCompleto = `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || '—';
        const habs = limpiarHabilidades(e.habilidades);
        const habsCell =
          habs.length > 0
            ? habs.map((h) => `<span class="hab-chip">${esc(h)}</span>`).join(' ')
            : '—';
        // ⭐ SOLO DEPARTAMENTO: nunca concatena `e.grupo` ni dirección
        const deptoSolo = limpiarSoloDepartamento(e.department, e.grupo) || '—';
        const sals = calcularSalariosEmpleadoReporte(e);
        const salDiaTxt = formatearMontoSalarioReporte(sals.diario);
        const salSemTxt = formatearMontoSalarioReporte(sals.semanal);
        const salQuinTxt = formatearMontoSalarioReporte(sals.quincenal);
        const salMesTxt = formatearMontoSalarioReporte(sals.mensual);
        const bancoPartes = [
          e.bank_name,
          e.bank_account ? `CTA. ${e.bank_account}` : null,
          e.bank_holder,
          e.bank_cedula ? `C.I ${e.bank_cedula}` : null,
        ].filter(Boolean);
        const bancoTxt = bancoPartes.length > 0 ? bancoPartes.join(' · ') : '—';

        const tds: string[] = [];
        if (op.numeracion) tds.push(`<td class="r nw">${i + 1}</td>`);
        if (op.empleado !== false || (tds.length === 0 && !op.cedula && !op.ficha && !op.cargo && !op.departamento && !op.habilidades && !op.empresa && !op.empresaReal && !op.estado && !op.telefono && !op.salarioDiario && !op.salarioSemanal && !op.salarioQuincenal && !op.salarioMensual && !op.datosBancarios)) {
          tds.push(`<td><b>${esc(nombreCompleto)}</b></td>`);
        }
        if (op.cedula) tds.push(`<td class="nw">${esc(e.cedula || '—')}</td>`);
        if (op.ficha) tds.push(`<td class="nw">${esc(e.ficha_number || '—')}</td>`);
        if (op.cargo) tds.push(`<td>${esc(e.cargo || 'Sin cargo')}</td>`);
        if (op.departamento) tds.push(`<td>${esc(deptoSolo)}</td>`);
        if (op.habilidades) tds.push(`<td>${habsCell}</td>`);
        if (op.empresa) tds.push(`<td>${esc(e.empresaNomina || 'Sin empresa')}</td>`);
        if (op.empresaReal) tds.push(`<td>${esc(e.empresaContratista || 'Sin empresa')}</td>`);
        if (op.estado) tds.push(`<td class="c nw">${esc(e.status || '—')}</td>`);
        if (op.telefono) tds.push(`<td class="nw">${esc(e.phone || '—')}</td>`);
        if (op.salarioDiario) tds.push(`<td class="r nw">${sals.diario !== null ? `<b>${esc(salDiaTxt)}</b>` : '—'}</td>`);
        if (op.salarioSemanal) tds.push(`<td class="r nw">${sals.semanal !== null ? `<b>${esc(salSemTxt)}</b>` : '—'}</td>`);
        if (op.salarioQuincenal) tds.push(`<td class="r nw">${sals.quincenal !== null ? `<b>${esc(salQuinTxt)}</b>` : '—'}</td>`);
        if (op.salarioMensual) tds.push(`<td class="r nw">${sals.mensual !== null ? `<b>${esc(salMesTxt)}</b>` : '—'}</td>`);
        if (op.datosBancarios) tds.push(`<td>${esc(bancoTxt)}</td>`);

        return `<tr>${tds.join('')}</tr>`;
      })
      .join('');

    const partesTfoot: string[] = [`TOTAL: ${lista.length} empleado(s)`];
    if (op.salarioDiario && totalSalarioDiario > 0) {
      partesTfoot.push(`POR DÍA TOTAL: ${esc(totalSalarioDiarioTxt)}`);
    }
    if (op.salarioSemanal && totalSalarioSemanal > 0) {
      partesTfoot.push(`POR SEMANA TOTAL: ${esc(totalSalarioSemanalTxt)}`);
    }
    if (op.salarioQuincenal && totalSalarioQuincenal > 0) {
      partesTfoot.push(`QUINCENAL TOTAL: ${esc(totalSalarioQuincenalTxt)}`);
    }
    if (op.salarioMensual && totalSalarioMensual > 0) {
      partesTfoot.push(`MENSUAL TOTAL: ${esc(totalSalarioMensualTxt)}`);
    }
    const tfootTxt = partesTfoot.join(' &nbsp;·&nbsp; ');
    const tbody = rows || `<tr><td colspan="${numCols}" class="c">Sin empleados</td></tr>`;
    listadoHtml = `
      <h3 class="sec">Listado de empleados (${lista.length})</h3>
      <table>
        <thead><tr>${ths.join('')}</tr></thead>
        <tbody>${tbody}</tbody>
        <tfoot><tr><td colspan="${numCols}">${tfootTxt}</td></tr></tfoot>
      </table>`;
  }

  // 4) Bloque de firmas al final (1 o más personas configurables)
  let firmasHtml = '';
  if (op.firmas) {
    const listaFirmantes =
      Array.isArray(input.firmantes) && input.firmantes.length > 0
        ? input.firmantes
        : [FIRMANTE_EMPLEADOS_DEFECTO];
    const cajasFirma = listaFirmantes
      .map((f) => {
        const nom = String(f?.nombre ?? '').trim();
        const crg = String(f?.cargo ?? '').trim();
        const ced = String(f?.cedula ?? '').trim();
        return `<div class="firma-box">
          <div class="firma-linea">
            <div class="firma-nom">${nom ? esc(nom) : '&nbsp;'}</div>
            ${crg ? `<div class="firma-cargo">${esc(crg)}</div>` : '<div class="firma-cargo">Firma autorizada</div>'}
            ${ced ? `<div class="firma-ci">C.I. ${esc(ced)}</div>` : ''}
          </div>
        </div>`;
      })
      .join('');
    firmasHtml = `<div class="firmas-wrap"><div class="firmas-grid">${cajasFirma}</div></div>`;
  }

  const numColsActivas = contarColumnasActivasEmpleados(op);
  const extraCss =
    REPORTE_EMPLEADOS_CSS +
    (numColsActivas >= 9 ? '\n  @page { size: landscape; margin: 1.2cm; }\n  table { font-size: 9pt; }' : '');

  return {
    body: tilesHtml + metaHtml + resumenHtml + listadoHtml + firmasHtml,
    extraCss,
    totalPersonas: lista.length,
    totalCargos: resumen.length,
    totalDepartamentos: resumenDepto.length,
  };
}

