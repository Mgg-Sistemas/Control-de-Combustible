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
// TODO ESTE ARCHIVO ES PURO: no toca Supabase ni React, así que
// `scripts/test-frentes-reporte.mjs` lo prueba solo.

/** Un camión asignado, tal como se imprime. */
export type CamionDelFrente = {
  code: string;
  /** Placa o serial: lo que identifica al camión en el patio. */
  placa?: string | null;
  empresa?: string | null;
};

export type FrenteDelDia = {
  nombre: string;
  camiones: CamionDelFrente[];
};

/**
 * Agrupa las asignaciones de un día por frente, en el orden en que se imprimen:
 * los frentes alfabéticamente y, dentro, los camiones por su código.
 *
 * ⚠️ Los frentes ACTIVOS SIN camiones ese día también salen (con su cero): el
 *    papel sirve para ver qué quedó SIN asignar, y un frente que desaparece de
 *    la hoja se lee como «no existe» en vez de «no se le puso nadie».
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

export type TotalesFrentes = { frentes: number; frentesConCamiones: number; camiones: number };

export function totalesFrentes(grupos: FrenteDelDia[]): TotalesFrentes {
  return {
    frentes: grupos.length,
    frentesConCamiones: grupos.filter((g) => g.camiones.length > 0).length,
    camiones: grupos.reduce((a, g) => a + g.camiones.length, 0),
  };
}

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
export function cuerpoFrentesDelDia(grupos: FrenteDelDia[], conEmpresa = true): string {
  const t = totalesFrentes(grupos);
  if (t.frentes === 0) {
    return '<p class="fr-vacio">No hay frentes creados todavía.</p>';
  }
  const cabecera = `<p class="fr-tot">${t.camiones} camión(es) asignados · ${t.frentesConCamiones} de ${t.frentes} frente(s) con camiones</p>`;
  const bloques = grupos.map((g) => {
    const filas = g.camiones.map((c, i) => `<tr>
      <td>${i + 1}</td>
      <td>${esc(c.code)}</td>
      <td>${esc(c.placa || '—')}</td>
      ${conEmpresa ? `<td>${esc(c.empresa || '—')}</td>` : ''}
    </tr>`).join('');
    const tabla = g.camiones.length
      ? `<table><thead><tr><th style="width:34px">Nº</th><th>Camión</th><th>Placa / Serial</th>${conEmpresa ? '<th>Empresa</th>' : ''}</tr></thead><tbody>${filas}</tbody></table>`
      : '<p class="fr-vacio">Sin camiones asignados este día.</p>';
    return `<div class="fr-g"><div class="fr-h">⛏️ ${esc(g.nombre)}<span>${g.camiones.length} camión(es)</span></div>${tabla}</div>`;
  }).join('');
  return cabecera + bloques;
}

/** «Frentes de trabajo 2026-09-29» — el nombre del archivo. */
export function nombreArchivoFrentes(jornadaISO: string): string {
  return `Frentes de trabajo ${String(jornadaISO ?? '').slice(0, 10)}`;
}
