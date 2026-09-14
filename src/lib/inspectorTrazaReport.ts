import { selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { computeInspectorData } from './inspectorReport';
import { assignmentCountsForShift } from './inspectorDaySets';
import { listInspectorAssignments } from './machineInspectors';
import {
  OPCIONES_INSPECTOR_POR_DEFECTO, columnasInspector, tituloColumnaInspector, marcaModeloInspector,
  estadoComoTarjeta, entraEnLasTarjetas, ordenFilasInspector, resumenEstadosInspector,
  revisionInspectorTexto, ocultosInspectorEnPalabras, sufijoArchivoInspector,
  type OpcionesInspector, type ColumnaInspector, type EstadoTarjeta, type ResumenEstados,
} from './inspectorTrazaColumnas';

/**
 * REPORTE POR INSPECTOR (PDF) · Inspecciones → Reportes.
 *
 * ⭐ CUENTA IGUAL QUE LAS TARJETAS DE INSPECCIONES (14-sep-2026). Pedido del cliente:
 *    «ese reporte no me refleja la realidad». Hasta ese día salía de los CHECK-IN
 *    (`supervisor_visits`): solo traía las máquinas que el inspector escaneó, con las
 *    horas del día completo. Así «Inspector SOS» (72 jornadas, cero check-in) no
 *    aparecía, y las máquinas de un inspector revisadas por otro salían bajo el otro.
 *
 *    Ahora la columna vertebral son las ASIGNADAS por turno, con los datos de
 *    `computeInspectorData` —la misma agregación del reporte con firma y del recibo del
 *    teléfono— y el estado y las exclusiones de las tarjetas (ver
 *    `inspectorTrazaColumnas.ts`). El check-in queda como columna: hora de la primera
 *    revisión y, si la hizo otro inspector, su nombre.
 *
 * Las horas son las del TURNO (día o noche) calculadas con `horasTurnoDelDia`, la
 * fórmula única del sistema. No se reimplementa nada acá.
 *
 * Las columnas se eligen con pastillas, como el Conteo de equipos. Ocultan columnas,
 * nunca máquinas: los totales no cambian.
 */

type Turno = 'day' | 'night';
export type TurnoReporteInspector = Turno | 'both';

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
const h2 = (n: number) => (Number(n) || 0).toFixed(2);
const horaCaracas = (iso: string): string => {
  try { return new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso)); } catch { return '—'; }
};

const ESTADO_TXT: Record<EstadoTarjeta, { txt: string; color: string }> = {
  averia: { txt: '🔴 Averiada', color: '#B91C1C' },
  parada: { txt: '🟡 Parada', color: '#B45309' },
  encurso: { txt: '● En curso', color: '#067647' },
  cerrada: { txt: '✅ Cerrada', color: '#166534' },
  pendiente: { txt: '⏳ Pendiente', color: '#6B7280' },
};

const TURNO_META: Record<Turno, { icon: string; label: string }> = {
  day: { icon: '☀️', label: 'Turno de día' },
  night: { icon: '🌙', label: 'Turno de noche' },
};

/**
 * Genera y exporta el PDF.
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateInspectorTrazaReport(opts: {
  date: string;
  turno?: TurnoReporteInspector;
  inspectors?: string[];
  opciones?: OpcionesInspector;
}): Promise<boolean> {
  const { date } = opts;
  const turnoPedido: TurnoReporteInspector = opts.turno ?? 'both';
  const op = opts.opciones ?? OPCIONES_INSPECTOR_POR_DEFECTO;
  const fecha = dmy(date);
  const filtro = opts.inspectors && opts.inspectors.length ? new Set(opts.inspectors.map((n) => n.trim().toLowerCase())) : null;

  const [{ data }, { rows: asignaciones }, visitas, fichas] = await Promise.all([
    computeInspectorData(date, null),
    listInspectorAssignments(),
    selectAllRows('supervisor_visits', 'supervisor_name, machinery_id, visited_at', (q: any) => q.eq('visit_date', date)),
    // Marca, modelo y clasificación no vienen en la agregación: se leen del catálogo.
    selectAllRows('machinery', 'id, marca, modelo, tipo, clasificacion, encargado'),
  ]);

  const asigPorClave = new Map<string, { shift: Turno; assigned_at?: string | null }>();
  (asignaciones ?? []).forEach((a: any) => asigPorClave.set(`${a.machinery_id}|${a.shift}`, { shift: a.shift, assigned_at: a.assigned_at ?? null }));
  const visitasPorMaquina = new Map<string, { nombre: string; at: string }[]>();
  ((visitas ?? []) as any[]).forEach((v) => {
    const id = String(v.machinery_id ?? '');
    if (!id || !v.visited_at) return;
    const arr = visitasPorMaquina.get(id) ?? [];
    arr.push({ nombre: String(v.supervisor_name ?? ''), at: String(v.visited_at) });
    visitasPorMaquina.set(id, arr);
  });
  const fichaPorId = new Map<string, any>();
  ((fichas ?? []) as any[]).forEach((f) => fichaPorId.set(String(f.id), f));

  const cols = columnasInspector(op);
  const turnos: Turno[] = turnoPedido === 'day' ? ['day'] : turnoPedido === 'night' ? ['night'] : ['day', 'night'];

  type Fila = { estadoTarjeta: EstadoTarjeta; code: string; placa: string; horas: number; celdas: Record<ColumnaInspector, string> };

  const general: ResumenEstados = { asignadas: 0, encurso: 0, cerradas: 0, pendientes: 0, paradas: 0, averiadas: 0, horas: 0 };
  let inspectoresIncluidos = 0;

  const seccionTurno = (turno: Turno): string => {
    const tMap = data.get(turno);
    const meta = TURNO_META[turno];
    const nombres = [...(tMap?.keys() ?? [])]
      .filter((n) => !filtro || filtro.has(n.trim().toLowerCase()))
      .sort(cmpText);

    const bloques = nombres.map((insp) => {
      const machs = [...(tMap!.get(insp)?.values() ?? [])];
      const filas: Fila[] = [];
      machs.forEach((m) => {
        const estadoTarjeta = estadoComoTarjeta(m);
        const asig = asigPorClave.get(`${m.id}|${turno}`);
        const asignacionCuenta = !asig || assignmentCountsForShift(asig, date, turno);
        const horas = turno === 'day' ? m.dayH : m.nightH;
        const horasOtroTurno = turno === 'day' ? m.nightH : m.dayH;
        if (!entraEnLasTarjetas({ estado: estadoTarjeta, asignacionCuenta, horasOtroTurno })) return;

        const ficha = fichaPorId.get(m.id) ?? {};
        const placa = m.plate || m.serial || '—';
        const nota = (() => {
          if (m.incidenteAveria) {
            const inc = m.incidenteAveria;
            return `${inc.trabajoHasta ? `trabajó hasta ${inc.trabajoHasta} · ` : ''}${inc.tipo === 'averia' ? '🔧 averiada desde' : '🟡 parada desde'} ${inc.hora}${inc.motivo ? ` · ${inc.motivo}` : ''}`;
          }
          if ((m.estado === 'averia' || m.estado === 'parada') && m.motivo) return m.motivo;
          if (m.estado === 'finalizada' && m.cierreMotivo) return `📝 ${m.cierreMotivo}`;
          return '—';
        })();
        const inicio = [m.iniBy ? `▶️ ${m.iniBy}` : '', m.cierreFinBy ? `🏁 ${m.cierreFinBy}` : ''].filter(Boolean).join(' · ') || '—';
        const celdas: Record<ColumnaInspector, string> = {
          n: '',
          maquina: m.code || '—',
          marcaModelo: marcaModeloInspector({ marca: ficha.marca, modelo: ficha.modelo, tipo: ficha.tipo ?? m.tipo }, op),
          placa,
          empresa: m.company || '—',
          clasificacion: String(ficha.clasificacion ?? '').trim() || '—',
          encargado: String(m.encargado ?? ficha.encargado ?? '').trim() || '—',
          sector: m.sector || '—',
          edificio: m.edificio || '—',
          estado: estadoTarjeta,
          revision: revisionInspectorTexto(visitasPorMaquina.get(m.id) ?? [], insp, horaCaracas),
          horas: h2(horas),
          inicio,
          nota,
        };
        filas.push({ estadoTarjeta, code: m.code || '', placa, horas, celdas });
      });
      if (!filas.length) return '';

      const ordenadas = ordenFilasInspector(filas);
      const r = resumenEstadosInspector(ordenadas);
      inspectoresIncluidos++;
      general.asignadas += r.asignadas; general.encurso += r.encurso; general.cerradas += r.cerradas;
      general.pendientes += r.pendientes; general.paradas += r.paradas; general.averiadas += r.averiadas;
      general.horas = Math.round((general.horas + r.horas) * 100) / 100;

      const thead = cols.map((c) => `<th class="c-${c}${c === 'horas' ? ' r' : ''}">${esc(tituloColumnaInspector(c, op, turno))}</th>`).join('');
      const tbody = ordenadas.map((f, i) => `<tr>${cols.map((c) => {
        if (c === 'n') return `<td>${i + 1}</td>`;
        if (c === 'maquina') return `<td><b>${esc(f.celdas.maquina)}</b></td>`;
        if (c === 'estado') { const e = ESTADO_TXT[f.estadoTarjeta]; return `<td style="color:${e.color};font-weight:700;white-space:nowrap">${esc(e.txt)}</td>`; }
        if (c === 'horas') return `<td class="r b">${esc(f.celdas.horas)}</td>`;
        if (c === 'revision') return `<td class="${f.celdas.revision === 'Sin check-in' ? 'nd' : ''}">${esc(f.celdas.revision)}</td>`;
        return `<td>${esc(f.celdas[c])}</td>`;
      }).join('')}</tr>`).join('');
      const idxHoras = cols.indexOf('horas');
      const pie = `<tr><td colspan="${idxHoras}">Total · ${r.asignadas} máquina(s)</td><td class="r b">${h2(r.horas)}</td>${cols.length - idxHoras - 1 > 0 ? `<td colspan="${cols.length - idxHoras - 1}"></td>` : ''}</tr>`;

      const chips = [
        `<span style="color:#067647">● ${r.encurso} en curso</span>`,
        `<span style="color:#166534">✅ ${r.cerradas} cerrada(s)</span>`,
        `<span style="color:#6B7280">⏳ ${r.pendientes} pendiente(s)</span>`,
        `<span style="color:#B45309">🟡 ${r.paradas} parada(s)</span>`,
        `<span style="color:#B91C1C">🔴 ${r.averiadas} averiada(s)</span>`,
        `<span style="color:#1E3A5F">🕒 ${h2(r.horas)} h del turno</span>`,
      ].join(' · ');
      return `<div class="insp">👷 <b>${esc(insp)}</b> <span class="cnt">${r.asignadas} asignada(s)</span><div class="estres">${chips}</div></div>`
        + `<table class="ir"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody><tfoot>${pie}</tfoot></table>`;
    }).filter(Boolean);

    if (!bloques.length) {
      return `<h2 class="turno">${meta.icon} ${meta.label}</h2><p class="none">${filtro ? 'Sin máquinas asignadas a los inspectores elegidos en este turno.' : 'Sin máquinas asignadas en este turno.'}</p>`;
    }
    return `<h2 class="turno">${meta.icon} ${meta.label} <span class="tcnt">${bloques.length} inspector(es)</span></h2>${bloques.join('')}`;
  };

  const secciones = turnos.map(seccionTurno).join('');

  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="k">Inspectores</div><div class="v">${inspectoresIncluidos}</div></div>
      <div class="kpi"><div class="k">Asignadas</div><div class="v">${general.asignadas}</div></div>
      <div class="kpi ok"><div class="k">En curso</div><div class="v">${general.encurso}</div></div>
      <div class="kpi"><div class="k">Cerradas</div><div class="v">${general.cerradas}</div></div>
      <div class="kpi"><div class="k">Pendientes</div><div class="v">${general.pendientes}</div></div>
      <div class="kpi warn"><div class="k">Paradas</div><div class="v">${general.paradas}</div></div>
      <div class="kpi warn"><div class="k">Averiadas</div><div class="v">${general.averiadas}</div></div>
      <div class="kpi ok"><div class="k">Horas del turno</div><div class="v">${h2(general.horas)}</div></div>
    </div>
    <div class="nota-gen">Cuenta igual que las tarjetas de Inspecciones: las máquinas ASIGNADAS a cada inspector en el turno, con su estado y las horas de ESE turno. La columna Check-in dice a qué hora se revisó y, si lo hizo otro inspector, quién. ${esc(ocultosInspectorEnPalabras(op))}</div>`;

  const extraCss = `
    @page{size:A4 landscape}
    h2.turno{font-size:14px;color:#1E3A5F;margin:18px 0 6px;padding-bottom:5px;border-bottom:2px solid #1E3A5F}
    h2.turno .tcnt{font-size:11px;color:#6B7280;font-weight:600}
    .insp{margin:12px 0 4px;font-size:12px;color:#111;border-left:4px solid #1E3A5F;padding-left:8px}
    .insp .cnt{background:#EEF2F7;color:#1E3A5F;border-radius:10px;padding:1px 8px;font-size:10.5px;font-weight:700;margin-left:6px}
    .insp .estres{margin-top:3px;font-size:10px;font-weight:700}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:9.5px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:3px 5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
    table.ir th{background:#1E3A5F;color:#fff;font-size:9px}
    table.ir td.r,table.ir th.r{text-align:right;white-space:nowrap}
    table.ir td.b{font-weight:800;color:#067647}
    table.ir td.nd{color:#9CA3AF}
    table.ir tfoot td{background:#F1F5F9;font-weight:800;border-top:2px solid #1E3A5F}
    .none{color:#6B7280;font-size:12px}
    .kpis{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 4px}
    .kpi{flex:1;min-width:90px;border:1px solid #E5E7EB;border-radius:10px;padding:7px 10px;background:#F8FAFC}
    .kpi .k{font-size:8.5px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px}
    .kpi .v{font-size:18px;font-weight:800;color:#1E3A5F;margin-top:2px}
    .kpi.warn{background:#FEF3F2;border-color:#FECDCA} .kpi.warn .v{color:#B42318}
    .kpi.ok{background:#ECFDF3;border-color:#ABEFC6} .kpi.ok .v{color:#067647}
    .nota-gen{font-size:8.5px;color:#6B7280;margin:2px 0 10px;text-transform:none}
  `;

  const turnoTxt = turnoPedido === 'day' ? 'turno día ☀️' : turnoPedido === 'night' ? 'turno noche 🌙' : 'ambos turnos ☀️ 🌙';
  const html = pdfDocument({
    title: 'REPORTE POR INSPECTOR',
    subtitle: `${fecha} · ${turnoTxt} · ${inspectoresIncluidos} inspector(es) · ${general.asignadas} máquina(s) · 🕒 ${h2(general.horas)} h`,
    body: inspectoresIncluidos ? (kpis + secciones) : `<p class="none">Sin máquinas asignadas para el ${fecha}${turnoPedido === 'both' ? '' : ` (${turnoTxt})`}.</p>`,
    extraCss,
  });
  const turnoArchivo = turnoPedido === 'day' ? ' dia' : turnoPedido === 'night' ? ' noche' : '';
  return await exportPdf(html, `Reporte por inspector ${fecha}${turnoArchivo}${sufijoArchivoInspector(op)}`);
}
