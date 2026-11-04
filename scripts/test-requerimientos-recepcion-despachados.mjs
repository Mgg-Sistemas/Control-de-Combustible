import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();

function loadTsModule(relPath, mocks = {}) {
  const fullPath = path.join(root, relPath);
  const src = fs.readFileSync(fullPath, 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const mod = { exports: {} };
  const dir = path.dirname(fullPath);
  const customRequire = (id) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('.')) {
      const resolved = path.resolve(dir, id);
      if (fs.existsSync(resolved + '.ts')) {
        return loadTsModule(path.relative(root, resolved + '.ts'), mocks);
      }
    }
    return eval('require')(id);
  };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText);
  fn(mod.exports, customRequire, mod, fullPath, dir);
  return mod.exports;
}

const mocks = {
  './pdf': { pdfDocument: () => '' },
  './logoGoldenTouchData': { GOLDEN_TOUCH_LOGO_DATA_URI: '' },
  './logoData': { LOGO_DATA_URI: '' },
  './firmaData': { FIRMA_DATA_URI: '', FIRMA2_DATA_URI: '' },
};

const expMod = loadTsModule('src/lib/requerimientoExpediente.ts', mocks);
const flujoMod = loadTsModule('src/lib/requerimientoFlujo.ts', mocks);
const fmtMod = loadTsModule('src/lib/formatosAdjuntos.ts', mocks);

console.log('1) Probando esUrlSoporteFiscalOPago (evitar foto de factura como foto de producto)...');
{
  const facturaUrl = 'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/requerimientos/requerimientos/1793799841492_0.jpeg';
  const reqConFacturaEnAdjunto = {
    code: 'REQ-0192',
    title: 'Pedido técnico: tela poli sombra para CAMIONES',
    status: 'recibido',
    attachment_url: facturaUrl,
    attachment_name: 'WhatsApp Image 2026-11-04 at 9.40.54 AM.jpeg',
    attachment_type: 'image',
    items: [{ name: 'TELA POLI SOMBRA', qty: 90, est_price: 4.5, image_url: null }],
    observaciones: expMod.inyectarFacturaEnObservaciones('', {
      numero: '00000954',
      empresa: 'FERRETERIA EPA, C.A.',
      fecha: '2026-11-04',
      url: facturaUrl,
      tipo: 'image',
      nombre: 'WhatsApp Image 2026-11-04 at 9.40.54 AM.jpeg',
      archivos: [{ url: facturaUrl, tipo: 'image', nombre: 'WhatsApp Image 2026-11-04 at 9.40.54 AM.jpeg' }],
    }),
  };

  assert.equal(
    expMod.esUrlSoporteFiscalOPago(reqConFacturaEnAdjunto, facturaUrl),
    true,
    'Debe detectar que attachment_url es la foto de la factura cargada en [FACTURA PROVEEDOR]'
  );

  // Tampoco debe aparecer como formato adjunto técnico duplicado
  const formatos = fmtMod.extraerFormatosAdjuntos(reqConFacturaEnAdjunto);
  assert.equal(
    formatos.length,
    0,
    'No debe devolver la factura de attachment_url como formato adjunto técnico'
  );

  // Pero una foto real de repuesto (que NO es factura ni recibo) sí es válida
  const fotoRepuestoUrl = 'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/repuesto-real.jpeg';
  const reqConFotoRepuesto = {
    code: 'REQ-0300',
    status: 'pendiente',
    attachment_url: fotoRepuestoUrl,
    attachment_name: 'Foto muestra repuesto.jpeg',
    attachment_type: 'image',
    items: [{ name: 'RODAMIENTO 6205', qty: 2, est_price: 15, image_url: fotoRepuestoUrl }],
    observaciones: 'Muestra del rodamiento dañado',
  };
  assert.equal(
    expMod.esUrlSoporteFiscalOPago(reqConFotoRepuesto, fotoRepuestoUrl),
    false,
    'La foto real del repuesto no debe marcarse como soporte fiscal'
  );
}

console.log('2) Probando esRequerimientoDespachado y calcularEstadoRequerimiento (categoría 📤 Despachados)...');
{
  const reqRecibidoEnAlmacen = {
    id: 'req-1',
    code: 'REQ-0210',
    status: 'recibido',
    items: [{ name: 'FILTRO', qty: 1, est_price: 20, currency: 'USD', supplier_id: 'sup-1' }],
    observaciones: '[RECEPCIÓN ALMACÉN: Factura N° 123]',
  };
  assert.equal(flujoMod.esRequerimientoDespachado(reqRecibidoEnAlmacen), false);
  const estRecibido = flujoMod.calcularEstadoRequerimiento(reqRecibidoEnAlmacen, 40);
  assert.equal(estRecibido.codigo, 'recibido');
  assert.equal(estRecibido.label, '📦 Recibido en Almacén');

  const obsDespachado = expMod.inyectarDespachoEnObservaciones(reqRecibidoEnAlmacen.observaciones, {
    estado: 'retirado',
    retiradoPor: 'OSMAR ZAMBRANO',
    retiradoCedula: '25977488',
    retiradoCargo: 'COORDINADOR DE SOPORTE Y SERVICIO',
    despachadoPor: 'abraham alonzo',
    fecha: '2026-11-04T13:44:59.841Z',
    nota: 'poli sombra para los camiones',
  });
  const reqDespachado = {
    ...reqRecibidoEnAlmacen,
    observaciones: obsDespachado,
  };
  assert.equal(flujoMod.esRequerimientoDespachado(reqDespachado), true);
  const estDespachado = flujoMod.calcularEstadoRequerimiento(reqDespachado, 40);
  assert.equal(estDespachado.codigo, 'despachado');
  assert.equal(estDespachado.label, '📤 Despachado de Almacén');
}

console.log('3) Verificando edición de nombre en recepción, no-escritura de factura en attachment_url y filtro Despachados en pantallas...');
{
  const reqTabSrc = fs.readFileSync(path.join(root, 'src/screens/RequerimientoTab.tsx'), 'utf8');
  const invSrc = fs.readFileSync(path.join(root, 'src/screens/InventarioScreen.tsx'), 'utf8');

  assert.ok(
    reqTabSrc.includes("label: '📤 Despachados'"),
    'RequerimientoTab debe incluir el filtro 📤 Despachados'
  );
  assert.ok(
    reqTabSrc.includes('Nombre / descripción real del producto (según factura)'),
    'El modal Recibir en inventario debe permitir editar el nombre real de cada producto'
  );
  assert.ok(
    !reqTabSrc.includes('reqPatch.attachment_url = recvFacturaUrl'),
    'Recibir en inventario NO debe copiar recvFacturaUrl en reqPatch.attachment_url'
  );
  assert.ok(
    !reqTabSrc.includes('patchPayload.attachment_url = dataFac.url'),
    'Guardar factura NO debe copiar dataFac.url en patchPayload.attachment_url'
  );
  assert.ok(
    invSrc.includes('esUrlSoporteFiscalOPago'),
    'InventarioScreen debe filtrar esUrlSoporteFiscalOPago al inferir fotos de requerimientos'
  );
}

console.log('✅ Todos los tests de recepción editable, separación de foto de factura y categoría Despachados pasaron correctamente.');
