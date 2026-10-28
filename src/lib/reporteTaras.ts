// ⚖️ REPORTE DE TARAS POR CAMIÓN (06-oct-2026).
//
// Pedido del cliente (WhatsApp, 06-oct-2026), textual:
//   «habrá posibilidad de generar un reporte de los camiones que se vaya
//    cargando el peso de la tara? ejemplo hasta ahora tenemos un total de 40
//    camiones que ya cargamos la tara — nosotros tenemos uno así pero con
//    metros cúbicos, pero ya los m3 no los usamos»
//   «y que me aparezca algo donde yo pueda quitar el nombre de las empresas,
//    porque eso es un reporte que nos piden pero no pueden aparecer los
//    nombres de las empresas por ningún lado si no el de jhenzen nada más»
//
// ⭐ ESTE ARCHIVO NO TOCA LA BASE NI LA PANTALLA: arma las filas, el resumen y
//    el cuerpo HTML. El membrete (logos) lo pone `pdfDocument` en la pantalla.
//    Probado solo en `scripts/test-reporte-taras.mjs`.
//
// ⚠️ «POR NINGÚN LADO» ES LITERAL: con `empresa: false` el nombre de la
//    empresa no puede colarse ni en la tabla, ni en el resumen, ni en el
//    nombre del archivo. La prueba lo verifica buscando el nombre en el HTML.

import { kgTexto, tonTexto, type UnidadPeso } from './viajesPeso';

export type CamionParaTara = {
  id: string;
  code: string;
  plate: string | null;
  serial: string | null;
  marca: string | null;
  modelo: string | null;
  companyName: string | null;
  /** ◆ Clasificación por capacidad (compacto / media / gran capacidad). Opcional:
   *  la pantalla ya la trae en TruckRow; llamadas viejas sin ella siguen valiendo. */
  clasificacion?: string | null;
  /** 👤 Chofer asignado al turno de DÍA (de «Choferes por camión»). */
  choferDia?: string | null;
  /** 👤 Chofer asignado al turno de NOCHE. */
  choferNoche?: string | null;
  /** ⛽ Cantidad de combustible (litros) asignada para el día del reporte. */
  combustibleLitros?: number | null;
};

export type TaraParaReporte = {
  pesoTaraKg: number | null;
  updatedAt: string;
  updatedByNombre: string | null;
  exentoRomana: boolean;
  /** ⛽ Cantidad de combustible (litros) asignada a esta maquinaria para ese día. */
  combustibleLitros?: number | null;
};

/** Qué camiones salen: solo los que ya tienen tara (el «van 40») o toda la flota. */
export type AlcanceTaras = 'conTara' | 'todos';

export type OpcionesReporteTaras = {
  alcance: AlcanceTaras;
  unidad: UnidadPeso;
  /** 🏢 Columna «Empresa». Apagada, el nombre no sale en NINGUNA parte. */
  empresa: boolean;
  marcaModelo: boolean;
  /** 👤 Quién cargó la tara y cuándo. */
  cargadaPor: boolean;
  // ── 19-oct-2026, a pedido («hace falta esas opciones, así como en frentes y
  //    en obras y ubicaciones»). Opcionales (`?`) a propósito: las opciones
  //    guardadas en el equipo (AsyncStorage v1) y las llamadas viejas siguen
  //    valiendo con el valor por defecto. Regla de la casa: lo que ya existía
  //    queda encendido; lo NUEVO entra apagado; lo oculto no deja rastro.
  /** 1️⃣ Columna «N°» (el enumerado). */
  numeracion?: boolean;
  /** 🔢 Columna «Placa / serial». */
  placa?: boolean;
  /** ◆ Columna «Clasificación» por capacidad. Nace apagada. */
  clasificacion?: boolean;
  /**
   * 👤 Columna «Chofer»: el que esté asignado al camión en «Choferes por
   * camión». Si día y noche son distintos salen los dos (☀️/🌙); si es el
   * mismo, el nombre solo. Nace apagada.
   */
  chofer?: boolean;
  /** ⛽ Columna «Combustible (L)» para cada maquinaria en el día seleccionado. */
  combustible?: boolean;
  /** 📅 Fecha (AAAA-MM-DD) del combustible mostrado en el reporte. */
  fechaCombustible?: string;
  /** ⚙️ Columna «Estado» (solo tiene sentido con «Toda la flota»). */
  estado?: boolean;
  /** 📊 Las cuatro tarjetas de arriba (total y taras). */
  kpis?: boolean;
  /** 📝 La nota al pie que explica qué es la tara. */
  notaPie?: boolean;
  /** 🏙 Toda la flota a nombre de UNA sola empresa (solo en el papel). Vacío = cada quien la suya. */
  empresaUnica?: string;
};

export const OPCIONES_TARAS_POR_DEFECTO: OpcionesReporteTaras = {
  alcance: 'conTara',
  unidad: 'kg',
  empresa: true,
  marcaModelo: true,
  cargadaPor: true,
  numeracion: true,
  placa: true,
  clasificacion: false,
  chofer: false,
  combustible: true,
  estado: true,
  kpis: true,
  notaPie: true,
  empresaUnica: '',
};

export type EstadoTara = 'conTara' | 'sinTara' | 'exento';

export type FilaTara = {
  camion: CamionParaTara;
  estado: EstadoTara;
  taraKg: number | null;
  cargadaPor: string | null;
  cargadaEl: string | null;
  combustibleLitros?: number | null;
};

export type ResumenTaras = {
  flota: number;
  conTara: number;
  sinTara: number;
  exentos: number;
  mayorKg: number | null;
  menorKg: number | null;
  promedioKg: number | null;
};

const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

/**
 * La situación de cada camión. Un exento CON tara guardada cuenta como
 * exento: no pasa por romana, su tara está «en espera» (ver `setExentoRomana`).
 */
export function filasDeTaras(
  camiones: CamionParaTara[],
  taras: Map<string, TaraParaReporte>,
  alcance: AlcanceTaras = 'conTara',
): FilaTara[] {
  const filas = camiones.map((c): FilaTara => {
    const t = taras.get(c.id);
    const exento = t?.exentoRomana === true;
    const kg = t?.pesoTaraKg != null && isFinite(t.pesoTaraKg) && t.pesoTaraKg > 0 ? t.pesoTaraKg : null;
    const rawComb = t?.combustibleLitros ?? c.combustibleLitros;
    const comb = rawComb != null && isFinite(Number(rawComb)) && Number(rawComb) > 0 ? Number(rawComb) : null;
    const estado: EstadoTara = exento ? 'exento' : kg != null ? 'conTara' : 'sinTara';
    return {
      camion: c,
      estado,
      taraKg: kg,
      cargadaPor: kg != null ? (t?.updatedByNombre ?? null) : null,
      cargadaEl: kg != null ? (t?.updatedAt || null) : null,
      combustibleLitros: comb,
    };
  });
  const elegidas = alcance === 'conTara' ? filas.filter((f) => f.estado === 'conTara') : filas;
  // Primero las que tienen tara; dentro, por código y luego placa (el código
  // se repite en casi toda la flota: «Camion Volteo Toronto»).
  const orden: Record<EstadoTara, number> = { conTara: 0, sinTara: 1, exento: 2 };
  return elegidas.sort((a, b) =>
    orden[a.estado] - orden[b.estado]
    || cmp(a.camion.code, b.camion.code)
    || cmp(a.camion.plate ?? a.camion.serial ?? '', b.camion.plate ?? b.camion.serial ?? ''));
}

/** El resumen se calcula SIEMPRE sobre la flota entera: «40 de 63» necesita el 63. */
export function resumenTaras(camiones: CamionParaTara[], taras: Map<string, TaraParaReporte>): ResumenTaras {
  const todas = filasDeTaras(camiones, taras, 'todos');
  const pesos = todas.filter((f) => f.estado === 'conTara').map((f) => f.taraKg as number);
  return {
    flota: todas.length,
    conTara: pesos.length,
    sinTara: todas.filter((f) => f.estado === 'sinTara').length,
    exentos: todas.filter((f) => f.estado === 'exento').length,
    mayorKg: pesos.length ? Math.max(...pesos) : null,
    menorKg: pesos.length ? Math.min(...pesos) : null,
    promedioKg: pesos.length ? pesos.reduce((s, x) => s + x, 0) / pesos.length : null,
  };
}

/** Resumen de combustible sobre las filas seleccionadas (o toda la flota). */
export function resumenCombustibleTaras(
  camiones: CamionParaTara[],
  taras: Map<string, TaraParaReporte>,
  alcance: AlcanceTaras = 'conTara',
): { conCombustible: number; totalLitros: number } {
  const filas = filasDeTaras(camiones, taras, alcance);
  let conCombustible = 0;
  let totalLitros = 0;
  for (const f of filas) {
    if (f.combustibleLitros != null && f.combustibleLitros > 0) {
      conCombustible += 1;
      totalLitros += f.combustibleLitros;
    }
  }
  return { conCombustible, totalLitros: Math.round(totalLitros * 10) / 10 };
}

export function esc(t: unknown): string {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** El peso en la unidad del reporte: UN solo decimal, sea Kg o Ton, como el
 *  resto de los reportes de viajes; el ticket es el único que conserva los
 *  suyos (dos en Kg, tres en Ton), porque se firma en el CDT. */
export function pesoTexto(kg: number | null, unidad: UnidadPeso): string {
  if (kg == null) return '—';
  // ⭐ UN SOLO DECIMAL, EN LA UNIDAD QUE SEA (07-oct-2026: «redondea la cifra»
  //    → «que sea un solo decimal» → «déjale un solo decimal como el
  //    ejemplo», con el papel de otro sistema de patrón). Antes eran dos; se
  //    probó con cero el mismo día y el cliente lo devolvió.
  return unidad === 't' ? tonTexto(kg, 1) : kgTexto(kg, 1);
}

/** Cantidad de combustible en litros formateada para el papel (ej. «120 L» o «120,5 L»). */
export function litrosTexto(litros: number | null | undefined): string {
  if (litros == null || !isFinite(litros) || litros <= 0) return '—';
  const redondeado = Math.round(litros * 10) / 10;
  const esEntero = Math.abs(redondeado - Math.round(redondeado)) < 1e-6;
  const [ent, dec] = redondeado.toFixed(esEntero ? 0 : 1).split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${dec ? `${miles},${dec}` : miles} L`;
}

/** «06/10/2026» en hora de Caracas (UTC−4 fijo, sin horario de verano). */
export function fechaCaracas(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!isFinite(ms)) return '';
  const d = new Date(ms - 4 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

const ESTADO_TEXTO: Record<EstadoTara, string> = {
  conTara: 'Con tara',
  sinTara: 'Sin tara',
  exento: 'No pasa por romana',
};

export const CSS_REPORTE_TARAS = `
  .kpis{display:flex;gap:10px;margin:4px 0 14px}
  .kpi{flex:1;border:1px solid #D4DCE5;border-top:3px solid #1E3A5F;border-radius:4px;padding:10px 6px;text-align:center;background:#FAFBFD}
  .kpi .v{font-size:19px;font-weight:800;color:#1E3A5F;line-height:1.1}
  .kpi .t{margin-top:5px;font-size:8.5px;font-weight:700;color:#68757F;letter-spacing:.3px}
  table.taras{width:100%;border-collapse:collapse;font-size:10px}
  table.taras th{background:#1E3A5F;color:#fff;text-align:left;padding:6px 7px;font-size:8.5px;letter-spacing:.3px}
  table.taras td{padding:5px 7px;border:1px solid #DDE4EC}
  table.taras tbody tr:nth-child(even) td{background:#F5F8FC}
  table.taras tfoot td{background:#EDF2F7;font-weight:800;color:#1E3A5F;border-top:2px solid #1E3A5F}
  table.taras td.n,table.taras th.n{text-align:center}
  table.taras td.r,table.taras th.r{text-align:right}
  table.taras td.sin{color:#9A3412;font-weight:700}
  .nota-t{margin-top:10px;font-size:9.5px;color:#6B7280;text-transform:none}
`;

/** El cuerpo del PDF (sin membrete). */
export function cuerpoReporteTaras(
  camiones: CamionParaTara[],
  taras: Map<string, TaraParaReporte>,
  op: OpcionesReporteTaras,
): string {
  const r = resumenTaras(camiones, taras);
  const filas = filasDeTaras(camiones, taras, op.alcance);
  const rComb = resumenCombustibleTaras(camiones, taras, op.alcance);
  // Los `!== false` son por las opciones guardadas de antes del 19-oct-2026
  // (no traen las claves nuevas): sin la clave, la columna de siempre SALE.
  const verNum = op.numeracion !== false;
  const verPlaca = op.placa !== false;
  const verClasif = op.clasificacion === true;
  const verChofer = op.chofer === true;
  const verCombustible = op.combustible !== false;
  /** ☀️/🌙 solo cuando hace falta distinguir: un mismo chofer en los dos turnos va limpio. */
  const choferTexto = (c: CamionParaTara): string => {
    const d = String(c.choferDia ?? '').trim();
    const n = String(c.choferNoche ?? '').trim();
    if (!d && !n) return '—';
    if (d && n) return d === n ? d : `☀️ ${d} · 🌙 ${n}`;
    return d ? `☀️ ${d}` : `🌙 ${n}`;
  };
  const verEstado = op.alcance === 'todos' && op.estado !== false;
  const verKpis = op.kpis !== false;
  const verNota = op.notaPie !== false;
  /** 🏙 El nombre que se imprime: la empresa única (solo papel) o la de cada quien. */
  const empresaImpresa = (c: CamionParaTara) => (op.empresaUnica ?? '').trim() || c.companyName || 'Sin empresa';

  // ⭐ CUATRO TARJETAS: EL TOTAL Y LAS TARAS (07-oct-2026, a pedido: «quítame
  //    esto, solo coloca el total de camiones y los totales de las taras»).
  //    Se fueron «N de M con tara cargada», «sin tara» y «no pasan por romana»:
  //    eran el estado de la carga del dato, no el dato. Quien quiera verlo tiene
  //    la columna Estado con el alcance «flota completa».
  //
  // ⚠️ EL TOTAL ES EL DE LAS FILAS QUE SALEN, no el de la flota: la tarjeta va
  //    pegada a la lista y tiene que cuadrar con ella. Con el alcance «solo con
  //    tara» dice 39 y lista 39; con «flota completa» dice 44 y lista 44. Un
  //    total que no cuadra con lo que está debajo manda a recontar a mano.
  const kpis: [string, string][] = [
    [String(filas.length), filas.length === 1 ? 'CAMIÓN' : 'CAMIONES'],
    [pesoTexto(r.promedioKg, op.unidad), 'TARA PROMEDIO'],
    [pesoTexto(r.mayorKg, op.unidad), 'TARA MAYOR'],
    [pesoTexto(r.menorKg, op.unidad), 'TARA MENOR'],
    ...(verCombustible && rComb.totalLitros > 0 ? [[litrosTexto(rComb.totalLitros), 'TOTAL COMBUSTIBLE'] as [string, string]] : []),
  ];

  const cab = [
    verNum ? '<th class="n">N°</th>' : '',
    '<th>Equipo</th>',
    verPlaca ? '<th>Placa / serial</th>' : '',
    op.marcaModelo ? '<th>Marca / modelo</th>' : '',
    verClasif ? '<th>Clasificación</th>' : '',
    verChofer ? '<th>Chofer</th>' : '',
    op.empresa ? '<th>Empresa</th>' : '',
    `<th class="r">Tara (${op.unidad === 't' ? 'Ton' : 'Kg'})</th>`,
    verCombustible ? '<th class="r">Combustible (L)</th>' : '',
    verEstado ? '<th>Estado</th>' : '',
    op.cargadaPor ? '<th>Cargada por</th>' : '',
  ].join('');
  const nCols = [verNum, true, verPlaca, op.marcaModelo, verClasif, verChofer, op.empresa, true, verCombustible, verEstado, op.cargadaPor].filter(Boolean).length;

  const cuerpo = filas.map((f, i) => {
    const c = f.camion;
    const ident = [c.plate ? `Placa ${c.plate}` : '', c.serial ? `Serial ${c.serial}` : ''].filter(Boolean).join(' · ') || '—';
    const mm = [c.marca, c.modelo].filter(Boolean).join(' ') || '—';
    const quien = f.estado === 'conTara'
      ? [f.cargadaPor, fechaCaracas(f.cargadaEl)].filter(Boolean).join(' · ') || '—'
      : '—';
    return `<tr>
      ${verNum ? `<td class="n">${i + 1}</td>` : ''}
      <td>${esc(c.code)}</td>
      ${verPlaca ? `<td>${esc(ident)}</td>` : ''}
      ${op.marcaModelo ? `<td>${esc(mm)}</td>` : ''}
      ${verClasif ? `<td>${esc(String(c.clasificacion ?? '').trim() || '—')}</td>` : ''}
      ${verChofer ? `<td>${esc(choferTexto(c))}</td>` : ''}
      ${op.empresa ? `<td>${esc(empresaImpresa(c))}</td>` : ''}
      <td class="r${f.taraKg == null ? ' sin' : ''}">${esc(f.taraKg == null ? '—' : pesoTexto(f.taraKg, op.unidad))}</td>
      ${verCombustible ? `<td class="r${f.combustibleLitros == null ? ' sin' : ''}">${esc(litrosTexto(f.combustibleLitros))}</td>` : ''}
      ${verEstado ? `<td${f.estado === 'conTara' ? '' : ' class="sin"'}>${ESTADO_TEXTO[f.estado]}</td>` : ''}
      ${op.cargadaPor ? `<td>${esc(quien)}</td>` : ''}
    </tr>`;
  }).join('');

  const colsAntesDeCombustible = [verNum, true, verPlaca, op.marcaModelo, verClasif, verChofer, op.empresa, true].filter(Boolean).length;
  const colsDespuesDeCombustible = [verEstado, op.cargadaPor].filter(Boolean).length;
  const pieCombustible = verCombustible && rComb.totalLitros > 0 && filas.length > 0
    ? `<tfoot><tr>
        <td colspan="${colsAntesDeCombustible}" class="r">Total combustible (${rComb.conCombustible} eq.):</td>
        <td class="r">${esc(litrosTexto(rComb.totalLitros))}</td>
        ${colsDespuesDeCombustible > 0 ? `<td colspan="${colsDespuesDeCombustible}"></td>` : ''}
      </tr></tfoot>`
    : '';

  const vacio = filas.length === 0
    ? `<tr><td colspan="${nCols}" class="n">Todavía no hay camiones con tara cargada.</td></tr>`
    : '';

  return `
    ${verKpis ? `<div class="kpis">${kpis.map(([v, t]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="t">${esc(t)}</div></div>`).join('')}</div>` : ''}
    <table class="taras"><thead><tr>${cab}</tr></thead><tbody>${cuerpo}${vacio}</tbody>${pieCombustible}</table>
    ${verNota ? `<div class="nota-t">La tara es el peso del camión vacío medido en romana. Cada viaje registrado conserva la tara que tenía ese día.</div>` : ''}
  `;
}

export function subtituloReporteTaras(r: ResumenTaras, alcance: AlcanceTaras): string {
  return alcance === 'conTara'
    ? `${r.conTara} camión(es) con tara cargada de ${r.flota} en la flota`
    : `Flota completa: ${r.flota} camión(es)`;
}

/**
 * Lo cambiado respecto al papel de siempre, para el NOMBRE del archivo (igual
 * que obras/ubicaciones): lo oculto NO se dice en el papel, solo acá. Nunca
 * nombres de empresa — ni siquiera el de la empresa única.
 */
export function sufijoArchivoTaras(op: OpcionesReporteTaras): string {
  const partes: string[] = [];
  if (op.numeracion === false) partes.push('sin numeración');
  if (op.placa === false) partes.push('sin placa');
  if (!op.marcaModelo) partes.push('sin marca-modelo');
  if (op.clasificacion === true) partes.push('con clasificación');
  if (op.chofer === true) partes.push('con chofer');
  if (!op.empresa) partes.push('sin empresas');
  else if ((op.empresaUnica ?? '').trim()) partes.push('a nombre de una empresa');
  if (op.combustible === false) partes.push('sin combustible');
  if (op.alcance === 'todos' && op.estado === false) partes.push('sin estado');
  if (!op.cargadaPor) partes.push('sin cargada-por');
  if (op.kpis === false) partes.push('sin resumen');
  if (op.notaPie === false) partes.push('sin nota');
  return partes.length ? ` (${partes.join(', ')})` : '';
}

/** Nombre del archivo: dice el alcance y lo cambiado; NUNCA lleva empresa. */
export function nombreArchivoTaras(alcance: AlcanceTaras, hoyISO: string, op?: OpcionesReporteTaras): string {
  const [a, m, d] = hoyISO.split('-');
  return `Reporte de taras${alcance === 'todos' ? ' (flota completa)' : ''} ${d}-${m}-${a}${op ? sufijoArchivoTaras(op) : ''}`;
}
