/*
 * VARIOS CONTACTOS DE EMERGENCIA POR TRABAJADOR (08-sep-2026).
 *
 * Pedido del cliente, textual: «necesito que las personas puedan tener mas de un
 * contacto de emergencia».
 *
 * La ficha tenia UNO solo, en tres columnas planas de `employees`:
 * emergency_contact_name / _phone / _relation. Ahora la lista completa vive en una
 * columna nueva `emergency_contacts` (jsonb) y el contacto nº 1 se SIGUE espejando
 * en las tres viejas.
 *
 * LAS DOS TRAMPAS QUE ESTE ARCHIVO VIGILA:
 *
 *   1. Las tres columnas viejas NO son basura: las leen la vista/RPC de nomina
 *      (supabase/fix_rls_anon_nomina.sql:199-217 y supabase/schema.sql:2380-2386) y
 *      el PDF de la ficha. Si alguien deja de escribirlas, esos reportes salen en
 *      BLANCO sin que nadie se entere. Por eso hay casos que exigen el espejo.
 *
 *   2. Los ~200 empleados que YA existen tienen su contacto en las columnas viejas y
 *      la nueva vacia. No se migro ni una fila: se reconstruye AL LEER. Si alguien
 *      rompe esa reconstruccion, TODAS las fichas viejas se quedan sin contacto de
 *      emergencia de golpe.
 *
 * Ademas se fija que si el SQL no se corrio, el guardado NO se pierda: se reintenta
 * sin la columna nueva y se conserva el primer contacto, como antes.
 *
 *   node scripts/test-contactos-emergencia.mjs
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
  leer('src/lib/contactosEmergencia.ts'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } },
).outputText)(mod.exports, mod);

const {
  MAX_CONTACTOS, COLUMNA_CONTACTOS, COLUMNAS_LEGADO, contactoVacio, normalizarContacto,
  limpiarContactos, leerContactos, contactosParaGuardar, contactoEnPalabras, tituloContacto,
  PASOS_SIN_MIGRACION, quitarColumnas,
} = mod.exports;

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; failures.push(name + (extra ? `  → ${extra}` : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `esperado ${JSON.stringify(want)}, obtenido ${JSON.stringify(got)}`);

const C = (n, t, p) => ({ nombre: n, telefono: t, parentesco: p });
const MARIA = C('MARÍA PÉREZ', '0412-1234567', 'MADRE');
const JOSE = C('JOSÉ PÉREZ', '0414-7654321', 'HERMANO');
const ANA = C('ANA LUGO', '0416-1112233', 'ESPOSA');

console.log('CONTACTOS DE EMERGENCIA — varios por trabajador\n');

// ── 1) Normalizar y limpiar ─────────────────────────────────────────────────
{
  eq('un contacto se normaliza a sus tres campos', normalizarContacto({ nombre: ' MARÍA ', telefono: ' 0412 ', parentesco: ' MADRE ' }), C('MARÍA', '0412', 'MADRE'));
  eq('los campos que faltan quedan en blanco, no en null', normalizarContacto({ nombre: 'X' }), C('X', '', ''));
  eq('basura no revienta', normalizarContacto(null), C('', '', ''));
  eq('* ni undefined', normalizarContacto(undefined), C('', '', ''));

  ok('un contacto sin nada es vacío', contactoVacio(C('', '', '')));
  ok('* con solo espacios también', contactoVacio(C('  ', ' ', '  ')));
  ok('* null también', contactoVacio(null));
  ok('con solo el teléfono NO es vacío', !contactoVacio(C('', '0412', '')));
  ok('con solo el nombre tampoco', !contactoVacio(C('MARÍA', '', '')));

  eq('limpiar quita los vacíos', limpiarContactos([MARIA, C('', '', ''), JOSE]), [MARIA, JOSE]);
  eq('* conserva el orden', limpiarContactos([JOSE, MARIA]), [JOSE, MARIA]);
  eq('* lo que no es lista da lista vacía', limpiarContactos('nada'), []);
  eq('* null también', limpiarContactos(null), []);
  ok('* corta en el tope de ' + MAX_CONTACTOS, limpiarContactos(Array.from({ length: 12 }, (_, i) => C('P' + i, '04' + i, 'X'))).length === MAX_CONTACTOS);
  ok('el tope es un número razonable', MAX_CONTACTOS >= 2 && MAX_CONTACTOS <= 10, String(MAX_CONTACTOS));
}

// ── 2) ⭐ LEER: la lista manda, pero el empleado VIEJO no se queda sin contacto ──
{
  const viejo = { emergency_contact_name: 'MARÍA PÉREZ', emergency_contact_phone: '0412-1234567', emergency_contact_relation: 'MADRE' };
  eq('⭐ un empleado VIEJO (sin la columna nueva) conserva su contacto', leerContactos(viejo), [MARIA]);
  eq('* con la columna nueva vacía, igual', leerContactos({ ...viejo, emergency_contacts: [] }), [MARIA]);
  eq('* con la columna nueva en null, igual', leerContactos({ ...viejo, emergency_contacts: null }), [MARIA]);
  eq('⭐ si la lista nueva trae datos, MANDA ella', leerContactos({ ...viejo, emergency_contacts: [JOSE, ANA] }), [JOSE, ANA]);
  eq('la lista como TEXTO también se entiende (PostgREST puede devolver jsonb sin parsear)',
    leerContactos({ emergency_contacts: JSON.stringify([JOSE]) }), [JOSE]);
  eq('* un texto roto no revienta: cae a las columnas viejas', leerContactos({ ...viejo, emergency_contacts: '{no es json' }), [MARIA]);
  eq('un empleado sin nada da lista vacía', leerContactos({}), []);
  eq('* null tampoco revienta', leerContactos(null), []);
  eq('* undefined tampoco', leerContactos(undefined), []);
  eq('columnas viejas en blanco NO inventan un contacto vacío',
    leerContactos({ emergency_contact_name: '', emergency_contact_phone: null, emergency_contact_relation: '  ' }), []);
  eq('un empleado viejo con SOLO teléfono igual se lee', leerContactos({ emergency_contact_phone: '0412' }), [C('', '0412', '')]);
}

// ── 3) ⭐⭐ GUARDAR: el espejo a las columnas viejas es OBLIGATORIO ───────────
{
  const g = contactosParaGuardar([MARIA, JOSE]);
  eq('la lista completa va a la columna nueva', g.emergency_contacts, [MARIA, JOSE]);
  eq('⭐⭐ el contacto nº 1 se espeja en el nombre viejo', g.emergency_contact_name, MARIA.nombre);
  eq('⭐⭐ y en el teléfono viejo', g.emergency_contact_phone, MARIA.telefono);
  eq('⭐⭐ y en el parentesco viejo', g.emergency_contact_relation, MARIA.parentesco);
  ok('se escriben las CUATRO columnas, ni una menos',
    [COLUMNA_CONTACTOS, ...COLUMNAS_LEGADO].every((c) => c in g), Object.keys(g).join(', '));

  const vacio = contactosParaGuardar([]);
  eq('sin contactos, la lista queda vacía', vacio.emergency_contacts, []);
  eq('⭐ y las columnas viejas se LIMPIAN (no queda el rastro anterior)', vacio.emergency_contact_name, null);
  eq('* teléfono también', vacio.emergency_contact_phone, null);
  eq('* parentesco también', vacio.emergency_contact_relation, null);

  eq('los vacíos intercalados no se guardan', contactosParaGuardar([C('', '', ''), JOSE]).emergency_contacts, [JOSE]);
  eq('* y el espejo toma el primero REAL', contactosParaGuardar([C('', '', ''), JOSE]).emergency_contact_name, JOSE.nombre);
  eq('basura no revienta', contactosParaGuardar(null).emergency_contacts, []);
  eq('un contacto con campos sueltos espeja en blanco como null', contactosParaGuardar([C('SOLO NOMBRE', '', '')]).emergency_contact_phone, null);

  // ⭐⭐ Ida y vuelta: lo que se guarda es EXACTAMENTE lo que se vuelve a leer.
  const ida = contactosParaGuardar([MARIA, JOSE, ANA]);
  eq('⭐⭐ guardar y volver a leer devuelve lo mismo', leerContactos(ida), [MARIA, JOSE, ANA]);
  eq('* y si solo sobrevivieran las columnas viejas, queda el nº 1',
    leerContactos({ emergency_contact_name: ida.emergency_contact_name, emergency_contact_phone: ida.emergency_contact_phone, emergency_contact_relation: ida.emergency_contact_relation }), [MARIA]);
}

// ── 4) Cómo se ve ───────────────────────────────────────────────────────────
{
  eq('una línea legible', contactoEnPalabras(MARIA), 'MARÍA PÉREZ · 0412-1234567 (MADRE)');
  eq('sin parentesco no deja el paréntesis colgando', contactoEnPalabras(C('X', '0412', '')), 'X · 0412');
  eq('sin teléfono tampoco deja el separador', contactoEnPalabras(C('X', '', 'MADRE')), 'X (MADRE)');
  eq('sin nombre lo dice', contactoEnPalabras(C('', '0412', '')), 'Sin nombre · 0412');

  eq('con uno solo, el rótulo es el de siempre', tituloContacto(0, 1), 'Contacto de emergencia');
  eq('con varios, el primero es el principal', tituloContacto(0, 3), 'Contacto principal');
  eq('* el segundo se numera', tituloContacto(1, 3), 'Contacto 2');
  eq('* y el tercero', tituloContacto(2, 3), 'Contacto 3');
}

// ── 5) Si el SQL no se corrió, el guardado NO se pierde ─────────────────────
{
  eq('el paso previsto es la columna nueva', PASOS_SIN_MIGRACION[0].columnas, ['emergency_contacts']);
  ok('el SQL que la crea existe', fs.existsSync(path.join(ROOT, PASOS_SIN_MIGRACION[0].archivo)), PASOS_SIN_MIGRACION[0].archivo);
  ok('el mensaje de PostgREST se reconoce',
    PASOS_SIN_MIGRACION[0].detecta.test("Could not find the 'emergency_contacts' column of 'employees' in the schema cache"));
  ok('⭐ un error de permisos NO dispara el reintento',
    !PASOS_SIN_MIGRACION[0].detecta.test('new row violates row-level security policy for table "employees"'));

  const fila = contactosParaGuardar([MARIA, JOSE]);
  fila.first_name = 'PEDRO';
  const sinCol = quitarColumnas(fila, ['emergency_contacts']);
  ok('quitarColumnas saca solo esa', !('emergency_contacts' in sinCol) && sinCol.first_name === 'PEDRO');
  eq('⭐ y el contacto nº 1 SOBREVIVE en las columnas viejas', sinCol.emergency_contact_name, MARIA.nombre);
  ok('no toca el objeto original', 'emergency_contacts' in fila);

  // Simulación del bucle del formulario contra una base sin la columna.
  const insertar = (f, faltan) => { const c = faltan.find((x) => x in f); return c ? { message: `Could not find the '${c}' column of 'employees' in the schema cache` } : null; };
  const simular = (faltan, fijo = null) => {
    let f = fila, intentos = 1, error = fijo ?? insertar(f, faltan);
    for (const paso of PASOS_SIN_MIGRACION) {
      if (!error || !paso.columnas.some((c) => c in f) || !paso.detecta.test(error.message)) break;
      f = quitarColumnas(f, paso.columnas); error = fijo ?? insertar(f, faltan); intentos++;
    }
    return { error, f, intentos };
  };
  let r = simular([]);
  ok('base al día: un solo intento, con la lista completa', r.intentos === 1 && !r.error && 'emergency_contacts' in r.f);
  r = simular(['emergency_contacts']);
  ok('⭐ base sin la columna: reintenta y GUARDA igual', r.intentos === 2 && !r.error && !('emergency_contacts' in r.f));
  eq('* conservando el contacto nº 1', r.f.emergency_contact_name, MARIA.nombre);
  r = simular([], { message: 'new row violates row-level security policy for table "employees"' });
  ok('error de permisos: no reintenta y el error sale a la pantalla', r.intentos === 1 && !!r.error);
}

// ── 6) La pantalla y el formulario usan la librería, no su propia regla ─────
{
  const rf = sinComentarios(leer('src/components/RecordForm.tsx'));
  ok('el formulario conoce el campo repetible', /type: 'contactos'/.test(rf));
  ok('⭐ al EDITAR arma la lista con leerContactos', /pre\[f\.key\] = JSON\.stringify\(leerContactos\(record as any\)\)/.test(rf));
  ok('⭐ al GUARDAR reparte con contactosParaGuardar', /Object\.assign\(payload, contactosParaGuardar\(lista\)\)/.test(rf));
  ok('⭐ y reintenta sin la columna si falta', /for \(const paso of PASOS_SIN_MIGRACION\)/.test(rf) && /fila = quitarColumnas\(fila, paso\.columnas\)/.test(rf));
  ok('* el reintento solo aplica si la columna iba en la fila', /paso\.columnas\.some\(\(c\) => c in fila\)/.test(rf));
  ok('el campo por defecto nace como lista vacía', /f\.type === 'contactos'\) o\[f\.key\] = '\[\]'/.test(rf));
  ok('"obligatorio" en una lista significa al menos uno con datos', /Agrega al menos un contacto de emergencia/.test(rf));
  ok('hay tope en la interfaz', /vista\.length < MAX_CONTACTOS/.test(rf));
  ok('se puede quitar un contacto', /emitir\(vista\.filter\(\(_, j\) => j !== i\)\)/.test(rf));
  ok('* pero nunca el último (siempre queda uno en pantalla)', /vista\.length > 1 \?/.test(rf));

  const emp = sinComentarios(leer('src/screens/EmpleadosScreen.tsx'));
  ok('⭐ la ficha del empleado ya NO tiene los tres campos planos',
    !/key: 'emergency_contact_name'/.test(emp) && !/key: 'emergency_contact_phone'/.test(emp) && !/key: 'emergency_contact_relation'/.test(emp));
  ok('* y sí el campo repetible', /key: 'emergency_contacts', label: '[^']*', type: 'contactos'/.test(emp));
  ok('* bajo su propia sección', /🚑 Contactos de emergencia/.test(emp));

  const card = sinComentarios(leer('src/screens/EmployeeCardScreen.tsx'));
  ok('⭐ la tarjeta lista TODOS los contactos', /leerContactos\(emp\)\.map\(\(c, i, todos\) =>/.test(card));
  ok('* con su rótulo por posición', /tituloContacto\(i, todos\.length\)/.test(card));

  const ficha = sinComentarios(leer('src/lib/ficha.ts'));
  ok('⭐ el PDF de la ficha lista TODOS', /leerContactos\(e\)\.map\(\(c, i, todos\) => section\(/.test(ficha));
  ok('* y ya no imprime solo las columnas viejas', !/\['Nombre', e\.emergency_contact_name\]/.test(ficha));

  const lib = sinComentarios(leer('src/lib/contactosEmergencia.ts'));
  // OJO: no basta con buscar la palabra "supabase" — la librería nombra el archivo
  // supabase/*.sql en PASOS_SIN_MIGRACION y eso NO es tocar la base. Se busca la
  // IMPORTACIÓN del cliente y las LLAMADAS de escritura.
  ok('la librería NO toca la base de datos',
    !/from '\.\/supabase'|\.from\(|\.insert\(|\.update\(|\.delete\(/.test(lib));
  ok('* ni importa React', !/from 'react/.test(lib));
}

// ── 7) El SQL y los manuales ────────────────────────────────────────────────
{
  const sql = leer('supabase/empleados_varios_contactos_emergencia.sql');
  ok('el SQL agrega la columna de forma idempotente', /add column if not exists emergency_contacts jsonb not null default '\[\]'::jsonb/.test(sql));
  ok('⭐ el SQL NO borra ni altera las columnas viejas',
    !/drop\s+column/i.test(sql) && !/\b(drop|truncate)\b/i.test(sql) && !/delete\s+from/i.test(sql));
  ok('trae su consulta de comprobación', /column_name = 'emergency_contacts'/.test(sql));
  ok('está anotado en la lista de SQL pendientes', /empleados_varios_contactos_emergencia\.sql/.test(leer('supabase/PENDIENTES.md')));

  const md = leer('docs/MANUAL-USUARIO.md');
  ok('manual .md: explica los varios contactos', /Varios contactos de emergencia \(08\/09\/2026\)/.test(md));
  const ms = leer('src/screens/ManualScreen.tsx');
  ok('manual en pantalla: explica los varios contactos', /VARIOS CONTACTOS DE EMERGENCIA \(08\/09\/2026\)/.test(ms));
}

if (fail) {
  console.log(`\n✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nCada persona puede tener varios contactos, y el nº 1 sigue espejado donde los reportes viejos lo leen.`);
