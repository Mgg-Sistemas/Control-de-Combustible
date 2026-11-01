/*
 * ════════════════════════════════════════════════════════════════════════════
 * 📄 REPORTE DE CUENTAS POR PAGAR / POR COBRAR — 28-oct-2026.
 *
 * Pedido del cliente: «necesito poder sacar un reporte de los que yo
 * selecciono o de todos, o lo que yo agrupe».
 *
 * ── LO QUE FIJA ────────────────────────────────────────────────────────────
 * ⭐ MARCADAS vs TODAS: las marcadas salen de TODAS las cuentas de la pestaña
 *    (la marca sobrevive a filtrar); «todas» es la lista tal como se ve.
 * ⭐ AGRUPAR: cada agrupación con su subtotal, y la suma de los subtotales
 *    cuadra con el total general (también con anuladas y pagadas de por medio).
 * ⚠️ LO APAGADO NO DEJA RASTRO: columna apagada = ni cabecera, ni celda, ni
 *    tarjeta del resumen.
 * ⭐ FILTRADO: solo cuando el papel es una parte de la lista.
 * ⭐ OPCIONES AL NOMBRE DEL ARCHIVO, no al papel.
 * ⭐ Bs: con tasa sale la columna y la tasa usada; sin tasa, ningún «Bs».
 * ⚠️ TODO TEXTO ESCAPADO.
 *
 *   node scripts/test-cuentas-reporte.mjs
 * ════════════════════════════════════════════════════════════════════════════
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

function cargar(rel) {
  const abs = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  m._compile(out, abs);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const R = cargar('src/lib/cuentasReporte.ts');
const {
  elegirCuentas, reporteEsFiltrado, agruparCuentas, totalesDe, armarReporteCuentas, nombreArchivoCuentas,
  OPCIONES_CUENTAS_POR_DEFECTO, COLUMNAS_POR_DEFECTO, tramoVencimiento, usdTexto, bsTexto, tasaTexto, esc,
} = R;

const cta = (id, contraparte, empresaNombre, monto, abonado, situacion, extra = {}) => ({
  id, contraparte, empresaNombre, concepto: `Concepto ${id}`, documento: `F-${id}`,
  fecha_emision: '2026-10-01', fecha_vencimiento: '2026-11-15',
  monto, abonado, saldo: Math.max(0, monto - abonado), situacion, ...extra,
});

// Universo de la pestaña (ya en el orden de la pantalla).
const TODAS = [
  cta('a', 'Repuestos Caracas', 'Golden Touch', 1000, 200, 'vencida', { fecha_vencimiento: '2026-10-10' }),
  cta('b', 'Ferretería El Sol', 'SOS La Guaira', 500, 0, 'por_vencer', { fecha_vencimiento: '2026-11-02', fecha_emision: '2026-09-20' }),
  cta('c', 'Repuestos Caracas', 'SOS La Guaira', 300, 100, 'pendiente'),
  cta('d', 'Lubricantes 2000', 'Golden Touch', 250.5, 0, 'pendiente', { fecha_vencimiento: null, fecha_emision: '2026-08-05' }),
  // Pagada «a mano» sin abonos: su saldo NO suma.
  cta('e', 'Ferretería El Sol', 'Golden Touch', 400, 0, 'pagada'),
  // Anulada: se lista, no suma en nada.
  cta('f', 'Lubricantes 2000', 'SOS La Guaira', 999, 0, 'anulada'),
];
const opc = (o = {}) => ({ ...OPCIONES_CUENTAS_POR_DEFECTO, columnas: { ...COLUMNAS_POR_DEFECTO }, ...o, columnas: { ...COLUMNAS_POR_DEFECTO, ...(o.columnas ?? {}) } });

// ── 1) MARCADAS vs TODAS ──────────────────────────────────────────────────────
const lista = TODAS.filter((c) => c.empresaNombre === 'Golden Touch' && c.situacion !== 'pagada'); // a, d (filtro de empresa)
const marcadas = new Set(['c', 'a', 'zzz']); // c NO está en la lista de ahora; zzz no existe
eq('1. «todas» = la lista tal como se ve', elegirCuentas(lista, TODAS, marcadas, 'todas').map((c) => c.id), ['a', 'd']);
eq('2. «marcadas» salen de TODAS (sobreviven al filtro), en el orden de la pantalla', elegirCuentas(lista, TODAS, marcadas, 'marcadas').map((c) => c.id), ['a', 'c']);
eq('3. sin marcas, «marcadas» no trae nada', elegirCuentas(lista, TODAS, new Set(), 'marcadas').length, 0);

// ── 2) FILTRADO ───────────────────────────────────────────────────────────────
const universo = TODAS.filter((c) => c.situacion !== 'pagada' && c.situacion !== 'anulada');
ok('4. la lista con filtro de empresa es FILTRADO', reporteEsFiltrado(lista, universo));
ok('5. toda la lista sin filtros NO es FILTRADO', !reporteEsFiltrado(universo.slice().reverse(), universo));
ok('6. marcar justo todas no es FILTRADO; marcar algunas sí', !reporteEsFiltrado(elegirCuentas([], universo, new Set(universo.map((c) => c.id)), 'marcadas'), universo)
  && reporteEsFiltrado(elegirCuentas([], universo, new Set(['a']), 'marcadas'), universo));

// ── 3) TOTALES: anulada no suma, pagada no debe ──────────────────────────────
const tot = totalesDe(TODAS);
eq('7. total: monto sin la anulada, saldo sin pagada ni anulada', tot, { cantidad: 6, anuladas: 1, monto: 2450.5, abonado: 300, saldo: 1750.5 });

// ── 4) CADA AGRUPACIÓN, Y LOS SUBTOTALES CUADRAN ─────────────────────────────
const cuadra = (grupos) => {
  const s = grupos.reduce((a, g) => ({ n: a.n + g.totales.cantidad, m: a.m + g.totales.monto, ab: a.ab + g.totales.abonado, sa: a.sa + g.totales.saldo }), { n: 0, m: 0, ab: 0, sa: 0 });
  const r2 = (x) => Math.round(x * 100) / 100;
  return s.n === tot.cantidad && r2(s.m) === tot.monto && r2(s.ab) === tot.abonado && r2(s.sa) === tot.saldo;
};
const gNinguno = agruparCuentas(TODAS, 'ninguno', 'por_pagar');
eq('8. sin agrupar = un solo grupo con todo, en el mismo orden', [gNinguno.length, gNinguno[0].cuentas.map((c) => c.id).join('')], [1, 'abcdef']);
const gProv = agruparCuentas(TODAS, 'contraparte', 'por_pagar');
eq('9. por proveedor: alfabético, cada uno con lo suyo', gProv.map((g) => `${g.etiqueta}:${g.cuentas.map((c) => c.id).join('')}`), ['Ferretería El Sol:be', 'Lubricantes 2000:df', 'Repuestos Caracas:ac']);
eq('9b. subtotal de «Repuestos Caracas»', gProv[2].totales, { cantidad: 2, anuladas: 0, monto: 1300, abonado: 300, saldo: 1000 });
const gEmp = agruparCuentas(TODAS, 'empresa', 'por_pagar');
eq('10. por empresa', gEmp.map((g) => `${g.etiqueta}:${g.cuentas.length}`), ['Golden Touch:3', 'SOS La Guaira:3']);
const gEst = agruparCuentas(TODAS, 'estado', 'por_pagar');
eq('11. por estado, en orden de urgencia', gEst.map((g) => g.clave), ['vencida', 'por_vencer', 'pendiente', 'pagada', 'anulada']);
const gVen = agruparCuentas(TODAS, 'vencimiento', 'por_pagar');
eq('12. por vencimiento: vencidas · por vencer · al día · sin fecha · cerradas', gVen.map((g) => `${g.clave}:${g.cuentas.map((c) => c.id).join('')}`), ['vencidas:a', 'por_vencer:b', 'al_dia:c', 'sin_fecha:d', 'cerradas:ef']);
eq('12b. una pagada con fecha vieja no es «vencida»', tramoVencimiento(cta('x', 'P', 'E', 10, 0, 'pagada', { fecha_vencimiento: '2020-01-01' })), 'cerradas');
const gMes = agruparCuentas([...TODAS, cta('g', 'P', 'E', 10, 0, 'pendiente', { fecha_emision: null })], 'mes', 'por_pagar');
eq('13. por mes de emisión: del más viejo al más nuevo; sin fecha al final', gMes.map((g) => g.etiqueta), ['Agosto 2026', 'Septiembre 2026', 'Octubre 2026', 'Sin fecha de emisión']);
ok('14. los subtotales cuadran con el total en TODAS las agrupaciones', [gNinguno, gProv, gEmp, gEst, gVen].every(cuadra)
  && cuadra(agruparCuentas(TODAS, 'mes', 'por_pagar')));
eq('14b. por cobrar, la contraparte es «Cliente»', agruparCuentas([cta('z', '—', 'E', 1, 0, 'pendiente')], 'contraparte', 'por_cobrar')[0].etiqueta, 'Sin cliente');

// ── 5) EL PAPEL ───────────────────────────────────────────────────────────────
const arma = (o, extra = {}) => armarReporteCuentas({ tipo: 'por_pagar', cuentas: TODAS, op: opc(o), tasaBcv: 40, hoyISO: '2026-10-28', filtrado: false, ...extra });
const base = arma({ agrupar: 'contraparte' });
ok('15. agrupado: cabecera de grupo, subtotal y total general', base.cuerpo.includes('Subtotal Repuestos Caracas') && base.cuerpo.includes('Total general · 6 cuenta(s)') && (base.cuerpo.match(/class="cx-sub"/g) || []).length === 3);
ok('15b. el total general dice el saldo total', base.cuerpo.includes(usdTexto(1750.5)));
ok('15c. sin agrupar no hay filas de subtotal', !arma({}).cuerpo.includes('cx-sub'));

const sinCols = arma({ columnas: { concepto: false, documento: false, abonado: false, empresa: false } });
ok('16. columna apagada: ni cabecera ni dato', !/<th[^>]*>Concepto</.test(sinCols.cuerpo) && !sinCols.cuerpo.includes('Concepto a') && !sinCols.cuerpo.includes('F-a'));
ok('16b. empresa apagada: el nombre no sale en ningún lado', !sinCols.cuerpo.includes('Golden Touch') && !sinCols.cuerpo.includes('SOS La Guaira'));
ok('16c. abonado apagado: tampoco su tarjeta del resumen', !sinCols.cuerpo.includes('TOTAL ABONADO') && !/<th[^>]*>Abonado/.test(sinCols.cuerpo));
ok('16d. el papel NO anuncia las opciones', !/sin concepto|por proveedor|agrupad|marcadas/i.test(base.cuerpo + base.subtitulo + base.titulo));

ok('17. FILTRADO en el subtítulo cuando es una parte', arma({}, { filtrado: true }).subtitulo.includes('FILTRADO'));
ok('17b. sin filtro no dice FILTRADO', !arma({}).subtitulo.includes('FILTRADO') && !arma({}).cuerpo.includes('FILTRADO'));

eq('18. nombre de archivo de siempre', nombreArchivoCuentas('por_pagar', opc(), '2026-10-28', false, 40), 'Cuentas por pagar 28-10-2026');
eq('18b. nombre con las opciones', nombreArchivoCuentas('por_pagar', opc({ alcance: 'marcadas', agrupar: 'contraparte', columnas: { concepto: false, bs: false } }), '2026-10-28', true, 40),
  'Cuentas por pagar 28-10-2026 (marcadas, por proveedor, sin concepto, sin Bs)');
eq('18c. por cobrar, filtrado, título propio', nombreArchivoCuentas('por_cobrar', opc({ titulo: '  Deudas de clientes ', agrupar: 'contraparte' }), '2026-10-28', true, null),
  'Deudas de clientes 28-10-2026 (filtrado, por cliente, sin Bs (sin tasa))');
eq('18d. título vacío = el de siempre', arma({ titulo: '   ' }).titulo, 'Cuentas por pagar');

const malo = armarReporteCuentas({
  tipo: 'por_pagar', op: opc({ titulo: '<script>alert(1)</script>', agrupar: 'contraparte' }), tasaBcv: 40, hoyISO: '2026-10-28', filtrado: false,
  cuentas: [cta('h', 'A & B <C>', 'E "1"', 10, 0, 'pendiente', { concepto: "O'Brien <b>", documento: '<img src=x>' })],
});
ok('19. todo escapado: título, contraparte, concepto, documento, empresa y grupo', !malo.titulo.includes('<script>') && malo.titulo.includes('&lt;script&gt;')
  && !/<img src=x>|<b>|<C>/.test(malo.cuerpo) && malo.cuerpo.includes('A &amp; B &lt;C&gt;') && malo.cuerpo.includes('O&#39;Brien') && malo.cuerpo.includes('E &quot;1&quot;'));
eq('19b. esc', esc(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');

const conTasa = arma({});
ok('20. con tasa: columna Bs, tasa usada y ≈ Bs en el resumen', /<th[^>]*>Saldo ≈ Bs</.test(conTasa.cuerpo) && conTasa.cuerpo.includes('Bs 40,00 por US$ 1') && conTasa.cuerpo.includes(`≈ ${bsTexto(1750.5 * 40)}`));
eq('20b. Bs del saldo total', bsTexto(1750.5 * 40), 'Bs 70.020,00');
const sinTasa = arma({}, { tasaBcv: null });
ok('21. sin tasa: ni columna, ni línea, ni un solo «Bs»', !/Bs/.test(sinTasa.cuerpo));
const bsApagado = arma({ columnas: { bs: false } });
ok('21b. Bs apagado con tasa: tampoco sale', !/Bs/.test(bsApagado.cuerpo));
const soloBs = arma({ columnas: { saldo: false } });
ok('21c. saldo US$ apagado pero Bs prendido: el resumen da el saldo en Bs, no en US$', soloBs.cuerpo.includes('TOTAL SALDO ≈ BS') && !soloBs.cuerpo.includes('>TOTAL SALDO<'));

eq('22. formatos fijos', [usdTexto(1234567.891), usdTexto(0), bsTexto(-5.5), tasaTexto(36.5), tasaTexto(219.8723), tasaTexto(40)], ['$1.234.567,89', '$0,00', 'Bs -5,50', '36,50', '219,8723', '40,00']);
ok('23. anuladas tachadas y con nota de que no suman', base.cuerpo.includes('cx-anulada') && base.cuerpo.includes('no suman'));
ok('23b. sin anuladas no hay nota', !armarReporteCuentas({ tipo: 'por_pagar', cuentas: TODAS.slice(0, 3), op: opc(), tasaBcv: 40, hoyISO: '2026-10-28', filtrado: false }).cuerpo.includes('no suman'));
ok('24. reporte vacío no revienta', armarReporteCuentas({ tipo: 'por_cobrar', cuentas: [], op: opc(), tasaBcv: null, hoyISO: '2026-10-28', filtrado: false }).cuerpo.includes('No hay cuentas'));

// ── 6) LA PANTALLA ESTÁ CABLEADA ──────────────────────────────────────────────
const pantalla = fs.readFileSync(path.join(ROOT, 'src/screens/CuentasScreen.tsx'), 'utf8');
const modal = fs.readFileSync(path.join(ROOT, 'src/components/ReporteCuentasModal.tsx'), 'utf8');
ok('25. botón 📄 Reporte, marcar todas, quitar marcas y contador', /📄 Reporte/.test(pantalla) && /Marcar todas \(de la lista\)/.test(pantalla) && /Quitar marcas/.test(pantalla) && /marcada\{nMarcadas === 1/.test(pantalla));
ok('25b. el modal se monta solo abierto y DESPUÉS del modal de abono', /\{reporteOpen \? \(\s*<ReporteCuentasModal/.test(pantalla) && pantalla.indexOf('<ReporteCuentasModal') > pantalla.indexOf('Registrar abono</SectionTitle>'));
ok('25c. el modal usa pdfDocument con logos y la lib', /pdfDocument\(\{[\s\S]*logos,/.test(modal) && /armarReporteCuentas\(/.test(modal) && /exportPdf\(html, r\.nombreArchivo\)/.test(modal));

console.log(`\n📄 Reporte de cuentas: ${pass} OK · ${fail} FALLO(S)`);
failures.forEach((f) => console.log('  ' + f));
process.exit(fail ? 1 : 0);
