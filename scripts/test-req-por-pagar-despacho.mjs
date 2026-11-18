// 🧪 Prueba de flujo: requerimiento marcado como despachado que se envía a Por Pagar
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'test-req-despacho-'));

function transpileAllLib() {
  const libDir = path.join(ROOT, 'src', 'lib');
  const destLib = path.join(TMP, 'src', 'lib');
  fs.mkdirSync(destLib, { recursive: true });
  const stubs = new Set(['pdf.ts', 'logoGoldenTouchData.ts', 'logoData.ts', 'firmaData.ts']);
  for (const file of fs.readdirSync(libDir)) {
    if (!file.endsWith('.ts')) continue;
    if (stubs.has(file)) {
      fs.writeFileSync(
        path.join(destLib, file.replace(/\.ts$/, '.mjs')),
        'export const pdfDocument = () => ""; export const GOLDEN_TOUCH_LOGO_DATA_URI = ""; export const LOGO_DATA_URI = ""; export const FIRMA_DATA_URI = ""; export const FIRMA2_DATA_URI = "";\n',
        'utf8'
      );
      continue;
    }
    const src = fs.readFileSync(path.join(libDir, file), 'utf8')
      .replace(/from\s+['"](\.[^'"]+)['"]/g, (m, p1) => (p1.endsWith('.mjs') ? m : `from '${p1}.mjs'`));
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    fs.writeFileSync(path.join(destLib, file.replace(/\.ts$/, '.mjs')), out, 'utf8');
  }
}

try {
  transpileAllLib();
  const flujo = await import(pathToFileURL(path.join(TMP, 'src', 'lib', 'requerimientoFlujo.mjs')).href);
  const exp = await import(pathToFileURL(path.join(TMP, 'src', 'lib', 'requerimientoExpediente.mjs')).href);
  const cp = await import(pathToFileURL(path.join(TMP, 'src', 'lib', 'cuentasPago.mjs')).href);

  const { calcularEstadoRequerimiento, esRequerimientoDespachado } = flujo;
  const { inyectarDespachoEnObservaciones } = exp;
  const { inyectarAprobacionCxpEnNota } = cp;

  // Caso 1: Requerimiento 0196 quedó como recibido + retirado en almacén -> 'despachado'
  const obsRetirado = inyectarDespachoEnObservaciones('Pedido inicial', {
    estado: 'retirado',
    retiradoPor: 'Pedro',
    despachadoPor: 'Almacén',
    fecha: '2026-11-18T10:00:00Z',
  });
  const reqDespachado = {
    id: 'req-0196',
    code: 'REQ-0196',
    status: 'recibido',
    observaciones: obsRetirado,
  };
  assert.equal(esRequerimientoDespachado(reqDespachado), true, 'Debe detectar despacho retirado');
  assert.equal(
    calcularEstadoRequerimiento(reqDespachado, []).codigo,
    'despachado',
    'Con status recibido + retirado debe estar en despachado'
  );

  // Caso 2: Al enviarlo a Por Pagar (status='aprobado' + limpiar despacho a 'disponible' + aprobacion_cxp='pendiente')
  let obsLimpia = inyectarAprobacionCxpEnNota(reqDespachado.observaciones, {
    estado: 'pendiente',
    aprobadoPor: null,
    aprobadoPorId: null,
    fecha: '2026-11-18T15:00:00Z',
  });
  obsLimpia = inyectarDespachoEnObservaciones(obsLimpia, { estado: 'disponible' });

  const reqEnPorPagar = {
    ...reqDespachado,
    status: 'aprobado',
    observaciones: obsLimpia,
  };
  assert.equal(esRequerimientoDespachado(reqEnPorPagar), false, 'No debe seguir marcado como despachado');
  const estadoFinal = calcularEstadoRequerimiento(reqEnPorPagar, [
    { id: 'cxp-1', estado: 'pendiente', nota: '', monto: 100 },
  ]);
  assert.notEqual(estadoFinal.codigo, 'despachado', 'No debe regresar a despachado al enviarse a Por Pagar');
  assert.equal(
    estadoFinal.codigo,
    'esperando_aprobacion_gg',
    'Debe quedar en esperando_aprobacion_gg cuando se envía a Por Pagar'
  );

  console.log('OK: test-req-por-pagar-despacho.mjs pasó todas las aserciones.');
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
