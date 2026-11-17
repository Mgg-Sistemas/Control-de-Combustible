// Prueba del modo Solo Resumen (Estilo Tesorería SOS) en Cuentas por Pagar (17-nov-2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const leer = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const repSrc = leer('src/lib/cuentasReporte.ts');
const modalSrc = leer('src/components/ReporteCuentasModal.tsx');

// 1. Modo resumen definido y soportado en cuentasReporte.ts
assert(repSrc.includes("export type ModoReporteCuentas = 'detallado' | 'resumen'"), 'Falta tipo ModoReporteCuentas');
assert(repSrc.includes("if (op.modo === 'resumen')"), 'armarReporteCuentas debe soportar op.modo === resumen');
assert(repSrc.includes('RESUMEN DE PAGOS — POR MÉTODO'), 'Debe incluir sección RESUMEN DE PAGOS — POR MÉTODO');
assert(repSrc.includes('TOTAL CONSOLIDADO (DÓLARES - $ USD)'), 'Debe incluir bloque TOTAL CONSOLIDADO');
assert(repSrc.includes('ÓRDENES'), 'Debe mostrar total de órdenes');
assert(repSrc.includes('#16324F') && repSrc.includes('#0284C7'), 'Debe usar los colores institucionales de SOS La Guaira');
assert(repSrc.includes("if (op.modo === 'resumen') partes.push('resumen')"), 'El nombre del archivo debe incluir resumen');

// 2. ReporteCuentasModal.tsx ofrece el selector de formato Solo Resumen
assert(modalSrc.includes('Solo Resumen (Estilo Tesorería SOS)'), 'El modal debe ofrecer la opción Solo Resumen (Estilo Tesorería SOS)');
assert(modalSrc.includes("op.modo !== 'resumen'"), 'Debe ocultar columnas detalladas cuando modo === resumen');

console.log('✅ test-cuentas-resumen-sos: todas las verificaciones pasaron (9/9).');
