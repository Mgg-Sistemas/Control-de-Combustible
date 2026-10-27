// 🏭 CENTRO DE OPERACIONES — PRUEBAS DEL 📅 PARTE DIARIO (24-oct-2026).
//
//   (1) Las cuentas puras de la pantalla (src/components/centroOperaciones/parteDiario.ts):
//       mover la jornada sin pasar de hoy, el aviso de un reporte de OTRA jornada (y el
//       corte de las 07:00, R28), los renglones de patio con LA MISMA regla que
//       guardarPatiosDelDia, la suma y la línea «Patios 250 · Reporte 238 · diferencia +12»
//       (neutra: nunca «error»), y el sello en hora de Caracas.
//   (2) Candados sobre las pantallas: 📅 Parte diario es la PRIMERA pestaña (y la que se
//       abre), «✍️ Carga libre» la última; el Reporte General se lee con
//       leerReporteGeneral y se guarda con guardarReporteGeneral preguntando antes de
//       reemplazar; los patios se guardan con guardarPatiosDelDia; ningún componente
//       habla con supabase; y los siete bloques están montados con { sitio, nivel, fecha }.
//
// ⭐ Todos los datos son SINTÉTICOS (el repositorio es público).
//
//   node scripts/test-centro-operaciones-parte-diario.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

// El mismo cargador de scripts/test-centro-operaciones-materiales.mjs: transpila el .ts
// a CommonJS y resuelve los imports relativos a otros .ts.
const cache = new Map();
function loadTs(abs) {
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

const DIR = 'src/components/centroOperaciones';
const LIB = path.join(ROOT, DIR, 'parteDiario.ts');
let L = {};
let pass = 0, fail = 0;
const failures = [];
try { L = loadTs(LIB); } catch (e) { fail++; failures.push(`no se pudo cargar parteDiario.ts: ${e.message}`); }

const eq = (name, got, want) => {
  let v;
  try { v = typeof got === 'function' ? got() : got; } catch (e) { v = `reventó: ${e.message}`; }
  const g = JSON.stringify(v), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond, detalle = '') => {
  let v;
  try { v = !!(typeof cond === 'function' ? cond() : cond); } catch (e) { v = false; detalle = `reventó: ${e.message}`; }
  if (v) pass++; else { fail++; failures.push(`✗ ${name}${detalle ? `\n    ${detalle}` : ''}`); }
};
const llamar = (fn, ...args) => {
  if (typeof L[fn] !== 'function') return `«${fn}» no existe`;
  try { return L[fn](...args); } catch (e) { return `«${fn}» lanzó: ${e.message}`; }
};

console.log('🏭 CENTRO DE OPERACIONES · 📅 PARTE DIARIO\n');

// ═══════════════════════════ (1) LAS CUENTAS PURAS ═══════════════════════════

// ——— 1.1 La jornada elegida: ◀ ▶ de a un día, sin pasar de hoy ———
{
  const HOY = '2026-10-24';
  eq('1.1 ◀ un día atrás', llamar('moverJornada', '2026-10-24', -1, HOY), '2026-10-23');
  eq('1.1 ▶ un día adelante', llamar('moverJornada', '2026-10-22', 1, HOY), '2026-10-23');
  eq('1.1 ▶ no pasa de hoy', llamar('moverJornada', '2026-10-24', 1, HOY), '2026-10-24');
  eq('1.1 ◀ cruza el mes', llamar('moverJornada', '2026-11-01', -1, '2026-11-05'), '2026-10-31');
  eq('1.1 ◀ cruza el año', llamar('moverJornada', '2027-01-01', -1, '2027-01-05'), '2026-12-31');
  eq('1.1 ◀ en bisiesto (2028)', llamar('moverJornada', '2028-03-01', -1, '2028-03-05'), '2028-02-29');
  eq('1.1 una fecha que no es fecha vuelve a hoy', llamar('moverJornada', 'basura', -1, HOY), HOY);
  eq('1.1 se puede avanzar si es antes de hoy', llamar('puedeAvanzar', '2026-10-23', HOY), true);
  eq('1.1 * y no si ya es hoy', llamar('puedeAvanzar', HOY, HOY), false);
}

// ——— 1.2 Un reporte de OTRA jornada ———
{
  const leido = { fecha: '2026-10-05', horaCorte: '19:00', jornada: '2026-10-05' };
  eq('1.2 misma jornada: no es distinta', llamar('jornadaDistinta', leido, '2026-10-05'), false);
  eq('1.2 otra jornada: sí', llamar('jornadaDistinta', leido, '2026-10-06'), true);
  eq('1.2 sin jornada leída no se sabe: false', llamar('jornadaDistinta', { fecha: null, horaCorte: null, jornada: null }, '2026-10-06'), false);
  eq('1.2 * y con null tampoco revienta', llamar('jornadaDistinta', null, '2026-10-06'), false);
  eq('1.2 misma jornada: sin aviso', llamar('avisoJornadaDistinta', leido, '2026-10-05'), null);
  const aviso = llamar('avisoJornadaDistinta', leido, '2026-10-06');
  ok('⭐ 1.2 el aviso nombra las dos jornadas', typeof aviso === 'string' && aviso.includes('05/10/2026') && aviso.includes('06/10/2026'), aviso);
  ok('⭐ 1.2 * y dice dónde queda al guardarlo (en la del reporte)', typeof aviso === 'string' && /queda en la jornada del 05\/10\/2026/.test(aviso), aviso);

  // R28: un corte a las 07:00 CIERRA la jornada anterior.
  const madrugada = { fecha: '2026-10-06', horaCorte: '07:00', jornada: '2026-10-05' };
  const nota = llamar('notaCorteMadrugada', madrugada);
  ok('⭐ 1.2 R28: el corte de las 07:00 del 06 se explica como cierre de la jornada del 05',
    typeof nota === 'string' && nota.includes('06/10/2026') && nota.includes('07:00') && nota.includes('05/10/2026'), nota);
  eq('1.2 * un corte de la tarde no necesita nota', llamar('notaCorteMadrugada', leido), null);
  eq('1.2 * sin fecha tampoco', llamar('notaCorteMadrugada', { fecha: null, horaCorte: null, jornada: null }), null);
  eq('1.2 * el corte de madrugada elegido en su jornada no es «otra jornada»', llamar('jornadaDistinta', madrugada, '2026-10-05'), false);
}

// ——— 1.3 Los patios del sitio y sus renglones guardados ———
const item = (id, nombre, clase = 'terraza', activo = true) => ({ id, sitioId: 's1', clase, nombre, activo, lat: null, lng: null, km: null, factorTM3: null, diasDisponible: null });
const mov = (o) => ({
  id: o.id ?? 'm', sitioId: 's1', fecha: '2026-10-05', hora: null, tipo: 'entrada', unidadId: null, unidadTexto: '', placa: null,
  transportista: null, transportistaId: null, origen: null, origenId: null, destino: null, destinoId: null,
  material: null, materialId: null, capacidadM3: null, viajes: null, toneladas: null, m3: null, estado: 'confirmado',
  observacion: null, ...o,
});
{
  const listas = [item('pc', 'Patio C'), item('pa', 'Patio A'), item('x', 'Patio Viejo', 'terraza', false), item('d1', 'Destino Uno', 'destino'), item('pb', 'patio b')];
  const patios = llamar('patiosDeLista', listas);
  eq('⭐ 1.3 los patios son la lista «terraza» ACTIVA, A→Z', Array.isArray(patios) ? patios.map((p) => p.nombre) : patios, ['Patio A', 'patio b', 'Patio C']);
  eq('1.3 * sin listas: ninguno', llamar('patiosDeLista', []), []);
  // ⭐ Revisión final A#5: el mismo patio «para todos los sitios» (sitioId null) y en el sitio
  //    → UN solo campo, el DEL SITIO (la regla de `itemDeLista`, lote 5 A8). Antes salían dos
  //    campos «Patio A» y «Guardar patios» los rechazaba por repetidos.
  {
    const general = { ...item('pg', 'Patio A'), sitioId: null };
    const delSitio = item('ps', ' patio a ');
    const unico = llamar('patiosDeLista', [general, item('pb', 'Patio B'), delSitio]);
    eq('⭐ 1.3 A#5 general + del sitio con el mismo nombre → un solo campo, el del sitio', Array.isArray(unico) ? unico.map((p) => p.id) : unico, ['ps', 'pb']);
    const soloGeneral = llamar('patiosDeLista', [general, item('pb', 'Patio B')]);
    eq('1.3 A#5 * un patio general sin gemelo en el sitio sigue saliendo', Array.isArray(soloGeneral) ? soloGeneral.map((p) => p.id) : soloGeneral, ['pg', 'pb']);
    const gemeloInactivo = llamar('patiosDeLista', [general, { ...delSitio, activo: false }]);
    eq('1.3 A#5 * si el del sitio está desactivado, queda el general', Array.isArray(gemeloInactivo) ? gemeloInactivo.map((p) => p.id) : gemeloInactivo, ['pg']);
  }

  ok('⭐ 1.3 un renglón de patio: entrada sin transportista, origen, unidad ni placa', llamar('esRenglonDePatio', mov({ destino: 'Patio A', viajes: 3 })) === true);
  ok('1.3 * con transportista ya no lo es (es una pesada)', llamar('esRenglonDePatio', mov({ destino: 'Patio A', transportista: 'Transportista Uno' })) === false);
  ok('1.3 * con origen tampoco', llamar('esRenglonDePatio', mov({ destino: 'Patio A', origen: 'Frente Norte' })) === false);
  ok('1.3 * con unidad tampoco', llamar('esRenglonDePatio', mov({ destino: 'Patio A', unidadId: 'u1' })) === false);
  ok('1.3 * con placa tampoco', llamar('esRenglonDePatio', mov({ destino: 'Patio A', placa: 'AA000AA' })) === false);
  ok('1.3 * una salida tampoco', llamar('esRenglonDePatio', mov({ tipo: 'salida', destino: 'Patio A' })) === false);
  // L5-A1: una entrada de ✍️ Carga libre con detalle (unidad escrita, toneladas, material, hora, nota…) NO es de patio.
  ok('⭐ 1.3 L5-A1 * con la unidad escrita a mano tampoco (es de ✍️ Carga libre)', llamar('esRenglonDePatio', mov({ destino: 'Patio A', unidadTexto: 'U-07' })) === false);
  ok('1.3 L5-A1 * con toneladas tampoco (una pesada)', llamar('esRenglonDePatio', mov({ destino: 'Patio A', toneladas: 14 })) === false);
  ok('1.3 L5-A1 * con material, hora u observación tampoco',
    [{ material: 'Material X' }, { hora: '08:15' }, { observacion: 'Nota' }, { m3: 10 }, { capacidadM3: 12 }]
      .every((o) => llamar('esRenglonDePatio', mov({ destino: 'Patio A', ...o })) === false));
  ok('1.3 L5-A1 * es LA MISMA regla de la librería (parteDiario.ts la re-exporta)', !/function esRenglonDePatio/.test(fs.readFileSync(LIB, 'utf8')));

  const ps = Array.isArray(patios) ? patios : [];
  const movs = [
    mov({ id: '1', destino: 'Patio A', destinoId: 'pa', viajes: 120 }),
    mov({ id: '2', destino: ' PATIO B ', destinoId: null, viajes: 80 }),        // por nombre (sin mayúsculas ni espacios)
    mov({ id: '3', destino: 'Patio A', destinoId: null, viajes: 5 }),           // repetido: se suma
    mov({ id: '4', destino: 'Patio A', transportista: 'Transportista Uno', viajes: 9 }), // una pesada: no es de patio
    mov({ id: '5', destino: 'Patio Viejo', destinoId: 'x', viajes: 7 }),        // patio desactivado → «otros»
    mov({ id: '6', destino: 'Patio C', destinoId: 'otro-id', viajes: 11 }),     // apunta a OTRO ítem: no es el Patio C
    mov({ id: '7', tipo: 'salida', destino: 'Patio C', viajes: 4 }),
  ];
  const g = llamar('patiosGuardados', movs, ps);
  eq('⭐ 1.3 por patio: por id, por nombre y los repetidos SUMADOS; sin renglón = null', g?.porPatio, { pa: 125, pb: 80, pc: null });
  eq('1.3 * lo que no es patio de la lista va a «otros» (sin sumar)', g?.otros, [{ destino: 'Patio C', viajes: 11 }, { destino: 'Patio Viejo', viajes: 7 }]);
  eq('1.3 * un renglón con viajes por confirmar cuenta 0', llamar('patiosGuardados', [mov({ destino: 'Patio A', destinoId: 'pa', viajes: null })], ps)?.porPatio, { pa: 0, pb: null, pc: null });
  eq('1.3 * sin renglones: todos null', llamar('patiosGuardados', [], ps)?.porPatio, { pa: null, pb: null, pc: null });

  // ⭐ L5-A1: las entradas de ✍️ Carga libre hacia un patio NO van en su campo: se dicen APARTE, sin sumarse.
  const conCargaLibre = [
    ...movs,
    mov({ id: '8', destino: 'Patio A', destinoId: 'pa', unidadTexto: 'U-07', toneladas: 14, viajes: 1 }), // pesada a mano
    mov({ id: '9', destino: 'Patio A', destinoId: null, unidadTexto: 'U-08', toneladas: 15, viajes: 1 }), // por nombre
    mov({ id: '10', destino: 'patio b', origen: 'Frente Norte', viajes: 3 }),
    mov({ id: '11', destino: 'Patio A', unidadTexto: 'U-09', viajes: null, estado: 'por_confirmar' }), // sin viajes
    mov({ id: '12', destino: 'Destino Uno', unidadTexto: 'U-07', viajes: 2 }), // no va a un patio: ni se dice
    mov({ id: '13', tipo: 'salida', destino: 'Patio A', unidadTexto: 'U-07', viajes: 6 }), // no es una entrada
  ];
  const g2 = llamar('patiosGuardados', conCargaLibre, ps);
  eq('⭐ 1.3 L5-A1 los campos de los patios NO cambian con las entradas de Carga libre', g2?.porPatio, { pa: 125, pb: 80, pc: null });
  eq('1.3 L5-A1 * «otros» tampoco cambia', g2?.otros, [{ destino: 'Patio C', viajes: 11 }, { destino: 'Patio Viejo', viajes: 7 }]);
  eq('⭐ 1.3 L5-A1 * las de Carga libre hacia cada patio salen aparte (viajes y renglones)', g2?.cargaLibre,
    { pa: { viajes: 11, renglones: 4 }, pb: { viajes: 3, renglones: 1 } });
  eq('1.3 L5-A1 * sin ninguna: vacío', llamar('patiosGuardados', movs.slice(0, 3), ps)?.cargaLibre, {});
  eq('⭐ 1.3 L5-A1 la línea informativa: «+N viajes de ✍️ Carga libre» (no van en el campo ni se suman)',
    llamar('textoCargaLibrePatio', { viajes: 11, renglones: 4 }), '+11 viajes de ✍️ Carga libre hacia este patio (no van en este campo ni se suman)');
  eq('1.3 L5-A1 * uno', llamar('textoCargaLibrePatio', { viajes: 1, renglones: 1 }), '+1 viaje de ✍️ Carga libre hacia este patio (no va en este campo ni se suma)');
  eq('1.3 L5-A1 * solo renglones sin viajes', llamar('textoCargaLibrePatio', { viajes: 0, renglones: 2 }),
    '+2 renglones sin viajes de ✍️ Carga libre hacia este patio (no van en este campo)');
  eq('1.3 L5-A1 * sin nada: null', llamar('textoCargaLibrePatio', undefined), null);
}

// ——— 1.4 La suma y la comparación con el Reporte General (neutra) ———
{
  eq('1.4 la suma ignora vacíos', llamar('sumaPatios', [120, null, 80, undefined, 50]), 250);
  eq('1.4 * sin nada es 0', llamar('sumaPatios', []), 0);
  eq('⭐ 1.4 «Patios 250 · Reporte 238 · diferencia +12»', llamar('textoPatiosVsReporte', 250, 238, true), 'Patios 250 · Reporte 238 · diferencia +12');
  eq('1.4 * por debajo, con su signo', llamar('textoPatiosVsReporte', 230, 238, true), 'Patios 230 · Reporte 238 · diferencia −8');
  eq('1.4 * iguales: sin diferencia', llamar('textoPatiosVsReporte', 238, 238, true), 'Patios 238 · Reporte 238 · sin diferencia');
  eq('1.4 * con miles', llamar('textoPatiosVsReporte', 1250, 1240, true), 'Patios 1.250 · Reporte 1.240 · diferencia +10');
  eq('1.4 * sin reporte ese día', llamar('textoPatiosVsReporte', 250, null, false), 'Patios 250 · sin Reporte General de ese día');
  eq('1.4 * con reporte pero sin total de viajes', llamar('textoPatiosVsReporte', 250, null, true), 'Patios 250 · el Reporte General no trae el total de viajes');
  const textos = [[250, 238, true], [230, 238, true], [250, null, false]].map((a) => String(llamar('textoPatiosVsReporte', ...a)));
  ok('⭐ 1.4 la diferencia es información: nunca dice «error» ni «descuadre»', textos.every((t) => !/error|descuadr|falta|mal/i.test(t)), textos.join(' | '));
}

// ——— 1.5 Cifras y sello ———
{
  eq('1.5 viajes en texto', llamar('textoViajesRg', 1240), '1.240 viajes');
  eq('1.5 * uno', llamar('textoViajesRg', 1), '1 viaje');
  eq('1.5 * sin dato', llamar('textoViajesRg', null), '—');
  eq('1.5 toneladas con dos decimales', llamar('textoToneladasRg', 4321.09), '4.321,09 t');
  eq('1.5 * sin dato', llamar('textoToneladasRg', null), '—');
  eq('⭐ 1.5 el sello en hora de Caracas (UTC−4)', llamar('fechaHoraCaracas', '2026-10-24T23:05:00Z'), '24/10/2026 19:05');
  eq('1.5 * la madrugada UTC es el día anterior en Caracas', llamar('fechaHoraCaracas', '2026-10-25T02:30:00+00:00'), '24/10/2026 22:30');
  eq('1.5 * sin fecha: vacío', llamar('fechaHoraCaracas', null), '');
  eq('1.5 quién y cuándo lo pegó', llamar('textoSelloReporte', { creadoPor: 'Persona Uno', creadoAt: '2026-10-24T23:05:00Z', editadoPor: 'Persona Uno', editadoAt: '2026-10-24T23:05:00Z' }),
    'Pegado por Persona Uno el 24/10/2026 19:05');
  eq('⭐ 1.5 * y quién lo reemplazó después', llamar('textoSelloReporte', { creadoPor: 'Persona Uno', creadoAt: '2026-10-24T23:05:00Z', editadoPor: 'Persona Dos', editadoAt: '2026-10-25T11:10:00Z' }),
    'Pegado por Persona Uno el 24/10/2026 19:05 · reemplazado por Persona Dos el 25/10/2026 07:10');
  eq('1.5 * sin sello: vacío', llamar('textoSelloReporte', { creadoPor: null, creadoAt: null, editadoPor: null, editadoAt: null }), '');
}

// ═══════════════════════════ (2) CANDADOS SOBRE LAS PANTALLAS ═══════════════════════════

const existe = (r) => fs.existsSync(path.join(ROOT, r));
const leer = (r) => (existe(r) ? fs.readFileSync(path.join(ROOT, r), 'utf8') : '');

/** El código sin comentarios (respeta las cadenas): los candados no se engañan con un comentario. */
function sinComentarios(src) {
  let out = '';
  let i = 0;
  let cadena = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (cadena) {
      out += c;
      if (c === '\\') { out += d ?? ''; i += 2; continue; }
      if (c === cadena) cadena = null;
      i++;
      continue;
    }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') cadena = c;
    out += c;
    i++;
  }
  return out;
}
/** El cuerpo de `const nombre = …` hasta la próxima constante del mismo nivel. */
function cuerpoDe(src, nombre) {
  const i = src.search(new RegExp(`\\n  const ${nombre} = `));
  if (i < 0) return '';
  const j = src.slice(i + 1).search(/\n  const \w+ = |\n  \/\/ ── /);
  return j < 0 ? src.slice(i) : src.slice(i, i + 1 + j);
}

const TAB = `${DIR}/ParteDiarioTab.tsx`;
const RG = `${DIR}/BloqueReporteGeneral.tsx`;
const PAT = `${DIR}/BloquePatios.tsx`;
const PURO = `${DIR}/parteDiario.ts`;
const PANTALLA = 'src/screens/CentroOperacionesScreen.tsx';

ok('(2) existen ParteDiarioTab, BloqueReporteGeneral, BloquePatios y parteDiario.ts', [TAB, RG, PAT, PURO].every(existe), [TAB, RG, PAT, PURO].filter((r) => !existe(r)).join(', '));
const tabCrudo = leer(TAB);
const tab = sinComentarios(tabCrudo);
const rg = sinComentarios(leer(RG));
const pat = sinComentarios(leer(PAT));
const puro = sinComentarios(leer(PURO));
const pantalla = sinComentarios(leer(PANTALLA));

// ——— 2.1 La pestaña es la PRIMERA, y la carga libre la última ———
{
  const m = /const PESTANAS[^=]*=\s*\[([\s\S]*?)\];/.exec(pantalla);
  const claves = m ? [...m[1].matchAll(/key:\s*'(\w+)'/g)].map((x) => x[1]) : [];
  eq('⭐ 2.1 📅 Parte diario es la primera pestaña (la que se abre por defecto)', claves[0], 'parte');
  ok('2.1 * con la etiqueta «📅 Parte diario» y para Lectura en adelante', /\{\s*key:\s*'parte',\s*label:\s*'📅 Parte diario',\s*necesita:\s*'lectura'\s*\}/.test(pantalla));
  eq('⭐ 2.1 R26: «✍️ Carga libre» es la ÚLTIMA', claves[claves.length - 1], 'cargar');
  ok('2.1 * se llama «✍️ Carga libre» y sigue pidiendo escritura', /\{\s*key:\s*'cargar',\s*label:\s*'✍️ Carga libre',\s*necesita:\s*'escritura'\s*\}/.test(pantalla));
  ok('2.1 * ya no queda la etiqueta vieja «✍️ Cargar»', !/'✍️ Cargar'/.test(pantalla));
  eq('2.1 las demás pestañas siguen, en su orden', claves, ['parte', 'registros', 'flota', 'reportes', 'ajustes', 'cargar']);
  ok('2.1 la que se abre es la primera visible', /visibles\[0\]\?\.key/.test(pantalla));
  // Revisión final B-I4/B-I1: la fecha cambia por cambiarFechaParte (recuerda si estaba «en hoy»)
  // y la pestaña avisa lo que quedó sin guardar (alSinGuardarParte).
  ok('⭐ 2.1 la pantalla monta <ParteDiarioTab key={sitio.id} sitio={sitio} nivel={nivel} fecha={fechaParte} alCambiarFecha={cambiarFechaParte} alSinGuardar={alSinGuardarParte} />',
    /<ParteDiarioTab\s+key=\{sitio\.id\}\s+sitio=\{sitio\}\s+nivel=\{nivel\}\s+fecha=\{fechaParte\}\s+alCambiarFecha=\{cambiarFechaParte\}\s+alSinGuardar=\{alSinGuardarParte\}\s*\/>/.test(pantalla));
  ok('⭐ 2.1 L5-B2 la jornada del Parte diario vive en la PANTALLA (sobrevive al cambio de pestaña y de sitio) y nace en caracasBusinessToday()',
    /const \[fechaParte, setFechaParte\] = useState<string>\(\(\) => caracasBusinessToday\(\)\)/.test(pantalla));
  ok('2.1 * importado de components/centroOperaciones', /from '\.\.\/components\/centroOperaciones\/ParteDiarioTab'/.test(pantalla));
  ok('2.1 * y la carga libre sigue montada (ocultar no es eliminar)', /<CargarTab\s+key=\{sitio\.id\}/.test(pantalla));
}

// ——— 2.2 La jornada de arriba ———
{
  ok('⭐ 2.2 L5-B2 la pestaña RECIBE la jornada (no la guarda: se perdía al cambiar de pestaña)',
    /export function ParteDiarioTab\(\{ sitio, nivel, fecha, alCambiarFecha(, alSinGuardar)? \}: Props\)/.test(tab) && !/useState<string>\(\(\) => caracasBusinessToday\(\)\)/.test(tab));
  ok('2.2 con el calendario de la casa (DateField)', /<DateField\b/.test(tab) && /from '\.\.\/DateField'/.test(tab));
  ok('2.2 ◀ y ▶ mueven de a un día con moverJornada', /moverJornada\(fecha, -1, hoy\)/.test(tab) && /moverJornada\(fecha, 1, hoy\)/.test(tab));
  ok('2.2 ▶ se apaga en hoy (puedeAvanzar)', /disabled=\{!puedeAvanzar\(fecha, hoy\)\}/.test(tab));
  ok('⭐ 2.2 L5-B7 el calendario no deja elegir una jornada futura (maxISO) y elegirFecha topa en hoy',
    /<DateField value=\{fecha\} onChange=\{elegirFecha\} maxISO=\{hoy\} \/>/.test(tab)
    && /const elegirFecha = \(f: string\) => \{ if \(fechaValida\(f\)\) alCambiarFecha\(f > hoy \? hoy : f\); \};/.test(tab));
}

// ——— 2.3 Los siete bloques en el orden de su hoja ———
{
  const titulos = [...tab.matchAll(/<Bloque\s+titulo="([^"]+)"/g)].map((x) => x[1]);
  eq('⭐ 2.3 los bloques van en el orden de su hoja', titulos.map((t) => t.replace(/^\d+ · \S+ /, '')),
    ['Reporte General', 'Entrada por patio', 'Salidas de agregados', 'Acero', 'Aluminio y plástico', 'Maquinaria', 'Bloques']);
  ok('2.3 * numerados del 1 al 7', titulos.every((t, i) => t.startsWith(`${i + 1} · `)), titulos.join(' | '));
  ok('⭐ 2.3 plegar NO desmonta (display none, no un children condicional)', /display:\s*abierto\s*\?\s*'flex'\s*:\s*'none'/.test(tab) && !/\{abierto \? children/.test(tab));
  ok('⭐ 2.3 (L5-B14) Patios recibe el error del Reporte General y su Reintentar (no se queda «cargando…»)',
    /<BloquePatios\b[^>]*errorReporte=\{errorRg\}[^>]*alReintentarReporte=\{recargarReporte\}/.test(tab));
  ok('2.3 el bloque 1 monta BloqueReporteGeneral y el 2 BloquePatios, con la jornada', /<BloqueReporteGeneral\b[\s\S]*?fecha=\{fecha\}/.test(tab) && /<BloquePatios\b[^>]*fecha=\{fecha\}/.test(tab));
  ok('2.3 el Reporte General del día se carga UNA vez y llega a los dos bloques', /cargarReportesGenerales\(sitio\.id, fecha, fecha\)/.test(tab)
    && /guardado=\{reporteDelDia\}/.test(tab) && /reporte=\{reporteDelDia\}/.test(tab));
  ok('2.3 * refresca al enfocarse, con el objeto sitio y la jornada (no solo sitio.id)',
    /useFocusEffect\(useCallback\(\(\) => \{ recargarReporte\(\); \}, \[recargarReporte\]\)\)/.test(tab) && /\}, \[sitio, fecha\]\);/.test(cuerpoDe(tab, 'recargarReporte')));
  ok('2.3 * y una respuesta vieja no pisa a la nueva (secuenciaDePedidos)', /secuenciaDePedidos\(\)/.test(tab) && /if \(!pedidosRg\.vigente\(n\)\) return;/.test(cuerpoDe(tab, 'recargarReporte')));
}

// ——— 2.4 Los bloques de las otras partes del equipo, montados ———
// Salidas (3, 4 y 5), maquinaria (6) y bloques (7): cada uno con { sitio, nivel, fecha } y
// ya sin ninguna tarjeta «Lo arma otra parte del equipo».
{
  const props = 'sitio=\{sitio\} nivel=\{nivel\} fecha=\{fecha\}';
  const montado = (nombre, resto = '') => new RegExp(`<${nombre} ${props}${resto}`).test(tab);
  // Lote 5 B11: las tres salidas con UNA sola carga (useDatosSalidas en la pestaña), incrustadas (B18).
  ok('⭐ 2.4 L5-B11 las salidas se cargan UNA vez en la pestaña (useDatosSalidas) para los tres bloques',
    [...tab.matchAll(/useDatosSalidas\(/g)].length === 1 && /const salidas = useDatosSalidas\(sitio, fecha\);/.test(tab));
  ok('⭐ 2.4 bloques 3, 4 y 5 montados con { sitio, nivel, fecha } y los MISMOS datos, incrustados (agregados, acero, aluminio y plástico)',
    montado('SalidasAgregados', ' datos=\\{salidas\\} incrustado') && montado('SalidasAcero', ' datos=\\{salidas\\} incrustado') && montado('SalidasAluminioPlastico', ' datos=\\{salidas\\} incrustado'));
  ok('2.4 * las salidas se importan de ./BloqueSalidas', /import \{[^}]*SalidasAgregados[^}]*\} from '\.\/BloqueSalidas'/.test(tab));
  ok('⭐ 2.4 bloque 6 (maquinaria) y bloque 7 (bloques) montados con { sitio, nivel, fecha }',
    montado('BloqueMaquinaria') && montado('BloqueBloques'));
  // Lote 5 B10: los encabezados plegados dicen lo importante.
  ok('⭐ 2.4 L5-B10 el acero plegado dice cuántas esperan pesaje (resumenSalidas), con tono de aviso',
    /resumenSalidas\(datos\.delDia, datos\.pendientes, clase, sitioId\)/.test(tab) && /const resAcero = resumenDeSalidas\(salidas, 'acero', sitio\.id\);/.test(tab)
    && /<Bloque titulo="4 · 🔩 Acero" resumen=\{resAcero\.texto\} alerta=\{resAcero\.alerta\}/.test(tab));
  ok('⭐ 2.4 L5-B10 la maquinaria plegada dice «✅ n · 🔧 m» (y ⛔ ❔ ⚠️ si hay) con la regla del bloque (alConteo + textoConteoDelSitio corto)',
    /alConteo=\{setConteoMaq\}/.test(tab) && /textoConteoDelSitio\(conteoMaq, 'corto'\)/.test(tab) && !/conteoMaq\.disponibles/.test(tab));
  ok('2.4 * con alguna que no coincide con inspección, o sin verificar / sin dato (lote 6 B9), el encabezado va en tono de aviso',
    /const alertaMaq = \(conteoMaq\?\.noCoinciden \?\? 0\) > 0 \|\| \(conteoMaq\?\.sinVerificar \?\? 0\) > 0 \|\| \(conteoMaq\?\.sinDato \?\? 0\) > 0;/.test(tab) && /alerta=\{alertaMaq\}/.test(tab));
  ok('⭐ 2.4 M8 la pestaña recibe el grupo EFECTIVO de cada unidad (alEstados) y se lo pasa a las salidas con vehículo',
    /alEstados=\{setEstadosMaq\}/.test(tab) && /<SalidasAgregados\b[^>]*gruposUnidades=\{estadosMaq\}/.test(tab) && /<SalidasAcero\b[^>]*gruposUnidades=\{estadosMaq\}/.test(tab));
  ok('⭐ 2.4 L5-B10 y cada bloque dice «✏️ sin guardar» cuando quedó algo escrito', /✏️ sin guardar/.test(tab) && [...tab.matchAll(/alSinGuardar=\{marcar\.\w+\}/g)].length >= 5);
  ok("2.4 * se importan de ./BloqueMaquinaria y ./BloqueBloques",
    /import \{ BloqueMaquinaria \} from '\.\/BloqueMaquinaria'/.test(tab) && /import \{ BloqueBloques \} from '\.\/BloqueBloques'/.test(tab));
  ok('2.4 * ya no queda ninguna tarjeta pendiente (PorArmar)', !/PorArmar/.test(tabCrudo));
}

// ——— 2.4b Lote 5 B13 + A9 + B7: las reglas para guardar el Reporte General (puras) ———
{
  const RUTA_RGD = `${DIR}/reporteGeneralDelDia.ts`;
  let G = {};
  try { G = loadTs(path.join(ROOT, RUTA_RGD)); } catch (e) { ok(`2.4b carga ${RUTA_RGD}`, false, e.message); }
  const g = (fn, ...a) => (typeof G[fn] === 'function' ? (() => { try { return G[fn](...a); } catch (e) { return `«${fn}» lanzó: ${e.message}`; } })() : `«${fn}» no existe`);
  const vacio = { fecha: '2026-10-24', horaCorte: '19:00', jornada: '2026-10-24', viajesTotal: null, toneladasTotal: null, empresas: [], frentes: [], avisos: [], lineasNoLeidas: ['Reporte de otra cosa'] };
  eq('⭐ 2.4b B13: un texto del que solo se leyó la fecha NO es un Reporte General', g('reporteReconocido', vacio), false);
  eq('2.4b * con el total de viajes sí', g('reporteReconocido', { ...vacio, viajesTotal: 238 }), true);
  eq('2.4b * con las toneladas sí', g('reporteReconocido', { ...vacio, toneladasTotal: 4321.09 }), true);
  eq('2.4b * con alguna fila de empresa o de frente sí', [g('reporteReconocido', { ...vacio, empresas: [{ nombre: 'E', viajes: 1, toneladas: 2 }] }), g('reporteReconocido', { ...vacio, frentes: [{ nombre: 'F', viajes: 1, toneladas: 2 }] })], [true, true]);
  eq('2.4b * nada (null) tampoco revienta', g('reporteReconocido', null), false);

  eq('⭐ 2.4b A9/R28: el corte de las 07:00 de la jornada del 24 es el 25 a las 07:00', g('instanteDelCorte', '2026-10-24', '07:00'), '2026-10-25 07:00');
  eq('2.4b * el de las 19:00 es el mismo 24', g('instanteDelCorte', '2026-10-24', '19:00'), '2026-10-24 19:00');
  eq('2.4b * el de las 06:00 también es del día siguiente', g('instanteDelCorte', '2026-10-24', '06:00'), '2026-10-25 06:00');
  eq('2.4b * sin hora o sin fecha válida: null', [g('instanteDelCorte', '2026-10-24', null), g('instanteDelCorte', 'basura', '19:00')], [null, null]);

  const guardado = { fecha: '2026-10-24', horaCorte: '07:00', viajesTotal: 238, toneladasTotal: 4321.09 };
  const nuevoTarde = { jornada: '2026-10-24', horaCorte: '19:00', viajesTotal: null, toneladasTotal: null };
  const t = g('textoReemplazo', guardado, nuevoTarde);
  ok('⭐ 2.4b B13: la confirmación dice qué hay guardado (corte, viajes, t)', typeof t === 'string' && t.includes('Guardado: corte 07:00 del 25/10/2026') && t.includes('238 viajes') && t.includes('4.321,09 t'), t);
  ok('⭐ 2.4b * y qué entra (sin cifras: «—»)', typeof t === 'string' && t.includes('Nuevo: corte 19:00 del 24/10/2026') && t.includes('— viajes') && t.includes('— t'), t);
  ok('⭐ 2.4b A9: y que el nuevo es de un corte ANTERIOR (un corte anterior no pisa al de las 07:00 sin decirlo)', typeof t === 'string' && /ANTERIOR/.test(t), t);
  const t2 = g('textoReemplazo', { ...guardado, horaCorte: '19:00' }, { ...nuevoTarde, horaCorte: '07:00', viajesTotal: 250, toneladasTotal: 4400 });
  ok('2.4b * un corte POSTERIOR no lleva la advertencia', typeof t2 === 'string' && !/ANTERIOR/.test(t2) && t2.includes('250 viajes'), t2);

  eq('⭐ 2.4b B7: una jornada posterior a hoy es futura', [g('jornadaFutura', '2026-10-26', '2026-10-25'), g('jornadaFutura', '2026-10-25', '2026-10-25'), g('jornadaFutura', '2026-10-01', '2026-10-25')], [true, false, false]);
  eq('2.4b * sin jornada no es futura', g('jornadaFutura', null, '2026-10-25'), false);
  const rgd = sinComentarios(leer(RUTA_RGD));
  ok('2.4b el archivo es puro: sin React ni la capa de datos', rgd !== '' && !/from 'react/.test(rgd) && !/centroOperacionesDb|supabase/.test(rgd));
}

// ——— 2.5 El Reporte General ———
{
  ok('⭐ 2.5 se lee con leerReporteGeneral (y reporteCuadra)', /leerReporteGeneral\(texto\)/.test(rg) && /reporteCuadra\(/.test(rg) && /from '\.\.\/\.\.\/lib\/centroOperacionesReporteGeneral'/.test(rg));
  ok('2.5 el campo grande pide pegar el Reporte General de WhatsApp', /PEGA AQUÍ EL REPORTE GENERAL DE WHATSAPP/.test(rg) && /multiline/.test(rg) && /Pega aquí el Reporte General de WhatsApp/.test(rg));
  ok('2.5 con el botón «Leer»', /🔎 Leer/.test(rg));
  ok('2.5 muestra los avisos y las líneas que no se leyeron', /leido\.r\.avisos/.test(rg) && /leido\.r\.lineasNoLeidas/.test(rg) && /Líneas que no se leyeron/.test(rg));
  ok('2.5 muestra las tablas de empresas y frentes con viajes y t', /titulo="Por empresa"/.test(rg) && /titulo="Por frente"/.test(rg) && />Viajes</.test(rg) && />t</.test(rg));
  const g = cuerpoDe(rg, 'guardar');
  ok('⭐ 2.5 guarda con guardarReporteGeneral(sitio.id, leido.r, leido.texto)', /await guardarReporteGeneral\(sitio\.id, leido\.r, leido\.texto\)/.test(g), g.slice(0, 120));
  const iBuscar = g.indexOf('cargarReportesGenerales(sitio.id, jornada, jornada)');
  const iPregunta = g.indexOf('Ya hay un Reporte General de ese día: ¿reemplazarlo?');
  const iGuardar = g.indexOf('await guardarReporteGeneral(');
  ok('⭐ 2.5 antes de guardar le pregunta a la base si ya hay uno de ESA jornada', iBuscar > 0 && iBuscar < iGuardar);
  ok('⭐ 2.5 * y si lo hay, confirma «Ya hay un Reporte General de ese día: ¿reemplazarlo?»', iPregunta > iBuscar && iPregunta < iGuardar && /await confirm\(/.test(g));
  ok('2.5 * si no confirma, no guarda (return)', /if \(!ok\) \{ setGuardando\(false\); return; \}/.test(g));
  ok('2.5 sin la fecha de corte no se guarda', /if \(!jornada\)/.test(g) && /No se encontró la fecha de corte/.test(rg));
  ok('2.5 si el texto cambió después de leerlo, hay que volver a leer', /textoCambio/.test(g) && /toca «Leer» otra vez/.test(rg));
  // Lo pegado no se pierde: el catch no limpia el texto, y se limpia solo después del éxito.
  const catchG = /catch\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/.exec(g)?.[1] ?? '';
  ok('⭐ 2.5 si la base rechaza, lo pegado sigue (el catch no limpia y sale con return)', catchG !== '' && !/setTexto\(/.test(catchG) && !/setLeido\(null\)/.test(catchG) && /return;/.test(catchG), catchG.trim().slice(0, 160));
  ok('2.5 * y el aviso queda escrito en el bloque (no solo el toast)', /setErrorGuardar\(/.test(catchG) && /toast\.error\(/.test(catchG));
  const iLimpia = g.indexOf("setTexto('')");
  ok('2.5 el texto se limpia recién después de guardar con éxito', iLimpia > iGuardar && iLimpia > g.indexOf(catchG));
  ok('⭐ 2.5 si es de otra jornada se dice y se ofrece cambiar la fecha', /avisoJornadaDistinta\(/.test(rg) && /alCambiarFecha\(jornadaLeida\)/.test(rg) && /Cambiar arriba a la jornada del/.test(rg));
  ok('2.5 lo guardado muestra quién y cuándo', /textoSelloReporte\(guardado\)/.test(rg));
  const b = cuerpoDe(rg, 'borrar');
  ok('⭐ 2.5 🗑️ Borrar solo Full, con confirmación', /!esFull/.test(b) && /await confirm\(/.test(b) && /borrarReporteGeneral\(guardado\.id\)/.test(b) && /const esFull = nivel === 'full'/.test(rg));
  ok('2.5 pegar y guardar piden escritura', /levelMeets\(nivel, 'escritura'\)/.test(rg) && /\{puedeEscribir \? \(/.test(rg));

  // ——— Lote 5 (F1b): B13 + A9, B7, B12 y B10 en el Reporte General ———
  ok('⭐ 2.5 L5-B13 no se guarda un texto del que solo se leyó la fecha (reporteReconocido, en el botón y al guardar)',
    /reporteReconocido\(leido\.r\)/.test(rg) && /if \(!reporteReconocido\(leido\.r\)\)/.test(g) && /No se reconoció un Reporte General/.test(rg)
    && /const puedeGuardar = [^;]*reconocido/.test(rg));
  ok('⭐ 2.5 L5-B13/A9 la confirmación de reemplazo dice lo guardado y lo nuevo, con sus cortes (textoReemplazo)',
    /textoReemplazo\(existentes\[0\], \{ jornada, horaCorte: leido\.r\.horaCorte, viajesTotal: leido\.r\.viajesTotal, toneladasTotal: leido\.r\.toneladasTotal \}\)/.test(g));
  ok('⭐ 2.5 L5-B7 un reporte con la jornada posterior a hoy no se guarda (ni se ofrece llevar la fecha allí)',
    /if \(jornadaFutura\(jornada, hoy\)\)/.test(g) && /posterior a hoy/.test(rg) && /distinta && avisoOtra && jornadaLeida && !futura/.test(rg));
  ok('⭐ 2.5 L5-B12 si no se pudo cargar lo guardado: «🔄 Reintentar» y cómo en el teléfono',
    /🔄 Reintentar/.test(rg) && /toca Reintentar \(o desliza hacia abajo en el teléfono\)/.test(rg) && /onPress=\{alCambiar\}/.test(rg));
  ok('2.5 L5-B10 avisa a la pestaña si quedó algo pegado sin guardar (alSinGuardar)', /alSinGuardar\?\.\(/.test(rg));
}

// ——— 2.6 Los patios ———
{
  const g = cuerpoDe(pat, 'guardar');
  ok('⭐ 2.6 «Guardar patios» llama a guardarPatiosDelDia(sitio.id, …, cambios)', /await guardarPatiosDelDia\(sitio\.id, delaFecha, cambios\)/.test(g));
  ok('2.6 * con el botón «Guardar patios»', /Guardar patios/.test(pat));
  ok('⭐ 2.6 un campo por patio de la lista terraza (patiosDeLista), mostrado como «Patio»', /patiosDeLista\(listas\)/.test(pat) && /lista de patios/.test(pat));
  ok('2.6 sin patios: indica crearlos en ⚙️ Ajustes', /Este sitio todavía no tiene patios/.test(pat) && /⚙️ Ajustes/.test(pat));
  ok('⭐ 2.6 la suma y la diferencia salen de textoPatiosVsReporte con el total del reporte del día', /textoPatiosVsReporte\(suma, reporte\?\.viajesTotal \?\? null, !!reporte\)/.test(pat));
  ok('2.6 la diferencia se explica como información, no como error', /es información, no un error/.test(pat));
  ok('⭐ 2.6 no se guarda hasta que lo guardado de ESE día esté a la vista', /if \(!listo\)/.test(g) && /delDia\.fecha === fecha/.test(pat));
  ok('2.6 solo viaja lo que ella cambió (los patios tocados y distintos de lo guardado)', /const cambios: PatioDelDia\[\] = lecturas\s*\.filter\(\(x\) => x\.patio\.id in misEditados/.test(pat));
  ok('2.6 los viajes se leen con la regla de la casa (viajesDeCampo)', /viajesDeCampo\(/.test(pat));
  const catchP = /catch\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/.exec(g)?.[1] ?? '';
  ok('⭐ 2.6 si la base rechaza, lo escrito sigue y se vuelve a leer lo guardado', catchP !== '' && !/setEditados\(/.test(catchP) && /recargar\(\)/.test(catchP) && /setErrorGuardar\(/.test(catchP), catchP.trim().slice(0, 160));
  const iExito = g.indexOf(catchP) + catchP.length;
  ok('2.6 lo tecleado se quita recién después de guardar con éxito (y solo lo que se mandó)',
    catchP !== '' && g.indexOf('setEditados(', iExito) > iExito && /const enviados = \{ \.\.\.misEditados \}/.test(g) && /actuales\[id\] === txt/.test(g));
  ok('2.6 refresca al enfocarse con el objeto sitio y la jornada', /useFocusEffect\(useCallback\(\(\) => \{ recargar\(\); \}, \[recargar\]\)\)/.test(pat) && /\}, \[sitio, fecha\]\);/.test(cuerpoDe(pat, 'recargar')));
  ok('2.6 * y una respuesta vieja no pisa a la nueva', /if \(!pedidos\.vigente\(n\)\) return;/.test(cuerpoDe(pat, 'recargar')));
  ok('2.6 cambiar los patios pide escritura', /levelMeets\(nivel, 'escritura'\)/.test(pat) && /\{puedeEscribir \? \(/.test(pat));

  // ——— Lote 5 (F1a): B12, B14, B15, A1 y A5 en la pantalla de patios ———
  ok('⭐ 2.6 L5-B15 la ayuda nombra la pastilla de hoy «⛰️ Patios» (ya no «Terrazas»)', !/Terraza/i.test(pat) && /⛰️ Patios/.test(pat));
  ok('⭐ 2.6 L5-B12 junto al error de carga hay «🔄 Reintentar» que vuelve a cargar los patios',
    /🔄 Reintentar/.test(pat) && /onPress=\{\(\) => \{ recargar\(\); \}\}/.test(pat));
  ok('2.6 L5-B12 * el texto sirve en web: «toca Reintentar (o desliza hacia abajo en el teléfono)»',
    /toca Reintentar \(o desliza hacia abajo en el teléfono\)/.test(pat) && !/desliza hacia abajo para intentar de nuevo/.test(pat));
  ok('⭐ 2.6 L5-B14 recibe el error del Reporte General (errorReporte) y lo dice en vez de «cargando…» sin fin',
    /errorReporte\?: string \| null/.test(pat) && /no se pudo cargar el Reporte General/.test(pat)
    && pat.indexOf('no se pudo cargar el Reporte General') < pat.indexOf('cargando el Reporte General'));
  ok('2.6 L5-B14 * con su «🔄 Reintentar» cuando la pantalla le da cómo (alReintentarReporte)', /alReintentarReporte\?: \(\) => void/.test(pat) && /alReintentarReporte\(\)/.test(pat));
  ok('⭐ 2.6 L5-A1 debajo de cada patio, lo anotado en ✍️ Carga libre hacia él, aparte (textoCargaLibrePatio)',
    /textoCargaLibrePatio\(guardados\.cargaLibre\[patio\.id\]\)/.test(pat));
  ok('2.6 L5-A5 si falla, dice que se volvió a leer lo guardado y que lo que no entró sigue escrito',
    /Se volvió a leer lo guardado/.test(cuerpoDe(pat, 'guardar')));
}

// ——— 2.7 Aislamiento: ningún componente habla con la base ———
for (const [nombre, src] of [['ParteDiarioTab', tab], ['BloqueReporteGeneral', rg], ['BloquePatios', pat], ['parteDiario.ts', puro]]) {
  ok(`⭐ 2.7 ${nombre} no nombra supabase ni arma consultas (.from( / .rpc( / selectAllRows)`, src !== '' && !/supabase/i.test(src) && !/\.from\(\s*['"`]/.test(src) && !/\.rpc\(/.test(src) && !/selectAllRows/.test(src));
}
ok('2.7 parteDiario.ts es puro: no importa React ni la capa de datos', !/from 'react/.test(puro) && !/centroOperacionesDb/.test(puro));
ok('2.7 los bloques piden y guardan por centroOperacionesDb', /from '\.\.\/\.\.\/lib\/centroOperacionesDb'/.test(rg) && /from '\.\.\/\.\.\/lib\/centroOperacionesDb'/.test(pat));

console.log(`${fail === 0 ? '✅' : '❌'} test-centro-operaciones-parte-diario · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('El Parte diario abre primero: Reporte General pegado y leído, patios con su diferencia, salidas, maquinaria y bloques.');
