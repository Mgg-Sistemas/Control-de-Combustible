/*
 * Test del MONTO QUINCENAL de la constancia de trabajo (21-ago-2026).
 *
 * QUÉ PEDIDO CUBRE (textual del cliente):
 *   «que salga un check para que le salga el monto quincenal; si le doy al check
 *    que le salga el monto que gana quincenal, y si no tiene un monto específico
 *    que haga un recálculo de cuánto gana si es semanal o mensual»
 *
 * LO QUE BLINDA (`src/lib/montoQuincenal.ts`):
 *   · Si tiene `precio_quincena`, ese MANDA y no se calcula nada.
 *   · Si no, se convierte: semana × 2 (una quincena son 2 semanas en este
 *     sistema) o mes ÷ 2 (un mes son 2 quincenas).
 *   · La PRIORIDAD es quincena > semana > mes.
 *   · ⭐ Un 0 cargado NO es "gana cero": es "sin definir", y se pasa al
 *     siguiente. Si no, alguien con precio_quincena = 0 y un sueldo mensual bien
 *     cargado saldría ganando CERO en un papel que va al banco.
 *   · Sin ningún monto → null. NO se inventa una cifra.
 *   · Basura (texto, null, negativos, sin ficha) no revienta.
 *
 * No usa framework de test (el repo no tiene): transpila el .ts en memoria con
 * el `typescript` ya instalado.
 *
 *   npm run test:monto-quincenal   (o: node scripts/test-monto-quincenal.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const loadTs = (srcPath) => {
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  m._compile(out, m.filename);
  return m.exports;
};

const { montoQuincenal, montoQuincenalTexto } = loadTs(path.join(ROOT, 'src/lib/montoQuincenal.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── 1) MONTO EXACTO: si tiene quincena, esa manda ──────────────────────────
{
  const r = montoQuincenal({ precio_quincena: 150 });
  eq('monto de la quincena', r.monto, 150);
  eq('origen', r.origen, 'quincena');
  ok('marcado como exacto', r.exacto);
  // Aunque tenga TAMBIÉN semana y mes, la quincena manda: es el dato cargado
  // a mano y no se le pisa con una conversión.
  const r2 = montoQuincenal({ precio_quincena: 150, precio_semana: 99, precio_mes: 999 });
  eq('⭐ la quincena le gana a semana y mes', [r2.monto, r2.origen], [150, 'quincena']);
}

// ── 2) SIN QUINCENA: se recalcula desde la SEMANA (× 2) ────────────────────
{
  const r = montoQuincenal({ precio_semana: 60 });
  eq('semana × 2', r.monto, 120);
  eq('origen', r.origen, 'semana');
  eq('NO es exacto (es conversión)', r.exacto, false);
  ok('el detalle dice de dónde salió', /semanal/i.test(r.detalle) && r.detalle.includes('60'));
  // La semana le gana al mes.
  eq('semana antes que mes', montoQuincenal({ precio_semana: 60, precio_mes: 500 }).origen, 'semana');
}

// ── 3) SOLO MES: se recalcula (÷ 2) ────────────────────────────────────────
{
  const r = montoQuincenal({ precio_mes: 500 });
  eq('mes ÷ 2', r.monto, 250);
  eq('origen', r.origen, 'mes');
  eq('NO es exacto', r.exacto, false);
  ok('el detalle dice de dónde salió', /mensual/i.test(r.detalle));
  // Redondeo a 2 decimales, sin colas de centavos.
  eq('mes impar se redondea', montoQuincenal({ precio_mes: 333.33 }).monto, 166.67);
  eq('semana con decimales', montoQuincenal({ precio_semana: 33.335 }).monto, 66.67);
}

// ── 4) ⭐ UN 0 NO ES "GANA CERO", ES "SIN DEFINIR" ─────────────────────────
// Si no, alguien con la quincena en 0 y el mes bien cargado saldría ganando
// CERO en un papel que va al banco.
{
  eq('quincena en 0 → pasa a la semana', montoQuincenal({ precio_quincena: 0, precio_semana: 60 }).origen, 'semana');
  eq('quincena y semana en 0 → pasa al mes', montoQuincenal({ precio_quincena: 0, precio_semana: 0, precio_mes: 500 }).origen, 'mes');
  eq('todo en 0 → no hay monto', montoQuincenal({ precio_quincena: 0, precio_semana: 0, precio_mes: 0 }), null);
  // Un negativo tampoco es un sueldo.
  eq('negativo se ignora', montoQuincenal({ precio_quincena: -50, precio_mes: 500 }).origen, 'mes');
}

// ── 5) SIN NADA: null, y NO se inventa un número ───────────────────────────
{
  eq('ficha sin sueldos', montoQuincenal({}), null);
  eq('todo nulo', montoQuincenal({ precio_quincena: null, precio_semana: null, precio_mes: null }), null);
  eq('sin empleado', montoQuincenal(null), null);
  eq('indefinido', montoQuincenal(undefined), null);
  eq('texto formateado cuando no hay', montoQuincenalTexto({}), null);
  // `base_salary` NO se usa: no dice si es semanal, quincenal o mensual.
  eq('⭐ base_salary no se toma como quincena', montoQuincenal({ base_salary: 400 }), null);
}

// ── 6) TEXTO PARA EL PDF ───────────────────────────────────────────────────
{
  // El separador decimal lo pone el idioma del equipo (coma en es-VE, punto en
  // en-US), igual que el resto de la app: se comprueba la FORMA, no el símbolo.
  const dosDecimales = /^\$\d[\d.,]*[.,]\d{2}$/;
  ok('quincena con 2 decimales', dosDecimales.test(montoQuincenalTexto({ precio_quincena: 150 })));
  ok('y trae el 150', /150/.test(montoQuincenalTexto({ precio_quincena: 150 })));
  ok('conversión con 2 decimales', dosDecimales.test(montoQuincenalTexto({ precio_semana: 60 })));
  ok('y trae el 120', /120/.test(montoQuincenalTexto({ precio_semana: 60 })));
  ok('lleva el signo de dólar', montoQuincenalTexto({ precio_mes: 500 }).startsWith('$'));
}

// ── 7) BASURA: no revienta ────────────────────────────────────────────────
{
  eq('texto en vez de número', montoQuincenal({ precio_quincena: 'abc', precio_mes: 500 }).origen, 'mes');
  eq('número como texto sí sirve', montoQuincenal({ precio_quincena: '150' }).monto, 150);
  eq('NaN se ignora', montoQuincenal({ precio_semana: NaN, precio_mes: 500 }).origen, 'mes');
  eq('Infinity se ignora', montoQuincenal({ precio_quincena: Infinity, precio_mes: 500 }).origen, 'mes');
  eq('cadena vacía se ignora', montoQuincenal({ precio_quincena: '', precio_mes: 500 }).origen, 'mes');
}

// ── Resultado ─────────────────────────────────────────────────────────────
console.log(`\n💵  Monto quincenal de la constancia de trabajo`);
console.log(`   ${pass} OK · ${fail} fallo(s)`);
if (fail) {
  console.log(`\n${failures.join('\n')}\n`);
  process.exit(1);
}
console.log('   ✅ Todo en verde\n');
