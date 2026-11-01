import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 Iniciando pruebas de verificación: Reporte de Jornadas Modificable...');

const reportsPath = path.resolve('src/screens/ReportsScreen.tsx');
const historicoPath = path.resolve('src/screens/HistoricoJornadasScreen.tsx');

const reportsContent = fs.readFileSync(reportsPath, 'utf8');
const historicoContent = fs.readFileSync(historicoPath, 'utf8');

// 1. Verificar definición de interfaces y opciones de personalización
assert(reportsContent.includes('export interface OpcionesJornadaReporte'), 'Debe existir OpcionesJornadaReporte');
assert(reportsContent.includes('sinNoTrabajaron'), 'Debe incluir opción sinNoTrabajaron');
assert(reportsContent.includes('sinHorometros'), 'Debe incluir opción sinHorometros');
assert(reportsContent.includes('sinViajes'), 'Debe incluir opción sinViajes');
assert(reportsContent.includes('sinResumenGeneral'), 'Debe incluir opción sinResumenGeneral');
assert(reportsContent.includes('sinTarjetasTop'), 'Debe incluir opción sinTarjetasTop');

// 2. Verificar estado y controles de logos en ReportsScreen
assert(reportsContent.includes('const [roundsLogos, setRoundsLogos]'), 'Debe existir estado roundsLogos');
assert(reportsContent.includes('const [opRounds, setOpRounds]'), 'Debe existir estado opRounds');
assert(reportsContent.includes('const [roundsTitulo, setRoundsTitulo]'), 'Debe existir estado roundsTitulo');
assert(reportsContent.includes('const [roundsNota, setRoundsNota]'), 'Debe existir estado roundsNota');
assert(reportsContent.includes('roundsLogos.sinMarcaTexto'), 'Debe soportar alternar sinMarcaTexto');

// 3. Verificar que downloadRoundsPdf y downloadPorMaquinaPdf usan roundsLogos y opRounds
assert(reportsContent.includes('pdfShell(tituloDoc, sub, content, roundsLogos)'), 'downloadRoundsPdf debe pasar roundsLogos y tituloDoc a pdfShell');
assert(reportsContent.includes("pdfShell('TOTAL POR EQUIPO · JORNADA', sub, body, roundsLogos)"), 'Total por equipo debe pasar roundsLogos a pdfShell');

// 4. Verificar que el selector y opciones aparecen tanto en la pantalla principal como en el modal de preview
const roundsConfigOccurrences = (reportsContent.match(/Personalizar membrete y opciones del PDF/g) || []).length;
assert(roundsConfigOccurrences >= 1, 'Debe haber selector en modal de preview');
const pastillasOccurrences = (reportsContent.match(/PASTILLAS_JORNADA\.map/g) || []).length;
assert(pastillasOccurrences >= 2, 'Las pastillas deben estar tanto en pantalla principal como en el modal de preview');

// 5. Verificar HistoricoJornadasScreen (Reporte de inspectores)
assert(historicoContent.includes('const [inspLogos, setInspLogos]'), 'HistoricoJornadasScreen debe tener estado inspLogos');
assert(historicoContent.includes('logos: inspLogos'), 'HistoricoJornadasScreen debe pasar logos a pdfDocument');
assert(historicoContent.includes('Placa: ${r.plate}'), 'HistoricoJornadasScreen debe identificar la maquinaria con su PLACA');

// 6. Verificar regla de maquinaria en ReportsScreen (placa presente)
assert(reportsContent.includes("`Placa: ${m.plate}`"), 'ReportsScreen debe identificar la maquinaria con su PLACA');

console.log('✅ Todas las aserciones de código y conexiones pasaron exitosamente.');
