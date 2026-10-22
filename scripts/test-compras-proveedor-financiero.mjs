/*
 * Test de Módulo de Compras:
 * 1) Datos Financieros de Proveedores (Cuenta bancaria, Pago Móvil, Binance).
 * 2) Ciclo de Retroalimentación Técnica (Bucle de Cotización: status aclaratoria_solicitada y bloqueo de aprobación).
 * 3) Asignación de Empresa Pagadora y Umbral > $1,000 USD.
 *
 * Ejecutar con:
 *   node scripts/test-compras-proveedor-financiero.mjs
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

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const cache = new Map();
const compilar = (p) => {
  if (cache.has(p)) return cache.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cache.set(p, m.exports);
  m._compile(js, m.filename);
  cache.set(p, m.exports);
  return m.exports;
};
const realLoad = Module._load;
Module._load = function (req, parent) {
  if (req === 'react-native') {
    return { Platform: { OS: 'web' } };
  }
  if (req === './pdf' || req.endsWith('/pdf') || req.startsWith('expo-')) {
    return {
      pdfDocument: ({ body }) => `<html><body>${body}</body></html>`,
      exportPdf: () => {},
      urlToDataUri: async () => null,
    };
  }
  if (req.startsWith('.') && parent && String(parent.filename || '').endsWith('.ts')) {
    const cand = path.resolve(path.dirname(parent.filename), req);
    for (const p of [cand, cand + '.ts', path.join(cand, 'index.ts')]) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return compilar(p);
    }
  }
  return realLoad.apply(this, arguments);
};

const cargar = (rel) => compilar(path.join(ROOT, rel));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── 1) VERIFICAR TIPOS Y CAMPOS FINANCIEROS Y DE ACLARATORIA ────────────────
const dbTypes = leer('src/types/database.ts');
ok('database.ts contiene bank_name en Supplier', dbTypes.includes('bank_name?: string | null;'));
ok('database.ts contiene account_number en Supplier', dbTypes.includes('account_number?: string | null;'));
ok('database.ts contiene pago_movil_phone en Supplier', dbTypes.includes('pago_movil_phone?: string | null;'));
ok('database.ts contiene binance_id en Supplier', dbTypes.includes('binance_id?: string | null;'));
ok('database.ts contiene aclaratoria_solicitada en RequirementStatus', dbTypes.includes("'aclaratoria_solicitada'"));
ok('database.ts contiene aclaratoria_motivo en InventoryRequirement', dbTypes.includes('aclaratoria_motivo?: string | null;'));
ok('database.ts contiene aclaratoria_respuesta en InventoryRequirement', dbTypes.includes('aclaratoria_respuesta?: string | null;'));
ok('database.ts contiene empresa_pagadora_id en InventoryRequirement', dbTypes.includes('empresa_pagadora_id?: string | null;'));
ok('database.ts contiene empresa_pagadora_nombre en InventoryRequirement', dbTypes.includes('empresa_pagadora_nombre?: string | null;'));

// ── 3) VERIFICAR REQ_STATUS EN REQUERIMIENTOTAB ──────────────────────────────
const reqTab = leer('src/screens/RequerimientoTab.tsx');
ok('RequerimientoTab tiene estado aclaratoria_solicitada', reqTab.includes("aclaratoria_solicitada: { label: '⚠️ Aclaratoria Técnica Solicitada'"));
ok('RequerimientoTab bloquea aprobación si está en aclaratoria', reqTab.includes("r.status === 'aclaratoria_solicitada' && status === 'aprobado'"));
ok('RequerimientoTab incluye selector de empresa pagadora', reqTab.includes('empresaPagadoraId'));
ok('RequerimientoTab detecta umbral > $1,000 USD', reqTab.includes('tUsd >= 1000'));
ok('RequerimientoTab tiene modal para solicitar aclaratoria', reqTab.includes('aclaratoriaOpen'));
ok('RequerimientoTab tiene modal para responder aclaratoria', reqTab.includes('respuestaOpen'));
ok('RequerimientoTab tiene modal para datos de pago del proveedor', reqTab.includes('modalPagoProvOpen'));

// ── 4) VERIFICAR PROVEEDORESTAB EN COMPRASSCREEN ─────────────────────────────
const comprasScr = leer('src/screens/ComprasScreen.tsx');
ok('ComprasScreen maneja bank_name', comprasScr.includes('bank_name: bankName.trim()'));
ok('ComprasScreen maneja pago_movil_phone', comprasScr.includes('pago_movil_phone: pagoMovilPhone.trim()'));
ok('ComprasScreen maneja binance_id', comprasScr.includes('binance_id: binanceId.trim()'));

// ── 5) VERIFICAR LIB REQUERIMIENTO HTML (PDF) ────────────────────────────────
const R = cargar('src/lib/requerimiento.ts');
const htmlSalida = R.requerimientoHtml({
  code: 'REQ-0100',
  fecha: '22/10/2026',
  title: 'REPUESTOS CRÍTICOS',
  company: 'EMPRESA OPERACIONES',
  empresaPagadora: 'Construcciones Liscioni, C.A.',
  proveedor: 'INVERSIONES REPUESTOS C.A.',
  proveedorDatosPago: {
    banco: 'Banesco',
    cuenta: '01340000000000001234',
    titular: 'INVERSIONES REPUESTOS C.A.',
    cedulaRif: 'J-12345678-9',
    pagoMovil: 'Banesco - 04141234567 (J-12345678-9)',
    binance: 'binance@repuestos.com',
  },
  aclaratoria: {
    motivo: 'Faltan tolerancias y diámetro interior del rodamiento.',
    solicitadaPor: 'Analista de Compras',
    fechaSolicitud: '22/10/2026',
    respuesta: 'Diámetro interior de 45mm, tolerancia ISO h6.',
    fechaRespuesta: '22/10/2026',
  },
  statusLabel: 'En Aclaratoria',
  rate: 45.5,
  items: [
    { name: 'RODAMIENTO 6205', unit: 'UND', qty: 2, est_price: 550, currency: 'USD' }
  ],
});

ok('PDF incluye Empresa Pagadora', htmlSalida.includes('Construcciones Liscioni, C.A.'));
ok('PDF incluye Coordenadas de Pago', htmlSalida.includes('Coordenadas de Pago'));
ok('PDF incluye Banesco y número de cuenta', htmlSalida.includes('01340000000000001234'));
ok('PDF incluye Pago Móvil', htmlSalida.includes('04141234567'));
ok('PDF incluye Binance', htmlSalida.includes('binance@repuestos.com'));
ok('PDF incluye Retroalimentación Técnica', htmlSalida.includes('Ciclo de Retroalimentación Técnica'));
ok('PDF incluye motivo de aclaratoria', htmlSalida.includes('Faltan tolerancias'));
ok('PDF incluye respuesta técnica', htmlSalida.includes('Diámetro interior de 45mm'));

// ── RESULTADOS ───────────────────────────────────────────────────────────────
console.log(`\nPruebas módulo de compras (datos financieros, bucle de aclaratoria, empresa pagadora): ${pass} pasaron, ${fail} fallaron.\n`);
if (failures.length) {
  failures.forEach((f) => console.error(f));
  process.exit(1);
} else {
  console.log('✓ Todas las pruebas pasaron satisfactoriamente.');
}
