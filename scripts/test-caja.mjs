/*
 * Test del MÓDULO DE CAJA (`src/lib/caja.ts`) — 22-sep-2026.
 *
 * QUÉ PEDIDO CUBRE (textual del cliente):
 *   «me vas a crear un modulo de caja. Todo lo que entra es por ventas, los ingresos»
 *
 * LO QUE BLINDA — y por qué cada cosa
 *   · ⭐ NO SE PUEDE FABRICAR UN INGRESO. `filaEgreso` es la única fila que este
 *     archivo sabe armar, y sale SIEMPRE como egreso manual. Si alguien le
 *     agrega un parámetro `tipo`, esta prueba se pone roja. (En la base la misma
 *     regla está dos veces más: un CHECK y la política de RLS.)
 *   · ⭐ CADA MÉTODO SE ARQUEA EN SU PROPIA MONEDA. El efectivo en dólares se
 *     cuenta en dólares; bolívares, pago móvil y transferencia se cuadran en
 *     BOLÍVARES. Mezclarlos convertiría dos bolívares de diferencia en un
 *     faltante de centavos imposible de rastrear.
 *   · ⭐ UN MÉTODO SIN CONTAR NO ES UN FALTANTE. Dejar el campo vacío informa
 *     «sin contar»; contar CERO sí es contar. Confundirlos manda a buscar plata
 *     que nunca faltó.
 *   · EL FONDO DE APERTURA SOLO SUMA AL EFECTIVO: una caja no se abre con saldo
 *     de Zelle — eso vive en el banco.
 *   · El signo de la diferencia: positivo SOBRA, negativo FALTA.
 *   · Los filtros del historial y el escape del acta.
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

const C = loadTs(path.join(ROOT, 'src/lib/caja.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); }
};

// ── 1) Números ──────────────────────────────────────────────────────────────
eq('money redondea a céntimos', C.money(0.1 + 0.2), 0.3);
eq('money de texto con coma', C.money('45,50'), 45.5);
eq('money de basura es 0', C.money('x'), 0);
eq('money de null es 0', C.money(null), 0);
eq('fmtUsd venezolano', C.fmtUsd(1936.84), '$1.936,84');
eq('fmtBs venezolano', C.fmtBs(4500), 'Bs 4.500,00');
eq('dmy', C.dmy('2026-09-22'), '22/09/2026');
eq('dmy de basura', C.dmy('x'), '—');

// ── 2) La moneda de cada método ─────────────────────────────────────────────
eq('efectivo $ se cuadra en dólares', C.MONEDA_METODO.efectivo_usd, 'usd');
eq('Zelle se cuadra en dólares', C.MONEDA_METODO.zelle, 'usd');
eq('USDT se cuadra en dólares', C.MONEDA_METODO.usdt, 'usd');
eq('⭐ bolívares se cuadra en bolívares', C.MONEDA_METODO.bs, 'bs');
eq('⭐ transferencia se cuadra en bolívares', C.MONEDA_METODO.transferencia, 'bs');
eq('⭐ pago móvil se cuadra en bolívares', C.MONEDA_METODO.pago_movil, 'bs');
ok('solo el efectivo está en la gaveta',
  C.esEfectivo('efectivo_usd') && C.esEfectivo('bs')
  && !C.esEfectivo('zelle') && !C.esEfectivo('transferencia') && !C.esEfectivo('pago_movil') && !C.esEfectivo('usdt'));

eq('monto nativo de un método en $', C.montoNativo({ metodo: 'zelle', monto: 100, monto_bs: 4000 }), 100);
eq('⭐ monto nativo de un método en Bs es el de Bs',
  C.montoNativo({ metodo: 'pago_movil', monto: 100, monto_bs: 4000 }), 4000);
eq('monto nativo de null', C.montoNativo(null), 0);

// ── 3) El día de caja ───────────────────────────────────────────────────────
// Tasa 40 Bs/$ en todo el ejemplo, para que las cuentas se puedan verificar a mano.
const SESION = {
  code: 'CAJA-0001', opened_at: '2026-09-22T08:00:00Z', opened_by_name: 'Diana De La Rans',
  apertura_usd: 50, apertura_bs: 2000, rate_bs: 40, estado: 'abierta',
};
const MOVS = [
  // Ventas de contado
  { tipo: 'ingreso', origen: 'venta', fecha: '2026-09-22', concepto: 'Venta VTA-0001 · Ferretería El Tornillo',
    metodo: 'efectivo_usd', monto: 120, monto_bs: 4800, rate_bs: 40, sale_id: 's1' },
  { tipo: 'ingreso', origen: 'venta', fecha: '2026-09-22', concepto: 'Venta VTA-0002 · Pedro Pérez',
    metodo: 'pago_movil', monto: 75, monto_bs: 3000, rate_bs: 40, sale_id: 's2' },
  { tipo: 'ingreso', origen: 'venta', fecha: '2026-09-22', concepto: 'Venta VTA-0003 · Luis Mora',
    metodo: 'zelle', monto: 200, monto_bs: 8000, rate_bs: 40, sale_id: 's3' },
  { tipo: 'ingreso', origen: 'venta', fecha: '2026-09-22', concepto: 'Venta VTA-0004 · Ana Ruiz',
    metodo: 'bs', monto: 25, monto_bs: 1000, rate_bs: 40, sale_id: 's4' },
  // Cobro de una venta a crédito (abono)
  { tipo: 'ingreso', origen: 'cobranza', fecha: '2026-09-22', concepto: 'Cobro · Venta VTA-0000 · Inversiones RM',
    metodo: 'transferencia', monto: 50, monto_bs: 2000, rate_bs: 40, abono_id: 'a1' },
  // Egresos
  { tipo: 'egreso', origen: 'manual', fecha: '2026-09-22', concepto: 'Tornillos y tacos',
    categoria: 'Compra menor', metodo: 'efectivo_usd', monto: 30, monto_bs: 1200, rate_bs: 40 },
  { tipo: 'egreso', origen: 'manual', fecha: '2026-09-22', concepto: 'Almuerzo del personal',
    categoria: 'Viático', metodo: 'bs', monto: 10, monto_bs: 400, rate_bs: 40 },
  { tipo: 'egreso', origen: 'manual', fecha: '2026-09-22', concepto: 'Gasoil de la camioneta',
    categoria: 'Combustible', metodo: 'efectivo_usd', monto: 20, monto_bs: 800, rate_bs: 40 },
];

const T = C.totalesPorMetodo(MOVS);
eq('⭐ salen SIEMPRE los seis métodos, aunque estén en cero', T.length, 6);
eq('los métodos salen en el orden del catálogo',
  T.map((x) => x.metodo), ['bs', 'transferencia', 'pago_movil', 'zelle', 'usdt', 'efectivo_usd']);

const porM = (k) => T.find((x) => x.metodo === k);
eq('efectivo $: entró 120', porM('efectivo_usd').ingresos, 120);
eq('efectivo $: salió 30 + 20 = 50', porM('efectivo_usd').egresos, 50);
eq('efectivo $: neto 70', porM('efectivo_usd').neto, 70);
eq('⭐ pago móvil se totaliza en BOLÍVARES (3.000), no en 75', porM('pago_movil').ingresos, 3000);
eq('⭐ bolívares: entró 1.000 y salió 400 → neto 600 Bs', porM('bs').neto, 600);
eq('transferencia (cobranza) en Bs', porM('transferencia').ingresos, 2000);
eq('zelle en dólares', porM('zelle').ingresos, 200);
eq('USDT no se movió', [porM('usdt').ingresos, porM('usdt').egresos, porM('usdt').neto], [0, 0, 0]);
eq('el total en $ del método en Bs se conserva aparte', porM('pago_movil').ingresosUsd, 75);
eq('totales de null no revienta', C.totalesPorMetodo(null).length, 6);

// ── 4) Lo esperado ──────────────────────────────────────────────────────────
const E = C.esperadoDe(SESION, MOVS);
const espM = (k) => E.find((x) => x.metodo === k);
eq('⭐ el fondo de apertura suma al efectivo $ (50 + 120 − 50)', espM('efectivo_usd').esperado, 120);
eq('⭐ el fondo de apertura suma a los bolívares (2.000 + 1.000 − 400)', espM('bs').esperado, 2600);
eq('⭐ Zelle NO tiene fondo de apertura', espM('zelle').apertura, 0);
eq('⭐ transferencia NO tiene fondo de apertura', espM('transferencia').apertura, 0);
eq('esperado de Zelle = lo que entró', espM('zelle').esperado, 200);
eq('esperado de pago móvil = 3.000 Bs', espM('pago_movil').esperado, 3000);
eq('esperado sin sesión no revienta', C.esperadoDe(null, MOVS).find((x) => x.metodo === 'bs').esperado, 600);

// ── 5) EL ARQUEO ────────────────────────────────────────────────────────────
// Cuadra clavado.
const A1 = C.arqueoDe(SESION, MOVS, { efectivo_usd: 120, bs: 2600, pago_movil: 3000, zelle: 200, transferencia: 2000, usdt: 0 });
ok('⭐ contando exacto, TODAS las diferencias son 0', A1.every((l) => l.diferencia === 0), JSON.stringify(A1.map((l) => [l.metodo, l.diferencia])));
ok('y todas quedan marcadas como contadas', A1.every((l) => l.seConto));

// Falta y sobra.
const A2 = C.arqueoDe(SESION, MOVS, { efectivo_usd: 115, bs: 2650 });
eq('⭐ faltan 5 → diferencia NEGATIVA', A2.find((l) => l.metodo === 'efectivo_usd').diferencia, -5);
eq('⭐ sobran 50 Bs → diferencia POSITIVA', A2.find((l) => l.metodo === 'bs').diferencia, 50);

// ⭐ Lo que NO se contó.
eq('⭐ un método sin contar NO es un faltante (diferencia 0)',
  A2.find((l) => l.metodo === 'zelle').diferencia, 0);
ok('⭐ y queda marcado como «sin contar»', A2.find((l) => l.metodo === 'zelle').seConto === false);
ok('⭐ contar CERO sí es contar (se distingue del vacío)',
  C.arqueoDe(SESION, MOVS, { zelle: 0 }).find((l) => l.metodo === 'zelle').seConto === true);
eq('⭐ y contar cero con 200 esperados SÍ es un faltante de 200',
  C.arqueoDe(SESION, MOVS, { zelle: 0 }).find((l) => l.metodo === 'zelle').diferencia, -200);
ok('la cadena vacía cuenta como «sin contar», no como cero',
  C.arqueoDe(SESION, MOVS, { zelle: '' }).find((l) => l.metodo === 'zelle').seConto === false);
eq('el conteo acepta texto con coma decimal',
  C.arqueoDe(SESION, MOVS, { efectivo_usd: '119,50' }).find((l) => l.metodo === 'efectivo_usd').diferencia, -0.5);
eq('arqueo sin conteo no revienta', C.arqueoDe(SESION, MOVS, null).length, 6);
eq('arqueo de todo null no revienta', C.arqueoDe(null, null, null).length, 6);

// ── 6) El resumen ───────────────────────────────────────────────────────────
const R = C.resumenCaja(MOVS);
eq('entró en $: 120 + 75 + 200 + 25 + 50', R.ingresos, 470);
eq('salió en $: 30 + 10 + 20', R.egresos, 60);
eq('saldo del movimiento', R.saldo, 410);
eq('entró en Bs', R.ingresosBs, 18800);
eq('saldo en Bs', R.saldoBs, 16400);
eq('cuenta los movimientos', R.movimientos, 8);
eq('cuenta cuántas fueron ventas de contado', R.porVenta, 4);
eq('cuenta cuántos fueron cobros', R.porCobranza, 1);
eq('resumen de null no revienta', C.resumenCaja(null).saldo, 0);
eq('resumen vacío no da NaN', C.resumenCaja([]), {
  ingresos: 0, egresos: 0, saldo: 0, ingresosBs: 0, egresosBs: 0, saldoBs: 0,
  movimientos: 0, porVenta: 0, porCobranza: 0,
});

const CAT = C.porCategoria(MOVS);
eq('⭐ las categorías son SOLO de egresos', CAT.map((c) => c.categoria), ['Compra menor', 'Combustible', 'Viático']);
eq('y van de mayor a menor', CAT.map((c) => c.usd), [30, 20, 10]);
eq('un egreso sin categoría no se pierde',
  C.porCategoria([{ tipo: 'egreso', origen: 'manual', metodo: 'bs', monto: 5 }])[0].categoria, 'Sin categoría');
eq('porCategoria de null no revienta', C.porCategoria(null), []);

// ── 7) ⭐ NO SE PUEDE FABRICAR UN INGRESO ───────────────────────────────────
const EG = C.filaEgreso({ concepto: 'Tornillos', categoria: 'Compra menor', metodo: 'efectivo_usd', monto: '30,50', fecha: '2026-09-22' }, 40, 'u1');
eq('⭐ la fila SIEMPRE sale como egreso', EG.tipo, 'egreso');
eq('⭐ y SIEMPRE con origen manual', EG.origen, 'manual');
ok('⭐ `filaEgreso` recibe UN solo argumento de datos, sin `tipo` (regla del cliente)',
  C.filaEgreso.length <= 3, `aridad=${C.filaEgreso.length}`);
ok('⭐ el módulo NO exporta forma alguna de armar un ingreso',
  !Object.keys(C).some((k) => /ingreso/i.test(k) && typeof C[k] === 'function'),
  Object.keys(C).filter((k) => /ingreso/i.test(k)).join(','));
eq('el monto acepta coma decimal', EG.monto, 30.5);
eq('el equivalente en Bs se congela con la tasa', EG.monto_bs, 1220);
eq('sin categoría va NULL, no ""', C.filaEgreso({ concepto: 'x', metodo: 'bs', monto: 1, fecha: '2026-09-22' }).categoria, null);
eq('sin tasa el equivalente en Bs es 0, no NaN',
  C.filaEgreso({ concepto: 'x', metodo: 'bs', monto: 10, fecha: '2026-09-22' }).monto_bs, 0);

eq('valida: sin concepto', C.validarEgreso({ metodo: 'bs', monto: 5, fecha: '2026-09-22' }), 'Escribe en qué se gastó.');
eq('valida: sin método', C.validarEgreso({ concepto: 'x', monto: 5, fecha: '2026-09-22' }), 'Elige con qué se pagó.');
eq('valida: método inventado', C.validarEgreso({ concepto: 'x', metodo: 'cripto', monto: 5, fecha: '2026-09-22' }), 'Elige con qué se pagó.');
eq('valida: monto en cero', C.validarEgreso({ concepto: 'x', metodo: 'bs', monto: 0, fecha: '2026-09-22' }), 'El monto tiene que ser mayor que cero.');
eq('valida: monto negativo', C.validarEgreso({ concepto: 'x', metodo: 'bs', monto: -5, fecha: '2026-09-22' }), 'El monto tiene que ser mayor que cero.');
eq('valida: sin fecha', C.validarEgreso({ concepto: 'x', metodo: 'bs', monto: 5 }), 'Selecciona la fecha.');
eq('valida: egreso correcto', C.validarEgreso({ concepto: 'x', metodo: 'bs', monto: 5, fecha: '2026-09-22' }), null);
eq('valida: null no revienta', C.validarEgreso(null), 'Escribe en qué se gastó.');

// ── 8) El historial ─────────────────────────────────────────────────────────
const CON_FECHAS = [
  { tipo: 'ingreso', origen: 'venta', fecha: '2026-09-20', metodo: 'bs', monto: 10, concepto: 'Venta VTA-0009 · Ana' },
  { tipo: 'egreso', origen: 'manual', fecha: '2026-09-21', metodo: 'zelle', monto: 5, concepto: 'Flete', categoria: 'Transporte / flete' },
  { tipo: 'ingreso', origen: 'cobranza', fecha: '2026-09-22', metodo: 'transferencia', monto: 8, concepto: 'Cobro · Venta VTA-0005 · Luis' },
];
eq('rango: ambos extremos incluidos', C.filtrarMovs(CON_FECHAS, { desde: '2026-09-20', hasta: '2026-09-22' }).length, 3);
eq('rango: recorta por abajo', C.filtrarMovs(CON_FECHAS, { desde: '2026-09-21' }).length, 2);
eq('rango: recorta por arriba', C.filtrarMovs(CON_FECHAS, { hasta: '2026-09-20' }).length, 1);
eq('⭐ rango al revés se voltea en vez de devolver nada',
  C.filtrarMovs(CON_FECHAS, { desde: '2026-09-22', hasta: '2026-09-20' }).length, 3);
eq('filtra por tipo', C.filtrarMovs(CON_FECHAS, { tipo: 'egreso' }).length, 1);
eq('filtra por método', C.filtrarMovs(CON_FECHAS, { metodo: 'transferencia' }).length, 1);
eq('filtra por origen', C.filtrarMovs(CON_FECHAS, { origen: 'cobranza' }).length, 1);
eq('busca por concepto', C.filtrarMovs(CON_FECHAS, { texto: 'VTA-0009' }).length, 1);
eq('busca por categoría', C.filtrarMovs(CON_FECHAS, { texto: 'flete' }).length, 1);
eq('busca por el nombre del cliente', C.filtrarMovs(CON_FECHAS, { texto: 'luis' }).length, 1);
eq('busca por la fecha como se ve (DD/MM/AAAA)', C.filtrarMovs(CON_FECHAS, { texto: '21/09/2026' }).length, 1);
eq('busca por el nombre del método', C.filtrarMovs(CON_FECHAS, { texto: 'Zelle' }).length, 1);
eq('sin filtros no filtra', C.filtrarMovs(CON_FECHAS, {}).length, 3);
eq('filtrar null no revienta', C.filtrarMovs(null, { texto: 'x' }), []);
eq('un movimiento sin fecha no entra en un rango', C.filtrarMovs([{ tipo: 'egreso', origen: 'manual', metodo: 'bs' }], { desde: '2026-01-01' }).length, 0);

// ── 9) El acta ──────────────────────────────────────────────────────────────
const ACTA = C.actaCierreHtml({
  sesion: { ...SESION, closed_at: '2026-09-22T18:30:00Z', closed_by_name: 'Diana De La Rans', estado: 'cerrada' },
  movimientos: MOVS,
  conteo: { efectivo_usd: 115, bs: 2600, pago_movil: 3000, zelle: 200, transferencia: 2000 },
  empresa: 'SOS LA GUAIRA / GOLDEN TOUCH 1127 C.A.',
  conDetalle: true,
});
ok('el acta se titula como tal', /ACTA DE CIERRE DE CAJA/i.test(ACTA.replace(/<[^>]+>/g, ' ')));
ok('el acta trae el código de la sesión', ACTA.includes('CAJA-0001'));
ok('el acta dice quién abrió y quién cerró', ACTA.includes('Diana De La Rans'));
ok('el acta trae la hora de apertura y de cierre',
  ACTA.includes('22/09/2026 08:00') && ACTA.includes('22/09/2026 18:30'));
ok('el acta trae el fondo de apertura', ACTA.includes('$50,00'));
ok('⭐ el acta marca el FALTANTE de efectivo', ACTA.includes('falta') && ACTA.includes('$5,00'));
ok('⭐ el acta marca lo que quedó SIN CONTAR', ACTA.includes('sin contar'));
ok('el acta trae el saldo del movimiento', ACTA.includes('$410,00'));
ok('el acta trae los egresos por categoría', ACTA.includes('Compra menor') && ACTA.includes('Viático'));
ok('el acta trae el detalle cuando se pide', ACTA.includes('Gasoil de la camioneta'));
ok('⭐ el acta deja por escrito la regla del cliente',
  /todo lo que entra a esta caja viene de ventas/i.test(ACTA.replace(/<[^>]+>/g, ' ')));
ok('el acta explica que cada método se cuadra en su moneda',
  /cada m[ée]todo se cuadra en su propia moneda/i.test(ACTA.replace(/<[^>]+>/g, ' ')));
ok('el acta trae las dos firmas', /Cerró la caja/.test(ACTA) && /Recibido conforme/.test(ACTA));

const SIN_DETALLE = C.actaCierreHtml({ sesion: SESION, movimientos: MOVS, conDetalle: false });
ok('sin detalle, no se imprime movimiento por movimiento', !SIN_DETALLE.includes('Gasoil de la camioneta'));
ok('pero el arqueo sigue saliendo', /ARQUEO POR M[ÉE]TODO/i.test(SIN_DETALLE.replace(/<[^>]+>/g, ' ')));

const VACIA = C.actaCierreHtml({ sesion: { code: 'CAJA-0002' }, movimientos: [], conDetalle: true });
ok('⭐ una caja sin un solo movimiento igual emite su acta', VACIA.includes('CAJA-0002') && VACIA.includes('Sin movimientos.'));
ok('y sus totales salen en cero, no en NaN', !/NaN/.test(VACIA));

// ⭐ Escape: el concepto y la nota los escribe el usuario.
const RARO = C.actaCierreHtml({
  sesion: { code: '<script>a</script>', nota: '<img src=x onerror=1>', closed_by_name: '<b>x</b>' },
  movimientos: [{ tipo: 'egreso', origen: 'manual', fecha: '2026-09-22', metodo: 'bs', monto: 1,
                  concepto: '<script>b</script>', categoria: '<i>c</i>' }],
  conDetalle: true,
});
ok('⭐ el texto del usuario va escapado', !RARO.includes('<script>'), 'hay <script> sin escapar');
ok('⭐ una imagen inyectada no se cuela', !RARO.includes('<img src=x'));
ok('⭐ la categoría va escapada', !RARO.includes('<i>c</i>'));


// ════════════════════════════════════════════════════════════════════════════
// 💵 CUÁNTO DINERO HAY (TARJETAS) Y LAS ENTRADAS POR VENTAS — 24-sep-2026.
//
// Pedido del cliente, textual:
//   «la parte de caja, se veran las entradas de dinero que vengan de las ventas,
//    hazlo asi. Y que se refleje con tarjetas cuando dinero hay»
//
// LO QUE BLINDA:
//   · ⭐ CADA BOLSILLO EN SU MONEDA. El efectivo en $ se cuenta en $, los Bs en
//     Bs. Un solo número convertido escondería que hay $300 en Zelle y CERO en
//     la gaveta — que es justo lo que hay que saber antes de pagar en efectivo.
//   · ⭐ SIN TASA NO SE INVENTA UN TOTAL. Los bolívares se informan aparte.
//   · EL FONDO DE APERTURA solo suma al efectivo.
//   · SOLO ENTRAN VENTAS Y COBROS: un egreso nunca es una «entrada por venta».
// ════════════════════════════════════════════════════════════════════════════
{
  const mov = (o) => ({ tipo: 'ingreso', origen: 'venta', fecha: '2026-09-24', concepto: 'x', ...o });
  const MOVS = [
    mov({ metodo: 'efectivo_usd', monto: 100, monto_bs: 0 }),
    mov({ metodo: 'zelle', monto: 50, monto_bs: 0 }),
    mov({ metodo: 'bs', monto: 10, monto_bs: 400 }),
    mov({ metodo: 'pago_movil', monto: 20, monto_bs: 800 }),
    mov({ metodo: 'transferencia', monto: 5, monto_bs: 200 }),
    mov({ origen: 'cobranza', metodo: 'efectivo_usd', monto: 30, monto_bs: 0 }),
    { tipo: 'egreso', origen: 'manual', fecha: '2026-09-24', concepto: 'gasolina',
      metodo: 'efectivo_usd', monto: 25, monto_bs: 0 },
    { tipo: 'egreso', origen: 'manual', fecha: '2026-09-24', concepto: 'pasaje',
      metodo: 'bs', monto: 2, monto_bs: 80 },
  ];
  const SESION = { code: 'CAJA-0001', apertura_usd: 200, apertura_bs: 1000, estado: 'abierta' };

  const t = C.tarjetasDeDinero(SESION, MOVS);
  eq('son cuatro bolsillos', t.map((x) => x.key),
    ['efectivo_usd', 'efectivo_bs', 'banco_bs', 'digital_usd']);

  // 💵 Efectivo en $: fondo 200 + (100 + 30) − 25 = 305
  eq('⭐ cuánto hay en efectivo en $', t[0].disponible, 305);
  eq('...con su fondo aparte', t[0].apertura, 200);
  eq('...lo que entró', t[0].ingresos, 130);
  eq('...y lo que salió', t[0].egresos, 25);
  // 💶 Efectivo en Bs: fondo 1000 + 400 − 80 = 1320 (EN BOLÍVARES, no en $)
  eq('⭐ el efectivo en Bs se cuenta en Bs', t[1].disponible, 1320);
  eq('...y su moneda lo dice', t[1].moneda, 'bs');
  // 🏦 Banco: pago móvil 800 + transferencia 200 = 1000 Bs, sin fondo
  eq('el banco junta pago móvil y transferencia', t[2].disponible, 1000);
  eq('⭐ el banco NO se abre con fondo', t[2].apertura, 0);
  eq('...y resume dos métodos', t[2].metodos, ['transferencia', 'pago_movil']);
  // 💳 Digital: zelle 50
  eq('lo digital va en $', [t[3].disponible, t[3].moneda], [50, 'usd']);

  // Una tarjeta en cero igual se muestra: que no haya efectivo es información.
  const vacias = C.tarjetasDeDinero(null, []);
  eq('sin nada, las cuatro tarjetas siguen ahí', vacias.length, 4);
  eq('...todas en cero', vacias.map((x) => x.disponible), [0, 0, 0, 0]);
  eq('...y avisan que no se movió nada', vacias.map((x) => x.hubo), [false, false, false, false]);
  eq('nada no revienta', C.tarjetasDeDinero(null, null).length, 4);

  // ── EL GRAN TOTAL ────────────────────────────────────────────────────────
  const tot = C.totalDisponible(SESION, MOVS, 40);
  eq('los dólares se suman entre ellos', tot.usd, 355);          // 305 + 50
  eq('los bolívares entre ellos', tot.bs, 2320);                  // 1320 + 1000
  eq('el total convertido es una referencia', tot.totalUsd, 413); // 355 + 2320/40
  eq('...y dice con qué tasa', tot.tasa, 40);
  // ⭐ SIN TASA NO SE INVENTA NADA: los bolívares quedan aparte, avisados.
  const sinTasa = C.totalDisponible(SESION, MOVS, 0);
  eq('⭐ sin tasa, el total en $ es solo lo que ES dólares', sinTasa.totalUsd, 355);
  eq('...y avisa que hay Bs sin convertir', sinTasa.bsSinConvertir, true);
  eq('con tasa no hay nada que avisar', tot.bsSinConvertir, false);
  eq('una tasa basura se trata como sin tasa', C.totalDisponible(SESION, MOVS, 'abc').bsSinConvertir, true);

  // ── LAS ENTRADAS POR VENTAS ──────────────────────────────────────────────
  eq('una venta de contado es entrada por venta', C.vieneDeVenta(MOVS[0]), true);
  eq('un cobro de crédito también', C.vieneDeVenta(MOVS[5]), true);
  // ⭐ Un egreso NUNCA es una entrada, aunque alguien le ponga el origen raro.
  eq('⭐ un egreso no', C.vieneDeVenta(MOVS[6]), false);
  eq('nada no revienta', C.vieneDeVenta(null), false);

  const e = C.resumenEntradas(MOVS);
  eq('cinco ventas de contado', e.ventas, 5);
  eq('...por 185', e.ventasUsd, 185);          // 100+50+10+20+5
  eq('un cobro de crédito', e.cobros, 1);
  eq('...por 30', e.cobrosUsd, 30);
  eq('en total entraron 215', e.totalUsd, 215);
  eq('⭐ los egresos no se cuelan en lo que entró', e.total, 6);
  eq('y su equivalente en Bs', e.totalBs, 1400);  // 400 + 800 + 200
  eq('sin movimientos, todo en cero', C.resumenEntradas([]).totalUsd, 0);
  eq('nada no revienta', C.resumenEntradas(null).total, 0);

  const pm = C.entradasPorMetodo(MOVS);
  // De mayor a menor en $: efectivo 130, zelle 50, pago movil 20, bs 10, transf 5
  eq('⭐ de mayor a menor', pm.map((x) => x.metodo),
    ['efectivo_usd', 'zelle', 'pago_movil', 'bs', 'transferencia']);
  eq('el efectivo junta la venta y el cobro', [pm[0].veces, pm[0].usd], [2, 130]);
  // ⭐ Y cada uno también en SU moneda: el pago móvil se cuadra en bolívares.
  eq('⭐ el pago móvil trae sus bolívares', [pm[2].nativo, pm[2].moneda], [800, 'bs']);
  eq('el efectivo en $ trae dólares', [pm[0].nativo, pm[0].moneda], [130, 'usd']);
  eq('un método sin entradas no aparece', pm.some((x) => x.metodo === 'usdt'), false);
  eq('sin nada, lista vacía', C.entradasPorMetodo([]), []);
}

// ── LA PANTALLA ─────────────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'src/screens/CajaScreen.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
  ok('muestra las tarjetas de cuánto dinero hay', /tarjetasDeDinero\(abierta, deLaCaja\)/.test(src));
  ok('...con su gran total', /totalDisponible\(abierta, deLaCaja, rate\)/.test(src));
  ok('tiene la sección de entradas por ventas', /💰 Entradas por ventas/.test(src));
  ok('...con el contado y los cobros separados', /resumenEntradas\(deLaCaja\)/.test(src));
  ok('...y por método de pago', /entradasPorMetodo\(deLaCaja\)/.test(src));
  ok('se puede filtrar la lista por ventas', /setVerMovs/.test(src));
  ok('el historial también las resume', /resumenEntradas\(filtrados\)/.test(src));
  // ⭐ LA REGLA QUE MANDA: acá no se fabrica un ingreso desde la pantalla.
  ok('⭐ sigue sin haber botón para agregar un ingreso',
    !/tipo: 'ingreso'/.test(src) && !/origen: 'venta'/.test(src));
  ok('...y lo dice en pantalla', /todo lo que entra viene de Ventas/i.test(src));
}

// ── MANUALES ────────────────────────────────────────────────────────────────
{
  ok('manual (md) lo explica',
    /cuánto dinero hay y las entradas por ventas \(24\/09\/2026\)/i.test(fs.readFileSync(path.join(ROOT, 'docs/MANUAL-USUARIO.md'), 'utf8')));
  ok('manual (app) lo explica',
    /CUÁNTO DINERO HAY Y LAS ENTRADAS POR VENTAS \(24\/09\/2026\)/.test(fs.readFileSync(path.join(ROOT, 'src/screens/ManualScreen.tsx'), 'utf8')));
}

// ── Resultado ───────────────────────────────────────────────────────────────
console.log('\nCAJA — arqueo por método, saldo y acta de cierre\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-caja · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
