/*
 * VEHÍCULO EN LA NOTA DE TRASLADO (09-sep-2026).
 *
 * Pedido del cliente: «para inventario, las salidas, se le agregó la opción de
 * vehículos, necesito que a notas de traslados también, para poder seleccionar un
 * vehículo al cual asignarlo».
 *
 * La pestaña Traslado movía material de una MÁQUINA o PERSONA a otra. Los
 * vehículos viven en `vehicles` (la pestaña Vehículos del Catálogo de equipos),
 * que es OTRA tabla, así que no había forma de trasladarle material a una
 * camioneta. Ahora hay un 🚗 Vehículo en el origen y otro en el destino.
 *
 * Lo que fijan estos casos:
 *   - `ladoTrasladoEnPalabras`: la máquina le sigue ganando a la persona (como
 *     antes), pero el vehículo SE SUMA en vez de competir — material montado en
 *     una camioneta es las dos cosas y ocultar una miente;
 *   - que el vehículo llegue a los TRES sitios: el PDF (fila "Vehículo:"), el
 *     texto del movimiento (`origen → destino`) y las cuatro columnas nuevas;
 *   - que la fila "Vehículo:" del PDF NO aparezca cuando no hay vehículo, para
 *     que las notas de siempre salgan idénticas;
 *   - que si la base todavía no tiene esas columnas el traslado se guarde igual,
 *     reintentando sin ellas, y que el reintento NO se dispare por un error de
 *     `to_company_name`, que es otra columna que también puede faltar;
 *   - que cada 🚗 esté DEBAJO de su 🚜 y que ambos lados se limpien al generar;
 *   - y que el tipo y los dos manuales cuenten la misma historia.
 *
 * Los guardas sobre la pantalla están anclados al argumento y al orden, no a la
 * mera presencia de un nombre: cambiar `toVehId` por `fromVehId` en un solo sitio,
 * o mover un apartado, tiene que hacer fallar esto.
 *
 *   node scripts/test-inventario-traslado-vehiculo.mjs
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
// Quita comentarios /* */ y // (sin tocar las URLs con "://") para que un guarda
// no se dé por satisfecho con código comentado.
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const bloque = (s, desde, hasta) => { const i = s.indexOf(desde); const j = s.indexOf(hasta, i + 1); if (i < 0 || j < 0) throw new Error(`no encuentro el bloque ${desde}…${hasta}`); return s.slice(i, j); };

const { ladoTrasladoEnPalabras, PASOS_SIN_MIGRACION_TRASLADO, quitarColumnasFila, etiquetaVehiculo } =
  cargar('src/lib/salidaVehiculo.ts');
const { notaTrasladoHtml } = cargar('src/lib/notaTraslado.ts', {
  './logoData': { LOGO_DATA_URI: 'data:,logo' },
  './company': { COMPANY_NAME: 'EMPRESA DE PRUEBA' },
});

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? `  → ${extra}` : '')); }
};

console.log('INVENTARIO — vehículo en la nota de traslado\n');

// ── 1) Un lado del traslado, en una línea ───────────────────────────────────
{
  const L = ladoTrasladoEnPalabras;
  ok('solo máquina', L('EXC-01', '', '') === 'EXC-01');
  ok('solo vehículo', L('', 'CAMIONETA · Placa AB123CD', '') === 'CAMIONETA · Placa AB123CD');
  ok('solo persona', L('', '', 'JUAN PÉREZ') === 'JUAN PÉREZ');
  ok('nada elegido devuelve cadena vacía', L('', '', '') === '');
  ok('nulos y undefined no rompen', L(null, undefined, null) === '');

  // La regla de siempre: la máquina le gana a la persona.
  ok('la máquina le gana a la persona', L('EXC-01', '', 'JUAN PÉREZ') === 'EXC-01');
  // La regla nueva: el vehículo se SUMA, no compite.
  ok('máquina + vehículo se muestran los dos', L('EXC-01', 'CAMIONETA', '') === 'EXC-01 · CAMIONETA');
  ok('máquina + vehículo + persona: manda la máquina y suma el vehículo', L('EXC-01', 'CAMIONETA', 'JUAN') === 'EXC-01 · CAMIONETA');
  ok('persona + vehículo se muestran los dos', L('', 'CAMIONETA', 'JUAN') === 'JUAN · CAMIONETA');

  ok('recorta los espacios sobrantes', L('  EXC-01  ', '  CAMIONETA  ', '') === 'EXC-01 · CAMIONETA');
  ok('un vehículo en blanco no deja el separador colgando', L('EXC-01', '   ', '') === 'EXC-01');
  ok('el separador es " · " y va una sola vez', (L('A', 'B', '').match(/ · /g) || []).length === 1);

  // Sin vehículo el resultado es EXACTAMENTE el de antes: nada de lo viejo cambia.
  const comoAntes = (maq, per) => (maq || per || '');
  for (const [maq, per] of [['EXC-01', 'JUAN'], ['EXC-01', ''], ['', 'JUAN'], ['', '']]) {
    ok(`sin vehículo se comporta como antes (${maq || '—'}/${per || '—'})`, L(maq, '', per) === comoAntes(maq, per));
  }
}

// ── 2) Reintento cuando faltan las columnas nuevas ──────────────────────────
{
  const pasos = PASOS_SIN_MIGRACION_TRASLADO;
  ok('hay exactamente un paso', Array.isArray(pasos) && pasos.length === 1);
  const p = pasos[0];
  ok('cubre las CUATRO columnas', JSON.stringify(p.columnas) === JSON.stringify(['from_vehicle_id', 'from_vehicle_label', 'to_vehicle_id', 'to_vehicle_label']));
  ok('el archivo dice que está fuera del repo', /fuera del repo/.test(p.archivo));

  // PostgREST avisa nombrando la columna.
  ok('reconoce el error de from_vehicle_id', p.detecta.test("Could not find the 'from_vehicle_id' column of 'inventory_transfers' in the schema cache"));
  ok('reconoce el error de to_vehicle_label', p.detecta.test("Could not find the 'to_vehicle_label' column of 'inventory_transfers' in the schema cache"));
  // Y lo que NO debe disparar el reintento.
  ok('NO se dispara con to_company_name, que es otra columna que puede faltar', !p.detecta.test("Could not find the 'to_company_name' column of 'inventory_transfers' in the schema cache"));
  ok('NO se dispara con un error de permisos', !p.detecta.test('new row violates row-level security policy for table "inventory_transfers"'));
  ok('NO se dispara con un error de red', !p.detecta.test('Failed to fetch'));

  // Quitar columnas de UNA fila (el traslado guarda un solo encabezado).
  const fila = { company_id: 'c1', from_vehicle_id: 'v1', from_vehicle_label: 'CAMIONETA', to_vehicle_id: null, to_vehicle_label: null, motivo: 'PRUEBA' };
  const limpia = quitarColumnasFila(fila, p.columnas);
  ok('quitarColumnasFila deja solo lo que no se quita', JSON.stringify(limpia) === JSON.stringify({ company_id: 'c1', motivo: 'PRUEBA' }));
  ok('no toca el objeto original', 'from_vehicle_id' in fila);
  ok('quitar una lista vacía no cambia nada', JSON.stringify(quitarColumnasFila(fila, [])) === JSON.stringify(fila));
  ok('sobre un objeto vacío devuelve un objeto vacío', JSON.stringify(quitarColumnasFila({}, p.columnas)) === '{}');
}

// ── 3) El PDF de la nota de traslado ────────────────────────────────────────
{
  const base = { fecha: '09/09/2026', items: [{ name: 'CASCO', qty: 2, unit: 'und' }] };
  const con = notaTrasladoHtml({ ...base, fromMaquina: 'EXC-01', fromVehiculo: 'CAMIONETA · Placa AB123CD', toMaquina: 'GRUA-02', toVehiculo: 'CHUTO · Placa XY987ZW' });
  ok('el PDF trae la fila Vehículo del origen', /<b>Vehículo:<\/b> CAMIONETA · Placa AB123CD/.test(con));
  ok('el PDF trae la fila Vehículo del destino', /<b>Vehículo:<\/b> CHUTO · Placa XY987ZW/.test(con));
  ok('cada lado muestra su vehículo, no el del otro', con.indexOf('CAMIONETA · Placa AB123CD') < con.indexOf('CHUTO · Placa XY987ZW'));
  ok('el vehículo va DEBAJO de la máquina en cada caja', con.indexOf('EXC-01') < con.indexOf('CAMIONETA · Placa AB123CD'));

  // Sin vehículo la nota tiene que salir EXACTAMENTE como salía antes.
  const sin = notaTrasladoHtml({ ...base, fromMaquina: 'EXC-01', toMaquina: 'GRUA-02' });
  ok('sin vehículo NO aparece la fila Vehículo', !/<b>Vehículo:<\/b>/.test(sin));
  ok('sin vehículo siguen las dos filas Máquina', (sin.match(/<b>Máquina:<\/b>/g) || []).length === 2);
  ok('una cadena vacía tampoco pinta la fila', !/<b>Vehículo:<\/b>/.test(notaTrasladoHtml({ ...base, fromVehiculo: '', toVehiculo: '' })));

  // El vehículo se escapa como todo lo demás (viene de un campo que escribe el usuario).
  const malo = notaTrasladoHtml({ ...base, toVehiculo: '<script>alert(1)</script>' });
  ok('el vehículo se escapa en el PDF', !/<script>alert/.test(malo) && /&lt;script&gt;/.test(malo));
}

// ── 4) La pantalla: los dos apartados y el dato a los tres lados ────────────
{
  const scr = leer('src/screens/InventarioScreen.tsx');
  const trCrudo = bloque(scr, 'function TrasladoTab(', '\nfunction GastosTab(');
  const tr = sinComentarios(trCrudo);

  ok('TrasladoTab carga los vehículos de la tabla vehicles', /const \{ data: vehicles \} = useTable<Vehicle>\('vehicles', \{ orderBy: 'plate' \}\)/.test(tr));
  ok('…y las empresas, para poder nombrarlos igual que en la salida', /const \{ data: companies \} = useTable<Company>\('companies', \{ orderBy: 'name' \}\)/.test(tr));
  ok('el nombre del vehículo sale de la librería, con su empresa', /const vehName = \(id: string\) => \{ const v = vehicles\.find\(\(x\) => x\.id === id\); return v \? etiquetaVehiculo\(v, companyNameById\(v\.company_id \?\? null\)\) : ''; \}/.test(tr));

  // Hay DOS estados distintos, uno por lado.
  ok('estado del vehículo de origen', /const \[fromVehId, setFromVehId\] = useState\(''\);/.test(tr));
  ok('estado del vehículo de destino', /const \[toVehId, setToVehId\] = useState\(''\);/.test(tr));

  // El selector puede filtrar por texto oculto (marca, modelo, encargado).
  ok('las opciones aceptan un texto de búsqueda aparte', /options: \{ id: string; text: string; busca\?: string \}\[\];/.test(tr));
  ok('el filtro usa busca cuando la hay', /norm\(o\.busca \?\? o\.text\)\.includes\(s\)/.test(tr));
  ok('vehOptions arma texto visible y texto buscable', /text: etiquetaVehiculo\(v, empresa\), busca: textoBusquedaVehiculo\(v, empresa\)/.test(tr));
  ok('vehOptions se recalcula si cambian vehículos o empresas', /\}\), \[vehicles, companies\]\);/.test(tr));

  // Validación: el vehículo vale por sí solo en los dos lados.
  ok('el vehículo sirve como origen', /if \(!fromMachId && !fromVehId && !fromEmpId\) return toast\.error\('Indica el origen \(máquina, vehículo o empleado\)\.'\);/.test(tr));
  ok('el vehículo sirve como destino', /if \(!toMachId && !toVehId && !toEmpId && !toEmpresaLibre\.trim\(\) && !toPersonaLibre\.trim\(\)\)/.test(tr));

  // A los tres lados: PDF, texto del movimiento, columnas.
  ok('PDF: fromVehiculo sale del vehículo de ORIGEN', /fromVehiculo: fromVehId \? vehName\(fromVehId\) : null,/.test(tr));
  ok('PDF: toVehiculo sale del vehículo de DESTINO', /toVehiculo: toVehId \? vehName\(toVehId\) : null,/.test(tr));
  ok('texto: el destino se arma con ladoTrasladoEnPalabras', /const destinoTxt = ladoTrasladoEnPalabras\(toMachId \? machName\(toMachId\) : '', toVehId \? vehName\(toVehId\) : '', toEmpId \? empNameById\(toEmpId\) : ''\)/.test(tr));
  ok('texto: el origen también', /const origenTxt = ladoTrasladoEnPalabras\(fromMachId \? machName\(fromMachId\) : '', fromVehId \? vehName\(fromVehId\) : '', fromEmpId \? empNameById\(fromEmpId\) : ''\) \|\| '—';/.test(tr));
  ok('texto: el motivo se arma origen → destino', /const detalle = `\$\{origenTxt\} → \$\{destinoTxt\}`;/.test(tr));
  ok('columnas: las dos del origen', /from_vehicle_id: fromVehId \|\| null, from_vehicle_label: fromVehId \? vehName\(fromVehId\) : null,/.test(tr));
  ok('columnas: las dos del destino', /to_vehicle_id: toVehId \|\| null, to_vehicle_label: toVehId \? vehName\(toVehId\) : null,/.test(tr));

  // El reintento: en bucle, sobre la lista de la librería, y solo si la columna iba.
  ok('el insert reintenta con PASOS_SIN_MIGRACION_TRASLADO', /for \(const paso of PASOS_SIN_MIGRACION_TRASLADO\) \{\s*if \(!tErr \|\| !paso\.columnas\.some\(\(c\) => c in fila\) \|\| !paso\.detecta\.test\(tErr\.message\)\) break;\s*fila = quitarColumnasFila\(fila, paso\.columnas\);\s*\(\{ error: tErr \} = await supabase\.from\('inventory_transfers'\)\.insert\(fila\)\);\s*\}/.test(tr));
  ok('sigue cortando si el insert salió bien', /if \(!tErr \|\|/.test(tr));

  // Los apartados: cada 🚗 debajo de su 🚜.
  const iMaqO = tr.indexOf('label="Máquina origen"'), iVehO = tr.indexOf('label="Vehículo origen"');
  const iMaqD = tr.indexOf('label="Máquina destino"'), iVehD = tr.indexOf('label="Vehículo destino"');
  ok('existe el 🚗 Vehículo origen', iVehO > 0);
  ok('existe el 🚗 Vehículo destino', iVehD > 0);
  ok('el de origen va DEBAJO de la máquina origen', iMaqO > 0 && iMaqO < iVehO, `maq=${iMaqO} veh=${iVehO}`);
  ok('el de destino va DEBAJO de la máquina destino', iMaqD > 0 && iMaqD < iVehD, `maq=${iMaqD} veh=${iVehD}`);
  ok('el de origen va ANTES que todo el bloque de destino', iVehO < iMaqD, `vehO=${iVehO} maqD=${iMaqD}`);
  ok('cada selector recibe SU propio estado', /id="fromVeh".*valueId=\{fromVehId\}.*onPick=\{setFromVehId\}/.test(tr) && /id="toVeh".*valueId=\{toVehId\}.*onPick=\{setToVehId\}/.test(tr));
  ok('los dos selectores usan la misma lista de vehículos', (tr.match(/options=\{vehOptions\}/g) || []).length === 2);
  ok('los identificadores de apertura son distintos', /id="fromVeh"/.test(tr) && /id="toVeh"/.test(tr));

  // Al generar se limpian los dos.
  ok('al generar se limpia el vehículo de origen', /setFromVehId\(''\);/.test(tr));
  ok('al generar se limpia el vehículo de destino', /setToVehId\(''\);/.test(tr));

  // La lista de traslados realizados también lo muestra.
  ok('la lista muestra el vehículo del origen', /const from = ladoTrasladoEnPalabras\(t\.from_machinery_label, \(t as any\)\.from_vehicle_label, t\.from_employee_name\) \|\| '—';/.test(tr));
  ok('la lista muestra el vehículo del destino', /const to = ladoTrasladoEnPalabras\(t\.to_machinery_label, \(t as any\)\.to_vehicle_label, t\.to_employee_name\) \|\| \(t as any\)\.to_company_name \|\| '—';/.test(tr));

  // Nada de esto se coló en las demás pestañas.
  // Se recortan los bloques CRUDOS (con sus comentarios); recortar la versión ya
  // limpia no coincidiría con el archivo y dejaría las dos pestañas dentro.
  const nota = bloque(scr, 'function NotaTab(', '\nfunction TrasladoTab(');
  const resto = sinComentarios(scr.replace(trCrudo, '').replace(nota, ''));
  // Sin los `import` de la cabecera: ahí el nombre aparece por fuerza.
  const restoSinImports = resto.split('\n').filter((l) => !/^import /.test(l)).join('\n');
  ok('ninguna otra pestaña carga vehicles', !/useTable<Vehicle>/.test(restoSinImports));
  ok('ninguna otra pestaña usa ladoTrasladoEnPalabras', !/ladoTrasladoEnPalabras/.test(restoSinImports));
  ok('la pantalla importa lo nuevo de la librería', /ladoTrasladoEnPalabras, PASOS_SIN_MIGRACION, PASOS_SIN_MIGRACION_TRASLADO, quitarColumnas, quitarColumnasFila \} from '\.\.\/lib\/salidaVehiculo'/.test(scr));
}

// ── 5) Tipo, PDF y manuales ─────────────────────────────────────────────────
{
  const db = leer('src/types/database.ts');
  const it = bloque(db, 'export interface InventoryTransfer {', '\n}');
  ok('el tipo declara el vehículo de origen', /from_vehicle_id\?: string \| null;\s*\n\s*from_vehicle_label\?: string \| null;/.test(it));
  ok('el tipo declara el vehículo de destino', /to_vehicle_id\?: string \| null;\s*\n\s*to_vehicle_label\?: string \| null;/.test(it));
  ok('son opcionales, porque la migración puede no estar corrida', /from_vehicle_id\?:/.test(it) && /to_vehicle_id\?:/.test(it));

  const nt = leer('src/lib/notaTraslado.ts');
  ok('el tipo del PDF acepta el vehículo de origen', /fromVehiculo\?: string \| null;/.test(nt));
  ok('el tipo del PDF acepta el vehículo de destino', /toVehiculo\?: string \| null;/.test(nt));

  const md = leer('docs/MANUAL-USUARIO.md');
  ok('manual .md: el traslado ofrece el 🚗 vehículo', /🚗 vehículo/.test(md) && /Vehículo en el traslado \(09\/09\/2026\)/.test(md));
  ok('manual .md: avisa que el vínculo consultable necesita el SQL', /el traslado se guarda igual y el vehículo queda en el PDF/.test(md));

  const ms = leer('src/screens/ManualScreen.tsx');
  ok('manual en pantalla: el traslado ofrece el 🚗 vehículo', /Vehículo en el traslado \(09\/09\/2026\)/.test(ms));
  ok('manual en pantalla: avisa lo mismo del SQL', /el traslado se guarda igual y el vehículo queda en el PDF/.test(ms));
}

// ── 6) La librería no toca la base de datos ─────────────────────────────────
{
  const lib = sinComentarios(leer('src/lib/salidaVehiculo.ts'));
  ok('la librería es pura: no consulta ni escribe', !/from '\.\/supabase'|\.from\(|\.insert\(|\.update\(|\.delete\(/.test(lib));
  ok('y no trae datos reales de nadie', !/[0-9]{20}|cedula: '[0-9]/.test(lib));
}

if (fail) {
  console.log(`\n✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nLa nota de traslado deja elegir vehículo en el origen y en el destino, y el vehículo llega al PDF, al texto y a las cuatro columnas.`);
