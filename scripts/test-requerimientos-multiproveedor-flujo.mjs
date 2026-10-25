// Test de verificación automatizada:
// 1) Asignación individual de proveedores por renglón (compras consolidadas multi-proveedor).
// 2) Flujo dinámico de estatus (esperando proveedor, esperando cotización, esperando pago).
// 3) Filtro de seguridad por monto (> $1,000 USD) que exige aprobación del Gerente General.
// 4) Aprobación por Gerente General que desbloquea para pago.

import assert from 'assert';
import {
  calcularTotalReqUsd,
  calcularEstadoRequerimiento,
  LIMITE_MONTO_GERENTE_GENERAL_USD,
  obtenerProveedorDeLinea,
} from '../src/lib/requerimientoFlujo.ts';

console.log('🧪 Iniciando prueba automatizada del flujo de Requerimientos Multi-Proveedor y Reglas de Negocio...');

// Caso 1: Solicitud sin proveedor cargado
const reqSinProveedor = {
  id: 'req-1',
  code: 'REQ-0101',
  status: 'pendiente',
  supplier_id: null,
  items: [
    { name: 'DISCO DE CORTE', qty: 2, est_price: 10, currency: 'USD', note: '4 PULGADAS' },
    { name: 'ELECTRODOS', qty: 5, est_price: 20, currency: 'USD', note: 'E6013' },
  ],
};

const st1 = calcularEstadoRequerimiento(reqSinProveedor, 1, null);
console.log('Test 1 - Sin proveedor:', st1.codigo, '|', st1.label);
assert.strictEqual(st1.codigo, 'esperando_proveedor', 'Debe estar en esperando_proveedor');
assert.strictEqual(st1.requiereAprobacionGG, false);

// Caso 2: Solicitud con proveedor y cotización <= $1,000 USD -> esperando pago directo
const reqMenor1000 = {
  id: 'req-2',
  code: 'REQ-0102',
  status: 'pendiente',
  supplier_id: 'sup-1',
  items: [
    { name: 'DISCO DE CORTE', qty: 2, est_price: 10, currency: 'USD', note: '4 PULGADAS' },
    { name: 'TINNER', qty: 2, est_price: 15, currency: 'USD', note: 'GALON' },
  ],
};

const st2 = calcularEstadoRequerimiento(reqMenor1000, 1, { id: 'sup-1', name: 'Ferretería Central' });
console.log('Test 2 - <= $1,000 USD con proveedor:', st2.codigo, '|', st2.label, '| Total USD:', st2.totalUSD);
assert.strictEqual(st2.codigo, 'esperando_pago', 'Debe estar en esperando_pago directamente');
assert.strictEqual(st2.totalUSD, 50);
assert.strictEqual(st2.requiereAprobacionGG, false);

// Caso 3: Solicitud con proveedor pero monto > $1,000 USD (sin aprobación GG)
const reqMayor1000SinAprobacion = {
  id: 'req-3',
  code: 'REQ-0103',
  status: 'pendiente',
  supplier_id: 'sup-1',
  items: [
    { name: 'TUBO ESTRUCTURAL', qty: 100, est_price: 15, currency: 'USD', note: '3 PULGADAS POR 1 PULGADA' }, // $1,500
  ],
};

const st3 = calcularEstadoRequerimiento(reqMayor1000SinAprobacion, 1, { id: 'sup-1', name: 'Hierros del Sur' });
console.log('Test 3 - > $1,000 USD sin aprobación GG:', st3.codigo, '|', st3.label);
assert.strictEqual(st3.codigo, 'esperando_aprobacion_gg', 'Debe exigir aprobación del GG');
assert.strictEqual(st3.requiereAprobacionGG, true);
assert.strictEqual(st3.totalUSD, 1500);

// Caso 4: Solicitud > $1,000 USD con aprobación del Gerente General registrada -> pasa a esperando pago
const reqMayor1000ConAprobacion = {
  ...reqMayor1000SinAprobacion,
  gerente_aprobado: true,
  gerente_aprobado_por: 'Ing. Carlos Liscioni',
  gerente_aprobado_at: new Date().toISOString(),
};

const st4 = calcularEstadoRequerimiento(reqMayor1000ConAprobacion, 1, { id: 'sup-1', name: 'Hierros del Sur' });
console.log('Test 4 - > $1,000 USD con aprobación GG:', st4.codigo, '|', st4.label);
assert.strictEqual(st4.codigo, 'esperando_pago', 'Una vez aprobado por GG, pasa a esperando pago');
assert.strictEqual(st4.requiereAprobacionGG, false);

// Caso 5: Compra consolidada Multi-Proveedor en una misma orden
const reqMultiProveedor = {
  id: 'req-5',
  code: 'REQ-0105',
  status: 'pendiente',
  supplier_id: 'sup-1', // Proveedor general: Ferretería Central
  items: [
    { name: 'DISCO DE CORTE', qty: 2, est_price: 10, currency: 'USD', note: '4 PULGADAS', supplier_id: 'sup-1', supplier_name: 'Ferretería Central' },
    { name: 'TUBO ESTRUCTURAL', qty: 6, est_price: 40, currency: 'USD', note: '3X1 PULGADA', supplier_id: 'sup-2', supplier_name: 'Hierros del Sur' },
  ],
};

const st5 = calcularEstadoRequerimiento(reqMultiProveedor, 1, { id: 'sup-1', name: 'Ferretería Central' });
console.log('Test 5 - Multi-proveedor:', st5.codigo, '| Multi:', st5.esMultiProveedor, '| Proveedores:', st5.proveedoresNombres);
assert.strictEqual(st5.esMultiProveedor, true, 'Debe detectar compra consolidada multi-proveedor');
assert.strictEqual(st5.proveedoresNombres.length, 2, 'Debe registrar 2 proveedores distintos');
assert.strictEqual(st5.totalUSD, 260);

// Caso 6: Prueba de tasas BCV (moneda VES convertida a USD)
const reqVES = {
  id: 'req-6',
  code: 'REQ-0106',
  status: 'pendiente',
  supplier_id: 'sup-1',
  items: [
    { name: 'TINNER', qty: 2, est_price: 100, currency: 'VES' }, // a tasa 50 -> $2 c/u * 2 = $4 USD
  ],
};
const totalUsdVES = calcularTotalReqUsd(reqVES.items, 50);
console.log('Test 6 - Conversión VES a USD con tasa BCV 50:', totalUsdVES, 'USD');
assert.strictEqual(totalUsdVES, 4);

console.log('✅ TODAS LAS PRUEBAS AUTOMATIZADAS DE REQUERIMIENTOS Y FLUJO PASARON CON ÉXITO.');
