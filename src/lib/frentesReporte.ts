// ⛏️ EL PAPEL DE LOS FRENTES DEL DÍA (29-sep-2026).
//
// Pedido del cliente: «agrégame un reporte para los frentes, un PDF que me dé
// los frentes registrados para ese día» — y, explícito: «ese reporte no es
// necesario que tenga toneladas, ni nada de eso».
//
// ⭐ POR ESO ACÁ NO HAY UNA SOLA CIFRA DE OPERACIÓN: ni viajes, ni peso, ni m³.
//    Es la HOJA DE ASIGNACIÓN del día: qué camión recoge en qué frente. Quien
//    quiera cantidades tiene el reporte de la Lista completa, que agrupa por
//    frente.
//
// SEGUNDA VUELTA (29-sep-2026, mismo día): «falta que pueda quitar o colocar
// información con los checks, además de quitar y colocar los logos» y «me deben
// salir SOLO los frentes para ese día asignados». Las dos cosas viven acá:
//   · `OpcionesFrentes` — qué columnas y qué líneas lleva el papel.
//   · `LOGOS_FRENTES_POR_DEFECTO` — este reporte nace SIN membrete de logos.
//   · `sinCamiones: false` — los frentes que ese día no tienen camión NO salen.
//
// ⭐ Y LO QUE SE APAGA NO DEJA RASTRO (corregido el 29-sep-2026, a pedido: «si
//    activo o desactivo un check, no me salga esa información en el PDF»). El
//    papel sale como si ese dato no existiera: ni columna vacía, ni «(oculto)»,
//    ni una nota en el subtítulo.
//
// TODO ESTE ARCHIVO ES PURO: no toca Supabase ni React, así que
// `scripts/test-frentes-reporte.mjs` lo prueba solo.

/** Un camión asignado, tal como se imprime. */
export type CamionDelFrente = {
  code: string;
  /** Placa o serial: lo que identifica al camión en el patio. */
  placa?: string | null;
  empresa?: string | null;
  /** Marca y modelo ya juntos («VOLVO FM 440»). Columna opcional. */
  marcaModelo?: string | null;
};

export type FrenteDelDia = {
  nombre: string;
  camiones: CamionDelFrente[];
};

/**
 * 🖨️ QUÉ SALE EN LA HOJA DE FRENTES (29-sep-2026, a pedido).
 *
 * Mismo criterio que los demás reportes del sistema: el usuario decide qué
 * columnas y qué líneas lleva el papel. Y lo que se apaga NO DEJA RASTRO: la
 * hoja se imprime como si ese dato no existiera — ni celda vacía, ni nota en el
 * subtítulo (pedido del 29-sep-2026).
 */
export type OpcionesFrentes = {
  /** Columna «Nº» (el orden dentro del frente). */
  numeracion: boolean;
  /** Columna «Placa / Serial». */
  placa: boolean;
  /** Columna «Empresa». */
  empresa: boolean;
  /** Columna «Marca / Modelo» (nace apagada: es dato de taller, no de patio). */
  marcaModelo: boolean;
  /** El «N camión(es)» a la derecha del nombre del frente. */
  contador: boolean;
  /** La línea de totales de arriba («12 camión(es) · 3 de 5 frente(s)…»). */
  totales: boolean;
  /**
   * ⭐ APAGADA A PEDIDO: «me deben salir SOLO los frentes para ese día
   * asignados». Encendida vuelve a listar los frentes activos que ese día no
   * tienen ningún camión, que es útil para ver qué quedó sin asignar.
   */
  sinCamiones: boolean;
  /**
   * 🏢 UNA SOLA EMPRESA PARA TODOS (03-oct-2026, a pedido: «que todas las
   * máquinas salgan para Golden Touch, como si todas fueran de Golden, o que yo
   * pueda elegir el nombre de la empresa que va a salir toda la maquinaria»).
   * Con texto, la columna «Empresa» lleva ESE nombre en cada fila, sea de quien
   * sea el equipo. Vacío = cada uno con la suya. Solo pinta: no cambia nada en
   * el catálogo. Sin la columna de empresa no se usa.
   */
  empresaUnica?: string;
};

export const FRENTES_POR_DEFECTO: OpcionesFrentes = {
  numeracion: true,
  placa: true,
  empresa: true,
  marcaModelo: false,
  contador: true,
  totales: true,
  sinCamiones: false,
  empresaUnica: '',
};

/** El nombre que se ofrece de entrada al encender la empresa única. */
export const EMPRESA_UNICA_SUGERIDA = 'Golden Touch';

/** La empresa que se imprime para un equipo: la única si está puesta; si no, la suya. */
export function empresaImpresa(c: { empresa?: string | null }, op: Pick<OpcionesFrentes, 'empresaUnica'>): string {
  const unica = String(op.empresaUnica ?? '').replace(/\s+/g, ' ').trim();
  return unica || String(c.empresa ?? '').trim() || '—';
}

/**
 * 🏷️ LOS LOGOS DEL MEMBRETE.
 *
 * ⭐ ESTE REPORTE NACE SIN NINGUNO, y sin la marca en texto del pie: el cliente
 *    pidió quitar «Banco Central de Venezuela / SOS La Guaira» de esta hoja
 *    («guarda en memoria que ya no va»). Los interruptores quedan para poder
 *    ponerle el que haga falta; no se borró nada del código.
 */
export type LogosFrentes = { bcv: boolean; sos: boolean; golden: boolean; renace: boolean; jhenzaen: boolean };
export const LOGOS_FRENTES_POR_DEFECTO: LogosFrentes = {
  bcv: false, sos: false, golden: false, renace: false, jhenzaen: false,
};

/**
 * Agrupa las asignaciones de un día por frente, en el orden en que se imprimen:
 * los frentes alfabéticamente y, dentro, los camiones por su código.
 *
 * `frentesActivos` son los frentes que hay que listar AUNQUE no tengan camiones
 * ese día. Normalmente va vacío (ver `frentesParaReporte`).
 */
export function frentesDelDia(
  asignaciones: { frenteNombre: string; camion: CamionDelFrente }[],
  frentesActivos: string[] = [],
): FrenteDelDia[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
  const m = new Map<string, CamionDelFrente[]>();
  frentesActivos.forEach((f) => { const n = String(f ?? '').trim(); if (n) m.set(n, []); });
  (asignaciones ?? []).forEach((a) => {
    const n = String(a?.frenteNombre ?? '').trim() || 'Sin frente';
    const lista = m.get(n) ?? [];
    lista.push(a.camion);
    m.set(n, lista);
  });
  return Array.from(m, ([nombre, camiones]) => ({
    nombre,
    camiones: camiones.slice().sort((x, y) => cmp(x.code, y.code) || cmp(String(x.placa ?? ''), String(y.placa ?? ''))),
  })).sort((a, b) => cmp(a.nombre, b.nombre));
}

/**
 * ⭐ LO QUE DE VERDAD SALE EN EL PAPEL: solo los frentes ASIGNADOS ese día,
 *    salvo que se encienda `sinCamiones`. Es una función aparte para que la
 *    regla —la que el cliente pidió— se pueda probar sin abrir la pantalla.
 */
export function frentesParaReporte(
  asignaciones: { frenteNombre: string; camion: CamionDelFrente }[],
  frentesActivos: string[],
  op: OpcionesFrentes = FRENTES_POR_DEFECTO,
): FrenteDelDia[] {
  return frentesDelDia(asignaciones, op.sinCamiones ? frentesActivos : []);
}

export type TotalesFrentes = { frentes: number; frentesConCamiones: number; camiones: number };

export function totalesFrentes(grupos: FrenteDelDia[]): TotalesFrentes {
  return {
    frentes: grupos.length,
    frentesConCamiones: grupos.filter((g) => g.camiones.length > 0).length,
    camiones: grupos.reduce((a, g) => a + g.camiones.length, 0),
  };
}

// ⛔ ACÁ HUBO UNA `etiquetaOpcionesFrentes` QUE ESCRIBÍA EN EL SUBTÍTULO LO QUE
//    SE HABÍA APAGADO («… · sin placa, empresa, numeración»). SE QUITÓ el
//    29-sep-2026 a pedido del cliente: «que no salga esa información, y guarda
//    en memoria que si activo o desactivo un check, no me salga esa información
//    en el PDF».
//
//    Es la regla de la casa desde el 25-sep-2026 y va para TODOS los reportes:
//    lo oculto NO aparece en NINGUNA parte del papel — ni columna en blanco, ni
//    «(oculto)», ni en el título o el subtítulo. El papel se imprime como si ese
//    dato no existiera. NO volver a agregarla (hay un candado en
//    `scripts/test-frentes-reporte.mjs` que lo impide).

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const CSS_FRENTES = `
  .fr-tot{margin:2px 0 12px;font-size:13px;font-weight:800;color:#16324F}
  .fr-g{margin:0 0 12px;page-break-inside:avoid}
  .fr-h{font-size:13px;font-weight:800;color:#16324F;border-bottom:2px solid #16324F;
    padding-bottom:2px;margin:0 0 4px}
  .fr-h span{float:right;font-weight:700;color:#5B6B80;font-size:11px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{border:1px solid #c9d2dc;padding:4px 7px;text-align:left}
  th{background:#16324F;color:#fff}
  tr:nth-child(even) td{background:#f4f7fb}
  .fr-vacio{font-size:11px;color:#7A8797;font-style:italic;padding:3px 0}`;

/**
 * El cuerpo del PDF: un bloque por frente con la lista de sus camiones.
 * Sin una sola cantidad de operación, a propósito (ver la cabecera).
 */
/** Cómo se llama el equipo en el papel. Para viajes, «camión»; para la hoja de
 *  frentes de maquinaria (02-oct-2026), «equipo». */
export type EtiquetaEquipo = { columna: string; singular: string; plural: string; unidad: string };
export const ETIQUETA_CAMION: EtiquetaEquipo = { columna: 'Camión', singular: 'camión', plural: 'camiones', unidad: 'camión(es)' };
export const ETIQUETA_EQUIPO: EtiquetaEquipo = { columna: 'Equipo', singular: 'equipo', plural: 'equipos', unidad: 'equipo(s)' };

export function cuerpoFrentesDelDia(grupos: FrenteDelDia[], op: OpcionesFrentes = FRENTES_POR_DEFECTO, e: EtiquetaEquipo = ETIQUETA_CAMION): string {
  const t = totalesFrentes(grupos);
  if (t.frentes === 0) {
    return `<p class="fr-vacio">Ese día no hay ningún ${e.singular} asignado a un frente.</p>`;
  }
  const cabecera = op.totales
    ? `<p class="fr-tot">${t.camiones} ${e.unidad} asignados · ${t.frentesConCamiones} de ${t.frentes} frente(s) con ${e.plural}</p>`
    : '';
  const bloques = grupos.map((g) => {
    const filas = g.camiones.map((c, i) => `<tr>
      ${op.numeracion ? `<td>${i + 1}</td>` : ''}
      <td>${esc(c.code)}</td>
      ${op.placa ? `<td>${esc(c.placa || '—')}</td>` : ''}
      ${op.empresa ? `<td>${esc(empresaImpresa(c, op))}</td>` : ''}
      ${op.marcaModelo ? `<td>${esc(c.marcaModelo || '—')}</td>` : ''}
    </tr>`).join('');
    const cabeceras = `${op.numeracion ? '<th style="width:34px">Nº</th>' : ''}<th>${e.columna}</th>${op.placa ? '<th>Placa / Serial</th>' : ''}${op.empresa ? '<th>Empresa</th>' : ''}${op.marcaModelo ? '<th>Marca / Modelo</th>' : ''}`;
    const tabla = g.camiones.length
      ? `<table><thead><tr>${cabeceras}</tr></thead><tbody>${filas}</tbody></table>`
      : `<p class="fr-vacio">Sin ${e.plural} asignados este día.</p>`;
    const conteo = op.contador ? `<span>${g.camiones.length} ${e.unidad}</span>` : '';
    return `<div class="fr-g"><div class="fr-h">⛏️ ${esc(g.nombre)}${conteo}</div>${tabla}</div>`;
  }).join('');
  return cabecera + bloques;
}

/** «Frentes de trabajo 2026-09-29» — el nombre del archivo. */
export function nombreArchivoFrentes(jornadaISO: string): string {
  return `Frentes de trabajo ${String(jornadaISO ?? '').slice(0, 10)}`;
}

// ── 🕘 EL HISTORIAL (29-sep-2026, a pedido: «que haya un historial de frentes
//    de trabajo ahí mismo en ese apartado») ────────────────────────────────────

/** Un día del historial: qué frentes se usaron y con cuántos camiones. */
export type DiaHistorialFrentes = {
  jornada: string;
  camiones: number;
  frentes: { nombre: string; camiones: number }[];
};

/**
 * Agrupa las asignaciones de VARIOS días por jornada, de la más reciente a la
 * más vieja (que es como se lee un historial). Dentro de cada día, los frentes
 * van del que más camiones tuvo al que menos, y a igualdad, alfabético.
 */
export function historialFrentes(
  asignaciones: { jornada: string; frenteNombre: string; machineryId?: string | null }[],
): DiaHistorialFrentes[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
  // ⭐ SE CUENTAN CAMIONES DISTINTOS, NO FILAS (30-sep-2026). Desde que un
  //    camión puede tener VARIOS frentes el mismo día, contar filas haría que
  //    el día dijera «14 camiones» teniendo 9: uno con tres frentes sumaría
  //    tres. Dentro de cada frente igual: un camión cuenta una vez.
  //    Sin `machineryId` (datos viejos) cada fila cuenta como un camión, que es
  //    exactamente lo que valía antes.
  const dias = new Map<string, { total: Set<string>; porFrente: Map<string, Set<string>> }>();
  (asignaciones ?? []).forEach((a, i) => {
    const j = String(a?.jornada ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(j)) return;
    const n = String(a?.frenteNombre ?? '').trim() || 'Sin frente';
    const cam = String(a?.machineryId ?? '').trim() || `#${i}`; // sin id, cada fila es uno
    const d = dias.get(j) ?? { total: new Set<string>(), porFrente: new Map<string, Set<string>>() };
    d.total.add(cam);
    const set = d.porFrente.get(n) ?? new Set<string>();
    set.add(cam);
    d.porFrente.set(n, set);
    dias.set(j, d);
  });
  return Array.from(dias, ([jornada, d]) => ({
    jornada,
    camiones: d.total.size,
    frentes: Array.from(d.porFrente, ([nombre, set]) => ({ nombre, camiones: set.size }))
      .sort((a, b) => b.camiones - a.camiones || cmp(a.nombre, b.nombre)),
  })).sort((a, b) => b.jornada.localeCompare(a.jornada));
}
