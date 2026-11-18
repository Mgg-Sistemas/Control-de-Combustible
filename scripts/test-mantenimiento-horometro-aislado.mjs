// Prueba de aislamiento de horómetros en Mantenimiento de Maquinaria (18-nov-2026).
// Verifica que Mantenimiento NO toque last_horometro de los inspectores y que no falle
// por falta de permiso UPDATE sobre machinery cuando el servicio se guardó en machinery_preventive_services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const leer = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const dbSrc = leer('src/lib/mantenimientoPreventivoDb.ts');
const scrSrc = leer('src/screens/MantenimientoMaquinariaScreen.tsx');

// 1. Mantenimiento NUNCA escribe en last_horometro ni en horometro_trabajo de los inspectores
assert(!/\.update\([^)]*last_horometro/i.test(dbSrc), 'mantenimientoPreventivoDb no debe actualizar last_horometro de inspectores');
assert(!/\.from\(['"]horometro_trabajo['"]\)/.test(dbSrc), 'mantenimientoPreventivoDb no debe escribir en horometro_trabajo');

// 2. Usa machinery_preventive_services como fuente persistente y syncMachineryBasePreventivo tolerante
assert(dbSrc.includes('export async function cargarUltimosServiciosPorMaquina'), 'Falta cargarUltimosServiciosPorMaquina');
assert(dbSrc.includes('sync_mantenimiento_preventivo_base'), 'Debe intentar RPC sync_mantenimiento_preventivo_base');
assert(!dbSrc.includes('No se pudo actualizar el horómetro base de la máquina (sin permiso).'), 'No debe bloquear al usuario de mantenimiento si machinery_preventive_services guardó el servicio');

// 3. MantenimientoMaquinariaScreen prioriza el último servicio preventivo de machinery_preventive_services
assert(scrSrc.includes('cargarUltimosServiciosPorMaquina'), 'MantenimientoMaquinariaScreen debe cargar los últimos servicios preventivos');
assert(scrSrc.includes('cargarTodosServiciosPreventivos') && scrSrc.includes('preventivosFiltrados'), 'La pestaña Historial y su PDF deben incluir los mantenimientos preventivos confirmados');

console.log('✅ test-mantenimiento-horometro-aislado: todas las verificaciones pasaron (7/7).');
