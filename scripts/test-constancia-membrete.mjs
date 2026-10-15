// 🏢 Candados del MEMBRETE de la constancia de trabajo — 15-oct-2026.
//
// Pedido: «poder sacarla con cualquier información o logo de todos los que
// tenemos, y que automáticamente modifique el pie de página». Reglas vigiladas:
// el membrete elegido manda en TODO el papel (cabecera, texto, firma y PIE);
// nace en SOS (idéntica a la de siempre); y «sin fines de lucro» es SOLO de
// SOS — ponérselo a una C.A. sería mentir en un papel que va a bancos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const lib = leer('src/lib/constancia.ts');
ok('🏢 están los CINCO membretes de la casa',
  ['sos', 'golden', 'renace', 'jhenzaen', 'bcv'].every((k) => lib.includes(`key: '${k}'`)));
ok('🏢 nace en SOS (el primero de la lista es el por defecto)',
  lib.includes('export const MEMBRETE_POR_DEFECTO = MEMBRETES_CONSTANCIA[0];')
  && /MEMBRETES_CONSTANCIA: MembreteConstancia\[\] = \[\s*\{ key: 'sos'/.test(lib));
ok('⭐ el papel usa el membrete (nada de empresa clavada en la constancia de trabajo)',
  lib.includes('const m = d.membrete ?? MEMBRETE_POR_DEFECTO;') && lib.includes('const empresa = m.nombre;'));
ok('⭐ la CABECERA sale del membrete (logo + nombre)',
  lib.includes('<img src="${m.logo}"') && lib.includes('<div class="co">${esc(m.cabecera)}</div>'));
ok('⭐ el PIE cambia solo con el membrete',
  lib.includes('<div class="foot">${esc(empresa)} · Constancia de trabajo')
  && !lib.includes('<div class="foot">${esc(COMPANY_NAME)} · Constancia de trabajo'));
ok('⭐ la FIRMA también', lib.includes('<div class="emp">${esc(empresa)}</div>'));
ok('⚖️ «sin fines de lucro» es SOLO de SOS (condicional, y una sola marca)',
  lib.includes("${m.sinFinesDeLucro ? ' institución <b>sin fines de lucro</b>,' : ''}")
  && (lib.match(/sinFinesDeLucro: true/g) || []).length === 1);

const scr = leer('src/screens/EmpleadosScreen.tsx');
ok('📱 la pantalla trae las pastillas de membrete', scr.includes('MEMBRETES_CONSTANCIA.map((mb)'));
ok('📱 nace en SOS también en pantalla', scr.includes('useState(MEMBRETE_POR_DEFECTO.key)'));
ok('📱 el elegido viaja al papel', scr.includes('membrete: memb,'));
ok('📎 el archivo dice el membrete cuando NO es el de siempre',
  scr.includes("memb.key === MEMBRETE_POR_DEFECTO.key ? '' : ` - ${memb.nombre}`"));

console.log(`\n🏢 Constancia · membretes: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   El membrete elegido manda en cabecera, texto, firma y pie.');
