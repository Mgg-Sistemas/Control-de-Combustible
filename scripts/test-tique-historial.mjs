/*
 * Test del HISTORIAL DE ENTREGAS de un ticket (14-sep-2026).
 *
 * Pedido del cliente: que la pastilla «entregado ×7», al tocarla, muestre quien
 * imprimio o reimprimio ese ticket y a que hora.
 *
 * Lo que fija, y por que duele si se rompe:
 *   · el orden es el del RELOJ — el numero 1 es la primera impresion; si el orden
 *     fuera otro, «la 3ra» no seria la tercera y nadie podria reclamarla
 *   · la hora es la de CARACAS — un historial en UTC dice que alguien imprimio a
 *     las 12 lo que imprimio a las 8, y ese es justo el dato que se va a discutir
 *   · la misma persona escrita con otras mayusculas cuenta UNA vez
 *   · un ticket sin CDT lo DICE, no deja un hueco que parezca un error
 *
 * Sin framework (el repo no tiene): transpila el .ts en memoria con `typescript`.
 *
 *   node scripts/test-ticket-historial.mjs
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
/** A va antes que B, y los DOS estan. Un indexOf de -1 no puede pasar por «antes». */
const antesQue = (s, a, b) => { const ia = s.indexOf(a); const ib = s.indexOf(b); return ia >= 0 && ib >= 0 && ia < ib; };
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
const r1 = { id: 'b', folio: 'CDT-000001', reimpresion: false, medio: 'ticketera', emitidoPorNombre: 'Persona Uno', ubicacionNombre: null, emitidoAt: '2026-09-12T21:25:00Z', loteId: 'l1' };
const r2 = { id: 'a', folio: 'CDT-000001', reimpresion: true, medio: 'ticketera', emitidoPorNombre: 'Persona Dos', ubicacionNombre: 'CDT de prueba', emitidoAt: '2026-09-13T18:16:00Z', loteId: 'l2' };
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
// ⚠️ Un ticket sin CDT lo DICE: quien imprimio no tenia obra asignada, o lo saco
//    desde la oficina. Un hueco en blanco parece un error del sistema.
eq('sin CDT lo dice', filas[0].donde, SIN_CDT);
eq('con CDT lo nombra', filas[1].donde, 'CDT de prueba');
eq('en ticketera', filas[0].medio, 'En ticketera');
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
eq('sin entregas tambien', resumenHistorial([]), 'Todavía no se entregó este ticket.');
eq('singular bien escrito', resumenHistorial([r1, r2]), '2 entregas · 2 personas · 1 reimpresión');

// ── 4b) BORRAR UNA ENTREGA (14-sep-2026) ────────────────────────────────────
// ⭐ Borrar es tachar: la borrada sigue en la lista con quien la borro, pero sin
//    numero, y el numero de las demas coincide con el «×N» de la pastilla.
const b2 = { ...r2, anuladaAt: '2026-09-14T13:05:00Z', anuladaPorNombre: ' Persona Tres ', anuladaMotivo: 'Viaje borrado' };
const conBorrada = filasDelHistorial([r1, b2, r3]);
eq('la borrada se queda en la lista', conBorrada.map((f) => f.clave), ['b', 'a', 'c']);
eq('...sin numero, y las vigentes siguen 1, 2', conBorrada.map((f) => f.n), [1, null, 2]);
eq('...marcada como borrada', conBorrada.map((f) => f.borrada), [false, true, false]);
ok('...dice quien la borro', /Borrada por Persona Tres/.test(conBorrada[1].borradaTexto ?? ''));
ok('...a que hora de Caracas', /14\/09\/2026/.test(conBorrada[1].borradaTexto ?? '') && /09:05/.test(conBorrada[1].borradaTexto ?? ''));
ok('...y por que', /Viaje borrado/.test(conBorrada[1].borradaTexto ?? ''));
eq('una vigente no trae texto de borrada', conBorrada[0].borradaTexto, null);
eq('trae el id para poder borrarla', conBorrada[2].id, 'c');
ok('borrada sin nombre lo dice', new RegExp('Borrada por ' + SIN_NOMBRE).test(filasDelHistorial([{ ...b2, anuladaPorNombre: null }])[0].borradaTexto ?? ''));
eq('una fecha de borrado vacia no la borra', filasDelHistorial([{ ...r1, anuladaAt: '  ' }])[0].borrada, false);
eq('el resumen cuenta solo las vigentes y nombra las borradas', resumenHistorial([r1, b2, r3]),
  '2 entregas · 2 personas · 1 reimpresión · 1 borrada');
eq('todas borradas lo dice', resumenHistorial([b2, { ...r1, anuladaAt: '2026-09-14T13:00:00Z' }]), 'Ninguna entrega vigente · 2 borradas');
// Si se borro la primera impresion, la que queda es una reimpresion: no se
// puede decir «la primera impresión» de un papel que dice REIMPRESIÓN.
eq('si queda una sola y es reimpresion no la llama primera', resumenHistorial([{ ...r1, anuladaAt: '2026-09-14T13:00:00Z' }, r2]),
  '1 entrega: una reimpresión · 1 borrada');

// ── 5) GUARDAS SOBRE EL CODIGO ──────────────────────────────────────────────
const lib = leer('src/lib/tiqueHistorial.ts');
ok('la libreria del historial es pura: no importa nada', !/^\s*import\s/m.test(sinComentarios(lib)));

const em = sinComentarios(leer('src/lib/tiqueEmisiones.ts'));
// Hasta la funcion siguiente, no un largo fijo: un largo fijo se queda corto en
// cuanto la funcion crece y la guarda falla por el recorte, no por el codigo.
const cuerpoListar = em.slice(em.indexOf('export async function listarEmisionesDeFolio'), em.indexOf('export async function anularEmision'));
ok('hay una lectura del historial de un folio', cuerpoListar.length > 200);
ok('...que filtra por ese folio', /\.eq\('folio', f\)/.test(cuerpoListar));
ok('...trae quien, cuando, donde y si fue reimpresion',
  /emitido_por_nombre/.test(cuerpoListar) && /emitido_at/.test(cuerpoListar) && /ubicacion_nombre/.test(cuerpoListar) && /reimpresion/.test(cuerpoListar));
ok('...ordenada por la hora de la base', /\.order\('emitido_at', \{ ascending: true \}\)/.test(cuerpoListar));
ok('...y distingue una tabla que falta de un error', /faltaLaTabla\(e\)/.test(cuerpoListar));
ok('la constancia sigue siendo de solo leer y agregar', !/\.update\(/.test(em) && !/\.delete\(/.test(em));
// ⭐ Borrar va por la funcion de la base, que pone el nombre de la sesion.
ok('borrar una entrega va por la funcion de la base', /\.rpc\('anular_tique_emision'/.test(em));
// ⚠️ El folio se repite despues de borrar un viaje. Contar por folio a secas le
//    suma al viaje nuevo las entregas del borrado (paso con CDT-000001: ×13).
const inicioContar = em.indexOf('export async function contarEmisionesPorFolio');
const cuerpoContar = em.slice(inicioContar, em.indexOf('export async function listarEmisionesDeFolio'));
ok('el contador no suma entregas de un viaje borrado', inicioContar >= 0 && /\.not\('viaje_id', 'is', null\)/.test(cuerpoContar));
ok('...ni las borradas', /\.is\('anulada_at', null\)/.test(cuerpoContar));
ok('el historial tampoco trae las de un viaje borrado', /\.not\('viaje_id', 'is', null\)/.test(cuerpoListar));
ok('...pero SI las borradas, con quien las borro', !/\.is\('anulada_at', null\)/.test(cuerpoListar) && /anulada_por_nombre/.test(cuerpoListar));

const comp = sinComentarios(leer('src/components/HistorialTiqueModal.tsx'));
const compCrudo = leer('src/components/HistorialTiqueModal.tsx');
ok('la ventana lee el historial del folio', /listarEmisionesDeFolio\(folio\)/.test(comp));
ok('...y lo arma con la libreria', /filasDelHistorial\(r\.filas\)/.test(comp) && /resumenHistorial\(r\.filas\)/.test(comp));
// ⚠️ Una entrega que salio sin senal todavia no esta en la base. Si la ventana no
//    lo dijera, el historial se veria completo y le faltaria justo esa.
ok('...y avisa si hay entregas de ese ticket sin subir en el telefono', /contarPendientesDeFolio\(folio\)/.test(comp) && /sin subir/.test(compCrudo));
ok('dice cuando esta cargando', /Leyendo el historial/.test(compCrudo));
ok('...y cuando falla, sin fingir que no hay entregas', /No se pudo leer el historial/.test(compCrudo));

const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
ok('la pastilla de entregado se puede tocar', /onPress=\{\(\) => setHistorialFolio\(folioDeTique\(row\)\)\}/.test(scr));
ok('la ventana del historial esta montada', /<HistorialTiqueModal\s+folio=\{historialFolio\}/.test(scr) && /onClose=\{\(\) => setHistorialFolio\(null\)\}/.test(scr));
ok('...borrar es de nivel completo, como borrar un viaje', /puedeBorrar=\{canFull\}/.test(scr));
ok('...y al borrar se recuenta la pastilla', /onCambio=\{\(f\) => refrescarEmisiones\(\[f\]\)\}/.test(scr));

ok('la ventana borra con la libreria', /anularEmision\(f\.id\)/.test(comp));
ok('...solo despues de confirmar', antesQue(comp, 'await confirm(', 'anularEmision(f.id)') && /if \(!ok\) return;/.test(comp));
ok('...solo si puede borrar, y nunca una ya borrada', /f\.borrada \? \(/.test(comp) && /\) : puedeBorrar \? \(/.test(comp));
ok('...sin doble toque', /borrandoRef\.current\) return/.test(comp));
ok('...vuelve a leer y avisa a la pantalla', /setVuelta\(\(v\) => v \+ 1\)/.test(comp) && /onCambio\?\.\(folio\)/.test(comp));
ok('...y muestra quien la borro', /f\.borradaTexto/.test(comp));

// ── 6) EL MANUAL ────────────────────────────────────────────────────────────
ok('el manual .md lo explica', /Ver quién imprimió cada ticket \(14\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla tambien', /VER QUIÉN IMPRIMIÓ CADA TICKET \(14\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
// ⚠️ Desde el 14-sep-2026 un número usado no se repite. Si el manual volviera a
//    decir que se repite, la jefa esperaría un número que ya no va a salir.
ok('el manual .md dice que un numero usado no se repite', /Un número de ticket usado no se repite nunca \(14\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md'))
  && !/puede volver a salir en el siguiente viaje/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla tambien', /UN NÚMERO DE TICKET USADO NO SE REPITE NUNCA \(14\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx'))
  && !/puede volver a salir en el siguiente viaje/.test(leer('src/screens/ManualScreen.tsx')));
ok('el manual .md explica borrar una entrega', /Borrar una entrega del historial \(14\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla tambien', /BORRAR UNA ENTREGA DEL HISTORIAL \(14\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-ticket-historial · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
