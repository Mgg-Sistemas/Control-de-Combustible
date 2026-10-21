/*
 * ⚙️ CARGAR EL HORÓMETRO DESDE CONTROL DE HORÓMETROS — 20-oct-2026, urgente.
 *
 * Pedido del cliente, textual: «necesito poder cargar el horómetro de inicio y
 * de cierre desde ahí» — «ahí» es el modal ⚙️ Acomodar el horómetro
 * (HorometroAjusteModal), que hasta hoy solo ACOMODABA una lectura que el
 * inspector ya había cargado. Cuando no existía la lectura (o le faltaba el
 * inicial o el final), desde ahí no se podía CARGAR nada.
 *
 * LO QUE BLINDA — y por qué cada cosa:
 *  · ⭐ SIN LECTURA TAMBIÉN SE PUEDE: la regla pura de la corrección
 *    (`validarCorreccionHorometro`) acepta uno, el otro o los dos números, y el
 *    modal la usa para CREAR la lectura real por la misma RPC del teléfono
 *    (origen 'control'). Si esto se rompe, el cliente vuelve a no poder cargar.
 *  · ⭐ EL PAGO ENTIENDE UN AJUSTE SIN LECTURA BASE: `lecturasEfectivas` y
 *    `filasPagoHorometro` pagan un día que el inspector nunca cargó. Si dejara
 *    de ser así, el destino «🧾 Solo para Control de horómetros» guardaría algo
 *    que el pago no lee.
 *  · ⭐ COMA Y PUNTO VALEN EN LOS DOS DESTINOS: el destino «🧾» leía con
 *    `Number(replace(',', '.'))`, que convertía «7.919» en 7,919 horas. Ahora
 *    los dos destinos leen con `numeroDeTexto` (la regla de la casa).
 *  · ⭐ LA ESCRITURA SE VERIFICA: la RLS rechaza sin error y con 0 filas
 *    (patrón conocido), así que tras guardar la lectura el modal RELEE la fila
 *    y avisa si no quedó.
 *  · El motivo sigue siendo OBLIGATORIO y nada toca machine_rounds.
 *
 *   node scripts/test-horometro-cargar-desde-control.mjs
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

// Loader de TS con stub de './supabase' (mismo patrón que test-hora-fin-jornada):
// las libs puras no lo necesitan, pero así la suite no se cae si alguna arrastra
// un import el día de mañana.
const cache = new Map();
const compilar = (p) => {
  if (cache.has(p)) return cache.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cache.set(p, m.exports);
  m._compile(js, m.filename);
  cache.set(p, m.exports);
  return m.exports;
};
const realLoad = Module._load;
Module._load = function (req, parent) {
  if (parent && String(parent.filename || '').endsWith('.ts') && (req === './supabase' || req.endsWith('/supabase'))) {
    return { supabase: {}, selectAllRows: async () => [] };
  }
  if (req.startsWith('.') && parent && String(parent.filename || '').endsWith('.ts')) {
    const cand = path.resolve(path.dirname(parent.filename), req);
    for (const p of [cand, cand + '.ts', path.join(cand, 'index.ts')]) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return compilar(p);
    }
  }
  return realLoad.apply(this, arguments);
};

const H = compilar(path.join(ROOT, 'src/lib/horometroTrabajo.ts'));
const P = compilar(path.join(ROOT, 'src/lib/pagoHorometro.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

// ── 1) LA REGLA PURA: qué se puede CARGAR y cuándo ───────────────────────────
// La corrección (destino ✎) acepta uno, el otro o los dos números: cargar solo
// el inicial (la jornada va empezando) o solo el final es legal; vacío todo, no.
eq('⭐ cargar inicial Y final pasa', H.validarCorreccionHorometro({ inicial: '7.919', final: '7.927,5', motivo: 'el inspector no la cargó' }), null);
eq('⭐ cargar SOLO el inicial pasa (el final vendrá después)', H.validarCorreccionHorometro({ inicial: '100', final: '', motivo: 'm' }), null);
eq('⭐ cargar SOLO el final pasa', H.validarCorreccionHorometro({ inicial: '', final: '108', motivo: 'm' }), null);
ok('vacíos los dos NO pasa', /al menos un numero/.test(H.validarCorreccionHorometro({ inicial: '', final: '', motivo: 'm' }) ?? ''));
ok('sin motivo NO pasa, ni cargando desde cero', /motivo/i.test(H.validarCorreccionHorometro({ inicial: '100', final: '108', motivo: '  ' }) ?? ''));
ok('final menor que inicial NO pasa', /menor/.test(H.validarCorreccionHorometro({ inicial: '108', final: '100', motivo: 'm' }) ?? ''));

// Coma y punto, miles de tres en tres: la regla de la casa que ahora usan los DOS destinos.
eq('⭐ «7.919» son 7919 horas (miles), no 7,919', H.numeroDeTexto('7.919'), 7919);
eq('⭐ «7.919,5» también se lee bien', H.numeroDeTexto('7.919,5'), 7919.5);
eq('vacío = null (no se confunde con 0)', H.numeroDeTexto(''), null);
eq('basura = false (se rechaza, no se adivina)', H.numeroDeTexto('7.7.7'), false);

// El ajuste (destino 🧾) exige los DOS números: su tabla no guarda medias lecturas.
eq('un ajuste con los dos números pasa', P.validarAjusteHorometro({ inicial: 100, final: 108, motivo: 'm' }), null);
ok('un ajuste a medias NO pasa (pide inicial y final)', /inicial y el final/.test(P.validarAjusteHorometro({ inicial: '', final: 108, motivo: 'm' })));

// ── 2) ⭐ EL PAGO ENTIENDE UN AJUSTE SIN LECTURA BASE ────────────────────────
// Si esto se rompe, el destino «🧾» de un día sin lectura guardaría un ajuste
// que el pago no lee (y habría que deshabilitarlo en pantalla).
{
  const aj = { id: 'a', machinery_id: 'm1', round_date: '2026-10-19', shift: 'day', inicial: 100, final: 108, motivo: 'no había lectura', created_at: '2026-10-20T00:00:01Z' };
  const ef = P.lecturasEfectivas([], [aj]);
  eq('⭐ el ajuste de un día SIN lectura entra como lectura efectiva',
    ef.map((l) => [l.machineryId, l.roundDate, l.shift, l.inicial, l.final, l.valida, l.ajustada]),
    [['m1', '2026-10-19', 'day', 100, 108, true, true]]);
  const filas = P.filasPagoHorometro({
    maquinas: [{ id: 'm1', code: 'EXC-1', placa: 'P1', empresa: 'E', clasificacion: 'c', marca: '', modelo: '' }],
    lecturas: [], precios: [{ id: 'p', machinery_id: 'm1', precio_hora: 10, desde: '2026-10-01', created_at: '2026-10-01T00:00:00Z' }],
    desde: '2026-10-19', hasta: '2026-10-19', ajustes: [aj],
  });
  eq('⭐ …y el pago lo paga (8 h × $10 = $80)', filas.map((f) => [f.maquina.code, f.horas, f.monto]), [['EXC-1', 8, 80]]);
  ok('…marcado como ajustado, con su motivo', filas[0].dias[0].ajustado === true && filas[0].dias[0].motivoAjuste === 'no había lectura');
}

// ── 3) LA PANTALLA: pines del modal y del panel ──────────────────────────────
const modal = sinComentarios(leer('src/components/HorometroAjusteModal.tsx'));

// Sin lectura, el modal lo DICE y avisa que lo escrito se carga.
ok('⭐ sin lectura el modal avisa que lo escrito se CARGA desde cero', /se CARGA desde cero/.test(modal));
ok('con media lectura dice que lo escrito la COMPLETA', /lo que escribas lo COMPLETA/.test(modal));

// Los dos destinos leen los números con la regla de la casa (coma Y punto).
ok('⭐ el destino 🧾 lee con numeroDeTexto (ya no Number(replace))', /const iNum = numeroDeTexto\(ini\)/.test(modal) && /const fNum = numeroDeTexto\(fin\)/.test(modal));
ok("⚠️ no queda ningún replace(',', '.') de lectura propia en el modal", !/\breplace\(','\s*,\s*'\.'\)/.test(modal));

// El destino ✎ sigue por la vía de siempre (misma RPC, origen control) — es la
// que CREA la fila cuando no existe, igual que el teléfono del inspector.
ok('⭐ ✎ guarda por guardarLecturaHorometro con origen control', /guardarLecturaHorometro\(machineryId, fecha, turno/.test(modal) && /origen: 'control'/.test(modal));

// ⭐ Tras guardar la lectura se RELEE la fila (la RLS rechaza sin error y con 0 filas).
ok('⭐ tras guardar se relee la lectura del día', /cargarLecturasDeMaquinaDia\(machineryId, fecha\)/.test(modal));
ok('⭐ si el turno no quedó guardado, se dice en pantalla (0 filas)', /0 filas/.test(modal) && /releidas\.some\(\(l\) => l\.shift === turno\)/.test(modal));

// El mensaje distingue CARGAR de CAMBIAR (para que nadie crea que pisó algo que no existía).
ok('mensaje de lectura CARGADA cuando no había', /Lectura CARGADA/.test(modal));
ok('mensaje de lectura cambiada cuando sí había', /Lectura del inspector cambiada/.test(modal));

// Lo de siempre, que no se puede romper al abrir la carga desde cero:
ok('el motivo sigue OBLIGATORIO y grabado con el nombre', /Motivo · OBLIGATORIO \(queda grabado con tu nombre\)/.test(modal));
ok('⭐ el modal sigue sin tocar Control de jornadas (nada de machine_rounds)', !/machine_rounds|day_hours|night_hours|upsertMachineRound/.test(modal));
ok('el ajuste sigue verificándose por filas devueltas en la capa de datos', /\.select\('id'\)/.test(sinComentarios(leer('src/lib/pagoHorometroDb.ts'))));

// El panel sigue ofreciendo la puerta para un día CUALQUIERA (también sin lectura).
const panel = sinComentarios(leer('src/components/ControlHorometrosPanel.tsx'));
ok('el panel abre el modal para un día cualquiera', /Acomodar el horómetro de un día/.test(panel));

// ── 📷 LAS FOTOS DEL TABLERO DESDE EL MODAL (21-oct-2026, a pedido) ──────────
// «Poder subir la foto del horometro inicial y la del final desde ahi, y
// modificar las que ya han subido en esos dias.»
ok('⭐⭐ hay subida de foto para el INICIAL y para el FINAL',
  /fotoInicialUrl: r\.url/.test(modal) && /fotoFinalUrl: r\.url/.test(modal));
ok('⭐ camara Y galeria, la regla de la casa (27-sep)',
  /takePhotoAndUpload\(machineryId, 'horometro'\)/.test(modal)
  && /pickPhotoFromGalleryAndUpload\(machineryId, 'horometro'\)/.test(modal)
  && modal.includes('📷 Cámara') && modal.includes('🖼️ Galería'));
ok('⭐ la foto va a la LECTURA por la misma RPC, con origen control y motivo',
  /subirFoto = async/.test(modal) && /motivoCorreccion: motivo\.trim\(\) \|\|/.test(modal));
ok('⭐⭐ tras subir se RELEE y se confirma la URL (la RLS rechaza sin error y con 0 filas)',
  /fila\?\.fotoInicialUrl === r\.url : fila\?\.fotoFinalUrl === r\.url/.test(modal)
  && modal.includes('La base no dejó la foto guardada (0 filas)'));
ok('⭐ sin el permiso del modulo Horometros, las fotos NO se ofrecen',
  /puedeCambiarInspector \? \([\s\S]*?📷 Fotos del tablero/.test(modal));
ok('⭐ reemplazar avisa que REEMPLAZA (y la vieja no se borra del almacen)',
  /REEMPLAZA la anterior/.test(modal) && /reemplaza la anterior/.test(modal));
ok('* la vista previa usa la foto local recien subida o la de la lectura',
  /fotoIniLocal \?\? delInspector\?\.fotoInicialUrl/.test(modal)
  && /fotoFinLocal \?\? delInspector\?\.fotoFinalUrl/.test(modal));
ok('* al cambiar de dia o turno la vista previa local se limpia',
  /setFotoIniLocal\(null\);[\s\S]{0,40}?setFotoFinLocal\(null\);/.test(modal));

console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Cargar el horómetro de inicio y de cierre desde ⚙️ Acomodar el horómetro: con o sin lectura del inspector, con verificación de lo guardado.');
