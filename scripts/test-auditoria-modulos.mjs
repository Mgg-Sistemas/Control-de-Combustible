/*
 * LOS MODULOS DE LA AUDITORIA SON LAS SECCIONES DEL MENU (07-sep-2026).
 *
 * Pedido del cliente, textual: «cuando me refiero a modulo, no me refiero a flota
 * y maquinaria, sino que por modulo me imaginaba a Control, Inspecciones... la
 * idea es que si yo busco por modulos, pueda ver los cambios que se hicieron en
 * Nomina, o en Inspecciones, o en cualquier otro». Y despues, con el menu de la
 * app en pantalla: «sube lo de la auditoria, si ya estan todos los modulos o
 * apartados».
 *
 * Antes el reparto era por TABLA de base de datos, en once cajones, y uno solo
 * -"Maquinaria y flota"- se tragaba el Catalogo, el Control de maquinaria, el
 * Servicio (averias), el Mantenimiento y la flota.
 *
 * LA TRAMPA DE FONDO: `audit_log` guarda QUE TABLA se toco, NO de que pantalla
 * vino, y a `machinery` le escriben ~20 pantallas. Lo unico que desempata son las
 * ACCIONES propias de la app (JORNADA_INICIO, JORNADA_FIN, PARADA, CHECK, SCAN):
 * por eso el modulo se decide por (tabla + accion), en ese orden. Si alguien
 * invierte ese orden, TODAS las jornadas vuelven a salir como "Catalogo".
 *
 * Lo que fijan estos casos:
 *   - que la lista de modulos sea EL MENU de la app (MoreScreen), seccion por
 *     seccion: si alguien agrega una seccion al menu y no aqui, falla;
 *   - que una jornada sobre `machinery` sea CONTROL y no Catalogo;
 *   - que ninguna tabla con trigger de auditoria caiga en "Otro" (el 20-ago-2026
 *     habia once asi y medio sistema se veia como "Otro");
 *   - que las secciones marcadas "sin rastro aun" sean exactamente las que no
 *     tienen trigger en ningun .sql, ni mas ni menos;
 *   - que cada tabla del mapa exista de verdad (un typo caeria en "Otro" en silencio);
 *   - que el filtro por modulo y el agrupado usen LA MISMA regla;
 *   - y que la libreria sea pura: no toca la base de datos (el cliente pidio
 *     expresamente que la auditoria no se abuse ni se tumbe).
 *
 *   node scripts/test-auditoria-modulos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const mod = { exports: {} };
new Function('exports', 'module', ts.transpileModule(
  leer('src/lib/auditModulos.ts'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } },
).outputText)(mod.exports, mod);

const {
  MODULOS_AUDITORIA, MODULO_OTRO, SIN_RASTRO_SUFIJO, moduloDeFila, etiquetaModulo, etiquetaPastilla,
  filaEnModulos, tablasConocidas, tablasDeModulo, accionesDeModulo,
} = mod.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? '  -> ' + extra : ''}`); } };

/** La clave del modulo de una fila, o null. */
const keyDe = (table_name, action) => (moduloDeFila({ table_name, action }) || {}).key ?? null;
const claves = new Set(MODULOS_AUDITORIA.map((m) => m.key));

console.log('LOS MODULOS DE LA AUDITORIA\n');

// ── 1) LA LISTA ────────────────────────────────────────────────────────────
{
  ok('hay modulos', MODULOS_AUDITORIA.length >= 20, String(MODULOS_AUDITORIA.length));
  ok('* cada uno con llave, nombre e icono', MODULOS_AUDITORIA.every((m) => m.key && m.label && m.icon));
  ok('* ninguna llave repetida', claves.size === MODULOS_AUDITORIA.length);
  ok('* ningun nombre repetido', new Set(MODULOS_AUDITORIA.map((m) => m.label)).size === MODULOS_AUDITORIA.length);
  ok('* ningun icono repetido (en la pastilla se distinguen de un vistazo)', new Set(MODULOS_AUDITORIA.map((m) => m.icon)).size === MODULOS_AUDITORIA.length,
    MODULOS_AUDITORIA.map((m) => m.icon).join(' '));
  // ⭐ Lo que pidio el cliente: que las secciones que el nombra existan por separado.
  for (const k of ['control', 'inspecciones', 'nomina', 'servicio', 'equipos', 'combustible', 'mantenimiento',
    'inspecciones_maq', 'asistencia_camiones', 'asistencia', 'aliados', 'compras', 'inventario', 'pagos', 'lavado', 'geodesta', 'fabricacion', 'acarreo', 'viajes']) {
    ok(`⭐ existe el modulo "${k}"`, claves.has(k));
  }
  ok('⭐⭐ ya NO existe el cajon "maquinaria" que se tragaba todo', !claves.has('maquinaria'));
  // El orden es el del menu (alfabetico por nombre), para que se reconozca.
  const nombres = MODULOS_AUDITORIA.filter((m) => m.key !== 'avisos').map((m) => m.label);
  const ordenados = [...nombres].sort((a, b) => a.localeCompare(b, 'es'));
  eq('* van en orden alfabetico como el menu (Avisos, que no es del menu, al final)', nombres, ordenados);
}

// ── 1b) ⭐⭐ EL MENU Y LA AUDITORIA SON LA MISMA LISTA ──────────────────────
// Se lee MoreScreen y se comprueba que cada seccion del menu tenga su modulo.
// Si la compañera agrega una seccion nueva al menu, esto falla y hay que decidir
// a que modulo va (o crearlo).
{
  const more = leer('src/screens/MoreScreen.tsx');
  const items = [...more.matchAll(/\{ label: '([^']+)', route: '[^']+', desc: '[^']*', icon: '[^']+', module: '([a-z_]+)' \}/g)]
    .map((m) => ({ label: m[1], menu: m[2] }));
  ok('se leyo el menu de la app', items.length >= 20, `items ${items.length}`);

  // Menu (permiso) -> modulo de auditoria. `null` = seccion sin datos propios que auditar.
  const MENU_A_MODULO = {
    control_pagos: 'pagos',
    margen_ganancia: 'equipos',           // edita el costo en la FICHA de la maquina
    mantenimiento: 'mantenimiento',
    servicio: 'servicio',
    operadores: 'operadores',
    coordinacion_operadores: 'operadores',
    supervision: 'inspecciones',
    obras_publicas: 'obras',
    lavado_maquinaria: 'lavado',
    inspecciones_maq: 'inspecciones_maq',
    geodesta: 'geodesta',
    comida: 'alimentacion',
    equipos: 'equipos',                   // Empresas (tabla companies -> empresas) y Escanear QR
    nomina: 'nomina',
    asistencia: 'asistencia',
    asistencia_camiones: 'asistencia_camiones',
    viajes_camiones: 'viajes',
    aliados: 'aliados',
    compras: 'compras',
    inventario: 'inventario',
    reportes: null,                       // solo lee
    mangueras: 'fabricacion',
    acarreo: 'acarreo',
  };
  for (const it of items) {
    ok(`⭐ el menu "${it.label}" (${it.menu}) esta contemplado`, it.menu in MENU_A_MODULO);
    const destino = MENU_A_MODULO[it.menu];
    if (destino) ok(`* y su modulo "${destino}" existe`, claves.has(destino));
  }
  // Las secciones fijas del menu (fuera de la lista `items`) y la pestaña Control.
  for (const k of ['combustible', 'usuarios', 'control']) ok(`* la seccion fija "${k}" tiene modulo`, claves.has(k));
  // Y al reves: ningun modulo de auditoria que no sea una seccion (salvo Avisos).
  const destinos = new Set(Object.values(MENU_A_MODULO).filter(Boolean).concat(['combustible', 'usuarios', 'control', 'avisos', 'empresas']));
  for (const m of MODULOS_AUDITORIA) ok(`* el modulo "${m.key}" corresponde a una seccion`, destinos.has(m.key));
}

// ── 2) ⭐⭐ LA ACCION MANDA SOBRE LA TABLA (esto es todo el arreglo) ──────────
{
  // La MISMA tabla, `machinery`, repartida segun lo que se hizo.
  eq('⭐⭐ una JORNADA sobre machinery es CONTROL, no Catalogo', keyDe('machinery', 'JORNADA_INICIO'), 'control');
  eq('* el fin de jornada tambien', keyDe('machinery', 'JORNADA_FIN'), 'control');
  eq('* y una PARADA tambien', keyDe('machinery', 'PARADA'), 'control');
  eq('⭐ asignar la maquina a un inspector (CHECK) es INSPECCIONES', keyDe('machinery', 'CHECK'), 'inspecciones');
  eq('* escanear el QR de una maquina tambien', keyDe('machinery', 'SCAN'), 'inspecciones');
  eq('⭐ editar la FICHA de la maquina si es el Catalogo', keyDe('machinery', 'UPDATE'), 'equipos');
  eq('* crearla tambien', keyDe('machinery', 'INSERT'), 'equipos');
  eq('* y borrarla', keyDe('machinery', 'DELETE'), 'equipos');

  // El SCAN depende de sobre QUE se hizo: un carnet no es una ronda.
  eq('⭐ escanear el carnet de un empleado es NOMINA', keyDe('employees', 'SCAN'), 'nomina');
  eq('* y editar su ficha tambien', keyDe('employees', 'UPDATE'), 'nomina');

  eq('entrar al sistema es USUARIOS', keyDe('profiles', 'LOGIN'), 'usuarios');
  eq('* y salir tambien', keyDe('profiles', 'LOGOUT'), 'usuarios');
  eq('* editar un perfil tambien', keyDe('profiles', 'UPDATE'), 'usuarios');

  // ⭐⭐ La mutacion que mas duele: si la tabla ganara sobre la accion, TODAS las
  //     jornadas volverian a salir como "Catalogo de equipos" y el cliente no
  //     tendria como preguntar "que se hizo en Control".
  ok('⭐⭐ jornada y ficha NO caen en el mismo modulo',
    keyDe('machinery', 'JORNADA_INICIO') !== keyDe('machinery', 'UPDATE'));
}

// ── 3) CADA SECCION EN SU CAJON (con los cortes del menu) ──────────────────
{
  eq('las jornadas de la maquina', keyDe('machine_rounds', 'UPDATE'), 'control');
  eq('* el cierre del control tambien', keyDe('control_closures', 'INSERT'), 'control');
  eq('⭐ la ronda del inspector es INSPECCIONES', keyDe('supervisor_visits', 'INSERT'), 'inspecciones');
  eq('* a quien le toca cada maquina tambien', keyDe('machine_inspectors', 'UPDATE'), 'inspecciones');
  eq('⭐ el inventario de herramientas de un equipo es INSPECCIONES DE MAQUINARIA (otra seccion del menu)', keyDe('machine_inspections', 'INSERT'), 'inspecciones_maq');
  ok('* y NO cae en la misma que las rondas', keyDe('machine_inspections', 'INSERT') !== keyDe('supervisor_visits', 'INSERT'));
  eq('⭐ presente/ausente de un camion es ASISTENCIA DE CAMIONES, no Control', keyDe('truck_yard_logs', 'INSERT'), 'asistencia_camiones');
  eq('⭐ el carnet marcado es CONTROL DE ASISTENCIA, no Nomina', keyDe('attendance', 'INSERT'), 'asistencia');
  eq('⭐ un aliado es ALIADOS, no Nomina', keyDe('aliados', 'UPDATE'), 'aliados');
  eq('el operador asignado', keyDe('operator_assignments', 'INSERT'), 'operadores');
  eq('* y el turno que le pone el coordinador', keyDe('machine_operators', 'INSERT'), 'operadores');
  eq('⭐ una averia es SERVICIO', keyDe('maintenance_requests', 'INSERT'), 'servicio');
  eq('* la orden de servicio tambien', keyDe('machinery_service_orders', 'INSERT'), 'servicio');
  eq('* y sus repuestos', keyDe('machinery_service_parts', 'INSERT'), 'servicio');
  eq('⭐ un expediente de reparacion es MANTENIMIENTO', keyDe('machinery_repairs', 'INSERT'), 'mantenimiento');
  eq('un viaje de camion', keyDe('camion_viajes', 'INSERT'), 'viajes');
  eq('* y la correccion de un viaje de otro dia', keyDe('camion_viajes', 'EDIT_VIAJE_FUERA_JORNADA'), 'viajes');
  eq('una orden de acarreo', keyDe('haul_orders', 'INSERT'), 'acarreo');
  eq('* y un flete', keyDe('fletes', 'INSERT'), 'acarreo');
  eq('un despacho de combustible', keyDe('dispatches', 'INSERT'), 'combustible');
  eq('* y un tanque', keyDe('tanks', 'UPDATE'), 'combustible');
  eq('la nomina', keyDe('staff_pay_payments', 'INSERT'), 'nomina');
  eq('* y la ficha del empleado', keyDe('employees', 'INSERT'), 'nomina');
  eq('⭐ un pago a empresa es CONTROL DE PAGOS', keyDe('company_payments', 'INSERT'), 'pagos');
  eq('* la ficha de la empresa sigue en Empresas', keyDe('companies', 'UPDATE'), 'empresas');
  eq('* y sus tarifas tambien', keyDe('price_tariffs', 'UPDATE'), 'empresas');
  eq('⭐ una orden de compra es COMPRAS, no Inventario', keyDe('purchase_orders', 'INSERT'), 'compras');
  eq('* un proveedor tambien', keyDe('suppliers', 'INSERT'), 'compras');
  eq('* y la existencia de un material si es INVENTARIO', keyDe('inventory_items', 'UPDATE'), 'inventario');
  eq('* una salida de inventario tambien', keyDe('inventory_movements', 'INSERT'), 'inventario');
  eq('la comida', keyDe('food_distributions', 'INSERT'), 'alimentacion');
  eq('un lavado', keyDe('lm_washes', 'INSERT'), 'lavado');
  eq('un levantamiento de geodesta', keyDe('geodesta_projects', 'INSERT'), 'geodesta');
  eq('una orden de fabricacion', keyDe('work_orders', 'UPDATE'), 'fabricacion');
  eq('obras publicas', keyDe('op_edificio_base', 'UPDATE'), 'obras');
  eq('* y sus partes diarios', keyDe('op_daily_reports', 'INSERT'), 'obras');
  eq('los permisos', keyDe('module_permissions', 'UPDATE'), 'usuarios');
  eq('la ficha del vehiculo es CATALOGO', keyDe('vehicles', 'UPDATE'), 'equipos');
  eq('los avisos', keyDe('notifications', 'INSERT'), 'avisos');
}

// ── 4) LO QUE NO SE SABE NO SE INVENTA ─────────────────────────────────────
{
  eq('una tabla desconocida no tiene modulo', keyDe('tabla_que_no_existe', 'INSERT'), null);
  eq('* y se muestra como "Otro" (no se esconde la fila)', etiquetaModulo({ table_name: 'tabla_que_no_existe', action: 'INSERT' }), MODULO_OTRO);
  eq('sin tabla tampoco revienta', keyDe(null, null), null);
  eq('* ni con una fila vacia', moduloDeFila({}), null);
  eq('* ni sin fila', moduloDeFila(undefined), null);
  // Una accion propia DESCONOCIDA no puede tumbar el reparto: manda la tabla.
  eq('una accion nueva que nadie mapeo cae por su tabla', keyDe('machinery', 'ACCION_NUEVA'), 'equipos');
  // Mayusculas/minusculas y espacios de mas no cambian nada.
  eq('la tabla en mayusculas igual', keyDe('MACHINERY', 'UPDATE'), 'equipos');
  eq('* la accion en minusculas tambien', keyDe('machinery', 'jornada_inicio'), 'control');
  eq('* con espacios sobrantes tambien', keyDe('  machinery  ', '  PARADA  '), 'control');
}

// ── 5) LA ETIQUETA QUE SE VE ───────────────────────────────────────────────
{
  const e = etiquetaModulo({ table_name: 'machine_rounds', action: 'UPDATE' });
  ok('la etiqueta lleva icono y nombre', /^\S+\s+Control de maquinaria/.test(e), e);
  ok('* la de una averia dice Servicio', /Servicio/.test(etiquetaModulo({ table_name: 'maintenance_requests', action: 'INSERT' })));
  // La pastilla del filtro avisa cuando la seccion no deja rastro; el agrupado NO
  // (una fila que existe, por definicion, dejo rastro).
  const lavado = MODULOS_AUDITORIA.find((m) => m.key === 'lavado');
  const nomina = MODULOS_AUDITORIA.find((m) => m.key === 'nomina');
  ok('la pastilla de una seccion sin rastro lo dice', etiquetaPastilla(lavado).endsWith(SIN_RASTRO_SUFIJO), etiquetaPastilla(lavado));
  ok('* la de una con rastro no', !etiquetaPastilla(nomina).includes(SIN_RASTRO_SUFIJO), etiquetaPastilla(nomina));
  ok('* y el agrupado nunca lleva ese sufijo', !etiquetaModulo({ table_name: 'lm_washes', action: 'INSERT' }).includes(SIN_RASTRO_SUFIJO));
}

// ── 6) ⭐ EL FILTRO Y EL AGRUPADO USAN LA MISMA REGLA ───────────────────────
{
  const fila = { table_name: 'machinery', action: 'JORNADA_INICIO' };
  ok('sin filtro pasa todo', filaEnModulos(fila, new Set()));
  ok('⭐ filtrando por Control, la jornada pasa', filaEnModulos(fila, new Set(['control'])));
  ok('⭐ filtrando por Catalogo, la jornada NO pasa', !filaEnModulos(fila, new Set(['equipos'])));
  ok('* la ficha si pasa por Catalogo', filaEnModulos({ table_name: 'machinery', action: 'UPDATE' }, new Set(['equipos'])));
  ok('* se pueden pedir varios modulos', filaEnModulos(fila, new Set(['nomina', 'control'])));
  ok('una fila sin modulo no pasa ningun filtro', !filaEnModulos({ table_name: 'xxx' }, new Set(['control'])));

  // ⭐⭐ La invariante: filtrar y agrupar tienen que coincidir SIEMPRE. Si un dia
  //     se separan, se puede filtrar por "Control" y ver grupos de otra cosa.
  const casos = [
    ['machinery', 'JORNADA_FIN'], ['machinery', 'UPDATE'], ['machinery', 'CHECK'],
    ['employees', 'SCAN'], ['profiles', 'LOGIN'], ['camion_viajes', 'INSERT'],
    ['maintenance_requests', 'UPDATE'], ['machinery_repairs', 'INSERT'], ['dispatches', 'INSERT'],
    ['truck_yard_logs', 'INSERT'], ['attendance', 'INSERT'], ['purchase_orders', 'INSERT'], ['machine_inspections', 'INSERT'],
  ];
  let coinciden = 0;
  for (const [t, a] of casos) {
    const m = moduloDeFila({ table_name: t, action: a });
    if (m && filaEnModulos({ table_name: t, action: a }, new Set([m.key])) && etiquetaModulo({ table_name: t, action: a }) === `${m.icon} ${m.label}`) coinciden++;
  }
  eq(`⭐⭐ filtro, agrupado y etiqueta coinciden en los ${casos.length} casos`, coinciden, casos.length);
}

// ── 7) ⭐ NINGUNA TABLA AUDITADA CAE EN "OTRO", Y "SIN RASTRO" ES VERDAD ──────
// Si una tabla tiene trigger de auditoria pero no esta en el mapa, sus acciones
// salen como "Otro" y el agrupado deja de servir. El 20-ago-2026 habia ONCE asi.
{
  const sqlDir = path.join(ROOT, 'supabase');
  const auditadas = new Set();
  for (const f of fs.readdirSync(sqlDir).filter((x) => x.endsWith('.sql'))) {
    const txt = leer(path.join('supabase', f));
    // Solo los bucles que crean o encienden `trg_audit` (audit.sql y
    // auditoria_reencender_tablas_humanas.sql). OJO: los .sql de realtime tambien
    // recorren tablas con `foreach`; si se cuentan, Obras Publicas y Avisos parecen
    // auditados sin serlo (paso el 07-sep-2026 al escribir esta prueba).
    for (const bloque of txt.matchAll(/foreach t in array array\[([\s\S]*?)\][\s\S]*?end loop/g)) {
      if (!/trg_audit/.test(bloque[0])) continue;
      for (const m of bloque[1].matchAll(/'([a-z_]+)'/g)) auditadas.add(m[1]);
    }
    for (const m of txt.matchAll(/create trigger trg_audit\w*\s+[\s\S]{0,80}?on public\.([a-z_]+)/g)) auditadas.add(m[1]);
  }
  auditadas.delete('audit_row'); // es el nombre de la funcion, no una tabla

  ok('se detectaron las tablas auditadas', auditadas.size > 20, `detectadas ${auditadas.size}`);
  const huerfanas = [...auditadas].filter((t) => !moduloDeFila({ table_name: t, action: 'UPDATE' })).sort();
  ok(`⭐ ninguna tabla auditada cae en "Otro" (${auditadas.size} auditadas)`, huerfanas.length === 0,
    huerfanas.length ? `sin modulo: ${huerfanas.join(', ')}` : '');

  // ⭐ "Sin rastro aun" tiene que ser verdad en los dos sentidos: ni prometer rastro
  //    donde no hay trigger, ni tachar de "sin rastro" a una seccion que si lo tiene.
  for (const m of MODULOS_AUDITORIA) {
    const conTrigger = tablasDeModulo(m.key).filter((t) => auditadas.has(t));
    const conAccion = accionesDeModulo(m.key);
    const dejaRastro = conTrigger.length > 0 || conAccion.length > 0;
    ok(`* "${m.label}": ${dejaRastro ? 'deja rastro' : 'sin rastro'} y la lista dice lo mismo`, dejaRastro === !m.sinRastro,
      `triggers: ${conTrigger.join(', ') || '—'} · acciones: ${conAccion.join(', ') || '—'}`);
  }

  // Cada tabla del mapa tiene que EXISTIR: en el codigo (.from('x') / useTable('x'))
  // o en algun .sql (create table / trigger). Un typo caeria en "Otro" en silencio.
  const conocidas = new Set();
  const recoger = (dir) => {
    for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, ent.name);
      if (ent.isDirectory()) recoger(rel);
      else if (/\.(tsx?|sql)$/.test(ent.name)) {
        const txt = leer(rel);
        for (const m of txt.matchAll(/\.from\('([a-z_0-9]+)'\)/g)) conocidas.add(m[1]);
        for (const m of txt.matchAll(/useTable<[^>]*>\('([a-z_0-9]+)'/g)) conocidas.add(m[1]);
        for (const m of txt.matchAll(/(?:table|on|into|update|from)\s+(?:if not exists\s+)?public\.([a-z_0-9]+)/gi)) conocidas.add(m[1]);
      }
    }
  };
  recoger('src'); recoger('supabase');
  const fantasma = tablasConocidas().filter((t) => !conocidas.has(t));
  ok('⭐ todas las tablas del mapa existen en el codigo o en un .sql (sin typos)', fantasma.length === 0, fantasma.join(', '));
}

// ── 8) LA PANTALLA OBEDECE, NO DECIDE ──────────────────────────────────────
{
  const vivo = sinComentarios(leer('src/screens/AuditScreen.tsx'));
  ok('⭐ la pantalla ya no define los modulos por su cuenta', !/const MODULES\s*:/.test(vivo));
  ok('* ni el mapa tabla->modulo', !/TABLE_TO_MODULE/.test(vivo));
  ok('la pantalla los pide a la libreria', /from '\.\.\/lib\/auditModulos'/.test(vivo));
  ok('⭐ el agrupado usa la libreria', /groupBy === 'modulo'\) return etiquetaModulo\(r\)/.test(vivo));
  ok('⭐ y el filtro tambien (la MISMA regla)', /filaEnModulos\(r, moduleFilter\)/.test(vivo));
  ok('* las pastillas salen de la lista de la libreria', /MODULOS_AUDITORIA\.map\(/.test(vivo));
  ok('* y la pastilla usa etiquetaPastilla (para avisar "sin rastro aun")', /label=\{etiquetaPastilla\(m\)\}/.test(vivo));
  ok('* debajo de las pastillas se explica que es "sin rastro aun"', /sinRastro\)\.map\(\(m\) => m\.label\)/.test(vivo));

  const libVivo = sinComentarios(leer('src/lib/auditModulos.ts'));
  ok('⭐ la libreria NO toca la base de datos', !/supabase|\.from\(|insert\(|update\(/.test(libVivo));
  ok('* ni importa React', !/from 'react/.test(libVivo));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-auditoria-modulos · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Los modulos son las secciones del menu; la accion manda sobre la tabla.');
