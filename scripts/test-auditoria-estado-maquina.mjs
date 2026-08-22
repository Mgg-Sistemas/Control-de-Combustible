/*
 * Test de «¿QUIÉN PUSO ESTA MÁQUINA RETIRADA?» en Auditoría (20-ago-2026).
 *
 * LO QUE VIGILA. La bitácora guarda el nombre CRUDO de la columna, así que una
 * máquina retirada salía como «Fulano modificó Máquina · CARGADOR 01 (6 cambios)»
 * y había que abrir la fila para descubrir el `operational: sí → no` escondido
 * entre los otros cinco. `src/lib/auditMachineState.ts` traduce eso a
 * «⬛ RETIRADA (fuera de servicio)».
 *
 * LAS TRAMPAS QUE CUBRE:
 *   · La forma de `changes` NO es la misma en UPDATE ({de,a}) que en INSERT/DELETE
 *     (la fila entera). Leer un INSERT como si fuera un UPDATE da `undefined`.
 *   · Los booleanos de la bitácora vienen de JSON: han pasado `true`, `"true"`,
 *     `"t"` y `1`. `null` es «no sé», que NO es «no» (si no, cada fila sin dato
 *     se reportaría como una retirada que nunca ocurrió).
 *   · Una máquina creada operativa NO es noticia; una creada ya retirada, sí.
 *   · Cambiarle la foto o el precio a una máquina no es un cambio de estado.
 *
 * Además vigila la pantalla, porque de nada sirve la función si AuditScreen no
 * la usa o si vuelve a pedirle a la BD más filas de las que puede aguantar.
 *
 *   npm run test:estados   (o: node scripts/test-auditoria-estado-maquina.mjs)
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

const load = (rel) => {
  const p = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  m._compile(out, m.filename);
  return m.exports;
};

const {
  cambiosEstadoMaquina, esCambioDeEstadoMaquina, conteoPorEstado,
  acompanantes, toBool, CAMPOS_ESTADO, TABLAS_CON_ESTADO,
} = load('src/lib/auditMachineState.ts');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const upd = (changes) => ({ action: 'UPDATE', table_name: 'machinery', changes });
const ins = (changes) => ({ action: 'INSERT', table_name: 'machinery', changes });
const keys = (row) => cambiosEstadoMaquina(row).map((c) => c.key);

// ── 1) LA PREGUNTA DEL CLIENTE: ¿quién la retiró? ──────────────────────────
eq('operational sí→no = RETIRADA', keys(upd({ operational: { de: true, a: false } })), ['retirada']);
eq('operational no→sí = REACTIVADA', keys(upd({ operational: { de: false, a: true } })), ['reactivada']);
eq('en_espera no→sí = EN ESPERA', keys(upd({ en_espera: { de: false, a: true } })), ['espera']);
eq('en_espera sí→no = RECIBIDA', keys(upd({ en_espera: { de: true, a: false } })), ['recibida']);
eq('active sí→no = ELIMINADA', keys(upd({ active: { de: true, a: false } })), ['eliminada']);
eq('active no→sí = RESTAURADA', keys(upd({ active: { de: false, a: true } })), ['restaurada']);
eq('qr_blocked no→sí = QR BLOQUEADO', keys(upd({ qr_blocked: { de: false, a: true } })), ['qr_bloqueado']);
eq('qr_blocked sí→no = QR liberado', keys(upd({ qr_blocked: { de: true, a: false } })), ['qr_liberado']);

ok('la retirada sale en MAYÚSCULAS y en criollo',
  /RETIRADA/.test(cambiosEstadoMaquina(upd({ operational: { de: true, a: false } }))[0].label));

// ── 2) EL CASO REAL: la retirada ENTERRADA entre otros cambios ─────────────
// Es exactamente lo que reportó el cliente: 6 cambios, uno de ellos el estado.
const seisCambios = upd({
  operational: { de: true, a: false },
  inactivated_at: { de: null, a: '2026-08-19T15:00:00Z' },
  inactivated_by: { de: null, a: 'uuid-del-que-la-retiro' },
  photo_url: { de: null, a: 'https://…/foto.jpg' },
  encargado: { de: 'Pedro', a: 'Luis' },
  price_per_hour: { de: 50, a: 60 },
});
eq('entre 6 cambios se pesca SOLO la retirada', keys(seisCambios), ['retirada']);
eq('y se listan los acompañantes (quién / cuándo)', acompanantes(seisCambios), ['inactivated_at', 'inactivated_by']);

// ── 3) LO QUE NO ES UN CAMBIO DE ESTADO ────────────────────────────────────
eq('cambiar la foto no es cambio de estado', keys(upd({ photo_url: { de: null, a: 'x.jpg' } })), []);
eq('cambiar el precio no es cambio de estado', keys(upd({ price_per_hour: { de: 50, a: 60 } })), []);
eq('cambiar solo el encargado no es cambio de estado', keys(upd({ encargado: { de: 'A', a: 'B' } })), []);
ok('esCambioDeEstadoMaquina dice que no', !esCambioDeEstadoMaquina(upd({ photo_url: { de: null, a: 'x.jpg' } })));
ok('esCambioDeEstadoMaquina dice que sí', esCambioDeEstadoMaquina(upd({ operational: { de: true, a: false } })));

// Otra tabla con las mismas palabras: una jornada no retira ninguna máquina.
eq('una jornada (machine_rounds) no aporta estados',
  keys({ action: 'UPDATE', table_name: 'machine_rounds', changes: { active: { de: true, a: false } } }), []);
eq('un empleado inactivo no es una máquina retirada',
  keys({ action: 'UPDATE', table_name: 'employees', changes: { active: { de: true, a: false } } }), []);
eq('vehicles sí cuenta (solo tiene `active`)',
  keys({ action: 'UPDATE', table_name: 'vehicles', changes: { active: { de: true, a: false } } }), ['eliminada']);

// ── 4) `null` ES «NO SÉ», NO ES «NO» ───────────────────────────────────────
// Si esto falla, cada fila sin dato se reporta como una retirada que nunca pasó.
eq('a=null no inventa una retirada', keys(upd({ operational: { de: true, a: null } })), []);
eq('sin `a` (fila rara) no inventa nada', keys(upd({ operational: { de: true } })), []);
eq('de=null pero a=false SÍ es retirada (el trigger solo guarda lo que cambió)',
  keys(upd({ operational: { de: null, a: false } })), ['retirada']);
eq('de === a no es transición', keys(upd({ operational: { de: false, a: false } })), []);

// ── 5) BOOLEANOS QUE VIENEN DE JSON ────────────────────────────────────────
eq('toBool(true)', toBool(true), true);
eq('toBool("true")', toBool('true'), true);
eq('toBool("t")', toBool('t'), true);
eq('toBool("f")', toBool('f'), false);
eq('toBool(1)', toBool(1), true);
eq('toBool(0)', toBool(0), false);
eq('toBool(null) = no sé', toBool(null), null);
eq('toBool(undefined) = no sé', toBool(undefined), null);
eq('toBool("") = no sé', toBool(''), null);
eq('toBool("cualquier cosa") = no sé', toBool('mañana'), null);
eq('"false" en texto también retira', keys(upd({ operational: { de: 'true', a: 'false' } })), ['retirada']);

// ── 6) INSERT / DELETE traen la FILA ENTERA, no {de,a} ─────────────────────
eq('creada operativa: no es noticia', keys(ins({ operational: true, en_espera: false, active: true })), []);
eq('creada ya retirada: sí es noticia', keys(ins({ operational: false, active: true })), ['retirada_al_crear']);
eq('creada en espera: sí es noticia', keys(ins({ operational: true, en_espera: true })), ['espera_al_crear']);
ok('y se dice que NACIÓ así', /NACIÓ/.test(cambiosEstadoMaquina(ins({ operational: false }))[0].label));
eq('borrar la fila es el estado más grave',
  keys({ action: 'DELETE', table_name: 'machinery', changes: { code: 'CARGADOR 01', operational: true } }), ['borrada']);
eq('borrar sin `changes` igual se reporta',
  keys({ action: 'DELETE', table_name: 'machinery', changes: null }), ['borrada']);

// ── 7) VARIOS ESTADOS EN UN MISMO GUARDADO, EN ORDEN DE IMPORTANCIA ────────
eq('operativa primero, luego el resto',
  keys(upd({ qr_blocked: { de: false, a: true }, operational: { de: true, a: false } })),
  ['retirada', 'qr_bloqueado']);

// ── 8) NADA DE ESTO PUEDE REVENTAR CON BASURA ──────────────────────────────
// La bitácora tiene años de filas de versiones viejas del sistema.
for (const basura of [null, undefined, {}, { action: 'UPDATE' }, { table_name: 'machinery' },
  upd(null), upd('texto'), upd([]), upd({ operational: 'sí' }), upd({ operational: { de: {}, a: [] } })]) {
  let crash = null;
  try { cambiosEstadoMaquina(basura); esCambioDeEstadoMaquina(basura); acompanantes(basura); }
  catch (e) { crash = String(e && e.message); }
  eq(`no revienta con ${JSON.stringify(basura)}`, crash, null);
}

// ── 9) EL RESUMEN DE ARRIBA (conteo por tipo) ──────────────────────────────
const lote = [
  upd({ operational: { de: true, a: false } }),
  upd({ operational: { de: true, a: false } }),
  upd({ operational: { de: false, a: true } }),
  upd({ photo_url: { de: null, a: 'x' } }),
  null,
];
eq('cuenta 2 retiradas y 1 reactivación',
  conteoPorEstado(lote).map((c) => [c.key, c.n]), [['retirada', 2], ['reactivada', 1]]);
eq('lista vacía → sin conteo', conteoPorEstado([]), []);

// ── 10) GUARDAS SOBRE LA PANTALLA ──────────────────────────────────────────
// Se normaliza CRLF→\n: en Windows el archivo sale con `\r\n` y varias guardas de
// abajo cuentan distancias con `[\s\S]{0,120}` o anclan con `$`; el `\r` extra las
// rompía y hacía fallar el test aunque la pantalla estuviera bien. Igual en Win y CI.
const scr = fs.readFileSync(path.join(ROOT, 'src/screens/AuditScreen.tsx'), 'utf8').replace(/\r\n/g, '\n');

ok('AuditScreen usa la función pura, no una copia',
  /from '\.\.\/lib\/auditMachineState'/.test(scr) && /cambiosEstadoMaquina\(/.test(scr));
ok('no quedó una lista de columnas de estado reimplementada en la pantalla',
  !/\['operational', 'en_espera', 'active', 'qr_blocked'\]/.test(scr));
ok('existe el filtro rápido de estados de máquina', /Estados de m[áa]quina/.test(scr));

// «Que no tumbe el sistema»: al filtrar por estados, la consulta debe ACOTARSE a
// las tablas con estado (columna indexada), nunca traer toda la bitácora.
ok('la consulta se acota por table_name (índice) cuando el filtro está activo',
  /\.in\('table_name', TABLAS_CON_ESTADO/.test(scr));
ok('el tope de filas sigue existiendo', /LIMIT_BASE\s*=\s*\d+/.test(scr) && /\.limit\(limit\)/.test(scr));

// ⚠️ EL FALLO QUE ENCONTRÓ LA REVISIÓN (20-ago-2026). `table_name = 'machinery'`
// NO significa "edición de una máquina": los EVENTOS de la app (SCAN, CHECK,
// JORNADA_INICIO/FIN, PARADA) se guardan con esa misma tabla desde ~25 sitios. Con
// ~173 máquinas × 2 turnos son del orden de MIL filas al día que no son cambios de
// estado; sin filtrar por acción se comían el tope y la pantalla llegaba a decir
// "ninguna máquina cambió de estado en todo el historial" con una retirada real
// fuera de la ventana — justo la pregunta que este filtro vino a contestar.
ok('⭐ la consulta descarta los EVENTOS de app (si no, se comen el tope de filas)',
  /\.in\('action', ACCIONES_DE_TABLA\)/.test(scr));
ok('ACCIONES_DE_TABLA son exactamente las tres que escribe un trigger',
  /const ACCIONES_DE_TABLA = \['INSERT', 'UPDATE', 'DELETE'\]/.test(scr));
// Y la función pura tiene que estar de acuerdo: un evento nunca es cambio de estado.
for (const ev of ['SCAN', 'CHECK', 'JORNADA_INICIO', 'JORNADA_FIN', 'PARADA', 'LOGIN', 'LOGOUT']) {
  ok(`un ${ev} sobre 'machinery' NO es cambio de estado`,
    !esCambioDeEstadoMaquina({ action: ev, table_name: 'machinery', changes: null }));
}

// «Que no choque»: el PDF vuelca la FILA ENTERA de cada INSERT/DELETE. Con miles de
// acciones el HTML llega a decenas de MB y eso es lo que cuelga la app.
ok('el PDF tiene tope de filas', /MAX_PDF_FILAS\s*=\s*\d+/.test(scr) && /shown\.slice\(0, MAX_PDF_FILAS\)/.test(scr));
ok('y avisa en el documento cuando recorta', /recortado > 0/.test(scr));
ok('generar el PDF no puede fallar en silencio', /catch[\s\S]{0,120}?No se pudo generar el PDF/.test(scr));
// Un error de consulta no puede seguir viéndose como "no hay nada".
ok('los errores de la consulta se muestran', /setLoadError\(/.test(scr) && /La bit[áa]cora no respondi[óo]/.test(scr));

// «Que no choque»: la hora de la bitácora se formatea con Intl, que REVIENTA con
// una fecha inválida — y una sola fila mala tumbaba la pantalla entera.
ok('caracasDT está blindado contra fechas inválidas',
  /function caracasDT[\s\S]{0,400}?try\s*\{/.test(scr));
ok('caracasDateISO está blindado contra fechas inválidas',
  /function caracasDateISO[\s\S]{0,400}?try\s*\{/.test(scr));

// Y la ficha de la máquina en el detalle no puede pedirse fila por fila.
ok('la ficha del detalle se pide solo al abrir una fila', /detail/.test(scr) && !/shown\.map\([\s\S]{0,200}?supabase\.from\('machinery'\)/.test(scr));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-auditoria-estado-maquina · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
