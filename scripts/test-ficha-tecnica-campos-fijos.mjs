// ============================================================================
// 🧪 FICHA TÉCNICA — CAMPOS FIJOS Y «LO VACÍO NO SALE» (01-nov-2026).
//
// El equipo pidió que los datos de las fichas hechas a mano (Fabricante,
// Modelo / Serie, Placa, Tipo / Combustible, Año, Ejes / Tren, Capacidad,
// Equipamiento, País de origen, Horómetro) vengan ya puestos en el formulario,
// y que lo que no se llene NO salga en el PDF. Esta suite prueba la parte pura
// (`src/lib/fichaTecnicaMaquina.ts`); el guardado en la nube lo hace la función
// `guardar_ficha_tecnica` de la base.
//
// Ejecutar:  node scripts/test-ficha-tecnica-campos-fijos.mjs
// ============================================================================
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
const loadTs = (srcPath) => {
  if (cache.has(srcPath)) return cache.get(srcPath);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  cache.set(srcPath, m.exports);
  const origRequire = m.require.bind(m);
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(srcPath), `${id}.ts`)) : origRequire(id));
  m._compile(out, m.filename);
  cache.set(srcPath, m.exports);
  return m.exports;
};

const F = loadTs(path.join(ROOT, 'src/lib/fichaTecnicaMaquina.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); }
};

// ── Los campos fijos, en el orden de las fichas de referencia ───────────────
const XCMG = { code: 'JUMBO 320', marca: 'XCMG', modelo: 'XE225BR', serial: 'XUG00225CTPA00246', plate: '', identifier: 'ID-9', last_horometro: 10.7 };
const fijos = F.camposFijosDeMaquina(XCMG);
eq('los diez campos fijos, en el orden de la ficha hecha a mano',
  fijos.map((r) => r.etiqueta),
  ['Fabricante', 'Modelo / Serie', 'Número de Placa / Identificación', 'Tipo / Combustible', 'Año de Fabricación',
    'Configuración de Ejes / Tren', 'Capacidad Nominal de Carga', 'Equipamiento Integrado', 'País de Origen', 'Horómetro']);
eq('⭐ lo que el catálogo sabe viene precargado', fijos.filter((r) => r.valor).map((r) => [r.id, r.valor]), [
  ['f-fabricante', 'XCMG'],
  ['f-modelo-serie', 'XE225BR / XUG00225CTPA00246'],
  ['f-placa', 'ID-9'],
  ['f-horometro', '10,7 h'],
]);
ok('⭐ lo que el catálogo no sabe queda vacío para teclear (no se inventa)',
  ['f-tipo-combustible', 'f-anio', 'f-ejes', 'f-capacidad', 'f-equipamiento', 'f-origen']
    .every((id) => fijos.find((r) => r.id === id)?.valor === ''));
ok('cada campo fijo trae su ejemplo para el formulario',
  F.CAMPOS_FIJOS_FICHA.every((c) => (F.ayudaCampoFicha(c.id) ?? '').startsWith('Ej.')));

// ── Lo vacío no sale en el PDF ──────────────────────────────────────────────
eq('vacío: nada, espacios y el «—» de relleno', [F.vacioEnFicha(''), F.vacioEnFicha('  '), F.vacioEnFicha('—'), F.vacioEnFicha(null), F.vacioEnFicha('4x2')], [true, true, true, true, false]);

const ficha = {
  titulo: 'FICHA TÉCNICA',
  metricas: [
    { id: 'm-horas', titulo: 'HORÓMETRO / KILOMETRAJE', valor: '10,7 h' },
    { id: 'm-peso', titulo: 'CAPACIDAD / PESO OPERATIVO', valor: '' },
  ],
  renglones: [
    ...fijos,
    { id: 'r-1', categoria: 'Datos Generales', etiqueta: 'Nuevo campo', valor: '' },
    { id: 'r-2', categoria: 'Componentes Principales', etiqueta: 'Filtro de aceite', valor: 'P627763' },
  ],
  observaciones: [
    { id: 'o-estado', titulo: 'Estado General', texto: 'Placa verificada con foto.' },
    { id: 'o-componentes', titulo: 'Componentes', texto: '' },
  ],
};
const html = F.fichaTecnicaMaquinaHtml(XCMG, { personalizada: ficha });
ok('⭐⭐ un campo fijo sin llenar NO sale en el PDF', !html.includes('País de Origen') && !html.includes('Año de Fabricación'));
ok('⭐⭐ la fila «Nuevo campo» vacía NO sale', !html.includes('Nuevo campo'));
ok('los campos llenos sí salen', html.includes('Fabricante') && html.includes('XE225BR / XUG00225CTPA00246') && html.includes('P627763'));
ok('⭐ la tarjeta sin valor no sale; la que tiene valor sí',
  html.includes('HORÓMETRO / KILOMETRAJE') && !html.includes('CAPACIDAD / PESO OPERATIVO'));
ok('⭐ el cuadro de observación vacío no sale; el escrito sí',
  html.includes('Placa verificada con foto.') && !html.includes('>Componentes<'));
ok('⭐ por defecto, UNA sola tabla (como las fichas de referencia)', !html.includes('class="specs-dual"'));
const htmlCols = F.fichaTecnicaMaquinaHtml(XCMG, { personalizada: { ...ficha, diseno: 'columnas' } });
ok('el diseño por columnas sigue disponible si se elige', htmlCols.includes('class="specs-dual"') && htmlCols.includes('Componentes Principales'));
const htmlVacia = F.fichaTecnicaMaquinaHtml(XCMG, { personalizada: { renglones: [{ id: 'x', etiqueta: 'Nuevo campo', valor: '' }] } });
ok('una ficha sin nada lleno lo dice, en vez de una tabla vacía', htmlVacia.includes('todavía no tiene especificaciones llenas'));

// ── Fichas ya guardadas: reciben los campos sin duplicar ni perder nada ─────
const vieja = {
  renglones: [
    { id: 'r-marca', categoria: 'Datos Generales', etiqueta: 'Fabricante / Marca', valor: 'XCMG' },
    { id: 'r-modelo', categoria: 'Datos Generales', etiqueta: 'Modelo', valor: 'XE225BR' },
    { id: 'r-x', categoria: 'configuracion de ejes', etiqueta: 'configuracion de ejes', valor: '4x2' },
  ],
  metricas: [{ id: 'm-pot', titulo: 'Potencia del Motor', valor: '135 kW' }],
  observaciones: [{ id: 'o-propia', titulo: 'Cabina', texto: 'OPS/FOPS' }],
};
const inicial = { renglones: fijos, metricas: [], observaciones: F.OBSERVACIONES_FIJAS_FICHA.map((o) => ({ id: o.id, titulo: o.titulo, texto: '' })) };
const sync = F.sincronizarFichaConCatalogo(vieja, inicial);
ok('⭐⭐ no se duplica el fabricante ni el modelo de una ficha vieja',
  !sync.renglones.some((r) => r.id === 'f-fabricante') && !sync.renglones.some((r) => r.id === 'f-modelo-serie'));
ok('⭐ los campos fijos que faltaban se añaden', sync.renglones.some((r) => r.id === 'f-ejes') && sync.renglones.some((r) => r.id === 'f-origen'));
ok('⭐⭐ no se pierde nada de lo escrito (renglones, métricas propias, observaciones propias)',
  sync.renglones.some((r) => r.valor === '4x2') && sync.metricas.some((m) => m.id === 'm-pot') && sync.observaciones.some((o) => o.id === 'o-propia'));
ok('los tres cuadros fijos de observaciones llegan a la ficha vieja', ['o-estado', 'o-componentes', 'o-anexo'].every((id) => sync.observaciones.some((o) => o.id === id)));
const syncOculta = F.sincronizarFichaConCatalogo({ ...vieja, renglonesOcultos: ['o-anexo', 'f-origen'] }, inicial);
ok('⭐ lo que el usuario borró no vuelve solo', !syncOculta.observaciones.some((o) => o.id === 'o-anexo') && !syncOculta.renglones.some((r) => r.id === 'f-origen'));

// ── Teléfono vs nube: gana la más reciente ──────────────────────────────────
const local = { titulo: 'LOCAL', actualizadoEn: '2026-11-01T10:00:00Z', fotoPrincipalUrl: 'data:image/jpeg;base64,xx' };
const nube = { titulo: 'NUBE', actualizadoEn: '2026-11-01T09:00:00Z' };
eq('⭐⭐ gana la copia guardada más tarde (no la más larga)', F.elegirFichaMasReciente(local, nube).titulo, 'LOCAL');
eq('si la nube es más nueva, gana la nube', F.elegirFichaMasReciente(local, { ...nube, actualizadoEn: '2026-11-01T11:00:00Z' }).titulo, 'NUBE');
eq('fichas de antes (sin fecha): manda la nube', F.elegirFichaMasReciente({ titulo: 'LOCAL' }, { titulo: 'NUBE' }).titulo, 'NUBE');
eq('⭐ la foto tomada en el teléfono no se pierde aunque gane la nube',
  F.elegirFichaMasReciente(local, { ...nube, actualizadoEn: '2026-11-01T11:00:00Z' }).fotoPrincipalUrl, 'data:image/jpeg;base64,xx');

eq('el estado en vivo pierde su emoji para el sello', F.estadoSinEmoji('✅ Operativa'), 'Operativa');

// ── Formato de la ficha hecha a mano (01-nov-2026, segunda vuelta) ──────────
const MAQ = { ...XCMG, photo_url: 'https://x.supabase.co/storage/v1/object/public/machinery/a/equipo.jpg',
  photo_serial_url: 'https://x.supabase.co/storage/v1/object/public/machinery/a/placa.jpg',
  fotoHorometroUrl: 'https://x.supabase.co/storage/v1/object/public/machinery/a/horo.jpg' };
const fotoUrl = (n) => `https://x.supabase.co/storage/v1/object/public/machinery/a/ficha-anexo/${n}.jpg`;
const conAnexo = {
  ...ficha,
  seccionFotosTitulo: '',
  fotoPrincipalLeyenda: null,
  observaciones: [
    { id: 'o-estado', titulo: 'Estado General', texto: 'Placa verificada.' },
    { id: 'o-componentes', titulo: 'Componentes', texto: 'Cabina y pluma integradas.' },
  ],
  anexos: [
    { id: 'a1', titulo: 'VISTAS ESTRUCTURALES Y TREN DE RODAJE', columnas: 2, fotos: [
      { id: 'f1', url: fotoUrl(1), leyenda: 'Perfil sobre lowboy (vista derecha)' },
      { id: 'f2', url: MAQ.photo_serial_url, leyenda: 'Coincidencia entre placa y PIN', descripcion: 'XUG00225CTPA00246' },
    ] },
    { id: 'a2', titulo: 'SECCIÓN VACÍA', columnas: 3, fotos: [] },
    { id: 'a3', titulo: 'COMPARTIMENTO DE MOTOR, FILTROS Y REFRIGERACIÓN', subtitulo: 'Revisión del 29/10', columnas: 3, fotos: [
      { id: 'f3', url: fotoUrl(3), leyenda: 'Filtro de aire' },
    ] },
  ],
};
const H = F.fichaTecnicaMaquinaHtml(MAQ, { personalizada: conAnexo });
ok('⭐⭐ las secciones del anexo salen numeradas y en su orden',
  H.includes('1. VISTAS ESTRUCTURALES Y TREN DE RODAJE') && H.includes('2. COMPARTIMENTO DE MOTOR')
    && H.indexOf('1. VISTAS') < H.indexOf('2. COMPARTIMENTO'));
ok('⭐ la sección sin fotos no sale (ni gasta número)', !H.includes('SECCIÓN VACÍA'));
ok('⭐⭐ cada foto lleva su título y su explicación', H.includes('Perfil sobre lowboy (vista derecha)') && H.includes('XUG00225CTPA00246</div>'));
ok('la explicación de la sección sale debajo del título', H.includes('Revisión del 29/10'));
ok('⭐ cada sección empieza en página nueva y elige 2 o 3 columnas',
  (H.match(/class="anx-sec"/g) || []).length === 2 && H.includes('anx-grid c2') && H.includes('anx-grid c3'));
ok('⭐ la foto de la placa puesta en una sección no se repite en el anexo automático',
  !H.includes('Detalle de la placa de identificación (serial / placa) del equipo'));
ok('la foto del horómetro que no se puso en una sección sigue en el anexo automático', H.includes('Última foto del horómetro subida'));
ok('⭐⭐ las observaciones van en un solo recuadro como «Título: texto»',
  H.includes('<b>Estado General:</b> Placa verificada.') && H.includes('<b>Componentes:</b> Cabina y pluma integradas.')
    && (H.match(/class="obs-box"/g) || []).length === 1 && H.includes('OBSERVACIONES DE INSPECCIÓN'));
ok('⭐ las observaciones van antes que la foto del equipo (página 1, como la referencia)',
  H.indexOf('OBSERVACIONES DE INSPECCIÓN') < H.indexOf('equipo.jpg'));
ok('⭐ sin título ni leyenda, la foto del equipo sale sola (sin franja ni pie)',
  !H.includes('VISTA GENERAL DEL EQUIPO') && !H.includes('foto-p1-cap"'));
ok('⭐ la tarjeta lleva el título arriba y el valor debajo',
  /<div class="ct">HORÓMETRO \/ KILOMETRAJE<\/div>\s*<div class="cv">10,7 h<\/div>/.test(H));
ok('⭐⭐ cada página lleva su pie y «Página X de Y»',
  H.includes('@bottom-left{content:"Ficha Técnica - XCMG · XE225BR"') && H.includes('counter(page) " de " counter(pages)'));
const Hpie = F.fichaTecnicaMaquinaHtml(MAQ, { personalizada: { ...conAnexo, pieTexto: 'Ficha "X" </style><script>' } });
ok('⭐ el pie escrito a mano no rompe el CSS ni cuela etiquetas', !Hpie.includes('</style><script>') && Hpie.includes('\\"X\\"'));
const HsinPie = F.fichaTecnicaMaquinaHtml(MAQ, { personalizada: { ...conAnexo, pieTexto: '' } });
ok('pie vacío = sin texto, pero sigue «Página X de Y»', !HsinPie.includes('@bottom-left') && HsinPie.includes('counter(pages)'));
ok('la ficha automática (sin personalizar) no cambia su @page', !F.fichaTecnicaMaquinaHtml(MAQ).includes('@bottom-right'));

eq('↕ ordenar como la referencia: fijos y equivalentes primero, lo demás después, sin perder nada',
  F.ordenarRenglonesComoReferencia([
    { id: 'r-codigo', etiqueta: 'Código', valor: 'J' },
    { id: 'f-origen', etiqueta: 'País de Origen', valor: 'Brasil' },
    { id: 'r-serial', etiqueta: 'Serie', valor: 'S' },
    { id: 'r-marca', etiqueta: 'Fabricante / Marca', valor: 'XCMG' },
    { id: 'r-modelo', etiqueta: 'Modelo', valor: 'XE' },
    { id: 'x', etiqueta: 'Otro', valor: 'o' },
  ]).map((r) => r.id),
  ['r-marca', 'r-modelo', 'r-serial', 'f-origen', 'r-codigo', 'x']);

const limpia = F.limpiarFichaParaNube({ anexos: [{ id: 'a', titulo: 't', fotos: [{ id: '1', url: 'data:image/jpeg;base64,xx' }, { id: '2', url: fotoUrl(2) }] }] });
eq('⭐ una foto que solo está en el teléfono no sube a la nube, tampoco dentro del anexo', limpia.anexos[0].fotos.map((f) => f.id), ['2']);

// ── Resultado ───────────────────────────────────────────────────────────────
console.log('\nFICHA TÉCNICA — campos fijos y lo vacío no sale\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-ficha-tecnica-campos-fijos · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
