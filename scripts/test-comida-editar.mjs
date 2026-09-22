/*
 * Test de CORREGIR COMIDAS (18-sep-2026).
 *
 * Pedido del cliente: agregar comidas en cualquier día, corregir una cantidad
 * que faltó o que sobró, y modificar el histórico de cualquier empresa o
 * persona, desde el teléfono.
 *
 * Lo que fija:
 *   · la coma es el decimal (a la venezolana): «4,50» son cuatro con cincuenta
 *   · solo se manda lo que DE VERDAD cambió (un UPDATE que reescribe lo mismo
 *     ensucia la bitácora con «nota: (vacío) → (vacío)» y nadie la lee)
 *   · no se puede registrar una comida de un día que todavía no llegó
 *   · hacia atrás NO hay límite: corregir el histórico es lo que se pidió
 *   · un rechazo por permisos vuelve SIN error y con 0 filas, y hay que
 *     traducirlo (si no, la pantalla dice «guardado» y no guardó nada)
 *   · el único por persona/comida/día se explica en criollo
 *   · «Otros» exige nombre del plato, y no existe por carnet
 *
 *   node scripts/test-comida-editar.mjs
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

function loadTs(rel) {
  const abs = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  m._compile(out, m.filename);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const E = loadTs('src/lib/comidaEditar.ts');
const HOY = '2026-09-18';

// ── 1) LEER NÚMEROS A LA VENEZOLANA ─────────────────────────────────────────
{
  eq('⭐ «4,50» son cuatro con cincuenta, no cuatrocientos cincuenta', E.leerDecimal('4,50'), 4.5);
  eq('«4.50» también se entiende', E.leerDecimal('4.50'), 4.5);
  eq('entero pelado', E.leerDecimal('7'), 7);
  eq('con espacios alrededor', E.leerDecimal('  3,25  '), 3.25);
  eq('vacío es «no escribió nada»', E.leerDecimal(''), null);
  eq('letras no son un número', E.leerDecimal('cuatro'), null);
  eq('dos comas no son un número', E.leerDecimal('4,5,0'), null);

  eq('cantidad entera', E.leerCantidad('12'), 12);
  eq('⭐ la cantidad NO admite coma (son platos, no litros)', E.leerCantidad('1,5'), null);
  eq('cero no vale: para eso se borra', E.leerCantidad('0'), null);
  eq('negativo no vale', E.leerCantidad('-3'), null);
  eq('vacío no vale', E.leerCantidad(''), null);
}

// ── 2) SOLO SE MANDA LO QUE CAMBIÓ ──────────────────────────────────────────
{
  const actual = { delivered: 10, unit_cost: 2, item_label: 'Postre', note: 'algo' };

  const soloCantidad = E.validarCambioEmpresa(actual, { cantidad: '12', costo: '2', plato: 'Postre', nota: 'algo' });
  ok('cambiar solo la cantidad pasa', soloCantidad.ok);
  eq('⭐ y el parche lleva SOLO la cantidad', soloCantidad.patch, { cantidad: 12 });

  const nada = E.validarCambioEmpresa(actual, { cantidad: '10', costo: '2', plato: 'Postre', nota: 'algo' });
  eq('⭐ sin cambiar nada, no se manda un UPDATE vacío', nada.ok, false);
  ok('...y lo dice', nada.error.includes('No cambiaste nada'));

  const costoIgual = E.validarCambioEmpresa(actual, { costo: '2,00' });
  eq('⭐ «2,00» y 2 son el mismo costo: no es un cambio', costoIgual.ok, false);

  const costoNuevo = E.validarCambioEmpresa(actual, { costo: '2,50' });
  eq('un costo distinto sí es un cambio', costoNuevo.patch, { costo: 2.5 });

  const varios = E.validarCambioEmpresa(actual, { cantidad: '8', nota: 'sobraron' });
  eq('varios campos a la vez', varios.patch, { cantidad: 8, nota: 'sobraron' });

  const notaVacia = E.validarCambioEmpresa({ ...actual, note: 'algo' }, { nota: '   ' });
  eq('⭐ vaciar la nota sí es un cambio, y va como null', notaVacia.patch, { nota: null });
}

// ── 3) LO QUE NO SE ACEPTA ──────────────────────────────────────────────────
{
  const actual = { delivered: 10, unit_cost: 0 };
  ok('cantidad con letras se rechaza', !E.validarCambioEmpresa(actual, { cantidad: 'diez' }).ok);
  ok('...y explica que si fueron cero se borra', E.validarCambioEmpresa(actual, { cantidad: '0' }).error.includes('borra la entrega'));
  ok('una cantidad absurda se frena', !E.validarCambioEmpresa(actual, { cantidad: '999999' }).ok);
  ok('costo negativo se rechaza', !E.validarCambioEmpresa(actual, { costo: '-1' }).ok);
  ok('costo con letras se rechaza', !E.validarCambioEmpresa(actual, { costo: 'gratis' }).ok);
}

// ── 4) POR PERSONA: no hay costo ni plato ───────────────────────────────────
{
  const actual = { meals: 1, note: null };
  eq('corregir la cantidad', E.validarCambioPersona(actual, { cantidad: '2' }).patch, { cantidad: 2 });
  eq('sin cambios avisa', E.validarCambioPersona(actual, { cantidad: '1' }).ok, false);
  eq('poner una nota', E.validarCambioPersona(actual, { nota: 'repitió' }).patch, { nota: 'repitió' });
}

// ── 5) AGREGAR EN CUALQUIER DÍA ─────────────────────────────────────────────
{
  const base = { companyId: 'e1', companyName: 'EMPRESA UNO', mealType: 'almuerzo', cantidad: '20' };

  const hoy = E.validarAltaEmpresa({ ...base, mealDate: HOY }, HOY);
  ok('hoy se puede', hoy.ok);
  eq('...con costo cero si no se escribió', hoy.patch.costo, 0);

  const viejo = E.validarAltaEmpresa({ ...base, mealDate: '2026-08-01' }, HOY);
  ok('⭐ un día de hace mes y medio SE PUEDE: corregir el histórico es el pedido', viejo.ok);

  const futuro = E.validarAltaEmpresa({ ...base, mealDate: '2026-09-19' }, HOY);
  eq('⭐ mañana NO se puede', futuro.ok, false);
  ok('...y lo dice claro', futuro.error.includes('todavía no llega'));

  ok('sin empresa no se puede', !E.validarAltaEmpresa({ ...base, companyId: '', mealDate: HOY }, HOY).ok);
  ok('sin comida no se puede', !E.validarAltaEmpresa({ ...base, mealType: '', mealDate: HOY }, HOY).ok);
  ok('con fecha rota no se puede', !E.validarAltaEmpresa({ ...base, mealDate: '18/09/2026' }, HOY).ok);

  const otrosSinNombre = E.validarAltaEmpresa({ ...base, mealType: 'otros', mealDate: HOY }, HOY);
  eq('⭐ «Otros» sin nombre del plato no se puede', otrosSinNombre.ok, false);
  ok('...y explica qué escribir', otrosSinNombre.error.includes('postre'));

  // ⭐ Encontrado al revisar: el campo del plato se escondía pero no se vaciaba,
  //    y un «Hielo» abandonado quedaba pegado a un almuerzo.
  const almuerzoConPlato = E.validarAltaEmpresa({ ...base, mealType: 'almuerzo', plato: 'Hielo', mealDate: HOY }, HOY);
  eq('⭐ un plato escrito y abandonado NO se pega a un almuerzo', almuerzoConPlato.patch.plato, null);

  const otros = E.validarAltaEmpresa({ ...base, mealType: 'otros', plato: 'Hielo', costo: '1,25', mealDate: HOY }, HOY);
  ok('«Otros» con nombre sí', otros.ok);
  eq('...con su costo leído a la venezolana', otros.patch.costo, 1.25);
  eq('...y su plato', otros.patch.plato, 'Hielo');
}

// ── 6) AGREGAR A UNA PERSONA ────────────────────────────────────────────────
{
  const base = { employeeId: 'x1', employeeName: 'Persona Uno', cedula: '111', mealType: 'cena', cantidad: '1' };
  const a = E.validarAltaPersona({ ...base, distributionDate: '2026-09-14' }, HOY);
  ok('un día pasado se puede', a.ok);
  eq('...guarda la cédula', a.patch.cedula, '111');

  ok('sin persona no se puede', !E.validarAltaPersona({ ...base, employeeId: '', distributionDate: HOY }, HOY).ok);
  const otros = E.validarAltaPersona({ ...base, mealType: 'otros', plato: 'Hielo', distributionDate: HOY }, HOY);
  eq('⭐ «Otros» no existe por carnet de nómina: es de empresas y de contactos', otros.ok, false);
  ok('...y lo explica', otros.error.includes('nómina'));
  eq('una persona de nómina no lleva columnas de contacto', [a.patch.contactoId, a.patch.cobrarA, a.patch.itemLabel], [null, null, null]);
  ok('mañana tampoco', !E.validarAltaPersona({ ...base, distributionDate: '2026-09-19' }, HOY).ok);
}

// ── 6b) AGREGAR A UN CONTACTO DE COCINA EN CUALQUIER DÍA (22-sep-2026) ──────
//
// «No puedo agregar días anteriores a esas personas»: el editor solo buscaba en
// nómina. Ahora un contacto entra por SU columna, con a quién se le cobra
// congelado, y se le puede cargar «Otros» por el precio del catálogo.
{
  const k = { contactoId: 'k1', employeeName: 'Ana Rojas', cedula: 'V-111', mealType: 'cena', cantidad: '3', distributionDate: '2026-09-14' };
  const a = E.validarAltaPersona(k, HOY);
  ok('⭐ un contacto se puede agregar en un día pasado', a.ok);
  eq('⭐ va por su columna, sin employee_id', [a.patch.employeeId, a.patch.contactoId], [null, 'k1']);
  eq('sin empresa paga él, aunque no se diga', a.patch.cobrarA, 'independiente');
  eq('...y no arrastra empresa', [a.patch.contactoCompanyId, a.patch.contactoCompanyNombre], [null, null]);

  const e = E.validarAltaPersona({ ...k, cobrarA: 'empresa', contactoCompanyId: 'E1', contactoCompanyNombre: 'EMPRESA UNO' }, HOY);
  eq('⭐ con empresa se congela a quién se le cobra y cuál', [e.patch.cobrarA, e.patch.contactoCompanyId, e.patch.contactoCompanyNombre], ['empresa', 'E1', 'EMPRESA UNO']);
  eq('⭐ «empresa» sin empresa guardada = paga él (nunca en el aire)', E.validarAltaPersona({ ...k, cobrarA: 'empresa' }, HOY).patch.cobrarA, 'independiente');

  const h = E.validarAltaPersona({ ...k, mealType: 'otros', plato: 'Bolsa de hielo' }, HOY);
  ok('⭐ a un contacto SÍ se le carga «Otros»', h.ok);
  eq('...con su plato', h.patch.itemLabel, 'Bolsa de hielo');
  const sinPlato = E.validarAltaPersona({ ...k, mealType: 'otros' }, HOY);
  eq('⭐ «Otros» sin plato no pasa', sinPlato.ok, false);
  ok('...y dice qué falta', sinPlato.error.includes('plato'));
  eq('el plato NO se pega a una cena', E.validarAltaPersona({ ...k, plato: 'Hielo' }, HOY).patch.itemLabel, null);
  eq('⭐ nómina y contacto a la vez: no', E.validarAltaPersona({ ...k, employeeId: 'x1' }, HOY).ok, false);
  ok('sin nombre tampoco', !E.validarAltaPersona({ ...k, employeeName: '' }, HOY).ok);

  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const db = sinComentarios(fs.readFileSync(path.join(ROOT, 'src/lib/comidaEditarDb.ts'), 'utf8'));
  ok('⭐ el editor busca en nómina Y en la agenda a la vez', /Promise\.all\(\[\s*buscarEmpleados\(texto, limite\),\s*buscarContactosComida\(texto, limite\)\.catch/.test(db));
  ok('⭐ las columnas de contacto solo se mandan si hay contacto', /\.\.\.\(a\.contactoId \? \{[\s\S]*?contacto_id: a\.contactoId,[\s\S]*?\} : \{\}\)/.test(db));
  ok('⭐ y el plato solo viaja en «Otros»', /\.\.\.\(a\.mealType === 'otros' \? \{ item_label: a\.itemLabel \?\? null \} : \{\}\)/.test(db));
  ok('solo contactos activos', /\.filter\(contactoActivo\)/.test(db));
  const editor = sinComentarios(fs.readFileSync(path.join(ROOT, 'src/components/ComidaEditor.tsx'), 'utf8'));
  ok('⭐ la pantalla usa el buscador doble', /buscarPersonasComida\(t, empresas\)/.test(editor) && !/buscarEmpleados\(/.test(editor));
  ok('⭐ a un contacto se le ofrece «Otros»; a nómina no', /form\?\.modo === 'alta-empresa' \|\| persona\?\.tipo === 'contacto' \? COMPANY_MEALS : MEALS/.test(editor));
  ok('⭐ el contacto elige el plato de la LISTA, no lo escribe', /esContactoOtros/.test(editor) && !/esContactoOtros \? campo\(/.test(editor));
  ok('cambiar a alguien de nómina baja «Otros»', /if \(p\.tipo !== 'contacto' && comida === 'otros'\) \{ setComida\('almuerzo'\); setPlato\(''\); \}/.test(editor));
  ok('un contacto sale marcado con 📇', /p\.tipo === 'contacto' \? '📇 ' : ''/.test(editor));
}

// ── 7) LOS RECHAZOS DE LA BASE, EN CRIOLLO ──────────────────────────────────
{
  eq('todo bien: sin mensaje', E.mensajeDeError(null, 1, 'guardar'), null);

  const cero = E.mensajeDeError(null, 0, 'guardar');
  ok('⭐ 0 filas sin error ES un rechazo por permisos, no un éxito', !!cero);
  ok('...y nombra el permiso que hace falta', cero.includes('COMPLETO'));

  const ceroBorrar = E.mensajeDeError(null, 0, 'borrar');
  ok('al borrar el mensaje es el suyo', ceroBorrar.includes('No se borró'));

  const dup = E.mensajeDeError({ code: '23505', message: 'duplicate key' }, 0, 'guardar');
  ok('⭐ el único por persona/comida/día se explica', dup.includes('ya tiene esa comida ese día'));
  ok('...y dice qué hacer en su lugar', dup.includes('Corrige la entrega'));

  const permiso = E.mensajeDeError({ code: '42501', message: 'new row violates row-level security' }, 0, 'guardar');
  ok('el 42501 se traduce', permiso.includes('permiso'));

  const check = E.mensajeDeError({ code: '23514', message: 'violates check constraint' }, 0, 'guardar');
  ok('el CHECK se traduce', check.includes('no acepta ese valor'));
}

// ── 8) EL RESUMEN QUE SE LE MUESTRA A LA GENTE ──────────────────────────────
{
  const r = E.resumenCambioEmpresa({ delivered: 10, unit_cost: 2 }, { cantidad: 8 });
  ok('⭐ dice de cuánto a cuánto', r.includes('10 → 8'));
  const r2 = E.resumenCambioPersona({ meals: 1 }, { cantidad: 3 });
  ok('por persona también', r2.includes('1 → 3'));
}

// ── 9) LA PANTALLA NO SE INVENTA SUS PROPIAS REGLAS ─────────────────────────
//
// Si mañana alguien valida a mano en el .tsx, esta prueba deja de proteger nada.
{
  const editor = fs.readFileSync(path.join(ROOT, 'src/components/ComidaEditor.tsx'), 'utf8');
  ok('⭐ el editor usa las validaciones de la librería', /validarAltaEmpresa/.test(editor) && /validarCambioEmpresa/.test(editor));
  ok('...también las de persona', /validarAltaPersona/.test(editor) && /validarCambioPersona/.test(editor));
  ok('⭐ y no escribe a la base por su cuenta', !/supabase/.test(editor));

  // Sin comentarios: el archivo EXPLICA por qué no manda `updated_at`, y ese
  // texto no puede hacer fallar la comprobación de que no lo manda.
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const db = sinComentarios(fs.readFileSync(path.join(ROOT, 'src/lib/comidaEditarDb.ts'), 'utf8'));
  // Un UPDATE/DELETE sin `.select()` no distingue «rechazado» de «hecho».
  const escrituras = (db.match(/\.(update|insert|delete)\(/g) ?? []).length;
  const selects = (db.match(/\.select\(/g) ?? []).length;
  ok(`⭐ cada escritura pide .select() para detectar el rechazo (${escrituras} escrituras, ${selects} select)`, selects >= escrituras);
  ok('⭐ no se inventa columnas que no existen (updated_at / updated_by)', !/updated_at|updated_by/.test(db));
}

// ── 10) DESPUÉS DE GUARDAR SE VE QUE SE GUARDÓ ──────────────────────────────
//
// Dos fallos encontrados al revisar (18-sep-2026), los dos con el mismo síntoma:
// quien corregía nunca veía el «✅ guardado».
//   · `cerrar()` limpiaba el aviso en el mismo instante en que se escribía.
//   · `load()` ponía la pantalla en esqueleto, que DESMONTA la tarjeta; y el
//     tiempo real hacía lo mismo al enterarse del propio cambio.
{
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const editor = sinComentarios(fs.readFileSync(path.join(ROOT, 'src/components/ComidaEditor.tsx'), 'utf8'));
  ok('⭐ tras guardar se cierra SIN borrar el aviso', /const cerrarTrasGuardar = \(\) => setForm\(null\);/.test(editor));
  ok('⭐ ...y ningún guardado usa el cerrar que limpia', !/onCambio\(\);\s*cerrar\(\)/.test(editor));

  const scr = sinComentarios(fs.readFileSync(path.join(ROOT, 'src/screens/ComidaScreen.tsx'), 'utf8'));
  ok('⭐ la carga del día tiene modo silencioso', /const load = useCallback\(async \(silencioso = false\) => \{\s*if \(!silencioso\) setLoading\(true\);/.test(scr));
  ok('⭐ el editor recarga en silencio (sin desmontarse)', /onCambio=\{\(\) => \{ load\(true\); cargarPlatosCatalogo\(\); \}\}/.test(scr));
  ok('⭐ el tiempo real también recarga en silencio', /useRealtimeRefresh\(\['food_distributions', 'food_company_meals'\], \(\) => \{\s*load\(true\);/.test(scr));
}

// ── 11) LOS FINALES DE LÍNEA NO SE TOCAN ────────────────────────────────────
//
// El 18-sep-2026 una edición con Python convirtió ComidaScreen y FoodCompanyScreen
// enteros a CRLF: 2.400 líneas de «cambios» que no cambiaban nada y que habrían
// chocado con cualquier trabajo de la compañera en esos archivos. El repo va en LF.
{
  const tocados = [
    'src/screens/ComidaScreen.tsx', 'src/screens/FoodCompanyScreen.tsx',
    'src/components/ComidaEditor.tsx', 'src/components/ComidaReporteModal.tsx', 'src/components/ComidaMovimientos.tsx',
    'src/lib/comidaEditar.ts', 'src/lib/comidaEditarDb.ts', 'src/lib/comidaMovimientos.ts',
    'src/lib/comidaReporte.ts', 'src/lib/comidaReporteHtml.ts', 'src/lib/comidaReporteOpciones.ts',
    'scripts/test-comida-reporte.mjs', 'scripts/test-comida-reportes-completos.mjs',
  ];
  const conCrlf = tocados.filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('\r\n'));
  eq('⭐ ningún archivo del módulo quedó en CRLF', conCrlf, []);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-comida-editar · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
