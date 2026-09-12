/*
 * VEHÍCULO DESTINO EN LA NOTA DE SALIDA (07-sep-2026).
 *
 * Pedido del cliente: «si yo le quiero dar salida a un starlink… tengo entendido
 * que se le asigna a una persona o maquinaria, pero yo se la quiero asignar a un
 * vehículo». Y con la pantalla abierta: «en ese apartado no se están reflejando
 * los vehículos, solo las maquinarias, necesito que haya un apartado abajo que
 * sea de vehículos».
 *
 * La pestaña Salida solo ofrecía la tabla `machinery`. Los vehículos viven en
 * `vehicles` (la pestaña Vehículos del Catálogo de equipos), así que ni buscando
 * la placa aparecían. Ahora hay un apartado 🚗 Vehículo debajo del de Máquina.
 *
 * Lo que fijan estos casos:
 *   - cómo se nombra el vehículo (nombre → marca modelo → tipo → "Vehículo"),
 *     con el MISMO formato que la máquina: `NOMBRE · EMPRESA · Placa XXX`;
 *   - que el filtro busque por nombre, placa, marca, modelo, encargado, serial y empresa;
 *   - que el vehículo llegue a los TRES sitios: el PDF (línea "Vehículo:"), el texto
 *     del movimiento (`· VEHÍCULO: …`) y la columna `vehicle_id`;
 *   - que si la base todavía no tiene `vehicle_id` (SQL sin correr) la salida se
 *     registre igual, reintentando sin esa columna, y que un error de permisos
 *     NO dispare reintentos;
 *   - que el apartado esté DEBAJO de Máquina y ENCIMA de Recibe, y que se limpie
 *     al generar la nota;
 *   - y que el SQL, el tipo y los dos manuales cuenten la misma historia.
 *
 * Los guardas sobre la pantalla están anclados al argumento y al orden, no a la
 * mera presencia de un nombre: cambiar `vehicleId` por `machineryId` en un solo
 * sitio, o poner el apartado en otro lado, tiene que hacer fallar esto.
 *
 *   node scripts/test-inventario-salida-vehiculo.mjs
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

const { nombreVehiculo, etiquetaVehiculo, textoBusquedaVehiculo, detalleVehiculoNota, PASOS_SIN_MIGRACION, quitarColumnas } =
  cargar('src/lib/salidaVehiculo.ts');
const { notaEntregaHtml } = cargar('src/lib/notaEntrega.ts', {
  './logoData': { LOGO_DATA_URI: 'data:,logo' },
  './company': { COMPANY_NAME: 'EMPRESA DE PRUEBA' },
});

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? `  → ${extra}` : '')); }
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('INVENTARIO — vehículo destino en la nota de salida\n');

// ── 1) Cómo se nombra el vehículo ───────────────────────────────────────────
{
  ok('con nombre, manda el nombre', nombreVehiculo({ id: '1', name: 'CAMIONETA 1', brand: 'Toyota', model: 'Hilux' }) === 'CAMIONETA 1');
  ok('sin nombre: marca + modelo', nombreVehiculo({ id: '1', brand: 'Toyota', model: 'Hilux' }) === 'Toyota Hilux');
  ok('solo marca', nombreVehiculo({ id: '1', brand: 'Toyota' }) === 'Toyota');
  ok('solo modelo', nombreVehiculo({ id: '1', model: 'Hilux' }) === 'Hilux');
  ok('sin marca ni modelo: el tipo', nombreVehiculo({ id: '1', vehicle_type: 'Pick-up' }) === 'Pick-up');
  ok('sin nada: "Vehículo"', nombreVehiculo({ id: '1' }) === 'Vehículo');
  ok('un nombre en blanco no cuenta como nombre', nombreVehiculo({ id: '1', name: '   ', brand: 'Ford' }) === 'Ford');
  ok('nulos no revientan', nombreVehiculo({ id: '1', name: null, brand: null, model: null, vehicle_type: null }) === 'Vehículo');
}

// ── 2) La etiqueta completa: igual que la máquina ───────────────────────────
{
  const v = { id: '1', name: 'HILUX BLANCA', plate: 'A80AJ2F', serial: 'SER-9', company_id: 'c1' };
  ok('nombre · empresa · placa', etiquetaVehiculo(v, 'GOLDEN TOUCH 1127 CA') === 'HILUX BLANCA · GOLDEN TOUCH 1127 CA · Placa A80AJ2F', etiquetaVehiculo(v, 'GOLDEN TOUCH 1127 CA'));
  ok('sin empresa no deja un separador colgando', etiquetaVehiculo(v, '') === 'HILUX BLANCA · Placa A80AJ2F', etiquetaVehiculo(v, ''));
  ok('empresa null también', etiquetaVehiculo(v, null) === 'HILUX BLANCA · Placa A80AJ2F');
  ok('la placa le gana al serial', etiquetaVehiculo(v).includes('Placa A80AJ2F') && !etiquetaVehiculo(v).includes('Serial'));
  ok('sin placa cae al serial', etiquetaVehiculo({ id: '1', name: 'X', serial: 'SER-9' }) === 'X · Serial SER-9');
  ok('sin placa ni serial, solo el nombre', etiquetaVehiculo({ id: '1', name: 'X' }) === 'X');
  ok('espacios alrededor de la placa se recortan', etiquetaVehiculo({ id: '1', name: 'X', plate: '  ABC123 ' }) === 'X · Placa ABC123');
}

// ── 3) Sobre qué busca el filtro ────────────────────────────────────────────
{
  const v = { id: '1', name: 'HILUX', plate: 'A80AJ2F', brand: 'Toyota', model: '2021', vehicle_type: 'Pick-up', encargado: 'PEDRO PEREZ', serial: 'SER-9' };
  const t = textoBusquedaVehiculo(v, 'GOLDEN TOUCH');
  for (const campo of ['HILUX', 'A80AJ2F', 'Toyota', '2021', 'Pick-up', 'PEDRO PEREZ', 'SER-9', 'GOLDEN TOUCH']) {
    ok(`el filtro encuentra por "${campo}"`, t.includes(campo), t);
  }
  ok('sin datos no revienta ni deja "null"', !/null|undefined/.test(textoBusquedaVehiculo({ id: '1', name: null, plate: null }, null)));
}

// ── 4) Lo que va al motivo (reason) del movimiento ──────────────────────────
{
  ok('con vehículo: " · VEHÍCULO: …"', detalleVehiculoNota('HILUX · Placa A80AJ2F') === ' · VEHÍCULO: HILUX · Placa A80AJ2F');
  ok('sin vehículo: nada', detalleVehiculoNota('') === '');
  ok('null: nada', detalleVehiculoNota(null) === '');
  ok('undefined: nada', detalleVehiculoNota(undefined) === '');
  ok('en blanco: nada', detalleVehiculoNota('   ') === '');
}

// ── 5) El PDF de la nota de salida ──────────────────────────────────────────
{
  const base = { fecha: '07/09/2026', items: [{ name: 'ANTENA MINI STARLINK', qty: 1, unit: 'UND' }] };
  const con = notaEntregaHtml({ ...base, maquina: 'VOLTEO 1', vehiculo: 'HILUX · GT · Placa A80AJ2F', empleados: ['PEDRO'] });
  ok('el PDF trae la línea Vehículo', con.includes('<b>Vehículo:</b> HILUX · GT · Placa A80AJ2F'));
  ok('la línea de vehículo va después de la máquina', con.indexOf('Máquina / equipo:') < con.indexOf('<b>Vehículo:</b>'));
  ok('y antes de quién recibe', con.indexOf('<b>Vehículo:</b>') < con.indexOf('Recibe:'));
  const sin = notaEntregaHtml({ ...base, maquina: 'VOLTEO 1' });
  ok('sin vehículo no aparece la línea', !sin.includes('Vehículo:'));
  const nulo = notaEntregaHtml({ ...base, vehiculo: null });
  ok('vehiculo null tampoco', !nulo.includes('Vehículo:'));
  const feo = notaEntregaHtml({ ...base, vehiculo: '<b>x</b> & y' });
  ok('el nombre del vehículo se escapa en el HTML', feo.includes('&lt;b&gt;x&lt;/b&gt; &amp; y') && !feo.includes('<b>x</b>'));
  const solo = notaEntregaHtml({ ...base, vehiculo: 'HILUX' });
  ok('se puede dar salida a un vehículo sin máquina', solo.includes('<b>Vehículo:</b> HILUX') && !solo.includes('Máquina / equipo:'));
}

// ── 6) Reintento cuando falta la migración ──────────────────────────────────
{
  ok('el primer paso es vehicle_id (la migración más nueva)', igual(PASOS_SIN_MIGRACION[0].columnas, ['vehicle_id']));
  ok('después machinery_id', igual(PASOS_SIN_MIGRACION[1].columnas, ['machinery_id']));
  ok('y por último los empleados', igual(PASOS_SIN_MIGRACION[2].columnas, ['employee_ids', 'employees_detail']));
  for (const p of PASOS_SIN_MIGRACION) {
    ok(`el SQL ${p.archivo} existe`, fs.existsSync(path.join(ROOT, p.archivo)));
    for (const col of p.columnas) {
      const msg = `Could not find the '${col}' column of 'inventory_movements' in the schema cache`;
      ok(`"${col}" faltante se reconoce por el mensaje de PostgREST`, p.detecta.test(msg));
    }
    ok(`${p.columnas[0]}: un error de permisos NO dispara el reintento`, !p.detecta.test('new row violates row-level security policy for table "inventory_movements"'));
  }

  const filas = [{ item_id: 'i1', kind: 'salida', qty: 1, machinery_id: 'm1', vehicle_id: 'v1', employee_ids: ['e1'], employees_detail: [{ id: 'e1' }] }];
  const copia = quitarColumnas(filas, ['vehicle_id']);
  ok('quitarColumnas saca solo esa columna', !('vehicle_id' in copia[0]) && copia[0].machinery_id === 'm1' && copia[0].item_id === 'i1');
  ok('y no toca las filas originales', filas[0].vehicle_id === 'v1');
  ok('varias columnas de una vez', igual(Object.keys(quitarColumnas(filas, ['employee_ids', 'employees_detail'])[0]), ['item_id', 'kind', 'qty', 'machinery_id', 'vehicle_id']));
  ok('una columna que no está es un no-op', igual(quitarColumnas(filas, ['no_existe']), filas));
  ok('lista vacía devuelve copias iguales', igual(quitarColumnas(filas, []), filas) && quitarColumnas(filas, [])[0] !== filas[0]);

  // Simula el bucle de la pantalla contra una base a la que le faltan columnas.
  const insertar = (fs_, faltan) => { const f = faltan.find((c) => c in fs_[0]); return f ? { message: `Could not find the '${f}' column of 'inventory_movements' in the schema cache` } : null; };
  const simular = (faltan, errorFijo = null) => {
    let f = filas, intentos = 1;
    let error = errorFijo ?? insertar(f, faltan);
    for (const paso of PASOS_SIN_MIGRACION) {
      if (!error || !paso.detecta.test(error.message)) break;
      f = quitarColumnas(f, paso.columnas);
      error = errorFijo ?? insertar(f, faltan); intentos++;
    }
    return { error, f, intentos };
  };
  let r = simular([]);
  ok('base al día: un solo insert, con vehicle_id', r.intentos === 1 && !r.error && 'vehicle_id' in r.f[0]);
  r = simular(['vehicle_id']);
  ok('sin vehicle_id en la base: reintenta UNA vez sin esa columna', r.intentos === 2 && !r.error && !('vehicle_id' in r.f[0]));
  ok('…y conserva machinery_id y empleados', r.f[0].machinery_id === 'm1' && igual(r.f[0].employee_ids, ['e1']));
  r = simular(['vehicle_id', 'machinery_id', 'employee_ids', 'employees_detail']);
  ok('base sin ninguna migración: llega a registrar la salida igual', r.intentos === 4 && !r.error && igual(Object.keys(r.f[0]), ['item_id', 'kind', 'qty']));
  r = simular([], { message: 'new row violates row-level security policy for table "inventory_movements"' });
  ok('error de permisos: no reintenta y el error sale a la pantalla', r.intentos === 1 && !!r.error);
  r = simular([], { message: 'null value in column "qty" violates not-null constraint' });
  ok('otro error que menciona "column": reintenta pero el error final igual sale', !!r.error && r.error.message.includes('not-null'));
}

// ── 7) La pantalla: el apartado, en su sitio, y el dato a los tres lados ────
{
  const scr = leer('src/screens/InventarioScreen.tsx');
  const nota = sinComentarios(bloque(scr, 'function NotaTab(', '\nfunction TrasladoTab('));

  ok('NotaTab carga los vehículos de la tabla vehicles', /const \{ data: vehicles \} = useTable<Vehicle>\('vehicles', \{ orderBy: 'plate' \}\)/.test(nota));
  ok('el nombre del vehículo sale de la librería, con su empresa', /const vehicleName = \(id: string\) => \{ const v = vehicles\.find\(\(x\) => x\.id === id\); return v \? etiquetaVehiculo\(v, companyNameById\(v\.company_id \?\? null\)\) : ''; \}/.test(nota));

  // A los tres lados: PDF, texto del movimiento, columna.
  ok('PDF: vehiculo viene del vehículo elegido', /vehiculo: vehicleId \? vehicleName\(vehicleId\) : null,/.test(nota));
  ok('texto: detalleVeh se arma con detalleVehiculoNota', /const detalleVeh = detalleVehiculoNota\(vehicleId \? vehicleName\(vehicleId\) : ''\);/.test(nota));
  ok('texto: va entre la máquina y la empresa en el reason', /\$\{detalleMaq\}\$\{detalleVeh\}\$\{detalleEmp\}\$\{detallePers\}`/.test(nota));
  ok('columna: vehicle_id en cada fila del movimiento', /vehicle_id: vehicleId \|\| null,/.test(nota));

  // El reintento usa la lista de la librería, en bucle, y ya no hay copias a mano.
  ok('el insert reintenta con PASOS_SIN_MIGRACION', /for \(const paso of PASOS_SIN_MIGRACION\) \{\s*if \(!error \|\| !paso\.detecta\.test\(error\.message\)\) break;\s*filas = quitarColumnas\(filas, paso\.columnas\);\s*\(\{ error \} = await supabase\.from\('inventory_movements'\)\.insert\(filas\)\);\s*\}/.test(nota));
  ok('la cadena vieja de reintentos a mano ya no está', !/rowsBasic|rowsSinEmpleados/.test(nota));

  // El apartado: debajo de Máquina, encima de Recibe.
  const iMaq = nota.indexOf('🚜 Máquina:'), iVeh = nota.indexOf('🚗 Vehículo:'), iRec = nota.indexOf('👷 Recibe:');
  ok('existe el apartado 🚗 Vehículo', iVeh > 0);
  ok('va DEBAJO de 🚜 Máquina', iMaq > 0 && iMaq < iVeh, `maq=${iMaq} veh=${iVeh}`);
  ok('y ENCIMA de 👷 Recibe', iRec > 0 && iVeh < iRec, `veh=${iVeh} rec=${iRec}`);
  ok('el filtro del apartado busca con textoBusquedaVehiculo', /norm\(textoBusquedaVehiculo\(v, companyNameById\(v\.company_id \?\? null\)\)\)\.includes\(s\)/.test(nota));
  ok('cada fila muestra la etiqueta de la librería', /\{etiquetaVehiculo\(v, companyNameById\(v\.company_id \?\? null\)\)\}<\/Text>/.test(nota));
  ok('tocar un vehículo lo elige y cierra la lista', /onPress=\{\(\) => \{ setVehicleId\(v\.id\); setVehOpen\(false\); \}\}/.test(nota));
  ok('se puede quitar la selección', /onPress=\{\(\) => setVehicleId\(''\)\}/.test(nota));
  ok('si no hay vehículos cargados, lo dice', /No hay vehículos cargados en el Catálogo de equipos \(pestaña Vehículos\)\./.test(nota));
  ok('el encabezado muestra el vehículo elegido o "elegir…"', /🚗 Vehículo: <Text style=\{\{ color: vehicleId \? colors\.brandText : colors\.muted \}\}>\{vehicleId \? vehicleName\(vehicleId\) : 'elegir…'\}<\/Text>/.test(nota));
  ok('al generar la nota se limpia el vehículo', /setVehicleId\(''\); setVehQuery\(''\); setVehOpen\(false\);/.test(nota));

  // El resto de la pantalla NO se tocó por accidente. Traslado también carga
  // vehículos DESDE EL 09-09-2026, a propósito (test-inventario-traslado-vehiculo.mjs);
  // fuera de esas dos pestañas no debe haber ninguno.
  const traslado = bloque(scr, 'function TrasladoTab(', '\nfunction GastosTab(');
  const resto = sinComentarios(scr.replace(bloque(scr, 'function NotaTab(', '\nfunction TrasladoTab('), '').replace(traslado, ''));
  ok('las demás pestañas no cargan vehicles', !/useTable<Vehicle>/.test(resto));
  ok('la pantalla importa la librería', /from '\.\.\/lib\/salidaVehiculo'/.test(scr));
}

// ── 8) Tipo, SQL, lista de pendientes y manuales ────────────────────────────
{
  const tipos = sinComentarios(bloque(leer('src/types/database.ts'), 'export interface InventoryMovement {', '\n}'));
  ok('InventoryMovement declara vehicle_id opcional', /vehicle_id\?: string \| null;/.test(tipos));
  ok('…al lado de machinery_id', tipos.indexOf('machinery_id') < tipos.indexOf('vehicle_id'));

  const sql = leer('supabase/inventory_movements_vehiculo.sql');
  ok('el SQL agrega vehicle_id con FK a vehicles y set null', /add column if not exists vehicle_id uuid references public\.vehicles\(id\) on delete set null/.test(sql));
  ok('el SQL crea el índice', /create index if not exists \w+ on public\.inventory_movements\(vehicle_id\)/.test(sql));
  // ("on delete set null" es la FK, no un borrado.)
  ok('el SQL es idempotente y no borra nada', !/\b(drop|truncate)\b|\bdelete\s+from\b|\bupdate\s+public\./i.test(sql));
  ok('el SQL trae su consulta de comprobación', /column_name = 'vehicle_id'/.test(sql));
  // Corrido y verificado el 07/09/2026: la comprobación del SQL devolvió la fila `vehicle_id`.
  const pend = leer('supabase/PENDIENTES.md');
  ok('PENDIENTES.md lo da por corrido y verificado', /\| `inventory_movements_vehiculo\.sql` \| \*\*07\/09\/2026\*\*/.test(pend));
  ok('…y ya no está entre los escritos y sin correr', pend.indexOf('inventory_movements_vehiculo.sql') > pend.indexOf('## \u2705 Corridos y confirmados por el cliente'));

  const md = leer('docs/MANUAL-USUARIO.md');
  ok('manual .md: el paso 3 ofrece el 🚗 vehículo', /o el 🚗 vehículo\*\* \(la lista de la\n\s+pestaña Vehículos del Catálogo de equipos/.test(md));
  ok('manual .md: nota fechada del vehículo destino', /\*\*Vehículo destino \(07\/09\/2026\):\*\*/.test(md));
  ok('manual .md: dice que el SQL ya se corrió y se verificó', /se corrió y se\n> verificó el 07\/09\/2026/.test(md));
  ok('manual .md: el Cancelar conserva también el vehículo', /máquina, vehículo y empleados quedan tal cual/.test(md));

  const ms = leer('src/screens/ManualScreen.tsx');
  ok('manual en pantalla: el paso 3 ofrece el 🚗 vehículo', /o el 🚗 vehículo \(la lista de la pestaña Vehículos del Catálogo de equipos/.test(ms));
  ok('manual en pantalla: nota del vehículo destino', /Vehículo destino \(07\/09\/2026\):/.test(ms));
  ok('manual en pantalla: dice que el SQL ya se corrió', /se corrió y se verificó el 07\/09\/2026/.test(ms));
  ok('manual en pantalla: el Cancelar conserva también el vehículo', /máquina, vehículo y empleados quedan tal cual/.test(ms));
}

if (fail) {
  console.log(`\n✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nLa nota de salida ofrece los vehículos del catálogo, debajo de la máquina, y el vehículo llega al PDF, al texto y a vehicle_id.`);
