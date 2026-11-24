/*
 * 🧪 Prueba: pegar foto del portapapeles en Horómetros (24-nov-2026)
 *
 *   node scripts/test-horometro-pegar-foto.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const srcPhoto = fs.readFileSync(path.join(ROOT, 'src/lib/photo.ts'), 'utf8');
const srcModal = fs.readFileSync(path.join(ROOT, 'src/components/HorometroCorregirModal.tsx'), 'utf8');

// Extraer la función pura extractImageBlobFromClipboardEvent para probarla en Node sin RN/Expo
const out = ts.transpileModule(srcPhoto.match(/export function extractImageBlobFromClipboardEvent[\s\S]*?\n\}/)[0], {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('exports', out)(mod.exports);
const { extractImageBlobFromClipboardEvent } = mod.exports;

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`✗ ${name}`);
  }
};

const fakeImg = { size: 1234, type: 'image/png' };
const evtConImagen = {
  clipboardData: {
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => fakeImg },
    ],
  },
};
const evtSoloTexto = {
  clipboardData: {
    items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
  },
};

ok('extrae imagen del evento paste', extractImageBlobFromClipboardEvent(evtConImagen) === fakeImg);
ok('devuelve null cuando solo hay texto', extractImageBlobFromClipboardEvent(evtSoloTexto) === null);
ok('devuelve null si evento es vacío', extractImageBlobFromClipboardEvent(null) === null);

ok('HorometroCorregirModal tiene botón Pegar inicial', srcModal.includes('📋 Pegar inicial'));
ok('HorometroCorregirModal tiene botón Pegar final', srcModal.includes('📋 Pegar final'));
ok('HorometroCorregirModal escucha evento paste (Ctrl+V)', srcModal.includes("addEventListener('paste'"));
ok('photo.ts exporta pastePhotoFromClipboardAndUpload', srcPhoto.includes('export async function pastePhotoFromClipboardAndUpload'));
ok('photo.ts exporta uploadImageBlobToMachinery', srcPhoto.includes('export async function uploadImageBlobToMachinery'));

console.log(`test-horometro-pegar-foto: ${pass} pasaron, ${fail} fallaron.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
