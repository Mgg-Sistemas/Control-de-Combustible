// 🛠️ REPORTE PERSONALIZADO DE MAQUINARIA — librería pura (09-oct-2026).
//
// Pedido del cliente: «un reporte independiente, que reciba información pero no
// envíe; que yo le pueda cargar o quitar máquinas, colocar o quitar nombres de
// empresas, cambiar estados, modificar la fecha en la que lo saco… todo
// modificable, sin que me dañe nada en el sistema».
//
// Reglas de este papel:
// - Es un TALLER DE PAPEL: el sistema le presta los datos del catálogo como
//   punto de partida y de ahí en adelante TODO vive en la pantalla. Nada de lo
//   que se edite aquí vuelve a la base (la tarjeta no tiene ni un INSERT/UPDATE,
//   y un candado del test lo vigila).
// - Por eso las filas son PURO TEXTO: cada celda se puede escribir a mano,
//   incluso el estado y la empresa. Las sugerencias (estados del sistema,
//   empresas del catálogo) son atajos, no límites.
// - Sin imports a propósito: así la suite la prueba sola, sin React ni Supabase.
//   (Mismo patrón que informeOperativo.ts.)

/** Una fila del reporte. TODO es texto editable; vacío = la columna sale «—». */
export type FilaPersonalizada = {
  /** Clave local de la fila (id de la máquina o `manual-N`). No va al papel. */
  id: string;
  code: string;
  marca: string;
  modelo: string;
  clasificacion: string;
  serial: string;
  plate: string;
  empresa: string;
  zona: string;
  encargado: string;
  estado: string;
  horometro: string;
  peso: string;
  medidas: string;
  nota: string;
};

/** Estados sugeridos (los mismos rótulos que usa el sistema). El campo acepta
 *  cualquier texto: estas pastillas son atajos. */
export const ESTADOS_PERSONALIZADO = [
  'Operativa',
  'Averiada',
  'Parada',
  'Esperando instrucciones',
  'Retirada',
  'Inactiva',
] as const;

/** Fila en blanco para «➕ Agregar fila manual». */
export function filaVacia(id: string): FilaPersonalizada {
  return {
    id, code: '', marca: '', modelo: '', clasificacion: '', serial: '', plate: '',
    empresa: '', zona: '', encargado: '', estado: '', horometro: '', peso: '', medidas: '', nota: '',
  };
}

/** Qué se puede esconder del papel. `true` = NO sale (regla de la casa). */
export type OpcionesPersonalizado = {
  /** Cuadro de arriba con el total y el conteo por estado. */
  sinResumen: boolean;
  /** La tabla principal (por si solo se quiere el resumen). */
  sinTabla: boolean;
  /** Cuadro extra agrupado por empresa (nace apagado). */
  sinPorEmpresa: boolean;
  // Columnas de la tabla, una a una (el código siempre sale):
  sinMarcaModelo: boolean;
  sinClasificacion: boolean;
  sinSerial: boolean;
  sinPlaca: boolean;
  sinEmpresa: boolean;
  sinZona: boolean;
  sinEncargado: boolean;
  sinEstado: boolean;
  sinHorometro: boolean;
  sinPeso: boolean;
  sinMedidas: boolean;
  sinNotas: boolean;
};

/** Cómo nace el papel: lo esencial encendido, los extras apagados
 *  («lo nuevo entra apagado»). */
export const OPCIONES_PERSONALIZADO_INICIAL: OpcionesPersonalizado = {
  sinResumen: false, sinTabla: false, sinPorEmpresa: true,
  sinMarcaModelo: false, sinClasificacion: false, sinSerial: false, sinPlaca: false,
  sinEmpresa: false, sinZona: false, sinEstado: false,
  sinEncargado: true, sinHorometro: true, sinPeso: true, sinMedidas: true, sinNotas: true,
};

export const PASTILLAS_PERSONALIZADO: { key: keyof OpcionesPersonalizado; chip: string; largo: string; archivo: string }[] = [
  { key: 'sinResumen', chip: '🚫 Resumen por estado', largo: 'resumen por estado', archivo: 'sin resumen' },
  { key: 'sinTabla', chip: '🚫 Tabla de máquinas', largo: 'tabla de máquinas', archivo: 'solo resumen' },
  { key: 'sinPorEmpresa', chip: '🚫 Cuadro por empresa', largo: 'cuadro por empresa', archivo: 'con empresas' },
  { key: 'sinMarcaModelo', chip: '🚫 Marca y modelo', largo: 'marca y modelo', archivo: 'sin marca' },
  { key: 'sinClasificacion', chip: '🚫 Clasificación', largo: 'clasificación', archivo: 'sin clasificacion' },
  { key: 'sinSerial', chip: '🚫 Serial', largo: 'serial', archivo: 'sin serial' },
  { key: 'sinPlaca', chip: '🚫 Placa', largo: 'placa', archivo: 'sin placa' },
  { key: 'sinEmpresa', chip: '🚫 Empresa', largo: 'columna de empresa', archivo: 'sin empresa' },
  { key: 'sinZona', chip: '🚫 Zona/ubicación', largo: 'zona/ubicación', archivo: 'sin zona' },
  { key: 'sinEstado', chip: '🚫 Estado', largo: 'columna de estado', archivo: 'sin estado' },
  { key: 'sinEncargado', chip: '🚫 Encargado', largo: 'encargado', archivo: 'con encargado' },
  { key: 'sinHorometro', chip: '🚫 Horómetro', largo: 'horómetro', archivo: 'con horometro' },
  { key: 'sinPeso', chip: '🚫 Peso', largo: 'peso', archivo: 'con peso' },
  { key: 'sinMedidas', chip: '🚫 Medidas', largo: 'medidas', archivo: 'con medidas' },
  { key: 'sinNotas', chip: '🚫 Notas', largo: 'columna de notas', archivo: 'con notas' },
];

export function alternarPersonalizado(o: OpcionesPersonalizado, key: keyof OpcionesPersonalizado): OpcionesPersonalizado {
  return { ...o, [key]: !o[key] };
}

/** Qué se cambió respecto a cómo nace el papel, en palabras. */
export function ocultosPersonalizadoEnPalabras(o: OpcionesPersonalizado): string {
  const l = PASTILLAS_PERSONALIZADO
    .filter((p) => o[p.key] !== OPCIONES_PERSONALIZADO_INICIAL[p.key])
    .map((p) => (o[p.key] ? `sin ${p.largo}` : `con ${p.largo}`));
  return l.length === 0 ? 'Sale con las columnas de siempre.' : `Cambiado: ${l.join(', ')}.`;
}

/** Sufijo del nombre del archivo: la fecha elegida y lo que se cambió. */
export function sufijoArchivoPersonalizado(fechaISO: string, o: OpcionesPersonalizado): string {
  const partes: string[] = [dmyPersonalizado(fechaISO) || 'sin fecha'];
  PASTILLAS_PERSONALIZADO
    .filter((p) => o[p.key] !== OPCIONES_PERSONALIZADO_INICIAL[p.key])
    .forEach((p) => partes.push(p.archivo));
  return partes.join(' · ');
}

// ——— Helpers propios (la librería no importa nada) ———

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Celda del papel: texto escapado, o «—» si está vacío. */
const celda = (s: string) => {
  const t = String(s ?? '').trim();
  return t ? esc(t) : '—';
};

const MESES_PERS = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'];

/** "AAAA-MM-DD" → "DD/MM/AAAA" (vacío si no es una fecha). */
export function dmyPersonalizado(iso: string): string {
  const p = String(iso ?? '').split('-');
  return p.length === 3 && p[0].length === 4 ? `${p[2]}/${p[1]}/${p[0]}` : '';
}

/** "AAAA-MM-DD" → "09 oct. 2026" para la línea «Emitida:» del membrete.
 *  Si la fecha no sirve, devuelve '' y la tarjeta deja la fecha real. */
export function emitidaTexto(iso: string): string {
  const p = String(iso ?? '').split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n)) || p[1] < 1 || p[1] > 12) return '';
  return `${String(p[2]).padStart(2, '0')} ${MESES_PERS[p[1] - 1]} ${p[0]}`;
}

/** Conteo por estado (texto libre: agrupa por el texto tal cual, sin mayúsculas/minúsculas). */
export function resumenPersonalizado(filas: FilaPersonalizada[]): { total: number; porEstado: [string, number][] } {
  const m = new Map<string, { label: string; n: number }>();
  filas.forEach((f) => {
    const label = String(f.estado ?? '').trim() || 'Sin estado';
    const k = label.toLowerCase();
    const prev = m.get(k);
    if (prev) prev.n += 1; else m.set(k, { label, n: 1 });
  });
  const porEstado = Array.from(m.values()).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'es'))
    .map((e) => [e.label, e.n] as [string, number]);
  return { total: filas.length, porEstado };
}

export const CSS_REPORTE_PERSONALIZADO = `
  table{width:100%;border-collapse:collapse;font-size:11px;margin-top:10px}
  th{background:#1E3A5F;color:#fff;padding:6px 7px;text-align:left;font-size:10px}
  td{border-bottom:1px solid #E5E7EB;padding:5px 7px;vertical-align:top}
  td.c{text-align:center}
  td.b{font-weight:800}
  h3{color:#1E3A5F;font-size:13px;margin:18px 0 2px}
  p.n{color:#555;font-size:11px;margin:4px 0}
  .tiles{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
  .tile{border:1px solid #D7E3F4;border-radius:8px;padding:8px 14px;background:#F6F9FE}
  .tile .t{font-size:20px;font-weight:800;color:#1E3A5F}
  .tile .s{font-size:10px;color:#555}
  tr.total td{border-top:2px solid #1E3A5F;font-weight:800}
`;

export type DatosPapelPersonalizado = {
  filas: FilaPersonalizada[];
  opciones: OpcionesPersonalizado;
  /** Nota libre del encabezado (sale tal cual debajo del resumen). */
  nota?: string | null;
};

/** El cuerpo del PDF. Solo arma HTML: no lee ni escribe nada. */
export function cuerpoReportePersonalizado(d: DatosPapelPersonalizado): string {
  const o = d.opciones;
  const partes: string[] = [];

  if (!o.sinResumen) {
    const r = resumenPersonalizado(d.filas);
    const tiles = [
      `<div class="tile"><div class="t">${r.total}</div><div class="s">Máquinas en el reporte</div></div>`,
      ...r.porEstado.map(([label, n]) => `<div class="tile"><div class="t">${n}</div><div class="s">${esc(label)}</div></div>`),
    ];
    partes.push(`<div class="tiles">${tiles.join('')}</div>`);
  }

  const nota = String(d.nota ?? '').trim();
  if (nota) partes.push(`<p class="n">${esc(nota)}</p>`);

  if (!o.sinTabla) {
    const cab: string[] = ['<th>Código</th>'];
    if (!o.sinMarcaModelo) cab.push('<th>Marca / modelo</th>');
    if (!o.sinClasificacion) cab.push('<th>Clasificación</th>');
    if (!o.sinSerial) cab.push('<th>Serial</th>');
    if (!o.sinPlaca) cab.push('<th>Placa</th>');
    if (!o.sinEmpresa) cab.push('<th>Empresa</th>');
    if (!o.sinZona) cab.push('<th>Zona / ubicación</th>');
    if (!o.sinEncargado) cab.push('<th>Encargado</th>');
    if (!o.sinEstado) cab.push('<th>Estado</th>');
    if (!o.sinHorometro) cab.push('<th>Horómetro</th>');
    if (!o.sinPeso) cab.push('<th>Peso</th>');
    if (!o.sinMedidas) cab.push('<th>Medidas</th>');
    if (!o.sinNotas) cab.push('<th>Notas</th>');
    const filas = d.filas.map((f) => {
      const c: string[] = [`<td class="b">${celda(f.code)}</td>`];
      if (!o.sinMarcaModelo) c.push(`<td>${celda([f.marca, f.modelo].map((s) => String(s ?? '').trim()).filter(Boolean).join(' '))}</td>`);
      if (!o.sinClasificacion) c.push(`<td>${celda(f.clasificacion)}</td>`);
      if (!o.sinSerial) c.push(`<td>${celda(f.serial)}</td>`);
      if (!o.sinPlaca) c.push(`<td>${celda(f.plate)}</td>`);
      if (!o.sinEmpresa) c.push(`<td>${celda(f.empresa)}</td>`);
      if (!o.sinZona) c.push(`<td>${celda(f.zona)}</td>`);
      if (!o.sinEncargado) c.push(`<td>${celda(f.encargado)}</td>`);
      if (!o.sinEstado) c.push(`<td>${celda(f.estado)}</td>`);
      if (!o.sinHorometro) c.push(`<td class="c">${celda(f.horometro)}</td>`);
      if (!o.sinPeso) c.push(`<td class="c">${celda(f.peso)}</td>`);
      if (!o.sinMedidas) c.push(`<td>${celda(f.medidas)}</td>`);
      if (!o.sinNotas) c.push(`<td>${celda(f.nota)}</td>`);
      return `<tr>${c.join('')}</tr>`;
    });
    const total = `<tr class="total"><td colspan="${cab.length}">TOTAL: ${d.filas.length} máquina(s)</td></tr>`;
    partes.push(`<table><thead><tr>${cab.join('')}</tr></thead><tbody>${filas.join('')}</tbody><tfoot>${total}</tfoot></table>`);
  }

  if (!o.sinPorEmpresa) {
    const m = new Map<string, { label: string; n: number }>();
    d.filas.forEach((f) => {
      const label = String(f.empresa ?? '').trim() || 'Sin empresa';
      const k = label.toLowerCase();
      const prev = m.get(k);
      if (prev) prev.n += 1; else m.set(k, { label, n: 1 });
    });
    const filas = Array.from(m.values()).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'es'))
      .map((e) => `<tr><td>${esc(e.label)}</td><td class="c b">${e.n}</td></tr>`);
    partes.push(`<h3>Máquinas por empresa</h3><table><thead><tr><th>Empresa</th><th>Máquinas</th></tr></thead><tbody>${filas.join('')}</tbody></table>`);
  }

  return partes.join('\n');
}
