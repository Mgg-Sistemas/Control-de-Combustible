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

const fmtMod = loadTsModule('src/lib/formatosAdjuntos.ts');

console.log('1) Probando resolverFotoReferenciaItem (foto propia del ítem y respaldo de 1 renglón)...');
{
  const urlItem = 'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/requerimientos/1794344061547_0.jpg';
  const reqMulti = {
    code: 'REQ-0277',
    items: [
      { name: 'EJE DE ACERO 1045', qty: 1, image_url: urlItem },
      { name: 'ELECTRODO 7018', qty: 5, image_url: null },
    ],
    attachment_url: urlItem,
    attachment_type: 'image',
  };

  assert.equal(
    fmtMod.resolverFotoReferenciaItem(reqMulti.items[0], reqMulti),
    urlItem,
    'Debe devolver image_url del propio ítem cuando existe'
  );
  assert.equal(
    fmtMod.resolverFotoReferenciaItem(reqMulti.items[1], reqMulti),
    null,
    'En requerimientos de varios ítems, no debe copiar attachment_url a un ítem sin foto'
  );

  // Caso real REQ-0279 / REQ-0276 / REQ-0243: 1 solo ítem donde la foto quedó en attachment_url e it.image_url es null
  const urlAdj = 'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/requerimientos_temp/1794406224163_0.jpeg';
  const reqUnItem = {
    code: 'REQ-0279',
    items: [{ name: 'RODAMIENTO 6205', qty: 2, image_url: null }],
    attachment_url: urlAdj,
    attachment_type: 'image',
    observaciones: 'Solicitud creada desde taller',
  };
  assert.equal(
    fmtMod.resolverFotoReferenciaItem(reqUnItem.items[0], reqUnItem),
    urlAdj,
    'En requerimiento de 1 ítem con foto de muestra en attachment_url, debe resolver esa foto para el ítem'
  );

  // Si attachment_url es un PDF o una factura fiscal, NO debe tomarse como foto del producto
  const reqPdf = {
    code: 'REQ-0280',
    items: [{ name: 'VALVULA', qty: 1, image_url: null }],
    attachment_url: 'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/cotizacion.pdf',
    attachment_type: 'pdf',
  };
  assert.equal(fmtMod.resolverFotoReferenciaItem(reqPdf.items[0], reqPdf), null);

  const urlFac = 'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/facturas/fac1.jpeg';
  const reqFactura = {
    code: 'REQ-0192',
    items: [{ name: 'TELA POLI SOMBRA', qty: 90, image_url: null }],
    attachment_url: urlFac,
    attachment_type: 'image',
    observaciones: `[FACTURA PROVEEDOR: N°: 001 | Empresa: EPA | Fecha: 2026-11-04 | Archivo: ${urlFac}]`,
  };
  assert.equal(
    fmtMod.resolverFotoReferenciaItem(reqFactura.items[0], reqFactura),
    null,
    'No debe usar la foto de la factura fiscal como foto de referencia del producto'
  );
}

console.log('2) Probando construirNombreDescargaFoto y construirUrlDescargaDirecta...');
{
  const url = 'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/requerimientos/1794344061547_0.jpeg?token=abc';
  const nombre = fmtMod.construirNombreDescargaFoto('📷 EJE DE ACERO 1045 (2")', url, 'REQ-0277');
  assert.equal(nombre, 'REQ-0277_EJE_DE_ACERO_1045_2.jpeg');

  const directUrl = fmtMod.construirUrlDescargaDirecta(url, nombre);
  assert.ok(
    directUrl.includes('&download=REQ-0277_EJE_DE_ACERO_1045_2.jpeg'),
    'Debe agregar el parámetro download= a las URLs públicas de Supabase Storage'
  );
}

console.log('3) Verificando botones de visor y descarga en RequerimientoTab.tsx y SolicitudesCompraTab.tsx...');
{
  const reqTabSrc = fs.readFileSync(path.join(root, 'src/screens/RequerimientoTab.tsx'), 'utf8');
  const solTabSrc = fs.readFileSync(path.join(root, 'src/screens/SolicitudesCompraTab.tsx'), 'utf8');

  assert.ok(
    reqTabSrc.includes('🔍 Ver foto'),
    'RequerimientoTab debe mostrar el botón/etiqueta 🔍 Ver foto en la miniatura de cada ítem'
  );
  assert.ok(
    reqTabSrc.includes('👁️ Ver / Descargar'),
    'RequerimientoTab debe mostrar el botón 👁️ Ver / Descargar junto a 🖼️ Cambiar imagen en Editar requerimiento'
  );
  assert.ok(
    reqTabSrc.includes('⬇️ Descargar') && reqTabSrc.includes('↗️ Abrir original'),
    'El visor modal en RequerimientoTab debe ofrecer ⬇️ Descargar y ↗️ Abrir original'
  );
  assert.ok(
    solTabSrc.includes('⬇️ Descargar') && solTabSrc.includes('↗️ Abrir original'),
    'El visor modal en SolicitudesCompraTab debe ofrecer ⬇️ Descargar y ↗️ Abrir original'
  );
}

console.log('✅ Todos los tests de visor y descarga de foto de referencia en Requerimientos y Solicitudes pasaron correctamente.');

