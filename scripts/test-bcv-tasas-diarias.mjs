/*
 * 🧪 26-nov-2026: el BCV publica 5 tasas (Bs por 1 unidad) y la USD manda.
 *   node scripts/test-bcv-tasas-diarias.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bcv-tasas-'));

const src = fs.readFileSync(path.join(ROOT, 'src/lib/bcvTasas.ts'), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
}).outputText;
fs.writeFileSync(path.join(TMP, 'bcvTasas.mjs'), js, 'utf8');
const B = await import(pathToFileURL(path.join(TMP, 'bcvTasas.mjs')).href);

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else { fail++; console.error(`  ✗ ${name}`); }
};

const HTML = `
<div id="euro"><strong class="strong-tb"> 1.016,86449384 </strong></div>
<div id="yuan"><strong class="strong-tb">139,10968284</strong></div>
<div id="lira"><strong class="strong-tb">18,28126443</strong></div>
<div id="rublo"><strong class="strong-tb">11,27635342</strong></div>
<div id="dolar"><strong class="strong-tb">926,35920000</strong></div>
<div class="pull-right">Fecha Valor: <span content="2026-11-27T00:00:00-04:00">Viernes</span></div>
`;

const tasas = B.parsearTasasBcv(HTML);

ok('lee las 5 monedas', tasas.length === 5);
ok('USD con coma decimal', tasas.find((t) => t.moneda === 'USD')?.tasa === 926.3592);
ok('EUR con punto de miles y coma decimal', tasas.find((t) => t.moneda === 'EUR')?.tasa === 1016.86449384);
ok('CNY', tasas.find((t) => t.moneda === 'CNY')?.tasa === 139.10968284);
ok('TRY', tasas.find((t) => t.moneda === 'TRY')?.tasa === 18.28126443);
ok('RUB', tasas.find((t) => t.moneda === 'RUB')?.tasa === 11.27635342);
ok('guarda la fecha Valor del BCV', tasas[0]?.fecha_valor === '2026-11-27');
ok('la USD es la que manda', B.tasaUsdDeBcv(tasas) === 926.3592);

ok('no inventa si falta una moneda', B.parsearTasasBcv('<div id="dolar"><strong class="strong-tb">926,35920000</strong></div>').length === 1);
ok('no inventa si el número viene roto', B.numeroBcv('abc') === null && B.numeroBcv('') === null);
ok('no acepta cero ni negativo', B.numeroBcv('0') === null && B.numeroBcv('-1') === null);
ok('fecha legible sin desplazar el día', B.fechaBcvLegible('2026-11-27') === '27/11/2026');
ok('texto de referencia usa coma y separa con ·', B.formatearTasasBcv(tasas).startsWith('USD 926,36 · EUR 1.016,86'));

// La app debe consultar la función de la base y respetar una tasa manual.
const bcv = fs.readFileSync(path.join(ROOT, 'src/lib/bcv.ts'), 'utf8');
ok('sincroniza con la función de la base', bcv.includes("supabase.rpc('actualizar_tasas_bcv')"));
ok('no pisa una tasa manual', bcv.includes("manual?.[0]?.source !== 'manual'"));
const tab = fs.readFileSync(path.join(ROOT, 'src/screens/RequerimientoTab.tsx'), 'utf8');
ok('muestra las 5 tasas en Requerimientos', tab.includes('formatearTasasBcv(tasasBcv)'));

console.log(`test-bcv-tasas-diarias: ${pass} pasaron, ${fail} fallaron.`);
if (fail) process.exit(1);
