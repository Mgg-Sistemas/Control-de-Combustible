// 🏭 CENTRO DE OPERACIONES — 📋 REPORTE DE LA FLOTA (11-nov-2026). Fija:
//   · el estado de cada máquina con LA regla del bloque 🚜 (marca del sitio si manda, si no inspección),
//   · categoría y empresa (del Catálogo en las vinculadas; descripción y dueño en las propias),
//   · filtros por estado, categoría, empresa y máquina; columnas; conteo; papel escapado,
//   · que solo lee (ningún insert/update/delete) y que está en 📊 Reportes con los logos del sitio.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');
const orig = Module._load;
const falso = new Proxy(function () {}, { get: () => new Proxy(function () {}, { get: () => ({}) }) });
Module._load = function (r) { if (r === 'react-native' || /supabase|async-storage|\/pdf$|logoData/.test(r)) return falso; return orig.apply(this, arguments); };
require.extensions['.ts'] = function (mod, fn) {
  mod._compile(ts.transpileModule(fs.readFileSync(fn, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText, fn);
};
const R = require(path.join(ROOT, 'src/lib/centroOperacionesFlotaReporte.ts'));

let ok = 0; const fallas = [];
const check = (c, m, x) => { if (c) ok++; else fallas.push('  ✗ ' + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), m, { esperado: b, obtenido: a });

const AHORA = Date.parse('2026-11-11T15:00:00Z');
const U = (o) => ({ id: o.codigo, sitioId: 's1', origen: o.machineryId ? 'catalogo' : 'propia', machineryId: null, codigo: 'X', descripcion: null, placa: null, serial: null, marca: null, modelo: null, dueno: null, capacidadM3: null, activo: true, nota: null, estado: null, estadoNota: null, estadoAt: null, chofer: null, ...o });
const leida = (estado, extra = {}) => ({ encontrada: true, estado, etiqueta: null, icono: null, motivo: null, desdeMs: null, enVivo: null, novedad: null, reactivadaMs: null, ...extra });
const UNIDADES = [
  U({ codigo: 'PAY-01', machineryId: 'm1', placa: 'A1', marca: 'CAT', modelo: '950' }),                                    // inspección: averiada
  U({ codigo: 'PAY-02', machineryId: 'm2', estado: 'retirada', estadoAt: '2026-11-10T12:00:00Z', estadoNota: 'se fue' }), // marca del sitio
  U({ codigo: 'VOL-09', descripcion: 'Volqueta', dueno: 'Cheli', estado: 'parada', estadoAt: '2026-11-09T12:00:00Z' }),   // propia
  U({ codigo: 'TRI-01', descripcion: 'Trituradora', dueno: 'Cheli', estado: 'disponible', estadoAt: '2026-11-01T12:00:00Z' }),
  U({ codigo: 'EXC-05', machineryId: 'm5' }),                                                                             // sin leer
  U({ codigo: 'BAJA', descripcion: 'x', estado: 'disponible', activo: false }),
];
const INSP = { leidaAt: '2026-11-11T15:00:00Z', porMaquina: { m1: leida('averiada', { desdeMs: Date.parse('2026-11-08T12:00:00Z') }), m2: leida('operativa') } };
const CAT = { m1: { clasificacion: 'Payloader', empresa: 'Golden Touch' }, m2: { clasificacion: 'Payloader', empresa: 'Liccione' }, m5: { clasificacion: 'Excavadora', empresa: 'Golden Touch' } };
const F = R.filasDeFlota(UNIDADES, INSP, CAT, AHORA);
const por = Object.fromEntries(F.map((f) => [f.codigo, f]));
eq(F.map((f) => f.codigo), ['EXC-05', 'PAY-01', 'PAY-02', 'TRI-01', 'VOL-09'], 'las activas del sitio, por código (la de baja no sale)');
eq([por['PAY-01'].estado, por['PAY-01'].fuente, por['PAY-01'].desde], ['averiada', 'según inspección', '08/11/2026'], '⭐ vinculada sin marca: el estado de INSPECCIÓN, con su «desde»');
eq([por['PAY-02'].estado, por['PAY-02'].fuente, por['PAY-02'].desde, por['PAY-02'].nota], ['retirada', 'marcado en el sitio', '10/11/2026', 'se fue'], '⭐ vinculada con marca del sitio (cualquiera de los 6): manda la marca, con su nota');
eq([por['VOL-09'].estado, por['VOL-09'].categoria, por['VOL-09'].empresa, por['VOL-09'].origen], ['parada', 'Volqueta', 'Cheli', 'Propia'], '⭐ propia: su marca; categoría = descripción, empresa = dueño');
eq([por['PAY-01'].categoria, por['PAY-01'].empresa, por['PAY-01'].origen, por['PAY-01'].marcaModelo], ['Payloader', 'Golden Touch', 'Catálogo', 'CAT 950'], '⭐ vinculada: categoría y empresa del Catálogo');
eq([por['EXC-05'].estado, por['EXC-05'].fuente], ['sin_dato', 'no se pudo leer inspección'], 'vinculada sin leer: «❔ Sin dato», nunca operativa');
eq(R.filasDeFlota(UNIDADES, null, {}, AHORA).find((f) => f.codigo === 'PAY-01').categoria, 'Sin categoría', 'sin Catálogo leído: «Sin categoría» (no revienta)');

eq(R.opcionesDeFlota(F), { categorias: ['Excavadora', 'Payloader', 'Trituradora', 'Volqueta'], empresas: ['Cheli', 'Golden Touch', 'Liccione'] }, 'categorías y empresas para las pastillas');
eq(R.filtrarFlota(F, { estados: ['averiada', 'retirada'] }).map((f) => f.codigo), ['PAY-01', 'PAY-02'], '⭐ filtro por estado');
eq(R.filtrarFlota(F, { categorias: ['Payloader'], empresas: ['Golden Touch'] }).map((f) => f.codigo), ['PAY-01'], '⭐ filtro por categoría Y empresa');
eq(R.filtrarFlota(F, { ids: ['TRI-01', 'VOL-09'] }).map((f) => f.codigo), ['TRI-01', 'VOL-09'], '⭐ filtro por máquinas elegidas');
eq(R.filtrarFlota(F, {}).length, 5, 'sin filtros: todas');
const c = R.conteoFlota(F);
eq([c.disponible, c.averiada, c.parada, c.retirada, c.sin_dato], [1, 1, 1, 1, 1], 'el conteo por estado');

const cols = ['n', 'codigo', 'estado', 'empresa'];
const html = R.cuerpoFlota(F, cols);
eq([...html.matchAll(/<th>([^<]+)<\/th>/g)].map((m) => m[1]), ['#', 'Código', 'Empresa', 'Estado'], '⭐ solo las columnas puestas, en el orden fijo del reporte');
check(/<span>✅ Operativa<\/span><b>1<\/b>/.test(html) && /<span>Total<\/span><b>5<\/b>/.test(html) && !/En espera/.test(html), 'tarjetas por estado (solo las que tienen algo) y total');
check(!/<script>/.test(R.cuerpoFlota([{ ...F[0], codigo: '<script>x</script>' }], cols)), 'lo escrito se escapa');
check(/No hay máquinas con esos filtros/.test(R.cuerpoFlota([], cols)), 'sin máquinas: lo dice');
eq(R.columnasPorDefecto(), ['n', 'codigo', 'descripcion', 'placa', 'marcaModelo', 'categoria', 'empresa', 'estado', 'desde'], 'las columnas que nacen puestas');
check(/^Flota - CDT - 2026-11-11 - Averiada - Payloader/.test(R.nombreArchivoFlota('CDT', '2026-11-11', { estados: ['averiada'], categorias: ['Payloader'] })), 'los filtros van al NOMBRE del archivo (no se anuncian en el papel)');

// Cableado
const comp = fs.readFileSync(path.join(ROOT, 'src/components/centroOperaciones/ReporteFlotaCop.tsx'), 'utf8');
check(!/\.(insert|update|upsert|delete)\(|guardar[A-Z]\w*\(/.test(comp), '⭐ solo lee: ningún guardado');
check(/cargarUnidades\(sitio\.id\)/.test(comp) && /cargarEstadoInspeccion\(vinculadas\)/.test(comp) && /cargarCatalogoDeFlota\(/.test(comp), 'lee flota, inspección y Catálogo');
check(/if \(abierto && filas === null && !cargando\)/.test(comp), 'lee solo al abrir la tarjeta');
check(/logos,\s*marcaTexto: false/.test(comp), 'con los logos elegidos y el membrete neutro de los papeles del sitio');
const tab = fs.readFileSync(path.join(ROOT, 'src/components/centroOperaciones/ReportesTab.tsx'), 'utf8');
check(/<ReporteFlotaCop sitio=\{sitio\} logosDelSitio=\{fijos\.logos\} \/>/.test(tab), 'en 📊 Reportes, arrancando con los logos del sitio');
const db = fs.readFileSync(path.join(ROOT, 'src/lib/centroOperacionesDb.ts'), 'utf8');
check(/export async function cargarCatalogoDeFlota[\s\S]{0,700}\.from\('machinery'\)\.select\('id, clasificacion, company:company_id\(name\)'\)\.in\('id', lote\)/.test(db), 'del Catálogo solo categoría y empresa, filtrado por esas máquinas');
check(/REPORTE DE LA FLOTA/.test(fs.readFileSync(path.join(ROOT, 'src/screens/ManualScreen.tsx'), 'utf8')), 'el manual lo explica');

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-centro-operaciones-flota-reporte: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-centro-operaciones-flota-reporte: ${ok} ok, 0 fallas`);
