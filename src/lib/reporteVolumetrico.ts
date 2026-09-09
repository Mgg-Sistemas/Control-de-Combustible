// REPORTE «ANÁLISIS TÉCNICO Y CAPACIDAD VOLUMÉTRICA DE FLOTA» (09-sep-2026).
//
// El cliente mandó dos PDF de muestra y pidió que el reporte del cubicaje
// saliera así. Este archivo arma ESE documento, pieza por pieza:
//
//   · Cabecera azul marino con el título y el subtítulo.
//   · Barra de «Fecha de Emisión | Configuración».
//   · Tres tarjetas grandes: mayor, menor y promedio.
//   · Tablas numeradas con cabecera azul y pastillas de clasificación de color.
//   · Análisis logístico y recomendaciones, deducidos de los propios números.
//   · Notas al pie en recuadro de color.
//
// Y una parte que las muestras no tenían y que también se pidió: los METROS
// CÚBICOS CARGADOS del histórico, buscables por día, por mes o por camión.
//
// Sin más import que la librería pura del cubicaje: así se puede probar entero
// (scripts/test-reporte-volumetrico.mjs) sin montar React ni tocar la base.
import {
  Segmento, SEGMENTOS, GrupoCarga, TotalCargas, EjeHistorico,
  pastillaClase, kpis, m3Texto, fechaCorta, mesLargo, redondear,
} from './cubicaje';

export type UnidadReporte = {
  ident: string;
  marca?: string | null;
  modelo?: string | null;
  alto: number;
  largo: number;
  ancho: number;
  m3: number;
  segmento: Segmento;
  /** Se pinta resaltada, como el Sinotruk en el PDF de muestra. */
  destacada?: boolean;
};

export type BloqueCargas = {
  eje: EjeHistorico;
  grupos: GrupoCarga[];
  total: TotalCargas;
  rango: string;
};

export type DatosVolumetrico = {
  fechaEmision: string;
  configuracion: string;
  unidades: UnidadReporte[];
  /** Dos tablas (volteos y volquetas) o una sola con toda la flota. */
  segmentado: boolean;
  /** Unidades dejadas fuera a propósito. Se nombran en la nota del pie: un
   *  reporte que excluye algo sin decirlo es un reporte que miente por omisión. */
  excluidas: string[];
  cargas?: BloqueCargas | null;
  empresa?: string;
};

// ── Utilidades de texto ─────────────────────────────────────────────────────

/** ⚠️ Todo lo que viene de la base pasa por acá. Los identificadores los teclea
 *  gente y un `<` suelto no rompe el documento: lo reescribe. */
export function esc(t: unknown): string {
  return String(t ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const m2 = (n: number) => (Number.isFinite(n) && n > 0 ? n.toFixed(2) : '—');

const TONO: Record<string, string> = {
  azul: 'background:#DCE9F7;color:#1F4E79;border:1px solid #B7CFE8',
  naranja: 'background:#FCE6CF;color:#95500D;border:1px solid #F3C79A',
  verde: 'background:#D9F0DF;color:#1D6B36;border:1px solid #A9DCBA',
  gris: 'background:#E9ECEF;color:#5B6672;border:1px solid #D3D9DF',
};

const pastilla = (m3: number, ident: string, seg: Segmento): string => {
  const p = pastillaClase(m3, ident, seg);
  return `<span class="pill" style="${TONO[p.tono]}">${esc(p.texto)}</span>`;
};

// ── Las tres tarjetas de arriba ─────────────────────────────────────────────

/**
 * Mayor, menor y promedio, cada una diciendo DE QUÉ UNIDAD es.
 *
 * ⚠️ El nombre entre paréntesis no es adorno: en la muestra del cliente dice
 *    «MAYOR CAPACIDAD (VOLQUETA TELESCÓPICA)». Sin él, tres números sueltos
 *    obligan a bajar a la tabla a buscar cuál es cuál.
 */
export function tarjetas(unidades: UnidadReporte[]): { valor: string; titulo: string }[] {
  const medidas = unidades.filter((u) => u.m3 > 0);
  const k = kpis(medidas.map((u) => u.m3));
  // El nombre entre paréntesis se recorta: la tarjeta tiene tres por fila y un
  // nombre largo la parte en tres líneas, empujando las otras dos hacia abajo y
  // desalineando el bloque entero.
  const nombreDe = (v: number) => {
    const u = medidas.find((x) => redondear(x.m3) === v);
    if (!u) return '';
    const t = u.ident.toUpperCase();
    return ` (${t.length > 30 ? t.slice(0, 29).trimEnd() + '\u2026' : t})`;
  };
  if (!k.n) {
    return [
      { valor: '—', titulo: 'MAYOR CAPACIDAD' },
      { valor: '—', titulo: 'MENOR CAPACIDAD' },
      { valor: '—', titulo: 'VOLUMEN PROMEDIO GENERAL' },
    ];
  }
  return [
    { valor: `${k.mayor.toFixed(2)} m³`, titulo: `MAYOR CAPACIDAD${nombreDe(k.mayor)}` },
    { valor: `${k.menor.toFixed(2)} m³`, titulo: `MENOR CAPACIDAD${nombreDe(k.menor)}` },
    { valor: `${k.promedio.toFixed(2)} m³`, titulo: 'VOLUMEN PROMEDIO GENERAL' },
  ];
}

// ── El análisis, deducido de los propios números ────────────────────────────

/**
 * Los hallazgos NO son texto fijo: se calculan.
 *
 * ⚠️ Un párrafo escrito a mano que diga «entre 13,80 y 17,64 m³» queda mintiendo
 *    en cuanto se mida otra unidad, y nadie se acuerda de ir a corregirlo. Acá
 *    los rangos salen de las mismas filas que se imprimieron arriba.
 */
export function hallazgos(unidades: UnidadReporte[]): { titulo: string; texto: string }[] {
  const out: { titulo: string; texto: string }[] = [];
  for (const seg of SEGMENTOS) {
    const u = unidades.filter((x) => x.segmento === seg.key && x.m3 > 0);
    if (!u.length) continue;
    const k = kpis(u.map((x) => x.m3));
    const nombres = u.slice().sort((a, b) => b.m3 - a.m3).map((x) => x.ident);
    if (seg.key === 'volteo') {
      out.push({
        titulo: 'Unidades de Volteo (Rígidos)',
        texto: `Con volúmenes que oscilan entre ${k.menor.toFixed(2)} m³ y ${k.mayor.toFixed(2)} m³ `
          + `(${u.length} unidad(es)), estas unidades son altamente versátiles para distribución urbana, `
          + `espacios confinados y maniobras en terrenos complejos.`,
      });
    } else {
      out.push({
        titulo: 'Unidades de Volqueta y Chutos',
        texto: `Con capacidades de hasta ${k.mayor.toFixed(2)} m³ (${esc(nombres[0])}) y un promedio de `
          + `${k.promedio.toFixed(2)} m³ sobre ${u.length} unidad(es), están diseñadas para acarreo masivo `
          + `de agregados y movimiento de tierra en trayectos de media y larga distancia.`,
      });
    }
  }
  return out;
}

export function recomendaciones(unidades: UnidadReporte[]): string[] {
  const med = unidades.filter((u) => u.m3 > 0).sort((a, b) => b.m3 - a.m3);
  if (!med.length) return [];
  const mayor = med[0], menor = med[med.length - 1];
  const out = [
    `<b>Asignación por densidad de material:</b> reservar ${esc(mayor.ident)} (${mayor.m3.toFixed(2)} m³) `
    + `para materiales de mayor volumen o densidad controlada, aprovechando su altura de bordes de ${m2(mayor.alto)} m.`,
    `<b>Estandarización de rutas:</b> utilizar las unidades de menor capacidad, empezando por `
    + `${esc(menor.ident)} (${menor.m3.toFixed(2)} m³), en zonas de maniobra estrechas o terrenos blandos `
    + `donde los semirremolques pesados corren riesgo de atascamiento.`,
  ];
  if (mayor.alto !== menor.alto) {
    out.push(
      `<b>Optimización de ciclos de carga:</b> coordinar la maquinaria de excavación o cargador frontal según `
      + `la altura de borde de tolva (${m2(mayor.alto)} m en ${esc(mayor.ident)} contra ${m2(menor.alto)} m en `
      + `${esc(menor.ident)}) para evitar derrames o daños en las cortinas laterales.`
    );
  }
  return out;
}

// ── El documento ────────────────────────────────────────────────────────────

const CSS = `
  *{box-sizing:border-box}
  body{margin:0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#22303C;background:#fff;font-size:11px}
  .hoja{padding:0 0 18px}
  .cab{background:#16324F;color:#fff;padding:18px 22px 16px;border-bottom:4px solid #E08A2E}
  .cab h1{margin:0;font-size:19px;font-weight:800;letter-spacing:-.2px}
  .cab .sub{margin-top:5px;font-size:11px;color:#B9C9DA}
  .meta{margin:14px 22px 0;border:1px solid #D4DCE5;border-radius:4px;padding:8px 12px;font-size:10.5px;color:#41505F;background:#FAFBFD}
  .meta b{color:#16324F}
  .intro{margin:12px 22px 0;font-size:11px;line-height:1.55;color:#3A4854}
  .kpis{display:flex;gap:10px;margin:14px 22px 0}
  .kpi{flex:1;border:1px solid #D4DCE5;border-top:3px solid #16324F;border-radius:4px;padding:12px 8px;text-align:center;background:#FAFBFD}
  .kpi .v{font-size:21px;font-weight:800;color:#17708A;line-height:1.1}
  .kpi .t{margin-top:5px;font-size:8.5px;font-weight:700;color:#68757F;letter-spacing:.3px}
  h2{margin:20px 22px 8px;font-size:13px;font-weight:800;color:#16324F;border-left:4px solid #E08A2E;padding-left:9px}
  h2.az{border-left-color:#16324F}
  .p{margin:0 22px 8px;font-size:10.5px;line-height:1.55;color:#3A4854}
  table{width:calc(100% - 44px);margin:0 22px 4px;border-collapse:collapse;font-size:10px}
  th{background:#16324F;color:#fff;text-align:left;padding:7px 8px;font-size:8.5px;font-weight:700;letter-spacing:.3px;border:1px solid #16324F}
  td{padding:6px 8px;border:1px solid #DDE4EC;color:#2B3844}
  tbody tr:nth-child(even) td{background:#F5F8FC}
  tr.dest td{background:#EAF3FB;color:#1F4E79;font-weight:700}
  td.n,th.n{text-align:center}
  td.r,th.r{text-align:right}
  td.b{font-weight:700}
  tfoot td{background:#E7EEF6;font-weight:800;color:#16324F}
  .pill{display:inline-block;padding:2px 7px;border-radius:9px;font-size:8px;font-weight:800;letter-spacing:.3px;white-space:nowrap}
  ul{margin:0 22px 8px;padding-left:16px}
  li{margin:0 0 6px;font-size:10.5px;line-height:1.5;color:#3A4854}
  ol{margin:0 22px 8px;padding-left:18px}
  .nota{margin:12px 22px 0;padding:9px 12px;border-left:4px solid #E8B33A;background:#FFF9EC;font-size:10px;line-height:1.5;color:#5C4A1E;border-radius:0 4px 4px 0}
  .nota.verde{border-left-color:#4CA96B;background:#EFF8F1;color:#20573A}
  .nota b{display:block;margin-bottom:3px}
  .pie{margin:22px 22px 0;padding-top:8px;border-top:1px solid #D4DCE5;font-size:9px;color:#7A8794;display:flex;justify-content:space-between}
`;

/** El documento completo, listo para `exportPdf`. */
export function reporteVolumetricoHtml(d: DatosVolumetrico): string {
  const unidades = d.unidades.slice().sort((a, b) => b.m3 - a.m3);
  const empresa = d.empresa || 'SOS La Guaira';

  const kpisHtml = tarjetas(unidades)
    .map((t) => `<div class="kpi"><div class="v">${esc(t.valor)}</div><div class="t">${esc(t.titulo)}</div></div>`)
    .join('');

  const filaDe = (u: UnidadReporte, i: number) => `
    <tr${u.destacada ? ' class="dest"' : ''}>
      <td class="n">${i + 1}</td>
      <td>${esc(u.ident)}</td>
      <td class="n">${m2(u.alto)}</td>
      <td class="n">${m2(u.largo)}</td>
      <td class="n">${m2(u.ancho)}</td>
      <td class="r b">${m3Texto(u.m3)} m³</td>
      <td class="n">${pastilla(u.m3, u.ident, u.segmento)}</td>
    </tr>`;

  const tablaDe = (titulo: string, columna: string, filas: UnidadReporte[], n: number) => `
    <h2${n > 1 ? ' class="az"' : ''}>${n}. ${esc(titulo)}</h2>
    <table>
      <thead><tr>
        <th class="n">N°</th><th>${esc(columna)}</th>
        <th class="n">ALTO (M)</th><th class="n">LARGO (M)</th><th class="n">ANCHO (M)</th>
        <th class="r">VOLUMEN (M³)</th><th class="n">CLASIFICACIÓN</th>
      </tr></thead>
      <tbody>${filas.map(filaDe).join('')}</tbody>
    </table>`;

  let n = 0;
  let tablas = '';
  if (d.segmentado) {
    for (const seg of SEGMENTOS) {
      const filas = unidades.filter((u) => u.segmento === seg.key);
      // Una tabla vacía con su encabezado se lee como «esta familia no cargó
      // nada», y lo cierto es que no hay ninguna unidad de esa familia medida.
      if (!filas.length) continue;
      tablas += tablaDe(seg.titulo, seg.columna, filas, ++n);
    }
  } else {
    tablas = tablaDe('Tabla Comparativa de Dimensiones y Volumen', 'EQUIPO / MODELO', unidades, ++n);
  }

  // ── Los m³ CARGADOS del histórico. Es la parte que las muestras no traían y
  //    que el cliente pidió: poder buscar por día, por mes o por camión.
  const c = d.cargas;
  const cargasHtml = c && c.grupos.length
    ? `<h2 class="az">${++n}. Metros Cúbicos Cargados · ${esc(EJE_TITULO[c.eje])}</h2>
       <p class="p">Volumen efectivamente registrado en el período <b>${esc(c.rango)}</b>. El día se cuenta
         por <b>jornada de 7am a 7am</b>, igual que los viajes, y no por día de calendario.</p>
       <table>
         <thead><tr>
           <th>${esc(EJE_COLUMNA[c.eje])}</th>
           <th class="n">${esc(EJE_DENTRO[c.eje])}</th>
           <th class="r">VIAJES</th><th class="r">VOLUMEN (M³)</th><th class="r">M³ / VIAJE</th>
         </tr></thead>
         <tbody>${c.grupos.map((g) => `
           <tr>
             <td>${esc(etiquetaGrupo(g, c.eje))}</td>
             <td class="n">${g.n}</td>
             <td class="r">${g.viajes}</td>
             <td class="r b">${m3Texto(g.m3)}</td>
             <td class="r">${m3Texto(g.viajes > 0 ? redondear(g.m3 / g.viajes) : 0)}</td>
           </tr>`).join('')}</tbody>
         <tfoot><tr>
           <td>TOTAL</td>
           <td class="n">${c.total.camiones} camión(es) · ${c.total.dias} día(s)</td>
           <td class="r">${c.total.viajes}</td>
           <td class="r">${m3Texto(c.total.m3)}</td>
           <td class="r">${m3Texto(c.total.viajes > 0 ? redondear(c.total.m3 / c.total.viajes) : 0)}</td>
         </tr></tfoot>
       </table>`
    : '';

  const hall = hallazgos(unidades);
  const reco = recomendaciones(unidades);

  const analisis = hall.length
    ? `<h2 class="az">${++n}. Análisis Logístico y Recomendaciones Operativas</h2>
       <ul>${hall.map((h) => `<li><b>${esc(h.titulo)}:</b> ${h.texto}</li>`).join('')}</ul>`
    : '';

  const recos = reco.length
    ? `<h2 class="az">${++n}. Recomendaciones Operativas</h2><ol>${reco.map((r) => `<li>${r}</li>`).join('')}</ol>`
    : '';

  const notaExcluidas = d.excluidas.length
    ? `<div class="nota"><b>Nota operativa</b>Se ha excluido ${d.excluidas.length === 1 ? 'la unidad' : 'las unidades'}
        ${esc(d.excluidas.join(', '))} según los parámetros de filtrado solicitados, enfocando el reporte
        exclusivamente en la flota estándar de volteos y volquetas operativas.
        Sus viajes se siguen registrando y contando con normalidad en el resto del módulo.</div>`
    : '';

  const intro = d.segmentado
    ? `El presente documento presenta la flota vehicular dividida en dos categorías operativas principales:
       <b>Volteos</b> (unidades rígidas de menor y mediana capacidad para obras urbanas y accesos reducidos)
       y <b>Volquetas / Chutos con Volqueta</b> (unidades de mayor capacidad volumétrica y semirremolques
       para acarreo industrial).`
    : `El presente documento ofrece un análisis comparativo y computacional detallado del volumen de carga útil
       (capacidad volumétrica geométrica) de la flota de vehículos de volteo y chutos con volqueta. El estudio
       se realiza a partir de las dimensiones exactas de las tolvas (alto, largo y ancho) suministradas para la
       planificación operativa de acarreo de materiales, agregados, minerales o escombros.`;

  return `<!doctype html><html><head><meta charset="utf-8"/><title>Analisis Tecnico y Capacidad Volumetrica de Flota</title>
    <style>${CSS}</style></head><body><div class="hoja">
    <div class="cab">
      <h1>Análisis Técnico y Capacidad Volumétrica de Flota</h1>
      <div class="sub">${esc(d.segmentado
        ? 'Evaluación Segmentada: Unidades de Volteo vs. Volquetas / Chutos'
        : 'Evaluación de Tolvas, Volteos y Chutos de Transporte de Carga Pesada')}</div>
    </div>
    <div class="meta">
      <b>Unidades Evaluadas:</b> ${unidades.length} Vehículos / Configuraciones &nbsp;|&nbsp;
      <b>Fecha de Emisión:</b> ${esc(d.fechaEmision)} &nbsp;|&nbsp;
      <b>Configuración:</b> ${esc(d.configuracion)}
    </div>
    <div class="intro">${intro}</div>
    <div class="kpis">${kpisHtml}</div>
    ${tablas}
    ${cargasHtml}
    ${analisis}
    <div class="nota verde"><b>Nota técnica sobre copamiento y carga efectiva</b>
      El volumen calculado corresponde al límite al enrasar la tolva (capacidad geométrica rasa). Al transportar
      materiales como arena, piedra picada o tierra, la capacidad real puede variar según el copamiento
      (acordonamiento del material) y el peso específico del mismo, para no exceder los límites legales de
      tonelaje por eje.</div>
    ${recos}
    ${notaExcluidas}
    <div class="pie"><span>${esc(empresa)} · Reporte Logístico Transporte y Volteo</span><span>Emitido el ${esc(d.fechaEmision)}</span></div>
  </div></body></html>`;
}

const EJE_TITULO: Record<EjeHistorico, string> = {
  dia: 'Detalle por Día', mes: 'Consolidado Mensual', camion: 'Consolidado por Unidad',
};
const EJE_COLUMNA: Record<EjeHistorico, string> = {
  dia: 'JORNADA', mes: 'MES', camion: 'UNIDAD',
};
const EJE_DENTRO: Record<EjeHistorico, string> = {
  dia: 'UNIDADES', mes: 'DÍAS', camion: 'DÍAS',
};

/** La etiqueta legible de cada grupo. Las fechas se escriben como se leen acá:
 *  día/mes/año, y el mes con su nombre. */
export function etiquetaGrupo(g: GrupoCarga, eje: EjeHistorico): string {
  if (eje === 'dia') return fechaCorta(g.label);
  if (eje === 'mes') return mesLargo(g.label);
  return g.label;
}
