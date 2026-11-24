/*
 * Test de la lógica PURA de «📁 Informes subidos» (24-nov-2026).
 *
 * Fija lo que NO se puede romper:
 *   · la fecha de subida es DÍA CALENDARIO de Caracas, no jornada 7am→7am
 *   · búsqueda sin tildes en título, nombre real y usuario (OR), y AND entre filtros
 *   · un informe ANULADO nunca aparece, aunque venga en una lista vieja
 *   · descarga forzada con `?download=`, sin duplicar el parámetro
 *   · la pestaña solo se monta en web y exige escritura/full del módulo propio
 *
 * Sin framework: transpila el .ts en memoria con `typescript`.
 *   node scripts/test-informes-subidos.mjs
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

const transpile = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;

// `informesArchivos.ts` importa `norm` de ./text. Se transpila el text.ts real
// y se inyecta sólo para ese módulo (nada de Supabase, nada de React).
const textMod = { exports: {} };
new Function('exports', 'module', transpile(path.join(ROOT, 'src/lib/text.ts')))(textMod.exports, textMod);
const srcPath = path.join(ROOT, 'src/lib/informesArchivos.ts');
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './text' && parent && parent.filename === srcPath) return textMod.exports;
  return realLoad.apply(this, arguments);
};
try {
  m._compile(transpile(srcPath), m.filename);
} finally {
  Module._load = realLoad;
}
const {
  diaCaracas, filtrarInformes, uploadersDe, tamanoLegible, fechaLegible,
  slugArchivo, extensionDe, urlDescarga, idCorto, rutaStorage,
} = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `  → ${extra}` : ''}`); }
};

const fila = (o = {}) => ({
  id: o.id ?? 'id-1',
  titulo: o.titulo ?? 'Valuación de noviembre',
  fileName: o.fileName ?? 'Valuación 01.PDF',
  storagePath: o.storagePath ?? 'reportes-archivos/2026/id-1_valuacion_01.pdf',
  publicUrl: o.publicUrl ?? 'https://ejemplo.supabase.co/storage/v1/object/public/machinery/id-1.pdf',
  mimeType: o.mimeType ?? 'application/pdf',
  sizeBytes: o.sizeBytes ?? 2048,
  uploadedBy: o.uploadedBy === undefined ? 'u1' : o.uploadedBy,
  uploadedByNombre: o.uploadedByNombre === undefined ? 'Juan Pérez' : o.uploadedByNombre,
  createdAt: o.createdAt ?? '2026-11-23T12:00:00-04:00',
  anuladoAt: o.anuladoAt ?? null,
});

console.log('📁 INFORMES SUBIDOS — lógica pura\n');

// ── 1) Fecha de Caracas (día calendario, NO jornada 7am→7am) ─────────────────
{
  eq('medianoche UTC del 24 es 23 de noviembre en Caracas',
    diaCaracas('2026-11-24T02:30:00Z'), '2026-11-23');
  eq('mediodía UTC del 24 sigue siendo 24 en Caracas',
    diaCaracas('2026-11-24T16:00:00Z'), '2026-11-24');
  eq('una fecha inválida no inventa día', diaCaracas('no-es-fecha'), '');
  eq('vacío no inventa día', diaCaracas(''), '');
}

// ── 2) Buscador sin tildes, con AND entre filtros ─────────────────────────────
const juan = fila();
const pedro = fila({
  id: 'id-2', titulo: 'Acta de conciliación', fileName: 'acta.xlsx',
  uploadedBy: 'u2', uploadedByNombre: 'Pedro Rodríguez',
  createdAt: '2026-11-24T15:00:00-04:00',
});
const anulado = fila({ id: 'id-3', titulo: 'Valuación anulada', anuladoAt: '2026-11-24T10:00:00Z' });
const todas = [juan, pedro, anulado];

{
  eq('sin filtros devuelve los activos (no el anulado)', filtrarInformes(todas, {}).map((r) => r.id), ['id-1', 'id-2']);
  eq('⭐ el anulado nunca aparece aunque venga en la lista',
    filtrarInformes([anulado], { query: 'valuacion' }).length, 0);
  eq('busca por título SIN tildes', filtrarInformes(todas, { query: 'valuacion' }).map((r) => r.id), ['id-1']);
  eq('busca por nombre real del archivo', filtrarInformes(todas, { query: 'ACTA.XLSX' }).map((r) => r.id), ['id-2']);
  eq('busca por usuario SIN tildes', filtrarInformes(todas, { query: 'juan perez' }).map((r) => r.id), ['id-1']);
  eq('fecha desde inclusiva', filtrarInformes(todas, { desde: '2026-11-24' }).map((r) => r.id), ['id-2']);
  eq('fecha hasta inclusiva', filtrarInformes(todas, { hasta: '2026-11-23' }).map((r) => r.id), ['id-1']);
  eq('rango de un solo día', filtrarInformes(todas, { desde: '2026-11-23', hasta: '2026-11-23' }).map((r) => r.id), ['id-1']);
  eq('por usuario', filtrarInformes(todas, { uploadedBy: 'u2' }).map((r) => r.id), ['id-2']);
  eq('⭐ texto + fecha + usuario se combinan con AND',
    filtrarInformes(todas, { query: 'acta', desde: '2026-11-24', uploadedBy: 'u2' }).map((r) => r.id), ['id-2']);
  eq('si choca un eje, no hay resultado',
    filtrarInformes(todas, { query: 'acta', hasta: '2026-11-23' }).length, 0);
}

// ── 3) Chip de usuarios y formato de la lista ──────────────────────────────────
{
  eq('usuarios únicos, ordenados por nombre',
    uploadersDe([pedro, juan, fila({ id: 'id-4', uploadedBy: 'u1', uploadedByNombre: 'Juan Pérez' })]),
    [{ id: 'u1', nombre: 'Juan Pérez' }, { id: 'u2', nombre: 'Pedro Rodríguez' }]);
  eq('sin nombre cae a "Sin nombre"', uploadersDe([fila({ uploadedBy: 'u3', uploadedByNombre: null })]),
    [{ id: 'u3', nombre: 'Sin nombre' }]);
  eq('quien subió sin id no genera chip', uploadersDe([fila({ uploadedBy: null })]), []);

  eq('tamaño nulo', tamanoLegible(null), '—');
  eq('tamaño en bytes', tamanoLegible(512), '512 B');
  eq('tamaño en KB', tamanoLegible(2048), '2 KB');
  eq('tamaño en MB con coma', tamanoLegible(5 * 1024 * 1024), '5,0 MB');
  ok('fecha legible en Caracas', fechaLegible(juan.createdAt).includes('2026'), fechaLegible(juan.createdAt));
  eq('fecha inválida', fechaLegible('xxx'), '—');
}

// ── 4) Ruta, nombre y descarga forzada ─────────────────────────────────────────
{
  eq('slug quita tildes y deja extensión', slugArchivo('Informe de Noviembre.PDF'), 'informe_de_noviembre.pdf');
  eq('slug quita rutas del nombre original', slugArchivo('C:/tmp/mi archivo.xlsx'), 'mi_archivo.xlsx');
  eq('slug nunca queda vacío', slugArchivo('***'), 'archivo');
  eq('extensión en minúsculas', extensionDe('x.PDF'), 'pdf');
  eq('sin extensión', extensionDe('sin extension'), '');

  const url = 'https://ejemplo.supabase.co/storage/v1/object/public/machinery/id.pdf';
  eq('descarga forzada', urlDescarga(url, 'Valuación 01.PDF'),
    `${url}?download=${encodeURIComponent('Valuación 01.PDF')}`);
  eq('con query existente usa &', urlDescarga(`${url}?x=1`, 'a.pdf'),
    `${url}?x=1&download=a.pdf`);
  eq('no duplica download', urlDescarga(`${url}?download=a.pdf`, 'otro.pdf'), `${url}?download=a.pdf`);
  eq('url vacía', urlDescarga('', 'a.pdf'), '');

  const id = idCorto();
  ok('id corto no vacío', !!id && id.length >= 10, id);
  ok('ruta dentro de la carpeta del año',
    /^reportes-archivos\/\d{4}\/[a-z0-9]+_archivo\.pdf$/.test(rutaStorage('Archivo.pdf', 'abc123')),
    rutaStorage('Archivo.pdf', 'abc123'));
}

// ── 5) La pestaña no se cuela en teléfono ni sin permiso ───────────────────────
{
  const screen = fs.readFileSync(path.join(ROOT, 'src/screens/CombustibleScreen.tsx'), 'utf8');
  ok('la pestaña existe en Combustible', /key: 'informes_archivos'/.test(screen));
  ok('solo se monta en web', /Platform\.OS === 'web' && \['escritura', 'full'\]\.includes\(moduleLevel\('informes_archivos'\)\)/.test(screen));
  ok('anular exige full', /puedeAnular=\{moduleLevel\('informes_archivos'\) === 'full'\}/.test(screen));

  const permisos = fs.readFileSync(path.join(ROOT, 'src/lib/permissions.ts'), 'utf8');
  ok('el módulo existe en la matriz de permisos', /\{ key: 'informes_archivos'/.test(permisos));
  ok('nace cerrado por defecto', /moduleKey === 'informes_archivos'\) return 'none'/.test(permisos));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-informes-subidos · ${pass} ok · ${fail} fallando`);
if (fail) {
  console.log('\n' + failures.join('\n'));
  process.exit(1);
}
console.log('La bandeja filtra en Caracas, anula sin borrar y solo vive en la PC.');
