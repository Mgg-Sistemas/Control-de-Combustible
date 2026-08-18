/*
 * SERVICIO DE MAQUINARIA — el registro de lo que se le hizo a cada máquina.
 *
 * Blinda `src/lib/machineService.ts`. Lo más importante que se prueba acá es LA
 * FRONTERA: guardar un servicio NO puede escribir en `machinery` ni en
 * `maintenance_requests`. Es un pedido explícito del cliente (18-ago-2026): los
 * módulos del taller reciben los avisos pero no mueven el estado de las máquinas,
 * para que la acumulación de reportes pendientes no arrastre a la flota.
 *
 *   npm run test:servicio   (o: node scripts/test-servicio.mjs)
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

// machineService.ts es PURO (sin imports) → transpila y evalúa directo.
const mod = { exports: {} };
new Function('exports', 'module', transpilar('src/lib/machineService.ts'))(mod.exports, mod);
const {
  validarServicio, limpiarRepuestos, filaServicio, quienLoHizo, guardarServicio,
  INTERVENCION_LABEL, ESTADOS_REPUESTO,
} = mod.exports;

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? `  → ${extra}` : '')); }
};

const BASE = {
  machineryId: 'maq-1', serviceDate: '2026-08-18', origen: 'interno',
  technician: 'José Pérez', workDone: 'Cambio de manguera',
};

console.log('SERVICIO DE MAQUINARIA\n');

// ── 1) ⭐ LA FRONTERA: guardar no toca nada de afuera ──────────────────────
{
  // Cliente Supabase falso que anota CADA tabla que alguien intenta tocar.
  const tocadas = [];
  const fakeDb = {
    from(tabla) {
      tocadas.push(tabla);
      return {
        insert: (rows) => ({
          select: () => ({
            single: async () => ({ data: { id: 'orden-1', ...(Array.isArray(rows) ? rows[0] : rows) }, error: null }),
          }),
          then: (res) => res({ error: null }),   // insert sin .select()
        }),
        update: () => { throw new Error(`PROHIBIDO: update sobre ${tabla}`); },
        delete: () => { throw new Error(`PROHIBIDO: delete sobre ${tabla}`); },
      };
    },
  };

  const r = await guardarServicio(fakeDb, { ...BASE, maintenanceRequestId: 'av-1' }, [
    { quantity: 2, description: 'Manguera 3/4"', estado: 'Nuevo' },
  ]);

  ok('⭐ guarda sin error', !r.error, r.error);
  ok('⭐ NO toca `machinery`', !tocadas.includes('machinery'), tocadas.join(', '));
  ok('⭐ NO toca `maintenance_requests`', !tocadas.includes('maintenance_requests'), tocadas.join(', '));
  ok('solo toca sus dos tablas',
    tocadas.every((t) => t === 'machinery_service_orders' || t === 'machinery_service_parts'),
    tocadas.join(', '));
  ok('enlazar una avería NO la modifica', !tocadas.includes('maintenance_requests'));
}

// ── 2) Sin repuestos no se toca la tabla de repuestos ─────────────────────
{
  const tocadas = [];
  const fakeDb = { from(t) { tocadas.push(t); return {
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'o1' }, error: null }) }),
                     then: (res) => res({ error: null }) }) }; } };
  await guardarServicio(fakeDb, BASE, []);
  ok('sin repuestos → no inserta en machinery_service_parts',
    !tocadas.includes('machinery_service_parts'), tocadas.join(', '));
}

// ── 3) Validación ─────────────────────────────────────────────────────────
{
  ok('un servicio bien armado pasa', validarServicio(BASE) === null, String(validarServicio(BASE)));
  ok('sin máquina no pasa', validarServicio({ ...BASE, machineryId: '' }) !== null);
  ok('sin fecha no pasa', validarServicio({ ...BASE, serviceDate: '' }) !== null);
  ok('interno sin técnico no pasa', validarServicio({ ...BASE, technician: '' }) !== null);
  ok('interno con técnico pasa', validarServicio({ ...BASE, technician: 'Ana' }) === null);
  ok('externo sin proveedor no pasa',
    validarServicio({ ...BASE, origen: 'externo', technician: null, provider: '' }) !== null);
  ok('externo con proveedor pasa',
    validarServicio({ ...BASE, origen: 'externo', technician: null, provider: 'Taller Pérez' }) === null);
  ok('sin problema NI acciones no pasa (registro vacío no sirve)',
    validarServicio({ ...BASE, workDone: '', problem: '' }) !== null);
  ok('con problema pero sin acciones sí pasa',
    validarServicio({ ...BASE, workDone: '', problem: 'Manguera reventada' }) === null);
  ok('el error es texto en cristiano, no un código',
    typeof validarServicio({ ...BASE, machineryId: '' }) === 'string');
}

// ── 4) Repuestos: limpieza y orden ────────────────────────────────────────
{
  const limpios = limpiarRepuestos([
    { quantity: '2', description: 'Manguera 3/4"', estado: 'Nuevo' },
    { quantity: null, description: '   ', estado: 'Usado' },      // vacío → se descarta
    { quantity: 1, description: 'Filtro de aceite', estado: null },
  ]);
  ok('descarta los renglones sin descripción', limpios.length === 2, String(limpios.length));
  ok('conserva el orden de carga', limpios[0].position === 0 && limpios[1].position === 1);
  ok('la cantidad en texto se vuelve número', limpios[0].quantity === 2, String(limpios[0].quantity));
  ok('el segundo renglón es el filtro', limpios[1].description === 'Filtro de aceite');
  ok('sin repuestos devuelve lista vacía', limpiarRepuestos([]).length === 0);
  ok('null no rompe', limpiarRepuestos(null).length === 0);
  ok('diez renglones entran los diez',
    limpiarRepuestos(Array.from({ length: 10 }, (_, i) => ({ description: `R${i}` }))).length === 10);
}

// ── 5) La fila que se guarda ──────────────────────────────────────────────
{
  const fila = filaServicio({ ...BASE, intervenciones: ['mecanica', 'mangueras'], photos: ['u1'] });
  ok('intervenciones va como arreglo', Array.isArray(fila.intervenciones) && fila.intervenciones.length === 2);
  ok('sin intervenciones va arreglo vacío, no null',
    Array.isArray(filaServicio(BASE).intervenciones) && filaServicio(BASE).intervenciones.length === 0);
  ok('sin fotos va arreglo vacío, no null', Array.isArray(filaServicio(BASE).photos));
  ok('los textos vacíos se guardan como null, no como ""', filaServicio({ ...BASE, notes: '   ' }).notes === null);
  ok('sin avería enlazada va null', filaServicio(BASE).maintenance_request_id === null);
  ok('con avería enlazada la conserva',
    filaServicio({ ...BASE, maintenanceRequestId: 'av-9' }).maintenance_request_id === 'av-9');
  ok('interno no guarda proveedor', filaServicio({ ...BASE, provider: 'X' }).provider === null);
  ok('externo no guarda técnico',
    filaServicio({ ...BASE, origen: 'externo', provider: 'Taller' }).technician === null);
  ok('⭐ la fila NO trae ningún campo de dinero',
    !Object.keys(fila).some((k) => /cost|price|amount|monto|pago/i.test(k)), Object.keys(fila).join(','));
}

// ── 6) Quién lo hizo, en una línea ────────────────────────────────────────
{
  ok('interno muestra al técnico',
    quienLoHizo({ origen: 'interno', technician: 'José Pérez' }).includes('José Pérez'));
  ok('externo muestra al taller',
    quienLoHizo({ origen: 'externo', provider: 'Taller Pérez' }).includes('Taller Pérez'));
  ok('interno y externo se distinguen a simple vista',
    quienLoHizo({ origen: 'interno', technician: 'X' }) !== quienLoHizo({ origen: 'externo', provider: 'X' }));
  ok('sin nombre no rompe ni dice "undefined"',
    !/undefined|null/.test(quienLoHizo({ origen: 'interno' })));
}

// ── 7) Las etiquetas del formulario de papel ──────────────────────────────
{
  ok('las cuatro intervenciones del formulario están',
    ['mecanica', 'electricidad', 'mangueras', 'servicio'].every((k) => !!INTERVENCION_LABEL[k]));
  ok('mangueras se muestra como en el papel',
    INTERVENCION_LABEL.mangueras === 'Mangueras / Hidráulica', INTERVENCION_LABEL.mangueras);
  ok('los estados de repuesto son cuatro', ESTADOS_REPUESTO.length === 4, ESTADOS_REPUESTO.join(','));
}

// ── 8) El PDF: ficha técnica + reparaciones ───────────────────────────────
{
  // machineLabel.ts es puro → se carga de verdad, para que la prueba compruebe
  // que las tres RETROEXCAVADORAS se distinguen también en el papel.
  const lblMod = { exports: {} };
  new Function('exports', 'module', transpilar('src/lib/machineLabel.ts'))(lblMod.exports, lblMod);

  // `pdf.ts` arrastra react-native y expo-print, así que se sustituye por lo
  // mínimo que el reporte usa: el membrete es un envoltorio, no lógica.
  const fakeRequire = (id) => {
    if (id.includes('machineLabel')) return lblMod.exports;
    if (id.includes('machineService')) return mod.exports;
    if (id.includes('pdf')) return {
      pdfDocument: (o) => `<html><title>${o.title}</title><style>${o.extraCss || ''}</style>${o.body}</html>`,
      exportPdf: async () => true,
    };
    throw new Error('import inesperado: ' + id);
  };
  const repMod = { exports: {} };
  new Function('exports', 'module', 'require', transpilar('src/lib/machineServiceReport.ts'))(
    repMod.exports, repMod, fakeRequire);
  const { buildMachineServiceReportHtml } = repMod.exports;

  const R053 = {
    code: 'RETROEXCAVADORA', identifier: '053', serial: '5YN02894',
    plate: 'SLP214TSWE0471955', marca: 'CAT', modelo: '320', tipo: 'Retroexcavadora',
    photo_url: 'https://x/foto.jpg', companyName: 'Golden Touch 1127 C.A.',
    oil_type: '15W-40', oil_capacity_l: 18, last_horometro: 1240, horometro_base: 1100,
  };
  const SRV = {
    id: 's1', service_date: '2026-08-18', origen: 'interno', technician: 'José Pérez',
    intervenciones: ['mecanica', 'mangueras'], problem: 'Manguera reventada',
    work_done: 'Cambio de manguera y filtro',
    parts: [{ quantity: 2, description: 'Manguera 3/4"', estado: 'Nuevo' }],
  };

  // ── Modo A: UNA máquina → lleva ficha técnica ──
  const unaHtml = buildMachineServiceReportHtml({ maquinas: [{ m: R053, servicios: [SRV] }] });
  ok('⭐ una máquina → sale la ficha técnica', /FICHA T[ÉE]CNICA/i.test(unaHtml));
  ok('la ficha muestra la PLACA, que es lo que usan para asignar',
    unaHtml.includes('SLP214TSWE0471955'));
  ok('la ficha trae la foto de la máquina', unaHtml.includes('https://x/foto.jpg'));
  ok('la ficha trae la lubricación del documento del cliente',
    unaHtml.includes('15W-40') && unaHtml.includes('18 L'));
  ok('la ficha calcula las horas acumuladas (1240 − 1100)', unaHtml.includes('140 h'));
  ok('hay salto de página entre la ficha y las reparaciones',
    /page-break-after\s*:\s*always/.test(unaHtml));
  ok('el servicio sale con su repuesto', unaHtml.includes('Manguera 3/4&quot;') || unaHtml.includes('Manguera 3/4"'));
  ok('el servicio dice quién lo hizo', unaHtml.includes('José Pérez'));
  ok('las intervenciones salen con su nombre de papel', unaHtml.includes('Mangueras / Hidráulica'));
  ok('hay líneas de firma', /Firma del T[ée]cnico/i.test(unaHtml) && /Firma Supervisor/i.test(unaHtml));
  ok('⭐ el PDF NO habla de dinero',
    !/costo|precio|monto|pagar/i.test(unaHtml.replace(/<[^>]+>/g, ' ')));

  // ── Modo B: VARIAS máquinas → sin ficha ──
  const R008 = { code: 'RETROEXCAVADORA', identifier: '008', serial: '92543.0', plate: null };
  const variasHtml = buildMachineServiceReportHtml({
    maquinas: [{ m: R053, servicios: [SRV] }, { m: R008, servicios: [SRV] }],
  });
  ok('⭐ varias máquinas → NO sale la ficha técnica', !/FICHA T[ÉE]CNICA/i.test(variasHtml));
  ok('las dos RETROEXCAVADORAS se distinguen en el PDF',
    variasHtml.includes('SLP214TSWE0471955') && variasHtml.includes('92543.0'));

  // ── Casos de borde ──
  ok('máquina sin servicios no rompe',
    typeof buildMachineServiceReportHtml({ maquinas: [{ m: R053, servicios: [] }] }) === 'string');
  ok('sin máquinas no rompe', typeof buildMachineServiceReportHtml({ maquinas: [] }) === 'string');
  const sinFoto = buildMachineServiceReportHtml({
    maquinas: [{ m: { code: 'VOLTEO', plate: 'A1' }, servicios: [SRV] }],
  });
  ok('máquina sin foto no deja un <img> roto', !/<img[^>]*src=["']["']/.test(sinFoto));
  ok('máquina sin lubricación no imprime "undefined" ni "null"',
    !/undefined|>null</.test(sinFoto.replace(/<[^>]+>/g, (t) => t)));

  // ── Registros viejos de machinery_repairs ──
  const viejo = { ...SRV, id: 'v1', esRegistroAnterior: true, parts: [], technician: null };
  const mixto = buildMachineServiceReportHtml({ maquinas: [{ m: R053, servicios: [SRV, viejo] }] });
  ok('los registros viejos salen marcados como tales', /registro anterior/i.test(mixto));

  // ── El rango y la avería enlazada ──
  const conRango = buildMachineServiceReportHtml({
    maquinas: [{ m: R053, servicios: [{ ...SRV, averia: 'Avería del 16/08 · César Flames' }] }],
    desde: '2026-08-01', hasta: '2026-08-18',
  });
  ok('el rango sale en el documento', conRango.includes('01/08/2026') && conRango.includes('18/08/2026'));
  ok('la avería enlazada se imprime', conRango.includes('César Flames'));

  // ── Inyección: un nombre con < > no rompe el HTML ──
  const raro = buildMachineServiceReportHtml({
    maquinas: [{ m: { code: '<script>x</script>', plate: 'B2' }, servicios: [SRV] }],
  });
  ok('el texto del usuario va escapado', !raro.includes('<script>x</script>'));
}

if (fail) {
  console.log(`✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nEl taller registra lo suyo y no mueve el estado de ninguna máquina.`);
