// Pruebas automatizadas para:
// 1. Condiciones de pago y Notas visibles en Por Pagar, Requerimientos, Servicios y Compras Directas
// 2. Control riguroso de las 37 unidades de Aires Acondicionados (AA-01 a AA-37) y su Semáforo

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function loadTs(relPath, mocks = {}) {
  const full = path.resolve(process.cwd(), relPath);
  const src = fs.readFileSync(full, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const mod = { exports: {} };
  const ctx = vm.createContext({
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (id in mocks) return mocks[id];
      if (id.startsWith('.')) {
        const resolved = path.resolve(path.dirname(full), id + (id.endsWith('.ts') ? '' : '.ts'));
        if (fs.existsSync(resolved)) {
          return loadTs(path.relative(process.cwd(), resolved), mocks);
        }
      }
      return {};
    },
    console,
    Date,
    Math,
    RegExp,
    String,
    Number,
    Array,
    Map,
    Set,
    Object,
  });
  vm.runInContext(out, ctx);
  return mod.exports;
}

const cuentasPago = loadTs('src/lib/cuentasPago.ts');
const airesLib = loadTs('src/lib/airesAcondicionados.ts', {
  './pdf': {
    pdfDocument: ({ title, subtitle, body }) => `<html><h1>${title}</h1><h2>${subtitle}</h2>${body}</html>`,
  },
});

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('\n🧪 Ejecutando pruebas de Condiciones de Pago y Control de 37 Aires Acondicionados...\n');

test('1. CONDICIONES_PAGO_CHIPS contiene las opciones rápidas comerciales', () => {
  assert.ok(cuentasPago.CONDICIONES_PAGO_CHIPS.includes('CONTADO'));
  assert.ok(cuentasPago.CONDICIONES_PAGO_CHIPS.includes('50% ADELANTO / 50% ENTREGA'));
  assert.ok(cuentasPago.CONDICIONES_PAGO_CHIPS.includes('CRÉDITO 15 DÍAS'));
});

test('2. toggleChipCondicionPago combina plazo + método y reemplaza plazos mutuamente excluyentes', () => {
  let c = cuentasPago.toggleChipCondicionPago('', 'CONTADO');
  assert.equal(c, 'CONTADO');
  c = cuentasPago.toggleChipCondicionPago(c, 'ZELLE / DIVISAS');
  assert.equal(c, 'CONTADO · ZELLE / DIVISAS');
  // Cambiar de CONTADO a CRÉDITO 15 DÍAS conserva el método ZELLE / DIVISAS
  c = cuentasPago.toggleChipCondicionPago(c, 'CRÉDITO 15 DÍAS');
  assert.equal(c, 'CRÉDITO 15 DÍAS · ZELLE / DIVISAS');
  // Tocar el mismo chip lo desmarca
  c = cuentasPago.toggleChipCondicionPago(c, 'ZELLE / DIVISAS');
  assert.equal(c, 'CRÉDITO 15 DÍAS');
});

test('3. detectarDiasCreditoChip devuelve los días exactos para ajustar vencimiento', () => {
  assert.equal(cuentasPago.detectarDiasCreditoChip('CONTADO'), 0);
  assert.equal(cuentasPago.detectarDiasCreditoChip('CRÉDITO 7 DÍAS'), 7);
  assert.equal(cuentasPago.detectarDiasCreditoChip('CRÉDITO 15 DÍAS'), 15);
  assert.equal(cuentasPago.detectarDiasCreditoChip('CRÉDITO 30 DÍAS'), 30);
  assert.equal(cuentasPago.detectarDiasCreditoChip('50% ADELANTO / 50% ENTREGA'), null);
});

test('4. inyectarCondicionesPagoEnNota, extraerCondicionesPago y limpiarNotaCuentasVisual', () => {
  const notaBase = 'PAGAR A CUENTA MERCANTIL [EMPRESA:123:GOLDEN TOUCH]';
  const conCond = cuentasPago.inyectarCondicionesPagoEnNota(
    notaBase,
    '50% ADELANTO PARA INICIAR Y 50% AL ENTREGAR FACTURA',
  );
  assert.equal(
    cuentasPago.extraerCondicionesPago(conCond),
    '50% ADELANTO PARA INICIAR Y 50% AL ENTREGAR FACTURA',
  );
  // La nota visual queda limpia sin tags técnicos
  assert.equal(cuentasPago.limpiarNotaCuentasVisual(conCond), 'PAGAR A CUENTA MERCANTIL');
});

test('5. resolverCondicionesYNotaCuenta preserva notas cargadas hoy y resuelve condiciones desde Requerimiento', () => {
  // Caso A: Cuenta cargada hoy en Por Pagar con nota libre escrita por la usuaria
  const ctaDirecta = {
    id: 'c1',
    concepto: 'REPARACIÓN ELÉCTRICA CARPA NUEVA',
    nota: 'ESTE TRABAJO YA INICIÓ, 50% HOY Y 50% CON FACTURA [EMPRESA:e1:GOLDEN TOUCH]',
  };
  const resA = cuentasPago.resolverCondicionesYNotaCuenta(ctaDirecta, { requirements: [] });
  assert.equal(resA.notaLimpia, 'ESTE TRABAJO YA INICIÓ, 50% HOY Y 50% CON FACTURA');

  // Caso B: Cuenta generada desde un Requerimiento que tiene Condiciones de Pago y Observaciones
  const reqs = [
    {
      id: 'req-99',
      code: 'REQ-0170',
      observaciones: 'ENTREGAR EN TALLER\n[CONDICIONES_PAGO: CRÉDITO 15 DÍAS · TRANSFERENCIA BS (BCV)]',
    },
  ];
  const ctaDesdeReq = {
    id: 'c2',
    inventory_requirement_id: 'req-99',
    documento: 'REQ-0170',
    concepto: 'Requerimiento REQ-0170 · Repuestos',
    nota: 'Generada automáticamente desde Requerimiento REQ-0170. El monto se sincroniza con los ítems aprobados.',
  };
  const resB = cuentasPago.resolverCondicionesYNotaCuenta(ctaDesdeReq, { requirements: reqs });
  assert.equal(resB.condicionesPago, 'CRÉDITO 15 DÍAS · TRANSFERENCIA BS (BCV)');
  assert.equal(resB.notaLimpia, 'ENTREGAR EN TALLER');
});

test('6. generar37UnidadesBase crea siempre las 37 unidades AA-01 a AA-37 y preserva ediciones', () => {
  const personalizadas = [
    {
      id: 'AA-05',
      code: 'AA-05',
      name: 'CONSOLA CARPA NUEVA',
      area: 'CARPA NUEVA',
      tipo_equipo: 'SPLIT',
      btu: '24.000 BTU',
      marca: 'LG',
      serial: 'SN123',
      company_id: 'comp-1',
      freq_days: 15,
      estado_operativo: 'operativo',
      last_maint_manual: null,
      notes: 'USA PROTECTOR 220V',
      active: true,
    },
  ];
  const todas = airesLib.generar37UnidadesBase(personalizadas);
  assert.equal(todas.length, 37);
  assert.equal(todas[0].code, 'AA-01');
  assert.equal(todas[36].code, 'AA-37');
  const aa05 = todas.find((u) => u.code === 'AA-05');
  assert.equal(aa05.area, 'CARPA NUEVA');
  assert.equal(aa05.btu, '24.000 BTU');
  assert.equal(aa05.freq_days, 15);
});

test('7. calcularSemaforoAires clasifica correctamente Al día, Próximo, Vencido y Sin registro', () => {
  const base = airesLib.generar37UnidadesBase([]);
  const servicios = [
    {
      id: 's1',
      code: 'SRV-0100',
      company_id: 'c1',
      supplier_id: 'sup1',
      service_date: '2026-10-25', // Hace 4 días respecto a 2026-10-29 -> Al día (faltan 26d de 30d)
      total: 50,
      note: 'LIMPIEZA [CONDICIONES_PAGO: CONTADO]',
      items: [
        {
          categoria: 'MANTENIMIENTO DE AIRE ACONDICIONADO',
          tipo: 'MANTENIMIENTO PREVENTIVO RIGUROSO',
          machine_label: '❄️ AA-01 · OFICINA',
          qty: 1,
          price: 50,
          usa_inventario: false,
          ac_unit_code: 'AA-01',
        },
      ],
    },
    {
      id: 's2',
      code: 'SRV-0101',
      company_id: 'c1',
      supplier_id: 'sup1',
      service_date: '2026-10-02', // Hace 27 días respecto a 2026-10-29 -> Próximo (faltan 3d de 30d)
      total: 40,
      note: null,
      items: [
        {
          categoria: 'MANTENIMIENTO DE AIRE ACONDICIONADO',
          tipo: 'LIMPIEZA',
          machine_label: '❄️ AA-02 · COMEDOR',
          qty: 1,
          price: 40,
          usa_inventario: false,
          ac_unit_code: 'AA-02',
        },
      ],
    },
    {
      id: 's3',
      code: 'SRV-0102',
      company_id: 'c1',
      supplier_id: 'sup1',
      service_date: '2026-09-10', // Hace 49 días respecto a 2026-10-29 -> Vencido (hace 19d)
      total: 60,
      note: null,
      items: [
        {
          categoria: 'MANTENIMIENTO DE AIRE ACONDICIONADO',
          tipo: 'RECARGA DE GAS',
          machine_label: '❄️ AA-03 · TALLER',
          qty: 1,
          price: 60,
          usa_inventario: false,
          ac_unit_code: 'AA-03',
        },
      ],
    },
  ];

  const calc = airesLib.calcularSemaforoAires(base, servicios, '2026-10-29');
  const u1 = calc.find((x) => x.code === 'AA-01');
  const u2 = calc.find((x) => x.code === 'AA-02');
  const u3 = calc.find((x) => x.code === 'AA-03');
  const u4 = calc.find((x) => x.code === 'AA-04');

  assert.equal(u1.semaforo, 'al_dia');
  assert.equal(u1.historial[0].condicionesPago, 'CONTADO');
  assert.equal(u2.semaforo, 'proximo');
  assert.equal(u3.semaforo, 'vencido');
  assert.equal(u4.semaforo, 'sin_registro');
});

test('8. reporteAiresHtml genera el documento HTML con las 37 unidades y KPIs', () => {
  const base = airesLib.generar37UnidadesBase([]);
  const calc = airesLib.calcularSemaforoAires(base, [], '2026-10-29');
  const html = airesLib.reporteAiresHtml({
    unidades: calc,
    hoyISO: '2026-10-29',
    supplierNameOf: () => 'PROV',
    companyNameOf: () => 'EMP',
  });
  assert.ok(html.includes('CONTROL RIGUROSO DE MANTENIMIENTO DE AIRES ACONDICIONADOS'));
  assert.ok(html.includes('AA-01'));
  assert.ok(html.includes('AA-37'));
});

console.log(`\n✅ Todas las pruebas pasaron: ${passed} OK · 0 FALLOS\n`);

