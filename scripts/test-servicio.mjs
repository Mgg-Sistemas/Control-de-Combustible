/*
 * SERVICIO DE MAQUINARIA — el registro de lo que se le hizo a cada máquina.
 *
 * Blinda `src/lib/machineService.ts`. Lo más importante que se prueba acá es LA
 * FRONTERA: guardar un servicio —y desde el 26-ago-2026 también EDITARLO— NO
 * puede escribir en `machinery` ni en `maintenance_requests`. Es un pedido explícito del cliente (18-ago-2026): los
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
  // ✏️ Editar un servicio ya registrado (26-ago-2026).
  editarServicio, cambiosServicio, resumenCambios, filaServicioEdicion,
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


// ══════════════════════════════════════════════════════════════════════════
// 14) ✏️ EDITAR UN SERVICIO — y que quede quién lo editó y qué cambió
//     (pedido del cliente, 26-ago-2026). Ver `supabase/servicio_editar.sql`.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Cliente falso para el camino de edición. Anota CADA operación EN ORDEN, con
 * su tabla, y guarda lo que se le mandó. El orden importa tanto como el
 * contenido: si algún día alguien invierte «insertar y luego borrar», el
 * servicio se queda sin repuestos ante el primer error de red.
 */
const dbEdicion = (opts = {}) => {
  const ops = [];
  const payloads = {};
  const err = opts.errores ?? {};
  const db = {
    from(tabla) {
      return {
        select: () => ({
          eq: async () => {
            ops.push(`select:${tabla}`);
            return { data: opts.partesViejas ?? [], error: err.select ?? null };
          },
        }),
        update: (row) => ({
          eq: async () => {
            ops.push(`update:${tabla}`);
            payloads[`update:${tabla}`] = row;
            return { error: err.update ?? null };
          },
        }),
        insert: (rows) => {
          ops.push(`insert:${tabla}`);
          payloads[`insert:${tabla}`] = rows;
          const e = err[`insert:${tabla}`] ?? null;
          return {
            then: (res) => res({ error: e }),
            select: () => ({ single: async () => ({ data: { id: 'o1' }, error: e }) }),
          };
        },
        delete: () => ({
          in: async () => {
            ops.push(`delete:${tabla}`);
            return { error: err.delete ?? null };
          },
        }),
      };
    },
  };
  return { db, ops, payloads };
};

const ANTES = {
  machinery_id: 'maq-1', service_date: '2026-08-18', origen: 'interno',
  technician: 'José Pérez', provider: null, intervenciones: ['mecanica'],
  problem: 'Manguera reventada', work_done: 'Cambio de manguera',
  photos: [], notes: null, maintenance_request_id: null,
};

// ── 14.a) El diff: qué detecta y qué NO ───────────────────────────────────
{
  const nada = cambiosServicio({ antes: ANTES, despues: { ...ANTES } });
  ok('⭐ sin tocar nada → CERO cambios', nada.length === 0, JSON.stringify(nada));

  const uno = cambiosServicio({ antes: ANTES, despues: { ...ANTES, work_done: 'Se cambió la manguera y el filtro' } });
  ok('un campo cambiado → un solo cambio', uno.length === 1, JSON.stringify(uno));
  ok('el cambio dice el nombre visible, no la columna',
    uno[0].etiqueta === 'Acciones realizadas', uno[0].etiqueta);
  ok('el cambio guarda la clave técnica también', uno[0].campo === 'work_done');
  ok('el cambio dice de qué a qué',
    uno[0].de === 'Cambio de manguera' && uno[0].a === 'Se cambió la manguera y el filtro',
    `${uno[0].de} → ${uno[0].a}`);

  // La fecha se muestra como la lee una persona, no como la guarda Postgres.
  const f = cambiosServicio({ antes: ANTES, despues: { ...ANTES, service_date: '2026-08-19' } });
  ok('⭐ la fecha se muestra DD/MM/AAAA',
    f[0].de === '18/08/2026' && f[0].a === '19/08/2026', `${f[0].de} → ${f[0].a}`);

  // Un campo que se vacía dice "—", no "null" ni "undefined".
  const v = cambiosServicio({ antes: ANTES, despues: { ...ANTES, problem: '' } });
  ok('vaciar un campo se ve como un guion', v[0].a === '—', v[0].a);
  ok('nunca aparece la palabra null/undefined en el texto',
    !/null|undefined/.test(JSON.stringify(v)), JSON.stringify(v));

  // El origen se traduce.
  const o = cambiosServicio({ antes: ANTES, despues: { ...ANTES, origen: 'externo', technician: null, provider: 'Taller Pérez' } });
  const orig = o.find((c) => c.campo === 'origen');
  ok('interno/externo se traduce a lo que ve el usuario',
    orig && orig.de === '🏭 Interno' && orig.a === '🤝 Externo', JSON.stringify(orig));
}

// ── 14.b) ⭐ Las intervenciones son un CONJUNTO, no una lista ordenada ─────
{
  const igual = cambiosServicio({
    antes: { ...ANTES, intervenciones: ['mecanica', 'electricidad'] },
    despues: { ...ANTES, intervenciones: ['electricidad', 'mecanica'] },
  });
  ok('⭐ desmarcar y volver a marcar (otro orden) NO es un cambio',
    igual.length === 0, JSON.stringify(igual));

  const repe = cambiosServicio({
    antes: { ...ANTES, intervenciones: ['mecanica'] },
    despues: { ...ANTES, intervenciones: ['mecanica', 'mecanica'] },
  });
  ok('una clave repetida tampoco es un cambio', repe.length === 0, JSON.stringify(repe));

  const dist = cambiosServicio({
    antes: { ...ANTES, intervenciones: ['mecanica'] },
    despues: { ...ANTES, intervenciones: ['mecanica', 'electricidad'] },
    nombres: { intervencion: (k) => (k === 'mecanica' ? 'Mecánica' : 'Electricidad') },
  });
  ok('agregar una intervención SÍ es un cambio', dist.length === 1, JSON.stringify(dist));
  ok('⭐ la intervención se nombra con su etiqueta, no con la clave',
    dist[0].a === 'Electricidad · Mecánica', dist[0].a);
}

// ── 14.c) La máquina y la avería se nombran, no se muestran por id ────────
{
  const c = cambiosServicio({
    antes: ANTES, despues: { ...ANTES, machinery_id: 'maq-2' },
    nombres: { maquina: (id) => (id === 'maq-1' ? 'CARGADOR 01' : 'JUMBO 330') },
  });
  ok('⭐ la máquina se nombra, no se muestra el uuid',
    c[0].de === 'CARGADOR 01' && c[0].a === 'JUMBO 330', `${c[0].de} → ${c[0].a}`);

  // Sin resolver, un uuid completo sería ilegible: se recorta pero no se miente.
  const sin = cambiosServicio({ antes: ANTES, despues: { ...ANTES, machinery_id: 'aaaaaaaa-bbbb-cccc' } });
  ok('sin quien lo nombre, el id se recorta', sin[0].a === 'aaaaaaaa', sin[0].a);

  const av = cambiosServicio({ antes: ANTES, despues: { ...ANTES, maintenance_request_id: 'av-9' } });
  ok('sin avería enlazada dice "ninguna", no vacío', av[0].de === 'ninguna', av[0].de);
}

// ── 14.d) Las fotos: se detecta por contenido, se dice en cantidad ────────
{
  const mas = cambiosServicio({ antes: ANTES, despues: { ...ANTES, photos: ['u1'] } });
  ok('agregar una foto es un cambio', mas.length === 1);
  ok('las fotos se cuentan, no se pega la URL',
    mas[0].de === 'sin fotos' && mas[0].a === '1 foto', `${mas[0].de} → ${mas[0].a}`);
  ok('la URL NO aparece en la bitácora', !/u1/.test(JSON.stringify(mas)), JSON.stringify(mas));

  const cambiada = cambiosServicio({
    antes: { ...ANTES, photos: ['u1'] }, despues: { ...ANTES, photos: ['u2'] },
  });
  ok('⭐ cambiar una foto por otra NO pasa desapercibido', cambiada.length === 1);
  ok('…y se dice que son distintas aunque sean la misma cantidad',
    /distintas/.test(cambiada[0].a), cambiada[0].a);

  const iguales = cambiosServicio({
    antes: { ...ANTES, photos: ['u1'] }, despues: { ...ANTES, photos: ['u1'] },
  });
  ok('la misma foto no es un cambio', iguales.length === 0);
}

// ── 14.e) Los repuestos ───────────────────────────────────────────────────
{
  const r = cambiosServicio({
    antes: ANTES, despues: { ...ANTES },
    repuestosAntes: [{ quantity: 2, description: 'Manguera 3/4"', estado: 'Nuevo' }],
    repuestosDespues: [
      { quantity: 2, description: 'Manguera 3/4"', estado: 'Nuevo' },
      { quantity: 1, description: 'Filtro de aceite', estado: 'Nuevo' },
    ],
  });
  ok('agregar un repuesto es un cambio', r.length === 1, JSON.stringify(r));
  ok('el repuesto se lee entero (cantidad, nombre y estado)',
    /2 · Manguera 3\/4" \(Nuevo\)/.test(r[0].de) && /Filtro de aceite/.test(r[0].a), r[0].a);

  // ⭐ El formulario SIEMPRE lleva un renglón vacío al final. Si contara, cada
  //    edición diría "cambiaron los repuestos" aunque no se tocara ninguno.
  const vacio = cambiosServicio({
    antes: ANTES, despues: { ...ANTES },
    repuestosAntes: [{ quantity: 2, description: 'Manguera', estado: 'Nuevo' }],
    repuestosDespues: [
      { quantity: 2, description: 'Manguera', estado: 'Nuevo' },
      { quantity: '', description: '', estado: 'Nuevo' },
    ],
  });
  ok('⭐ el renglón vacío del final NO cuenta como repuesto nuevo',
    vacio.length === 0, JSON.stringify(vacio));

  const quitar = cambiosServicio({
    antes: ANTES, despues: { ...ANTES },
    repuestosAntes: [{ quantity: 2, description: 'Manguera', estado: 'Nuevo' }],
    repuestosDespues: [],
  });
  ok('quitar todos los repuestos se ve como un guion', quitar[0].a === '—', quitar[0].a);
}

// ── 14.f) El resumen de una línea ─────────────────────────────────────────
{
  const c = (n) => Array.from({ length: n }, (_, i) => ({ campo: `c${i}`, etiqueta: `Campo ${i}`, de: 'a', a: 'b' }));
  ok('sin cambios el resumen lo dice', resumenCambios([]) === 'sin cambios', resumenCambios([]));
  ok('un cambio', resumenCambios(c(1)) === 'Campo 0', resumenCambios(c(1)));
  ok('dos cambios se unen con "y"', resumenCambios(c(2)) === 'Campo 0 y Campo 1', resumenCambios(c(2)));
  ok('más de dos se resumen', resumenCambios(c(5)) === 'Campo 0, Campo 1 y 3 más', resumenCambios(c(5)));
  ok('el resumen aguanta null', resumenCambios(null) === 'sin cambios');
}

// ── 14.g) ⭐ La fila de edición NO puede robarse el `created_by` ───────────
{
  const fila = filaServicioEdicion({ ...BASE, createdBy: 'usuario-viejo' }, 'usuario-nuevo', '2026-08-26T12:00:00Z');
  ok('⭐ editar NO manda created_by (no le cambia el dueño al registro)',
    !('created_by' in fila), JSON.stringify(Object.keys(fila)));
  ok('editar sella quién lo editó', fila.updated_by === 'usuario-nuevo', String(fila.updated_by));
  ok('editar sella cuándo', fila.updated_at === '2026-08-26T12:00:00Z', String(fila.updated_at));
  ok('lo demás va igual que al crear',
    fila.machinery_id === 'maq-1' && fila.technician === 'José Pérez' && fila.origen === 'interno');
  ok('sin quién edita, updated_by va nulo (no la cadena vacía)',
    filaServicioEdicion(BASE, '', '2026-01-01T00:00:00Z').updated_by === null);
}

// ── 14.h) ⭐ Editar sigue respetando LA FRONTERA ──────────────────────────
{
  const { db, ops, payloads } = dbEdicion({ partesViejas: [{ id: 'p-viejo-1' }] });
  const r = await editarServicio(db, 'orden-1', { ...BASE, maintenanceRequestId: 'av-1' },
    [{ quantity: 1, description: 'Filtro', estado: 'Nuevo' }],
    { id: 'u1', nombre: 'Ana Gómez', cambios: [{ campo: 'work_done', etiqueta: 'Acciones realizadas', de: 'x', a: 'y' }], ahoraIso: '2026-08-26T12:00:00Z' });

  ok('⭐ editar guarda sin error', !r.error, r.error);
  const tablas = ops.map((o) => o.split(':')[1]);
  ok('⭐ editar NO toca `machinery`', !tablas.includes('machinery'), ops.join(', '));
  ok('⭐ editar NO toca `maintenance_requests`', !tablas.includes('maintenance_requests'), ops.join(', '));
  ok('⭐ editar solo toca las tablas del módulo',
    tablas.every((t) => ['machinery_service_orders', 'machinery_service_parts', 'machinery_service_edits'].includes(t)),
    ops.join(', '));

  // ⭐ EL ORDEN. Insertar ANTES de borrar: si el insert falla, el servicio se
  //    queda con sus repuestos viejos en vez de quedarse sin ninguno.
  const iIns = ops.indexOf('insert:machinery_service_parts');
  const iDel = ops.indexOf('delete:machinery_service_parts');
  ok('⭐ los repuestos nuevos se INSERTAN antes de borrar los viejos',
    iIns >= 0 && iDel >= 0 && iIns < iDel, ops.join(' → '));
  ok('los viejos se leen de la base antes de nada',
    ops[0] === 'select:machinery_service_parts', ops.join(' → '));

  // La bitácora
  const bit = payloads['insert:machinery_service_edits'];
  ok('⭐ queda escrito QUIÉN editó', bit && bit.edited_by === 'u1', JSON.stringify(bit));
  ok('⭐ queda escrito el NOMBRE, copiado', bit && bit.edited_by_name === 'Ana Gómez', JSON.stringify(bit));
  ok('⭐ queda escrito QUÉ cambió', bit && Array.isArray(bit.changes) && bit.changes.length === 1, JSON.stringify(bit));
  ok('la bitácora apunta al servicio', bit && bit.service_order_id === 'orden-1');

  // Los repuestos nuevos llevan la FK y su posición.
  const rep = payloads['insert:machinery_service_parts'];
  ok('los repuestos nuevos llevan el id del servicio',
    Array.isArray(rep) && rep[0].service_order_id === 'orden-1', JSON.stringify(rep));
  ok('y su posición', Array.isArray(rep) && rep[0].position === 0);
}

// ── 14.i) Sin cambios que anotar, no se escribe bitácora ─────────────────
{
  const { db, ops } = dbEdicion({ partesViejas: [] });
  await editarServicio(db, 'orden-1', BASE, [], { id: 'u1', cambios: [] });
  ok('sin cambios anotados no se escribe en la bitácora',
    !ops.some((o) => o.includes('machinery_service_edits')), ops.join(', '));
}

// ── 14.j) ⭐ Si falta el SQL, el servicio SE GUARDA IGUAL y se avisa ──────
{
  const { db } = dbEdicion({
    partesViejas: [],
    errores: { 'insert:machinery_service_edits': { message: 'relation "public.machinery_service_edits" does not exist' } },
  });
  const r = await editarServicio(db, 'orden-1', BASE, [], {
    id: 'u1', cambios: [{ campo: 'work_done', etiqueta: 'Acciones realizadas', de: 'x', a: 'y' }],
  });
  ok('⭐ sin la tabla de bitácora, la edición NO falla', !r.error, r.error);
  ok('⭐ …pero avisa que no quedó el rastro', !!r.avisoBitacora, String(r.avisoBitacora));
  ok('⭐ …y dice qué archivo hay que correr',
    /servicio_editar\.sql/.test(r.avisoBitacora || ''), String(r.avisoBitacora));
  ok('el aviso no le echa un código de Postgres en la cara al usuario',
    !/42P01|relation/.test(r.avisoBitacora || ''), String(r.avisoBitacora));
}

// ── 14.k) Los errores que SÍ tienen que parar la edición ─────────────────
{
  const { db } = dbEdicion();
  const sinId = await editarServicio(db, '', BASE, []);
  ok('sin id no se edita nada', !!sinId.error, String(sinId.error));

  const malo = await editarServicio(db, 'o1', { ...BASE, technician: '' }, []);
  ok('un servicio inválido no se guarda al editar', !!malo.error, String(malo.error));
  ok('y el error es el mismo texto en cristiano de siempre',
    malo.error === validarServicio({ ...BASE, technician: '' }), String(malo.error));

  const { db: db2 } = dbEdicion({ partesViejas: [], errores: { update: { message: 'sin permiso' } } });
  const falla = await editarServicio(db2, 'o1', BASE, [], { id: 'u1', cambios: [{ campo: 'a', etiqueta: 'A', de: '1', a: '2' }] });
  ok('si falla el update, se avisa y no se sigue', falla.error === 'sin permiso', String(falla.error));

  // Si fallan los repuestos, el servicio YA se guardó: hay que decirlo así.
  const { db: db3 } = dbEdicion({
    partesViejas: [{ id: 'x' }],
    errores: { 'insert:machinery_service_parts': { message: 'se cayó la red' } },
  });
  const parcial = await editarServicio(db3, 'o1', BASE, [{ quantity: 1, description: 'Filtro' }], { id: 'u1' });
  ok('si fallan los repuestos, dice que los DATOS sí se guardaron',
    /se guardaron los datos del servicio/i.test(parcial.error || ''), String(parcial.error));
}


// ══════════════════════════════════════════════════════════════════════════
// 15) GUARDAS SOBRE LA PANTALLA Y SOBRE EL SQL DE LA EDICIÓN
//     Lo que `tsc` no ve y las funciones puras tampoco: el cableado.
// ══════════════════════════════════════════════════════════════════════════
{
  const scr = fs.readFileSync(path.join(ROOT, 'src/screens/ServicioRegistroTab.tsx'), 'utf8');

  const cuerpo = (arranque) => {
    const i = scr.indexOf(arranque);
    return i < 0 ? '' : scr.slice(i, scr.indexOf('\n  };', i));
  };
  // ⚠️ FUERA LOS COMENTARIOS ANTES DE CONTAR. Sin esto, comentar un
  //    `setFotos(...)` dejaba la palabra en el archivo, la prueba la seguía
  //    contando y el mutante sobrevivía — la guarda no valía nada (probado:
  //    3 de 3 mutantes vivos hasta que se agregó esta línea).
  const setters = (txt) => new Set(
    [...txt.replace(/\/\/[^\n]*/g, '').matchAll(/\bset([A-Z]\w*)\(/g)].map((m) => m[1])
  );

  const limpia = setters(cuerpo('const limpiarForm = () => {'));
  const edita = setters(cuerpo('const abrirEditar = (o: Orden) => {'));

  ok('existe `abrirEditar`', edita.size > 0);
  // ⭐ LA GUARDA QUE MÁS IMPORTA. Es el MISMO formulario para crear y para
  //    editar: si `abrirEditar` se olvida de cargar un campo, ese campo llega
  //    vacío al guardado y la edición LO BORRA sin decir nada. Cuando se agregue
  //    un campo nuevo al formulario, esta prueba avisa que hay que cargarlo.
  const faltan = [...limpia].filter((c) => !edita.has(c));
  ok('⭐ `abrirEditar` carga TODOS los campos que `limpiarForm` resetea (si no, editar los borra)',
    faltan.length === 0, 'no carga: ' + faltan.join(', '));

  ok('salir del formulario también sale del modo edición',
    /const limpiarForm = \(\) => \{[\s\S]{0,400}setEditandoId\(null\)/.test(scr));
  ok('cancelar limpia el formulario (no deja el modo edición pegado)',
    /label="Cancelar" onPress=\{\(\) => \{ setFormOpen\(false\); limpiarForm\(\); \}\}/.test(scr));

  ok('existe el botón "✏️ Editar"', scr.includes('✏️ Editar'));
  ok('⭐ el botón de editar solo sale con permiso de escritura',
    /canWrite \?[\s\S]{0,260}abrirEditar\(o\)/.test(scr));
  ok('⭐ "🕓 Ver cambios" NO exige permiso de escritura (el que solo mira también necesita saberlo)',
    /o\.updated_at \?\s*\([\s\S]{0,200}verCambios\(o\)/.test(scr));
  ok('la línea de "última edición" solo aparece si de verdad se editó',
    /\{o\.updated_at \?[\s\S]{0,300}Última edición/.test(scr));

  ok('el título del formulario cambia según el modo',
    /editandoId \? '✏️ Editar servicio' : '🔧 Registrar servicio'/.test(scr));
  ok('el botón de guardar también', /editandoId \? '💾 Guardar cambios' : '💾 Guardar'/.test(scr));

  // El «qué cambió» sale de la función pura, no de una copia hecha en la pantalla.
  ok('la pantalla usa `cambiosServicio`, no un diff propio', /cambiosServicio\(\{/.test(scr));
  ok('compara filas de base contra filas de base (`filaServicio`)',
    /despues: filaServicio\(inp\)/.test(scr));
  ok('⭐ la pantalla NO reimplementa el diff', !/\bde: [^,\n]*,\s*a: [^,\n]*\}\);?\s*$/m.test(scr));

  // La frontera, también en la pantalla.
  ok('⭐ la pantalla sigue sin escribir en `machinery`',
    !/from\('machinery'\)[\s\S]{0,80}\.(update|insert|delete)/.test(scr));
  ok('⭐ la pantalla sigue sin escribir en `maintenance_requests`',
    !/from\('maintenance_requests'\)[\s\S]{0,80}\.(update|insert|delete)/.test(scr));
  // Los nombres se leen, nunca se escriben.
  ok('a `profiles` solo se le lee el nombre',
    !/from\('profiles'\)[\s\S]{0,80}\.(update|insert|delete)/.test(scr));

  // Si no hay nada que anotar, no se anota.
  ok('sin cambios no se escribe bitácora', /if \(!cambios\.length\)/.test(scr));
  // El aviso de "no quedó el rastro" no puede salir como un ✅.
  ok('⭐ si no quedó el rastro se avisa como ERROR, no como éxito',
    /if \(re\.avisoBitacora\) return toast\.error\(/.test(scr));
}

// ── 15.b) El SQL que hay que correr a mano ────────────────────────────────
{
  const sqlPath = path.join(ROOT, 'supabase/servicio_editar.sql');
  ok('existe supabase/servicio_editar.sql', fs.existsSync(sqlPath));
  const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';
  // Solo lo que de verdad se ejecuta (fuera los comentarios).
  const vivo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();

  ok('el archivo avisa que hay que correrlo a mano', /A MANO|a mano/.test(sql));
  ok('las columnas se agregan de forma idempotente',
    /add column if not exists updated_at/.test(vivo) && /add column if not exists updated_by/.test(vivo));
  ok('la bitácora se crea de forma idempotente',
    /create table if not exists public\.machinery_service_edits/.test(vivo));
  ok('la bitácora se borra con su servicio', /on delete cascade/.test(vivo));
  ok('el nombre de quien editó se guarda copiado', /edited_by_name\s+text/.test(vivo));
  ok('el detalle va en jsonb', /changes\s+jsonb/.test(vivo));

  // ⭐ UNA BITÁCORA QUE SE PUEDE EDITAR NO ES UNA BITÁCORA.
  ok('⭐ la bitácora NO tiene política de update ni de delete',
    !/create policy[^\n]*machinery_service_edits[^\n]*for (update|delete)/.test(vivo)
    && !/for (update|delete) to authenticated[\s\S]{0,120}machinery_service_edits/.test(vivo));
  ok('⭐ y se le quitan esos privilegios explícitamente',
    /revoke update, delete on public\.machinery_service_edits from authenticated/.test(vivo));
  ok('se puede leer y agregar', /grant select, insert on public\.machinery_service_edits/.test(vivo));
  ok('la bitácora tiene RLS encendido',
    /alter table public\.machinery_service_edits enable row level security/.test(vivo));
  ok('escribir la bitácora exige poder escribir el módulo',
    /can_write_module\('servicio'\)/.test(vivo));

  // ⚠️ NADA DESTRUCTIVO, y nada fuera del módulo.
  ok('⭐ NO borra ni vacía datos',
    !/\bdelete from\b/.test(vivo) && !/\bdrop table\b/.test(vivo) && !/\btruncate\b/.test(vivo));
  ok('⭐ NO toca `machinery`', !/alter table[^\n]*\bpublic\.machinery\b/.test(vivo));
  ok('⭐ NO toca `maintenance_requests`', !/\bmaintenance_requests\b/.test(vivo));
  ok('⭐ NO toca nada de Inspecciones',
    !/machine_inspections|supervisor_visits|machine_inspectors/.test(vivo));
  ok('trae su bloque de verificación', /pg_policies|pg_indexes/.test(vivo));
}


// ══════════════════════════════════════════════════════════════════════════
// 16) QUE LA VISTA PREVIA NO SE VUELVA A PONER LENTA (26-ago-2026)
//     El taller reportó «la vista previa tarda muchísimo en cargar». Estas
//     guardas cuidan los tres arreglos que lo destrabaron.
// ══════════════════════════════════════════════════════════════════════════
{
  const scr = fs.readFileSync(path.join(ROOT, 'src/screens/ServicioRegistroTab.tsx'), 'utf8');
  const rep = fs.readFileSync(path.join(ROOT, 'src/lib/machineServiceReport.ts'), 'utf8');
  const pdf = fs.readFileSync(path.join(ROOT, 'src/lib/pdf.ts'), 'utf8');

  // ── 16.a) La ventana se pinta ANTES de escribir el documento ─────────────
  // Si `cdoc.write(html)` vuelve a quedar pegado al `appendChild(overlay)`, todo
  // pasa en una sola tarea del hilo y la app se ve CONGELADA hasta el final.
  const iWrite = pdf.indexOf('cdoc.write(html)');
  ok('⭐ el documento se escribe dentro de una función diferida, no en línea',
    /const escribirDocumento = \(\) => \{[\s\S]{0,400}cdoc\.write\(html\)/.test(pdf));
  ok('⭐ y se difiere de verdad (requestAnimationFrame o setTimeout)',
    /requestAnimationFrame[\s\S]{0,200}escribirDocumento|setTimeout\(escribirDocumento/.test(pdf));
  ok('⭐ NO se escribe inmediatamente después de insertar el overlay',
    !/d\.body\.appendChild\(overlay\);[\s\S]{0,200}cdoc\.write\(html\)/.test(pdf), 'volvió a ser síncrono');
  ok('la ventana avisa que está preparando', /Preparando la vista previa/.test(pdf));
  ok('si el usuario cierra mientras prepara, no se escribe nada',
    /const escribirDocumento = \(\) => \{\s*\n\s*if \(closed\) return;/.test(pdf));
  ok('el escritor diferido no puede tumbar la app', iWrite > 0 && /escribirDocumento = \(\) => \{[\s\S]{0,600}catch/.test(pdf));

  // ── 16.b) Las fotos no frenan la maquetación ─────────────────────────────
  // Se guardan a 1600px y se pintan a 104x78. Sin medidas, el navegador espera
  // a descargarlas para saber cuánto ocupan y no puede armar la página.
  const imgs = [...rep.matchAll(/<img class="(hoja-foto|sv-photo)"[^`]*/g)].map((m) => m[0]);
  ok('hay dos imágenes remotas en el reporte', imgs.length === 2, String(imgs.length));
  ok('⭐ TODAS llevan width y height (si no, la página no se puede maquetar sin bajarlas)',
    imgs.every((t) => /width="\d+"/.test(t) && /height="\d+"/.test(t)), imgs.join(' | '));
  ok('⭐ TODAS se decodifican aparte del hilo que maqueta',
    imgs.every((t) => /decoding="async"/.test(t)), imgs.join(' | '));

  // ── 16.c) El reporte no arrastra el histórico completo ───────────────────
  ok('⭐ las dos consultas del PDF van a la vez, no en serie',
    /await Promise\.all\(\[\s*\n\s*traerFichas\(ids\)/.test(scr));
  ok('⭐ los expedientes viejos se acotan por fecha EN EL SERVIDOR',
    /traerViejos[\s\S]{0,900}\.gte\('out_at'/.test(scr) && /traerViejos[\s\S]{0,900}\.lt\('out_at'/.test(scr));
  ok('⭐ …y paginan (antes PostgREST los cortaba en 1000 en silencio)',
    /const traerViejos[\s\S]{0,400}selectAllRows\('machinery_repairs'/.test(scr));
  ok('⭐ el rango del servidor va ESTIRADO, para no perder filas por zona horaria',
    /masDias\(fDesde, -1\)/.test(scr) && /masDias\(fHasta, 2\)/.test(scr));
  // El filtro fino de la pantalla SIGUE mandando: es lo que garantiza que el
  // resultado no cambió. Si alguien lo quita creyendo que ya sobra, el PDF
  // empezaría a traer días de más.
  ok('⭐ el filtro fino de la pantalla sigue existiendo y sigue aplicándose',
    /const dentro = \(d\?: string \| null\)/.test(scr)
    && /\.filter\(\(v: any\) => v\.machinery_id === id && dentro\(v\.out_at\)\)/.test(scr));
  ok('ya no queda la consulta vieja sin filtrar',
    !/\.from\('machinery_repairs'\)\s*\n?\s*\.select\([^)]*\)\s*\n?\s*\.eq\('tipo', 'correctivo'\)\s*\n?\s*\.in\('machinery_id', ids\)\s*\n?\s*:/.test(scr));

  // `masDias` tiene que dar el día correcto, o el filtro del servidor recorta mal.
  {
    const m = scr.match(/const masDias = \(iso: string, n: number\) => \{[\s\S]*?\n  \};/);
    ok('existe `masDias`', !!m);
    if (m) {
      const masDias = new Function('return ' + m[0].replace('const masDias = ', '').replace(/;$/, '')
        .replace(/: string|: number/g, ''))();
      ok('masDias(+1) cruza bien el fin de mes', masDias('2026-08-31', 1) === '2026-09-01', masDias('2026-08-31', 1));
      ok('masDias(-1) cruza bien el inicio de mes', masDias('2026-09-01', -1) === '2026-08-31', masDias('2026-09-01', -1));
      ok('masDias(+2) suma dos días', masDias('2026-08-26', 2) === '2026-08-28', masDias('2026-08-26', 2));
      ok('masDias aguanta año bisiesto', masDias('2028-02-28', 1) === '2028-02-29', masDias('2028-02-28', 1));
    }
  }
}

if (fail) {
  console.log(`✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nEl taller registra lo suyo y no mueve el estado de ninguna máquina.`);
