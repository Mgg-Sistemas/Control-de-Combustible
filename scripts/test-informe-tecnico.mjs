/*
 * Test del INFORME TÉCNICO Y DE COSTOS (`src/lib/informeTecnico.ts`) — 22-sep-2026.
 *
 * QUÉ PEDIDO CUBRE
 *   El cliente armaba a mano, en Word, un «Informe Técnico y de Costos de
 *   Mantenimiento y Reparación» por máquina para entregarle al dueño del equipo
 *   (el ejemplo que entregó: JUMBO 320 → Sr. Samuel Nasser, 9 intervenciones,
 *   $910,00 de mano de obra + $1.026,84 de repuestos = $1.936,84). Ahora lo
 *   genera el sistema desde el historial de Servicio de Maquinaria.
 *
 * LO QUE BLINDA — y por qué cada cosa
 *   · LAS CUENTAS. Es un papel que se firma y con el que se cobra: si suma mal,
 *     el error sale de la oficina con un sello encima. Se reproduce ENTERO el
 *     ejemplo del cliente y se exige la cifra exacta, no «algo parecido».
 *   · EL COSTO OPCIONAL. Una intervención sin costo cargado vale 0 y no puede
 *     producir NaN ni «$NaN» en el papel — el módulo de Servicio nació sin
 *     dinero y hay años de historial sin un solo número.
 *   · LA CANTIDAD AUSENTE CUENTA COMO 1. «Reparación de cilindro hidráulico» no
 *     lleva cantidad pero sí precio; tratarla como 0 haría desaparecer del total
 *     un repuesto cobrado.
 *   · EL PERÍODO Y EL ORDEN. El informe es un relato cronológico ASCENDENTE, al
 *     revés que las listas de la app (novedades primero).
 *   · EL ESCAPE. Todo lo que escribe el usuario pasa por el HTML del documento.
 *
 * No usa framework (el repo no tiene): transpila el .ts en memoria con el
 * `typescript` ya instalado.
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
const loadTs = (srcPath) => {
  if (cache.has(srcPath)) return cache.get(srcPath);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  cache.set(srcPath, m.exports);
  const origRequire = m.require.bind(m);
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(srcPath), `${id}.ts`)) : origRequire(id));
  m._compile(out, m.filename);
  cache.set(srcPath, m.exports);
  return m.exports;
};

const I = loadTs(path.join(ROOT, 'src/lib/informeTecnico.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); }
};

// ── 1) Números: nada puede volverse NaN ─────────────────────────────────────
eq('numero: texto con coma decimal', I.numero('45,50'), 45.5);
eq('numero: texto con punto', I.numero('45.50'), 45.5);
eq('numero: vacio es 0', I.numero(''), 0);
eq('numero: null es 0', I.numero(null), 0);
eq('numero: basura es 0', I.numero('abc'), 0);
eq('numero: Infinity es 0', I.numero(Infinity), 0);
eq('centavos redondea', I.centavos(0.1 + 0.2), 0.3);
eq('centavos de basura', I.centavos('x'), 0);

// ── 2) El renglón de repuesto ───────────────────────────────────────────────
eq('repuesto: cantidad × costo unitario', I.totalRepuesto({ quantity: 10, unit_cost: 8 }), 80);
eq('repuesto: decimal', I.totalRepuesto({ quantity: 2.5, unit_cost: 4 }), 10);
// ⭐ Sin cantidad, UNO. Un servicio suelto («reparación de cilindro») no lleva
//    número pero sí precio: contarlo como 0 lo borraría del total cobrado.
eq('⭐ repuesto sin cantidad cuenta como 1', I.totalRepuesto({ unit_cost: 350 }), 350);
eq('⭐ repuesto con cantidad vacía cuenta como 1', I.totalRepuesto({ quantity: '', unit_cost: 350 }), 350);
eq('repuesto sin costo vale 0', I.totalRepuesto({ quantity: 3, description: 'Trapo' }), 0);
eq('repuesto null vale 0', I.totalRepuesto(null), 0);
eq('repuesto: cantidad 0 con costo NO se vuelve 1', I.totalRepuesto({ quantity: 0, unit_cost: 50 }), 0);

eq('costoRepuestos suma los renglones',
  I.costoRepuestos([{ quantity: 1, unit_cost: 158.6 }, { quantity: 1, unit_cost: 11.9 }]), 170.5);
eq('costoRepuestos de lista vacía', I.costoRepuestos([]), 0);
eq('costoRepuestos de null no revienta', I.costoRepuestos(null), 0);

// ── 3) EL EJEMPLO DEL CLIENTE, ENTERO ───────────────────────────────────────
// Las nueve intervenciones del informe de la JUMBO 320 (31/08 → 20/09/2026),
// con sus cifras exactas. Si alguna de estas sumas se mueve, el papel que se
// entrega deja de cuadrar con el que el cliente ya validó.
const JUMBO = [
  { service_date: '2026-08-31', origen: 'interno', technician: 'Daniel Jiménez',
    problem: 'Instalación de pasador y engrase general de la estructura Caterpillar 320D.',
    labor_cost: 45,
    parts: [{ quantity: 1, description: 'Pasador nuevo', unit_cost: 45 },
            { quantity: 10, description: 'kg Grasa Oilven / 1/2 paila', unit_cost: 8 }] },
  { service_date: '2026-09-02', origen: 'interno', technician: 'Israel Urdaneta',
    problem: 'Falla de encendido por batería defectuosa. Reemplazo de batería eléctrica y bornes.',
    labor_cost: 20,
    parts: [{ quantity: 1, description: 'Batería eléctrica', unit_cost: 158.6 },
            { quantity: 1, description: 'Bornes de batería', unit_cost: 11.9 }] },
  { service_date: '2026-09-03', origen: 'interno', technician: 'Daniel Jiménez',
    problem: 'Ajuste del sistema eléctrico y verificación del reemplazo de batería y bornes.',
    labor_cost: 20,
    parts: [{ quantity: 1, description: 'Batería', unit_cost: 158.6 },
            { quantity: 1, description: 'Bornes', unit_cost: 11.9 }] },
  { service_date: '2026-09-09', origen: 'interno', technician: 'Daniel Jiménez',
    problem: 'Reemplazo de pico de grasera dañado y lubricación pesada de puntos de articulación.',
    labor_cost: 45,
    parts: [{ quantity: 1, description: 'Pico de grasera nuevo', unit_cost: 35 },
            { quantity: 10, description: 'kg Grasa Oilven / 1/2 paila', unit_cost: 8 }] },
  { service_date: '2026-09-14', origen: 'interno', technician: 'Israel Urdaneta',
    problem: 'Falla de aceleración por suciedad en sistema. Limpieza de líneas de combustible y sustitución de filtro.',
    labor_cost: 80,
    parts: [{ quantity: 1, description: 'Filtro de combustible', unit_cost: 35 }] },
  { service_date: '2026-09-14', origen: 'interno', technician: 'Israel Urdaneta',
    problem: 'Obstrucción por polvo en admisión de aire. Soplado y mantenimiento preventivo de filtro.',
    labor_cost: 75,
    parts: [{ description: 'Insumos de limpieza y mantenimiento' }] },
  { service_date: '2026-09-16', origen: 'interno', technician: 'Israel Urdaneta',
    problem: 'Descarrilamiento de oruga. Encarrilado de oruga, ajuste hidráulico y engrase de tensor.',
    labor_cost: 230,
    parts: [{ quantity: 10, description: 'kg Grasa Oilven / 1/2 paila', unit_cost: 9 }] },
  { service_date: '2026-09-17', origen: 'interno', technician: 'Daniel Jiménez',
    problem: 'Mantenimiento preventivo periódico de motor. Cambio de aceite de motor y filtros principales.',
    labor_cost: 45,
    parts: [{ quantity: 26, description: 'L Aceite Motul 15W40', unit_cost: 9.263 },
            { quantity: 1, description: 'Filtro Combustible 1R-0751', unit_cost: 35 },
            { quantity: 1, description: 'Filtro Aceite 1R-0739', unit_cost: 45 }] },
  { service_date: '2026-09-20', origen: 'interno', technician: 'Israel Urdaneta',
    problem: 'Desmonte de gato hidráulico defectuoso en martillo para reparación especializada.',
    labor_cost: 350,
    parts: [{ description: 'Reparación/acondicionamiento de cilindro hidráulico' }] },
];

eq('subtotal intervención 1 (45 + 125)', I.subtotalIntervencion(JUMBO[0]), 170);
eq('subtotal intervención 2 (20 + 170,50)', I.subtotalIntervencion(JUMBO[1]), 190.5);
eq('subtotal intervención 7 (230 + 90)', I.subtotalIntervencion(JUMBO[6]), 320);
eq('subtotal intervención 8 (45 + 320,84)', I.subtotalIntervencion(JUMBO[7]), 365.84);
eq('subtotal de una sin repuestos cobrados', I.subtotalIntervencion(JUMBO[8]), 350);

const T = I.totalesInforme(JUMBO);
eq('⭐ TOTAL mano de obra del informe real', T.manoObra, 910);
eq('⭐ TOTAL repuestos del informe real', T.repuestos, 1026.84);
eq('⭐ MONTO TOTAL ACUMULADO del informe real', T.total, 1936.84);
eq('cuenta las intervenciones', T.intervenciones, 9);
eq('⭐ promedio por intervención del informe real', T.promedio, 215.2);


// ── 3b) LA HOJA DE COSTOS, QUE VIVE APARTE ─────────────────────────────────
// ⭐ El cliente pidió que el informe fuera «independiente en el módulo, que no
//    afecte nada». Los costos NO están en `machinery_service_orders` ni en
//    `machinery_service_parts`: viven en `machinery_tech_report_costs`, una hoja
//    por intervención, y se pegan al imprimir.
{
  const SERVICIO = {
    id: 'so-1', service_date: '2026-09-17', technician: 'Daniel Jiménez',
    problem: 'Cambio de aceite de motor y filtros.',
    parts: [{ quantity: 26, description: 'L Aceite Motul 15W40' },
            { quantity: 1, description: 'Filtro Aceite 1R-0739' }],
  };

  // La propuesta: los repuestos del taller, con el precio EN BLANCO.
  const P = I.hojaPropuesta(SERVICIO);
  eq('la hoja se propone con los repuestos del servicio', P.map((p) => p.description),
    ['L Aceite Motul 15W40', 'Filtro Aceite 1R-0739']);
  eq('conserva la cantidad', P.map((p) => p.quantity), [26, 1]);
  eq('⭐ y el precio arranca VACÍO (nadie lo inventa)', P.map((p) => p.unit_cost), [null, null]);
  eq('ignora renglones sin descripción',
    I.hojaPropuesta({ parts: [{ quantity: 1 }, { description: '  ' }] }), []);
  eq('hojaPropuesta de null no revienta', I.hojaPropuesta(null), []);

  // Pegar la hoja al imprimir.
  const HOJA = [{ service_order_id: 'so-1', labor_cost: 45,
    items: [{ description: 'L Aceite Motul 15W40', quantity: 26, unit_cost: 9.263 },
            { description: 'Filtro Aceite 1R-0739', quantity: 1, unit_cost: 45 }] }];
  const [CON] = I.conCostos([SERVICIO], HOJA);
  eq('⭐ la mano de obra viene de la hoja, no del servicio', CON.labor_cost, 45);
  eq('⭐ y los insumos también', I.costoRepuestos(CON.parts), 285.84);
  eq('el resto de la intervención no se toca', [CON.id, CON.technician], ['so-1', 'Daniel Jiménez']);

  // ⭐ Sin hoja, la intervención sale IGUAL: sin costo, pero sale.
  const [SIN] = I.conCostos([SERVICIO], []);
  eq('⭐ una intervención sin hoja no se cae del informe', SIN.id, 'so-1');
  eq('y vale 0, sin inventar nada', I.subtotalIntervencion(SIN), 0);
  eq('conserva sus repuestos para poder nombrarlos',
    I.insumosTexto(SIN.parts), '26 L Aceite Motul 15W40, 1 Filtro Aceite 1R-0739');

  // ⭐ La hoja MANDA sobre los repuestos del taller: son dos listas distintas.
  const [MANDA] = I.conCostos([SERVICIO], [{ service_order_id: 'so-1', labor_cost: 10,
    items: [{ description: 'Reparación de cilindro', unit_cost: 350 }] }]);
  eq('⭐ cuando hay hoja, se imprimen SUS insumos y no los del servicio',
    MANDA.parts.map((p) => p.description), ['Reparación de cilindro']);
  eq('y el subtotal es el de la hoja', I.subtotalIntervencion(MANDA), 360);

  // Una hoja con la lista vacía no borra los repuestos del servicio: el usuario
  // cargó mano de obra y nada más.
  const [SOLO_MO] = I.conCostos([SERVICIO], [{ service_order_id: 'so-1', labor_cost: 80, items: [] }]);
  eq('una hoja con solo mano de obra conserva los repuestos a la vista',
    SOLO_MO.parts.length, 2);
  eq('y el subtotal es solo la mano de obra', I.subtotalIntervencion(SOLO_MO), 80);

  // La hoja de OTRA intervención no se cuela.
  const [OTRA] = I.conCostos([SERVICIO], [{ service_order_id: 'so-9', labor_cost: 999 }]);
  eq('⭐ la hoja de otra intervención no se aplica', OTRA.labor_cost, undefined);

  eq('conCostos de null no revienta', I.conCostos(null, HOJA), []);
  eq('conCostos sin hojas devuelve lo mismo', I.conCostos([SERVICIO], null).length, 1);
  eq('una intervención sin id no toma ninguna hoja',
    I.conCostos([{ service_date: '2026-09-01' }], HOJA)[0].labor_cost, undefined);
}

// ── 4) Sin costos: 0, nunca NaN ─────────────────────────────────────────────
const SIN = [{ service_date: '2026-09-01', problem: 'Revisión' },
             { service_date: '2026-09-02', problem: 'Engrase', parts: [{ description: 'Grasa' }] }];
const T0 = I.totalesInforme(SIN);
eq('⭐ sin costos cargados todo vale 0', [T0.manoObra, T0.repuestos, T0.total, T0.promedio], [0, 0, 0, 0]);
ok('⭐ ningún total es NaN', Object.values(T0).every((v) => Number.isFinite(v)));
const TV = I.totalesInforme([]);
eq('⭐ sin intervenciones el promedio es 0, no NaN (division por cero)', TV.promedio, 0);
eq('totales de null no revienta', I.totalesInforme(null).total, 0);

// ── 5) Orden, rango y período ───────────────────────────────────────────────
const DESORDEN = [{ service_date: '2026-09-20' }, { service_date: '2026-08-31' }, { service_date: '2026-09-14' }];
eq('⭐ el informe ordena de la más VIEJA a la más nueva',
  I.ordenarCronologico(DESORDEN).map((x) => x.service_date),
  ['2026-08-31', '2026-09-14', '2026-09-20']);
ok('ordenar no muta la lista original', DESORDEN[0].service_date === '2026-09-20');
eq('ordenar null no revienta', I.ordenarCronologico(null), []);

eq('rango: ambos extremos INCLUIDOS',
  I.filtrarPorRango(DESORDEN, '2026-08-31', '2026-09-20').length, 3);
eq('rango: recorta por abajo',
  I.filtrarPorRango(DESORDEN, '2026-09-01', '').map((x) => x.service_date), ['2026-09-20', '2026-09-14']);
eq('rango: recorta por arriba',
  I.filtrarPorRango(DESORDEN, '', '2026-09-01').map((x) => x.service_date), ['2026-08-31']);
eq('rango vacío no filtra nada', I.filtrarPorRango(DESORDEN, '', '').length, 3);
eq('⭐ rango al revés se voltea en vez de devolver nada',
  I.filtrarPorRango(DESORDEN, '2026-09-20', '2026-08-31').length, 3);
eq('una intervención sin fecha no entra en un rango', I.filtrarPorRango([{}], '2026-01-01', '2026-12-31').length, 0);

eq('período: la primera y la última fecha',
  I.periodoDe(JUMBO), { desde: '2026-08-31', hasta: '2026-09-20' });
eq('período sin fechas usables es null', I.periodoDe([{}, { service_date: 'x' }]), null);
eq('período de null es null', I.periodoDe(null), null);

// ── 6) Textos del documento ─────────────────────────────────────────────────
eq('fecha larga', I.fechaLarga('2026-09-21'), '21 de septiembre de 2026');
eq('fecha larga sin cero de relleno', I.fechaLarga('2026-01-05'), '5 de enero de 2026');
eq('fecha larga de basura', I.fechaLarga('nada'), '—');
eq('dmy', I.dmy('2026-09-21'), '21/09/2026');
eq('dmy de null', I.dmy(null), '—');
eq('money con separador venezolano', I.money(1936.84), '$1.936,84');
eq('money de null', I.money(null), '$0,00');

eq('quién lo hizo: interno muestra al técnico',
  I.quienInforme({ origen: 'interno', technician: 'Daniel Jiménez', provider: 'X' }), 'Daniel Jiménez');
eq('quién lo hizo: externo muestra al taller',
  I.quienInforme({ origen: 'externo', provider: 'Taller Pérez', technician: 'Y' }), 'Taller Pérez');
eq('quién lo hizo: sin nombre, un guion', I.quienInforme({ origen: 'interno' }), '—');

const INS = I.insumosTexto(JUMBO[0].parts);
ok('insumos: nombra el repuesto con su total', INS.includes('1 Pasador nuevo ($45,00)'), INS);
ok('insumos: la cantidad multiplica (10 × 8 = 80)', INS.includes('($80,00)'), INS);
ok('⭐ un repuesto SIN costo igual se nombra',
  I.insumosTexto([{ description: 'Trapo industrial' }]) === 'Trapo industrial');
eq('insumos de null', I.insumosTexto(null), '');
eq('insumos ignora renglones sin descripción', I.insumosTexto([{ unit_cost: 10 }]), '');

eq('descripción junta problema y acciones',
  I.descripcionIntervencion({ problem: 'Falla de encendido.', work_done: 'Se cambió la batería.' }),
  'Falla de encendido. Se cambió la batería.');
eq('descripción con solo uno de los dos',
  I.descripcionIntervencion({ work_done: 'Se engrasó.' }), 'Se engrasó.');
eq('descripción vacía lo dice', I.descripcionIntervencion({}), 'Sin descripción registrada.');

// ── 7) Horómetro y próximo servicio ─────────────────────────────────────────
// El ejemplo del cliente: 1.248,7 h registradas → próximo a las 1.498,7 h (+250).
eq('⭐ próximo servicio = base + 250 h',
  I.horometroInforme({ last_horometro: 1248.7, horometro_base: 1248.7 }),
  '1.248,7 horas (Próximo servicio: 1.498,7 hrs)');
ok('⭐ el próximo servicio se cuenta desde el ÚLTIMO mantenimiento, no desde hoy',
  I.horometroInforme({ last_horometro: 1300, horometro_base: 1248.7 }).includes('1.498,7'),
  I.horometroInforme({ last_horometro: 1300, horometro_base: 1248.7 }));
eq('sin horómetro, un guion', I.horometroInforme({}), '—');
eq('sin horómetro de null', I.horometroInforme(null), '—');

// ── 8) Antecedentes redactados solos ────────────────────────────────────────
const ANT = I.antecedentesAuto({
  equipo: { code: 'JUMBO CON MARTILLO 320', marca: 'Caterpillar', modelo: '320D2GC', serial: 'CAT0320DCZBH00579' },
  items: JUMBO, dirigidoA: 'Sr. Samuel Nasser', ubicacion: 'Banco Central de Venezuela / SOS La Guaira',
});
ok('antecedentes: nombra al destinatario', ANT.includes('Sr. Samuel Nasser'), ANT);
ok('antecedentes: dice el período real', ANT.includes('31 de agosto de 2026') && ANT.includes('20 de septiembre de 2026'), ANT);
ok('antecedentes: cuenta las intervenciones', ANT.includes('9 intervenciones'), ANT);
ok('antecedentes: nombra el serial', ANT.includes('CAT0320DCZBH00579'), ANT);
ok('⭐ una sola intervención se dice en singular',
  I.antecedentesAuto({ equipo: {}, items: [JUMBO[0]] }).includes('1 intervención de'), '');
ok('sin intervenciones lo dice, no inventa un período',
  I.antecedentesAuto({ equipo: {}, items: [] }).includes('no se registraron intervenciones'));

// ── 9) El documento ─────────────────────────────────────────────────────────
const EQUIPO = {
  code: 'JUMBO CON MARTILLO 320', serial: 'CAT0320DCZBH00579', plate: null, identifier: null,
  tipo: 'Excavadora de orugas con martillo hidráulico', marca: 'Caterpillar', modelo: '320D2GC',
  photo_url: 'https://x/jumbo.jpg', companyName: 'GOLDEN TOUCH 1127 C.A.', companyRif: 'J-501299935',
  encargado: 'Cheli - Samuel', last_horometro: 1248.7, horometro_base: 1248.7,
};
const CAB = {
  code: 'IT-2026-001', reportDate: '2026-09-21', dirigidoA: 'Sr. Samuel Nasser (Propietario)',
  elaboradoPor: 'Diana De La Rans', empresaPropietaria: 'Samuel Nasser', encargadoSitio: 'Cheli - Samuel',
  ubicacion: 'Banco Central de Venezuela / SOS La Guaira', estadoInforme: 'Consolidado final de servicios',
  estadoOperatividad: 'En observación / operativo con restricción.',
  recomendaciones: ['Concluir la evaluación del gato hidráulico.', 'Lubricar orugas cada 50 horas.'],
  firma1Nombre: 'Diana De La Rans', firma1Cargo: 'Jefa de Almacén y Compras', firma1Empresa: 'SOS La Guaira',
  firma2Nombre: 'Sr. Samuel Nasser', firma2Cargo: 'Propietario de la maquinaria',
  conFotos: true,
};
const HTML = I.informeTecnicoHtml({ equipo: EQUIPO, items: JUMBO, cabecera: CAB, empresaEmisora: 'SOS LA GUAIRA / GOLDEN TOUCH 1127 C.A.' });

ok('el documento trae el título del informe', /INFORME T[ÉE]CNICO/i.test(HTML.replace(/<[^>]+>/g, ' ')));
ok('el documento nombra el equipo', HTML.includes('JUMBO CON MARTILLO 320'));
ok('el documento trae el serial', HTML.includes('CAT0320DCZBH00579'));
ok('el documento trae el RIF de la empresa propietaria', HTML.includes('J-501299935'));
ok('el documento trae el correlativo', HTML.includes('IT-2026-001'));
ok('el documento trae la fecha de emisión en largo', HTML.includes('21 de septiembre de 2026'));
ok('el documento trae la foto del equipo', HTML.includes('https://x/jumbo.jpg'));
ok('⭐ el documento imprime el TOTAL consolidado', HTML.includes('$1.936,84'));
ok('⭐ el documento imprime el total de mano de obra', HTML.includes('$910,00'));
ok('⭐ el documento imprime el total de repuestos', HTML.includes('$1.026,84'));
ok('⭐ el documento imprime el promedio por intervención', HTML.includes('$215,20'));
ok('el documento trae las 9 intervenciones',
  (HTML.match(/class="desc"/g) || []).length === 9,
  String((HTML.match(/class="desc"/g) || []).length));
ok('el documento trae la línea de insumos', HTML.includes('Insumos:'));
ok('el documento trae el horómetro y el próximo servicio', HTML.includes('1.498,7 hrs'));
ok('el documento trae las recomendaciones', HTML.includes('Lubricar orugas cada 50 horas.'));
ok('el documento trae las dos firmas',
  HTML.includes('Jefa de Almacén y Compras') && HTML.includes('Propietario de la maquinaria'));
ok('⭐ sin fotos cargadas deja los recuadros para pegarlas',
  HTML.includes('Insertar foto antes / durante'));

// Con fotos cargadas, van las fotos y NO el recuadro de esa intervención.
const CON_FOTO = I.informeTecnicoHtml({
  equipo: EQUIPO, cabecera: CAB,
  items: [{ ...JUMBO[0], photos: ['https://x/antes.jpg', 'https://x/despues.jpg'] }],
});
ok('⭐ con fotos cargadas, el informe las imprime',
  CON_FOTO.includes('https://x/antes.jpg') && CON_FOTO.includes('https://x/despues.jpg'));
ok('y ya no pide pegar una foto a mano', !CON_FOTO.includes('Insertar foto antes'));

// La sección fotográfica se puede apagar, y entonces las secciones se renumeran.
const SIN_FOTOS = I.informeTecnicoHtml({ equipo: EQUIPO, items: JUMBO, cabecera: { ...CAB, conFotos: false } });
ok('apagar el registro fotográfico lo quita', !/REGISTRO FOTOGR/i.test(SIN_FOTOS.replace(/<[^>]+>/g, ' ')));
ok('⭐ y renumera: conclusiones pasa a ser la 5', SIN_FOTOS.includes('5. Conclusiones'));
ok('⭐ y firmas pasa a ser la 6', SIN_FOTOS.includes('6. Firmas'));
ok('con fotos, conclusiones es la 6 y firmas la 7',
  HTML.includes('6. Conclusiones') && HTML.includes('7. Firmas'));

// Sin intervenciones el documento SALE IGUAL, diciendo que no hay — no se rompe
// ni se queda en blanco a mitad de página.
const VACIO = I.informeTecnicoHtml({ equipo: EQUIPO, items: [], cabecera: CAB });
ok('⭐ sin intervenciones el informe igual se emite y lo dice',
  VACIO.includes('No hay intervenciones registradas'));
ok('sin intervenciones los totales salen en cero', VACIO.includes('$0,00'));

// ⭐ Escape: todo lo que escribe el usuario termina en este HTML.
const RARO = I.informeTecnicoHtml({
  equipo: { code: '<img src=x onerror=1>', companyName: '"Golden"' },
  items: [{ service_date: '2026-09-01', problem: '<script>alert(1)</script>', technician: '<b>x</b>',
            parts: [{ description: '<i>tuerca</i>', unit_cost: 1 }] }],
  cabecera: { ...CAB, dirigidoA: '<script>y</script>', recomendaciones: ['<script>z</script>'] },
});
ok('⭐ el texto del usuario va escapado', !RARO.includes('<script>'), 'hay <script> sin escapar');
ok('⭐ una imagen inyectada no se cuela', !RARO.includes('<img src=x'));
ok('⭐ el HTML del repuesto va escapado', !RARO.includes('<i>tuerca</i>'));

eq('nombre de archivo lleva el equipo y el correlativo',
  I.nombreArchivoInforme({ code: 'JUMBO 320' }, 'IT-2026-001'), 'Informe tecnico JUMBO 320 IT-2026-001');

// ── Resultado ───────────────────────────────────────────────────────────────
console.log('\nINFORME TÉCNICO — costos, totales consolidados y documento\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-informe-tecnico · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
