import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';

/**
 * Reporte PDF "DISTRIBUCIÓN DE GUARDIAS": muestra la rotación de inspectores de
 * equipo por un rango de fechas (el "ciclo"), estilo el documento de guardias.
 * NO consulta la base de datos: recibe los datos YA cargados (inspectores + sus
 * guardias/descansos). Arma dos secciones: (1) un calendario del ciclo con el
 * estado T/D de cada inspector por día, y (2) la conformación de los grupos con
 * sus datos y descanso del ciclo.
 */

export type GuardInspector = { name: string; grupo: string | null; cargo: string | null; cedula: string | null; telefono: string | null; sector: string | null };
export type GuardShift = { inspector_name: string; from_date: string; to_date: string; kind: 'turno' | 'descanso' };

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
/** "DD/MM" a partir de un ISO "AAAA-MM-DD" (para rangos compactos). */
const dm = (iso: string) => { const [, m, d] = (iso || '').split('-'); return m && d ? `${d}/${m}` : iso; };

/** Días de la semana por getUTCDay() (0=Dom..6=Sáb). */
const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

/** Paleta de fondo de la celda 'D' (descanso) por grupo. */
const GRUPO_COLOR: Record<string, string> = { A: '#E8EAED', B: '#E6F2EA', C: '#FBEBDD' };
const colorGrupo = (g: string | null) => (g && GRUPO_COLOR[g.trim().toUpperCase()]) || '#E8EAED';

/**
 * Genera y exporta el PDF de la distribución de guardias.
 * @param opts.from/to rango del ciclo (ISO "AAAA-MM-DD", inclusive).
 * @param opts.rotation etiqueta de jornada (p. ej. "14x7"); por defecto "14x7".
 * @param opts.inspectors inspectores en la rotación.
 * @param opts.shifts guardias/descansos ya cargados.
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateGuardiasReport(opts: {
  from: string; to: string; rotation?: string; inspectors: GuardInspector[]; shifts: GuardShift[];
}): Promise<boolean> {
  const { from, to, inspectors, shifts } = opts;
  const rotation = opts.rotation || '14x7';
  const subtitle = `Inspectores de equipo · jornada ${rotation} · Ciclo ${dmy(from)} — ${dmy(to)}`;

  const extraCss = `
    h3{margin:16px 0 3px;font-size:13px;color:#1E3A5F;padding-bottom:3px;border-bottom:2px solid #1E3A5F}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
    td.r,th.r{text-align:right} td.b{font-weight:800}
    .kpi{display:inline-block;border:1px solid #ccc;border-radius:8px;padding:8px 12px;margin:2px}
    .kpi b{display:block;font-size:20px}
    .cal{border-collapse:collapse;width:100%;margin:6px 0 10px}
    .cal td,.cal th{border:1px solid #ccc;padding:3px 5px;text-align:center;font-size:9px}
    .cal th{background:#1E3A5F;color:#fff}
    .cal td.name,.cal th.name{text-align:left}
    .cal .we{color:#B45309}
    .cal .t{color:#9CA3AF;background:#fff}
    .legend{font-size:10px;color:#333;margin:2px 0 10px}
    .swatch{display:inline-block;width:11px;height:11px;border:1px solid #ccc;vertical-align:middle;margin:0 3px 0 8px}
    .criterio{font-size:11px;color:#333;margin:8px 0 4px}
  `;

  if (!inspectors.length) {
    const html = pdfDocument({
      title: 'DISTRIBUCIÓN DE GUARDIAS',
      subtitle,
      body: '<p>No hay inspectores en la distribución. Agrega inspectores y sus guardias.</p>',
      extraCss,
    });
    return await exportPdf(html, `Distribucion de guardias ${dmy(from)} a ${dmy(to)}`);
  }

  // 1) Lista de días ISO del ciclo (from..to inclusive). Sin new Date() sin args.
  const dias: string[] = [];
  {
    const d = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    while (d.getTime() <= end.getTime()) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      dias.push(`${y}-${m}-${dd}`);
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }

  // Shifts por inspector (por nombre).
  const shiftsByInsp = new Map<string, GuardShift[]>();
  shifts.forEach((s) => {
    const list = shiftsByInsp.get(s.inspector_name) ?? [];
    list.push(s);
    shiftsByInsp.set(s.inspector_name, list);
  });
  const cubre = (s: GuardShift, dia: string) => s.from_date <= dia && dia <= s.to_date;
  /** Estado (inspector, día): 'D' solo si cae en un descanso; el resto 'T'. */
  const estado = (name: string, dia: string): 'D' | 'T' => {
    const list = shiftsByInsp.get(name) || [];
    if (list.some((s) => s.kind === 'descanso' && cubre(s, dia))) return 'D';
    return 'T';
  };
  /** Primer shift 'descanso' del inspector dentro del ciclo (o null). */
  const primerDescanso = (name: string): GuardShift | null =>
    (shiftsByInsp.get(name) || []).find((s) => s.kind === 'descanso') || null;

  // Orden: por grupo (cmpText) y luego por nombre.
  const orden = inspectors.slice().sort((a, b) =>
    cmpText(a.grupo || '', b.grupo || '') || cmpText(a.name, b.name));

  // KPIs del ciclo.
  const nInspectores = inspectors.length;
  const grupos = Array.from(new Set(inspectors.map((i) => (i.grupo || '').trim()).filter(Boolean)))
    .sort((a, b) => cmpText(a, b));
  const nGrupos = grupos.length;
  const nDias = dias.length;
  // Conteo de 'D' por día → máximo en descanso y mínimo de activos.
  const descansoPorDia = dias.map((dia) => orden.reduce((n, i) => n + (estado(i.name, dia) === 'D' ? 1 : 0), 0));
  const maxDescansoDia = descansoPorDia.length ? Math.max(...descansoPorDia) : 0;
  const activosMin = nInspectores - maxDescansoDia;

  const kpis =
    `<div>` +
    `<div class="kpi"><b>${nInspectores}</b>INSPECTORES EN ROTACIÓN</div>` +
    `<div class="kpi"><b>${nGrupos}</b>GRUPOS</div>` +
    `<div class="kpi"><b>${nDias}</b>DÍAS POR CICLO</div>` +
    `<div class="kpi"><b>${maxDescansoDia}</b>EN DESCANSO (máx/día)</div>` +
    `<div class="kpi"><b>${activosMin}</b>ACTIVOS (mín/día)</div>` +
    `</div>`;

  // Tabla calendario.
  const esFinDeSemana = (dia: string) => { const w = new Date(dia + 'T00:00:00Z').getUTCDay(); return w === 0 || w === 6; };
  const letraDia = (dia: string) => DOW[new Date(dia + 'T00:00:00Z').getUTCDay()];
  const headDias = dias.map((dia) => {
    const dd = dia.split('-')[2];
    const we = esFinDeSemana(dia) ? ' class="we"' : '';
    return `<th${we}>${dd}<br/>${letraDia(dia)}</th>`;
  }).join('');
  const filasCal = orden.map((i) => {
    const celdas = dias.map((dia) => {
      const st = estado(i.name, dia);
      if (st === 'D') return `<td style="background:${colorGrupo(i.grupo)}"><b>D</b></td>`;
      return `<td class="t">T</td>`;
    }).join('');
    return `<tr><td class="name"><b>${esc(i.name)}</b></td><td>${esc(i.grupo || '—')}</td>${celdas}</tr>`;
  }).join('');
  const filaDescanso = `<tr><th class="name">En descanso</th><th></th>${descansoPorDia.map((n) => `<th>${n}</th>`).join('')}</tr>`;
  const tablaCal =
    `<table class="cal"><thead>` +
    `<tr><th class="name">Inspector</th><th>Gr.</th>${headDias}</tr>` +
    `</thead><tbody>${filasCal}</tbody>` +
    `<tfoot>${filaDescanso}</tfoot></table>`;

  const legendGrupos = grupos.map((g) => `<span class="swatch" style="background:${colorGrupo(g)}"></span>${esc(g)}`).join(' ');
  const leyenda = `<div class="legend"><b>D</b> En descanso · <b>T</b> En turno${legendGrupos ? ' · Grupos: ' + legendGrupos : ''}</div>`;

  // 2) Conformación de los grupos.
  const descansoTxt = (name: string): string => {
    const d = primerDescanso(name);
    return d ? `${dm(d.from_date)} al ${dm(d.to_date)}` : '—';
  };
  const filasGrupo = orden.map((i) =>
    `<tr>
      <td>${esc(i.grupo || '—')}</td>
      <td><b>${esc(i.name)}</b></td>
      <td>${esc(i.cedula || '—')}</td>
      <td>${esc(i.telefono || '—')}</td>
      <td>${esc(i.sector || '—')}</td>
      <td>${esc(i.cargo || '—')}</td>
      <td>${esc(descansoTxt(i.name))}</td>
    </tr>`).join('');
  const tablaGrupos =
    `<table class="ir"><thead><tr>` +
    `<th>Grupo</th><th>Inspector</th><th>Cédula</th><th>Teléfono</th><th>Sector</th><th>Cargo</th><th>Descanso del ciclo</th>` +
    `</tr></thead><tbody>${filasGrupo}</tbody></table>`;

  // Cobertura por grupo.
  const filasCobertura = grupos.map((g) => {
    const miembros = orden.filter((i) => (i.grupo || '').trim() === g);
    const coords = miembros.filter((i) => (i.cargo || '').trim().toLowerCase() === 'coordinador').length;
    const nocturnos = miembros.filter((i) => (i.cargo || '').trim().toLowerCase() === 'nocturno').length;
    // Rango de descanso del grupo = primer descanso de algún miembro del grupo.
    let rango = '—';
    for (const m of miembros) { const d = primerDescanso(m.name); if (d) { rango = `${dm(d.from_date)} al ${dm(d.to_date)}`; break; } }
    return `<tr>
      <td><b>${esc(g)}</b></td>
      <td class="r">${miembros.length}</td>
      <td class="r">${coords}</td>
      <td class="r">${nocturnos}</td>
      <td>${esc(rango)}</td>
    </tr>`;
  }).join('');
  const tablaCobertura = grupos.length
    ? `<table class="ir"><thead><tr>` +
      `<th>Grupo</th><th class="r">Inspectores</th><th class="r">Coordinadores</th><th class="r">Nocturnos</th><th>Descansa (rango)</th>` +
      `</tr></thead><tbody>${filasCobertura}</tbody></table>`
    : '<p>Sin grupos definidos.</p>';

  const criterio = `<p class="criterio"><b>Criterio:</b> Los grupos se arman para que nunca descansen a la vez los dos coordinadores ni los dos inspectores nocturnos.</p>`;

  const body =
    `<h3>Calendario del ciclo</h3>` +
    kpis +
    tablaCal +
    leyenda +
    `<h3>Conformación de los grupos</h3>` +
    tablaGrupos +
    `<h3>Cobertura por grupo</h3>` +
    tablaCobertura +
    criterio;

  const html = pdfDocument({
    title: 'DISTRIBUCIÓN DE GUARDIAS',
    subtitle,
    body,
    extraCss,
  });
  return await exportPdf(html, `Distribucion de guardias ${dmy(from)} a ${dmy(to)}`);
}
