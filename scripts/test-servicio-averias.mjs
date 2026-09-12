/*
 * EL TALLER Y LAS AVERÍAS — la frontera nueva (01-sep-2026).
 *
 * Blinda las tres funciones que conectan el módulo de Servicio con los reportes
 * de avería, y sobre todo blinda LO QUE SIGUE PROHIBIDO.
 *
 * LA REGLA: el taller manda sobre EL PAPEL, nunca sobre LA MÁQUINA.
 *
 *   · `machinery`            → PROHIBIDO. Ni una escritura, nunca. Esa pared es
 *                              la que protege el miedo original del cliente: que
 *                              cerrar un reporte de hace meses no cambie la
 *                              realidad de la máquina de hoy.
 *   · `maintenance_requests` → PERMITIDO desde hoy, y SOLO tres campos.
 *
 * Hasta el 18-ago-2026 las dos estaban prohibidas por igual, y eso dejaba dos
 * botones del MISMO módulo con reglas opuestas: en «⏳ Averías» el botón
 * «✓ Realizado» cerraba la avería, y en «🧾 Servicios» registrar el trabajo
 * completo —con repuestos y fotos— no la cerraba. Se separó la pared correcta.
 *
 *   node scripts/test-servicio-averias.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const transpilar = (rel) => ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;

const mod = { exports: {} };
new Function('exports', 'module', transpilar('src/lib/machineService.ts'))(mod.exports, mod);
const {
  filaCierreAveria, cerrarAveriaPorServicio, serviciosPorAveria,
  esReporteViejo, DIAS_REPORTE_VIEJO,
} = mod.exports;

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? '  -> ' + extra : '')); }
};

/** Supabase falso que ANOTA todo lo que le hacen. Nada se ejecuta de verdad. */
const fakeDb = (resp = {}) => {
  const log = [];
  const api = {
    log,
    from(tabla) {
      log.push({ op: 'from', tabla });
      const cadena = {
        update(row) { log.push({ op: 'update', tabla, row }); return cadena; },
        insert(row) { log.push({ op: 'insert', tabla, row }); return cadena; },
        delete() { log.push({ op: 'delete', tabla }); return cadena; },
        upsert(row) { log.push({ op: 'upsert', tabla, row }); return cadena; },
        select(cols) { log.push({ op: 'select', tabla, cols }); return cadena; },
        eq(col, val) { log.push({ op: 'eq', tabla, col, val }); return cadena; },
        in(col, vals) { log.push({ op: 'in', tabla, col, vals }); return cadena; },
        then(res) { return res({ data: resp.data ?? null, error: resp.error ?? null }); },
      };
      return cadena;
    },
  };
  api.tablas = () => [...new Set(log.filter((x) => x.op === 'from').map((x) => x.tabla))];
  api.escrituras = () => log.filter((x) => ['update', 'insert', 'delete', 'upsert'].includes(x.op));
  return api;
};

console.log('EL TALLER Y LAS AVERIAS\n');

// ── 1) filaCierreAveria: exactamente TRES campos, ni uno más ───────────────
{
  const fila = filaCierreAveria('user-1');
  const claves = Object.keys(fila).sort();

  ok('la fila de cierre tiene exactamente 3 campos', claves.length === 3, claves.join(', '));
  ok('* status', fila.status === 'realizado', String(fila.status));
  ok('* resolved_by', fila.resolved_by === 'user-1');
  ok('* resolved_at es una fecha ISO real', !isNaN(Date.parse(fila.resolved_at)), String(fila.resolved_at));

  // ⭐ LO QUE NUNCA PUEDE APARECER ACÁ. Si alguien agrega uno de estos campos,
  //    el taller estaría moviendo la realidad de la máquina por la puerta de
  //    atrás — que es exactamente lo que el cliente pidió que no pasara.
  const PROHIBIDOS = ['operational', 'en_espera', 'machinery_id', 'horometro_base',
                      'active', 'latitude', 'longitude', 'status_maquina'];
  PROHIBIDOS.forEach((c) => {
    ok('* NO trae "' + c + '"', !(c in fila));
  });

  // Sin usuario no se inventa uno: queda en null, no en cadena vacía.
  ok('sin usuario, resolved_by queda en null', filaCierreAveria(null).resolved_by === null);
  ok('con espacios en blanco, tambien null', filaCierreAveria('   ').resolved_by === null);
  ok('sin argumento, tambien null', filaCierreAveria().resolved_by === null);
}

// ── 2) ⭐ cerrarAveriaPorServicio: la frontera ──────────────────────────────
{
  const db = fakeDb();
  const r = await cerrarAveriaPorServicio(db, 'av-1', 'user-1');

  ok('cerrar la averia no devuelve error', !r.error, r.error);
  ok('⭐ toca UNA sola tabla', db.tablas().length === 1, db.tablas().join(', '));
  ok('⭐ y esa tabla es maintenance_requests', db.tablas()[0] === 'maintenance_requests');
  ok('⭐⭐ NUNCA toca machinery', !db.tablas().includes('machinery'));

  const escrituras = db.escrituras();
  ok('hace exactamente UNA escritura', escrituras.length === 1, String(escrituras.length));
  ok('y es un update (no un insert ni un delete)', escrituras[0].op === 'update');
  ok('* con los tres campos del cierre', Object.keys(escrituras[0].row).length === 3);

  // ⭐ EL CANDADO QUE PERMITE ENLAZAR AVERIAS VIEJAS.
  //    Sin este .eq('status','pendiente'), enlazar una averia que el inspector ya
  //    cerro en campo le pisaria la firma y la fecha a quien la cerro de verdad.
  const filtros = db.log.filter((x) => x.op === 'eq');
  ok('⭐ filtra por id', filtros.some((f) => f.col === 'id' && f.val === 'av-1'));
  ok('⭐⭐ y SOLO pisa las que siguen pendientes',
    filtros.some((f) => f.col === 'status' && f.val === 'pendiente'),
    JSON.stringify(filtros));
}

// ── 3) Sin averia enlazada no se toca la base ──────────────────────────────
{
  for (const vacio of ['', null, undefined, '   ']) {
    const db = fakeDb();
    const r = await cerrarAveriaPorServicio(db, vacio, 'user-1');
    ok('sin averia (' + JSON.stringify(vacio) + ') no se toca la base', db.log.length === 0, JSON.stringify(db.log));
    ok('sin averia (' + JSON.stringify(vacio) + ') no hay error', !r.error);
  }
}

// ── 4) Si la base falla, se avisa (no se traga el error) ───────────────────
{
  const db = fakeDb({ error: { message: 'permission denied for table maintenance_requests' } });
  const r = await cerrarAveriaPorServicio(db, 'av-1', 'user-1');
  ok('un fallo de la base se devuelve como error', !!r.error, JSON.stringify(r));
  ok('* y se ve el mensaje real', String(r.error).includes('permission denied'));
}

// ── 5) serviciosPorAveria: SOLO LECTURA ────────────────────────────────────
{
  const db = fakeDb({ data: [
    { id: 's1', service_date: '2026-08-20', maintenance_request_id: 'av-1' },
    { id: 's2', service_date: '2026-08-28', maintenance_request_id: 'av-1' },
    { id: 's3', service_date: '2026-07-01', maintenance_request_id: 'av-2' },
  ] });
  const mapa = await serviciosPorAveria(db, ['av-1', 'av-2', 'av-3']);

  ok('⭐ no escribe NADA', db.escrituras().length === 0, JSON.stringify(db.escrituras()));
  ok('⭐ NUNCA toca machinery', !db.tablas().includes('machinery'));
  ok('⭐ NUNCA toca maintenance_requests', !db.tablas().includes('maintenance_requests'));
  ok('lee de machinery_service_orders', db.tablas()[0] === 'machinery_service_orders');

  ok('se queda con la fecha MAS RECIENTE de cada averia', mapa['av-1'] === '2026-08-28', mapa['av-1']);
  ok('* y con la unica cuando hay una sola', mapa['av-2'] === '2026-07-01');
  ok('* una averia sin servicio no aparece', !('av-3' in mapa));
}

// ── 6) serviciosPorAveria aguanta todo ─────────────────────────────────────
{
  const vacia = await serviciosPorAveria(fakeDb(), []);
  ok('sin ids devuelve vacio', Object.keys(vacia).length === 0);

  const dbSinTocar = fakeDb();
  await serviciosPorAveria(dbSinTocar, []);
  ok('* y ni consulta la base', dbSinTocar.log.length === 0);

  const roto = await serviciosPorAveria(fakeDb({ error: { message: 'boom' } }), ['av-1']);
  ok('si la consulta falla devuelve vacio (la lista se pinta igual)', Object.keys(roto).length === 0);

  const sucio = await serviciosPorAveria(fakeDb({ data: [
    { id: 's1', service_date: null, maintenance_request_id: 'av-1' },
    { id: 's2', service_date: '2026-08-01', maintenance_request_id: null },
    { id: 's3', service_date: '2026-08-02T10:30:00Z', maintenance_request_id: 'av-9' },
  ] }), ['av-1', 'av-9']);
  ok('una fila sin fecha se ignora', !('av-1' in sucio));
  ok('una fila sin averia se ignora', Object.keys(sucio).length === 1, JSON.stringify(sucio));
  ok('la fecha se recorta a AAAA-MM-DD', sucio['av-9'] === '2026-08-02', sucio['av-9']);

  const dbDup = fakeDb();
  await serviciosPorAveria(dbDup, ['av-1', 'av-1', '  ', 'av-1']);
  const consulta = dbDup.log.find((x) => x.op === 'in');
  ok('los ids repetidos y vacios se limpian antes de consultar',
    consulta && consulta.vals.length === 1, JSON.stringify(consulta));
}

// ── 7) esReporteViejo: la raya en la arena ─────────────────────────────────
{
  const HOY = new Date('2026-09-01T12:00:00Z');
  const haceDias = (d) => new Date(HOY.getTime() - d * 24 * 3600 * 1000).toISOString();

  ok('el corte de la casa son 30 dias', DIAS_REPORTE_VIEJO === 30, String(DIAS_REPORTE_VIEJO));

  ok('de hace 60 dias: viejo', esReporteViejo(haceDias(60), HOY) === true);
  ok('de hace 31 dias: viejo', esReporteViejo(haceDias(31), HOY) === true);
  ok('de hace 29 dias: NO es viejo', esReporteViejo(haceDias(29), HOY) === false);
  ok('de hoy: NO es viejo', esReporteViejo(HOY.toISOString(), HOY) === false);

  // El borde exacto: 30 dias clavados NO es viejo (el corte es "mas de 30").
  ok('a los 30 dias clavados todavia NO es viejo', esReporteViejo(haceDias(30), HOY) === false);
  ok('un pelo despues de los 30, ya es viejo',
    esReporteViejo(new Date(HOY.getTime() - 30 * 24 * 3600 * 1000 - 1000).toISOString(), HOY) === true);

  // ⭐ ANTE LA DUDA, ARRIBA Y A LA VISTA. Una fecha ilegible NO puede mandar un
  //    reporte a la seccion plegada: se perderia de vista sin que nadie lo decida.
  ok('⭐ sin fecha: NO es viejo', esReporteViejo(null, HOY) === false);
  ok('⭐ fecha vacia: NO es viejo', esReporteViejo('', HOY) === false);
  ok('⭐ fecha ilegible: NO es viejo', esReporteViejo('ayer por la tarde', HOY) === false);
  ok('⭐ sin argumento: NO es viejo', esReporteViejo(undefined, HOY) === false);

  // Una fecha futura tampoco es vieja (pasa: hay relojes de telefono mal puestos).
  ok('una fecha futura NO es vieja', esReporteViejo(new Date(HOY.getTime() + 86400000).toISOString(), HOY) === false);

  // El corte se puede mover sin tocar el codigo de las pantallas.
  ok('el corte se puede cambiar', esReporteViejo(haceDias(10), HOY, 7) === true);
  ok('* y en el otro sentido tambien', esReporteViejo(haceDias(40), HOY, 90) === false);
}

// ── 8) ⭐ LA PARED, revisada sobre el codigo fuente ─────────────────────────
{
  const crudo = fs.readFileSync(path.join(ROOT, 'src/lib/machineService.ts'), 'utf8');
  // Sin comentarios: un comentario que NOMBRA una tabla no es tocarla.
  const vivo = crudo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  ok('⭐⭐ la libreria NUNCA hace from("machinery")',
    !/from\(\s*'machinery'\s*\)/.test(vivo));
  ok('⭐⭐ y no escribe operational en ningun lado',
    !/operational\s*:/.test(vivo));
  ok('⭐ ni en_espera', !/en_espera\s*:/.test(vivo));

  // maintenance_requests SI se toca, pero solo en UN lugar y solo con update.
  const usos = (vivo.match(/from\(\s*'maintenance_requests'\s*\)/g) || []).length;
  ok('⭐ maintenance_requests se toca en UN solo lugar', usos === 1, String(usos));
  ok('⭐ y nunca se le borra una fila',
    !/from\(\s*'maintenance_requests'\s*\)[\s\S]{0,120}\.delete\(/.test(vivo));
  ok('⭐ ni se le inserta una',
    !/from\(\s*'maintenance_requests'\s*\)[\s\S]{0,120}\.insert\(/.test(vivo));

  // El candado del cierre tiene que estar en el codigo, no solo en la prueba.
  ok('⭐⭐ el cierre lleva el candado de "solo pendientes"',
    /\.eq\(\s*'status'\s*,\s*'pendiente'\s*\)/.test(vivo));
}

console.log('\n' + pass + ' OK · ' + fail + ' FALLO(S)');
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('El taller cierra el papel. La maquina no se mueve.');
