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
  horariosDeCarga, horariosOcupados, tandaEnElSiguienteHueco,
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

  // ⭐⭐ LA PLACA, QUE ES LO QUE DE VERDAD IDENTIFICA AL CAMION.
  //    En esta flota casi todos se llaman igual ("Camion Volteo Toronto"), asi
  //    que un rastro con solo el nombre deja a quien lo lee sin saber cual de los
  //    treinta fue -- y el cliente pidio esto justamente para "poder identificar
  //    facilmente esos cambios". Es la misma trampa que obligo a que la clave use
  //    la identidad y no el nombre; aca se colo por la puerta de al lado.
  const conPlaca = detalleRastroEdicion({
    machineCode: 'Camion Volteo Toronto', placa: 'A74AB3P',
    antesISO: '2026-08-15T03:00:00-04:00', despuesISO: '2026-08-15T05:30:00-04:00',
  });
  ok('⭐⭐ el detalle trae la PLACA', conPlaca.includes('A74AB3P'), conPlaca);
  ok('* y sigue trayendo el nombre', conPlaca.includes('CAMION VOLTEO TORONTO'), conPlaca);

  // Sin placa no se inventa ni se pinta un separador huerfano.
  const sinPlaca = detalleRastroEdicion({
    machineCode: 'V-1', placa: null,
    antesISO: '2026-08-15T03:00:00-04:00', despuesISO: '2026-08-15T05:30:00-04:00',
  });
  ok('sin placa no queda un separador colgando', !/V-1\s*·\s*·/.test(sinPlaca), sinPlaca);
  ok('placa vacia se trata como sin placa',
    detalleRastroEdicion({ machineCode: 'V-1', placa: '   ', antesISO: '', despuesISO: '' })
      === detalleRastroEdicion({ machineCode: 'V-1', antesISO: '', despuesISO: '' }));
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
  // Ojo con el atajo: `from\(` a secas casa con `Array.from(`, que es JavaScript
  // normal y no tiene nada que ver con la base. Escribir `Array.from(new Set(...))`
  // en esta libreria tumbaba la suite sin que nada estuviera mal.
  ok('⭐ no habla con Supabase', !/\bsupabase\b/i.test(vivo) && !/\.from\(\s*['"`]/.test(vivo));

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
  // ⚠️ SE VIGILA LA INTENCION, NO LA FORMA. La primera version de esta guardia
  //    exigia que el `if (requiereRastroDeEdicion({...}))` y el `logAudit(`
  //    estuvieran pegados y en ese orden literal, y contaba que hubiera
  //    EXACTAMENTE un `logAudit` en 3.000 lineas. Las dos cosas se rompian con
  //    refactors correctos: extraer la condicion a una variable con nombre, o
  //    auditar ademas otra cosa distinta de esta pantalla. Una prueba que se cae
  //    cuando el codigo MEJORA entrena a la gente a desactivarla.
  //
  //    Lo que de verdad importa: que la accion del viaje-de-otro-dia no se
  //    escriba sin haber consultado antes a `requiereRastroDeEdicion`.
  // ⭐⭐ LA PANTALLA NO DECIDE, OBEDECE.
  //
  // Esta guardia es corta porque la regla de verdad se prueba por COMPORTAMIENTO
  // mas abajo (bloque 9): `rastroDeEdicion` devuelve `null` cuando no hay nada
  // que escribir. Aca solo hay que asegurar que la pantalla no se salte esa
  // respuesta -- que es justo lo que la version anterior de esta guardia NO
  // agarraba: sacar el `logAudit` fuera del `if` la sobrevivia entera.
  const escrituras = scrVivo.match(/logAudit\s*\([^)]*/g) || [];
  ok('⭐⭐ toda escritura a auditoria sale de `rastro`',
    escrituras.length > 0 && escrituras.every((e) => /rastro\./.test(e)),
    escrituras.join(' | '));
  ok('⭐ y va condicionada a que haya rastro', /if\s*\(\s*rastro\s*\)\s*logAudit/.test(scrVivo));
  // Que la DECISION no se rehaga a mano. Ojo con pasarse de estricto: la pantalla
  // SI puede usar `fueraDeJornada`, y de hecho debe -- el aviso del formulario se
  // apoya en esa misma primitiva justamente para que no haya ni un aviso sin
  // rastro ni un rastro sin aviso. Lo que no puede es rehacer el criterio
  // completo (que incluye el "y ademas cambio algo") por su cuenta.
  ok('⭐ la decision de auditar no se reimplementa en la pantalla',
    !/requiereRastroDeEdicion\s*\(/.test(scrVivo));
  ok('* y el aviso del formulario si comparte la primitiva',
    /fueraDeJornada\s*\(/.test(scrVivo));
  // Ojo con el atajo: `/machinery/` a secas tambien casa con `machineryId`, que
  // es un NOMBRE DE CAMPO del formulario y no la tabla. Lo que hay que prohibir
  // es nombrar la TABLA, y eso solo pasa entre comillas.
  ok('⭐ no nombra la tabla `machinery`', !/['"`]machinery['"`]/.test(vivo));
  // Y no vuelve a meter bytes de control en el fuente (paso una vez, en un join).
  const bytes = Buffer.from(crudo, 'utf8');
  ok('⭐ sin bytes de control en el fuente',
    !bytes.some((b) => b < 9 || (b > 13 && b < 32)));
}

// ── 9) ⭐⭐ rastroDeEdicion: LA REGLA, PROBADA POR COMPORTAMIENTO ───────────
//
// Antes esta regla solo se vigilaba leyendo el codigo de la pantalla con una
// expresion regular, y eso fallaba por los dos lados: se rompia con refactors
// correctos (extraer la condicion a una variable) y DEJABA PASAR el bug de
// verdad (sacar el logAudit fuera del if). Ahora la decision vive en una
// funcion pura y se prueba con entradas y salidas.
{
  const { rastroDeEdicion } = E;
  const V = { startMs: Date.parse('2026-09-02T07:00:00-04:00'), endMs: Date.parse('2026-09-03T07:00:00-04:00') };
  const HOY = '2026-09-02T12:00:00-04:00';
  const NOCHE_DE_HOY = '2026-09-03T02:00:00-04:00';  // madrugada: MISMA jornada
  const VIEJO = '2026-08-15T12:00:00-04:00';
  const r = (antes, despues, huboCambios) => rastroDeEdicion({
    registeredAtAntesISO: antes, registeredAtDespuesISO: despues,
    ventana: V, huboCambios, machineCode: 'Camion Volteo Toronto', placa: 'A74AB3P',
    cambios: ['hora'],
  });

  ok('⭐⭐ un viaje de HOY no genera rastro', r(HOY, HOY, true) === null);
  ok('⭐⭐ la MADRUGADA de hoy tampoco (la jornada es de 7am a 7am)',
    r(NOCHE_DE_HOY, NOCHE_DE_HOY, true) === null);
  ok('⭐⭐ un viaje VIEJO si genera rastro', r(VIEJO, VIEJO, true) !== null);
  ok('⭐⭐ sin cambios NUNCA genera rastro, aunque sea viejo', r(VIEJO, VIEJO, false) === null);
  ok('⭐ mover un viaje de hoy al pasado genera rastro', r(HOY, VIEJO, true) !== null);

  const con = r(VIEJO, VIEJO, true);
  ok('el rastro trae la accion propia', con.accion === 'EDIT_VIAJE_FUERA_JORNADA', String(con && con.accion));
  ok('⭐ y el detalle identifica el camion por su PLACA', con.detalle.includes('A74AB3P'), con.detalle);
  ok('* y trae lo que cambio', con.detalle.includes('hora'), con.detalle);
}

// ── 5) ⛔ LA TANDA QUE CHOCA CON LO QUE YA ESTÁ CARGADO (29-sep-2026) ────────
//
// EL PEDIDO, textual: «me están diciendo que las que tienen full control en el
// módulo de viajes de camiones NO LAS DEJA REGISTRAR VIAJES A MANO, les sale
// ese mensaje y cuando buscan NO SALE EL VIAJE REGISTRADO».
//
// LA CAUSA: la clave anti-duplicado es (camión + listero + MINUTO) y la carga
// manual arranca siempre a la misma hora. El primer viaje del día entra; cuando
// la oficina quiere AGREGARLE otro al mismo camión, vuelve a arrancar a las
// 8:00, la clave se repite y la base lo rechaza — y el aviso salía EN VERDE
// diciendo «ya estaban cargados», como si todo hubiera ido bien.
//
// LO QUE BLINDA: se distingue ANTES de insertar. Chocan algunos = es la tanda
// de antes reintentándose (entran los que faltan, en SU hora). Chocan TODOS =
// nadie entraría, y se corre la tanda al siguiente hueco libre.
{
  const CAM = 'cam-1 CAMION VOLTEO TORONTO';
  const LIS = 'lis-1';
  const claveDe = (iso) => claveViajeEstable({ identidadCamion: CAM, listeroId: LIS, registeredAtISO: iso });

  // Una tanda de 3 viajes desde las 8:00 (hora de Caracas = 12:00 UTC).
  const tanda = horariosDeCarga('2026-09-29', 8, 0, 3);
  ok('la tanda son 3 horarios de 5 en 5', tanda.length === 3, tanda.join(' '));

  // Nada cargado todavía: no choca ninguno.
  ok('⭐ sin nada cargado, ningún horario choca', horariosOcupados(tanda, claveDe, new Set()).length === 0);

  // ── Caso A: la tanda ENTERA ya está (es lo que le pasaba a la oficina) ──
  const todas = new Set(tanda.map(claveDe));
  ok('⭐⭐ si ya están los 3, chocan los 3 (antes esto se anunciaba en verde)',
    horariosOcupados(tanda, claveDe, todas).length === 3);
  const corrida = tandaEnElSiguienteHueco(tanda, claveDe, todas);
  ok('⭐⭐ y se ofrece la MISMA tanda en el siguiente hueco libre', !!corrida && corrida.length === 3);
  ok('⭐ el hueco es LIBRE de verdad', horariosOcupados(corrida, claveDe, todas).length === 0);
  ok('⭐ la tanda se mueve ENTERA y sigue de 5 en 5 (no se reparte en huecos sueltos)',
    Date.parse(corrida[1]) - Date.parse(corrida[0]) === 5 * 60000
    && Date.parse(corrida[2]) - Date.parse(corrida[1]) === 5 * 60000);
  ok('⭐ y va HACIA ADELANTE, nunca hacia atrás', Date.parse(corrida[0]) > Date.parse(tanda[0]));
  ok('el primer hueco es el más cercano posible (8:15, justo después de la última)',
    corrida[0] === new Date(Date.parse(tanda[2]) + 5 * 60000).toISOString(), corrida[0]);

  // ── Caso B: la tanda a medias (el reintento de siempre) ──
  const aMedias = new Set([claveDe(tanda[0])]);
  ok('⭐ si solo choca uno, se dice cuál — los otros dos entran en SU hora',
    horariosOcupados(tanda, claveDe, aMedias).length === 1
    && horariosOcupados(tanda, claveDe, aMedias)[0] === tanda[0]);

  // ── El otro camión y el otro listero NO chocan: la clave los distingue ──
  const otroCamion = (iso) => claveViajeEstable({ identidadCamion: 'cam-2 CAMION VOLTEO TORONTO', listeroId: LIS, registeredAtISO: iso });
  ok('⭐⭐ OTRO camión a la misma hora NO choca (son camiones distintos)',
    horariosOcupados(tanda, otroCamion, todas).length === 0);
  const otroListero = (iso) => claveViajeEstable({ identidadCamion: CAM, listeroId: 'lis-2', registeredAtISO: iso });
  ok('⭐ y otro listero tampoco', horariosOcupados(tanda, otroListero, todas).length === 0);

  // ── Bordes ──
  ok('sin claves cargadas no hay choque posible', horariosOcupados(tanda, claveDe, new Set()).length === 0);
  ok('una clave VACÍA no cuenta como ocupada (esa fila entra con clave al azar)',
    horariosOcupados(tanda, () => '', new Set([''])).length === 0);
  ok('sin horarios no hay tanda que correr', tandaEnElSiguienteHueco([], claveDe, todas) === null);
  ok('con horarios rotos devuelve null en vez de reventar',
    tandaEnElSiguienteHueco(['no-es-fecha'], claveDe, todas) === null);
  // Si TODO el día está ocupado se devuelve null y la pantalla lo dice, en vez
  // de girar para siempre o proponer una hora inventada.
  {
    const unSolo = horariosDeCarga('2026-09-29', 8, 0, 1);
    const todoElDia = new Set();
    for (let i = 0; i <= 400; i++) todoElDia.add(claveDe(new Date(Date.parse(unSolo[0]) + i * 5 * 60000).toISOString()));
    ok('⭐ si no hay ningún hueco, devuelve null (la pantalla avisa)',
      tandaEnElSiguienteHueco(unSolo, claveDe, todoElDia) === null);
  }

  // ── Y cómo quedó conectado en la pantalla ──
  const scr = fs.readFileSync(path.join(ROOT, 'src/screens/ViajesCamionesScreen.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('⭐ la carga manual mira ANTES si esos horarios ya tienen viaje',
    /const chocan = horariosOcupados\(horariosPedidos, claveDe, yaCargadas\)/.test(scr));
  ok('⭐ compara por la clave GUARDADA en la base, no re-deduciendo la hora',
    /new Set\(deEseCamion\.map\(\(r\) => r\.clientActionId\)\.filter\(Boolean\)/.test(scr));
  ok('⭐ solo corre la tanda cuando NO entraría ninguno',
    /const todosChocan = chocan\.length > 0 && chocan\.length === horariosPedidos\.length/.test(scr)
    && /todosChocan \? tandaEnElSiguienteHueco\(/.test(scr));
  ok('⭐ la confirmación anuncia la hora REAL en que se va a grabar',
    /desde las \$\{horaDe\(horarios\[0\]\)\}/.test(scr));
  ok('⭐ y avisa que si es la misma tanda de antes, hay que cancelar',
    /dale Cancelar/.test(scr));
  ok('⭐⭐ «no se agregó ninguno» YA NO SALE EN VERDE',
    /toast\.error\(\s*`No se agregó ninguno:/.test(scr));
  ok('…y dice qué hacer (cambiar la hora de arranque)',
    /cambia la hora de arranque/i.test(scr));
  ok('si la consulta previa falla, la carga NO se bloquea',
    /if \(!errCarga\) yaCargadas = /.test(scr));
}


console.log('\n' + pass + ' OK · ' + fail + ' FALLO(S)');
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('El mismo viaje no entra dos veces, y la edicion excepcional deja rastro.');
