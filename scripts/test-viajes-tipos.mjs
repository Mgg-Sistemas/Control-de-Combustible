/*
 * Test de los TIPOS DE VIAJE CON NOMBRE (26-sep-2026).
 *
 * Pedido del cliente: cobrar los viajes CRUZADOS (Oeste → Este y viceversa) y
 * poder inventar tarifas nuevas con otros nombres sin tocar código.
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · la tarifa del TIPO manda sobre la de zona (pagar el cruce con la tarifa
 *     de zona es pagar mal en silencio)
 *   · un tipo SIN precio nunca se paga por adivinanza: sale «tipo sin tarifa»
 *   · un viaje SIN tipo se paga EXACTAMENTE como siempre (nada de lo ya
 *     pagado puede moverse un centavo)
 *   · el tipo y su tarifa van CONGELADOS en el viaje
 *   · el papel del pago separa y cuenta los cruces
 *
 *   node scripts/test-viajes-tipos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

Module._extensions['.ts'] = (m, filename) => {
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  m._compile(js, filename);
};
const cargar = (rel) => require(path.join(ROOT, rel));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const P = cargar('src/lib/pagoViajes.ts');
const R = cargar('src/lib/pagoViajesReporte.ts');

// ── 1) EL TIPO DE UNA FILA, limpio ──────────────────────────────────────────
eq('con tipo', P.tipoDeViajePago({ tipo_viaje_nombre: '  Oeste →  Este ' }), 'Oeste → Este');
eq('sin tipo = null', P.tipoDeViajePago({ tipo_viaje_nombre: null }), null);
eq('vacío = null', P.tipoDeViajePago({ tipo_viaje_nombre: '   ' }), null);
eq('el motivo nuevo tiene su texto', P.etiquetaMotivoSinPago('tipo_sin_tarifa'), 'Tipo de viaje sin tarifa');

// ── 2) EL DINERO: la tarifa del tipo MANDA; sin tipo, todo sigue igual ─────
{
  const semanaDe = (j) => j; // una semana por jornada, suficiente para la prueba
  const modos = P.indexarModos([{ id: 'm1', machinery_id: 'cam1', modo: 'viaje', desde: '2026-09-14' }]);
  const marcas = P.indexarMarcas([]);
  // Tarifa de ZONA vigente: $10 el este. Es la trampa: si el cruce la usara,
  // pagaría $10 en vez de los $25 del tipo.
  const tarifas = [{ id: 't1', zona: 'este', precio: 10, desde: '2026-09-14', created_at: '2026-09-14' }];
  const base = { machinery_id: 'cam1', machine_code: 'VOLTEO', company_id: 'e1', zona_pago: 'este', registered_at: '2026-09-20T10:00:00-04:00' };

  const calcular = (viajes) => {
    const grupos = P.calcularPagoViajes({ viajes, modos, tarifas, marcas, semanaDe });
    return Array.from(grupos.values()).flatMap((g) => g.lineas);
  };

  // Sin tipo: la de siempre.
  const [normal] = calcular([{ ...base, id: 'v1' }]);
  eq('⭐ sin tipo, paga la tarifa de zona de siempre', [normal.precio, normal.monto, normal.motivoSinPago], [10, 10, null]);
  ok('...y la línea dice QUÉ tarifa de zona usó', normal.tarifa?.id === 't1');

  // Con tipo y tarifa congelada: manda el tipo.
  const [cruce] = calcular([{ ...base, id: 'v2', tipo_viaje_nombre: 'Oeste → Este', tipo_viaje_tarifa: 25 }]);
  eq('⭐ con tipo, manda la tarifa CONGELADA del tipo (no los $10 de la zona)', [cruce.precio, cruce.monto, cruce.motivoSinPago], [25, 25, null]);
  ok('...y NO se cuelga de ninguna tarifa de zona', cruce.tarifa === null);

  // Con tipo sin precio: visible y sin pagar — nunca la tarifa de zona por adivinanza.
  const [sinPrecio] = calcular([{ ...base, id: 'v3', tipo_viaje_nombre: 'Oeste → Este', tipo_viaje_tarifa: null }]);
  eq('⭐ tipo sin tarifa: sale «tipo_sin_tarifa» con monto 0', [sinPrecio.precio, sinPrecio.monto, sinPrecio.motivoSinPago], [0, 0, 'tipo_sin_tarifa']);

  // La marca a mano sigue mandando sobre todo.
  const marcasNo = P.indexarMarcas([{ id: 'k1', viaje_id: 'v4', facturable: false, created_at: '2026-09-21' }]);
  const gruposNo = P.calcularPagoViajes({ viajes: [{ ...base, id: 'v4', tipo_viaje_nombre: 'Oeste → Este', tipo_viaje_tarifa: 25 }], modos, tarifas, marcas: marcasNo, semanaDe });
  const [noFacturo] = Array.from(gruposNo.values()).flatMap((g) => g.lineas);
  eq('«no facturó» manda incluso sobre el tipo', [noFacturo.monto, noFacturo.motivoSinPago], [0, 'no_facturo']);

  // Un cruce pagado en un CDT SIN zona igual se paga: la tarifa es del tipo.
  const [sinZona] = calcular([{ ...base, id: 'v5', zona_pago: null, tipo_viaje_nombre: 'Oeste → Este', tipo_viaje_tarifa: 25 }]);
  eq('el tipo paga aunque el CDT no tenga zona', [sinZona.monto, sinZona.motivoSinPago], [25, null]);

  // ── 3) EL PAPEL DEL PAGO ─────────────────────────────────────────────────
  const lineas = calcular([
    { ...base, id: 'p1' },
    { ...base, id: 'p2', tipo_viaje_nombre: 'Oeste → Este', tipo_viaje_tarifa: 25 },
    { ...base, id: 'p3', tipo_viaje_nombre: 'Oeste → Este', tipo_viaje_tarifa: 25 },
  ]);
  const conteo = R.conteoPorTipoViaje(lineas);
  eq('el cuadro por tipo de viaje cuenta Normal y el cruce',
    conteo.map((c) => [c.clave, c.viajes, c.monto]),
    [['Normal (por zona)', 1, 10], ['Oeste → Este', 2, 50]]);
  const renglones = R.renglonesPorEquipo(lineas, null, null, null);
  eq('⭐ el listado separa el cruce en su propio renglón, rotulado por el tipo',
    renglones.map((r) => [r.zona, r.viajes, r.precio]),
    [['Este', 1, 10], ['Oeste → Este', 2, 25]]);
  // La pastilla nueva, apagada «como antes» (el cuadro entra oculto).
  eq('la pastilla del cuadro existe y entra oculta', [R.OPCIONES_PAGO_COMO_ANTES.sinTipoViaje, R.OPCIONES_PAGO_COMPLETO.sinTipoViaje], [true, false]);
  ok('el papel arma el cuadro cuando la pastilla lo deja',
    /if \(!o\.sinTipoViaje\) partes\.push\(cuadroConteo\('Cantidad por tipo de viaje', 'Tipo de viaje', conteoPorTipoViaje\(d\.lineas\)\)\)/.test(sinComentarios(leer('src/lib/pagoViajesReporte.ts'))));
}

// ── 4) LA LIBRERÍA DE DATOS: catálogo y congelado ──────────────────────────
const lib = sinComentarios(leer('src/lib/camionViajes.ts'));
ok('las columnas del tipo, completas', /tipo_viaje_id, tipo_viaje_nombre, tipo_viaje_tarifa/.test(lib));
ok('el insert congela id, nombre y tarifa',
  /tipo_viaje_id: params\.tipoViajeId \?\? null/.test(lib)
  && /tipo_viaje_nombre: params\.tipoViajeNombre \?\? null/.test(lib)
  && /tipo_viaje_tarifa: params\.tipoViajeTarifa \?\? null/.test(lib));
ok('la corrección del tipo congela el snapshot COMPLETO (o los tres null)',
  /patch\.tipo_viaje_id = cambios\.tipoViaje\.id;\s*patch\.tipo_viaje_nombre = cambios\.tipoViaje\.nombre;\s*patch\.tipo_viaje_tarifa = cambios\.tipoViaje\.tarifa;/.test(lib));
ok('el catálogo existe: listar, crear, editar y apagar',
  /export async function listTiposViaje/.test(lib) && /export async function crearTipoViaje/.test(lib)
  && /export async function editarTipoViaje/.test(lib) && /export async function setActivoTipoViaje/.test(lib));
ok('el nombre repetido rebota con un mensaje en criollo', /Ya existe un tipo activo llamado/.test(lib));
ok('la escalera del insert tiene el peldaño sin tipo',
  /obra: true, ticket: true, peso: true, tipo: false/.test(lib));

// ── 5) LA PANTALLA ──────────────────────────────────────────────────────────
const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
ok('el listero ve las pastillas con «Normal» de primera', /🚚 Normal/.test(scr) && /🧾 TIPO DE VIAJE/.test(scr));
ok('el payload congela el tipo elegido',
  /tipoViajeId: tipoElegido\?\.id \?\? null,\s*tipoViajeNombre: tipoElegido\?\.nombre \?\? null,\s*tipoViajeTarifa: tipoElegido\?\.tarifaUsd \?\? null,/.test(scr));
ok('la cola de pantalla también lleva el tipo',
  (scr.match(/tipoViajeNombre: q\.payload\.tipoViajeNombre \?\? null/g) || []).length === 2);
ok('la fila del viaje enseña el tipo', /🧾 \$\{row\.tipoViajeNombre\}/.test(scr));
ok('la jefa corrige el tipo con pastillas y queda en bitácora',
  /tipo de viaje: \$\{row\.tipoViajeNombre \|\| 'normal'\}/.test(scr) && /TIPO DE VIAJE<\/Text>/.test(scr));
ok('la administración de tipos existe (crear, tarifa, apagar)',
  /🧾 Tipos de viaje \(tarifas con nombre\)/.test(scr) && /crearTipo/.test(scr) && /guardarTarifaTipo/.test(scr) && /toggleActivoTipo/.test(scr));
ok('apagar un tipo PREGUNTA y aclara que no toca lo registrado',
  /deja de ofrecerse a los listeros/.test(scr) && /NO cambian/.test(scr));
ok('si falta el SQL de tipos, se dice', /tiposMissing/.test(scr));

// El detalle del pago rotula el cruce por su tipo, no por la zona del CDT.
const det = sinComentarios(leer('src/components/PagoViajesDetalle.tsx'));
ok('el detalle del pago rotula por tipo y explica la tarifa congelada',
  /tipoDeViajePago\(l\.viaje\)/.test(det) && /tarifa del tipo «/.test(det) && /congelada en el viaje/.test(det));
ok('el «tipo sin tarifa» dice cómo arreglarlo', /ponle la tarifa al tipo/.test(det));

// ── 6) LOS MANUALES ─────────────────────────────────────────────────────────
ok('el manual .md: tipos de viaje', /🧾 Tipos de viaje con nombre: la tarifa Oeste → Este y las que vengan \(26\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual .md: no pasa por romana', /🚫 Camiones que NO pasan por romana \(26\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla: tipos', /🧾 TIPOS DE VIAJE CON NOMBRE/.test(leer('src/screens/ManualScreen.tsx')));
ok('el manual en pantalla: romana', /🚫 CAMIONES QUE NO PASAN POR ROMANA/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-tipos · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
