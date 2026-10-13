// 🧾 Candados del IVA en Compras Directas — 13-oct-2026.
//
// Pedido: «en la cantera, en las compras directas, tienes la opción de colocar
// automáticamente el IVA en 16% y poder modificarlo, y también el cuadrito de
// colocarlo exento — tráetelo para acá». Reglas vigiladas: nace en 16 y es
// editable; el exento es POR RENGLÓN; el IVA sale SOLO de la base imponible;
// el total guardado ya lo incluye; y las compras viejas (alícuota 0) no se
// mueven ni un céntimo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const scr = leer('src/screens/ComprasScreen.tsx');

// La alícuota: nace en 16 y se puede cambiar.
ok('🧾 el 16% es la casa: IVA_POR_DEFECTO = 16', scr.includes('const IVA_POR_DEFECTO = 16;'));
ok('🧾 la alícuota NACE en 16 (useState con el default)', scr.includes('useState(String(IVA_POR_DEFECTO))'));
ok('🧾 …y es editable (campo IVA % conectado al estado)', scr.includes('value={alicuota} onChangeText={setAlicuota}'));
ok('🧾 se acota a [0, 100] al guardar', scr.includes("Math.min(100, Math.max(0, parseNum(alicuota) || 0))"));

// El exento es por renglón y resta de la base imponible.
ok('☑ cada renglón tiene su cuadrito «Exento de IVA»', scr.includes('Exento de IVA') && scr.includes('upd(i, { exento: !l.exento })'));
ok('☑ la base imponible EXCLUYE los exentos', scr.includes('l.exento ? 0 :'));
ok('☑ el IVA sale de la base imponible, no del subtotal', scr.includes('ivaDe') && scr.includes('baseImponible(items) * (Number(alicuota) || 0)'));

// El total guardado ya incluye el IVA, y la alícuota viaja a la base.
ok('⭐ el payload guarda total = subtotal + IVA', scr.includes('total: Math.round((linesTotal(clean) + ivaDe(clean, alic)) * 100) / 100'));
ok('⭐ el payload guarda la alícuota (alicuota_iva)', scr.includes('alicuota_iva: alic,'));

// Las compras viejas no se mueven: editar una sin IVA sale con SU 0.
ok('🕰️ editar una compra vieja respeta su alícuota (0 si no tenía)', scr.includes('setAlicuota(String(c.alicuota_iva ?? 0))'));

// El resumen al estilo LA CANTERA.
ok('📄 el resumen trae Subtotal · Base imponible · IVA · Total',
  scr.includes("fila('Subtotal'") && scr.includes('Base imponible') && scr.includes('fila(`IVA (${alic}%)`') && scr.includes("fila('Total'"));

// Si falta la columna en la base, el error lo dice claro (no un error crudo).
ok('🧯 sin la columna en la base, el aviso lo explica', scr.includes('Falta la columna del IVA en la base'));

// El exento vive en el JSON de renglones: el tipo lo declara opcional
// (los renglones viejos no lo tienen y siguen gravados).
const tipos = leer('src/types/database.ts');
ok('🔤 PurchaseLine.exento es opcional', tipos.includes('exento?: boolean'));
ok('🔤 DirectPurchase.alicuota_iva puede venir null (columna sin correr)', tipos.includes('alicuota_iva?: number | null'));

// Los otros flujos que usan LineEditor (requerimientos, órdenes) NO ganan el
// cuadrito: conExento solo se pasa en la compra directa.
ok('🔒 el exento es SOLO de compras directas (un solo conExento)', (scr.match(/conExento(?=[ /}])/g) || []).length >= 1 && (scr.match(/<LineEditor[^>]*conExento/g) || []).length === 1);

console.log(`\n🧾 Compras directas · IVA: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   Nace en 16%, se cambia, el exento no paga y lo viejo no se mueve.');
