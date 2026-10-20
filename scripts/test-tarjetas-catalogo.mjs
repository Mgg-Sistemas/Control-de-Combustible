// 🏷️ TARJETAS POR CATEGORÍA DEL CATÁLOGO: ESTADOS CONFIGURABLES (20-oct-2026).
//
// Pedido: «solo en transporte de escombros que salgan las paradas, pero también
// dame la opción de configurar qué estados salen en esas tarjetas, por si
// quiero quitarle a una tarjeta o varias cualquier estado».
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function cargar(rel) {
  const p = path.join(ROOT, rel);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  m._compile(js, p);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

console.log('\n🏷️ TARJETAS DEL CATÁLOGO · ESTADOS CONFIGURABLES\n');

const T = cargar('src/lib/tarjetasCatalogo.ts');

// ═══ 1) Los defaults: lo de siempre, y Paradas SOLO en Transporte de escombros ═
{
  eq('⭐ una tarjeta cualquiera nace con los 4 estados de siempre',
    T.estadosPorDefecto('EQUIPO DE CORTE'), ['operativa', 'averiada', 'espera', 'transferida']);
  eq('⭐ Transporte de escombros nace ADEMÁS con Paradas (el pedido literal)',
    T.estadosPorDefecto('TRANSPORTE DE ESCOMBROS'), ['operativa', 'averiada', 'parada', 'espera', 'transferida']);
  ok('…y vale igual en singular, con acentos o con espacios de más',
    T.estadosPorDefecto('Transporte de Escombro').includes('parada')
    && T.estadosPorDefecto('  TRANSPORTE   DE ESCOMBROS ').includes('parada'));
  eq('la tarjeta Σ nace con los 4 (sin paradas)',
    T.estadosPorDefecto(T.TARJETA_TOTAL), ['operativa', 'averiada', 'espera', 'transferida']);
  ok('⭐ RETIRADA no se ofrece (pedido del 14-oct: ni verse ni contarse acá)',
    !T.ESTADOS_TARJETA.includes('retirada'));
}

// ═══ 2) Configurar: quitar y poner cualquier estado en cualquier tarjeta ══════
{
  let cfg = null;
  cfg = T.alternarEstadoTarjeta(cfg, 'EQUIPO DE CORTE', 'averiada'); // quitarla
  eq('⭐ quitar un estado de UNA tarjeta no toca a las demás',
    [T.estadosDeTarjeta(cfg, 'EQUIPO DE CORTE'), T.estadosDeTarjeta(cfg, 'MANEJO DE CARGA')],
    [['operativa', 'espera', 'transferida'], ['operativa', 'averiada', 'espera', 'transferida']]);
  cfg = T.alternarEstadoTarjeta(cfg, 'MANEJO DE CARGA', 'parada'); // ponerla donde no estaba
  ok('⭐ Paradas se puede encender en cualquier tarjeta',
    T.estadosDeTarjeta(cfg, 'MANEJO DE CARGA').includes('parada'));
  cfg = T.alternarEstadoTarjeta(cfg, 'EQUIPO DE CORTE', 'averiada'); // volverla a poner
  eq('…y volver a encenderlo lo devuelve en su ORDEN canónico',
    T.estadosDeTarjeta(cfg, 'EQUIPO DE CORTE'), ['operativa', 'averiada', 'espera', 'transferida']);
  // Vaciar una tarjeta entera también vale («quitarle cualquier estado»).
  let vacia = null;
  for (const e of T.ESTADOS_TARJETA) vacia = T.alternarEstadoTarjeta(vacia, 'SOPORTE Y SERVICIOS', e);
  // quedó con parada encendida (no estaba) y el resto apagado → apagarla también
  vacia = T.alternarEstadoTarjeta(vacia, 'SOPORTE Y SERVICIOS', 'parada');
  eq('una tarjeta puede quedar sin ningún estado', T.estadosDeTarjeta(vacia, 'SOPORTE Y SERVICIOS'), []);
  ok('la clave no distingue mayúsculas ni acentos (una sola config por tarjeta)',
    T.claveTarjeta('REMOCIÓN Y EXCAVACIÓN') === T.claveTarjeta('remocion y excavación '));
  eq('un guardado con basura no revienta: vuelve a los defaults',
    [T.leerConfigTarjetas('{{{').constructor === Object, T.estadosDeTarjeta(T.leerConfigTarjetas('null'), 'X')],
    [true, ['operativa', 'averiada', 'espera', 'transferida']]);
  eq('…y los valores desconocidos de una versión vieja se filtran',
    T.estadosDeTarjeta({ [T.claveTarjeta('X')]: ['operativa', 'inventado'] }, 'X'), ['operativa']);
}

// ═══ 3) La pantalla: contar aparte, pintar según config, totales intactos ═════
{
  const scr = leer('src/screens/EquiposScreen.tsx');
  ok('⭐ las paradas se cuentan APARTE de las operativas en las tarjetas',
    scr.includes("suma(activeMachines.filter((m) => liveStatusOf(m.id).estado !== 'parada'), 'operativa')")
    && scr.includes("suma(activeMachines.filter((m) => liveStatusOf(m.id).estado === 'parada'), 'parada')"));
  ok('⭐ con Paradas APAGADA se suman de vuelta a Operativas (el total no cambia)',
    scr.includes("k === 'operativa' && !visibles.has('parada') ? c.operativa + c.parada : c[k]"));
  ok('⭐ cada tarjeta pinta SOLO sus estados configurados',
    scr.includes('estadosDeTarjeta(tarjetasCfg, cat ?? TARJETA_TOTAL)')
    && scr.includes('ESTADOS_CAT.filter((e) => visibles.has(e.k))'));
  ok('⭐ el renglón Paradas abre SU lista, y Operativas abre la suya sin paradas cuando están separadas',
    scr.includes("detailStatus === 'parada' ? activeMachines.filter((m) => liveStatusOf(m.id).estado === 'parada')")
    && scr.includes("abrirDetalle(e.s, cat, e.k === 'operativa' && visibles.has('parada'))")
    && scr.includes("detailSinParadas ? activeMachines.filter((m) => liveStatusOf(m.id).estado !== 'parada') : activeMachines"));
  ok('⚙️ el configurador existe, con la Σ incluida, y guarda en el dispositivo',
    scr.includes('⚙️ Configurar tarjetas')
    && scr.includes('[...cats.map(([nombre]) => nombre), TARJETA_TOTAL]')
    && scr.includes('AsyncStorage.setItem(CLAVE_GUARDADO_TARJETAS'));
  ok('los cubos de arriba NO cambian (siguen abriendo la lista completa de operativas)',
    scr.includes("onPress={() => abrirDetalle('retirada')}"));
}

if (fail) {
  console.error(failures.join('\n'));
  console.error(`\n❌ test-tarjetas-catalogo · ${fail} fallo(s), ${pass} ok`);
  process.exit(1);
}
console.log(`✅ test-tarjetas-catalogo · ${pass} pruebas ok`);
