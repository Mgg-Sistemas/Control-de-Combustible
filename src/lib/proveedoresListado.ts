// 🖨️ LISTADO DE PROVEEDORES PARA TENERLO EN FÍSICO (03-nov-2026, a pedido:
// «poder imprimir un reporte tipo PDF… cuántas ferreterías tengo con sus números
// de teléfono y dirección, cuántas empresas que vendan desinfectantes… filtrado
// ya por rubro, nombre del proveedor, teléfono y dirección corta»).
//
// El RUBRO es la etiqueta que ya tiene cada proveedor (FERRETERIA, LIMPIEZA…).
// Un proveedor con varias etiquetas sale en cada rubro; el total los cuenta una
// vez. Sin etiqueta = «SIN RUBRO». Esto solo LEE: no cambia ningún proveedor.
//
// ⭐ SIN IMPORTS, a propósito: se prueba sola (scripts/test-proveedores-listado.mjs).

export type ProveedorListado = {
  id: string;
  name: string;
  rif?: string | null;
  phone?: string | null;
  pago_movil_phone?: string | null;
  email?: string | null;
  address?: string | null;
  tags?: string[] | null;
  active?: boolean | null;
};

export const SIN_RUBRO = 'SIN RUBRO';

export type OpcionesListadoProveedores = {
  /** Una tabla por rubro (si no, una sola tabla con la columna Rubro). */
  agrupar: boolean;
  sinResumen: boolean;
  sinRif: boolean;
  sinTelefono: boolean;
  sinDireccion: boolean;
  sinCorreo: boolean;
  /** La columna de rubros (agrupado: «también vende…»). */
  sinRubros: boolean;
  /** ✂️ La dirección recortada a una línea. */
  direccionCorta: boolean;
};

/** Lo pedido: rubro, nombre, teléfono y dirección corta. RIF y correo se piden. */
export const OPCIONES_LISTADO_PROVEEDORES_INICIAL: OpcionesListadoProveedores = {
  agrupar: true, sinResumen: false, sinRif: true, sinTelefono: false,
  sinDireccion: false, sinCorreo: true, sinRubros: false, direccionCorta: true,
};

export const LARGO_DIRECCION_CORTA = 60;

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const celda = (v: unknown) => (limpio(v) ? esc(limpio(v)) : '—');

/** Los rubros de un proveedor, en mayúscula y sin repetir. Sin etiquetas → SIN RUBRO. */
export function rubrosDe(p: ProveedorListado): string[] {
  const out: string[] = [];
  for (const t of p.tags ?? []) {
    const r = limpio(t).toUpperCase();
    if (r && !out.includes(r)) out.push(r);
  }
  return out.length ? out : [SIN_RUBRO];
}

/** El teléfono de contacto; si no hay, el de Pago Móvil (también es suyo). */
export function telefonoDe(p: ProveedorListado): string {
  return limpio(p.phone) || limpio(p.pago_movil_phone);
}

/** La dirección en una línea; si es larga, se corta en una palabra con «…». */
export function direccionCorta(dir: unknown, max = LARGO_DIRECCION_CORTA): string {
  const t = limpio(dir);
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  const esp = corte.lastIndexOf(' ');
  return `${(esp > max * 0.6 ? corte.slice(0, esp) : corte).replace(/[\s,.;:-]+$/, '')}…`;
}

/** Cuántos proveedores hay por rubro (de más a menos; empate por nombre). */
export function conteoPorRubro(provs: readonly ProveedorListado[]): { rubro: string; n: number }[] {
  const m = new Map<string, number>();
  for (const p of provs) for (const r of rubrosDe(p)) m.set(r, (m.get(r) ?? 0) + 1);
  return Array.from(m, ([rubro, n]) => ({ rubro, n }))
    .sort((a, b) => b.n - a.n || cmp(a.rubro, b.rubro));
}

/** Los que entran al papel: los de los rubros elegidos (ninguno elegido = todos). */
export function filtrarProveedores(
  provs: readonly ProveedorListado[],
  rubrosSel: readonly string[],
  busca = '',
): ProveedorListado[] {
  const sel = new Set(rubrosSel.map((r) => limpio(r).toUpperCase()).filter(Boolean));
  const q = limpio(busca).toLowerCase();
  return provs
    .filter((p) => p.active !== false)
    .filter((p) => sel.size === 0 || rubrosDe(p).some((r) => sel.has(r)))
    .filter((p) => !q || [p.name, p.rif, ...(p.tags ?? [])].some((x) => limpio(x).toLowerCase().includes(q)))
    .slice()
    .sort((a, b) => cmp(limpio(a.name), limpio(b.name)));
}

/** Los grupos del papel, en el orden del conteo (solo los rubros elegidos). */
export function gruposPorRubro(
  provs: readonly ProveedorListado[],
  rubrosSel: readonly string[],
): { rubro: string; proveedores: ProveedorListado[] }[] {
  const sel = new Set(rubrosSel.map((r) => limpio(r).toUpperCase()).filter(Boolean));
  return conteoPorRubro(provs)
    .filter((c) => sel.size === 0 || sel.has(c.rubro))
    // SIN RUBRO al final: es lo que falta clasificar.
    .sort((a, b) => Number(a.rubro === SIN_RUBRO) - Number(b.rubro === SIN_RUBRO))
    .map((c) => ({ rubro: c.rubro, proveedores: provs.filter((p) => rubrosDe(p).includes(c.rubro)) }));
}

export function subtituloListadoProveedores(rubrosSel: readonly string[]): string {
  const sel = rubrosSel.map((r) => limpio(r).toUpperCase()).filter(Boolean);
  return sel.length ? `Rubro${sel.length === 1 ? '' : 's'}: ${sel.join(' · ')}` : 'Todos los rubros';
}

/** El cuerpo del PDF (todo escapado). `provs` ya filtrados con filtrarProveedores. */
export function cuerpoListadoProveedores(d: {
  proveedores: readonly ProveedorListado[];
  rubrosSel: readonly string[];
  opciones: OpcionesListadoProveedores;
}): string {
  const o = d.opciones;
  const provs = d.proveedores;
  const partes: string[] = [];
  const grupos = gruposPorRubro(provs, d.rubrosSel);

  if (!o.sinResumen) {
    const tiles = [`<div class="tile"><div class="t">${provs.length}</div><div class="s">Proveedor${provs.length === 1 ? '' : 'es'}</div></div>`]
      .concat(grupos.map((g) => `<div class="tile"><div class="t">${g.proveedores.length}</div><div class="s">${esc(g.rubro)}</div></div>`));
    partes.push(`<div class="tiles">${tiles.join('')}</div>`);
  }

  const cab = (conRubro: boolean) => {
    const c = ['<th class="n">N°</th>', '<th>Proveedor</th>'];
    if (!o.sinRif) c.push('<th>RIF</th>');
    if (!o.sinTelefono) c.push('<th>Teléfono</th>');
    if (!o.sinDireccion) c.push('<th>Dirección</th>');
    if (!o.sinCorreo) c.push('<th>Correo</th>');
    if (conRubro) c.push(`<th>${o.agrupar ? 'También vende' : 'Rubro'}</th>`);
    return `<tr>${c.join('')}</tr>`;
  };
  const fila = (p: ProveedorListado, i: number, rubroGrupo: string | null) => {
    const c = [`<td class="n">${i + 1}</td>`, `<td class="nom">${celda(p.name)}</td>`];
    if (!o.sinRif) c.push(`<td>${celda(p.rif)}</td>`);
    if (!o.sinTelefono) c.push(`<td class="tel">${celda(telefonoDe(p))}</td>`);
    if (!o.sinDireccion) c.push(`<td>${celda(o.direccionCorta ? direccionCorta(p.address) : p.address)}</td>`);
    if (!o.sinCorreo) c.push(`<td>${celda(p.email)}</td>`);
    if (!o.sinRubros) {
      const rs = rubrosDe(p).filter((r) => r !== rubroGrupo && r !== SIN_RUBRO);
      c.push(`<td class="rub">${rs.length ? esc(rs.join(', ')) : '—'}</td>`);
    }
    return `<tr>${c.join('')}</tr>`;
  };

  if (provs.length === 0) {
    partes.push('<p class="vacio">No hay proveedores con ese filtro.</p>');
  } else if (o.agrupar) {
    for (const g of grupos) {
      partes.push(`<h3 class="rubro">🏷️ ${esc(g.rubro)} <span>· ${g.proveedores.length} proveedor${g.proveedores.length === 1 ? '' : 'es'}</span></h3>`);
      partes.push(`<table><thead>${cab(!o.sinRubros)}</thead><tbody>${g.proveedores.map((p, i) => fila(p, i, g.rubro)).join('')}</tbody></table>`);
    }
    if (grupos.length > 1 && grupos.reduce((a, g) => a + g.proveedores.length, 0) > provs.length) {
      partes.push('<p class="nota">Un proveedor con varios rubros sale en cada uno; el total de arriba lo cuenta una sola vez.</p>');
    }
  } else {
    partes.push(`<table><thead>${cab(!o.sinRubros)}</thead><tbody>${provs.map((p, i) => fila(p, i, null)).join('')}</tbody></table>`);
  }
  return partes.join('\n');
}

/** Lo que cambia el papel va al nombre del archivo, no al papel (regla de la casa). */
export function nombreArchivoListadoProveedores(rubrosSel: readonly string[], fechaDmy: string): string {
  const sel = rubrosSel.map((r) => limpio(r).toUpperCase()).filter(Boolean);
  const rub = sel.length === 0 ? 'todos' : sel.length <= 3 ? sel.join(', ') : `${sel.length} rubros`;
  return `Proveedores (${rub}) ${fechaDmy}`.replace(/[\\/:*?"<>|]/g, '-');
}

export const CSS_LISTADO_PROVEEDORES = `
  .tiles{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px}
  .tile{border:1px solid #cbd5e1;border-radius:6px;padding:4px 8px;min-width:70px;text-align:center}
  .tile .t{font-size:15px;font-weight:800;color:#0f172a}
  .tile .s{font-size:9px;color:#475569;text-transform:uppercase}
  h3.rubro{font-size:13px;margin:12px 0 4px;color:#0f172a;border-bottom:2px solid #1e3a5f;padding-bottom:2px;break-after:avoid;page-break-after:avoid}
  h3.rubro span{font-weight:600;color:#475569;font-size:11px}
  table{width:100%;border-collapse:collapse;font-size:10.5px}
  th{background:#1e3a5f;color:#fff;text-align:left;padding:4px 5px;font-size:10px}
  td{border-bottom:1px solid #e2e8f0;padding:4px 5px;vertical-align:top}
  tr{break-inside:avoid;page-break-inside:avoid}
  td.n,th.n{width:22px;text-align:center;color:#64748b}
  td.nom{font-weight:700;text-transform:uppercase}
  td{overflow-wrap:anywhere}
  td.tel{white-space:nowrap}
  td.rub{color:#475569;font-size:9.5px}
  p.nota,p.vacio{font-size:10px;color:#475569;margin-top:8px}
`;
