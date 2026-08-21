import { LOGO_DATA_URI } from './logoData';
import { COMPANY_NAME } from './company';

// Ayudantes de fecha y escape. Son GEMELOS de los de `constancia.ts` (allá son
// privados). Se copian a propósito en vez de exportarlos desde allá: la
// constancia de trabajo es un documento legal que ya está en producción y no se
// toca para acomodar a uno nuevo. Misma razón por la que `esc` está repetido en
// carnet.ts, constancia.ts y ficha.ts.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Fecha de hoy en texto largo: "15 de julio de 2026". */
function hoyLargo(): string {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** Fecha ISO (AAAA-MM-DD) a texto largo "15 de julio de 2026"; '' si no hay fecha. */
function fechaLarga(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return '';
  return `${d} de ${MESES[m - 1] ?? ''} de ${y}`;
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

/** Grado de la amonestación. El orden importa: es la escala de reincidencia. */
export type GradoAmonestacion = 'primera' | 'segunda' | 'tercera';

export const GRADO_LABEL: Record<GradoAmonestacion, string> = {
  primera: 'Primera amonestación',
  segunda: 'Segunda amonestación',
  tercera: 'Tercera amonestación',
};

export type AmonestacionData = {
  fullName: string;
  cedula?: string | null;
  cargo?: string | null;
  department?: string | null;
  fichaNumber?: string | null;
  hireDate?: string | null;    // fecha de ingreso ISO "AAAA-MM-DD"
  city?: string | null;
  state?: string | null;

  /** Tipo de falta ("Inasistencia injustificada"). Sale en el párrafo principal. */
  tipoFalta?: string | null;
  /** Fecha del HECHO en ISO. NO es la fecha de emisión: un hecho del lunes se
   *  puede amonestar el miércoles, y el documento debe decir cuál es cuál. */
  fechaHecho?: string | null;
  /** Hora del hecho, texto libre ("7:30 a. m."). Opcional. */
  horaHecho?: string | null;
  /** Relato de lo ocurrido. Si viene vacío, el documento imprime RENGLONES EN
   *  BLANCO para llenarlo a mano — así sirve también como planilla. */
  descripcion?: string | null;

  /** Grado. null = no mencionarlo (por si no se quiere llevar la escala). */
  grado?: GradoAmonestacion | null;
  /** Cuántas amonestaciones previas tiene. Solo se menciona si es mayor que 0. */
  previas?: number | null;

  /** Fundamento legal AL PIE, texto libre. Vacío por defecto y a propósito: los
   *  artículos los pone la empresa, NO se inventan acá. */
  baseLegal?: string | null;

  /** Quién emite. Si no viene, la raya queda en blanco para firmar a mano. */
  emiteNombre?: string | null;
  emiteCargo?: string | null;
  /** Testigo — el que da fe si el trabajador se niega a firmar. */
  testigoNombre?: string | null;
  testigoCedula?: string | null;
};

/**
 * AMONESTACIÓN ESCRITA (llamado de atención) lista para imprimir. Sigue el mismo
 * formato de la constancia de trabajo: carta, márgenes de 2 cm, membrete con el
 * logo y pie con el sello de impresión.
 *
 * TRES DECISIONES QUE NO SON CAPRICHO:
 *
 * 1. NO lleva firma escaneada, aunque el sistema tenga dos guardadas
 *    (`firmaData.ts`). Un llamado de atención que sale ya firmado se puede
 *    emitir sin que el jefe se entere, y pierde fuerza justo cuando más hace
 *    falta. Las tres rayas van en blanco.
 *
 * 2. SIEMPRE imprime el recuadro de DESCARGOS del trabajador, aunque nadie lo
 *    llene. Una sanción sin espacio para que la persona responda es más fácil de
 *    tumbar: el derecho a ser oído es parte del debido proceso.
 *
 * 3. Lleva la casilla "SE NEGÓ A FIRMAR" junto a la raya del trabajador. Es el
 *    caso que más problemas da en la práctica, y así queda asentado en el mismo
 *    papel, con el testigo al lado.
 *
 * Todo lo opcional que no se pase NO deja hueco ni guion: el párrafo entero
 * desaparece. Mismo truco del sueldo en `constanciaTrabajoHtml`.
 */
export function amonestacionHtml(d: AmonestacionData): string {
  const linea = '________________________';
  const nombre = esc(d.fullName || linea);
  const ci = esc(d.cedula || linea);
  const cargo = esc(d.cargo || linea);
  // Mismo criterio que la constancia: el cuerpo dice el nombre corto de la
  // empresa y el membrete el largo. Se replica tal cual para que los dos
  // documentos se vean hermanos.
  const empresa = 'SOS LA GUAIRA';
  const lugar = esc([d.city, d.state].filter(Boolean).join(', ') || 'La Guaira, Venezuela');
  const fecha = esc(hoyLargo());
  const impreso = esc(selloImpresion());

  // Grado y reincidencia van JUNTOS en el subtítulo, no en un párrafo aparte.
  // Además de ahorrar una hoja, es donde de verdad se leen: lo primero que mira
  // quien recibe el papel es si esta es la primera vez o ya van tres.
  // Reincidencia: solo si hay previas de verdad; un "0" no se menciona.
  const previas = Number(d.previas ?? 0);
  const subtitulo = [
    d.grado ? GRADO_LABEL[d.grado] : '',
    previas > 0 ? `${previas} amonestación(es) previa(s) en el expediente` : '',
  ].filter(Boolean).join(' · ');
  const bloqueGrado = subtitulo ? `\n    <div class="grado">${esc(subtitulo)}</div>` : '';

  // Filas de identificación que solo salen si hay dato. Las cuatro primeras van
  // siempre (con raya si faltan) porque son las que identifican a la persona.
  const filaOpc = (et: string, v?: string | null) =>
    String(v ?? '').trim() ? `<tr><th>${esc(et)}</th><td>${esc(String(v).trim())}</td></tr>` : '';

  // Cuándo ocurrió. Si no hay fecha del hecho no se inventa: se deja la raya.
  const cuando = fechaLarga(d.fechaHecho) || linea;
  const hora = String(d.horaHecho ?? '').trim();
  const cuandoTexto = hora ? `${cuando}, aproximadamente a las ${hora}` : cuando;

  const falta = String(d.tipoFalta ?? '').trim();
  const porLaFalta = falta
    ? `por <span class="fill">${esc(falta)}</span>, hecho ocurrido el <span class="fill">${esc(cuandoTexto)}</span>`
    : `por el hecho ocurrido el <span class="fill">${esc(cuandoTexto)}</span>`;

  // Relato. Vacío = renglones en blanco para escribir a mano.
  const relato = String(d.descripcion ?? '').trim();
  const cuerpoRelato = relato
    ? `<div class="texto">${esc(relato).replace(/\n/g, '<br/>')}</div>`
    : `<div class="renglones"><span></span><span></span><span></span></div>`;

  const legal = String(d.baseLegal ?? '').trim();
  const parrafoLegal = legal
    ? `\n    <p class="legal"><b>Fundamento:</b> ${esc(legal)}</p>`
    : '';

  const emiteNombre = esc(String(d.emiteNombre ?? '').trim());
  const emiteCargo = esc(String(d.emiteCargo ?? '').trim() || 'Supervisor / Recursos Humanos');
  const testigoNombre = esc(String(d.testigoNombre ?? '').trim());
  const testigoCedula = esc(String(d.testigoCedula ?? '').trim());
  const testigoPie = testigoCedula ? `C.I. ${testigoCedula}` : 'C.I.';

  return `<!doctype html><html><head><meta charset="utf-8"/><title></title>
  <style>
    @page{ margin:2cm; size:letter }
    *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact }
    html,body{ margin:0; padding:0 }
    /* ⚠️ ESTE DOCUMENTO TIENE QUE CABER EN UNA SOLA HOJA. Se firma en el sitio,
       por triplicado y muchas veces de pie: una segunda hoja con solo las firmas
       se pierde o no se firma. Todo lo de aquí abajo está apretado a propósito
       (tipografía 10pt, márgenes cortos, recuadros justos) y se midió imprimiendo
       de verdad. Si agregas algo, vuelve a medir el PDF antes de subirlo — una
       amonestación normal cabe con holgura; solo un relato muy largo debe pasar
       a una segunda hoja, y eso sí es correcto. */
    body{ font-family:Tahoma, Geneva, Verdana, sans-serif; color:#1a1a1a; font-size:10pt; line-height:1.4; display:flex; flex-direction:column; min-height:100vh }
    @media screen{ body{ padding:20px 30px; background:#fff } }
    .head{ text-align:center; border-bottom:2.5px solid #1E3A5F; padding-bottom:5px; margin-bottom:10px }
    .head img{ height:46px; width:auto }
    .head .co{ color:#1E3A5F; font-weight:700; font-size:10.5pt; letter-spacing:.2px; margin-top:2px }
    h1{ font-size:13.5pt; text-align:center; color:#1E3A5F; margin:4px 0 2px; text-transform:uppercase; letter-spacing:1px }
    .grado{ text-align:center; font-weight:700; color:#B45309; font-size:10pt; text-transform:uppercase; letter-spacing:.5px; margin:2px 0 0 }
    p{ text-align:justify; margin:8px 0 }
    .fill{ font-weight:700 }
    /* Recuadro de identificación del trabajador. */
    table.datos{ width:100%; border-collapse:collapse; margin:10px 0 2px; font-size:9.5pt }
    table.datos th, table.datos td{ border:1px solid #d7dee8; padding:3px 7px; text-align:left; vertical-align:top }
    table.datos th{ background:#f1f5f9; color:#1E3A5F; width:31%; font-weight:700 }
    /* Recuadros de contenido (hechos y descargos). */
    .bloque{ margin:9px 0 }
    .bt{ background:#1E3A5F; color:#fff; font-weight:700; font-size:9pt; text-transform:uppercase; letter-spacing:.4px; padding:3px 7px }
    .bc{ border:1px solid #d7dee8; border-top:0; padding:6px }
    /* El recuadro de descargos SE ESTIRA hasta donde empiezan las firmas. Sin
       esto quedaba un hueco muerto de media hoja y dos rayitas para escribir:
       el trabajador no tenía dónde poner su versión de los hechos. */
    .crece{ flex:1; display:flex; flex-direction:column; min-height:70px }
    .crece .bc{ flex:1 }
    .texto{ text-align:justify; white-space:normal }
    .renglones span{ display:block; border-bottom:1px solid #c9d3e0; height:17px }
    .renglones span:last-child{ border-bottom:0 }
    .legal{ font-size:9pt; color:#444 }
    .cierre{ margin-top:8px }
    /* Tres firmas al pie: trabajador, quien emite y testigo. */
    .sign-block{ margin-top:auto; padding-top:20px }
    table.firmas{ width:100%; border-collapse:collapse }
    table.firmas td{ width:33.33%; text-align:center; vertical-align:top; padding:0 6px }
    table.firmas .line{ border-top:1px solid #1a1a1a; padding-top:5px }
    table.firmas .rol{ font-weight:700; color:#1E3A5F; font-size:9.5pt; text-transform:uppercase; letter-spacing:.3px }
    table.firmas .nom{ color:#333; font-size:9.5pt; margin-top:1px }
    table.firmas .ci{ color:#777; font-size:8.5pt; margin-top:1px }
    .nego{ margin-top:5px; font-size:8.5pt; color:#444 }
    .nego .box{ display:inline-block; width:9px; height:9px; border:1px solid #1a1a1a; margin-right:4px; vertical-align:-1px }
    .foot{ margin-top:10px; text-align:center; color:#9aa4b2; font-size:8pt; border-top:1px solid #e5e7eb; padding-top:5px }
  </style></head><body>
    <div class="head">
      <img src="${LOGO_DATA_URI}"/>
      <div class="co">${esc(COMPANY_NAME)}</div>
    </div>

    <h1>Amonestación Escrita</h1>${bloqueGrado}

    <table class="datos">
      <tr><th>Trabajador(a)</th><td>${nombre}</td></tr>
      <tr><th>Cédula de identidad</th><td>${ci}</td></tr>
      <tr><th>Cargo</th><td>${cargo}</td></tr>
      ${filaOpc('Departamento', d.department)}
      ${filaOpc('N.° de ficha', d.fichaNumber)}
      ${filaOpc('Fecha de ingreso', fechaLarga(d.hireDate))}
    </table>

    <p>Por medio de la presente, <span class="fill">${esc(empresa)}</span> le hace un <b>llamado de atención formal</b> ${porLaFalta}, conducta que se aparta de las obligaciones inherentes a su cargo y de las normas internas de la empresa.</p>

    <div class="bloque">
      <div class="bt">Descripción de los hechos</div>
      <div class="bc">${cuerpoRelato}</div>
    </div>

    <p>Se le exhorta a corregir de inmediato la conducta señalada. La <b>reincidencia</b> dará lugar a las medidas disciplinarias que correspondan, conforme a la normativa laboral vigente y al reglamento interno.</p>${parrafoLegal}

    <div class="bloque crece">
      <div class="bt">Descargos del trabajador(a)</div>
      <div class="bc"><div class="renglones"><span></span><span></span></div></div>
    </div>

    <p class="cierre">Se expide en ${lugar}, a la fecha ${fecha}, en dos (2) ejemplares: uno para el expediente y otro que se entrega al trabajador(a) en este acto.</p>

    <div class="sign-block">
      <table class="firmas"><tr>
        <td>
          <div class="line">
            <div class="rol">Trabajador(a)</div>
            <div class="nom">${nombre}</div>
            <div class="ci">C.I. ${ci}</div>
          </div>
          <div class="nego"><span class="box"></span>Se negó a firmar</div>
        </td>
        <td>
          <div class="line">
            <div class="rol">${emiteCargo}</div>
            <div class="nom">${emiteNombre || '&nbsp;'}</div>
            <div class="ci">${esc(COMPANY_NAME)}</div>
          </div>
        </td>
        <td>
          <div class="line">
            <div class="rol">Testigo</div>
            <div class="nom">${testigoNombre || '&nbsp;'}</div>
            <div class="ci">${testigoPie}</div>
          </div>
        </td>
      </tr></table>
    </div>

    <div class="foot">${esc(COMPANY_NAME)} · Amonestación escrita &nbsp;·&nbsp; Impreso el ${impreso}</div>
  </body></html>`;
}
