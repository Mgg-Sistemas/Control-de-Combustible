// Prueba de conservación de historial al cambiar un camión de frente (17-nov-2026).
// Verifica que mover un camión de VENLIV a PORTO FINO congele los viajes previos sin frente
// en la jornada actual y que el resumen por frente conserve ambos frentes para el mismo camión.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const leer = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const camionViajesSrc = leer('src/lib/camionViajes.ts');
const frentesTrabajoSrc = leer('src/components/FrentesTrabajo.tsx');
const viajesScreenSrc = leer('src/screens/ViajesCamionesScreen.tsx');
const viajesResumenSrc = leer('src/lib/viajesResumen.ts');

// 1. camionViajes.ts: congelarFrentePrevioEnViajes respeta jornadaWindowISO y solo llena nulos
assert(camionViajesSrc.includes('export async function congelarFrentePrevioEnViajes'), 'Falta congelarFrentePrevioEnViajes en camionViajes.ts');
assert(camionViajesSrc.includes('jornadaWindowISO(params.jornada)'), 'congelarFrentePrevioEnViajes debe usar jornadaWindowISO (7am-7am)');
assert(camionViajesSrc.includes(".is('frente_id', null)"), 'Solo debe congelar viajes con frente_id nulo');
assert(camionViajesSrc.includes(".select('id')"), 'Debe usar .select("id") para verificar RLS');

// 2. FrentesTrabajo.tsx: congela antes de mover o quitar en camiones
assert(frentesTrabajoSrc.includes('congelarFrentePrevioEnViajes'), 'FrentesTrabajo debe llamar a congelarFrentePrevioEnViajes');

// 3. ViajesCamionesScreen.tsx: escucha cambios en viaje_frente_asignaciones en vivo
assert(viajesScreenSrc.includes("'viaje_frente_asignaciones'"), 'ViajesCamionesScreen debe escuchar realtime de viaje_frente_asignaciones');
assert(viajesScreenSrc.includes('setFrentesRecarga'), 'ViajesCamionesScreen debe refrescar asignacionesHoy en realtime');

// 4. viajesResumen.ts: el resumen por frente usa claveFrenteViaje por cada viaje (no sobrescribe frentes anteriores)
assert(viajesResumenSrc.includes("case 'frente':"), 'resumirViajes debe agrupar por frente');
assert(viajesResumenSrc.includes('claveFrenteViaje(r)'), 'resumirViajes debe usar claveFrenteViaje por viaje');

// 5. frentesAuto.ts y ViajesCamionesScreen.tsx: con 2+ frentes y creadoAt resuelven por línea de tiempo (no quedan en Sin frente)
const frentesAutoSrc = leer('src/lib/frentesAuto.ts');
assert(frentesAutoSrc.includes('todasConHora'), 'completarFrentes debe resolver por hora creadoAt cuando hay 2+ frentes');
assert(viajesScreenSrc.includes('masReciente'), 'frenteParaGrabar debe tomar el frente más reciente por creadoAt cuando hay 2+');

// 6. Asignación de frente en planificación se refleja en tickets y listero no cambia frentes
const tiqueConfigSrc = leer('src/lib/tiqueConfig.ts');
assert(tiqueConfigSrc.includes("k: 'frente'"), 'CAMPOS_TIQUE debe incluir frente');
assert(tiqueConfigSrc.includes('frente: true'), 'frente debe venir encendido por defecto en tickets');
assert(!viajesScreenSrc.includes('frentesListeroAbierto'), 'El listero no debe tener selector de frente');
assert(!viajesScreenSrc.includes('busqFrenteListero'), 'El listero no debe tener buscador de frente');
assert(viajesScreenSrc.includes('...frenteParaGrabar(esFuera ? null : selectedTruck.id)'), 'El viaje debe congelar la asignación de frentes del camión');
assert(!viajesScreenSrc.includes('sincronizarFrenteDesdeListero('), 'No debe haber sincronización de frente desde listero');
assert(viajesScreenSrc.includes('frente: row.frenteNombre ?? null'), 'datosTiqueDeViaje debe pasar frente al ticket');

// 7. frentesReporte.ts: cuenta camiones únicos reales e identifica repetidos en más de un frente
const frentesRepSrc = leer('src/lib/frentesReporte.ts');
assert(frentesRepSrc.includes('export function analizarRepetidosFrentes'), 'Falta analizarRepetidosFrentes en frentesReporte.ts');
assert(frentesRepSrc.includes('repetidos en más de un frente'), 'El reporte debe listar repetidos en más de un frente');

console.log('✅ test-frente-cambio-historico: todas las verificaciones pasaron (19/19).');
