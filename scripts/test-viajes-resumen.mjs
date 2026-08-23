/*
 * Test del RESUMEN GLOBALIZADO de viajes de camiones (20-ago-2026).
 *
 * Pedido del cliente: el reporte de viajes no siempre debe salir desglosado viaje
 * por viaje. Debe poder pedirse "camión X → N viajes", con varios camiones a la
 * vez, y al filtrar por empresa deben salir TODOS sus camiones, el número global
 * de viajes de la empresa y su desglose.
 *
 * Fija lo que no se puede romper:
 *   · el TOTAL GENERAL siempre cuadra con la cantidad de viajes recibidos
 *   · el total de cada empresa cuadra con la suma de sus camiones
 *   · la placa sale del camión, con el serial como respaldo
 *   · un viaje de un camión que ya no está en el catálogo NO se pierde
 *   · el orden es de más viajes a menos, tanto empresas como camiones
 *
 * Ampliado el 22-ago-2026 (agrupar POR LISTERO). Lo que fija esa parte:
 *   · AGRUPAR NO FILTRA: el total es idéntico por empresa y por listero
 *   · dos listeros distintos NUNCA se funden, aunque se llamen igual
 *   · un mismo listero con el nombre escrito de dos formas es UN solo grupo
 *   · un camión trabajado por varios listeros se cuenta UNA vez en el total
 *
 * Sin framework (el repo no tiene): transpila el .ts en memoria con `typescript`.
 *
 *   npm run test:viajes   (o: node scripts/test-viajes-resumen.mjs)
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

const srcPath = path.join(ROOT, 'src/lib/viajesResumen.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const { resumirViajes, SIN_EMPRESA, SIN_LISTERO } = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── Catálogo de camiones, con los casos reales del sistema ──────────────────
const CAMIONES = {
  t1: { companyId: 'beraca', companyName: 'INVERSIONES BERACA 2021 CA', plate: 'A98AJ0G', serial: null },
  t2: { companyId: 'beraca', companyName: 'INVERSIONES BERACA 2021 CA', plate: null, serial: '251619' }, // sin placa → serial
  t3: { companyId: 'costa',  companyName: 'INGENIERIA & LOGISTICA COSTA BRAVA, C.A', plate: null, serial: null }, // ni placa ni serial
  t4: { companyId: null,     companyName: '', plate: 'A15AW5I', serial: null }, // camión sin empresa asignada
};
const cat = (id) => CAMIONES[id];
const viaje = (id, code) => ({ machineryId: id, machineCode: code });

// ── 1) EL CASO DE USO: varios camiones de varias empresas ───────────────────
const rows = [
  ...Array.from({ length: 5 }, () => viaje('t1', 'CAMION VOLTEO TORONTO')),
  ...Array.from({ length: 3 }, () => viaje('t2', 'GRÚAS TELESCÓPICAS 30 TON')),
  ...Array.from({ length: 9 }, () => viaje('t3', 'CHUTO CON VOLQUETA')),
];
const r = resumirViajes(rows, cat);

eq('el total general cuadra con los viajes recibidos', r.total, 17);
eq('cuenta los camiones distintos', r.totalCamiones, 3);
eq('la empresa con más viajes va primero', r.empresas[0].name, 'INGENIERIA & LOGISTICA COSTA BRAVA, C.A');
eq('total de la empresa líder', r.empresas[0].total, 9);
eq('total de la segunda empresa (5 + 3)', r.empresas[1].total, 8);

// El total de cada empresa SIEMPRE es la suma de sus camiones: si esto se rompe,
// el reporte muestra un global que no cuadra con su propio desglose.
r.empresas.forEach((e) => {
  eq(`total de "${e.name}" = suma de su desglose`, e.camiones.reduce((s, c) => s + c.viajes, 0), e.total);
});
eq('la suma de las empresas es el total general', r.empresas.reduce((s, e) => s + e.total, 0), r.total);

// ── 2) DENTRO DE LA EMPRESA: de más viajes a menos ──────────────────────────
const beraca = r.empresas.find((e) => e.key === 'beraca');
eq('los camiones de la empresa van de más a menos viajes',
  beraca.camiones.map((c) => c.viajes), [5, 3]);
eq('el camión con más viajes de BERACA', beraca.camiones[0].code, 'CAMION VOLTEO TORONTO');

// ── 3) LA PLACA: la del camión, con el serial de respaldo ───────────────────
eq('usa la placa cuando existe', beraca.camiones[0].placa, 'A98AJ0G');
eq('cae al serial cuando no hay placa', beraca.camiones[1].placa, '251619');
eq('sin placa ni serial muestra guion',
  r.empresas.find((e) => e.key === 'costa').camiones[0].placa, '—');

// ── 4) UN SOLO CAMIÓN (el caso "camión X → cuántos viajes") ─────────────────
const uno = resumirViajes(Array.from({ length: 12 }, () => viaje('t1', 'CAMION VOLTEO TORONTO')), cat);
eq('un solo camión: total', uno.total, 12);
eq('un solo camión: una empresa', uno.empresas.length, 1);
eq('un solo camión: sin desglosar viaje por viaje', uno.empresas[0].camiones.length, 1);
eq('un solo camión: su cantidad de viajes', uno.empresas[0].camiones[0].viajes, 12);

// ── 5) CAMIÓN SIN EMPRESA y CAMIÓN QUE YA NO ESTÁ EN EL CATÁLOGO ────────────
const sueltos = resumirViajes(
  [viaje('t4', 'CHUTO CON VOLQUETA'), viaje('borrado', 'CAMION VIEJO'), viaje('t1', 'CAMION VOLTEO TORONTO')],
  cat
);
eq('total con camiones sin empresa / desconocidos', sueltos.total, 3);
const sin = sueltos.empresas.find((e) => e.key === SIN_EMPRESA);
ok('los que no tienen empresa caen en una sola cubeta', !!sin);
eq('la cubeta "Sin empresa" junta al sin-empresa y al desconocido', sin.total, 2);
eq('el camión borrado del catálogo NO se pierde',
  sin.camiones.some((c) => c.code === 'CAMION VIEJO'), true);
eq('nada se pierde: la suma sigue cuadrando',
  sueltos.empresas.reduce((s, e) => s + e.total, 0), sueltos.total);

// ── 6) SIN VIAJES ──────────────────────────────────────────────────────────
const vacio = resumirViajes([], cat);
eq('sin viajes: total 0', vacio.total, 0);
eq('sin viajes: sin empresas', vacio.empresas.length, 0);
eq('sin viajes: sin camiones', vacio.totalCamiones, 0);

// ── 7) NO MUTA LO QUE RECIBE ───────────────────────────────────────────────
const original = [viaje('t1', 'A'), viaje('t2', 'B')];
const copia = JSON.stringify(original);
resumirViajes(original, cat);
eq('no modifica las filas que recibe', JSON.stringify(original), copia);

// ═══════════════════════════════════════════════════════════════════════════
// AGRUPAR POR LISTERO (22-ago-2026)
// ═══════════════════════════════════════════════════════════════════════════

// Un viaje con listero. `L` es el uuid (la identidad de verdad) y `n` el nombre
// copiado en la fila, que es solo una FOTO y puede variar entre un viaje y otro.
const vl = (truck, code, L, n) => ({ machineryId: truck, machineCode: code, listeroId: L, listeroName: n });

// Busca un grupo por su clave SIN reventar si no está.
//
// Sin esto, romper la clave de agrupación (por ejemplo agrupar por nombre en vez
// de por uuid) hacía que el test se cayera con "Cannot read properties of
// undefined" en vez de decir qué se rompió, y de paso se llevaba por delante los
// casos que venían después. Un test que revienta no informa: informa el que
// falla y sigue.
const grupoDe = (resumen, key) =>
  resumen.empresas.find((g) => g.key === key) ?? { key: `⚠️ NO EXISTE EL GRUPO ${key}`, name: '', total: -1, camiones: [] };

// ── 8) LA INVARIANTE: agrupar por otro eje no saca ni agrega un solo viaje ──
// Es la propiedad que hace que dos reportes del mismo día siempre cuadren entre
// sí. Si esto se rompe, alguien cobra de menos o de más.
const mezcla = [
  vl('t1', 'VOLTEO A', 'u-junior', 'Junior Cardona'),
  vl('t1', 'VOLTEO A', 'u-junior', 'Junior Cardona'),
  vl('t2', 'VOLTEO B', 'u-junior', 'Junior Cardona'),
  vl('t3', 'VOLTEO C', 'u-maria',  'María Pérez'),
  vl('t4', 'VOLTEO D', 'u-maria',  'María Pérez'),
  vl('t1', 'VOLTEO A', 'u-maria',  'María Pérez'),
];
const porEmp = resumirViajes(mezcla, cat, 'empresa');
const porLis = resumirViajes(mezcla, cat, 'listero');
eq('agrupar por listero NO cambia el total general', porLis.total, porEmp.total);
eq('el total por listero cuadra con las filas recibidas', porLis.total, mezcla.length);
eq('la suma de los grupos cuadra con el total',
  porLis.empresas.reduce((s, g) => s + g.total, 0), porLis.total);

// ── 9) EL EJE POR DEFECTO SIGUE SIENDO EMPRESA ─────────────────────────────
// Compatibilidad: quien llame sin el tercer argumento recibe lo de siempre.
eq('sin decir el eje, agrupa por empresa como siempre',
  JSON.stringify(resumirViajes(mezcla, cat)), JSON.stringify(porEmp));
eq('el resultado dice por dónde quedó partido (empresa)', porEmp.groupBy, 'empresa');
eq('el resultado dice por dónde quedó partido (listero)', porLis.groupBy, 'listero');

// ── 10) CADA LISTERO, SU GRUPO ─────────────────────────────────────────────
eq('salen los dos listeros', porLis.empresas.length, 2);
eq('el que más registró va primero', porLis.empresas[0].name, 'Junior Cardona');
eq('Junior con sus 3 viajes', porLis.empresas[0].total, 3);
eq('María con sus 3 viajes', grupoDe(porLis, 'u-maria').total, 3);
eq('el desglose de cada listero es por camión',
  porLis.empresas[0].camiones.map((c) => `${c.code}:${c.viajes}`).join('|'),
  'VOLTEO A:2|VOLTEO B:1');

// ── 11) ⭐ EL CAMIÓN COMPARTIDO NO SE CUENTA DOS VECES ──────────────────────
// t1 lo trabajaron Junior (2 viajes) y María (1). Aparece en los dos grupos,
// pero camiones DISTINTOS hay 4, no 5. Si se sumaran los grupos, el encabezado
// del reporte diría 5 camiones y sería mentira.
eq('camiones distintos, no la suma de los grupos', porLis.totalCamiones, 4);
eq('sumar los grupos daría de más (por eso no se hace)',
  porLis.empresas.reduce((s, g) => s + g.camiones.length, 0), 5);
eq('agrupando por empresa el conteo de camiones es el mismo',
  porEmp.totalCamiones, porLis.totalCamiones);

// ── 12) ⭐ DOS CUENTAS DISTINTAS NO SE FUNDEN AUNQUE SE LLAMEN IGUAL ────────
// Pasa de verdad: dos personas homónimas, o la misma persona con dos cuentas.
// La clave es el uuid, así que son dos grupos — y eso es lo correcto: el
// reporte no puede inventar que dos cuentas son la misma persona.
const homonimos = resumirViajes([
  vl('t1', 'VOLTEO A', 'u-uno', 'José García'),
  vl('t1', 'VOLTEO A', 'u-dos', 'José García'),
], cat, 'listero');
eq('dos cuentas con el mismo nombre son dos grupos', homonimos.empresas.length, 2);
eq('y no se pierde ningún viaje', homonimos.total, 2);

// ── 13) ⭐ UN MISMO LISTERO CON EL NOMBRE ESCRITO DE DOS FORMAS ─────────────
// `listero_name` es una foto: si le corrigen el nombre en su perfil, los viajes
// viejos conservan el viejo. Tiene que ser UN grupo, rotulado con la variante
// más usada — no con la que llegó primero.
const renombrado = resumirViajes([
  vl('t1', 'VOLTEO A', 'u-junior', 'Jr Cardona'),
  vl('t1', 'VOLTEO A', 'u-junior', 'Junior Cardona'),
  vl('t2', 'VOLTEO B', 'u-junior', 'Junior Cardona'),
], cat, 'listero');
eq('el mismo uuid con dos nombres es UN solo grupo', renombrado.empresas.length, 1);
eq('se rotula con la variante más usada, no con la primera',
  renombrado.empresas[0].name, 'Junior Cardona');
eq('y conserva sus 3 viajes', renombrado.empresas[0].total, 3);

// El empate se resuelve alfabéticamente para que dos corridas del MISMO reporte
// salgan idénticas — si dependiera del orden de llegada, el título bailaría.
const empate = resumirViajes([
  vl('t1', 'VOLTEO A', 'u-x', 'Zoraida Ruiz'),
  vl('t1', 'VOLTEO A', 'u-x', 'Ana Ruiz'),
], cat, 'listero');
eq('empate de variantes: gana la alfabéticamente menor (determinista)',
  empate.empresas[0].name, 'Ana Ruiz');
const empateAlReves = resumirViajes([
  vl('t1', 'VOLTEO A', 'u-x', 'Ana Ruiz'),
  vl('t1', 'VOLTEO A', 'u-x', 'Zoraida Ruiz'),
], cat, 'listero');
eq('y da lo mismo en qué orden lleguen las filas',
  empateAlReves.empresas[0].name, empate.empresas[0].name);

// ── 14) ESPACIOS DE MÁS NO PARTEN UN GRUPO ─────────────────────────────────
const espacios = resumirViajes([
  vl('t1', 'VOLTEO A', 'u-j', '  Junior   Cardona '),
  vl('t1', 'VOLTEO A', 'u-j', 'Junior Cardona'),
], cat, 'listero');
eq('los espacios de más se colapsan', espacios.empresas[0].name, 'Junior Cardona');
eq('y sigue siendo un solo grupo', espacios.empresas.length, 1);

// ── 15) UN VIAJE SIN LISTERO NO SE PIERDE ──────────────────────────────────
// En la base `listero_id` es not null, así que no debería pasar nunca. Pero la
// función es pura y recibe lo que le den: si llega uno sin listero cae en su
// cubeta en vez de desaparecer, porque el total tiene que cuadrar SIEMPRE.
const huerfano = resumirViajes([
  vl('t1', 'VOLTEO A', 'u-junior', 'Junior Cardona'),
  { machineryId: 't2', machineCode: 'VOLTEO B' },
], cat, 'listero');
eq('el viaje sin listero no se pierde', huerfano.total, 2);
ok('cae en la cubeta "sin listero"', huerfano.empresas.some((g) => g.key === SIN_LISTERO));
eq('rotulada de forma legible',
  grupoDe(huerfano, SIN_LISTERO).name, 'Sin listero');

// ── 16) LOS CAMIONES FUERA DE CATÁLOGO TAMBIÉN CUENTAN POR LISTERO ─────────
// Un camión anotado a mano no tiene ficha, pero sí tiene quien lo registró.
const fuera = resumirViajes([
  { machineryId: null, machineCode: 'VOLTEO 88', fueraCatalogo: true, listeroId: 'u-j', listeroName: 'Junior Cardona' },
  { machineryId: null, machineCode: 'VOLTEO 99', fueraCatalogo: true, listeroId: 'u-j', listeroName: 'Junior Cardona' },
], cat, 'listero');
eq('los de fuera de catálogo se le cuentan a su listero', fuera.empresas[0].total, 2);
eq('y siguen siendo dos camiones distintos, no uno', fuera.empresas[0].camiones.length, 2);
eq('con la marca de que no están en la flota', fuera.empresas[0].camiones[0].placa, 'FUERA DE CATÁLOGO');

// ── 17) NO MUTA LO QUE RECIBE (tampoco por listero) ────────────────────────
const orig2 = [vl('t1', 'A', 'u-j', 'Junior Cardona')];
const copia2 = JSON.stringify(orig2);
resumirViajes(orig2, cat, 'listero');
eq('agrupar por listero no modifica las filas recibidas', JSON.stringify(orig2), copia2);

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-resumen · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
