import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';

/**
 * Reporte (PDF) de MÁQUINAS POR ASIGNAR / POR INICIAR para un día y turno.
 *
 * Se alimenta de los datos que YA tiene en memoria el dashboard "RESUMEN DE
 * INSPECCIONES" (InspectionsSummary): las máquinas PENDIENTES por iniciar del
 * día+turno (`topIds.pend`), su ficha (`machineInfo`) y el inspector asignado
 * (`inspectorByMachine`). NO hace consultas nuevas.
 *
 * Dos secciones (ambas A→Z por código, misma cabecera/estilo que los otros
 * reportes vía `pdfDocument`/`exportPdf`):
 *  1) ⏳ PENDIENTES POR INICIAR: máquinas asignadas a un inspector REAL que aún
 *     no inician jornada. Columnas: Máquina, Placa, Empresa, Inspector asignado.
 *  2) ⚠️ SIN INSPECTOR (POR ASIGNAR): máquinas sin inspector real (cajón
 *     "…FALTANTES" o vacío). Columnas: Máquina, Placa, Empresa.
 * Cada sección muestra su total; "—" cuando falte un dato.
 */

export type PorAsignarMachine = {
  code: string;
  plate: string | null;
  company: string | null;
  inspector: string | null; // nombre del inspector asignado (o cajón faltantes/vacío)
  sinInspector: boolean;     // true = sin inspector real → sección "por asignar"
  tipo?: string | null;      // MODELO/marca de la máquina (CAT 320, Komatsu PC200…)
};

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
const dash = (v: any) => { const s = String(v ?? '').trim(); return s || '—'; };

/**
 * Genera y exporta el PDF de máquinas por asignar / por iniciar.
 * @param date  día ISO "AAAA-MM-DD".
 * @param shift 'day' | 'night'.
 * @param machines máquinas PENDIENTES por iniciar (ya resueltas por la pantalla).
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generatePorAsignarReport(opts: { date: string; shift: 'day' | 'night'; machines: PorAsignarMachine[] }): Promise<boolean> {
  const { date, shift, machines } = opts;
  const fecha = dmy(date);
  const turnoTxt = shift === 'night' ? 'Turno noche 🌙' : 'Turno día ☀️';

  const porIniciar = machines.filter((m) => !m.sinInspector).slice().sort((a, b) => cmpText(a.code, b.code));
  const porAsignar = machines.filter((m) => m.sinInspector).slice().sort((a, b) => cmpText(a.code, b.code));

  const tablePend = (list: PorAsignarMachine[]): string => {
    const rows = list.map((m, i) =>
      `<tr><td>${i + 1}</td><td><b>${esc(m.code)}</b></td><td>${esc(dash(m.tipo))}</td><td>${esc(dash(m.plate))}</td><td>${esc(dash(m.company))}</td><td>${esc(dash(m.inspector))}</td></tr>`).join('');
    return `<table class="ir"><thead><tr><th style="width:26px">Nº</th><th>Máquina</th><th>Marca/Modelo</th><th>Placa</th><th>Empresa</th><th>Inspector asignado</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="6">Total · ${list.length} equipo(s)</td></tr></tfoot></table>`;
  };

  const tableSin = (list: PorAsignarMachine[]): string => {
    const rows = list.map((m, i) =>
      `<tr><td>${i + 1}</td><td><b>${esc(m.code)}</b></td><td>${esc(dash(m.tipo))}</td><td>${esc(dash(m.plate))}</td><td>${esc(dash(m.company))}</td></tr>`).join('');
    return `<table class="ir"><thead><tr><th style="width:26px">Nº</th><th>Máquina</th><th>Marca/Modelo</th><th>Placa</th><th>Empresa</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5">Total · ${list.length} equipo(s)</td></tr></tfoot></table>`;
  };

  const section = (icon: string, title: string, count: number, table: string): string =>
    `<h2 class="turno">${icon} ${title} <span class="tcnt">${count} equipo(s)</span></h2>${count ? table : '<p class="none">Sin registros para este día y turno.</p>'}`;

  const body = [
    section('⏳', 'Pendientes por iniciar', porIniciar.length, tablePend(porIniciar)),
    section('⚠️', 'Sin inspector (por asignar)', porAsignar.length, tableSin(porAsignar)),
  ].join('');

  const extraCss = `
    h2.turno{font-size:15px;color:#1E3A5F;margin:20px 0 6px;padding-bottom:6px;border-bottom:2px solid #1E3A5F}
    h2.turno .tcnt{font-size:11px;color:#6B7280;font-weight:600}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 10px;font-size:11.5px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
    table.ir tfoot td{background:#EEF2F7;font-weight:800}
    .none{color:#6B7280;font-size:12px}
  `;

  const subtitle = `Máquinas por asignar / por iniciar · ${fecha} · ${turnoTxt} · ⏳ ${porIniciar.length} pendientes · ⚠️ ${porAsignar.length} por asignar`;

  const html = pdfDocument({
    title: 'MÁQUINAS POR ASIGNAR / POR INICIAR',
    subtitle,
    body,
    extraCss,
  });
  return await exportPdf(html, `Reporte - Por asignar ${fecha} ${shift === 'night' ? 'noche' : 'dia'}`);
}
