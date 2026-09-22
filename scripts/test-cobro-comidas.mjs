/*
 * Test del COBRO DE COMIDAS (15-sep-2026).
 *
 * Pedido del cliente: en Distribución de comida, cobrar lo entregado por empresa o por
 * encargado, con precios editables por comida (general desde una fecha o blindado a un
 * rango), y decidir por cuenta qué se cobra y qué es consumo interno.
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · el precio blindado manda en su rango y no fuera; el anulado no cuenta; lo pasado conserva su precio
 *   · lo entregado por QR va a la empresa GUARDADA en la entrega
 *   · lo de carnet va a la empresa de la ficha; sin empresa = nómina; sin ficha = aparte (no se le carga a nadie)
 *   · lo que no tiene precio no suma, pero no desaparece
 *   · «se cobra / consumo interno» y el encargado rigen DESDE SU FECHA; sin configurar, la nómina no se cobra
 *   · agrupar por encargado reparte distinto pero el total es el mismo
 *   · vive solo en Distribución de comida, con permiso completo, y no toca el registro de la cocina
 *
 * Valores inventados: no hay precios reales en el repositorio (es público).
 *
 *   node scripts/test-cobro-comidas.mjs
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

function cargar(rel) {
  const p = path.join(ROOT, rel);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  m._compile(js, p);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; failures.push(`✗ ${name}\n    obtenido: ${JSON.stringify(got)}\n    esperado: ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const L = cargar('src/lib/cobroComidas.ts');
ok('la librería no importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/cobroComidas.ts'))));

// ── 1) PRECIO VIGENTE ────────────────────────────────────────────────────────
const P = [
  { id: 'g1', categoria: 'desayuno', precio: 7, desde: '2026-09-01', created_at: '2026-09-01T10:00:00Z' },
  { id: 'g2', categoria: 'desayuno', precio: 9, desde: '2026-09-10', created_at: '2026-09-10T10:00:00Z' },
  { id: 'b1', categoria: 'desayuno', precio: 3, desde: '2026-09-12', hasta: '2026-09-13', created_at: '2026-09-11T10:00:00Z' },
  { id: 'an', categoria: 'desayuno', precio: 99, desde: '2026-09-11', created_at: '2026-09-11T11:00:00Z', anulada_at: '2026-09-11T12:00:00Z' },
  { id: 'a1', categoria: 'almuerzo', precio: '11,5', desde: '2026-09-01', created_at: '2026-09-01T10:00:00Z' },
  { id: 'a2', categoria: 'almuerzo', precio: 12, desde: '2026-09-01', created_at: '2026-09-02T10:00:00Z' },
  { id: 'c0', categoria: 'cena', precio: 0, desde: '2026-09-01', created_at: '2026-09-01T10:00:00Z' },
];
const pid = (cat, f) => L.precioComidaEn(P, cat, f)?.id ?? null;
eq('antes del primer precio: sin precio', pid('desayuno', '2026-08-31'), null);
eq('general vigente', pid('desayuno', '2026-09-05'), 'g1');
eq('el general más nuevo manda desde su fecha', pid('desayuno', '2026-09-10'), 'g2');
eq('el día antes del cambio conserva el precio viejo', pid('desayuno', '2026-09-09'), 'g1');
eq('el anulado no cuenta', pid('desayuno', '2026-09-11'), 'g2');
eq('blindado manda en su primer día', pid('desayuno', '2026-09-12'), 'b1');
eq('blindado manda en su último día', pid('desayuno', '2026-09-13'), 'b1');
eq('fuera del blindado vuelve el general', pid('desayuno', '2026-09-14'), 'g2');
eq('mismo «desde»: gana el creado después', pid('almuerzo', '2026-09-05'), 'a2');
eq('precio 0 no cuenta', pid('cena', '2026-09-05'), null);
eq('categoría sin precios', pid('lunch', '2026-09-05'), null);
eq('una categoría no toma el precio de otra', L.precioComidaEn(P, 'almuerzo', '2026-09-12')?.categoria, 'almuerzo');

// ── 2) VALIDACIÓN ────────────────────────────────────────────────────────────
const CATS = ['desayuno', 'almuerzo', 'lunch', 'cena'];
eq('válido', L.validarPrecioComida({ categoria: 'cena', precio: '4,5', desde: '2026-09-15' }, CATS), null);
ok('categoría desconocida', L.validarPrecioComida({ categoria: 'postre', precio: 1, desde: '2026-09-15' }, CATS));
ok('precio 0', L.validarPrecioComida({ categoria: 'cena', precio: '0', desde: '2026-09-15' }, CATS));
ok('precio vacío', L.validarPrecioComida({ categoria: 'cena', precio: '', desde: '2026-09-15' }, CATS));
ok('sin desde', L.validarPrecioComida({ categoria: 'cena', precio: 1, desde: '' }, CATS));
ok('hasta antes de desde', L.validarPrecioComida({ categoria: 'cena', precio: 1, desde: '2026-09-15', hasta: '2026-09-14' }, CATS));
eq('hasta igual a desde vale', L.validarPrecioComida({ categoria: 'cena', precio: 1, desde: '2026-09-15', hasta: '2026-09-15' }, CATS), null);

// ── 3) CUENTAS SIN CONFIGURAR (empresa se cobra, nómina es consumo interno) ────
const empresas = [
  { company_id: 'EMPA', company_name: 'EMPRESA A', meal_type: 'desayuno', meal_date: '2026-09-08', delivered: 2 },  // 7
  { company_id: 'EMPA', company_name: 'EMPRESA A', meal_type: 'desayuno', meal_date: '2026-09-09', delivered: 10 }, // 7 (se suma al de arriba)
  { company_id: 'EMPZ', company_name: 'EMPRESA CERO', meal_type: 'cena', meal_date: '2026-09-09', delivered: 0 },   // solo ceros: no hay cuenta
  { company_id: 'EMPA', company_name: 'EMPRESA A', meal_type: 'desayuno', meal_date: '2026-09-12', delivered: 4 },  // blindado 3
  { company_id: 'EMPA', company_name: 'EMPRESA A', meal_type: 'lunch', meal_date: '2026-09-12', delivered: 6 },     // sin precio
  { company_id: 'EMPA', company_name: 'EMPRESA A', meal_type: 'almuerzo', meal_date: '2026-09-12', delivered: 0 },  // 0: no entra
  { company_id: null, company_name: 'EMPRESA VIEJA', meal_type: 'almuerzo', meal_date: '2026-09-12', delivered: '2' }, // sin id
];
const personas = [
  { employee_id: 'e1', meal_type: 'almuerzo', distribution_date: '2026-09-12', meals: 1 }, // ficha EMPA
  { employee_id: 'e2', meal_type: 'desayuno', distribution_date: '2026-09-14', meals: 1 }, // nómina
  { employee_id: 'e2', meal_type: 'cena', distribution_date: '2026-09-14', meals: 1 },     // nómina, precio 0 = sin precio
  { employee_id: 'e9', meal_type: 'desayuno', distribution_date: '2026-09-14', meals: 1 }, // ficha no leída
  { employee_id: null, meal_type: 'desayuno', distribution_date: '2026-09-14', meals: 1 }, // ficha borrada
  { employee_id: 'e2', meal_type: null, distribution_date: '2026-09-14', meals: 1 },       // sin tipo
];
const fichas = new Map([
  ['e1', { companyId: 'EMPA', companyName: 'EMPRESA A' }],
  ['e2', { companyId: null, companyName: null }],
]);
const C = L.calcularCobroComidas({ empresas, personas, empresaDePersona: fichas, precios: P });
const cuenta = (k) => C.find((c) => c.clave === k);

eq('orden: empresas, luego nómina, luego sin ficha', C.map((c) => c.clave), ['EMPA', 'EMPRESA VIEJA', L.CUENTA_NOMINA, L.CUENTA_SIN_FICHA]);

const A = cuenta('EMPA');
eq('empresa A: comidas (QR + carnet, sin las de 0)', A.comidas, 23);
eq('empresa A: por QR', A.porQr, 22);
eq('empresa A: por carnet (su gente)', A.porCarnet, 1);
eq('empresa A: sin precio (lunch)', A.sinPrecio, 6);
eq('empresa A: cobradas', A.cobradas, 17);
eq('empresa A: monto = 12×7 + 4×3 + 1×12', A.monto, 108);
eq('empresa A: sin configurar se cobra todo', [A.montoInterno, A.comidasInternas], [0, 0]);
eq('empresa A: detalle por comida y precio', A.items, [
  { categoria: 'almuerzo', plato: null, precio: 12, fuente: 'tabla', cantidad: 1, monto: 12, seCobra: true },
  { categoria: 'desayuno', plato: null, precio: 7, fuente: 'tabla', cantidad: 12, monto: 84, seCobra: true },
  { categoria: 'desayuno', plato: null, precio: 3, fuente: 'tabla', cantidad: 4, monto: 12, seCobra: true },
  { categoria: 'lunch', plato: null, precio: null, fuente: null, cantidad: 6, monto: 0, seCobra: true },
]);

const V = cuenta('EMPRESA VIEJA');
eq('entrega sin id de empresa: cuenta por el nombre guardado', [V.nombre, V.comidas, V.monto], ['EMPRESA VIEJA', 2, 24]);

const N = cuenta(L.CUENTA_NOMINA);
eq('nómina: comidas', N.comidas, 3);
eq('⭐ nómina sin configurar: consumo interno (desayuno a 9 valorado, no cobrado)', [N.cobradas, N.sinPrecio, N.monto, N.montoInterno, N.comidasInternas], [0, 2, 0, 9, 3]);
ok('nómina: lo sin tipo sale como «sin categoría»', N.items.some((i) => i.categoria === L.SIN_CATEGORIA && i.precio === null && i.seCobra === false));
eq('nómina sin departamento en la ficha', N.detalle, [L.DEPTO_SIN_NOMBRE]);

const S = cuenta(L.CUENTA_SIN_FICHA);
eq('sin ficha (no leída o borrada): aparte, no en nómina, y se cuenta', [S.comidas, S.monto], [2, 18]);

eq('total', L.totalCobroComidas(C), { comidas: 30, cobradas: 21, sinPrecio: 8, monto: 150, montoInterno: 9, comidasInternas: 3 });
ok('una empresa con solo entregas de 0 no abre cuenta', !cuenta('EMPZ'));

eq('sin entregas: sin cuentas', L.calcularCobroComidas({ empresas: [], personas: null, empresaDePersona: new Map(), precios: P }), []);
eq('sin precios: todo sin precio, nada suma',
  L.totalCobroComidas(L.calcularCobroComidas({ empresas, personas, empresaDePersona: fichas, precios: [] })),
  { comidas: 30, cobradas: 0, sinPrecio: 30, monto: 0, montoInterno: 0, comidasInternas: 3 });
eq('centavos: 3 × 1,10 = 3,30 exactos',
  L.calcularCobroComidas({ empresas: [{ company_id: 'X', company_name: 'X', meal_type: 'cena', meal_date: '2026-09-15', delivered: 3 }], personas: [], empresaDePersona: new Map(),
    precios: [{ id: 'c', categoria: 'cena', precio: 1.1, desde: '2026-09-01' }] })[0].monto, 3.3);

// ── 4) SE COBRA / CONSUMO INTERNO Y ENCARGADO, DESDE SU FECHA ────────────────
eq('por defecto: empresa se cobra, departamento no, sin tipo sí', [L.seCobraPorDefecto('empresa'), L.seCobraPorDefecto('departamento'), L.seCobraPorDefecto(null)], [true, false, true]);
eq('departamento normalizado', [L.normalizarDepartamento('  operaciones  de maquinaria '), L.normalizarDepartamento(null), L.normalizarDepartamento(' ')], ['OPERACIONES DE MAQUINARIA', L.DEPTO_SIN_NOMBRE, L.DEPTO_SIN_NOMBRE]);

const CFG = L.indexarConfigCuentas([
  { tipo: 'empresa', clave: 'EMPA', desde: '2026-09-15', se_cobra: false, encargado_id: 'enc1', created_at: '1' }, // EMPA deja de cobrarse el 15
  { tipo: 'empresa', clave: 'GNB', desde: '2026-09-01', se_cobra: true, encargado_id: 'enc2', created_at: '1' },
  { tipo: 'departamento', clave: 'OPERACIONES DE MAQUINARIA', desde: '2026-09-15', se_cobra: true, encargado_id: 'enc2', created_at: '1' },
  { tipo: 'departamento', clave: 'cocina', desde: '2026-09-01', se_cobra: false, encargado_id: 'enc1', created_at: '1' },
  // mismo día: manda la guardada después (en orden inverso a propósito)
  { tipo: 'empresa', clave: 'GNB', desde: '2026-09-20', se_cobra: false, encargado_id: null, created_at: '3' },
  { tipo: 'empresa', clave: 'GNB', desde: '2026-09-20', se_cobra: true, encargado_id: 'enc1', created_at: '2' },
  { tipo: 'rara', clave: 'x', desde: '2026-09-01', se_cobra: true },
  { tipo: 'empresa', clave: 'EMPA', desde: '2026-09-01', se_cobra: 'si' },
]);
eq('antes de su fecha no hay configuración', L.configCuentaEn(CFG, 'empresa', 'EMPA', '2026-09-14'), null);
eq('desde su fecha rige', L.configCuentaEn(CFG, 'empresa', 'EMPA', '2026-09-15')?.se_cobra, false);
eq('mismo día: la guardada después', L.configCuentaEn(CFG, 'empresa', 'GNB', '2026-09-20')?.created_at, '3');
eq('el departamento se encuentra aunque venga escrito distinto', L.configCuentaEn(CFG, 'departamento', ' Cocina ', '2026-09-20')?.encargado_id, 'enc1');
eq('filas inválidas no cuentan (se_cobra que no es sí/no)', L.configCuentaEn(CFG, 'empresa', 'EMPA', '2026-09-10'), null);
eq('una fila de tipo inventado no se guarda en el índice', L.configCuentaEn(CFG, 'rara', 'x', '2026-09-20'), null);

const P2 = [{ id: 'd', categoria: 'desayuno', precio: 3, desde: '2026-09-01' }];
const emp2 = [
  { company_id: 'EMPA', company_name: 'EMPRESA A', meal_type: 'desayuno', meal_date: '2026-09-10', delivered: 10 }, // se cobra (antes del 15)
  { company_id: 'EMPA', company_name: 'EMPRESA A', meal_type: 'desayuno', meal_date: '2026-09-20', delivered: 5 },  // interno, enc1
  { company_id: 'GNB', company_name: 'APOYO', meal_type: 'desayuno', meal_date: '2026-09-20', delivered: 4 },       // interno, sin encargado
];
const per2 = [
  { employee_id: 'e1', meal_type: 'desayuno', distribution_date: '2026-09-20', meals: 1 }, // gente de EMPA: interno, enc1
  { employee_id: 'e2', meal_type: 'desayuno', distribution_date: '2026-09-10', meals: 1 }, // operaciones antes del 15: interno por defecto
  { employee_id: 'e2', meal_type: 'desayuno', distribution_date: '2026-09-20', meals: 1 }, // operaciones desde el 15: se cobra, enc2
  { employee_id: 'e3', meal_type: 'desayuno', distribution_date: '2026-09-20', meals: 1 }, // cocina: interno, enc1
  { employee_id: 'e4', meal_type: 'desayuno', distribution_date: '2026-09-20', meals: 1 }, // sin departamento: interno, sin encargado
];
const fichas2 = new Map([
  ['e1', { companyId: 'EMPA', companyName: 'EMPRESA A' }],
  ['e2', { companyId: null, companyName: null, departamento: '  operaciones  de maquinaria ' }],
  ['e3', { companyId: null, companyName: null, departamento: 'Cocina' }],
  ['e4', { companyId: null, companyName: null, departamento: null }],
]);
const ENC = new Map([['enc1', 'ENCARGADO UNO'], ['enc2', 'ENCARGADO DOS']]);
const base2 = { empresas: emp2, personas: per2, empresaDePersona: fichas2, precios: P2, config: CFG, encargados: ENC };

const porCuenta = L.calcularCobroComidas(base2);
const pc = (k) => porCuenta.find((c) => c.clave === k);
eq('por cuenta: orden', porCuenta.map((c) => c.nombre), ['APOYO', 'EMPRESA A', 'Nómina propia (por carnet)']);
eq('⭐ empresa A: se cobra hasta el 14 y es interna desde el 15 (QR y su gente por carnet)',
  [pc('EMPA').comidas, pc('EMPA').monto, pc('EMPA').montoInterno, pc('EMPA').comidasInternas], [16, 30, 18, 6]);
eq('empresa A: el mismo precio se separa en cobrado e interno', pc('EMPA').items, [
  { categoria: 'desayuno', plato: null, precio: 3, fuente: 'tabla', cantidad: 10, monto: 30, seCobra: true },
  { categoria: 'desayuno', plato: null, precio: 3, fuente: 'tabla', cantidad: 6, monto: 18, seCobra: false },
]);
eq('APOYO: la configuración del mismo día guardada después (interna)', [pc('GNB').monto, pc('GNB').montoInterno], [0, 12]);
eq('⭐ nómina: operaciones se cobra desde el 15; lo demás interno', [pc(L.CUENTA_NOMINA).monto, pc(L.CUENTA_NOMINA).montoInterno, pc(L.CUENTA_NOMINA).cobradas], [3, 9, 1]);
eq('nómina: sus departamentos', pc(L.CUENTA_NOMINA).detalle, ['COCINA', 'OPERACIONES DE MAQUINARIA', 'SIN DEPARTAMENTO']);
const tCuenta = L.totalCobroComidas(porCuenta);
eq('total por cuenta', tCuenta, { comidas: 24, cobradas: 11, sinPrecio: 0, monto: 33, montoInterno: 39, comidasInternas: 13 });

const porEnc = L.calcularCobroComidas({ ...base2, eje: 'encargado' });
const pe = (k) => porEnc.find((c) => c.clave === k);
eq('por encargado: orden (sin encargado al final)', porEnc.map((c) => c.nombre), ['ENCARGADO DOS', 'ENCARGADO UNO', 'Sin encargado asignado']);
eq('encargado dos: operaciones desde el 15', [pe('enc2').comidas, pe('enc2').monto, pe('enc2').montoInterno, pe('enc2').detalle], [1, 3, 0, ['OPERACIONES DE MAQUINARIA']]);
eq('encargado uno: empresa A desde el 15 y cocina', [pe('enc1').comidas, pe('enc1').monto, pe('enc1').montoInterno, pe('enc1').detalle], [7, 0, 21, ['COCINA', 'EMPRESA A']]);
eq('sin encargado: lo que no tiene encargado en su fecha', [pe(L.SIN_ENCARGADO).comidas, pe(L.SIN_ENCARGADO).monto, pe(L.SIN_ENCARGADO).montoInterno, pe(L.SIN_ENCARGADO).detalle],
  [16, 30, 18, ['APOYO', 'EMPRESA A', 'OPERACIONES DE MAQUINARIA', 'SIN DEPARTAMENTO']]);
eq('⭐ el total por encargado es el mismo que por cuenta', L.totalCobroComidas(porEnc), tCuenta);
eq('encargado sin nombre en el catálogo', L.calcularCobroComidas({ ...base2, eje: 'encargado', encargados: new Map() })[0].nombre, 'Encargado sin nombre');

// ── 4b) «OTROS» SE COBRA CON EL COSTO POR PLATO DE LA COCINA (18-sep-2026) ───
//
// Antes salía «sin precio» y no sumaba, mientras el reporte por empresa de la
// cocina sí los sumaba con su costo: dos papeles con cifras distintas. Además la
// línea decía «4 otros» sin decir qué eran.
{
  const P3 = [{ id: 'd', categoria: 'desayuno', precio: 4, desde: '2026-09-01' }];
  eq('otros: el costo por plato escrito (con coma)', L.precioDeEntrega(P3, 'otros', '2026-09-18', '1,5'), { precio: 1.5, fuente: 'cocina', desde: '' });
  eq('otros: se redondea a centavos antes de multiplicar', L.precioDeEntrega(P3, 'otros', '2026-09-18', 1.234)?.precio, 1.23);
  eq('otros con costo 0 (la cocina lo dejó en blanco): sin precio', L.precioDeEntrega(P3, 'otros', '2026-09-18', 0), null);
  eq('otros sin costo escrito: sin precio', L.precioDeEntrega(P3, 'otros', '2026-09-18', null), null);
  eq('⭐ una comida fija NO toma el costo de la cocina: manda la tabla', L.precioDeEntrega(P3, 'desayuno', '2026-09-18', 99), { precio: 4, fuente: 'tabla', desde: '2026-09-01' });
  eq('⭐ ...ni siquiera cuando la tabla no le tiene precio', L.precioDeEntrega(P3, 'cena', '2026-09-18', 99), null);

  const emp3 = [
    { company_id: 'C', company_name: 'CARBO', meal_type: 'desayuno', meal_date: '2026-09-18', delivered: 8, unit_cost: 99 },
    { company_id: 'C', company_name: 'CARBO', meal_type: 'otros', item_label: 'Bolsa de hielo', meal_date: '2026-09-18', delivered: 3, unit_cost: 1.5 },
    { company_id: 'C', company_name: 'CARBO', meal_type: 'otros', item_label: ' bolsa de  hielo ', meal_date: '2026-09-18', delivered: 1, unit_cost: '1.5' },
    { company_id: 'C', company_name: 'CARBO', meal_type: 'otros', item_label: 'Refresco', meal_date: '2026-09-18', delivered: 2, unit_cost: 0 },
  ];
  const [c3] = L.calcularCobroComidas({ empresas: emp3, personas: [], empresaDePersona: new Map(), precios: P3 });
  eq('⭐ 8 desayunos × 4 (tabla, no el 99 escrito) + 4 hielos × 1,50 = 38', c3.monto, 38);
  eq('...el refresco sin costo no suma, pero se cuenta', [c3.sinPrecio, c3.comidas, c3.cobradas], [2, 14, 12]);
  eq('⭐ cada plato de Otros en su renglón, con su nombre y de dónde sale el precio', c3.items, [
    { categoria: 'desayuno', plato: null, precio: 4, fuente: 'tabla', cantidad: 8, monto: 32, seCobra: true },
    { categoria: 'otros', plato: 'Bolsa de hielo', precio: 1.5, fuente: 'cocina', cantidad: 4, monto: 6, seCobra: true },
    { categoria: 'otros', plato: 'Refresco', precio: null, fuente: null, cantidad: 2, monto: 0, seCobra: true },
  ]);

  const cfg3 = L.indexarConfigCuentas([{ tipo: 'empresa', clave: 'C', desde: '2026-09-01', se_cobra: false }]);
  const [i3] = L.calcularCobroComidas({ empresas: emp3, personas: [], empresaDePersona: new Map(), precios: P3, config: cfg3 });
  eq('⭐ en una cuenta de consumo interno, Otros se valora aparte y no se cobra', [i3.monto, i3.montoInterno], [0, 38]);

  const [d3] = L.calcularCobroComidas({
    empresas: [
      { company_id: 'C', company_name: 'CARBO', meal_type: 'otros', item_label: 'Hielo', meal_date: '2026-09-17', delivered: 2, unit_cost: 1 },
      { company_id: 'C', company_name: 'CARBO', meal_type: 'otros', item_label: 'Hielo', meal_date: '2026-09-18', delivered: 2, unit_cost: 2 },
    ],
    personas: [], empresaDePersona: new Map(), precios: P3,
  });
  eq('el mismo plato a dos costos: dos renglones, bien sumados', [d3.items.length, d3.monto], [2, 6]);

  const [n3] = L.calcularCobroComidas({
    empresas: [], personas: [{ employee_id: 'z', meal_type: 'otros', distribution_date: '2026-09-18', meals: 1 }],
    empresaDePersona: new Map([['z', { companyId: 'C', companyName: 'CARBO' }]]), precios: P3,
  });
  eq('un «otros» por carnet no trae costo escrito: sin precio', [n3.monto, n3.sinPrecio], [0, 1]);
}

// ── 5) DÓNDE VIVE Y QUIÉN LO VE ──────────────────────────────────────────────
const pantalla = sinComentarios(leer('src/screens/ComidaScreen.tsx'));
ok('ComidaScreen usa la tarjeta de cobro', /<CobroComidasResumen[\s>]/.test(pantalla));
ok('la tarjeta exige permiso completo de comida', /levelMeets\(\s*moduleLevel\(\s*'comida'\s*\)\s*,\s*'full'\s*\)/.test(pantalla));
ok('la tarjeta va dentro de canCobro', /canCobro\s*&&\s*!rangeError\s*\?\s*\(\s*<CobroComidasResumen/.test(pantalla));
ok('la tarjeta recibe las entregas del rango sin filtrar', /empresas=\{rangeRows\}/.test(pantalla) && /personas=\{rangePersons\}/.test(pantalla));

for (const f of ['src/screens/CocinaScreen.tsx', 'src/screens/FoodCompanyScreen.tsx', 'src/lib/foodDistributions.ts', 'src/lib/foodCompanyMeals.ts']) {
  ok(`${f} no sabe del cobro`, !/cobroComidas|CobroComidas|comida_precios|comida_cuentas_config/.test(leer(f)));
}
const resumen = sinComentarios(leer('src/components/CobroComidasResumen.tsx'));
const precios = sinComentarios(leer('src/components/CobroComidasPrecios.tsx'));
const cuentasUi = sinComentarios(leer('src/components/CobroComidasCuentas.tsx'));
ok('el cobro no escribe entregas', !/food_distributions|food_company_meals|saveFoodDistribution|saveCompanyMeal|deleteFoodDistribution/.test(resumen + precios + cuentasUi));
ok('la tarjeta calcula con la configuración de cuentas', /config: indexarConfigCuentas\(config\)/.test(resumen));
ok('...se puede agrupar por encargado', /chipEje\('encargado'/.test(resumen) && /\beje,\s*\n\s*platoAPrecio: resolverPlatos\(platos\),\s*\n\s*\}\)/.test(resumen));
ok('...el filtro de empresa solo aplica viendo por cuenta', /eje === 'cuenta' && filtroEmpresa !== 'all'/.test(resumen));
ok('...y muestra el consumo interno aparte', /Consumo interno \(no se cobra\)/.test(resumen));
ok('la tarjeta nombra el plato de Otros', /etiquetaItem\(it\)/.test(resumen));
ok('...dice cuándo el precio lo escribió la cocina', /costo de la cocina/.test(resumen));
ok('...y avisa aparte lo de Otros sin precio ni costo, mandando a «🧾 Platos»', /sin precio ni costo de la cocina: no suman/.test(resumen));
const repLib = sinComentarios(leer('src/lib/comidaReporte.ts'));
ok('⭐ el reporte PDF usa la MISMA regla de precio que la tarjeta', /precioDeEntrega\(precios, cat, dia\(fecha\), costoEscrito, categoriaPlato\)/.test(repLib) && !/precioComidaEn/.test(repLib));
ok('...y le pasa el costo de la cocina y el plato a las entregas por QR', /montoCon\(r\.delivered, r\.meal_type, r\.meal_date, precios, r\.unit_cost, catPlato\)/.test(repLib));
ok('la ventana de precios dice dónde se manejan los platos', /se crean, se renombran y se quitan en la pestaña «🧾 Platos»/.test(precios));
ok('la ventana de precios tiene la pestaña de cuentas', /<CobroComidasCuentas[\s>]/.test(precios));
ok('la pestaña de cuentas guarda con fecha desde', /guardarConfigCuentas\(\[\{ tipo: f\.tipo, clave: f\.clave, desde: fecha, encargadoId, seCobra \}\]\)/.test(cuentasUi));
ok('...usa la misma regla para mostrar lo vigente', /configCuentaEn\(idx, f\.tipo, f\.clave, fecha\)/.test(cuentasUi) && /seCobraPorDefecto\(f\.tipo\)/.test(cuentasUi));

const db = sinComentarios(leer('src/lib/cobroComidasDb.ts'));
eq('escrituras con .select(\'id\') (insert y update)', (db.match(/\.(insert|update)\(/g) || []).length, (db.match(/\.select\('id'\)/g) || []).length);
ok('avisa el rechazo por permiso', /SIN_PERMISO_COMIDA/.test(db) && /!data\?\.length/.test(db));
ok('la lectura de fichas lanza si falla', /if \(error\) throw/.test(db));
ok('la ficha trae el departamento', /select\('id, company_id, department, company:company_id\(name\)'\)/.test(db));
ok('la configuración de cuentas nunca se pisa: solo agrega filas', /from\('comida_cuentas_config'\)\s*\.insert\(/.test(db) && !/from\('comida_cuentas_config'\)\s*\.(update|delete|upsert)/.test(db));

// ── 6) AUDITORÍA Y MANUAL ────────────────────────────────────────────────────
const aud = leer('src/lib/auditModulos.ts');
ok('auditoría agrupa comida_precios en alimentación', /comida_precios:\s*'alimentacion'/.test(aud));
ok('...y comida_cuentas_config también', /comida_cuentas_config:\s*'alimentacion'/.test(aud));
ok('manual (md) explica el cobro', /Cobro de comidas \(15\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('manual (app) explica el cobro', /COBRO DE COMIDAS \(15\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
ok('manual (md) explica qué precio se cobra en «Otros»', /Qué precio se cobra en «Otros»:\*\* el del plato/.test(leer('docs/MANUAL-USUARIO.md')));
ok('manual (app) explica qué precio se cobra en «Otros»', /QUÉ PRECIO SE COBRA EN "OTROS": el del plato/.test(leer('src/screens/ManualScreen.tsx')));
ok('⭐ ningún manual sigue diciendo que «Otros» sale «sin precio»', !/Otros.{0,20}salen.{0,4}«?"?sin precio/.test(leer('docs/MANUAL-USUARIO.md') + leer('src/screens/ManualScreen.tsx')));
ok('manual (md) explica cuentas y encargados', /Cuentas: se cobra y encargado \(15\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('manual (app) también', /CUENTAS: SE COBRA Y ENCARGADO \(15\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

// ── CONTACTOS DE COCINA EN EL COBRO (Fase 2, 21-sep-2026) ───────────────────
{
  const deContactos = [
    // paga ella: 3 desayunos del 14-sep a 9
    { employee_id: null, contacto_id: 'k1', cobrar_a: 'independiente', employee_name: 'Ana Rojas', meal_type: 'desayuno', distribution_date: '2026-09-14', meals: 3 },
    // se le cobra a EMPRESA A: 2 desayunos a 9
    { employee_id: null, contacto_id: 'k2', cobrar_a: 'empresa', contacto_company_id: 'EMPA', contacto_company_nombre: 'EMPRESA A', employee_name: 'Beto Mora', meal_type: 'desayuno', distribution_date: '2026-09-14', meals: 2 },
    // decía «empresa» pero la entrega no guardó cuál: no puede quedar sin cobrar
    { employee_id: null, contacto_id: 'k3', cobrar_a: 'empresa', contacto_company_id: null, employee_name: 'Caro Díaz', meal_type: 'desayuno', distribution_date: '2026-09-14', meals: 1 },
  ];
  const conK = (extra = {}) => L.calcularCobroComidas({ empresas, personas: [...personas, ...deContactos], empresaDePersona: fichas, precios: P, ...extra });
  const K = conK();
  const de = (lista, k) => lista.find((c) => c.clave === k);

  eq('⭐ orden: empresas, contactos, nómina, sin ficha', K.map((c) => c.clave),
    ['EMPA', 'EMPRESA VIEJA', 'contacto:k1', 'contacto:k3', L.CUENTA_NOMINA, L.CUENTA_SIN_FICHA]);
  const ana = de(K, 'contacto:k1');
  eq('⭐ el contacto independiente tiene SU cuenta, con su nombre', [ana.nombre, ana.comidas, ana.monto, ana.porContacto, ana.clase], ['Ana Rojas', 3, 27, 3, 'contacto']);
  eq('...y se cobra (no es consumo interno)', [ana.cobradas, ana.montoInterno], [3, 0]);
  eq('⭐ el cobrado a su empresa NO abre cuenta propia', de(K, 'contacto:k2'), undefined);
  eq('⭐ ...se funde en la cuenta de la empresa: una sola EMPRESA A', K.filter((c) => c.nombre === 'EMPRESA A').length, 1);
  eq('⭐ ...y le suma exactamente lo suyo', [de(K, 'EMPA').monto - A.monto, de(K, 'EMPA').comidas - A.comidas, de(K, 'EMPA').porContacto], [18, 2, 2]);
  ok('...con su nombre en el detalle de la empresa', de(K, 'EMPA').detalle.some((d) => /Beto Mora/.test(d)));
  eq('⭐ «empresa» sin empresa guardada: a su propia cuenta, cobrada', [de(K, 'contacto:k3')?.monto, de(K, 'contacto:k3')?.cobradas], [9, 1]);
  // ⭐ NINGÚN contacto cae ya en el saco de «sin ficha».
  eq('⭐ el saco «sin ficha» no recibe a ningún contacto', de(K, L.CUENTA_SIN_FICHA).comidas, cuenta(L.CUENTA_SIN_FICHA).comidas);
  // ⭐ NADA SE COBRA DOS VECES: el total sube exactamente lo que valen esas 6 comidas.
  eq('⭐ el total sube exactamente lo de los contactos', [L.totalCobroComidas(K).monto - L.totalCobroComidas(C).monto, L.totalCobroComidas(K).comidas - L.totalCobroComidas(C).comidas], [54, 6]);
  // Las filas de nómina no cambian en nada por convivir con contactos.
  eq('⭐ la nómina queda idéntica', JSON.stringify(de(K, L.CUENTA_NOMINA)), JSON.stringify(cuenta(L.CUENTA_NOMINA)));

  // La empresa marcada «no se cobra» arrastra lo de su contacto; el independiente no.
  const cfgNo = L.indexarConfigCuentas([{ id: 'x', tipo: 'empresa', clave: 'EMPA', desde: '2026-09-01', se_cobra: false, encargado_id: null }]);
  const KN = conK({ config: cfgNo });
  eq('⭐ si la empresa no se cobra, lo de su contacto tampoco', [de(KN, 'EMPA').monto, de(KN, 'EMPA').montoInterno - 18 >= 0], [0, true]);
  eq('...pero el contacto independiente se sigue cobrando', de(KN, 'contacto:k1').monto, 27);

  // Un contacto NO se configura: `comida_cuentas_config` tiene un CHECK con 'empresa' y
  // 'departamento'. Una fila con otro tipo se descarta, y el contacto se cobra igual.
  const cfgRara = L.indexarConfigCuentas([{ id: 'y', tipo: 'contacto', clave: 'k1', desde: '2026-09-01', se_cobra: false, encargado_id: null }]);
  eq('⭐ una config de tipo «contacto» no existe: se sigue cobrando', de(conK({ config: cfgRara }), 'contacto:k1').monto, 27);
  ok('⭐ TipoCuenta sigue siendo solo lo que admite la base', /export type TipoCuenta = 'empresa' \| 'departamento';/.test(leer('src/lib/cobroComidas.ts')));

  // Eje por encargado: el independiente no tiene encargado posible.
  const KE = conK({ eje: 'encargado' });
  eq('por encargado, el total es el mismo', L.totalCobroComidas(KE).monto, L.totalCobroComidas(K).monto);
  ok('...y el independiente cae en «sin encargado»', de(KE, L.SIN_ENCARGADO).comidas >= 4);

  const src = sinComentarios(leer('src/lib/cobroComidas.ts'));
  ok('⭐ la rama del contacto va ANTES de buscar la ficha', src.indexOf('const contactoId = limpio(r.contacto_id);') > 0 && src.indexOf('const contactoId = limpio(r.contacto_id);') < src.indexOf('const ficha = r.employee_id'));
  ok('⭐ ...y termina en continue: una sola suma por fila', /clase: 'contacto' \}\);\s*\}\s*continue;/.test(src));
  ok('⭐ la clave de la empresa es su id, la misma del QR', /sumar\(\{ \.\.\.baseC, clave: empresaId, nombre, orden: 0, tipo: 'empresa', claveConfig: empresaId,/.test(src));
  const resumen2 = sinComentarios(leer('src/components/CobroComidasResumen.tsx'));
  ok('la tarjeta pinta al contacto con su ícono y cuenta sus comidas', /c\.clase === 'contacto' \? '📇'/.test(resumen2) && /c\.porContacto \?/.test(resumen2));
  ok('el PDF del cobro tiene la columna de contactos y el pie cuadra', /<th class="r">Contactos<\/th>/.test(resumen2) && /colspan="7"/.test(resumen2));
}

// ── «OTROS» PARA CONTACTOS: SE COBRA POR EL CATÁLOGO (22-sep-2026) ──────────
//
// Niliany no podía cobrarle bolsas de hielo a un particular: «Otros» solo existía
// por empresa. Decisión del cliente: el precio es el del catálogo de platos (el
// mismo que pagan las empresas) y esto es SOLO para contactos.
{
  const PH = [
    { id: 'd', categoria: 'desayuno', precio: 4, desde: '2026-09-01' },
    { id: 'h', categoria: 'plato_hielo', precio: 2.5, desde: '2026-09-01' },
  ];
  const aPrecio = (n) => (String(n ?? '').trim().toLowerCase() === 'bolsa de hielo' ? 'plato_hielo' : null);
  const hielo = [
    { employee_id: null, contacto_id: 'k1', cobrar_a: 'independiente', employee_name: 'Ana Rojas', meal_type: 'desayuno', distribution_date: '2026-09-22', meals: 1 },
    { employee_id: null, contacto_id: 'k1', cobrar_a: 'independiente', employee_name: 'Ana Rojas', meal_type: 'otros', item_label: 'Bolsa de hielo', distribution_date: '2026-09-22', meals: 4 },
    { employee_id: null, contacto_id: 'k1', cobrar_a: 'independiente', employee_name: 'Ana Rojas', meal_type: 'otros', item_label: 'Vasos', distribution_date: '2026-09-22', meals: 2 },
  ];
  const [h] = L.calcularCobroComidas({ empresas: [], personas: hielo, empresaDePersona: new Map(), precios: PH, platoAPrecio: aPrecio });
  eq('⭐ 1 desayuno × 4 + 4 hielos × 2,50 = 14, en la cuenta del contacto', [h.clave, h.monto, h.comidas, h.cobradas], ['contacto:k1', 14, 7, 5]);
  eq('⭐ el hielo sale en su renglón, con su nombre y precio de la TABLA', h.items.find((i) => i.plato === 'Bolsa de hielo'), { categoria: 'otros', plato: 'Bolsa de hielo', precio: 2.5, fuente: 'tabla', cantidad: 4, monto: 10, seCobra: true });
  eq('un plato sin precio en el catálogo se cuenta y se avisa, no se inventa', [h.sinPrecio, h.items.find((i) => i.plato === 'Vasos')?.precio], [2, null]);
  // A su empresa: el hielo se le suma a la empresa, como el resto de lo suyo.
  const [e] = L.calcularCobroComidas({ empresas: [], personas: [{ ...hielo[1], cobrar_a: 'empresa', contacto_company_id: 'EMPA', contacto_company_nombre: 'EMPRESA A' }], empresaDePersona: new Map(), precios: PH, platoAPrecio: aPrecio });
  eq('⭐ cobrado a su empresa, el hielo va a la cuenta de la empresa', [e.clave, e.monto], ['EMPA', 10]);
  // Sin el catálogo (platoAPrecio ausente) no hay costo de cocina que lo salve: sin precio.
  const [s] = L.calcularCobroComidas({ empresas: [], personas: [hielo[1]], empresaDePersona: new Map(), precios: PH });
  eq('sin catálogo, el hielo del contacto queda sin precio (nunca inventa un costo)', [s.monto, s.sinPrecio], [0, 4]);
  ok('⭐ la rama del contacto manda el plato', /via: 'contacto' as const, plato: r\.item_label \}/.test(sinComentarios(leer('src/lib/cobroComidas.ts'))));
}

console.log(`\nCobro de comidas: ${pass} ok, ${fail} fallas`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
