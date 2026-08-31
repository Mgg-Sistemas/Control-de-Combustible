/*
 * TOTAL POR EQUIPO en Reportes -> Jornada (31-ago-2026).
 *
 * Pedido del cliente: «necesito una opcion de buscar por maquinaria en
 * especifico, y poder tener un total generado por equipo, que yo pueda ver el
 * total de horas el total en dinero en un rango que yo elija o para dias que
 * elija, sin danar nada en el modulo».
 *
 * LO QUE MAS IMPORTA DE ESTA SUITE es la PARIDAD: filtrar o elegir dias no puede
 * cambiar la aritmetica. Si el panel nuevo dijera un numero distinto al del
 * informe de siempre, nadie sabria cual de los dos creer -- y este es un
 * documento con el que se cobra.
 *
 * Y el caso que atrapa la reimplementacion ingenua: el monto es la suma DIA POR
 * DIA, no horas/12 x precio. Si a una maquina le cambiaron el precio a mitad de
 * semana, las dos cuentas dan distinto y solo una es la que se cobro.
 *
 *   node scripts/test-jornada-por-maquina.mjs
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

const J = compilar(path.join(ROOT, 'src/lib/jornadaPorMaquina.ts'));
const { diaEnAlcance, etiquetaAlcance, filtrarMaquinas, resumirPorMaquina, htmlPorMaquina } = J;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const dmy = (iso) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };

/** Un dia de jornada. `p` = precio de la JORNADA de 12h (no por hora). */
const dia = (fecha, trabajadas, p, { d = trabajadas, n = 0 } = {}) => ({
  fecha, dia: d, noche: n, trabajadas,
  precioJornada: p, monto: p == null ? 0 : (trabajadas / 12) * p,
});
const maq = (id, code, extra = {}) => ({
  id, code, plate: null, serial: null, identifier: null,
  tipo: 'CAT', clasificacion: 'EXCAVADORA', company: 'MGG', encargado: 'Pedro',
  estado: 'trabajo', porDia: [], ...extra,
});

const RANGO = { modo: 'rango', desde: '2026-08-24', hasta: '2026-08-30' };

// -- 1) QUE DIAS ENTRAN ------------------------------------------------------
ok('el primer dia del rango entra', diaEnAlcance('2026-08-24', RANGO));
ok('* y el ultimo tambien (inclusivo en los dos extremos)', diaEnAlcance('2026-08-30', RANGO));
ok('uno de en medio entra', diaEnAlcance('2026-08-27', RANGO));
ok('* uno anterior no', !diaEnAlcance('2026-08-23', RANGO));
ok('* uno posterior tampoco', !diaEnAlcance('2026-08-31', RANGO));
{
  const sueltos = { modo: 'dias', dias: ['2026-08-25', '2026-08-28'] };
  ok('con dias sueltos, solo los marcados', diaEnAlcance('2026-08-25', sueltos));
  ok('* uno no marcado queda fuera aunque este en medio', !diaEnAlcance('2026-08-26', sueltos));
}
// Las dos trampas: nunca caer de vuelta a "todos".
ok('* la lista de dias VACIA no deja pasar nada', !diaEnAlcance('2026-08-25', { modo: 'dias', dias: [] }));
ok('* un rango al reves no deja pasar nada',
  !diaEnAlcance('2026-08-25', { modo: 'rango', desde: '2026-08-30', hasta: '2026-08-24' }));
ok('* y no revienta con fecha vacia', !diaEnAlcance('', RANGO));

// -- 2) PARIDAD: elegir o filtrar NO cambia la aritmetica --------------------
const FLOTA = [
  maq('m1', 'EXCAVADORA', { plate: 'A11AA1A', porDia: [
    dia('2026-08-24', 12, 100), dia('2026-08-25', 10, 100), dia('2026-08-26', 8, 100),
  ] }),
  maq('m2', 'PAYLOADER', { serial: 'SN-777', porDia: [
    dia('2026-08-24', 6, 60), dia('2026-08-26', 12, 60),
  ] }),
  maq('m3', 'RETROEXCAVADORA', { identifier: '073', porDia: [dia('2026-08-25', 12, 90)] }),
];

const todo = resumirPorMaquina(FLOTA, RANGO);
eq('el total de horas es la suma de todas', todo.horas, 12 + 10 + 8 + 6 + 12 + 12);
eq('* y el de dinero tambien',
  todo.monto, Math.round(((12 + 10 + 8) / 12 * 100 + (6 + 12) / 12 * 60 + 12 / 12 * 90) * 100) / 100);
eq('cuenta los equipos que trabajaron', todo.equipos, 3);
eq('* y las jornadas con horas', todo.jornadas, 6);

// Filtrar a UNA maquina no le cambia sus numeros.
{
  const sola = resumirPorMaquina(FLOTA, RANGO, { soloIds: new Set(['m2']) });
  const m2EnTodo = todo.maquinas.find((x) => x.id === 'm2');
  eq('* filtrar no cambia las horas de la maquina', sola.maquinas[0].horas, m2EnTodo.horas);
  eq('* ni su monto', sola.maquinas[0].monto, m2EnTodo.monto);
  eq('* y el total del filtro es esa sola maquina', sola.horas, m2EnTodo.horas);
}

// Los dias sueltos SUMAN exactamente lo mismo que el rango completo.
{
  const dias = ['2026-08-24', '2026-08-25', '2026-08-26'];
  const porDias = resumirPorMaquina(FLOTA, { modo: 'dias', dias });
  eq('* elegir todos los dias del rango da el mismo total de horas', porDias.horas, todo.horas);
  eq('* y el mismo total de dinero', porDias.monto, todo.monto);
  // Y un subconjunto nunca puede dar mas.
  const parcial = resumirPorMaquina(FLOTA, { modo: 'dias', dias: ['2026-08-25'] });
  ok('* un subconjunto da menos o igual', parcial.horas <= todo.horas && parcial.horas > 0);
}

// -- 3) EL PRECIO QUE CAMBIA A MITAD DE SEMANA -------------------------------
// El caso que atrapa la cuenta ingenua `horas/12 x ultimoPrecio`.
{
  const cambio = [maq('mx', 'GRUA', { porDia: [
    dia('2026-08-24', 12, 100),  // $100 la jornada
    dia('2026-08-25', 12, 200),  // se lo subieron
  ] })];
  const r = resumirPorMaquina(cambio, RANGO);
  eq('* el monto es la suma DIA POR DIA', r.monto, 300);
  const ingenuo = (r.horas / 12) * 200;
  ok('* y NO es horas/12 x el ultimo precio', r.monto !== ingenuo);
  eq('* el $/hora efectivo sale del monto real', r.maquinas[0].precioHoraEfectivo, 12.5);
}

// -- 4) HORAS SIN PRECIO -----------------------------------------------------
{
  const sinP = [maq('ms', 'MARTILLO', { porDia: [dia('2026-08-24', 10, null), dia('2026-08-25', 2, 60)] })];
  const r = resumirPorMaquina(sinP, RANGO).maquinas[0];
  eq('las horas se cuentan aunque no haya precio', r.horas, 12);
  eq('* el monto solo suma lo que si tenia precio', r.monto, 10);
  ok('* y queda avisado que esta incompleto', r.sinPrecio);
}
{
  const cero = [maq('m0', 'PARADA', { estado: 'averia', motivo: 'Motor', porDia: [] })];
  const r = resumirPorMaquina(cero, RANGO);
  eq('una maquina averiada aparece en la lista', r.maquinas.length, 1);
  eq('* con cero horas', r.maquinas[0].horas, 0);
  eq('* y sin dividir por cero', r.maquinas[0].precioHoraEfectivo, null);
  eq('* pero NO cuenta como equipo que trabajo', r.equipos, 0);
  eq('* ni suma al total', r.horas, 0);
}

// -- 5) "0 HORAS = PARADA": un dia en cero no es una jornada -----------------
{
  const conCero = [maq('mc', 'VOLTEO', { porDia: [
    dia('2026-08-24', 0, 100), dia('2026-08-25', 8, 100),
  ] })];
  const r = resumirPorMaquina(conCero, RANGO).maquinas[0];
  eq('* el dia en cero no cuenta como jornada', r.jornadas, 1);
  eq('y las horas son solo las del dia que trabajo', r.horas, 8);
}

// -- 6) COMO SE IDENTIFICA LA MAQUINA ----------------------------------------
// Dos maquinas con el MISMO nombre tienen que verse distintas.
{
  const gemelas = [
    maq('g1', 'CAMION VOLTEO TORONTO', { plate: 'A28BC1J', porDia: [dia('2026-08-24', 6, 50)] }),
    maq('g2', 'CAMION VOLTEO TORONTO', { plate: 'A55DF2K', porDia: [dia('2026-08-24', 6, 50)] }),
  ];
  const r = resumirPorMaquina(gemelas, RANGO);
  eq('* dos maquinas del mismo nombre son DOS filas', r.maquinas.length, 2);
  ok('* y sus etiquetas se distinguen', r.maquinas[0].etiqueta !== r.maquinas[1].etiqueta);
}
{
  const r = resumirPorMaquina(FLOTA, RANGO).maquinas;
  const porId = Object.fromEntries(r.map((x) => [x.id, x]));
  eq('la placa manda en el discriminante', porId.m1.discriminante, 'A11AA1A');
  eq('* sin placa, el serial', porId.m2.discriminante, 'SN-777');
  // ESTE es el que se pierde si se usa la regla de los camiones: las
  // retroexcavadoras 008/053/073 solo tienen IDENTIFICADOR.
  eq('* y sin ninguno de los dos, el IDENTIFICADOR', porId.m3.discriminante, '073');
  eq('* la etiqueta pega nombre y discriminante', porId.m3.etiqueta, 'RETROEXCAVADORA · 073');
}
{
  const pelada = [maq('mp', 'MARTILLO', { porDia: [dia('2026-08-24', 4, 40)] })];
  eq('* una maquina sin ningun dato queda con guion',
    resumirPorMaquina(pelada, RANGO).maquinas[0].discriminante, '—');
}

// -- 7) EL BUSCADOR ----------------------------------------------------------
eq('sin texto salen todas', filtrarMaquinas(FLOTA, '').length, 3);
eq('* solo espacios tampoco filtra', filtrarMaquinas(FLOTA, '   ').length, 3);
eq('* busca por placa', filtrarMaquinas(FLOTA, 'A11AA1A').map((m) => m.id), ['m1']);
eq('* por un pedazo de placa', filtrarMaquinas(FLOTA, 'AA1').map((m) => m.id), ['m1']);
eq('* por serial', filtrarMaquinas(FLOTA, 'SN-777').map((m) => m.id), ['m2']);
eq('* por identificador', filtrarMaquinas(FLOTA, '073').map((m) => m.id), ['m3']);
eq('* por nombre', filtrarMaquinas(FLOTA, 'payloader').map((m) => m.id), ['m2']);
eq('* no distingue mayusculas', filtrarMaquinas(FLOTA, 'sn-777').map((m) => m.id), ['m2']);
eq('* tambien por empresa', filtrarMaquinas(FLOTA, 'MGG').length, 3);
eq('* y por encargado', filtrarMaquinas(FLOTA, 'pedro').length, 3);
eq('lo que no coincide con nada devuelve vacio', filtrarMaquinas(FLOTA, 'zzzz'), []);
{
  // Los acentos: `machineMatches` solo no alcanza, por eso el lib agrega norm().
  const conTilde = [maq('mt', 'CAMIÓN GRÚA', { porDia: [] })];
  eq('* los acentos no estorban', filtrarMaquinas(conTilde, 'camion grua').map((m) => m.id), ['mt']);
}
{
  const copia = JSON.parse(JSON.stringify(FLOTA));
  filtrarMaquinas(FLOTA, 'AA1');
  eq('* no muta ni reordena la entrada', JSON.parse(JSON.stringify(FLOTA)), copia);
}

// -- 8) ORDEN Y DETERMINISMO -------------------------------------------------
{
  const r = resumirPorMaquina(FLOTA, RANGO).maquinas.map((m) => m.id);
  eq('* sale la de mas horas primero', r[0], 'm1'); // 30h vs 18h vs 12h
  // Dos corridas con la entrada en otro orden dan lo MISMO.
  const alReves = resumirPorMaquina([...FLOTA].reverse(), RANGO).maquinas.map((m) => m.id);
  eq('* el orden de entrada no cambia el resultado', alReves, r);
}
{
  const empate = [
    maq('e2', 'ZORRA', { porDia: [dia('2026-08-24', 5, 10)] }),
    maq('e1', 'ALMENDRA', { porDia: [dia('2026-08-24', 5, 10)] }),
  ];
  eq('* con las mismas horas desempata alfabeticamente',
    resumirPorMaquina(empate, RANGO).maquinas.map((m) => m.code), ['ALMENDRA', 'ZORRA']);
}
eq('los dias cubiertos salen ordenados y sin repetir',
  resumirPorMaquina(FLOTA, RANGO).diasCubiertos, ['2026-08-24', '2026-08-25', '2026-08-26']);

// -- 9) COMO SE ROTULA EL ALCANCE --------------------------------------------
eq('un rango de un solo dia se dice solo', etiquetaAlcance({ modo: 'rango', desde: '2026-08-31', hasta: '2026-08-31' }, dmy), '31/08/2026');
eq('un rango se dice del X al Y', etiquetaAlcance(RANGO, dmy), 'del 24/08/2026 al 30/08/2026');
eq('* sin dias marcados se dice', etiquetaAlcance({ modo: 'dias', dias: [] }, dmy), 'sin días marcados');
eq('un dia suelto se dice solo', etiquetaAlcance({ modo: 'dias', dias: ['2026-08-25'] }, dmy), '25/08/2026');
{
  // LA REGLA: dias sueltos NUNCA se anuncian como un rango corrido.
  const et = etiquetaAlcance({ modo: 'dias', dias: ['2026-08-30', '2026-08-24'] }, dmy);
  ok('* dos dias sueltos NO se anuncian como rango', !et.includes('del 24'));
  ok('* y se dicen ordenados', et.includes('24/08/2026, 30/08/2026'));
}
ok('* un rango al reves se dice, no se disimula',
  etiquetaAlcance({ modo: 'rango', desde: '2026-08-30', hasta: '2026-08-24' }, dmy).includes('al revés'));

// -- 10) EL PDF --------------------------------------------------------------
{
  const r = resumirPorMaquina(FLOTA, RANGO);
  const conPlata = htmlPorMaquina(r, { money: true, conDetalleDiario: true, dmy });
  const soloHoras = htmlPorMaquina(r, { money: false, conDetalleDiario: true, dmy });
  ok('el PDF nombra las maquinas por su etiqueta', conPlata.includes('RETROEXCAVADORA · 073'));
  ok('* y muestra el dinero', conPlata.includes('$'));
  ok('* en "solo horas" NO sale ni un signo de dolar', !soloHoras.includes('$'));
  ok('* el detalle diario se puede apagar',
    !htmlPorMaquina(r, { money: true, conDetalleDiario: false, dmy }).includes('<table class="sub">'));
  ok('* y una lista vacia lo dice en vez de salir en blanco',
    htmlPorMaquina(resumirPorMaquina([], RANGO), { money: true, conDetalleDiario: true, dmy })
      .includes('No hay equipos'));
}
{
  // Escapado: un nombre con < > & no puede romper el HTML del reporte.
  const raro = [maq('mr', 'CAT <script> & "cia"', { porDia: [dia('2026-08-24', 4, 40)] })];
  const html = htmlPorMaquina(resumirPorMaquina(raro, RANGO), { money: true, conDetalleDiario: false, dmy });
  ok('* el nombre se escapa, no se inyecta', html.includes('&lt;script&gt;') && !html.includes('<script>'));
}

// -- 11) LA LIBRERIA NO CALCULA HORAS NI LEE LA BASE -------------------------
// Es la garantia de "sin danar nada": si acá se recalculara, el panel y el
// informe dirian numeros distintos y nadie sabria cual creer.
{
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/jornadaPorMaquina.ts'), 'utf8');
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok('* no recalcula horas', !codigo.includes('workedFromShifts'));
  ok('* no lee la base', !codigo.includes('supabase'));
  ok('* no usa jornadaWindowISO (round_date YA es el dia de trabajo)', !codigo.includes('jornadaWindowISO'));
  // La identidad de una maquina se decide con machineLabel, no con la regla de
  // los camiones: `placaDeCamion` omite el identificador y dejaria en '—' a las
  // tres retroexcavadoras.
  ok('* identifica con machineLabel', codigo.includes('machineLabel('));
  ok('* y NO con placaDeCamion', !codigo.includes('placaDeCamion'));
  ok('* la busqueda se apoya en machineMatches', codigo.includes('machineMatches('));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-jornada-por-maquina · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
