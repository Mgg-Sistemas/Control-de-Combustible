/*
 * Test de los TIPOS DE INTERVENCIÓN administrables de Servicio de Maquinaria
 * (20-ago-2026).
 *
 * EL PEDIDO. El cliente pidió sobre el reporte de servicios: «para ese reporte, el
 * tipo de intervención, dame una opción para crear, borrar o modificar los tipos de
 * intervenciones». Antes eran CUATRO opciones escritas a mano en el código
 * (Mecánica · Electricidad · Mangueras/Hidráulica · Servicio): para agregar
 * «Soldadura» había que tocar el programa y volver a publicar la app. Ahora salen
 * de la tabla `service_intervention_types`.
 *
 * LO QUE MÁS HAY QUE BLINDAR — y la razón de ser de este archivo:
 * la tabla se crea corriendo `supabase/servicio_tipos_intervencion.sql` A MANO en
 * Supabase. MIENTRAS NADIE LO CORRA, la consulta falla con `42P01 · relation does
 * not exist` y la pantalla TIENE que seguir funcionando exactamente igual que
 * antes, con los cuatro tipos de siempre, sin errores rojos ni pantalla en blanco.
 * Por eso más de la mitad de estas pruebas son sobre «no hay datos» y sobre basura.
 *
 * LA OTRA REGLA: «borrar» un tipo es DESACTIVARLO. Si se borrara de verdad, los
 * servicios viejos que guardaron esa clave se quedarían sin nombre (saldría
 * `soldadura` en vez de «Soldadura») — el nombre solo vive en el catálogo.
 *
 *   npm run test:intervenciones   (o: node scripts/test-tipos-intervencion.mjs)
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

const srcPath = path.join(ROOT, 'src/lib/machineService.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const {
  INTERVENCIONES_POR_DEFECTO, resolverIntervenciones, etiquetaIntervencion,
  validarTipoIntervencion, claveDesdeTexto, INTERVENCION_LABEL,
} = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const claves = (filas) => resolverIntervenciones(filas).map((t) => t.key);
const LOS_CUATRO = ['mecanica', 'electricidad', 'mangueras', 'servicio'];

// ── 1) SIN TABLA / SIN DATOS → LOS CUATRO DE SIEMPRE ───────────────────────
// Este bloque es el que sostiene la app mientras el SQL no se haya corrido.
eq('null → los cuatro de siempre', claves(null), LOS_CUATRO);
eq('undefined → los cuatro de siempre', claves(undefined), LOS_CUATRO);
eq('sin argumento → los cuatro de siempre', resolverIntervenciones().map((t) => t.key), LOS_CUATRO);
eq('catálogo vacío → los cuatro de siempre', claves([]), LOS_CUATRO);
eq('los nombres de siempre están completos',
  resolverIntervenciones(null).map((t) => t.label),
  ['Mecánica', 'Electricidad', 'Mangueras / Hidráulica', 'Servicio']);
eq('el respaldo es el mismo que INTERVENCION_LABEL',
  resolverIntervenciones(null).map((t) => t.label),
  LOS_CUATRO.map((k) => INTERVENCION_LABEL[k]));
eq('los cuatro por defecto están declarados en orden',
  INTERVENCIONES_POR_DEFECTO.map((t) => t.key), LOS_CUATRO);

// Nadie puede ensuciar la constante de respaldo desde afuera.
const copia = resolverIntervenciones(null);
copia[0].label = 'DESTROZADO';
eq('el respaldo se devuelve en copias, no la constante viva',
  resolverIntervenciones(null)[0].label, 'Mecánica');

// ── 2) CON CATÁLOGO: SE FILTRAN LOS DESACTIVADOS ───────────────────────────
const CAT = [
  { key: 'mecanica', label: 'Mecánica', sort_order: 10, active: true },
  { key: 'soldadura', label: 'Soldadura', sort_order: 20, active: true },
  { key: 'pintura', label: 'Pintura', sort_order: 30, active: false },
];
eq('solo salen los activos', claves(CAT), ['mecanica', 'soldadura']);
eq('un tipo desactivado no se ofrece más', claves(CAT).includes('pintura'), false);
eq('active ausente cuenta como activo',
  claves([{ key: 'x', label: 'X', sort_order: 1 }]), ['x']);
eq('active null NO desactiva (solo el false explícito)',
  claves([{ key: 'x', label: 'X', sort_order: 1, active: null }]), ['x']);

// ── 3) EL ORDEN ────────────────────────────────────────────────────────────
eq('ordena por sort_order, no por como venga la base',
  claves([
    { key: 'c', label: 'C', sort_order: 30 },
    { key: 'a', label: 'A', sort_order: 10 },
    { key: 'b', label: 'B', sort_order: 20 },
  ]), ['a', 'b', 'c']);
eq('con el mismo orden, desempata por nombre',
  claves([
    { key: 'zeta', label: 'Zeta', sort_order: 5 },
    { key: 'alfa', label: 'Alfa', sort_order: 5 },
    { key: 'beta', label: 'Beta', sort_order: 5 },
  ]), ['alfa', 'beta', 'zeta']);
eq('sin sort_order va al final (100 por defecto)',
  claves([{ key: 'sin', label: 'Sin orden' }, { key: 'con', label: 'Con orden', sort_order: 1 }]),
  ['con', 'sin']);
eq('sort_order de texto numérico también sirve',
  claves([{ key: 'b', label: 'B', sort_order: '20' }, { key: 'a', label: 'A', sort_order: '10' }]),
  ['a', 'b']);

// ── 4) BASURA: NO PUEDE REVENTAR NUNCA ─────────────────────────────────────
// Si esto explota, la pestaña de Servicios se queda en blanco.
eq('[null] no revienta → los cuatro', claves([null]), LOS_CUATRO);
eq('[undefined] no revienta → los cuatro', claves([undefined]), LOS_CUATRO);
eq('[{}] (fila a medias) no revienta → los cuatro', claves([{}]), LOS_CUATRO);
eq('[{key:""}] (clave en blanco) se descarta → los cuatro', claves([{ key: '' }]), LOS_CUATRO);
eq('[{key:"   "}] (clave en blancos) se descarta → los cuatro', claves([{ key: '   ' }]), LOS_CUATRO);
eq('un texto en vez de filas → los cuatro', claves('texto'), LOS_CUATRO);
eq('un número en vez de filas → los cuatro', claves(7), LOS_CUATRO);
eq('un objeto suelto en vez de filas → los cuatro', claves({ key: 'x' }), LOS_CUATRO);
eq('mezcla de basura y filas buenas: sobrevive la buena',
  claves([null, 'texto', {}, { key: '' }, { key: 'buena', label: 'Buena', sort_order: 1 }]), ['buena']);
eq('sin nombre se usa la clave cruda como nombre',
  resolverIntervenciones([{ key: 'soldadura' }])[0].label, 'soldadura');
eq('sort_order imposible no rompe el orden',
  claves([{ key: 'a', label: 'A', sort_order: 'ñ' }, { key: 'b', label: 'B', sort_order: 1 }]), ['b', 'a']);
eq('claves repetidas se cuentan una sola vez',
  claves([{ key: 'a', label: 'A', sort_order: 1 }, { key: 'a', label: 'A otra vez', sort_order: 2 }]), ['a']);
eq('todo desactivado → los cuatro (jamás un formulario sin casillas)',
  claves([{ key: 'a', label: 'A', active: false }]), LOS_CUATRO);

// ── 5) EL NOMBRE DE UNA CLAVE (servicios viejos incluidos) ─────────────────
eq('una clave conocida sale con su nombre', etiquetaIntervencion('mecanica', CAT), 'Mecánica');
eq('una clave del catálogo nuevo sale con su nombre', etiquetaIntervencion('soldadura', CAT), 'Soldadura');
// LO IMPORTANTE: un servicio viejo NO puede quedarse sin texto.
eq('clave desconocida → la clave cruda, NUNCA undefined',
  etiquetaIntervencion('inventada', CAT), 'inventada');
eq('clave desconocida sin catálogo → la clave cruda',
  etiquetaIntervencion('inventada', null), 'inventada');
eq('los cuatro de siempre tienen nombre aunque no haya catálogo',
  etiquetaIntervencion('mangueras', null), 'Mangueras / Hidráulica');
eq('un tipo renombrado en el catálogo manda sobre el nombre viejo',
  etiquetaIntervencion('mecanica', [{ key: 'mecanica', label: 'Mecánica pesada', sort_order: 1 }]),
  'Mecánica pesada');
ok('nunca devuelve undefined', typeof etiquetaIntervencion('lo-que-sea', null) === 'string');
eq('sin clave devuelve vacío, no "undefined"', etiquetaIntervencion(null, CAT), '');

// ── 6) LA CLAVE SE ARMA SOLA DESDE EL NOMBRE ───────────────────────────────
eq('minúsculas y guion bajo', claveDesdeTexto('Aire Acondicionado'), 'aire_acondicionado');
eq('sin acentos', claveDesdeTexto('Mecánica'), 'mecanica');
eq('la ñ también', claveDesdeTexto('Cañería'), 'caneria');
eq('signos raros fuera', claveDesdeTexto('Mangueras / Hidráulica'), 'mangueras_hidraulica');
eq('sin guiones bajos colgando', claveDesdeTexto('  ¡Soldadura!  '), 'soldadura');
eq('un nombre sin letras da clave vacía', claveDesdeTexto('¿¡...!?'), '');
eq('null da clave vacía', claveDesdeTexto(null), '');

// ── 7) VALIDAR UN TIPO NUEVO ───────────────────────────────────────────────
const YA = [{ key: 'mecanica' }, { key: 'soldadura' }];
ok('nombre vacío → error', !!validarTipoIntervencion({ label: '', key: '' }, YA));
ok('nombre en blancos → error', !!validarTipoIntervencion({ label: '   ' }, YA));
ok('nombre sin letras ni números → error', !!validarTipoIntervencion({ label: '¿¡!?' }, YA));
eq('caso bueno → sin error', validarTipoIntervencion({ label: 'Pintura', key: '' }, YA), null);
eq('caso bueno con clave escrita a mano → sin error',
  validarTipoIntervencion({ label: 'Aire acondicionado', key: 'aire_ac' }, YA), null);

ok('clave repetida (escrita) → error', !!validarTipoIntervencion({ label: 'Otra', key: 'mecanica' }, YA));
ok('clave repetida (generada del nombre) → error',
  !!validarTipoIntervencion({ label: 'Soldadura', key: '' }, YA));
ok('el nombre repetido con acento también choca (Mecánica → mecanica)',
  !!validarTipoIntervencion({ label: 'Mecánica' }, YA));

ok('clave con espacios → error', !!validarTipoIntervencion({ label: 'Aire', key: 'aire acond' }, YA));
ok('clave con acentos → error', !!validarTipoIntervencion({ label: 'Mecánica', key: 'mecánica' }, YA));
ok('clave con mayúsculas → error', !!validarTipoIntervencion({ label: 'Pintura', key: 'Pintura' }, YA));
ok('el mensaje de error es en cristiano, no un código',
  /minúsculas/.test(validarTipoIntervencion({ label: 'Pintura', key: 'Pintura' }, YA) ?? ''));

eq('sin lista de existentes tampoco revienta', validarTipoIntervencion({ label: 'Pintura' }, null), null);
ok('sin argumentos tampoco revienta', !!validarTipoIntervencion(null, null));
eq('existentes con basura adentro no revienta',
  validarTipoIntervencion({ label: 'Pintura' }, [null, {}, { key: '' }]), null);

// ── 8) GUARDAS SOBRE LA PANTALLA ───────────────────────────────────────────
const scr = fs.readFileSync(path.join(ROOT, 'src/screens/ServicioRegistroTab.tsx'), 'utf8');

ok('la pantalla usa la función pura, no una copia', /resolverIntervenciones\(filasTipos\)/.test(scr));
ok('no quedó una reimplementación del listado en la pantalla',
  !/Object\.keys\(INTERVENCION_LABEL\)/.test(scr) && !scr.includes('INTERVENCION_LABEL'));
ok('las casillas del formulario salen del catálogo cargado', /tipos\.map\(\(t\) =>/.test(scr));
ok('la tarjeta pone el nombre con la función pura', /etiquetaIntervencion\(k, tiposParaEtiquetar\)/.test(scr));

// LO MÁS IMPORTANTE: la carga NO puede tumbar la pantalla si la tabla no existe.
const carga = (scr.match(/const cargarTipos = async \(\) => \{[\s\S]*?\n  \};/) ?? [''])[0];
ok('existe la carga del catálogo', carga.includes('service_intervention_types'));
ok('la carga está dentro de un try/catch', /try \{[\s\S]*\} catch/.test(carga));
ok('la carga cae sin ruido: ni toast de error ni console.error',
  !carga.includes('toast.error') && !carga.includes('console.error') && !carga.includes('console.warn'));
ok('si falla, deja el catálogo en null (→ los cuatro de siempre)', /setFilasTipos\(null\)/.test(carga));

ok('existe el botón "⚙️ Tipos de intervención"', scr.includes('⚙️ Tipos de intervención'));
ok('el botón solo sale con permiso de escritura',
  /canWrite \?[\s\S]{0,220}⚙️ Tipos de intervención/.test(scr));
ok('el modal avisa cuando la tabla todavía no existe',
  /Todavía no está creada la tabla de tipos de intervención/.test(scr)
  && scr.includes('supabase/servicio_tipos_intervencion.sql'));
ok('antes de desactivar se explica que los servicios viejos lo siguen mostrando',
  /confirm\(\{[\s\S]{0,400}SIGUEN mostrando/.test(scr));
ok('desactivar es un update de active, no un delete',
  /\.update\(\{ active: !t\.active \}\)/.test(scr) && !/service_intervention_types'\)\s*\n?\s*\.delete\(/.test(scr));
ok('el modal nuevo usa zIndex 9999 (en web gana el último montado)',
  /tiposOpen[\s\S]{0,400}zIndex: 9999/.test(scr));
// El proyecto NO usa Alert de React Native: en web no se ve.
ok('no usa Alert.alert', !/Alert\.alert/.test(scr) && !/\bAlert\b.*from 'react-native'/.test(scr));

// ── 9) GUARDAS SOBRE EL SQL ────────────────────────────────────────────────
const sqlPath = path.join(ROOT, 'supabase/servicio_tipos_intervencion.sql');
ok('existe supabase/servicio_tipos_intervencion.sql', fs.existsSync(sqlPath));
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';
// Solo lo que de verdad se ejecuta (fuera los comentarios).
const vivo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();

ok('crea la tabla de forma idempotente',
  /create table if not exists public\.service_intervention_types/.test(vivo));
ok('la clave es única', /key\s+text not null unique/.test(vivo));
ok('siembra los cuatro sin duplicar', /on conflict \(key\) do nothing/.test(vivo));
ok('siembra los cuatro de siempre', LOS_CUATRO.every((k) => vivo.includes(`'${k}'`)));
ok('trae RLS', vivo.includes('enable row level security'));
ok('trae el trigger de auditoría', vivo.includes('public.audit_row()'));
ok('NO hay política de delete (borrar es desactivar)', !/for delete/.test(vivo));
ok('NO borra ni altera datos existentes',
  !/\bdelete from\b/.test(vivo) && !/\bdrop table\b/.test(vivo) && !/\btruncate\b/.test(vivo));
ok('NO toca machinery_service_orders (solo la lee en la verificación)',
  !/(update|alter table|delete from|insert into)[^\n]*machinery_service_orders/.test(vivo));
ok('el archivo avisa que hay que correrlo a mano', /A MANO|a mano/.test(sql));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-tipos-intervencion · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
