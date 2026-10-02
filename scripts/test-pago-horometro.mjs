/*
 * Test del CONTROL DE HORÓMETROS (`src/lib/pagoHorometro.ts`) — 02-oct-2026.
 *
 * QUÉ PEDIDO CUBRE, textual
 *   «crear otro apartado como el de control de las jornadas, pero para los
 *   horómetros, para colocar los precios (…) la idea es que los dos existan y
 *   que puedan usar los dos sin que choque (…) poder asignar los precios también
 *   en un rango en específico (…) y con eso tener también un reporte aparte de
 *   los pagos que corresponde en base a los horómetros».
 *
 * LO QUE BLINDA — y por qué cada cosa
 *   · ⭐ LOS DOS CONTROLES NO SE TOCAN. Este módulo no puede leer ni escribir
 *     machine_rounds, price_per_hour ni los cierres de Control de jornadas.
 *   · ⭐ EL PRECIO DE CADA DÍA ES EL QUE REGÍA ESE DÍA. Cambiar el precio hoy no
 *     puede reescribir lo ya trabajado; un rango blindado manda sobre el abierto.
 *   · ⭐ NADA SE INVENTA. Sin lectura = 0 h; inválida = 0 h con alerta; horas sin
 *     precio = $0 con alerta. Nunca se cae a las horas de la jornada.
 *   · LO OCULTO NO DEJA RASTRO en el papel (regla de la casa).
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

const srcPath = path.join(ROOT, 'src/lib/pagoHorometro.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const P = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); } };
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 1) EL PRECIO QUE RIGE CADA DÍA ──────────────────────────────────────────
const precio = (id, maq, p, desde, hasta = null, extra = {}) => ({ id, machinery_id: maq, precio_hora: p, desde, hasta, created_at: `2026-09-01T00:00:0${id.length}Z`, ...extra });
const PRECIOS = [
  precio('a', 'm1', 10, '2026-09-01'),
  precio('bb', 'm1', 12, '2026-09-15'),                    // sube desde el 15
  precio('ccc', 'm1', 20, '2026-09-20', '2026-09-22'),     // blindado 20–22
  precio('dddd', 'm1', 99, '2026-09-10', null, { anulada_at: '2026-09-11T00:00:00Z' }),
  precio('e', 'm2', 8, '2026-09-10'),
];
const pr = (maq, f) => { const x = P.precioHoraEn(PRECIOS, maq, f); return x ? Number(x.precio_hora) : null; };
eq('antes del primer precio no hay precio', pr('m1', '2026-08-31'), null);
eq('rige el primero desde su fecha', pr('m1', '2026-09-01'), 10);
eq('⭐ el día anterior al cambio sigue con el precio viejo', pr('m1', '2026-09-14'), 10);
eq('⭐ el cambio rige desde su fecha, no antes', pr('m1', '2026-09-15'), 12);
eq('⭐ el BLINDADO manda sobre el abierto dentro de su rango', [pr('m1', '2026-09-20'), pr('m1', '2026-09-22')], [20, 20]);
eq('⭐ …y al terminar el rango vuelve el abierto', pr('m1', '2026-09-23'), 12);
eq('⭐ un precio ANULADO no cuenta', pr('m1', '2026-09-12'), 10);
eq('cada máquina tiene el suyo', [pr('m2', '2026-09-12'), pr('m2', '2026-09-09'), pr('m9', '2026-09-12')], [8, null, null]);
eq('entre dos del mismo «desde», gana el último guardado',
  Number(P.precioHoraEn([precio('a', 'm1', 5, '2026-09-01'), precio('bb', 'm1', 7, '2026-09-01')], 'm1', '2026-09-02').precio_hora), 7);
eq('un precio 0 no cuenta', P.precioHoraEn([precio('a', 'm1', 0, '2026-09-01')], 'm1', '2026-09-02'), null);
eq('nada no revienta', P.precioHoraEn(null, 'm1', '2026-09-02'), null);

// Validación.
eq('precio válido pasa', P.validarPrecioHorometro({ precio: '12,5', desde: '2026-09-01' }), null);
ok('precio 0 se rechaza', /mayor que 0/.test(P.validarPrecioHorometro({ precio: 0, desde: '2026-09-01' })));
ok('sin fecha se rechaza', /fecha desde/.test(P.validarPrecioHorometro({ precio: 5, desde: '' })));
ok('«hasta» antes de «desde» se rechaza', /no puede ser anterior/.test(P.validarPrecioHorometro({ precio: 5, desde: '2026-09-10', hasta: '2026-09-01' })));
ok('un precio absurdo se rechaza', /demasiado alto/.test(P.validarPrecioHorometro({ precio: 5000000, desde: '2026-09-10' })));

// ── 2) LAS HORAS DEL DÍA ────────────────────────────────────────────────────
const L = (maq, fecha, shift, inicial, final, extra = {}) => ({ machineryId: maq, roundDate: fecha, shift, inicial, final, valida: true, motivoInvalida: null, ...extra });
eq('⭐ sin lecturas → 0 h, «sin lectura», sin alerta', P.horasDelDia([]), { horas: 0, estado: 'sin_lectura', detalle: '', inicial: null, final: null, ajustado: false, motivoAjuste: '' });
eq('un turno completo', P.horasDelDia([L('m1', '2026-09-01', 'day', 100, 108.5)]), { horas: 8.5, estado: 'ok', detalle: '', inicial: 100, final: 108.5, ajustado: false, motivoAjuste: '' });
eq('⭐ dos turnos se SUMAN (día + noche)', P.horasDelDia([L('m1', '2026-09-01', 'night', 108, 112), L('m1', '2026-09-01', 'day', 100, 108)]), { horas: 12, estado: 'ok', detalle: '', inicial: 100, final: 112, ajustado: false, motivoAjuste: '' });
eq('⭐ una INVÁLIDA deja el día en 0, con su razón',
  P.horasDelDia([L('m1', '2026-09-01', 'day', 100, 108), L('m1', '2026-09-01', 'night', 108, 90, { valida: false, motivoInvalida: 'final menor que inicial' })]),
  { horas: 0, estado: 'invalida', detalle: 'final menor que inicial', inicial: 100, final: 90, ajustado: false, motivoAjuste: '' });
eq('⭐ un turno INCOMPLETO vale 0 y lo dice; el completo sí cuenta',
  P.horasDelDia([L('m1', '2026-09-01', 'day', 100, 108), L('m1', '2026-09-01', 'night', 108, null)]),
  { horas: 8, estado: 'incompleta', detalle: 'noche: falta el final', inicial: 100, final: 108, ajustado: false, motivoAjuste: '' });
eq('solo un inicial: 0 h, incompleta', P.horasDelDia([L('m1', '2026-09-01', 'day', 100, null)]).estado, 'incompleta');
eq('nunca da horas negativas', P.horasDelDia([L('m1', '2026-09-01', 'day', 100, 90)]).horas, 0);

// ── 3) EL PAGO ──────────────────────────────────────────────────────────────
const MAQ = [
  { id: 'm1', code: 'RETRO-01', placa: 'A1', empresa: 'EMPRESA ALFA', clasificacion: 'Tierra', marca: 'CAT', modelo: '320' },
  { id: 'm2', code: 'JUMBO-02', placa: 'B2', empresa: 'EMPRESA BETA', clasificacion: 'Tierra', marca: 'XCMG', modelo: 'X1' },
  { id: 'm3', code: 'SIN-LECT', placa: 'C3', empresa: 'EMPRESA ALFA', clasificacion: 'Tierra', marca: '', modelo: '' },
  { id: 'm4', code: 'SIN-PRECIO', placa: 'D4', empresa: 'EMPRESA BETA', clasificacion: 'Tierra', marca: '', modelo: '' },
];
const LECT = [
  L('m1', '2026-09-14', 'day', 100, 108),   // 8 h × 10
  L('m1', '2026-09-15', 'day', 108, 118),   // 10 h × 12  (cambió el precio)
  L('m1', '2026-09-16', 'day', 118, 110, { valida: false, motivoInvalida: 'final menor que inicial' }),
  L('m2', '2026-09-14', 'day', 50, 56),     // 6 h × 8
  L('m4', '2026-09-14', 'day', 1, 5),       // 4 h sin precio
  L('m1', '2026-09-30', 'day', 1, 9),       // fuera del rango
];
const filas = P.filasPagoHorometro({ maquinas: MAQ, lecturas: LECT, precios: PRECIOS, desde: '2026-09-14', hasta: '2026-09-16' });
eq('⭐ entran solo las máquinas con lectura en el rango, por empresa y código', filas.map((f) => f.maquina.code), ['RETRO-01', 'JUMBO-02', 'SIN-PRECIO']);
const f1 = filas.find((f) => f.maquina.id === 'm1');
eq('⭐ cada día se paga con SU precio (8×10 + 10×12 = 200)', [f1.horas, f1.monto, f1.variosPrecios], [18, 200, true]);
eq('el día inválido vale 0 y cuenta como alerta', [f1.dias[2].horas, f1.dias[2].monto, f1.alertas], [0, 0, 1]);
eq('una fila por cada día del rango', f1.dias.map((d) => d.fecha), ['2026-09-14', '2026-09-15', '2026-09-16']);
const f4 = filas.find((f) => f.maquina.id === 'm4');
eq('⭐ horas sin precio → $0, con alerta (no se inventa un precio)', [f4.horas, f4.monto, f4.alertas, f4.dias[0].sinPrecio, f4.precioVigente], [4, 0, 1, true, null]);
const tot = P.totalPagoHorometro(filas);
eq('⭐ el total suma lo de todas', tot, { maquinas: 3, horas: 28, monto: 248, alertas: 2, sinPrecio: 1 });
eq('por empresa, con subtotal', P.pagoPorEmpresa(filas).map((e) => [e.empresa, e.total.monto]), [['EMPRESA ALFA', 200], ['EMPRESA BETA', 48]]);
eq('⭐ la suma por empresa = el total', P.pagoPorEmpresa(filas).reduce((a, e) => a + e.total.monto, 0), tot.monto);
eq('rango al revés → nada', P.filasPagoHorometro({ maquinas: MAQ, lecturas: LECT, precios: PRECIOS, desde: '2026-09-16', hasta: '2026-09-14' }), []);
eq('los días del rango, ambos inclusive', P.diasDelRango('2026-09-29', '2026-10-02'), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
ok('un rango enorme se topa (no arma miles de columnas)', P.diasDelRango('2026-01-01', '2026-12-31').length === 92);

// ── 4) EL PAPEL ─────────────────────────────────────────────────────────────
const D = { desde: '2026-09-14', hasta: '2026-09-16', filas };
const papel = P.cuerpoPagoHorometro(D);
ok('trae el resumen por empresa y el total a pagar', /Resumen por empresa/.test(papel) && /EMPRESA ALFA/.test(papel) && /TOTAL A PAGAR/.test(papel));
ok('⭐ el total del papel es el del cálculo', papel.includes(P.usd(248)));
ok('el listado por máquina trae horas, precio y monto', /Pago por máquina/.test(papel) && /RETRO-01/.test(papel) && /Precio\/h/.test(papel));
ok('una máquina con dos precios en el rango dice «varios»', />varios</.test(papel));
ok('⭐ el detalle día por día nace OCULTO', !/Detalle día por día/.test(papel));
ok('…y se enciende con su pastilla', /Detalle día por día/.test(P.cuerpoPagoHorometro(D, { ...P.OPCIONES_PAGO_HOROMETRO, sinDias: false })));
ok('los días por revisar salen con su motivo', /Días por revisar \(2\)/.test(papel) && /Inválida: final menor que inicial/.test(papel) && /no hay precio por hora/.test(papel));
// ⭐ LO OCULTO NO DEJA RASTRO.
const sinEmp = P.cuerpoPagoHorometro(D, { ...P.OPCIONES_PAGO_HOROMETRO, sinEmpresas: true });
ok('⭐ sin empresas: ni la columna, ni el cuadro, ni el nombre', !/Empresa/.test(sinEmp) && !sinEmp.includes('EMPRESA ALFA'));
const sinPrecio = P.cuerpoPagoHorometro(D, { ...P.OPCIONES_PAGO_HOROMETRO, sinPrecio: true });
ok('⭐ sin precio: ni la columna ni el número', !/Precio\/h/.test(sinPrecio) && !/>varios</.test(sinPrecio));
const sinPlaca = P.cuerpoPagoHorometro(D, { ...P.OPCIONES_PAGO_HOROMETRO, sinPlaca: true });
ok('sin placa: ni la columna ni el dato', !/Serial \/ Placa/.test(sinPlaca) && !/<td>A1<\/td>/.test(sinPlaca));
const nada = P.cuerpoPagoHorometro(D, { sinMarca: true, sinModelo: true, sinPlaca: true, sinEmpresas: true, sinPrecio: true, sinResumen: true, sinListado: true, sinDias: true, sinInicioFin: true, sinAlertas: true });
ok('⭐ todo apagado: el papel no dice «oculto» ni deja celdas vacías', !/ocult/i.test(nada) && !/<td><\/td>/.test(nada));
ok('sin lecturas, el papel lo dice', /Sin lecturas de horómetro en el rango/.test(P.cuerpoPagoHorometro({ desde: '2026-09-14', hasta: '2026-09-16', filas: [] })));
eq('el archivo de siempre no lleva sufijo', P.sufijoArchivoPagoHorometro(P.OPCIONES_PAGO_HOROMETRO), '');
ok('…y dice lo que se cambió', /con dias/.test(P.sufijoArchivoPagoHorometro({ ...P.OPCIONES_PAGO_HOROMETRO, sinDias: false })) && /sin placa/.test(P.sufijoArchivoPagoHorometro({ ...P.OPCIONES_PAGO_HOROMETRO, sinPlaca: true })));
ok('el texto del usuario va escapado', !P.cuerpoPagoHorometro({ ...D, filas: [{ ...f1, maquina: { ...f1.maquina, code: '<script>x</script>' } }] }).includes('<script>'));

// ── 5) ⭐ LOS DOS CONTROLES NO SE TOCAN ──────────────────────────────────────
{
  const lib = sinComentarios(leer('src/lib/pagoHorometro.ts'));
  ok('⭐ la librería es pura: sin imports', !/^\s*import\s/m.test(lib));
  ok('⭐ …y no nombra las tablas de Control de jornadas', !/machine_rounds|control_closures|price_per_hour|machinery_precio_historial/.test(lib));
  const db = sinComentarios(leer('src/lib/pagoHorometroDb.ts'));
  ok('⭐ la capa de datos NO lee ni escribe rondas ni cierres de Control', !/machine_rounds|control_closures|machinery_precio_historial/.test(db));
  ok('⭐ el precio de Control de jornadas solo se LEE como referencia', /precioJornada/.test(db) && !/from\('machinery'\)\s*\.\s*(update|insert|upsert)/.test(db));
  ok('⭐ escribe SOLO en sus tres tablas propias', (db.match(/from\('([a-z_]+)'\)/g) || []).every((t) => ["from('horometro_precios')", "from('horometro_ajustes')", "from('horometro_cierres')"].includes(t)));
  ok('⭐ los ajustes NO tocan las lecturas del inspector', !/lecturas_horometro_trabajo/.test(db));
  ok('un precio no se borra: se anula', !/\.delete\(/.test(db) && /anulada_at/.test(db));
  const panel = sinComentarios(leer('src/components/ControlHorometrosPanel.tsx'));
  ok('⭐ el panel no escribe en las rondas ni usa el precio de la jornada para calcular',
    !/machine_rounds|upsertMachineRound|control_closures/.test(panel) && /filasPagoHorometro\(/.test(panel));
  ok('el panel avisa si falta la tabla de precios', /faltaSql/.test(panel));
  const ctrl = leer('src/screens/ControlMaquinariaScreen.tsx');
  ok('⭐ Control de jornadas solo gana el botón que abre el panel', /ControlHorometrosPanel/.test(ctrl) && /Control de horómetros/.test(ctrl));
}


// ── 6) 🧾 AJUSTES «SOLO PARA CONTROL DE HORÓMETROS» ──────────────────────────
// Pedido (02-oct-2026): «tener la opción de que ese horómetro que yo cargue desde
// control de horómetros me salga SOLO para el reporte de horómetros, o que me
// modifique el que cargó el inspector en ese día en específico».
{
  const aj = (id, maq, fecha, shift, inicial, final, extra = {}) => ({ id, machinery_id: maq, round_date: fecha, shift, inicial, final, motivo: 'tecleo', created_at: '2026-09-20T00:00:0' + id.length + 'Z', ...extra });
  const base = [L('m1', '2026-09-14', 'day', 100, 108)];
  // Sin ajustes, vale lo del inspector.
  eq('sin ajustes, valen las lecturas tal cual', P.lecturasEfectivas(base, []).map((l) => [l.inicial, l.final, !!l.ajustada]), [[100, 108, false]]);
  // ⭐ Con ajuste activo, MANDA el ajuste para ese turno.
  const ef = P.lecturasEfectivas(base, [aj('a', 'm1', '2026-09-14', 'day', 100, 110)]);
  eq('⭐ el ajuste MANDA sobre la lectura del inspector', ef.map((l) => [l.inicial, l.final, l.ajustada, l.motivoAjuste]), [[100, 110, true, 'tecleo']]);
  ok('⭐ …y NO muta la lectura original', base[0].final === 108 && base[0].ajustada === undefined);
  eq('⭐ un ajuste ANULADO no cuenta: vuelve a valer lo del inspector',
    P.lecturasEfectivas(base, [aj('a', 'm1', '2026-09-14', 'day', 100, 110, { anulada_at: '2026-09-21T00:00:00Z' })]).map((l) => l.final), [108]);
  eq('entre dos ajustes activos manda el más nuevo',
    P.lecturasEfectivas(base, [aj('a', 'm1', '2026-09-14', 'day', 100, 110), aj('bb', 'm1', '2026-09-14', 'day', 100, 111)]).map((l) => l.final), [111]);
  eq('⭐ el ajuste de un turno NO toca el otro turno',
    P.lecturasEfectivas([...base, L('m1', '2026-09-14', 'night', 108, 112)], [aj('a', 'm1', '2026-09-14', 'day', 100, 109)]).map((l) => [l.shift, l.final]), [['day', 109], ['night', 112]]);
  eq('⭐ un ajuste para un día SIN lectura del inspector también entra',
    P.lecturasEfectivas([], [aj('a', 'm2', '2026-09-15', 'day', 50, 57)]).map((l) => [l.machineryId, l.roundDate, l.inicial, l.final, l.ajustada]), [['m2', '2026-09-15', 50, 57, true]]);
  eq('un ajuste arregla una lectura INVÁLIDA (el día vuelve a contar)',
    P.horasDelDia(P.lecturasEfectivas([L('m1', '2026-09-14', 'day', 100, 90, { valida: false, motivoInvalida: 'final menor que inicial' })], [aj('a', 'm1', '2026-09-14', 'day', 100, 109)])),
    { horas: 9, estado: 'ok', detalle: '', inicial: 100, final: 109, ajustado: true, motivoAjuste: 'tecleo' });
  // En el pago.
  const conAj = P.filasPagoHorometro({ maquinas: MAQ, lecturas: LECT, precios: PRECIOS, desde: '2026-09-14', hasta: '2026-09-16', ajustes: [aj('a', 'm1', '2026-09-14', 'day', 100, 110)] });
  const g1 = conAj.find((f) => f.maquina.id === 'm1');
  eq('⭐ el pago usa el ajuste (10 h × 10 + 10 h × 12 = 220)', [g1.horas, g1.monto, g1.dias[0].ajustado], [20, 220, true]);
  eq('⭐ sin pasar ajustes, el pago es el de las lecturas (200)', P.filasPagoHorometro({ maquinas: MAQ, lecturas: LECT, precios: PRECIOS, desde: '2026-09-14', hasta: '2026-09-16' }).find((f) => f.maquina.id === 'm1').monto, 200);
  const soloAj = P.filasPagoHorometro({ maquinas: MAQ, lecturas: [], precios: PRECIOS, desde: '2026-09-14', hasta: '2026-09-16', ajustes: [aj('a', 'm3', '2026-09-15', 'day', 1, 5)] });
  eq('⭐ una máquina que solo tiene AJUSTE (sin lecturas) también entra', soloAj.map((f) => [f.maquina.code, f.horas]), [['SIN-LECT', 4]]);
  // En el papel.
  const papelAj = P.cuerpoPagoHorometro({ desde: '2026-09-14', hasta: '2026-09-16', filas: conAj }, { ...P.OPCIONES_PAGO_HOROMETRO, sinDias: false });
  ok('⭐ el día ajustado se dice en el detalle, con su motivo', /🧾 ajustado en Control de horómetros: tecleo/.test(papelAj));
  // Validación.
  eq('un ajuste válido pasa', P.validarAjusteHorometro({ inicial: '100', final: '108,5', motivo: 'x' }), null);
  ok('sin motivo se rechaza', /motivo/.test(P.validarAjusteHorometro({ inicial: 1, final: 2, motivo: ' ' })));
  ok('sin los dos números se rechaza', /inicial y el final/.test(P.validarAjusteHorometro({ inicial: '', final: 2, motivo: 'x' })));
  ok('final menor que inicial se rechaza', /no puede ser menor/.test(P.validarAjusteHorometro({ inicial: 10, final: 2, motivo: 'x' })));
  ok('más de 24 h en un turno se rechaza', /24 horas/.test(P.validarAjusteHorometro({ inicial: 0, final: 30, motivo: 'x' })));
  // El modal de los dos destinos, por su código.
  const modal = sinComentarios(leer('src/components/HorometroAjusteModal.tsx'));
  ok('⭐ el modal ofrece los DOS destinos', /Solo para Control de horómetros/.test(modal) && /Cambiar la lectura del inspector/.test(modal));
  ok('⭐ «solo para horómetros» guarda en la tabla de ajustes, no en la lectura', /destino === 'horometros'[\s\S]*?guardarAjusteHorometro\(/.test(modal));
  ok('⭐ «cambiar la del inspector» usa la corrección de Control (origen control)', /guardarLecturaHorometro\(machineryId, fecha, turno/.test(modal) && /origen: 'control'/.test(modal));
  ok('⭐ el destino «inspector» solo se ofrece a quien puede corregir', /\{puedeCambiarInspector \? \(/.test(modal));
  ok('al cambiar la del inspector se quita el ajuste que la taparía', /if \(ajusteVigente\) await anularAjustesHorometro\(/.test(modal));
  ok('el ajuste se puede quitar (vuelve lo del inspector)', /Quitar el ajuste/.test(modal));
  const panel2 = sinComentarios(leer('src/components/ControlHorometrosPanel.tsx'));
  ok('⭐ el panel pasa los ajustes al cálculo y abre el modal de dos destinos', /filasPagoHorometro\(\{ maquinas, lecturas, precios, desde, hasta, ajustes, cierres \}\)/.test(panel2) && /HorometroAjusteModal/.test(panel2));
}


// ── 7) ➕ LAS MÁQUINAS SIN LECTURAS EN EL RANGO ───────────────────────────────
// Pedido (02-oct-2026): «coloca… listar también las máquinas sin lecturas».
{
  const base = { maquinas: MAQ, lecturas: LECT, precios: PRECIOS, desde: '2026-09-14', hasta: '2026-09-16' };
  eq('por defecto NO sale la que no tiene lecturas', P.filasPagoHorometro(base).some((f) => f.maquina.id === 'm3'), false);
  const con = P.filasPagoHorometro({ ...base, incluirSinLectura: new Set(['m3']) });
  const f3 = con.find((f) => f.maquina.id === 'm3');
  ok('⭐ pidiéndola, SÍ sale — con 0 h y $0', !!f3 && f3.horas === 0 && f3.monto === 0 && f3.alertas === 0);
  eq('⭐ …y NO mueve el total a pagar', P.totalPagoHorometro(con).monto, P.totalPagoHorometro(P.filasPagoHorometro(base)).monto);
  ok('solo entran las que se piden, no todo el catálogo', con.length === P.filasPagoHorometro(base).length + 1);
  const db7 = sinComentarios(leer('src/lib/pagoHorometroDb.ts'));
  ok('⭐ «activa» usa la vara de Control: operativa y no en espera', /activa: m\.operational !== false && m\.en_espera !== true/.test(db7));
  const panel7 = sinComentarios(leer('src/components/ControlHorometrosPanel.tsx'));
  ok('el panel ofrece el interruptor y nace APAGADO', /Incluir las máquinas sin lecturas en el rango/.test(panel7) && /const \[incluirSin, setIncluirSin\] = useState\(false\)/.test(panel7));
  ok('⭐ lo que se CIERRA es lo que tiene lecturas, no las agregadas para ver', /crearCierreHorometro\(\{ desde, hasta, filas: filasConAlgo/.test(panel7));
}

// ── 8) 🔒 CIERRES CON HISTÓRICO ──────────────────────────────────────────────
// Pedido (02-oct-2026): «coloca los cierres con histórico (como "Cerrar control"
// de jornadas)». Cerrar guarda la FOTO del pago; los días cerrados se leen de la
// foto y no cambian aunque después se toque un precio, una lectura o un ajuste.
{
  const base = { maquinas: MAQ, lecturas: LECT, precios: PRECIOS, desde: '2026-09-14', hasta: '2026-09-16' };
  const vivas = P.filasPagoHorometro(base);
  const cierre = (id, desde, hasta, detalle, extra = {}) => ({ id, desde, hasta, total_horas: 0, total_monto: 0, maquinas: detalle.length, detalle, created_at: '2026-09-17T00:00:00Z', ...extra });
  const C1 = cierre('c1', '2026-09-14', '2026-09-15', JSON.parse(JSON.stringify(vivas)));

  // ⭐ Lo cerrado sale de la FOTO: cambiar el precio después no lo mueve.
  const preciosNuevos = [...PRECIOS, { id: 'zzzzz', machinery_id: 'm1', precio_hora: 1000, desde: '2026-09-01', hasta: '2026-09-30', created_at: '2026-09-18T00:00:00Z' }];
  const trasCambio = P.filasPagoHorometro({ ...base, precios: preciosNuevos, cierres: [C1] }).find((f) => f.maquina.id === 'm1');
  eq('⭐ los días CERRADOS conservan su monto aunque el precio cambie después', [trasCambio.dias[0].monto, trasCambio.dias[1].monto, trasCambio.dias[0].cerrado], [80, 120, true]);
  eq('⭐ …y sin el cierre, ese mismo cambio SÍ los movería', P.filasPagoHorometro({ ...base, precios: preciosNuevos }).find((f) => f.maquina.id === 'm1').dias[0].monto, 8000);
  // ⭐ Y tampoco los mueve una lectura corregida después.
  const lectCambiadas = LECT.map((l) => (l.machineryId === 'm1' && l.roundDate === '2026-09-14' ? { ...l, final: 200 } : l));
  eq('⭐ ni una lectura corregida después', P.filasPagoHorometro({ ...base, lecturas: lectCambiadas, cierres: [C1] }).find((f) => f.maquina.id === 'm1').dias[0].horas, 8);
  eq('⭐ ni un ajuste puesto después', P.filasPagoHorometro({ ...base, cierres: [C1], ajustes: [{ id: 'a', machinery_id: 'm1', round_date: '2026-09-14', shift: 'day', inicial: 0, final: 20, motivo: 'x', created_at: '2026-09-18T00:00:00Z' }] }).find((f) => f.maquina.id === 'm1').dias[0].horas, 8);
  // El día fuera del cierre sigue vivo.
  const m1 = P.filasPagoHorometro({ ...base, cierres: [C1] }).find((f) => f.maquina.id === 'm1');
  eq('el día FUERA del cierre sigue en vivo', [m1.dias[2].cerrado, m1.dias[2].estado], [false, 'invalida']);
  eq('⭐ un día cerrado NO cuenta como alerta (ya no hay nada que arreglarle)', P.filasPagoHorometro({ ...base, cierres: [cierre('c2', '2026-09-14', '2026-09-16', JSON.parse(JSON.stringify(vivas)))] }).find((f) => f.maquina.id === 'm1').alertas, 0);
  // ⭐ Reabierto (anulado) = como si no existiera.
  eq('⭐ un cierre REABIERTO no congela nada', P.filasPagoHorometro({ ...base, precios: preciosNuevos, cierres: [{ ...C1, anulada_at: '2026-09-19T00:00:00Z' }] }).find((f) => f.maquina.id === 'm1').dias[0].monto, 8000);
  // Una máquina que ya no está en el catálogo sigue saliendo por su foto.
  eq('⭐ una máquina borrada del catálogo sigue en su cierre', P.filasPagoHorometro({ ...base, maquinas: MAQ.filter((m) => m.id !== 'm2'), lecturas: [], cierres: [C1] }).map((f) => f.maquina.code).includes('JUMBO-02'), true);
  // Un día cerrado sin foto para esa máquina = vacío y cerrado (no se recalcula).
  const C3 = cierre('c3', '2026-09-14', '2026-09-14', []);
  eq('⭐ un día cerrado NO se recalcula aunque haya lecturas', P.filasPagoHorometro({ ...base, cierres: [C3] }).find((f) => f.maquina.id === 'm1').dias[0], { horas: 0, estado: 'sin_lectura', detalle: '', inicial: null, final: null, ajustado: false, motivoAjuste: '', fecha: '2026-09-14', precio: null, monto: 0, sinPrecio: false, cerrado: true });

  // Solapes y validación.
  eq('el cierre que cubre una fecha', [P.cierreQueCubre([C1], '2026-09-15')?.id, P.cierreQueCubre([C1], '2026-09-16')], ['c1', null]);
  eq('un cierre reabierto no cubre nada', P.cierreQueCubre([{ ...C1, anulada_at: 'x' }], '2026-09-15'), null);
  eq('⭐ detecta el solape de rangos', [P.cierresSolapados([C1], '2026-09-15', '2026-09-20').length, P.cierresSolapados([C1], '2026-09-16', '2026-09-20').length], [1, 0]);
  ok('⭐ NO deja cerrar un rango que pisa otro cierre', /ya tiene días cerrados/.test(P.validarCierreHorometro({ desde: '2026-09-15', hasta: '2026-09-18', filas: vivas }, [C1])));
  eq('un rango libre con lecturas sí se puede cerrar', P.validarCierreHorometro({ desde: '2026-09-14', hasta: '2026-09-16', filas: vivas }, []), null);
  ok('sin lecturas no hay nada que cerrar', /No hay nada que cerrar/.test(P.validarCierreHorometro({ desde: '2026-09-14', hasta: '2026-09-16', filas: [] }, [])));
  ok('un rango al revés se rechaza', /no es válido/.test(P.validarCierreHorometro({ desde: '2026-09-16', hasta: '2026-09-14', filas: vivas }, [])));

  // El PDF del histórico sale de la foto.
  const delCierre = P.filasDeCierre(C1);
  eq('⭐ las filas del histórico salen de la FOTO, con sus totales recalculados', delCierre.map((f) => [f.maquina.code, f.monto]), vivas.map((f) => [f.maquina.code, f.monto]));
  ok('el papel del cierre se arma con el mismo cuerpo', /TOTAL A PAGAR/.test(P.cuerpoPagoHorometro({ desde: C1.desde, hasta: C1.hasta, filas: delCierre })));
  eq('una foto vacía o rota no revienta', [P.filasDeCierre(null), P.filasDeCierre({ ...C1, detalle: [{ dias: [] }] })], [[], []]);

  // La capa de datos y el panel.
  const db8 = sinComentarios(leer('src/lib/pagoHorometroDb.ts'));
  ok('⭐ el cierre NO toca los cierres de Control de jornadas', !/control_closures/.test(db8));
  ok('un cierre no se borra: se reabre anulándolo', /reabrirCierreHorometro/.test(db8) && !/\.delete\(/.test(db8));
  ok('solo se guardan en la foto las máquinas que tienen algo', /c\.filas\.filter\(\(f\) => f\.dias\.some\(\(d\) => d\.estado !== 'sin_lectura'\)\)/.test(db8));
  const panel8 = sinComentarios(leer('src/components/ControlHorometrosPanel.tsx'));
  ok('⭐ el panel valida el solape ANTES de cerrar y pide confirmación', /validarCierreHorometro\(\{ desde, hasta, filas: filasConAlgo \}, cierres\)/.test(panel8) && /await confirm\(/.test(panel8));
  ok('⭐ un día cerrado no se puede tocar', /disabled=\{!canEdit \|\| faltaSql \|\| d\.cerrado\}/.test(panel8));
  ok('el histórico ofrece el PDF y reabrir con motivo', /Histórico de cierres/.test(panel8) && /pdfDeCierre\(c\)/.test(panel8) && /Motivo para reabrir/.test(panel8));
}

console.log('\nCONTROL DE HORÓMETROS — pago por horómetro, al lado de Control de jornadas\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-pago-horometro · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
