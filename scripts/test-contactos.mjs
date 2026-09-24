/*
 * Test del MÓDULO 📇 CONTACTOS (COMPRAS, VENTAS) — 23-sep-2026.
 *
 * Pedido del cliente, textual:
 *   «esa lista de personas y proveedores desde ventas, la vas a volver un catálogo
 *    en un módulo aparte que diga CONTACTOS (COMPRAS, VENTAS) […] lo mismo harás
 *    con compras, lo que se tiene registrado, que se refleje allá, y vas a permitir
 *    poder editar, deshabilitar, y agregar un nuevo contacto ya sea persona o
 *    proveedor, con los datos básicos que sería nombre, apellido, razón social,
 *    cédula, rif. Y además no permitas agregar si ya existe esa cédula o RIF»
 *
 * LO QUE BLINDA, Y POR QUÉ DUELE SI SE ROMPE:
 *   · ⭐ UNA CÉDULA O UN RIF NO ENTRA DOS VECES, aunque se escriba con puntos,
 *     guiones o espacios. Es lo único que impide que el mismo proveedor entre tres
 *     veces y su cuenta por pagar salga partida en pedazos.
 *   · ⭐ EL DOCUMENTO ES OPCIONAL, porque en la base real hay proveedores que hoy no
 *     lo tienen cargado. Pero dos contactos SIN documento no chocan entre sí: si
 *     «sin documento» contara como repetido, no se podría registrar ninguno.
 *   · EL NOMBRE QUE SE IMPRIME nunca queda vacío, y partirlo y volver a armarlo da
 *     exactamente el mismo: editarle el teléfono a alguien no lo renombra.
 *   · CLIENTE Y PROVEEDOR SON DOS MARCAS, no dos listas.
 *   · DESHABILITAR NO ES BORRAR: un contacto borrado se lleva por delante el nombre
 *     de sus ventas, sus compras y sus cuentas.
 *
 * Valores inventados: no hay datos reales en el repositorio (es público).
 *
 *   node scripts/test-contactos.mjs
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

const cache = new Map();
function loadTs(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(abs), id) + '.ts') : orig(id));
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond, extra) => eq(name + (extra ? ` [${extra}]` : ''), !!cond, true);

const C = loadTs('src/lib/contactos.ts');

// ── 1) PERSONA O EMPRESA ────────────────────────────────────────────────────
{
  ok('la librería solo importa el normalizador de texto',
    (sinComentarios(leer('src/lib/contactos.ts')).match(/^\s*import\s/gm) ?? []).length === 1);
  eq('V es persona', C.esPersona('V'), true);
  eq('E es persona', C.esPersona('E'), true);
  eq('P (pasaporte) es persona', C.esPersona('P'), true);
  eq('J es empresa', C.esPersona('J'), false);
  eq('G es empresa', C.esPersona('G'), false);
  eq('rótulo del documento', [C.docTipoLabel('V'), C.docTipoLabel('J')], ['Cédula', 'RIF']);
}

// ── 2) EL NOMBRE QUE SE IMPRIME ─────────────────────────────────────────────
{
  eq('persona: nombre + apellido', C.componerNombre('V', 'pedro', 'pérez'), 'PEDRO PÉREZ');
  eq('...sin espacios de más', C.componerNombre('V', '  pedro  ', '  pérez '), 'PEDRO PÉREZ');
  eq('...ni los de en medio', C.componerNombre('V', 'juan   carlos', 'pérez'), 'JUAN CARLOS PÉREZ');
  eq('empresa: la razón social', C.componerNombre('J', 'x', 'y', 'constructora ejemplo, c.a.'), 'CONSTRUCTORA EJEMPLO, C.A.');
  // ⚠️ Mejor un nombre a medias que un contacto llamado «undefined» en una factura.
  eq('⭐ falta el apellido: se usa lo que haya', C.componerNombre('V', 'pedro', ''), 'PEDRO');
  eq('⭐ falta el nombre: se usa lo que haya', C.componerNombre('V', null, 'pérez'), 'PÉREZ');
  eq('sin nada, cadena vacía (nunca «undefined»)', C.componerNombre('V', null, undefined), '');

  // ⭐ EL INVARIANTE: partir y volver a componer da EXACTAMENTE el mismo nombre.
  //    De eso depende que editarle el teléfono a un contacto que llegó de Compras
  //    no lo deje llamándose «PEDRO PEREZ PEREZ» en la próxima orden de compra.
  const NOMBRES = [
    'PEDRO PEREZ', 'JUAN CARLOS PEREZ GOMEZ', 'MARIA', 'ANA DE LA ROSA',
    'JOSE  GREGORIO   HERNANDEZ', '  LUIS  PEÑA  ', 'FERRETERIA EL PUERTO MARITIMO C.A.',
  ];
  let reversible = true;
  NOMBRES.forEach((n) => {
    const p = C.partirNombre(n);
    if (C.componerNombre('V', p.nombre, p.apellido) !== C.limpiarNombre(n)) reversible = false;
  });
  ok('⭐ partir + componer devuelve el MISMO nombre, siempre', reversible);
  eq('parte por el último espacio', C.partirNombre('JUAN CARLOS PEREZ GOMEZ'), { nombre: 'JUAN CARLOS PEREZ', apellido: 'GOMEZ' });
  eq('una sola palabra no se inventa apellido', C.partirNombre('MARIA'), { nombre: 'MARIA', apellido: '' });
  eq('vacío no revienta', C.partirNombre(null), { nombre: '', apellido: '' });
}

// ── 3) EL BUSCADOR SE APROVECHA ─────────────────────────────────────────────
{
  eq('buscó un nombre → va al nombre', C.repartirBusqueda('pedro perez'), { nombre: 'PEDRO PEREZ', numero: '' });
  eq('buscó una cédula → va al documento', C.repartirBusqueda('12345678'), { nombre: '', numero: '12345678' });
  eq('...con puntos y guion también', C.repartirBusqueda('V-12.345.678'), { nombre: '', numero: '12345678' });
  eq('⭐ un nombre CON números sigue siendo nombre', C.repartirBusqueda('taller 3g ca'), { nombre: 'TALLER 3G CA', numero: '' });
  eq('pocos dígitos no es un documento', C.repartirBusqueda('1234'), { nombre: '1234', numero: '' });
  eq('vacío no revienta', C.repartirBusqueda(null), { nombre: '', numero: '' });
}

// ── 4) ⭐ NO ENTRA DOS VECES LA MISMA CÉDULA NI EL MISMO RIF ────────────────
{
  const YA = [
    { id: 'c1', name: 'PEDRO PEREZ', doc_letter: 'V', doc_number: '12345678' },
    { id: 'c2', name: 'FERRETERIA EL TORNILLO', doc_letter: 'J', doc_number: '409876543' },
    // Los que llegaron de Compras sin RIF cargado.
    { id: 'c3', name: 'DEFCOM VENEZUELA', doc_letter: null, doc_number: null },
    { id: 'c4', name: 'TORNILLERIA GLOBAL C.A.', doc_letter: null, doc_number: null },
  ];
  ok('⭐ duplicado aunque se escriba con puntos', !!C.docDuplicado(YA, 'V', '12.345.678'));
  ok('⭐ duplicado aunque se escriba con guion', !!C.docDuplicado(YA, 'V', 'V-12345678'));
  ok('⭐ duplicado de RIF', !!C.docDuplicado(YA, 'J', '40.987.654-3'));
  eq('dice a nombre de QUIÉN choca', C.docDuplicado(YA, 'J', '409876543')?.name, 'FERRETERIA EL TORNILLO');
  ok('otra letra con los mismos dígitos NO es duplicado', !C.docDuplicado(YA, 'E', '12345678'));
  ok('un documento nuevo no es duplicado', !C.docDuplicado(YA, 'V', '99999999'));
  ok('⭐ al EDITAR, el propio registro no se denuncia solo', !C.docDuplicado(YA, 'V', '12345678', 'c1'));
  ok('al editar, OTRO con ese documento sí se denuncia', !!C.docDuplicado(YA, 'V', '12345678', 'c2'));
  // ⭐ Si «sin documento» contara como repetido, los proveedores que hoy no tienen
  //    RIF se bloquearían entre sí y no se podría registrar ninguno.
  ok('⭐ dos contactos SIN documento no chocan entre sí', !C.docDuplicado(YA, null, null));
  ok('...ni con letra pero sin número', !C.docDuplicado(YA, 'J', ''));
}

// ── 5) LA VALIDACIÓN ────────────────────────────────────────────────────────
{
  const YA = [{ id: 'c1', name: 'PEDRO PEREZ', doc_letter: 'V', doc_number: '12345678' }];
  const base = { letra: 'V', numero: '87654321', nombre: 'ANA', apellido: 'ROJAS', esCliente: true };
  eq('una persona completa pasa', C.validarContacto(base, YA), null);
  ok('sin nombre no pasa', /nombre/i.test(C.validarContacto({ ...base, nombre: '' }, YA) ?? ''));
  ok('⭐ sin apellido tampoco (el cliente lo pidió con apellido)', /apellido/i.test(C.validarContacto({ ...base, apellido: '' }, YA) ?? ''));
  ok('a una empresa se le pide razón social', /razón social/i.test(C.validarContacto({ letra: 'J', numero: '409876543', esCliente: true }, YA) ?? ''));
  ok('una empresa no necesita apellido', C.validarContacto({ letra: 'J', numero: '409876543', razonSocial: 'X, C.A.', esProveedor: true }, YA) === null);

  // ⭐ Opcional, pero si se escribe tiene que servir: «no lo tengo» y «lo escribí
  //    mal» son cosas distintas, y confundirlas mete RIFs de 3 dígitos al catálogo.
  ok('⭐ SIN documento pasa (hay proveedores reales que no lo tienen)',
    C.validarContacto({ ...base, numero: '' }, YA) === null);
  ok('⭐ pero escrito a medias NO pasa', /incompleto/i.test(C.validarContacto({ ...base, numero: '123' }, YA) ?? ''));
  ok('⭐ repetido NO pasa', /ya está registrado/i.test(C.validarContacto({ ...base, numero: '12.345.678' }, YA) ?? ''));
  ok('...y dice a nombre de quién', /PEDRO PEREZ/.test(C.validarContacto({ ...base, numero: '12345678' }, YA) ?? ''));
  ok('editándose a sí mismo, no se denuncia solo', C.validarContacto({ ...base, numero: '12345678' }, YA, 'c1') === null);
  // Sin ninguna marca no aparecería en ningún lado: ni en ventas ni en compras.
  ok('sin marcar cliente ni proveedor no pasa',
    /vende|compra/i.test(C.validarContacto({ ...base, esCliente: false, esProveedor: false }, YA) ?? ''));
}

// ── 6) LA FILA QUE SE GUARDA ────────────────────────────────────────────────
{
  const fp = C.filaContacto({ letra: 'V', numero: 'V-12.345.678', nombre: 'pedro', apellido: 'pérez', telefono: ' 0414-1112233 ', esCliente: true, esProveedor: true });
  eq('persona: nombre compuesto', fp.name, 'PEDRO PÉREZ');
  eq('...y desglosado', [fp.first_name, fp.last_name], ['PEDRO', 'PÉREZ']);
  eq('una persona no lleva razón social', fp.razon_social, null);
  eq('el documento se guarda en dígitos', [fp.doc_letter, fp.doc_number], ['V', '12345678']);
  eq('el teléfono, sin espacios de más', fp.phone, '0414-1112233');
  // ⭐ Dos marcas, no dos listas: a mucha gente se le vende Y se le compra.
  eq('⭐ puede ser cliente Y proveedor a la vez', [fp.es_cliente, fp.es_proveedor], [true, true]);

  const fe = C.filaContacto({ letra: 'J', numero: '409876543', razonSocial: 'ferretería el tornillo', esProveedor: true, rubros: ['ferreteria', ' FERRETERIA ', 'tornillos', ''] });
  eq('empresa: razón social', [fe.name, fe.razon_social], ['FERRETERÍA EL TORNILLO', 'FERRETERÍA EL TORNILLO']);
  eq('⭐ una empresa NO lleva nombre ni apellido', [fe.first_name, fe.last_name], [null, null]);
  eq('los rubros: en mayúsculas y sin repetir', fe.tags, ['FERRETERIA', 'TORNILLOS']);
  eq('lo opcional vacío queda en null, no en cadena vacía', [fe.phone, fe.email, fe.address], [null, null, null]);

  // ⭐ Sin documento van los DOS en null: media llave no sirve, y el índice único
  //    de la base solo ignora la fila si `doc_number` está vacío.
  const sd = C.filaContacto({ letra: 'J', numero: '', razonSocial: 'DEFCOM VENEZUELA', esProveedor: true });
  eq('⭐ sin documento, letra y número van los dos en null', [sd.doc_letter, sd.doc_number], [null, null]);
  eq('sin rubros, null (no un arreglo vacío)', sd.tags, null);
}

// ── 7) BUSCAR, FILTRAR Y CONTAR ─────────────────────────────────────────────
{
  const LISTA = [
    { id: 'a', name: 'PEDRO PÉREZ', first_name: 'PEDRO', last_name: 'PÉREZ', doc_letter: 'V', doc_number: '12345678', es_cliente: true, active: true },
    { id: 'b', name: 'FERRETERIA EL TORNILLO', razon_social: 'FERRETERIA EL TORNILLO', doc_letter: 'J', doc_number: '409876543', es_proveedor: true, tags: ['FERRETERIA'], active: true },
    { id: 'c', name: 'DEFCOM VENEZUELA', doc_letter: null, doc_number: null, es_proveedor: true, active: true },
    { id: 'd', name: 'VIEJO INACTIVO', doc_letter: 'V', doc_number: '99999999', es_cliente: true, active: false },
    { id: 'e', name: 'LOS DOS, C.A.', doc_letter: 'J', doc_number: '111111111', es_cliente: true, es_proveedor: true, active: true },
  ];
  eq('busca por apellido', C.buscarContactos(LISTA, 'perez').map((c) => c.id), ['a']);
  eq('...sin acentos también', C.buscarContactos(LISTA, 'pérez').map((c) => c.id), ['a']);
  eq('busca por rubro', C.buscarContactos(LISTA, 'ferreteria').map((c) => c.id), ['b']);
  eq('busca por documento con guion', C.buscarContactos(LISTA, 'J-409876543').map((c) => c.id), ['b']);
  eq('busca por la palabra «proveedor»', C.buscarContactos(LISTA, 'proveedor').map((c) => c.id), ['b', 'c', 'e']);
  eq('sin texto: salen todos', C.buscarContactos(LISTA, '').length, 5);

  // ⚠️ Deshabilitar tiene que servir de algo: en todos los filtros MENOS el suyo,
  //    un contacto deshabilitado NO sale. Si no, la lista sigue igual de larga.
  eq('⭐ «Todos» no muestra los deshabilitados', C.filtrarContactos(LISTA, 'todos').map((c) => c.id), ['a', 'b', 'c', 'e']);
  eq('clientes (el que es las dos cosas entra)', C.filtrarContactos(LISTA, 'clientes').map((c) => c.id), ['a', 'e']);
  eq('proveedores (el que es las dos cosas también)', C.filtrarContactos(LISTA, 'proveedores').map((c) => c.id), ['b', 'c', 'e']);
  eq('⭐ los que hay que completar a mano', C.filtrarContactos(LISTA, 'sin_documento').map((c) => c.id), ['c']);
  eq('⭐ «Deshabilitados» es el único que los muestra', C.filtrarContactos(LISTA, 'deshabilitados').map((c) => c.id), ['d']);
  eq('los conteos de las pastillas', C.conteoContactos(LISTA),
    { todos: 4, clientes: 2, proveedores: 3, sin_documento: 1, deshabilitados: 1 });
  eq('rótulo de roles', [C.rolesDe(LISTA[0]), C.rolesDe(LISTA[4])], ['👤 Cliente', '👤 Cliente · 🏭 Proveedor']);
  eq('los rubros ya usados, A→Z', C.rubrosUsados(LISTA), ['FERRETERIA']);
  eq('filtrar null no revienta', C.filtrarContactos(null, 'todos'), []);
  eq('contar null no revienta', C.conteoContactos(null).todos, 0);
}

// ── 8) LA PANTALLA Y EL FORMULARIO ──────────────────────────────────────────
{
  const form = sinComentarios(leer('src/components/ContactoForm.tsx'));
  ok('valida con la regla de la librería', /validarContacto\(datos, contactos as any, contacto\?\.id \?\? null\)/.test(form));
  ok('...y arma la fila con la de la librería', /filaContacto\(datos\)/.test(form));
  ok('escribe en la tabla del catálogo', /from\('contactos'\)/.test(form));
  // ⚠️ Con RLS, un «no tienes permiso» llega como 0 filas y SIN error.
  ok('⭐ el guardado pide la fila de vuelta (.select)', /\.select\(\)\.single\(\)/.test(form));
  ok('...y avisa si no llegó ninguna', /te falta permiso de escritura/.test(form));
  ok('avisa si falta el SQL', /contactos\.sql/.test(form));
  ok('propone partido el nombre de un contacto sin desglose', /partirNombre\(contacto\.name\)/.test(form));
  ok('pide los datos que pidió el cliente', /Razón social/.test(form) && /Apellido/.test(form) && /Cédula · solo los números/.test(form));
  ok('se marca cliente, proveedor o las dos', /Cliente · se le vende/.test(form) && /Proveedor · se le compra/.test(form));

  const pant = sinComentarios(leer('src/screens/ContactosScreen.tsx'));
  ok('la pantalla usa el MISMO formulario', /<ContactoForm/.test(pant));
  ok('se puede agregar', /＋ Agregar contacto/.test(pant));
  // ⭐ Borrar a un contacto se lleva por delante el nombre de sus ventas y compras.
  ok('⭐ se DESHABILITA, no se borra', /update\(\{ active: activo \}\)/.test(pant) && !/\.delete\(\)/.test(pant));
  ok('...y lo dice con todas sus letras', /No se borra/.test(pant));
  ok('avisa que un proveedor también se deshabilita en Compras', /también en Compras/.test(pant));
  // ⚠️ confirm() dentro de un Modal a pantalla completa queda tapado: trampa ya
  //    documentada en este proyecto.
  ok('⭐ la confirmación es EN LÍNEA, no un confirm() tapado por el modal',
    /confirmando/.test(pant) && !/useConfirm/.test(pant));
  ok('tiene las pastillas por rol', /sin_documento/.test(pant) && /deshabilitados/.test(pant));
  ok('avisa cuántos están sin cédula ni RIF', /sin cédula ni RIF/.test(pant));

  // El «＋» de la venta sigue existiendo y usa el mismo formulario.
  // ⚠️ 24-sep-2026: el selector de la venta se mudó a components/ContactoPicker.tsx
  //    para compartirlo con 🧰 Ventas de servicio. El «＋» vive ahí, pero el
  //    FORMULARIO tiene que seguir siendo el mismo del módulo: si algún día son
  //    dos, el mismo contacto queda escrito de dos maneras según por dónde se creó.
  const ventas = sinComentarios(leer('src/screens/VentasScreen.tsx'));
  const picker = sinComentarios(leer('src/components/ContactoPicker.tsx'));
  ok('⭐ desde una venta se puede agregar sin salirse', /＋ Agregar persona o proveedor/.test(picker));
  ok('...con el MISMO formulario del módulo', /<ContactoForm/.test(picker) && /<ContactoForm/.test(ventas));
  ok('⭐ Ventas lee del catálogo único', /useTable<SalesClient>\('contactos'/.test(ventas));
  ok('...y ya no de la lista vieja', !/sales_clients/.test(ventas));
}

// ── 9) EL MÓDULO ESTÁ REGISTRADO ────────────────────────────────────────────
{
  ok('tiene permiso propio', /\{ key: 'contactos', label: 'Contactos' \}/.test(leer('src/lib/permissions.ts')));
  // Nace cerrado, como todo lo que toca plata o datos de clientes.
  ok('⭐ nace cerrado (nadie lo ve hasta que se lo den)', /moduleKey === 'contactos'/.test(leer('src/lib/permissions.ts')));
  ok('está en el menú', /route: 'Contactos'/.test(leer('src/screens/MoreScreen.tsx')));
  ok('está en la navegación', /name="Contactos"/.test(leer('src/navigation/index.tsx')));
  ok('sale en la auditoría', /key: 'contactos', label: 'Contactos \(compras, ventas\)'/.test(leer('src/lib/auditModulos.ts')));
  ok('...y su tabla está mapeada', /contactos: 'contactos'/.test(leer('src/lib/auditModulos.ts')));
}

// ── 10) EL SQL ──────────────────────────────────────────────────────────────
{
  const sql = leer('supabase/contactos.sql');
  ok('renombra la lista vacía de Ventas en vez de crear otra tabla', /rename to contactos/.test(sql));
  ok('agrega los datos que pidió el cliente', /first_name/.test(sql) && /last_name/.test(sql) && /razon_social/.test(sql));
  // ⭐ El índice PARCIAL: impide repetir el documento, pero deja convivir a los que
  //    todavía no lo tienen. Sin el `where`, no entraría ninguno de esos.
  ok('⭐ índice único PARCIAL por letra + dígitos', /create unique index if not exists contactos_doc_key/.test(sql)
    && /where doc_number is not null/.test(sql));
  ok('⭐ importa los proveedores de Compras', /from public\.suppliers s/.test(sql) && /where s\.contacto_id is null/.test(sql));
  ok('...y los deja espejados en los dos sentidos',
    /contacto_espeja_supplier/.test(sql) && /supplier_espeja_contacto/.test(sql));
  // ⚠️ Sin esta guarda los dos triggers se quedan rebotando hasta que la base corte.
  ok('⭐ el espejo no se muerde la cola', /pg_trigger_depth\(\) > 1/.test(sql));
  // ⭐ Seis tablas apuntan a `suppliers`: borrarla se lleva compras, cuentas y mangueras.
  ok('⭐ NO borra la tabla de proveedores de Compras', !/drop table[^\n]*suppliers/i.test(sql));
  ok('...ni borra ninguna fila', !/\bdelete\s+from\b|\btruncate\b/i.test(sql));
  ok('deja de proveedor = desactivar su ficha, no borrarla', /update public\.suppliers set active = false/.test(sql));
  ok('trae su verificación', /✅/.test(sql) && /Proveedores de Compras SIN reflejar/.test(sql));
  ok('y lista los que hay que completar a mano', /Hay que ponerle la cédula o el RIF/.test(sql));
}

// ── 11) MANUALES ────────────────────────────────────────────────────────────
{
  ok('manual (md) lo explica', /contactos \(compras, ventas\) \(23\/09\/2026\)/i.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) lo explica', /contactos \(compras, ventas\) \(23\/09\/2026\)/i.test(leer('src/screens/ManualScreen.tsx')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-contactos · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
