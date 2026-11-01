/*
 * 📍 RUTA DEL FLETE — origen y destino editables, y traerlos de «Traslados y salidas»
 * (27-oct-2026).
 *
 * EL PEDIDO: «dame la opción de modificar el origen o destino en esos fletes» y «una opción
 * con la que yo también pueda traerme esa información de viajes de Traslados y salidas».
 *
 * LAS REGLAS QUE NO SE PUEDEN AFLOJAR:
 *  1. Las notas que ya existen se leen EXACTAMENTE igual (se compara contra el lector viejo).
 *  2. Cambiar el estado o editar un flete ya NO borra la ruta, el chofer, la cédula, la
 *     modalidad, los viajes ni los tickets (antes rehacía la nota con unos pocos campos).
 *  3. Lo escrito a mano no rompe el metadato: «[ ] |» se limpian, y un «CI:» o «ESTADO:»
 *     dentro del origen no le roba la cédula al chofer ni da el flete por pagado.
 *  4. El exento sigue siendo exento (primer token, sin ESTADO).
 *  5. Traslados se LEE y nada más: columnas mínimas (sin `datos` entero ni montos), sin la
 *     función que reescribe la copia local, y el selector va de último modal.
 *  6. Con varios traslados el mismo día se proponen; nunca se elige uno solo a ciegas.
 *
 * Todos los datos son inventados.
 *
 *   node scripts/test-fletes-ruta-traslado.mjs
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

let ultimoPdf = null;
const fakeRequire = (id) => {
  if (id.includes('logoData')) return { LOGO_DATA_URI: '' };
  if (id.includes('pdf')) return {
    exportPdf: async (html, nombre) => { ultimoPdf = { html: html.replace(/<!--[\s\S]*?-->/g, ''), nombre }; return true; },
    nowStamp: () => '27 oct. 2026, 10:00 a. m.',
  };
  throw new Error('import inesperado: ' + id);
};
const cargar = (rel, req) => {
  const mod = { exports: {} };
  new Function('exports', 'module', 'require', transpilar(rel))(mod.exports, mod, req);
  return mod.exports;
};
const pdf = cargar('src/lib/fletePdf.ts', fakeRequire);
const lib = cargar('src/lib/fleteRutaTraslado.ts', (id) => { throw new Error('import inesperado: ' + id); });

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── El lector de la nota ANTES del 27-oct (copia literal), para comparar ──
function parseViejo(raw) {
  const str = String(raw || '').trim();
  let operacionTipo = 'pagar';
  let operacionEstado = 'pendiente';
  let modalidad = 'Día / Jornada';
  let origen = '', destino = '', conductor = '', cedulaConductor = '', cliente = '';
  let detalle = str;
  let viajeIds = [], tickets = [];
  const match = str.match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (match) {
    const meta = match[1];
    detalle = match[2];
    operacionTipo = pdf.tipoDesdeMeta(meta);
    if (operacionTipo !== 'exento' && (meta.includes('ESTADO:completado') || meta.includes('ESTADO:pagado') || meta.includes('ESTADO:cobrado'))) {
      operacionEstado = 'completado';
    }
    const g = (re) => meta.match(re);
    let x;
    if ((x = g(/MOD:([^|]+)/))) modalidad = x[1].trim();
    if ((x = g(/ORIGEN:([^|]+)/))) origen = x[1].trim();
    if ((x = g(/DEST:([^|]+)/))) destino = x[1].trim();
    if ((x = g(/CHOF:([^|]+)/))) conductor = x[1].trim();
    if ((x = g(/CI:([^|]+)/))) cedulaConductor = x[1].trim();
    if ((x = g(/CLIENTE:([^|]+)/))) cliente = x[1].trim();
    if ((x = g(/VIAJES_IDS:([^|]+)/))) viajeIds = x[1].split(',').map((s) => s.trim()).filter(Boolean);
    if ((x = g(/TICKETS:([^|]+)/))) tickets = x[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return { operacionTipo, operacionEstado, modalidad, origen, destino, conductor, cedulaConductor, cliente, detalle, viajeIds, tickets };
}

const NOTAS_EXISTENTES = [
  '[POR_PAGAR|ESTADO:pendiente|CLIENTE:CLIENTE UNO|VIAJES_IDS:v-1,v-2|TICKETS:T-001,T-002] Flete importado desde 2 viaje(s) de camión',
  '[POR_COBRAR|ESTADO:cobrado|CLIENTE:CLIENTE DOS] Acarreo de prueba',
  '[POR_PAGAR|ESTADO:pagado] ',
  '[EXENTO|CLIENTE:CORTESÍA] Viaje de reposición',
  '[EXENTO|ESTADO:completado|CLIENTE:X] antes era pagado',
  '[POR_COBRAR|ESTADO:pendiente|MOD:Por viaje|ORIGEN:PATIO NORTE|DEST:OBRA SUR|CHOF:CHOFER UNO|CI:V-1|CLIENTE:Y|VIAJES_IDS:a|TICKETS:T-9] x',
  'nota escrita a mano sin metadato',
  '',
  null,
];

test('Ruta del flete: origen y destino editables y traídos de Traslados y salidas', async (t) => {
  await t.test('1. las notas que ya existen se leen exactamente igual que antes', () => {
    for (const n of NOTAS_EXISTENTES) {
      assert.deepEqual(pdf.parseFleteNote(n), parseViejo(n), `nota: ${n}`);
    }
  });

  await t.test('2. cambiar el estado conserva TODO lo demás de la nota', () => {
    const n = NOTAS_EXISTENTES[5];
    const nueva = pdf.rehacerNotaFlete(n, { operacionEstado: 'completado' });
    const a = pdf.parseFleteNote(n);
    const b = pdf.parseFleteNote(nueva);
    assert.equal(b.operacionEstado, 'completado');
    for (const k of ['operacionTipo', 'modalidad', 'origen', 'destino', 'conductor', 'cedulaConductor', 'cliente', 'detalle', 'viajeIds', 'tickets']) {
      assert.deepEqual(b[k], a[k], `se perdió ${k}`);
    }
  });

  await t.test('2b. rehacer sin cambios deja la nota igual; no inventa MOD si no lo traía', () => {
    for (const n of NOTAS_EXISTENTES.slice(0, 6)) {
      const r = pdf.rehacerNotaFlete(n, {});
      assert.deepEqual(pdf.parseFleteNote(r), pdf.parseFleteNote(n), `nota: ${n}`);
    }
    assert.ok(!pdf.rehacerNotaFlete(NOTAS_EXISTENTES[0], { operacionEstado: 'completado' }).includes('MOD:'));
    // Un `undefined` en los cambios no borra nada.
    const r = pdf.rehacerNotaFlete(NOTAS_EXISTENTES[5], { origen: undefined, destino: 'OTRA OBRA' });
    assert.equal(pdf.parseFleteNote(r).origen, 'PATIO NORTE');
    assert.equal(pdf.parseFleteNote(r).destino, 'OTRA OBRA');
  });

  await t.test('2c. editar el flete pone la ruta nueva y conserva chofer, viajes y tickets', () => {
    const n = NOTAS_EXISTENTES[5];
    const r = pdf.rehacerNotaFlete(n, {
      operacionTipo: 'cobrar', operacionEstado: 'pendiente', cliente: 'Y', detalle: 'x',
      origen: 'HOTEL A', destino: 'RESIDENCIA B',
    });
    const p = pdf.parseFleteNote(r);
    assert.equal(p.origen, 'HOTEL A');
    assert.equal(p.destino, 'RESIDENCIA B');
    assert.equal(p.conductor, 'CHOFER UNO');
    assert.equal(p.cedulaConductor, 'V-1');
    assert.deepEqual(p.viajeIds, ['a']);
    assert.deepEqual(p.tickets, ['T-9']);
    // Borrar la ruta a mano (campos vacíos) la quita.
    const sin = pdf.parseFleteNote(pdf.rehacerNotaFlete(r, { origen: '', destino: '' }));
    assert.equal(sin.origen, '');
    assert.equal(sin.destino, '');
    assert.deepEqual(sin.viajeIds, ['a']);
  });

  await t.test('2d. el exento sigue exento y sin ESTADO', () => {
    const r = pdf.rehacerNotaFlete(NOTAS_EXISTENTES[3], { origen: 'A', destino: 'B' });
    assert.ok(r.startsWith('[EXENTO|'));
    assert.ok(!r.includes('ESTADO:'));
    assert.equal(pdf.parseFleteNote(r).operacionTipo, 'exento');
    assert.equal(pdf.tipoDesdeMeta(r.slice(1, r.indexOf(']'))), 'exento');
  });

  await t.test('3. lo escrito a mano no rompe el metadato ni roba campos', () => {
    assert.equal(pdf.limpiarCampoNota(' a [b]  | c '), 'a (b) / c');
    const n = pdf.formatFleteNote({
      operacionTipo: 'pagar', operacionEstado: 'pendiente',
      origen: 'PLANTA ] CI: 3 | ESTADO:pagado', destino: 'OBRA [2]',
      conductor: 'CHOFER', cedulaConductor: 'V-9', viajeIds: ['v1', 'v2'], tickets: ['T1'],
    });
    const p = pdf.parseFleteNote(n);
    assert.equal(p.cedulaConductor, 'V-9', 'el «CI:» del origen no le roba la cédula');
    assert.equal(p.operacionEstado, 'pendiente', 'el «ESTADO:pagado» del origen no lo da por pagado');
    assert.deepEqual(p.viajeIds, ['v1', 'v2'], 'los viajes vinculados siguen ahí');
    assert.deepEqual(p.tickets, ['T1']);
    assert.equal(p.origen, 'PLANTA ) CI: 3 / ESTADO:pagado');
    assert.equal(p.destino, 'OBRA (2)');
    // La clave se compara EXACTA, como antes: un «Ci:» escrito a mano no es la cédula.
    assert.equal(pdf.parseFleteNote('[POR_PAGAR|ESTADO:pendiente|CLIENTE:A | Ci: 5]').cedulaConductor, '');
  });

  await t.test('3b. el comprobante sale con la ruta guardada', async () => {
    const note = pdf.formatFleteNote({ operacionTipo: 'cobrar', operacionEstado: 'pendiente', origen: 'HOTEL A', destino: 'RESIDENCIA B' });
    await pdf.exportarComprobanteFlete({ flete: { id: 'f1', flete_date: '2026-10-21', viajes: 3, precio: 1, note }, companyName: 'EMPRESA' });
    assert.ok(ultimoPdf.html.includes('HOTEL A'));
    assert.ok(ultimoPdf.html.includes('RESIDENCIA B'));
    assert.ok(!ultimoPdf.html.includes('Punto de origen no especificado'));
  });

  await t.test('4. placas y fechas de Traslados', () => {
    assert.equal(lib.normalizarPlaca(' ab12-cd 3e '), 'AB12CD3E');
    assert.deepEqual(lib.pedazosPlaca('AAA111/BBB222'), ['AAA111', 'BBB222']);
    assert.deepEqual(lib.pedazosPlaca('—'), []);
    assert.deepEqual(lib.pedazosPlaca(null), []);
    assert.equal(lib.fechaTrasladoIso('19 / 10 / 2026'), '2026-10-19');
    assert.equal(lib.fechaTrasladoIso('1/9/2026'), '2026-09-01');
    assert.equal(lib.fechaTrasladoIso('31/02/2026'), null);
    assert.equal(lib.fechaTrasladoIso(''), null);
    assert.equal(lib.diaCaracas('2026-10-20T02:00:00Z'), '2026-10-19');
    assert.equal(lib.limpiarLugar('Patio'), '');
    assert.equal(lib.limpiarLugar('Destino de entrega'), '');
    assert.equal(lib.limpiarLugar(' — '), '');
    assert.equal(lib.limpiarLugar('  HOTEL   A '), 'HOTEL A');
  });

  const fila = (o) => ({
    id: o.id, numero_control: o.num ?? 'AT-1', machine_code: null, created_at: o.creado ?? '2026-10-21T13:00:00Z',
    is_deleted: o.borrado ?? false, deleted_at: null, origen: o.origen ?? 'A', destino: o.destino ?? 'B',
    fecha: o.fecha ?? '21 / 10 / 2026', placa_chuto: o.chuto ?? 'AAA111', placa_lowboy: o.lowboy ?? '—',
    equipo_codigo: o.equipo ?? 'MARTILLO', equipo_tipo: null,
  });

  await t.test('5. fila de Traslados → ruta: borrados fuera, fecha ilegible usa el día de registro', () => {
    assert.equal(lib.filaATrasladoRuta(fila({ id: 'x', borrado: true })), null);
    const r = lib.filaATrasladoRuta(fila({ id: 'y', fecha: 'ayer', creado: '2026-10-22T03:00:00Z', chuto: '—' }));
    assert.equal(r.fechaIso, '2026-10-21');
    assert.equal(r.chutoTxt, '');
    assert.equal(r.chuto, '');
    assert.equal(r.equipo, 'MARTILLO');
  });

  await t.test('6. se proponen los del mismo chuto y fecha; los demás del día aparte', () => {
    const lista = [
      fila({ id: '2', creado: '2026-10-21T15:00:00Z', origen: 'R', destino: 'C' }),
      fila({ id: '1', creado: '2026-10-21T13:00:00Z', origen: 'H', destino: 'R' }),
      fila({ id: '3', chuto: 'ZZZ999', origen: 'O', destino: 'P' }),
      fila({ id: '4', fecha: '20 / 10 / 2026' }),
      fila({ id: '5', chuto: '—' }),
      fila({ id: '6', creado: '2026-10-21T17:00:00Z', chuto: 'QQQ000', lowboy: 'BBB222', origen: 'L', destino: 'M' }),
    ].map(lib.filaATrasladoRuta);
    const c = lib.clasificarTraslados(lista, { plate: 'AAA111/BBB222', fecha: '2026-10-21' });
    assert.deepEqual(c.sugeridos.map((x) => x.id), ['1', '2', '6']);
    assert.deepEqual(c.mismaFecha.map((x) => x.id).sort(), ['3', '5']);
    // Sin placa no se propone ninguno como «del chuto».
    assert.equal(lib.clasificarTraslados(lista, { plate: null, fecha: '2026-10-21' }).sugeridos.length, 0);
    // Una ruta: la suya. Varias: en orden de registro, sin repetir.
    assert.deepEqual(lib.rutaDeTraslados([c.sugeridos[0]]), { origen: 'H', destino: 'R' });
    assert.deepEqual(lib.rutaDeTraslados([c.sugeridos[1], c.sugeridos[0], c.sugeridos[0]]), { origen: 'H / R', destino: 'R / C' });
    assert.equal(lib.rutaDeTraslados([lib.filaATrasladoRuta(fila({ id: 'v', origen: 'Patio', destino: 'Destino de entrega' }))]), null);
    // El botón cuenta rutas DISTINTAS: dos traslados con la misma ruta son una.
    assert.equal(lib.paresDeRuta([c.sugeridos[0], c.sugeridos[0], c.sugeridos[1]]).length, 2);
    assert.equal(lib.MAX_LUGAR_FLETE, 240);
    // Búsqueda sin acentos y por placa.
    const conAcento = [lib.filaATrasladoRuta(fila({ id: 'z', origen: 'ALMACÉN', chuto: 'XYZ123' }))];
    assert.equal(lib.buscarTraslados(conAcento, 'almacen').length, 1);
    assert.equal(lib.buscarTraslados(conAcento, 'xyz-123').length, 1);
    assert.equal(lib.buscarTraslados(conAcento, '').length, 0);
  });

  await t.test('7. candados del código: solo lectura, sin borrar nada de la nota', () => {
    const db = leer('src/lib/fleteRutaTrasladoDb.ts');
    const sinComentarios = db.replace(/\/\/.*$/gm, '');
    assert.ok(!/\.(insert|update|upsert|delete)\s*\(/.test(sinComentarios), 'Traslados solo se lee');
    assert.ok(!/['"]\*['"]/.test(sinComentarios) && !/['"]datos['"]/.test(sinComentarios), 'nunca datos entero ni *');
    assert.ok(/\.is\('deleted_at', null\)/.test(db), 'solo traslados vivos');
    assert.ok(!sinComentarios.includes('cargarTrasladosCompartidos'));

    const pant = leer('src/screens/ServicioFletesScreen.tsx');
    const toggle = pant.slice(pant.indexOf('const toggleEstadoFlete'), pant.indexOf('const saveFlete'));
    assert.ok(toggle.includes('rehacerNotaFlete(f.note'), 'cambiar el estado conserva la nota');
    assert.ok(!toggle.includes('formatFleteNote('));
    const save = pant.slice(pant.indexOf('const saveFlete'), pant.indexOf('// 📍 Traer la ruta'));
    assert.ok(save.includes('rehacerNotaFlete(origFlete.note'), 'editar conserva la nota');
    assert.ok(!pant.includes('cargarTrasladosCompartidos'));
    // Editar un flete que ya no está en la lista no se guarda (perdería sus viajes vinculados).
    assert.ok(save.includes('if (editingFleteId && !origFlete)'));
    // Los avisos del selector van dentro del selector (un toast quedaría tapado por el modal).
    const usar = pant.slice(pant.indexOf('const usarRuta'), pant.indexOf('const camposRuta'));
    assert.ok(usar.includes('setRutaAviso(') && !usar.includes('toast.'));
    assert.ok(usar.includes('MAX_LUGAR_FLETE'));
    // El selector es el último modal (en la web gana el último montado).
    const ultimo = pant.lastIndexOf('<Modal');
    assert.ok(pant.slice(ultimo, ultimo + 80).includes('rutaPara !== null'));
    // Los campos de ruta se llaman como función (no pierden el foco).
    assert.ok(pant.includes("{camposRuta('form'") && pant.includes("{camposRuta('import'"));
    assert.ok(!/<CamposRuta/.test(pant));
  });
});
