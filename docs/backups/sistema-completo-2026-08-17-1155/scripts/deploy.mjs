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
import { writeFileSync } from 'node:fs';

const msg = process.argv.slice(2).join(' ').trim() || 'deploy: build web';
const run = (cmd) => { console.log(`\n$ ${cmd}`); execSync(cmd, { stdio: 'inherit' }); };
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

try {
  const branch = out('git rev-parse --abbrev-ref HEAD');
  if (branch !== 'dev') {
    console.error(`\n✋ Estás en la rama "${branch}". Cámbiate a "dev" antes de desplegar (git checkout dev).`);
    process.exit(1);
  }

  // ID de esta build: se incrusta en el bundle (EXPO_PUBLIC_BUILD_ID) Y en
  // dist/version.json con el MISMO valor. Si no coinciden, la barra
  // "ACTUALIZAR" del sitio (src/lib/version.ts → isUpdateAvailable) se queda
  // pegada para siempre, porque compara justo esos dos valores. Antes este
  // script no tocaba ninguno de los dos: cada `expo export` dejaba el
  // BUILD_ID del bundle con lo que hubiera en el entorno (o "dev") y
  // dist/version.json intacto (o incluso lo borraba, al no regenerarlo).
  // Como el deploy MANUAL es el que usa DigitalOcean (.do/app.yaml: build
  // command vacío, sirve dist tal cual), esa desincronización quedaba
  // publicada en producción sin forma de arreglarse con un simple reload.
  const buildId = out('git rev-parse HEAD');

  console.log('\n⏳ Compilando la web (expo export)…');
  process.env.EXPO_PUBLIC_BUILD_ID = buildId;
  run('npx expo export -p web');

  writeFileSync('dist/version.json', JSON.stringify({ v: buildId }));
  console.log(`\nversion.json → ${buildId}`);

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
