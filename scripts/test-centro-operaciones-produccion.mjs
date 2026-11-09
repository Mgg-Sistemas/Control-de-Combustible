// 🏭 CENTRO DE OPERACIONES · ⚙️ PRODUCCIÓN DE TRITURACIÓN (06-nov-2026).
//
// Pedido de la encargada del CDT (dos audios; el segundo corrige al primero):
//   · bloque 2 del Parte diario: horas × t/h = toneladas, por equipo (Trituradora 1, la 2 de
//     Ecosocialismo y el cono, que se activan cuando estén en sitio);
//   · dos modos: triturado mixto (un producto) y cribado (clasificado en los % que ella ve);
//   · NO descuenta ni limita las salidas (el cernidor también produce y no se mide): la
//     comparación con lo que salió es SOLO informativa;
//   · va en el Reporte completo, de segunda.
// Esta prueba recorre los escenarios: lecturas raras («10:30», coma, vacío, > 24), % que no
// suman 100, repetidos, reparto exacto, tope de 24 h por equipo y día, varias líneas,
// equipos inactivos con historia, lo congelado, el papel y el cableado de la pantalla.
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
function loadTs(abs) {
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
    if (id === './supabase' || id.endsWith('/supabase')) return { supabase: {}, selectAllRows: async () => [] };
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, abs);
  cache.set(abs, m.exports);
  return m.exports;
}

let ok = 0; const fallas = [];
const check = (cond, msg, extra) => { if (cond) ok++; else fallas.push('  ✗ ' + msg + (extra !== undefined ? `\n      ${JSON.stringify(extra)}` : '')); };
const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), msg, { esperado: b, obtenido: a });

const P = loadTs(path.join(ROOT, 'src/lib/centroOperacionesProduccion.ts'));
const RC = loadTs(path.join(ROOT, 'src/lib/centroOperacionesReporteCompleto.ts'));
const PAPEL = loadTs(path.join(ROOT, 'src/lib/centroOperacionesPapel.ts'));

const lista = (nombre, factor) => ({ id: 'l-' + nombre, sitioId: 'S', clase: 'material', nombre, activo: true, lat: null, lng: null, km: null, factorTM3: factor, diasDisponible: null });
const LISTAS = [lista('Triturado mixto', 1.4), lista('Polvillo', 1.5), lista('Arrocillo', 1.3)];
const EQ1 = { id: 'e1', sitioId: 'S', nombre: 'Trituradora 1', tipo: 'trituradora', codigo: null, serial: null, thDefecto: 250, activo: true, orden: 1, nota: null };
const EQ2 = { id: 'e2', sitioId: 'S', nombre: 'Trituradora 2 (Ecosocialismo)', tipo: 'trituradora', codigo: null, serial: null, thDefecto: null, activo: false, orden: 2, nota: null };
const EQ3 = { id: 'e3', sitioId: 'S', nombre: 'Cono triturador', tipo: 'cono', codigo: null, serial: null, thDefecto: 300, activo: false, orden: 3, nota: null };
const prod = (o) => ({ id: 'p' + Math.random(), sitioId: 'S', fecha: '2026-11-06', equipoId: 'e1', equipoNombre: 'Trituradora 1', modo: 'mixto', horas: 6, tPorHora: 250, toneladas: 1500, reparto: [{ producto: 'Triturado mixto', pct: 100, factor: 1.4 }], nota: null, creadoPor: 'María', creadoAt: '2026-11-06T12:00:00Z', editadoPor: null, editadoAt: null, ...o });

// ═══════ 1. Leer las horas ═══════
{
  const h = (t) => { const r = P.leerHoras(t); return r.ok ? r.valor : 'ERR'; };
  eq(h('10'), 10, 'horas: «10»');
  eq(h('10,5'), 10.5, 'horas: «10,5» (coma)');
  eq(h('10.5'), 10.5, 'horas: «10.5» (punto)');
  eq(h('10:30'), 10.5, '⭐ horas: «10:30» = diez y media');
  eq(h('7:15'), 7.25, 'horas: «7:15»');
  eq(h('24'), 24, 'horas: 24 es el máximo y vale');
  eq(h('24,5'), 'ERR', 'horas: más de 24 no');
  eq(h('0'), 'ERR', 'horas: 0 no');
  eq(h('abc'), 'ERR', 'horas: letras no');
  eq(h('10:75'), 'ERR', 'horas: 75 minutos no');
  const v = P.leerHoras('   ');
  check(!v.ok && v.vacio === true, 'horas: vacío se marca como vacío (no se pinta en rojo antes de guardar)');
  eq(P.textoHoras(10.5), '10 h 30 min', 'textoHoras: 10,5 → «10 h 30 min»');
  eq(P.textoHoras(4), '4 h', 'textoHoras: 4 → «4 h»');
}

// ═══════ 2. t/h y % ═══════
{
  const t = (x) => { const r = P.leerTph(x); return r.ok ? r.valor : 'ERR'; };
  eq(t('250'), 250, 't/h: 250');
  eq(t('262,5'), 262.5, 't/h: con coma');
  eq(t('1.200'), 1.2, 't/h: «1.200» se lee como 1,2 (un punto es decimal, igual que en todo el sistema)');
  eq(t('0'), 'ERR', 't/h: 0 no');
  eq(t('6000'), 'ERR', 't/h: más de 5.000 no');
  const p = (x) => { const r = P.leerPct(x); return r.ok ? r.valor : 'ERR'; };
  eq(p('30'), 30, '%: 30');
  eq(p('30 %'), 30, '%: con el signo');
  eq(p('12,5'), 12.5, '%: con decimales');
  eq(p('0'), 'ERR', '%: 0 no (si no salió, se quita el producto)');
  eq(p('120'), 'ERR', '%: más de 100 no');
}

// ═══════ 3. Reparto del cribado ═══════
{
  const r = P.revisarReparto([{ producto: 'Polvillo', pct: '30' }, { producto: 'Arrocillo', pct: '40' }, { producto: 'Estéril', pct: '30' }], LISTAS);
  check(r.ok && r.texto === 'Suman 100 % ✅', '⭐ cribado 30/40/30 suma 100 ✅', r);
  eq(r.items.map((i) => i.factor), [1.5, 1.3, 1.2], 'cribado: cada producto con el factor de SU material; sin lista, 1,2');
  // El ejemplo del audio: 60 % + 40 % + 10 % = 110 %.
  const r2 = P.revisarReparto([{ producto: 'Polvillo', pct: '60' }, { producto: 'Arrocillo', pct: '40' }, { producto: 'Estéril', pct: '10' }], LISTAS);
  check(!r2.ok && r2.texto === 'Suman 110 %: sobran 10 %', '⭐ el ejemplo del audio (60+40+10) NO se deja guardar: «sobran 10 %»', r2.texto);
  const r3 = P.revisarReparto([{ producto: 'Polvillo', pct: '30' }, { producto: 'Arrocillo', pct: '40' }], LISTAS);
  check(!r3.ok && r3.texto === 'Suman 70 %: faltan 30 %', 'cribado: «faltan 30 %»', r3.texto);
  const r4 = P.revisarReparto([{ producto: 'Polvillo', pct: '50' }, { producto: 'polvillo ', pct: '50' }], LISTAS);
  check(!r4.ok && r4.errores.some((e) => /repetido/.test(e)), 'cribado: el mismo producto dos veces (mayúsculas/espacios) no');
  const r5 = P.revisarReparto([{ producto: '', pct: '100' }], LISTAS);
  check(!r5.ok && r5.errores.some((e) => /sin el nombre/.test(e)), 'cribado: un % sin nombre no');
  const r6 = P.revisarReparto([{ producto: '', pct: '' }, { producto: '', pct: '' }], LISTAS);
  check(!r6.ok && r6.errores.some((e) => /al menos un producto/.test(e)), 'cribado: todo vacío pide al menos un producto');
  const r7 = P.revisarReparto([{ producto: 'Polvillo', pct: '33,33' }, { producto: 'Arrocillo', pct: '33,33' }, { producto: 'Estéril', pct: '33,34' }], LISTAS);
  check(r7.ok, 'cribado: tercios con decimales (33,33+33,33+33,34) suman 100');
  check(P.revisarReparto([{ producto: 'Gravilla', pct: '100' }], LISTAS).ok, 'cribado: se puede escribir un producto nuevo (no está en la lista) → factor 1,2');
}

// ═══════ 4. Desglose exacto ═══════
{
  const d = P.desglosar(1000, [{ producto: 'A', pct: 33.33, factor: 1.2 }, { producto: 'B', pct: 33.33, factor: 1.2 }, { producto: 'C', pct: 33.34, factor: 1.2 }]);
  const suma = Math.round(d.reduce((s, x) => s + x.toneladas, 0) * 100) / 100;
  eq(suma, 1000, '⭐ el reparto en toneladas cuadra EXACTO con el total (el último absorbe el redondeo)');
  const d2 = P.desglosar(1000, [{ producto: 'Polvillo', pct: 30, factor: 1.5 }, { producto: 'Arrocillo', pct: 40, factor: 1.3 }, { producto: 'Estéril', pct: 30, factor: null }]);
  eq(d2.map((x) => [x.producto, x.toneladas, x.m3]), [['Polvillo', 300, 200], ['Arrocillo', 400, 307.69], ['Estéril', 300, 250]], 'desglose: t y m³ con el factor de cada producto (sin factor = 1,2)');
  // El ejemplo del audio: 1.400 t ≈ 1.000 m³ → factor 1,4.
  eq(P.desglosar(1400, P.repartoMixto(LISTAS))[0].m3, 1000, '⭐ el ejemplo del audio: 1.400 t de triturado mixto con factor 1,4 = 1.000 m³');
  eq(P.toneladasDe(10.5, 250), 2625, 'toneladas: 10,5 h × 250 t/h = 2.625 t');
  eq(P.toneladasDe(1 / 3, 250), 83.33, 'toneladas: se redondean a 2 decimales (igual que la base)');
  eq(P.desglosar(0, P.repartoMixto(LISTAS))[0].toneladas, 0, 'desglose de 0 t no da NaN');
}

// ═══════ 5. El formulario completo ═══════
{
  const base = P.formVacio(EQ1, null);
  eq([base.modo, base.tph, base.horas], ['mixto', '250', ''], '⭐ el formulario arranca en triturado mixto con la t/h POR DEFECTO del equipo');
  eq(base.reparto.map((r) => r.producto), ['Polvillo', 'Arrocillo', 'Estéril'], 'el cribado arranca con polvillo, arrocillo y estéril');
  eq(P.formVacio(EQ2, null).tph, '', 'un equipo sin t/h por defecto arranca vacío');
  const conUltimo = P.formVacio(EQ1, [{ producto: 'Polvillo', pct: 35, factor: 1.5 }, { producto: 'Arrocillo', pct: 45, factor: 1.3 }, { producto: 'Estéril', pct: 20, factor: 1.2 }]);
  eq(conUltimo.reparto, [{ producto: 'Polvillo', pct: '35' }, { producto: 'Arrocillo', pct: '45' }, { producto: 'Estéril', pct: '20' }], '⭐ el cribado propone los % del ÚLTIMO cribado de ese equipo');
  check(!P.formCambio(base, base), 'sin tocar nada no cuenta como «sin guardar»');
  check(P.formCambio({ ...base, horas: '4' }, base), 'escribir las horas sí cuenta como «sin guardar»');
  check(!P.formCambio({ ...base, reparto: [{ producto: 'X', pct: '1' }] }, base), 'en triturado mixto, las filas del cribado no cuentan');

  const ok1 = P.revisarForm({ ...base, horas: '6' }, LISTAS, 0, 'Trituradora 1');
  check(ok1.ok && ok1.toneladas === 1500 && ok1.datos.reparto[0].producto === 'Triturado mixto', '⭐ 6 h × 250 t/h = 1.500 t de triturado mixto', ok1);
  const tope = P.revisarForm({ ...base, horas: '6' }, LISTAS, 20, 'Trituradora 1');
  check(!tope.ok && tope.errores.some((e) => /ya tiene 20 h/.test(e) && /serían 26 h/.test(e)), '⭐ tope: con 20 h ya anotadas, 6 h más (26) no se dejan', tope.errores);
  check(P.revisarForm({ ...base, horas: '4' }, LISTAS, 20, 'Trituradora 1').ok, 'tope: 20 + 4 = 24 sí');
  const crib = P.revisarForm({ ...base, modo: 'cribado', horas: '4', reparto: [{ producto: 'Polvillo', pct: '60' }, { producto: 'Arrocillo', pct: '40' }, { producto: 'Estéril', pct: '10' }] }, LISTAS, 6, 'Trituradora 1');
  check(!crib.ok && crib.toneladas === 1000 && crib.desglose.length === 0, 'cribado mal repartido: muestra las t pero no el desglose ni deja guardar');
  const crib2 = P.revisarForm({ ...base, modo: 'cribado', horas: '4', tph: '265', reparto: [{ producto: 'Polvillo', pct: '30' }, { producto: 'Arrocillo', pct: '40' }, { producto: 'Estéril', pct: '30' }] }, LISTAS, 6, 'Trituradora 1');
  check(crib2.ok && crib2.toneladas === 1060 && crib2.desglose.length === 3, '⭐ el caso del audio: 10 h prendida, 4 cribando a 265 t/h = 1.060 t clasificadas', crib2);
  const vacio = P.revisarForm({ ...base, tph: '' }, LISTAS, 0, 'Trituradora 1');
  check(!vacio.ok && vacio.errores.length === 2 && vacio.toneladas === null, 'sin horas ni t/h: dos avisos y sin total');
  check(P.revisarForm({ ...base, horas: '5', nota: '  mandíbula abierta  ' }, LISTAS, 0, 'T').datos.nota === 'mandíbula abierta', 'la nota se limpia de espacios');
}

// ═══════ 6. Lo del día ═══════
{
  const lineas = [
    prod({ id: 'a', horas: 6, toneladas: 1500 }),
    prod({ id: 'b', modo: 'cribado', horas: 4, tPorHora: 265, toneladas: 1060, reparto: [{ producto: 'Polvillo', pct: 30, factor: 1.5 }, { producto: 'Arrocillo', pct: 40, factor: 1.3 }, { producto: 'Estéril', pct: 30, factor: 1.2 }] }),
    prod({ id: 'c', fecha: '2026-11-05', horas: 10, toneladas: 2500 }),
    prod({ id: 'd', equipoId: 'e2', equipoNombre: 'Trituradora 2 (Ecosocialismo)', horas: 3, toneladas: 600 }),
  ];
  eq(P.horasDelEquipo(lineas, 'e1', '2026-11-06'), 10, '⭐ las horas del equipo en la jornada suman sus líneas (6 + 4), sin las de otro día ni de otro equipo');
  eq(P.horasDelEquipo(lineas, 'e1', '2026-11-06', 'b'), 6, 'al corregir una línea, sus horas no cuentan contra el tope');
  eq(P.ultimoRepartoCribado(lineas, 'e1').map((r) => r.pct), [30, 40, 30], 'el último cribado del equipo');
  eq(P.ultimoRepartoCribado(lineas, 'e3'), null, 'un equipo sin cribados: null');
  eq(P.equiposDelDia([EQ3, EQ2, EQ1], lineas, '2026-11-06').map((e) => e.id), ['e1', 'e2'], '⭐ se muestran los activos + los inactivos CON algo anotado ese día (lo anotado nunca desaparece)');
  eq(P.equiposDelDia([EQ3, EQ2, EQ1], lineas, '2026-11-07').map((e) => e.id), ['e1'], 'otro día: solo los activos');
  const t = P.totalesProduccion(lineas.filter((l) => l.fecha === '2026-11-06' && l.equipoId === 'e1'));
  eq([t.horas, t.toneladas, t.porProducto.map((x) => x.producto)], [10, 2560, ['Triturado mixto', 'Arrocillo', 'Estéril', 'Polvillo']], 'totales: horas, toneladas y productos (el mixto primero)');
  eq(P.resumenBloqueProduccion(lineas, '2026-11-07'), 'Sin producción anotada', 'plegado sin nada: «Sin producción anotada»');
  check(/^13 h · 3\.160,00 t · ≈ /.test(P.resumenBloqueProduccion(lineas, '2026-11-06')), 'plegado con algo: horas, t y m³', P.resumenBloqueProduccion(lineas, '2026-11-06'));
  eq(P.textoLinea(lineas[0]), '🪨 Triturado mixto · 6 h × 250 t/h = 1.500,00 t', 'una línea en palabras');
}

// ═══════ 7. Producido vs. salido (INFORMATIVO) ═══════
{
  const sal = (o) => ({ id: 's' + Math.random(), sitioId: 'S', fecha: '2026-11-06', hora: null, tipo: 'salida', material: 'Triturado mixto', estado: 'confirmado', viajes: 1, toneladas: 100, m3: 70, destino: 'X', unidadTexto: null, unidadId: null, placa: null, transportista: null, origen: null, capacidadM3: null, observacion: null, cantidad: null, unidadIngresada: 't', ...o });
  const movs = [sal({ toneladas: 1000, m3: 714.29 }), sal({ material: 'Arrocillo', toneladas: 600, m3: 461.54 }), sal({ material: 'Arena del cernidor', toneladas: 50, m3: 40 }), sal({ material: 'Polvillo', estado: 'por_confirmar', toneladas: 999 })];
  const f = P.producidoVsSalido([prod({ horas: 5.6, tPorHora: 250, toneladas: 1400 })], movs);
  const mixto = f.find((x) => x.producto === 'Triturado mixto');
  check(mixto && mixto.producidoT === 1400 && mixto.salidoT === 1000 && mixto.diferenciaT === -400, '⭐ el ejemplo del audio: produjo 1.400, salió 1.000 → diferencia −400 (solo se informa)', mixto);
  const arena = f.find((x) => x.producto === 'Arena del cernidor');
  check(arena && arena.producidoT === 0 && arena.salidoT === 50, '⭐ lo que salió sin pasar por la trituradora (cernidor) también se lista, sin error');
  check(!f.some((x) => x.producto === 'Polvillo'), 'una salida «por confirmar» no cuenta');
  check(/no se mide/.test(P.NOTA_CERNIDOR) && /No descuenta ni limita/.test(P.NOTA_CERNIDOR), 'la nota del cernidor dice que solo informa');
  // ⭐ Nada de la librería toca las salidas: no hay ninguna función que las cambie.
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/centroOperacionesProduccion.ts'), 'utf8');
  check(!/guardarMovimiento|cop_movimientos|from\(/.test(src), '⭐ la librería no escribe en las salidas ni habla con la base');
}

// ═══════ 8. Filas de la base (congelado) ═══════
{
  const fila = P.produccionAFila({ sitioId: 'S', fecha: '2026-11-06', equipo: EQ1, modo: 'mixto', horas: 6, tPorHora: 250, reparto: P.repartoMixto(LISTAS), nota: '  ' });
  check(!('toneladas' in fila), '⭐ las toneladas NO se mandan: las calcula la base (columna generada)');
  eq([fila.equipo_nombre, fila.reparto[0].factor, fila.nota], ['Trituradora 1', 1.4, null], 'se congela el nombre del equipo y el factor del producto; la nota vacía va null');
  const p = P.filaAProduccion({ id: 'x', sitio_id: 'S', fecha: '2026-11-06', equipo_id: 'e1', equipo_nombre: 'T1', modo: 'cribado', horas: '4', t_por_hora: '265', toneladas: '1060', reparto: [{ producto: 'Polvillo', pct: 30, factor: 1.5 }, { producto: '', pct: 10 }] });
  eq([p.horas, p.tPorHora, p.toneladas, p.reparto.length], [4, 265, 1060, 1], 'de la base: números en texto se leen y un producto sin nombre se descarta');
  eq(P.filaAEquipo({ id: 'e', sitio_id: 'S', nombre: ' Cono ', tipo: 'raro', activo: false, th_defecto: '300' }).tipo, 'otro', 'un tipo desconocido cae en «otro»');
  eq(P.equipoAFila({ thDefecto: 0, codigo: '  ' }), { codigo: null, th_defecto: null }, 'equipo: t/h 0 y código vacío se guardan como null');
  // Equipos: nombre obligatorio y sin repetir entre los activos.
  check(!P.revisarEquipo({ ...P.formEquipoVacio(), nombre: '  ' }, [EQ1], null).ok, 'equipo sin nombre no');
  check(!P.revisarEquipo({ ...P.formEquipoVacio(), nombre: 'trituradora 1' }, [EQ1], null).ok, '⭐ equipo repetido con un activo no');
  check(P.revisarEquipo({ ...P.formEquipoVacio(), nombre: 'Cono triturador' }, [EQ1, EQ3], null).ok, 'mismo nombre que uno DADO DE BAJA sí (la base solo exige únicos entre activos)');
  check(P.revisarEquipo(P.formDeEquipo(EQ1), [EQ1], 'e1').ok, 'editar un equipo sin cambiarle el nombre no choca consigo mismo');
  check(!P.revisarEquipo({ ...P.formEquipoVacio(), nombre: 'X', th: 'abc' }, [], null).ok, 'equipo con t/h que no es número no');
}

// ═══════ 9. El papel: sección 2 del Reporte completo ═══════
{
  eq(PAPEL.SECCIONES_COP.completo.map((s) => s.k).slice(0, 3), ['reporteGeneral', 'produccion', 'patios'], '⭐ la producción va DE SEGUNDA en el Reporte completo');
  const lineas = [
    prod({ id: 'a', fecha: '2026-11-05', horas: 6, toneladas: 1500 }),
    prod({ id: 'b', fecha: '2026-11-06', horas: 4, tPorHora: 300, toneladas: 1200 }),
    prod({ id: 'c', fecha: '2026-11-06', modo: 'cribado', horas: 2, tPorHora: 265, toneladas: 530, reparto: [{ producto: 'Polvillo', pct: 50, factor: 1.5 }, { producto: 'Arrocillo <b>', pct: 50, factor: 1.3 }] }),
    prod({ id: 'z', fecha: '2026-11-09', horas: 9, toneladas: 9999 }), // fuera del período
  ];
  const entrada = { sitio: 'cdt', desde: '2026-11-05', hasta: '2026-11-06', hoy: '2026-11-06', reportes: [], movimientos: [], anteriores: [], unidades: [], listas: LISTAS, produccion: lineas };
  const m = RC.modeloReporteCompleto(entrada);
  const pr = m.produccion;
  eq([pr.vacio, pr.horas, pr.toneladas, pr.lineas], [false, 12, 3230, 3], '⭐ el período suma 12 h y 3.230 t (lo de fuera del período no entra)');
  const mixto = pr.porEquipo.find((x) => x.modo.includes('mixto'));
  check(mixto && mixto.tph === null && mixto.tphPromedio === 270, '⭐ si la t/h cambió en el período, sale el PROMEDIO ponderado (2.700 t ÷ 10 h = 270)', mixto);
  eq(pr.porJornada.map((x) => [x.fecha, x.horas]), [['2026-11-05', 6], ['2026-11-06', 6]], 'por jornada (rango de varios días)');
  const html = RC.cuerpoReporteCompleto(m, {});
  check(html.includes('2. Producción de trituración') && html.includes('3. Entrada por patio'), 'el papel la numera 2 y corre las demás');
  check(html.includes('Horas trituradas') && html.includes('Toneladas producidas'), 'el papel trae sus tarjetas');
  check(html.includes('Arrocillo &lt;b&gt;') && !html.includes('Arrocillo <b>'), '⭐ lo que ella escribe sale escapado (nunca HTML suelto)');
  check(html.includes('promedio'), 'el papel dice «promedio» donde la t/h cambió');
  const oculto = RC.cuerpoReporteCompleto(m, { ocultosSecciones: ['produccion'] });
  check(!/Producción de trituración|Horas trituradas/.test(oculto) && oculto.includes('2. Entrada por patio'), '⭐ oculta: no deja rastro y la numeración sigue');
  const sinProd = RC.modeloReporteCompleto({ ...entrada, produccion: undefined });
  check(sinProd.produccion.vacio === true, 'sin producción cargada (papeles viejos): la sección sale vacía, sin romper');
  const conSalidas = RC.modeloReporteCompleto({ ...entrada, movimientos: [{ id: 'm', sitioId: 'S', fecha: '2026-11-06', tipo: 'salida', material: 'Triturado mixto', estado: 'confirmado', viajes: 2, toneladas: 2000, m3: 1400, destino: 'X', unidadIngresada: 't' }] });
  const htmlS = RC.cuerpoReporteCompleto(conSalidas, {});
  check(conSalidas.produccion.vsSalido.length > 0 && htmlS.includes('Salió (t)') && htmlS.includes('el cernidor también produce'), '⭐ con salidas: la tabla «producido vs. salido» con la nota del cernidor');
  check(!RC.cuerpoReporteCompleto(m, {}).includes('Salió (t)'), 'sin salidas en el período: no sale la comparación');
}

// ═══════ 9b. De punta a punta: lo cargado llega a la HOJA (bug 09-nov-2026) ═══════
// María anotó 7,84 h × 229 t/h el 02/11 y en «👁️ Ver la hoja aquí» la sección 2 decía
// «Sin registros en el período.»: `armarPapelCop` copiaba los datos a mano y dejaba fuera la
// producción. Esta prueba pasa por el MISMO camino que la pestaña 📄 Reportes.
{
  const R = loadTs(path.join(ROOT, 'src/lib/centroOperacionesReportes.ts'));
  const op = { ...PAPEL.OPCIONES_PAPEL_POR_DEFECTO, ocultosSecciones: [], ocultosColumnas: [], logos: { ...PAPEL.OPCIONES_PAPEL_POR_DEFECTO.logos } };
  const lineaMaria = prod({ id: 'm', fecha: '2026-11-02', horas: 7.84, tPorHora: 229, toneladas: 1795.36, nota: 'Mandíbula abierta' });
  const datos = { reportes: [], movimientos: [], anteriores: [], unidades: [], listas: LISTAS, produccion: [lineaMaria], equiposTrituracion: [EQ1] };
  const armado = R.armarPapelCop({
    papel: 'completo', sitio: 'CDT', base: [], rango: { desde: '2026-11-02', hasta: '2026-11-05', corteHora: null },
    filtros: { tipos: [], unidadIds: [], transportistas: [], texto: '' }, op, edicion: null,
    completo: { datos, hoy: '2026-11-09' },
  });
  const sec2 = armado.cuerpo.slice(armado.cuerpo.indexOf('2. Producción de trituración'), armado.cuerpo.indexOf('3. Entrada por patio'));
  check(armado.completo && armado.completo.produccion.vacio === false && armado.completo.produccion.horas === 7.84,
    '⭐ el Reporte completo de la pestaña 📄 Reportes RECIBE la producción cargada (no la deja en el camino)', armado.completo?.produccion);
  check(sec2.includes('Horas trituradas') && !sec2.includes('Sin registros en el período.'),
    '⭐ la hoja muestra la sección 2 con lo anotado (no «Sin registros en el período.»)');
}

// ═══════ 10. La pantalla y la base: cableado ═══════
{
  const tab = fs.readFileSync(path.join(ROOT, 'src/components/centroOperaciones/ParteDiarioTab.tsx'), 'utf8');
  check(/<Bloque titulo="2 · ⚙️ Producción de trituración"[^>]*sinGuardar=\{sucios\.produccion\}/.test(tab) && /<BloqueProduccion\b[^>]*alSinGuardar=\{marcar\.produccion\}/.test(tab), '⭐ el bloque 2 del Parte diario es la producción y avisa «✏️ sin guardar»');
  const bp = fs.readFileSync(path.join(ROOT, 'src/components/centroOperaciones/BloqueProduccion.tsx'), 'utf8');
  check(/levelMeets\(nivel, 'escritura'\)/.test(bp) && /levelMeets\(nivel, 'full'\)/.test(bp), 'permisos: escritura anota, full borra');
  check(/\{esFull \? \(/.test(bp) && /title: 'Borrar línea de producción'/.test(bp), '⭐ 🗑️ solo Full y con confirmación');
  check(/setErrorGuardar\(e\?\.message/.test(bp) && /Lo escrito se queda en el formulario/.test(bp), 'si no se guarda, lo dice y lo escrito se queda');
  check(/enVuelo\.current/.test(bp), 'doble toque: candado');
  check(/FALTA_TABLA_PRODUCCION/.test(bp), 'si la base no tiene las tablas, lo dice (no falla callado)');
  check(/Hay algo escrito sin guardar/.test(bp), 'abrir otra línea con algo escrito pregunta antes de descartar');
  check(/Se guarda en la jornada del/.test(bp), 'si se cambia la jornada arriba con el formulario abierto, dice en cuál se guarda');
  check(!/guardarMovimiento|cop_movimientos/.test(bp), '⭐ la pantalla NO escribe en las salidas');
  const db = fs.readFileSync(path.join(ROOT, 'src/lib/centroOperacionesDb.ts'), 'utf8');
  const fnGuardar = db.slice(db.indexOf('export async function guardarProduccion'), db.indexOf('export async function borrarProduccion'));
  check(/\.select\('id'\)/.test(fnGuardar) && /if \(filas\.length === 0\) throw new Error\(NO_SE_GUARDO\)/.test(db), '⭐ escribe con .select(\'id\'): si la RLS rechaza callada, se dice');
  check(/esFaltaTablaProduccion\(e\)\) return \[\] as Produccion\[\]/.test(db), 'el Reporte completo sale aunque las tablas no existan todavía');
  const aj = fs.readFileSync(path.join(ROOT, 'src/components/centroOperaciones/AjustesTab.tsx'), 'utf8');
  check(/<EquiposTrituracionAjustes\b/.test(aj), 'los equipos se administran en ⚙️ Ajustes');
  const eqa = fs.readFileSync(path.join(ROOT, 'src/components/centroOperaciones/EquiposTrituracionAjustes.tsx'), 'utf8');
  check(!/\.delete\(/.test(eqa) && /activo: !e\.activo/.test(eqa), '⭐ un equipo nunca se borra: se da de baja o se activa');
  check((bp.match(/📷|cámara/gi) || []).length === 0, 'el bloque no pide fotos (no aplica la regla cámara+galería)');
  const audit = fs.readFileSync(path.join(ROOT, 'src/lib/auditModulos.ts'), 'utf8');
  check(/cop_produccion: 'centro_operaciones'/.test(audit) && /cop_equipos_trituracion: 'centro_operaciones'/.test(audit), 'la auditoría la pone en «Centro de Operaciones»');
}

if (fallas.length) {
  console.error(fallas.join('\n'));
  console.error(`\n❌ test-centro-operaciones-produccion: ${fallas.length} falla(s), ${ok} ok`);
  process.exit(1);
}
console.log(`✅ test-centro-operaciones-produccion: ${ok} ok, 0 fallas`);
