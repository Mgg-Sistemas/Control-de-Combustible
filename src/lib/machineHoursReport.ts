import { selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText, norm } from './text';
import { ordenarMaquinas, agruparMaquinas } from './ordenMaquinas';

/**
 * Reporte HORAS DEL HORÓMETRO · PRÓXIMAS A MANTENIMIENTO (PDF), filtrable por empresa.
 *
 * Métrica = horas del HORÓMETRO acumuladas desde el último mantenimiento:
 *   horas = last_horometro − horometro_base   (= final − inicial acumulado)
 * donde `last_horometro` es el horómetro vivo (se actualiza con el horómetro final de
 * cada jornada) y `horometro_base` es la lectura en el último mantenimiento confirmado
 * (se reinicia con "Confirmar mantenimiento" en Mantenimiento de Maquinaria). Misma
 * fuente que las alertas de la campana (ver supabase/horometro_alertas.sql).
 *
 * Regla de mantenimiento:
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

type Nivel = 'limite' | 'media' | 'alerta' | 'ok' | 'sin';
function nivelDe(horas: number | null): Nivel {
  if (horas == null) return 'sin';
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
  sin: { label: '— sin horómetro', bg: '#EEE' },
};

type Fila = {
  code: string; modelo: string; serialPlaca: string; encargado: string; empresa: string;
  horas: number | null;     // horas del horómetro (last_horometro − base); null = sin horómetro
  restante: number | null;  // 250 − horas (negativo = pasada del límite)
  nivel: Nivel;
};

export async function generateMachineHoursReport(opts: { companyIds?: string[]; encargados?: string[]; groupBy?: 'empresa' | 'encargado' }): Promise<boolean> {
  const companyIds = opts.companyIds ?? [];
  const encargados = opts.encargados ?? [];
  // Cómo se parte el detalle en secciones. 'empresa' es lo de siempre; 'encargado'
  // arma las mismas tablas pero una por responsable (pedido del cliente 21-ago-2026).
  const groupBy = opts.groupBy ?? 'empresa';

  // 1) Máquinas (todas o de las empresas/encargados elegidos), con su horómetro vivo y
  //    base. `tipo` = MODELO de la máquina (CAT 320, Komatsu PC200…).
  const machs = await selectAllRows(
    'machinery',
    'id, code, serial, plate, tipo, encargado, active, last_horometro, horometro_base, company_id, company:company_id(name)',
    (companyIds.length || encargados.length)
      ? (q) => { let qq = q; if (companyIds.length) qq = qq.in('company_id', companyIds); if (encargados.length) qq = qq.in('encargado', encargados); return qq; }
      : undefined,
  );
  const rows = ((machs ?? []) as any[]).filter((m) => m.active !== false);
  if (!rows.length) return false;

  // 2) Filas — horas del HORÓMETRO desde el último mantenimiento (last − base).
  const filas: Fila[] = rows.map((m) => {
    const lh = m.last_horometro != null ? Number(m.last_horometro) : null;
    const base = m.horometro_base != null ? Number(m.horometro_base) : lh; // sin base → 0 acumuladas
    const horas = lh != null && base != null ? Math.max(0, n1(lh - base)) : null;
    return {
      code: m.code || '—',
      modelo: (m.tipo && String(m.tipo).trim()) || '—',
      serialPlaca: m.serial || m.plate || '—',
      encargado: dash(m.encargado),
      empresa: m.company?.name || 'Sin empresa',
      horas,
      restante: horas != null ? n1(LIMITE - horas) : null,
      nivel: nivelDe(horas),
    };
  });

  // 3) Resumen (conteos por nivel + total de horas de horómetro).
  const cnt = { limite: 0, media: 0, alerta: 0, ok: 0, sin: 0 } as Record<Nivel, number>;
  filas.forEach((f) => { cnt[f.nivel] += 1; });
  const totHoras = n1(filas.reduce((s, f) => s + (f.horas ?? 0), 0));

  const celdaHoras = (f: Fila): string => (f.horas == null ? '<td class="r">—</td>' : `<td class="r b">${f.horas}</td>`);
  const celdaRestante = (f: Fila): string => {
    if (f.restante == null) return '<td class="r">—</td>';
    if (f.restante < 0) return `<td class="r" style="color:#B00">pasada +${n1(-f.restante)} h</td>`;
    return `<td class="r">${f.restante} h</td>`;
  };
  const filaHtml = (f: Fila, i: number, conEmpresa: boolean): string => {
    const bg = NIVEL_META[f.nivel].bg;
    const empresaCol = conEmpresa ? `<td>${esc(f.empresa)}</td>` : '';
    return `<tr${bg ? ` style="background:${bg}"` : ''}>
      <td>${i + 1}</td><td><b>${esc(f.code)}</b></td><td>${esc(dash(f.modelo))}</td><td>${esc(dash(f.serialPlaca))}</td>
      <td>${esc(f.encargado)}</td>${empresaCol}
      ${celdaHoras(f)}${celdaRestante(f)}
      <td>${NIVEL_META[f.nivel].label}</td>
    </tr>`;
  };
  const encabezado = (conEmpresa: boolean): string => `<thead><tr>
      <th style="width:24px">Nº</th><th>Máquina</th><th>Marca/Modelo</th><th>Serial/Placa</th><th>Encargado</th>
      ${conEmpresa ? '<th>Empresa</th>' : ''}
      <th class="r">Horas horómetro</th><th class="r">Faltan p/${LIMITE}</th><th>Estado</th>
    </tr></thead>`;

  // 4a) Bloque destacado: PRÓXIMAS A MANTENIMIENTO (≥ 200 h), más urgente primero.
  const proximas = filas.filter((f) => f.nivel === 'limite' || f.nivel === 'media' || f.nivel === 'alerta')
    .sort((a, b) => (b.horas ?? 0) - (a.horas ?? 0) || cmpText(a.code, b.code));
  const bloqueProximas = proximas.length
    ? `<h3 class="warn">⚠️ PRÓXIMAS A MANTENIMIENTO · ${proximas.length} máquina(s) (≥ ${ALERTA} h)</h3>
       <table class="ir">${encabezado(true)}<tbody>${proximas.map((f, i) => filaHtml(f, i, true)).join('')}</tbody></table>`
    : `<h3 class="ok">✅ Ninguna máquina alcanza el umbral de alerta (${ALERTA} h) por ahora.</h3>`;

  // 4b) Detalle por EMPRESA (o por ENCARGADO), orden por horas desc dentro de cada
  //     sección. El bloque "próximas a mantenimiento" de arriba NO se toca: ese es
  //     una lista de urgencias y se lee entera, no por grupos.
  //     El agrupado por encargado se delega en `ordenMaquinas.ts`, que es la única
  //     verdad sobre cuándo dos grafías son el mismo responsable.
  const porEmpresa = new Map<string, Fila[]>();
  filas.forEach((f) => { if (!porEmpresa.has(f.empresa)) porEmpresa.set(f.empresa, []); porEmpresa.get(f.empresa)!.push(f); });
  const empresas: [string, Fila[]][] = groupBy === 'encargado'
    ? agruparMaquinas(ordenarMaquinas(filas, 'encargado'), 'encargado').map((g) => [g.label, g.items] as [string, Fila[]])
    : Array.from(porEmpresa.entries()).sort((a, b) => cmpText(a[0], b[0]));
  const icoGrupo = groupBy === 'encargado' ? '👤' : '🏢';
  const secciones = empresas.map(([name, fs]) => {
    const ordenadas = fs.slice().sort((a, b) => (b.horas ?? -1) - (a.horas ?? -1) || cmpText(a.code, b.code));
    const tHoras = n1(fs.reduce((s, f) => s + (f.horas ?? 0), 0));
    const foot = `<tfoot><tr><td colspan="5">Total · ${fs.length} equipo(s)</td><td class="r b">${tHoras}</td><td colspan="2"></td></tr></tfoot>`;
    return `<h3>${icoGrupo} ${esc(name)} · ${fs.length} máquina(s)</h3>
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
    <b>Horas horómetro</b> = horómetro actual − horómetro del último mantenimiento (final − inicial acumulado) ·
    umbral: 🟡 alerta a <b>${ALERTA} h</b> · 🟠 media a <b>${MEDIA} h</b> · 🔴 límite a <b>${LIMITE} h</b>.
    Al confirmar el mantenimiento el contador vuelve a 0. "— sin horómetro" = máquina sin lectura registrada aún.
  </div>`;

  // `encargados` trae TODAS las variantes de escritura seleccionadas (p. ej. "Alberto"
  // y "ALBERTO" del mismo encargado); se unifican por clave normalizada para no
  // mostrar duplicados ni inflar el conteo en el subtítulo del PDF.
  const encargadosUnicos = (() => {
    const vistos = new Map<string, string>();
    encargados.forEach((e) => { const k = norm(e); if (!vistos.has(k)) vistos.set(k, e); });
    return [...vistos.values()];
  })();
  const filtroEnc = encargadosUnicos.length ? ` · 👤 ${encargadosUnicos.length} encargado(s): ${encargadosUnicos.join(', ')}` : '';
  // Si se agrupó por encargado, contar "empresa(s)" mentiría sobre lo que se ve.
  const cuentaGrupo = groupBy === 'encargado' ? `${empresas.length} encargado(s)` : `${empresas.length} empresa(s)`;
  const subtitle = `${cuentaGrupo} · ${filas.length} máquina(s)${filtroEnc} · `
    + `🔴 ${cnt.limite} límite · 🟠 ${cnt.media} media · 🟡 ${cnt.alerta} alerta · 🟢 ${cnt.ok} ok`
    + (cnt.sin ? ` · — ${cnt.sin} sin horómetro` : '')
    + ` · ⏱️ ${totHoras} h horómetro en total`;

  const html = pdfDocument({
    title: 'HORAS HORÓMETRO · PRÓXIMAS A MANTENIMIENTO',
    subtitle,
    body: leyenda + bloqueProximas + secciones,
    extraCss,
  });
  // El nombre del archivo dice cómo quedó partido: dos PDF del mismo día con
  // cortes distintos no se pueden llamar igual o uno pisa al otro al guardarlos.
  const nombreEmp = groupBy === 'encargado'
    ? 'por encargado'
    : (companyIds.length ? `${empresas.length} empresa` : 'todas las empresas');
  return await exportPdf(html, `Horas horometro maquinaria ${nombreEmp}`);
}
