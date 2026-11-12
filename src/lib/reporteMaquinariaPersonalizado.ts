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

/** Estados sugeridos (los mismos 6 cubos reales del Catálogo). El campo acepta
 *  cualquier texto: estas pastillas son atajos. */
export const ESTADOS_PERSONALIZADO = [
  'Operativa',
  'Averiada',
  'Parada',
  'Esperando instrucciones',
  'Retirada',
  'Transferido a otros',
] as const;

/** Fila en blanco para «➕ Agregar fila manual». */
export function filaVacia(id: string): FilaPersonalizada {
  return {
    id, code: '', marca: '', modelo: '', clasificacion: '', serial: '', plate: '',
    empresa: '', zona: '', encargado: '', estado: '', horometro: '', peso: '', medidas: '', nota: '',
    litros: '', cardinal: '',
  };
}

/** Cómo agrupar la tabla principal del PDF ('ninguno' = lista única en el orden del taller). */
export type AgruparPorPersonalizado = 'ninguno' | 'empresa' | 'encargado';

/** Qué se puede esconder del papel. `true` = NO sale (regla de la casa). */
export type OpcionesPersonalizado = {
  /** Cuadro de arriba con el total y el conteo por estado. */
  sinResumen: boolean;
  /** La tabla principal (por si solo se quiere el resumen). */
  sinTabla: boolean;
  /** Cuadro extra agrupado por empresa (nace apagado). */
  sinPorEmpresa: boolean;
  /** Cuadro extra agrupado por encargado (nace apagado). */
  sinPorEncargado: boolean;
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
  /** ⛽📅 Columna «Promedio por día» (03-nov-2026): los litros de la fila ÷ los días del
   *  rango elegido. Solo aplica con la columna de combustible. */
  sinPromedioDia: boolean;
  /** ⛽📅 El promedio por día del TOTAL (al pie y en el resumen): total de litros ÷ días. */
  sinTotalPromedioDia: boolean;
  /** 🧭 Columna Este / Oeste del rango (30-oct-2026). */
  sinCardinal: boolean;
};

/** Cómo nace el papel: lo esencial encendido, los extras apagados
 *  («lo nuevo entra apagado»). */
export const OPCIONES_PERSONALIZADO_INICIAL: OpcionesPersonalizado = {
  sinResumen: false, sinTabla: false, sinPorEmpresa: true, sinPorEncargado: true,
  sinMarcaModelo: false, sinClasificacion: false, sinSerial: false, sinPlaca: false,
  sinEmpresa: false, sinZona: false, sinEstado: false,
  sinEncargado: true, sinHorometro: true, sinPeso: true, sinMedidas: true, sinNotas: true,
  // Lo nuevo nace apagado: el papel de siempre no cambia hasta que se pida.
  sinConsumo: true, sinTotalConsumo: false, sinCardinal: true,
  // El promedio sale junto con la columna de combustible (que nace apagada); cada uno se oculta aparte.
  sinPromedioDia: false, sinTotalPromedioDia: false,
};

/** ⛽📅 Las opciones que llegaron DESPUÉS: un reporte guardado antes no las tenía, y
 *  reimprimirlo «como estaba» no puede sumarle columnas. Sin la llave = oculto. */
const OPCIONES_NUEVAS_OCULTAS: (keyof OpcionesPersonalizado)[] = ['sinPromedioDia', 'sinTotalPromedioDia', 'sinPorEncargado'];

export const PASTILLAS_PERSONALIZADO: { key: keyof OpcionesPersonalizado; chip: string; largo: string; archivo: string }[] = [
  { key: 'sinResumen', chip: '🚫 Resumen por estado', largo: 'resumen por estado', archivo: 'sin resumen' },
  { key: 'sinTabla', chip: '🚫 Tabla de máquinas', largo: 'tabla de máquinas', archivo: 'solo resumen' },
  { key: 'sinPorEmpresa', chip: '🚫 Cuadro por empresa', largo: 'cuadro por empresa', archivo: 'con empresas' },
  { key: 'sinPorEncargado', chip: '🚫 Cuadro por encargado', largo: 'cuadro por encargado', archivo: 'con encargados' },
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
  { key: 'sinPromedioDia', chip: '🚫 Promedio por día', largo: 'promedio de litros por día', archivo: 'sin promedio por dia' },
  { key: 'sinTotalPromedioDia', chip: '🚫 Promedio por día del total', largo: 'promedio por día del total', archivo: 'sin promedio del total' },
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

/** ⛽📅 Cuántos días tiene el rango (los dos extremos cuentan). Sin fechas válidas → 0. */
export function diasDelRangoPersonalizado(desde: string, hasta: string): number {
  const r = rangoOrdenado(desde, hasta);
  if (!r.desde) return 0;
  const a = Date.parse(`${r.desde}T12:00:00Z`), b = Date.parse(`${r.hasta}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** ⛽📅 Litros por día: lo que diga la celda ÷ los días del rango (sea cual sea el rango).
 *  Sin días o sin litros escritos → null (la celda sale «—»). */
export function promedioLitrosDia(litros: unknown, dias: number): number | null {
  if (!(dias > 0)) return null;
  const t = String(litros ?? '').trim();
  if (!t) return null;
  return Math.round((leerLitros(t) / dias) * 100) / 100;
}

/** ⛽📅 El promedio por día de un total ya sumado (número, no texto). */
export function promedioDeTotal(total: number, dias: number): number | null {
  if (!(dias > 0) || !Number.isFinite(Number(total))) return null;
  return Math.round((Number(total) / dias) * 100) / 100;
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
export function sufijoArchivoPersonalizado(
  fechaISO: string,
  o: OpcionesPersonalizado,
  agruparPor?: AgruparPorPersonalizado,
): string {
  const partes: string[] = [dmyPersonalizado(fechaISO) || 'sin fecha'];
  if (agruparPor === 'encargado') partes.push('por encargado');
  else if (agruparPor === 'empresa') partes.push('por empresa');
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

export const SIN_ENCARGADO_PERSONALIZADO = 'Sin encargado';

/** Clave canónica de encargado para agrupar/filtrar: ignora mayúsculas, tildes y espacios dobles,
 *  respetando la Ñ (PEÑA ≠ PENA), y usa el centinela '__sin_encargado__' cuando está vacío. */
export function claveEncargadoCatalogo(encargado?: string | null): string {
  const raw = String(encargado ?? '').replace(/\s+/g, ' ').trim();
  if (!raw || /^sin\s+encargado$/i.test(raw)) return '__sin_encargado__';
  return raw
    .toLowerCase()
    .replace(/ñ/g, '\u0001')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0001/g, 'ñ');
}

/** Nombre limpio de encargado (vacío → 'Sin encargado'). */
export function nombreEncargadoCatalogo(encargado?: string | null): string {
  const raw = String(encargado ?? '').replace(/\s+/g, ' ').trim();
  if (!raw || /^sin\s+encargado$/i.test(raw)) return SIN_ENCARGADO_PERSONALIZADO;
  return raw;
}

/** Clave normalizada de categoría / clasificación de maquinaria (vacía → 'Sin categoría'). */
export function nombreCategoriaCatalogo(clasificacion?: string | null): string {
  return String(clasificacion ?? '').trim() || 'Sin categoría';
}

/** Clave normalizada de estado (vacía → 'Sin estado'; 'Transferida(s) a otros' → 'Transferido a otros'). */
export function nombreEstadoCatalogo(estado?: string | null): string {
  const t = String(estado ?? '').trim();
  if (!t) return 'Sin estado';
  if (/^transferid[ao]s?\s+a\s+otros$/i.test(t)) return 'Transferido a otros';
  return t;
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

/** Lista ordenada de encargados únicos del catálogo con su cantidad de equipos.
 *  Unifica grafías equivalentes («juan perez», «Juan Pérez») bajo la grafía más frecuente
 *  y deja «Sin encargado» siempre al final. */
export function encargadosCatalogoPersonalizado(
  catalogo: FilaPersonalizada[],
  fuente: 'todos' | 'maq' | 'veh' = 'todos',
  empresasSel?: ReadonlySet<string> | readonly string[],
  categoriasSel?: ReadonlySet<string> | readonly string[],
): { nombre: string; count: number }[] {
  const empSet = empresasSel
    ? new Set(Array.from(empresasSel).map((e) => String(e).trim().toLowerCase()).filter(Boolean))
    : null;
  const catSet = categoriasSel
    ? new Set(Array.from(categoriasSel).map((c) => String(c).trim().toLowerCase()).filter(Boolean))
    : null;
  const m = new Map<string, { count: number; variantes: Map<string, number> }>();
  catalogo.forEach((f) => {
    const esVeh = String(f.id ?? '').startsWith('veh-');
    if (fuente !== 'todos' && (fuente === 'veh') !== esVeh) return;
    if (empSet && empSet.size > 0) {
      const empKey = nombreEmpresaCatalogo(f.empresa).toLowerCase();
      if (!empSet.has(empKey)) return;
    }
    if (catSet && catSet.size > 0) {
      const catKey = nombreCategoriaCatalogo(f.clasificacion).toLowerCase();
      if (!catSet.has(catKey)) return;
    }
    const visible = nombreEncargadoCatalogo(f.encargado);
    const k = claveEncargadoCatalogo(f.encargado);
    let entry = m.get(k);
    if (!entry) {
      entry = { count: 0, variantes: new Map<string, number>() };
      m.set(k, entry);
    }
    entry.count += 1;
    entry.variantes.set(visible, (entry.variantes.get(visible) ?? 0) + 1);
  });
  const out: { nombre: string; count: number }[] = [];
  m.forEach((entry, k) => {
    if (k === '__sin_encargado__') {
      out.push({ nombre: SIN_ENCARGADO_PERSONALIZADO, count: entry.count });
      return;
    }
    let mejor = '';
    let mejorN = -1;
    entry.variantes.forEach((n, vis) => {
      if (n > mejorN || (n === mejorN && vis.localeCompare(mejor, 'es') < 0)) {
        mejor = vis;
        mejorN = n;
      }
    });
    out.push({ nombre: mejor || SIN_ENCARGADO_PERSONALIZADO, count: entry.count });
  });
  return out.sort((a, b) => {
    if (a.nombre === SIN_ENCARGADO_PERSONALIZADO) return 1;
    if (b.nombre === SIN_ENCARGADO_PERSONALIZADO) return -1;
    return a.nombre.localeCompare(b.nombre, 'es');
  });
}

/** Lista ordenada de categorías (clasificaciones) del catálogo con su cantidad de equipos. */
export function categoriasCatalogoPersonalizado(
  catalogo: FilaPersonalizada[],
  fuente: 'todos' | 'maq' | 'veh' = 'todos',
  empresasSel?: ReadonlySet<string> | readonly string[],
  encargadosSel?: ReadonlySet<string> | readonly string[],
): { nombre: string; count: number }[] {
  const empSet = empresasSel
    ? new Set(Array.from(empresasSel).map((e) => String(e).trim().toLowerCase()).filter(Boolean))
    : null;
  const encSet = encargadosSel
    ? new Set(Array.from(encargadosSel).map((e) => claveEncargadoCatalogo(e)).filter(Boolean))
    : null;
  const m = new Map<string, { nombre: string; count: number }>();
  catalogo.forEach((f) => {
    const esVeh = String(f.id ?? '').startsWith('veh-');
    if (fuente !== 'todos' && (fuente === 'veh') !== esVeh) return;
    if (empSet && empSet.size > 0) {
      const empKey = nombreEmpresaCatalogo(f.empresa).toLowerCase();
      if (!empSet.has(empKey)) return;
    }
    if (encSet && encSet.size > 0) {
      const encKey = claveEncargadoCatalogo(f.encargado);
      if (!encSet.has(encKey)) return;
    }
    const nombre = nombreCategoriaCatalogo(f.clasificacion);
    const k = nombre.toLowerCase();
    const prev = m.get(k);
    if (prev) prev.count += 1;
    else m.set(k, { nombre, count: 1 });
  });
  return Array.from(m.values()).sort((a, b) => {
    if (a.nombre === 'Sin categoría') return 1;
    if (b.nombre === 'Sin categoría') return -1;
    return a.nombre.localeCompare(b.nombre, 'es');
  });
}

/** Lista ordenada de estados actuales del catálogo con su cantidad de equipos. */
export function estadosCatalogoPersonalizado(
  catalogo: FilaPersonalizada[],
  fuente: 'todos' | 'maq' | 'veh' = 'todos',
  empresasSel?: ReadonlySet<string> | readonly string[],
  categoriasSel?: ReadonlySet<string> | readonly string[],
  encargadosSel?: ReadonlySet<string> | readonly string[],
): { nombre: string; count: number }[] {
  const empSet = empresasSel
    ? new Set(Array.from(empresasSel).map((e) => String(e).trim().toLowerCase()).filter(Boolean))
    : null;
  const catSet = categoriasSel
    ? new Set(Array.from(categoriasSel).map((c) => String(c).trim().toLowerCase()).filter(Boolean))
    : null;
  const encSet = encargadosSel
    ? new Set(Array.from(encargadosSel).map((e) => claveEncargadoCatalogo(e)).filter(Boolean))
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
    if (catSet && catSet.size > 0) {
      const catKey = nombreCategoriaCatalogo(f.clasificacion).toLowerCase();
      if (!catSet.has(catKey)) return;
    }
    if (encSet && encSet.size > 0) {
      const encKey = claveEncargadoCatalogo(f.encargado);
      if (!encSet.has(encKey)) return;
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

/** Filtra el catálogo por tipo (Todos/Máquinas/Vehículos), empresas, encargados, categorías, estados actuales y búsqueda. */
export function filtrarCatalogoPersonalizado(params: {
  catalogo: FilaPersonalizada[];
  fuente?: 'todos' | 'maq' | 'veh';
  empresasSel?: ReadonlySet<string> | readonly string[];
  encargadosSel?: ReadonlySet<string> | readonly string[];
  categoriasSel?: ReadonlySet<string> | readonly string[];
  estadosSel?: ReadonlySet<string> | readonly string[];
  busca?: string;
}): FilaPersonalizada[] {
  const fuente = params.fuente ?? 'todos';
  const empSet = params.empresasSel
    ? new Set(Array.from(params.empresasSel).map((e) => String(e).trim().toLowerCase()).filter(Boolean))
    : null;
  const encSet = params.encargadosSel
    ? new Set(Array.from(params.encargadosSel).map((e) => claveEncargadoCatalogo(e)).filter(Boolean))
    : null;
  const catSet = params.categoriasSel
    ? new Set(Array.from(params.categoriasSel).map((c) => String(c).trim().toLowerCase()).filter(Boolean))
    : null;
  const estSet = params.estadosSel
    ? new Set(Array.from(params.estadosSel).map((e) => String(e).trim().toLowerCase()).filter(Boolean))
    : null;
  const q = String(params.busca ?? '')
    .replace(/ñ/gi, '\u0001')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0001/g, 'ñ')
    .toLowerCase()
    .trim();

  return (params.catalogo || []).filter((m) => {
    const esVeh = String(m.id ?? '').startsWith('veh-');
    if (fuente !== 'todos' && (fuente === 'veh') !== esVeh) return false;
    if (empSet && empSet.size > 0) {
      const empKey = nombreEmpresaCatalogo(m.empresa).toLowerCase();
      if (!empSet.has(empKey)) return false;
    }
    if (encSet && encSet.size > 0) {
      const encKey = claveEncargadoCatalogo(m.encargado);
      if (!encSet.has(encKey)) return false;
    }
    if (catSet && catSet.size > 0) {
      const catKey = nombreCategoriaCatalogo(m.clasificacion).toLowerCase();
      if (!catSet.has(catKey)) return false;
    }
    if (estSet && estSet.size > 0) {
      const estKey = nombreEstadoCatalogo(m.estado).toLowerCase();
      if (!estSet.has(estKey)) return false;
    }
    if (q) {
      const haystack = `${m.code} ${m.plate} ${m.serial} ${m.marca} ${m.modelo} ${m.clasificacion} ${m.empresa} ${m.encargado} ${m.estado}`
        .replace(/ñ/gi, '\u0001')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\u0001/g, 'ñ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Agrupa las filas del papel por Empresa o por Encargado (unificando grafías y dejando
 *  «Sin empresa» / «Sin encargado» siempre al final). Conserva el orden relativo dentro de cada grupo. */
export function agruparFilasPersonalizado(
  filas: readonly FilaPersonalizada[],
  eje: 'empresa' | 'encargado',
): { key: string; label: string; filas: FilaPersonalizada[] }[] {
  const grupos = new Map<string, { filas: FilaPersonalizada[]; variantes: Map<string, number> }>();
  (filas || []).forEach((f) => {
    const k = eje === 'encargado'
      ? claveEncargadoCatalogo(f.encargado)
      : nombreEmpresaCatalogo(f.empresa).toLowerCase();
    const vis = eje === 'encargado'
      ? nombreEncargadoCatalogo(f.encargado)
      : nombreEmpresaCatalogo(f.empresa);
    let g = grupos.get(k);
    if (!g) {
      g = { filas: [], variantes: new Map<string, number>() };
      grupos.set(k, g);
    }
    g.filas.push(f);
    g.variantes.set(vis, (g.variantes.get(vis) ?? 0) + 1);
  });
  const sinLabel = eje === 'encargado' ? SIN_ENCARGADO_PERSONALIZADO : 'Sin empresa';
  const sinKey = eje === 'encargado' ? '__sin_encargado__' : 'sin empresa';
  const out: { key: string; label: string; filas: FilaPersonalizada[] }[] = [];
  grupos.forEach((g, k) => {
    if (k === sinKey) {
      out.push({ key: k, label: sinLabel, filas: g.filas });
      return;
    }
    let mejor = '';
    let mejorN = -1;
    g.variantes.forEach((n, vis) => {
      if (n > mejorN || (n === mejorN && vis.localeCompare(mejor, 'es') < 0)) {
        mejor = vis;
        mejorN = n;
      }
    });
    out.push({ key: k, label: mejor || sinLabel, filas: g.filas });
  });
  return out.sort((a, b) => {
    if (a.key === sinKey) return 1;
    if (b.key === sinKey) return -1;
    return a.label.localeCompare(b.label, 'es');
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
  /** ⛽📅 Días del rango elegido (para el promedio por día). Sin él, el promedio no sale. */
  dias?: number;
  /** 🗂️ Cómo agrupar las máquinas en el PDF ('ninguno' por defecto = lista única). */
  agruparPor?: AgruparPorPersonalizado;
};

/** El cuerpo del PDF. Solo arma HTML: no lee ni escribe nada. */
export function cuerpoReportePersonalizado(d: DatosPapelPersonalizado): string {
  const o = d.opciones;
  const agruparPor: AgruparPorPersonalizado =
    d.agruparPor === 'empresa' || d.agruparPor === 'encargado' ? d.agruparPor : 'ninguno';
  const partes: string[] = [];
  // ⛽📅 El promedio por día: solo con la columna de combustible y con días. Una opción
  //    que no venga (reporte guardado antes) cuenta como oculta: se reimprime como estaba.
  const dias = Number(d.dias) > 0 ? Number(d.dias) : 0;
  const conPromedio = !o.sinConsumo && o.sinPromedioDia === false && dias > 0;
  const conTotalPromedio = !o.sinConsumo && o.sinTotalPromedioDia === false && dias > 0;
  const promedioTextoDeFilas = (lista: readonly FilaPersonalizada[]) =>
    `${litrosTexto(promedioDeTotal(totalLitrosPersonalizado(lista), dias)) || '0'} L/día`;
  const totalPromedioTexto = () => promedioTextoDeFilas(d.filas);

  if (!o.sinResumen) {
    const r = resumenPersonalizado(d.filas);
    const tiles = [
      `<div class="tile"><div class="t">${r.total}</div><div class="s">Equipos en el reporte</div></div>`,
      ...r.porEstado.map(([label, n]) => `<div class="tile"><div class="t">${n}</div><div class="s">${esc(label)}</div></div>`),
    ];
    if (agruparPor === 'encargado') {
      const nEnc = agruparFilasPersonalizado(d.filas, 'encargado').length;
      tiles.push(`<div class="tile"><div class="t">${nEnc}</div><div class="s">Encargado(s)</div></div>`);
    } else if (agruparPor === 'empresa') {
      const nEmp = agruparFilasPersonalizado(d.filas, 'empresa').length;
      tiles.push(`<div class="tile"><div class="t">${nEmp}</div><div class="s">Empresa(s)</div></div>`);
    }
    if (!o.sinConsumo && !o.sinTotalConsumo) {
      tiles.push(`<div class="tile"><div class="t">${esc(litrosTexto(totalLitrosPersonalizado(d.filas)) || '0')}</div><div class="s">Litros de combustible</div></div>`);
    }
    if (conTotalPromedio) {
      tiles.push(`<div class="tile"><div class="t">${esc(totalPromedioTexto())}</div><div class="s">Promedio por día (${dias} día${dias === 1 ? '' : 's'})</div></div>`);
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
    const colPromedio = conPromedio ? cab.length : -1;
    if (conPromedio) cab.push('<th>Promedio por día (L)</th>');
    if (!o.sinNotas) cab.push('<th>Notas</th>');

    const armarFilasHtml = (lista: readonly FilaPersonalizada[]) =>
      lista.map((f) => {
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
        if (conPromedio) c.push(`<td class="c">${celda(litrosTexto(promedioLitrosDia(f.litros, dias)))}</td>`);
        if (!o.sinNotas) c.push(`<td>${celda(f.nota)}</td>`);
        return `<tr>${c.join('')}</tr>`;
      });

    const armarFilaPie = (lista: readonly FilaPersonalizada[], rotuloPie: string) => {
      let total = `<tr class="total"><td colspan="${cab.length}">${rotuloPie}</td></tr>`;
      const conTotalLitros = colLitros > 0 && !o.sinTotalConsumo;
      if (conTotalLitros || (colLitros > 0 && conTotalPromedio)) {
        // El total de litros cae debajo de su columna, y el promedio del total debajo de la
        // suya (si la columna de promedio está oculta, va junto al total). El rótulo ocupa
        // las de antes.
        const enCeldaLitros = [
          conTotalLitros ? `${esc(litrosTexto(totalLitrosPersonalizado(lista)) || '0')} L` : '',
          conTotalPromedio && !conPromedio ? esc(promedioTextoDeFilas(lista)) : '',
        ].filter(Boolean).join(' · ');
        const hasta = conPromedio ? colPromedio : colLitros;
        const despues = cab.length - hasta - 1;
        total = `<tr class="total"><td colspan="${colLitros}">${rotuloPie}</td>`
          + `<td class="c">${enCeldaLitros}</td>`
          + (conPromedio ? `<td class="c">${conTotalPromedio ? esc(promedioTextoDeFilas(lista)) : ''}</td>` : '')
          + (despues > 0 ? `<td colspan="${despues}"></td>` : '') + '</tr>';
      }
      return total;
    };

    if (agruparPor === 'empresa' || agruparPor === 'encargado') {
      const grupos = agruparFilasPersonalizado(d.filas, agruparPor);
      const ico = agruparPor === 'encargado' ? '🧑‍🔧' : '🏢';
      grupos.forEach((g) => {
        const filasG = armarFilasHtml(g.filas);
        const pieG = armarFilaPie(g.filas, `Subtotal ${esc(g.label)}: ${g.filas.length} equipo(s)`);
        partes.push(`<h3>${ico} ${esc(g.label)} (${g.filas.length} equipo${g.filas.length === 1 ? '' : 's'})</h3>`);
        partes.push(`<table><thead><tr>${cab.join('')}</tr></thead><tbody>${filasG.join('')}</tbody><tfoot>${pieG}</tfoot></table>`);
      });
      const pieGeneral = armarFilaPie(d.filas, `TOTAL: ${d.filas.length} equipo(s)`);
      partes.push(`<table><tfoot>${pieGeneral}</tfoot></table>`);
    } else {
      const filas = armarFilasHtml(d.filas);
      const total = armarFilaPie(d.filas, `TOTAL: ${d.filas.length} equipo(s)`);
      partes.push(`<table><thead><tr>${cab.join('')}</tr></thead><tbody>${filas.join('')}</tbody><tfoot>${total}</tfoot></table>`);
    }
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

  if (o.sinPorEncargado === false) {
    const gruposEnc = agruparFilasPersonalizado(d.filas, 'encargado');
    const filasEnc = [...gruposEnc]
      .sort((a, b) => {
        if (a.key === '__sin_encargado__') return 1;
        if (b.key === '__sin_encargado__') return -1;
        return b.filas.length - a.filas.length || a.label.localeCompare(b.label, 'es');
      })
      .map((g) => `<tr><td>${esc(g.label)}</td><td class="c b">${g.filas.length}</td></tr>`);
    partes.push(`<h3>Equipos por encargado</h3><table><thead><tr><th>Encargado</th><th>Equipos</th></tr></thead><tbody>${filasEnc.join('')}</tbody></table>`);
  }

  return partes.join('\n');
}

// ============================================================================
// 🕒 HISTÓRICO DE REPORTES PERSONALIZADOS SACADOS — lógica 100% pura (02-nov-2026)
// ============================================================================
//
// Reglas de diseño (consenso de los 4 agentes):
// 1. CERO Base64 / CERO HTML crudo: en vez de guardar ~400 KB de logos en Base64
//    por reporte, se guarda el snapshot estructurado de las `filas` congeladas y
//    sus `opciones`, `logos` (5 booleanos), encabezados y filtros (~3-5 KB).
// 2. Opción A (🖨️ Reimprimir como estaba): reconstruye el PDF idéntico con las
//    `filas` congeladas, la `emitida` congelada y las opciones exactas de ese día.
// 3. Opción B (✏️ Reusar y modificar): devuelve todo el estado al taller de papel
//    (incluyendo filtros y celdas editadas a mano) para modificarlo y sacar otro.
// 4. Opción C (🗑️ Borrar individual o vaciar todo): soporta tombstones (`deletedIds`
//    y `clearedBefore`) para que un reporte borrado no resucite al sincronizar.

export const MAX_HISTORIAL_PERSONALIZADO = 40;
export const MAX_DELETED_HISTORIAL = 100;

export type LogosPersonalizado = {
  bcv: boolean;
  sos: boolean;
  golden: boolean;
  renace: boolean;
  jhenzaen: boolean;
};

export const LOGOS_PERSONALIZADO_INICIAL: LogosPersonalizado = {
  bcv: true,
  sos: true,
  golden: false,
  renace: false,
  jhenzaen: false,
};

export type FiltrosCatalogoPersonalizado = {
  fuente: 'todos' | 'maq' | 'veh';
  empresasSel: string[];
  encargadosSel?: string[];
  categoriasSel: string[];
  estadosSel: string[];
  busca: string;
};

export type ResumenHistorialPersonalizado = {
  /** Etiqueta autodescriptiva si el usuario no escribió un nombre propio */
  etiquetaAuto: string;
  totalEquipos: number;
  totalMaquinas: number;
  totalVehiculos: number;
  totalManuales: number;
  porEstadoTexto: string;
  empresasTexto: string;
  encargadosTexto: string;
  agruparPorTexto: string;
  categoriasTexto: string;
  rangoTexto: string;
  totalLitrosTexto: string;
  /** Vista previa de los primeros equipos SIEMPRE con Código + Placa (regla GEMINI.md) */
  previewEquipos: string;
};

export type RegistroHistorialPersonalizado = {
  id: string;
  createdAt: string;
  updatedAt: string;
  cuandoTexto: string;
  creadoPorNombre: string;
  origen: 'impresion' | 'manual';
  etiqueta: string;
  nombreArchivo: string;
  vecesReimpreso: number;
  fingerprint: string;

  // ── Snapshot congelado del papel (garantiza Reimprimir como estaba) ──
  titulo: string;
  subtitulo: string;
  subtituloPapel: string;
  nota: string;
  fechaEmision: string;
  emitida: string;
  conRango: boolean;
  desde: string;
  hasta: string;
  opciones: OpcionesPersonalizado;
  agruparPor?: AgruparPorPersonalizado;
  logos: LogosPersonalizado;
  marcaTexto: boolean;
  filas: FilaPersonalizada[];

  // ── Estado adicional del taller (para Reusar y modificar) ──
  filtros: FiltrosCatalogoPersonalizado;
  editadosManual: string[];
  manuales: number;

  // ── Resumen precalculado para identificar rápido "cuál fue que saqué" ──
  resumen: ResumenHistorialPersonalizado;
};

export type EstadoHistorialPersonalizado = {
  items: RegistroHistorialPersonalizado[];
  deletedIds: Record<string, string>;
  clearedBefore: string | null;
};

export const ESTADO_HISTORIAL_VACIO: EstadoHistorialPersonalizado = {
  items: [],
  deletedIds: {},
  clearedBefore: null,
};

/** Formatea una fecha ISO en hora de Caracas (DD/MM/AAAA · hh:mm a. m./p. m.). */
export function fechaHoraCaracasHistorial(iso?: string | null): string {
  const raw = String(iso ?? '').trim();
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    const fmt = new Intl.DateTimeFormat('es-VE', {
      timeZone: 'America/Caracas',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    return fmt.format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** Formatea la identificación de un equipo en el histórico cumpliendo regla de Código + Placa. */
export function etiquetaEquipoHistorial(f: Pick<FilaPersonalizada, 'id' | 'code' | 'plate'>): string {
  const esVeh = String(f.id ?? '').startsWith('veh-');
  const code = String(f.code ?? '').trim() || '(sin código)';
  const plate = String(f.plate ?? '').trim() || 'S/P';
  return `${esVeh ? '🚗 ' : '🚜 '}${code} · Placa: ${plate}`;
}

function cortarTextoSeguro(v: unknown, max = 300): string {
  const s = String(v ?? '').trim();
  if (s.startsWith('data:')) return '';
  return s.length > max ? s.slice(0, max) : s;
}

function clonarFilaSegura(f: FilaPersonalizada): FilaPersonalizada {
  return {
    id: cortarTextoSeguro(f?.id, 120) || 'fila',
    code: cortarTextoSeguro(f?.code, 120),
    marca: cortarTextoSeguro(f?.marca, 120),
    modelo: cortarTextoSeguro(f?.modelo, 120),
    clasificacion: cortarTextoSeguro(f?.clasificacion, 140),
    serial: cortarTextoSeguro(f?.serial, 120),
    plate: cortarTextoSeguro(f?.plate, 80),
    empresa: cortarTextoSeguro(f?.empresa, 140),
    zona: cortarTextoSeguro(f?.zona, 160),
    encargado: cortarTextoSeguro(f?.encargado, 140),
    estado: cortarTextoSeguro(f?.estado, 80),
    horometro: cortarTextoSeguro(f?.horometro, 60),
    peso: cortarTextoSeguro(f?.peso, 60),
    medidas: cortarTextoSeguro(f?.medidas, 120),
    nota: cortarTextoSeguro(f?.nota, 400),
    litros: cortarTextoSeguro(f?.litros, 60),
    cardinal: cortarTextoSeguro(f?.cardinal, 120),
  };
}

/** Calcula la huella canónica del reporte para no duplicar impresiones idénticas seguidas. */
export function huellaReportePersonalizado(params: {
  titulo: string;
  subtitulo: string;
  nota: string;
  fechaEmision: string;
  conRango: boolean;
  desde: string;
  hasta: string;
  opciones: OpcionesPersonalizado;
  agruparPor?: AgruparPorPersonalizado;
  logos: LogosPersonalizado;
  marcaTexto: boolean;
  filas: FilaPersonalizada[];
}): string {
  const payload = {
    t: cortarTextoSeguro(params.titulo, 160),
    s: cortarTextoSeguro(params.subtitulo, 200),
    n: cortarTextoSeguro(params.nota, 500),
    fe: cortarTextoSeguro(params.fechaEmision, 20),
    cr: Boolean(params.conRango),
    d: cortarTextoSeguro(params.desde, 20),
    h: cortarTextoSeguro(params.hasta, 20),
    o: { ...OPCIONES_PERSONALIZADO_INICIAL, ...(params.opciones || {}) },
    ...(params.agruparPor && params.agruparPor !== 'ninguno' ? { ag: params.agruparPor } : {}),
    l: { ...LOGOS_PERSONALIZADO_INICIAL, ...(params.logos || {}) },
    m: Boolean(params.marcaTexto),
    f: (params.filas || []).map((f) => [
      f.id, f.code, f.marca, f.modelo, f.clasificacion, f.serial, f.plate,
      f.empresa, f.zona, f.encargado, f.estado, f.horometro, f.peso,
      f.medidas, f.nota, f.litros, f.cardinal,
    ]),
  };
  return JSON.stringify(payload);
}

/** Construye el resumen autodescriptivo para saber de un vistazo qué tenía el reporte. */
export function armarResumenHistorialPersonalizado(params: {
  titulo: string;
  subtitulo: string;
  fechaEmision: string;
  conRango: boolean;
  desde: string;
  hasta: string;
  opciones: OpcionesPersonalizado;
  agruparPor?: AgruparPorPersonalizado;
  filas: FilaPersonalizada[];
  filtros?: Partial<FiltrosCatalogoPersonalizado>;
}): ResumenHistorialPersonalizado {
  const filas = Array.isArray(params.filas) ? params.filas : [];
  const o = { ...OPCIONES_PERSONALIZADO_INICIAL, ...(params.opciones || {}) };
  let totalMaquinas = 0;
  let totalVehiculos = 0;
  let totalManuales = 0;

  const porEstado = new Map<string, { label: string; n: number }>();
  const empresas = new Map<string, string>();
  const categorias = new Map<string, string>();
  const encargados = new Map<string, string>();

  filas.forEach((f) => {
    const id = String(f.id ?? '');
    if (id.startsWith('manual-')) totalManuales += 1;
    else if (id.startsWith('veh-')) totalVehiculos += 1;
    else totalMaquinas += 1;

    const est = String(f.estado ?? '').trim() || 'Sin estado';
    const estK = est.toLowerCase();
    const prevEst = porEstado.get(estK);
    if (prevEst) prevEst.n += 1;
    else porEstado.set(estK, { label: est, n: 1 });

    const emp = String(f.empresa ?? '').trim();
    if (emp && !empresas.has(emp.toLowerCase())) empresas.set(emp.toLowerCase(), emp);

    const cat = String(f.clasificacion ?? '').trim();
    if (cat && !categorias.has(cat.toLowerCase())) categorias.set(cat.toLowerCase(), cat);

    const enc = String(f.encargado ?? '').trim();
    const encK = claveEncargadoCatalogo(enc);
    if (enc && encK !== '__sin_encargado__' && !encargados.has(encK)) {
      encargados.set(encK, enc);
    }
  });

  const porEstadoTexto = Array.from(porEstado.values())
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'es'))
    .map((e) => `${e.n} ${e.label}`)
    .join(' · ') || 'Sin equipos';

  const listaEmp = (params.filtros?.empresasSel && params.filtros.empresasSel.length > 0)
    ? params.filtros.empresasSel
    : Array.from(empresas.values());
  const empresasTexto = listaEmp.length === 0
    ? 'Todas las empresas'
    : listaEmp.length <= 2
      ? listaEmp.join(', ')
      : `${listaEmp.slice(0, 2).join(', ')} (+${listaEmp.length - 2})`;

  const listaCat = (params.filtros?.categoriasSel && params.filtros.categoriasSel.length > 0)
    ? params.filtros.categoriasSel
    : Array.from(categorias.values());
  const categoriasTexto = listaCat.length === 0
    ? 'Todas las categorías'
    : listaCat.length <= 2
      ? listaCat.join(', ')
      : `${listaCat.slice(0, 2).join(', ')} (+${listaCat.length - 2})`;

  const listaEnc = (params.filtros?.encargadosSel && params.filtros.encargadosSel.length > 0)
    ? params.filtros.encargadosSel
    : Array.from(encargados.values());
  const encargadosTexto = listaEnc.length === 0
    ? 'Todos los encargados'
    : listaEnc.length <= 2
      ? listaEnc.join(', ')
      : `${listaEnc.slice(0, 2).join(', ')} (+${listaEnc.length - 2})`;

  const agruparPorTexto = params.agruparPor === 'empresa'
    ? 'Por empresa'
    : params.agruparPor === 'encargado'
      ? 'Por encargado'
      : 'Sin agrupar';

  const usaRango = Boolean(params.conRango) || usaRangoPersonalizado(o);
  const r = rangoOrdenado(params.desde, params.hasta);
  const rangoTexto = usaRango && r.desde
    ? (r.desde === r.hasta
      ? `Día ${dmyPersonalizado(r.desde)}`
      : `Del ${dmyPersonalizado(r.desde)} al ${dmyPersonalizado(r.hasta)}`)
    : (params.fechaEmision ? `Emitido ${dmyPersonalizado(params.fechaEmision)}` : 'Fecha actual');

  const totalLitros = !o.sinConsumo ? totalLitrosPersonalizado(filas) : 0;
  const totalLitrosTexto = !o.sinConsumo ? `${litrosTexto(totalLitros) || '0'} L` : '';

  const primeros = filas.slice(0, 3).map((f) => etiquetaEquipoHistorial(f));
  const previewEquipos = primeros.length === 0
    ? 'Sin equipos'
    : `${primeros.join(' · ')}${filas.length > 3 ? ` (+${filas.length - 3} más)` : ''}`;

  // Etiqueta autodescriptiva inteligente
  const partesEtiqueta: string[] = [];
  const tit = String(params.titulo ?? '').trim();
  const sub = String(params.subtitulo ?? '').trim();
  if (tit && tit.toLowerCase() !== 'reporte de maquinaria') {
    partesEtiqueta.push(tit);
  } else if (sub && sub.toLowerCase() !== 'reporte personalizado') {
    partesEtiqueta.push(sub);
  }
  if (params.filtros?.empresasSel && params.filtros.empresasSel.length > 0) {
    partesEtiqueta.push(`🏢 ${empresasTexto}`);
  }
  if (params.filtros?.encargadosSel && params.filtros.encargadosSel.length > 0) {
    partesEtiqueta.push(`🧑‍🔧 ${encargadosTexto}`);
  }
  if (params.filtros?.categoriasSel && params.filtros.categoriasSel.length > 0) {
    partesEtiqueta.push(`🔶 ${categoriasTexto}`);
  }
  if (params.agruparPor === 'empresa') {
    partesEtiqueta.push('🗂️ Por empresa');
  } else if (params.agruparPor === 'encargado') {
    partesEtiqueta.push('🗂️ Por encargado');
  }
  if (!o.sinConsumo) {
    partesEtiqueta.push(`⛽ ${totalLitrosTexto}`);
  }
  if (!o.sinCardinal) {
    partesEtiqueta.push('🧭 Este/Oeste');
  }
  partesEtiqueta.push(`${filas.length} eq.`);
  partesEtiqueta.push(rangoTexto);

  return {
    etiquetaAuto: partesEtiqueta.join(' · '),
    totalEquipos: filas.length,
    totalMaquinas,
    totalVehiculos,
    totalManuales,
    porEstadoTexto,
    empresasTexto,
    categoriasTexto,
    encargadosTexto,
    agruparPorTexto,
    rangoTexto,
    totalLitrosTexto,
    previewEquipos,
  };
}

/** Crea un registro normalizado listo para guardarse en el histórico. */
export function crearRegistroHistorialPersonalizado(params: {
  id?: string;
  createdAt?: string;
  creadoPorNombre?: string | null;
  origen?: 'impresion' | 'manual';
  etiqueta?: string;
  nombreArchivo?: string;
  titulo: string;
  subtitulo: string;
  subtituloPapel?: string;
  nota: string;
  fechaEmision: string;
  emitida?: string;
  conRango: boolean;
  desde: string;
  hasta: string;
  opciones: OpcionesPersonalizado;
  agruparPor?: AgruparPorPersonalizado;
  logos?: Partial<LogosPersonalizado>;
  marcaTexto?: boolean;
  filas: FilaPersonalizada[];
  filtros?: Partial<FiltrosCatalogoPersonalizado>;
  editadosManual?: string[];
  manuales?: number;
}): RegistroHistorialPersonalizado {
  const ahora = String(params.createdAt ?? '').trim() || new Date().toISOString();
  const id = String(params.id ?? '').trim() || `rp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const opciones: OpcionesPersonalizado = {
    ...OPCIONES_PERSONALIZADO_INICIAL,
    ...(params.opciones || {}),
  };
  for (const k of OPCIONES_NUEVAS_OCULTAS) {
    if (!params.opciones || !(k in (params.opciones as object))) (opciones as any)[k] = true;
  }
  const agruparPor: AgruparPorPersonalizado =
    params.agruparPor === 'empresa' || params.agruparPor === 'encargado'
      ? params.agruparPor
      : 'ninguno';
  const logos: LogosPersonalizado = {
    ...LOGOS_PERSONALIZADO_INICIAL,
    ...(params.logos || {}),
  };
  const marcaTexto = params.marcaTexto !== false;
  const filas = (Array.isArray(params.filas) ? params.filas : []).slice(0, 300).map(clonarFilaSegura);
  const titulo = cortarTextoSeguro(params.titulo, 160) || 'Reporte de maquinaria';
  const subtitulo = cortarTextoSeguro(params.subtitulo, 200);
  const nota = cortarTextoSeguro(params.nota, 1000);
  const fechaEmision = cortarTextoSeguro(params.fechaEmision, 20);
  const conRango = Boolean(params.conRango);
  const r = rangoOrdenado(params.desde, params.hasta);
  const desde = r.desde || cortarTextoSeguro(params.desde, 20);
  const hasta = r.hasta || cortarTextoSeguro(params.hasta, 20);

  const usaRango = conRango || usaRangoPersonalizado(opciones);
  const rangoStr = usaRango && desde
    ? (desde === hasta
      ? `Día ${dmyPersonalizado(desde)}`
      : `Del ${dmyPersonalizado(desde)} al ${dmyPersonalizado(hasta)}`)
    : '';
  const subtituloPapel = cortarTextoSeguro(
    params.subtituloPapel ?? ([subtitulo, rangoStr].filter(Boolean).join(' · ') || 'Reporte personalizado'),
    260,
  );
  const emitida = cortarTextoSeguro(params.emitida ?? (emitidaTexto(fechaEmision) || fechaHoraCaracasHistorial(ahora)), 80);
  const nombreArchivo = cortarTextoSeguro(
    params.nombreArchivo ?? `${titulo} · ${sufijoArchivoPersonalizado(fechaEmision, opciones, agruparPor)}`,
    200,
  );

  const filtros: FiltrosCatalogoPersonalizado = {
    fuente: params.filtros?.fuente === 'maq' || params.filtros?.fuente === 'veh' ? params.filtros.fuente : 'todos',
    empresasSel: Array.isArray(params.filtros?.empresasSel) ? params.filtros!.empresasSel.map((s) => cortarTextoSeguro(s, 140)).filter(Boolean) : [],
    categoriasSel: Array.isArray(params.filtros?.categoriasSel) ? params.filtros!.categoriasSel.map((s) => cortarTextoSeguro(s, 140)).filter(Boolean) : [],
    estadosSel: Array.isArray(params.filtros?.estadosSel) ? params.filtros!.estadosSel.map((s) => cortarTextoSeguro(s, 80)).filter(Boolean) : [],
    encargadosSel: Array.isArray(params.filtros?.encargadosSel) ? params.filtros!.encargadosSel.map((s) => cortarTextoSeguro(s, 140)).filter(Boolean) : [],
    busca: cortarTextoSeguro(params.filtros?.busca, 120),
  };

  const maxManualEnFilas = filas.reduce((acc, f) => {
    const m = /^manual-(\d+)$/.exec(String(f.id ?? ''));
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);
  const manuales = Math.max(Number(params.manuales) || 0, maxManualEnFilas);

  const editadosManual = Array.isArray(params.editadosManual)
    ? params.editadosManual.map((s) => cortarTextoSeguro(s, 140)).filter(Boolean)
    : [];

  const resumen = armarResumenHistorialPersonalizado({
    titulo,
    subtitulo,
    fechaEmision,
    conRango,
    desde,
    hasta,
    opciones,
    agruparPor,
    filas,
    filtros,
  });

  const fingerprint = huellaReportePersonalizado({
    titulo,
    subtitulo,
    nota,
    fechaEmision,
    conRango,
    desde,
    hasta,
    opciones,
    agruparPor,
    logos,
    marcaTexto,
    filas,
  });

  return {
    id,
    createdAt: ahora,
    updatedAt: ahora,
    cuandoTexto: fechaHoraCaracasHistorial(ahora),
    creadoPorNombre: cortarTextoSeguro(params.creadoPorNombre, 120) || 'Usuario',
    origen: params.origen === 'manual' ? 'manual' : 'impresion',
    etiqueta: cortarTextoSeguro(params.etiqueta, 140),
    nombreArchivo,
    vecesReimpreso: 0,
    fingerprint,
    titulo,
    subtitulo,
    subtituloPapel,
    nota,
    fechaEmision,
    emitida,
    conRango,
    desde,
    hasta,
    opciones,
    agruparPor,
    logos,
    marcaTexto,
    filas,
    filtros,
    editadosManual,
    manuales,
    resumen,
  };
}

/** Normaliza un objeto arbitrario leído de disco o red en un RegistroHistorialPersonalizado válido, o null si es inválido. */
export function normalizarRegistroHistorialPersonalizado(raw: any): RegistroHistorialPersonalizado | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.filas) || raw.filas.length === 0) return null;
  const reg = crearRegistroHistorialPersonalizado({
    id: raw.id,
    createdAt: raw.createdAt || raw.creadoAt,
    creadoPorNombre: raw.creadoPorNombre,
    origen: raw.origen,
    etiqueta: raw.etiqueta,
    nombreArchivo: raw.nombreArchivo,
    titulo: raw.titulo,
    subtitulo: raw.subtitulo,
    subtituloPapel: raw.subtituloPapel,
    nota: raw.nota,
    fechaEmision: raw.fechaEmision,
    emitida: raw.emitida,
    conRango: raw.conRango,
    desde: raw.desde,
    hasta: raw.hasta,
    opciones: raw.opciones,
    agruparPor: raw.agruparPor,
    logos: raw.logos,
    marcaTexto: raw.marcaTexto,
    filas: raw.filas,
    filtros: raw.filtros,
    editadosManual: raw.editadosManual,
    manuales: raw.manuales,
  });
  reg.updatedAt = cortarTextoSeguro(raw.updatedAt, 40) || reg.createdAt;
  reg.vecesReimpreso = Math.max(0, Math.floor(Number(raw.vecesReimpreso) || 0));
  return reg;
}

/** Normaliza el contenedor completo de estado del histórico. */
export function normalizarEstadoHistorialPersonalizado(raw: any): EstadoHistorialPersonalizado {
  if (!raw) return { ...ESTADO_HISTORIAL_VACIO, items: [], deletedIds: {} };
  if (Array.isArray(raw)) {
    const items = raw
      .map(normalizarRegistroHistorialPersonalizado)
      .filter((x): x is RegistroHistorialPersonalizado => x !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
      .slice(0, MAX_HISTORIAL_PERSONALIZADO);
    return { items, deletedIds: {}, clearedBefore: null };
  }
  if (typeof raw !== 'object') return { ...ESTADO_HISTORIAL_VACIO, items: [], deletedIds: {} };

  const deletedIds: Record<string, string> = {};
  if (raw.deletedIds && typeof raw.deletedIds === 'object' && !Array.isArray(raw.deletedIds)) {
    Object.entries(raw.deletedIds).forEach(([k, v]) => {
      if (k && typeof v === 'string') deletedIds[k] = v;
    });
  }
  const clearedBefore = typeof raw.clearedBefore === 'string' && raw.clearedBefore.trim()
    ? raw.clearedBefore.trim()
    : null;

  const items = (Array.isArray(raw.items) ? (raw.items as any[]) : [])
    .map(normalizarRegistroHistorialPersonalizado)
    .filter((x: RegistroHistorialPersonalizado | null): x is RegistroHistorialPersonalizado => {
      if (!x) return false;
      const stamp = x.updatedAt || x.createdAt;
      if (deletedIds[x.id] && deletedIds[x.id] >= stamp) return false;
      if (clearedBefore && stamp <= clearedBefore) return false;
      return true;
    })
    .sort((a: RegistroHistorialPersonalizado, b: RegistroHistorialPersonalizado) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, MAX_HISTORIAL_PERSONALIZADO);

  return { items, deletedIds, clearedBefore };
}

/**
 * Agrega un reporte al histórico.
 * Si el reporte más reciente tiene exactamente la misma `fingerprint` (mismas filas,
 * fechas, opciones y textos) y la misma etiqueta (o el nuevo trae una etiqueta),
 * actualiza ese registro en el tope en vez de duplicarlo.
 */
export function agregarAlHistorialPersonalizado(
  estadoActual: EstadoHistorialPersonalizado,
  nuevo: RegistroHistorialPersonalizado,
  max = MAX_HISTORIAL_PERSONALIZADO,
): EstadoHistorialPersonalizado {
  const base = normalizarEstadoHistorialPersonalizado(estadoActual);
  const tope = base.items[0];
  let lista: RegistroHistorialPersonalizado[];

  if (
    tope &&
    tope.fingerprint === nuevo.fingerprint &&
    (!tope.etiqueta || !nuevo.etiqueta || tope.etiqueta === nuevo.etiqueta)
  ) {
    const actualizado: RegistroHistorialPersonalizado = {
      ...nuevo,
      id: tope.id,
      createdAt: nuevo.createdAt,
      updatedAt: nuevo.updatedAt,
      cuandoTexto: nuevo.cuandoTexto,
      etiqueta: nuevo.etiqueta || tope.etiqueta,
      vecesReimpreso: tope.vecesReimpreso,
    };
    lista = [actualizado, ...base.items.slice(1)];
  } else {
    lista = [nuevo, ...base.items.filter((i) => i.id !== nuevo.id)];
  }

  const nextDeleted = { ...base.deletedIds };
  delete nextDeleted[nuevo.id];

  return {
    items: lista.slice(0, Math.max(1, max)),
    deletedIds: nextDeleted,
    clearedBefore: base.clearedBefore,
  };
}

/** Cambia la etiqueta personalizada de un reporte ya guardado en el histórico. */
export function renombrarEnHistorialPersonalizado(
  estadoActual: EstadoHistorialPersonalizado,
  id: string,
  nuevaEtiqueta: string,
  ahoraIso?: string,
): EstadoHistorialPersonalizado {
  const base = normalizarEstadoHistorialPersonalizado(estadoActual);
  const stamp = ahoraIso || new Date().toISOString();
  const limpia = cortarTextoSeguro(nuevaEtiqueta, 140);
  return {
    ...base,
    items: base.items.map((item) =>
      item.id === id ? { ...item, etiqueta: limpia, updatedAt: stamp } : item
    ),
  };
}

/** Incrementa el contador de reimpresiones de un reporte del histórico. */
export function marcarReimpresoEnHistorialPersonalizado(
  estadoActual: EstadoHistorialPersonalizado,
  id: string,
  ahoraIso?: string,
): EstadoHistorialPersonalizado {
  const base = normalizarEstadoHistorialPersonalizado(estadoActual);
  const stamp = ahoraIso || new Date().toISOString();
  return {
    ...base,
    items: base.items.map((item) =>
      item.id === id
        ? { ...item, vecesReimpreso: (item.vecesReimpreso || 0) + 1, updatedAt: stamp }
        : item
    ),
  };
}

/** Elimina un reporte individual del histórico y guarda su tombstone para que no resucite. */
export function quitarDelHistorialPuro(
  estadoActual: EstadoHistorialPersonalizado,
  id: string,
  ahoraIso?: string,
): EstadoHistorialPersonalizado {
  const base = normalizarEstadoHistorialPersonalizado(estadoActual);
  const stamp = ahoraIso || new Date().toISOString();
  const pares = Object.entries({ ...base.deletedIds, [id]: stamp })
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, MAX_DELETED_HISTORIAL);
  const deletedIds: Record<string, string> = {};
  pares.forEach(([k, v]) => {
    deletedIds[k] = v;
  });
  return {
    items: base.items.filter((item) => item.id !== id),
    deletedIds,
    clearedBefore: base.clearedBefore,
  };
}

/** Vacía todo el histórico y registra `clearedBefore` para sincronizar el vaciado. */
export function vaciarHistorialPuro(
  estadoActual: EstadoHistorialPersonalizado,
  ahoraIso?: string,
): EstadoHistorialPersonalizado {
  const base = normalizarEstadoHistorialPersonalizado(estadoActual);
  const stamp = ahoraIso || new Date().toISOString();
  const nextDeleted = { ...base.deletedIds };
  base.items.forEach((i) => {
    nextDeleted[i.id] = stamp;
  });
  const pares = Object.entries(nextDeleted)
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, MAX_DELETED_HISTORIAL);
  const deletedIds: Record<string, string> = {};
  pares.forEach(([k, v]) => {
    deletedIds[k] = v;
  });
  return {
    items: [],
    deletedIds,
    clearedBefore: stamp,
  };
}

/**
 * Fusiona (merge) el estado local y remoto del histórico respetando los borrados
 * individuales (`deletedIds`) y el vaciado total (`clearedBefore`).
 */
export function mergeHistorialPersonalizado(
  localRaw: any,
  remotoRaw: any,
  max = MAX_HISTORIAL_PERSONALIZADO,
): EstadoHistorialPersonalizado {
  const local = normalizarEstadoHistorialPersonalizado(localRaw);
  const remoto = normalizarEstadoHistorialPersonalizado(remotoRaw);

  const todosDeleted: Record<string, string> = { ...remoto.deletedIds };
  Object.entries(local.deletedIds).forEach(([id, ts]) => {
    if (!todosDeleted[id] || ts > todosDeleted[id]) {
      todosDeleted[id] = ts;
    }
  });
  const paresDel = Object.entries(todosDeleted)
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, MAX_DELETED_HISTORIAL);
  const deletedIds: Record<string, string> = {};
  paresDel.forEach(([k, v]) => {
    deletedIds[k] = v;
  });

  const clearedBefore =
    local.clearedBefore && remoto.clearedBefore
      ? (local.clearedBefore > remoto.clearedBefore ? local.clearedBefore : remoto.clearedBefore)
      : (local.clearedBefore || remoto.clearedBefore || null);

  const porId = new Map<string, RegistroHistorialPersonalizado>();
  [...remoto.items, ...local.items].forEach((item) => {
    const prev = porId.get(item.id);
    if (!prev) {
      porId.set(item.id, item);
      return;
    }
    const stampPrev = prev.updatedAt || prev.createdAt;
    const stampNuevo = item.updatedAt || item.createdAt;
    if (stampNuevo >= stampPrev) {
      porId.set(item.id, {
        ...item,
        vecesReimpreso: Math.max(prev.vecesReimpreso || 0, item.vecesReimpreso || 0),
        etiqueta: item.etiqueta || prev.etiqueta,
      });
    }
  });

  const items = Array.from(porId.values())
    .filter((item) => {
      const stamp = item.updatedAt || item.createdAt;
      if (deletedIds[item.id] && deletedIds[item.id] >= stamp) return false;
      if (clearedBefore && stamp <= clearedBefore) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, max));

  return { items, deletedIds, clearedBefore };
}

/**
 * Filtra las entradas del histórico por texto libre (busca en etiqueta, título,
 * subtítulo, nota, fechas, autor, empresas, categorías, estados, encargados y en el código,
 * placa, serial o encargado de cualquiera de las máquinas que salieron en ese reporte).
 */
export function filtrarHistorialPersonalizado(
  items: RegistroHistorialPersonalizado[],
  busca: string,
): RegistroHistorialPersonalizado[] {
  const q = String(busca ?? '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const camposCabecera = [
      item.etiqueta,
      item.resumen?.etiquetaAuto,
      item.titulo,
      item.subtitulo,
      item.subtituloPapel,
      item.nota,
      item.fechaEmision,
      dmyPersonalizado(item.fechaEmision),
      item.desde,
      dmyPersonalizado(item.desde),
      item.hasta,
      dmyPersonalizado(item.hasta),
      item.cuandoTexto,
      item.creadoPorNombre,
      item.resumen?.empresasTexto,
      item.resumen?.categoriasTexto,
      item.resumen?.encargadosTexto,
      item.resumen?.agruparPorTexto,
      item.resumen?.porEstadoTexto,
      ...(item.filtros?.empresasSel || []),
      ...(item.filtros?.categoriasSel || []),
      ...(item.filtros?.estadosSel || []),
      ...(item.filtros?.encargadosSel || []),
    ];
    if (camposCabecera.some((v) => String(v ?? '').toLowerCase().includes(q))) {
      return true;
    }
    return (item.filas || []).some((f) =>
      [f.code, f.plate, f.serial, f.marca, f.modelo, f.empresa, f.clasificacion, f.estado, f.zona, f.encargado, f.nota]
        .some((v) => String(v ?? '').toLowerCase().includes(q))
    );
  });
}

