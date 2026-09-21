/*
 * Test: IMPRIMIR CONFIRMA CUANDO SALE EL PAPEL (17-sep-2026).
 *
 * El caso real: los tickets CDT-000419, 420 y 421 se imprimieron y se entregaron,
 * pero el sistema los mostraba como NO entregados. La causa estaba acá: la vista
 * previa de la web solo resolvía su promesa dentro de `cleanup()`, o sea cuando
 * el usuario CERRABA la ventana. Quien imprimía y se iba —cerrar la pestaña,
 * volver atrás, o que el teléfono matara el navegador— dejaba la promesa colgada
 * y la constancia de entrega NUNCA se escribía: el papel en la calle y el sistema
 * diciendo que no se entregó.
 *
 * Lo que fija, con un navegador de mentira (el repo no tiene jsdom):
 *   · imprimir resuelve `true` AL INSTANTE, sin cerrar la ventana
 *   · cerrar sin imprimir sigue resolviendo `false` (cancelar es cancelar)
 *   · imprimir y DESPUÉS cerrar resuelve UNA sola vez
 *   · Ctrl+P / el menú del navegador (evento `beforeprint`) también cuenta
 *   · la ventana NO se cierra sola al imprimir: sigue ahí para volver a mandarla
 *
 *   node scripts/test-imprimir-confirma.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};

// ── UN NAVEGADOR DE MENTIRA ────────────────────────────────────────────────
// Solo lo que usa `previewHtmlWeb`: crear elementos, colgarlos del body, un
// iframe con su ventana (focus/print/documento) y los oyentes de teclado.
function navegadorFalso() {
  const oyentesIframe = {};
  let raiz = null;
  const nuevoEl = (tag) => {
    const el = {
      tag, hijos: [], texto: '', quitado: false, onclick: null,
      setAttribute() {}, appendChild(h) { el.hijos.push(h); }, remove() { el.quitado = true; },
      get textContent() { return el.texto; },
      set textContent(v) { el.texto = v; },
      contentWindow: null,
    };
    return el;
  };
  const impresiones = { n: 0 };
  const ventanaIframe = {
    focus() {},
    print() {
      impresiones.n += 1;
      // Un navegador de verdad dispara `beforeprint` al imprimir. Se imita: es lo
      // que confirmaría DOS veces si faltara el candado de una sola resolución.
      (oyentesIframe.beforeprint ?? []).forEach((f) => f());
    },
    addEventListener(ev, f) { (oyentesIframe[ev] ??= []).push(f); },
    removeEventListener() {},
    document: { open() {}, write() {}, close() {}, title: '', images: [] },
  };
  const oyentesDoc = {};
  const document = {
    body: { appendChild(el) { raiz = el; } },
    createElement(tag) { const el = nuevoEl(tag); if (tag === 'iframe') el.contentWindow = ventanaIframe; return el; },
    addEventListener(ev, f) { (oyentesDoc[ev] ??= []).push(f); },
    removeEventListener(ev, f) { oyentesDoc[ev] = (oyentesDoc[ev] ?? []).filter((x) => x !== f); },
  };
  const porTexto = (t) => {
    const out = [];
    const rec = (el) => { if (!el) return; if (el.texto === t) out.push(el); el.hijos?.forEach(rec); };
    rec(raiz);
    return out[0];
  };
  return { document, impresiones, porTexto, ventana: () => raiz, teclado: (k) => (oyentesDoc.keydown ?? []).forEach((f) => f({ key: k })) };
}

// `pdf.ts` con lo nativo apagado: acá solo interesa el camino de la web.
function cargarPdf() {
  const abs = path.join(ROOT, 'src/lib/pdf.ts');
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id === 'react-native') return { Platform: { OS: 'web' } };
    if (id === 'expo-print' || id === 'expo-sharing') return {};
    // Logos y nombre de empresa: texto que acá no hace falta de verdad.
    if (id.startsWith('.')) return new Proxy({}, { get: () => '' });
    return orig(id);
  };
  m._compile(out, m.filename);
  return m.exports;
}

// Oyentes de la ventana principal (los de Ctrl+P).
const oyentesGlobales = {};
globalThis.addEventListener = (ev, f) => { (oyentesGlobales[ev] ??= []).push(f); };
globalThis.removeEventListener = (ev, f) => { oyentesGlobales[ev] = (oyentesGlobales[ev] ?? []).filter((x) => x !== f); };
// Sin `requestAnimationFrame`, `pdf.ts` cae a `setTimeout`, que acá alcanza.
globalThis.requestAnimationFrame = undefined;

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Abre la vista previa y devuelve con qué quedó, sin esperar a que resuelva. */
async function abrir() {
  const nav = navegadorFalso();
  globalThis.document = nav.document;
  const { exportPdf } = cargarPdf();
  const estado = { valor: 'sin-resolver', veces: 0 };
  exportPdf('<html><body>ticket</body></html>', 'ticket-CDT-000419').then((v) => { estado.valor = v; estado.veces += 1; });
  await tick();
  return { nav, estado };
}
const imprimir = async (nav) => { await nav.porTexto('🖨️  Imprimir').onclick(); await tick(); };
const cerrar = async (nav) => { nav.porTexto('Cancelar')?.onclick?.(); await tick(); };

// ── 1) ⭐ IMPRIMIR CONFIRMA SIN CERRAR LA VENTANA ──────────────────────────
{
  const { nav, estado } = await abrir();
  eq('antes de tocar nada, nadie confirmó', estado.valor, 'sin-resolver');
  await imprimir(nav);
  eq('el papel salió', nav.impresiones.n, 1);
  eq('⭐ confirma AL IMPRIMIR, sin cerrar la ventana', estado.valor, true);
  eq('⭐ y la ventana sigue abierta (se puede volver a mandar)', nav.ventana().quitado, false);
  eq('el botón pasa a decir «Cerrar»', nav.porTexto('Cerrar') != null, true);
  // Cerrar después NO vuelve a resolver: una entrega, una constancia.
  await cerrar(nav);
  eq('⭐ cerrar después no confirma de nuevo', estado.veces, 1);
  eq('...y sigue siendo «sí se imprimió»', estado.valor, true);
}

// ── 2) CANCELAR SIGUE SIENDO CANCELAR ──────────────────────────────────────
{
  const { nav, estado } = await abrir();
  await cerrar(nav);
  eq('cerrar sin imprimir: no se entregó nada', estado.valor, false);
  eq('la impresora no recibió nada', nav.impresiones.n, 0);
  eq('resolvió una sola vez', estado.veces, 1);
}

// ── 3) ESCAPE TAMPOCO ES IMPRIMIR ──────────────────────────────────────────
{
  const { nav, estado } = await abrir();
  nav.teclado('Escape');
  await tick();
  eq('Escape cancela', estado.valor, false);
}

// ── 4) ⭐ Ctrl+P / EL MENÚ DEL NAVEGADOR TAMBIÉN CUENTA ────────────────────
{
  const { nav, estado } = await abrir();
  (oyentesGlobales.beforeprint ?? []).forEach((f) => f());
  await tick();
  eq('⭐ imprimir por fuera del botón también queda registrado', estado.valor, true);
  await cerrar(nav);
  eq('y no se cuenta dos veces', estado.veces, 1);
}

// ── 5) ⭐ LA HORA DE LA ENTREGA ES LA DEL BOTÓN, NO LA DE LA SUBIDA (21-sep-2026) ──
//
// La base pone `emitido_at = now()` al LLEGAR la fila. Una entrega apartada sin señal
// subía horas después y quedaba con esa hora. Ahora la hora se toma al confirmarse la
// impresión y viaja con la entrega.
{
  const fsx = await import('node:fs');
  const lib = fsx.readFileSync(new URL('../src/lib/tiqueEmisiones.ts', import.meta.url), 'utf8');
  const pan = fsx.readFileSync(new URL('../src/screens/ViajesCamionesScreen.tsx', import.meta.url), 'utf8');
  eq('⭐ la hora viaja con la entrega (también con la apartada sin señal)', /\.\.\.\(e\.emitidoAt \? \{ emitido_at: e\.emitidoAt \} : \{\}\)/.test(lib), true);
  eq('⭐ se toma apenas se confirma, antes de cualquier espera de red', /if \(!confirmado\) return;[\s\S]{0,420}const emitidoAt = new Date\(\)\.toISOString\(\);[\s\S]*?await registrarEmisiones\(nuevas\)/.test(pan), true);
  eq('...y va en cada entrega del mandado', /emitidoPorNombre: listeroName,\s*emitidoAt,/.test(pan), true);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-imprimir-confirma · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
