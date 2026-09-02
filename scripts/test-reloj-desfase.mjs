/*
 * EL RELOJ DEL TELÉFONO CONTRA EL DEL SERVIDOR (02-sep-2026).
 *
 * Blinda `src/lib/relojDesfase.ts`. Un viaje se sella con la hora DEL TELÉFONO,
 * y esa hora decide a qué JORNADA (el día va de 7am a 7am) y a qué TURNO (que se
 * deduce de la hora) pertenece. Un teléfono corrido media hora manda los viajes
 * al día equivocado y el listero jura que los registró.
 *
 * ⚠️ Esto NO reemplaza la hora, solo AVISA: el registro sin conexión depende del
 *    reloj del teléfono y no hay otro.
 *
 *   node scripts/test-reloj-desfase.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const mod = { exports: {} };
new Function('exports', 'module', ts.transpileModule(
  fs.readFileSync(path.join(ROOT, 'src/lib/relojDesfase.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } },
).outputText)(mod.exports, mod);

const { desfaseMinutos, relojDesfasado, avisoDesfase, DESFASE_TOLERADO_MIN } = mod.exports;

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? '  -> ' + extra : '')); }
};

console.log('RELOJ DEL TELEFONO\n');

const SRV = '2026-09-02T12:00:00-04:00';
const ms = (iso) => Date.parse(iso);

// ── 1) La medida ───────────────────────────────────────────────────────────
{
  ok('la tolerancia de la casa son 3 minutos', DESFASE_TOLERADO_MIN === 3, String(DESFASE_TOLERADO_MIN));

  ok('en hora -> 0', desfaseMinutos(SRV, ms(SRV)) === 0);
  ok('⭐ telefono ADELANTADO 10 min -> +10', desfaseMinutos(SRV, ms(SRV) + 10 * 60000) === 10);
  ok('⭐ telefono ATRASADO 10 min -> -10', desfaseMinutos(SRV, ms(SRV) - 10 * 60000) === -10);
  ok('redondea al minuto', desfaseMinutos(SRV, ms(SRV) + 89000) === 1);

  // ⭐ NO SABER no es lo mismo que ESTAR BIEN.
  ok('⭐ sin hora del servidor -> null', desfaseMinutos(null, ms(SRV)) === null);
  ok('⭐ hora del servidor ilegible -> null', desfaseMinutos('ayer', ms(SRV)) === null);
  ok('⭐ hora del servidor vacia -> null', desfaseMinutos('', ms(SRV)) === null);
  ok('sin hora del telefono usa la de ahora (no revienta)', typeof desfaseMinutos(SRV) === 'number');
}

// ── 2) Cuando amerita avisar ───────────────────────────────────────────────
{
  ok('0 no amerita', relojDesfasado(0) === false);
  ok('3 clavados NO amerita (el corte es "mas de")', relojDesfasado(3) === false);
  ok('⭐ 4 SI amerita', relojDesfasado(4) === true);
  ok('⭐ -4 tambien (atrasado importa igual)', relojDesfasado(-4) === true);
  ok('⭐⭐ no medido (null) NO amerita: no se alarma por lo no comprobado',
    relojDesfasado(null) === false);
  ok('la tolerancia se puede mover', relojDesfasado(4, 10) === false);
  ok('* y en el otro sentido', relojDesfasado(2, 1) === true);
}

// ── 3) El aviso, en palabras que alguien pueda usar ────────────────────────
{
  ok('en hora -> sin aviso', avisoDesfase(0) === null);
  ok('no medido -> sin aviso', avisoDesfase(null) === null);

  const ade = avisoDesfase(10);
  ok('⭐ adelantado lo dice', ade && ade.includes('ADELANTADO'), String(ade));
  ok('* y dice cuanto', ade.includes('10 minuto'), ade);
  ok('* y dice POR QUE importa', /d[ií]a|turno/i.test(ade), ade);
  ok('* y dice QUE hacer', /ajusta/i.test(ade), ade);

  const atr = avisoDesfase(-10);
  ok('⭐ atrasado lo dice', atr && atr.includes('ATRASADO'), String(atr));

  ok('1 minuto en singular', String(avisoDesfase(1, 0)).includes('1 minuto '), avisoDesfase(1, 0));
  ok('90 min se dice en horas y minutos', String(avisoDesfase(90)).includes('1 h 30 min'), avisoDesfase(90));
  ok('3 horas se dice en horas', String(avisoDesfase(180)).includes('3 horas'), avisoDesfase(180));
}

// ── 4) ⭐ La libreria es PURA: no toca la red ni la hora por su cuenta ──────
{
  const crudo = fs.readFileSync(path.join(ROOT, 'src/lib/relojDesfase.ts'), 'utf8');
  const vivo = crudo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok('⭐ no habla con Supabase', !/supabase|from\(/.test(vivo));
  ok('⭐ no hace fetch', !/fetch\(/.test(vivo));
  // ⚠️ NO reemplaza la hora del viaje: solo avisa. Si algun dia esto empezara a
  //    devolver una hora "corregida", el registro sin conexion se rompe.
  ok('⭐⭐ no exporta nada que parezca "la hora buena"',
    !/export function (ahora|horaCorregida|horaBuena)/.test(vivo));
}

console.log('\n' + pass + ' OK · ' + fail + ' FALLO(S)');
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('El telefono desfasado avisa; la hora del viaje no se toca.');
