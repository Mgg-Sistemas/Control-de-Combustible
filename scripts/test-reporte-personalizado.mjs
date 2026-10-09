// 🛠️ Pruebas del REPORTE PERSONALIZADO DE MAQUINARIA (09-oct-2026).
//
// La regla de oro de este papel: RECIBE información del sistema pero NO ENVÍA
// nada. Los candados de abajo vigilan que la tarjeta no tenga ni un
// insert/update/delete/rpc, que la librería sea pura y que todo sea editable.
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
function loadTs(abs) {
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

const L = loadTs(path.join(ROOT, 'src/lib/reporteMaquinariaPersonalizado.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ——— 1. Fechas ———
eq('dmy: 2026-10-09 → 09/10/2026', L.dmyPersonalizado('2026-10-09'), '09/10/2026');
eq('dmy: basura → vacío', L.dmyPersonalizado('hoy'), '');
eq('emitida: 2026-10-09 → 09 oct. 2026', L.emitidaTexto('2026-10-09'), '09 oct. 2026');
eq('emitida: 2026-01-03 → 03 ene. 2026', L.emitidaTexto('2026-01-03'), '03 ene. 2026');
eq('emitida: basura → vacío (la tarjeta deja la fecha real)', L.emitidaTexto('ayer'), '');
eq('emitida: mes 13 → vacío', L.emitidaTexto('2026-13-01'), '');

// ——— 2. Fila vacía y resumen ———
const fv = L.filaVacia('manual-1');
eq('fila vacía: id puesto y todo lo demás en blanco', [fv.id, fv.code, fv.estado, fv.nota], ['manual-1', '', '', '']);
const filas = [
  { ...L.filaVacia('a'), code: 'M-1', empresa: 'Savanna', estado: 'Operativa' },
  { ...L.filaVacia('b'), code: 'M-2', empresa: 'savanna', estado: 'operativa' },
  { ...L.filaVacia('c'), code: 'M-3', empresa: '', estado: 'Averiada', serial: 'S<script>' },
  { ...L.filaVacia('d'), code: 'M-4', empresa: 'Costa', estado: '' },
];
const r = L.resumenPersonalizado(filas);
eq('resumen: total', r.total, 4);
eq('resumen: agrupa el estado sin mirar mayúsculas', r.porEstado[0], ['Operativa', 2]);
ok('resumen: estado vacío cuenta como «Sin estado»', r.porEstado.some(([l, n]) => l === 'Sin estado' && n === 1));

// ——— 3. El papel con las opciones de nacimiento ———
const html = L.cuerpoReportePersonalizado({ filas, opciones: L.OPCIONES_PERSONALIZADO_INICIAL, nota: 'Nota de prueba' });
ok('salen los cuadros del resumen', html.includes('class="tiles"') && html.includes('Máquinas en el reporte'));
ok('sale la tabla con el código', html.includes('<th>Código</th>') && html.includes('M-1'));
ok('⭐ encargado/horómetro/peso/medidas/notas NACEN ocultos', !html.includes('<th>Encargado</th>') && !html.includes('<th>Horómetro</th>') && !html.includes('<th>Peso</th>') && !html.includes('<th>Medidas</th>') && !html.includes('<th>Notas</th>'));
ok('el cuadro por empresa NACE oculto', !html.includes('Máquinas por empresa'));
ok('fila TOTAL al pie', html.includes('TOTAL: 4 máquina(s)'));
ok('lo vacío sale como «—»', html.includes('>—<'));
ok('⭐ el HTML se escapa (nada de <script> crudo)', !html.includes('<script>') && html.includes('&lt;script&gt;'));
ok('la nota del encabezado sale', html.includes('Nota de prueba'));
ok('⭐⭐ NI UN SIGNO DE DINERO en el papel', !/\$|USD|[Mm]onto|[Tt]arifa|factur/.test(html));

// ——— 4. Las opciones mandan ———
const o = (cambios) => ({ ...L.OPCIONES_PERSONALIZADO_INICIAL, ...cambios });
ok('sinResumen apaga los cuadros', !L.cuerpoReportePersonalizado({ filas, opciones: o({ sinResumen: true }) }).includes('class="tiles"'));
ok('sinTabla deja solo el resumen', !L.cuerpoReportePersonalizado({ filas, opciones: o({ sinTabla: true }) }).includes('<table'));
ok('sinSerial quita la columna', !L.cuerpoReportePersonalizado({ filas, opciones: o({ sinSerial: true }) }).includes('<th>Serial</th>'));
const conEmp = L.cuerpoReportePersonalizado({ filas, opciones: o({ sinPorEmpresa: false }) });
ok('encender el cuadro por empresa lo trae, con «Sin empresa» para las vacías', conEmp.includes('Máquinas por empresa') && conEmp.includes('Sin empresa'));
const conExtra = L.cuerpoReportePersonalizado({ filas, opciones: o({ sinEncargado: false, sinNotas: false }) });
ok('encender encargado y notas las trae', conExtra.includes('<th>Encargado</th>') && conExtra.includes('<th>Notas</th>'));
ok('sin nota del encabezado no sale el párrafo', !L.cuerpoReportePersonalizado({ filas, opciones: L.OPCIONES_PERSONALIZADO_INICIAL }).includes('class="n"'));

// ——— 5. Pastillas, palabras y archivo ———
eq('cada opción tiene su pastilla (ni una más, ni una menos)',
  L.PASTILLAS_PERSONALIZADO.map((p) => p.key).sort(), Object.keys(L.OPCIONES_PERSONALIZADO_INICIAL).sort());
eq('sin cambios: el texto de siempre', L.ocultosPersonalizadoEnPalabras(L.OPCIONES_PERSONALIZADO_INICIAL), 'Sale con las columnas de siempre.');
eq('con cambios: los nombra («con» para lo que nace oculto)',
  L.ocultosPersonalizadoEnPalabras(o({ sinEncargado: false, sinSerial: true })), 'Cambiado: sin serial, con encargado.');
eq('alternar cambia solo esa llave', L.alternarPersonalizado(L.OPCIONES_PERSONALIZADO_INICIAL, 'sinSerial').sinSerial, true);
eq('sufijo del archivo: la fecha sola si no hay cambios', L.sufijoArchivoPersonalizado('2026-10-09', L.OPCIONES_PERSONALIZADO_INICIAL), '09/10/2026');
eq('sufijo del archivo: nombra los cambios', L.sufijoArchivoPersonalizado('2026-10-09', o({ sinPorEmpresa: false })), '09/10/2026 · con empresas');
eq('los seis estados sugeridos del sistema', [...L.ESTADOS_PERSONALIZADO], ['Operativa', 'Averiada', 'Parada', 'Esperando instrucciones', 'Retirada', 'Inactiva']);

// ——— 6. Candados sobre el código fuente ———
const srcLib = fs.readFileSync(path.join(ROOT, 'src/lib/reporteMaquinariaPersonalizado.ts'), 'utf8');
ok('⭐⭐ la librería es PURA (sin imports): se prueba sola', !/^\s*import\s/m.test(srcLib));
ok('⭐⭐ la librería no consulta nada (ni supabase ni fetch)', !/supabase\.|fetch\(|selectAllRows/.test(srcLib));

const srcCard = fs.readFileSync(path.join(ROOT, 'src/components/ReporteMaquinariaPersonalizadoCard.tsx'), 'utf8');
ok('⭐⭐⭐ RECIBE PERO NO ENVÍA: ni un insert/update/delete/upsert/rpc en la tarjeta',
  !/\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(/.test(srcCard) && !/supabase\s*\.\s*from\(/.test(srcCard));
ok('solo lee con selectAllRows', /import \{ selectAllRows \} from '\.\.\/lib\/supabase';/.test(srcCard));
ok('lee el catálogo (machinery) y las averías pendientes para sugerir el estado',
  /selectAllRows\(\s*'machinery'/.test(srcCard) && /selectAllRows\('maintenance_requests'/.test(srcCard) && /eq\('status', 'pendiente'\)/.test(srcCard));
ok('⭐ la fecha de emisión elegida viaja al membrete', /emitida: emitidaTexto\(fechaEmision\) \|\| undefined/.test(srcCard));
ok('vaciar el papel pide confirmación (doble toque)', srcCard.includes('¿Seguro? Toca otra vez'));
ok('el estado también se puede escribir libre', srcCard.includes('Estado libre…'));
ok('hay fila manual en blanco', /filaVacia\(`manual-\$\{manuales \+ 1\}`\)/.test(srcCard));

const srcPdf = fs.readFileSync(path.join(ROOT, 'src/lib/pdf.ts'), 'utf8');
ok('⭐ pdf.ts: sin pasar «emitida», los demás reportes no cambian (nowStamp de siempre)',
  srcPdf.includes('${opts.emitida ?? nowStamp()}') && /emitida\?: string/.test(srcPdf));

const srcPantalla = fs.readFileSync(path.join(ROOT, 'src/screens/ReportsScreen.tsx'), 'utf8');
ok('la pestaña «Personalizado» está montada en Reportes', /<ReporteMaquinariaPersonalizadoCard \/>/.test(srcPantalla) && srcPantalla.includes("{ v: 'personalizado', label: '🛠️ Personalizado' }"));
ok('el botón genérico de generar no aplica en la pestaña nueva', srcPantalla.includes("mode !== 'frentes' && mode !== 'personalizado'"));

// ——— Cierre ———
console.log(`\n🛠️ Reporte personalizado: ${pass} OK · ${fail} FALLO(S)`);
if (fail) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('   Recibe pero no envía: el taller de papel no toca la base.');
