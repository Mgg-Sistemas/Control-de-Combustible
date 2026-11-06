// 👥 RESUMEN POR CARGO CON SALARIOS TAMBIÉN DICE CUÁNTAS PERSONAS (06-nov-2026, a pedido):
// en el modo tabulador (con columnas de salario) la tabla solo traía cargo, departamento y
// montos; ahora lleva la columna «Personas» y su total en el pie.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src/lib/empleadosReporte.ts'), 'utf8');
const tab = src.slice(src.indexOf('Modo Tabulador por Cargo'), src.indexOf('} else {', src.indexOf('Modo Tabulador por Cargo')));

let ok = 0; const fallas = [];
const check = (c, m) => { if (c) ok++; else fallas.push('  ✗ ' + m); };
check(/thsCargo\.push\('<th class="r nw" style="width:80px">Personas<\/th>'\)/.test(tab), 'cabecera «Personas» en el tabulador');
check(/\.map\(\(\[c, n\], idx\) =>/.test(tab) && /tds\.push\(`<td class="r nw"><b>\$\{n\}<\/b><\/td>`\)/.test(tab), 'cada cargo muestra su cantidad');
check(/TOTAL \(\$\{resumen\.length\} cargos\)<\/td>`, `<td class="r nw">\$\{lista\.length\}<\/td>`/.test(tab), 'el pie suma las personas');

if (fallas.length) { console.error(fallas.join('\n')); process.exit(1); }
console.log(`✅ test-empleados-personas-por-cargo: ${ok} ok, 0 fallas`);
