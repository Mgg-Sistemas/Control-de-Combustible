/*
 * Test de la AMONESTACIÓN ESCRITA (21-ago-2026).
 *
 * QUÉ PEDIDO CUBRE (textual del cliente):
 *   «para empleados así como están las constancias de trabajo y de carnet
 *    necesito una de amonestación»
 *
 * LO QUE BLINDA (`src/lib/amonestacion.ts`):
 *   · ⭐ NO INVENTA NADA. Sin fecha del hecho pone una raya, no la fecha de hoy.
 *     Sin fundamento legal NO escribe artículos: los pone la empresa. Un papel
 *     disciplinario con un dato inventado es peor que no tener papel.
 *   · La fecha del HECHO y la fecha de EMISIÓN son distintas y no se mezclan.
 *   · El recuadro de DESCARGOS del trabajador sale SIEMPRE, aunque nadie lo
 *     llene: sin espacio para responder, la sanción es más fácil de tumbar.
 *   · La casilla "SE NEGÓ A FIRMAR" sale SIEMPRE. Es el caso que más problemas
 *     da en la práctica y tiene que quedar asentado en el mismo papel.
 *   · NO lleva firma escaneada aunque el sistema tenga dos guardadas: una
 *     amonestación pre-firmada se puede emitir sin que el jefe se entere.
 *   · Lo opcional que no se pasa DESAPARECE entero, sin dejar hueco ni guion.
 *   · Nada de lo que escribe un usuario se cuela como HTML.
 *
 * No usa framework de test (el repo no tiene): transpila el .ts en memoria con
 * el `typescript` ya instalado.
 *
 *   node scripts/test-amonestacion.mjs   (o: npm run test:all)
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

// Cargador recursivo de .ts con stubs por NOMBRE de módulo (igual que
// test-recibo-jornada / test-reportes-paridad).
const stubs = {};
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
    const base = id.split('/').pop();
    if (stubs[base]) return stubs[base];
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

// El logo real son ~40 KB de base64: se sustituye por un marcador para que el
// HTML del test sea legible. `company` SÍ se carga de verdad, porque el nombre
// que sale en el membrete es parte de lo que se está probando.
stubs['logoData'] = { LOGO_DATA_URI: 'data:image/png;base64,LOGO' };

const { amonestacionHtml, GRADO_LABEL } = loadTs(path.join(ROOT, 'src/lib/amonestacion.ts'));
const { COMPANY_NAME } = loadTs(path.join(ROOT, 'src/lib/company.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const BASE = { fullName: 'JUAN PEREZ', cedula: 'V-12345678', cargo: 'OPERADOR' };

// ── 1) EL DOCUMENTO: mismo formato que la constancia de trabajo ────────────
{
  const h = amonestacionHtml(BASE);
  ok('es un documento HTML completo', h.startsWith('<!doctype html>') && h.trim().endsWith('</html>'));
  ok('tamaño carta con márgenes de 2 cm', /@page\{\s*margin:2cm;\s*size:letter\s*\}/.test(h));
  ok('title vacío (el nombre lo pone exportPdf)', h.includes('<title></title>'));
  ok('lleva el logo en el membrete', h.includes('data:image/png;base64,LOGO'));
  ok('el membrete dice el nombre largo de la empresa', h.includes(COMPANY_NAME));
  ok('el cuerpo dice el nombre corto, igual que la constancia', h.includes('SOS LA GUAIRA'));
  ok('el pie lleva sello de impresión', /Impreso el \d{2}\/\d{2}\/\d{4}/.test(h));
  // ⭐ Una sola imagen: el logo. Si algún día alguien mete una firma escaneada
  // (firmaData.ts), este test lo caza.
  eq('⭐ NO lleva firma escaneada: una sola imagen', (h.match(/<img/g) || []).length, 1);
}

// ── 2) LOS DATOS DEL TRABAJADOR ───────────────────────────────────────────
{
  const h = amonestacionHtml({ ...BASE, department: 'OPERACIONES', fichaNumber: '0042', hireDate: '2024-03-15' });
  ok('sale el nombre', h.includes('JUAN PEREZ'));
  ok('sale la cédula', h.includes('V-12345678'));
  ok('sale el cargo', h.includes('OPERADOR'));
  ok('sale el departamento', h.includes('OPERACIONES'));
  ok('sale la ficha', h.includes('0042'));
  ok('la fecha de ingreso sale en texto largo', h.includes('15 de marzo de 2024'));
}

// ── 3) LO OPCIONAL QUE NO SE PASA, DESAPARECE ENTERO ──────────────────────
{
  const h = amonestacionHtml(BASE);
  ok('sin departamento no sale el renglón', !h.includes('Departamento'));
  ok('sin ficha no sale el renglón', !h.includes('N.° de ficha'));
  ok('sin fecha de ingreso no sale el renglón', !h.includes('Fecha de ingreso'));
  ok('pero los datos de identidad SÍ van siempre', h.includes('Trabajador(a)') && h.includes('Cédula de identidad') && h.includes('Cargo'));
}

// ── 4) ⭐ LA FECHA DEL HECHO NO ES LA DE HOY ──────────────────────────────
{
  const h = amonestacionHtml({ ...BASE, fechaHecho: '2026-08-18' });
  ok('la fecha del hecho sale en texto largo', h.includes('18 de agosto de 2026'));
  // Sin fecha del hecho NO se rellena con hoy: va una raya para escribirla.
  const sin = amonestacionHtml(BASE);
  ok('⭐ sin fecha del hecho va una RAYA, no la de hoy', /hecho ocurrido el <span class="fill">_{10,}<\/span>/.test(sin));
  // La hora es opcional y se suma al texto.
  const conHora = amonestacionHtml({ ...BASE, fechaHecho: '2026-08-18', horaHecho: '7:30 a. m.' });
  ok('con hora, la menciona', conHora.includes('aproximadamente a las 7:30 a. m.'));
  ok('sin hora, no dice "aproximadamente"', !h.includes('aproximadamente'));
}

// ── 5) EL TIPO DE FALTA ───────────────────────────────────────────────────
{
  const h = amonestacionHtml({ ...BASE, tipoFalta: 'Inasistencia injustificada', fechaHecho: '2026-08-18' });
  ok('sale el tipo de falta', h.includes('Inasistencia injustificada'));
  ok('la frase se lee bien con falta', h.includes('llamado de atención formal</b> por <span class="fill">Inasistencia injustificada</span>, hecho ocurrido el'));
  // Sin falta la frase NO puede quedar coja ("por , hecho ocurrido").
  const sin = amonestacionHtml({ ...BASE, fechaHecho: '2026-08-18' });
  ok('⭐ sin falta la frase sigue siendo gramatical', sin.includes('llamado de atención formal</b> por el hecho ocurrido el'));
  ok('sin falta no queda una coma huérfana', !/por\s*<span class="fill"><\/span>/.test(sin) && !sin.includes('por , '));
}

// ── 6) LA DESCRIPCIÓN: texto o renglones para llenar a mano ───────────────
{
  const con = amonestacionHtml({ ...BASE, descripcion: 'No se presentó a su turno de las 7:00 a. m. y no avisó.' });
  ok('sale el relato', con.includes('No se presentó a su turno'));
  ok('con relato NO imprime renglones vacíos en ese recuadro', (con.match(/class="renglones"/g) || []).length === 1);
  const sin = amonestacionHtml(BASE);
  ok('⭐ sin relato imprime renglones para escribir a mano', (sin.match(/class="renglones"/g) || []).length === 2);
  // Los saltos de línea del formulario se respetan en el papel.
  const multi = amonestacionHtml({ ...BASE, descripcion: 'Primera línea\nSegunda línea' });
  ok('respeta los saltos de línea', multi.includes('Primera línea<br/>Segunda línea'));
}

// ── 7) EL GRADO (primera / segunda / tercera) ─────────────────────────────
{
  eq('las tres etiquetas', [GRADO_LABEL.primera, GRADO_LABEL.segunda, GRADO_LABEL.tercera],
     ['Primera amonestación', 'Segunda amonestación', 'Tercera amonestación']);
  const h = amonestacionHtml({ ...BASE, grado: 'segunda' });
  ok('sale el grado', h.includes('Segunda amonestación'));
  const sin = amonestacionHtml(BASE);
  ok('sin grado no sale el renglón', !sin.includes('class="grado"'));
}

// ── 8) LA REINCIDENCIA: va en el SUBTÍTULO, y un 0 no se menciona ─────────
// Vive junto al grado, arriba del todo, no en un párrafo perdido en el medio:
// lo primero que mira quien recibe el papel es si ya van tres.
{
  const h = amonestacionHtml({ ...BASE, previas: 2 });
  ok('menciona las previas', h.includes('2 amonestación(es) previa(s) en el expediente'));
  ok('las previas van en el subtítulo', /class="grado">[^<]*previa\(s\)/.test(h));
  // Con grado Y previas, los dos salen en el mismo renglón separados por " · ".
  const both = amonestacionHtml({ ...BASE, grado: 'tercera', previas: 2 });
  ok('grado y previas comparten renglón', both.includes('Tercera amonestación · 2 amonestación(es) previa(s) en el expediente'));
  // Solo previas, sin grado: el renglón sale igual.
  ok('solo previas también sale', amonestacionHtml({ ...BASE, previas: 1 }).includes('class="grado">1 amonestación(es) previa(s)'));
  ok('⭐ con 0 previas NO dice nada', !amonestacionHtml({ ...BASE, previas: 0 }).includes('previa(s)'));
  ok('sin el dato tampoco dice nada', !amonestacionHtml(BASE).includes('previa(s)'));
  ok('basura no revienta ni inventa', !amonestacionHtml({ ...BASE, previas: NaN }).includes('previa(s)'));
}

// ── 9) ⭐ EL FUNDAMENTO LEGAL NO SE INVENTA ───────────────────────────────
{
  const sin = amonestacionHtml(BASE);
  ok('⭐ sin fundamento NO escribe artículos', !sin.includes('Fundamento'));
  ok('⭐ no aparece ninguna ley inventada', !/LOTTT|art[íi]culo\s*\d+/i.test(sin));
  const con = amonestacionHtml({ ...BASE, baseLegal: 'Artículo 79 de la LOTTT.' });
  ok('con fundamento, lo escribe tal cual', con.includes('<b>Fundamento:</b> Artículo 79 de la LOTTT.'));
}

// ── 10) LO QUE VA SIEMPRE (debido proceso) ────────────────────────────────
{
  const h = amonestacionHtml(BASE);
  ok('⭐ el recuadro de DESCARGOS va siempre', h.includes('Descargos del trabajador(a)'));
  ok('⭐ la casilla SE NEGÓ A FIRMAR va siempre', h.includes('Se negó a firmar'));
  ok('advierte de la reincidencia', h.includes('<b>reincidencia</b>'));
  ok('se expide en dos ejemplares', h.includes('dos (2) ejemplares'));
}

// ── 11) LAS TRES FIRMAS ───────────────────────────────────────────────────
{
  const h = amonestacionHtml(BASE);
  ok('firma del trabajador', h.includes('>Trabajador(a)</div>'));
  ok('firma del testigo', h.includes('>Testigo</div>'));
  ok('cargo por defecto de quien emite', h.includes('Supervisor / Recursos Humanos'));
  const con = amonestacionHtml({ ...BASE, emiteNombre: 'DORIANNE PEREZ', emiteCargo: 'Jefa de Administración', testigoNombre: 'ANA GOMEZ', testigoCedula: 'V-99887766' });
  ok('sale quien emite', con.includes('DORIANNE PEREZ') && con.includes('Jefa de Administración'));
  ok('sale el testigo con su cédula', con.includes('ANA GOMEZ') && con.includes('C.I. V-99887766'));
}

// ── 12) SIN DATOS NO REVIENTA: sirve como planilla en blanco ──────────────
{
  const h = amonestacionHtml({ fullName: '' });
  ok('genera igual', h.startsWith('<!doctype html>'));
  ok('pone rayas donde falta el dato', h.includes('________________________'));
  ok('lugar por defecto', h.includes('La Guaira, Venezuela'));
  ok('no imprime "null" ni "undefined"', !/>null<|>undefined<|null,|undefined,/.test(h));
}

// ── 13) NADA DE LO QUE ESCRIBE UN USUARIO SE CUELA COMO HTML ──────────────
{
  const h = amonestacionHtml({
    fullName: '<script>alert(1)</script>',
    cedula: 'V-1 & V-2',
    tipoFalta: '<b>falsa negrita</b>',
    descripcion: '<img src=x onerror=alert(1)>',
    baseLegal: '<i>ley</i>',
    testigoNombre: '<u>testigo</u>',
  });
  ok('el nombre va escapado', h.includes('&lt;script&gt;') && !h.includes('<script>'));
  ok('el & va escapado', h.includes('V-1 &amp; V-2'));
  ok('la falta va escapada', h.includes('&lt;b&gt;falsa negrita&lt;/b&gt;'));
  ok('⭐ la descripción va escapada', h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  ok('el fundamento va escapado', h.includes('&lt;i&gt;ley&lt;/i&gt;'));
  ok('el testigo va escapado', h.includes('&lt;u&gt;testigo&lt;/u&gt;'));
  // Sigue habiendo UNA sola imagen: la del membrete.
  eq('la inyección no metió una imagen', (h.match(/<img/g) || []).length, 1);
}

// ── 14) EL LUGAR SALE DE LA FICHA ─────────────────────────────────────────
{
  const h = amonestacionHtml({ ...BASE, city: 'Catia La Mar', state: 'La Guaira' });
  ok('usa ciudad y estado', h.includes('Catia La Mar, La Guaira'));
  ok('solo ciudad también sirve', amonestacionHtml({ ...BASE, city: 'Maiquetía' }).includes('en Maiquetía, a la fecha'));
}

// ── Resultado ─────────────────────────────────────────────────────────────
console.log(`\n⚠️   Amonestación escrita`);
console.log(`   ${pass} OK · ${fail} fallo(s)`);
if (fail) {
  console.log(`\n${failures.join('\n')}\n`);
  process.exit(1);
}
console.log('   ✅ Todo en verde\n');
