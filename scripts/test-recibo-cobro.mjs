/*
 * RECIBO DE COBRO DE UNA MANGUERA — la ficha de la máquina embebida en el PDF.
 *
 * EL PEDIDO QUE CUBRE (20-ago-2026, cliente): «para recibo de cobro, que si está
 * enlazado a una maquinaria, salga la ficha de la máquina así como en servicio de
 * maquinaria, que te trae la imagen de la maquinaria y la información de la
 * maquinaria». Antes el recibo solo decía "RETROEXCAVADORA · Serial X" en una fila
 * de tabla; quien recibe el cobro no tenía cómo saber a qué equipo se le hizo el
 * trabajo. Ahora, cuando la manguera está enlazada a una máquina de la FLOTA, el
 * recibo lleva la ficha con FOTO debajo del monto a cobrar.
 *
 * LAS DOS REGLAS QUE NO SE PUEDEN ROMPER:
 *   1. Sin máquina (manguera EXTERNA, o ficha que no se pudo cargar) el recibo sale
 *      EXACTAMENTE como salía: nadie se queda sin su recibo por un problema de red.
 *   2. La ficha se embebe SIN corte de página (`corte: false`). Con corte, el recibo
 *      de UNA manguera se volvía de dos hojas.
 *
 * Además vigila la pantalla: la ficha se carga en el `onPress` del botón y NO dentro
 * del `.map` de la lista — la lista trae decenas de mangueras y una consulta por
 * cada una tumbaría el módulo.
 *
 *   npm run test:recibo-cobro   (o: node scripts/test-recibo-cobro.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const transpilar = (rel) => ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;

// machineLabel.ts es PURO (sin imports) → se carga de verdad, para que la prueba
// compruebe que las tres RETROEXCAVADORAS se distinguen también en el recibo.
const lblMod = { exports: {} };
new Function('exports', 'module', transpilar('src/lib/machineLabel.ts'))(lblMod.exports, lblMod);

// `pdf.ts` arrastra react-native/expo-print y `bcv.ts` arrastra supabase: se
// sustituyen por lo mínimo que el recibo usa. El membrete y el formato de dólares
// son envoltorio, no lógica del recibo.
const fmtUsd = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100)
  .toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fakeRequire = (id) => {
  if (id.includes('machineLabel')) return lblMod.exports;
  if (id.includes('machineService')) return svcMod.exports;   // la ficha de verdad
  if (id.includes('bcv')) return { fmtUsd };
  if (id.includes('pdf')) return {
    pdfDocument: (o) => `<html><title>${o.title}</title><div class="doc-sub">${o.subtitle || ''}</div><style>${o.extraCss || ''}</style>${o.body}</html>`,
    exportPdf: async () => true,
  };
  if (id.includes('types/database')) return {};
  throw new Error('import inesperado: ' + id);
};

// La FICHA de verdad, la misma de Servicio de maquinaria (no una copia).
const svcMod = { exports: {} };
new Function('exports', 'module', 'require', transpilar('src/lib/machineServiceReport.ts'))(
  svcMod.exports, svcMod, fakeRequire);

const recMod = { exports: {} };
new Function('exports', 'module', 'require', transpilar('src/lib/reciboCobro.ts'))(
  recMod.exports, recMod, fakeRequire);
const { montoACobrar, buildReciboCobroHtml } = recMod.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    → ${extra}` : ''}`); }
};

const MANGUERA = {
  id: 'mg-1', code: 'MG-0042', service_date: '2026-08-18',
  description: 'Cambio de manguera hidráulica del brazo',
  cost_usd: 120, sale_margin_pct: 30, is_external: false, machinery_id: 'maq-1',
};
const R053 = {
  id: 'maq-1', code: 'RETROEXCAVADORA', identifier: '053', serial: '5YN02894',
  plate: 'SLP214TSWE0471955', marca: 'CAT', modelo: '320', tipo: 'Retroexcavadora',
  photo_url: 'https://x/foto.jpg', encargado: 'César Flames',
  companyName: 'Golden Touch 1127 C.A.',
};
const BASE = { hose: MANGUERA, companyName: 'Golden Touch 1127 C.A.', encargadoName: 'César Flames' };

// ── 1) EL MONTO A COBRAR (lo que de verdad se le factura a la empresa) ─────
eq('120 con 30 % de margen', montoACobrar(120, 30), 156);
eq('margen 0 → se cobra el costo', montoACobrar(120, 0), 120);
eq('costo 0 → no se cobra nada', montoACobrar(0, 30), 0);
eq('redondea a 2 decimales', montoACobrar(33.33, 15), 38.33);
eq('el redondeo no arrastra centavos de más', montoACobrar(10.005, 0), 10.01);
eq('costo en texto (viene del formulario) se calcula igual', montoACobrar('120', '30'), 156);
eq('costo no numérico cuenta como 0', montoACobrar('abc', 30), 0);
eq('margen no numérico cuenta como 0, no rompe el cobro', montoACobrar(120, 'abc'), 120);
eq('null/undefined no rompen', montoACobrar(null, undefined), 0);
eq('margen 100 % duplica', montoACobrar(80, 100), 160);

// ── 2) ⭐ CON MÁQUINA: la ficha con foto va DENTRO del recibo ──────────────
{
  const html = buildReciboCobroHtml({ ...BASE, maquina: R053 });

  ok('⭐ la ficha trae la FOTO de la máquina',
    html.includes('<img class="sv-photo"') && html.includes('src="https://x/foto.jpg"'));
  ok('⭐ sale el título pedido por el cliente', /M[ÁA]QUINA A LA QUE SE LE HIZO EL TRABAJO/i.test(html));
  ok('la ficha muestra la PLACA, que es lo que usan para asignar',
    html.includes('SLP214TSWE0471955'));
  ok('la ficha muestra el SERIAL', html.includes('5YN02894'));
  ok('la ficha muestra la EMPRESA', html.includes('Golden Touch 1127 C.A.'));
  ok('la ficha muestra marca y modelo', html.includes('CAT') && html.includes('320'));
  ok('la ficha muestra al encargado', html.includes('César Flames'));
  ok('el nombre de la máquina encabeza la ficha', /class="sv-name"/.test(html));
  ok('viaja el CSS de la ficha (si no, sale sin foto ni recuadros)',
    html.includes('.sv-photo') && html.includes('table.ft'));

  // ⭐ La regla del corte: el recibo de UNA manguera es de UNA hoja.
  ok('⭐ la ficha embebida NO corta página', !html.includes('class="corte"'));
  // Y que no sea una prueba de mentira: la MISMA ficha, en el reporte de
  // servicios, sí corta. La diferencia la hace el `corte: false` del recibo.
  ok('⭐ la misma ficha SÍ corta cuando es la página 1 del reporte de servicios',
    svcMod.exports.fichaTecnicaHtml(R053).includes('class="corte"'));

  // El recibo sigue siendo un recibo: el dinero manda.
  ok('⭐ el MONTO A COBRAR sigue saliendo', html.includes('MONTO A COBRAR') && html.includes('$156,00'));
  ok('el costo sigue saliendo', html.includes('$120,00'));
  ok('el margen sigue saliendo', html.includes('30%'));
  ok('el código de la fabricación sigue saliendo', html.includes('MG-0042'));
  ok('la fecha sale en formato criollo', html.includes('18/08/2026'));

  // Orden: la ficha va DESPUÉS del cuadro del monto, no antes.
  ok('⭐ la ficha va DESPUÉS del monto a cobrar',
    html.indexOf('MÁQUINA A LA QUE SE LE HIZO EL TRABAJO') > html.indexOf('MONTO A COBRAR'));
}

// ── 3) SIN MÁQUINA: el recibo sale EXACTAMENTE como antes ─────────────────
{
  const externa = { ...MANGUERA, is_external: true, machinery_id: null, external_client: 'Taller Pérez' };
  const sinFicha = buildReciboCobroHtml({
    ...BASE, hose: externa, machineLabel: 'Taller Pérez (externa, fuera de la flota)',
  });

  ok('⭐ manguera externa → NO se cuela ninguna foto', !sinFicha.includes('<img class="sv-photo"'));
  ok('⭐ manguera externa → NO sale la sección de la ficha',
    !/M[ÁA]QUINA A LA QUE SE LE HIZO EL TRABAJO/i.test(sinFicha));
  ok('manguera externa → no queda ningún <img> suelto', !/<img/.test(sinFicha));
  ok('manguera externa → sí sale el cliente externo', sinFicha.includes('Taller Pérez'));
  ok('manguera externa → sigue saliendo el monto', sinFicha.includes('MONTO A COBRAR'));

  // `maquina: null` es el caso "la consulta falló": el recibo NO puede perderse.
  const fallo = buildReciboCobroHtml({ ...BASE, maquina: null, machineLabel: 'RETROEXCAVADORA · Serial 5YN02894' });
  ok('⭐ si la ficha no se pudo cargar (null) el recibo sale igual',
    !/M[ÁA]QUINA A LA QUE SE LE HIZO EL TRABAJO/i.test(fallo) && fallo.includes('MONTO A COBRAR'));
  ok('sin ficha se conserva la fila de la máquina de siempre', fallo.includes('5YN02894'));
  eq('sin máquina el recibo es idéntico con null que con undefined',
    fallo === buildReciboCobroHtml({ ...BASE, maquina: undefined, machineLabel: 'RETROEXCAVADORA · Serial 5YN02894' }),
    true);
}

// ── 4) CASOS DE BORDE: máquinas a medio llenar ────────────────────────────
{
  const sinFoto = buildReciboCobroHtml({
    ...BASE, maquina: { id: 'm2', code: 'VOLTEO', plate: 'A12BC3D' },
  });
  ok('⭐ máquina SIN foto no deja un <img src=""> roto', !/<img[^>]*src=["']["']/.test(sinFoto));
  ok('máquina sin foto no deja el <img> vacío', !sinFoto.includes('<img class="sv-photo"'));
  ok('máquina sin foto igual trae su ficha', /M[ÁA]QUINA A LA QUE SE LE HIZO EL TRABAJO/i.test(sinFoto));
  ok('máquina sin foto muestra su placa', sinFoto.includes('A12BC3D'));
  ok('⭐ máquina a medio llenar no imprime "undefined" ni ">null<"',
    !/undefined/.test(sinFoto) && !/>null</.test(sinFoto));

  const pelada = buildReciboCobroHtml({ ...BASE, maquina: { id: 'm3', code: 'MINICARGADOR' } });
  ok('máquina sin placa/serial/empresa no rompe', typeof pelada === 'string' && pelada.includes('MINICARGADOR'));
  ok('máquina pelada tampoco imprime "undefined" ni ">null<"',
    !/undefined/.test(pelada) && !/>null</.test(pelada));

  const nulos = buildReciboCobroHtml({
    ...BASE,
    hose: { ...MANGUERA, description: null, cost_usd: null, sale_margin_pct: null },
    maquina: { id: 'm4', code: 'GRÚA', plate: null, serial: null, tipo: null, marca: null,
               modelo: null, photo_url: null, encargado: null, companyName: null },
  });
  ok('manguera y máquina con TODO en null no imprimen "undefined" ni ">null<"',
    !/undefined/.test(nulos) && !/>null</.test(nulos));
  ok('con costo null el monto sale en cero, no vacío', nulos.includes('$0,00'));

  // Inyección: un nombre con < > no puede romper el HTML del recibo.
  const raro = buildReciboCobroHtml({
    ...BASE, maquina: { id: 'm5', code: '<script>x</script>', plate: 'B2' },
  });
  ok('el texto del usuario va escapado', !raro.includes('<script>x</script>'));
}

// ── 5) LA FUNCIÓN SIGUE SIENDO PURA (no consulta Supabase) ────────────────
{
  const fuente = fs.readFileSync(path.join(ROOT, 'src/lib/reciboCobro.ts'), 'utf8');
  ok('⭐ reciboCobro.ts NO importa supabase', !/from '\.\/supabase'/.test(fuente));
  ok('⭐ reciboCobro.ts no consulta ninguna tabla', !/\.from\(/.test(fuente));
  ok('el HTML se arma aparte de la exportación (por eso se puede probar)',
    /export function buildReciboCobroHtml/.test(fuente));
  ok('generateReciboCobro usa el mismo armador, no una copia',
    /generateReciboCobro[\s\S]{0,300}buildReciboCobroHtml\(/.test(fuente));
  ok('la ficha se embebe con corte:false y el título del cliente',
    /fichaTecnicaHtml\(maquina,\s*\{\s*corte:\s*false/.test(fuente));
  ok('el recibo arrastra el CSS de la ficha', /FICHA_CSS/.test(fuente));
}

// ── 6) GUARDAS SOBRE LA PANTALLA (la consulta puntual, no una por manguera) ─
{
  const scr = fs.readFileSync(path.join(ROOT, 'src/screens/ManguerasScreen.tsx'), 'utf8');

  ok('la pantalla le pasa la ficha al recibo', /generateReciboCobro\(\{[\s\S]{0,400}maquina/.test(scr));

  // ⭐ La ficha se pide DENTRO del onPress del botón, no en el render de la lista.
  const onPress = (scr.match(/Recibo de cobro[\s\S]{0,2000}?generateReciboCobro\(/) || [''])[0];
  ok('⭐ la ficha se carga en el onPress del botón de recibo',
    /from\('machinery'\)/.test(onPress) && /photo_url/.test(onPress), 'no se halló la consulta en el onPress');
  ok('⭐ la consulta es puntual: una sola máquina (.eq + .maybeSingle)',
    /\.eq\('id',\s*h\.machinery_id\)/.test(onPress) && /maybeSingle\(\)/.test(onPress));
  ok('⭐ solo se pide la ficha de mangueras de la FLOTA (externas no)',
    /!h\.is_external\s*&&\s*h\.machinery_id/.test(onPress));

  // La lista pinta decenas de mangueras: ahí NO puede haber una consulta.
  const listado = (scr.match(/shown\.map\(\(h\) => \{[\s\S]{0,1500}?const installInfo/) || [''])[0];
  ok('⭐ la lista NO pide la ficha de cada manguera',
    !!listado && !/from\('machinery'\)/.test(listado) && !/photo_url/.test(listado));

  // Si la red falla, el usuario igual se lleva su recibo.
  ok('⭐ la consulta va en try/catch (si falla, el recibo sale sin ficha)',
    /try\s*\{[\s\S]{0,600}?from\('machinery'\)[\s\S]{0,600}?\}\s*catch/.test(onPress));
  ok('la empresa de la ficha sale de company.name', /company\?\.name/.test(onPress));
  ok('ya no se piden los campos que la ficha dejó de imprimir',
    !/oil_type|oil_capacity_l|last_horometro|horometro_base/.test(onPress));
  ok('el botón sigue respetando su estado `busy`', /busy === h\.id \+ '-recibo'/.test(scr));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-recibo-cobro · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
