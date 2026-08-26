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
/**
 * Una `<img>` de mentira, para probar la espera de las fotos.
 * `complete:false` = todavía viene en camino. Se "completa" llamando a `llega()`.
 */
const fotoFalsa = (completa) => {
  const oyentes = { load: [], error: [] };
  return {
    complete: completa,
    addEventListener(ev, fn) { (oyentes[ev] ?? []).push(fn); },
    llega(evento = 'load') { this.complete = true; oyentes[evento].forEach((f) => f()); },
  };
};

const hacerDom = (imagenes = []) => {
  const escrito = { html: null, abierto: 0, cerrado: 0, title: null, images: imagenes };
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
          get images() { return escrito.images; },
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

// ── 3) Imprimir sigue funcionando (con todas las fotos ya cargadas) ──────
const bloque3 = async () => {
  const dom = hacerDom([fotoFalsa(true), fotoFalsa(true)]); const rafs = [];
  const { mod, restaurar } = cargarPdf(dom, rafs);
  const p = mod.exports.exportPdf('<html>OK</html>', 'y.pdf');
  correrRafs(rafs);

  const overlay = dom.body.hijos[0];
  const btns = overlay.hijos[0].hijos[0].hijos[1];
  const btnCancel = btns.hijos[0], btnPrint = btns.hijos[1];
  ok('el botón dice Imprimir', /Imprimir/.test(btnPrint.textContent), btnPrint.textContent);
  await btnPrint.onclick();
  ok('⭐ imprimir llama a print() del iframe', dom.escrito.imprimio === true);
  ok('tras imprimir, Cancelar pasa a decir Cerrar', btnCancel.textContent === 'Cerrar', btnCancel.textContent);
  btnCancel.onclick();
  const r = await p;
  ok('⭐ imprimir resuelve true (los efectos SÍ se ejecutan)', r === true, String(r));
  restaurar();
};

// ══════════════════════════════════════════════════════════════════════════
// 3.b) ⭐ NO SE IMPRIME HASTA QUE LAS FOTOS ESTÉN (26-ago-2026)
//      El taller mandó un PDF de 11 servicios con 4 hojas de recuadro negro o
//      vacío: `print()` salía mientras las fotos todavía bajaban.
// ══════════════════════════════════════════════════════════════════════════
const bloque3b = async () => {
  const enCamino = fotoFalsa(false);
  const dom = hacerDom([fotoFalsa(true), enCamino]); const rafs = [];
  const { mod, restaurar } = cargarPdf(dom, rafs);
  mod.exports.exportPdf('<html>CON FOTOS</html>', 'z.pdf');
  correrRafs(rafs);

  const overlay = dom.body.hijos[0];
  const bar = overlay.hijos[0].hijos[0];
  const btnPrint = bar.hijos[1].hijos[1];

  const clic = btnPrint.onclick();          // el usuario toca Imprimir
  await new Promise((r) => setTimeout(r, 5));
  ok('⭐ con una foto en camino, NO se imprime todavía',
    dom.escrito.imprimio !== true, String(dom.escrito.imprimio));
  ok('⭐ …y la ventana lo dice, en vez de quedarse muda',
    /Cargando las fotos/.test(bar.hijos[0].textContent), bar.hijos[0].textContent);
  ok('dice cuántas faltan', /\(1\)/.test(bar.hijos[0].textContent), bar.hijos[0].textContent);

  enCamino.llega();                          // llega la foto
  await clic;
  ok('⭐ cuando llega la foto, SÍ se imprime', dom.escrito.imprimio === true);
  ok('y el título vuelve a la normalidad',
    bar.hijos[0].textContent === 'Vista previa del documento', bar.hijos[0].textContent);
  restaurar();
};

// ── 3.c) Una foto ROTA no puede trancar el botón para siempre ────────────
const bloque3c = async () => {
  const rota = fotoFalsa(false);
  const dom = hacerDom([rota]); const rafs = [];
  const { mod, restaurar } = cargarPdf(dom, rafs);
  mod.exports.exportPdf('<html>ROTA</html>', 'w.pdf');
  correrRafs(rafs);
  const btnPrint = dom.body.hijos[0].hijos[0].hijos[0].hijos[1].hijos[1];

  const clic = btnPrint.onclick();
  await new Promise((r) => setTimeout(r, 5));
  ok('con la foto rota todavía sin resolver, espera', dom.escrito.imprimio !== true);
  rota.llega('error');                       // el navegador avisa que falló
  await clic;
  ok('⭐ una foto que falla NO tranca el botón: igual se imprime',
    dom.escrito.imprimio === true, String(dom.escrito.imprimio));
  restaurar();
};

// ── 3.d) Una foto ya rota (complete=true, nunca cargó) no se espera ──────
const bloque3d = async () => {
  // `complete` en true = el navegador ya terminó con ella, cargara o no.
  const dom = hacerDom([fotoFalsa(true)]); const rafs = [];
  const { mod, restaurar } = cargarPdf(dom, rafs);
  mod.exports.exportPdf('<html>YA</html>', 'v.pdf');
  correrRafs(rafs);
  const btnPrint = dom.body.hijos[0].hijos[0].hijos[0].hijos[1].hijos[1];
  await btnPrint.onclick();
  ok('⭐ si ninguna está pendiente, imprime de una vez', dom.escrito.imprimio === true);
  restaurar();
};

// ── 3.e) Cerrar mientras cargan las fotos no manda a imprimir ────────────
const bloque3e = async () => {
  const enCamino = fotoFalsa(false);
  const dom = hacerDom([enCamino]); const rafs = [];
  const { mod, restaurar } = cargarPdf(dom, rafs);
  const p = mod.exports.exportPdf('<html>CIERRA</html>', 'u.pdf');
  correrRafs(rafs);
  const btns = dom.body.hijos[0].hijos[0].hijos[0].hijos[1];
  const btnCancel = btns.hijos[0], btnPrint = btns.hijos[1];

  const clic = btnPrint.onclick();
  await new Promise((r) => setTimeout(r, 5));
  btnCancel.onclick();                       // cierra mientras carga
  enCamino.llega();
  await clic;
  ok('⭐ si cerró mientras cargaban, NO se manda a imprimir',
    dom.escrito.imprimio !== true, String(dom.escrito.imprimio));
  const r = await p;
  ok('…y se resuelve false (los efectos NO se ejecutan)', r === false, String(r));
  restaurar();
};

// ══════════════════════════════════════════════════════════════════════════
// 3.f) ⭐ UNA FOTO PEGADA NO PUEDE TRANCAR EL BOTÓN PARA SIEMPRE
//      Foto que nunca llega y nunca falla (red caída, archivo borrado del
//      bucket): vencido el tope de tiempo se imprime con lo que haya.
//      El reloj se comprime para no tener que esperar los 15 s de verdad.
// ══════════════════════════════════════════════════════════════════════════
const bloque3f = async () => {
  const pegada = fotoFalsa(false);           // no llega jamás
  const dom = hacerDom([pegada]); const rafs = [];

  const realST = globalThis.setTimeout;
  let huboEspera = 0;
  // Cualquier plazo largo (el tope de `esperarFotos`) se dispara enseguida.
  globalThis.setTimeout = (fn, ms, ...r) => {
    if (ms >= 1000) { huboEspera = ms; return realST(fn, 1, ...r); }
    return realST(fn, ms, ...r);
  };

  const { mod, restaurar } = cargarPdf(dom, rafs);
  mod.exports.exportPdf('<html>PEGADA</html>', 't.pdf');
  correrRafs(rafs);
  const btnPrint = dom.body.hijos[0].hijos[0].hijos[0].hijos[1].hijos[1];

  await btnPrint.onclick();
  ok('⭐ con una foto pegada, el tope de tiempo deja imprimir igual',
    dom.escrito.imprimio === true, String(dom.escrito.imprimio));
  ok('⭐ y el tope existe de verdad (no es una espera infinita)',
    huboEspera >= 1000, `plazo=${huboEspera}`);
  ok('el tope es razonable: ni eterno ni tan corto que no sirva',
    huboEspera >= 5000 && huboEspera <= 60000, `plazo=${huboEspera}`);

  globalThis.setTimeout = realST;
  restaurar();
};

// ── 4) Sin requestAnimationFrame (algún navegador viejo) igual escribe ────
const bloque4 = async () => {
  const dom = hacerDom();
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
  mod.exports.exportPdf('<html>SIN RAF</html>', 'sinraf.pdf');
  ok('sin requestAnimationFrame tampoco escribe de inmediato', dom.escrito.html === null);
  await new Promise((r) => setTimeout(r, 5));
  ok('⭐ …pero el respaldo con setTimeout sí escribe',
    dom.escrito.html === '<html>SIN RAF</html>', String(dom.escrito.html));
  g.document = viejoDoc; g.requestAnimationFrame = viejoRaf;
};

// ── 5) 🚫 Que nadie vuelva a poner `decoding="async"` en el reporte ──────
// Se puso el 26-ago-2026 por rendimiento y hubo que quitarlo el mismo día:
// permite pintar sin esperar la foto, y al imprimir salían recuadros negros.
{
  const rep = fs.readFileSync(path.join(ROOT, 'src/lib/machineServiceReport.ts'), 'utf8');
  // Solo las etiquetas `<img>` de verdad: el comentario que explica por qué NO
  // hay que ponerlo tiene que poder nombrarlo sin que la prueba se dispare.
  const etiquetas = rep.match(/<img[^>]*>/g) ?? [];
  ok('hay imágenes en el reporte que vigilar', etiquetas.length >= 2, String(etiquetas.length));
  ok('🚫 NINGUNA etiqueta <img> usa decoding="async"',
    etiquetas.every((t) => !/decoding=/.test(t)),
    etiquetas.filter((t) => /decoding=/.test(t)).join(' | '));
  ok('el aviso de por qué no volver a ponerlo sigue escrito',
    /NO VOLVER A PONERLO/.test(rep));
}

// Las pruebas asíncronas van EN ORDEN: comparten `globalThis.document`, así que
// dos a la vez se pisarían el DOM la una a la otra.
await bloque3();
await bloque3b();
await bloque3c();
await bloque3d();
await bloque3e();
await bloque3f();
await bloque4();

if (fail) {
  console.log(`✗ ${fail} FALLO(S):\n` + malas.map((m) => '  · ' + m).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nLa ventana se pinta primero, el documento se escribe después, y no se imprime sin las fotos.`);
