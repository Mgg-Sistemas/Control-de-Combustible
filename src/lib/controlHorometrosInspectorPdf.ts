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
//  · FRENTE: la planificación de frentes de MAQUINARIA de esa jornada
//    (`maquinaria_frente_asignaciones`, la que ya se hace desde el sistema). Varios
//    frentes el mismo día se listan todos — aquí no hay ambigüedad que inventar:
//    el papel dice dónde estuvo asignada, no dónde cargó cada viaje.
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
import { listAsignacionesFrente, FRENTES_MAQUINARIA } from './camionViajes';
import { unFrentePorMaquina } from './frentesReporte';

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
export async function cargarFilasControlHorometros(opts: { date: string; shift: 'day' | 'night'; inspectorName: string }): Promise<{ filas: FilaControlHorometros[]; inspectores: string[] }> {
  const { date, shift, inspectorName } = opts;
  const [{ data }, lecturas, { asignaciones }, segsRes, roundsRes] = await Promise.all([
    computeInspectorData(date, null),
    cargarLecturasHorometro(date, date),
    listAsignacionesFrente(date, FRENTES_MAQUINARIA),
    // Tramos trabajados del día: primer arranque y último cierre POR TURNO.
    selectAllRows('machine_work_segments', 'machinery_id, started_at, ended_at, shift', (q: any) => q.eq('round_date', date)).catch(() => [] as any[]),
    // Jornada ABIERTA (sin tramo cerrado todavía): la hora de inicio real.
    supabase.from('machine_rounds').select('machinery_id, jornada_start_at, jornada_shift').eq('round_date', date).not('jornada_start_at', 'is', null),
  ]);

  const machMap = data.get(shift)?.get(inspectorName);
  const maquinas = machMap ? [...machMap.values()].sort((a, b) => cmpText(a.code, b.code)) : [];
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

  // Frente planificado de la jornada. ⛏️ 19-oct-2026: una máquina = UN frente
  // por día; si un día viejo quedó con varios, manda el MÁS RECIENTE (el join
  // de abajo se queda por si acaso, pero ya no debería concatenar nada).
  const frentesDeMaquina = new Map<string, string[]>();
  unFrentePorMaquina(asignaciones ?? []).forEach((a) => {
    if (!a.machineryId || !a.frenteNombre) return;
    const l = frentesDeMaquina.get(a.machineryId) ?? [];
    if (!l.includes(a.frenteNombre)) l.push(a.frenteNombre);
    frentesDeMaquina.set(a.machineryId, l);
  });

  const filas = maquinas.map((m) => {
    const lec = lecturaDe.get(m.id);
    const tramo = tramosDe.get(m.id);
    const iniAbierto = inicioAbiertoDe.get(m.id);
    return {
      machineryId: m.id,
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

/**
 * Genera y descarga el PDF de la planilla, horizontal como el papel. Las filas van
 * NUMERADAS por posición (1, 2, 3…) y la observación es la que escribió el
 * inspector en pantalla (clave: machineryId).
 */
export async function generarControlHorometrosPdf(opts: {
  date: string; shift: 'day' | 'night'; inspectorName: string;
  filas: FilaControlHorometros[]; observaciones: Record<string, string>;
}): Promise<void> {
  const { date, shift, inspectorName, filas, observaciones } = opts;
  const turnoTxt = shift === 'day' ? '☀️ Turno Día (7:00am–7:00pm)' : '🌙 Turno Noche (7:00pm–7:00am)';

  const cuerpo = filas.map((f, i) => `
    <tr>
      <td class="c num">${i + 1}</td>
      <td>${esc(f.empresa)}</td>
      <td><b>${esc(f.placaSerial || '—')}</b>${f.codigo ? `<div class="mini">${esc(f.codigo)}</div>` : ''}</td>
      <td class="c">${esc(f.horoInicio)}</td>
      <td class="c">${esc(f.horaInicio)}</td>
      <td class="c">${esc(f.horoFinal)}</td>
      <td class="c">${esc(f.horaFinal)}</td>
      <td>${esc(f.frente)}</td>
      <td class="obs">${esc(String(observaciones[f.machineryId] ?? '').trim())}</td>
    </tr>`).join('');

  const body = `
    <div class="meta">
      <span><b>INSPECTOR:</b> ${esc(inspectorName)}</span>
      <span><b>FECHA:</b> ${esc(dmy(date))}</span>
      <span><b>DÍA:</b> ${esc(diaSemanaCaracas(date))}</span>
      <span><b>TURNO:</b> ${esc(turnoTxt)}</span>
    </div>
    <table class="cho">
      <thead><tr>
        <th class="c" style="width:26px">№</th>
        <th style="width:14%">EMPRESA</th>
        <th style="width:13%">PLACA / SERIAL</th>
        <th class="c" style="width:9%">HORÓMETRO<br/>INICIO</th>
        <th class="c" style="width:8%">HORA<br/>INICIO</th>
        <th class="c" style="width:9%">HORÓMETRO<br/>FINAL</th>
        <th class="c" style="width:8%">HORA<br/>FINAL</th>
        <th style="width:12%">FRENTE</th>
        <th>OBSERVACIÓN</th>
      </tr></thead>
      <tbody>${cuerpo || '<tr><td colspan="9" class="none">Sin máquinas asignadas este turno.</td></tr>'}</tbody>
    </table>
    <div class="firma"><div class="linea"></div><div class="rotulo">${esc(inspectorName)} · Inspector</div></div>`;

  const extraCss = `
    @page{size:A4 landscape}
    .meta{display:flex;flex-wrap:wrap;gap:6px 22px;font-size:11.5px;color:#111;margin:2px 0 10px}
    .meta b{color:#1E3A5F}
    table.cho{width:100%;border-collapse:collapse;font-size:10.5px}
    .cho th{background:#EEF2F7;color:#1E3A5F;border:1px solid #94A3B8;padding:5px 6px;font-size:9px;letter-spacing:.3px;text-align:left}
    .cho td{border:1px solid #94A3B8;padding:6px;vertical-align:top;min-height:22px}
    .cho .c{text-align:center}
    .cho .num{font-weight:800}
    .cho .mini{color:#6B7280;font-size:8.5px;margin-top:1px}
    .cho .obs{min-width:150px}
    .cho .none{color:#6B7280;text-align:center;padding:14px 0}
    .cho tr{page-break-inside:avoid}
    .firma{margin-top:44px;width:260px}
    .firma .linea{border-top:1px solid #111}
    .firma .rotulo{font-size:10.5px;color:#374151;text-align:center;margin-top:4px}
  `;

  const html = pdfDocument({
    title: 'CONTROL DE HORÓMETROS',
    subtitle: `👷 ${esc(inspectorName)} · ${dmy(date)} · ${turnoTxt}`,
    body,
    extraCss,
  });
  await exportPdf(html, `Control de horometros - ${inspectorName} - ${dmy(date)} ${shift === 'day' ? 'dia' : 'noche'}`);
}
