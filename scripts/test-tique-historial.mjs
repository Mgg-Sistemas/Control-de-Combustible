/*
 * Test del HISTORIAL DE ENTREGAS de un tique (14-sep-2026).
 *
 * Pedido del cliente: que la pastilla «entregado ×7», al tocarla, muestre quien
 * imprimio o reimprimio ese tique y a que hora.
 *
 * Lo que fija, y por que duele si se rompe:
 *   · el orden es el del RELOJ — el numero 1 es la primera impresion; si el orden
 *     fuera otro, «la 3ra» no seria la tercera y nadie podria reclamarla
 *   · la hora es la de CARACAS — un historial en UTC dice que alguien imprimio a
 *     las 12 lo que imprimio a las 8, y ese es justo el dato que se va a discutir
 *   · la misma persona escrita con otras mayusculas cuenta UNA vez
 *   · un tique sin CDT lo DICE, no deja un hueco que parezca un error
 *
 * Sin framework (el repo no tiene): transpila el .ts en memoria con `typescript`.
 *
 *   node scripts/test-tique-historial.mjs
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

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const cacheTs = new Map();
function cargar(rel) {
  const p = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (cacheTs.has(p)) return cacheTs.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cacheTs.set(p, m.exports);
  m.require = (spec) => {
    if (spec.startsWith('.')) {
      const base = path.resolve(path.dirname(p), spec);
      for (const cand of [base + '.ts', base + '.tsx']) if (fs.existsSync(cand)) return cargar(cand);
    }
    return require(spec);
  };
  m._compile(js, p);
  cacheTs.set(p, m.exports);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const ok = (nombre, cond) => { if (cond) { pass++; return; } fail++; failures.push(`✗ ${nombre}`); };
const eq = (nombre, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) { pass++; return; }
  fail++; failures.push(`✗ ${nombre}\n    obtenido: ${JSON.stringify(a)}\n    esperado: ${JSON.stringify(b)}`);
};

const {
  filasDelHistorial, resumenHistorial, fmtFechaHoraCaracas, SIN_NOMBRE, SIN_CDT,
} = cargar('src/lib/tiqueHistorial.ts');

// Nombres inventados. Las horas estan en UTC; Caracas es UTC-4.
const r1 = { id: 'b', folio: 'CDT-000001', reimpresion: false, medio: 'tiquetera', emitidoPorNombre: 'Persona Uno', ubicacionNombre: null, emitidoAt: '2026-09-12T21:25:00Z', loteId: 'l1' };
const r2 = { id: 'a', folio: 'CDT-000001', reimpresion: true, medio: 'tiquetera', emitidoPorNombre: 'Persona Dos', ubicacionNombre: 'CDT de prueba', emitidoAt: '2026-09-13T18:16:00Z', loteId: 'l2' };
const r3 = { id: 'c', folio: 'CDT-000001', reimpresion: true, medio: 'hoja', emitidoPorNombre: '  persona dos ', ubicacionNombre: 'CDT de prueba', emitidoAt: '2026-09-14T12:12:00Z', loteId: 'l3' };

// ── 1) EL ORDEN ─────────────────────────────────────────────────────────────
const entrada = [r3, r1, r2];
const filas = filasDelHistorial(entrada);
eq('salen en el orden del reloj, la primera arriba', filas.map((f) => f.clave), ['b', 'a', 'c']);
eq('...numeradas desde 1', filas.map((f) => f.n), [1, 2, 3]);
ok('no desordena la lista que le pasan', entrada[0] === r3 && entrada[1] === r1);
// Dos entregas en el mismo segundo pasan con un lote: tienen que salir siempre
// en el mismo orden, o el numero de cada una cambia cada vez que se abre.
const empate = filasDelHistorial([
  { ...r2, id: 'z', emitidoAt: '2026-09-13T18:16:00Z' },
  { ...r2, id: 'm', emitidoAt: '2026-09-13T18:16:00Z' },
]);
eq('en el mismo segundo desempata siempre igual', empate.map((f) => f.clave), ['m', 'z']);

// ── 2) QUE DICE CADA RENGLON ────────────────────────────────────────────────
eq('la primera dice que es la primera impresion', filas[0].titulo, 'Primera impresión');
eq('las otras dicen reimpresion', [filas[1].titulo, filas[2].titulo], ['Reimpresión', 'Reimpresión']);
ok('y se puede distinguir sin leer el texto', filas[0].esReimpresion === false && filas[1].esReimpresion === true);
eq('dice quien', filas[1].quien, 'Persona Dos');
eq('...sin los espacios que traiga', filas[2].quien, 'persona dos');
eq('sin nombre lo dice', filasDelHistorial([{ ...r1, emitidoPorNombre: '' }])[0].quien, SIN_NOMBRE);
// ⚠️ Un tique sin CDT lo DICE: quien imprimio no tenia obra asignada, o lo saco
//    desde la oficina. Un hueco en blanco parece un error del sistema.
eq('sin CDT lo dice', filas[0].donde, SIN_CDT);
eq('con CDT lo nombra', filas[1].donde, 'CDT de prueba');
eq('en tiquetera', filas[0].medio, 'En tiquetera');
eq('en hoja', filas[2].medio, 'En hoja');
eq('un medio desconocido no se inventa', filasDelHistorial([{ ...r1, medio: 'fax' }])[0].medio, 'Sin dato del medio');

// ── 3) LA HORA ES LA DE CARACAS ─────────────────────────────────────────────
// ⭐ 12:12 UTC son las 08:12 en Caracas. Un historial en UTC diria que alguien
//    imprimio a mediodia lo que imprimio a primera hora.
ok('la fecha es la de Caracas', /14\/09\/2026/.test(filas[2].cuando));
ok('la hora es la de Caracas, no la UTC', /08:12/.test(filas[2].cuando) && !/12:12/.test(filas[2].cuando));
// 21:25 UTC del 12 sigue siendo el 12 en Caracas, a las 5:25 de la tarde.
ok('de noche en UTC sigue siendo el mismo dia en Caracas', /12\/09\/2026/.test(filas[0].cuando) && /05:25/.test(filas[0].cuando));
eq('una fecha rota no revienta', fmtFechaHoraCaracas('no-es-fecha'), '—');

// ── 4) EL RESUMEN ───────────────────────────────────────────────────────────
// La misma persona con otras mayusculas y espacios cuenta UNA vez.
eq('el resumen cuenta entregas, personas y reimpresiones', resumenHistorial([r1, r2, r3]),
  '3 entregas · 2 personas · 2 reimpresiones');
eq('una sola entrega lo dice claro', resumenHistorial([r1]), '1 entrega: la primera impresión');
eq('sin entregas tambien', resumenHistorial([]), 'Todavía no se entregó este tique.');
eq('singular bien escrito', resumenHistorial([r1, r2]), '2 entregas · 2 personas · 1 reimpresión');

// ── 5) GUARDAS SOBRE EL CODIGO ──────────────────────────────────────────────
const lib = leer('src/lib/tiqueHistorial.ts');
ok('la libreria del historial es pura: no importa nada', !/^\s*import\s/m.test(sinComentarios(lib)));

const em = sinComentarios(leer('src/lib/tiqueEmisiones.ts'));
const cuerpoListar = em.slice(em.indexOf('export async function listarEmisionesDeFolio'), em.indexOf('export async function listarEmisionesDeFolio') + 1200);
ok('hay una lectura del historial de un folio', cuerpoListar.length > 200);
ok('...que filtra por ese folio', /\.eq\('folio', f\)/.test(cuerpoListar));
ok('...trae quien, cuando, donde y si fue reimpresion',
  /emitido_por_nombre/.test(cuerpoListar) && /emitido_at/.test(cuerpoListar) && /ubicacion_nombre/.test(cuerpoListar) && /reimpresion/.test(cuerpoListar));
ok('...ordenada por la hora de la base', /\.order\('emitido_at', \{ ascending: true \}\)/.test(cuerpoListar));
ok('...y distingue una tabla que falta de un error', /faltaLaTabla\(e\)/.test(cuerpoListar));
ok('la constancia sigue siendo de solo leer y agregar', !/\.update\(/.test(em) && !/\.delete\(/.test(em));

const comp = sinComentarios(leer('src/components/HistorialTiqueModal.tsx'));
const compCrudo = leer('src/components/HistorialTiqueModal.tsx');
ok('la ventana lee el historial del folio', /listarEmisionesDeFolio\(folio\)/.test(comp));
ok('...y lo arma con la libreria', /filasDelHistorial\(r\.filas\)/.test(comp) && /resumenHistorial\(r\.filas\)/.test(comp));
// ⚠️ Una entrega que salio sin senal todavia no esta en la base. Si la ventana no
//    lo dijera, el historial se veria completo y le faltaria justo esa.
ok('...y avisa si hay entregas de ese tique sin subir en el telefono', /contarPendientesDeFolio\(folio\)/.test(comp) && /sin subir/.test(compCrudo));
ok('dice cuando esta cargando', /Leyendo el historial/.test(compCrudo));
ok('...y cuando falla, sin fingir que no hay entregas', /No se pudo leer el historial/.test(compCrudo));

const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
ok('la pastilla de entregado se puede tocar', /onPress=\{\(\) => setHistorialFolio\(folioDeTique\(row\)\)\}/.test(scr));
ok('la ventana del historial esta montada', /<HistorialTiqueModal folio=\{historialFolio\} onClose=\{\(\) => setHistorialFolio\(null\)\} \/>/.test(scr));

// ── 6) EL MANUAL ────────────────────────────────────────────────────────────
ok('el manual .md lo explica', /Ver quién imprimió cada tique \(14\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla tambien', /VER QUIÉN IMPRIMIÓ CADA TIQUE \(14\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-tique-historial · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
