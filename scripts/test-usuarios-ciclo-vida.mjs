/*
 * LAS CUENTAS NO SE BORRAN: SE APAGAN Y SE ARCHIVAN (09-sep-2026).
 *
 * Pedido del cliente: «en los usuarios, se eliminan, esa opción ya no va, hay
 * que trabajar como en el PDF: que no se eliminen, que se activen o desactiven,
 * y que se puedan archivar».
 *
 * POR QUÉ NO SE BORRA (medido sobre supabase/schema.sql, no estimado):
 * 33 claves foráneas apuntan a `public.profiles`. Ocho no tienen cascada y
 * bloquean el borrado; las otras 25 son `on delete set null` y lo dejan pasar
 * dejando SIN AUTOR nóminas, reparaciones, asistencia y dotaciones. O sea que el
 * botón de eliminar o fallaba o rompía el historial en silencio.
 *
 * Lo que fijan estos casos:
 *   - los tres estados y las cuatro transiciones legales; el arco activa →
 *     archivada NO existe, ni en un sentido ni en el otro;
 *   - que archivada implique SIEMPRE inactiva, incluso si llegara una fila
 *     imposible (archivada y encendida) desde la base;
 *   - que nadie se apague ni se archive a sí mismo;
 *   - que el motivo sea obligatorio de verdad (no basta con espacios);
 *   - que la lista se PARTA en dos, en vez de filtrarse;
 *   - que en la pantalla ya NO exista ningún borrado, ni el de la lista ni el
 *     del modal de edición, ni la llamada `action: 'delete'`;
 *   - que cada botón aparezca solo donde la acción es legal;
 *   - y que los cinco selectores de gente asignable dejen fuera a los archivados
 *     sin romperse mientras el SQL no esté corrido.
 *
 * Los guardas sobre la pantalla están anclados al argumento, no a la presencia
 * de un nombre: cambiar `puedeArchivar` por `puedeActivar` en un solo sitio, o
 * devolver el botón de eliminar, tiene que hacer fallar esto.
 *
 *   node scripts/test-usuarios-ciclo-vida.mjs
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
const transpilar = (src) => ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const cargar = (rel, stubs = {}) => {
  const mod = { exports: {} };
  const req = (n) => { if (n in stubs) return stubs[n]; throw new Error(`import no previsto en ${rel}: ${n}`); };
  new Function('exports', 'module', 'require', transpilar(leer(rel)))(mod.exports, mod, req);
  return mod.exports;
};
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const bloque = (s, desde, hasta) => { const i = s.indexOf(desde); const j = s.indexOf(hasta, i + 1); if (i < 0 || j < 0) throw new Error(`no encuentro el bloque ${desde}…${hasta}`); return s.slice(i, j); };

const L = cargar('src/lib/cicloVidaUsuario.ts');

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? `  → ${extra}` : '')); }
};

console.log('USUARIOS — las cuentas no se borran: se apagan y se archivan\n');

const YO = 'yo-1';
const activa   = { id: 'a', active: true };
const inactiva = { id: 'b', active: false };
const archiv   = { id: 'c', active: false, archivado_en: '2026-09-05T10:00:00Z', archivado_motivo: 'RENUNCIO' };

// ── 1) Los tres estados ─────────────────────────────────────────────────────
{
  ok('activa', L.estadoDeCuenta(activa) === 'activa');
  ok('inactiva', L.estadoDeCuenta(inactiva) === 'inactiva');
  ok('archivada', L.estadoDeCuenta(archiv) === 'archivada');
  ok('sin la columna active se asume activa', L.estadoDeCuenta({ id: 'x' }) === 'activa');
  ok('active nulo NO es inactiva (solo el false lo es)', L.estadoDeCuenta({ id: 'x', active: null }) === 'activa');
  ok('una cuenta que no existe no revienta', L.estadoDeCuenta(null) === 'inactiva' && L.estadoDeCuenta(undefined) === 'inactiva');

  // La fila imposible: archivada Y encendida. El CHECK de la base no deja que
  // exista, pero si llegara, el archivo manda. Nunca se lee como activa.
  ok('archivada gana aunque llegue encendida', L.estadoDeCuenta({ id: 'z', active: true, archivado_en: '2026-01-01' }) === 'archivada');
  ok('una fecha en blanco NO archiva', L.estadoDeCuenta({ id: 'z', active: true, archivado_en: '   ' }) === 'activa');

  ok('etiqueta Activa', L.etiquetaEstado(activa) === 'Activa');
  ok('etiqueta Inactiva', L.etiquetaEstado(inactiva) === 'Inactiva');
  ok('etiqueta Archivada', L.etiquetaEstado(archiv) === 'Archivada');
  ok('estaArchivada solo con la archivada', !L.estaArchivada(activa) && !L.estaArchivada(inactiva) && L.estaArchivada(archiv));
}

// ── 2) Las cuatro transiciones legales, y el arco prohibido ────────────────
{
  // desactivar: solo lo encendido, nunca uno mismo
  ok('se desactiva lo activo', L.puedeDesactivar(activa, YO));
  ok('no se desactiva lo ya apagado', !L.puedeDesactivar(inactiva, YO));
  ok('no se desactiva lo archivado', !L.puedeDesactivar(archiv, YO));
  ok('NADIE se desactiva a sí mismo', !L.puedeDesactivar({ id: YO, active: true }, YO));

  // activar: solo lo apagado
  ok('se activa lo inactivo', L.puedeActivar(inactiva));
  ok('no se activa lo ya activo', !L.puedeActivar(activa));
  ok('ARCO PROHIBIDO: no se activa lo archivado', !L.puedeActivar(archiv));

  // archivar: solo lo apagado, nunca uno mismo
  ok('se archiva lo inactivo', L.puedeArchivar(inactiva, YO));
  ok('ARCO PROHIBIDO: no se archiva lo activo', !L.puedeArchivar(activa, YO));
  ok('no se archiva lo ya archivado', !L.puedeArchivar(archiv, YO));
  ok('NADIE se archiva a sí mismo', !L.puedeArchivar({ id: YO, active: false }, YO));
  ok('ni siquiera si el id viene con espacios', !L.puedeArchivar({ id: YO, active: false }, ' ' + YO + ' '));

  // desarchivar: solo lo archivado
  ok('se desarchiva lo archivado', L.puedeDesarchivar(archiv));
  ok('no se desarchiva lo que está en uso', !L.puedeDesarchivar(activa) && !L.puedeDesarchivar(inactiva));

  // La regla se explica antes de chocar con ella.
  ok('dice que primero hay que desactivar', /Primero hay que desactivarla/.test(L.razonNoArchivable(activa, YO)));
  ok('dice que ya está archivada', /Ya está archivada/.test(L.razonNoArchivable(archiv, YO)));
  ok('dice que no puedes archivarte a ti mismo', /tu propia cuenta/.test(L.razonNoArchivable({ id: YO, active: false }, YO)));
  ok('cuando SÍ se puede, no dice nada', L.razonNoArchivable(inactiva, YO) === '');
}

// ── 3) El motivo es obligatorio de verdad ──────────────────────────────────
{
  ok('vacío no vale', !L.motivoValido(''));
  ok('nulo no vale', !L.motivoValido(null) && !L.motivoValido(undefined));
  ok('solo espacios NO vale', !L.motivoValido('      '));
  ok('tres letras no llegan', !L.motivoValido('abc'));
  ok('cuatro sí', L.motivoValido('abcd'));
  ok('el mínimo se aplica ya recortado', !L.motivoValido('  ab  ') && L.motivoValido('  abcd  '));
  ok('el mínimo es 4', L.MOTIVO_MINIMO === 4);
}

// ── 4) Dos listas, no un filtro ────────────────────────────────────────────
{
  const { enUso, archivados } = L.partirUsuarios([activa, archiv, inactiva]);
  ok('la activa va a en uso', enUso.some((u) => u.id === 'a'));
  ok('la inactiva TAMBIÉN va a en uso', enUso.some((u) => u.id === 'b'));
  ok('la archivada va al archivo', archivados.length === 1 && archivados[0].id === 'c');
  ok('no se pierde ni se duplica nadie', enUso.length + archivados.length === 3);
  ok('conserva el orden de entrada', enUso[0].id === 'a' && enUso[1].id === 'b');
  const vacio = L.partirUsuarios(null);
  ok('una lista nula no revienta', vacio.enUso.length === 0 && vacio.archivados.length === 0);
}

// ── 5) La línea que se lee dentro de un año ────────────────────────────────
{
  const l = L.lineaArchivo(archiv, 'ANA GOMEZ');
  ok('trae la fecha', /05\/09\/2026/.test(l));
  ok('trae quién', /por ANA GOMEZ/.test(l));
  ok('trae el motivo', /RENUNCIO/.test(l));
  ok('sin quién, no deja el "por" colgando', !/por\s*·/.test(L.lineaArchivo(archiv, null)));
  ok('sobre una cuenta en uso no dice nada', L.lineaArchivo(activa, 'ANA') === '');
  ok('una fecha inservible no ensucia la línea', !/Invalid|NaN/.test(L.lineaArchivo({ id: 'q', archivado_en: 'no-es-fecha', archivado_motivo: 'X' }, null)));
  ok('fechaCorta con basura devuelve vacío', L.fechaCorta('no-es-fecha') === '' && L.fechaCorta(null) === '');
}

// ── 6) Cuando el SQL todavía no se ha corrido ──────────────────────────────
{
  ok('reconoce que falta la función', L.faltaElSql('Could not find the function public.archivar_usuario(p_id, p_motivo) in the schema cache'));
  ok('reconoce que falta desarchivar', L.faltaElSql('Could not find the function public.desarchivar_usuario in the schema cache'));
  ok('NO confunde un error de permisos', !L.faltaElSql('Solo un administrador puede archivar cuentas.'));
  ok('NO confunde la regla de negocio', !L.faltaElSql('Primero hay que desactivarla. Se archiva lo que ya esta apagado.'));
  ok('NO confunde un fallo de red', !L.faltaElSql('Failed to fetch'));
  ok('un mensaje vacío no es falta de SQL', !L.faltaElSql('') && !L.faltaElSql(null));
  ok('el aviso dice qué archivo correr', /01_usuarios_archivar\.sql/.test(L.AVISO_SIN_SQL));

  ok('reconoce que falta la COLUMNA', L.faltaColumnaArchivo("column profiles.archivado_en does not exist"));
  ok('…y en el caché de esquema', L.faltaColumnaArchivo("Could not find the 'archivado_en' column of 'profiles' in the schema cache"));
  ok('NO confunde otra columna que falte', !L.faltaColumnaArchivo("Could not find the 'to_company_name' column"));

  const filas = [{ id: '1' }, { id: '2', archivado_en: '2026-09-01' }, { id: '3', archivado_en: null }];
  ok('soloEnUso quita los archivados', L.soloEnUso(filas).map((f) => f.id).join(',') === '1,3');
  ok('soloEnUso con nulo devuelve lista vacía', L.soloEnUso(null).length === 0);
  ok('sin la columna, no quita a nadie', L.soloEnUso([{ id: '1' }, { id: '2' }]).length === 2);
}

// ── 7) La pantalla: el borrado ya no existe ────────────────────────────────
{
  const scr = leer('src/screens/UsersScreen.tsx');
  const limpio = sinComentarios(scr);

  ok('NO queda ninguna llamada de borrado', !/action:\s*'delete'/.test(limpio));
  ok('NO queda el botón "Eliminar usuario"', !/Eliminar usuario/.test(limpio));
  ok('NO queda el botón "🗑️ Eliminar"', !/🗑️ Eliminar/.test(limpio));
  ok('NO queda el texto "Eliminando…"', !/Eliminando…/.test(limpio));
  ok('NO quedan removeUser ni deletingId', !/removeUser|deletingId|delError/.test(limpio));
  ok('NO queda el estado deleting del modal', !/const \[deleting, setDeleting\]/.test(limpio));
  ok('se explica POR QUÉ ya no se eliminan', /Las cuentas ya no se eliminan/.test(scr));

  // Encender y apagar: escritura directa, funciona sin SQL.
  ok('desactivar escribe active en profiles', /supabase\.from\('profiles'\)\.update\(\{ active: encender \}\)\.eq\('id', u\.id\)/.test(limpio));
  ok('el aviso de desactivar dice que NO se borra', /NO se borra: su historial sigue intacto/.test(scr));

  // Archivar y desarchivar: por las funciones de la base.
  ok('archivar llama a la función con el motivo', /supabase\.rpc\('archivar_usuario', \{ p_id: u\.id, p_motivo: motivo \}\)/.test(limpio));
  ok('desarchivar llama a su función', /supabase\.rpc\('desarchivar_usuario', \{ p_id: u\.id \}\)/.test(limpio));
  ok('si falta el SQL se dice con palabras, no con el error crudo', (limpio.match(/faltaElSql\(error\.message\) \? AVISO_SIN_SQL : error\.message/g) || []).length === 2);
  ok('el aviso de desarchivar recuerda que queda apagada', /Quedo apagada|queda apagada/i.test(scr));

  // Dos listas, no un filtro.
  ok('la lista se parte con partirUsuarios', /const \{ enUso, archivados \} = partirUsuarios\(filtrados as CuentaCicloVida\[\]\)/.test(limpio));
  ok('la pestaña elige cuál se muestra', /const filtered = \(verArchivo \? archivados : enUso\) as Profile\[\]/.test(limpio));
  ok('cada pestaña muestra su cuenta', /En uso · \$\{enUso\.length\}/.test(scr) && /Archivados · \$\{archivados\.length\}/.test(scr));

  // Cada botón, solo donde la acción es legal.
  ok('Desactivar se pinta con puedeDesactivar', /\{puedeDesactivar\(u as CuentaCicloVida, yoId\) \?/.test(limpio));
  ok('Activar se pinta con puedeActivar', /\{puedeActivar\(u as CuentaCicloVida\) \?/.test(limpio));
  ok('Archivar se pinta con puedeArchivar', /\{puedeArchivar\(u as CuentaCicloVida, yoId\) \?/.test(limpio));
  ok('Sacar del archivo se pinta con puedeDesarchivar', /\{puedeDesarchivar\(u as CuentaCicloVida\) \?/.test(limpio));
  ok('cada botón dispara SU acción', /onPress=\{\(\) => cambiarEncendido\(u, false\)\}/.test(limpio)
    && /onPress=\{\(\) => cambiarEncendido\(u, true\)\}/.test(limpio)
    && /onPress=\{\(\) => setArchivando\(u\)\}/.test(limpio)
    && /onPress=\{\(\) => desarchivar\(u\)\}/.test(limpio));
  ok('yoId sale de la sesión', /const yoId = session\?\.user\?\.id \?\? null;/.test(limpio));

  // El motivo, obligatorio también en la pantalla.
  ok('el modal del motivo existe', /function ArchivarModal\(/.test(scr));
  ok('el botón de archivar espera un motivo válido', /const listo = motivoValido\(motivo\);/.test(limpio));
  ok('y está deshabilitado hasta entonces', /disabled=\{!listo \|\| ocupado\}/.test(limpio));
  ok('el motivo se limpia al cambiar de persona', /useEffect\(\(\) => \{ setMotivo\(''\); \}, \[user\?\.id\]\);/.test(limpio));
  ok('se envía recortado', /onConfirm\(motivo\.trim\(\)\)/.test(limpio));
}

// ── 8) Paso 06: quién más lista usuarios ───────────────────────────────────
{
  const pa = leer('src/lib/personalAsignable.ts');
  ok('pide la columna del archivo', /campos \+ ', archivado_en'/.test(pa));
  ok('reintenta sin ella si no existe', /if \(error && faltaColumnaArchivo\(error\.message\)\)/.test(pa));
  ok('quita a los archivados', /return soloEnUso\(/.test(pa));
  // Desde el 09-09-2026 SI se filtra por active: el SQL 02 hizo que una cuenta
  // apagada no tenga rol, asi que ofrecerla como asignable era ofrecer a alguien
  // que no puede hacer el trabajo.
  ok('deja fuera lo apagado', /\.eq\('active', true\)/.test(pa));
  ok('…y explica desde cuándo y por qué', /Desde el 09-09-2026 eso ya no es así/.test(pa));

  const SITIOS = [
    'src/components/CheckMaquinaModal.tsx',
    'src/screens/SupervisionScreen.tsx',
    'src/screens/SupervisorScreen.tsx',
    'src/screens/DistribucionGuardiasScreen.tsx',
    'src/screens/redesign/InspectionsSummary.tsx',
  ];
  SITIOS.forEach((rel) => {
    const s = sinComentarios(leer(rel));
    ok(`${rel.split('/').pop()} usa personalAsignable`, /personalAsignable\(/.test(s));
    ok(`${rel.split('/').pop()} ya no hace la consulta a mano`, !/from\('profiles'\)[\s\S]{0,120}coordinador_patio/.test(s));
  });

  // Los diccionarios id → nombre NO deben filtrar: si lo hicieran, los
  // documentos viejos empezarían a decir «—».
  const dicc = sinComentarios(leer('src/lib/machineInspectors.ts'));
  ok('el diccionario de inspectores sigue SIN filtrar', /from\('profiles'\)\.select\('id, full_name'\)/.test(dicc) && !/archivado_en/.test(dicc));
}

// ── 9) El tipo y la librería ───────────────────────────────────────────────
{
  const db = leer('src/types/database.ts');
  const p = bloque(db, 'export interface Profile {', '\n}');
  ok('el tipo declara las tres columnas', /archivado_en\?: string \| null;/.test(p) && /archivado_por\?: string \| null;/.test(p) && /archivado_motivo\?: string \| null;/.test(p));
  ok('son opcionales, porque el SQL puede no estar corrido', !/archivado_en: string/.test(p));

  const cab = leer('src/lib/cicloVidaUsuario.ts');
  ok('la librería dice que las puertas YA miran active', /CORREGIDO Y VERIFICADO EL 09-09-2026/.test(cab));
  ok('…y que aun así no cierra el login', /NO cierra el login/.test(cab));
  const lib = sinComentarios(cab);
  ok('la librería de reglas es pura', !/from '\.\/supabase'|\.from\(|\.rpc\(|\.insert\(|\.update\(/.test(lib));
}

// ── 10) Los dos manuales cuentan la misma historia ─────────────────────────
{
  const md = leer('docs/MANUAL-USUARIO.md');
  ok('manual .md: las cuentas ya no se eliminan', /Las cuentas ya no se eliminan \(09\/09\/2026\)/.test(md));
  ok('manual .md: explica los 33 enlaces', /33 enlaces/.test(md));
  ok('manual .md: la tabla de los tres estados', /\| \*\*Activa\*\* \|/.test(md) && /\| \*\*Inactiva\*\* \|/.test(md) && /\| \*\*Archivada\*\* \|/.test(md));
  ok('manual .md: dice que primero se desactiva', /primero hay que \*\*desactivarlo\*\*/.test(md));
  ok('manual .md: dice que desarchivar deja apagado', /queda \*\*apagado\*\*: encenderlo es otro botón/.test(md));
  ok('manual .md: dice que desactivar YA quita el sistema', /Desactivar ahora sí le quita el sistema a la\n> persona/.test(md));
  ok('manual .md: y que NO cierra el login', /no cierra el login/.test(md));
  ok('manual .md: dice que el 01 ya se corrió', /se corrió y se verificó el 09\/09\/2026/.test(md));
  ok('manual .md: dice que el SQL NO va en el repositorio', /no\*\* va en el repositorio/.test(md));

  const ms = leer('src/screens/ManualScreen.tsx');
  ok('manual en pantalla: las cuentas ya no se eliminan', /LAS CUENTAS YA NO SE ELIMINAN \(09\/09\/2026\)/.test(ms));
  ok('manual en pantalla: los tres estados', /AHORA HAY TRES ESTADOS/.test(ms));
  ok('manual en pantalla: el motivo es obligatorio', /PIDE UN MOTIVO obligatorio/.test(ms));
  ok('manual en pantalla: dice que desactivar YA quita el sistema', /Desactivar ahora si le quita el sistema/.test(ms));
  ok('manual en pantalla: y que NO cierra el login', /NO cierra el login/.test(ms));
  ok('manual en pantalla: dice que el 01 ya se corrió', /01_usuarios_archivar\.sql se corrio y se verifico/.test(ms));
}

if (fail) {
  console.log(`\n✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nLas cuentas ya no se eliminan: se activan, se desactivan y se archivan, y el archivo sale de las listas de gente asignable.`);
