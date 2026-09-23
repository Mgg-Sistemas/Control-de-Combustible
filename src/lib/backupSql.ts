// RESPALDO EN .SQL — cómo se escribe cada valor (23-sep-2026).
//
// Pedido del cliente: «ese backup que sea en .SQL, me generó un .json».
//
// Un .json solo se puede leer; un .sql se puede VOLVER A METER en la base, que es
// para lo que sirve un respaldo. Este archivo arma el texto y no habla con nadie:
// sin React ni Supabase, para poder probarlo entero.
// Prueba: scripts/test-backup-sql.mjs
//
// ⚠️ ESCAPAR MAL UNA COMILLA ARRUINA EL RESPALDO ENTERO. Un nombre como
//    «ATLANTA´S CENTRO FERRETERO» o una nota con un apóstrofo cierran la cadena
//    antes de tiempo y, al restaurar, PostgreSQL se pierde a mitad del archivo. Por
//    eso el escapado vive acá, en una función probada, y no repartido por la app.

/** Las tablas `backup_*` y `bkp_*` son respaldos manuales viejos dentro de la
 *  propia base: respaldarlas otra vez es respaldar un respaldo. */
export const esTablaDeRespaldoViejo = (t: string): boolean => /^(backup|bkp)[_-]/i.test(String(t ?? ''));

/**
 * `audit_log` queda fuera: son 115 mil filas y 181 MB de BITÁCORA, no de datos del
 * negocio. Meterla haría un archivo que el navegador no puede armar, y sin ella el
 * respaldo sigue teniendo todo lo que hace falta para volver a levantar el sistema.
 */
export const TABLAS_EXCLUIDAS = ['audit_log'];

export const seRespalda = (t: string): boolean =>
  !!t && !TABLAS_EXCLUIDAS.includes(t) && !esTablaDeRespaldoViejo(t);

/** Un identificador entre comillas dobles: así un nombre raro no rompe el SQL. */
export const ident = (v: string): string => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * Un valor, escrito como literal de PostgreSQL.
 *
 * ⚠️ Las comillas simples se DUPLICAN (''), que es como las escapa el estándar.
 *    Con `standard_conforming_strings` en on —el de siempre desde PostgreSQL 9— la
 *    barra invertida es un carácter normal y no hay que tocarla.
 */
export function valorSql(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  // jsonb / arreglos / objetos: van como texto JSON y se convierten al insertar.
  // El `::jsonb` es lo que hace que una columna jsonb lo acepte sin pelear.
  if (Array.isArray(v) || typeof v === 'object') {
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Las columnas de una tabla, sacadas de sus filas (la primera puede traer nulls). */
export function columnasDe(filas: any[] | null | undefined): string[] {
  const cols: string[] = [];
  const vistas = new Set<string>();
  (filas ?? []).forEach((f) => {
    if (!f || typeof f !== 'object') return;
    Object.keys(f).forEach((k) => { if (!vistas.has(k)) { vistas.add(k); cols.push(k); } });
  });
  return cols;
}

/** Cuántas filas van en cada INSERT. Lotes: un INSERT por fila hace un archivo
 *  enorme, y uno solo con 17 mil filas es una línea que ningún editor abre. */
export const FILAS_POR_INSERT = 200;

/**
 * El bloque SQL de UNA tabla. Vacía, solo deja constancia: que una tabla esté
 * vacía es un dato, y borrarla del archivo haría dudar de si se respaldó o no.
 */
export function insertsDeTabla(tabla: string, filas: any[] | null | undefined): string {
  const rows = (filas ?? []).filter((f) => f && typeof f === 'object');
  if (!rows.length) return `-- ${tabla}: sin filas\n`;
  const cols = columnasDe(rows);
  if (!cols.length) return `-- ${tabla}: sin columnas legibles\n`;
  const lista = cols.map(ident).join(', ');
  const partes: string[] = [`-- ${tabla}: ${rows.length} fila(s)`];
  for (let i = 0; i < rows.length; i += FILAS_POR_INSERT) {
    const lote = rows.slice(i, i + FILAS_POR_INSERT)
      .map((f) => `  (${cols.map((c) => valorSql(f[c])).join(', ')})`)
      .join(',\n');
    // ⭐ `on conflict do nothing`: restaurar dos veces no revienta ni duplica. Un
    //    respaldo que solo sirve sobre una base vacía sirve para la mitad de los
    //    casos en los que de verdad se usa.
    partes.push(`insert into public.${ident(tabla)} (${lista}) values\n${lote}\non conflict do nothing;`);
  }
  return partes.join('\n') + '\n';
}

export type TablaRespaldada = { tabla: string; filas: number; error?: string };

/** La cabecera del archivo: qué es, de cuándo, y —sobre todo— qué NO trae. */
export function cabeceraSql(resumen: TablaRespaldada[], generadoEn: string): string {
  const okey = resumen.filter((r) => !r.error);
  const malas = resumen.filter((r) => r.error);
  const filas = okey.reduce((a, r) => a + r.filas, 0);
  const l: string[] = [
    '-- ============================================================================',
    '-- RESPALDO · SOS LA GUAIRA · Control de Combustible',
    `-- Generado: ${generadoEn}`,
    `-- Tablas respaldadas: ${okey.length} · Filas: ${filas}`,
    '--',
    '-- CÓMO SE RESTAURA: pegarlo en Supabase → SQL Editor y darle RUN. Cada INSERT',
    '-- lleva «on conflict do nothing», así que correrlo sobre una base que ya tiene',
    '-- datos no duplica ni revienta: solo mete lo que falta.',
    '--',
    '-- ⚠️ QUÉ NO TRAE: solo DATOS. No trae el esquema (tablas, índices, funciones,',
    '--    triggers ni políticas RLS): eso vive en los archivos de supabase/. Tampoco',
    `--    trae la bitácora «audit_log» (son más de 100 mil filas de auditoría, no de`,
    '--    datos del negocio) ni las tablas «backup_*» y «bkp_*», que ya son respaldos',
    '--    viejos guardados dentro de la propia base.',
  ];
  // ⭐ Las tablas que fallaron van ARRIBA y con nombre. Un respaldo incompleto que
  //    parece completo es peor que uno que falla: nadie lo revisa hasta que hace
  //    falta restaurarlo, y para entonces ya no hay a quién preguntarle.
  if (malas.length) {
    l.push('--');
    l.push(`-- ❌❌ ATENCIÓN: ${malas.length} TABLA(S) NO SE PUDIERON RESPALDAR.`);
    l.push('--    ESTE RESPALDO ESTÁ INCOMPLETO. Vuelve a generarlo antes de confiar en él:');
    malas.forEach((r) => l.push(`--      · ${r.tabla} → ${r.error}`));
  }
  l.push('-- ============================================================================');
  l.push('');
  l.push('begin;');
  l.push('');
  return l.join('\n');
}

export const pieSql = (): string => '\ncommit;\n';

/** El nombre del archivo: `respaldo-soslaguaira-2026-09-23-14-05-11.sql`. */
export function nombreArchivoRespaldo(fecha: Date = new Date()): string {
  const s = fecha.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `respaldo-soslaguaira-${s}.sql`;
}
