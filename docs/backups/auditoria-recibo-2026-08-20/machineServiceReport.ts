// ============================================================================
// REPORTE DE SERVICIOS DE MAQUINARIA (PDF).
//
// Reproduce el documento que trajo el cliente («Ficha técnica Jumbo con martillo
// 0488», Golden Touch 1127 C.A.): la ficha técnica de la máquina en la primera
// página, y sus reparaciones a partir de la segunda, con las dos firmas al pie.
//
// Función PURA: recibe los datos ya cargados por la pantalla, no consulta
// Supabase. Mismo contrato que `hoseServiceReport.ts`.
//
// EL MODO LO DECIDE EL REPORTE, no un botón: si el filtro dejó UNA sola máquina
// imprime su ficha; si dejó varias, agrupa sin ficha — cuarenta fichas seguidas
// no le sirven a nadie.
//
// ⚠️ SIN DINERO: acá no se imprime ningún costo. El módulo no los lleva.
//
// Blindado por `scripts/test-servicio.mjs` (`npm run test:servicio`).
// ============================================================================
import { pdfDocument, exportPdf } from './pdf';
import { machineLabel, machineFileLabel, MaquinaIdentificable } from './machineLabel';
import { quienLoHizo, INTERVENCION_LABEL, Intervencion, ServiceOrigen } from './machineService';

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dmy = (iso?: string | null) => {
  const [y, m, d] = String(iso ?? '').split('T')[0].split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};
const oDash = (v: any) => (v == null || v === '' ? '—' : String(v));

/** Lo que hace falta de la máquina para imprimir su ficha técnica. */
export type MaquinaFicha = MaquinaIdentificable & {
  tipo?: string | null; marca?: string | null; modelo?: string | null;
  photo_url?: string | null; companyName?: string | null; encargado?: string | null;
  oil_type?: string | null; oil_capacity_l?: number | null; oil_notes?: string | null;
  last_horometro?: number | null; horometro_base?: number | null;
};

/** Un trabajo, listo para imprimir. Sirve tanto a las órdenes nuevas como a los
 *  expedientes viejos de `machinery_repairs`, que traen menos datos. */
export type ServicioImprimible = {
  id: string;
  service_date: string;
  origen: ServiceOrigen;
  technician?: string | null;
  provider?: string | null;
  intervenciones?: string[] | null;
  problem?: string | null;
  work_done?: string | null;
  parts?: { quantity: number | null; description: string; estado: string | null }[];
  /** Texto de la avería que atiende, si la hay. */
  averia?: string | null;
  /** Expediente viejo de `machinery_repairs`: se marca como tal para que no
   *  parezca un formulario llenado a medias. */
  esRegistroAnterior?: boolean;
};

const CSS = `
  .sv-head{display:flex;gap:18px;align-items:center;margin:6px 0 4px}
  .sv-photo{width:150px;height:120px;object-fit:cover;border:3px solid #1E3A5F;border-radius:10px;background:#EEF2F7}
  .sv-name{font-size:22px;font-weight:800;color:#1E3A5F;line-height:1.1}
  .sv-sub{font-size:13px;color:#374151;font-weight:700;margin-top:3px}
  h3.sec{margin:16px 0 4px;font-size:13px;color:#1E3A5F;border-top:2px solid #1E3A5F;padding-top:8px}
  table.ft{width:100%;border-collapse:collapse;font-size:12px}
  table.ft td{border:1px solid #D7E3F4;padding:5px 9px;vertical-align:top}
  table.ft td.k{background:#EAF1FB;color:#374151;width:42%;font-weight:700}
  .corte{page-break-after:always}
  .srv{border:1px solid #D7E3F4;border-radius:8px;padding:10px 12px;margin-bottom:10px;page-break-inside:avoid}
  .srv .top{display:flex;justify-content:space-between;gap:10px;font-size:12px;font-weight:800;color:#1E3A5F}
  .srv .tags span{display:inline-block;background:#EAF1FB;border:1px solid #D7E3F4;border-radius:10px;padding:1px 8px;font-size:10px;margin-left:4px}
  .srv .kv{font-size:12px;margin-top:4px}
  .srv .kv b{color:#374151}
  .viejo{background:#FFFBEB;border-color:#FDE68A}
  table.rep{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}
  table.rep th{background:#1E3A5F;color:#fff;padding:4px 7px;text-align:left}
  table.rep td{border:1px solid #D7E3F4;padding:4px 7px}
  .grupo{font-size:15px;font-weight:800;color:#1E3A5F;margin:14px 0 6px;border-bottom:2px solid #1E3A5F;page-break-after:avoid}
  .firmas{display:flex;gap:60px;margin-top:56px;page-break-inside:avoid}
  .firmas div{flex:1;border-top:1px solid #333;padding-top:6px;text-align:center;font-size:11px;font-weight:700}
`;

/** Filas de una tabla clave/valor, saltando lo que viene vacío. */
function filas(pairs: [string, any][]): string {
  return pairs
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('');
}

/** Página 1: la ficha técnica de la máquina, como el documento del cliente. */
export function fichaTecnicaHtml(m: MaquinaFicha): string {
  const horas = m.last_horometro != null && m.horometro_base != null
    ? Math.max(0, Number(m.last_horometro) - Number(m.horometro_base))
    : null;
  const foto = m.photo_url ? `<img class="sv-photo" src="${esc(m.photo_url)}"/>` : '';
  const lubricacion = filas([
    ['Tipo de aceite recomendado (motor)', m.oil_type],
    ['Cantidad requerida (motor)', m.oil_capacity_l != null ? `${m.oil_capacity_l} L` : null],
    ['Nota', m.oil_notes],
  ]);
  const horometro = filas([
    ['Última lectura', m.last_horometro != null ? `${m.last_horometro} h` : null],
    ['Lectura del último mantenimiento', m.horometro_base != null ? `${m.horometro_base} h` : null],
    ['Horas acumuladas desde entonces', horas != null ? `${horas} h` : null],
  ]);
  const vacio = (k: string) => `<tr><td class="k">${k}</td><td>—</td></tr>`;
  return `<div class="corte">
    <h3 class="sec">FICHA TÉCNICA DE MAQUINARIA</h3>
    <div class="sv-head">${foto}
      <div><div class="sv-name">${esc(machineLabel(m))}</div>
        <div class="sv-sub">${esc(m.companyName ?? '')}</div></div>
    </div>
    <h3 class="sec">🚜 Información general</h3>
    <table class="ft"><tbody>${filas([
      ['Tipo de equipo', m.tipo], ['Marca', m.marca], ['Modelo', m.modelo],
      ['Número de serial', m.serial], ['Placa', m.plate], ['Identificador', m.identifier],
      ['Empresa', m.companyName], ['Encargado', m.encargado],
    ]) || vacio('Sin datos')}</tbody></table>
    <h3 class="sec">🛢️ Información de lubricación</h3>
    <table class="ft"><tbody>${lubricacion || vacio('Sin datos de lubricación')}</tbody></table>
    <h3 class="sec">⏱️ Horómetro</h3>
    <table class="ft"><tbody>${horometro || vacio('Sin lecturas')}</tbody></table>
  </div>`;
}

/** Una reparación, como la hoja «Reporte de mantenimiento / reparación». */
export function servicioCardHtml(s: ServicioImprimible): string {
  const tags = (s.intervenciones ?? [])
    .map((k) => `<span>${esc(INTERVENCION_LABEL[k as Intervencion] ?? k)}</span>`).join('');
  const reps = (s.parts ?? []).length
    ? `<table class="rep"><thead><tr><th>Cant.</th><th>Descripción del repuesto / insumo</th><th>Estado</th></tr></thead><tbody>${
        (s.parts ?? []).map((p) =>
          `<tr><td>${esc(oDash(p.quantity))}</td><td>${esc(p.description)}</td><td>${esc(oDash(p.estado))}</td></tr>`
        ).join('')}</tbody></table>`
    : '';
  return `<div class="srv${s.esRegistroAnterior ? ' viejo' : ''}">
    <div class="top"><span>${esc(dmy(s.service_date))} · ${esc(quienLoHizo(s))}</span>
      <span class="tags">${tags}${s.esRegistroAnterior ? '<span>Registro anterior</span>' : ''}</span></div>
    ${s.problem ? `<div class="kv"><b>Problema:</b> ${esc(s.problem)}</div>` : ''}
    ${s.work_done ? `<div class="kv"><b>Se hizo:</b> ${esc(s.work_done)}</div>` : ''}
    ${s.averia ? `<div class="kv"><b>Atiende:</b> ${esc(s.averia)}</div>` : ''}
    ${reps}
  </div>`;
}

/** Las dos líneas para firmar a mano, como en el formulario de papel. */
const FIRMAS = `<div class="firmas"><div>Firma del Técnico</div><div>Firma Supervisor</div></div>`;

export type ReportOpts = {
  maquinas: { m: MaquinaFicha; servicios: ServicioImprimible[] }[];
  desde?: string; hasta?: string;
};

/** El documento completo. PURA — devuelve el HTML, no imprime nada. */
export function buildMachineServiceReportHtml(opts: ReportOpts): string {
  const { maquinas, desde, hasta } = opts;
  const unaSola = maquinas.length === 1;   // ← acá se decide el modo
  const rango = desde && hasta ? `${dmy(desde)} — ${dmy(hasta)}` : '';

  const cuerpo = maquinas.map(({ m, servicios }) => {
    const lista = servicios.length
      ? servicios.map(servicioCardHtml).join('')
      : '<div class="srv">Sin servicios registrados en el período.</div>';
    return unaSola
      ? fichaTecnicaHtml(m) + `<h3 class="sec">🔧 Reparaciones${rango ? ` · ${esc(rango)}` : ''}</h3>` + lista
      : `<div class="grupo">${esc(machineLabel(m))}</div>` + lista;
  }).join('');

  const total = maquinas.reduce((a, x) => a + x.servicios.length, 0);
  return pdfDocument({
    title: unaSola ? 'Ficha técnica y reparaciones' : 'Reparaciones de maquinaria',
    subtitle: `${total} servicio(s)${rango ? ` · ${rango}` : ''}`,
    body: cuerpo + FIRMAS,
    extraCss: CSS,
  });
}

/** Genera y exporta el PDF. @returns true si el usuario confirmó (imprimió/guardó). */
export async function generateMachineServiceReport(opts: ReportOpts): Promise<boolean> {
  // El nombre del archivo lleva placa o serial: tres máquinas se llaman
  // RETROEXCAVADORA y sus PDF se pisaban entre sí.
  const nombre = opts.maquinas.length === 1
    ? `Servicios - ${machineFileLabel(opts.maquinas[0].m)}`
    : 'Reparaciones de maquinaria';
  return exportPdf(buildMachineServiceReportHtml(opts), nombre);
}
