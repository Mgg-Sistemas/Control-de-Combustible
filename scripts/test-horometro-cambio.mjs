// 🔁 Pruebas del CAMBIO DE HORÓMETRO FÍSICO (10-oct-2026).
//
// Reglas de la casa que se vigilan acá:
// - El aparato nuevo SIENTA BASE (reinicio): nada se marca «menor que ayer».
// - Las ± horas reconocidas entran al pago del día con su precio, nunca en negativo.
// - El reporte ⚙️ Horómetro dice «Cambio de horómetro» como causa, con sus ± horas
//   y su motivo — no un retroceso ni un «jornada mayor» sin explicación.
// - Un cambio no se edita ni se borra: se anula con motivo.
// - Las fotos son opcionales, con cámara Y galería (regla del 27-sep).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

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

const P = loadTs(path.join(ROOT, 'src/lib/pagoHorometro.ts'));
const H = loadTs(path.join(ROOT, 'src/lib/horometroTrabajo.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ——— 1. Las piezas puras del pago ———
const CAMBIO = (over = {}) => ({
  id: 'c1', machinery_id: 'm1', round_date: '2026-10-08', shift: 'day',
  lectura_vieja: 1250.4, lectura_nueva: 0, horas_ajuste: 1.5, motivo: 'se dañó el tablero',
  anulada_at: null, ...over,
});
{
  const m = P.cambiosPorClave([CAMBIO(), CAMBIO({ id: 'c2', horas_ajuste: -0.5, motivo: 'otra cosa' })]);
  eq('los cambios del mismo día se suman y juntan motivos', m.get('m1|2026-10-08'), { horas: 1, motivos: ['se dañó el tablero', 'otra cosa'] });
  eq('un cambio ANULADO no cuenta', P.cambiosPorClave([CAMBIO({ anulada_at: 'x' })]).size, 0);
  eq('texto de horas: positivo', P.horasCambioTexto(1.5), '+1,5 h');
  eq('texto de horas: negativo', P.horasCambioTexto(-2), '−2 h');
  eq('texto de horas: cero = nada', P.horasCambioTexto(0), '');
}
{
  const v = P.validarCambioHorometro;
  ok('sin motivo NO pasa', !!v({ nuevaInicial: 0, nuevaFinal: null, horasAjuste: 0, motivo: ' ' }));
  ok('sin la inicial del nuevo NO pasa', !!v({ nuevaInicial: null, nuevaFinal: null, horasAjuste: 0, motivo: 'x' }));
  ok('final menor que inicial NO pasa', !!v({ nuevaInicial: 5, nuevaFinal: 3, horasAjuste: 0, motivo: 'x' }));
  ok('salto de más de 12,5 h NO pasa', !!v({ nuevaInicial: 0, nuevaFinal: 13, horasAjuste: 0, motivo: 'x' }));
  ok('más de 24 h reconocidas NO pasa', !!v({ nuevaInicial: 0, nuevaFinal: null, horasAjuste: 25, motivo: 'x' }));
  eq('el caso bueno pasa (nuevo en 0, +1,5 h, con motivo)', v({ nuevaInicial: 0, nuevaFinal: 6, horasAjuste: 1.5, motivo: 'cambio' }), null);
}

// ——— 2. El pago del día con el cambio ———
const LECT = (machineryId, roundDate, shift, inicial, final, over = {}) => ({
  machineryId, roundDate, shift, inicial, final, valida: true, motivoInvalida: null,
  reinicio: false, origen: 'inspector', corregidoPor: null, motivoCorreccion: null, ...over,
});
const MAQ = { id: 'm1', code: 'RETRO-01', placa: 'P-1', empresa: 'ALFA', clasificacion: 'X', marca: '', modelo: '' };
const PRECIO = { id: 'p1', machinery_id: 'm1', precio_hora: 10, desde: '2026-10-01', hasta: null, anulada_at: null };
{
  const filas = P.filasPagoHorometro({
    maquinas: [MAQ], lecturas: [LECT('m1', '2026-10-08', 'day', 0, 5, { reinicio: true, origen: 'control' })],
    precios: [PRECIO], desde: '2026-10-08', hasta: '2026-10-08', cambios: [CAMBIO()],
  });
  const d = filas[0].dias[0];
  eq('⭐⭐ el día paga lectura + horas reconocidas (5 + 1,5 = 6,5 h · $65)', [d.horas, d.monto, d.cambio, d.horasCambio], [6.5, 65, true, 1.5]);
  eq('el motivo del cambio viaja en el día', d.motivoCambio, 'se dañó el tablero');
  eq('la fila suma con el cambio incluido', [filas[0].horas, filas[0].monto], [6.5, 65]);
}
{
  const filas = P.filasPagoHorometro({
    maquinas: [MAQ], lecturas: [LECT('m1', '2026-10-08', 'day', 0, 1)],
    precios: [PRECIO], desde: '2026-10-08', hasta: '2026-10-08', cambios: [CAMBIO({ horas_ajuste: -5 })],
  });
  eq('⭐ restar nunca deja el día en negativo (1 − 5 → 0 h)', filas[0].dias[0].horas, 0);
}
{
  const filas = P.filasPagoHorometro({
    maquinas: [MAQ], lecturas: [], precios: [PRECIO],
    desde: '2026-10-08', hasta: '2026-10-08', cambios: [CAMBIO()],
  });
  ok('⭐ una máquina SOLO con cambio igual aparece (hay que poder verlo)', filas.length === 1 && filas[0].dias[0].cambio);
}
{
  const html = P.cuerpoPagoHorometro({
    desde: '2026-10-08', hasta: '2026-10-08',
    filas: P.filasPagoHorometro({
      maquinas: [MAQ], lecturas: [LECT('m1', '2026-10-08', 'day', 0, 5)],
      precios: [PRECIO], desde: '2026-10-08', hasta: '2026-10-08', cambios: [CAMBIO()],
    }),
  }, { ...P.OPCIONES_PAGO_HOROMETRO, sinDias: false }); // el detalle día por día nace oculto
  ok('el PDF del pago dice el cambio con sus ± horas y su motivo',
    html.includes('🔁 cambio de horómetro') && html.includes('+1,5 h') && html.includes('se dañó el tablero'));
}

// ——— 3. El comparativo (el reporte ⚙️ Horómetro) ———
const RONDA = (machineryId, code, fecha, dia, noche) => ({ machineryId, code, empresa: 'ALFA', fecha, ronda: { dia, noche, parada: 0, extras: 0 } });
const CC = { machineryId: 'm1', fecha: '2026-10-08', horasAjuste: 1.5, motivo: 'se dañó el tablero' };
{
  // Jornada de 6,5 h; el aparato nuevo marcó 0→5; con +1,5 reconocidas, cuadra.
  const f = H.compararJornadaHorometro(
    [RONDA('m1', 'RETRO-01', '2026-10-08', 6.5, 0)],
    [LECT('m1', '2026-10-08', 'day', 0, 5, { reinicio: true, origen: 'control', corregidoPor: 'u1', motivoCorreccion: 'Cambio de horómetro: se dañó el tablero' })],
    null, [CC],
  )[0];
  eq('⭐⭐ con las horas reconocidas el día CUADRA (5 + 1,5 vs 6,5)', [f.horasHorometro, f.estado, f.cambio], [6.5, 'cuadra', true]);
  ok('⭐⭐ el ESTADO dice la causa: «Cambio de horómetro…», no un choque',
    H.etiquetaDeEstado(f).startsWith('Cambio de horómetro') && H.etiquetaDeEstado(f).includes('+1,5 h reconocidas') && H.etiquetaDeEstado(f).includes('se dañó el tablero'));
}
{
  // El checkbox viejo (reinicio sin registro de cambio) también se dice.
  const f = H.compararJornadaHorometro(
    [RONDA('m1', 'RETRO-01', '2026-10-08', 5, 0)],
    [LECT('m1', '2026-10-08', 'day', 0, 5, { reinicio: true, origen: 'control', corregidoPor: 'u1' })],
  )[0];
  eq('una lectura con reinicio (sin registro) también marca el cambio', [f.cambio, f.cambioDetalle], [true, 'reinicio del aparato']);
}
{
  // Inválida por otra razón + cambio: el estado dice las dos cosas.
  const f = H.compararJornadaHorometro(
    [RONDA('m1', 'RETRO-01', '2026-10-08', 5, 0)],
    [LECT('m1', '2026-10-08', 'day', 5, 3, { valida: false, motivoInvalida: 'final menor que inicial' })],
    null, [CC],
  )[0];
  eq('inválida + cambio: el estado dice las dos cosas', f.estadoDetalle, 'final menor que inicial · hubo cambio de horómetro');
}
{
  // Sin jornada: las horas reconocidas también entran.
  const f = H.compararJornadaHorometro([], [LECT('m1', '2026-10-08', 'day', 0, 5)], null, [CC])[0];
  eq('sin jornada: el horómetro del día ya trae las ± horas', [f.estado, f.horasHorometro, f.cambio], ['sin_ronda', 6.5, true]);
}
{
  const filas = H.compararJornadaHorometro(
    [RONDA('m1', 'RETRO-01', '2026-10-08', 6.5, 0)],
    [LECT('m1', '2026-10-08', 'day', 0, 5, { reinicio: true, origen: 'control', corregidoPor: 'u1' })],
    null, [CC],
  );
  const r = H.resumenComparativo(filas);
  eq('el resumen cuenta los cambios', r.cambios, 1);
  const html = H.cuerpoComparativo({ desde: '2026-10-08', hasta: '2026-10-08', filas });
  ok('el papel trae la caja y la marca 🔁 (y explica qué significa)',
    html.includes('🔁 cambios de horómetro') && html.includes('🔁 cambio de horómetro') && html.includes('sienta base nueva'));
  ok('⭐ la fila del cambio NO sale como «✎ corregido desde Control» (esa era la confusión)',
    !/✎ corregido desde Control/.test(html));
}

// ——— 4. Candados sobre el código fuente ———
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const modal = leer('src/components/HorometroCambioModal.tsx');
ok('⭐⭐ la lectura del día va con reinicio y origen control (la base protege lo corregido)',
  /origen: 'control',\s*\n\s*reinicio: true,/.test(modal) && modal.includes("motivoCorreccion: `Cambio de horómetro: ${motivo.trim()}`"));
ok('⭐ el registro del cambio se guarda con crearCambioHorometro', /crearCambioHorometro\(\{/.test(modal));
ok('📷 fotos OPCIONALES con cámara Y galería (regla de la casa)',
  /takePhotoAndUpload\(machineryId, 'horometro'\)/.test(modal) && /pickPhotoFromGalleryAndUpload\(machineryId, 'horometro'\)/.test(modal) && modal.includes('opcional'));
ok('📷 las fotos también van al histórico del horómetro (salen en el reporte)', /agregarFotoHorometro\(\{ machineryId, roundDate: fecha, shift: turno, url/.test(modal));
ok('↺ anular exige motivo y doble toque', modal.includes('toca otra vez ↺ Anular') && /anularCambioHorometro\(c\.id, m\)/.test(modal));

const db = leer('src/lib/pagoHorometroDb.ts');
ok('⭐ las escrituras del cambio piden .select(\'id\') (0 filas = sin permiso, se dice)',
  /from\('horometro_cambios'\)\.insert\(\{[\s\S]*?\}\)\.select\('id'\)/.test(db.replace(/\n/g, ' ')) || (db.includes("from('horometro_cambios').insert(") && db.includes('SIN_PERMISO_CAMBIO_HOROMETRO')));
ok('⭐ un cambio no se borra: se anula con motivo', /anularCambioHorometro/.test(db) && !/horometro_cambios'\)\s*\.delete\(/.test(db));
ok('si falta la tabla, el módulo sigue (missing, no crash)', /horometro_\(precios\|ajustes\|cierres\|cambios\)/.test(db));

const compDb = leer('src/lib/horometroComparativoDb.ts');
ok('el comparativo carga los cambios del rango y filtra anuladas', /cargarCambiosHorometro\(desde, hasta\)/.test(compDb) && /filter\(\(c\) => !c\.anulada_at\)/.test(compDb));

// ——— Cierre ———
console.log(`\n🔁 Cambio de horómetro: ${pass} OK · ${fail} FALLO(S)`);
if (fail) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('   El aparato nuevo sienta base, las horas se reconocen y el papel dice la causa.');
