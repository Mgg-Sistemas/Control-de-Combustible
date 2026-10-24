import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();

function cargarTs(relPath) {
  const fullPath = path.resolve(ROOT, relPath);
  const tsCode = fs.readFileSync(fullPath, 'utf8');
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', jsCode);
  fn((dep) => {
    if (dep === './notaEntrega') {
      return {};
    }
    if (dep.startsWith('./logo')) {
      return {
        LOGO_DATA_URI: 'data:image/png;base64,SOS',
        GOLDEN_TOUCH_LOGO_DATA_URI: 'data:image/png;base64,GOLDEN',
        RENACE_LOGO_DATA_URI: 'data:image/png;base64,RENACE',
        JHENZAEN_LOGO_DATA_URI: 'data:image/png;base64,JHEN',
        BCV_LOGO_DATA_URI: 'data:image/png;base64,BCV',
      };
    }
    return {};
  }, mod, mod.exports);
  return mod.exports;
}

test('autorizacionTrasladoHtml genera documento idéntico al PDF con todos los campos', () => {
  const { autorizacionTrasladoHtml } = cargarTs('src/lib/autorizacionTraslado.ts');

  const html = autorizacionTrasladoHtml({
    numeroControl: 'AT-2026-17092026',
    fecha: '17 / 9 / 2026',
    empresaEmisora: {
      nombre: 'CONSTRUCCIONES LICCIONE, C.A.',
      rif: 'J405036419',
    },
    logos: {}, // sin logo seleccionado
    maquinaria: {
      codigo: 'MIN-01',
      tipo: 'Minishover',
      marca: 'Lovol',
      modelo: 'FSL75',
      anio: '2025',
      color: 'Amarillo / Negro',
      serial: 'CLW09L58VSH000104',
      placa: 'A97BE9P',
      pesoOperativo: '3.500 kg',
      potenciaMotor: '55KW',
    },
    origen: 'Camuri Chico / La Guaira',
    destino: 'Puerto Ordaz / Estado Bolivar',
    transporte: {
      conductorNombre: 'Jose Gregorio Gomez',
      conductorCedula: 'V-11.683.953',
      vehiculoChuto: 'Chuto',
      placaChuto: 'A22CY0J',
      vehiculoLowboy: 'Lowboy',
      placaLowboy: 'A97BE9P',
      telefonoContacto: '04264902690',
      vigenciaTraslado: 'Del 17/9 al 23/9',
    },
    estado: {
      operativo: true,
      inoperativo: false,
      combustiblePct: 80,
      limpiezaAceptable: true,
      observacionesDanios: 'Sin daños visibles al momento de entrega.',
    },
    firmas: {
      autorizadoPorEmpresa: 'CONSTRUCCIONES LICCIONE, C.A.',
      transportistaNombre: 'Jose Gregorio Gomez',
    },
  });

  // Verificaciones de contenido
  assert.match(html, /AUTORIZACIÓN DE TRASLADO/, 'Título del documento');
  assert.match(html, /AT-2026-17092026/, 'Número de control');
  assert.match(html, /17 \/ 9 \/ 2026/, 'Fecha');
  assert.match(html, /CONSTRUCCIONES LICCIONE, C\.A\./, 'Nombre de la empresa emisora');
  assert.match(html, /J405036419/, 'RIF');
  assert.match(html, /Por medio del presente documento, la empresa/, 'Párrafo legal');
  assert.match(html, /1\. IDENTIFICACIÓN DE LA MAQUINARIA/, 'Sección 1');
  assert.match(html, /Minishover/, 'Tipo');
  assert.match(html, /Lovol/, 'Marca');
  assert.match(html, /FSL75/, 'Modelo');
  assert.match(html, /A97BE9P/, 'Placa de la maquinaria');
  assert.match(html, /2\. DATOS DE ORIGEN, DESTINO/, 'Sección 2');
  assert.match(html, /Camuri Chico \/ La Guaira/, 'Origen');
  assert.match(html, /Puerto Ordaz \/ Estado Bolivar/, 'Destino');
  assert.match(html, /3\. IDENTIFICACIÓN DE LA EMPRESA DE TRANSPORTE Y CONDUCTOR/, 'Sección 3');
  assert.match(html, /Jose Gregorio Gomez/, 'Conductor');
  assert.match(html, /V-11\.683\.953/, 'Cédula');
  assert.match(html, /A22CY0J/, 'Placa Chuto');
  assert.match(html, /4\. ESTADO DEL EQUIPO AL MOMENTO DE SALIDA/, 'Sección 4');
  assert.match(html, /\[ x \](?:<\/span>\s*)?Operativo/, 'Checkbox operativo');
  assert.match(html, /80%/, 'Combustible');
  assert.match(html, /AUTORIZADO POR/, 'Firma Autorizado');
  assert.match(html, /TRANSPORTISTA \/ CONDUCTOR/, 'Firma Transportista');
  assert.match(html, /RECIBIDO EN DESTINO/, 'Firma Destino');
  assert.match(html, /Nota de Autorización Legal/, 'Nota legal para autoridades');
});

test('autorizacionTrasladoHtml sin logos no inyecta etiquetas img', () => {
  const { autorizacionTrasladoHtml } = cargarTs('src/lib/autorizacionTraslado.ts');
  const html = autorizacionTrasladoHtml({
    numeroControl: 'AT-2026-0002',
    fecha: '18 / 9 / 2026',
    empresaEmisora: { nombre: 'CONSTRUCTORA LIBRE, C.A.', rif: 'J-99999999-9' },
    logos: {}, // sin logos
    maquinaria: { tipo: 'Excavadora', marca: 'CAT', modelo: '320D', placa: 'AB123CD' },
    origen: 'Patio Central',
    destino: 'Obra Macuto',
    transporte: { conductorNombre: 'Pedro Perez' },
    estado: { operativo: false, inoperativo: true, limpiezaAceptable: false },
  });
  assert.equal(/<img/i.test(html), false, 'No debe haber imágenes de logo');
  assert.match(html, /\[ x \](?:<\/span>\s*)?Inoperativo \/ Averiado/);
});

test('autorizacionTrasladoHtml con logos renderiza imagenes', () => {
  const { autorizacionTrasladoHtml } = cargarTs('src/lib/autorizacionTraslado.ts');
  const html = autorizacionTrasladoHtml({
    numeroControl: 'AT-2026-0003',
    fecha: '19 / 9 / 2026',
    empresaEmisora: { nombre: 'GOLDEN TOUCH 1127 C.A.', rif: 'J-50129993-5' },
    logos: { golden: true, sos: true },
    maquinaria: { tipo: 'Retroexcavadora', marca: 'JCB', modelo: '3CX', placa: 'CD456EF' },
    origen: 'Caraballeda',
    destino: 'La Guaira',
    transporte: { conductorNombre: 'Carlos Gomez' },
    estado: { operativo: true, inoperativo: false, limpiezaAceptable: true },
  });
  assert.equal(/<img/i.test(html), true, 'Debe haber imágenes de logo');
});
