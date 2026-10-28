/*
 * 📱💱 ENCABEZADO EN TELÉFONO Y CUENTAS EN DOS MONEDAS (28-oct-2026).
 * 1. En un iPhone grande (430 px) el encabezado mostraba «Cerrar sesión» en texto y la fecha, y
 *    todo se montaba sobre el título: el modo compacto debe cubrir todo teléfono en vertical.
 * 2. Cuentas por pagar/cobrar: el monto es en US$ y al lado sale su equivalente en Bs con la tasa
 *    BCV de hoy (monto y saldo).
 *   node scripts/test-encabezado-y-cuentas-bs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const nav = fs.readFileSync(path.join(ROOT, 'src/navigation/index.tsx'), 'utf8');
const cuentas = fs.readFileSync(path.join(ROOT, 'src/screens/CuentasScreen.tsx'), 'utf8');
let ok = 0; const fallos = [];
const t = (n, c) => { if (c) ok++; else fallos.push(n); };
const m = nav.match(/const HEADER_COMPACT_BREAKPOINT = (\d+);/);
t('1. el encabezado es compacto en todo teléfono (≥ 440 px)', !!m && Number(m[1]) >= 440);
t('2. Cuentas lee la tasa BCV de hoy', /const \{ rate: tasaBcv \} = useBcvRate\(\);/.test(cuentas));
t('2b. muestra el monto en Bs', /fmtBs\(bsFromUsd\(Number\(c\.monto\) \|\| 0, tasaBcv\)\)/.test(cuentas));
t('2c. y el saldo en Bs', /fmtBs\(bsFromUsd\(c\.saldo, tasaBcv\)\)/.test(cuentas));
console.log(`\n📱💱 Encabezado y cuentas en Bs: ${ok} OK · ${fallos.length} FALLO(S)`);
fallos.forEach((f) => console.log('  ✗ ' + f));
process.exit(fallos.length ? 1 : 0);
