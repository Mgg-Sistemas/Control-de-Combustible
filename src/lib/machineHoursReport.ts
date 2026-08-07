import { selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';

/**
 * Reporte HORAS TRABAJADAS (TOTALES) · PRÓXIMAS A MANTENIMIENTO (PDF), filtrable por
 * empresa.
 *
 * Métrica = TOTAL de horas trabajadas por jornadas de cada máquina: la suma de
 * `day_hours + night_hours` de TODAS las fechas en `machine_rounds` (no es por día;
 * es el acumulado histórico — la flota mide sus horas por jornadas de inspección,
 * no por horómetro).
 *
 * Regla de mantenimiento pedida por el cliente:
 *   🟡 alerta a 200 h · 🟠 media a 220 h · 🔴 límite (a mantenimiento) a 250 h.
 *
 * @param companyIds  IDs de empresas a incluir. Vacío = TODAS.
 * @returns true si se imprimió/guardó, false si se canceló o no hay datos.
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dash = (v: any) => { const s = String(v ?? '').trim(); return s || '—'; };
const n1 = (n: number) => Math.round(n * 10) / 10;

const LIMITE = 250; // 🔴 a mantenimiento
const MEDIA = 220;  // 🟠 media
const ALERTA = 200; // 🟡 alerta

type Nivel = 'limite' | 'media' | 'alerta' | 'ok';
function nivelDe(horas: number): Nivel {
  if (horas >= LIMITE) return 'limite';
  if (horas >= MEDIA) return 'media';
  if (horas >= ALERTA) return 'alerta';
  return 'ok';
}
const NIVEL_META: Record<Nivel, { label: string; bg: string }> = {
  limite: { label: '🔴 A MANTENIMIENTO', bg: '#FDE0E0' },
  media: { label: '🟠 MEDIA', bg: '#FDEBD0' },
  alerta: { label: '🟡 ALERTA', bg: '#FCF3CF' },
  ok: { label: '🟢 OK', bg: '' },
};

type Fila = {
  code: string; serialPlaca: string; encargado: string; empresa: string;
  horas: number;            // total de horas trabajadas (jornadas)
  restante: number;         // 250 − horas (negativo = pasada del límite)
  nivel: Nivel;
};

export async function generateMachineHoursReport(opts: { companyIds?: string[] }): Promise<boolean> {
  const companyIds = opts.companyIds ?? [];

  // 1) Máquinas (todas o de las empresas elegidas). Solo las activas del catálogo.
  const machs = await selectAllRows(
    'machinery',
    'id, code, serial, plate, encargado, active, company_id, company:company_id(name)',
    companyIds.length ? (q) => q.in('company_id', companyIds) : undefined,
  );
  const rows = ((machs ?? []) as any[]).filter((m) => m.active !== false);
  if (!rows.length) return false;
  const validId = new Set(rows.map((m) => m.id));

  // 2) TOTAL de horas trabajadas por máquina (histórico completo de machine_rounds).
  const roundsRows = await selectAllRows('machine_rounds', 'machinery_id, day_hours, night_hours');
  const horasBy = new Map<string, number>();
  ((roundsRows ?? []) as any[]).forEach((r) => {
    if (!validId.has(r.machinery_id)) return;
    horasBy.set(r.machinery_id, (horasBy.get(r.machinery_id) ?? 0) + (Number(r.day_hours) || 0) + (Number(r.night_hours) || 0));
  });

  // 3) Filas.
  const filas: Fila[] = rows.map((m) => {
    const horas = n1(horasBy.get(m.id) ?? 0);
    return {
      code: m.code || '—',
      serialPlaca: m.serial || m.plate || '—',
      encargado: dash(m.encargado),
      empresa: m.company?.name || 'Sin empresa',
      horas,
      restante: n1(LIMITE - horas),
      nivel: nivelDe(horas),
    };
  });

  // 4) Resumen (conteos por nivel + total de horas).
  const cnt = { limite: 0, media: 0, alerta: 0, ok: 0 } as Record<Nivel, number>;
  filas.forEach((f) => { cnt[f.nivel] += 1; });
  const totHoras = n1(filas.reduce((s, f) => s + f.horas, 0));

  const celdaRestante = (f: Fila): string => {
    if (f.restante < 0) return `<td class="r" style="color:#B00">pasada +${n1(-f.restante)} h</td>`;
    return `<td class="r">${f.restante} h</td>`;
  };
  const filaHtml = (f: Fila, i: number, conEmpresa: boolean): string => {
    const bg = NIVEL_META[f.nivel].bg;
    const empresaCol = conEmpresa ? `<td>${esc(f.empresa)}</td>` : '';
    return `<tr${bg ? ` style="background:${bg}"` : ''}>
      <td>${i + 1}</td><td><b>${esc(f.code)}</b></td><td>${esc(dash(f.serialPlaca))}</td>
      <td>${esc(f.encargado)}</td>${empresaCol}
      <td class="r b">${f.horas}</td>${celdaRestante(f)}
      <td>${NIVEL_META[f.nivel].label}</td>
    </tr>`;
  };
  const encabezado = (conEmpresa: boolean): string => `<thead><tr>
      <th style="width:24px">Nº</th><th>Máquina</th><th>Serial/Placa</th><th>Encargado</th>
      ${conEmpresa ? '<th>Empresa</th>' : ''}
      <th class="r">Horas trabajadas</th><th class="r">Faltan p/${LIMITE}</th><th>Estado</th>
    </tr></thead>`;

  // 4a) Bloque destacado: PRÓXIMAS A MANTENIMIENTO (≥ 200 h), más urgente primero.
  const proximas = filas.filter((f) => f.nivel !== 'ok')
    .sort((a, b) => b.horas - a.horas || cmpText(a.code, b.code));
  const bloqueProximas = proximas.length
    ? `<h3 class="warn">⚠️ PRÓXIMAS A MANTENIMIENTO · ${proximas.length} máquina(s) (≥ ${ALERTA} h)</h3>
       <table class="ir">${encabezado(true)}<tbody>${proximas.map((f, i) => filaHtml(f, i, true)).join('')}</tbody></table>`
    : `<h3 class="ok">✅ Ninguna máquina alcanza el umbral de alerta (${ALERTA} h) por ahora.</h3>`;

  // 4b) Detalle por EMPRESA (todas las máquinas), orden por horas desc.
  const porEmpresa = new Map<string, Fila[]>();
  filas.forEach((f) => { if (!porEmpresa.has(f.empresa)) porEmpresa.set(f.empresa, []); porEmpresa.get(f.empresa)!.push(f); });
  const empresas = Array.from(porEmpresa.entries()).sort((a, b) => cmpText(a[0], b[0]));
  const secciones = empresas.map(([name, fs]) => {
    const ordenadas = fs.slice().sort((a, b) => b.horas - a.horas || cmpText(a.code, b.code));
    const tHoras = n1(fs.reduce((s, f) => s + f.horas, 0));
    const foot = `<tfoot><tr><td colspan="4">Total · ${fs.length} equipo(s)</td><td class="r b">${tHoras}</td><td colspan="2"></td></tr></tfoot>`;
    return `<h3>🏢 ${esc(name)} · ${fs.length} máquina(s)</h3>
      <table class="ir">${encabezado(false)}<tbody>${ordenadas.map((f, i) => filaHtml(f, i, false)).join('')}</tbody>${foot}</table>`;
  }).join('');

  const extraCss = `
    h3{margin:16px 0 3px;font-size:13px;color:#1E3A5F;padding-bottom:3px;border-bottom:2px solid #1E3A5F}
    h3.warn{color:#B00;border-bottom-color:#B00}
    h3.ok{color:#1B7F3B;border-bottom-color:#1B7F3B}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
    td.r,th.r{text-align:right} td.b{font-weight:800}
    .leyenda{font-size:10.5px;color:#444;margin:2px 0 10px}
    .leyenda b{color:#111}
  `;

  const leyenda = `<div class="leyenda">
    <b>Horas trabajadas</b> = total acumulado de las jornadas (día + noche) de cada máquina ·
    umbral de mantenimiento: 🟡 alerta a <b>${ALERTA} h</b> · 🟠 media a <b>${MEDIA} h</b> · 🔴 límite a <b>${LIMITE} h</b>.
  </div>`;

  const subtitle = `${empresas.length} empresa(s) · ${filas.length} máquina(s) · `
    + `🔴 ${cnt.limite} límite · 🟠 ${cnt.media} media · 🟡 ${cnt.alerta} alerta · 🟢 ${cnt.ok} ok`
    + ` · ⏱️ ${totHoras} h trabajadas en total`;

  const html = pdfDocument({
    title: 'HORAS TRABAJADAS · PRÓXIMAS A MANTENIMIENTO',
    subtitle,
    body: leyenda + bloqueProximas + secciones,
    extraCss,
  });
  const nombreEmp = companyIds.length ? `${empresas.length} empresa` : 'todas las empresas';
  return await exportPdf(html, `Horas trabajadas maquinaria ${nombreEmp}`);
}
