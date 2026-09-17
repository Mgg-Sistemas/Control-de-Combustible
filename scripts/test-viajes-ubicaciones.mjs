/*
 * Test de OBRAS / UBICACIONES en Viajes de camiones (12-sep-2026).
 *
 * Pedido del cliente: poder crear y borrar obras (CDT Parque del Agua,
 * SanteDubi, CDF, CDT Playa Escondida), asignarle una a cada listero y poder
 * moverlo, y sacar el reporte por obra además de por empresa y por listero.
 * Más una columna de empresa que se pueda ocultar con su interruptor.
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · LA OBRA VIAJA EN LA FILA, NO EN LA FICHA. Cada viaje guarda la obra que
 *     tenía el listero ese día. Si el reporte leyera la ficha de hoy, mover a
 *     alguien de obra cambiaría sus viajes de agosto de sitio y un informe ya
 *     entregado dejaría de cuadrar con el de mañana del mismo rango.
 *   · AGRUPAR NO FILTRA. El total por obra tiene que ser EXACTAMENTE el mismo
 *     que por empresa y que por listero: cambiar el eje reparte los mismos
 *     viajes, no saca ni agrega ninguno.
 *   · BORRAR UNA OBRA NO BORRA VIAJES NI LES QUITA EL NOMBRE. La clave cae al
 *     nombre guardado, que sobrevive a que la fila se borre.
 *   · LOS VIAJES VIEJOS NO SE ADIVINAN. Los de antes de que esto existiera van
 *     a SIN UBICACIÓN. Rellenarlos con la obra actual del listero daría un
 *     reporte completo y falso, que es peor que uno incompleto y honesto.
 *   · UN EJE NUEVO NO PUEDE TUMBAR EL PANEL. Un llamador viejo que no mande el
 *     quinto eje tiene que seguir funcionando, no reventar.
 *
 *   node scripts/test-viajes-ubicaciones.mjs
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
function cargarAbs(abs) {
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return cargarAbs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}
const cargar = (rel) => cargarAbs(path.join(ROOT, rel));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const ub = cargar('src/lib/ubicacionesObra.ts');
const res = cargar('src/lib/viajesResumen.ts');
const fil = cargar('src/lib/viajesFiltros.ts');

// ── 1) EL CATÁLOGO: nombres que no se repiten escritos distinto ────────────
const OBRAS = [
  { id: 'u1', nombre: 'CDT Parque del Agua', active: true },
  { id: 'u2', nombre: 'SanteDubi', active: true },
  { id: 'u3', nombre: 'CDF', active: true },
  { id: 'u4', nombre: 'CDT Playa Escondida', active: false },
];

eq('limpia los espacios de más', ub.nombreLimpio('  CDT   Parque  del Agua '), 'CDT Parque del Agua');
eq('un nombre vacío queda vacío', ub.nombreLimpio('   '), '');
eq('no fuerza mayúsculas: el nombre sale como se escribió', ub.nombreLimpio('CDT Parque del Agua'), 'CDT Parque del Agua');
eq('la clave ignora tildes y mayúsculas', ub.claveUbicacion(' CDF '), ub.claveUbicacion('cdf'));

eq('un nombre en blanco se rechaza', ub.validarNombre('  ', OBRAS), 'Escribe el nombre de la obra.');
ok('un nombre larguísimo se rechaza', !!ub.validarNombre('x'.repeat(ub.MAX_NOMBRE + 1), OBRAS));
ok('un nombre del largo justo pasa', ub.validarNombre('x'.repeat(ub.MAX_NOMBRE), OBRAS) === null);
eq('no deja repetir una obra que ya existe', ub.validarNombre('cdf', OBRAS), 'Ya existe una obra que se llama "CDF".');
eq('...ni escrita con espacios de más', ub.validarNombre('  C D F  ', OBRAS), null); // "C D F" NO es "CDF"
eq('tampoco con otra caja', ub.validarNombre('SANTEDUBI', OBRAS), 'Ya existe una obra que se llama "SanteDubi".');
// Renombrar una obra a su propio nombre no puede decir que ya existe: la que
// existe es ella misma. Sin esto, corregir una tilde sería imposible.
eq('renombrarla a lo mismo SÍ se permite', ub.validarNombre('CDF', OBRAS, 'u3'), null);
eq('pero no al nombre de otra', ub.validarNombre('SanteDubi', OBRAS, 'u3'), 'Ya existe una obra que se llama "SanteDubi".');
eq('una obra nueva con nombre libre pasa', ub.validarNombre('Obra Nueva', OBRAS), null);

// Las desactivadas al final: siguen existiendo por sus viajes, pero no estorban.
eq('las activas primero, en orden alfabético',
  ub.ordenarUbicaciones(OBRAS).map((o) => o.nombre),
  ['CDF', 'CDT Parque del Agua', 'SanteDubi', 'CDT Playa Escondida']);
eq('ordenar no muta la lista de entrada', OBRAS.map((o) => o.id), ['u1', 'u2', 'u3', 'u4']);

// ── 2) LO QUE SE GRABA EN EL VIAJE: id Y nombre ────────────────────────────
eq('graba las dos cosas', ub.obraParaGrabar('u3', OBRAS), { ubicacionId: 'u3', ubicacionNombre: 'CDF' });
eq('sin obra asignada no graba nada', ub.obraParaGrabar(null, OBRAS), { ubicacionId: null, ubicacionNombre: null });
eq('una cadena vacía es lo mismo que nada', ub.obraParaGrabar('', OBRAS), { ubicacionId: null, ubicacionNombre: null });
// El nombre es lo que hace que el viaje sobreviva a que se borre la obra.
eq('un id que ya no está en el catálogo graba el id sin nombre',
  ub.obraParaGrabar('u9', OBRAS), { ubicacionId: 'u9', ubicacionNombre: null });

// ── 3) LA CLAVE CON LA QUE SE AGRUPA UN VIAJE POR OBRA ─────────────────────
eq('manda el id', res.claveUbicacionViaje({ ubicacionId: 'u1', ubicacionName: 'CDF' }), 'u1');
// ⭐ EL CASO DE BORRAR UNA OBRA: la FK es `on delete set null`, así que el id se
//    va y el nombre se queda. Sin este repuesto, borrar una obra mandaría TODOS
//    sus viajes históricos a "Sin ubicación" de golpe.
eq('sin id, cae al nombre guardado',
  res.claveUbicacionViaje({ ubicacionId: null, ubicacionName: 'CDF' }), 'nombre:cdf');
eq('el nombre no distingue mayúsculas ni espacios',
  res.claveUbicacionViaje({ ubicacionId: null, ubicacionName: '  cdf ' }),
  res.claveUbicacionViaje({ ubicacionId: null, ubicacionName: 'CDF' }));
eq('sin nada, cubeta de sin ubicación',
  res.claveUbicacionViaje({ ubicacionId: null, ubicacionName: null }), res.SIN_UBICACION);
eq('un viaje viejo (sin los campos) también', res.claveUbicacionViaje({}), res.SIN_UBICACION);
ok('el nombre suelto nunca puede chocar con un uuid',
  res.claveUbicacionViaje({ ubicacionName: 'u1' }) !== 'u1');

// ── 4) AGRUPAR POR OBRA NO SACA NI AGREGA UN SOLO VIAJE ────────────────────
const CAMIONES = {
  m1: { companyId: 'e1', companyName: 'MGG', plate: 'AB123', serial: null },
  m2: { companyId: 'e2', companyName: 'SOS', plate: null, serial: 'S-9' },
};
const camionPorId = (id) => CAMIONES[id];
const viaje = (m, listeroId, listeroName, ubicacionId, ubicacionName, turno) => ({
  machineryId: m, machineCode: m === 'm1' ? 'VOLTEO A' : 'VOLTEO B',
  listeroId, listeroName, ubicacionId, ubicacionName, turno,
});
const VIAJES = [
  viaje('m1', 'l1', 'Listero Uno', 'u1', 'CDT Parque del Agua', 'day'),
  viaje('m1', 'l1', 'Listero Uno', 'u1', 'CDT Parque del Agua', 'night'),
  viaje('m2', 'l2', 'Listero Dos', 'u2', 'SanteDubi', 'day'),
  viaje('m2', 'l2', 'Listero Dos', 'u3', 'CDF', 'day'),
  // Un viaje viejo: no trae obra por ningún lado.
  viaje('m1', 'l3', 'Listero Tres', null, null, 'night'),
];

const porEmp = res.resumirViajes(VIAJES, camionPorId, 'empresa');
const porLis = res.resumirViajes(VIAJES, camionPorId, 'listero');
const porUbi = res.resumirViajes(VIAJES, camionPorId, 'ubicacion');

eq('el total por obra es el mismo que por empresa', porUbi.total, porEmp.total);
eq('...y que por listero', porUbi.total, porLis.total);
eq('la suma de los grupos cuadra con el total',
  porUbi.empresas.reduce((a, g) => a + g.total, 0), porUbi.total);
eq('el desglose día/noche también cuadra',
  [porUbi.dia, porUbi.noche], [porEmp.dia, porEmp.noche]);
eq('los camiones distintos son los mismos en los tres ejes',
  [porUbi.totalCamiones, porLis.totalCamiones], [porEmp.totalCamiones, porEmp.totalCamiones]);
eq('el eje queda anotado en el resultado', porUbi.groupBy, 'ubicacion');

// El reparto por obra, grupo a grupo.
eq('cada obra con sus viajes',
  porUbi.empresas.map((g) => [g.name, g.total]).sort(),
  [['CDF', 1], ['CDT Parque del Agua', 2], ['SanteDubi', 1], ['Sin ubicación', 1]].sort());
// ⭐ El viaje viejo NO se le regala a ninguna obra: se dice que no se sabe.
ok('el viaje sin obra cae en su propia cubeta, no en la de otro',
  porUbi.empresas.some((g) => g.key === res.SIN_UBICACION && g.total === 1));
// Un listero con viajes en dos obras aparece en las dos: es lo correcto, porque
// el reporte cuenta VIAJES, no personas.
eq('un listero que trabajó en dos obras suma en las dos',
  porUbi.empresas.filter((g) => ['SanteDubi', 'CDF'].includes(g.name)).map((g) => g.total), [1, 1]);

// El eje por defecto NO cambió: quien no pida nada sigue sacando por empresa.
eq('el eje por defecto sigue siendo empresa',
  JSON.stringify(res.resumirViajes(VIAJES, camionPorId)), JSON.stringify(porEmp));

// Obra borrada del catálogo: los viajes siguen juntos, bajo su nombre.
const BORRADA = [
  viaje('m1', 'l1', 'Uno', null, 'CDF', 'day'),
  viaje('m2', 'l2', 'Dos', null, 'CDF', 'day'),
];
const tras = res.resumirViajes(BORRADA, camionPorId, 'ubicacion');
eq('borrar la obra no dispersa sus viajes', tras.empresas.length, 1);
eq('...y conservan su nombre', tras.empresas[0].name, 'CDF');

// ── 5) EL QUINTO EJE DE FILTRO NO PUEDE TUMBAR EL PANEL ────────────────────
eq('el eje de obra está declarado', fil.EJES_FILTRO.includes('ubicacion'), true);
eq('son cinco ejes', fil.EJES_FILTRO.length, 5);
const claves = { listero: 'l1', empresa: 'e1', camion: 'm1', turno: 'day', ubicacion: 'u1' };
const vacia = { listero: new Map(), empresa: new Map(), camion: new Map(), turno: new Map(), ubicacion: new Map() };
ok('sin nada marcado pasa todo', fil.pasaFiltros(claves, vacia));
ok('marcar su obra lo deja pasar',
  fil.pasaFiltros(claves, { ...vacia, ubicacion: new Map([['u1', 'CDF']]) }));
ok('marcar OTRA obra lo saca',
  !fil.pasaFiltros(claves, { ...vacia, ubicacion: new Map([['u2', 'SanteDubi']]) }));
// ⚠️ Un llamador viejo que todavía no mande el eje nuevo NO puede reventar: ya
//    pasó al sumar el cuarto eje (turno), y el archivo lo documenta.
const sinElEje = { listero: new Map(), empresa: new Map(), camion: new Map(), turno: new Map() };
ok('un llamador que no manda el eje nuevo no revienta', fil.pasaFiltros(claves, sinElEje));
ok('...y marcadosFueraDelRango tampoco',
  Array.isArray(fil.marcadosFueraDelRango([{}], () => claves, sinElEje)));

// ── 6) LA PANTALLA ─────────────────────────────────────────────────────────
const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
const scrCrudo = leer('src/screens/ViajesCamionesScreen.tsx');
const comp = sinComentarios(leer('src/components/ObrasListeros.tsx'));
const compCrudo = leer('src/components/ObrasListeros.tsx');

ok('la pantalla lee el catálogo de obras', /useTable<UbicacionObra>\('ubicaciones_obra'/.test(scr));
ok('hay un tercer eje de agrupación', scrCrudo.includes("['ubicacion', '🏗️ Obra']"));
ok('hay chips para filtrar por obra', /toggleFilterUbicacion\(o\.id, o\.label\)/.test(scr));
ok('limpiar filtros también limpia la obra', /setFilterUbicacionSel\(new Map\(\)\)/.test(scr));
ok('el filtro usa la MISMA clave que el resumen', /ubicacion: claveUbicacionViaje\(/.test(scr));

// ⭐ LA FOTO. Si esto se rompiera, mover a un listero reescribiría su pasado.
eq('la obra se graba en el viaje al registrarlo', (scr.match(/\.\.\.obraParaGrabar\(/g) || []).length, 1);
ok('el listero registra con SU obra', /\.\.\.obraParaGrabar\(miObraId, obras\)/.test(scr));
ok('la carga manual graba la obra en cada viaje', /\.\.\.obraCarga,/.test(scr));
ok('la carga manual usa por defecto la obra del listero elegido, no la de la jefa',
  /obraParaGrabar\(cargaUbicacionId \|\| \(listeros\.find\(\(l\) => l\.id === listero\.id\)\?\.ubicacion_id \?\? null\), obras\)/.test(scr));
ok('el reporte NO mira la ficha de hoy', !/miObraId.*resumirViajes|resumirViajes.*miObraId/.test(scr));

// El PDF: rótulos del tercer eje y el filtro anotado.
ok('el PDF rotula la obra', /porUbicacion \? '🏗️'/.test(scrCrudo));
ok('...y la cuenta en obras', /porUbicacion \? 'obra\(s\)'/.test(scr));
ok('el nombre del archivo dice el eje', /resumen por obra /.test(scr));
ok('el papel deja constancia del filtro de obra', /Obras: \$\{esc\(Array\.from\(filterUbicacionSel\.values\(\)\)/.test(scr));
ok('las columnas reciben el eje', /columnasDetalle\(op, resumenEje\)/.test(scr) && /columnasResumen\(op, resumenEje\)/.test(scr));
ok('el detallado muestra el nombre GRABADO, no el del catálogo de hoy',
  /ubicacion: r\.ubicacionNombre \|\| SIN_UBICACION_LABEL/.test(scr));
// ⭐ 15-sep-2026: «Agrupar por obra» separaba bien los viajes (por id) pero rotulaba TODAS
//    las obras «Sin ubicación», porque la pantalla trae `ubicacionNombre` y el resumen lee
//    `ubicacionName`. Esto fija el puente, y abajo se muestra lo que pasa sin él.
ok('⭐ el resumen recibe el NOMBRE de la obra', /ubicacionName: r\.ubicacionNombre \?\? null/.test(scr));
{
  const sinPuente = res.resumirViajes([{ machineryId: 'm1', machineCode: 'VOLTEO A', ubicacionId: 'u1', ubicacionNombre: 'CDT Playa Escondida' }], camionPorId, 'ubicacion');
  const conPuente = res.resumirViajes([{ machineryId: 'm1', machineCode: 'VOLTEO A', ubicacionId: 'u1', ubicacionName: 'CDT Playa Escondida' }], camionPorId, 'ubicacion');
  eq('sin el puente la obra sale «Sin ubicación» (el error que se vio)', sinPuente.empresas[0].name, 'Sin ubicación');
  eq('con el puente sale su nombre', conPuente.empresas[0].name, 'CDT Playa Escondida');
}

// El administrador de obras.
ok('se pueden crear obras', /from\('ubicaciones_obra'\)\.insert/.test(comp));
ok('se pueden renombrar', /from\('ubicaciones_obra'\)\.update\(\{ nombre:/.test(comp));
ok('se pueden desactivar sin borrarlas', /update\(\{ active: !o\.active \}\)/.test(comp));
ok('se pueden borrar', /from\('ubicaciones_obra'\)\.delete\(\)/.test(comp));
ok('borrar pregunta antes', /await confirm\(/.test(comp));
ok('...y avisa que los viajes NO se borran', compCrudo.includes('Los viajes ya registrados NO se borran'));
ok('se puede mover un listero de obra', /asignarObraAListero\(l\.id, obraId\)/.test(comp));
ok('...y quitarle la obra', /mover\(l, null\)/.test(comp));
ok('se avisa que mover no toca los viajes viejos', compCrudo.includes('Sus viajes anteriores no se mueven'));
ok('se ve quién no tiene obra asignada', compCrudo.includes('Sin obra asignada'));
ok('el nombre se valida antes de guardar', /validarNombre\(/.test(comp));

// ⭐ EL MÓDULO SIGUE VIVO SIN EL SQL CORRIDO. Es lo que separa un despliegue de
//    una caída: el código sale antes que el SQL, siempre.
ok('la tarjeta avisa si falta correr el SQL', compCrudo.includes('Falta correr el SQL de obras'));
ok('...y dice que no se pierde ningún viaje', compCrudo.includes('No se pierde ningún viaje'));
const lib = sinComentarios(leer('src/lib/camionViajes.ts'));
ok('la lectura de viajes se reintenta sin las columnas nuevas', /const data = await selectAllRows\('camion_viajes', SELECT_COLS, filtro\)/.test(lib));
// El REINTENTO, no cualquier insert: sin él, el listero no podría registrar ni
// un viaje entre el despliegue y el momento en que se corra el SQL.
//
// Desde la tiquetera (12-sep-2026) el reintento es una ESCALERA de tres peldaños
// —todo, sin tique, pelado— porque hay dos grupos de columnas que pueden faltar
// por separado. El peldaño de abajo es el que salva al listero.
ok('el insert baja hasta el cuerpo pelado',
  /escalones\.push\(\{ cuerpo: base, obra: false, tique: false \}\);/.test(lib));
ok('...y los tres peldaños salen del MISMO cuerpo base',
  (lib.match(/cuerpo: \{ \.\.\.base/g) || []).length === 2);
ok('el reintento usa la MISMA clave de idempotencia', !/nuevoClientActionId/.test(lib));
ok('la lista de listeros no se cae sin la columna', /supabase\.from\('profiles'\)\.select\(COLS_PERFIL\)/.test(lib));

// ⭐ EL GUARDA QUE DE VERDAD IMPORTA: los interruptores solo se tocan DESPUÉS de
//    que un insert funcionó. Si se apagaran al fallar, un error que no tenía
//    nada que ver con las columnas dejaría al módulo sin obras ni tique el resto
//    de la sesión — y los viajes de esa sesión se guardarían sin folio.
{
  const i = lib.indexOf('for (const paso of escalones)');
  const bucle = i >= 0 ? lib.slice(i, lib.indexOf('if (error) return { error: error.message', i)) : '';
  const iExito = bucle.indexOf('if (!error) {');
  const iVuelta = bucle.indexOf('return {};');
  const asignaciones = [...bucle.matchAll(/hayColumnasDe(?:Obra|Tique) = (?:true|false);/g)].map((m) => m.index);
  ok('los interruptores solo se tocan cuando el insert FUNCIONÓ',
    bucle.length > 0 && iExito >= 0 && iVuelta > iExito
    && asignaciones.length >= 4
    && asignaciones.every((p) => p > iExito && p < iVuelta));
}

// ── 6b) EL PANEL: nombre nuevo y todo plegable (12-sep-2026) ───────────────
ok('el panel ya no se llama "de la jefa"', !/Panel de la jefa<\/SectionTitle>/.test(scrCrudo));
ok('se llama Panel de información', scrCrudo.includes('📊 Panel de información'));

// Los SEIS apartados son desplegables. Se cuenta, en vez de mirar uno: si
// alguien agrega un bloque nuevo con <Card> suelto, el panel vuelve a crecer sin
// que nada avise, que es justo lo que esto vino a arreglar.
const plegable = sinComentarios(leer('src/components/Plegable.tsx'));
// Seis desde el 17-sep: se sumó «🚜 Máquinas que salen en Viajes» (solo admin).
eq('los seis apartados del panel son plegables', (scr.match(/<Plegable[\s>]/g) || []).length, 6);
ok('y el de obras también lo es', /setAbierto\(\(v\) => !v\)/.test(comp));
ok('ya no quedan tarjetas fijas en el panel',
  !/\n          <Card>\n            <SectionTitle>/.test(scrCrudo));

// ⚠️ CERRADO NO ES ESCONDIDO: el título tiene que decir qué hay dentro, o una
//    lista de seis desplegables mudos es una búsqueda a ciegas.
eq('cada plegable dice qué hay dentro sin abrirlo', (scr.match(/resumen=/g) || []).length, 6);
ok('el resumen de hoy y la lista completa arrancan abiertos',
  (scr.match(/abiertaPorDefecto(?![=])/g) || []).length === 2);
// Una alerta que hay que ir a destapar no es una alerta.
ok('la alerta de camiones parados se abre sola si hay alguno',
  /abiertaPorDefecto=\{!!alertaError \|\| alertList\.length > 0\}/.test(scr));
ok('...y se pinta en color de aviso', /alerta=\{!!alertaError \|\| alertList\.length > 0\}/.test(scr));
ok('el componente pinta el resumen en aviso cuando toca', /alerta \? colors\.warning : colors\.muted/.test(plegable));
ok('el pliegue no se guarda en ningún lado', !/AsyncStorage|localStorage/.test(plegable));

// ── 7) EL MANUAL CUENTA LO MISMO ───────────────────────────────────────────
const md = leer('docs/MANUAL-USUARIO.md');
const ms = leer('src/screens/ManualScreen.tsx');
ok('el manual .md explica las obras', /Obras y ubicaciones \(12\/09\/2026\)/.test(md));
ok('el manual .md dice que mover no cambia el pasado', /NO cambia sus viajes ya registrados/i.test(md));
ok('el manual .md explica el reporte por obra', /resumen por obra/i.test(md));
ok('el manual en pantalla lo explica', /OBRAS Y UBICACIONES \(12\/09\/2026\)/.test(ms));
ok('el manual en pantalla también avisa lo del pasado', /NO CAMBIA SUS VIAJES YA REGISTRADOS/.test(ms));
ok('los dos manuales cuentan la corrección de «Agrupar por obra»', /Agrupar por obra corregido \(15\/09\/2026\)/.test(md) && /AGRUPAR POR OBRA CORREGIDO \(15\/09\/2026\)/.test(ms));
ok('el manual .md explica que el panel son desplegables', /Todo el panel son desplegables \(12\/09\/2026\)/.test(md));
ok('el manual .md usa el nombre nuevo del panel', /### Panel de información \(administración\)/.test(md));
ok('el manual en pantalla también', /EL PANEL AHORA SON DESPLEGABLES \(12\/09\/2026\)/.test(ms));

// ── SOLO LOS DEL ROL LISTERO EN «LISTEROS Y SU OBRA» (13-sep-2026) ──────────
// Pedido del cliente: «necesito que ahi solo me aparezcan los que tienen el rol de
// listeros». La lista juntaba a todo el que tenia acceso al modulo: dos admins, un
// usuario de pruebas y dos almacenistas con permiso full salian como listeros sin obra.
const rol = cargar('src/lib/rolListero.ts');
ok('un rol con SOLO viajes es listero', rol.esRolListero({ viajes_camiones: 'escritura' }) === true);
ok('...aunque tenga otros modulos apagados', rol.esRolListero({ viajes_camiones: 'escritura', compras: 'none' }) === true);
ok('un rol con viajes y mas modulos NO es listero', rol.esRolListero({ viajes_camiones: 'full', compras: 'full' }) === false);
ok('un rol sin viajes no es listero', rol.esRolListero({ inventario: 'full' }) === false);
ok('viajes apagado no es listero', rol.esRolListero({ viajes_camiones: 'none' }) === false);
ok('sin rol no es listero', rol.esRolListero(null) === false && rol.esRolListero(undefined) === false && rol.esRolListero({}) === false);

// ⭐ LA MISMA REGLA QUE EL MENU. Con dos reglas, alguien podria entrar al panel del
//    listero y no aparecer para asignarle obra, o aparecer sin ser listero.
const nav = sinComentarios(leer('src/navigation/index.tsx'));
ok('el menu usa la regla compartida', /esRolListero\(appRole\?\.modules\)/.test(nav));
ok('...y ya no tiene su propia copia', !/VIAJES_MODULES/.test(nav));
ok('la lista marca quien tiene el rol con la MISMA regla', /esRolListero\(r\?\.modules\)/.test(lib) && /esListero: rolesListero\.has\(/.test(lib));
ok('...y pide el rol de cada perfil', /COLS_PERFIL = 'id, full_name, active, app_role_id'/.test(lib));
ok('a «Listeros y su obra» le llegan solo los del rol',
  /listeros=\{listerosDeRol\}/.test(scr) && /listeros\.filter\(\(l\) => l\.esListero\)/.test(scr));
// ⚠️ Lo demas NO cambia: la carga a mano y «Lo registro» siguen con todos los que
//    tienen acceso. Un viaje ya registrado por alguien sin el rol tiene que seguir
//    mostrando a quien pertenece.
ok('la carga a mano sigue con la lista completa', /listeros\.find\(\(l\) => l\.id === cargaListeroId\)/.test(scr));
ok('«Lo registro» sigue con la lista completa', /\{listeros\.map\(\(l\) => \{/.test(scr));
ok('la tarjeta dice que no hay nadie con el rol', compCrudo.includes('No hay usuarios con el rol de listero'));
ok('...y explica por que falta quien tiene solo permiso', compCrudo.includes('Solo salen los usuarios con el rol de listero'));
ok('el manual .md lo explica', /Solo salen los usuarios con el \*\*rol de listero\*\*/.test(md));
ok('el manual en pantalla tambien', /SOLO SALEN LOS USUARIOS CON EL ROL DE LISTERO \(13\/09\/2026\)/.test(ms));

// ── ELEGIR EL CDT DE UN VIAJE (16-sep-2026) ─────────────────────────────────
// Pedido del cliente: quien tiene permiso completo elige el CDT en la carga manual
// y lo corrige en un viaje ya registrado. «Lo que fue, fue»: cambiar el CDT de un
// viaje toca SOLO esa fila; lo demás no se mueve.
const O = (id, nombre, active = true, zona_pago = null) => ({ id, nombre, active, zona_pago });
const catCdt = [O('b', 'CDT Beta', true, 'oeste'), O('a', 'CDT Alfa', true, 'este'), O('z', 'CDT Cerrado', false, 'este')];
eq('se ofrecen los CDT activos, en orden', ub.cdtsParaElegir(catCdt).map((o) => o.id), ['a', 'b']);
eq('...y el desactivado que ya tiene el viaje, al final', ub.cdtsParaElegir(catCdt, 'z').map((o) => o.id), ['a', 'b', 'z']);
ok('el aviso dice de dónde a dónde', ub.avisoCambioCdt('CDT Alfa', catCdt[0]).includes('«CDT Alfa» a «CDT Beta»'));
ok('...con qué zona se va a pagar', ub.avisoCambioCdt('CDT Alfa', catCdt[0]).includes('zona de «CDT Beta»: Oeste'));
ok('...y que solo cambia ese viaje', ub.avisoCambioCdt('CDT Alfa', catCdt[0]).includes('Solo cambia este viaje'));
ok('un viaje sin CDT se nombra «Sin ubicación»', ub.avisoCambioCdt(null, catCdt[1]).includes(`«${ub.SIN_UBICACION_LABEL}» a «CDT Alfa»`));
ok('un CDT sin zona avisa que el viaje queda sin pagar', ub.avisoCambioCdt('CDT Alfa', O('s', 'CDT Nuevo')).includes('no tiene zona de pago'));

ok('corregir un viaje manda el CDT nuevo a la base', /if \(cambios\.ubicacionId\) patch\.ubicacion_id = cambios\.ubicacionId;/.test(lib));
ok('...y NO manda nombre ni zona: los pone la base', !/patch\.ubicacion_nombre|patch\.zona_pago/.test(lib));
ok('la corrección arranca con el CDT que ya tenía el viaje', /ubicacionId: row\.ubicacionId \?\? '',/.test(scr));
ok('⭐ solo quien tiene full ve y cambia el CDT', (() => {
  // El selector vive dentro del bloque {canFull ? (<> … </>) : null} de la edición,
  // el mismo del chofer: entre «Sin chofer anotado» y el cierre de ese bloque.
  const i = scr.indexOf('CDT / UBICACIÓN DE ESTE VIAJE');
  const chofer = scr.indexOf('placeholder="Sin chofer anotado"');
  const cierre = chofer < 0 ? -1 : chofer + scr.slice(chofer).search(/<\/>\s*\) : null\}/);
  return i > chofer && chofer > 0 && cierre > i;
})());
ok('⭐ pregunta antes, con el aviso de zona', /confirm\(`\$\{avisoCambioCdt\(row\.ubicacionNombre, obra\)\}/.test(scr));
ok('...cambia solo si eligió otro', /editing\.ubicacionId && editing\.ubicacionId !== \(row\.ubicacionId \?\? ''\)/.test(scr));
ok('...y queda en el rastro de la edición', /queCambio\.push\(`CDT: /.test(scr));
ok('la carga manual ofrece elegir CDT', /CDT \/ UBICACIÓN \(por defecto, el del listero\)/.test(scr) && /setCargaUbicacionId\(o\.id\)/.test(scr));
ok('...y la confirmación dice en qué CDT quedan', /en \$\{obraCarga\.ubicacionNombre \?/.test(scr));
ok('cada viaje muestra su CDT en la lista', /row\.ubicacionNombre \? ` · 🏗️ \$\{row\.ubicacionNombre\}` : ''/.test(scr));
ok('el manual .md lo explica', /Elegir el CDT de un viaje \(16\/09\/2026/.test(md));
ok('el manual en pantalla también', /ELEGIR EL CDT DE UN VIAJE \(16\/09\/2026/.test(ms));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-ubicaciones · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
