// 🏭 CENTRO DE OPERACIONES — 🔁 MOVIMIENTO ENTRE PATIOS (11-nov-2026). Fija:
//   · que es el MISMO movimiento «interno» de ✍️ Carga libre (misma validación y mismo guardado),
//     así los reportes que ya lo suman lo toman sin cambios,
//   · patio de origen y de destino obligatorios y distintos; viajes o m³; m³ = viajes × m³ por viaje,
//   · resumen y balance por patio (los «por confirmar» no suman),
//   · el bloque en el Parte diario (4), con su «sin guardar», y borrar solo con Full.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');
const orig = Module._load;
const falso = new Proxy(function () {}, { get: () => new Proxy(function () {}, { get: () => ({}) }) });
Module._load = function (r) { if (r === 'react-native' || /supabase|AsyncStorage|async-storage/.test(r)) return falso; return orig.apply(this, arguments); };
require.extensions['.ts'] = function (mod, fn) {
  mod._compile(ts.transpileModule(fs.readFileSync(fn, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText, fn);
};
const I = require(path.join(ROOT, 'src/lib/centroOperacionesInternos.ts'));

let ok = 0; const fallas = [];
const check = (c, m, x) => { if (c) ok++; else fallas.push('  ✗ ' + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), m, { esperado: b, obtenido: a });

const L = (id, clase, nombre, activo = true) => ({ id, sitioId: 's1', clase, nombre, activo, lat: null, lng: null });
const LISTAS = [L('pc', 'terraza', 'Patio C'), L('pb', 'terraza', 'Patio B'), L('pa', 'terraza', 'Patio A'), L('px', 'terraza', 'Viejo', false), L('mv', 'material', 'Vestigios'), L('o1', 'origen', 'Obra 1')];
eq(I.patiosActivos(LISTAS).map((p) => p.nombre), ['Patio A', 'Patio B', 'Patio C'], '⭐ los patios que ella creó (activos, A→Z); los desactivados y las otras listas no');
eq(I.materialesActivos(LISTAS).map((p) => p.nombre), ['Vestigios'], 'materiales para decir qué se movió');

// ── Validar y armar (con LA validación de Carga libre) ──
const F = (o) => ({ ...I.formInternoVacio('2026-11-10'), ...o });
{
  const { errores, datos } = I.validarInterno(F({ origenId: 'pc', destinoId: 'pb', viajes: '4', capacidad: '8', materialId: 'mv', observacion: 'payloader 2' }), LISTAS, '2026-11-11');
  eq(errores, [], 'un movimiento bien hecho no tiene errores');
  eq([datos.tipo, datos.origen, datos.origenId, datos.destino, datos.destinoId, datos.viajes, datos.capacidadM3, datos.m3, datos.material, datos.estado, datos.observacion],
    ['interno', 'Patio C', 'pc', 'Patio B', 'pb', 4, 8, null, 'Vestigios', 'confirmado', 'payloader 2'], '⭐⭐ se guarda como el «interno» de siempre (tipo, patios con su id, viajes, m³ por viaje, material)');
  eq(I.m3DelFormulario(F({ viajes: '4', capacidad: '8' })), 32, '⭐ m³ = viajes × m³ por viaje');
  eq(I.m3DelFormulario(F({ viajes: '4', capacidad: '8', m3: '30,5' })), 30.5, 'los m³ escritos mandan');
}
const errs = (o, hoy = '2026-11-11') => I.validarInterno(F(o), LISTAS, hoy).errores;
check(errs({ destinoId: 'pb' }).some((e) => /DE DÓNDE/.test(e)), 'falta el patio de origen: lo dice');
check(errs({ origenId: 'pc' }).some((e) => /A DÓNDE/.test(e)), 'falta el patio de destino: lo dice');
check(errs({ origenId: 'pc', destinoId: 'pc' }).some((e) => /distintos/.test(e)), '⭐ el mismo patio en los dos lados no se acepta');
check(errs({ origenId: 'pc', destinoId: 'px' }).some((e) => /A DÓNDE/.test(e)), 'un patio desactivado no sirve');
check(errs({ origenId: 'pc', destinoId: 'pb', viajes: '0', m3: '' }).some((e) => /viajes o los m³/.test(e)), 'sin viajes ni m³: lo dice');
check(errs({ origenId: 'pc', destinoId: 'pb', viajes: '2,5' }).length > 0, 'viajes con decimales: no (regla de Carga libre)');
check(errs({ origenId: 'pc', destinoId: 'pb', capacidad: '0' }).some((e) => /Capacidad/.test(e)), 'm³ por viaje en 0: no (regla de Carga libre)');
check(errs({ origenId: 'pc', destinoId: 'pb', fecha: '2026-11-12' }, '2026-11-11').some((e) => /todavía no empieza/.test(e)), '⭐ no se anota en una jornada futura (regla de Carga libre)');
check(errs({ origenId: 'pc', destinoId: 'pb', viajes: '', m3: '20' }).some((e) => /Escribe los viajes/.test(e)), 'los viajes son obligatorios (regla de Carga libre); los m³ se pueden escribir además');

// ── Lo del día: resumen y balance ──
const M = (o) => ({ id: o.id ?? 'x', sitioId: 's1', fecha: '2026-11-10', tipo: 'interno', estado: 'confirmado', viajes: null, capacidadM3: null, m3: null, origen: null, destino: null, ...o });
const DIA = [
  M({ id: '1', origen: 'Patio C', destino: 'Patio B', viajes: 4, capacidadM3: 8 }),
  M({ id: '2', origen: 'Patio C', destino: 'Patio A', viajes: 2, m3: 10 }),
  M({ id: '3', origen: 'Patio B', destino: 'Patio A', viajes: 1, capacidadM3: 8, estado: 'por_confirmar' }),
  M({ id: '4', tipo: 'entrada', destino: 'Patio C', viajes: 9 }),
  M({ id: '5', tipo: 'salida', origen: 'Patio A', viajes: 3 }),
];
eq(I.internosDelDia(DIA).map((m) => m.id), ['1', '2', '3'], '⭐ solo los internos (también los de Carga libre); entradas y salidas no');
eq(I.resumenInternos(I.internosDelDia(DIA)), '3 movimiento(s) · 6 viaje(s) · 42,00 m³ · 1 por confirmar', 'resumen: los «por confirmar» no suman (como en los reportes)');
eq(I.resumenInternos([]), 'Sin movimientos entre patios este día', 'sin nada: lo dice');
eq(I.balancePorPatio(I.internosDelDia(DIA)), [
  { patio: 'Patio A', salenViajes: 0, salenM3: 0, entranViajes: 2, entranM3: 10 },
  { patio: 'Patio B', salenViajes: 0, salenM3: 0, entranViajes: 4, entranM3: 32 },
  { patio: 'Patio C', salenViajes: 6, salenM3: 42, entranViajes: 0, entranM3: 0 },
], '⭐ por patio: lo que salió y lo que entró (viajes y m³)');

// ── Cableado ──
const blq = fs.readFileSync(path.join(ROOT, 'src/components/centroOperaciones/BloqueInternos.tsx'), 'utf8');
check(/guardarMovimiento\(editando \? \{ \.\.\.d, id: editando\.id \} : \{ \.\.\.d, sitioId: sitio\.id \}\)/.test(blq) && /validarInterno\(form, datos\.listas, caracasBusinessToday\(\)\)/.test(blq), '⭐ guarda con guardarMovimiento (el de Carga libre), validado');
check(/const puedeBorrar = levelMeets\(nivel, 'full'\)/.test(blq) && /const puedeEscribir = levelMeets\(nivel, 'escritura'\)/.test(blq), 'escribir con Escritura; borrar solo con Full (lo exige la base)');
check(/patios\.length < 2/.test(blq) && /⚙️ Ajustes → «⛰️ Patios»/.test(blq), 'con menos de dos patios, dice dónde crearlos');
const tab = fs.readFileSync(path.join(ROOT, 'src/components/centroOperaciones/ParteDiarioTab.tsx'), 'utf8');
check(/<Bloque titulo="4 · 🔁 Movimiento entre patios" resumen=\{resumenInternos\} sinGuardar=\{sucios\.internos\}>/.test(tab) && /<BloqueInternos\b[^>]*datos=\{salidas\}[^>]*alSinGuardar=\{marcar\.internos\}/.test(tab), '⭐ bloque 4 del Parte diario, con los mismos datos del día y su «sin guardar»');
const man = fs.readFileSync(path.join(ROOT, 'src/screens/ManualScreen.tsx'), 'utf8');
check(/MOVIMIENTO ENTRE PATIOS/.test(man), 'el manual lo explica');

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-centro-operaciones-internos: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-centro-operaciones-internos: ${ok} ok, 0 fallas`);
