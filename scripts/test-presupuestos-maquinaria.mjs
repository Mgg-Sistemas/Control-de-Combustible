/*
 * Test de PRESUPUESTOS Y COTIZACIONES DE MAQUINARIA (`src/lib/presupuestoDocumento.ts`) — 22-oct-2026.
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

const cache = new Map();
const loadTs = (srcPath) => {
  if (cache.has(srcPath)) return cache.get(srcPath);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  cache.set(srcPath, m.exports);
  const origRequire = m.require.bind(m);
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(srcPath), `${id}.ts`)) : origRequire(id));
  m._compile(out, m.filename);
  cache.set(srcPath, m.exports);
  return m.exports;
};

const DOC = loadTs(path.join(ROOT, 'src/lib/presupuestoDocumento.ts'));
const TYPES = loadTs(path.join(ROOT, 'src/types/presupuesto.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); }
};

// ── 1) Tipos y unidades de alquiler ─────────────────────────────────────────
ok('existen unidades de alquiler clave: hora, día, mes, flete, standby',
  TYPES.UNIDADES_ALQUILER.some((u) => u.key === 'hora') &&
  TYPES.UNIDADES_ALQUILER.some((u) => u.key === 'dia') &&
  TYPES.UNIDADES_ALQUILER.some((u) => u.key === 'mes') &&
  TYPES.UNIDADES_ALQUILER.some((u) => u.key === 'flete') &&
  TYPES.UNIDADES_ALQUILER.some((u) => u.key === 'standby') &&
  TYPES.UNIDADES_ALQUILER.some((u) => u.key === 'personalizado'));

// ── 2) Generación de documento PDF ──────────────────────────────────────────
const PRES_TEST = {
  id: 'pres_123',
  code: 'PRES-0001',
  company_id: 'comp_1',
  company_name: 'GOLDEN TOUCH 1127 C.A.',
  company_rif: 'J-12345678-9',
  client_name: 'CONSORCIO VIAL MINERO',
  client_doc: 'J-98765432-1',
  client_contact_person: 'Ing. Carlos Mendoza',
  project_name: 'Movimiento de Tierra Sector Mina Sur',
  date: '2026-10-22',
  valid_until: '2026-10-29',
  items: [
    {
      id: 'it_1',
      machine_code: 'EXC-01',
      description: 'Excavadora sobre orugas CAT 320D',
      unit: 'hora',
      qty: 150,
      unit_price: 85,
      subtotal: 12750,
    },
    {
      id: 'it_2',
      machine_code: 'FLETE-01',
      description: 'Traslado Lowboy ida y vuelta a mina',
      unit: 'flete',
      qty: 1,
      unit_price: 1200,
      subtotal: 1200,
    },
  ],
  subtotal: 13950,
  con_iva: true,
  iva_pct: 16,
  iva_monto: 2232,
  total: 16182,
  rate_bs: 45.5,
  total_bs: 736281,
  conditions: {
    incluye_operador: true,
    detalle_operador: 'Operador calificado incluido en la tarifa diaria',
    incluye_combustible: false,
    detalle_combustible: 'Combustible suministrado por el cliente en sitio',
    horas_minimas_dia: 8,
    flete_incluido: false,
    mantenimiento: 'Mantenimiento preventivo rutinario a cargo de la arrendadora',
    forma_pago: '50% anticipo al confirmar y 50% al finalizar',
    vigencia_dias: 7,
  },
  status: 'emitido',
  created_at: '2026-10-22T10:00:00Z',
};

const HTML = DOC.presupuestoDocumentoHtml(PRES_TEST);

ok('el documento contiene el nombre de la empresa y su RIF',
  HTML.includes('GOLDEN TOUCH 1127 C.A.') && HTML.includes('J-12345678-9'));
ok('el documento contiene el código y estado',
  HTML.includes('PRES-0001') && HTML.includes('EMITIDO'));
ok('el documento contiene los datos del cliente y proyecto',
  HTML.includes('CONSORCIO VIAL MINERO') && HTML.includes('Ing. Carlos Mendoza') && HTML.includes('Sector Mina Sur'));
ok('los ítems cotizados salen con su descripción y tarifa',
  HTML.includes('Excavadora sobre orugas CAT 320D') && HTML.includes('EXC-01') && HTML.includes('Lowboy'));
ok('los totales en $ y Bs se muestran con IVA',
  HTML.includes('16.182,00') && HTML.includes('736.281,00') && HTML.includes('IVA (16%)'));
ok('las condiciones comerciales del alquiler se detallan',
  HTML.includes('Operador calificado incluido') && HTML.includes('Combustible suministrado por el cliente') && HTML.includes('Mínimo de 8 horas'));
ok('incluye los bloques de firmas de arrendadora y cliente',
  HTML.includes('Por GOLDEN TOUCH 1127 C.A.') && HTML.includes('Aceptación Conforme del Cliente'));

// ── 3) Integración en VentasScreen ──────────────────────────────────────────
const scr = fs.readFileSync(path.join(ROOT, 'src/screens/VentasScreen.tsx'), 'utf8');
ok('VentasScreen tiene la pestaña Presupuestos de maquinaria',
  scr.includes("label: 'Presupuestos de maquinaria'") && scr.includes("key: 'presupuestos'"));
ok('VentasScreen renderiza PresupuestosTab',
  scr.includes('<PresupuestosTab canWrite={canWrite} />'));
ok('VentasScreen conserva intacta la pestaña Ventas de servicio',
  scr.includes('<VentaServiciosTab canWrite={canWrite} />'));

console.log('\nPRESUPUESTOS Y COTIZACIONES DE MAQUINARIA\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-presupuestos-maquinaria · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
