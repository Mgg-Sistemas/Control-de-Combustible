/*
 * 👤 QUIÉN SOLICITÓ, QUIÉN AUTORIZÓ, PARA QUÉ Y PARA QUÉ ÁREA (20-oct-2026).
 *
 * Pedido del cliente, textual: «para ese formato necesito colocar también quién
 * lo solicitó y que sea de la lista de la nómina, PERO SIN TOCAR NÓMINA NI NADA,
 * y si no existe lo pueda escribir y se guarde en contactos. También quién lo
 * autorizó. También seleccionar si es para vehículo o maquinaria. También poder
 * seleccionar el área al que va dirigido, que si administración, cocina, etc. Y
 * al final un espacio de observaciones».
 *
 * LO QUE FIJA, Y POR QUÉ DUELE SI SE ROMPE:
 *
 *  1. LA NÓMINA NO SE TOCA. Ni un insert, ni un update, ni un delete sobre
 *     `employees` desde este módulo. Es la condición que puso el cliente, y es
 *     la que un refactor distraído rompe primero («ya que estamos, le guardo el
 *     cargo»). El candado mira el CÓDIGO de las dos piezas.
 *  2. EL NOMBRE ESCRITO A MANO VA A CONTACTOS CON LA MISMA FUNCIÓN QUE EL
 *     FORMULARIO DE CONTACTOS (`filaContacto`). Si esta puerta armara su fila
 *     aparte, el mismo señor quedaría escrito distinto según por dónde entró, y
 *     el catálogo tendría dos «JOSE PEREZ» que nadie puede unir después.
 *  3. NO SE DUPLICA A QUIEN YA ESTÁ: se compara contra la nómina Y contra los
 *     contactos, sin distinguir mayúsculas ni acentos.
 *  4. TODO ES OPCIONAL: un requerimiento sin nada de esto se guarda igual que
 *     siempre (son 500 requerimientos viejos los que dependen de eso).
 *
 *   node scripts/test-requerimiento-personas.mjs
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
  if (req.startsWith('.') && parent && String(parent.filename || '').endsWith('.ts')) {
    const cand = path.resolve(path.dirname(parent.filename), req);
    for (const p of [cand, cand + '.ts', path.join(cand, 'index.ts')]) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return compilar(p);
    }
  }
  return realLoad.apply(this, arguments);
};

const P = compilar(path.join(ROOT, 'src/lib/requerimientoPersonas.ts'));
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** El código SIN comentarios: si no, un candado da positivo por la prosa que lo explica. */
const sinComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── 1) ¿PARA QUÉ ES? vehículo o maquinaria ───────────────────────────────────
eq('las dos opciones, y solo esas', P.DESTINOS.map((d) => d.key), ['maquinaria', 'vehiculo']);
eq('se imprime en palabras', P.destinoLabel('maquinaria'), 'Maquinaria');
eq('* y el otro también', P.destinoLabel('vehiculo'), 'Vehículo');
eq('* sin elegir no imprime nada', P.destinoLabel(null), '');
eq('* una basura tampoco', P.destinoLabel('camioneta'), '');
eq('a la base va la clave', P.destinoAGuardar('vehiculo'), 'vehiculo');
// El check de la base solo acepta vehiculo|maquinaria: cualquier otra cosa tiene
// que llegar como null o el guardado entero se cae por una pastilla mal puesta.
eq('* lo que no es ninguna de las dos va NULL', P.destinoAGuardar('otra cosa'), null);
eq('* y sin elegir, NULL', P.destinoAGuardar(null), null);

// ── 2) LA GENTE DE LA NÓMINA ─────────────────────────────────────────────────
const NOMINA = [
  { id: '1', first_name: 'zoila', last_name: 'perez', cedula: '12345678', cargo: 'cocinera', department: 'cocina', status: 'activo' },
  { id: '2', first_name: 'ana', last_name: 'gómez', cedula: '87654321', cargo: 'analista', department: 'administrativo', status: 'activo' },
  { id: '3', first_name: 'beto', last_name: 'ruiz', cedula: '55555555', cargo: 'soldador', department: 'almacén', status: 'retirado' },
  { id: '4', first_name: '  ', last_name: '  ', cedula: '99', cargo: 'x', department: 'y', status: 'activo' },
];
const personas = P.personasDeNomina(NOMINA);
eq('el nombre se imprime en MAYÚSCULAS, nombre y apellido', P.nombreEmpleado(NOMINA[0]), 'ZOILA PEREZ');
eq('* una ficha a medias usa lo que haya', P.nombreEmpleado({ first_name: 'ana', last_name: null }), 'ANA');
eq('* una ficha que no existe no revienta', P.nombreEmpleado(null), '');
// Una pastilla en blanco no se puede ni tocar ni entender: la ficha sin nombre no entra.
eq('⭐ la ficha SIN NOMBRE no entra en la lista', personas.map((p) => p.id), ['2', '1', '3']);
eq('⭐ los ACTIVOS salen primero (es a quien se le pide algo hoy)',
  personas.map((p) => `${p.nombre}${p.activo ? '' : ' (no activo)'}`),
  ['ANA GÓMEZ', 'ZOILA PEREZ', 'BETO RUIZ (no activo)']);
eq('* el área y el cargo vienen en mayúsculas', [personas[0].area, personas[0].cargo], ['ADMINISTRATIVO', 'ANALISTA']);
eq('* la cédula se conserva tal cual', personas[0].cedula, '87654321');
eq('* sin nómina no revienta', P.personasDeNomina(null), []);

// ── 3) EL BUSCADOR ───────────────────────────────────────────────────────────
eq('sin texto salen todas', P.buscarPersonas(personas, '').length, 3);
eq('* solo espacios tampoco filtra', P.buscarPersonas(personas, '   ').length, 3);
eq('* por nombre', P.buscarPersonas(personas, 'zoila').map((p) => p.id), ['1']);
eq('* por cédula', P.buscarPersonas(personas, '8765').map((p) => p.id), ['2']);
eq('* por cargo', P.buscarPersonas(personas, 'soldador').map((p) => p.id), ['3']);
eq('* por área', P.buscarPersonas(personas, 'cocina').map((p) => p.id), ['1']);
// Nadie escribe «GÓMEZ» con tilde en un buscador con prisa.
eq('* los acentos no estorban', P.buscarPersonas(personas, 'gomez').map((p) => p.id), ['2']);
eq('* lo que no coincide devuelve vacío', P.buscarPersonas(personas, 'zzzz'), []);
{
  const copia = JSON.parse(JSON.stringify(personas));
  P.buscarPersonas(personas, 'ana');
  eq('* no muta ni reordena la lista que recibe', personas, copia);
}

// ── 4) EL ÁREA A LA QUE VA DIRIGIDO ──────────────────────────────────────────
eq('⭐ las áreas salen de lo que YA existe: nómina + las ya usadas',
  P.areasSugeridas(['cocina', 'administrativo'], ['almacén', 'cocina']),
  ['ADMINISTRATIVO', 'ALMACÉN', 'COCINA']);
eq('* no repite (ni cambiando mayúsculas o acentos)',
  P.areasSugeridas(['COCINA', 'cocina', 'Cocina']), ['COCINA']);
eq('* los vacíos y los nulos se caen', P.areasSugeridas(['', null, '  ', 'taller']), ['TALLER']);
eq('* sin nada, lista vacía', P.areasSugeridas(null, null), []);

// ── 5) UN NOMBRE ESCRITO A MANO ──────────────────────────────────────────────
ok('un nombre de verdad sirve', P.nombreEscritoValido('jose perez'));
ok('* con acentos también', P.nombreEscritoValido('josé'));
// Dos iniciales o un número no pueden terminar de contacto en el catálogo de Compras.
ok('* dos letras sueltas NO', !P.nombreEscritoValido('jp'));
ok('* puros números NO', !P.nombreEscritoValido('12345'));
ok('* vacío NO', !P.nombreEscritoValido('   '));
eq('lo que se guardaría se ve limpio y en mayúsculas', P.nombreEscrito('  jose   perez '), 'JOSE PEREZ');

// ── 6) NO SE DUPLICA A QUIEN YA ESTÁ ─────────────────────────────────────────
const CONTACTOS = [{ id: 'c1', name: 'MARIA LOPEZ' }];
eq('⭐ si ya está en la NÓMINA se dice, no se crea otro',
  P.nombreYaExiste('zoila perez', personas, CONTACTOS)?.donde, 'nomina');
eq('⭐ si ya está en CONTACTOS, igual',
  P.nombreYaExiste('maria lopez', personas, CONTACTOS)?.donde, 'contactos');
eq('* sin distinguir acentos', P.nombreYaExiste('ana gomez', personas, CONTACTOS)?.donde, 'nomina');
eq('* alguien nuevo no está en ninguna', P.nombreYaExiste('pedro nuevo', personas, CONTACTOS), null);
eq('* un nombre vacío no «existe»', P.nombreYaExiste('  ', personas, CONTACTOS), null);

// ── 7) EL CONTACTO QUE SE CREA ───────────────────────────────────────────────
{
  const fila = P.contactoDesdeNombre('jose carlos perez');
  eq('⭐ el nombre que se imprime queda completo', fila.name, 'JOSE CARLOS PEREZ');
  eq('* parte por el ÚLTIMO espacio (es reversible: no duplica el apellido)',
    [fila.first_name, fila.last_name], ['JOSE CARLOS', 'PEREZ']);
  // El documento es OPCIONAL en el catálogo: media llave no sirve de nada y el
  // índice único la ignora solo si `doc_number` viene vacío.
  eq('⭐ va SIN documento: los dos campos en null', [fila.doc_letter, fila.doc_number], [null, null]);
  // Es alguien que pidió algo, no alguien a quien se le compra o se le vende.
  eq('⭐ no se marca ni cliente ni proveedor', [fila.es_cliente, fila.es_proveedor], [false, false]);
  eq('* ni razón social ni rubros', [fila.razon_social, fila.tags], [null, null]);
  eq('* un nombre que no sirve no crea nada', P.contactoDesdeNombre('jp'), null);
}
{
  // La fila tiene que ser EXACTAMENTE la que arma el formulario de contactos.
  const C = compilar(path.join(ROOT, 'src/lib/contactos.ts'));
  const aMano = C.filaContacto({ letra: 'V', numero: '', nombre: 'JOSE', apellido: 'PEREZ' });
  eq('⭐ la arma `filaContacto`, la MISMA del formulario de contactos',
    P.contactoDesdeNombre('jose perez'), aMano);
}

// ── 8) LO QUE SE GUARDA EN EL REQUERIMIENTO ──────────────────────────────────
eq('⭐ sin nada elegido, TODO va en null (el requerimiento se guarda igual que siempre)',
  P.camposRequerimiento({}),
  {
    solicitante_nombre: null, solicitante_employee_id: null,
    autorizado_nombre: null, autorizado_employee_id: null,
    destino_tipo: null, area: null, observaciones: null,
  });
eq('con la ficha de nómina se copian nombre e id',
  P.camposRequerimiento({ solicitante: P.personaDeFicha(personas[0]) }),
  {
    solicitante_nombre: 'ANA GÓMEZ', solicitante_employee_id: '2',
    autorizado_nombre: null, autorizado_employee_id: null,
    destino_tipo: null, area: null, observaciones: null,
  });
eq('escrito a mano: queda el nombre y NO hay ficha de nómina',
  P.camposRequerimiento({ autorizado: P.personaEscrita(' pedro  nuevo ') }),
  {
    solicitante_nombre: null, solicitante_employee_id: null,
    autorizado_nombre: 'PEDRO NUEVO', autorizado_employee_id: null,
    destino_tipo: null, area: null, observaciones: null,
  });
eq('* el área se guarda limpia y en mayúsculas', P.camposRequerimiento({ area: ' cocina ' }).area, 'COCINA');
// Las observaciones son prosa del usuario: NO se tocan más allá de los bordes.
eq('⭐ las observaciones se guardan tal cual (con sus saltos de línea)',
  P.camposRequerimiento({ observaciones: '  urgente\nfalta el filtro  ' }).observaciones,
  'urgente\nfalta el filtro');
eq('* unas observaciones en blanco van NULL', P.camposRequerimiento({ observaciones: '   ' }).observaciones, null);

// ── 9) SI EL SQL TODAVÍA NO SE CORRIÓ ────────────────────────────────────────
ok('reconoce que falta la columna nueva', P.faltaColumnaNueva("Could not find the 'solicitante_nombre' column in the schema cache"));
ok('* también la de observaciones', P.faltaColumnaNueva('column "observaciones" does not exist'));
ok('* un error cualquiera NO se confunde con eso', !P.faltaColumnaNueva('duplicate key value violates unique constraint'));
ok('* ni un error vacío', !P.faltaColumnaNueva(null));

// ── 10) LAS DOS PIEZAS DE PANTALLA USAN ESTO (no una copia suya) ─────────────
{
  const tab = leer('src/screens/RequerimientoTab.tsx');
  const picker = leer('src/components/PersonaNominaPicker.tsx');
  const codigo = sinComentarios(tab) + '\n' + sinComentarios(picker);

  // ⭐ LA REGLA DEL CLIENTE: «sin tocar nómina ni nada».
  ok('⭐ la nómina SOLO SE LEE: ni insert, ni update, ni delete sobre employees',
    !/from\('employees'\)[\s\S]{0,80}?\.(insert|update|delete|upsert)\(/.test(codigo));
  ok('⭐ …y se lee con un select de columnas contadas',
    /from\('employees'\)\s*\.select\('id, first_name, last_name, cedula, cargo, department, status'\)/.test(codigo));

  // El selector es UNO solo, usado dos veces: dos copias se separan a la primera corrección.
  eq('⭐ el mismo selector sirve para los dos (solicitó y autorizó)',
    (codigo.match(/<PersonaNominaPicker/g) || []).length, 2);
  ok('* …y la regla la pone la librería, no la pantalla',
    codigo.includes("from '../lib/requerimientoPersonas'") && picker.includes("from '../lib/requerimientoPersonas'"));

  // El clásico «borrado que finge éxito», versión insert: la RLS de contactos
  // rechaza SIN error y con 0 filas a quien solo tiene permiso de inventario.
  ok('⭐ el contacto nuevo se verifica con .select(\'id\') y se avisa si no quedó',
    /from\('contactos'\)[\s\S]{0,160}?\.insert\([\s\S]{0,80}?\)\.select\('id'\)/.test(codigo)
    && /data\.length === 0/.test(codigo) && /no se agregó a Contactos/.test(codigo));

  // Todo lo nuevo es opcional y se guarda con la misma red del responsable: si el
  // SQL no se corrió, el requerimiento se guarda SIN esos campos y se avisa.
  ok('* si falta el SQL se reintenta sin los campos nuevos (no se pierde el requerimiento)',
    codigo.includes('faltaColumnaNueva(error.message)') && /nuevosCampos = \{\}/.test(codigo));
  ok('* los campos salen de camposRequerimiento (una sola receta para crear y editar)',
    (codigo.match(/camposRequerimiento\(\{/g) || []).length >= 2);

  // Lo pedido textual: «al final un espacio de observaciones».
  ok('* las observaciones van al FINAL, después del formato adjunto',
    codigo.indexOf('📝 Observaciones') > codigo.indexOf('📎 Formato'));
  // Con 12 campos, resetear a mano en cada salida deja alguno pegado del anterior.
  ok('* el formulario se limpia en UNA función, usada en las CUATRO salidas (guardar, cancelar y cerrar con atrás)',
    (codigo.match(/limpiarForm\(\)/g) || []).length >= 4);

  // Y lo declarado tiene que llegar al PAPEL, que es para lo que se pidió.
  ok('* los cuatro datos y las observaciones viajan al PDF',
    /solicitante: r\.solicitante_nombre/.test(codigo) && /autorizadoPor: r\.autorizado_nombre/.test(codigo)
    && /destino: destinoLabel\(r\.destino_tipo\)/.test(codigo) && /observaciones: r\.observaciones/.test(codigo));
}
{
  // En el PDF, lo vacío NO sale: 500 requerimientos viejos no traen nada de esto.
  const pdf = leer('src/lib/requerimiento.ts');
  ok('⭐ el PDF conoce los cinco datos nuevos',
    /solicitante\?: string \| null/.test(pdf) && /autorizadoPor\?: string \| null/.test(pdf)
    && /destino\?: string \| null/.test(pdf) && /area\?: string \| null/.test(pdf)
    && /observaciones\?: string \| null/.test(pdf));
  ok('* y el subtítulo de siempre no se tocó («Solicita» es el usuario que lo registró)',
    pdf.includes("' · Solicita: '") && pdf.includes("' · Responsable: '"));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-requerimiento-personas · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('   La nómina solo se lee, el nombre escrito va a Contactos sin duplicar, y todo es opcional.');
