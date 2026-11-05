// ACTA DE COMPROMISO Y ENTREGA DE HERRAMIENTAS / IMPLEMENTOS DE TRABAJO (04-nov-2026)
//
// Hermana de `src/lib/amonestacion.ts`, diseñada para el proceso de ingreso/entrevista
// o asignación de implementos de un trabajador, y asociada a su expediente.
//
// Incluye:
// - Tabla de herramientas, equipos e implementos entregados (o renglones en blanco
//   si se imprime como planilla física para llenar a mano en campo).
// - Cláusulas obligatorias:
//   1. Uso adecuado y exclusivo para las labores asignadas.
//   2. Cuidado, custodia, mantenimiento y reporte oportuno de fallas/desgaste.
//   3. Aceptación de responsabilidad y obligación de devolución.
//   4. Autorización expresa de deducción salarial en caso de daño o extravío
//      atribuible al trabajador.
// - Soporte de firma digital del trabajador y de quien entrega (incrustada en el
//   documento si se firmó en pantalla) o raya en blanco para firma manuscrita,
//   más casilla de testigo.

import { LOGO_DATA_URI } from './logoData';
import { COMPANY_NAME } from './company';
import { CommitmentToolItem } from '../types/database';
import { leerNumero } from './numeros';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hoyLargo(): string {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export function fechaLargaActa(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return '';
  return `${d} de ${MESES[m - 1] ?? ''} de ${y}`;
}

function selloImpresion(): string {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const fecha = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  let h = d.getHours();
  const ampm = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12 || 12;
  return `${fecha}, ${p2(h)}:${p2(d.getMinutes())} ${ampm}`;
}

/** Herramientas e implementos sugeridos para agregar con un toque durante el ingreso. */
export const HERRAMIENTAS_SUGERIDAS: readonly { nombre: string; estado: string }[] = [
  { nombre: 'Casco de seguridad', estado: 'Nuevo / Operativo' },
  { nombre: 'Par de botas de seguridad', estado: 'Nuevo / Operativo' },
  { nombre: 'Chaleco reflectivo', estado: 'Nuevo / Operativo' },
  { nombre: 'Lentes de protección', estado: 'Nuevo / Operativo' },
  { nombre: 'Par de guantes de carnaza / seguridad', estado: 'Nuevo / Operativo' },
  { nombre: 'Protector auditivo', estado: 'Nuevo / Operativo' },
  { nombre: 'Impermeable / encauchado', estado: 'Operativo' },
  { nombre: 'Radio transmisor portátil con cargador', estado: 'Operativo' },
  { nombre: 'Juego de llaves combinadas', estado: 'Operativo' },
  { nombre: 'Juego de destornilladores', estado: 'Operativo' },
  { nombre: 'Alicate de presión / mecánico', estado: 'Operativo' },
  { nombre: 'Cinta métrica', estado: 'Operativo' },
  { nombre: 'Linterna de trabajo', estado: 'Operativo' },
  { nombre: 'Carnet de identificación corporativo', estado: 'Nuevo' },
];

export type ActaCompromisoData = {
  codigo?: string | null;
  fullName: string;
  cedula?: string | null;
  cargo?: string | null;
  department?: string | null;
  fichaNumber?: string | null;
  hireDate?: string | null;
  city?: string | null;
  state?: string | null;
  lugar?: string | null;
  fechaEntrega?: string | null; // ISO YYYY-MM-DD
  items?: readonly CommitmentToolItem[] | null;
  clausulasAdicionales?: string | null;
  observaciones?: string | null;
  entregadoPor?: string | null;
  entregadoCargo?: string | null;
  testigoNombre?: string | null;
  testigoCedula?: string | null;
  firmaTrabajadorDataUri?: string | null;
  firmaEntregaDataUri?: string | null;
  mostrarLogo?: boolean;
  companyName?: string | null;
  logoDataUri?: string | null;
};

/** Genera un código correlativo legible para el acta: `AC-HER-2026-001`. */
export function generarCodigoActaCompromiso(secuencia = 1, fechaIso?: string | null): string {
  const year = fechaIso && /^\d{4}/.test(fechaIso) ? fechaIso.slice(0, 4) : String(new Date().getFullYear());
  const num = Math.max(1, Math.floor(Number(secuencia) || 1));
  return `AC-HER-${year}-${String(num).padStart(3, '0')}`;
}

/** Limpia y normaliza la lista de herramientas antes de guardar o imprimir. */
export function limpiarItemsActa(items?: readonly Partial<CommitmentToolItem>[] | null): CommitmentToolItem[] {
  if (!Array.isArray(items)) return [];
  const out: CommitmentToolItem[] = [];
  for (const it of items) {
    const nombre = String(it?.nombre ?? '').replace(/\s+/g, ' ').trim();
    if (!nombre) continue;
    const cantRaw = leerNumero(it?.cantidad ?? 1);
    const cantidad = cantRaw > 0 ? cantRaw : 1;
    const serial = String(it?.serial ?? '').trim() || null;
    const estado = String(it?.estado ?? '').trim() || 'Operativo';
    const valRaw = it?.valor_usd != null && String(it.valor_usd).trim() !== '' ? leerNumero(it.valor_usd) : null;
    const valor_usd = valRaw != null && valRaw > 0 ? Math.round(valRaw * 100) / 100 : null;
    out.push({ nombre, cantidad, serial, estado, valor_usd });
  }
  return out;
}

/** Suma el valor total de reposición en USD de los implementos que tengan valor declarado. */
export function totalValorReposicionUsd(items?: readonly Partial<CommitmentToolItem>[] | null): number {
  const limpios = limpiarItemsActa(items);
  let total = 0;
  for (const it of limpios) {
    if (it.valor_usd && it.valor_usd > 0) {
      total += (Number(it.cantidad) || 1) * it.valor_usd;
    }
  }
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

/**
 * Genera el HTML imprimible / firmable del Acta de Compromiso y Entrega de Herramientas.
 * Cabe en una (1) hoja tamaño carta para uso normal.
 */
export function actaCompromisoHtml(d: ActaCompromisoData): string {
  const linea = '________________________';
  const nombre = esc(d.fullName || linea);
  const ci = esc(d.cedula || linea);
  const cargo = esc(d.cargo || linea);
  const empresa = String(d.companyName ?? '').trim() || 'SOS LA GUAIRA';
  const lugar = esc(String(d.lugar ?? '').trim() || [d.city, d.state].filter(Boolean).join(', ') || 'La Guaira, Venezuela');
  const fechaTexto = esc(fechaLargaActa(d.fechaEntrega) || hoyLargo());
  const impreso = esc(selloImpresion());
  const codigo = esc(String(d.codigo ?? '').trim() || generarCodigoActaCompromiso(1, d.fechaEntrega));
  const logoSrc = d.logoDataUri !== undefined ? d.logoDataUri : LOGO_DATA_URI;

  const filaOpc = (et: string, v?: string | null) =>
    String(v ?? '').trim() ? `<tr><th>${esc(et)}</th><td>${esc(String(v).trim())}</td></tr>` : '';

  const itemsLimpios = limpiarItemsActa(d.items);
  const hayValores = itemsLimpios.some((x) => x.valor_usd != null && x.valor_usd > 0);
  const totalRepo = totalValorReposicionUsd(itemsLimpios);

  let tablaHerramientasHtml = '';
  if (itemsLimpios.length > 0) {
    const filas = itemsLimpios
      .map((it, idx) => {
        const valCell = hayValores
          ? `<td class="r">${it.valor_usd ? `$${it.valor_usd.toFixed(2)}` : '—'}</td>`
          : '';
        return `<tr>
          <td class="c">${idx + 1}</td>
          <td><b>${esc(it.nombre)}</b></td>
          <td class="c">${esc(it.cantidad)}</td>
          <td>${esc(it.serial || '—')}</td>
          <td>${esc(it.estado || 'Operativo')}</td>
          ${valCell}
        </tr>`;
      })
      .join('');
    const pieTotal = hayValores
      ? `<tfoot><tr><td colspan="5" class="r"><b>VALOR TOTAL ESTIMADO DE REPOSICIÓN (USD)</b></td><td class="r"><b>$${totalRepo.toFixed(2)}</b></td></tr></tfoot>`
      : '';
    tablaHerramientasHtml = `
      <table class="tools">
        <thead>
          <tr>
            <th class="c" style="width:28px">#</th>
            <th>Herramienta / Implemento / Equipo</th>
            <th class="c" style="width:52px">Cant.</th>
            <th style="width:120px">Serial / Marca / Talla</th>
            <th style="width:110px">Estado de entrega</th>
            ${hayValores ? '<th class="r" style="width:82px">Valor Unit.</th>' : ''}
          </tr>
        </thead>
        <tbody>${filas}</tbody>
        ${pieTotal}
      </table>`;
  } else {
    // Planilla en blanco para llenar a mano en entrevista/campo
    const filasBlanco = [1, 2, 3, 4, 5]
      .map(
        (n) => `<tr>
          <td class="c">${n}</td>
          <td style="height:20px"></td>
          <td class="c"></td>
          <td></td>
          <td></td>
        </tr>`
      )
      .join('');
    tablaHerramientasHtml = `
      <table class="tools">
        <thead>
          <tr>
            <th class="c" style="width:28px">#</th>
            <th>Herramienta / Implemento / Equipo</th>
            <th class="c" style="width:52px">Cant.</th>
            <th style="width:130px">Serial / Marca / Talla</th>
            <th style="width:115px">Estado de entrega</th>
          </tr>
        </thead>
        <tbody>${filasBlanco}</tbody>
      </table>`;
  }

  const obs = String(d.observaciones ?? '').trim();
  const bloqueObs = obs
    ? `<div class="texto">${esc(obs).replace(/\n/g, '<br/>')}</div>`
    : `<div class="renglones"><span></span><span></span></div>`;

  const entregadoPor = esc(String(d.entregadoPor ?? '').trim());
  const entregadoCargo = esc(String(d.entregadoCargo ?? '').trim() || 'Almacén / Seguridad / RRHH');
  const testigoNombre = esc(String(d.testigoNombre ?? '').trim());
  const testigoCedula = esc(String(d.testigoCedula ?? '').trim());
  const testigoPie = testigoCedula ? `C.I. ${testigoCedula}` : 'C.I.';

  const firmaTrabImg = d.firmaTrabajadorDataUri
    ? `<div class="sig-img-wrap"><img src="${esc(d.firmaTrabajadorDataUri)}" class="sig-img" alt="Firma trabajador"/></div>`
    : `<div class="sig-space"></div>`;
  const firmaEntImg = d.firmaEntregaDataUri
    ? `<div class="sig-img-wrap"><img src="${esc(d.firmaEntregaDataUri)}" class="sig-img" alt="Firma entrega"/></div>`
    : `<div class="sig-space"></div>`;

  const mostrarLogo = d.mostrarLogo !== false;

  return `<!doctype html><html><head><meta charset="utf-8"/><title>Acta de Compromiso - ${nombre}</title>
  <style>
    @page{ margin:1.6cm 1.8cm; size:letter }
    *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact }
    html,body{ margin:0; padding:0 }
    body{ font-family:Tahoma, Geneva, Verdana, sans-serif; color:#1a1a1a; font-size:9.3pt; line-height:1.35; display:flex; flex-direction:column; min-height:100vh }
    @media screen{ body{ padding:18px 26px; background:#fff } }
    .head{ display:flex; align-items:center; justify-content:space-between; border-bottom:2.5px solid #1E3A5F; padding-bottom:6px; margin-bottom:8px }
    .head-left{ display:flex; align-items:center; gap:10px }
    .head img{ height:42px; width:auto }
    .head .co{ color:#1E3A5F; font-weight:800; font-size:10pt; letter-spacing:.2px }
    .head .cod{ background:#EEF2F7; border:1px solid #CBD5E1; border-radius:4px; padding:3px 8px; font-size:8.5pt; font-weight:800; color:#1E3A5F }
    h1{ font-size:12.5pt; text-align:center; color:#1E3A5F; margin:3px 0 1px; text-transform:uppercase; letter-spacing:.8px }
    .sub{ text-align:center; font-weight:700; color:#475569; font-size:8.8pt; text-transform:uppercase; letter-spacing:.4px; margin-bottom:6px }
    p{ text-align:justify; margin:5px 0 }
    .fill{ font-weight:700 }
    table.datos{ width:100%; border-collapse:collapse; margin:6px 0; font-size:9pt }
    table.datos th, table.datos td{ border:1px solid #CBD5E1; padding:3px 7px; text-align:left; vertical-align:middle }
    table.datos th{ background:#F1F5F9; color:#1E3A5F; width:28%; font-weight:700 }
    .bloque{ margin:6px 0 }
    .bt{ background:#1E3A5F; color:#fff; font-weight:700; font-size:8.8pt; text-transform:uppercase; letter-spacing:.4px; padding:3px 7px }
    .bc{ border:1px solid #CBD5E1; border-top:0; padding:6px }
    table.tools{ width:100%; border-collapse:collapse; font-size:8.8pt; margin:0 }
    table.tools th{ background:#1E3A5F; color:#fff; padding:4px 6px; text-align:left; font-weight:700; border:1px solid #1E3A5F }
    table.tools td{ border:1px solid #CBD5E1; padding:4px 6px; vertical-align:middle }
    table.tools tbody tr:nth-child(even) td{ background:#F8FAFC }
    table.tools tfoot td{ background:#EEF2F7; border:1px solid #1E3A5F; padding:4px 6px; color:#1E3A5F }
    .c{ text-align:center }
    .r{ text-align:right; font-variant-numeric:tabular-nums }
    .clausulas{ border:1px solid #CBD5E1; border-left:4px solid #1E3A5F; background:#F8FAFC; padding:6px 9px; margin:6px 0; font-size:8.6pt; line-height:1.34 }
    .clausulas ol{ margin:3px 0 0 16px; padding:0 }
    .clausulas li{ margin-bottom:3.5px; text-align:justify }
    .texto{ text-align:justify; white-space:normal }
    .renglones span{ display:block; border-bottom:1px solid #CBD5E1; height:16px }
    .renglones span:last-child{ border-bottom:0 }
    .cierre{ margin-top:5px; font-size:8.8pt }
    .sign-block{ margin-top:auto; padding-top:12px }
    table.firmas{ width:100%; border-collapse:collapse }
    table.firmas td{ width:33.33%; text-align:center; vertical-align:bottom; padding:0 6px }
    .sig-space{ height:42px }
    .sig-img-wrap{ height:42px; display:flex; align-items:flex-end; justify-content:center; padding-bottom:2px }
    .sig-img{ max-height:40px; max-width:150px; object-fit:contain }
    table.firmas .line{ border-top:1px solid #1a1a1a; padding-top:4px }
    table.firmas .rol{ font-weight:700; color:#1E3A5F; font-size:8.8pt; text-transform:uppercase; letter-spacing:.3px }
    table.firmas .nom{ color:#333; font-size:8.8pt; margin-top:1px }
    table.firmas .ci{ color:#777; font-size:8pt; margin-top:1px }
    .huella-box{ display:inline-block; width:46px; height:54px; border:1px dashed #64748B; border-radius:4px; margin-top:4px; font-size:7pt; color:#64748B; line-height:52px; text-align:center }
    .foot{ margin-top:8px; text-align:center; color:#9aa4b2; font-size:7.8pt; border-top:1px solid #e5e7eb; padding-top:4px }
  </style></head><body>
    <div class="head">
      <div class="head-left">
        ${mostrarLogo && logoSrc ? `<img src="${logoSrc}"/>` : ''}
        <div class="co">${esc(empresa)}</div>
      </div>
      <div class="cod">ACTA N.° ${codigo}</div>
    </div>

    <h1>Acta de Compromiso y Entrega de Herramientas</h1>
    <div class="sub">Asignación de Equipos, Implementos de Trabajo y Protección Personal</div>

    <table class="datos">
      <tr><th>Trabajador(a)</th><td><b>${nombre}</b></td></tr>
      <tr><th>Cédula de identidad</th><td>${ci}</td></tr>
      <tr><th>Cargo</th><td>${cargo}</td></tr>
      ${filaOpc('Departamento', d.department)}
      ${filaOpc('N.° de ficha', d.fichaNumber)}
      ${filaOpc('Fecha de ingreso', fechaLargaActa(d.hireDate))}
      <tr><th>Fecha de entrega</th><td>${fechaTexto}</td></tr>
    </table>

    <p>Por medio de la presente se deja constancia de que <span class="fill">${esc(empresa)}</span> hace entrega formal al trabajador(a) arriba identificado(a) de los implementos, equipos y/o herramientas de trabajo descritos a continuación, en buenas condiciones operativas:</p>

    <div class="bloque">
      <div class="bt">Detalle de herramientas e implementos entregados</div>
      ${tablaHerramientasHtml}
    </div>

    <div class="clausulas">
      <b>CLÁUSULAS DE COMPROMISO, CUSTODIA Y RESPONSABILIDAD:</b>
      <ol>
        <li><b>Uso adecuado y exclusivo:</b> El trabajador(a) se compromete a utilizar las herramientas, equipos e implementos recibidos única y exclusivamente para el desempeño de las funciones inherentes a su cargo dentro de <span class="fill">${esc(empresa)}</span>, cumpliendo las normas operativas y de seguridad industrial.</li>
        <li><b>Cuidado, guarda y mantenimiento:</b> El trabajador(a) asume la custodia directa de los implementos entregados, obligándose a velar por su buen estado de conservación y a reportar de inmediato a su supervisor o al área de Almacén cualquier falla técnica o deterioro por uso normal.</li>
        <li><b>Aceptación de responsabilidad y devolución:</b> Los equipos e implementos detallados son propiedad exclusiva de la empresa. El trabajador(a) se obliga a presentarlos para auditoría cuando le sea requerido y a devolverlos íntegramente al cambiar de funciones o al finalizar la relación laboral.</li>
        <li><b>Autorización de deducción salarial por daño o extravío:</b> En caso de pérdida, extravío, hurto por descuido o daño atribuible a negligencia, mal uso o dolo del trabajador(a), éste(a) asume la responsabilidad de su reposición y <b>autoriza expresamente a la empresa a efectuar el descuento o deducción salarial</b> correspondiente al costo de reposición sobre sus pagos de nómina, bonificaciones y/o liquidación final, conforme a la normativa laboral vigente.</li>
      </ol>
    </div>

    <div class="bloque">
      <div class="bt">Observaciones adicionales / Estado de recepción</div>
      <div class="bc">${bloqueObs}</div>
    </div>

    <p class="cierre">Leído el presente documento y conforme con todas sus cláusulas, se suscribe en ${lugar}, a la fecha ${fechaTexto}, en dos (2) ejemplares de un mismo tenor y a un solo efecto: uno para el expediente laboral y otro para el trabajador(a).</p>

    <div class="sign-block">
      <table class="firmas"><tr>
        <td>
          ${firmaTrabImg}
          <div class="line">
            <div class="rol">Recibí conforme — Trabajador(a)</div>
            <div class="nom">${nombre}</div>
            <div class="ci">C.I. ${ci} · Firma y huella</div>
          </div>
        </td>
        <td>
          ${firmaEntImg}
          <div class="line">
            <div class="rol">Entregado por</div>
            <div class="nom">${entregadoPor || '&nbsp;'}</div>
            <div class="ci">${entregadoCargo}</div>
          </div>
        </td>
        <td>
          <div class="sig-space"></div>
          <div class="line">
            <div class="rol">Testigo / RRHH</div>
            <div class="nom">${testigoNombre || '&nbsp;'}</div>
            <div class="ci">${testigoPie}</div>
          </div>
        </td>
      </tr></table>
    </div>

    <div class="foot">${esc(COMPANY_NAME)} · Expediente Laboral · Impreso el ${impreso}</div>
  </body></html>`;
}

