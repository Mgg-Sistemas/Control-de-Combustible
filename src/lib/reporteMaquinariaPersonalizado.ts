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
  /** ⛽ Litros de combustible despachados EN EL RANGO (texto editable; lo trae
   *  el sistema al encender la columna). */
  litros: string;
  /** 🧭 Este / Oeste (con el área: «Este · Macuto»), según el rango. Editable. */
  cardinal: string;
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
    litros: '', cardinal: '',
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
  /** ⛽ Columna de consumo de combustible del rango (30-oct-2026). */
  sinConsumo: boolean;
  /** ⛽ Total de litros (al pie de la tabla y en el resumen). Solo aplica con la columna. */
  sinTotalConsumo: boolean;
  /** 🧭 Columna Este / Oeste del rango (30-oct-2026). */
  sinCardinal: boolean;
};

/** Cómo nace el papel: lo esencial encendido, los extras apagados
 *  («lo nuevo entra apagado»). */
export const OPCIONES_PERSONALIZADO_INICIAL: OpcionesPersonalizado = {
  sinResumen: false, sinTabla: false, sinPorEmpresa: true,
  sinMarcaModelo: false, sinClasificacion: false, sinSerial: false, sinPlaca: false,
  sinEmpresa: false, sinZona: false, sinEstado: false,
  sinEncargado: true, sinHorometro: true, sinPeso: true, sinMedidas: true, sinNotas: true,
  // Lo nuevo nace apagado: el papel de siempre no cambia hasta que se pida.
  sinConsumo: true, sinTotalConsumo: false, sinCardinal: true,
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
  { key: 'sinConsumo', chip: '🚫 Consumo de combustible', largo: 'consumo de combustible', archivo: 'con combustible' },
  { key: 'sinTotalConsumo', chip: '🚫 Total de litros', largo: 'total de litros', archivo: 'sin total de litros' },
  { key: 'sinCardinal', chip: '🚫 Este / Oeste', largo: 'Este / Oeste', archivo: 'con este-oeste' },
];

/** ¿Alguna columna depende del rango de fechas? Entonces el rango tiene que salir
 *  en el subtítulo: unos litros sin su período no dicen nada. */
export function usaRangoPersonalizado(o: OpcionesPersonalizado): boolean {
  return !o.sinConsumo || !o.sinCardinal;
}

// ——— ⛽ Consumo de combustible y 🧭 Este / Oeste del rango (30-oct-2026) ———
//
// Pedido: «que tome información de rango, que se traiga el consumo de combustible
// y la ubicación Este u Oeste, y poder colocarlo o quitarlo del reporte».
// - Los litros salen de los DESPACHOS (`dispatches`) con la MISMA consulta que
//   Control de Maquinaria, Supervisión e Inspecciones (`loadFuelByMachine`):
//   por `dispatch_date`, que es una FECHA sin hora — la jornada que eligió quien
//   registró el surtido. No hay corte de las 7am que aplicar: el día ya viene
//   puesto, y cortar por la hora de registro descuadraría con esas pantallas.
//   Este archivo repite la suma solo para poder probarla sin red.
// - El Este/Oeste sale de la regla del reporte 📍 Ubicaciones (`zonaCardinal`,
//   `armarUbicaciones`, en ubicacionesReporte.ts). Aquí solo se pinta.
// - Lo que el usuario corrige a mano en una celda NO se pisa al recargar.

/** "AAAA-MM-DD" válido o ''. */
const fechaOk = (v: unknown) => { const t = String(v ?? '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : ''; };

/** Rango derecho: si viene al revés, se endereza (mismo criterio que Ubicaciones). */
export function rangoOrdenado(desde: string, hasta: string): { desde: string; hasta: string } {
  const a = fechaOk(desde) || fechaOk(hasta), b = fechaOk(hasta) || a;
  return a <= b ? { desde: a, hasta: b } : { desde: b, hasta: a };
}

/** Un despacho tal como lo lee `loadFuelByMachine`. */
export type DespachoLitros = { machinery_id: string | null; liters: unknown; dispatch_date: string | null };

/** Litros por máquina dentro de [desde, hasta] (ambos incluidos), por `dispatch_date`.
 *  Es la suma de `loadFuelByMachine`, sin red. */
export function sumarLitrosPorMaquina(despachos: readonly DespachoLitros[], desde: string, hasta: string): Record<string, number> {
  const r = rangoOrdenado(desde, hasta);
  const acc: Record<string, number> = {};
  if (!r.desde) return acc;
  despachos.forEach((d) => {
    const id = String(d.machinery_id ?? '');
    const f = fechaOk(d.dispatch_date);
    if (!id || !f || f < r.desde || f > r.hasta) return;
    acc[id] = (acc[id] ?? 0) + (Number(d.liters) || 0);
  });
  return acc;
}

/** Litros en formato venezolano: «1.234,5». Sin dato → ''. */
export function litrosTexto(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const v = Math.round(Number(n) * 100) / 100;
  const [ent, dec] = Math.abs(v).toFixed(2).split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const d = dec.replace(/0+$/, '');
  return `${v < 0 ? '-' : ''}${miles}${d ? ',' + d : ''}`;
}

/** Lee lo que haya en la celda de litros (lo puso el sistema o una persona):
 *  «1.234,5», «1234.5», «1,5», «800 L». Ilegible o vacío → 0. */
export function leerLitros(texto: unknown): number {
  let t = String(texto ?? '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(t)) return 0;
  const coma = t.lastIndexOf(','), punto = t.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    // El último separador es el decimal; el otro, de miles.
    t = coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (coma >= 0) {
    t = t.slice(0, coma).replace(/,/g, '') + '.' + t.slice(coma + 1);
  } else if (punto >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, ''); // «1.234» = mil doscientos treinta y cuatro (formato venezolano)
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** Suma de la columna de litros, tal como quedó en el papel (con lo corregido a mano). */
export function totalLitrosPersonalizado(filas: readonly FilaPersonalizada[]): number {
  return Math.round(filas.reduce((a, f) => a + leerLitros(f.litros), 0) * 100) / 100;
}

/** «ESTE» + «Macuto» → «Este · Macuto». Sin cardinal → ''. */
export function cardinalTexto(cardinal: string, area?: string | null): string {
  const c = String(cardinal ?? '').trim().toUpperCase();
  const lado = c === 'ESTE' ? 'Este' : c === 'OESTE' ? 'Oeste' : '';
  if (!lado) return '';
  const a = String(area ?? '').trim();
  return a ? `${lado} · ${a}` : lado;
}

/** Lo que trae el sistema para el rango. `null` = esa fuente no está cargada (no se toca). */
export type DatosDelRango = {
  litros: Record<string, number> | null;
  cardinal: Record<string, string> | null;
};

/** Pone en la fila los datos del rango SIN pisar lo corregido a mano (`editados`
 *  guarda «id|campo»). Las filas manuales y los vehículos no tienen despachos de
 *  maquinaria: se quedan como estén. Una máquina sin surtidos en el rango sale con
 *  «0» (es un dato, no un hueco). */
export function aplicarDatosDelRango(f: FilaPersonalizada, d: DatosDelRango, editados?: ReadonlySet<string>): FilaPersonalizada {
  const id = String(f.id ?? '');
  if (!id || id.startsWith('manual-') || id.startsWith('veh-')) return f;
  let out = f;
  if (d.litros && !editados?.has(`${id}|litros`)) {
    const t = litrosTexto(d.litros[id] ?? 0);
    if (t !== out.litros) out = { ...out, litros: t };
  }
  if (d.cardinal && !editados?.has(`${id}|cardinal`)) {
    const t = d.cardinal[id] ?? '';
    if (t !== out.cardinal) out = { ...out, cardinal: t };
  }
  return out;
}

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

/** Clave normalizada de empresa (vacía → 'Sin empresa'). */
export function nombreEmpresaCatalogo(empresa?: string | null): string {
  return String(empresa ?? '').trim() || 'Sin empresa';
}

/** Clave normalizada de estado (vacía → 'Sin estado'). */
export function nombreEstadoCatalogo(estado?: string | null): string {
  return String(estado ?? '').trim() || 'Sin estado';
}

/** Lista ordenada de empresas únicas del catálogo con su cantidad de equipos. */
export function empresasCatalogoPersonalizado(
  catalogo: FilaPersonalizada[],
  fuente: 'todos' | 'maq' | 'veh' = 'todos',
): { nombre: string; count: number }[] {
  const m = new Map<string, { nombre: string; count: number }>();
  catalogo.forEach((f) => {
    const esVeh = String(f.id ?? '').startsWith('veh-');
    if (fuente !== 'todos' && (fuente === 'veh') !== esVeh) return;
    const nombre = nombreEmpresaCatalogo(f.empresa);
    const k = nombre.toLowerCase();
    const prev = m.get(k);
    if (prev) prev.count += 1;
    else m.set(k, { nombre, count: 1 });
  });
  return Array.from(m.values()).sort((a, b) => {
    if (a.nombre === 'Sin empresa') return 1;
    if (b.nombre === 'Sin empresa') return -1;
    return a.nombre.localeCompare(b.nombre, 'es');
  });
}

/** Lista ordenada de estados actuales del catálogo con su cantidad de equipos. */
export function estadosCatalogoPersonalizado(
  catalogo: FilaPersonalizada[],
  fuente: 'todos' | 'maq' | 'veh' = 'todos',
  empresasSel?: ReadonlySet<string> | readonly string[],
): { nombre: string; count: number }[] {
  const empSet = empresasSel
    ? new Set(Array.from(empresasSel).map((e) => String(e).trim().toLowerCase()))
    : null;
  const m = new Map<string, { nombre: string; count: number }>();
  // Pre-seed con los 6 estados del sistema para que siempre estén visibles aunque tengan 0
  ESTADOS_PERSONALIZADO.forEach((e) => {
    m.set(e.toLowerCase(), { nombre: e, count: 0 });
  });
  catalogo.forEach((f) => {
    const esVeh = String(f.id ?? '').startsWith('veh-');
    if (fuente !== 'todos' && (fuente === 'veh') !== esVeh) return;
    if (empSet && empSet.size > 0) {
      const empKey = nombreEmpresaCatalogo(f.empresa).toLowerCase();
      if (!empSet.has(empKey)) return;
    }
    const nombre = nombreEstadoCatalogo(f.estado);
    const k = nombre.toLowerCase();
    const prev = m.get(k);
    if (prev) prev.count += 1;
    else m.set(k, { nombre, count: 1 });
  });
  const ordenBase = new Map<string, number>(ESTADOS_PERSONALIZADO.map((e, i) => [e.toLowerCase(), i]));
  return Array.from(m.values())
    .filter((item) => item.count > 0 || ordenBase.has(item.nombre.toLowerCase()))
    .sort((a, b) => {
      const ia = ordenBase.get(a.nombre.toLowerCase()) ?? 99;
      const ib = ordenBase.get(b.nombre.toLowerCase()) ?? 99;
      if (ia !== ib) return ia - ib;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
}

/** Filtra el catálogo por tipo (Todos/Máquinas/Vehículos), empresas seleccionadas, estados actuales y búsqueda. */
export function filtrarCatalogoPersonalizado(params: {
  catalogo: FilaPersonalizada[];
  fuente?: 'todos' | 'maq' | 'veh';
  empresasSel?: ReadonlySet<string> | readonly string[];
  estadosSel?: ReadonlySet<string> | readonly string[];
  busca?: string;
}): FilaPersonalizada[] {
  const fuente = params.fuente ?? 'todos';
  const empSet = params.empresasSel
    ? new Set(Array.from(params.empresasSel).map((e) => String(e).trim().toLowerCase()).filter(Boolean))
    : null;
  const estSet = params.estadosSel
    ? new Set(Array.from(params.estadosSel).map((e) => String(e).trim().toLowerCase()).filter(Boolean))
    : null;
  const q = String(params.busca ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  return (params.catalogo || []).filter((m) => {
    const esVeh = String(m.id ?? '').startsWith('veh-');
    if (fuente !== 'todos' && (fuente === 'veh') !== esVeh) return false;
    if (empSet && empSet.size > 0) {
      const empKey = nombreEmpresaCatalogo(m.empresa).toLowerCase();
      if (!empSet.has(empKey)) return false;
    }
    if (estSet && estSet.size > 0) {
      const estKey = nombreEstadoCatalogo(m.estado).toLowerCase();
      if (!estSet.has(estKey)) return false;
    }
    if (q) {
      const haystack = `${m.code} ${m.plate} ${m.serial} ${m.marca} ${m.modelo} ${m.clasificacion} ${m.empresa} ${m.estado}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
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
      `<div class="tile"><div class="t">${r.total}</div><div class="s">Equipos en el reporte</div></div>`,
      ...r.porEstado.map(([label, n]) => `<div class="tile"><div class="t">${n}</div><div class="s">${esc(label)}</div></div>`),
    ];
    if (!o.sinConsumo && !o.sinTotalConsumo) {
      tiles.push(`<div class="tile"><div class="t">${esc(litrosTexto(totalLitrosPersonalizado(d.filas)) || '0')}</div><div class="s">Litros de combustible</div></div>`);
    }
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
    if (!o.sinCardinal) cab.push('<th>Este / Oeste</th>');
    if (!o.sinEncargado) cab.push('<th>Encargado</th>');
    if (!o.sinEstado) cab.push('<th>Estado</th>');
    if (!o.sinHorometro) cab.push('<th>Horómetro</th>');
    if (!o.sinPeso) cab.push('<th>Peso</th>');
    if (!o.sinMedidas) cab.push('<th>Medidas</th>');
    // Dónde cae la columna de litros (para poner el total justo debajo).
    const colLitros = o.sinConsumo ? -1 : cab.length;
    if (!o.sinConsumo) cab.push('<th>Combustible (L)</th>');
    if (!o.sinNotas) cab.push('<th>Notas</th>');
    const filas = d.filas.map((f) => {
      const c: string[] = [`<td class="b">${celda(f.code)}</td>`];
      if (!o.sinMarcaModelo) c.push(`<td>${celda([f.marca, f.modelo].map((s) => String(s ?? '').trim()).filter(Boolean).join(' '))}</td>`);
      if (!o.sinClasificacion) c.push(`<td>${celda(f.clasificacion)}</td>`);
      if (!o.sinSerial) c.push(`<td>${celda(f.serial)}</td>`);
      if (!o.sinPlaca) c.push(`<td>${celda(f.plate)}</td>`);
      if (!o.sinEmpresa) c.push(`<td>${celda(f.empresa)}</td>`);
      if (!o.sinZona) c.push(`<td>${celda(f.zona)}</td>`);
      if (!o.sinCardinal) c.push(`<td>${celda(f.cardinal)}</td>`);
      if (!o.sinEncargado) c.push(`<td>${celda(f.encargado)}</td>`);
      if (!o.sinEstado) c.push(`<td>${celda(f.estado)}</td>`);
      if (!o.sinHorometro) c.push(`<td class="c">${celda(f.horometro)}</td>`);
      if (!o.sinPeso) c.push(`<td class="c">${celda(f.peso)}</td>`);
      if (!o.sinMedidas) c.push(`<td>${celda(f.medidas)}</td>`);
      if (!o.sinConsumo) c.push(`<td class="c">${celda(f.litros)}</td>`);
      if (!o.sinNotas) c.push(`<td>${celda(f.nota)}</td>`);
      return `<tr>${c.join('')}</tr>`;
    });
    const rotuloTotal = `TOTAL: ${d.filas.length} equipo(s)`;
    let total = `<tr class="total"><td colspan="${cab.length}">${rotuloTotal}</td></tr>`;
    if (colLitros > 0 && !o.sinTotalConsumo) {
      // El total de litros cae debajo de su columna; el rótulo ocupa las de antes.
      const despues = cab.length - colLitros - 1;
      total = `<tr class="total"><td colspan="${colLitros}">${rotuloTotal}</td>`
        + `<td class="c">${esc(litrosTexto(totalLitrosPersonalizado(d.filas)) || '0')} L</td>`
        + (despues > 0 ? `<td colspan="${despues}"></td>` : '') + '</tr>';
    }
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
    partes.push(`<h3>Equipos por empresa</h3><table><thead><tr><th>Empresa</th><th>Equipos</th></tr></thead><tbody>${filas.join('')}</tbody></table>`);
  }

  return partes.join('\n');
}
