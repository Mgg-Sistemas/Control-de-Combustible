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
  fn(() => ({}), mod, mod.exports);
  return mod.exports;
}

test('actaRecepcionHtml genera el acta completa idéntica a la muestra con fotos', () => {
  const { actaRecepcionHtml } = cargarTs('src/lib/actaRecepcionEquipo.ts');

  const html = actaRecepcionHtml({
    codigo: 'AR-EQ-2026-089',
    fecha: '23 de Octubre, 2026',
    hora: '21:44 hrs',
    departamento: 'DEPARTAMENTO DE MAQUINARIA Y EQUIPO PESADO',
    equipoModeloHeader: 'CASE CX330',
    pinSerialHeader: 'DAC331342',
    placaHeader: 'A97BE9P',
    horometroHeader: '8,317.4 hrs',
    datosGenerales: {
      equipo: 'Excavadora de Cadenas',
      fabricante: 'CNH America LLC (Made in Japan)',
      marca: 'CASE',
      modelo: 'CX330',
      serialPin: 'DAC331342',
      placa: 'A97BE9P',
      horometro: '8317.4 Horas',
      ubicacionRecepcion: 'Patio Central / Zona de Descarga',
      modoTransporte: 'Lowboy / Batea de Transporte',
      entregadoPor: 'José Gómez (Transportista)',
      recibidoPor: 'Ing. Carlos Mendoza (Inspector)',
    },
    visibilidad: {
      mostrarChofer: true,
      mostrarInspector: true,
      mostrarFabricante: true,
      mostrarHorometro: true,
      mostrarTransporte: true,
    },
    checklist: [
      { item: 'Placa de Identificación / Serial (PIN)', estado: 'CONFORME', observaciones: 'Legible, fija en chasis' },
      { item: 'Estructura Principal y Pluma (Boom)', estado: 'OPERATIVO', observaciones: 'Estructura íntegra' },
      { item: 'Tren de Rodaje / Orugas y Cadenas', estado: 'OPERATIVO', observaciones: 'Zapatas y tejas alineadas' },
      { item: 'Sistema Hidráulico y Cilindros', estado: 'OPERATIVO', observaciones: 'Sin fugas visibles' },
      { item: 'Cabina del Operador y Panel de Control', estado: 'CONFORME', observaciones: 'Cristal intacto' },
      { item: 'Aseguramiento de Carga en Lowboy', estado: 'CONFORME', observaciones: 'Amarrado con cadenas y tensores' },
    ],
    observacionesGenerales: 'El equipo ingresa transportado en lowboy en horario nocturno.',
    firmas: {
      entregadoPorNombre: 'Transporte / Proveedor',
      recibidoPorNombre: 'Inspector / Recepción',
    },
    fotos: [
      { uri: 'data:image/png;base64,123', titulo: 'Placa de Identificación del Fabricante (PIN: DAC331342)' },
      { uri: 'data:image/png;base64,456', titulo: 'Lectura Digital de Horómetro (8,317.4 Horas)' },
    ],
  });

  assert.match(html, /ACTA DE RECEPCCIÓN DE EQUIPO/);
  assert.match(html, /AR-EQ-2026-089/);
  assert.match(html, /CASE CX330/);
  assert.match(html, /DAC331342/);
  assert.match(html, /A97BE9P/); // Placa obligatoria
  assert.match(html, /8,317\.4 hrs/);
  assert.match(html, /1\. DATOS GENERALES DEL EQUIPO Y TRASLADO/);
  assert.match(html, /CNH America LLC/);
  assert.match(html, /Lowboy \/ Batea de Transporte/);
  assert.match(html, /2\. LISTA DE VERIFICACIÓN DE RECEPCIÓN/);
  assert.match(html, /Placa de Identificación \/ Serial/);
  assert.match(html, /CONFORME/);
  assert.match(html, /OPERATIVO/);
  assert.match(html, /3\. OBSERVACIONES \/ COMENTARIOS DE RECEPCIÓN/);
  assert.match(html, /ANEXO FOTOGRÁFICO DE RECEPCCIÓN/);
  assert.match(html, /4\. EVIDENCIA FOTOGRÁFICA INSPECCIONADA/);
});

test('actaRecepcionHtml sin fotos no crea página 2', () => {
  const { actaRecepcionHtml } = cargarTs('src/lib/actaRecepcionEquipo.ts');
  const html = actaRecepcionHtml({
    codigo: 'AR-EQ-2026-090',
    fecha: '24 de Octubre, 2026',
    hora: '10:00 hrs',
    datosGenerales: { equipo: 'Motoniveladora', marca: 'CAT', modelo: '140M', placa: 'AA11BB' },
    checklist: [{ item: 'Motor', estado: 'OPERATIVO' }],
    fotos: [],
  });

  assert.match(html, /ACTA DE RECEPCCIÓN DE EQUIPO/);
  assert.equal(/class="anexo-title"/i.test(html), false, 'No debe haber bloque de anexo fotográfico si fotos está vacío');
});
