// 🗑️ Candado: aires acondicionados sin relleno y con opción de eliminar (29-oct-2026).
// Pedido: «dame la opción de eliminar un aire acondicionado, y además borra todos esos
// que están ahí, que los van a cargar en el sistema manualmente».
import fs from 'node:fs';
import ts from 'typescript';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const src = fs.readFileSync('src/lib/airesAcondicionados.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
const lib = mod.exports;

ok('sin catálogo guardado no inventa unidades', lib.extraerCatalogoAiresDeServicios([]).length === 0);
const master = { code: lib.AC_MASTER_CODE, items: [{ code: 'aa-03', area: 'Oficina' }, { code: 'AA-01' }] };
const cat = lib.extraerCatalogoAiresDeServicios([master]);
ok('con catálogo guardado muestra solo lo cargado', cat.length === 2);
ok('ordena por código', cat[0].code === 'AA-01' && cat[1].code === 'AA-03');

const tab = fs.readFileSync('src/screens/AiresAcondicionadosTab.tsx', 'utf8')
  .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
ok('cada tarjeta tiene 🗑️ Eliminar', /onPress=\{\(\) => eliminarUnidades\(\[u\.code\]\)\}/.test(tab));
ok('se pueden eliminar los marcados', /eliminarUnidades\(Array\.from\(selCodes\)\)/.test(tab));
ok('eliminar pide confirmación', /const ok = await confirm\(\{[\s\S]{0,900}danger: true/.test(tab));
ok('eliminar no borra servicios ni cuentas (solo reescribe el catálogo)', !/from\('servicios'\)\s*\.delete|from\('cuentas'\)\s*\.delete/.test(tab));
ok('el código nuevo no repite uno existente', /const nextNum = unidadesCatalogo\.reduce/.test(tab));

console.log(failures.map((f) => '  ✗ ' + f).join('\n'));
console.log(`🗑️ Aires (eliminar): ${pass} OK · ${fail} FALLO(S)`);
process.exit(fail ? 1 : 0);
