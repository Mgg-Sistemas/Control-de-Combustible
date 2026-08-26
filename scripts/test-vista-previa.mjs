/*
 * VISTA PREVIA DE IMPRESIÓN — `src/lib/pdf.ts`.
 *
 * ⚠️ ESTO LO USAN **TODOS** LOS REPORTES DE LA APP, no un módulo suelto: si
 *    `previewHtmlWeb` se rompe, se rompe cada PDF del sistema a la vez. Por eso
 *    tiene suite propia aunque el archivo no sea "puro".
 *
 * Lo que blinda (26-ago-2026, queja del taller «la vista previa tarda muchísimo
 * en cargar»): la ventana se PINTA PRIMERO y el documento se escribe DESPUÉS,
 * cediéndole el hilo al navegador. Antes todo pasaba en una sola tarea y la
 * aplicación se veía congelada hasta que terminaba de armar el reporte entero.
 *
 * Se simula un DOM mínimo (no hay jsdom en el proyecto) para poder ejecutar la
 * función de verdad, no mirarla con expresiones regulares.
 *
 *   node scripts/test-vista-previa.mjs
 */
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

let pass = 0, fail = 0; const malas = [];
const ok = (n, c, extra = '') => { if (c) pass++; else { fail++; malas.push(n + (extra ? ` → ${extra}` : '')); } };

// ── Un DOM de mentira, lo mínimo que `previewHtmlWeb` toca ────────────────
const hacerDom = () => {
  const escrito = { html: null, abierto: 0, cerrado: 0, title: null };
  const nuevoEl = (tag) => {
    const el = {
      tag, hijos: [], _style: '', textContent: '', onclick: null,
      setAttribute(k, v) { if (k === 'style') el._style = v; },
      appendChild(c) { el.hijos.push(c); c.padre = el; return c; },
      remove() { if (el.padre) el.padre.hijos = el.padre.hijos.filter((x) => x !== el); },
    };
    if (tag === 'iframe') {
      el.contentWindow = {
        document: {
          open() { escrito.abierto++; },
          write(h) { escrito.html = h; },
          close() { escrito.cerrado++; },
          set title(v) { escrito.title = v; },
          get title() { return escrito.title; },
        },
        focus() {}, print() { escrito.imprimio = true; },
      };
    }
    return el;
  };
  const body = nuevoEl('body');
  const doc = {
    body, createElement: nuevoEl,
    addEventListener() {}, removeEventListener() {},
  };
  return { doc, escrito, body };
};

// ── Cargar pdf.ts con requires falsos ─────────────────────────────────────
const tr = (rel) => ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;

const cargarPdf = (dom, rafs) => {
  const g = globalThis;
  const viejoDoc = g.document, viejoRaf = g.requestAnimationFrame;
  g.document = dom.doc;
  g.requestAnimationFrame = (fn) => { rafs.push(fn); return rafs.length; };
  const mod = { exports: {} };
  new Function('exports', 'module', 'require', tr('src/lib/pdf.ts'))(mod.exports, mod, (id) => {
    if (id.includes('logoBcvData')) return { BCV_LOGO_DATA_URI: 'data:image/svg+xml;base64,AAA' };
    if (id.includes('logoData')) return { LOGO_DATA_URI: 'data:image/png;base64,BBB' };
    if (id.includes('react-native')) return { Platform: { OS: 'web' } };
    return {};
  });
  return { mod, restaurar: () => { g.document = viejoDoc; g.requestAnimationFrame = viejoRaf; } };
};

const correrRafs = (rafs) => { while (rafs.length) { const fn = rafs.shift(); fn(); } };

console.log('VISTA PREVIA DE IMPRESIÓN (pdf.ts)\n');

// ── 1) ⭐ La ventana se muestra ANTES de escribir el documento ─────────────
{
  const dom = hacerDom(); const rafs = [];
  const { mod, restaurar } = cargarPdf(dom, rafs);
  mod.exports.exportPdf('<html><body>HOLA</body></html>', 'reporte.pdf');

  ok('⭐ la ventana ya está en pantalla', dom.body.hijos.length === 1, String(dom.body.hijos.length));
  ok('⭐ …y el documento TODAVÍA NO se ha escrito (esa es toda la mejora)',
    dom.escrito.html === null, String(dom.escrito.html));

  const overlay = dom.body.hijos[0];
  const card = overlay.hijos[0];
  const bar = card.hijos[0];
  ok('la ventana avisa que está preparando',
    /Preparando/.test(bar.hijos[0].textContent), bar.hijos[0].textContent);

  correrRafs(rafs);
  ok('⭐ tras ceder el hilo, el documento SÍ se escribe',
    dom.escrito.html === '<html><body>HOLA</body></html>', String(dom.escrito.html));
  ok('se abre y se cierra el documento como debe',
    dom.escrito.abierto === 1 && dom.escrito.cerrado === 1);
  ok('el nombre de archivo sugerido se conserva', dom.escrito.title === 'reporte.pdf', String(dom.escrito.title));
  ok('el título de la barra vuelve a la normalidad',
    bar.hijos[0].textContent === 'Vista previa del documento', bar.hijos[0].textContent);
  restaurar();
}

// ── 2) ⭐ Cancelar MIENTRAS prepara no escribe nada (antes ni se podía) ────
{
  const dom = hacerDom(); const rafs = [];
  const { mod, restaurar } = cargarPdf(dom, rafs);
  const p = mod.exports.exportPdf('<html>PESADO</html>', 'x.pdf');

  const overlay = dom.body.hijos[0];
  const bar = overlay.hijos[0].hijos[0];
  const btns = bar.hijos[1];
  const btnCancel = btns.hijos[0];
  ok('el botón de cancelar existe desde el primer momento', btnCancel.textContent === 'Cancelar');

  btnCancel.onclick();                       // el usuario cancela mientras prepara
  ok('cancelar quita la ventana', dom.body.hijos.length === 0);
  correrRafs(rafs);                          // llega el cuadro que iba a escribir
  ok('⭐ ya cancelado, NO se escribe el documento', dom.escrito.html === null, String(dom.escrito.html));
  ok('⭐ ni se abre siquiera', dom.escrito.abierto === 0, String(dom.escrito.abierto));

  p.then((r) => ok('cancelar resuelve false (quien llama no ejecuta efectos)', r === false, String(r)));
  restaurar();
}

// ── 3) Imprimir sigue funcionando ────────────────────────────────────────
{
  const dom = hacerDom(); const rafs = [];
  const { mod, restaurar } = cargarPdf(dom, rafs);
  const p = mod.exports.exportPdf('<html>OK</html>', 'y.pdf');
  correrRafs(rafs);

  const overlay = dom.body.hijos[0];
  const btns = overlay.hijos[0].hijos[0].hijos[1];
  const btnCancel = btns.hijos[0], btnPrint = btns.hijos[1];
  ok('el botón dice Imprimir', /Imprimir/.test(btnPrint.textContent), btnPrint.textContent);
  btnPrint.onclick();
  ok('⭐ imprimir llama a print() del iframe', dom.escrito.imprimio === true);
  ok('tras imprimir, Cancelar pasa a decir Cerrar', btnCancel.textContent === 'Cerrar', btnCancel.textContent);
  btnCancel.onclick();
  p.then((r) => ok('⭐ imprimir resuelve true (los efectos SÍ se ejecutan)', r === true, String(r)));
  restaurar();
}

// ── 4) Sin requestAnimationFrame (algún navegador viejo) igual escribe ────
{
  const dom = hacerDom(); const rafs = [];
  const g = globalThis;
  const viejoDoc = g.document, viejoRaf = g.requestAnimationFrame;
  g.document = dom.doc; g.requestAnimationFrame = undefined;
  const mod = { exports: {} };
  new Function('exports', 'module', 'require', tr('src/lib/pdf.ts'))(mod.exports, mod, (id) => {
    if (id.includes('logoBcvData')) return { BCV_LOGO_DATA_URI: 'x' };
    if (id.includes('logoData')) return { LOGO_DATA_URI: 'y' };
    if (id.includes('react-native')) return { Platform: { OS: 'web' } };
    return {};
  });
  mod.exports.exportPdf('<html>SIN RAF</html>', 'z.pdf');
  ok('sin requestAnimationFrame tampoco escribe de inmediato', dom.escrito.html === null);
  setTimeout(() => {
    ok('⭐ …pero el respaldo con setTimeout sí escribe', dom.escrito.html === '<html>SIN RAF</html>', String(dom.escrito.html));
    g.document = viejoDoc; g.requestAnimationFrame = viejoRaf;
    cerrar();
  }, 5);
}

const cerrar = () => {
  setTimeout(() => {
    if (fail) { console.log(`✗ ${fail} FALLO(S):\n` + malas.map((m) => '  · ' + m).join('\n')); process.exit(1); }
    console.log(`${pass} OK · 0 FALLO(S)\nLa ventana se pinta primero y el documento se escribe después.`);
  }, 5);
};
