/**
 * Pruebas unitarias para Distribución de Guardias y Días Libres del Personal:
 * - Colocar manualmente días de trabajo (T) y de descanso (D) tocando el calendario o por rango
 * - Indicar cuántos días de trabajo (X) y cuántos de descanso (Y) para calcular automáticamente
 *   los períodos de trabajo y de descanso del personal
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let ultimoHtmlPdf = '';

const customRequire = (id) => {
  if (id === './pdf') {
    return {
      pdfDocument: ({ title, subtitle, body }) => `<h1>${title}</h1><h2>${subtitle}</h2>${body}`,
      exportPdf: async (html) => {
        ultimoHtmlPdf = html;
        return true;
      },
    };
  }
  if (id === './text') {
    return {
      cmpText: (a, b) => String(a || '').localeCompare(String(b || ''), 'es'),
    };
  }
  return require(id);
};

const mod = { exports: {} };
new Function(
  'exports',
  'module',
  'require',
  ts.transpileModule(leer('src/lib/guardiasReport.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText
)(mod.exports, mod, customRequire);

const {
  compactarDiasEnRangos,
  calcularPeriodosPersonaEnCiclo,
  aplicarCambioManualEnRangos,
  alternarDiaManualEnRangos,
  calcularGruposSugeridosFormula,
  generarPeriodosAutomaticosTrabajoDescanso,
  generateGuardiasReport,
} = mod.exports;

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name + (extra ? ` → ${extra}` : ''));
  }
};

console.log('GUARDIAS Y DÍAS LIBRES — Edición manual T/D y cálculo automático Trabajo × Descanso\n');

// 1. Cálculo de períodos de trabajo y de descanso dentro de un ciclo
{
  const res = calcularPeriodosPersonaEnCiclo('2026-11-06', '2026-11-26', [
    { from_date: '2026-11-09', to_date: '2026-11-15' },
  ]);
  ok('Calcula 14 días de trabajo y 7 de descanso en el ciclo de 21 días', res.diasTrabajo.length === 14 && res.diasDescanso.length === 7);
  ok(
    'Divide el trabajo en 2 períodos continuos (06/11..08/11 y 16/11..26/11)',
    res.periodosTrabajo.length === 2 &&
      res.periodosTrabajo[0].from_date === '2026-11-06' &&
      res.periodosTrabajo[0].to_date === '2026-11-08' &&
      res.periodosTrabajo[0].days === 3 &&
      res.periodosTrabajo[1].from_date === '2026-11-16' &&
      res.periodosTrabajo[1].to_date === '2026-11-26' &&
      res.periodosTrabajo[1].days === 11
  );
  ok('Formatea resumen de trabajo y de descanso con días y fechas', res.resumenTrabajoTxt.includes('14 d (06/11 al 08/11 · 16/11 al 26/11)') && res.resumenDescansoTxt.includes('7 d (09/11 al 15/11)'));
}

// 2. Alternar manualmente un día en el calendario (incluso dentro de una semana de descanso)
{
  const descansosIniciales = [{ from_date: '2026-11-09', to_date: '2026-11-15' }];
  // Tocar el día 2026-11-11 (que estaba en D) lo pasa a Trabajo (T) y parte el descanso en dos
  const paso1 = alternarDiaManualEnRangos(descansosIniciales, '2026-11-11');
  ok(
    'Al tocar un día en descanso (11/11) pasa a trabajo y parte el rango en 09..10 y 12..15',
    paso1.nuevoEstado === 'trabajo' &&
      paso1.rangosDescanso.length === 2 &&
      paso1.rangosDescanso[0].from_date === '2026-11-09' &&
      paso1.rangosDescanso[0].to_date === '2026-11-10' &&
      paso1.rangosDescanso[1].from_date === '2026-11-12' &&
      paso1.rangosDescanso[1].to_date === '2026-11-15'
  );

  // Tocar de nuevo el 2026-11-11 lo vuelve a poner en descanso y une el rango 09..15
  const paso2 = alternarDiaManualEnRangos(paso1.rangosDescanso, '2026-11-11');
  ok(
    'Al volver a tocar el mismo día (11/11) regresa a descanso y compacta el rango 09..15',
    paso2.nuevoEstado === 'descanso' &&
      paso2.rangosDescanso.length === 1 &&
      paso2.rangosDescanso[0].from_date === '2026-11-09' &&
      paso2.rangosDescanso[0].to_date === '2026-11-15'
  );
}

// 3. Marcar un rango manual como Trabajo (T) o como Descanso (D)
{
  const descansos = [{ from_date: '2026-11-09', to_date: '2026-11-15' }];
  const trasTrabajo = aplicarCambioManualEnRangos(descansos, '2026-11-13', '2026-11-20', 'trabajo');
  ok(
    'Marcar un rango como TRABAJO recorta cualquier descanso que se solapara',
    trasTrabajo.length === 1 && trasTrabajo[0].from_date === '2026-11-09' && trasTrabajo[0].to_date === '2026-11-12'
  );
}

// 4. Cálculo automático de períodos indicando X días de trabajo y Y días de descanso
{
  // Caso 14x7 empezando con trabajo (Grupo A índice 0)
  const gA = generarPeriodosAutomaticosTrabajoDescanso({
    from: '2026-11-06',
    to: '2026-11-26',
    diasTrabajo: 14,
    diasDescanso: 7,
    modo: 'escalonado_trabajo',
    indiceGrupo: 0,
  });
  ok(
    '14×7 (Grupo A empieza trabajando): 14 días de trabajo (06/11..19/11) y 7 de descanso (20/11..26/11)',
    gA.diasTrabajoList.length === 14 &&
      gA.diasDescansoList.length === 7 &&
      gA.periodosTrabajo[0].from_date === '2026-11-06' &&
      gA.periodosTrabajo[0].to_date === '2026-11-19' &&
      gA.periodosDescanso[0].from_date === '2026-11-20' &&
      gA.periodosDescanso[0].to_date === '2026-11-26'
  );

  // Caso 5 días de trabajo × 2 días de descanso en 14 días (2 semanas)
  const c5x2 = generarPeriodosAutomaticosTrabajoDescanso({
    from: '2026-11-01',
    to: '2026-11-14',
    diasTrabajo: 5,
    diasDescanso: 2,
    modo: 'simultaneo_trabajo_primero',
  });
  ok(
    '5×2 en 14 días genera automáticamente 2 períodos de trabajo de 5 días y 2 de descanso de 2 días',
    c5x2.diasTrabajoList.length === 10 &&
      c5x2.diasDescansoList.length === 4 &&
      c5x2.periodosTrabajo.length === 2 &&
      c5x2.periodosDescanso.length === 2 &&
      c5x2.periodosTrabajo[0].days === 5 &&
      c5x2.periodosDescanso[0].days === 2
  );

  // Caso 7×7 sugiere 2 grupos y reparte sin dejar días sin cobertura
  const g7x7_A = generarPeriodosAutomaticosTrabajoDescanso({
    from: '2026-11-01',
    to: '2026-11-14',
    diasTrabajo: 7,
    diasDescanso: 7,
    modo: 'escalonado_trabajo',
    indiceGrupo: 0,
  });
  const g7x7_B = generarPeriodosAutomaticosTrabajoDescanso({
    from: '2026-11-01',
    to: '2026-11-14',
    diasTrabajo: 7,
    diasDescanso: 7,
    modo: 'escalonado_trabajo',
    indiceGrupo: 1,
  });
  ok(
    '7×7 sugiere 2 grupos complementarios (cuando A descansa, B trabaja)',
    calcularGruposSugeridosFormula(7, 7) === 2 &&
      g7x7_A.periodosTrabajo[0].from_date === '2026-11-01' &&
      g7x7_B.periodosDescanso[0].from_date === '2026-11-01'
  );
}

// 5. PDF incluye columna Trabajo del ciclo y Descanso del ciclo
{
  await generateGuardiasReport({
    from: '2026-11-06',
    to: '2026-11-26',
    rotation: '14x7',
    inspectors: [{ name: 'FRANK NARROS', grupo: 'A', cargo: 'Inspector', cedula: '27733898', telefono: null, sector: null }],
    shifts: [{ inspector_name: 'FRANK NARROS', from_date: '2026-11-09', to_date: '2026-11-15', kind: 'descanso' }],
  });
  ok(
    'El PDF generado incluye tanto Trabajo del ciclo como Descanso del ciclo',
    ultimoHtmlPdf.includes('Trabajo del ciclo') &&
      ultimoHtmlPdf.includes('Descanso del ciclo') &&
      ultimoHtmlPdf.includes('14 d (06/11 al 08/11 · 16/11 al 26/11)')
  );
}

// 6. Integración en las pantallas de Guardias e Inspectores y Días Libres de Nómina
{
  const guardiasSrc = leer('src/screens/DistribucionGuardiasScreen.tsx');
  const libresSrc = leer('src/screens/DiasLibresCargoScreen.tsx');

  ok(
    'DistribucionGuardiasScreen tiene botón y modal «Días Trabajo × Descanso» y clic directo en el calendario',
    guardiasSrc.includes('Días Trabajo × Descanso') &&
      guardiasSrc.includes('toggleDiaCalendario') &&
      guardiasSrc.includes('Marcar días de trabajo (T)')
  );
  ok(
    'DiasLibresCargoScreen tiene botón y modal «Días Trabajo × Descanso» y edición manual de días de trabajo y descanso',
    libresSrc.includes('Días Trabajo × Descanso') &&
      libresSrc.includes('generarPorFormulaPersonal') &&
      libresSrc.includes('alternarDiaManualEnRangos')
  );
}

if (fail > 0) {
  console.error(`\n❌ ${fail} FALLO(S):`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
} else {
  console.log(`✅ ${pass} OK · 0 FALLOS`);
}

