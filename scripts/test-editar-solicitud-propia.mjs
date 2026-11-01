// ============================================================================
// 🧪 PEDIR MATERIAL — EDITAR MI SOLICITUD (01-nov-2026).
//
// Pedido: «una persona puede hacer su petición o modificarla siempre y cuando
// siga en solicitud, y tenga permiso de escribir en el módulo de pedir
// material/repuesto». Antes se le pedía permiso de Inventario (la base solo
// dejaba modificar a Compras o Inventario). Esta suite prueba la regla de la
// pantalla (`puedeEditarSolicitudCompraPropia`); la base la repite en la
// función `solicitud_propia_editar`.
//
// Ejecutar:  node scripts/test-editar-solicitud-propia.mjs
// ============================================================================
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

const { puedeEditarSolicitudCompraPropia: puede } = loadTs(path.join(ROOT, 'src/lib/solicitudMaterial.ts'));

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); }
};

const YO = 'user-1';
const base = {
  id: 'req-1',
  status: 'pendiente',
  requested_by: YO,
  observaciones: 'Solicitud creada desde el portal técnico de taller.',
  items: [{ name: 'Filtro de aceite', qty: 2, unit: 'UND', est_price: 0, currency: 'USD' }],
};

ok('⭐⭐ el dueño con escritura en Pedir Material edita su solicitud pendiente (sin Compras ni Inventario)',
  puede(base, YO, true).ok);
ok('⭐ también mientras está en aclaratoria', puede({ ...base, status: 'aclaratoria_solicitada' }, YO, true).ok);
ok('⭐⭐ sin escritura en Pedir Material no edita, y el motivo nombra ESE módulo (no Inventario)',
  !puede(base, YO, false).ok && /Pedir Material/.test(puede(base, YO, false).reason || '')
    && !/inventario/i.test(puede(base, YO, false).reason || ''));
ok('⭐ la solicitud de otro no se edita', !puede(base, 'otro', true).ok);
ok('sin sesión no se edita', !puede(base, null, true).ok);
ok('⭐ aprobada ya no se edita', !puede({ ...base, status: 'aprobado' }, YO, true).ok);
ok('recibida ya no se edita', !puede({ ...base, status: 'recibido' }, YO, true).ok);
ok('rechazada o cancelada ya no se edita', !puede({ ...base, status: 'rechazado' }, YO, true).ok);
ok('⭐⭐ convertida en requerimiento (sigue «pendiente» pero con la marca) ya no se edita',
  !puede({ ...base, observaciones: `${base.observaciones}\n[CONVERTIDO_EN_REQ]` }, YO, true).ok);
ok('⭐ si Compras ya le puso precio, se le pide el cambio a Compras',
  !puede({ ...base, items: [{ ...base.items[0], price_usd: 12 }] }, YO, true).ok
    && /Compras/.test(puede({ ...base, items: [{ ...base.items[0], est_price: 5 }] }, YO, true).reason || ''));
ok('un precio en cero no cuenta como cotizado', puede({ ...base, items: [{ ...base.items[0], price_usd: 0, total_usd: 0 }] }, YO, true).ok);
ok('el nombre parecido no basta: para editar cuenta el usuario, no el nombre',
  !puede({ ...base, requested_by: 'otro', solicitante_nombre: 'Juan' }, YO, true).ok);

// La pantalla usa la regla para mostrar el botón y la base la repite al guardar.
const pantalla = fs.readFileSync(path.join(ROOT, 'src/screens/SolicitudMaterialScreen.tsx'), 'utf8');
ok('⭐ el botón «Editar mi solicitud» sale solo si la regla lo permite',
  (pantalla.match(/puedeEditarSolicitudCompraPropia\(r, uid, puedeEscribirSolicitudes\)\.ok/g) || []).length >= 2);
ok('⭐ el permiso que se mira es el de Pedir Material', /moduleLevel\('solicitudes_material'\)/.test(pantalla));
ok('⭐⭐ se guarda por la función de la base, no con un update que pide Compras/Inventario',
  /rpc\('solicitud_propia_editar'/.test(pantalla));
ok('el aviso de permisos ya no nombra la tabla inventory_requirements',
  !/Permiso RLS insuficiente en la base de datos para inventory_requirements/.test(pantalla));

console.log('\nPEDIR MATERIAL — editar mi solicitud\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-editar-solicitud-propia · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
