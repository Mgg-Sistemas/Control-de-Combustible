/*
 * Test de los CIERRES DEL PAGO DE VIAJES (`src/lib/pagoViajesCierres.ts`) — 06-oct-2026.
 *
 * QUÉ PEDIDO CUBRE, textual
 *   «¿cómo yo decido o cómo defino que ya pagaron viajes?, ¿desde dónde hago
 *   eso en el pago por viajes?» (05-oct-2026). No existía: ahora un rango se
 *   marca PAGADO y queda la constancia con su foto.
 *
 * LO QUE BLINDA — y por qué cada cosa
 *   · ⭐ LA FOTO SE ARMA DE LAS MISMAS LÍNEAS de la tarjeta: el cierre no
 *     recalcula un centavo, y los NOMBRES quedan congelados (el papel viejo no
 *     cambia aunque renombren una empresa).
 *   · ⭐ DOS CIERRES ACTIVOS NO SE PISAN; un reabierto ya no cuenta.
 *   · ⭐ UN RANGO SIN NI UN VIAJE PAGADO NO SE PUEDE MARCAR: una constancia de
 *     pago en $0 es mentir en papel.
 *   · El PDF del histórico sale DE LA FOTO, nunca de los datos vivos.
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

const srcPath = path.join(ROOT, 'src/lib/pagoViajesCierres.ts');
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

// ── 1) LA FOTO ──────────────────────────────────────────────────────────────
const linea = (empresa, code, monto, motivo = null, placa = null) => ({
  viaje: { company_id: empresa, machinery_id: `id-${code}`, machine_code: code, placa_snap: placa },
  monto, motivoSinPago: motivo,
});
const NOMBRES = new Map([['E1', 'EMPRESA UNO'], ['E2', 'EMPRESA DOS']]);
const LINEAS = [
  linea('E1', 'VOLTEO A', 50, null, 'PL1'),
  linea('E1', 'VOLTEO A', 50, null, 'PL1'),
  linea('E1', 'VOLTEO B', 100),
  linea('E2', 'CHUTO C', 75),
  linea('E1', 'VOLTEO A', 0, 'no_facturo'),
  linea('E2', 'CHUTO C', 0, 'sin_zona'),
  linea(null, 'FUERA', 0, 'fuera_catalogo'),
];
const foto = P.armarFotoCierrePago(LINEAS, NOMBRES);
eq('⭐ el total es el de las mismas líneas (no recalcula nada)', foto.total, { viajes: 7, pagados: 4, noFacturados: 1, pendientes: 2, monto: 275 });
eq('⭐ por empresa con el NOMBRE congelado, orden alfabético y «sin empresa» aparte',
  foto.empresas.map((e) => [e.nombre, e.pagados, e.monto, e.noFacturados, e.pendientes]),
  [['EMPRESA DOS', 1, 75, 0, 1], ['EMPRESA UNO', 3, 200, 1, 0], ['Sin empresa (fuera del catálogo)', 0, 0, 0, 1]]);
eq('por camión: solo los PAGADOS, con placa y empresa', foto.camiones.map((c) => [c.code, c.placa, c.empresa, c.pagados, c.monto]),
  [['CHUTO C', '', 'EMPRESA DOS', 1, 75], ['VOLTEO A', 'PL1', 'EMPRESA UNO', 2, 100], ['VOLTEO B', '', 'EMPRESA UNO', 1, 100]]);
eq('nada no revienta', P.armarFotoCierrePago(null, null).total.viajes, 0);

// ── 2) LAS REGLAS ───────────────────────────────────────────────────────────
const cierre = (id, desde, hasta, extra = {}) => ({ id, desde, hasta, total_monto: 100, viajes: 5, pagados: 4, detalle: null, ...extra });
const CIERRES = [
  cierre('a', '2026-09-14', '2026-09-20'),
  cierre('b', '2026-09-21', '2026-09-27', { anulada_at: '2026-09-28T00:00:00Z' }), // reabierto: no cuenta
];
eq('⭐ un rango DENTRO de un cierre activo está «pagado»', P.cierrePagoDelRango(CIERRES, '2026-09-15', '2026-09-19')?.id, 'a');
eq('el rango exacto también', P.cierrePagoDelRango(CIERRES, '2026-09-14', '2026-09-20')?.id, 'a');
eq('⭐ un cierre REABIERTO ya no cuenta', P.cierrePagoDelRango(CIERRES, '2026-09-21', '2026-09-27'), null);
eq('un rango que se SALE del cierre no está pagado (solo solapa)', P.cierrePagoDelRango(CIERRES, '2026-09-18', '2026-09-22'), null);
eq('…pero el solape sí se detecta, para avisar', P.cierresPagoSolapados(CIERRES, '2026-09-18', '2026-09-22').map((c) => c.id), ['a']);
eq('fechas malas no revientan', P.cierrePagoDelRango(CIERRES, '', 'x'), null);

const FOTO_OK = { total: { viajes: 5, pagados: 4, noFacturados: 0, pendientes: 1, monto: 275 }, empresas: [], camiones: [] };
eq('un cierre bueno pasa', P.validarCierrePago({ desde: '2026-09-28', hasta: '2026-10-04', foto: FOTO_OK }, CIERRES), null);
ok('⭐ dos cierres activos no se pisan (y el aviso dice cuál)', /del 14\/09\/2026 al 20\/09\/2026/.test(P.validarCierrePago({ desde: '2026-09-19', hasta: '2026-09-25', foto: FOTO_OK }, CIERRES)));
ok('…pero pisar un REABIERTO sí se puede (ya no vale)', P.validarCierrePago({ desde: '2026-09-21', hasta: '2026-09-27', foto: FOTO_OK }, CIERRES) === null);
ok('⭐ sin ni un viaje pagado no hay constancia que valga', /ni un viaje pagado/.test(P.validarCierrePago({ desde: '2026-09-28', hasta: '2026-09-29', foto: { total: { viajes: 3, pagados: 0, noFacturados: 0, pendientes: 3, monto: 0 }, empresas: [], camiones: [] } }, [])));
ok('un rango de más de 92 días no pasa', /92 días/.test(P.validarCierrePago({ desde: '2026-01-01', hasta: '2026-06-30', foto: FOTO_OK }, [])));
ok('hasta < desde no pasa', /no es válido/.test(P.validarCierrePago({ desde: '2026-10-05', hasta: '2026-10-01', foto: FOTO_OK }, [])));

// La confirmación dice la verdad.
ok('⭐ la confirmación canta el total y AVISA los pendientes', (() => {
  const s = P.textoConfirmarCierrePago('2026-09-28', '2026-10-04', foto);
  return /YA SE PAGÓ/.test(s) && /4 viaje\(s\) · \$275,00 · 3 empresa\(s\)/.test(s) && /quedan 2 viaje\(s\) SIN PAGAR/.test(s) && /se puede reabrir con motivo/.test(s);
})());
ok('sin pendientes, no mete miedo de gratis', !/SIN PAGAR/.test(P.textoConfirmarCierrePago('2026-09-28', '2026-10-04', { ...foto, total: { ...foto.total, pendientes: 0 } })));

// ── 3) EL PAPEL DE LA CONSTANCIA (sale de la FOTO) ──────────────────────────
const cFoto = cierre('z', '2026-09-28', '2026-10-04', { detalle: foto, total_monto: 275, created_by_nombre: 'FULANA DE TAL', created_at: '2026-10-05T12:00:00Z', nota: 'semana 40' });
const html = P.cuerpoCierrePago(cFoto);
ok('⭐ lleva el sello PAGADO con rango, monto y quién', /✔️ PAGADO · del 28\/09\/2026 al 04\/10\/2026 · \$275,00/.test(html) && /FULANA DE TAL/.test(html) && /semana 40/.test(html));
ok('las dos tablas salen de la foto', /EMPRESA UNO/.test(html) && /VOLTEO A/.test(html) && /TOTAL PAGADO/.test(html));
ok('⭐ un cierre REABIERTO lo dice en el papel (la constancia quedó sin efecto)',
  /REABIERTO.*sin efecto/.test(P.cuerpoCierrePago({ ...cFoto, anulada_at: '2026-10-06T00:00:00Z', anulada_motivo: 'error de rango' })) &&
  /error de rango/.test(P.cuerpoCierrePago({ ...cFoto, anulada_at: '2026-10-06T00:00:00Z', anulada_motivo: 'error de rango' })));
ok('sin detalle guardado, lo dice en vez de inventar', /no guardó detalle/.test(P.cuerpoCierrePago(cierre('y', '2026-09-28', '2026-10-04'))));
ok('escapa HTML', P.cuerpoCierrePago({ ...cFoto, nota: '<b>x</b>' }).includes('&lt;b&gt;x&lt;/b&gt;'));
eq('usdCierre con miles y coma', [P.usdCierre(7101.72), P.usdCierre(0)], ['$7.101,72', '$0,00']);

// ── 4) CANDADOS ─────────────────────────────────────────────────────────────
{
  const lib = sinComentarios(leer('src/lib/pagoViajesCierres.ts'));
  ok('⭐ la librería solo importa TIPOS (se prueba sola)', !/^\s*import\s+(?!type)/m.test(lib.replace(/import type/g, '')));
  const db = sinComentarios(leer('src/lib/pagoViajesCierresDb.ts'));
  ok('⭐ tabla PROPIA: no escribe en viajes, tarifas ni marcas', /viaje_pago_cierres/.test(db) && !/from\('camion_viajes'\)|from\('viaje_tarifas'\)|from\('viaje_pago_marcas'\)/.test(db));
  ok('⭐ un cierre no se borra: se reabre anulándolo', /reabrirCierrePago/.test(db) && !/\.delete\(/.test(db));
  ok('si falta el SQL, lo dice en vez de reventar', /missing: true/.test(db));
  const comp = sinComentarios(leer('src/components/PagoViajesResumen.tsx'));
  ok('⭐ la pantalla arma la foto de LAS LÍNEAS SIN FILTRAR (lineasTodas, nunca lineasPdf)',
    /armarFotoCierrePago\(lineasTodas, /.test(comp) && !/armarFotoCierrePago\(lineasPdf/.test(comp));
  ok('⭐ valida ANTES de guardar y confirma EN LÍNEA', /validarCierrePago\(/.test(comp) && !/window\.confirm/.test(comp));
  ok('el histórico imprime la constancia DE LA FOTO', /cuerpoCierrePago\(/.test(comp) && /CSS_CIERRE_PAGO/.test(comp));
  ok('reabrir exige motivo', /reabrirCierrePago\(/.test(comp));
  ok('⭐ el PDF del pago dice PAGADO cuando el rango está cerrado', /PAGADO el /.test(comp));
}

console.log('\nCIERRES DEL PAGO DE VIAJES — la constancia de «ya se pagó», con su foto\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-pago-viajes-cierres · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
