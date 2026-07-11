#!/usr/bin/env node
// Deploy CASI INSTANTÁNEO a DigitalOcean.
// Compila la web en tu PC y sube la carpeta `dist` ya lista, para que DO no
// tenga que recompilar (el deploy baja de ~3-5 min a ~30-60 s).
//
// Uso:
//   npm run deploy               → compila y sube con mensaje por defecto
//   npm run deploy -- "mi msg"   → compila y sube con tu mensaje de commit
//
// Qué hace: expo export → commit (código + dist) en dev → merge a main → push a
// ambas ramas (DO despliega desde main; dev queda igual).

import { execSync } from 'node:child_process';

const msg = process.argv.slice(2).join(' ').trim() || 'deploy: build web';
const run = (cmd) => { console.log(`\n$ ${cmd}`); execSync(cmd, { stdio: 'inherit' }); };
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

try {
  const branch = out('git rev-parse --abbrev-ref HEAD');
  if (branch !== 'dev') {
    console.error(`\n✋ Estás en la rama "${branch}". Cámbiate a "dev" antes de desplegar (git checkout dev).`);
    process.exit(1);
  }

  console.log('\n⏳ Compilando la web (expo export)…');
  run('npx expo export -p web');

  // ¿Hay cambios que commitear?
  const dirty = out('git status --porcelain');
  if (dirty) {
    run('git add -A');
    run(`git commit -m ${JSON.stringify(msg)}`);
  } else {
    console.log('\n(No hay cambios nuevos; se re-despliega el último commit.)');
  }

  run('git push origin dev');
  run('git checkout main');
  run('git merge dev --no-edit');
  run('git push origin main');
  run('git checkout dev');

  console.log('\n✅ Listo. DigitalOcean subirá la carpeta dist ya compilada (deploy rápido).');
  console.log('   Al probar en el navegador usa Ctrl+F5 para saltar la caché.');
} catch (e) {
  console.error('\n❌ El deploy falló. Revisa el error de arriba.');
  // Intenta volver a dev si quedó en main.
  try { if (out('git rev-parse --abbrev-ref HEAD') !== 'dev') run('git checkout dev'); } catch {}
  process.exit(1);
}
