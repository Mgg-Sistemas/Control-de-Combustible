/*
 * 🚫 FLETE EXENTO — el tercer tipo de Servicio de Fletes (26-oct-2026).
 *
 * EL PEDIDO: «en servicio de fletes necesito otra opción o apartado que además de
 * por cobrar o por pagar uno que sea exento». Un exento se registra con su camión,
 * empresa, viajes y precio de referencia, pero NO se cobra ni se paga.
 *
 * LAS REGLAS QUE NO SE PUEDEN AFLOJAR:
 *  1. No hay columna en la base: el tipo es el PRIMER token del metadato de la nota
 *     (`[POR_PAGAR|…]`, `[POR_COBRAR|…]`, `[EXENTO|…]`). Las notas viejas se leen igual.
 *  2. Un CLIENTE que se llame como un tipo («POR_PAGAR C.A.») no cambia el tipo.
 *     Antes se buscaba la palabra en todo el metadato y sí lo cambiaba.
 *  3. Un exento NO suma a «por pagar» ni a «por cobrar»: tiene su propio contador.
 *  4. El comprobante dice EXENTO, sin «total a pagar/cobrar»; el consolidado los
 *     lista APARTE y no los suma a ningún saldo.
 *
 * Todos los datos son inventados.
 *
 *   node scripts/test-fletes-exento.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

// `pdf.ts` arrastra react-native/expo-print: se sustituye por lo mínimo, y
// `exportPdf` GUARDA el HTML para poder leer lo que sale en el papel.
// Los comentarios HTML no salen en el papel: se quitan para leer solo lo visible.
let ultimoPdf = null;
const fakeRequire = (id) => {
  if (id.includes('logoData')) return { LOGO_DATA_URI: '' };
  if (id.includes('pdf')) return {
    exportPdf: async (html, nombre) => { ultimoPdf = { html: html.replace(/<!--[\s\S]*?-->/g, ''), nombre }; return true; },
    nowStamp: () => '26 oct. 2026, 10:00 a. m.',
  };
  throw new Error('import inesperado: ' + id);
};
const mod = { exports: {} };
new Function('exports', 'module', 'require', transpilar('src/lib/fletePdf.ts'))(mod.exports, mod, fakeRequire);
const {
  parseFleteNote, formatFleteNote, tipoDesdeMeta, totalesFletes,
  exportarComprobanteFlete, exportarReporteConsolidadoFletes,
} = mod.exports;

const usd = (n) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usdVE = (n) => `$${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test('Flete exento: tercer tipo que no se cobra ni se paga', async (t) => {
  await t.test('formatFleteNote escribe el tipo de PRIMER token; el exento sin ESTADO', () => {
    assert.equal(
      formatFleteNote({ operacionTipo: 'pagar', operacionEstado: 'pendiente', detalle: 'Traslado de arena' }),
      '[POR_PAGAR|ESTADO:pendiente] Traslado de arena',
    );
    assert.equal(
      formatFleteNote({ operacionTipo: 'cobrar', operacionEstado: 'completado', cliente: 'Obra Ejemplo Norte' }),
      '[POR_COBRAR|ESTADO:completado|CLIENTE:Obra Ejemplo Norte]',
    );
    assert.equal(
      formatFleteNote({ operacionTipo: 'exento', operacionEstado: 'completado', detalle: 'Cortesía a la obra' }),
      '[EXENTO] Cortesía a la obra',
      'un exento no lleva ESTADO aunque el formulario tuviera uno',
    );
    assert.equal(
      formatFleteNote({ operacionTipo: 'exento', operacionEstado: 'pendiente', viajeIds: ['v-1', 'v-2'], tickets: ['T-01', 'T-02'] }),
      '[EXENTO|VIAJES_IDS:v-1,v-2|TICKETS:T-01,T-02]',
    );
  });

  await t.test('parse ↔ format: los tres tipos van y vuelven sin perder nada', () => {
    for (const tipo of ['pagar', 'cobrar', 'exento']) {
      const nota = formatFleteNote({
        operacionTipo: tipo, operacionEstado: 'completado', cliente: 'Cliente Ficticio S.A.',
        detalle: 'Detalle de prueba', viajeIds: ['v-9'], tickets: ['T-99'],
      });
      const p = parseFleteNote(nota);
      assert.equal(p.operacionTipo, tipo, `tipo ${tipo}`);
      assert.equal(p.operacionEstado, tipo === 'exento' ? 'pendiente' : 'completado', `estado ${tipo}`);
      assert.equal(p.cliente, 'Cliente Ficticio S.A.');
      assert.equal(p.detalle, 'Detalle de prueba');
      assert.deepEqual(p.viajeIds, ['v-9']);
      assert.deepEqual(p.tickets, ['T-99']);
    }
  });

  await t.test('las notas VIEJAS se leen igual que antes', () => {
    const a = parseFleteNote('[POR_PAGAR|ESTADO:pendiente|CLIENTE:Fletero Uno] Arena lavada');
    assert.equal(a.operacionTipo, 'pagar');
    assert.equal(a.operacionEstado, 'pendiente');
    assert.equal(a.cliente, 'Fletero Uno');
    assert.equal(a.detalle, 'Arena lavada');

    const b = parseFleteNote('[POR_COBRAR|ESTADO:cobrado] Piedra picada');
    assert.equal(b.operacionTipo, 'cobrar');
    assert.equal(b.operacionEstado, 'completado');

    const c = parseFleteNote('[POR_PAGAR|ESTADO:pagado|VIAJES_IDS:x-1|TICKETS:T-7] Importado');
    assert.equal(c.operacionTipo, 'pagar');
    assert.equal(c.operacionEstado, 'completado');
    assert.deepEqual(c.viajeIds, ['x-1']);

    // Sin metadato (fletes de Control de maquinaria): por pagar, nota completa.
    const d = parseFleteNote('Flete directo estándar');
    assert.equal(d.operacionTipo, 'pagar');
    assert.equal(d.detalle, 'Flete directo estándar');
    assert.equal(parseFleteNote(null).operacionTipo, 'pagar');
    assert.equal(parseFleteNote('').operacionTipo, 'pagar');

    // El formato viejo de importación (corchete al FINAL) no es metadato de tipo.
    const e = parseFleteNote('Material granular [VIAJES_IDS:v-1|TICKETS:T-1]');
    assert.equal(e.operacionTipo, 'pagar');
    assert.equal(e.detalle, 'Material granular [VIAJES_IDS:v-1|TICKETS:T-1]');

    // Nota escrita a mano con el tipo fuera del primer lugar: token EXACTO.
    assert.equal(parseFleteNote('[ESTADO:pendiente|POR_COBRAR] x').operacionTipo, 'cobrar');
    assert.equal(parseFleteNote('[ESTADO:pendiente|EXENTO] x').operacionTipo, 'exento');
  });

  await t.test('un CLIENTE que se llama como un tipo NO cambia el tipo', () => {
    // Con la regla vieja (includes) estos dos salían «por pagar».
    assert.equal(parseFleteNote('[POR_COBRAR|ESTADO:pendiente|CLIENTE:POR_PAGAR C.A.] x').operacionTipo, 'cobrar');
    assert.equal(parseFleteNote('[EXENTO|CLIENTE:POR_PAGAR C.A.] x').operacionTipo, 'exento');
    assert.equal(parseFleteNote('[POR_PAGAR|ESTADO:pendiente|CLIENTE:EXENTO S.A.] x').operacionTipo, 'pagar');
    assert.equal(parseFleteNote('[POR_PAGAR|ESTADO:pendiente|CLIENTE:POR_COBRAR] x').operacionTipo, 'pagar');

    for (const tipo of ['pagar', 'cobrar', 'exento']) {
      for (const cliente of ['POR_PAGAR', 'POR_COBRAR', 'EXENTO', 'Exento Hermanos']) {
        const nota = formatFleteNote({ operacionTipo: tipo, operacionEstado: 'pendiente', cliente, detalle: 'EXENTO POR_COBRAR' });
        assert.equal(parseFleteNote(nota).operacionTipo, tipo, `${tipo} con cliente «${cliente}»`);
        assert.equal(parseFleteNote(nota).cliente, cliente);
      }
    }
    assert.equal(tipoDesdeMeta('CLIENTE:POR_COBRAR'), 'pagar', 'una subcadena nunca es un tipo');
  });

  await t.test('un exento no tiene estado aunque la nota trajera uno', () => {
    // Era «por pagar / pagado» y lo cambiaron a exento a mano en la nota.
    const p = parseFleteNote('[EXENTO|ESTADO:pagado] x');
    assert.equal(p.operacionTipo, 'exento');
    assert.equal(p.operacionEstado, 'pendiente');
  });

  await t.test('los totales NO suman los exentos; tienen su propio contador', () => {
    const fletes = [
      { viajes: 3, precio: 40, note: '[POR_PAGAR|ESTADO:pendiente]' },
      { viajes: 2, precio: 50, note: '[POR_COBRAR|ESTADO:cobrado]' },
      { viajes: 5, precio: 30, note: '[EXENTO]' },
      { viajes: 1, precio: 999, note: '[EXENTO|CLIENTE:POR_COBRAR]' },
      { viajes: 4, precio: 10, note: 'Nota vieja sin metadato' },
      { viajes: 2, precio: 15, note: null, operacionTipo: 'exento' },
    ];
    const t2 = totalesFletes(fletes);
    assert.deepEqual(t2.pagar, { fletes: 2, viajes: 7, usd: 160 });
    assert.deepEqual(t2.cobrar, { fletes: 1, viajes: 2, usd: 100 });
    assert.deepEqual(t2.exento, { fletes: 3, viajes: 8, refUsd: 150 + 999 + 30 });
    assert.deepEqual(totalesFletes([]).exento, { fletes: 0, viajes: 0, refUsd: 0 });
  });

  await t.test('el comprobante del exento dice EXENTO y no habla de cobrar ni pagar', async () => {
    const base = { id: 'f-1', flete_date: '2026-10-20', viajes: 4, precio: 25, code: 'VOL-900', plate: 'ZZ000ZZ', tipo: 'Volteo' };

    await exportarComprobanteFlete({ flete: { ...base, note: '[EXENTO] Cortesía' }, companyName: 'Transportes Ficticios C.A.' });
    const ex = ultimoPdf.html;
    assert.ok(ex.includes('SERVICIO EXENTO'), 'título del exento');
    assert.ok(ex.includes('NO SE COBRA NI SE PAGA'), 'franja que lo dice claro');
    assert.ok(ex.includes('Estado: <b style="color: #475569;">EXENTO</b>'), 'el estado dice EXENTO');
    assert.ok(ex.includes(`Valor de referencia: ${usdVE(100)}`), 'el monto queda como referencia');
    assert.ok(!ex.includes('TOTAL A PAGAR') && !ex.includes('TOTAL A COBRAR'), 'sin total a pagar/cobrar');
    assert.ok(!ex.includes('PENDIENTE') && !ex.includes('COMPLETADO'), 'sin estado de cobro/pago');

    await exportarComprobanteFlete({ flete: { ...base, note: '[POR_PAGAR|ESTADO:pendiente]' }, companyName: 'X' });
    assert.ok(ultimoPdf.html.includes('TOTAL A PAGAR'));
    assert.ok(ultimoPdf.html.includes('PENDIENTE'));
    assert.ok(!ultimoPdf.html.includes('EXENTO'), 'un por pagar no menciona exento');

    await exportarComprobanteFlete({ flete: { ...base, note: '[POR_COBRAR|ESTADO:cobrado|CLIENTE:EXENTO S.A.]' }, companyName: 'X' });
    assert.ok(ultimoPdf.html.includes('TOTAL A COBRAR'));
    assert.ok(ultimoPdf.html.includes('COMPLETADO'));
    assert.ok(!ultimoPdf.html.includes('SERVICIO EXENTO'), 'el cliente «EXENTO S.A.» no lo vuelve exento');
  });

  await t.test('el consolidado lista los exentos APARTE y no los suma a ningún saldo', async () => {
    const fletes = [
      { id: 'a', flete_date: '2026-10-01', viajes: 3, precio: 40, code: 'VOL-901', note: '[POR_PAGAR|ESTADO:pendiente]' },
      { id: 'b', flete_date: '2026-10-02', viajes: 2, precio: 50, code: 'VOL-902', note: '[POR_COBRAR|ESTADO:pendiente]' },
      { id: 'c', flete_date: '2026-10-03', viajes: 5, precio: 30, code: 'VOL-903', note: '[EXENTO]' },
    ];
    await exportarReporteConsolidadoFletes({ companyName: 'Empresa de Prueba', fletes });
    const html = ultimoPdf.html;

    const sumAmt = (titulo) => {
      const m = html.match(new RegExp(`${titulo}<\\/div>\\s*<div class="sum-amt"[^>]*>([^<]+)<`));
      return m && m[1].trim();
    };
    assert.equal(sumAmt('💸 Total por Pagar \\(Fleteros\\):'), usd(120), 'por pagar = solo el por pagar');
    assert.equal(sumAmt('💰 Total por Cobrar \\(Clientes\\):'), usd(100), 'por cobrar = solo el por cobrar');
    assert.equal(sumAmt('🚫 Exentos \\(sin cobro ni pago\\):'), '1 flete(s)', 'contador propio de exentos');

    assert.ok(html.includes('Fletes exentos · no se cobran ni se pagan'), 'sección aparte');
    assert.ok(html.includes('Total exento (no se suma):'), 'su total dice que no se suma');
    // Fila de totales de la tabla principal: 5 viajes y $220 (sin los 5 viajes / $150 exentos).
    const tot = html.match(/Totales:<\/td>\s*<td class="num">(\d+)<\/td>\s*<td><\/td>\s*<td class="num"[^>]*>\s*([^<]+?)\s*<\/td>/);
    assert.ok(tot, 'fila de totales');
    assert.equal(tot[1], '5');
    assert.equal(tot[2], usd(220));

    // Solo exentos: no hay tabla principal, sí la de exentos.
    await exportarReporteConsolidadoFletes({ companyName: 'Empresa de Prueba', fletes: [fletes[2]] });
    assert.ok(!ultimoPdf.html.includes('Totales:</td>'), 'sin tabla de saldos');
    assert.ok(ultimoPdf.html.includes('Total exento (no se suma):'));

    // Sin exentos el reporte sale como siempre: ni tarjeta ni sección de exentos.
    await exportarReporteConsolidadoFletes({ companyName: 'Empresa de Prueba', fletes: fletes.slice(0, 2) });
    assert.ok(!ultimoPdf.html.includes('Exentos (sin cobro ni pago)'));
    assert.ok(!ultimoPdf.html.includes('Fletes exentos'));
    assert.ok(ultimoPdf.html.includes('Totales:</td>'));
  });

  await t.test('la pantalla ofrece «Exento» en los tres lugares y usa la regla compartida', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/screens/ServicioFletesScreen.tsx'), 'utf8');
    assert.ok(src.includes("setFilterTipo('exento')"), 'pastilla de filtro');
    assert.ok(src.includes("setFormOperacionTipo('exento')"), 'formulario Registrar/Editar');
    assert.ok(src.includes("setImportOperacionTipo('exento')"), 'modal Importar desde viajes');
    assert.ok(src.includes("'🚫 EXENTO'"), 'etiqueta en la tarjeta');
    assert.ok(src.includes('totalesFletes(filteredFletes)'), 'los totales salen de la misma regla que el PDF');
    assert.ok(/if \(parsed\.operacionTipo === 'exento'\) return; \/\/ un exento no tiene estado/.test(src),
      'tocar el estado de un exento no hace nada');
    assert.ok(!/meta\.includes\('POR_/.test(fs.readFileSync(path.join(ROOT, 'src/lib/fletePdf.ts'), 'utf8')),
      'el tipo ya no se decide por subcadena');
  });
});
