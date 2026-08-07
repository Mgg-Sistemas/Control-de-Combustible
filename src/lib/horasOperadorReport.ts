import { selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText, norm } from './text';

/**
 * Reporte HORAS POR OPERADOR (PDF).
 *
 * Para un rango de fechas [from, to] resume, por PERSONA (operador), cuántas
 * JORNADAS trabajó y cuántas HORAS acumuló, cruzando la tabla
 * `operator_assignments` (una fila = una jornada de un operador en una máquina,
 * turno día/noche, con `worked_hours`). Opcionalmente se filtra a un subconjunto
 * de operadores por su nombre completo (`opts.operators`).
 *
 * @param opts.from      fecha inicial ISO "AAAA-MM-DD" (inclusive).
 * @param opts.to        fecha final ISO "AAAA-MM-DD" (inclusive).
 * @param opts.operators nombres completos a incluir; vacío/omitido = todos.
 * @returns true si se imprimió/guardó, false si se canceló o no hay datos.
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
const n1 = (n: number) => Math.round(n * 10) / 10;

type Row = {
  first_name: string | null;
  last_name: string | null;
  cedula: string | null;
  machinery_id: string | null;
  company_name: string | null;
  work_date: string;
  shift: 'day' | 'night' | null;
  worked_hours: number | null;
  machine?: { code?: string | null; sector?: string | null } | null;
};

type Detalle = { work_date: string; shift: 'day' | 'night' | null; code: string; sector: string; horas: number };
type Operador = {
  key: string;
  nombre: string;
  jornadas: number;
  horas: number;
  maquinas: Set<string>;
  empresas: Set<string>;
  detalles: Detalle[];
};

export async function generateHorasOperadorReport(opts: { from: string; to: string; operators?: string[] }): Promise<boolean> {
  const { from, to } = opts;

  // 1) Jornadas de operadores en el rango (con la máquina embebida). Paginado seguro.
  const data = await selectAllRows(
    'operator_assignments',
    'first_name, last_name, cedula, machinery_id, company_name, work_date, shift, worked_hours, machine:machinery_id(code, sector)',
    (q) => q.gte('work_date', from).lte('work_date', to),
  );
  let rows = ((data ?? []) as any[]) as Row[];

  // 2) Filtro opcional por nombre completo (en cliente, normalizando).
  const nombreDe = (r: Row) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();
  if (opts.operators && opts.operators.length) {
    const wanted = new Set(opts.operators.map((s) => norm(s)));
    rows = rows.filter((r) => wanted.has(norm(nombreDe(r))));
  }

  // 3) Agrupa por operador (clave = cédula si existe, si no el nombre completo).
  const porOperador = new Map<string, Operador>();
  rows.forEach((r) => {
    const nombre = nombreDe(r) || (r.cedula ? String(r.cedula) : '') || '—';
    const key = (r.cedula && String(r.cedula).trim()) || nombre;
    let op = porOperador.get(key);
    if (!op) {
      op = { key, nombre, jornadas: 0, horas: 0, maquinas: new Set(), empresas: new Set(), detalles: [] };
      porOperador.set(key, op);
    }
    const horas = Number(r.worked_hours) || 0;
    const code = (r.machine?.code && String(r.machine.code).trim()) || '';
    const sector = (r.machine?.sector && String(r.machine.sector).trim()) || '—';
    const empresa = (r.company_name && String(r.company_name).trim()) || '';
    op.jornadas += 1;
    op.horas += horas;
    if (code) op.maquinas.add(code);
    if (empresa) op.empresas.add(empresa);
    op.detalles.push({ work_date: r.work_date, shift: r.shift, code: code || '—', sector, horas: n1(horas) });
  });

  // 4) Orden por horas DESC, desempate por nombre.
  const operadores = Array.from(porOperador.values())
    .map((o) => ({ ...o, horas: n1(o.horas) }))
    .sort((a, b) => (b.horas - a.horas) || cmpText(a.nombre, b.nombre));

  const turnoTxt = (s: 'day' | 'night' | null): string => (s === 'night' ? '🌙 Noche' : s === 'day' ? '☀️ Día' : '—');
  const empresasTxt = (o: Operador): string => (o.empresas.size ? Array.from(o.empresas).sort((a, b) => cmpText(a, b)).join(' · ') : '—');

  // 5a) Ranking (resumen arriba).
  const ranking = operadores.map((o, i) =>
    `<tr>
      <td>${i + 1}</td><td><b>${esc(o.nombre)}</b></td>
      <td class="r">${o.jornadas}</td>
      <td class="r b">${o.horas}</td>
      <td class="r">${o.maquinas.size}</td>
      <td>${esc(empresasTxt(o))}</td>
    </tr>`).join('');
  const totJornadas = operadores.reduce((s, o) => s + o.jornadas, 0);
  const totHoras = n1(operadores.reduce((s, o) => s + o.horas, 0));
  const bloqueRanking = `<h3>🏁 Ranking · ${operadores.length} operador(es)</h3>
    <table class="ir"><thead><tr>
      <th style="width:24px">Nº</th><th>Operador</th>
      <th class="r">Jornadas</th><th class="r">Horas</th><th class="r">Máquinas</th><th>Empresa(s)</th>
    </tr></thead><tbody>${ranking}</tbody>
    <tfoot><tr><td colspan="2">Total · ${operadores.length} operador(es)</td>
      <td class="r b">${totJornadas}</td><td class="r b">${totHoras}</td><td colspan="2"></td></tr></tfoot></table>`;

  // 5b) Detalle por operador.
  const secciones = operadores.map((o) => {
    const filas = o.detalles.slice().sort((a, b) => cmpText(a.work_date, b.work_date)).map((d) =>
      `<tr>
        <td>${esc(dmy(d.work_date))}</td>
        <td>${turnoTxt(d.shift)}</td>
        <td><b>${esc(d.code)}</b></td>
        <td>${esc(d.sector)}</td>
        <td class="r b">${d.horas}</td>
      </tr>`).join('');
    return `<h3>👷 ${esc(o.nombre)} · ${o.horas} h · ${o.jornadas} jornada(s)</h3>
      <table class="ir"><thead><tr>
        <th>Fecha</th><th>Turno</th><th>Máquina</th><th>Sector</th><th class="r">Horas</th>
      </tr></thead><tbody>${filas}</tbody></table>`;
  }).join('');

  const extraCss = `
    h3{margin:16px 0 3px;font-size:13px;color:#1E3A5F;padding-bottom:3px;border-bottom:2px solid #1E3A5F}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
    td.r,th.r{text-align:right} td.b{font-weight:800}
  `;

  const subtitle = `${dmy(from)} — ${dmy(to)} · ${operadores.length} operador(es) · 🕒 ${totHoras} h en total`;

  const html = pdfDocument({
    title: 'HORAS POR OPERADOR',
    subtitle,
    body: operadores.length ? (bloqueRanking + secciones) : '<p>Sin jornadas de operadores en el rango.</p>',
    extraCss,
  });
  return await exportPdf(html, `Horas por operador ${dmy(from)} a ${dmy(to)}`);
}
