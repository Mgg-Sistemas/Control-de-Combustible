// 📊 REPORTE MODIFICABLE DE EMPLEADOS (Nómina → Empleados).
// Arma el cuerpo HTML, estilos y resumen del reporte PDF permitiendo elegir
// qué columnas y bloques salen (incluyendo 🛠️ Habilidades).
import { limpiarHabilidades } from './empleadosHabilidades';
import { estadoCartaBancoTercero } from './cartaBancoTercero';

export type OrdenReporteEmpleados =
  | 'nombre_az'
  | 'nombre_za'
  | 'cargo_az'
  | 'departamento_az'
  | 'cedula'
  | 'ficha'
  | 'salario_desc';

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
  /** 📅 Columna «Fecha de ingreso». */
  fechaIngreso?: boolean;
  /** 📅 Columna «Trabajó hasta» (fecha de egreso/inactivación). */
  fechaEgreso?: boolean;
  /** 📞 Columna «Teléfono». */
  telefono: boolean;
  /** ☀️ Columna «Por Día (Diurno)» (cuánto gana en turno diurno: `precio_dia` o calculado desde semanal/quincenal/mensual). */
  salarioDiario: boolean;
  /** 🌙 Columna «Por Noche (Nocturno)» (cuánto gana en turno nocturno: `precio_noche`). */
  salarioNocturno?: boolean;
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
  /** 💵 Mostrar montos salariales (mensual/diario) en la tabla de «Resumen por departamento». */
  salarioPorDepartamento?: boolean;
  /** 👥 Tabla principal con el listado de trabajadores. */
  listadoPersonas: boolean;
  /** 📝 Línea institucional en texto y pie del sistema en el membrete PDF. */
  marcaTexto: boolean;
  /** ✍️ Bloque de firmas al final del reporte (1 o más personas). */
  firmas: boolean;
  /** ↕️ Cómo ordenar el listado de personas en el reporte (nombre, cargo, departamento, etc.). */
  ordenarPor?: OrdenReporteEmpleados;
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
  fechaIngreso: false,
  fechaEgreso: false,
  telefono: true,
  salarioDiario: false,
  salarioNocturno: false,
  salarioSemanal: false,
  salarioQuincenal: false,
  salarioMensual: false,
  datosBancarios: false,
  cuadrosResumen: true,
  cabeceraFiltros: true,
  resumenCargo: true,
  resumenDepartamento: false,
  salarioPorDepartamento: true,
  listadoPersonas: true,
  marcaTexto: true,
  firmas: false,
  ordenarPor: 'nombre_az',
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
  hire_date?: string | null;
  fecha_egreso?: string | null;
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
  carta_banco_tercero?: unknown;
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
  fechaIngresoTxt?: string | null;
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
  nocturno: number | null;
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
 * Calcula cuánto gana un empleado en las 5 modalidades del reporte:
 * - `diario` (Por Día / Diurno): usa `precio_dia` (o `semanal / 7` si solo tiene semanal).
 * - `nocturno` (Por Noche / Nocturno): usa `precio_noche`.
 * - `semanal` (Por Semana): usa `base_salary` o `precio_semana` (o `diario * 7` / `nocturno * 7` según turno).
 * - `quincenal` (Quincenal): usa `precio_quincena` (si es >= semanal) o `semanal * 2` (2 semanas).
 * - `mensual` (Mensual): usa `precio_mes` (si es > semanal) o `semanal * 4` (4 semanas).
 */
export function calcularSalariosEmpleadoReporte(
  e?: {
    base_salary?: number | string | null;
    precio_dia?: number | string | null;
    precio_noche?: number | string | null;
    precio_semana?: number | string | null;
    precio_quincena?: number | string | null;
    precio_mes?: number | string | null;
  } | null,
  opts?: { preferirNocturno?: boolean }
): SalariosEmpleadoReporte {
  if (!e) return { diario: null, nocturno: null, semanal: null, quincenal: null, mensual: null };
  const rawBase = numPos(e.base_salary);
  const rawSem = numPos(e.precio_semana);
  const rawDia = numPos(e.precio_dia);
  const rawNoche = numPos(e.precio_noche);
  const rawQuin = numPos(e.precio_quincena);
  const rawMes = numPos(e.precio_mes);

  // Si el cargo es por turno (tiene precio_dia y precio_noche y precio_semana === 0 en el tabulador),
  // el semanal se calcula a partir del turno activo (diurno * 7 o nocturno * 7).
  const esCargoPorTurno =
    rawSem === null &&
    rawDia !== null &&
    rawNoche !== null &&
    e.precio_semana !== null &&
    e.precio_semana !== undefined &&
    e.precio_semana !== '' &&
    Number(String(e.precio_semana).replace(',', '.')) === 0;

  // Si `precio_dia` y `precio_semana` vienen sincronizados del Tabulador de Cargos (dia * 7 ≈ sem),
  // se prioriza `rawSem` sobre un `base_salary` viejo que haya quedado sin actualizar.
  let semDirecto: number | null = null;
  if (!esCargoPorTurno) {
    if (rawDia !== null && rawSem !== null) {
      const diaCand =
        rawDia >= rawSem && Math.abs(rawDia / 100 - rawSem / 7) < 0.5 ? rawDia / 100 : rawDia;
      if (Math.abs(diaCand * 7 - rawSem) < 0.5) {
        semDirecto = rawSem;
      } else {
        semDirecto = rawBase ?? rawSem;
      }
    } else {
      semDirecto = rawBase ?? rawSem;
    }
  }

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

  let nocheLimpio = rawNoche;
  if (rawNoche !== null && semDirecto !== null && Math.abs(rawNoche / 100 - semDirecto / 7) < 0.5) {
    nocheLimpio = rawNoche / 100;
  }

  const usarBaseNocturna =
    Boolean(opts?.preferirNocturno) &&
    nocheLimpio !== null &&
    (semDirecto === null || (diaLimpio !== null && Math.abs(semDirecto - diaLimpio * 7) < 0.5));

  const semanal = usarBaseNocturna
    ? nocheLimpio! * 7
    : semDirecto !== null
    ? semDirecto
    : rawQuin !== null
    ? rawQuin / 2
    : rawMes !== null
    ? rawMes / 4
    : diaLimpio !== null
    ? diaLimpio * 7
    : nocheLimpio !== null
    ? nocheLimpio * 7
    : null;

  const diario =
    diaLimpio !== null
      ? diaLimpio
      : semDirecto !== null
      ? semDirecto / 7
      : semanal !== null && !usarBaseNocturna
      ? semanal / 7
      : null;

  const nocturno = nocheLimpio;

  const quincenal =
    !usarBaseNocturna && rawQuin !== null && (semanal === null || rawQuin >= semanal)
      ? rawQuin
      : semanal !== null
      ? semanal * 2
      : rawMes !== null
      ? rawMes / 2
      : diario !== null
      ? diario * 14
      : null;

  const mensual =
    !usarBaseNocturna && rawMes !== null && (semanal === null || rawMes > semanal)
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
    nocturno: r2(nocturno),
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

export function leerSalarioNocturnoEmpleado(e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0]): number | null {
  return calcularSalariosEmpleadoReporte(e).nocturno;
}

/**
 * Obtiene el Salario Semanal del trabajador: toma primero `base_salary` (campo
 * «Salario Semanal» de la ficha) y, si no está cargado, cae a `precio_semana`
 * (o convierte desde tarifa diaria/nocturna/quincenal/mensual). Devuelve `null` si no tiene monto (> 0).
 */
export function leerSalarioSemanalEmpleado(
  e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0],
  opts?: { preferirNocturno?: boolean }
): number | null {
  return calcularSalariosEmpleadoReporte(e, opts).semanal;
}

export function leerSalarioQuincenalEmpleado(
  e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0],
  opts?: { preferirNocturno?: boolean }
): number | null {
  return calcularSalariosEmpleadoReporte(e, opts).quincenal;
}

export function leerSalarioMensualEmpleado(
  e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0],
  opts?: { preferirNocturno?: boolean }
): number | null {
  return calcularSalariosEmpleadoReporte(e, opts).mensual;
}

export function formatearSalarioDiarioReporte(e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0]): string {
  return formatearMontoSalarioReporte(leerSalarioDiarioEmpleado(e));
}

export function formatearSalarioNocturnoReporte(e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0]): string {
  return formatearMontoSalarioReporte(leerSalarioNocturnoEmpleado(e));
}

/** Formatea un monto de salario semanal como `$200,00` o devuelve `'—'` si no tiene. */
export function formatearSalarioSemanalReporte(
  e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0],
  opts?: { preferirNocturno?: boolean }
): string {
  return formatearMontoSalarioReporte(leerSalarioSemanalEmpleado(e, opts));
}

export function formatearSalarioQuincenalReporte(
  e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0],
  opts?: { preferirNocturno?: boolean }
): string {
  return formatearMontoSalarioReporte(leerSalarioQuincenalEmpleado(e, opts));
}

export function formatearSalarioMensualReporte(
  e?: Parameters<typeof calcularSalariosEmpleadoReporte>[0],
  opts?: { preferirNocturno?: boolean }
): string {
  return formatearMontoSalarioReporte(leerSalarioMensualEmpleado(e, opts));
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
  if (op.fechaIngreso) n++;
  if (op.fechaEgreso) n++;
  if (op.telefono) n++;
  if (op.salarioDiario) n++;
  if (op.salarioNocturno) n++;
  if (op.salarioSemanal) n++;
  if (op.salarioQuincenal) n++;
  if (op.salarioMensual) n++;
  if (op.datosBancarios) n++;
  return Math.max(1, n);
}

/** Formatea una fecha YYYY-MM-DD (o ISO) a DD/MM/YYYY. */
export function fmtFechaCortaDMY(v: string | null | undefined): string {
  const s = String(v ?? '').trim().slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

/**
 * Filtra un empleado según su fecha de ingreso (`hire_date`) y el rango [desde, hasta] (YYYY-MM-DD).
 * Si ni `desde` ni `hasta` están definidos, pasan todos (incluso los que no tienen `hire_date`).
 * Si hay filtro activo, los empleados sin `hire_date` quedan fuera.
 */
export function pasaFiltroFechaIngreso(
  hireDate: string | null | undefined,
  desde?: string | null,
  hasta?: string | null,
): boolean {
  const d0 = String(desde ?? '').trim().slice(0, 10);
  const d1 = String(hasta ?? '').trim().slice(0, 10);
  if (!d0 && !d1) return true;
  const f = String(hireDate ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  if (d0 && f < d0) return false;
  if (d1 && f > d1) return false;
  return true;
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

const nombreCompletoEmpleado = (e: EmpleadoParaReporte): string =>
  `${String(e.first_name ?? '').trim()} ${String(e.last_name ?? '').trim()}`.replace(/\s+/g, ' ').trim();

const cmpTextoEs = (a: string, b: string): number =>
  a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

/** Ordena el listado de empleados del reporte según la opción elegida por el usuario. */
export function ordenarEmpleadosReporte<T extends EmpleadoParaReporte>(
  empleados: readonly T[],
  ordenarPor: OrdenReporteEmpleados | undefined,
  preferirNocturno = false,
): T[] {
  const arr = (empleados ?? []).slice();
  const modo: OrdenReporteEmpleados = ordenarPor ?? 'nombre_az';
  return arr.sort((a, b) => {
    const na = nombreCompletoEmpleado(a);
    const nb = nombreCompletoEmpleado(b);
    if (modo === 'nombre_za') return cmpTextoEs(nb, na);
    if (modo === 'cargo_az') {
      const ca = String(a.cargo ?? '').trim() || 'ZZZ';
      const cb = String(b.cargo ?? '').trim() || 'ZZZ';
      return cmpTextoEs(ca, cb) || cmpTextoEs(na, nb);
    }
    if (modo === 'departamento_az') {
      const da = limpiarSoloDepartamento(a.department, a.grupo) || 'ZZZ';
      const db = limpiarSoloDepartamento(b.department, b.grupo) || 'ZZZ';
      const ca = String(a.cargo ?? '').trim() || 'ZZZ';
      const cb = String(b.cargo ?? '').trim() || 'ZZZ';
      return cmpTextoEs(da, db) || cmpTextoEs(ca, cb) || cmpTextoEs(na, nb);
    }
    if (modo === 'cedula') {
      const cda = String(a.cedula ?? '').trim() || 'ZZZ';
      const cdb = String(b.cedula ?? '').trim() || 'ZZZ';
      return cmpTextoEs(cda, cdb) || cmpTextoEs(na, nb);
    }
    if (modo === 'ficha') {
      const fa = String(a.ficha_number ?? '').trim() || 'ZZZ';
      const fb = String(b.ficha_number ?? '').trim() || 'ZZZ';
      return cmpTextoEs(fa, fb) || cmpTextoEs(na, nb);
    }
    if (modo === 'salario_desc') {
      const sa = calcularSalariosEmpleadoReporte(a, { preferirNocturno });
      const sb = calcularSalariosEmpleadoReporte(b, { preferirNocturno });
      const va = sa.mensual ?? sa.semanal ?? sa.diario ?? sa.nocturno ?? 0;
      const vb = sb.mensual ?? sb.semanal ?? sb.diario ?? sb.nocturno ?? 0;
      return (vb - va) || cmpTextoEs(na, nb);
    }
    return cmpTextoEs(na, nb);
  });
}

export function cuerpoReporteEmpleados(input: EntradaReporteEmpleados): {
  body: string;
  extraCss: string;
  totalPersonas: number;
  totalCargos: number;
  totalDepartamentos: number;
} {
  const op = resolverOpcionesReporteEmpleados(input.opciones);
  const preferirNocturno = Boolean(op.salarioNocturno && !op.salarioDiario);
  const lista = ordenarEmpleadosReporte(input.empleados ?? [], op.ordenarPor, preferirNocturno);
  const hayColumnaSalario = Boolean(
    op.salarioDiario ||
      op.salarioNocturno ||
      op.salarioSemanal ||
      op.salarioQuincenal ||
      op.salarioMensual
  );

  // Agrupación para el resumen por cargo y tabulador por cargo
  const porCargoMap = new Map<string, number>();
  const porCargoDeptosMap = new Map<string, Set<string>>();
  const porCargoSalariosListaMap = new Map<string, SalariosEmpleadoReporte[]>();
  // Agrupación para el resumen por departamento (SOLO department, nunca grupo/dirección)
  const porDeptoMap = new Map<string, number>();
  const porDeptoSalariosMap = new Map<
    string,
    { diario: number; nocturno: number; semanal: number; quincenal: number; mensual: number }
  >();
  const empresasSet = new Set<string>();
  let totalSalarioDiario = 0;
  let totalSalarioNocturno = 0;
  let totalSalarioSemanal = 0;
  let totalSalarioQuincenal = 0;
  let totalSalarioMensual = 0;

  for (const e of lista) {
    const c = String(e.cargo ?? '').trim() || 'Sin cargo';
    porCargoMap.set(c, (porCargoMap.get(c) ?? 0) + 1);

    const dLimpio = limpiarSoloDepartamento(e.department, e.grupo);
    const d = dLimpio || 'Sin departamento';
    porDeptoMap.set(d, (porDeptoMap.get(d) ?? 0) + 1);
    if (dLimpio) {
      let setD = porCargoDeptosMap.get(c);
      if (!setD) {
        setD = new Set<string>();
        porCargoDeptosMap.set(c, setD);
      }
      setD.add(dLimpio);
    }

    const emp = String(e.empresaNomina ?? '').trim();
    if (emp && emp !== 'Sin empresa de filtro') empresasSet.add(emp);

    const sals = calcularSalariosEmpleadoReporte(e, { preferirNocturno });
    let arrSals = porCargoSalariosListaMap.get(c);
    if (!arrSals) {
      arrSals = [];
      porCargoSalariosListaMap.set(c, arrSals);
    }
    arrSals.push(sals);

    let depSals = porDeptoSalariosMap.get(d);
    if (!depSals) {
      depSals = { diario: 0, nocturno: 0, semanal: 0, quincenal: 0, mensual: 0 };
      porDeptoSalariosMap.set(d, depSals);
    }

    if (sals.diario !== null) {
      totalSalarioDiario += sals.diario;
      depSals.diario += sals.diario;
    }
    if (sals.nocturno !== null) {
      totalSalarioNocturno += sals.nocturno;
      depSals.nocturno += sals.nocturno;
    }
    if (sals.semanal !== null) {
      totalSalarioSemanal += sals.semanal;
      depSals.semanal += sals.semanal;
    }
    if (sals.quincenal !== null) {
      totalSalarioQuincenal += sals.quincenal;
      depSals.quincenal += sals.quincenal;
    }
    if (sals.mensual !== null) {
      totalSalarioMensual += sals.mensual;
      depSals.mensual += sals.mensual;
    }
  }
  totalSalarioDiario = Math.round(totalSalarioDiario * 100) / 100;
  totalSalarioNocturno = Math.round(totalSalarioNocturno * 100) / 100;
  totalSalarioSemanal = Math.round(totalSalarioSemanal * 100) / 100;
  totalSalarioQuincenal = Math.round(totalSalarioQuincenal * 100) / 100;
  totalSalarioMensual = Math.round(totalSalarioMensual * 100) / 100;

  for (const depSals of porDeptoSalariosMap.values()) {
    depSals.diario = Math.round(depSals.diario * 100) / 100;
    depSals.nocturno = Math.round(depSals.nocturno * 100) / 100;
    depSals.semanal = Math.round(depSals.semanal * 100) / 100;
    depSals.quincenal = Math.round(depSals.quincenal * 100) / 100;
    depSals.mensual = Math.round(depSals.mensual * 100) / 100;
  }

  const totalSalarioDiarioTxt = formatearMontoSalarioReporte(totalSalarioDiario);
  const totalSalarioNocturnoTxt = formatearMontoSalarioReporte(totalSalarioNocturno);
  const totalSalarioSemanalTxt = formatearMontoSalarioReporte(totalSalarioSemanal);
  const totalSalarioQuincenalTxt = formatearMontoSalarioReporte(totalSalarioQuincenal);
  const totalSalarioMensualTxt = formatearMontoSalarioReporte(totalSalarioMensual);

  // Obtiene la tarifa representativa (moda de los valores > 0) de cada cargo para el modo Tabulador
  const modaMonto = (vals: (number | null)[]): number | null => {
    const freq = new Map<number, number>();
    let mejorVal: number | null = null;
    let mejorCant = 0;
    for (const v of vals) {
      if (v === null || !Number.isFinite(v) || v <= 0) continue;
      const cant = (freq.get(v) ?? 0) + 1;
      freq.set(v, cant);
      if (cant > mejorCant) {
        mejorCant = cant;
        mejorVal = v;
      }
    }
    return mejorVal;
  };

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
    const deptoFiltrado = Boolean(
      input.departamentoTxt &&
        input.departamentoTxt !== 'Todos' &&
        input.departamentoTxt !== 'Todos los departamentos'
    );
    if (op.departamento || op.resumenDepartamento || deptoFiltrado) {
      const labelDepto = deptoFiltrado && resumenDepto.length === 1 ? esc(resumenDepto[0][0]) : `${resumenDepto.length}`;
      const subDepto = deptoFiltrado && resumenDepto.length === 1 ? 'Departamento' : 'Departamento(s)';
      tiles.push(`<div class="tile"><div class="t">${labelDepto}</div><div class="s">${subDepto}</div></div>`);
    }
    if (op.empresa && empresasSet.size > 0) {
      tiles.push(`<div class="tile"><div class="t">${empresasSet.size}</div><div class="s">Empresa(s) nómina</div></div>`);
    }
    if (op.salarioDiario && totalSalarioDiario > 0) {
      const subDiario = deptoFiltrado ? `Total Por Día (${esc(input.departamentoTxt!)})` : 'Total Por Día';
      tiles.push(`<div class="tile"><div class="t">${esc(totalSalarioDiarioTxt)}</div><div class="s">${subDiario}</div></div>`);
    }
    if (op.salarioNocturno && totalSalarioNocturno > 0) {
      const subNoche = deptoFiltrado ? `Total Por Noche (${esc(input.departamentoTxt!)})` : 'Total Por Noche';
      tiles.push(`<div class="tile"><div class="t">${esc(totalSalarioNocturnoTxt)}</div><div class="s">${subNoche}</div></div>`);
    }
    if (op.salarioSemanal && totalSalarioSemanal > 0) {
      const subSem = deptoFiltrado ? `Total Por Semana (${esc(input.departamentoTxt!)})` : 'Total Por Semana';
      tiles.push(`<div class="tile"><div class="t">${esc(totalSalarioSemanalTxt)}</div><div class="s">${subSem}</div></div>`);
    }
    if (op.salarioQuincenal && totalSalarioQuincenal > 0) {
      const subQuin = deptoFiltrado ? `Total Quincenal (${esc(input.departamentoTxt!)})` : 'Total Quincenal';
      tiles.push(`<div class="tile"><div class="t">${esc(totalSalarioQuincenalTxt)}</div><div class="s">${subQuin}</div></div>`);
    }
    if (op.salarioMensual && totalSalarioMensual > 0) {
      const subMensual = deptoFiltrado ? `Total Mensual (${esc(input.departamentoTxt!)})` : 'Total Mensual';
      tiles.push(`<div class="tile"><div class="t">${esc(totalSalarioMensualTxt)}</div><div class="s">${subMensual}</div></div>`);
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
    if (input.fechaIngresoTxt && input.fechaIngresoTxt.trim()) {
      partesMeta.push(`<b>Fecha de ingreso:</b> ${esc(input.fechaIngresoTxt.trim())}`);
    }
    if (input.busquedaTxt && input.busquedaTxt.trim()) {
      partesMeta.push(`<b>Búsqueda:</b> «${esc(input.busquedaTxt.trim())}»`);
    }
    metaHtml = `<div class="meta">${partesMeta.join(' &nbsp;·&nbsp; ')}</div>`;
  }

  // 2) Tablas de resumen en cuadros (Resumen por cargo y/o Resumen por departamento)
  const cajasResumen: string[] = [];
  if (op.resumenCargo && resumen.length > 0) {
    if (hayColumnaSalario) {
      // Modo Tabulador por Cargo: muestra el cargo (y departamento si está marcado) junto con sus tarifas por Día / Noche / Semana / Quincenal / Mensual
      const mostrarNumCargo = Boolean(op.numeracion && !op.listadoPersonas);
      const thsCargo: string[] = [];
      if (mostrarNumCargo) thsCargo.push('<th class="r nw" style="width:34px">#</th>');
      thsCargo.push('<th>Cargo</th>');
      if (op.departamento) thsCargo.push('<th>Departamento</th>');
      // 👥 Cantidad de personas por cargo también en el modo tabulador (06-nov-2026).
      thsCargo.push('<th class="r nw" style="width:80px">Personas</th>');
      if (op.salarioDiario) thsCargo.push('<th class="r nw">Por Día</th>');
      if (op.salarioNocturno) thsCargo.push('<th class="r nw">Por Noche</th>');
      if (op.salarioSemanal) thsCargo.push('<th class="r nw">Por Semana</th>');
      if (op.salarioQuincenal) thsCargo.push('<th class="r nw">Quincenal</th>');
      if (op.salarioMensual) thsCargo.push('<th class="r nw">Mensual</th>');

      let sumCargoDia = 0;
      let sumCargoNoche = 0;
      let sumCargoSem = 0;
      let sumCargoQuin = 0;
      let sumCargoMes = 0;

      const resumenRows = resumen
        .map(([c, n], idx) => {
          const listaSals = porCargoSalariosListaMap.get(c) ?? [];
          const salDia = modaMonto(listaSals.map((s) => s.diario));
          const salNoche = modaMonto(listaSals.map((s) => s.nocturno));
          const salSem = modaMonto(listaSals.map((s) => s.semanal));
          const salQuin = modaMonto(listaSals.map((s) => s.quincenal));
          const salMes = modaMonto(listaSals.map((s) => s.mensual));

          if (salDia !== null) sumCargoDia += salDia;
          if (salNoche !== null) sumCargoNoche += salNoche;
          if (salSem !== null) sumCargoSem += salSem;
          if (salQuin !== null) sumCargoQuin += salQuin;
          if (salMes !== null) sumCargoMes += salMes;

          const deptosCargo = Array.from(porCargoDeptosMap.get(c) ?? []);
          const deptoTxt = deptosCargo.length > 0 ? deptosCargo.join(' / ') : '—';

          const tds: string[] = [];
          if (mostrarNumCargo) tds.push(`<td class="r nw">${idx + 1}</td>`);
          tds.push(`<td><b>${esc(c)}</b></td>`);
          if (op.departamento) tds.push(`<td>${esc(deptoTxt)}</td>`);
          tds.push(`<td class="r nw"><b>${n}</b></td>`);
          if (op.salarioDiario) {
            tds.push(`<td class="r nw">${salDia !== null ? `<b>${esc(formatearMontoSalarioReporte(salDia))}</b>` : '—'}</td>`);
          }
          if (op.salarioNocturno) {
            tds.push(`<td class="r nw">${salNoche !== null ? `<b>${esc(formatearMontoSalarioReporte(salNoche))}</b>` : '—'}</td>`);
          }
          if (op.salarioSemanal) {
            tds.push(`<td class="r nw">${salSem !== null ? `<b>${esc(formatearMontoSalarioReporte(salSem))}</b>` : '—'}</td>`);
          }
          if (op.salarioQuincenal) {
            tds.push(`<td class="r nw">${salQuin !== null ? `<b>${esc(formatearMontoSalarioReporte(salQuin))}</b>` : '—'}</td>`);
          }
          if (op.salarioMensual) {
            tds.push(`<td class="r nw">${salMes !== null ? `<b>${esc(formatearMontoSalarioReporte(salMes))}</b>` : '—'}</td>`);
          }
          return `<tr>${tds.join('')}</tr>`;
        })
        .join('');

      const colsEtiqueta = 1 + (mostrarNumCargo ? 1 : 0) + (op.departamento ? 1 : 0);
      const tfootCells: string[] = [`<td colspan="${colsEtiqueta}">TOTAL (${resumen.length} cargos)</td>`, `<td class="r nw">${lista.length}</td>`];
      if (op.salarioDiario) {
        tfootCells.push(`<td class="r nw">${sumCargoDia > 0 ? esc(formatearMontoSalarioReporte(r2(sumCargoDia))) : '—'}</td>`);
      }
      if (op.salarioNocturno) {
        tfootCells.push(`<td class="r nw">${sumCargoNoche > 0 ? esc(formatearMontoSalarioReporte(r2(sumCargoNoche))) : '—'}</td>`);
      }
      if (op.salarioSemanal) {
        tfootCells.push(`<td class="r nw">${sumCargoSem > 0 ? esc(formatearMontoSalarioReporte(r2(sumCargoSem))) : '—'}</td>`);
      }
      if (op.salarioQuincenal) {
        tfootCells.push(`<td class="r nw">${sumCargoQuin > 0 ? esc(formatearMontoSalarioReporte(r2(sumCargoQuin))) : '—'}</td>`);
      }
      if (op.salarioMensual) {
        tfootCells.push(`<td class="r nw">${sumCargoMes > 0 ? esc(formatearMontoSalarioReporte(r2(sumCargoMes))) : '—'}</td>`);
      }

      cajasResumen.push(`
      <div class="sec-box">
        <h3 class="sec">Resumen por cargo (${resumen.length})</h3>
        <table class="sum">
          <thead><tr>${thsCargo.join('')}</tr></thead>
          <tbody>${resumenRows}</tbody>
          <tfoot><tr>${tfootCells.join('')}</tr></tfoot>
        </table>
      </div>`);
    } else {
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
  }
  if (op.resumenDepartamento && resumenDepto.length > 0) {
    const mostrarSalarioDepto = Boolean(
      op.salarioPorDepartamento !== false &&
      (hayColumnaSalario || op.salarioMensual || op.salarioDiario || op.salarioSemanal || op.salarioQuincenal)
    );

    if (mostrarSalarioDepto) {
      const thsDepto: string[] = ['<th>Departamento</th>', '<th class="r nw" style="width:90px">Personas</th>'];
      if (op.salarioDiario) thsDepto.push('<th class="r nw" style="width:110px">Total Por Día</th>');
      if (op.salarioSemanal) thsDepto.push('<th class="r nw" style="width:110px">Total Por Semana</th>');
      if (op.salarioQuincenal) thsDepto.push('<th class="r nw" style="width:110px">Total Quincenal</th>');
      if (op.salarioMensual || (!op.salarioDiario && !op.salarioSemanal && !op.salarioQuincenal)) {
        thsDepto.push('<th class="r nw" style="width:120px">Total Mensual</th>');
      }

      const deptoRows = resumenDepto
        .map(([d, n]) => {
          const ds = porDeptoSalariosMap.get(d) ?? { diario: 0, nocturno: 0, semanal: 0, quincenal: 0, mensual: 0 };
          const tds: string[] = [`<td><b>${esc(d)}</b></td>`, `<td class="r nw"><b>${n}</b></td>`];
          if (op.salarioDiario) {
            tds.push(`<td class="r nw">${ds.diario > 0 ? esc(formatearMontoSalarioReporte(ds.diario)) : '—'}</td>`);
          }
          if (op.salarioSemanal) {
            tds.push(`<td class="r nw">${ds.semanal > 0 ? esc(formatearMontoSalarioReporte(ds.semanal)) : '—'}</td>`);
          }
          if (op.salarioQuincenal) {
            tds.push(`<td class="r nw">${ds.quincenal > 0 ? esc(formatearMontoSalarioReporte(ds.quincenal)) : '—'}</td>`);
          }
          if (op.salarioMensual || (!op.salarioDiario && !op.salarioSemanal && !op.salarioQuincenal)) {
            tds.push(`<td class="r nw"><b>${ds.mensual > 0 ? esc(formatearMontoSalarioReporte(ds.mensual)) : '—'}</b></td>`);
          }
          return `<tr>${tds.join('')}</tr>`;
        })
        .join('');

      const tfootCells: string[] = ['<td>TOTAL</td>', `<td class="r nw"><b>${lista.length}</b></td>`];
      if (op.salarioDiario) {
        tfootCells.push(`<td class="r nw"><b>${totalSalarioDiario > 0 ? esc(formatearMontoSalarioReporte(totalSalarioDiario)) : '—'}</b></td>`);
      }
      if (op.salarioSemanal) {
        tfootCells.push(`<td class="r nw"><b>${totalSalarioSemanal > 0 ? esc(formatearMontoSalarioReporte(totalSalarioSemanal)) : '—'}</b></td>`);
      }
      if (op.salarioQuincenal) {
        tfootCells.push(`<td class="r nw"><b>${totalSalarioQuincenal > 0 ? esc(formatearMontoSalarioReporte(totalSalarioQuincenal)) : '—'}</b></td>`);
      }
      if (op.salarioMensual || (!op.salarioDiario && !op.salarioSemanal && !op.salarioQuincenal)) {
        tfootCells.push(`<td class="r nw"><b>${totalSalarioMensual > 0 ? esc(formatearMontoSalarioReporte(totalSalarioMensual)) : '—'}</b></td>`);
      }

      cajasResumen.push(`
      <div class="sec-box">
        <h3 class="sec">Resumen por departamento (${resumenDepto.length})</h3>
        <table class="sum">
          <thead><tr>${thsDepto.join('')}</tr></thead>
          <tbody>${deptoRows}</tbody>
          <tfoot><tr>${tfootCells.join('')}</tr></tfoot>
        </table>
      </div>`);
    } else {
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
    if (op.fechaIngreso) ths.push('<th class="c nw">Ingreso</th>');
    if (op.fechaEgreso) ths.push('<th class="c nw">Trabajó hasta</th>');
    if (op.telefono) ths.push('<th class="nw">Teléfono</th>');
    if (op.salarioDiario) ths.push('<th class="r nw">Por Día</th>');
    if (op.salarioNocturno) ths.push('<th class="r nw">Por Noche</th>');
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
        const sals = calcularSalariosEmpleadoReporte(e, { preferirNocturno });
        const salDiaTxt = formatearMontoSalarioReporte(sals.diario);
        const salNocheTxt = formatearMontoSalarioReporte(sals.nocturno);
        const salSemTxt = formatearMontoSalarioReporte(sals.semanal);
        const salQuinTxt = formatearMontoSalarioReporte(sals.quincenal);
        const salMesTxt = formatearMontoSalarioReporte(sals.mensual);
        const estBco = estadoCartaBancoTercero(e);
        const bancoPartes = [
          e.bank_name,
          e.bank_account ? `CTA. ${e.bank_account}` : null,
          e.bank_holder,
          e.bank_cedula ? `C.I ${e.bank_cedula}` : null,
          estBco.esTercero ? `TERCERO${estBco.parentesco ? ` (${estBco.parentesco})` : ''}` : null,
        ].filter(Boolean);
        const bancoTxt = bancoPartes.length > 0 ? bancoPartes.join(' · ') : '—';

        const tds: string[] = [];
        if (op.numeracion) tds.push(`<td class="r nw">${i + 1}</td>`);
        if (op.empleado !== false || (tds.length === 0 && !op.cedula && !op.ficha && !op.cargo && !op.departamento && !op.habilidades && !op.empresa && !op.empresaReal && !op.estado && !op.fechaIngreso && !op.fechaEgreso && !op.telefono && !op.salarioDiario && !op.salarioNocturno && !op.salarioSemanal && !op.salarioQuincenal && !op.salarioMensual && !op.datosBancarios)) {
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
        if (op.fechaIngreso) tds.push(`<td class="c nw">${esc(fmtFechaCortaDMY(e.hire_date))}</td>`);
        if (op.fechaEgreso) tds.push(`<td class="c nw">${esc(fmtFechaCortaDMY(e.fecha_egreso))}</td>`);
        if (op.telefono) tds.push(`<td class="nw">${esc(e.phone || '—')}</td>`);
        if (op.salarioDiario) tds.push(`<td class="r nw">${sals.diario !== null ? `<b>${esc(salDiaTxt)}</b>` : '—'}</td>`);
        if (op.salarioNocturno) tds.push(`<td class="r nw">${sals.nocturno !== null ? `<b>${esc(salNocheTxt)}</b>` : '—'}</td>`);
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
    if (op.salarioNocturno && totalSalarioNocturno > 0) {
      partesTfoot.push(`POR NOCHE TOTAL: ${esc(totalSalarioNocturnoTxt)}`);
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

