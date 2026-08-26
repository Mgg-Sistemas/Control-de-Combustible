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
      // ⚠️ EL SUBTÍTULO TIENE QUE ENTRAR AL HTML. Este doble lo descartaba, y por
      //    eso «el texto del usuario va escapado» salía verde aunque el subtítulo
      //    inyectara: nunca llegaba al HTML que la prueba revisa. El `pdfDocument`
      //    de verdad (src/lib/pdf.ts) lo interpola CRUDO, así que el escapado es
      //    responsabilidad de quien lo arma.
      pdfDocument: (o) => `<html><title>${o.title}</title><style>${o.extraCss || ''}</style>`
        + `<div class="doc-sub">${o.subtitle || ''}</div>${o.body}</html>`,
      exportPdf: async () => true,
    };
    throw new Error('import inesperado: ' + id);
  };
  const repMod = { exports: {} };
  new Function('exports', 'module', 'require', transpilar('src/lib/machineServiceReport.ts'))(
    repMod.exports, repMod, fakeRequire);
  const { buildMachineServiceReportHtml, buildServicioHojaHtml,
          servicioCardHtml, casillasIntervencionHtml } = repMod.exports;

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
  // 20-ago-2026 — el cliente pidió QUITAR estos dos bloques del PDF: en la flota
  // salían casi siempre vacíos ("SIN DATOS DE LUBRICACIÓN — ") y empujaban media
  // página antes de las reparaciones, que es lo que se viene a leer. Los campos
  // siguen en la máquina y se siguen editando en Control de Maquinaria; lo único
  // que cambió es que ya NO se imprimen acá. No los devuelvas sin que lo pida.
  ok('⭐ la ficha YA NO imprime la lubricación',
    !/LUBRICACI/i.test(unaHtml) && !unaHtml.includes('15W-40') && !unaHtml.includes('18 L'));
  ok('⭐ la ficha YA NO imprime el horómetro',
    !/HOR[ÓO]METRO/i.test(unaHtml) && !unaHtml.includes('1240 h') && !unaHtml.includes('140 h'));
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
  ok('máquina a medio llenar no imprime "undefined" ni "null"',
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

  // ══════════════════════════════════════════════════════════════════════════
  // LA HOJA DEL FORMULARIO (25-ago-2026)
  //
  // El cliente mandó el papel que llena el taller y pidió que el PDF se le
  // parezca. Antes cada reparación salía como una tarjetita resumida; ahora sale
  // como la HOJA: franja con el título, los cuatro datos de cabecera, las
  // CASILLAS de tipo de intervención y los tres recuadros, con sus firmas.
  //
  // Lo que se prueba acá es la FORMA, porque la forma es el pedido.
  // ══════════════════════════════════════════════════════════════════════════

  // ⚠️ EL CATÁLOGO ES {clave, nombre}, NO una lista de nombres. Las casillas se
  //    cruzan por CLAVE — ver el encabezado de `casillasIntervencionHtml`.
  const CATALOGO = [
    { key: 'mecanica', label: 'Mecánica' },
    { key: 'electricidad', label: 'Electricidad' },
    { key: 'mangueras', label: 'Mangueras / Hidráulica' },
    { key: 'servicio', label: 'Servicio' },
    { key: 'soldadura', label: 'Soldadura' },
  ];
  const hoja = servicioCardHtml(SRV, R053, { tipos: CATALOGO });
  /** Lo que quedó DENTRO de cada recuadro, en orden: problema · acciones · repuestos. */
  const cajasDe = (html) => [...html.matchAll(/<div class="caja">([\s\S]*?)<\/div>/g)].map((m) => m[1]);

  ok('⭐ cada reparación sale como la HOJA del formulario',
    /REPORTE DE MANTENIMIENTO \/ REPARACI[ÓO]N/i.test(hoja) && /MAQUINARIA PESADA/i.test(hoja));
  // Los cuatro renglones de cabecera del papel. Van SIEMPRE, aunque el dato
  // falte: a un formulario no se le pueden caer renglones.
  for (const k of ['Fecha:', 'Operador / Técnico:', 'Equipo (ID / Modelo):', 'Código de Serial:']) {
    ok(`la cabecera trae «${k}»`, hoja.includes(k));
  }
  ok('la cabecera dice de QUÉ máquina es la hoja',
    hoja.includes('SLP214TSWE0471955') && hoja.includes('5YN02894'));
  ok('y trae la marca y el modelo', hoja.includes('CAT 320'));
  ok('⭐ la fecha sale en dd/mm/aaaa, no en ISO',
    hoja.includes('18/08/2026') && !hoja.includes('2026-08-18'));
  ok('⭐ la foto de la máquina va en CADA hoja', hoja.includes('https://x/foto.jpg'));
  ok('las cuatro bandas del papel están',
    /Tipo de intervenci[óo]n/i.test(hoja) && /Descripci[óo]n del problema/i.test(hoja)
    && /Acciones realizadas/i.test(hoja) && /Repuestos utilizados/i.test(hoja));
  ok('la hoja lleva sus dos firmas al pie',
    /Firma del T[ée]cnico/i.test(hoja) && /Firma Supervisor/i.test(hoja));
  ok('la avería enlazada sale como un renglón más de la cabecera',
    servicioCardHtml({ ...SRV, averia: 'Avería del 16/08' }, R053, {}).includes('Avería que atiende:'));

  // ── Lo que escribió el taller tiene que LLEGAR, y a SU recuadro ───────────
  // Sin esto, cambiar `s.problem` por `s.work_done` (o dejar un recuadro vacío)
  // pasaba desapercibido: se probaba que hubiera tres cajas, no que dijeran algo.
  const cajas = cajasDe(hoja);
  ok('⭐ el problema llega, y va en el recuadro del PROBLEMA',
    cajas[0].includes('Manguera reventada') && !cajas[0].includes('Cambio de manguera'));
  ok('⭐ las acciones llegan, y van en el recuadro de ACCIONES',
    cajas[1].includes('Cambio de manguera y filtro') && !cajas[1].includes('Manguera reventada'));
  ok('⭐ los repuestos llegan, y van en el recuadro de REPUESTOS',
    /Manguera 3\/4/.test(cajas[2]) && /<table class="rep"/.test(cajas[2]));

  // ── Las casillas ──────────────────────────────────────────────────────────
  // Que se impriman TODAS —marcadas y sin marcar— es lo que las hace casillas y
  // no etiquetas. Antes solo salían las marcadas, como píldoras.
  const cas = casillasIntervencionHtml(['mecanica', 'mangueras'], CATALOGO);
  ok('⭐ salen TODAS las casillas del catálogo, no solo las marcadas',
    (cas.match(/class="chk"/g) || []).length === 5);
  ok('las marcadas se distinguen de las que no',
    (cas.match(/class="bx on"/g) || []).length === 2 && (cas.match(/class="bx"/g) || []).length === 3);
  ok('la casilla marcada lleva su ✓', cas.includes('>✓<'));
  ok('una casilla sin marcar queda en blanco', /class="bx"><\/span>/.test(cas));
  ok('los nombres salen como en el papel',
    cas.includes('Mangueras / Hidráulica') && cas.includes('Soldadura'));
  ok('⭐ el catálogo sale EN SU ORDEN, no alfabético',
    cas.indexOf('Mecánica') < cas.indexOf('Electricidad')
    && cas.indexOf('Electricidad') < cas.indexOf('Mangueras / Hidráulica')
    && cas.indexOf('Servicio') < cas.indexOf('Soldadura'));

  // ⭐⭐ EL CRUCE ES POR CLAVE. Estos cuatro casos son los que rompían la versión
  //     que comparaba textos en minúsculas, y los cuatro son alcanzables desde el
  //     modal de «⚙️ Tipos de intervención».
  const AIRE = [{ key: 'aire_acondicionado', label: 'Aire Acondicionado' }];
  const aire = casillasIntervencionHtml(['aire_acondicionado'], AIRE);
  ok('⭐ el nombre y la clave del MISMO tipo no salen como dos casillas',
    (aire.match(/class="chk"/g) || []).length === 1);
  ok('⭐ …y esa única casilla sale MARCADA (antes salía vacía)',
    /class="bx on">✓<\/span>Aire Acondicionado/.test(aire));

  const DOBLE = [{ key: 'soldadura', label: 'Soldadura' }, { key: 'soldadura_fina', label: 'soldadura' }];
  ok('⭐ dos tipos que solo difieren en mayúsculas NO se marcan los dos',
    (casillasIntervencionHtml(['soldadura'], DOBLE).match(/class="bx on"/g) || []).length === 1);

  const REPE = [{ key: 'a', label: 'Mecánica' }, { key: 'a', label: 'Mecánica' }, { key: 'b', label: 'Electricidad' }];
  ok('⭐ un catálogo con la clave repetida da UNA sola casilla',
    (casillasIntervencionHtml([], REPE).match(/class="chk"/g) || []).length === 2);

  ok('⭐ un acento de más no descuadra el cruce (se compara la clave)',
    /class="bx on">✓<\/span>Mecánica/.test(casillasIntervencionHtml(['mecanica'], CATALOGO)));

  // Un tipo que se marcó y DESPUÉS desactivaron: el servicio viejo no puede
  // perder lo que dijo, así que sale igual — al final y marcado, con su nombre.
  const CONOCIDOS = [...CATALOGO, { key: 'aire_acondicionado', label: 'Aire acondicionado' }];
  const conBaja = casillasIntervencionHtml(['mecanica', 'aire_acondicionado'], CATALOGO, CONOCIDOS);
  ok('⭐ un tipo marcado que ya no está en el catálogo igual sale',
    conBaja.includes('Aire acondicionado'));
  ok('…y sale MARCADO', /class="bx on">✓<\/span>Aire acondicionado/.test(conBaja));
  ok('…y va al final, después del catálogo',
    conBaja.indexOf('Aire acondicionado') > conBaja.indexOf('Soldadura'));
  ok('…y si nadie sabe su nombre, sale la clave cruda antes que nada',
    casillasIntervencionHtml(['tipo_borrado'], CATALOGO).includes('tipo_borrado'));
  ok('no se repite si venía dos veces',
    (casillasIntervencionHtml(['x_raro', 'x_raro'], CATALOGO).match(/x_raro/g) || []).length === 1);

  // Sin catálogo (nadie corrió el SQL de tipos) salen los cuatro del papel.
  const sinCat = casillasIntervencionHtml(['mecanica'], null);
  ok('⭐ sin catálogo salen los CUATRO de siempre',
    (sinCat.match(/class="chk"/g) || []).length === 4 && sinCat.includes('Mangueras / Hidráulica'));
  ok('…y la marcada se marca igual', (sinCat.match(/class="bx on"/g) || []).length === 1);
  ok('sin nada marcado tampoco se rompe',
    (casillasIntervencionHtml(null, CATALOGO).match(/class="bx on"/g) || []).length === 0);

  // Basura: nada de esto puede tumbar la exportación.
  ok('⭐ un jsonb que llega como TEXTO no revienta el PDF',
    typeof casillasIntervencionHtml('mecanica', CATALOGO) === 'string');
  ok('un catálogo que no es lista cae a los cuatro de siempre',
    (casillasIntervencionHtml(['mecanica'], 'ay').match(/class="chk"/g) || []).length === 4);
  ok('los nulls y los vacíos se filtran',
    (casillasIntervencionHtml([null, undefined, '', '   '], CATALOGO).match(/class="bx on"/g) || []).length === 0);
  // ⚠️ Una clave como `constructor` o `toString` imprimía el CÓDIGO FUENTE de la
  //    función en el formulario, porque se indexaba un objeto plano.
  for (const veneno of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    ok(`la clave «${veneno}» no imprime código`,
      !/native code|\[object Object\]|function /.test(casillasIntervencionHtml([veneno], CATALOGO)));
  }
  ok('⭐ el nombre del tipo va ESCAPADO (lo escribe un usuario en el catálogo)',
    !casillasIntervencionHtml([], [{ key: 'k', label: '<img src=x onerror=1>' }]).includes('<img src=x'));

  // ── Los recuadros vacíos y los datos que faltan ───────────────────────────
  // En el papel el recuadro está aunque no se haya escrito nada: se llena a mano.
  const pelada = servicioCardHtml(
    { id: 'x', service_date: '2026-08-01', origen: 'interno', technician: 'Ana' }, R053, { tipos: CATALOGO });
  ok('⭐ los tres recuadros salen aunque vengan vacíos',
    (pelada.match(/class="caja"/g) || []).length === 3 && cajasDe(pelada).every((c) => c === ''));
  ok('un servicio pelado no imprime "undefined" ni "null"',
    !/undefined|null/.test(pelada.replace(/<[^>]+>/g, ' ')));

  // Máquina a medio llenar: los renglones NO desaparecen, dicen «—».
  const sinDatos = servicioCardHtml(SRV, { code: 'VOLTEO' }, { tipos: CATALOGO });
  ok('⭐ sin serial ni modelo, los renglones siguen ahí y dicen «—»',
    /Código de Serial:<\/span><span class="v">—/.test(sinDatos) && sinDatos.includes('VOLTEO'));
  ok('sin máquina la hoja tampoco se rompe',
    typeof servicioCardHtml(SRV, null, { tipos: CATALOGO }) === 'string');
  ok('⭐ un photo_url con puros espacios no deja un <img> roto',
    !/<img/.test(servicioCardHtml(SRV, { code: 'X', photo_url: '   ' }, {})));
  ok('⭐ un null dentro de los repuestos no tumba la exportación',
    typeof servicioCardHtml({ ...SRV, parts: [null, undefined] }, R053, {}) === 'string');

  // ── El CSS que el manual promete ─────────────────────────────────────────
  // Se prueba que la REGLA exista: sin ella el recuadro vacío colapsa, el texto
  // de varias líneas se aplasta, la casilla deja de dibujarse, o una referencia
  // larga sin espacios se sale de la hoja y NO LLEGA AL PAPEL.
  ok('⭐ una hoja PIDE no partirse entre páginas', /\.hoja\{[^}]*page-break-inside\s*:\s*avoid/.test(unaHtml));
  ok('⭐ el recuadro vacío conserva su alto (se llena a mano)', /\.caja\{[^}]*min-height/.test(unaHtml));
  ok('⭐ el texto de varias líneas no se aplasta', /\.caja\{[^}]*white-space\s*:\s*pre-wrap/.test(unaHtml));
  ok('⭐ una referencia larga sin espacios no se sale de la hoja',
    /\.caja\{[^}]*overflow-wrap\s*:\s*anywhere/.test(unaHtml)
    && /table\.rep td\{[^}]*overflow-wrap\s*:\s*anywhere/.test(unaHtml));
  ok('⭐ la casilla se DIBUJA (tiene borde), no es solo el ✓', /\.bx\{[^}]*border\s*:/.test(unaHtml));
  ok('⭐ la casilla marcada se pinta', /\.bx\.on\{[^}]*background/.test(unaHtml));
  ok('⭐ las firmas no se quedan solas en la página siguiente',
    /\.firmas\{[^}]*page-break-before\s*:\s*avoid/.test(unaHtml));

  // ── En el documento completo ──────────────────────────────────────────────
  const tresHtml = buildMachineServiceReportHtml({
    maquinas: [{ m: R053, servicios: [SRV, { ...SRV, id: 's2' }, { ...SRV, id: 's3' }] }],
    tiposIntervencion: CATALOGO,
  });
  ok('⭐ tres servicios = tres hojas, cada una con SUS firmas',
    (tresHtml.match(/Firma Supervisor/g) || []).length === 3);
  ok('el catálogo llega hasta el PDF', tresHtml.includes('Soldadura'));

  // ⭐⭐ QUE LA MÁQUINA LLEGUE A CADA HOJA desde el documento. Sin esta prueba,
  //     borrar el `m` del `servicioCardHtml(...)` de `buildMachineServiceReportHtml`
  //     dejaba TODAS las hojas sin foto y sin serial, y la suite seguía en verde:
  //     la ficha técnica y el título del grupo tapaban el agujero.
  const dosMaq = buildMachineServiceReportHtml({
    maquinas: [{ m: R053, servicios: [SRV] }, { m: { ...R008, photo_url: 'https://x/008.jpg' }, servicios: [SRV] }],
    tiposIntervencion: CATALOGO,
  });
  const hojas = dosMaq.split('class="hoja"').slice(1);
  ok('⭐ cada hoja trae SU foto (no la de la otra máquina)',
    hojas.length === 2 && hojas[0].includes('https://x/foto.jpg') && hojas[1].includes('https://x/008.jpg'));
  ok('⭐ y cada hoja trae SU serial',
    hojas[0].includes('5YN02894') && hojas[1].includes('92543.0'));

  ok('una máquina sin servicios lo dice y no deja una hoja en blanco',
    /Sin servicios registrados/.test(buildMachineServiceReportHtml({ maquinas: [{ m: R053, servicios: [] }] })));
  ok('⭐ sin servicios NO se imprimen firmas que nadie tiene que firmar',
    !/Firma Supervisor/.test(buildMachineServiceReportHtml({ maquinas: [{ m: R053, servicios: [] }] })));

  // La ficha técnica NO cambió: la comparte el Recibo de cobro de mangueras
  // (`reciboCobro.ts`), que es de otro módulo. Si alguien la toca, se entera acá.
  ok('⭐ la ficha técnica sigue intacta (la usa el recibo de mangueras)',
    /FICHA T[ÉE]CNICA DE MAQUINARIA/i.test(unaHtml) && /class="sv-photo"/.test(unaHtml));

  // ══════════════════════════════════════════════════════════════════════════
  // UNA SOLA HOJA (25-ago-2026)
  //
  // Queja del taller: «me los arroja los dos, el que ya monté y el que estoy
  // haciendo de prueba». «Exportar PDF» saca TODO lo del filtro, y los filtros
  // de fecha arrancan vacíos. Ahora cada servicio tiene su «📄 Solo esta hoja».
  // ══════════════════════════════════════════════════════════════════════════
  const sola = buildServicioHojaHtml({ m: R053, servicio: SRV, tiposIntervencion: CATALOGO });

  ok('⭐ la hoja sola NO arrastra la ficha técnica (sería una página repitiendo lo mismo)',
    !/FICHA T[ÉE]CNICA/i.test(sola));
  ok('⭐ y es UNA sola hoja, no la lista entera',
    (sola.match(/class="hoja"/g) || []).length === 1);
  ok('⭐ una sola pareja de firmas', (sola.match(/Firma Supervisor/g) || []).length === 1);
  ok('la hoja sola es la MISMA hoja de siempre (mismo formato)',
    /REPORTE DE MANTENIMIENTO \/ REPARACI[ÓO]N/i.test(sola)
    && /Descripci[óo]n del problema/i.test(sola) && /Repuestos utilizados/i.test(sola));
  ok('el encabezado dice de qué máquina y de qué día es',
    sola.includes('SLP214TSWE0471955') && sola.includes('18/08/2026'));
  ok('lleva su foto, su serial y lo que se hizo',
    sola.includes('https://x/foto.jpg') && sola.includes('5YN02894')
    && sola.includes('Cambio de manguera y filtro'));
  ok('las casillas salen igual que en el reporte grande',
    (sola.match(/class="chk"/g) || []).length === 5
    && (sola.match(/class="bx on"/g) || []).length === 2);
  ok('⭐ la hoja sola tampoco habla de dinero',
    !/costo|precio|monto|pagar/i.test(sola.replace(/<[^>]+>/g, ' ')));
  ok('sin catálogo la hoja sola sigue saliendo con las cuatro casillas',
    (buildServicioHojaHtml({ m: R053, servicio: SRV }).match(/class="chk"/g) || []).length === 4);
  ok('una máquina a medio llenar no rompe la hoja sola',
    typeof buildServicioHojaHtml({ m: { code: 'VOLTEO' }, servicio: SRV }) === 'string');
  ok('el texto del usuario va escapado también en la hoja sola',
    !buildServicioHojaHtml({ m: { code: '<script>x</script>' }, servicio: SRV }).includes('<script>x</script>'));
  // ⚠️ EL ENCABEZADO, no solo el cuerpo. `pdfDocument` interpola el subtítulo
  //    CRUDO, y en web la vista previa se pinta con `document.write` sobre un
  //    iframe del MISMO ORIGEN: un `<script>` en el nombre de una máquina se
  //    ejecutaría en el origen de la app. El nombre lo escribe un humano en
  //    Control de Maquinaria.
  const conVeneno = buildServicioHojaHtml({
    m: { code: '"><img src=x onerror=alert(1)>', plate: 'P1' }, servicio: SRV,
  });
  ok('⭐ el SUBTÍTULO de la hoja sola va escapado, no solo el cuerpo',
    /class="doc-sub"/.test(conVeneno) && !/<img src=x/.test(conVeneno));
  ok('…y un & o un < sueltos no rompen el encabezado del papel',
    !/<b>/.test(buildServicioHojaHtml({ m: { code: 'RETRO & CIA <b>', plate: 'P2' }, servicio: SRV })));

  // ── QUE QUEPA EN UNA PÁGINA ───────────────────────────────────────────────
  // ⚠️ Contado en PDF de verdad: la carta deja ~905px y el MEMBRETE se come
  //    ~190px. Con las medidas originales, una hoja con UN SOLO REPUESTO ya
  //    medía ~790px y salía en DOS páginas — justo lo contrario de lo que el
  //    manual prometía. Estas aserciones fijan los números ajustados: si alguien
  //    los engorda, se entera acá antes de que el taller reciba dos hojas.
  ok('⭐ los recuadros vacíos no pasan de 38px (si crecen, la hoja no cabe)',
    /\.caja\{[^}]*min-height:38px/.test(sola));
  ok('⭐ las firmas no separan más de 20px por arriba', /\.firmas\{[^}]*margin:20px/.test(sola));
  ok('⭐ las bandas van apretadas', /\.banda\{[^}]*margin:8px 14px 5px/.test(sola));

  // ⚠️ En un documento de UNA sola hoja, la hoja SÍ se puede partir. Si no, y no
  //    cabe debajo del membrete, el motor la empuja ENTERA a la página 2 y deja
  //    la 1 con el membrete y nada más.
  ok('⭐ la hoja SOLA puede fluir a la página siguiente', /\.hoja\{page-break-inside:auto\}/.test(sola));
  ok('⭐ …pero el reporte GRANDE sigue sin partir sus hojas',
    !/\.hoja\{page-break-inside:auto\}/.test(unaHtml)
    && /\.hoja\{[^}]*page-break-inside:avoid/.test(unaHtml));

  // Los renglones de cabecera recortaban igual que los recuadros antes.
  ok('⭐ un serial largo sin espacios no se sale de la cabecera',
    /\.campo \.v\{[^}]*overflow-wrap:anywhere/.test(sola));

  // Un tipo desactivado también tiene que salir acá, no solo en el reporte grande.
  ok('un tipo desactivado sale marcado en la hoja sola',
    /class="bx on">✓<\/span>Aire acondicionado/.test(buildServicioHojaHtml({
      m: R053, servicio: { ...SRV, intervenciones: ['aire_acondicionado'] },
      tiposIntervencion: CATALOGO, tiposConocidos: CONOCIDOS,
    })));

}

if (fail) {
  console.log(`✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nEl taller registra lo suyo y no mueve el estado de ninguna máquina.`);
