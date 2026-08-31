/*
 * EL BUSCADOR DE LOS FILTROS Y LA PLACA EN EL CHIP (31-ago-2026).
 *
 * Pedido del cliente: «en lista completa de viajes necesito que este un
 * buscador, ademas necesito que los vehiculos en esa lista no solo le salga el
 * nombre del vehiculo o maquinaria como esta, sino que salga la placa tambien».
 *
 * El problema, tal cual se ve en pantalla: los camiones de la flota se llaman
 * TODOS igual -- "CAMION VOLTEO TORONTO" -- asi que la fila de filtro por camion
 * son treinta pastillas identicas. No hay forma de saber cual tocar, ni de
 * encontrar una. Son dos arreglos que van juntos: la placa las distingue, el
 * buscador las encuentra.
 *
 * Lo que fijan estos casos:
 *   - que la placa entra en la etiqueta, con el serial de respaldo;
 *   - que la regla placa-o-serial vive en UN solo lugar (estaba escrita dos veces);
 *   - que el buscador no distingue mayusculas ni acentos;
 *   - y la regla que mas facil se rompe: UN FILTRO MARCADO NO SE ESCONDE NUNCA,
 *     coincida o no con la busqueda. Un filtro escondido sigue filtrando la
 *     lista de abajo sin dar la cara, que es la trampa que este modulo ya vino a
 *     cerrar una vez.
 *
 *   node scripts/test-viajes-buscador-placa.mjs
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
const compilar = (p) => {
  if (cache.has(p)) return cache.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cache.set(p, m.exports);
  m._compile(js, m.filename);
  cache.set(p, m.exports);
  return m.exports;
};
const realLoad = Module._load;
Module._load = function (req, parent) {
  if (req.startsWith('.') && parent && String(parent.filename || '').endsWith('.ts')) {
    const cand = path.resolve(path.dirname(parent.filename), req);
    for (const p of [cand, cand + '.ts', path.join(cand, 'index.ts')]) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return compilar(p);
    }
  }
  return realLoad.apply(this, arguments);
};

const { filtrarOpciones } = compilar(path.join(ROOT, 'src/lib/viajesFiltros.ts'));
const { placaDeCamion } = compilar(path.join(ROOT, 'src/lib/viajesResumen.ts'));
// El `norm` de verdad, el mismo que usa toda la app.
const { norm } = compilar(path.join(ROOT, 'src/lib/text.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// -- 1) COMO SE IDENTIFICA UN CAMION A LA VISTA ------------------------------
eq('la placa manda', placaDeCamion({ plate: 'A28BC1J', serial: 'S-9' }), 'A28BC1J');
eq('* sin placa vale el serial', placaDeCamion({ plate: null, serial: 'S-9' }), 'S-9');
eq('* una placa VACIA no tapa al serial', placaDeCamion({ plate: '', serial: 'S-9' }), 'S-9');
eq('* sin placa ni serial, un guion', placaDeCamion({ plate: null, serial: null }), '—');
eq('* un camion que ya no esta tampoco revienta', placaDeCamion(undefined), '—');
eq('* ni un null', placaDeCamion(null), '—');

// -- 2) EL BUSCADOR ----------------------------------------------------------
const OPC = [
  { id: 'a', label: 'CAMION VOLTEO TORONTO · A28BC1J', count: 4 },
  { id: 'b', label: 'CAMION VOLTEO TORONTO · A55DF2K', count: 3 },
  { id: 'c', label: 'CHUTO CON VOLQUETA · A28ZZ9P', count: 7 },
];
const nada = new Map();

eq('sin texto salen todas', filtrarOpciones(OPC, '', nada, norm).map((o) => o.id), ['a', 'b', 'c']);
eq('* solo espacios tampoco filtra', filtrarOpciones(OPC, '   ', nada, norm).map((o) => o.id), ['a', 'b', 'c']);
eq('* buscar una placa completa deja UNA sola',
  filtrarOpciones(OPC, 'A55DF2K', nada, norm).map((o) => o.id), ['b']);
eq('* un pedazo de placa deja las que lo tengan',
  filtrarOpciones(OPC, 'A28', nada, norm).map((o) => o.id), ['a', 'c']);
eq('* no distingue mayusculas', filtrarOpciones(OPC, 'a55df2k', nada, norm).map((o) => o.id), ['b']);
eq('* tambien se puede buscar por el nombre',
  filtrarOpciones(OPC, 'chuto', nada, norm).map((o) => o.id), ['c']);
eq('lo que no coincide con nada devuelve vacio', filtrarOpciones(OPC, 'zzzz', nada, norm), []);
// Acentos: el `norm` de la app los quita en los dos lados.
eq('* los acentos no estorban',
  filtrarOpciones([{ id: 'x', label: 'CAMIÓN GRÚA', count: 1 }], 'camion grua', nada, norm).map((o) => o.id),
  ['x']);

// -- 3) LO MARCADO NO SE ESCONDE NUNCA ---------------------------------------
// Es LA regla. Un filtro escondido sigue filtrando la lista de abajo, y entonces
// la pantalla muestra pocos viajes sin nada que explique por que.
{
  const marcado = new Map([['a', 'CAMION VOLTEO TORONTO · A28BC1J']]);
  eq('* lo marcado sobrevive aunque no coincida',
    filtrarOpciones(OPC, 'A55DF2K', marcado, norm).map((o) => o.id), ['a', 'b']);
  eq('* y sobrevive aunque NADA coincida',
    filtrarOpciones(OPC, 'zzzz', marcado, norm).map((o) => o.id), ['a']);
}

// -- 4) NO MUTA NI REORDENA LO QUE RECIBE ------------------------------------
{
  const copia = OPC.map((o) => ({ ...o }));
  filtrarOpciones(OPC, 'A28', nada, norm);
  eq('* no toca la lista original', OPC, copia);
  eq('* y conserva el orden que le dieron',
    filtrarOpciones(OPC, '', nada, norm).map((o) => o.label), OPC.map((o) => o.label));
}

// -- 5) LA PANTALLA USA TODO ESTO (no una copia suya) ------------------------
{
  const src = fs.readFileSync(path.join(ROOT, 'src/screens/ViajesCamionesScreen.tsx'), 'utf8');
  // Sin comentarios: el archivo EXPLICA la regla en prosa y buscar el texto
  // pelado daria positivo por el comentario y no por el codigo.
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok('* el chip de camion arma la etiqueta con la placa', codigo.includes('${r.machineCode} · ${placa}'));
  ok('* la pantalla usa el buscador de la libreria', codigo.includes('filtrarOpciones('));
  ok('* y hay una caja donde escribirlo', codigo.includes('setBusqFiltros'));
  // Las tres filas tienen que pintar la lista FILTRADA, no la completa: si una
  // se queda con la vieja, el buscador parece roto justo en esa.
  for (const eje of ['listeroOptionsVisibles', 'companyOptionsVisibles', 'truckOptionsVisibles']) {
    ok(`* la fila ${eje.replace('OptionsVisibles', '')} pinta la lista filtrada`, codigo.includes(`{${eje}.map(`));
  }
  // Y la regla placa-o-serial no puede volver a escribirse a mano en la pantalla.
  ok('* la regla placa-o-serial no esta duplicada en la pantalla',
    !/t\?\.plate \|\| t\?\.serial/.test(codigo));
}
{
  const lib = fs.readFileSync(path.join(ROOT, 'src/lib/viajesResumen.ts'), 'utf8');
  const codigo = lib.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // El resumen y el PDF tienen que salir de la MISMA funcion que el chip: si se
  // separan, el filtro dice una placa y el reporte otra.
  ok('* el resumen tambien pasa por placaDeCamion', codigo.includes('placaDeCamion(t)'));
  const aMano = (codigo.match(/plate \|\| .*serial \|\| /g) || []).filter((x) => !x.includes('placaDeCamion'));
  eq('* y la regla vive en UN solo lugar', aMano.length, 1);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-buscador-placa · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
