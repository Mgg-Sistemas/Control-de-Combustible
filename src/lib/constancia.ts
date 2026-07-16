import { LOGO_DATA_URI } from './logoData';
import { COMPANY_NAME } from './company';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Fecha de hoy en texto largo: "15 de julio de 2026". */
function hoyLargo(): string {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** Sello de impresión: "15/07/2026, 03:42 p. m." (fecha y hora en que se imprime). */
function selloImpresion(): string {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const fecha = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  let h = d.getHours();
  const ampm = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12 || 12;
  return `${fecha}, ${p2(h)}:${p2(d.getMinutes())} ${ampm}`;
}

export type ConstanciaData = {
  fullName: string;
  cedula?: string | null;
  companyName?: string | null;
  city?: string | null;
  state?: string | null;
};

/**
 * Constancia de ENTREGA DE CARNET y declaración de condiciones de trabajo a
 * destajo, lista para imprimir. Autocompleta el nombre, la C.I y la empresa del
 * trabajador; lleva el logo. Sirve como control de entrega de ficha (se firma).
 */
export function constanciaCarnetHtml(d: ConstanciaData): string {
  const nombre = esc(d.fullName || '____________________');
  const ci = esc(d.cedula || '____________________');
  const empresa = esc(d.companyName || COMPANY_NAME);
  const lugar = esc([d.city, d.state].filter(Boolean).join(', ') || 'La Guaira, Venezuela');
  const fecha = esc(hoyLargo());
  const impreso = esc(selloImpresion());

  return `<!doctype html><html><head><meta charset="utf-8"/><title></title>
  <style>
    @page{ margin:1.4cm; size:letter }
    *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact }
    html,body{ margin:0; padding:0 }
    body{ font-family:Tahoma, Geneva, Verdana, sans-serif; color:#1a1a1a; font-size:10.5pt; line-height:1.32 }
    @media screen{ body{ padding:20px 30px; background:#fff } }
    .head{ text-align:center; border-bottom:2.5px solid #1E3A5F; padding-bottom:7px; margin-bottom:11px }
    .head img{ height:58px; width:auto }
    .head .co{ color:#1E3A5F; font-weight:700; font-size:10.5pt; letter-spacing:.2px; margin-top:3px }
    h1{ font-size:12.5pt; text-align:center; color:#1E3A5F; margin:4px 0 1px; text-transform:uppercase; letter-spacing:.2px }
    .sub{ text-align:center; color:#555; font-size:9pt; font-style:italic; margin-bottom:9px }
    .meta{ margin:0 0 9px }
    .meta b{ color:#1E3A5F }
    p{ text-align:justify; margin:6px 0 }
    .fill{ font-weight:700; border-bottom:1px solid #1a1a1a; padding:0 4px }
    h2{ font-size:10.5pt; color:#1E3A5F; margin:11px 0 4px; border-bottom:1px solid #d7e3f4; padding-bottom:2px }
    ol{ margin:4px 0; padding-left:18px }
    ol li{ margin:5px 0; text-align:justify }
    .firma{ margin-top:34px; text-align:center }
    .firma .line{ width:260px; margin:0 auto; border-top:1px solid #1a1a1a; padding-top:5px; font-size:9.5pt }
    .datos{ margin-top:11px; font-size:10pt }
    .datos div{ margin:3px 0 }
    .foot{ margin-top:18px; text-align:center; color:#9aa4b2; font-size:8pt; border-top:1px solid #e5e7eb; padding-top:6px }
  </style></head><body>
    <div class="head">
      <img src="${LOGO_DATA_URI}"/>
      <div class="co">${esc(COMPANY_NAME)}</div>
    </div>

    <h1>Constancia de entrega de carnet y declaración de condiciones de trabajo a destajo</h1>
    <div class="sub">Modalidad de pago a destajo (por unidad de obra o tarea realizada)</div>

    <div class="meta"><b>Fecha:</b> ${fecha} &nbsp;&nbsp;·&nbsp;&nbsp; <b>Lugar:</b> ${lugar}</div>

    <p>Por medio de la presente, yo, <span class="fill">${nombre}</span>, titular de la cédula de identidad / documento de identidad Nro. <span class="fill">${ci}</span>, declaro haber recibido conforme el carnet de identificación correspondiente a la empresa <span class="fill">${empresa}</span>.</p>

    <p>Declaro además tener pleno conocimiento y ser plenamente consciente de que la labor que prestaré se realiza bajo la modalidad de <b>TRABAJO A DESTAJO</b>, es decir, que la remuneración se calcula y se paga por cada unidad de obra, tarea o servicio efectivamente realizado y entregado, y no por tiempo, jornada fija ni salario mensual.</p>

    <p>Asimismo, mediante la firma de este documento, declaro conocer, aceptar y estar de acuerdo con las condiciones bajo las cuales prestaré mis servicios:</p>

    <h2>Declaraciones y condiciones del servicio</h2>
    <ol>
      <li><b>Modalidad de pago a destajo:</b> Ambas partes acuerdan que la remuneración se regirá bajo la modalidad de pago a destajo, calculada por unidad de obra, tarea o servicio efectivamente realizado y entregado. El pago corresponde exclusivamente al trabajo concluido y aceptado.</li>
      <li><b>Cálculo de la remuneración:</b> El monto a pagar por cada unidad de obra, tarea o servicio será el previamente acordado entre las partes. Manifiesto ser consciente de que mis ingresos dependerán directamente de la cantidad de trabajo que realice y entregue conforme.</li>
      <li><b>Uso del carnet:</b> El carnet entregado es de uso personal e intransferible. Su único propósito es la identificación visual y el control de acceso a las instalaciones o áreas de trabajo para la ejecución de las tareas asignadas.</li>
    </ol>

    <p>Leído y firmado en señal de total conformidad por el colaborador:</p>

    <div class="firma">
      <div class="line">Firma del Colaborador</div>
    </div>
    <div class="datos">
      <div><b>Nombre:</b> ${nombre}</div>
      <div><b>C.I:</b> ${ci}</div>
    </div>

    <div class="foot">${esc(COMPANY_NAME)} · Constancia de entrega de ficha / carnet &nbsp;·&nbsp; Impreso el ${impreso}</div>
  </body></html>`;
}
