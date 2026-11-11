// 🗜️ TODAS LAS IMÁGENES SE OPTIMIZAN ANTES DE GUARDARSE (11-nov-2026, a pedido: «que todas
// las imágenes que se suban en SOS se optimicen automáticamente… que no pesen tanto y no
// consuman tanto»; en Supabase se apagó el redimensionador al vuelo, que cobra por foto).
// Barre TODO src/: cada subida al Storage y cada foto que se guarda como data-url tiene que
// pasar por la optimización (JPEG ≤1600 px). Si alguien agrega una nueva sin optimizar, falla.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');
let ok = 0; const fallas = [];
const check = (c, m, x) => { if (c) ok++; else fallas.push('  ✗ ' + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), m, { esperado: b, obtenido: a });

const todos = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f.name)) todos.push(p); } })(path.join(ROOT, 'src'));
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const leer = (p) => fs.readFileSync(p, 'utf8');

// ── 1) La regla: qué se optimiza ──
{
  const orig = Module._load;
  const falso = new Proxy(function () {}, { get: () => new Proxy(function () {}, { get: () => ({}) }) });
  Module._load = function (r) { if (r === 'react-native') return { Platform: { OS: 'web' } }; if (/expo-|\.\/supabase|PhotoCropper/.test(r)) return falso; return orig.apply(this, arguments); };
  try {
    const abs = path.join(ROOT, 'src/lib/photo.ts');
    const out = ts.transpileModule(leer(abs), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
    const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs)); m._compile(out, abs);
    const E = m.exports.esImagenOptimizable;
    eq([E('image/jpeg', 'a.jpg'), E('image/png', 'logo.png'), E('', 'FOTO.HEIC'), E('image/webp', 'x')], [true, true, true, true], '⭐ JPG, PNG, HEIC y WEBP se optimizan');
    eq([E('application/pdf', 'f.pdf'), E('', 'factura.PDF'), E('image/gif', 'a.gif'), E('image/svg+xml', 'a.svg')], [false, false, false, false], 'los PDF van tal cual (y GIF/SVG no se tocan)');
    check(typeof m.exports.optimizarAssetADataUrl === 'function' && typeof m.exports.optimizarAssetParaSubir === 'function' && typeof m.exports.optimizarImagenWeb === 'function', 'las funciones de optimizar existen');
  } finally { Module._load = orig; }
  const ph = leer(path.join(ROOT, 'src/lib/photo.ts'));
  check(/async function resizeImageWeb\(uri: string, maxDim = 1600, quality = 0\.5\)/.test(ph), 'la regla: máximo 1600 px y JPEG al 50 %');
  check((ph.match(/const opt = !isPdf && esImagenOptimizable\(file\.type, file\.name\) \? await optimizarImagenWeb\(file\) : null;/g) || []).length === 2, '⭐ adjuntar documentos desde la PC (uno o varios): la imagen se sube optimizada, el PDF tal cual');
  check(/r\.size < \(origen as Blob\)\.size/.test(ph), 'una imagen ya liviana no se agranda');
}

// ── 2) ⭐⭐ Barrido: toda subida al Storage pasa por la optimización ──
// Cada `.upload(` con su motivo. Si aparece uno nuevo que no está aquí, la prueba falla.
const SUBIDAS = {
  'src/lib/photo.ts': 'uploadToMachinery recibe assetToBody (optimizado); los documentos web pasan por optimizarImagenWeb; los PDF van tal cual',
  'src/screens/ComprasScreen.tsx': 'optimizarAssetParaSubir antes de subir',
  'src/screens/RequerimientoTab.tsx': 'optimizarAssetParaSubir antes de subir',
  'src/screens/GeodestaInspections.tsx': 'optimizarImagenWeb antes de subir',
  'src/lib/camionViajes.ts': 'la foto de la romana ya viene de capturarFotoLocal/elegirFotoLocal (optimizada)',
};
const conUpload = todos.filter((p) => /storage\s*\.from\([^)]*\)\s*\.upload\(/.test(leer(p).replace(/\s+/g, ' ')) || /\.upload\(path,/.test(leer(p))).map(rel);
for (const f of conUpload) check(f in SUBIDAS, `⭐ subida al Storage conocida y optimizada: ${f}`);
for (const f of ['src/screens/ComprasScreen.tsx', 'src/screens/RequerimientoTab.tsx']) {
  check(/const optimizada = await optimizarAssetParaSubir\(asset\);\s*if \(optimizada\) \{/.test(leer(path.join(ROOT, f))), `${f}: la cámara del comprobante sube la foto optimizada`);
}
check(/\(await optimizarImagenWeb\(dataUrl\)\) \?\? await \(await fetch\(dataUrl\)\)\.blob\(\)/.test(leer(path.join(ROOT, 'src/screens/GeodestaInspections.tsx'))), 'Geodesta: la foto anotada se sube optimizada');
const romana = leer(path.join(ROOT, 'src/lib/camionViajes.ts'));
check(/bytesDeBase64\(b64\)/.test(romana), 'la romana sube el data-url que ya viene optimizado');

// ── 3) ⭐⭐ Barrido: ninguna foto se guarda como data-url SIN optimizar ──
// El patrón crudo «data:image/jpeg;base64,${…base64}» solo puede quedar como RESPALDO después de
// optimizar (en la misma línea), o en photo.ts (que es la que optimiza), o en los LOGOS de
// Presupuestos (a propósito: un logo PNG perdería su fondo transparente al pasarlo a JPEG).
const PERMITIDOS = new Set(['src/lib/photo.ts', 'src/components/PresupuestoFormModal.tsx']);
for (const p of todos) {
  const r = rel(p);
  if (PERMITIDOS.has(r)) continue;
  leer(p).split('\n').forEach((linea, i) => {
    if (/data:image\/jpeg;base64,\$\{[^}]*base64\}/.test(linea)) {
      check(/optimizarAssetADataUrl\(/.test(linea), `⭐ ${r}:${i + 1} guarda la foto optimizada (lo crudo solo de respaldo)`);
    }
  });
}
const acta = leer(path.join(ROOT, 'src/screens/ActaRecepcionScreen.tsx'));
check(/const uri = \(await optimizarAssetADataUrl\(asset\)\) \?\?/.test(acta), '⭐ Actas de recepción: el anexo (que va DENTRO de la base) se guarda optimizado');
const inv = leer(path.join(ROOT, 'src/screens/InventarioScreen.tsx'));
check((inv.match(/optimizarAssetADataUrl\(a\)/g) || []).length === 4, '⭐ Inventario: cámara y galería (las 4) se guardan optimizadas');

// ── 4) La ficha técnica: sus fotos ya se suben optimizadas y no usan el redimensionador de Supabase ──
const ficha = leer(path.join(ROOT, 'src/components/FichaTecnicaModal.tsx'));
check(/takePhotoAndUpload\(/.test(ficha) && /pickPhotoFromGalleryAndUpload|elegirFotoLocal/.test(ficha), 'la ficha técnica sube con takePhotoAndUpload / pickPhotoFromGalleryAndUpload (optimizadas)');
check(/export const USAR_TRANSFORMADOR = false;/.test(leer(path.join(ROOT, 'src/lib/fotoRemota.ts'))), 'el redimensionador de Supabase sigue APAGADO');

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-imagenes-optimizadas: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-imagenes-optimizadas: ${ok} ok, 0 fallas`);
