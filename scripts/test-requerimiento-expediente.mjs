import assert from 'assert';
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
  m.require = (id) => {
    if (id.startsWith('.')) {
      const resolved = path.resolve(path.dirname(srcPath), id);
      const candidates = [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`];
      for (const c of candidates) {
        if (fs.existsSync(c) && !fs.statSync(c).isDirectory()) {
          return loadTs(c);
        }
      }
    }
    if (id === 'expo-print' || id === 'expo-sharing') return {};
    if (id === 'react-native') {
      return { Platform: { OS: 'web' } };
    }
    return origRequire(id);
  };
  m._compile(out, srcPath);
  return m.exports;
};

const expedienteMod = loadTs(path.join(ROOT, 'src/lib/requerimientoExpediente.ts'));
const {
  extraerFactura,
  inyectarFacturaEnObservaciones,
  extraerDespacho,
  inyectarDespachoEnObservaciones,
  limpiarObservacionesUsuario,
  expedienteCompletoHtml,
} = expedienteMod;

console.log('🧪 Iniciando pruebas de Expediente de Compra, Factura de Abraham y Trazabilidad de Almacén...');

// 1. Prueba de Extracción y Serialización de Factura
console.log('Test 1: Extracción y serialización de Factura');
const facturaOriginal = {
  numero: 'FAC-998822',
  empresa: 'Golden Touch',
  fecha: '2026-10-25',
  url: 'https://storage.supabase.co/machinery/facturas/fac-1.jpg',
  tipo: 'image',
  nombre: 'factura-proveedor.jpg',
  subidaPor: 'Abraham',
  subidaAt: '2026-10-25T14:30:00Z',
};

const obsConFactura = inyectarFacturaEnObservaciones('Urgente para taller central', facturaOriginal);
assert.ok(obsConFactura.includes('[FACTURA PROVEEDOR: Nro: FAC-998822 | Empresa: Golden Touch'));

const facturaExtraida = extraerFactura({ observaciones: obsConFactura });
assert.strictEqual(facturaExtraida.numero, 'FAC-998822');
assert.strictEqual(facturaExtraida.empresa, 'Golden Touch');
assert.strictEqual(facturaExtraida.subidaPor, 'Abraham');
assert.strictEqual(facturaExtraida.tipo, 'image');

// Verificar limpieza de observaciones para el usuario
const obsLimpia = limpiarObservacionesUsuario(obsConFactura);
assert.strictEqual(obsLimpia, 'Urgente para taller central', 'Las etiquetas técnicas no deben verse en notas del usuario');
console.log('✅ Test 1 pasado: Factura serializada y extraída correctamente.');

// 2. Prueba de Factura de Inversiones Las Ilusiones
console.log('Test 2: Factura de Inversiones Las Ilusiones');
const facturaIlusiones = {
  numero: '004512',
  empresa: 'Inversiones Las Ilusiones',
  fecha: '2026-10-26',
  url: 'https://storage.supabase.co/machinery/facturas/fac-2.pdf',
  tipo: 'pdf',
  nombre: 'factura-repuestos.pdf',
  subidaPor: 'Abraham',
};
const obsIlusiones = inyectarFacturaEnObservaciones('', facturaIlusiones);
const extIlusiones = extraerFactura({ observaciones: obsIlusiones });
assert.strictEqual(extIlusiones.numero, '004512');
assert.strictEqual(extIlusiones.empresa, 'Inversiones Las Ilusiones');
assert.strictEqual(extIlusiones.tipo, 'pdf');
console.log('✅ Test 2 pasado: Factura de Las Ilusiones procesada con éxito.');

// 3. Prueba de Trazabilidad de Almacén (Disponible vs Retirado)
console.log('Test 3: Trazabilidad de Almacén');
// Por defecto: Disponible
const despachoInicial = extraerDespacho({ status: 'recibido', observaciones: '' });
assert.strictEqual(despachoInicial.estado, 'disponible');

// Despacho retirado con chofer/mecánico y maquinaria con PLACA
const despachoRetirado = {
  estado: 'retirado',
  retiradoPor: 'Carlos Mecánico',
  retiradoCedula: 'V-18456123',
  retiradoCargo: 'Mecánico Jefe',
  despachadoPor: 'José Almacén',
  fecha: '2026-10-26T16:00:00Z',
  nota: 'Entregado completo para cambio inmediato en campo',
  maquinariaCodigo: 'CAT-320D',
  maquinariaPlaca: 'AB123CD',
};

const obsConDespacho = inyectarDespachoEnObservaciones('Nota adicional de prueba', despachoRetirado);
assert.ok(obsConDespacho.includes('[DESPACHO ALMACEN: Estado: retirado | RetiradoPor: Carlos Mecánico'));

const despachoExtraido = extraerDespacho({ observaciones: obsConDespacho });
assert.strictEqual(despachoExtraido.estado, 'retirado');
assert.strictEqual(despachoExtraido.retiradoPor, 'Carlos Mecánico');
assert.strictEqual(despachoExtraido.retiradoCedula, 'V-18456123');
assert.strictEqual(despachoExtraido.maquinariaPlaca, 'AB123CD', 'Debe conservar la placa obligatoria de la máquina');
console.log('✅ Test 3 pasado: Despacho físico de almacén extraído e inyectado con placa.');

// 4. Prueba de Generación del Expediente Completo en PDF (HTML)
console.log('Test 4: Generación de Expediente Completo en PDF');
const reqDummy = {
  id: 'req-test-1',
  code: 'REQ-0550',
  title: 'Repuestos Bomba de Inyección',
  status: 'recibido',
  created_at: '2026-10-20T10:00:00Z',
  solicitante_nombre: 'Ing. Pedro Ramírez',
  area: 'Taller Mecánico Mina',
  company_id: 'golden-touch',
  supplier_id: 'sup-1',
  decided_by_name: 'Dorianne Pérez',
  decided_at: '2026-10-21T11:00:00Z',
  gerente_aprobado: true,
  gerente_aprobado_por: 'Ing. Carlos Liscioni',
  gerente_aprobado_at: '2026-10-21T12:00:00Z',
  received_at: '2026-10-25T09:00:00Z',
  responsable_nombre: 'Miguel Galpón',
  items: [
    { name: 'FILTRO DE COMBUSTIBLE', qty: 4, est_price: 25, currency: 'USD', note: 'Código 1R-0750', image_url: 'https://dummy.com/img1.jpg' },
    { name: 'INYECTOR DIÉSEL', qty: 6, est_price: 200, currency: 'USD', note: 'Original Bosch', image_url: 'https://dummy.com/img2.jpg' },
  ],
  observaciones: obsConFactura + '\n' + obsConDespacho,
};

const htmlExpediente = expedienteCompletoHtml({
  req: reqDummy,
  factura: facturaOriginal,
  despacho: despachoRetirado,
  proveedorNombre: 'Diesel Parts Venezuela C.A.',
  proveedorRif: 'J-31456789-0',
  proveedorDatosPago: 'Banesco Cta: 0134-1234-56-1234567890 (Diesel Parts J-31456789-0)',
  maquinariaLabel: 'EXCAVADORA CAT-320D · Placa AB123CD',
  pagoInfo: {
    estadoCuenta: 'pagada',
    montoTotal: 1300,
    montoPagado: 1300,
    saldoPendiente: 0,
    abonos: [
      { fecha: '2026-10-22', monto: 1300, metodo: 'Transferencia Banesco', referencia: 'TRANSF-998811' },
    ],
  },
});

// Verificaciones obligatorias del Expediente
assert.ok(htmlExpediente.includes('EXPEDIENTE EJECUTIVO UNIFICADO DE COMPRA'));
assert.ok(htmlExpediente.includes('1. DATOS DEL REQUERIMIENTO (REQ-0550)'));
assert.ok(htmlExpediente.includes('EXCAVADORA CAT-320D · Placa AB123CD'), 'Debe incluir código y placa en el expediente');
assert.ok(htmlExpediente.includes('2. LISTA DE REPUESTOS Y ESPECIFICACIONES TÉCNICAS'));
assert.ok(htmlExpediente.includes('FILTRO DE COMBUSTIBLE'));
assert.ok(htmlExpediente.includes('3. DATOS DE LA COTIZACIÓN Y PROVEEDOR SELECCIONADO'));
assert.ok(htmlExpediente.includes('Diesel Parts Venezuela C.A.'));
assert.ok(htmlExpediente.includes('4. TRAZABILIDAD DE APROBACIÓN Y PAGOS'));
assert.ok(htmlExpediente.includes('Dorianne Pérez'));
assert.ok(htmlExpediente.includes('TRANSF-998811'));
assert.ok(htmlExpediente.includes('5. FACTURA FISCAL / COMERCIAL DEL PROVEEDOR'));
assert.ok(htmlExpediente.includes('FAC-998822'));
assert.ok(htmlExpediente.includes('Golden Touch'));
assert.ok(htmlExpediente.includes('6. CONTROL FÍSICO EN ALMACÉN Y TRAZABILIDAD DE RETIRO'));
assert.ok(htmlExpediente.includes('Carlos Mecánico'));

console.log('✅ Test 4 pasado: Expediente Completo PDF generado con las 6 secciones integradas.');
console.log('🎉 TODOS LOS TESTS DE EXPEDIENTE, FACTURA Y ALMACÉN PASARON AL 100%.');
