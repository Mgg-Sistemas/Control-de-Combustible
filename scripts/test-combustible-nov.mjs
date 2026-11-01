// ⛽ Combustible (01-nov-2026): editar foto/nota de consumos e ingresos ya
// registrados (solo 'full'), teclado decimal con punto O coma en iPhone, y el
// comprobante de WhatsApp sin «�».
import fs from 'node:fs';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

// ── Copia fiel de leerNumero (src/lib/numeros.ts) ──
function leerNumero(t) {
  let s = String(t ?? '').replace(/[^0-9.,\-]/g, '');
  const negativo = s.startsWith('-');
  s = s.replace(/-/g, '');
  const comas = (s.match(/,/g) || []).length;
  const puntos = (s.match(/\./g) || []).length;
  if (comas && puntos) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comas > 1) s = s.replace(/,/g, '');
  else if (puntos > 1) s = s.replace(/\./g, '');
  else if (comas === 1) s = s.replace(',', '.');
  const n = Number(s);
  if (!isFinite(n)) return 0;
  return negativo ? -n : n;
}
// ── Copia fiel de onlyDecimal (src/lib/text.ts) ──
const onlyDecimal = (s) => {
  let t = String(s ?? '').replace(/[^0-9.,]/g, '');
  const sep = t.indexOf('.') >= 0 && (t.indexOf(',') < 0 || t.indexOf('.') < t.indexOf(',')) ? '.' : ',';
  let seen = false;
  t = t.replace(/[.,]/g, (c) => { if (c === sep && !seen) { seen = true; return sep; } return ''; });
  return t;
};
// ── Copia fiel de toNum (FuelDriverScreen) ──
const toNum = (s) => (/\d/.test(String(s ?? '')) ? leerNumero(s) : NaN);

ok('coma decimal', leerNumero('12,5') === 12.5);
ok('punto decimal', leerNumero('12.5') === 12.5);
ok('miles y decimal', leerNumero('1.234,5') === 1234.5);
ok('onlyDecimal conserva la coma', onlyDecimal('12,5') === '12,5');
ok('onlyDecimal deja un solo separador', onlyDecimal('1,2.3') === '1,23');
ok('toNum vacío es NaN', Number.isNaN(toNum('')));
ok('toNum con coma', toNum('40,75') === 40.75);
ok('antes: Number("12,5") era NaN (el bug)', Number.isNaN(Number('12,5')));

// ── Copia fiel de armarCambiosCombustible (src/lib/combustibleEdicion.ts) ──
function armar(flags, tabla, fotos, nota) {
  const fotosAct = tabla === 'dispatches' ? true : flags.ingFotos;
  const notasAct = tabla === 'dispatches' ? flags.consNotas : flags.ingNotas;
  const c = {};
  if (fotosAct) c.photos = (fotos || []).map((f) => String(f || '').trim()).filter(Boolean);
  if (notasAct) c.notes = String(nota ?? '').trim() || null;
  return c;
}
const apagado = { consNotas: false, ingNotas: false, ingFotos: false };
const c1 = armar(apagado, 'dispatches', ['a', '', ' b '], 'x');
ok('consumo manda solo photos sin columna de nota', JSON.stringify(c1) === '{"photos":["a","b"]}');
ok('ingreso sin columnas no manda nada', Object.keys(armar(apagado, 'fuel_intakes', ['a'], 'x')).length === 0);
const c2 = armar({ consNotas: true, ingNotas: true, ingFotos: true }, 'fuel_intakes', [], '  ');
ok('nota en blanco queda null', c2.notes === null && Array.isArray(c2.photos));

// ── Mensaje de WhatsApp: emojis simples, saltos reales, enlace sin wa.me ──
const urlWhatsapp = (t) => `https://api.whatsapp.com/send?text=${encodeURIComponent(t)}`;
const msg = '⛽ *COMPROBANTE DE SURTIDO - COMBUSTIBLE*\n\n⛽ *Tanque origen:* T1\n🚜 *Equipo / Maquinaria:* X';
const url = urlWhatsapp(msg);
ok('saltos de línea como %0A', url.includes('%0A%0A'));
ok('el emoji viaja en UTF-8', url.includes(encodeURIComponent('🚜')) && decodeURIComponent(url.split('text=')[1]) === msg);
ok('no hay sustitutos sueltos', !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(msg));

// ── Comprobaciones de fuente ──
const fuel = fs.readFileSync('src/lib/fuelRules.ts', 'utf8');
const lib = fs.readFileSync('src/lib/combustibleEdicion.ts', 'utf8');
const files = ['src/lib/fuelRules.ts', 'src/components/combustible/SurtidorMovil.tsx', 'src/screens/FuelDriverScreen.tsx', 'src/screens/redesign/DispatchesPilot.tsx', 'src/screens/redesign/IntakesPilot.tsx', 'src/components/RecordForm.tsx', 'src/components/combustible/EditarFotosCombustibleModal.tsx'];
for (const f of files) ok(`sin U+FFFD en ${f}`, !fs.readFileSync(f, 'utf8').includes('�'));
ok('comprobante usa urlWhatsapp', fuel.includes('const url = urlWhatsapp(texto);') && !fuel.includes('https://wa.me/?text='));
ok('comprobante sin selector de variación (FE0F)', !/️/.test(fuel.slice(fuel.indexOf('export function construirMensajeWhatsapp'), fuel.indexOf('export async function compartirPorWhatsapp'))));
ok('urlWhatsapp usa api.whatsapp.com', lib.includes('https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}'));
ok('nota y fotos de ingresos encendidas (columnas creadas)', /CONSUMOS_NOTAS_ACTIVAS = true/.test(lib) && /INGRESOS_NOTAS_ACTIVAS = true/.test(lib) && /INGRESOS_FOTOS_ACTIVAS = true/.test(lib));
ok('guardado con .select(\'id\') y aviso de 0 filas', lib.includes(".eq('id', id).select('id')") && lib.includes('0 filas'));
const surt = fs.readFileSync('src/components/combustible/SurtidorMovil.tsx', 'utf8');
ok('Surtidor sin keyboardType numeric', !surt.includes('keyboardType="numeric"') && surt.includes('keyboardType="decimal-pad"'));
ok('Surtidor lee con leerNumero', !/Number\(\w+\.replace\(',', '\.'\)\)/.test(surt) && surt.includes('leerNumero(liters)'));
const drv = fs.readFileSync('src/screens/FuelDriverScreen.tsx', 'utf8');
ok('Chofer sin keyboardType numeric', !drv.includes('keyboardType="numeric"'));
const rf = fs.readFileSync('src/components/RecordForm.tsx', 'utf8');
ok('RecordForm número con decimal-pad y leerNumero', rf.includes("f.type === 'number' ? 'decimal-pad'") && rf.includes("f.type === 'number' ? leerNumero(raw)"));
const disp = fs.readFileSync('src/screens/redesign/DispatchesPilot.tsx', 'utf8');
ok('Consumos: editar foto solo con full', disp.includes("levelMeets(moduleLevel('consumos'), 'full')") && disp.includes('tabla="dispatches"'));
const ing = fs.readFileSync('src/screens/redesign/IntakesPilot.tsx', 'utf8');
ok('Ingresos: editar detrás de full + columnas', ing.includes("levelMeets(moduleLevel('ingresos'), 'full')") && ing.includes('tabla="fuel_intakes"'));
const modal = fs.readFileSync('src/components/combustible/EditarFotosCombustibleModal.tsx', 'utf8');
ok('modal con cámara Y galería', modal.includes('📷 Cámara') && modal.includes('🖼️ Galería'));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
