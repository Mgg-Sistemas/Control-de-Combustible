/*
 * 📑 SOPORTE DE MEDICIÓN POR PARTIDA Y REGISTRO DIARIO DE ACARREO Y PESAJE (24-nov-2026).
 * Prueba la lógica pura de días activos/sin actividad, acumulados, frentes,
 * conciliación, firmas, escape XSS e integración en ViajesCamionesScreen.
 *
 *   node scripts/test-viajes-valuacion-pdf.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

require.extensions['.ts'] = (m, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  m._compile(out, filename);
};

const {
  CONFIG_VALUACION_INICIAL,
  construirDatosValuacion,
  generarHtmlValuacionPdf,
  jornadaDeInstante,
  horaCaracas,
} = require(path.join(ROOT, 'src/lib/viajesValuacionPdf.ts'));

const srcScreen = fs.readFileSync(path.join(ROOT, 'src/screens/ViajesCamionesScreen.tsx'), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else {
    fail++;
    failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`);
  }
};

// 1. Jornada 7am-7am Caracas y hora local
eq('jornada 14:18 Caracas del 13/11 es 2026-11-13', jornadaDeInstante('2026-11-13T14:18:00-04:00'), '2026-11-13');
eq('jornada 06:30 Caracas del 14/11 sigue siendo 2026-11-13', jornadaDeInstante('2026-11-14T06:30:00-04:00'), '2026-11-13');
eq('horaCaracas 14:18', horaCaracas('2026-11-13T14:18:00-04:00'), '14:18');

// 2. Periodo de 3 días (13 activo, 14 sin actividad, 15 activo)
const viajes = [
  {
    id: 'v1',
    registered_at: '2026-11-13T14:18:00-04:00',
    machinery_id: 'm1',
    machine_code: 'CAMION VOLTEO TORONTO',
    placa_snap: 'A90BH2R',
    chofer_name: 'Juan Perez',
    peso_tara_kg: 12000,
    peso_bruto_kg: 23800,
    peso_neto_kg: 11800,
    frente_id: 'f1',
    frente_nombre: 'CDT Playa Escondida',
    ubicacion_nombre: 'CDT Playa Escondida (Tanaguarena)',
  },
  {
    id: 'v2',
    registered_at: '2026-11-15T10:00:00-04:00',
    machinery_id: 'm2',
    machine_code: 'CAMION VOLTEO',
    placa_snap: null,
    chofer_name: null,
    peso_tara_kg: null,
    peso_bruto_kg: null,
    peso_neto_kg: 32160,
    frente_id: 'f2',
    frente_nombre: 'Frente Norte <test>',
    ubicacion_nombre: 'CDT Playa Escondida (Tanaguarena)',
  },
];

const maquinas = [
  { id: 'm1', code: 'CAMION VOLTEO TORONTO', plate: 'A90BH2R' },
  { id: 'm2', code: 'CAMION VOLTEO', plate: 'A07CW5J' },
];

const datos = construirDatosValuacion(viajes, '2026-11-13', '2026-11-15', {
  ...CONFIG_VALUACION_INICIAL,
  acumuladoAnterior: '100',
  contratado: '500',
});

eq('total días en periodo', datos.dias.length, 3);
eq('días activos', datos.diasActivos.length, 2);
eq('día 1 soporte', datos.dias[0].soporte, 'Control diario');
eq('día 2 soporte sin actividad', datos.dias[1].soporte, 'Sin actividad');
eq('día 2 mantiene acumulado', datos.dias[1].acumuladoT, 11.8);
eq('día 2 mantiene viajesAcum', datos.dias[1].viajesAcum, 1);
eq('día 3 acumulado suma ambos', datos.dias[2].acumuladoT, 43.96);
eq('total viajes', datos.totalViajes, 2);
eq('total toneladas', datos.totalT, 43.96);
eq('frentes cuadran', datos.cuadraFrentes, true);
eq('total páginas = 2 + días activos', datos.totalPaginas, 4);
eq('acumulado a la fecha = 100 + 43.96', datos.acumuladoAFechaT, 143.96);
eq('saldo contractual = 500 - 143.96', datos.saldoContractualT, 356.04);

// 3. Generación HTML y escape XSS (con respaldo de choferes por camión/turno)
const html = generarHtmlValuacionPdf({
  viajes,
  maquinas,
  choferesPorCamionTurno: { 'm2|day': 'Douglas Azuaje' },
  desde: '2026-11-13',
  hasta: '2026-11-15',
  config: CONFIG_VALUACION_INICIAL,
});

eq('incluye sección 1 registro diario', html.includes('1 &nbsp; REGISTRO DIARIO DEL PERÍODO'), true);
eq('incluye sección 2 distribución frentes', html.includes('2 &nbsp; DISTRIBUCIÓN POR FRENTES DE TRABAJO'), true);
eq('incluye sección 3 conciliación', html.includes('3 &nbsp; CONCILIACIÓN DE LA PARTIDA'), true);
eq('incluye registro diario de acarreo y pesaje', html.includes('Registro diario de acarreo y pesaje'), true);
eq('usa placa de catálogo cuando placa_snap es null', html.includes('A07CW5J'), true);
eq('usa chofer de respaldo cuando chofer_name es null', html.includes('Douglas Azuaje'), true);
eq('escapa HTML peligroso en frente', html.includes('Frente Norte &lt;test&gt;'), true);
eq('NO incluye tag crudo <test>', html.includes('<test>'), false);
eq('incluye Página 4 de 4', html.includes('Página 4 de 4'), true);

// 4. Integración en ViajesCamionesScreen y filtro de camión por placa en ValuacionViajesCard
const srcCard = fs.readFileSync(path.join(ROOT, 'src/components/ValuacionViajesCard.tsx'), 'utf8');
eq('ViajesCamionesScreen importa ValuacionViajesCard', /ValuacionViajesCard/.test(srcScreen), true);
eq('ValuacionViajesCard filtra por camionesSel', /camionesSel/.test(srcCard), true);
eq('ValuacionViajesCard tiene buscador por placa', /busqCamion/.test(srcCard), true);

console.log(`test-viajes-valuacion-pdf: ${pass} pasaron, ${fail} fallaron.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
