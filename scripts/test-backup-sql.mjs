/*
 * Test del RESPALDO EN .SQL (23-sep-2026).
 *
 * Pedido del cliente: «ese backup que sea en .SQL, me generó un .json». Y antes,
 * reportando la pantalla congelada: «RESPALDANDO 5/45: MACHINE_ROUNDS… se quedó allí».
 *
 * QUÉ SE ENCONTRÓ AL REVISARLO CONTRA LA BASE REAL, y que este test blinda:
 *
 *   1. ⚠️ EL RESPALDO SE DEJABA 75 TABLAS. La lista estaba escrita a mano en el
 *      código (45 nombres) y envejecía con cada módulo nuevo: de 107 tablas con
 *      datos se llevaba 32. Faltaban machinery_locations (7.105 filas),
 *      camion_viajes (4.448), cuentas, suppliers, purchase_orders… Ahora la lista
 *      se LEE DE LA BASE.
 *   2. ⚠️ SE COLGABA SIN DECIR NADA: no había tope de tiempo ni de páginas.
 *   3. ⚠️ SE TRAGABA LOS ERRORES: una tabla que fallaba se anotaba vacía y el
 *      archivo salía incompleto SIN AVISAR.
 *
 * Y lo que arruina un respaldo en silencio:
 *   · ⭐ UNA COMILLA MAL ESCAPADA. «ATLANTA´S CENTRO FERRETERO» está en la base de
 *     verdad. Si una comilla cierra la cadena antes de tiempo, PostgreSQL se pierde
 *     a mitad del archivo y el respaldo no sirve — y no hay forma de enterarse
 *     hasta el día que hace falta restaurarlo.
 *
 *   node scripts/test-backup-sql.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const cache = new Map();
function loadTs(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(abs), id) + '.ts') : orig(id));
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond, extra) => eq(name + (extra ? ` [${extra}]` : ''), !!cond, true);

const B = loadTs('src/lib/backupSql.ts');

// ── 1) ⭐ ESCAPAR VALORES ───────────────────────────────────────────────────
{
  eq('null', B.valorSql(null), 'NULL');
  eq('undefined también es NULL', B.valorSql(undefined), 'NULL');
  eq('booleanos', [B.valorSql(true), B.valorSql(false)], ['true', 'false']);
  eq('números', B.valorSql(17.5), '17.5');
  eq('cero no se confunde con vacío', B.valorSql(0), '0');
  eq('negativos', B.valorSql(-3), '-3');
  // NaN e Infinity no son literales válidos en SQL: entran como NULL.
  eq('NaN no rompe el archivo', B.valorSql(NaN), 'NULL');
  eq('Infinity tampoco', B.valorSql(Infinity), 'NULL');
  eq('texto normal', B.valorSql('HOLA'), "'HOLA'");

  // ⭐ EL CASO QUE ARRUINA UN RESPALDO ENTERO. Está en la base de verdad.
  eq('⭐ una comilla simple se duplica', B.valorSql("ATLANTA'S CENTRO FERRETERO"), "'ATLANTA''S CENTRO FERRETERO'");
  eq('⭐ varias comillas', B.valorSql("a'b'c"), "'a''b''c'");
  eq('solo una comilla', B.valorSql("'"), "''''");
  // Con standard_conforming_strings (el de siempre) la barra es un carácter normal.
  eq('la barra invertida NO se toca', B.valorSql('C:\\ruta'), "'C:\\ruta'");
  eq('el salto de línea va tal cual', B.valorSql('a\nb'), "'a\nb'");

  // jsonb: los renglones de una venta, los conteos de un arqueo…
  eq('un objeto va como jsonb', B.valorSql({ a: 1 }), `'{"a":1}'::jsonb`);
  eq('un arreglo también', B.valorSql([1, 2]), `'[1,2]'::jsonb`);
  eq('⭐ y una comilla DENTRO del json también se escapa',
    B.valorSql({ n: "O'BRIEN" }), `'{"n":"O''BRIEN"}'::jsonb`);
  eq('un arreglo de texto (los rubros de un proveedor)',
    B.valorSql(['FERRETERIA', 'REPUESTOS']), `'["FERRETERIA","REPUESTOS"]'::jsonb`);

  // Identificadores: una tabla o columna con comillas no rompe nada.
  eq('identificador entre comillas dobles', B.ident('machine_rounds'), '"machine_rounds"');
  eq('...y una comilla doble se duplica', B.ident('ra"ro'), '"ra""ro"');
}

// ── 2) QUÉ SE RESPALDA Y QUÉ NO ─────────────────────────────────────────────
{
  ok('una tabla normal se respalda', B.seRespalda('machine_rounds'));
  ok('las tablas nuevas también (la lista ya no se escribe a mano)', B.seRespalda('contactos'));
  // ⭐ audit_log: 115 mil filas y 181 MB de BITÁCORA. Meterla hace un archivo que
  //    el navegador no puede ni armar, y sin ella el respaldo sigue sirviendo.
  ok('⭐ la bitácora de auditoría NO', !B.seRespalda('audit_log'));
  // Respaldar un `backup_*` es respaldar un respaldo.
  ok('⭐ los respaldos viejos dentro de la base NO', !B.seRespalda('backup_rounds_congelar_20260817'));
  ok('...ni los «bkp_»', !B.seRespalda('bkp_sos_18ago_20260819'));
  ok('...sin importar mayúsculas', !B.seRespalda('BACKUP_COSAS'));
  // Pero una tabla que solo EMPIEZA parecido sí se respalda: «backups» de verdad.
  ok('una tabla que solo se parece SÍ se respalda', B.seRespalda('backupsalgo'));
  ok('vacío no se respalda', !B.seRespalda(''));
}

// ── 3) LOS INSERT DE UNA TABLA ──────────────────────────────────────────────
{
  const filas = [
    { id: 'a1', name: "ATLANTA'S", activo: true, monto: 12.5, tags: ['X'], nota: null },
    { id: 'a2', name: 'OTRO', activo: false, monto: 0, tags: null, nota: 'ok' },
  ];
  const sql = B.insertsDeTabla('suppliers', filas);
  ok('dice de qué tabla y cuántas filas', sql.includes('-- suppliers: 2 fila(s)'));
  ok('nombra las columnas', sql.includes('"id", "name", "activo", "monto", "tags", "nota"'));
  ok('la tabla va con esquema y entrecomillada', sql.includes('insert into public."suppliers"'));
  ok('⭐ escapa la comilla del nombre real', sql.includes("'ATLANTA''S'"));
  // ⭐ Restaurar dos veces no puede duplicar ni reventar: un respaldo que solo
  //    funciona sobre una base vacía sirve para la mitad de los casos reales.
  ok('⭐ se puede restaurar dos veces sin duplicar', sql.includes('on conflict do nothing;'));
  ok('el 0 y el false no se pierden', sql.includes('false, 0'));
  ok('los nulos van como NULL', sql.includes('NULL'));

  // Una columna que solo aparece en la SEGUNDA fila no se puede perder.
  const desparejas = [{ id: 1 }, { id: 2, extra: 'X' }];
  eq('⭐ las columnas salen de TODAS las filas, no solo de la primera',
    B.columnasDe(desparejas), ['id', 'extra']);
  ok('...y la fila que no la tiene va con NULL', B.insertsDeTabla('t', desparejas).includes('(1, NULL)'));

  // Vacía: deja constancia. Borrarla del archivo haría dudar si se respaldó.
  ok('una tabla vacía deja constancia', B.insertsDeTabla('vacia', []).includes('-- vacia: sin filas'));
  ok('null no revienta', B.insertsDeTabla('x', null).includes('sin filas'));

  // Lotes: ni un INSERT por fila (archivo enorme) ni uno solo de 17 mil (una línea
  // que ningún editor abre).
  const muchas = Array.from({ length: 450 }, (_, i) => ({ id: i }));
  eq('⭐ se parte en lotes', (B.insertsDeTabla('t', muchas).match(/insert into/g) ?? []).length, 3);
}

// ── 4) LA CABECERA NO MIENTE ────────────────────────────────────────────────
{
  const bien = [{ tabla: 'a', filas: 10 }, { tabla: 'b', filas: 5 }];
  const c = B.cabeceraSql(bien, '2026-09-23T12:00:00Z');
  ok('dice cuántas tablas y filas', c.includes('Tablas respaldadas: 2') && c.includes('Filas: 15'));
  ok('explica cómo se restaura', c.includes('SQL Editor'));
  ok('dice qué NO trae', c.includes('No trae el esquema') && c.includes('audit_log'));
  ok('abre la transacción', c.trim().endsWith('begin;'));
  ok('sin fallos, no grita', !c.includes('INCOMPLETO'));
  eq('y cierra la transacción', B.pieSql().trim(), 'commit;');

  // ⭐ Con una tabla fallida, el archivo lo dice ARRIBA y con nombre.
  const mal = [{ tabla: 'a', filas: 10 }, { tabla: 'machine_rounds', filas: 0, error: 'tardó más de 45s' }];
  const c2 = B.cabeceraSql(mal, '2026-09-23T12:00:00Z');
  ok('⭐ avisa que está INCOMPLETO', c2.includes('ESTE RESPALDO ESTÁ INCOMPLETO'));
  ok('⭐ ...y dice cuál falló y por qué', c2.includes('machine_rounds') && c2.includes('tardó más de 45s'));
  ok('...y no cuenta la fallida entre las buenas', c2.includes('Tablas respaldadas: 1'));
}

// ── 5) EL NOMBRE DEL ARCHIVO ────────────────────────────────────────────────
{
  const n = B.nombreArchivoRespaldo(new Date('2026-09-23T14:05:11Z'));
  eq('⭐ termina en .sql, no en .json', n.endsWith('.sql'), true);
  eq('lleva la fecha y la hora', n, 'respaldo-soslaguaira-2026-09-23-14-05-11.sql');
  ok('⭐ no lleva «:» ni «/» (Windows no los admite en un nombre)', !/[:/\\]/.test(n));
}

// ── 6) LO QUE HACE LA PANTALLA ──────────────────────────────────────────────
{
  const bk = sinComentarios(leer('src/lib/backup.ts'));
  // ⭐ Las tres causas del cuelgue reportado («se quedó allí» en machine_rounds).
  ok('⭐ hay tope de tiempo por consulta', /conTope\(/.test(bk) && /MS_POR_PAGINA/.test(bk));
  ok('⭐ hay tope de páginas (nada de for(;;))', /MAX_PAGINAS/.test(bk) && !/for \(let from = 0; ;/.test(bk));
  ok('⭐ los errores YA NO se tragan en silencio', /resumen\.push\(\{ tabla: t, filas: 0, error: motivo \}\)/.test(bk));
  ok('...y una tabla que falla no detiene el resto', /catch \(e: any\)/.test(bk));
  // ⭐ La lista de tablas se le pregunta a la BASE: así no vuelve a envejecer.
  ok('⭐ la lista de tablas se lee de la base', /rpc\('tablas_para_respaldo'\)/.test(bk));
  ok('...con lista de emergencia si falta el SQL', /LISTA_DE_EMERGENCIA/.test(bk));
  ok('⭐ el archivo es .sql', /nombreArchivoRespaldo/.test(bk) && !/JSON\.stringify\(payload\)/.test(bk));
  ok('ya no arma un json', !/_backup/.test(bk));

  const aj = sinComentarios(leer('src/screens/AjustesScreen.tsx'));
  ok('⭐ la pantalla avisa si el respaldo salió INCOMPLETO', /INCOMPLETO/.test(aj));
  ok('...y nombra las tablas que fallaron', /res\.fallidas\.map\(\(f\) => f\.tabla\)/.test(aj));
  ok('el botón dice que baja un .sql', /Descargar respaldo \(\.sql\)/.test(aj));
  ok('ya no promete un JSON', !/archivo JSON/.test(aj));

  const sql = leer('supabase/respaldo_sql.sql');
  ok('el SQL crea la función de la lista', /create or replace function public\.tablas_para_respaldo/.test(sql));
  ok('deja fuera la bitácora', /relname <> 'audit_log'/.test(sql));
  ok('y los respaldos viejos', /\^\(backup\|bkp\)/.test(sql));
  ok('solo tablas, no vistas', /relkind = 'r'/.test(sql));
  ok('trae su verificación', /✅/.test(sql));
}

// ── 7) MANUALES ─────────────────────────────────────────────────────────────
{
  ok('manual (md) lo explica', /respaldo .*\.sql \(23\/09\/2026\)/i.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) lo explica', /respaldo .*\.sql \(23\/09\/2026\)/i.test(leer('src/screens/ManualScreen.tsx')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-backup-sql · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
