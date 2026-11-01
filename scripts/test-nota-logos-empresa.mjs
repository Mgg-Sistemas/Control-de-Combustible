import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const transpilar = (src) => ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const cargar = (rel, stubs = {}) => {
  const mod = { exports: {} };
  const req = (n) => { if (n in stubs) return stubs[n]; throw new Error(`import no previsto en ${rel}: ${n}`); };
  new Function('exports', 'module', 'require', transpilar(leer(rel)))(mod.exports, mod, req);
  return mod.exports;
};

const stubs = {
  './logoData': { LOGO_DATA_URI: 'data:image/png;base64,SOS_LOGO_DATA' },
  './logoGoldenTouchData': { GOLDEN_TOUCH_LOGO_DATA_URI: 'data:image/png;base64,GT_LOGO_DATA' },
  './logoRenaceData': { RENACE_LOGO_DATA_URI: 'data:image/png;base64,RENACE_LOGO_DATA' },
  './logoJhenzaenData': { JHENZAEN_LOGO_DATA_URI: 'data:image/png;base64,JHENZAEN_LOGO_DATA' },
  './logoBcvData': { BCV_LOGO_DATA_URI: 'data:image/png;base64,BCV_LOGO_DATA' },
  './company': { COMPANY_NAME: 'SOS La Guaira 2026' },
};

const { notaEntregaHtml } = cargar('src/lib/notaEntrega.ts', stubs);
const { notaTrasladoHtml } = cargar('src/lib/notaTraslado.ts', stubs);

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? `  → ${extra}` : '')); }
};

console.log('PRUEBAS — Logos y Empresa Emisora en Notas de Salida y Traslado\n');

// ── 1) Nota de Entrega: SOS desmarcado, solo Golden Touch marcado ───────────
{
  const html = notaEntregaHtml({
    fecha: '23/10/2026',
    items: [{ name: 'FILTRO DE ACEITE', qty: 2, unit: 'UND' }],
    logos: { golden: true, sos: false, renace: false, jhenzaen: false, bcv: false },
    empresaEmisora: null, // No seleccionó empresa explícita
  });

  ok('NO contiene "SOS La Guaira" en ningún lado al desmarcar SOS', !html.includes('SOS La Guaira'));
  ok('Muestra logo Golden Touch', html.includes('GT_LOGO_DATA'));
  ok('Emisor muestra Golden Touch', html.includes('GOLDEN TOUCH 1127 C.A.'));
  ok('Emisor muestra RIF de Golden Touch', html.includes('J-50129993-5'));
  ok('No duplica Golden Touch en co-block junto al logo que ya lo trae', !html.includes('<div class="co">GOLDEN TOUCH 1127 C.A.</div>'));
  ok('Pie de página tiene Golden Touch', html.includes('GOLDEN TOUCH 1127 C.A. · Comprobante oficial'));
}

// ── 2) Nota de Entrega: Empresa sin logo (logos desmarcados) ────────────────
{
  const html = notaEntregaHtml({
    fecha: '23/10/2026',
    items: [{ name: 'FILTRO DE ACEITE', qty: 2, unit: 'UND' }],
    logos: { golden: false, sos: false, renace: false, jhenzaen: false, bcv: false },
    empresaEmisora: { nombre: 'CONSTRUCCIONES LICCIONE, C.A.', rif: 'J-12345678-9' },
  });

  ok('No muestra imágenes de logos en el encabezado', !html.includes('<div class="head-logos">'));
  ok('Muestra nombre de empresa en co-block del encabezado', html.includes('<div class="co">CONSTRUCCIONES LICCIONE, C.A.</div>'));
  ok('Muestra RIF en co-block del encabezado', html.includes('<div class="rif">J-12345678-9</div>'));
  ok('Entregado por (Emisor) muestra la empresa', html.includes('<div class="box-title">CONSTRUCCIONES LICCIONE, C.A.</div>'));
  ok('Entregado por (Emisor) muestra el RIF', html.includes('RIF: J-12345678-9'));
  ok('Pie de página muestra la empresa', html.includes('CONSTRUCCIONES LICCIONE, C.A. · Comprobante oficial'));
  ok('NO contiene "SOS La Guaira"', !html.includes('SOS La Guaira'));
}

// ── 3) Nota de Entrega: Golden Touch sin logo ──────────────────────────────
{
  const html = notaEntregaHtml({
    fecha: '23/10/2026',
    items: [{ name: 'BATERIA 12V', qty: 1, unit: 'UND' }],
    logos: { golden: false, sos: false, renace: false, jhenzaen: false, bcv: false },
    empresaEmisora: { nombre: 'GOLDEN TOUCH 1127 C.A.', rif: 'J-50129993-5' },
  });

  ok('No muestra imágenes de logos', !html.includes('<div class="head-logos">'));
  ok('Muestra Golden Touch en co-block', html.includes('<div class="co">GOLDEN TOUCH 1127 C.A.</div>'));
  ok('Muestra RIF en co-block', html.includes('<div class="rif">J-50129993-5</div>'));
  ok('NO contiene "SOS La Guaira"', !html.includes('SOS La Guaira'));
}

// ── 4) Nota de Entrega: SOS marcado explícitamente ─────────────────────────
{
  const html = notaEntregaHtml({
    fecha: '23/10/2026',
    items: [{ name: 'BATERIA 12V', qty: 1, unit: 'UND' }],
    logos: { golden: false, sos: true, renace: false, jhenzaen: false, bcv: false },
    empresaEmisora: null,
  });

  ok('Contiene SOS La Guaira', html.includes('SOS La Guaira'));
  ok('Muestra logo SOS', html.includes('<div class="head-logos">') && html.includes('SOS_LOGO_DATA'));
  ok('Muestra SOS en co-block', html.includes('<div class="co">SOS La Guaira 2026</div>'));
  ok('Entregado por muestra SOS', html.includes('<div class="box-title">SOS La Guaira 2026</div>'));
}

// ── 5) Nota de Traslado: SOS desmarcado, Golden Touch marcado ───────────────
{
  const html = notaTrasladoHtml({
    fecha: '23/10/2026',
    items: [{ name: 'TUBO PVC 2"', qty: 10, unit: 'UND' }],
    logos: { golden: true, sos: false, renace: false, jhenzaen: false, bcv: false },
    empresaEmisora: null,
  });

  ok('Traslado: NO contiene "SOS La Guaira"', !html.includes('SOS La Guaira'));
  ok('Traslado: muestra logo Golden Touch', html.includes('GT_LOGO_DATA'));
  ok('Traslado: pie de página Golden Touch', html.includes('GOLDEN TOUCH 1127 C.A. · Comprobante oficial'));
}

// ── 6) Nota de Traslado: Empresa sin logo ───────────────────────────────────
{
  const html = notaTrasladoHtml({
    fecha: '23/10/2026',
    items: [{ name: 'TUBO PVC 2"', qty: 10, unit: 'UND' }],
    logos: { golden: false, sos: false, renace: false, jhenzaen: false, bcv: false },
    empresaEmisora: { nombre: 'JHENZAEN 2.012 C.A.', rif: 'J-31415926-5' },
  });

  ok('Traslado sin logo: no muestra head-logos', !html.includes('<div class="head-logos">'));
  ok('Traslado sin logo: muestra nombre en co-block', html.includes('<div class="co">JHENZAEN 2.012 C.A.</div>'));
  ok('Traslado sin logo: muestra RIF en co-block', html.includes('<div class="rif">J-31415926-5</div>'));
  ok('Traslado sin logo: pie de página con nombre', html.includes('JHENZAEN 2.012 C.A. · Comprobante oficial'));
  ok('Traslado sin logo: NO contiene "SOS La Guaira"', !html.includes('SOS La Guaira'));
}

console.log(`\nResultado: ${pass} OK · ${fail} FALLO(S)`);
if (fail > 0) {
  console.error('\nFallos:\n' + failures.join('\n'));
  process.exit(1);
}
