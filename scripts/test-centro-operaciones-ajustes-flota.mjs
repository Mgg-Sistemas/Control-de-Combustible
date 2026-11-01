// 🏭 CENTRO DE OPERACIONES — CANDADOS DE ⚙️ AJUSTES Y 🚛 FLOTA (24-oct-2026).
//
// Las dos pestañas son componentes de React Native: acá no se pueden montar sin
// la app, así que los candados son ESTÁTICOS, sobre el texto del código (sin los
// comentarios, para que una nota que diga «supabase» o «borrar» no engañe):
//
//   (a) no hablan con Supabase: piden y guardan SOLO por centroOperacionesDb;
//   (b) las unidades, los sitios y los nombres de lista se DESACTIVAN
//       (`activo: false`), nunca se borran: ninguna función de borrar;
//   (c) 🚛 Flota ofrece «➕ Del catálogo» (buscador por código, placa, serial y
//       empresa sobre el catálogo de sugerenciasDelSistema), «➕ Propia» con todos
//       los campos de la unidad y «🔄 Actualizar desde el catálogo»;
//   (d) ⚙️ Ajustes crea/renombra/desactiva sitios, lleva las cinco listas y
//       guarda los cinco textos fijos en cop_ajustes DEL SITIO, con los logos por
//       defecto del módulo (solo Golden Touch);
//   (e) solo Full cambia algo; los avisos van por useToast; desactivar pide
//       confirmación (useConfirm); A→Z con cmpText;
//   (f) la pantalla monta las dos pestañas y carga los sitios de verdad.
//
// Si un candado falla, NO se afloja el candado: se arregla la pestaña.
//
//   node scripts/test-centro-operaciones-ajustes-flota.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

// Para las reglas PURAS que las pestañas usan (lote 2, A6): el mismo cargador de
// scripts/test-reporte-personalizado.mjs, que transpila el .ts a CommonJS.
const cacheTs = new Map();
function loadTs(abs) {
  if (cacheTs.has(abs)) return cacheTs.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cacheTs.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cacheTs.set(abs, m.exports);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? '  -> ' + extra : ''}`); }
};

const existe = (r) => fs.existsSync(path.join(ROOT, r));
const leer = (r) => (existe(r) ? fs.readFileSync(path.join(ROOT, r), 'utf8') : '');

/**
 * El código sin comentarios (`// …` y `/* … *\/`, también los `{/* … *\/}` de JSX).
 * Respeta las cadenas: un «//» dentro de comillas no corta la línea.
 */
function sinComentarios(src) {
  let out = '';
  let i = 0;
  let cadena = null; // la comilla que abrió la cadena en curso
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (cadena) {
      out += c;
      if (c === '\\') { out += d ?? ''; i += 2; continue; }
      if (c === cadena) cadena = null;
      i++;
      continue;
    }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') cadena = c;
    out += c;
    i++;
  }
  return out;
}

/** Lo que una línea `import { … } from '<desde>'` trae, como lista de nombres. */
function importadosDe(code, desde) {
  const re = new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${desde.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"]`, 'g');
  const nombres = [];
  let m;
  while ((m = re.exec(code))) {
    for (const p of m[1].split(',')) {
      const n = p.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (n) nombres.push(n);
    }
  }
  return nombres;
}

const AJUSTES = 'src/components/centroOperaciones/AjustesTab.tsx';
const FLOTA = 'src/components/centroOperaciones/FlotaTab.tsx';
const PANTALLA = 'src/screens/CentroOperacionesScreen.tsx';
const DB = '../../lib/centroOperacionesDb';

console.log('🏭 CENTRO DE OPERACIONES · ⚙️ AJUSTES Y 🚛 FLOTA\n');

ok('las dos pestañas existen', existe(AJUSTES) && existe(FLOTA), `${existe(AJUSTES) ? '' : AJUSTES + ' '}${existe(FLOTA) ? '' : FLOTA}`);

const ajustes = sinComentarios(leer(AJUSTES));
const flota = sinComentarios(leer(FLOTA));
const pantalla = sinComentarios(leer(PANTALLA));
const pestanas = [[AJUSTES, ajustes], [FLOTA, flota]];

// El quitacomentarios tiene que funcionar de verdad, si no los candados mienten.
ok('(*) el quitacomentarios borra // y /* */ pero respeta las cadenas',
  sinComentarios("a // supabase\nb /* borrar() */ c {/* x */} 'http://x' \"//y\"") === "a \nb  c {} 'http://x' \"//y\"",
  JSON.stringify(sinComentarios("a // supabase\nb /* borrar() */ c {/* x */} 'http://x' \"//y\"")));

// ── (a) NO HABLAN CON SUPABASE ────────────────────────────────────────────
for (const [r, code] of pestanas) {
  const n = path.basename(r);
  ok(`⭐ (a) ${n} no nombra supabase (ni lo importa ni lo usa)`, code !== '' && !/\bsupabase\b/i.test(code));
  ok(`(a) ${n} no importa nada de lib/supabase`, !/from\s+['"][^'"]*\/supabase['"]/.test(code));
  ok(`(a) ${n} pide y guarda por centroOperacionesDb`, importadosDe(code, DB).length > 0, importadosDe(code, DB).join(', '));
  ok(`(a) ${n} no arma consultas: ni .from( ni .rpc( ni selectAllRows`, !/\.from\(|\.rpc\(|selectAllRows/.test(code));
}

// ── (b) SE DESACTIVA, NUNCA SE BORRA ──────────────────────────────────────
for (const [r, code] of pestanas) {
  const n = path.basename(r);
  const delDb = importadosDe(code, DB);
  ok(`⭐ (b) ${n} no importa ninguna función de borrar`, !delDb.some((x) => /borrar|eliminar|delete|remove/i.test(x)), delDb.join(', '));
  ok(`⭐ (b) ${n} no llama a nada que borre`, !/\b(borrar|eliminar|delete|remove)\w*\s*\(/i.test(code) && !/\.delete\(/.test(code));
}
ok('⭐ (b) Flota da de baja con guardarUnidad({ …, activo: false })', /guardarUnidad\(\s*\{[^}]*\bactivo:\s*false/.test(flota));
ok('(b) * y la reactiva con activo: true', /guardarUnidad\(\s*\{[^}]*\bactivo:\s*true/.test(flota));
// M4 (mesa de maquinaria D7): reactivar manda lo que dice la regla (vinculada → su marca a null, vuelve a
// mandar inspección; del sitio → conserva su marca) y avisa con el mismo resultado.
ok('⭐ (b) M4 reactivar usa cambioAlReactivar y avisa con avisoAlReactivar (D7)',
  /guardarUnidad\(\{ id: u\.id, \.\.\.cambioAlReactivar\(u\) \}\)/.test(flota) && /avisoAlReactivar\(u\)/.test(flota)
  && /import \{[^}]*\bavisoAlReactivar\b[^}]*\bcambioAlReactivar\b[^}]*\} from '\.\.\/\.\.\/lib\/centroOperacionesMaquinariaBloques'/.test(flota));
// Lote 6 B12: el aviso de D7 («su último estado: …», ~130 letras) no cabe en un toast de 3,5 s: dura 8 s.
ok('⭐ (b) B12 el aviso al reactivar una del sitio («su último estado») se queda 8 s; los demás, lo normal',
  /const DURACION_AVISO_LARGO_MS = 8000;/.test(flota) && /\/su último estado\/\.test\(aviso\) \? DURACION_AVISO_LARGO_MS : undefined/.test(flota)
  && /toast\.success\(exito, duracionMs\)/.test(flota));
ok('(b) M4 * 🚛 Flota no muestra ni cambia el estado (un solo lugar: el Parte diario)', !/\bencendida\b|guardarMarcaUnidad|soltarMarcaUnidad|guardarNotaMarca/.test(flota));
ok('⭐ (b) Ajustes desactiva un sitio con guardarSitio({ …, activo: false })', /guardarSitio\(\s*\{[^}]*\bactivo:\s*false/.test(ajustes));
ok('(b) * y lo reactiva con activo: true', /guardarSitio\(\s*\{[^}]*\bactivo:\s*true/.test(ajustes));
ok('⭐ (b) Ajustes desactiva un nombre de lista con guardarItemLista({ …, activo: false })', /guardarItemLista\(\s*\{[^}]*\bactivo:\s*false/.test(ajustes));
ok('(b) * y lo reactiva con activo: true', /guardarItemLista\(\s*\{[^}]*\bactivo:\s*true/.test(ajustes));

// ── (c) 🚛 FLOTA: DEL CATÁLOGO, PROPIA Y ACTUALIZAR ──────────────────────
{
  const delDb = importadosDe(flota, DB);
  for (const f of ['cargarUnidades', 'guardarUnidad', 'sugerenciasDelSistema']) {
    ok(`(c) Flota importa ${f} de centroOperacionesDb`, delDb.includes(f), delDb.join(', '));
  }
  ok('⭐ (c) Flota ofrece «➕ Del catálogo»', flota.includes('➕ Del catálogo'));
  ok('⭐ (c) Flota ofrece «➕ Propia»', flota.includes('➕ Propia'));
  ok('⭐ (c) Flota ofrece «🔄 Actualizar desde el catálogo»', flota.includes('🔄 Actualizar desde el catálogo'));
  ok('(c) el catálogo sale de sugerenciasDelSistema().maquinas', /sugerenciasDelSistema\(\)/.test(flota) && /\.maquinas\b/.test(flota));
  // El buscador mira código, placa, serial y empresa en la MISMA comparación.
  const lineaBuscador = flota.split('\n').find((l) => ['.codigo', '.placa', '.serial', '.empresa'].every((t) => l.includes(t)));
  ok('⭐ (c) el buscador del catálogo compara código, placa, serial y empresa juntos', !!lineaBuscador);
  ok('(c) * normalizando el texto (sin tildes ni mayúsculas) con norm', /\bnorm\(/.test(flota) && importadosDe(flota, '../../lib/text').includes('norm'));
  ok("(c) la unidad del catálogo se guarda con origen 'catalogo' y su machineryId", /origen:\s*'catalogo'/.test(flota) && /machineryId:/.test(flota));
  ok("(c) la propia se guarda con origen 'propia'", /origen:\s*'propia'/.test(flota));
  // Todos los campos de 7.2 viajan en el formulario.
  for (const campo of ['codigo', 'descripcion', 'placa', 'serial', 'marca', 'modelo', 'dueno', 'capacidadM3', 'nota']) {
    ok(`(c) el formulario lleva ${campo}`, new RegExp(`\\b${campo}:`).test(flota));
  }
  // A7/B11 (lote 2): la capacidad se lee con LA regla de ✍️ Cargar (cifraDeCampo, que lee con
  // numeroDeCampo: punto o coma) y tiene que ser MAYOR que cero, como exige la base.
  ok('⭐ (c) A7: la capacidad se lee con cifraDeCampo(…, { mayorQueCero: true }) (la regla de Cargar)',
    /cifraDeCampo\([^)]*\{\s*mayorQueCero:\s*true\s*\}\s*\)/.test(flota)
    && importadosDe(flota, '../../lib/centroOperacionesCarga').includes('cifraDeCampo'), importadosDe(flota, '../../lib/centroOperacionesCarga').join(', '));
  ok('(c) A7: …y su error («Tiene que ser mayor que cero») frena el guardado y se ve junto al campo',
    /capLeida\.error/.test(flota) && /⚠️ \$\{capLeida\.error\}/.test(flota));
  ok('(c) * y junto al campo se muestra la cifra leída (es-VE)', /toLocaleString\(\s*'es-VE'/.test(flota));
  // A8 (lote 2): reactivar también revisa la placa repetida (con la misma función que guardar).
  {
    const cuerpo = (nombre) => {
      const i = flota.search(new RegExp(`const ${nombre} = `));
      if (i < 0) return '';
      const j = flota.slice(i + 1).search(/\n  const \w+ = /);
      return j < 0 ? flota.slice(i) : flota.slice(i, i + 1 + j);
    };
    ok('⭐ (c) A8: reactivar revisa la placa repetida entre las activas (otraActivaConPlaca)', /otraActivaConPlaca\(/.test(cuerpo('reactivar')), cuerpo('reactivar').slice(0, 120));
    ok('(c) A8: …y guardar usa la misma función', /otraActivaConPlaca\(/.test(cuerpo('guardar')));
    ok('(c) A8: viene de la librería de la carga', importadosDe(flota, '../../lib/centroOperacionesCarga').includes('otraActivaConPlaca'));
  }
  ok('(c) la flota se filtra por texto', /placeholder=\{?['"`][^'"`]*(Filtrar|Buscar)/.test(flota));
  ok('(c) en el buscador, la máquina que ya está en la flota activa se marca y no se repite', flota.includes('ya en la flota'));
  // A3 (lote 2): la placa repetida se compara con LA regla de la librería, no con una propia.
  ok('⭐ (c) A3: Flota no tiene su propia regla de placa (no define clavePlaca ni normaliza placas a mano)',
    !/(const|function)\s+clavePlaca\b/.test(flota) && !/replace\(\/\[\^a-z0-9/.test(flota));
  {
    const deLib = [...importadosDe(flota, '../../lib/centroOperaciones'), ...importadosDe(flota, '../../lib/centroOperacionesCarga')];
    ok('⭐ (c) A3: …compara placas con la librería (clavePlaca u otraActivaConPlaca, que la usa)',
      deLib.some((n) => n === 'clavePlaca' || n === 'otraActivaConPlaca') && /(clavePlaca|otraActivaConPlaca)\(/.test(flota), deLib.join(', '));
  }
}

// ── (d) ⚙️ AJUSTES: SITIOS, LISTAS Y TEXTOS FIJOS ─────────────────────────
{
  const delDb = importadosDe(ajustes, DB);
  for (const f of ['cargarSitios', 'guardarSitio', 'cargarListas', 'guardarItemLista', 'cargarAjustes', 'guardarAjuste']) {
    ok(`(d) Ajustes importa ${f} de centroOperacionesDb`, delDb.includes(f), delDb.join(', '));
  }
  for (const clase of ['transportista', 'origen', 'destino', 'material', 'terraza']) {
    ok(`(d) Ajustes lleva la lista «${clase}»`, ajustes.includes(`'${clase}'`));
  }
  for (const clave of ['presentacion', 'consideraciones', 'titulo_consolidado', 'titulo_corte', 'logos']) {
    ok(`⭐ (d) Ajustes guarda el texto fijo «${clave}»`, ajustes.includes(`'${clave}'`));
  }
  ok('⭐ (d) los ajustes se guardan en el SITIO (guardarAjuste(sitio.id, …))', /guardarAjuste\(\s*sitio\.id\s*,/.test(ajustes));
  ok('(d) * y se leen del sitio (cargarAjustes(sitio.id))', /cargarAjustes\(\s*sitio\.id\s*\)/.test(ajustes));
  // A6 (lote 2): la lectura de los textos fijos y de los logos vive UNA vez, en la librería
  // de los papeles (la que también usará 📄 Reportes), con UN defecto: el de los papeles.
  ok('⭐ (d) A6: Ajustes lee textos y logos con textosDe / logosDe de la librería de los papeles',
    ['textosDe', 'logosDe'].every((f) => importadosDe(ajustes, '../../lib/centroOperacionesPapel').includes(f)),
    importadosDe(ajustes, '../../lib/centroOperacionesPapel').join(', '));
  ok('⭐ (d) A6: Ajustes ya no tiene su propia copia (ni LOGOS_POR_DEFECTO, ni logosDe, ni textosDe)',
    !/LOGOS_POR_DEFECTO|function\s+(logosDe|textosDe)\b|const\s+(logosDe|textosDe)\s*=/.test(ajustes));
  {
    let P = {};
    try { P = loadTs(path.join(ROOT, 'src/lib/centroOperacionesPapel.ts')); } catch (e) { ok('(d) A6: la librería de los papeles carga', false, String(e?.message ?? e)); }
    const intenta = (f) => { try { return f(); } catch (e) { return `ERROR: ${e?.message ?? e}`; } };
    const SOLO_GOLDEN = { golden: true, bcv: false, sos: false, renace: false, jhenzaen: false };
    const canon = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, canon(o[k])])) : o);
    const igual = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
    ok('⭐ (d) logos por defecto: solo Golden Touch (logosDe sin nada guardado)', igual(intenta(() => P.logosDe(undefined)), SOLO_GOLDEN), JSON.stringify(intenta(() => P.logosDe(undefined))));
    ok('(d) A6: …y es el MISMO defecto de los papeles', igual(intenta(() => P.logosDe(null)), P.OPCIONES_PAPEL_POR_DEFECTO?.logos));
    ok('⭐ (d) A6: un «false» guardado NO vuelve al defecto (Golden apagado se queda apagado)',
      igual(intenta(() => P.logosDe({ golden: false, bcv: true })), { ...SOLO_GOLDEN, golden: false, bcv: true }));
    ok('(d) A6: lo que no es sí/no toma el defecto (texto, lista)',
      igual(intenta(() => P.logosDe({ golden: 'si', sos: 1 })), SOLO_GOLDEN) && igual(intenta(() => P.logosDe([true])), SOLO_GOLDEN));
    const t = intenta(() => P.textosDe({ presentacion: 'Hola <b>', titulo_corte: 5, logos: { sos: true } }));
    ok('⭐ (d) A6: textosDe: los textos guardados; lo que no es texto sale vacío; los logos saneados',
      igual(t, { presentacion: 'Hola <b>', titulo_corte: '', titulo_consolidado: '', consideraciones: '', logos: { ...SOLO_GOLDEN, sos: true } }), JSON.stringify(t));
    ok('(d) A6: textosDe sin ajustes (null) no revienta', igual(intenta(() => P.textosDe(null)),
      { presentacion: '', titulo_corte: '', titulo_consolidado: '', consideraciones: '', logos: SOLO_GOLDEN }));
  }
  ok('(d) crear un sitio manda el nombre (guardarSitio({ nombre … }))', /guardarSitio\(\s*\{[^}]*\bnombre\b/.test(ajustes));
  ok('(d) renombrar manda el id del sitio', /guardarSitio\(\s*\{\s*id:/.test(ajustes));
  ok('(d) al cambiar un sitio avisa a la pantalla (alCambiarSitios)', /alCambiarSitios\??\.?\(/.test(ajustes));
  ok('(d) un nombre nuevo de lista dice de qué sitio es (o null = todos)', /guardarItemLista\(\s*\{[^}]*\bsitioId:/.test(ajustes));
  ok('(d) se abre también SIN sitio (crear el primero)', /sitio\s*\?|!sitio\b|sitio\s*===\s*null/.test(ajustes));
}

// ── (e) SOLO FULL CAMBIA; AVISOS POR TOAST; A→Z ──────────────────────────
for (const [r, code] of pestanas) {
  const n = path.basename(r);
  ok(`⭐ (e) ${n} decide los botones con el nivel 'full'`, /levelMeets\(\s*nivel\s*,\s*'full'\s*\)|nivel\s*===\s*'full'/.test(code));
  ok(`(e) ${n} avisa con useToast`, /useToast\(\)/.test(code) && /from\s+['"]\.\.\/ToastProvider['"]/.test(code));
  ok(`(e) ${n} muestra el error de la capa de datos (e.message)`, /e\??\.message/.test(code));
  ok(`(e) ${n} ordena A→Z con cmpText`, /\.sort\([^\n]*cmpText\(/.test(code) && importadosDe(code, '../../lib/text').includes('cmpText'));
  ok(`(e) ${n} usa el tema (useTheme)`, /useTheme\(\)/.test(code));
  ok(`(e) ${n} refresca al enfocarse (useFocusEffect)`, /useFocusEffect\(/.test(code));
  ok(`(e) ${n} pide confirmación antes de desactivar (useConfirm)`, /useConfirm\(\)/.test(code) && /from\s+['"]\.\.\/ConfirmProvider['"]/.test(code));
}

// ── R3 (lote 2): SI LA CARGA FALLA, SE DICE (NO UN «VACÍO» FALSO) ────────
for (const [r, code] of pestanas) {
  const n = path.basename(r);
  ok(`⭐ R3 ${n} guarda el error de la carga en un estado (como Registros)`, /const \[error, setError\] = useState/.test(code) && /setError\(/.test(code));
  ok(`R3 ${n} lo muestra: «No se pudo cargar … (desliza o vuelve a entrar)»`, /No se pud[\s\S]{0,200}desliza/i.test(code));
}
// La condición que pinta el «vacío» va DESPUÉS de una que pregunta por el error.
const conErrorAntes = (code, vacio) => new RegExp(`error(?:\\s*&&[^?]{0,80})?\\s*\\?[\\s\\S]{0,300}:\\s*${vacio}\\s*\\?`).test(code);
ok('⭐ R3 Flota: con error, NO dice «Todavía no hay unidades» (invitaría a crearlas de nuevo)', conErrorAntes(flota, 'unidades\\.length === 0'));
ok('⭐ R3 Ajustes: con error, NO dice «Todavía no hay sitios»', conErrorAntes(ajustes, 'sitiosOrdenados\\.length === 0'));
ok('R3 Ajustes: con error, NO dice «La lista está vacía»', conErrorAntes(ajustes, 'activosClase\\.length === 0'));

// ── (f) LA PANTALLA MONTA LAS DOS PESTAÑAS Y CARGA LOS SITIOS ────────────
{
  ok('⭐ (f) la pantalla ya no tiene el TODO de la tarea 6', pantalla !== '' && !leer(PANTALLA).includes('TODO Task 6'));
  ok('⭐ (f) la pantalla carga los sitios con cargarSitios()', /await\s+cargarSitios\(\)/.test(pantalla)
    && importadosDe(pantalla, '../lib/centroOperacionesDb').includes('cargarSitios'));
  ok('(f) importa AjustesTab de su archivo', /import\s+AjustesTab\s+from\s+['"]\.\.\/components\/centroOperaciones\/AjustesTab['"]/.test(pantalla));
  ok('(f) importa FlotaTab de su archivo', /import\s+FlotaTab\s+from\s+['"]\.\.\/components\/centroOperaciones\/FlotaTab['"]/.test(pantalla));
  ok('(f) ya no define sus marcadores de Flota ni de Ajustes', !/function\s+(FlotaTab|AjustesTab)\s*\(/.test(pantalla));
  ok('(f) monta <FlotaTab y <AjustesTab', /<FlotaTab\b/.test(pantalla) && /<AjustesTab\b/.test(pantalla));
  ok('(f) Ajustes le avisa a la pantalla que recargue los sitios', /<AjustesTab\b[^>]*alCambiarSitios=\{recargar\}/.test(pantalla));
  {
    const montajes = pantalla.match(/<AjustesTab\b[^>]*>/g) ?? [];
    ok('(f) * en TODOS sus montajes (con y sin sitio)', montajes.length >= 2 && montajes.every((t) => t.includes('alCambiarSitios={recargar}')),
      `${montajes.length} montaje(s)`);
  }
  // B2 (lote 2): al cambiar de sitio, Flota y Ajustes se vuelven a montar (key = el sitio):
  // nunca muestran ni tocan los datos del sitio anterior, y un texto sin guardar del sitio A
  // no puede terminar guardado en el sitio B.
  {
    const flotas = pantalla.match(/<FlotaTab\b[^>]*>/g) ?? [];
    const ajustesConSitio = (pantalla.match(/<AjustesTab\b[^>]*>/g) ?? []).filter((t) => /sitio=\{sitio\}/.test(t));
    ok('⭐ (f) B2: <FlotaTab> se monta con key={sitio.id}', flotas.length > 0 && flotas.every((t) => /key=\{sitio\.id\}/.test(t)), flotas.join(' | '));
    ok('⭐ (f) B2: <AjustesTab> con sitio se monta con key={sitio.id}', ajustesConSitio.length > 0 && ajustesConSitio.every((t) => /key=\{sitio\.id\}/.test(t)), ajustesConSitio.join(' | '));
    ok('(f) B2: Flota ya no necesita el parche «sitioAbierto»', !/sitioAbierto/.test(flota));
    const guardarTextos = (() => {
      const i = ajustes.indexOf('const guardarTextos = ');
      if (i < 0) return '';
      const j = ajustes.slice(i + 1).search(/\n  const \w+ = |\n  \/\/ ═/);
      return j < 0 ? ajustes.slice(i) : ajustes.slice(i, i + 1 + j);
    })();
    ok('(f) B2: Ajustes guarda los textos solo si el formulario es de ESTE sitio', /textosDelSitio\.current\s*!==\s*sitio\.id/.test(guardarTextos), guardarTextos.slice(0, 160));
    // B4 (lote 2): los textos se guardan uno por uno; si uno falla, se dice cuáles quedaron
    // y se vuelve a leer lo guardado (así el botón reintenta solo lo que falta).
    const catchT = /catch\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/.exec(guardarTextos)?.[1] ?? '';
    ok('⭐ (f) B4: si un texto falla, se vuelve a leer lo guardado (cargar() en el catch)', /\bcargar\(\)/.test(catchT), catchT.trim().slice(0, 160));
    ok('(f) B4: …y el aviso dice cuáles sí quedaron', /Se guardaron/.test(catchT));
  }
  ok('(f) el selector es de los sitios ACTIVOS', /\.filter\(\(s\)\s*=>\s*s\.activo\)/.test(pantalla));
  ok('(f) * y se esconde con uno solo', /sitios\.length\s*>\s*1/.test(pantalla));
  ok('(f) sin sitios: Full ve «Crea el primer sitio» y Lectura «Todavía no hay sitios»',
    pantalla.includes('Crea el primer sitio') && pantalla.includes('Todavía no hay sitios'));
  ok('(f) refresca al enfocarse', /useFocusEffect\(/.test(pantalla));
}

// ── Lote 5 (F1a): A8, B16 y B17 en ⚙️ Ajustes ─────────────────────────────
{
  // A8: el mismo nombre «para todos» y del sitio: manda el del sitio (itemDeLista). La ayuda
  // ya no pide algo que Ajustes no deja hacer (crear en el sitio un nombre que ya está).
  ok('⭐ L5-A8 la ayuda del destino «de todos» ya no dice solo «crea el destino en cada sitio»',
    !/si cada sitio queda a otra distancia, crea el destino en cada sitio/.test(ajustes));
  ok('L5-A8 * dice que se desactive el de todos y se cree uno en cada sitio (con sus km)', /desactívalo y crea el destino en cada sitio/.test(ajustes));
  ok('L5-A8 * y que el del sitio manda sobre el de todos', /en ese sitio manda el suyo/.test(ajustes));
  // B16: el factor y los días explicados como funcionan.
  ok('⭐ L5-B16 «sin factor» ya no dice que no convierte (en agregados se usa 1,2)',
    !/no convierte m³/.test(ajustes) && !/sin factor, solo t ↔ kg/.test(ajustes) && /se usa 1,2/.test(ajustes));
  ok('L5-B16 * el placeholder del factor tampoco dice «vacío = sin factor»', !/vacío = sin factor/.test(ajustes));
  ok('⭐ L5-B16 los días se explican: solo para el material de los bloques', /solo para el material de los bloques/.test(ajustes));
  ok('L5-B16 * y la lista marca cuál es el material de los bloques (materialDeBloques, la regla de 🧱 Bloques)',
    importadosDe(ajustes, '../../lib/centroOperacionesMaquinariaBloques').includes('materialDeBloques') && /🧱 material de los bloques/.test(ajustes));
  // B17: pegar «lat, lng» en cualquiera de los dos campos los reparte (sitio y destino).
  ok('⭐ L5-B17 Ajustes reparte el par pegado con parDeCoordenadas (de la librería de carga)',
    importadosDe(ajustes, '../../lib/centroOperacionesCarga').includes('parDeCoordenadas'));
  ok('L5-B17 * en los cuatro campos de GPS (lat y lng del sitio y del destino)', (ajustes.match(/coordEscrita\('(lat|lng)', v\)/g) || []).length === 4);
  ok('L5-B17 * y se dice que se puede pegar como lo copia Google Maps', /como las copia Google Maps/.test(ajustes));
}
// El comentario del tipo tampoco miente (B16): «Sin factor = no convierte m³» era falso en agregados.
ok('L5-B16 el comentario de ItemLista.factorTM3 ya no dice «Sin factor = no convierte m³»', !/Sin factor = no convierte m³/.test(leer('src/lib/centroOperaciones.ts')));

console.log(`${fail === 0 ? '✅' : '❌'} test-centro-operaciones-ajustes-flota · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Ajustes y Flota solo hablan con la capa de datos, desactivan en vez de borrar y solo Full cambia algo.');
