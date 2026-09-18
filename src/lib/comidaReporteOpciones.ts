// QUÉ SE OCULTA EN EL PDF DE COMIDAS (18-sep-2026).
//
// Pedido del cliente: «poder imprimirlo con monto y sin monto, con todas las
// opciones como en reportes/conteo de equipos, que a esos reportes se les puede
// quitar o colocar algo al reporte con un solo botón».
//
// Es una librería APARTE de `conteoTipoOpciones` y de `inspectorTrazaColumnas`
// aunque se parezcan, por la misma razón que ellas son distintas entre sí: son
// reportes con columnas distintas. Éste tiene comidas, montos, cédula y quién
// registró; no tiene marca, placa ni cubicaje. Compartir un solo tipo obligaría
// a llevar pastillas que no hacen nada en la mitad de los casos, y una pastilla
// que no hace nada es peor que no tenerla: se toca, no pasa nada, y se pierde la
// confianza en las demás.
//
// ⚠️ LAS PASTILLAS OCULTAN COLUMNAS Y CUADROS, NUNCA ENTREGAS. Los totales del
//    reporte NO cambian al encenderlas. Lo que sí cambia los totales son los
//    FILTROS (empresa, persona, comida, fechas), que viven en `comidaReporte.ts`
//    y salen escritos en el cuadro de alcance del papel. Son dos cosas distintas
//    a propósito: si una pastilla pudiera quitar entregas, un total sin su
//    cuadro de alcance sería un número imposible de auditar después.
//
// Sin React ni Supabase, para poder probarla de verdad
// (scripts/test-comida-reporte.mjs).

export type OpcionesComida = {
  /** Sin montos: el papel sale con las cantidades peladas, sin un solo $. */
  sinMontos: boolean;
  /** Sin el cuadro «Entregas por empresa». */
  sinEmpresas: boolean;
  /** Sin el cuadro «Entregas por persona». */
  sinPersonas: boolean;
  /** Sin el cuadro de cantidad por tiempo de comida. */
  sinComidas: boolean;
  /** Sin el listado entrega por entrega (el detalle largo). */
  sinDetalle: boolean;
  /** Sin la columna de días con entrega. */
  sinDias: boolean;
  /** Sin la cédula de cada persona. */
  sinCedula: boolean;
  /** Sin quién registró cada entrega. */
  sinQuien: boolean;
  /** Sin la hora de cada entrega. */
  sinHora: boolean;
  /** Sin las notas escritas al registrar. */
  sinNotas: boolean;
  /** Sin el cuadro de alcance del final (qué filtros se aplicaron). */
  sinAlcance: boolean;
};

/** El papel completo: no se oculta nada. Es el valor por defecto. */
export const OPCIONES_COMIDA_COMPLETO: OpcionesComida = {
  sinMontos: false,
  sinEmpresas: false,
  sinPersonas: false,
  sinComidas: false,
  sinDetalle: false,
  sinDias: false,
  sinCedula: false,
  sinQuien: false,
  sinHora: false,
  sinNotas: false,
  sinAlcance: false,
};

/**
 * El papel de siempre: lo que salía ANTES de que existieran las pastillas.
 *
 * El botón viejo «📄 Descargar reporte PDF» sacaba empresa + persona y NADA más:
 * ni montos, ni detalle entrega por entrega, ni notas. Arrancar con el papel
 * completo le cambiaría la hoja de un día para otro a quien ya la usa así, y esa
 * hoja se entrega a las empresas. Quien quiera lo demás lo enciende.
 */
export const OPCIONES_COMIDA_COMO_ANTES: OpcionesComida = {
  ...OPCIONES_COMIDA_COMPLETO,
  sinMontos: true,
  sinDetalle: true,
  sinQuien: true,
  sinHora: true,
  sinNotas: true,
};

export const PASTILLAS_COMIDA: { key: keyof OpcionesComida; chip: string; largo: string; archivo: string }[] = [
  // La que pidió el cliente por su nombre: la misma hoja, con y sin plata.
  { key: 'sinMontos', chip: '🚫 Montos ($)', largo: 'los montos en $', archivo: 'sin montos' },
  { key: 'sinEmpresas', chip: '🚫 Cuadro por empresa', largo: 'cuadro de entregas por empresa', archivo: 'sin empresas' },
  { key: 'sinPersonas', chip: '🚫 Cuadro por persona', largo: 'cuadro de entregas por persona', archivo: 'sin personas' },
  { key: 'sinComidas', chip: '🚫 Cuadro por comida', largo: 'cuadro de cantidad por comida', archivo: 'sin comidas' },
  { key: 'sinDetalle', chip: '🚫 Detalle entrega por entrega', largo: 'listado entrega por entrega', archivo: 'solo resumen' },
  { key: 'sinDias', chip: '🚫 Días', largo: 'columna de días con entrega', archivo: 'sin dias' },
  // En el nombre del archivo sin barra: "/" no se puede usar en un nombre de archivo.
  { key: 'sinCedula', chip: '🚫 Cédula', largo: 'cédula de cada persona', archivo: 'sin cedula' },
  { key: 'sinQuien', chip: '🚫 Quién registró', largo: 'quién registró cada entrega', archivo: 'sin quien' },
  { key: 'sinHora', chip: '🚫 Hora', largo: 'hora de cada entrega', archivo: 'sin hora' },
  { key: 'sinNotas', chip: '🚫 Notas', largo: 'notas escritas al registrar', archivo: 'sin notas' },
  { key: 'sinAlcance', chip: '🚫 Alcance del informe', largo: 'cuadro de alcance', archivo: 'sin alcance' },
];

export function alternarComida(o: OpcionesComida, key: keyof OpcionesComida): OpcionesComida {
  return { ...o, [key]: !o[key] };
}

export function hayAlgoOcultoComida(o: OpcionesComida): boolean {
  return PASTILLAS_COMIDA.some((p) => !!o[p.key]);
}

export function ocultosComidaLista(o: OpcionesComida): string[] {
  return PASTILLAS_COMIDA.filter((p) => !!o[p.key]).map((p) => p.largo);
}

/** Para que la pantalla diga en criollo qué va a salir ANTES de descargar. */
export function ocultosComidaEnPalabras(o: OpcionesComida): string {
  const l = ocultosComidaLista(o);
  return l.length ? `Se oculta: ${l.join(' · ')}. Los totales no cambian.` : 'Sale completo.';
}

/** Va en el NOMBRE DEL ARCHIVO: dos PDF distintos no se pueden pisar en la
 *  carpeta de descargas. */
export function sufijoArchivoComida(o: OpcionesComida): string {
  const l = PASTILLAS_COMIDA.filter((p) => !!o[p.key]).map((p) => p.archivo);
  return l.length ? ' ' + l.join(', ') : '';
}

/**
 * Si el reporte quedó SIN NADA que contar ni listar, no se emite.
 *
 * Con los cuatro cuadros apagados a la vez queda el membrete y el total pelado:
 * parece un informe y no dice nada. Es mejor decirlo antes de generarlo que
 * entregar la hoja vacía.
 */
export function comidaSinContenido(o: OpcionesComida): boolean {
  return o.sinEmpresas && o.sinPersonas && o.sinComidas && o.sinDetalle;
}

// ── LAS COLUMNAS ────────────────────────────────────────────────────────────
//
// ⚠️ El PDF arma el ENCABEZADO y CADA FILA recorriendo ESTA MISMA lista. Un
//    `<th>` sin su `<td>` corre la tabla entera y el papel sale con la cédula
//    debajo de «Almuerzo» sin que nadie lo note hasta que el cliente lo lee.

/** Columnas del cuadro por EMPRESA. Las de comida se agregan aparte, una por tipo. */
export type ColumnaEmpresa = 'n' | 'empresa' | 'comidas' | 'total' | 'monto' | 'dias';

export function columnasEmpresa(o: OpcionesComida): ColumnaEmpresa[] {
  const cols: ColumnaEmpresa[] = ['n', 'empresa', 'comidas', 'total'];
  if (!o.sinMontos) cols.push('monto');
  if (!o.sinDias) cols.push('dias');
  return cols;
}

/** Columnas del cuadro por PERSONA. */
export type ColumnaPersona = 'n' | 'persona' | 'cedula' | 'comidas' | 'total' | 'monto' | 'dias';

export function columnasPersona(o: OpcionesComida): ColumnaPersona[] {
  const cols: ColumnaPersona[] = ['n', 'persona'];
  if (!o.sinCedula) cols.push('cedula');
  cols.push('comidas', 'total');
  if (!o.sinMontos) cols.push('monto');
  if (!o.sinDias) cols.push('dias');
  return cols;
}

/** Columnas del listado ENTREGA POR ENTREGA (el detalle largo). */
export type ColumnaDetalle = 'fecha' | 'hora' | 'quienRecibe' | 'comida' | 'cantidad' | 'monto' | 'quien' | 'nota';

export function columnasDetalle(o: OpcionesComida): ColumnaDetalle[] {
  const cols: ColumnaDetalle[] = ['fecha'];
  if (!o.sinHora) cols.push('hora');
  cols.push('quienRecibe', 'comida', 'cantidad');
  if (!o.sinMontos) cols.push('monto');
  if (!o.sinQuien) cols.push('quien');
  if (!o.sinNotas) cols.push('nota');
  return cols;
}

export const TITULO_EMPRESA: Record<ColumnaEmpresa, string> = {
  n: '#',
  empresa: 'Empresa',
  comidas: 'Comidas',      // se expande a una columna por tiempo de comida
  total: 'Total',
  monto: 'Valor ($)',
  dias: 'Días',
};

export const TITULO_PERSONA: Record<ColumnaPersona, string> = {
  n: '#',
  persona: 'Persona',
  cedula: 'Cédula',
  comidas: 'Comidas',
  total: 'Total',
  monto: 'Valor ($)',
  dias: 'Días',
};

export const TITULO_DETALLE: Record<ColumnaDetalle, string> = {
  fecha: 'Día',
  hora: 'Hora',
  quienRecibe: 'Empresa / Persona',
  comida: 'Comida',
  cantidad: 'Cantidad',
  monto: 'Valor ($)',
  quien: 'Registró',
  nota: 'Nota',
};

/** Las columnas numéricas van alineadas a la derecha. */
export const NUMERICA_EMPRESA: Record<ColumnaEmpresa, boolean> = {
  n: true, empresa: false, comidas: true, total: true, monto: true, dias: true,
};
export const NUMERICA_PERSONA: Record<ColumnaPersona, boolean> = {
  n: true, persona: false, cedula: false, comidas: true, total: true, monto: true, dias: true,
};
export const NUMERICA_DETALLE: Record<ColumnaDetalle, boolean> = {
  fecha: false, hora: false, quienRecibe: false, comida: false, cantidad: true, monto: true, quien: false, nota: false,
};
