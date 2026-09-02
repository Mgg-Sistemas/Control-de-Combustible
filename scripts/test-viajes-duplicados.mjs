/*
 * EL VIAJE DUPLICADO, Y EL RASTRO DE LA EDICIÓN FUERA DE JORNADA (02-sep-2026).
 *
 * Blinda lo que se le agregó a `src/lib/viajesEdicion.ts`:
 *
 *  1. `claveViajeEstable` — la clave de idempotencia derivada de la INTENCIÓN.
 *     `client_action_id` tiene índice ÚNICO en la base, así que dos filas con la
 *     misma clave no pueden existir. El problema era que `nuevoClientActionId()`
 *     la armaba con `Date.now()` + azar: NUEVA EN CADA TOQUE. El candado servía
 *     para los reintentos del propio código, pero no para lo que pasa en el
 *     patio — el listero toca dos veces porque «no pasó nada», y quedan DOS
 *     viajes de verdad sin que nadie avise.
 *
 *  2. `requiereRastroDeEdicion` — cuándo vale la pena escribir en Auditoría.
 *     Pedido explícito del cliente: «que no se dañe ni abuse el módulo de
 *     auditoría, y que no se tumbe ni consuma en exceso». Por eso NO se registra
 *     toda edición (para eso ya está el trigger `trg_audit` de `camion_viajes`),
 *     solo la EXCEPCIONAL: la que toca un viaje de otra jornada.
 *
 *   node scripts/test-viajes-duplicados.mjs
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

// `viajesEdicion` importa dos módulos; se cargan igual para no tener que simularlos.
const cargar = (rel, deps = {}) => {
  const mod = { exports: {} };
  const req = (n) => {
    const k = n.replace(/^\.\//, '');
    if (deps[k]) return deps[k];
    throw new Error('dependencia no prevista: ' + n);
  };
  new Function('exports', 'module', 'require', transpilar(rel))(mod.exports, mod, req);
  return mod.exports;
};
const caracasDay = cargar('src/lib/caracasDay.ts', {});
const viajesTurno = cargar('src/lib/viajesTurno.ts', { caracasDay });
const E = cargar('src/lib/viajesEdicion.ts', { caracasDay, viajesTurno });

const {
  claveViajeEstable, fueraDeJornada, requiereRastroDeEdicion,
  detalleRastroEdicion, ACCION_EDIT_FUERA_JORNADA,
} = E;

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? '  -> ' + extra : '')); }
};

console.log('VIAJES DUPLICADOS Y RASTRO DE EDICION\n');

// ── 1) ⭐ La clave es la MISMA para el mismo viaje ──────────────────────────
{
  const base = { identidadCamion: 'V-12', listeroId: 'lis-1', registeredAtISO: '2026-09-02T14:30:00.000Z' };
  const k = claveViajeEstable(base);

  ok('la clave no viene vacia', !!k, k);
  ok('⭐⭐ dos toques del mismo minuto dan LA MISMA clave',
    claveViajeEstable(base) === claveViajeEstable({ ...base, registeredAtISO: '2026-09-02T14:30:59.999Z' }),
    k + ' vs ' + claveViajeEstable({ ...base, registeredAtISO: '2026-09-02T14:30:59.999Z' }));
  ok('* los milisegundos no cuentan',
    k === claveViajeEstable({ ...base, registeredAtISO: '2026-09-02T14:30:00.777Z' }));

  // El codigo sale del catalogo, pero por si acaso: mayusculas y espacios.
  ok('el codigo se normaliza (minusculas)', k === claveViajeEstable({ ...base, identidadCamion: 'v-12' }));
  ok('el codigo se normaliza (espacios de mas)', k === claveViajeEstable({ ...base, identidadCamion: '  V-12  ' }));
  ok('el codigo se normaliza (espacios dobles adentro)',
    claveViajeEstable({ ...base, identidadCamion: 'V  12' }) === claveViajeEstable({ ...base, identidadCamion: 'V 12' }));
}

// ── 2) ⭐ Y DISTINTA cuando de verdad es otro viaje ─────────────────────────
{
  const base = { identidadCamion: 'V-12', listeroId: 'lis-1', registeredAtISO: '2026-09-02T14:30:00.000Z' };
  const k = claveViajeEstable(base);

  ok('⭐ otro minuto -> otra clave',
    k !== claveViajeEstable({ ...base, registeredAtISO: '2026-09-02T14:31:00.000Z' }));
  ok('⭐ otro camion -> otra clave',
    k !== claveViajeEstable({ ...base, identidadCamion: 'V-13' }));
  ok('⭐ otro listero -> otra clave',
    k !== claveViajeEstable({ ...base, listeroId: 'lis-2' }));
  ok('otra hora -> otra clave',
    k !== claveViajeEstable({ ...base, registeredAtISO: '2026-09-02T15:30:00.000Z' }));
  ok('otro dia -> otra clave',
    k !== claveViajeEstable({ ...base, registeredAtISO: '2026-09-03T14:30:00.000Z' }));
}

// ── 2.b) ⭐⭐ DOS CAMIONES DISTINTOS CON EL MISMO CODIGO ────────────────────
//
// EL CASO QUE HABRIA BORRADO VIAJES REALES. En esta flota casi todos los
// camiones se llaman igual ("Camion Volteo Toronto" y parecidos) — por eso el
// resto del modulo arrastra la placa a todas partes. Si la clave se armara con
// el CODIGO pelado, dos camiones distintos del mismo listero en el mismo minuto
// darian LA MISMA clave, el indice unico rechazaria el segundo, y ese viaje
// -que ocurrio de verdad- desapareceria sin que nadie viera un error.
//
// Por eso el parametro se llama `identidadCamion` y no `machineCode`: quien
// llama tiene que mandar algo UNICO por camion (el id del catalogo).
{
  const MISMO_CODIGO = 'Camion Volteo Toronto';
  const base = { listeroId: 'lis-1', registeredAtISO: '2026-09-02T14:30:00.000Z' };

  const a = claveViajeEstable({ ...base, identidadCamion: `cam-aaa ${MISMO_CODIGO}` });
  const b = claveViajeEstable({ ...base, identidadCamion: `cam-bbb ${MISMO_CODIGO}` });

  ok('⭐⭐ dos camiones con el MISMO codigo dan claves DISTINTAS', a !== b, a + ' vs ' + b);
  ok('* las dos son claves validas', !!a && !!b);

  // Y el mismo camion, aunque se lo nombre igual, sigue dando la misma clave:
  // el arreglo no puede haber roto la deteccion del doble toque de verdad.
  ok('⭐ pero el MISMO camion sigue chocando consigo mismo',
    claveViajeEstable({ ...base, identidadCamion: `cam-aaa ${MISMO_CODIGO}` }) === a);

  // Una tanda completa cargada a dos camiones homonimos: los diez tienen que
  // poder entrar. Antes de esto, la tanda del segundo camion rebotaba ENTERA.
  const horarios = E.horariosDeCarga('2026-09-01', 8, 0, 5);
  const claves = (id) => horarios.map((iso) =>
    claveViajeEstable({ identidadCamion: `${id} ${MISMO_CODIGO}`, listeroId: 'jefa', registeredAtISO: iso }));
  const todas = [...claves('cam-aaa'), ...claves('cam-bbb')];
  ok('⭐⭐ dos tandas a camiones homonimos: las 10 claves son distintas',
    new Set(todas).size === 10, String(new Set(todas).size));
}

// ── 3) ⭐ Sin datos completos NO se inventa una clave ───────────────────────
//    Una clave a medias podria chocar con la de otro viaje legitimo y hacerlo
//    desaparecer en silencio: peor que el duplicado que estamos evitando.
{
  const base = { identidadCamion: 'V-12', listeroId: 'lis-1', registeredAtISO: '2026-09-02T14:30:00.000Z' };
  ok('⭐ sin codigo de camion -> vacio', claveViajeEstable({ ...base, identidadCamion: '' }) === '');
  ok('⭐ sin listero -> vacio', claveViajeEstable({ ...base, listeroId: '' }) === '');
  ok('⭐ sin fecha -> vacio', claveViajeEstable({ ...base, registeredAtISO: '' }) === '');
  ok('⭐ fecha incompleta -> vacio', claveViajeEstable({ ...base, registeredAtISO: '2026-09-02' }) === '');
  ok('codigo solo espacios -> vacio', claveViajeEstable({ ...base, identidadCamion: '   ' }) === '');
  ok('listero solo espacios -> vacio', claveViajeEstable({ ...base, listeroId: '  ' }) === '');
}

// ── 4) La tanda cargada a mano: misma tanda, mismas claves ─────────────────
{
  const horarios = E.horariosDeCarga('2026-09-01', 8, 0, 5);
  const claves = (h) => h.map((iso) => claveViajeEstable({ identidadCamion: 'V-9', listeroId: 'jefa', registeredAtISO: iso }));
  const a = claves(horarios);
  const b = claves(E.horariosDeCarga('2026-09-01', 8, 0, 5));

  ok('los 5 viajes de la tanda tienen claves distintas entre si', new Set(a).size === 5, a.join(' | '));
  ok('⭐⭐ recargar LA MISMA tanda da LAS MISMAS claves', a.join() === b.join());
  // Reintentar tras un fallo a la mitad: los 3 que entraron rebotan, los 2 que
  // faltan entran. Antes se duplicaban los 3.
  ok('⭐ los que ya entraron rebotarian por clave repetida',
    a.slice(0, 3).every((k) => b.includes(k)));
}

// ── 5) fueraDeJornada ──────────────────────────────────────────────────────
{
  const V = { startMs: Date.parse('2026-09-02T07:00:00-04:00'), endMs: Date.parse('2026-09-02T19:00:00-04:00') };

  ok('un viaje de media jornada NO esta fuera', fueraDeJornada('2026-09-02T12:00:00-04:00', V) === false);
  ok('justo al arranque NO esta fuera', fueraDeJornada('2026-09-02T07:00:00-04:00', V) === false);
  ok('⭐ justo al cierre SI esta fuera (el fin no se incluye)',
    fueraDeJornada('2026-09-02T19:00:00-04:00', V) === true);
  ok('un minuto antes del arranque esta fuera', fueraDeJornada('2026-09-02T06:59:00-04:00', V) === true);
  ok('la noche anterior esta fuera', fueraDeJornada('2026-09-02T03:00:00-04:00', V) === true);
  ok('el mes pasado esta fuera', fueraDeJornada('2026-08-02T12:00:00-04:00', V) === true);

  // ⭐ Sin fecha legible NO se acusa a nadie: se prefiere no escribir una fila de
  //    auditoria antes que escribir una que dice cualquier cosa.
  ok('⭐ fecha ilegible -> NO esta fuera', fueraDeJornada('cualquier cosa', V) === false);
  ok('⭐ fecha vacia -> NO esta fuera', fueraDeJornada('', V) === false);
  ok('⭐ sin fecha -> NO esta fuera', fueraDeJornada(null, V) === false);
}

// ── 6) ⭐⭐ CUANDO SE ESCRIBE EN AUDITORIA (y cuando NO) ────────────────────
{
  const V = { startMs: Date.parse('2026-09-02T07:00:00-04:00'), endMs: Date.parse('2026-09-02T19:00:00-04:00') };
  const HOY = '2026-09-02T12:00:00-04:00';
  const VIEJO = '2026-08-15T12:00:00-04:00';
  const r = (antes, despues, huboCambios) =>
    requiereRastroDeEdicion({ registeredAtAntesISO: antes, registeredAtDespuesISO: despues, ventana: V, huboCambios });

  ok('⭐⭐ editar un viaje VIEJO deja rastro', r(VIEJO, VIEJO, true) === true);
  ok('⭐⭐ editar un viaje de HOY no deja rastro extra (ya lo cubre el trigger)',
    r(HOY, HOY, true) === false);

  // ⭐ EL CASO QUE MAS IMPORTA RASTREAR: mover un viaje de hoy hacia atras.
  ok('⭐⭐ mover un viaje de HOY al mes pasado deja rastro', r(HOY, VIEJO, true) === true);
  ok('⭐⭐ traer un viaje viejo hacia HOY deja rastro', r(VIEJO, HOY, true) === true);

  // ⭐ NO ENSUCIAR: abrir el editor y guardar sin tocar nada no escribe.
  ok('⭐⭐ sin cambios NO se escribe, aunque sea viejo', r(VIEJO, VIEJO, false) === false);
  ok('⭐ sin cambios y de hoy, tampoco', r(HOY, HOY, false) === false);

  // Fechas ilegibles: no se escribe basura.
  ok('fechas ilegibles no generan rastro', r('x', 'y', true) === false);
}

// ── 7) El detalle que se lee en Auditoria ──────────────────────────────────
{
  ok('la accion es propia y filtrable', ACCION_EDIT_FUERA_JORNADA === 'EDIT_VIAJE_FUERA_JORNADA');

  const d = detalleRastroEdicion({
    machineCode: 'v-12', antesISO: '2026-08-15T03:00:00-04:00', despuesISO: '2026-08-15T05:30:00-04:00',
    cambios: ['chofer: Juan'],
  });
  ok('el detalle trae el camion en mayusculas', d.includes('V-12'), d);
  ok('el detalle muestra el movimiento', d.includes('->') || d.includes('→'), d);
  ok('el detalle trae los cambios extra', d.includes('chofer: Juan'), d);

  const sinCambio = detalleRastroEdicion({
    machineCode: 'V-1', antesISO: '2026-08-15T03:00:00-04:00', despuesISO: '2026-08-15T03:00:00-04:00',
  });
  ok('si la fecha no se movio, no se pinta una flecha falsa',
    !sinCambio.includes('→') && !sinCambio.includes('->'), sinCambio);

  const pelado = detalleRastroEdicion({ machineCode: '', antesISO: '', despuesISO: '' });
  ok('sin datos no revienta', typeof pelado === 'string' && pelado.length > 0, pelado);
}

// ── 8) ⭐ La libreria sigue sin tocar la base ni las maquinas ───────────────
{
  const crudo = fs.readFileSync(path.join(ROOT, 'src/lib/viajesEdicion.ts'), 'utf8');
  const vivo = crudo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok('⭐ no habla con Supabase', !/supabase|from\(/.test(vivo));

  // ── ⭐⭐ LA PANTALLA NO PUEDE ABUSAR DE AUDITORIA ────────────────────────
  //
  // Pedido explicito del cliente (02-sep-2026): «que no se dañe ni abuse el
  // modulo de auditoria, y que no se tumbe ni consuma en exceso».
  //
  // La regla concreta: en toda la pantalla de viajes hay UNA sola escritura a la
  // bitacora, y va DENTRO del `if (requiereRastroDeEdicion(...))`. Las
  // correcciones normales del dia no escriben nada extra: ya las registra el
  // trigger `trg_audit` de `camion_viajes`. Aflojar esto llenaria la bitacora de
  // ruido y es exactamente lo que se pidio evitar.
  const scr = fs.readFileSync(path.join(ROOT, 'src/screens/ViajesCamionesScreen.tsx'), 'utf8');
  const scrVivo = scr.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const llamadas = (scrVivo.match(/logAudit\s*\(/g) || []).length;
  ok('⭐⭐ la pantalla escribe en auditoria UNA sola vez', llamadas === 1, String(llamadas));
  ok('⭐⭐ y esa escritura va DENTRO del if de requiereRastroDeEdicion',
    /if\s*\(\s*requiereRastroDeEdicion\(\{[\s\S]{0,400}?\}\)\s*\)\s*\{[\s\S]{0,300}?logAudit\s*\(/.test(scrVivo));
  // Ojo con el atajo: `/machinery/` a secas tambien casa con `machineryId`, que
  // es un NOMBRE DE CAMPO del formulario y no la tabla. Lo que hay que prohibir
  // es nombrar la TABLA, y eso solo pasa entre comillas.
  ok('⭐ no nombra la tabla `machinery`', !/['"`]machinery['"`]/.test(vivo));
  // Y no vuelve a meter bytes de control en el fuente (paso una vez, en un join).
  const bytes = Buffer.from(crudo, 'utf8');
  ok('⭐ sin bytes de control en el fuente',
    !bytes.some((b) => b < 9 || (b > 13 && b < 32)));
}

console.log('\n' + pass + ' OK · ' + fail + ' FALLO(S)');
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('El mismo viaje no entra dos veces, y la edicion excepcional deja rastro.');
