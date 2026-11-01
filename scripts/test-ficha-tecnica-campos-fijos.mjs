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

// ── Resultado ───────────────────────────────────────────────────────────────
console.log('\nFICHA TÉCNICA — campos fijos y lo vacío no sale\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-ficha-tecnica-campos-fijos · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
