// ============================================================================
// INFORME TÉCNICO Y DE COSTOS DE MANTENIMIENTO Y REPARACIÓN.
//
// Reemplaza el Word que la oficina armaba a mano por máquina para entregárselo
// al dueño del equipo («Informe Técnico JUMBO 320 — Sr. Samuel Nasser»): ficha
// del equipo, historial cronológico de intervenciones con mano de obra y
// repuestos, totales consolidados, registro fotográfico y firmas.
//
// TODO ESTE ARCHIVO ES PURO: no toca Supabase ni React. La pantalla trae los
// datos ya cargados y acá solo se calcula e imprime. Así lo prueba
// `scripts/test-informe-tecnico.mjs` sin base de datos, que es lo que hace que
// las CUENTAS del documento se puedan blindar: un informe que suma mal es peor
// que no tenerlo.
//
// ⚠️ ACÁ SÍ SE HABLA DE DINERO — y es la única parte del módulo de Servicio que
//    lo hace. La hoja de trabajo (`machineServiceReport.ts`) sigue SIN costos a
//    propósito: es el papel que firma el técnico en el patio, y ahí el precio de
//    los repuestos no tiene por qué andar circulando.
//
// ⚠️ EL COSTO ES OPCIONAL EN TODAS PARTES. Una intervención sin mano de obra
//    cargada vale 0 y sale con su renglón vacío; no se inventa un número ni se
//    deja el informe a medias. Por eso `totalesInforme` NUNCA devuelve NaN:
//    todos los caminos pasan por `numero()`.
// ============================================================================
import { machineLabel, MaquinaIdentificable } from './machineLabel';

const esc = (v: any): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Cualquier cosa → número usable. Texto con coma decimal incluido («45,50»). */
export function numero(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return 0;
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

/** Redondeo a céntimos. Sin esto, 0.1 + 0.2 aparece impreso como 0.30000000000000004. */
export const centavos = (n: number): number => Math.round(numero(n) * 100) / 100;

/** «$1.936,84». Formato venezolano, que es el que lee quien firma el papel. */
export function money(v: unknown): string {
  return `$${centavos(numero(v)).toLocaleString('es-VE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

/** Cantidad sin ceros de relleno: «10», «1,5». */
export function cantidad(v: unknown): string {
  return (Math.round(numero(v) * 100) / 100).toLocaleString('es-VE', { maximumFractionDigits: 2 });
}

/** AAAA-MM-DD → DD/MM/AAAA. Sin `new Date()`: una fecha suelta no tiene zona
 *  horaria y construir un Date la corre un día en Venezuela (UTC-4). */
export function dmy(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** AAAA-MM-DD → «21 de septiembre de 2026», como va en la cabecera del informe. */
export function fechaLarga(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim());
  if (!m) return '—';
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${Number(m[3])} de ${mes} de ${m[1]}` : '—';
}

// ── LO QUE ENTRA ────────────────────────────────────────────────────────────

/** Un repuesto de la intervención, tal como vive en `machinery_service_parts`. */
export type RepuestoInforme = {
  quantity?: number | string | null;
  description?: string | null;
  estado?: string | null;
  /** Costo UNITARIO. El total del renglón es cantidad × este número. */
  unit_cost?: number | string | null;
};

/** Una intervención, tal como vive en `machinery_service_orders` + sus repuestos. */
export type IntervencionInforme = {
  id?: string;
  service_date?: string | null;
  origen?: 'interno' | 'externo' | null;
  technician?: string | null;
  provider?: string | null;
  problem?: string | null;
  work_done?: string | null;
  notes?: string | null;
  labor_cost?: number | string | null;
  parts?: RepuestoInforme[] | null;
  photos?: string[] | null;
};

/** Lo que hace falta del equipo para la sección 1. */
export type EquipoInforme = MaquinaIdentificable & {
  tipo?: string | null;
  marca?: string | null;
  modelo?: string | null;
  photo_url?: string | null;
  companyName?: string | null;
  companyRif?: string | null;
  encargado?: string | null;
  last_horometro?: number | null;
  horometro_base?: number | null;
};

/** La cabecera editorial: lo único que no se deduce de los datos. */
export type CabeceraInforme = {
  code?: string | null;
  reportDate?: string | null;
  dirigidoA?: string | null;
  elaboradoPor?: string | null;
  empresaPropietaria?: string | null;
  encargadoSitio?: string | null;
  ubicacion?: string | null;
  estadoInforme?: string | null;
  antecedentes?: string | null;
  estadoOperatividad?: string | null;
  proximoPm?: string | null;
  recomendaciones?: string[] | null;
  firma1Nombre?: string | null; firma1Cargo?: string | null; firma1Empresa?: string | null;
  firma2Nombre?: string | null; firma2Cargo?: string | null; firma2Empresa?: string | null;
  conFotos?: boolean;
};

// ── LAS CUENTAS ─────────────────────────────────────────────────────────────

/**
 * Total de UN renglón de repuesto: cantidad × costo unitario.
 *
 * ⚠️ Cantidad ausente cuenta como 1, no como 0. En el formulario la cantidad es
 *    opcional («Reparación de cilindro hidráulico» no lleva número), y tratarla
 *    como cero haría desaparecer del total un repuesto que SÍ tiene precio —
 *    un informe que cobra de menos sin avisar.
 */
export function totalRepuesto(p: RepuestoInforme | null | undefined): number {
  const costo = numero(p?.unit_cost);
  if (costo === 0) return 0;
  const cant = p?.quantity == null || String(p.quantity).trim() === '' ? 1 : numero(p.quantity);
  return centavos(cant * costo);
}

/** Lo que costaron los repuestos de UNA intervención. */
export function costoRepuestos(parts?: RepuestoInforme[] | null): number {
  return centavos((parts ?? []).reduce((s, p) => s + totalRepuesto(p), 0));
}

/** Mano de obra + repuestos de UNA intervención. */
export function subtotalIntervencion(it: IntervencionInforme | null | undefined): number {
  return centavos(numero(it?.labor_cost) + costoRepuestos(it?.parts));
}

export type TotalesInforme = {
  intervenciones: number;
  manoObra: number;
  repuestos: number;
  total: number;
  /** Costo promedio por intervención. 0 si no hay ninguna (nunca NaN). */
  promedio: number;
};

/** Los totales consolidados de la sección 4. */
export function totalesInforme(items?: IntervencionInforme[] | null): TotalesInforme {
  const xs = items ?? [];
  const manoObra = centavos(xs.reduce((s, it) => s + numero(it?.labor_cost), 0));
  const repuestos = centavos(xs.reduce((s, it) => s + costoRepuestos(it?.parts), 0));
  const total = centavos(manoObra + repuestos);
  return {
    intervenciones: xs.length,
    manoObra,
    repuestos,
    total,
    promedio: xs.length ? centavos(total / xs.length) : 0,
  };
}

/** Quién hizo el trabajo, en texto plano para la columna «Técnico». */
export function quienInforme(it: IntervencionInforme | null | undefined): string {
  const nombre = String((it?.origen === 'externo' ? it?.provider : it?.technician) ?? '').trim();
  return nombre || '—';
}

/** «1 Pasador nuevo ($45,00), 10 kg Grasa Oilven ($80,00)» — la línea de insumos
 *  que va en cursiva debajo de la descripción. Un repuesto sin costo igual se
 *  nombra: el informe también documenta lo que se puso, no solo lo que se pagó. */
export function insumosTexto(parts?: RepuestoInforme[] | null): string {
  return (parts ?? [])
    .filter((p) => String(p?.description ?? '').trim() !== '')
    .map((p) => {
      const cant = p.quantity == null || String(p.quantity).trim() === '' ? '' : `${cantidad(p.quantity)} `;
      const total = totalRepuesto(p);
      return `${cant}${String(p.description).trim()}${total > 0 ? ` (${money(total)})` : ''}`;
    })
    .join(', ');
}

/** El texto de la columna «Descripción de la intervención»: qué falló y qué se
 *  hizo, en ese orden. Si solo hay uno de los dos, sale ese. */
export function descripcionIntervencion(it: IntervencionInforme | null | undefined): string {
  const partes = [String(it?.problem ?? '').trim(), String(it?.work_done ?? '').trim()].filter(Boolean);
  return partes.join(' ') || 'Sin descripción registrada.';
}

/** Ordena por fecha ASCENDENTE: el informe es un relato cronológico, no una
 *  lista de novedades. Empate → se respeta el orden en que venían. */
export function ordenarCronologico<T extends IntervencionInforme>(items?: T[] | null): T[] {
  return (items ?? []).slice().sort((a, b) => {
    const fa = String(a?.service_date ?? '').slice(0, 10);
    const fb = String(b?.service_date ?? '').slice(0, 10);
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });
}

/** Deja solo lo que cae dentro del rango (ambos extremos INCLUIDOS). Un extremo
 *  vacío no limita ese lado. */
export function filtrarPorRango<T extends IntervencionInforme>(
  items?: T[] | null, desde?: string | null, hasta?: string | null
): T[] {
  const d = String(desde ?? '').slice(0, 10);
  const h = String(hasta ?? '').slice(0, 10);
  // Un rango al revés (desde > hasta) no devuelve nada en silencio: se voltea.
  const lo = d && h && d > h ? h : d;
  const hi = d && h && d > h ? d : h;
  return (items ?? []).filter((it) => {
    const f = String(it?.service_date ?? '').slice(0, 10);
    if (!f) return false;
    if (lo && f < lo) return false;
    if (hi && f > hi) return false;
    return true;
  });
}

/** El período que abarcan las intervenciones, ya en formato largo para el texto
 *  de antecedentes. Devuelve null si no hay ninguna fecha usable. */
export function periodoDe(items?: IntervencionInforme[] | null): { desde: string; hasta: string } | null {
  const fechas = (items ?? [])
    .map((it) => String(it?.service_date ?? '').slice(0, 10))
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
    .sort();
  return fechas.length ? { desde: fechas[0], hasta: fechas[fechas.length - 1] } : null;
}

/**
 * El horómetro del equipo y cuándo le toca el próximo servicio.
 *
 * El intervalo es el mismo 250 h que ya usa el módulo de Mantenimiento para sus
 * alertas (`horometroAlertas.ts`), y se cuenta desde `horometro_base` — la
 * lectura del ÚLTIMO mantenimiento confirmado—, no desde la lectura de hoy. Con
 * la lectura de hoy el «próximo servicio» se correría solo hacia adelante todos
 * los días y no llegaría nunca.
 */
export const INTERVALO_PM_HORAS = 250;

export function horometroInforme(
  m: EquipoInforme | null | undefined, intervalo = INTERVALO_PM_HORAS
): string {
  const last = m?.last_horometro;
  if (last == null) return '—';
  const base = m?.horometro_base != null ? m.horometro_base : last;
  const prox = numero(base) + intervalo;
  const h = (v: number) => v.toLocaleString('es-VE', { maximumFractionDigits: 1 });
  return `${h(numero(last))} horas (Próximo servicio: ${h(prox)} hrs)`;
}

/**
 * Redacta la sección 2 sola, con los datos que ya hay. El usuario la puede
 * corregir antes de emitir: se propone, no se impone.
 */
export function antecedentesAuto(opts: {
  equipo: EquipoInforme;
  items: IntervencionInforme[];
  dirigidoA?: string | null;
  ubicacion?: string | null;
}): string {
  const { equipo, items } = opts;
  const nombre = machineLabel(equipo) || 'el equipo';
  const marca = [equipo?.marca, equipo?.modelo].filter(Boolean).join(' ');
  const serial = String(equipo?.serial ?? '').trim();
  const destino = String(opts.dirigidoA ?? '').trim();
  const lugar = String(opts.ubicacion ?? '').trim();
  const per = periodoDe(items);
  const n = items.length;

  const frases: string[] = [];
  frases.push(
    `El presente informe consolidado tiene como propósito presentar${destino ? ` a ${destino}` : ''} ` +
    `el historial detallado de las intervenciones técnicas, reparaciones preventivas y correctivas y ` +
    `los costos asociados al mantenimiento de la unidad ${nombre}` +
    `${marca ? ` (${marca})` : ''}${serial ? `, serial ${serial}` : ''}.`
  );
  if (per) {
    frases.push(
      `Durante el período comprendido entre el ${fechaLarga(per.desde)} y el ${fechaLarga(per.hasta)}, ` +
      `${lugar ? `el equipo ha estado desplegado en las operaciones de ${lugar}, y ` : ''}` +
      `se realizaron ${n} ${n === 1 ? 'intervención' : 'intervenciones'} de campo para garantizar su ` +
      `disponibilidad operativa y mantener los estándares de rendimiento técnico.`
    );
  } else {
    frases.push('En el período consultado no se registraron intervenciones de campo para esta unidad.');
  }
  return frases.join(' ');
}

// ── EL DOCUMENTO ────────────────────────────────────────────────────────────

const NAVY = '#16324F';

/** Filas clave/valor, saltando lo que viene vacío. */
function kv(pairs: [string, any][]): string {
  return pairs
    .filter(([, v]) => v != null && String(v).trim() !== '' && String(v) !== '—')
    .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('');
}

export type InformeTecnicoData = {
  equipo: EquipoInforme;
  items: IntervencionInforme[];
  cabecera: CabeceraInforme;
  /** Nombre del titular del sistema para el membrete. */
  empresaEmisora?: string | null;
};

/**
 * HTML imprimible del informe completo, listo para `exportPdf`. Carta.
 *
 * Mejora el Word de referencia en tres cosas concretas: las cuentas las hace el
 * sistema (no se tipean), el registro fotográfico trae LAS FOTOS que el taller
 * ya cargó en cada servicio —y solo deja los recuadros vacíos donde no hay—, y
 * la ficha del equipo sale de la base en vez de una captura de pantalla pegada.
 */
export function informeTecnicoHtml(d: InformeTecnicoData): string {
  const { equipo, cabecera: c } = d;
  const items = ordenarCronologico(d.items);
  const t = totalesInforme(items);
  const nombreEquipo = machineLabel(equipo) || '—';
  const marcaModelo = [equipo?.marca, equipo?.modelo].filter(Boolean).join(' / ');
  const empresa = String(equipo?.companyName ?? '').trim();
  const rif = String(equipo?.companyRif ?? '').trim();

  const filas = items.map((it) => {
    const insumos = insumosTexto(it.parts);
    const rep = costoRepuestos(it.parts);
    return `<tr>
      <td class="nw">${esc(dmy(it.service_date))}</td>
      <td>${esc(quienInforme(it))}</td>
      <td>
        <div class="desc">${esc(descripcionIntervencion(it))}</div>
        ${insumos ? `<div class="ins">Insumos: ${esc(insumos)}</div>` : ''}
      </td>
      <td class="r">${esc(money(it.labor_cost))}</td>
      <td class="r">${esc(money(rep))}</td>
      <td class="r b">${esc(money(subtotalIntervencion(it)))}</td>
    </tr>`;
  }).join('');

  // ── 5. Registro fotográfico ───────────────────────────────────────────────
  // Con fotos cargadas se imprimen; sin ellas van los dos recuadros vacíos, que
  // es exactamente lo que hace hoy el documento en Word para pegarlas a mano.
  const foto = (
    items.map((it, i) => {
      const fotos = (it.photos ?? []).filter((u) => String(u ?? '').trim() !== '');
      const cajas = fotos.length
        ? fotos.map((u) => `<img class="ph" src="${esc(u)}" alt=""/>`).join('')
        : `<div class="ph vacio">[ Insertar foto antes / durante ]</div>
           <div class="ph vacio">[ Insertar foto después / componente ]</div>`;
      const nota = String(it.notes ?? '').trim() || descripcionIntervencion(it);
      return `<div class="fot">
        <div class="fot-t">• Intervención ${i + 1} (${esc(dmy(it.service_date))}): ${esc(descripcionIntervencion(it).slice(0, 90))}</div>
        <div class="fot-c">${cajas}</div>
        <div class="fot-n">Nota técnica: ${esc(nota)}</div>
      </div>`;
    }).join('')
  );

  const recos = (c.recomendaciones ?? []).filter((r) => String(r ?? '').trim() !== '');

  return `<!doctype html><html><head><meta charset="utf-8"><title></title><style>
  @page{size:letter;margin:14mm 12mm}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#1a1c20;margin:0;font-size:11.5px;line-height:1.45}

  .hd{background:${NAVY};color:#fff;padding:14px 16px;border-radius:6px}
  .hd .co{font-size:10.5px;font-weight:800;letter-spacing:1.1px;color:#AFC4DB;text-transform:uppercase}
  .hd h1{margin:6px 0 0;font-size:20px;font-weight:900;line-height:1.2;text-wrap:balance}
  .hd .eq{margin-top:7px;font-size:11.5px;font-weight:800;letter-spacing:.5px;color:#DCE7F3}

  .meta{display:flex;flex-wrap:wrap;margin-top:12px;border:1px solid #E2E8F0;border-radius:6px;
    background:#F8FAFC;overflow:hidden}
  .meta div{width:50%;padding:6px 11px;font-size:11px;border-bottom:1px solid #EDF2F7}
  .meta b{color:${NAVY}}

  h2{font-size:13px;color:${NAVY};margin:18px 0 6px;border-bottom:2px solid ${NAVY};padding-bottom:4px;
    text-transform:uppercase;letter-spacing:.3px;page-break-after:avoid}

  .eqhead{display:flex;gap:14px;align-items:center;margin:8px 0}
  .eqhead img{width:132px;height:100px;object-fit:cover;border:3px solid ${NAVY};border-radius:8px;background:#EEF2F7;flex:none}
  .eqhead .n{font-size:17px;font-weight:900;color:${NAVY};line-height:1.15}
  .eqhead .s{font-size:11.5px;color:#475569;font-weight:700;margin-top:2px}

  table{border-collapse:collapse;width:100%}
  table.ft td{border:1px solid #D7E3F4;padding:5px 9px;vertical-align:top;font-size:11.5px}
  table.ft td.k{background:#EAF1FB;color:#334155;width:38%;font-weight:700}

  p.tx{margin:6px 0;text-align:justify}

  table.hist{font-size:10.5px;table-layout:fixed;margin-top:4px}
  table.hist th{background:${NAVY};color:#fff;padding:6px 7px;text-align:left;font-size:10px;
    text-transform:uppercase;letter-spacing:.3px}
  table.hist td{border-bottom:1px solid #E2E8F0;padding:6px 7px;vertical-align:top;
    overflow-wrap:anywhere;word-break:break-word}
  table.hist tr:nth-child(even) td{background:#F8FAFC}
  .desc{font-weight:700;color:#0F172A}
  .ins{font-style:italic;color:#64748B;font-size:9.5px;margin-top:2px}
  .r{text-align:right;font-variant-numeric:tabular-nums}
  .b{font-weight:800}
  .nw{white-space:nowrap}
  tr.tot td{background:#EAF1FB;color:${NAVY};font-weight:900;font-size:11px;border-top:2px solid ${NAVY}}

  table.fin td{border-bottom:1px solid #E2E8F0;padding:7px 10px;font-size:11.5px}
  table.fin td.v{text-align:right;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
  table.fin tr.grand td{background:#EAF1FB;color:${NAVY};font-weight:900;font-size:13px}

  .fot{margin:10px 0 14px;page-break-inside:avoid}
  .fot-t{font-weight:800;color:${NAVY};font-size:11.5px}
  .fot-c{display:flex;gap:10px;margin:5px 0}
  .ph{flex:1;height:112px;border-radius:6px;object-fit:cover;border:1px solid #E2E8F0;background:#F8FAFC}
  .ph.vacio{display:flex;align-items:center;justify-content:center;color:#94A3B8;font-size:10px;font-style:italic}
  .fot-n{font-style:italic;color:#64748B;font-size:10px}

  ul.reco{margin:4px 0 0 16px;padding:0}
  ul.reco li{margin:3px 0;text-align:justify}

  .firmas{display:flex;gap:48px;margin-top:46px;page-break-inside:avoid}
  .firma{flex:1;text-align:center}
  .firma .line{border-top:1px solid #334155;margin-bottom:5px}
  .firma .n{font-weight:800;font-size:11.5px;color:${NAVY}}
  .firma .c{font-size:10.5px;color:#475569}

  .vacia{border:1px dashed #CBD5E1;border-radius:8px;padding:14px;text-align:center;
    color:#64748B;font-size:11.5px;margin-top:6px}
  </style></head><body>

  <div class="hd">
    <div class="co">${esc(d.empresaEmisora ?? '')}</div>
    <h1>Informe técnico y de costos de mantenimiento y reparación</h1>
    <div class="eq">EQUIPO: ${esc(nombreEquipo)}${marcaModelo ? ` (${esc(marcaModelo)})` : ''}</div>
  </div>

  <div class="meta">
    <div><b>Código de documento:</b> ${esc(c.code || '—')}</div>
    <div><b>Dirigido a:</b> ${esc(c.dirigidoA || '—')}</div>
    <div><b>Fecha de emisión:</b> ${esc(fechaLarga(c.reportDate))}</div>
    <div><b>Elaborado por:</b> ${esc(c.elaboradoPor || '—')}</div>
    <div><b>Empresa / propietario:</b> ${esc(c.empresaPropietaria || empresa || '—')}</div>
    <div><b>Encargado de sitio:</b> ${esc(c.encargadoSitio || equipo?.encargado || '—')}</div>
    <div><b>Ubicación de operación:</b> ${esc(c.ubicacion || '—')}</div>
    <div><b>Estado del informe:</b> ${esc(c.estadoInforme || '—')}</div>
  </div>

  <h2>1. Datos de identificación del equipo</h2>
  <div class="eqhead">
    ${equipo?.photo_url ? `<img src="${esc(equipo.photo_url)}" width="132" height="100" alt=""/>` : ''}
    <div>
      <div class="n">${esc(nombreEquipo)}</div>
      <div class="s">${esc(empresa)}</div>
    </div>
  </div>
  <table class="ft"><tbody>${kv([
    ['Tipo de equipo', equipo?.tipo],
    ['Marca / modelo', marcaModelo],
    ['Número de serial / VIN', equipo?.serial],
    ['Placa', equipo?.plate],
    ['Horómetro registrado', horometroInforme(equipo)],
    ['Empresa propietaria', empresa ? `${empresa}${rif ? ` (RIF: ${rif})` : ''}` : ''],
    ['Encargado', c.encargadoSitio || equipo?.encargado],
    ['Ubicación / proyecto', c.ubicacion],
  ]) || '<tr><td class="k">Sin datos</td><td>—</td></tr>'}</tbody></table>

  <h2>2. Antecedentes y estado operativo general</h2>
  <p class="tx">${esc(c.antecedentes || antecedentesAuto({
    equipo, items, dirigidoA: c.dirigidoA, ubicacion: c.ubicacion,
  }))}</p>

  <h2>3. Historial de intervenciones técnicas y costos</h2>
  ${items.length ? `<table class="hist">
    <thead><tr>
      <th style="width:60px">Fecha</th>
      <th style="width:80px">Técnico</th>
      <th>Descripción de la intervención y repuestos</th>
      <th class="r" style="width:66px">Mano obra</th>
      <th class="r" style="width:66px">Repuestos</th>
      <th class="r" style="width:70px">Subtotal</th>
    </tr></thead>
    <tbody>${filas}
      <tr class="tot">
        <td colspan="3">TOTALES CONSOLIDADOS</td>
        <td class="r">${esc(money(t.manoObra))}</td>
        <td class="r">${esc(money(t.repuestos))}</td>
        <td class="r">${esc(money(t.total))}</td>
      </tr>
    </tbody></table>`
    : '<div class="vacia">No hay intervenciones registradas para esta unidad en el período seleccionado.</div>'}

  <h2>4. Resumen financiero de mantenimiento</h2>
  <table class="fin"><tbody>
    <tr><td>Total invertido en mano de obra especializada</td><td class="v">${esc(money(t.manoObra))}</td></tr>
    <tr><td>Total invertido en repuestos, filtros y lubricantes</td><td class="v">${esc(money(t.repuestos))}</td></tr>
    <tr class="grand"><td>MONTO TOTAL ACUMULADO DE SERVICIOS Y MANTENIMIENTO</td><td class="v">${esc(money(t.total))}</td></tr>
    <tr><td>Promedio de costo por intervención técnica (${t.intervenciones} ${t.intervenciones === 1 ? 'servicio' : 'servicios'})</td><td class="v">${esc(money(t.promedio))}</td></tr>
  </tbody></table>

  ${c.conFotos === false || !items.length ? '' : `<h2>5. Registro fotográfico de mantenimiento y reparación</h2>${foto}`}

  <h2>${c.conFotos === false || !items.length ? '5' : '6'}. Conclusiones técnicas y recomendaciones</h2>
  <p class="tx"><b>Estado de operatividad del equipo:</b> ${esc(c.estadoOperatividad || '—')}</p>
  <p class="tx"><b>Próximo mantenimiento preventivo (PM):</b> ${esc(c.proximoPm || horometroInforme(equipo))}</p>
  ${recos.length ? `<p class="tx"><b>Recomendaciones principales:</b></p>
    <ul class="reco">${recos.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}

  <h2>${c.conFotos === false || !items.length ? '6' : '7'}. Firmas de conformidad y validación</h2>
  <div class="firmas">
    <div class="firma">
      <div class="line"></div>
      <div class="n">${esc(c.firma1Nombre || c.elaboradoPor || '')}</div>
      <div class="c">${esc(c.firma1Cargo || '')}</div>
      <div class="c">${esc(c.firma1Empresa || '')}</div>
    </div>
    <div class="firma">
      <div class="line"></div>
      <div class="n">${esc(c.firma2Nombre || c.dirigidoA || '')}</div>
      <div class="c">${esc(c.firma2Cargo || '')}</div>
      <div class="c">${esc(c.firma2Empresa || '')}</div>
    </div>
  </div>
  </body></html>`;
}

/** Nombre del archivo: «Informe tecnico JUMBO 320 IT-2026-001.pdf». */
export function nombreArchivoInforme(equipo: EquipoInforme, code?: string | null): string {
  const base = (machineLabel(equipo) || 'equipo').replace(/[^\w\s-]/g, '').trim() || 'equipo';
  return `Informe tecnico ${base}${code ? ` ${code}` : ''}`;
}
