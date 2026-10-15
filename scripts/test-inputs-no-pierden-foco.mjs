// ⌨️ Candado: NINGÚN bloque con TextInput se define DENTRO de otro componente
// y se monta como <Etiqueta/> — 15-oct-2026.
//
// EL BUG QUE PREVIENE (reportado por el cliente en Pago a personal →
// Bonos/Deducciones): «cada que coloco una letra me deselecciona». Causa: un
// componente declarado dentro del render (`const LineEditor = (...) => ...`) es
// una FUNCIÓN NUEVA en cada render; React la ve como un TIPO distinto, así que
// DESMONTA y vuelve a montar todo su subárbol. Al remontarse el TextInput, el
// navegador pierde el foco y el cursor — una letra por campo y afuera.
//
// LA REGLA: un bloque de interfaz con TextInput que viva dentro de otro
// componente se LLAMA como función (`{lineEditor({...})}`), no se monta como
// etiqueta JSX; así su JSX entra en el árbol del padre y React lo reconcilia
// por posición, sin remontar. (La otra salida válida es sacarlo del componente,
// a nivel de módulo; este candado también la acepta, porque deja de estar
// indentado.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/** Todos los .tsx de pantallas y componentes. */
function tsxFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const archivos = [
  ...tsxFiles(path.join(ROOT, 'src/screens')),
  ...tsxFiles(path.join(ROOT, 'src/components')),
];

const culpables = [];
for (const file of archivos) {
  const src = fs.readFileSync(file, 'utf8');
  const lineas = src.split('\n');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  lineas.forEach((linea, i) => {
    // Un componente declarado DENTRO de otro empieza con indentación, no en la
    // columna 0 (los de nivel de módulo no sufren el remontaje).
    const m = /^\s+const ([A-Z][A-Za-z0-9_]*) = \(/.exec(linea);
    if (!m) return;
    const nombre = m[1];
    // Dónde TERMINA ese componente: en la primera línea con CONTENIDO cuya
    // sangría sea igual o menor que la de su declaración (su propio `);` o
    // `};`). Medirlo por sangría y no por palabras clave evita que el cuerpo se
    // desborde hacia abajo y acuse a un bloque vecino que sí tiene TextInput.
    const sangria = (s) => (/^\s*/.exec(s) || [''])[0].length;
    const nivel = sangria(linea);
    // La firma puede ocupar varias líneas (un tipo largo entre llaves): el cuerpo
    // arranca recién en la línea que abre con `=> (` o `=> {`.
    let abre = i;
    while (abre < lineas.length && !/=>.*[({]\s*$/.test(lineas[abre])) abre++;
    if (abre >= lineas.length) return;
    let fin = lineas.length;
    for (let j = abre + 1; j < lineas.length; j++) {
      if (lineas[j].trim() === '') continue;
      if (sangria(lineas[j]) <= nivel) { fin = j + 1; break; } // incluye el cierre
    }
    const cuerpo = lineas.slice(i, fin).join('\n');
    if (!cuerpo.includes('<TextInput')) return;  // sin campos de texto no hay foco que perder
    // ¿Se monta como etiqueta JSX? Si solo se llama como función, está bien.
    const comoEtiqueta = [' ', '/', '>'].some((c) => src.includes('<' + nombre + c));
    if (!comoEtiqueta) return;
    culpables.push(`${rel}:${i + 1} · <${nombre}/> tiene TextInput y se monta como etiqueta`);
  });
}

if (culpables.length) {
  console.log(`\n⌨️  Foco de los campos: ${culpables.length} FALLO(S)`);
  culpables.forEach((c) => console.log(`  ✗ ${c}`));
  console.log('\n  Un bloque con TextInput definido dentro del render se REMONTA en cada');
  console.log('  tecla y el campo pierde el foco. Llámalo como función: {miBloque({...})}.');
  process.exit(1);
}
console.log(`\n⌨️  Foco de los campos: ${archivos.length} archivo(s) revisados · 0 FALLO(S)`);
console.log('   Ningún bloque con TextInput se remonta en cada tecla.');
