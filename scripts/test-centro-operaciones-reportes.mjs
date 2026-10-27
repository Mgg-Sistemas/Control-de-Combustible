// 🏭 CENTRO DE OPERACIONES — CANDADOS DE 📄 REPORTES (24-oct-2026).
//
// La pestaña 📄 Reportes convierte los renglones del sitio en los tres papeles
// (consolidado, corte por unidad y listado) con todas sus opciones. Dos partes:
//
//   1. LA LIBRERÍA PURA `src/lib/centroOperacionesReportes.ts` (se carga y se
//      prueba de verdad): rango y hora de corte validados, el rótulo del corte
//      sacado del MOMENTO REAL (jornada de 7am a 7am), textos fijos y logos de
//      cop_ajustes, la memoria del equipo, el aviso de lo apagado (solo en
//      pantalla) y el armado completo de los tres papeles con UNA sola regla de
//      pertenencia a la unidad (`unidadDeLosRenglones` armada con la lista base).
//   2. LOS COMPONENTES (`ReportesTab.tsx`, `EditorResumen.tsx`): candados
//      ESTÁTICOS sobre su texto sin comentarios — `pdfDocument` con
//      `marcaTexto: false`, los logos y la emisión de las opciones; el nombre del
//      PDF de `nombreArchivoCop`; la memoria `cop_opciones_<papel>` dentro de
//      try/catch; `edicionAlCambiarDeDia` al cambiar el rango; ninguna escritura
//      salvo `guardarAjuste` (el botón «Guardar como texto fijo», solo Full).
//
// ⭐ Todos los datos son SINTÉTICOS (el repositorio es público).
//
//   node scripts/test-centro-operaciones-reportes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

// El mismo cargador de scripts/test-reporte-personalizado.mjs: transpila el .ts
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

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? '  -> ' + extra : ''}`); }
};
/** Corre `fn` y, si revienta (p. ej. la función todavía no existe), cuenta la falla en vez de abortar. */
const intenta = (name, fn, siFalla = null) => {
  try { return fn(); } catch (e) { fail++; failures.push(`✗ ${name}\n    reventó: ${e && e.message}`); return siFalla; }
};

const existe = (r) => fs.existsSync(path.join(ROOT, r));
const leer = (r) => (existe(r) ? fs.readFileSync(path.join(ROOT, r), 'utf8') : '');

/**
 * El código sin comentarios (`// …` y `/* … *\/`, también los `{/* … *\/}` de JSX).
 * Respeta las cadenas: un «//» dentro de comillas no corta la línea.
 * (Copia del de scripts/test-centro-operaciones-ajustes-flota.mjs.)
 */
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

/** El texto de la llamada `nombre(…)` que empieza en `desde`, con sus paréntesis balanceados. */
function llamada(src, nombre, desde = 0) {
  const i = src.indexOf(`${nombre}(`, desde);
  if (i < 0) return '';
  let nivel = 0;
  for (let j = i + nombre.length; j < src.length; j++) {
    if (src[j] === '(') nivel++;
    else if (src[j] === ')') { nivel--; if (nivel === 0) return src.slice(i, j + 1); }
  }
  return '';
}

console.log('🏭 CENTRO DE OPERACIONES · 📄 REPORTES\n');

ok('(*) el quitacomentarios borra // y /* */ pero respeta las cadenas',
  sinComentarios("a // update(\nb /* .insert( */ c 'http://x'") === "a \nb  c 'http://x'");

// ═══════════════════════════ 1. LA LIBRERÍA PURA ═══════════════════════════

const SRC_LIB = 'src/lib/centroOperacionesReportes.ts';
ok('existe src/lib/centroOperacionesReportes.ts', existe(SRC_LIB));
const R = existe(SRC_LIB) ? intenta('cargar centroOperacionesReportes.ts', () => loadTs(path.join(ROOT, SRC_LIB)), {}) : {};
const L = loadTs(path.join(ROOT, 'src/lib/centroOperaciones.ts'));
const P = loadTs(path.join(ROOT, 'src/lib/centroOperacionesPapel.ts'));
const F = loadTs(path.join(ROOT, 'src/lib/frentesReporte.ts'));

// La librería es PURA: ni React, ni Supabase, ni el almacenamiento del equipo.
{
  const libTxt = sinComentarios(leer(SRC_LIB));
  const imports = [...libTxt.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  ok('1.0 la librería solo importa librerías puras del módulo y de la casa',
    imports.length > 0 && imports.every((x) => ['./centroOperaciones', './centroOperacionesPapel', './centroOperacionesCarga', './centroOperacionesReporteCompleto', './frentesReporte', './text'].includes(x)),
    imports.join(', '));
  ok('1.0 * y no nombra el prefijo de las tablas (se queda fuera del candado de aislamiento)', !/(?<![a-z0-9])cop_/i.test(leer(SRC_LIB)));
}

for (const nombre of [
  'validarRango', 'avisoCorte', 'opcionesIniciales', 'cambiosTextosFijos', 'memoriaParaGuardar', 'memoriaLeida',
  'apagadoEnPalabras', 'opcionesUnidadCorte', 'armarPapelCop', 'filtrosDelPapel',
  'alternarSeccion', 'alternarColumna', 'alternarOcultoResumen', 'escribirEnResumen',
  'agregarTarjetaPropia', 'cambiarTarjetaPropia', 'quitarTarjetaPropia',
]) ok(`1.1 exporta ${nombre}()`, typeof R[nombre] === 'function');
// ⭐ A3 = B7 (lote 4): UNA sola fuente de cada regla. El rótulo del corte, el período,
//    el subtítulo, la emisión escapada, los textos fijos/logos y la pertenencia del
//    corte son de la librería de cálculo y de la de papeles: acá ya no hay copias.
for (const copia of ['corteEnPalabras', 'periodoEnPalabras', 'subtituloReporte', 'emitidaPdf', 'textosFijosDe', 'logosDe', 'renglonesConUnidad', 'sitioParaArchivo']) {
  ok(`⭐ A3 la librería de reportes ya no tiene su copia de ${copia}()`, !(copia in R));
}
{
  const libTxt = sinComentarios(leer(SRC_LIB));
  ok('⭐ A3 sin reglas propias de hora ni de fecha (horaLegible/corteReal/fechaValida son de las librerías)', !/function\s+(horaLegible|corteReal|fechaValida)\b/.test(libTxt));
  ok('⭐ A3 la regla de pertenencia va DENTRO del op del corte (unidadDe), sin reescribir unidadId', /cortePorUnidad\([^;]*unidadDe\b/.test(libTxt.replace(/\s+/g, ' ')) && !/unidadId:\s*unidadDe/.test(libTxt));
  ok('⭐ A3 el resumen del consolidado recibe el MISMO op (sigue a las columnas apagadas)', /resumenConsolidado\(\s*m\s*,\s*op\b/.test(libTxt));
}
eq('1.1 hasta 6 tarjetas propias', R.MAX_TARJETAS_PROPIAS_COP, 6);
eq('⭐ PD5b 1.1 los cuatro papeles, en orden: el Reporte completo PRIMERO', (R.PAPELES_COP ?? []).map((p) => p.k), ['completo', 'consolidado', 'corte', 'listado']);

// ——— Datos sintéticos ———
let seq = 0;
const mov = (o = {}) => ({
  id: `m${++seq}`, sitioId: 's1', fecha: '2026-10-06', hora: null, tipo: 'entrada',
  unidadId: null, unidadTexto: '', placa: null,
  transportista: null, transportistaId: null, origen: null, origenId: null,
  destino: null, destinoId: null, material: null, materialId: null,
  capacidadM3: null, viajes: 1, toneladas: null, m3: null, estado: 'confirmado',
  observacion: null, creadoPor: null, creadoAt: null, editadoPor: null, editadoAt: null,
  ...o,
});
const unidad = (o = {}) => ({
  id: 'u0', sitioId: 's1', origen: 'propia', machineryId: null, codigo: '', descripcion: null, placa: null,
  serial: null, marca: null, modelo: null, dueno: null, capacidadM3: null, activo: true, nota: null, ...o,
});
const U1 = { unidadId: 'u1', unidadTexto: 'U-1', placa: 'TST-001' };
const U2 = { unidadId: 'u2', unidadTexto: 'U-2', placa: 'TST-002' };
const FLOTA = [
  unidad({ id: 'u1', codigo: 'U-1', descripcion: 'Volteo sintético', placa: 'TST-001', capacidadM3: 18 }),
  unidad({ id: 'u2', codigo: 'U-2', placa: 'TST-002', capacidadM3: 24 }),
  unidad({ id: 'u3', codigo: 'U-3', descripcion: 'Volteo sin viajes', placa: 'TST-003' }),
  unidad({ id: 'u4', codigo: 'U-4', placa: 'TST-004', activo: false }),
];
const BASE = [
  mov({ fecha: '2026-10-06', hora: '08:10', transportista: 'Transportista A', origen: 'Frente 1', viajes: 4, toneladas: 92.4 }),
  mov({ fecha: '2026-10-07', transportista: 'Transportista B', origen: 'Frente 2', viajes: 3, toneladas: 70.2 }),
  mov({ ...U1, tipo: 'interno', fecha: '2026-10-06', origen: 'Terraza 1', destino: 'Terraza 2', capacidadM3: 18, viajes: 5 }),
  mov({ ...U2, tipo: 'interno', fecha: '2026-10-07', origen: 'Terraza 2', destino: 'Terraza 3', capacidadM3: 24, viajes: 2 }),
  mov({ ...U1, tipo: 'salida', fecha: '2026-10-07', material: 'Triturado', destino: 'Destino X', capacidadM3: 18, viajes: 2, observacion: '<b>x</b> & "y"' }),
  // Un renglón SUELTO (sin vincular) con la placa de U-1: es de U-1 en los tres papeles.
  mov({ tipo: 'salida', fecha: '2026-10-08', unidadTexto: 'volteo uno', placa: 'tst-001', material: 'Arena', destino: 'Destino Y', capacidadM3: 18, viajes: 3 }),
  // De madrugada: 05:30 de la jornada del 08 es el 09 a las 05:30.
  mov({ ...U2, tipo: 'salida', fecha: '2026-10-08', hora: '05:30', material: 'Arena', destino: 'Destino Y', capacidadM3: 24, viajes: 1 }),
  // Vinculado a U-1 pero SIN placa: solo la lista BASE (el renglón de Triturado) dice
  // que «TST-001» es de U-1. Filtrando solo Arena, una regla armada con lo filtrado
  // separaría el suelto de este; la armada con la base los junta.
  mov({ unidadId: 'u1', unidadTexto: 'U-1', placa: null, tipo: 'salida', fecha: '2026-10-08', material: 'Arena', destino: 'Destino Y', capacidadM3: 18, viajes: 1 }),
];
const RANGO = { desde: '2026-10-06', hasta: '2026-10-08', corteHora: null };
const DEF = P.OPCIONES_PAPEL_POR_DEFECTO;
const op = (c = {}) => ({ ...DEF, ocultosSecciones: [], ocultosColumnas: [], logos: { ...DEF.logos }, ...c });

// ——— 1.2 El rango y la hora de corte ———
{
  const v = intenta('validarRango', () => R.validarRango({ desde: '2026-10-06', hasta: '2026-10-08', corte: '' }), {});
  eq('1.2 rango bueno, sin hora: sin errores', v.errores, []);
  eq('1.2 * y el rango sale tal cual, sin hora', v.rango, { desde: '2026-10-06', hasta: '2026-10-08', corteHora: null });
  const h = intenta('validarRango', () => R.validarRango({ desde: '2026-10-06', hasta: '2026-10-08', corte: '7:05' }), {});
  eq('1.2 «7:05» se entiende como 07:05', h.rango && h.rango.corteHora, '07:05');
  for (const mala of ['25:00', '12:60', 'siete', '24:00']) {
    const x = intenta('validarRango', () => R.validarRango({ desde: '2026-10-06', hasta: '2026-10-08', corte: mala }), {});
    ok(`1.2 hora de corte «${mala}» → error y sin rango`, (x.errores ?? []).length === 1 && x.rango === null && /00:00 a 23:59/.test(x.errores[0]), JSON.stringify(x));
  }
  const rev = intenta('validarRango', () => R.validarRango({ desde: '2026-10-09', hasta: '2026-10-08', corte: '' }), {});
  ok('1.2 «desde» después de «hasta» → error', rev.rango === null && (rev.errores ?? []).some((e) => /desde/i.test(e)), JSON.stringify(rev));
  const basura = intenta('validarRango', () => R.validarRango({ desde: '2026-02-30', hasta: '9999-12-31', corte: '' }), {});
  ok('1.2 fechas que no existen o centinelas «sin fin» → error', basura.rango === null && (basura.errores ?? []).length >= 2, JSON.stringify(basura));
  const largo = intenta('validarRango', () => R.validarRango({ desde: '2025-01-01', hasta: '2026-10-08', corte: '' }), {});
  ok('1.2 más de un año → error (no se arma un papel de años)', largo.rango === null && (largo.errores ?? []).some((e) => /366/.test(e)), JSON.stringify(largo));
  const medio = intenta('validarRango', () => R.validarRango({ desde: '2026-07-01', hasta: '2026-10-08', corte: '' }), {});
  ok('1.2 rango de 100 días → sale, pero con aviso', !!medio.rango && typeof medio.aviso === 'string' && /100 días/.test(medio.aviso), JSON.stringify(medio));
  eq('1.2 rango corto → sin aviso', v.aviso, null);
}

// ——— 1.3 El rótulo del corte sale del MOMENTO REAL (jornada 7am–7am) ———
// ⭐ A3: lo dicen `corteCop` (librería de cálculo) y `periodoCop` (papeles); el armado
//    de los papeles los usa a ellos, sin copia propia.
{
  const tarde = { desde: '2026-10-06', hasta: '2026-10-08', corteHora: '19:00' };
  const madrugada = { desde: '2026-10-06', hasta: '2026-10-08', corteHora: '05:00' };
  const fichaCons = (r) => intenta('armarPapelCop', () => R.armarPapelCop({ papel: 'consolidado', sitio: 'Sitio 1', base: [], rango: r, filtros: {}, op: op(), edicion: null }).cuerpo, '');
  ok('1.3 consolidado, corte 19:00 → ese mismo día (corteCop)', fichaCons(tarde).includes(`<b>Corte:</b> ${L.corteCop(tarde)}`) && L.corteCop(tarde) === '08/10/2026, 07:00 p. m.');
  ok('⭐ 1.3 consolidado, corte 05:00 → el día calendario SIGUIENTE (la jornada termina a las 7am)', fichaCons(madrugada).includes('<b>Corte:</b> 09/10/2026, 05:00 a. m.'), fichaCons(madrugada).slice(0, 300));
  ok('1.3 consolidado sin hora → la jornada «hasta»', fichaCons(RANGO).includes('<b>Corte:</b> 08/10/2026<'));
  eq('⭐ 1.3 período con corte de madrugada nombra el día real (periodoCop)', P.periodoCop(madrugada), 'del 06/10/2026 al 08/10/2026, corte el 09/10/2026 a las 05:00 a. m.');
  ok('1.3 avisoCorte con corte de tarde: el mismo día y la hora', (intenta('avisoCorte', () => R.avisoCorte(tarde), '') ?? '').includes('08/10/2026, 07:00 p. m.'));
  ok('1.3 el aviso en pantalla explica la madrugada', /09\/10\/2026/.test(intenta('avisoCorte', () => R.avisoCorte(madrugada), '') ?? '') && /7am a 7am/.test(R.avisoCorte?.(madrugada) ?? ''));
  eq('1.3 sin hora no hay aviso', intenta('avisoCorte', () => R.avisoCorte(RANGO)), null);
  // ⭐ R33 (revisión final A#2): un corte a las 07:00 EN PUNTO cierra la jornada «hasta»
  //    (como el Reporte General, R28): el consolidado, el aviso y el archivo dicen el día
  //    siguiente, y el papel suma la jornada entera.
  const siete = { desde: '2026-10-06', hasta: '2026-10-08', corteHora: '07:00' };
  ok('⭐ 1.3 R33 consolidado, corte 07:00 → el día calendario SIGUIENTE', fichaCons(siete).includes('<b>Corte:</b> 09/10/2026, 07:00 a. m.'), fichaCons(siete).slice(0, 300));
  ok('⭐ 1.3 R33 el aviso del corte de las 07:00 dice el día siguiente y por qué', /09\/10\/2026, 07:00 a\. m\./.test(intenta('avisoCorte', () => R.avisoCorte(siete), '') ?? '') && /7am a 7am/.test(R.avisoCorte?.(siete) ?? ''));
  {
    // 50 viajes por patio (sin hora) y dos de ✍️ Carga libre (10:00 y 05:00 de la madrugada).
    const J = [
      mov({ fecha: '2026-10-08', hora: null, viajes: 50 }),
      mov({ fecha: '2026-10-08', hora: '10:00', viajes: 3 }),
      mov({ fecha: '2026-10-08', hora: '05:00', viajes: 2 }),
    ];
    const renglones = (corteHora) => intenta('armarPapelCop', () => R.armarPapelCop({ papel: 'consolidado', sitio: 'Sitio 1', base: J, rango: { ...siete, corteHora }, filtros: {}, op: op(), edicion: null }, { conCuerpo: false }).renglones, null);
    eq('⭐ 1.3 R33 06:59 y 07:00 entran los mismos renglones: la jornada entera (antes 3 contra 1)', [renglones('06:59'), renglones('07:00')], [3, 3]);
  }
}

// ——— 1.4 Subtítulo y emisión (escapados: pdfDocument los pega tal cual) ———
{
  const arm = (o, r = { desde: '2026-10-08', hasta: '2026-10-08', corteHora: '05:00' }, sitio = 'Sitio 1') =>
    intenta('armarPapelCop', () => R.armarPapelCop({ papel: 'consolidado', sitio, base: [], rango: r, filtros: {}, op: o, edicion: null }), {});
  eq('1.4 subtítulo automático: sitio · período real (subtituloCop)', arm(op()).subtitulo, 'Sitio 1 · 08/10/2026, corte el 09/10/2026 a las 05:00 a. m.');
  eq('1.4 * es exactamente el de la librería de papeles', arm(op()).subtitulo, P.subtituloCop('consolidado', 'Sitio 1', { desde: '2026-10-08', hasta: '2026-10-08', corteHora: '05:00' }, op()));
  eq('1.4 subtítulo escrito: literal y escapado', arm(op({ subtitulo: ' <b>Mío</b> & ya ' }), RANGO).subtitulo, '&lt;b&gt;Mío&lt;/b&gt; &amp; ya');
  eq('1.4 sitio con <, > se escapa también', arm(op(), { desde: '2026-10-08', hasta: '2026-10-08' }, 'S<1>').subtitulo, 'S&lt;1&gt; · 08/10/2026');
  eq('1.4 emisión en blanco y sin hora real → undefined (pdfDocument pone la fecha real)', arm(op({ emitida: '   ' })).emitida, undefined);
  eq('⭐ A3 emisión escrita «A & B» → escapada UNA sola vez (emitidaCop, sin cadenas de escapadoras)', arm(op({ emitida: 'A & B' })).emitida, 'A &amp; B');
  eq('1.4 emisión escrita con < > → escapada', arm(op({ emitida: '24 oct. <2026>' })).emitida, '24 oct. &lt;2026&gt;');
}

// ——— 1.5 Textos fijos y logos de cop_ajustes (con textosDe/logosDe de la librería de papeles) ———
{
  const vacio = P.textosDe({});
  eq('1.5 sin nada guardado: textos vacíos', [vacio.titulo_consolidado, vacio.titulo_corte, vacio.presentacion, vacio.consideraciones], ['', '', '', '']);
  eq('⭐ 1.5 sin nada guardado: logos = solo Golden Touch', vacio.logos, { bcv: false, sos: false, golden: true, renace: false, jhenzaen: false });
  const lleno = P.textosDe({
    titulo_consolidado: 'Consolidado CDT', titulo_corte: 'Corte', presentacion: 'Párrafo', consideraciones: 'Notas',
    logos: { bcv: true, golden: false, sos: 'sí' },
  });
  eq('1.5 los textos guardados como cadena', [lleno.titulo_consolidado, lleno.titulo_corte, lleno.presentacion, lleno.consideraciones], ['Consolidado CDT', 'Corte', 'Párrafo', 'Notas']);
  eq('1.5 logos guardados: lo que no es sí/no toma el de por defecto', lleno.logos, { bcv: true, sos: false, golden: false, renace: false, jhenzaen: false });

  const oc = intenta('opcionesIniciales', () => R.opcionesIniciales('consolidado', lleno, null), {});
  eq('1.5 el consolidado nace con su título, su presentación y los logos guardados', [oc.titulo, oc.presentacion, oc.consideraciones, oc.logos && oc.logos.bcv], ['Consolidado CDT', 'Párrafo', '', true]);
  const ok2 = intenta('opcionesIniciales', () => R.opcionesIniciales('corte', lleno, null), {});
  eq('1.5 el corte nace con su título y sus consideraciones', [ok2.titulo, ok2.presentacion, ok2.consideraciones], ['Corte', '', 'Notas']);
  const ol = intenta('opcionesIniciales', () => R.opcionesIniciales('listado', null, null), {});
  eq('1.5 sin ajustes ni memoria: las opciones de nacimiento', [ol.titulo, ol.orden, ol.agruparListado, ol.logos], ['', 'cantidad', 'dia', DEF.logos]);
  ok('1.5 * sin compartir las listas de las opciones de nacimiento', ol.ocultosSecciones !== DEF.ocultosSecciones && ol.ocultosColumnas !== DEF.ocultosColumnas);

  eq('1.5 nada cambiado → nada que guardar', intenta('cambiosTextosFijos', () => R.cambiosTextosFijos('consolidado', oc, lleno)), []);
  eq('1.5 consolidado: guarda su título y la presentación (sin espacios a los lados)',
    intenta('cambiosTextosFijos', () => R.cambiosTextosFijos('consolidado', { ...oc, titulo: ' Nuevo ', presentacion: 'Otro\npárrafo ' }, lleno)),
    [['titulo_consolidado', 'Nuevo'], ['presentacion', 'Otro\npárrafo']]);
  eq('1.5 corte: guarda su título y las consideraciones, y los logos si cambiaron',
    intenta('cambiosTextosFijos', () => R.cambiosTextosFijos('corte', { ...ok2, consideraciones: 'X', logos: { ...ok2.logos, sos: true } }, lleno)),
    [['consideraciones', 'X'], ['logos', { bcv: true, sos: true, golden: false, renace: false, jhenzaen: false }]]);
  eq('1.5 listado: solo los logos (no tiene texto fijo)',
    intenta('cambiosTextosFijos', () => R.cambiosTextosFijos('listado', { ...ol, titulo: 'X', logos: { ...ol.logos, renace: true } }, vacio)),
    [['logos', { bcv: false, sos: false, golden: true, renace: true, jhenzaen: false }]]);
}

// ——— L4 A7 = B2: los textos fijos y los logos son del SITIO (valen para los tres papeles) ———
{
  const reb = (p, o, v, n) => intenta('rebasarTextosFijos', () => R.rebasarTextosFijos(p, o, v, n), o);
  const f0 = P.textosDe({});
  let ops = { consolidado: R.opcionesIniciales('consolidado', null, null), corte: R.opcionesIniciales('corte', null, null), listado: R.opcionesIniciales('listado', null, null) };
  const rebasarTodos = (v, n) => { ops = Object.fromEntries(Object.entries(ops).map(([p, o]) => [p, reb(p, o, v, n)])); };
  // 1. Se cargan los ajustes del sitio: los tres papeles los toman.
  const f1 = P.textosDe({ titulo_corte: 'Corte del sitio', consideraciones: 'Cons', logos: { golden: true, bcv: true } });
  rebasarTodos(f0, f1);
  eq('L4 A7 al cargar, cada papel toma lo suyo de los ajustes del sitio', [ops.corte.titulo, ops.corte.consideraciones, ops.consolidado.logos.bcv, ops.listado.logos.bcv], ['Corte del sitio', 'Cons', true, true]);
  // 2. En el consolidado prende Renace y 💾: el sitio queda con Renace.
  ops.consolidado = { ...ops.consolidado, logos: { ...ops.consolidado.logos, renace: true } };
  const guardado = R.cambiosTextosFijos('consolidado', ops.consolidado, f1);
  const f2 = { ...f1, ...Object.fromEntries(guardado) };
  rebasarTodos(f1, f2);
  ok('⭐ L4 A7 tras guardar los logos en el consolidado, el corte también los lleva (no los guardados de antes)', ops.corte.logos.renace === true && ops.listado.logos.renace === true);
  eq('⭐ L4 A7 …y el corte NO dice «con cambios sin guardar» sin que ella toque nada', R.cambiosTextosFijos('corte', ops.corte, f2), []);
  // 3. En el corte escribe las consideraciones y 💾: no revierte el Renace recién guardado.
  ops.corte = { ...ops.corte, consideraciones: 'Nuevas' };
  eq('⭐ L4 A7 guardar desde el corte escribe SOLO lo que cambió (no revierte los logos)', R.cambiosTextosFijos('corte', ops.corte, f2), [['consideraciones', 'Nuevas']]);
  // 4. 🔄 trae lo que otro equipo guardó: lo que ella tecleó no se pisa; lo demás se pone al día.
  ops.consolidado = { ...ops.consolidado, titulo: 'Mi título de hoy' };
  const f3 = { ...f2, titulo_consolidado: 'Título del otro equipo', titulo_corte: 'Corte nuevo', logos: { ...f2.logos, bcv: false } };
  rebasarTodos(f2, f3);
  eq('⭐ L4 A7 lo que ella tecleó se queda (no lo pisa un 🔄)', [ops.consolidado.titulo, ops.corte.consideraciones], ['Mi título de hoy', 'Nuevas']);
  eq('⭐ L4 A7 lo que seguía igual al fijo pasa al fijo nuevo (título del corte, logos)', [ops.corte.titulo, ops.corte.logos.bcv, ops.listado.logos.bcv], ['Corte nuevo', false, false]);
  eq('L4 A7 el listado no tiene título fijo: sigue en blanco', ops.listado.titulo, '');
}

// ——— 1.6 La memoria del equipo ———
{
  const o = op({ ocultosSecciones: ['transportistas'], ocultosColumnas: ['pct', 'm3'], orden: 'az', titulo: 'No se recuerda', emitida: 'ni esto' });
  const ed = { ocultos: ['promedio'], titulos: { viajes: 'Viajes' }, valores: { viajes: '99' }, notas: { viajes: 'n' }, propias: [{ titulo: 'Clima', valor: 'Sol' }] };
  const crudo = intenta('memoriaParaGuardar', () => R.memoriaParaGuardar('consolidado', o, ed, 's1'), '');
  ok('1.6 se guarda como texto JSON', typeof crudo === 'string' && crudo.startsWith('{'));
  const leido = intenta('memoriaLeida', () => R.memoriaLeida('consolidado', crudo, 's1'), { opciones: {}, edicion: {} });
  eq('1.6 vuelven lo oculto, el orden y la agrupación', [leido.opciones.ocultosSecciones, leido.opciones.ocultosColumnas, leido.opciones.orden], [['transportistas'], ['pct', 'm3'], 'az']);
  ok('1.6 los textos NO se recuerdan en el equipo (vienen de cop_ajustes)', !('titulo' in leido.opciones) && !('emitida' in leido.opciones) && !('logos' in leido.opciones));
  eq('⭐ 1.6 del resumen solo vuelve la FORMA: valores y propias no (son cifras de ese día)', [leido.edicion.ocultos, leido.edicion.titulos, leido.edicion.valores ?? {}, leido.edicion.propias ?? []],
    [['promedio'], { viajes: 'Viajes' }, {}, []]);
  // ⭐ L4 R1: las NOTAS tampoco: hablan de las cifras de ESE período y reaparecían
  //    semanas después, con el editor plegado, en un papel que va a terceros.
  ok('⭐ L4 R1 las notas del resumen no se guardan en el equipo', !/"notas"/.test(crudo) && !crudo.includes('"n"'), crudo);
  eq('⭐ L4 R1 …ni vuelven aunque el texto guardado las traiga', intenta('memoriaLeida', () => R.memoriaLeida('consolidado', JSON.stringify({ v: 2, sitioId: 's1', edicion: { titulos: { viajes: 'T' }, notas: { viajes: 'de octubre' } } }), 's1').edicion, {}), { titulos: { viajes: 'T' } });
  // ⭐ L4 B3: la forma del resumen es del SITIO (las claves de las tarjetas son las mismas
  //    en todos): el título escrito para el sitio A no sale en el papel del sitio B.
  ok('⭐ L4 B3 el sitio va dentro de lo guardado (la clave cop_opciones_<papel> no cambia)', JSON.parse(crudo || '{}').sitioId === 's1');
  const otro = intenta('memoriaLeida', () => R.memoriaLeida('consolidado', crudo, 's2'), { opciones: {}, edicion: {} });
  eq('⭐ L4 B3 en OTRO sitio no vuelve la forma del resumen', otro.edicion, {});
  eq('L4 B3 * pero lo oculto, el orden y la agrupación sí (son del equipo, §9)', [otro.opciones.ocultosSecciones, otro.opciones.orden], [['transportistas'], 'az']);
  eq('L4 B3 una memoria vieja, sin sitio, no devuelve la forma del resumen', intenta('memoriaLeida', () => R.memoriaLeida('consolidado', JSON.stringify({ v: 1, papel: 'consolidado', opciones: { orden: 'az' }, edicion: { titulos: { viajes: 'X' } } }), 's1')), { opciones: { orden: 'az' }, edicion: {} });
  eq('L4 B9 una versión que no se entiende se descarta entera', intenta('memoriaLeida', () => R.memoriaLeida('consolidado', JSON.stringify({ v: 99, sitioId: 's1', opciones: { orden: 'az' } }), 's1')), { opciones: {}, edicion: {} });
  eq('1.6 nada guardado → vacío, sin reventar', intenta('memoriaLeida', () => R.memoriaLeida('corte', null)), { opciones: {}, edicion: {} });
  eq('1.6 basura → vacío, sin reventar', intenta('memoriaLeida', () => R.memoriaLeida('corte', '{no es json')), { opciones: {}, edicion: {} });
  const raro = intenta('memoriaLeida', () => R.memoriaLeida('corte', JSON.stringify({ v: 1, opciones: { ocultosColumnas: ['placa', 'inventada', 3], ocultosSecciones: ['transportistas', 'tarjetas'], orden: 'loco', diasSinAnotacion: 'ocultar', columnasPorDestino: 'no' } })), { opciones: {} });
  eq('1.6 lo que no es de ese papel o no se entiende se descarta',
    [raro.opciones.ocultosColumnas, raro.opciones.ocultosSecciones, raro.opciones.orden, raro.opciones.diasSinAnotacion, raro.opciones.columnasPorDestino],
    [['placa'], ['tarjetas'], undefined, 'ocultar', undefined]);
  const conMemoria = intenta('opcionesIniciales', () => R.opcionesIniciales('corte', P.textosDe({ titulo_corte: 'T' }), raro.opciones), {});
  eq('1.6 la memoria y los textos fijos se juntan', [conMemoria.ocultosColumnas, conMemoria.diasSinAnotacion, conMemoria.titulo, conMemoria.orden], [['placa'], 'ocultar', 'T', 'cantidad']);
}

// ——— 1.7 El aviso de lo apagado (SOLO en pantalla) ———
{
  eq('1.7 nada apagado ni filtrado → lista vacía', intenta('apagadoEnPalabras', () => R.apagadoEnPalabras('consolidado', op(), {})), []);
  const a = intenta('apagadoEnPalabras', () => R.apagadoEnPalabras('consolidado', op({ ocultosSecciones: ['transportistas'], ocultosColumnas: ['pct'] }),
    { tipos: ['salida'], transportistas: ['Transportista A'], texto: 'arena' }), []);
  ok('1.7 nombra la sección apagada por su etiqueta', a.some((x) => x.includes('Recepción por empresa transportista')), a.join(' | '));
  ok('1.7 nombra la columna apagada', a.some((x) => x.includes('Participación (%)')), a.join(' | '));
  ok('1.7 nombra los filtros', a.some((x) => /Salida/i.test(x)) && a.some((x) => x.includes('Transportista A')) && a.some((x) => x.includes('arena')), a.join(' | '));
  const c = intenta('apagadoEnPalabras', () => R.apagadoEnPalabras('corte', op({ diasSinAnotacion: 'ocultar', ocultosSecciones: ['transportistas'] }), {}), []);
  ok('1.7 corte: los días vacíos escondidos se avisan', c.some((x) => /días sin anotación/i.test(x)), c.join(' | '));
  ok('1.7 * y una sección que el corte no tiene no se nombra', !c.some((x) => x.includes('transportista')), c.join(' | '));
  const r = intenta('apagadoEnPalabras', () => R.apagadoEnPalabras('consolidado', op(), {}, { ocultos: ['viajes'] }), []);
  ok('1.7 las tarjetas escondidas del resumen se avisan', r.some((x) => /tarjeta/i.test(x)), r.join(' | '));
}

// ——— 1.8 Las unidades del corte ———
const UNIDAD_DE = L.unidadDeLosRenglones(BASE);
{
  const ops = intenta('opcionesUnidadCorte', () => R.opcionesUnidadCorte(BASE, FLOTA), []);
  const claves = ops.map((o) => o.clave);
  ok('1.8 ofrece las unidades con renglones (claves de unidadDeLosRenglones(base))', claves.includes('u1') && claves.includes('u2'), claves.join(', '));
  ok('1.8 * y las ACTIVAS de la flota sin renglones (hoja con su nombre)', claves.includes('u3'), claves.join(', '));
  ok('1.8 * pero no una dada de baja sin renglones', !claves.includes('u4'), claves.join(', '));
  ok('⭐ 1.8 el renglón suelto con la placa de U-1 no aparece como otra unidad', !claves.includes('tst-001') && new Set(BASE.map(UNIDAD_DE).filter(Boolean)).size === 2, claves.join(', '));
  const u3 = ops.find((o) => o.clave === 'u3') ?? {};
  eq('1.8 la ficha sale de cop_unidades: código · descripción y placa', u3.ficha, { unidad: 'U-3 · Volteo sin viajes', placa: 'TST-003' });
  eq('1.8 * y A→Z', ops.map((o) => o.clave), ['u1', 'u2', 'u3']);
}

// ——— L4 A5: «Las que trabajaron» = las que tienen viajes DEL CORTE (internos o salidas) ———
{
  const conEntrada = [
    mov({ tipo: 'entrada', fecha: '2026-10-06', unidadTexto: 'Volteo externo', placa: 'EXT-100', transportista: 'Transportista A', viajes: 6 }),
    mov({ ...U1, tipo: 'interno', fecha: '2026-10-06', origen: 'Terraza 1', destino: 'Terraza 2', viajes: 2 }),
    // U-2 solo trabajó DESPUÉS de la hora de corte (19:30 del último día, corte 19:00).
    mov({ ...U2, tipo: 'salida', fecha: '2026-10-08', hora: '19:30', destino: 'Destino X', viajes: 1 }),
  ];
  const r = { desde: '2026-10-06', hasta: '2026-10-08', corteHora: '19:00' };
  const ops = intenta('opcionesUnidadCorte con rango', () => R.opcionesUnidadCorte(conEntrada, FLOTA, r), []);
  const de = (k) => ops.find((o) => o.clave === k);
  eq('⭐ L4 A5 la unidad con viajes internos del período sí «trabajó»', de('u1')?.conRenglones, true);
  eq('⭐ L4 A5 la que solo TRAJO material (entradas) no cuenta como «trabajó» (su hoja saldría vacía)', de('ext100')?.conRenglones, false);
  ok('⭐ L4 A5 …pero se sigue ofreciendo (quitarla se llevaría su hoja sin aviso)', !!de('ext100'));
  eq('L4 A5 la que solo trabajó después de la hora de corte tampoco', de('u2')?.conRenglones, false);
  eq('L4 A5 la de la flota sin nada en el período, igual que antes', de('u3')?.conRenglones, false);
  const hojaExt = intenta('armarPapelCop', () => R.armarPapelCop({ papel: 'corte', sitio: 'Sitio 1', base: conEntrada, rango: r, filtros: {}, op: op(), edicion: null, unidadesCorte: [{ clave: 'ext100' }] }), { cuerpo: '' });
  ok('L4 A5 (la razón) el corte de esa unidad sale «Sin registros en el período»', hojaExt.cuerpo.includes('Sin registros en el período'));
}

// ——— 1.9 El armado completo (lib → modelo → papel) ———
const armar = (e) => intenta('armarPapelCop', () => R.armarPapelCop({ sitio: 'Sitio 1', base: BASE, rango: RANGO, filtros: {}, op: op(), edicion: null, ...e }), { cuerpo: '', titulo: '', subtitulo: '' });
{
  const fichas = Object.fromEntries((R.opcionesUnidadCorte?.(BASE, FLOTA) ?? []).map((o) => [o.clave, o]));
  const cons = armar({ papel: 'consolidado' });
  ok('1.9 consolidado: título de siempre, escapado', cons.titulo === 'Consolidado del sitio');
  ok('1.9 * con la sección de transportistas', cons.cuerpo.includes('Recepción por empresa transportista'));
  const consOc = armar({ papel: 'consolidado', op: op({ ocultosSecciones: ['transportistas'], ocultosColumnas: ['pct'] }) });
  ok('⭐ 1.9 lo oculto no deja rastro (ni el título de la sección ni la columna)', !consOc.cuerpo.includes('Recepción por empresa transportista') && !consOc.cuerpo.includes('Participación'));
  ok('⭐ 1.9 el papel NO anuncia opciones ni filtros', !/oculto|filtrad|apagad/i.test(consOc.cuerpo + consOc.subtitulo));
  const az = armar({ papel: 'consolidado', op: op({ orden: 'az' }) });
  const iA = az.cuerpo.indexOf('Transportista A'), iB = az.cuerpo.indexOf('Transportista B');
  ok('1.9 el MISMO op manda en el modelo: orden A→Z', iA > 0 && iB > iA);
  const masViajes = armar({ papel: 'consolidado', base: [...BASE, mov({ transportista: 'Transportista B', viajes: 9, toneladas: 10 })] });
  ok('1.9 * y por cantidad, el de más viajes primero', masViajes.cuerpo.indexOf('Transportista B') < masViajes.cuerpo.indexOf('Transportista A'));
  const madrugada = armar({ papel: 'consolidado', rango: { ...RANGO, corteHora: '05:00' } });
  ok('⭐ 1.9 la ficha del corte dice el día real de la madrugada', madrugada.cuerpo.includes('09/10/2026, 05:00 a. m.'), madrugada.cuerpo.slice(0, 300));

  // Corte: dos unidades → dos hojas; la que no trabajó sale con SU NOMBRE.
  const corte = armar({ papel: 'corte', unidadesCorte: [fichas.u1, fichas.u3].filter(Boolean) });
  eq('⭐ 1.9 corte: una hoja por unidad', (corte.cuerpo.match(/<section class="cop-hoja">/g) ?? []).length, 2);
  ok('⭐ 1.9 * la unidad sin renglones imprime su nombre, no su id', corte.cuerpo.includes('U-3 · Volteo sin viajes') && !/Unidad:<\/b> u3</.test(corte.cuerpo));
  eq('1.9 * dos hojas', corte.hojas, 2);
  ok('1.9 * el período de cada hoja sale del momento real', armar({ papel: 'corte', rango: { ...RANGO, corteHora: '05:00' }, unidadesCorte: [fichas.u2] }).cuerpo.includes('corte el 09/10/2026 a las 05:00 a. m.'));

  // ⭐ UNA sola regla de pertenencia: filtrando solo las salidas de Arena, el renglón
  //    suelto con la placa de U-1 sigue siendo de U-1 en el corte y en el listado.
  const filtros = { materiales: ['Arena'] };
  const corteU1 = armar({ papel: 'corte', filtros, unidadesCorte: [fichas.u1] });
  ok('⭐ 1.9 corte filtrado: el suelto con la placa de U-1 cuenta en U-1 (3 + 1 = 4 viajes)', /Destino Y/.test(corteU1.cuerpo) && /<td class="n">4<\/td>/.test(corteU1.cuerpo), corteU1.cuerpo.slice(0, 600));
  const listado = armar({ papel: 'listado', filtros, op: op({ agruparListado: 'unidad' }) });
  const grupos = (listado.cuerpo.match(/<div class="fr-h cop-h">[^<]*/g) ?? []).map((g) => g.replace(/<div class="fr-h cop-h">/, ''));
  ok('⭐ 1.9 listado filtrado por unidad: el suelto va en el grupo de U-1 (no en uno propio)', grupos.length === 2 && grupos.some((g) => g.startsWith('U-1')) && grupos.some((g) => g.startsWith('U-2')), grupos.join(' | '));
  eq('⭐ 1.9 * y la tabla por unidad (tablaPor con la misma regla) dice lo mismo: U-1 con 4, U-2 con 1',
    (listado.porUnidad ?? []).map((f) => f.viajes), [4, 1]);

  // Con varias hojas, un valor escrito a mano saldría IGUAL en todas: se descarta.
  const ed = { valores: { internos: '777' }, titulos: { internos: 'Internos del mes' } };
  const una = armar({ papel: 'corte', edicion: ed, unidadesCorte: [fichas.u1] });
  const varias = armar({ papel: 'corte', edicion: ed, unidadesCorte: [fichas.u1, fichas.u2] });
  ok('1.9 corte de UNA unidad: el valor a mano sale', una.cuerpo.includes('777') && una.cuerpo.includes('Internos del mes'));
  ok('1.9 corte de VARIAS: el valor a mano no sale (repetiría la cifra), el título sí', !varias.cuerpo.includes('777') && varias.cuerpo.includes('Internos del mes'));
  ok('1.9 el resumen automático va para el editor', Array.isArray(cons.resumen && cons.resumen.tarjetas) && cons.resumen.tarjetas.map((t) => t.k).join() === 'viajes,toneladas,promedio');
  // ⭐ A3 (1): el resumen del editor sigue al MISMO op que el papel: con «toneladas»
  //    apagada el papel no imprime toneladas ni promedio, y el editor no los ofrece.
  const sinTon = armar({ papel: 'consolidado', op: op({ ocultosColumnas: ['toneladas'] }) });
  eq('⭐ A3 con «toneladas» apagada, el resumen del editor = las tarjetas del papel (solo viajes)', (sinTon.resumen?.tarjetas ?? []).map((t) => t.k), ['viajes']);
  ok('⭐ A3 * y el papel tampoco las imprime', !sinTon.cuerpo.includes('Toneladas netas') && !sinTon.cuerpo.includes('Promedio t/viaje'));
  // ⭐ A3 (2): los nombres IMPRESOS de las hojas (los de la ficha) para el nombre del archivo.
  eq('⭐ A3 el corte devuelve los nombres impresos de sus hojas', corte.nombresHojas, ['U-1 · Volteo sintético', 'U-3 · Volteo sin viajes']);
  const suelto = armar({ papel: 'corte', unidadesCorte: [{ clave: 'tst999' }], base: [...BASE, mov({ tipo: 'salida', fecha: '2026-10-07', unidadTexto: 'Volteo prestado', placa: 'TST-999', destino: 'Destino X', viajes: 1 })] });
  eq('A3 * una unidad suelta (sin ficha) se nombra por lo que ella escribió', suelto.nombresHojas, ['Volteo prestado']);
  eq('A3 * los otros papeles no tienen hojas que nombrar', cons.nombresHojas, []);
  // ⭐ A3 (cmpMovimientoJornada): el listado sale en el orden de la jornada de la librería;
  //    a igual momento, por cuándo se cargó (no por el orden en que llegaron).
  const tarde = mov({ id: 'z-tarde', fecha: '2026-10-07', hora: '10:00', transportista: 'Orden B', creadoAt: '2026-10-07T15:00:00Z' });
  const temprano = mov({ id: 'a-temprano', fecha: '2026-10-07', hora: '10:00', transportista: 'Orden A', creadoAt: '2026-10-07T14:00:00Z' });
  const madr = mov({ id: 'm-madrugada', fecha: '2026-10-07', hora: '05:00', transportista: 'Orden C' });
  const ordenLst = armar({ papel: 'listado', base: [madr, tarde, temprano] }).cuerpo;
  const esperado = [madr, tarde, temprano].sort(L.cmpMovimientoJornada).map((m) => m.transportista);
  eq('⭐ A3 el listado ordena con cmpMovimientoJornada (empate → creado antes; la madrugada al final)',
    ['Orden A', 'Orden B', 'Orden C'].sort((a, b) => ordenLst.indexOf(a) - ordenLst.indexOf(b)), esperado);

  // ⭐ L4 A1: el corte de varias unidades lleva título y emisión en cada hoja (la 1.ª los
  //    tiene en el membrete); la emisión es UNA sola, la misma del membrete.
  {
    const AHORA = '24 oct. 2026, 05:00 p. m.';
    const tres = armar({ papel: 'corte', unidadesCorte: [fichas.u1, fichas.u2, fichas.u3], ahora: AHORA, op: op({ titulo: 'Corte <A & B>' }) });
    const hojasHtml = tres.cuerpo.split('<section class="cop-hoja">').slice(1);
    eq('⭐ L4 A1: tres unidades → tres hojas', hojasHtml.length, 3);
    ok('⭐ L4 A1: la hoja 1 no repite el membrete (ya lo tiene arriba)', !hojasHtml[0].includes('cop-hoja-enc'));
    ok('⭐ L4 A1: las hojas 2 y 3 dicen qué son (el título, escapado una vez) y cuándo se emitieron', hojasHtml.slice(1).every((h) => h.includes('Corte &lt;A &amp; B&gt;') && h.includes(AHORA)) && !tres.cuerpo.includes('&amp;amp;'), hojasHtml[1].slice(0, 200));
    eq('⭐ L4 A1: el membrete lleva la MISMA emisión que las hojas', tres.emitida, AHORA);
    ok('⭐ L4 A1: las hojas siguen pegadas (el salto de página .cop-hoja+.cop-hoja casa)', (tres.cuerpo.match(/<\/section><section class="cop-hoja">/g) ?? []).length === 2);
    ok('L4 A1: sin logo por hoja', !/<img/i.test(tres.cuerpo));
    const escrita = armar({ papel: 'corte', unidadesCorte: [fichas.u1, fichas.u2], ahora: AHORA, op: op({ emitida: 'A & B' }) });
    ok('⭐ L4 A1: una emisión escrita a mano va igual al membrete y a cada hoja, escapada una vez', escrita.emitida === 'A &amp; B' && escrita.cuerpo.includes('A &amp; B') && !escrita.cuerpo.includes(AHORA) && !escrita.cuerpo.includes('&amp;amp;'));
    ok('L4 A1: una sola unidad no lleva encabezado de hoja (es la hoja del membrete)', !armar({ papel: 'corte', unidadesCorte: [fichas.u1], ahora: AHORA }).cuerpo.includes('cop-hoja-enc'));
  }

  // Período sin nada (Review Focus 3): los tres papeles, con ceros y la leyenda, sin NaN.
  for (const papel of ['consolidado', 'corte', 'listado']) {
    const v = armar({ papel, base: [], unidadesCorte: papel === 'corte' ? [fichas.u3] : undefined });
    ok(`1.9 período vacío (${papel}): «Sin registros en el período» y sin NaN`, v.cuerpo.includes('Sin registros en el período') && !/NaN|Infinity|undefined/.test(v.cuerpo), v.cuerpo.slice(0, 200));
  }
  // Texto del usuario literal (Review Focus 1).
  const lst = armar({ papel: 'listado' });
  ok('1.9 lo escrito con < > & " sale literal', lst.cuerpo.includes('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;') && !lst.cuerpo.includes('<b>x</b>'));
}

// ——— L4 A2 = B4: la pantalla arma el MODELO sin el HTML (lo caro es el cuerpo) ———
{
  const fichas = Object.fromEntries((R.opcionesUnidadCorte?.(BASE, FLOTA) ?? []).map((o) => [o.clave, o]));
  const sinHtml = (e) => intenta('armarPapelCop sin cuerpo', () => R.armarPapelCop({ sitio: 'Sitio 1', base: BASE, rango: RANGO, filtros: {}, op: op(), edicion: null, ...e }, { conCuerpo: false }), {});
  const lo = (a) => JSON.stringify([a.renglones, a.hojas, a.resumen, a.porUnidad, a.nombresHojas, a.titulo, a.subtitulo, a.emitida]);
  for (const [papel, extra] of [['consolidado', {}], ['corte', { unidadesCorte: [fichas.u1, fichas.u3] }], ['listado', { op: op({ agruparListado: 'unidad' }) }]]) {
    const completo = armar({ papel, ...extra });
    const modelo = sinHtml({ papel, ...extra });
    eq(`⭐ L4 A2 ${papel}: sin el cuerpo, el HTML no se arma`, modelo.cuerpo, '');
    eq(`⭐ L4 A2 ${papel}: …y lo demás (renglones, hojas, resumen, por unidad, nombres) sale IGUAL que el armado completo`, lo(modelo), lo(completo));
  }
  ok('L4 A2: sin la opción, el armado es el completo (las pruebas y los muestreos no cambian)', armar({ papel: 'listado' }).cuerpo.length > 0);
  // Lo que la pantalla teclea (textos, logos, emisión, la edición) NO mueve el modelo.
  const base = op({ orden: 'az', ocultosColumnas: ['toneladas'], columnasPorDestino: false, diasSinAnotacion: 'ocultar' });
  const tecleado = { ...base, titulo: 'Otro', subtitulo: 'Sub', presentacion: 'P', consideraciones: 'C', emitida: 'E', logos: { ...base.logos, bcv: true }, ocultosSecciones: ['presentacion'], agruparListado: 'tipo' };
  eq('⭐ L4 A2 claveDelModelo: los textos, logos y secciones no cambian la clave', intenta('claveDelModelo', () => R.claveDelModelo(tecleado)), intenta('claveDelModelo', () => R.claveDelModelo(base)));
  for (const [k, v] of [['orden', 'cantidad'], ['ocultosColumnas', []], ['columnasPorDestino', true], ['diasSinAnotacion', 'cero']]) {
    ok(`L4 A2 claveDelModelo: «${k}» sí la cambia (mueve el modelo)`, R.claveDelModelo?.({ ...base, [k]: v }) !== R.claveDelModelo?.(base));
  }
  const conTeclas = sinHtml({ papel: 'consolidado', op: tecleado, edicion: { valores: { viajes: '9' } } });
  const sinTeclas = sinHtml({ papel: 'consolidado', op: base });
  eq('⭐ L4 A2 lo tecleado no cambia el modelo de la pantalla (resumen, renglones, por unidad)', [conTeclas.resumen, conTeclas.renglones, conTeclas.porUnidad], [sinTeclas.resumen, sinTeclas.renglones, sinTeclas.porUnidad]);
}

// ——— L4 A6: el control ORDEN sale solo donde actúa ———
{
  const fichas = Object.fromEntries((R.opcionesUnidadCorte?.(BASE, FLOTA) ?? []).map((o) => [o.clave, o]));
  const oa = (papel, o) => intenta('ordenActua', () => R.ordenActua(papel, o), null);
  eq('⭐ L4 A6 ORDEN actúa en el consolidado y en el listado agrupado por unidad', [oa('consolidado', op()), oa('listado', op({ agruparListado: 'unidad' }))], [true, true]);
  eq('⭐ L4 A6 …y NO en el corte ni en el listado por día o por tipo (no se muestra)', [oa('corte', op()), oa('listado', op({ agruparListado: 'dia' })), oa('listado', op({ agruparListado: 'tipo' }))], [false, false, false]);
  const hojas = [fichas.u2, fichas.u1];
  eq('L4 A6 (la razón) el corte sale igual con «más viajes» y con «A→Z»', armar({ papel: 'corte', unidadesCorte: hojas, op: op({ orden: 'cantidad' }) }).cuerpo, armar({ papel: 'corte', unidadesCorte: hojas, op: op({ orden: 'az' }) }).cuerpo);
  eq('L4 A6 (la razón) y el listado por día también', armar({ papel: 'listado', op: op({ orden: 'cantidad' }) }).cuerpo, armar({ papel: 'listado', op: op({ orden: 'az' }) }).cuerpo);
}

// ——— L4 B6: con el filtro de TIPO, el consolidado no afirma «Sin entradas» de un sitio que sí recibió ———
{
  const soloSalidas = armar({ papel: 'consolidado', filtros: { tipos: ['salida'] } });
  ok('⭐ L4 B6 «solo salidas»: sin «Sin entradas», sin las tarjetas de lo recibido ni sus tablas', !/Sin entradas/.test(soloSalidas.cuerpo) && !soloSalidas.cuerpo.includes('Viajes recibidos') && !soloSalidas.cuerpo.includes('Recepción por empresa transportista') && !soloSalidas.cuerpo.includes('Recepción por frente u obra de origen'));
  ok('⭐ L4 B6 * ni «Movimientos internos» (el filtro los excluye)', !soloSalidas.cuerpo.includes('Movimientos internos'));
  ok('L4 B6 * y las salidas sí salen', soloSalidas.cuerpo.includes('Salidas / despacho') && soloSalidas.cuerpo.includes('Destino X'));
  ok('⭐ L4 B6 * lo filtrado no deja rastro (no se anuncia)', !/filtrad|oculto|solo salidas/i.test(soloSalidas.cuerpo));
  const soloEntradas = armar({ papel: 'consolidado', filtros: { tipos: ['entrada'] } });
  ok('L4 B6 «solo entradas»: sin internos, sin salidas ni su resumen en texto', !soloEntradas.cuerpo.includes('Movimientos internos') && !soloEntradas.cuerpo.includes('Salidas / despacho') && !soloEntradas.cuerpo.includes('Resumen de salidas') && soloEntradas.cuerpo.includes('Viajes recibidos'));
  const porTransportista = armar({ papel: 'consolidado', filtros: { transportistas: ['Transportista A'] } });
  ok('L4 B6 el filtro de transportista NO esconde secciones (Cargar lo pide en todos los tipos)', porTransportista.cuerpo.includes('Movimientos internos') && porTransportista.cuerpo.includes('Salidas / despacho'));
  const o = op();
  const d = intenta('opDelCuerpo', () => R.opDelCuerpo('consolidado', o, { tipos: ['salida'] }), o);
  eq('L4 B6 opDelCuerpo: las secciones que el filtro excluye por completo', [...(d.ocultosSecciones ?? [])].sort(), ['internos', 'origenes', 'tarjetas', 'transportistas']);
  eq('L4 B6 * sin tocar el op de la pantalla (ni el del nombre del archivo)', o.ocultosSecciones, []);
  eq('L4 B6 * el corte no cambia (sus hojas no cuentan entradas)', intenta('opDelCuerpo', () => R.opDelCuerpo('corte', o, { tipos: ['salida'] }), null), o);
}

// ——— 1.10 El nombre del archivo y los filtros de cada papel ———
{
  eq('1.10 el corte no filtra por unidad (las unidades son sus hojas)', intenta('filtrosDelPapel', () => R.filtrosDelPapel('corte', { unidadIds: ['u1'], tipos: ['salida'] })), { tipos: ['salida'] });
  eq('1.10 los otros papeles sí', intenta('filtrosDelPapel', () => R.filtrosDelPapel('listado', { unidadIds: ['u1'] })), { unidadIds: ['u1'] });
  // ⭐ A3 (2): la unidad va por el parámetro de `nombreArchivoCop`, no pegada al sitio (el
  //    recorte de un sitio largo se la comía y dos cortes de unidades distintas chocaban).
  const largo = 'Sitio de nombre larguísimo para probar el recorte del archivo sin perder la unidad';
  const n1 = P.nombreArchivoCop('corte', largo, RANGO, op(), {}, ['U-1 · Volteo sintético']);
  const n2 = P.nombreArchivoCop('corte', largo, RANGO, op(), {}, ['U-2']);
  ok('⭐ A3 dos cortes de unidades distintas de un sitio largo no se llaman igual', n1 !== n2 && n1.includes('U-1') && n2.includes('U-2'), `${n1} | ${n2}`);
}

// ——— L4 B1: los valores a mano no pasan de una unidad a otra ni sobreviven a un filtro ———
{
  const ed = { ocultos: ['total'], titulos: { salidas: 'Externos' }, notas: { salidas: 'n' }, valores: { salidas: '45' }, propias: [{ titulo: 'Tarifa', valor: '10' }] };
  const eds = { consolidado: { valores: { viajes: '120' } }, corte: ed, listado: {} };
  const porUnidad = intenta('edicionesAlCambiar', () => R.edicionesAlCambiar(eds, 'unidades'), {});
  eq('⭐ L4 B1 al cambiar las unidades del corte: sin el «45» ni la tarjeta propia (cifras de OTRA unidad)', [porUnidad.corte?.valores ?? {}, porUnidad.corte?.propias ?? []], [{}, []]);
  eq('⭐ L4 B1 * la forma se queda (lo escondido, los títulos, las notas)', [porUnidad.corte?.ocultos, porUnidad.corte?.titulos, porUnidad.corte?.notas], [['total'], { salidas: 'Externos' }, { salidas: 'n' }]);
  ok('L4 B1 * los otros papeles no se tocan (sus hojas no cambiaron)', porUnidad.consolidado === eds.consolidado && porUnidad.listado === eds.listado);
  const porFiltro = intenta('edicionesAlCambiar', () => R.edicionesAlCambiar(eds, 'filtros'), {});
  eq('⭐ L4 B1 al cambiar los filtros: los tres papeles sin valores a mano', [porFiltro.consolidado?.valores ?? {}, porFiltro.corte?.valores ?? {}], [{}, {}]);
  const f = (x, t) => intenta('firmaFiltros', () => R.firmaFiltros(x, t), null);
  eq('L4 B1 firmaFiltros: una lista vacía es «sin filtro» y el buscador va recortado', f({ tipos: [] }, '  arena '), f({}, 'arena'));
  eq('L4 B1 firmaFiltros: el orden en que se tocaron no importa', f({ transportistas: ['B', 'A'] }, ''), f({ transportistas: ['A', 'B'] }, ''));
  ok('L4 B1 firmaFiltros: otro filtro u otra búsqueda sí la cambian', f({ transportistas: ['A'] }, '') !== f({}, '') && f({}, 'arena') !== f({}, 'grava'));
}

// ——— 1.11 Los interruptores y el editor del resumen (puros) ———
{
  const o1 = intenta('alternarSeccion', () => R.alternarSeccion(op(), 'origenes'), op());
  eq('1.11 apagar una sección', o1.ocultosSecciones, ['origenes']);
  eq('1.11 * y volver a prenderla', intenta('alternarSeccion', () => R.alternarSeccion(o1, 'origenes').ocultosSecciones), []);
  eq('1.11 apagar una columna', intenta('alternarColumna', () => R.alternarColumna(op(), 'm3').ocultosColumnas), ['m3']);
  ok('1.11 no muta las opciones de nacimiento', DEF.ocultosSecciones.length === 0 && DEF.ocultosColumnas.length === 0);

  let ed = {};
  ed = intenta('alternarOcultoResumen', () => R.alternarOcultoResumen(ed, 'viajes'), {});
  eq('1.11 esconder una tarjeta', ed.ocultos, ['viajes']);
  eq('1.11 * y mostrarla de nuevo', intenta('alternarOcultoResumen', () => R.alternarOcultoResumen(ed, 'viajes').ocultos), []);
  eq('1.11 escribir el título de una tarjeta', intenta('escribirEnResumen', () => R.escribirEnResumen({}, 'titulos', 'viajes', 'Recibidos').titulos), { viajes: 'Recibidos' });
  let conPropias = {};
  for (let i = 0; i < 8; i++) conPropias = intenta('agregarTarjetaPropia', () => R.agregarTarjetaPropia(conPropias), conPropias);
  eq('⭐ 1.11 hasta 6 tarjetas propias, ni una más', (conPropias.propias ?? []).length, 6);
  const cambiada = intenta('cambiarTarjetaPropia', () => R.cambiarTarjetaPropia(conPropias, 1, 'valor', '12'), conPropias);
  eq('1.11 cambiar una tarjeta propia', (cambiada.propias ?? [])[1], { titulo: '', valor: '12', nota: '' });
  eq('1.11 quitar una tarjeta propia', intenta('quitarTarjetaPropia', () => R.quitarTarjetaPropia(cambiada, 0).propias.length), 5);
  const aplicado = intenta('escribirEnResumen', () => F.aplicarEdicionResumen({ tarjetas: [{ k: 'viajes', titulo: 'Viajes', valor: '5' }], cuadros: [] }, R.escribirEnResumen({}, 'valores', 'viajes', '   ')), { tarjetas: [{}] });
  eq('1.11 lo escrito en blanco vuelve al automático (contrato EdicionResumen)', aplicado.tarjetas[0].valor, '5');
}

// ——— PD5b: el 📄 Reporte completo, primer papel de la pestaña ———
// Su rango son JORNADAS enteras (7am a 7am): sin hora de corte y sin filtros, buscador,
// orden ni resumen editable. Sí: secciones ocultables, logos, título, subtítulo y emisión.
const RC = loadTs(path.join(ROOT, 'src/lib/centroOperacionesReporteCompleto.ts'));
{
  const item = (o) => ({ id: `l${++seq}`, sitioId: 's1', clase: 'material', nombre: 'X', activo: true, lat: null, lng: null, km: null, factorTM3: null, diasDisponible: null, ...o });
  const BLOQ = item({ nombre: 'Bloques', diasDisponible: 7 });
  const DATOS = {
    reportes: [{ id: 'r1', sitioId: 's1', fecha: '2026-10-06', viajesTotal: 9, toneladasTotal: 180.5, empresas: [{ nombre: 'Transportista <A> & B', viajes: 9, toneladas: 180.5 }], frentes: [{ nombre: 'Obra Uno', viajes: 9, toneladas: 180.5 }], avisos: [] }],
    movimientos: [
      mov({ destino: 'Patio Uno', viajes: 4 }),
      mov({ fecha: '2026-10-07', tipo: 'salida', material: 'Arena', destino: 'Obra Uno', km: 8, m3: 12, toneladas: 14.4, vehiculo: 'propio', unidadIngresada: 'm3' }),
      mov({ fecha: '2026-10-07', tipo: 'produccion', material: 'Bloques', materialId: BLOQ.id, cantidad: 60, viajes: null, unidadIngresada: 'u' }),
      mov({ fecha: '2026-10-08', tipo: 'salida', material: 'Bloques', materialId: BLOQ.id, cantidad: 10, viajes: null, unidadIngresada: 'u', destino: 'Cliente Prueba' }),
      // Fuera del período (llegó de más): no cuenta.
      mov({ fecha: '2026-10-09', destino: 'Patio Uno', viajes: 99 }),
    ],
    anteriores: [],
    unidades: [unidad({ id: 'u1', codigo: 'U-1', estado: 'averiada', estadoNota: 'Caja', estadoAt: '2026-10-07T12:00:00Z' })],
    listas: [item({ clase: 'terraza', nombre: 'Patio Uno' }), BLOQ],
  };
  const CON_HORA = { ...RANGO, corteHora: '19:00' };
  const FILTROS = { tipos: ['entrada'], unidadIds: ['u1'], transportistas: ['Transportista A'], texto: 'zzz' };
  const armarC = (e = {}, conCuerpo) => intenta('armarPapelCop completo', () => R.armarPapelCop({
    papel: 'completo', sitio: 'Sitio 1', base: BASE, rango: CON_HORA, filtros: FILTROS, op: op(), edicion: null,
    completo: { datos: DATOS, hoy: '2026-10-09' }, ...e,
  }, conCuerpo === false ? { conCuerpo: false } : undefined), { cuerpo: '', titulo: '', subtitulo: '' });

  const a = armarC();
  eq('⭐ PD5b el título de siempre: «Reporte completo»', a.titulo, 'Reporte completo');
  eq('⭐ PD5b el subtítulo son JORNADAS enteras: sin la hora de corte de los otros papeles', a.subtitulo, 'Sitio 1 · del 06/10/2026 al 08/10/2026');
  const esperado = intenta('cuerpo directo', () => RC.cuerpoReporteCompleto(RC.modeloReporteCompleto({ ...DATOS, sitio: 'Sitio 1', desde: RANGO.desde, hasta: RANGO.hasta, hoy: '2026-10-09' }), op()), 'x');
  eq('⭐ PD5b el cuerpo es el del Reporte completo con TODO el período: los filtros, el buscador y la hora de corte no lo tocan', a.cuerpo, esperado);
  ok('PD5b …las 7 secciones numeradas', a.cuerpo.includes('1. Reporte General desglosado') && a.cuerpo.includes('7. Bloques'));
  ok('PD5b …lo de fuera del período no entra', !a.cuerpo.includes('>99<') && !a.cuerpo.includes('103'));
  ok('PD5b …y el texto del usuario sale escapado', a.cuerpo.includes('Transportista &lt;A&gt; &amp; B') && !a.cuerpo.includes('<A>'));
  eq('PD5b una hoja, sin resumen editable, sin tabla por unidad ni nombres de hojas', [a.hojas, a.resumen, a.porUnidad, a.nombresHojas], [1, null, [], []]);
  eq('PD5b los renglones del papel son los del período (todos los tipos)', a.renglones, 4);
  eq('PD5b el modelo va a la pantalla (sin HTML)', a.completo?.jornadas, 3);
  {
    // ⭐ M5: lo que leyó inspección AL EMITIR y la hora de ese momento llegan al papel tal cual
    //    (datos inventados: una vinculada a una máquina ficticia).
    const INSP = { leidaAt: '2026-10-09T10:44:00.000Z', porMaquina: { 'MQ-1': { encontrada: true, estado: 'averiada', etiqueta: 'Averiada', icono: '🔴', motivo: 'falla sintética', desdeMs: null, enVivo: null, novedad: null, reactivadaMs: null } } };
    const DATOS_V = { ...DATOS, unidades: [...DATOS.unidades, unidad({ id: 'u9', codigo: 'V-1', origen: 'catalogo', machineryId: 'MQ-1', estado: null })] };
    const EMITIDO = Date.parse('2026-10-09T10:45:00.000Z'); // 06:45 a. m. en Caracas
    const conInsp = armarC({ completo: { datos: DATOS_V, hoy: '2026-10-09', inspeccion: INSP, emitidoMs: EMITIDO } });
    const esperadoInsp = intenta('cuerpo directo con inspección', () => RC.cuerpoReporteCompleto(RC.modeloReporteCompleto({
      ...DATOS_V, sitio: 'Sitio 1', desde: RANGO.desde, hasta: RANGO.hasta, hoy: '2026-10-09', inspeccion: INSP, emitidoMs: EMITIDO,
    }), op()), 'x');
    eq('⭐ M5 armarPapelCop lleva al papel lo leído de inspección y la hora de emitir', conInsp.cuerpo, esperadoInsp);
    ok('M5 …la vinculada sale según inspección, con la hora de emitir en la sección 6', conInsp.cuerpo.includes('Averiada — falla sintética') && conInsp.cuerpo.includes('según inspección')
      && conInsp.cuerpo.includes('Estado al emitir: 09/10/2026, 06:45 a. m.'));
    const sinInsp = armarC({ completo: { datos: DATOS_V, hoy: '2026-10-09', inspeccion: null, emitidoMs: EMITIDO } });
    ok('⭐ M5 …si no se leyó: el aviso arriba y la vinculada sin marca «Sin dato» (nunca «Disponible»)',
      sinInsp.cuerpo.includes('No se pudo leer el estado de inspección al emitir: se imprime lo marcado en el sitio.')
      && /<tr><td>V-1<\/td><td>—<\/td><td>Sin dato<\/td>/.test(sinInsp.cuerpo), sinInsp.cuerpo.slice(sinInsp.cuerpo.indexOf('6. Maquinaria'), sinInsp.cuerpo.indexOf('7. Bloques')));
    const ocultaInsp = armarC({ op: op({ ocultosSecciones: ['maquinaria'] }), completo: { datos: DATOS_V, hoy: '2026-10-09', inspeccion: null, emitidoMs: EMITIDO } });
    ok('M5 …con la sección oculta, ni el aviso ni la hora (lo oculto no deja rastro)', !/inspección|Estado al emitir|Maquinaria/i.test(ocultaInsp.cuerpo));
  }
  const oc = armarC({ op: op({ ocultosSecciones: ['patios', 'maquinaria'], emitida: 'A & B' }) });
  ok('⭐ PD5b lo escondido no deja rastro y la numeración sigue', !oc.cuerpo.includes('Entrada por patio') && !oc.cuerpo.includes('Maquinaria') && oc.cuerpo.includes('5. Bloques') && !/oculto|sin patios/i.test(oc.cuerpo));
  eq('PD5b la emisión escrita sale escapada UNA vez (la del membrete)', oc.emitida, 'A &amp; B');
  eq('PD5b …o la hora real que pone la pantalla', armarC({ ahora: '25 oct. 2026, 05:00 p. m.' }).emitida, '25 oct. 2026, 05:00 p. m.');
  const sinHtml = armarC({}, false);
  eq('⭐ PD5b (patrón L4 A2) sin el cuerpo, el HTML no se arma', sinHtml.cuerpo, '');
  eq('PD5b …y todo lo demás sale IGUAL que el armado completo', JSON.stringify({ ...sinHtml, cuerpo: '' }), JSON.stringify({ ...a, cuerpo: '' }));
  const sinDatos = armarC({ completo: null });
  ok('PD5b sin los datos todavía: no revienta y sale con «Sin registros en el período.»', sinDatos.cuerpo.includes('Sin registros en el período.') && !/NaN|undefined/.test(sinDatos.cuerpo));
  eq('PD5b los otros papeles no traen el modelo del completo', armar({ papel: 'consolidado' }).completo, null);

  // Lo que no aplica al Reporte completo no se nombra ni en la pantalla ni en el archivo.
  eq('⭐ PD5b ningún filtro vale para el Reporte completo', intenta('filtrosDelPapel', () => R.filtrosDelPapel('completo', FILTROS), null), {});
  eq('⭐ PD5b el aviso de lo apagado nombra solo sus secciones (ni filtros ni tarjetas del resumen)',
    intenta('apagadoEnPalabras', () => R.apagadoEnPalabras('completo', op({ ocultosSecciones: ['patios'] }), FILTROS, { ocultos: ['viajes'] }), null), ['Sin «Entrada por patio»']);
  eq('PD5b el ORDEN no actúa en el Reporte completo', intenta('ordenActua', () => R.ordenActua('completo', op()), null), false);
  const nombre = intenta('nombreArchivoCop', () => P.nombreArchivoCop('completo', 'Sitio 1', { desde: RANGO.desde, hasta: RANGO.hasta, corteHora: null }, op({ ocultosSecciones: ['acero'] }), R.filtrosDelPapel('completo', FILTROS), a.nombresHojas), '');
  eq('⭐ PD5b el nombre del archivo lleva lo escondido (y nada de filtros)', nombre, 'Reporte completo Sitio 1 2026-10-06 al 2026-10-08 - sin acero');

  // Textos fijos: el Reporte completo no tiene título fijo; los logos sí son los del sitio.
  const fijos = { ...P.textosDe({ titulo_consolidado: 'Consolidado X', presentacion: 'P', consideraciones: 'C' }), logos: { ...DEF.logos, bcv: true } };
  const ini = intenta('opcionesIniciales', () => R.opcionesIniciales('completo', fijos, { ocultosSecciones: ['patios'], orden: 'az' }), op());
  eq('PD5b nace sin título, presentación ni consideraciones fijos, con los logos del sitio y lo que recuerda el equipo',
    [ini.titulo, ini.presentacion, ini.consideraciones, ini.logos.bcv, ini.ocultosSecciones], ['', '', '', true, ['patios']]);
  eq('PD5b «Guardar como texto fijo» solo escribe los logos (el título no es fijo)',
    intenta('cambiosTextosFijos', () => R.cambiosTextosFijos('completo', op({ titulo: 'Mi papel', logos: { ...DEF.logos, sos: true } }), fijos).map(([k]) => k), []), ['logos']);
  eq('PD5b los logos guardados desde otro papel le llegan', intenta('rebasarTextosFijos', () => R.rebasarTextosFijos('completo', op(), P.textosDe({}), fijos).logos.bcv, null), true);
  const mem = intenta('memoria', () => R.memoriaLeida('completo', R.memoriaParaGuardar('completo', op({ ocultosSecciones: ['patios', 'presentacion'] }), null, 's1'), 's1'), { opciones: {} });
  eq('PD5b la memoria del equipo guarda sus secciones (y descarta lo que no es de este papel)', mem.opciones.ocultosSecciones, ['patios']);
  const eds = intenta('edicionesAlCambiar', () => R.edicionesAlCambiar({ completo: {}, consolidado: { valores: { viajes: '9' } }, corte: {}, listado: {} }, 'rango'), {});
  eq('PD5b al cambiar el rango se limpian los valores a mano de todos los papeles (el completo incluido)', [Object.keys(eds).sort(), eds.consolidado?.valores ?? {}], [['completo', 'consolidado', 'corte', 'listado'], {}]);
  const vistas = intenta('seccionesEnPantalla', () => R.seccionesEnPantalla(a.completo, op({ ocultosSecciones: ['patios'] })), []);
  eq('PD5b la pantalla dice sus secciones visibles, numeradas como el papel, y cuáles saldrán sin registros',
    vistas.map((s) => [s.n, s.k, s.vacia]),
    [[1, 'reporteGeneral', false], [2, 'agregados', false], [3, 'acero', true], [4, 'aluminioPlastico', true], [5, 'maquinaria', false], [6, 'bloques', false]]);
  eq('PD5b …sin modelo todavía, ninguna', intenta('seccionesEnPantalla vacío', () => R.seccionesEnPantalla(null, op()), null), []);
  // A4: la venta de bloques no es un viaje, tampoco en «viajes por unidad» de la pantalla.
  const venta = mov({ tipo: 'salida', fecha: '2026-10-07', material: 'Bloques', cantidad: 10, viajes: null, unidadIngresada: 'u', destino: 'Cliente Prueba' });
  const conUnidad = BASE.filter((m) => m.unidadTexto); // sin renglones sueltos: «Sin unidad» solo saldría por la venta
  eq('PD5b A4 «viajes por unidad» no lista la venta de bloques (0 viajes en «Sin unidad»)',
    armar({ papel: 'listado', base: [...conUnidad, venta], op: op({ agruparListado: 'unidad' }) }).porUnidad.map((f) => f.clave),
    armar({ papel: 'listado', base: conUnidad, op: op({ agruparListado: 'unidad' }) }).porUnidad.map((f) => f.clave));
  ok('PD5b PAPELES_COP dice qué es el Reporte completo', /Parte diario/.test((R.PAPELES_COP ?? []).find((p) => p.k === 'completo')?.ayuda ?? ''));
}

// ═══════════════════════════ 2. LOS COMPONENTES (estáticos) ═══════════════════════════

const TAB = 'src/components/centroOperaciones/ReportesTab.tsx';
const EDITOR = 'src/components/centroOperaciones/EditorResumen.tsx';
const PANTALLA = 'src/screens/CentroOperacionesScreen.tsx';
ok('2.0 existe ReportesTab.tsx', existe(TAB));
ok('2.0 existe EditorResumen.tsx', existe(EDITOR));
const tab = sinComentarios(leer(TAB));
const editor = sinComentarios(leer(EDITOR));
const pantalla = sinComentarios(leer(PANTALLA));

// ——— 2.1 El PDF ———
{
  const pdf = llamada(tab, 'pdfDocument');
  ok('2.1 ReportesTab llama a pdfDocument', !!pdf);
  eq('⭐ L4 A8 2.1 pdfDocument es UNO solo (la vista previa y el PDF salen del mismo)', (tab.match(/pdfDocument\(/g) ?? []).length, 1);
  ok('⭐ 2.1 * con marcaTexto: false', /marcaTexto:\s*false/.test(pdf), pdf);
  ok('⭐ 2.1 * con los logos de las opciones', /logos:\s*op\.logos/.test(pdf), pdf);
  ok('⭐ 2.1 * con la emisión del armado (emitidaCop: escapada una sola vez)', /emitida:\s*armado\.emitida/.test(pdf), pdf);
  ok('2.1 * con el CSS del módulo', /extraCss:\s*CSS_COP/.test(pdf), pdf);
  ok('2.1 * título y subtítulo del armado (ya escapados)', /title:\s*armado\.titulo/.test(pdf) && /subtitle:\s*armado\.subtitulo/.test(pdf) && /body:\s*armado\.cuerpo/.test(pdf), pdf);
  const exp = llamada(tab, 'exportPdf');
  ok('⭐ 2.1 el nombre del PDF sale de nombreArchivoCop', /^exportPdf\(\s*\w+\s*,\s*nombreArchivoCop\(/.test(exp), exp);
  ok('2.1 * con el MISMO op y los filtros del papel', /nombreArchivoCop\(\s*papel\s*,[^)]*rango[^)]*,\s*op\s*,\s*filtrosDelPapel\(/.test(exp.replace(/\s+/g, ' ')), exp);
  ok('⭐ A3 * con el sitio solo y las hojas por el parámetro de unidades (nombres impresos)', /nombreArchivoCop\(\s*papel\s*,\s*sitio\.nombre\s*,/.test(exp) && /\.nombresHojas\b/.test(exp) && !/sitioParaArchivo/.test(tab), exp);
  ok('⭐ A3 la pestaña no tiene su propia emisión ni su propio período', !/emitidaPdf|periodoEnPalabras|corteEnPalabras|subtituloReporte/.test(tab));
  ok('⭐ L4 A1 la pestaña pasa la hora real (nowStamp de pdf.ts) al armado: la librería sigue pura y la emisión es una sola', /ahora:\s*nowStamp\(\)/.test(tab) && /import\s*\{[^}]*\bnowStamp\b[^}]*\}\s*from '\.\.\/\.\.\/lib\/pdf'/.test(tab));
  ok('2.1 el papel se arma con armarPapelCop y el MISMO op', /armarPapelCop\(\{[^}]*\bop\b/.test(tab.replace(/\s+/g, ' ')));
  ok('2.1 pdf.ts se importa de la casa', /from '\.\.\/\.\.\/lib\/pdf'/.test(tab));
}

// ——— L4 A2 = B4: cada tecla ya no rearma el papel entero ———
{
  const plano = tab.replace(/\s+/g, ' ');
  ok('⭐ L4 A2 la pantalla memoriza el MODELO sin el HTML (conCuerpo: false)', /useMemo<[^>]*>\(\s*\(\)\s*=>[^;]*armarPapelCop\([^;]*\{\s*conCuerpo:\s*false\s*\}/.test(plano));
  ok('⭐ L4 A2 …con el buscador diferido (useDeferredValue) y el op del modelo por su clave', /useDeferredValue\(\s*busca\s*\)/.test(tab) && /claveDelModelo\(\s*op\s*\)/.test(tab));
  ok('⭐ L4 A2 ningún useMemo arma el HTML de la hoja (htmlDelPapel)', !/useMemo\([^;]*htmlDelPapel\(/.test(plano));
  const pdfFn = /const bajarPdf = async \(\) => \{([^]*?)\n {2}\};/.exec(tab);
  const cuerpoPdf = pdfFn ? pdfFn[1] : '';
  ok('⭐ L4 A2 el PDF se arma EN EL TOQUE, completo (armarPapelCop + htmlDelPapel dentro de bajarPdf)', /armarPapelCop\(/.test(cuerpoPdf) && /htmlDelPapel\(/.test(cuerpoPdf) && !/conCuerpo/.test(cuerpoPdf));
  ok('⭐ L4 A2 …y NUNCA de un valor diferido (usa el buscador de este instante)', /filtros:\s*filtrosConBusca/.test(cuerpoPdf) && !/Diferid|deferred/i.test(cuerpoPdf) && /const filtrosConBusca = useMemo<FiltrosCop>\(\(\) => \(\{ \.\.\.filtros, texto: busca \}\)/.test(tab));
  ok('⭐ L4 A2 la hoja abierta se arma tras una espera de ~400 ms desde la última tecla', /ESPERA_HOJA_MS\s*=\s*400\b/.test(tab) && /setTimeout\(\(\)\s*=>\s*\{[^}]*htmlDelPapel\([^}]*\},\s*ESPERA_HOJA_MS\)/.test(plano) && /clearTimeout\(/.test(tab));
  ok('L4 A2 el equipo se escribe solo si lo que se guarda cambió', /ultimaGuardada\.current\[papel\]\s*===\s*crudo/.test(tab));
}

// ——— 2.2 La memoria del equipo ———
{
  ok('⭐ 2.2 la clave es cop_opciones_<papel>', /`cop_opciones_\$\{\s*papel\s*\}`/.test(tab) || /'cop_opciones_'\s*\+\s*papel/.test(tab));
  const usos = [...tab.matchAll(/AsyncStorage\.(getItem|setItem|removeItem)\(/g)].map((m) => m.index);
  ok('2.2 se lee y se guarda en el equipo', usos.length >= 2 && /AsyncStorage\.getItem\(/.test(tab) && /AsyncStorage\.setItem\(/.test(tab));
  const dentroDeTry = (i) => {
    const t = tab.lastIndexOf('try {', i);
    return t >= 0 && !tab.slice(t, i).includes('catch');
  };
  ok('⭐ 2.2 cada lectura y escritura del equipo va dentro de try/catch', usos.length > 0 && usos.every(dentroDeTry));
  ok('2.2 lo que se guarda pasa por memoriaParaGuardar y se lee con memoriaLeida', /memoriaParaGuardar\(/.test(tab) && /memoriaLeida\(/.test(tab));
  ok('⭐ L4 B3 la pestaña guarda y lee la memoria CON el sitio', /memoriaParaGuardar\([^)]*,\s*sitio\.id\s*\)/.test(tab) && /memoriaLeida\(\s*p\s*,\s*crudo\s*,\s*sitio\.id\s*\)/.test(tab));
}

// ——— 2.3 Al cambiar el rango (y, L4 B1, las unidades o los filtros), los valores a mano se limpian ———
// ⭐ L4 A8: cada llamada tiene que estar DENTRO de un solo efecto (se recorre cada
//    `useEffect(…)` con sus paréntesis balanceados), no en un manejador cualquiera.
const EFECTOS = (() => {
  const r = [];
  for (let i = tab.indexOf('useEffect('); i >= 0; i = tab.indexOf('useEffect(', i + 1)) {
    const txt = llamada(tab, 'useEffect', i);
    const deps = /,\s*\[([^\]]*)\]\s*\)$/.exec(txt);
    r.push({ txt, deps: deps ? deps[1] : null });
  }
  return r;
})();
{
  const rango = EFECTOS.find((e) => /edicionAlCambiarDeDia\(/.test(e.txt));
  ok('⭐ 2.3 un efecto aplica edicionAlCambiarDeDia', !!rango);
  ok('⭐ 2.3 * cuando cambia el rango (desde, hasta y hora de corte)', !!rango && /desde/.test(rango.deps ?? '') && /hasta/.test(rango.deps ?? '') && /corte/i.test(rango.deps ?? ''), rango ? rango.deps : '');
  const unidades = EFECTOS.find((e) => /edicionesAlCambiar\(\s*\w+\s*,\s*'unidades'\s*\)/.test(e.txt));
  ok('⭐ L4 B1 un efecto limpia los valores del corte al cambiar sus unidades', !!unidades && /claveUnidadesEd/.test(unidades.deps ?? '') && /const claveUnidadesEd = unidadesCorte\.join\(/.test(tab), unidades ? unidades.deps : '');
  const filtros = EFECTOS.find((e) => /edicionesAlCambiar\(\s*\w+\s*,\s*'filtros'\s*\)/.test(e.txt));
  ok('⭐ L4 B1 otro limpia los de los tres papeles al cambiar los filtros o el buscador (diferido)', !!filtros && /claveFiltrosEd/.test(filtros.deps ?? '') && /firmaFiltros\(\s*filtros\s*,\s*buscaDiferida\s*\)/.test(tab), filtros ? filtros.deps : '');
}

// ——— 2.4 Ninguna escritura salvo guardarAjuste ———
for (const [n, code] of [['ReportesTab', tab], ['EditorResumen', editor]]) {
  ok(`⭐ 2.4 ${n} no llama a insert/update/upsert/delete/rpc`, !/\.(insert|update|upsert|delete|rpc)\s*\(/.test(code));
  ok(`2.4 ${n} no habla con Supabase`, !/supabase/i.test(code));
  ok(`2.4 ${n} no borra nada`, !/\b(borrar|eliminar|remove)\w*\s*\(/i.test(code));
}
{
  const imp = /import\s*\{([^}]*)\}\s*from\s*'\.\.\/\.\.\/lib\/centroOperacionesDb'/.exec(tab);
  const nombres = imp ? imp[1].split(',').map((x) => x.trim()).filter(Boolean).sort() : [];
  eq('⭐ 2.4 de la capa de datos solo lee… y guardarAjuste (M5: más la lectura de inspección)', nombres, ['cargarAjustes', 'cargarDatosReporteCompleto', 'cargarEstadoInspeccion', 'cargarMovimientos', 'cargarUnidades', 'guardarAjuste']);
  ok('2.4 EditorResumen no toca la capa de datos', !/centroOperacionesDb/.test(editor));
  ok('2.4 guardarAjuste solo con Full', /levelMeets\(\s*nivel\s*,\s*'full'\s*\)/.test(tab) && /guardarAjuste\(/.test(tab));
  {
    // ⭐ L4 A8: no basta con que las dos cosas aparezcan en el archivo: la guarda va al
    //    INICIO de la función que llama a guardarAjuste, y el botón dentro de `esFull ?`.
    const guardar = /const guardarTextosFijos = async \(\) => \{([^]*?)\n {2}\};/.exec(tab)?.[1] ?? '';
    ok('⭐ L4 A8 2.4 guardarTextosFijos empieza con la guarda de Full', /^\s*if \(!levelMeets\(nivel, 'full'\)/.test(guardar), guardar.slice(0, 80));
    ok('⭐ L4 A8 2.4 guardarAjuste solo se llama dentro de guardarTextosFijos', (tab.match(/guardarAjuste\(/g) ?? []).length === 1 && /guardarAjuste\(/.test(guardar));
    const boton = tab.indexOf('onPress={guardarTextosFijos}');
    const abre = tab.lastIndexOf('{esFull ? (', boton);
    ok('⭐ L4 A8 2.4 el botón «Guardar como texto fijo» está dentro de esFull ? (…)', boton > 0 && abre > 0 && !tab.slice(abre, boton).includes(') : null}'));
  }
  ok('2.4 * y lo que guarda sale de cambiosTextosFijos', /cambiosTextosFijos\(/.test(tab));
  {
    const guardar = /const guardarTextosFijos = async \(\) => \{([^]*?)\n {2}\};/.exec(tab)?.[1] ?? '';
    const recargarTxt = /const recargar = useCallback\(async \(\) => \{([^]*?)\n {2}\}, \[/.exec(tab)?.[1] ?? '';
    ok('⭐ L4 A7 tras un guardado bueno, lo guardado pasa a los TRES papeles (rebasarTextosFijos)', /rebasarTextosFijos\(/.test(guardar) && /porPapel\(/.test(guardar));
    ok('⭐ L4 A7 cada carga (también 🔄) pone al día los tres papeles sin pisar lo tecleado', /rebasarTextosFijos\(/.test(recargarTxt) && !/textosPuestos/.test(tab));
    ok('L4 A7 la pantalla dice que los logos valen para todos los papeles del sitio (PD5b: ya son cuatro)', /valen para todos los papeles del sitio/.test(tab) && !/los logos de este papel/.test(tab) && !/los tres papeles/.test(tab));
  }
  ok('2.4 el rechazo de la base se dice con useToast', /useToast\(\)/.test(tab) && /toast\.error\(/.test(tab));
}

// ——— 2.5 Las piezas de la casa y las opciones en pantalla ———
{
  ok('2.5 Toggle de CubicajeTab', /import\s*\{\s*Toggle\s*\}\s*from\s*'\.\.\/CubicajeTab'/.test(tab));
  ok('2.5 DateField', /from '\.\.\/DateField'/.test(tab));
  ok('2.5 useTheme, spacing y radius', /useTheme\(\)/.test(tab) && /spacing/.test(tab) && /radius/.test(tab));
  ok('2.5 los interruptores de «¿Qué se oculta?» salen de SECCIONES_COP y COLUMNAS_COP', /SECCIONES_COP\[/.test(tab) && /COLUMNAS_COP\[/.test(tab));
  ok('2.5 las pastillas de papel salen de PAPELES_COP', /PAPELES_COP\.map\(/.test(tab));
  ok('2.5 el rango se valida (hora de corte y fechas)', /validarRango\(/.test(tab));
  ok('2.5 el aviso de lo apagado es de la pantalla', /apagadoEnPalabras\(/.test(tab));
  ok('2.5 «Guardar como texto fijo»', /Guardar como texto fijo/.test(tab));
  ok('2.5 EditorResumen está montado', /<EditorResumen\b/.test(tab));
  ok('⭐ A3 los textos fijos llegan de cop_ajustes del sitio, leídos con textosDe (el mismo lector de ⚙️ Ajustes)', /cargarAjustes\(\s*sitio\.id\s*\)/.test(tab) && /\btextosDe\(/.test(tab) && !/textosFijosDe/.test(tab));
  ok('2.5 se elige una o varias unidades para el corte', /opcionesUnidadCorte\(/.test(tab));
  ok('⭐ L4 A5 las opciones del corte se arman con el rango (para saber quién tiene viajes del corte)', /opcionesUnidadCorte\(\s*base\s*,\s*unidades\s*,\s*rango\s*\)/.test(tab));
  ok('L4 A5 las que no tienen viajes del corte se nombran así', /\(sin viajes del corte\)/.test(tab));
  {
    const iframe = llamada(tab, 'React.createElement');
    ok('⭐ L4 B5 la hoja de la vista previa va en un iframe con sandbox (sin scripts ni el origen de la app)', /'iframe'/.test(iframe) && /sandbox:\s*''/.test(iframe), iframe.slice(0, 200));
  }
  ok('⭐ L4 B6 el editor del resumen sigue a lo que el papel imprime (opDelCuerpo con los filtros)', /const conTarjetas = [^;]*opDelCuerpo\(\s*papel\s*,\s*op\s*,\s*filtrosConBusca\s*\)/.test(tab.replace(/\s+/g, ' ')));
  ok('⭐ L4 A6 el control ORDEN se pinta solo si ordenActua(papel, op)', /ordenActua\(\s*papel\s*,\s*op\s*\)\s*\?\s*\(\s*<>\s*<Text style=\{etiqueta\}>ORDEN<\/Text>/.test(tab.replace(/\s+/g, ' ')));
  ok('2.5 una respuesta vieja (otro rango) no pisa la nueva', /const yo = \+\+pedido\.current/.test(tab) && /if \(yo !== pedido\.current\) return/.test(tab));
  ok('2.5 el PDF espera a que la base sea la del rango elegido', /cargadoDe === `\$\{rango\.desde\}\|\$\{rango\.hasta\}`/.test(tab));
}

// ——— PD5b: el Reporte completo en la pestaña ———
{
  const plano = tab.replace(/\s+/g, ' ');
  ok('PD5b la pestaña abre en el Reporte completo (el primero de la lista)', /useState<PapelCop>\('completo'\)/.test(tab));
  eq('⭐ PD5b cargarDatosReporteCompleto se llama UNA vez', (tab.match(/cargarDatosReporteCompleto\(/g) ?? []).length, 1);
  const cargaC = /const recargarCompleto = useCallback\(async \(\) => \{([^]*?)\n {2}\}, \[/.exec(tab)?.[1] ?? '';
  ok('⭐ PD5b …dentro de su propia carga (recargarCompleto)', /cargarDatosReporteCompleto\(/.test(cargaC));
  ok('⭐ PD5b …con la guarda de respuestas viejas (su propio número de pedido)', /const yo = \+\+pedidoCompleto\.current/.test(cargaC)
    && (cargaC.match(/if \(yo !== pedidoCompleto\.current\) return/g) ?? []).length >= 2 && /finally \{\s*if \(yo === pedidoCompleto\.current\)/.test(cargaC));
  ok('PD5b …y el mismo manejo de errores (aviso en pantalla y toast)', /setErrorCompleto\(/.test(cargaC) && /toast\.error\(/.test(cargaC));
  const efecto = EFECTOS.find((e) => /recargarCompleto\(\)/.test(e.txt));
  ok('⭐ PD5b se carga SOLO con el Reporte completo elegido', !!efecto && /if \(esCompleto\) recargarCompleto\(\)/.test(efecto.txt) && /esCompleto/.test(efecto.deps ?? ''), efecto ? efecto.txt : '');
  ok('PD5b 🔄 también recarga el Reporte completo cuando es el elegido', /const actualizar = \(\) => \{[^}]*recargar\(\);[^}]*if \(esCompleto\) recargarCompleto\(\);/.test(plano) && /onPress=\{actualizar\}/.test(tab));
  ok('⭐ PD5b el PDF y la vista previa esperan los datos del Reporte completo de ESE rango', /completoDe === claveRango/.test(tab) && /const listo = [^;]*\(!esCompleto \|\| [^;]*completoDe === claveRango/.test(plano));
  const pdfFn = /const bajarPdf = async \(\) => \{([^]*?)\n {2}\};/.exec(tab)?.[1] ?? '';
  ok('⭐ PD5b el PDF lleva los datos del Reporte completo (armado en el toque, con el «hoy» de ese instante)', /completo:\s*datosDelCompleto\(\s*lectura\s*\)/.test(pdfFn) && /caracasBusinessToday\(\)/.test(/const datosDelCompleto = [^;]*;/.exec(plano)?.[0] ?? ''));
  ok('PD5b el modelo de la pantalla también (sin HTML)', /armarPapelCop\(\{[^}]*completo:\s*completoModelo[^}]*\},\s*\{\s*conCuerpo:\s*false\s*\}\)/.test(plano));
  // Lo que no aplica al Reporte completo no se muestra con él.
  const dentroDeNoCompleto = (marca) => {
    const i = tab.indexOf(marca);
    const abre = tab.lastIndexOf('{!esCompleto ? (', i);
    return i > 0 && abre > 0 && !tab.slice(abre, i).includes(') : null}');
  };
  ok('⭐ PD5b sin la hora de corte', dentroDeNoCompleto('HORA DE CORTE (OPCIONAL)'));
  ok('⭐ PD5b sin el buscador', dentroDeNoCompleto('placeholder="🔎 Buscar'));
  ok('⭐ PD5b sin los filtros', dentroDeNoCompleto('titulo="🎛️ Filtros"'));
  ok('⭐ PD5b sin el editor del resumen (no tiene tarjetas editables)', /const conTarjetas = papel !== 'listado' && !esCompleto && /.test(plano));
  ok('PD5b la etiqueta COLUMNAS solo si el papel tiene columnas', /COLUMNAS_COP\[papel\]\.length \? <Text style=\{etiqueta\}>COLUMNAS<\/Text> : null/.test(plano));
  ok('PD5b el rango del Reporte completo se valida SIN la hora de corte (jornadas enteras)', /validarRango\(\{\s*desde: fechas\.desde, hasta: fechas\.hasta, corte: ''\s*\}\)/.test(plano));
  ok('PD5b cambiar al Reporte completo no limpia los valores a mano de los otros (el efecto mira la hora de corte de ellos)',
    !!EFECTOS.find((e) => /edicionAlCambiarDeDia\(/.test(e.txt) && /validacion\.rango\?\.corteHora/.test(e.deps ?? '')));
}

// ——— M5: el Reporte completo lee inspección AL EMITIR (mesa de maquinaria §4.3) ———
{
  const plano = tab.replace(/\s+/g, ' ');
  const pdfFn = /const bajarPdf = async \(\) => \{([^]*?)\n {2}\};/.exec(tab)?.[1] ?? '';
  const iLeer = pdfFn.indexOf('leerInspeccionAlEmitir(');
  const iArmar = pdfFn.indexOf('armarPapelCop(');
  ok('⭐ M5.1 el PDF lee inspección EN EL TOQUE, antes de armar el papel', iLeer >= 0 && iArmar > iLeer, pdfFn);
  ok('⭐ M5.1 * solo con el Reporte completo, con el lector de la capa de datos y las secciones de ESE instante',
    /esCompleto\s*\?\s*await leerInspeccionAlEmitir\(\s*\{\s*unidades:\s*datosCompleto\?\.unidades\s*\?\?\s*\[\],\s*ocultosSecciones:\s*op\.ocultosSecciones\s*\},\s*cargarEstadoInspeccion\s*\)/.test(pdfFn.replace(/\s+/g, ' ')), pdfFn);
  ok('⭐ M5.2 si la lectura falla, el PDF sale IGUAL (un aviso, sin cortar el armado)',
    /if \(lectura\?\.error\) toast\.info\(/.test(pdfFn) && iLeer >= 0 && iArmar > iLeer && !/\breturn\b/.test(pdfFn.slice(iLeer, iArmar)), pdfFn.slice(iLeer, iArmar));
  ok('⭐ M5.3 la capa de datos de inspección NUNCA se llama directo desde la pestaña (siempre por leerInspeccionAlEmitir)', !/cargarEstadoInspeccion\(/.test(tab));
  ok('M5.3 * leerInspeccionAlEmitir viene de la librería del Reporte completo', /import\s*\{[^}]*\bleerInspeccionAlEmitir\b[^}]*\}\s*from\s*'\.\.\/\.\.\/lib\/centroOperacionesReporteCompleto'/.test(tab));
  ok('⭐ M5.4 lo leído y su hora van al papel (inspeccion + emitidoMs)', /const datosDelCompleto = \(lectura[^)]*\)[^;]*inspeccion:\s*lectura\?\.inspeccion\s*\?\?\s*null[^;]*emitidoMs:\s*lectura\?\.ms\s*\?\?\s*null/.test(plano), /const datosDelCompleto = [^;]*;/.exec(plano)?.[0] ?? '');
  const efHoja = EFECTOS.find((e) => /leerInspeccionAlEmitir\(/.test(e.txt));
  ok('⭐ M5.5 la hoja abierta lee inspección UNA vez por carga (un efecto, con la guarda de respuesta vieja)',
    !!efHoja && /inspHojaVigente/.test(efHoja.txt) && /inspHoja\?\.de === datosCompleto/.test(plano) && /let vivo = true/.test(efHoja.txt) && /vivo = false/.test(efHoja.txt), efHoja ? efHoja.txt : '');
  // Lote 6 B14: con la sección 🚜 oculta la hoja ni lee, ni espera, ni avisa (como el PDF); al prenderla, lee entonces.
  ok('⭐ B14 la hoja pasa las secciones ocultas a la lectura (con 🚜 oculta no se consulta nada)',
    !!efHoja && /leerInspeccionAlEmitir\(\{ unidades: de\.unidades, ocultosSecciones: op\.ocultosSecciones \}, cargarEstadoInspeccion\)/.test(efHoja.txt), efHoja ? efHoja.txt : '');
  ok('⭐ B14 * la caché recuerda si se leyó con la sección oculta: vale la lectura que consultó, o la que no consultó porque sigue oculta (al prender 🚜 se lee)',
    /const inspHojaVigente = !!datosCompleto && inspHoja\?\.de === datosCompleto && \(inspHoja\.lectura\.consulto \|\| inspHoja\.oculta === maqOculta\);/.test(plano)
    && /setInspHoja\(\{ de, oculta, lectura \}\)/.test(plano) && /const maqOculta = \(op\.ocultosSecciones \?\? \[\]\)\.includes\('maquinaria'\);/.test(plano));
  ok('B14 * el aviso de la hoja no sale con 🚜 oculta', /inspHojaLista && !maqOculta && inspHoja\?\.lectura\.error/.test(plano));
  // Lote 6 B13: el botón dice «🔎 Leyendo inspección…» mientras lee; si no se pudo, el aviso queda fijo debajo (además del toast); el tope de 20 s no se baja.
  ok('⭐ B13 el botón 📄 PDF dice «🔎 Leyendo inspección…» mientras lee y «Armando el PDF…» después',
    /setLeyendoInspPdf\(esCompleto\);/.test(pdfFn) && /\{exportando \? \(leyendoInspPdf \? '🔎 Leyendo inspección…' : 'Armando el PDF…'\) : '📄 PDF'\}/.test(tab));
  ok('⭐ B13 * si falló, el aviso queda FIJO debajo del botón (además del toast) y se limpia al volver a tocar',
    /if \(lectura\?\.error\) setAvisoInspPdf\(/.test(pdfFn) && /setAvisoInspPdf\(null\);/.test(pdfFn) && /\{avisoInspPdf \? \(/.test(tab) && /⚠️ \{avisoInspPdf\}/.test(tab));
  ok('B13 * el tope del papel sigue en 20 s (tres rondas de consultas en serie: bajarlo cortaría lecturas buenas)',
    /export const TOPE_INSPECCION_MS = 20000;/.test(leer('src/lib/centroOperacionesReporteCompleto.ts')));
  const efPrevia = EFECTOS.find((e) => /setHtmlPrevia\(/.test(e.txt));
  ok('⭐ M5.5 * y la hoja espera esa lectura (no pinta «Sin dato» por no haber leído todavía)', !!efPrevia && /if \(!hojaPosible \|\| !inspHojaLista\) \{ setHtmlPrevia\(''\); return; \}/.test(efPrevia.txt) && /inspHojaLista/.test(efPrevia.deps ?? ''), efPrevia ? efPrevia.txt : '');
  ok('M5.5 * la hoja arma con lo que leyó (papelDeAhora usa la lectura de la hoja)', /const papelDeAhora = [^;]*completo:\s*datosDelCompleto\(\s*inspHoja\?\.lectura\s*\)/.test(plano));
  ok('M5.6 la pantalla dice si la hoja no pudo leer inspección', /inspHoja\?\.lectura\.error/.test(tab));
  ok('M5.7 el modelo de la pantalla NO lee inspección (sin HTML; solo dice qué secciones salen)', /const completoModelo = useMemo\(\(\) => \(esCompleto && datosCompleto \? \{ datos: datosCompleto, hoy: caracasBusinessToday\(\) \} : null\)/.test(plano));
}

// ——— 2.6 El editor del resumen ———
{
  ok('2.6 EditorResumen usa el contrato EdicionResumen', /EdicionResumen/.test(editor) && /from '\.\.\/\.\.\/lib\/frentesReporte'/.test(editor));
  ok('2.6 * esconder, título, valor y nota por clave', /alternarOcultoResumen\(/.test(editor) && /'titulos'/.test(editor) && /'valores'/.test(editor) && /'notas'/.test(editor));
  ok('2.6 * hasta MAX_TARJETAS_PROPIAS_COP tarjetas propias', /MAX_TARJETAS_PROPIAS_COP/.test(editor) && /agregarTarjetaPropia\(/.test(editor) && /quitarTarjetaPropia\(/.test(editor));
  ok('2.6 * y volver al automático', /EDICION_RESUMEN_VACIA|\{\s*\}\s*\)/.test(editor));
}

// ——— 2.7 La pantalla monta la pestaña de verdad ———
{
  ok('⭐ 2.7 la pantalla importa ReportesTab de su componente', /from '\.\.\/components\/centroOperaciones\/ReportesTab'/.test(pantalla));
  ok('2.7 * y ya no tiene su marcador «En construcción»', !/function ReportesTab\(/.test(pantalla) && !/En construcción/.test(pantalla));
  ok('2.7 * la monta con el sitio y el nivel (una por sitio)', /<ReportesTab\s+key=\{sitio\.id\}\s+sitio=\{sitio\}\s+nivel=\{nivel\}\s*\/>/.test(pantalla));
}

console.log(`${fail === 0 ? '✅' : '❌'} test-centro-operaciones-reportes · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Los tres papeles salen con sus opciones, sin anunciarlas, y la pestaña solo escribe textos fijos.');
