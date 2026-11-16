// 🕐 CONTROL DE HORÓMETROS — el PDF del formato de papel del inspector (16-oct-2026).
//
// PEDIDO, textual: «en la vista de inspectores deben tener un boton para poder
// descargar ese formato ya rellenado en su mayoria con toda la informacion que ya
// deberia haber registrado … lo que no se puede tocar ni nada seria la placa de la
// maquinaria, la empresa, el frente se lo trae automaticamente de la planificacion
// de frente … el horometro final, inicial, hora de inicio y hora final se los trae
// por defecto de lo que habian cargado ellos mismos; lo que si podrian colocar o
// modificar seria las observaciones».
//
// Reproduce la planilla física «CONTROL DE HORÓMETROS» (№ · EMPRESA · PLACA/SERIAL ·
// HORÓMETRO INICIO · HORA INICIO · HORÓMETRO FINAL · HORA FINAL · FRENTE ·
// OBSERVACIÓN, con INSPECTOR/FECHA/DÍA en la cabecera), pero ya rellena:
//
//  · MÁQUINAS: las ASIGNADAS al inspector en ese turno — misma columna vertebral que
//    su recibo de jornada (`computeInspectorData`), para que ambos papeles listen
//    exactamente la misma flota.
//  · HORÓMETROS inicio/final: la lectura del día/turno de `lecturas_horometro_trabajo`
//    (lo que el propio inspector cargó en su teléfono). Sin lectura → en blanco,
//    como en el papel: nunca se inventa un número que termina en un documento.
//  · HORAS inicio/final: el primer arranque y el último cierre de los tramos
//    trabajados (`machine_work_segments`) de ese turno; si la jornada sigue ABIERTA,
//    la hora de inicio sale de `machine_rounds.jornada_start_at` y la final queda en
//    blanco (todavía no existe).
//  · FRENTE: el frente de MAQUINARIA VIGENTE a esa fecha
//    (`maquinaria_frente_asignaciones` leída como bitácora, 19-oct-2026: la
//    asignación arrastra hasta que la reasignan o la quitan) — el papel dice
//    dónde estaba asignada, no dónde cargó cada viaje.
//  · OBSERVACIÓN: lo ÚNICO editable. La escribe el inspector en la pantalla antes de
//    descargar; si la máquina quedó averiada/parada se le sugiere el motivo ya
//    registrado, pero su texto manda.
//
// TODO ES SOLO LECTURA: este archivo no escribe nada en la base.
// Lo vigila scripts/test-control-horometros-inspector.mjs.
import { supabase, selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { machineLabel as etiquetaMaquina } from './machineLabel';
import { computeInspectorData } from './inspectorReport';
import { cargarLecturasHorometro } from './horometroTrabajoDb';
import { listAsignacionesHasta, FRENTES_MAQUINARIA } from './camionViajes';
import { vigentesAlDia } from './frentesReporte';

const CARACAS_TZ = 'America/Caracas';
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };

/** Día de la semana (Caracas) en mayúsculas: "JUEVES" — la casilla DÍA del papel. */
export function diaSemanaCaracas(iso: string): string {
  try {
    const d = new Date(`${iso}T12:00:00-04:00`);
    const txt = new Intl.DateTimeFormat('es-VE', { weekday: 'long', timeZone: CARACAS_TZ }).format(d);
    return txt.toUpperCase();
  } catch { return ''; }
}

/** "HH:MM am/pm" (Caracas) de un instante ISO; '' si no hay. */
const horaCaracas = (iso: string | null | undefined): string => {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso)); } catch { return ''; }
};

/** Horómetro legible (es-VE). '' si no hay lectura: el papel queda en blanco, no en 0. */
const horoTxt = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '' : n.toLocaleString('es-VE', { maximumFractionDigits: 2 });

/** Una fila de la planilla, ya resuelta. Todo viene de lo registrado; nada se edita
 *  aquí salvo la observación, que viaja aparte (la escribe el inspector). */
export type FilaControlHorometros = {
  machineryId: string;
  inspector?: string;        // inspector al que pertenece en el turno (útil cuando se eligen varios)
  etiqueta: string;          // nombre + discriminante (para la pantalla)
  empresa: string;
  placaSerial: string;       // placa, o serial si no hay placa
  codigo: string;            // nombre de la máquina (línea pequeña bajo la placa)
  horoInicio: string;
  horaInicio: string;
  horoFinal: string;
  horaFinal: string;
  frente: string;            // todos los frentes planificados de la jornada
  obsSugerida: string;       // motivo de avería/parada ya registrado (editable)
};

/**
 * Reúne las filas de la planilla para un inspector, día de negocio y turno, y de
 * paso la LISTA de inspectores de ese turno (sale del mismo cálculo, sin otra
 * vuelta a la red): el coordinador la usa para sacar la planilla de cualquiera
 * (pedido 16-oct-2026). Nunca lanza por tablas opcionales (lecturas/frentes):
 * esas columnas salen en blanco y el resto del papel sigue — igual criterio que
 * el teléfono.
 */
export async function cargarFilasControlHorometros(opts: {
  date: string;
  shift: 'day' | 'night';
  inspectorName: string;
  inspectorNames?: string[];
}): Promise<{ filas: FilaControlHorometros[]; inspectores: string[] }> {
  const { date, shift, inspectorName, inspectorNames } = opts;
  const [{ data }, lecturas, { asignaciones }, segsRes, roundsRes] = await Promise.all([
    computeInspectorData(date, null),
    cargarLecturasHorometro(date, date),
    listAsignacionesHasta(date, FRENTES_MAQUINARIA),
    // Tramos trabajados del día: primer arranque y último cierre POR TURNO.
    selectAllRows('machine_work_segments', 'machinery_id, started_at, ended_at, shift', (q: any) => q.eq('round_date', date)).catch(() => [] as any[]),
    // Jornada ABIERTA (sin tramo cerrado todavía): la hora de inicio real.
    supabase.from('machine_rounds').select('machinery_id, jornada_start_at, jornada_shift').eq('round_date', date).not('jornada_start_at', 'is', null),
  ]);

  const nombresPedidos = (inspectorNames && inspectorNames.length > 0 ? inspectorNames : [inspectorName]).filter(Boolean);
  const machVistas = new Set<string>();
  const maquinasConInsp: Array<{ m: any; inspector: string }> = [];
  for (const nombre of nombresPedidos) {
    const machMap = data.get(shift)?.get(nombre);
    if (!machMap) continue;
    const lista = [...machMap.values()].sort((a, b) => cmpText(a.code, b.code));
    for (const m of lista) {
      if (machVistas.has(m.id)) continue; // Evitar duplicar una máquina si fue reasignada entre dos seleccionados
      machVistas.add(m.id);
      maquinasConInsp.push({ m, inspector: nombre });
    }
  }
  const inspectores = [...(data.get(shift)?.keys() ?? [])].sort(cmpText);

  // Lectura del turno por máquina (0 o 1: la tabla es única por máquina/día/turno).
  const lecturaDe = new Map<string, { inicial: number | null; final: number | null }>();
  lecturas.forEach((l) => { if (l.roundDate === date && l.shift === shift) lecturaDe.set(l.machineryId, { inicial: l.inicial, final: l.final }); });

  // Primer arranque / último cierre de los tramos del TURNO.
  const tramosDe = new Map<string, { ini: number; fin: number }>();
  ((segsRes ?? []) as any[]).forEach((s) => {
    if ((s.shift === 'night' ? 'night' : 'day') !== shift) return;
    const st = s.started_at ? new Date(s.started_at).getTime() : NaN;
    const en = s.ended_at ? new Date(s.ended_at).getTime() : NaN;
    if (isNaN(st) || isNaN(en)) return;
    const prev = tramosDe.get(s.machinery_id);
    tramosDe.set(s.machinery_id, { ini: prev ? Math.min(prev.ini, st) : st, fin: prev ? Math.max(prev.fin, en) : en });
  });
  // Jornada abierta: hay inicio pero aún no hay cierre.
  const inicioAbiertoDe = new Map<string, string>();
  ((roundsRes.data ?? []) as any[]).forEach((r) => {
    if (r.jornada_shift && r.jornada_shift !== shift) return;
    if (r.jornada_start_at) inicioAbiertoDe.set(r.machinery_id, r.jornada_start_at);
  });

  // Frente VIGENTE a la fecha. ⛏️ 19-oct-2026 (tarde): el frente de maquinaria
  // es PEGAJOSO — rige la última anotación <= esa fecha de cada máquina, y la
  // marca «sin frente» la deja en blanco (vigentesAlDia la filtra sola).
  const frentesDeMaquina = new Map<string, string[]>();
  vigentesAlDia(asignaciones ?? [], date).forEach((a) => {
    if (!a.machineryId || !a.frenteNombre) return;
    const l = frentesDeMaquina.get(a.machineryId) ?? [];
    if (!l.includes(a.frenteNombre)) l.push(a.frenteNombre);
    frentesDeMaquina.set(a.machineryId, l);
  });

  const filas = maquinasConInsp.map(({ m, inspector }) => {
    const lec = lecturaDe.get(m.id);
    const tramo = tramosDe.get(m.id);
    const iniAbierto = inicioAbiertoDe.get(m.id);
    return {
      machineryId: m.id,
      inspector,
      etiqueta: etiquetaMaquina(m),
      empresa: String(m.company ?? '').trim(),
      placaSerial: String(m.plate ?? '').trim() || String(m.serial ?? '').trim(),
      codigo: String(m.code ?? '').trim(),
      horoInicio: horoTxt(lec?.inicial),
      horaInicio: horaCaracas(tramo ? new Date(tramo.ini).toISOString() : iniAbierto),
      horoFinal: horoTxt(lec?.final),
      // Jornada abierta sin tramo cerrado: la hora final NO existe todavía — en blanco.
      horaFinal: horaCaracas(tramo ? new Date(tramo.fin).toISOString() : null),
      frente: (frentesDeMaquina.get(m.id) ?? []).join(' + '),
      obsSugerida: (m.estado === 'averia' || m.estado === 'parada') && m.motivo ? String(m.motivo) : '',
    };
  });
  return { filas, inspectores };
}

export type ChoColumnasConfig = {
  num: boolean;
  empresa: boolean;
  placaSerial: boolean;
  nombreMaquina: boolean;
  horoInicio: boolean;
  horaInicio: boolean;
  horoFinal: boolean;
  horaFinal: boolean;
  frente: boolean;
  observacion: boolean;
};

export type ChoLogosConfig = {
  bcv: boolean;
  sos: boolean;
  golden: boolean;
  renace: boolean;
  jhenzaen: boolean;
};

export type ChoAgrupacion = 'empresa' | 'inspector' | 'ninguno';

export type ChoOpcionesPdf = {
  columnas: ChoColumnasConfig;
  logos: ChoLogosConfig;
  agruparPor: ChoAgrupacion;
  mostrarFirma: boolean;
};

export const CHO_OPCIONES_DEFECTO: ChoOpcionesPdf = {
  columnas: {
    num: true,
    empresa: true,
    placaSerial: true,
    nombreMaquina: true,
    horoInicio: true,
    horaInicio: true,
    horoFinal: true,
    horaFinal: true,
    frente: true,
    observacion: true,
  },
  logos: { bcv: true, sos: true, golden: false, renace: false, jhenzaen: false },
  agruparPor: 'empresa',
  mostrarFirma: true,
};

/**
 * Genera y descarga el PDF de la planilla en formato Carta Vertical (letter portrait),
 * bien organizado para que las columnas quepan completas sin cortarse. Las filas van
 * NUMERADAS por posición (1, 2, 3…) y la observación es la que escribió el
 * inspector en pantalla (clave: machineryId). Soporta uno o varios inspectores,
 * agrupación por empresa/inspector y personalización de columnas/logos.
 */
export async function generarControlHorometrosPdf(opts: {
  date: string; shift: 'day' | 'night'; inspectorName: string; inspectorNames?: string[];
  filas: FilaControlHorometros[]; observaciones: Record<string, string>;
  opciones?: ChoOpcionesPdf;
}): Promise<void> {
  const { date, shift, inspectorName, inspectorNames, filas, observaciones } = opts;
  const op: ChoOpcionesPdf = {
    columnas: { ...CHO_OPCIONES_DEFECTO.columnas, ...(opts.opciones?.columnas ?? {}) },
    logos: { ...CHO_OPCIONES_DEFECTO.logos, ...(opts.opciones?.logos ?? {}) },
    agruparPor: opts.opciones?.agruparPor ?? CHO_OPCIONES_DEFECTO.agruparPor,
    mostrarFirma: opts.opciones?.mostrarFirma ?? CHO_OPCIONES_DEFECTO.mostrarFirma,
  };
  const cols = op.columnas;

  const nombres = (inspectorNames && inspectorNames.length > 0 ? inspectorNames : [inspectorName]).filter(Boolean);
  const esMulti = nombres.length > 1;
  const inspectorCabecera = nombres.join(', ') || inspectorName;
  const turnoTxt = shift === 'day' ? '☀️ Turno Día (7:00am–7:00pm)' : '🌙 Turno Noche (7:00pm–7:00am)';

  // Ordenar filas según agrupación
  const filasOrdenadas = [...filas];
  if (op.agruparPor === 'empresa') {
    filasOrdenadas.sort((a, b) => {
      const ea = a.empresa || 'Sin empresa';
      const eb = b.empresa || 'Sin empresa';
      if (!a.empresa && b.empresa) return 1;
      if (a.empresa && !b.empresa) return -1;
      const cEmp = cmpText(ea, eb);
      if (cEmp !== 0) return cEmp;
      return cmpText(a.codigo || a.placaSerial, b.codigo || b.placaSerial);
    });
  } else if (op.agruparPor === 'inspector') {
    filasOrdenadas.sort((a, b) => {
      const cInsp = cmpText(a.inspector || '', b.inspector || '');
      if (cInsp !== 0) return cInsp;
      const cEmp = cmpText(a.empresa || 'Sin empresa', b.empresa || 'Sin empresa');
      if (cEmp !== 0) return cEmp;
      return cmpText(a.codigo || a.placaSerial, b.codigo || b.placaSerial);
    });
  }

  // Definición de columnas visibles (lo apagado no deja rastro en el papel)
  type ColDef = {
    k: keyof ChoColumnasConfig;
    w: number;
    th: string;
    td: (f: FilaControlHorometros, i: number) => string;
  };
  const todasCols: ColDef[] = [
    { k: 'num', w: 4, th: '<th class="c">№</th>', td: (_f, i) => `<td class="c num">${i + 1}</td>` },
    { k: 'empresa', w: 14, th: '<th>EMPRESA</th>', td: (f) => `<td>${esc(f.empresa)}</td>` },
    { k: 'placaSerial', w: 15, th: '<th class="c">PLACA / SERIAL</th>', td: (f) => `<td class="c placa-col"><b>${esc(f.placaSerial || '—')}</b>${cols.nombreMaquina && f.codigo ? `<div class="mini">${esc(f.codigo)}</div>` : ''}</td>` },
    { k: 'horoInicio', w: 10, th: '<th class="c">HORÓMETRO<br/>INICIO</th>', td: (f) => `<td class="c">${esc(f.horoInicio)}</td>` },
    { k: 'horaInicio', w: 8.5, th: '<th class="c">HORA<br/>INICIO</th>', td: (f) => `<td class="c">${esc(f.horaInicio)}</td>` },
    { k: 'horoFinal', w: 10, th: '<th class="c">HORÓMETRO<br/>FINAL</th>', td: (f) => `<td class="c">${esc(f.horoFinal)}</td>` },
    { k: 'horaFinal', w: 8.5, th: '<th class="c">HORA<br/>FINAL</th>', td: (f) => `<td class="c">${esc(f.horaFinal)}</td>` },
    { k: 'frente', w: 13, th: '<th>FRENTE</th>', td: (f) => `<td>${esc(f.frente)}</td>` },
    { k: 'observacion', w: 17, th: '<th>OBSERVACIÓN</th>', td: (f) => `<td class="obs">${esc(String(observaciones[f.machineryId] ?? '').trim())}</td>` },
  ];
  const colsActivas = todasCols.filter((c) => cols[c.k]);
  const colsFinal = colsActivas.length > 0 ? colsActivas : [todasCols[2]];
  const totalPeso = colsFinal.reduce((s, c) => s + c.w, 0) || 100;

  // Contar por grupo para mostrar (N máquinas) en el separador
  const conteoGrupo = new Map<string, number>();
  if (op.agruparPor !== 'ninguno') {
    filasOrdenadas.forEach((f) => {
      const key = op.agruparPor === 'empresa' ? (f.empresa || 'Sin empresa') : (f.inspector || inspectorCabecera);
      conteoGrupo.set(key, (conteoGrupo.get(key) ?? 0) + 1);
    });
  }

  let ultimoGrupo = '';
  const colCount = colsFinal.length;
  const cuerpo = filasOrdenadas.map((f, i) => {
    let grupoHtml = '';
    if (op.agruparPor === 'empresa') {
      const emp = f.empresa || 'Sin empresa';
      if (emp !== ultimoGrupo) {
        ultimoGrupo = emp;
        grupoHtml = `<tr class="grp"><td colspan="${colCount}">🏢 EMPRESA: ${esc(emp)} (${conteoGrupo.get(emp) ?? 1})</td></tr>`;
      }
    } else if (op.agruparPor === 'inspector') {
      const insp = f.inspector || inspectorCabecera;
      if (insp !== ultimoGrupo) {
        ultimoGrupo = insp;
        grupoHtml = `<tr class="grp"><td colspan="${colCount}">👷 INSPECTOR: ${esc(insp)} (${conteoGrupo.get(insp) ?? 1})</td></tr>`;
      }
    }
    return `${grupoHtml}
    <tr>
      ${colsFinal.map((c) => c.td(f, i)).join('\n      ')}
    </tr>`;
  }).join('');

  const body = `
    <div class="meta">
      <span>${esMulti ? '<b>INSPECTORES:</b>' : '<b>INSPECTOR:</b>'} ${esc(inspectorCabecera)}</span>
      <span><b>FECHA:</b> ${esc(dmy(date))}</span>
      <span><b>DÍA:</b> ${esc(diaSemanaCaracas(date))}</span>
      <span><b>TURNO:</b> ${esc(turnoTxt)}</span>
    </div>
    <table class="cho">
      <colgroup>
        ${colsFinal.map((c) => `<col style="width:${(Math.round((c.w / totalPeso) * 1000) / 10)}%"/>`).join('\n        ')}
      </colgroup>
      <thead><tr>
        ${colsFinal.map((c) => c.th).join('\n        ')}
      </tr></thead>
      <tbody>${cuerpo || `<tr><td colspan="${colCount}" class="none">Sin máquinas asignadas este turno.</td></tr>`}</tbody>
    </table>
    ${op.mostrarFirma ? `<div class="firma"><div class="linea"></div><div class="rotulo">${esc(esMulti ? `Coordinación · ${nombres.length} inspectores` : `${inspectorCabecera} · Inspector`)}</div></div>` : ''}`;

  const extraCss = `
    @page{size:letter portrait;margin:10mm 9mm}
    @media screen{body{max-width:215.9mm;margin:0 auto;padding:10mm 9mm}}
    .top{gap:10px;align-items:center}
    .brand{gap:10px}
    .logo-box img{height:50px;width:auto}
    .logo-cap{font-size:8.5px;max-width:105px}
    .doc-title{font-size:20px;letter-spacing:.5px;line-height:1.08}
    .doc-sub{font-size:10.5px;margin-top:3px}
    .emit{font-size:10px}
    .rule{margin:8px 0 10px;height:3px}
    .company{font-size:10.5px;line-height:1.4;margin-bottom:6px}
    .company b{font-size:11.5px}
    .meta{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:10.5px;color:#111;margin:2px 0 8px;padding:5px 8px;background:#F8FAFC;border:1px solid #CBD5E1;border-radius:4px}
    .meta b{color:#1E3A5F}
    table.cho{width:100%;table-layout:fixed;border-collapse:collapse;font-size:9.5px}
    .cho thead{display:table-header-group}
    .cho tfoot{display:table-row-group}
    .cho tr{page-break-inside:avoid;break-inside:avoid}
    .cho th{background:#EEF2F7;color:#1E3A5F;border:1px solid #94A3B8;padding:4px 3px;font-size:8px;font-weight:800;letter-spacing:0;line-height:1.15;text-align:left;overflow-wrap:break-word;word-wrap:break-word}
    .cho th.c{text-align:center}
    .cho td{border:1px solid #94A3B8;padding:4.5px 3.5px;vertical-align:middle;min-height:22px;line-height:1.2;overflow-wrap:break-word;word-wrap:break-word;word-break:break-word}
    .cho .c{text-align:center}
    .cho td.c{white-space:nowrap}
    .cho td.c.placa-col{white-space:normal}
    .cho .num{font-weight:800;font-size:9px}
    .cho .mini{color:#4B5563;font-size:8px;margin-top:1px;line-height:1.1;white-space:normal;text-align:center}
    .cho .obs{min-width:0;width:auto}
    .cho .none{color:#6B7280;text-align:center;padding:14px 0}
    .cho tr.grp td{background:#E2E8F0;color:#1E3A5F;font-weight:800;font-size:9px;padding:4px 6px;letter-spacing:.3px}
    .firma{margin-top:32px;width:220px;page-break-inside:avoid;break-inside:avoid}
    .firma .linea{border-top:1px solid #111}
    .firma .rotulo{font-size:10px;color:#374151;text-align:center;margin-top:4px}
  `;

  const nombreArchivoInsp = nombres.length > 2 ? `${nombres.length} inspectores` : inspectorCabecera;
  const sufijosArchivo: string[] = [];
  if (op.agruparPor === 'empresa') sufijosArchivo.push('por empresa');
  else if (op.agruparPor === 'inspector') sufijosArchivo.push('por inspector');
  const ocultasCount = Object.values(cols).filter((v) => !v).length + (!op.mostrarFirma ? 1 : 0);
  if (ocultasCount > 0) sufijosArchivo.push('personalizado');
  const sufijoTxt = sufijosArchivo.length ? ` - ${sufijosArchivo.join(' - ')}` : '';

  const html = pdfDocument({
    title: 'CONTROL DE HORÓMETROS',
    subtitle: `👷 ${esc(esMulti && nombres.length > 3 ? `${nombres.length} inspectores` : inspectorCabecera)} · ${dmy(date)} · ${turnoTxt}`,
    body,
    extraCss,
    logos: op.logos,
  });
  await exportPdf(html, `Control de horometros - ${nombreArchivoInsp} - ${dmy(date)} ${shift === 'day' ? 'dia' : 'noche'}${sufijoTxt}`);
}
