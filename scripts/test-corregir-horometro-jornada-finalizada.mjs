/*
 * EL INSPECTOR PUEDE CORREGIR HORÓMETRO Y FOTO CON LA JORNADA YA FINALIZADA
 * — pedido del cliente del 28-oct-2026:
 *
 *   «En la vista de teléfono de inspectores, cuando termina la jornada no le deja
 *    editar (…) el horómetro inicial o final o la foto».
 *
 * Causa: el panel «✏️ Horómetros que cargaste (hoy y ayer)» vivía SOLO en la rama
 * «iniciar jornada» del ternario `jornadaStart ? … : shiftClosed ? … : …`. Al
 * finalizar, `shiftClosed` se vuelve true y el panel desaparecía.
 *
 * Esta prueba fija:
 *   1. El panel se arma UNA sola vez (`panelCorregirHoro`) y se pinta en la rama
 *      `shiftClosed` (jornada finalizada) y en la de iniciar.
 *   2. NO se pinta con la jornada ABIERTA (Finalizar pisaría la corrección).
 *   3. Sigue siendo hoy y ayer, modo inspector, con el guardado de siempre.
 *
 *   node scripts/test-corregir-horometro-jornada-finalizada.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0; const malas = [];
const ok = (n, c, extra = '') => { if (c) pass++; else { fail++; malas.push(n + (extra ? `  → ${extra}` : '')); } };

const crudo = fs.readFileSync(path.join(ROOT, 'src/screens/SupervisorScreen.tsx'), 'utf8');
// Fuera comentarios (// y {/* */} y /* */) para que comentar una línea no engañe a la prueba.
const src = crudo
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// 1) Una sola definición del panel, con su condición y el modal en modo inspector.
const defs = src.match(/const panelCorregirHoro = ci && horoEditables\.some\(\(d\) => d\.lecturas\.length > 0\) \? \(/g) || [];
ok('panelCorregirHoro se define una sola vez', defs.length === 1, `definiciones: ${defs.length}`);
const ini = src.indexOf('const panelCorregirHoro');
const fin = src.indexOf(') : null;', ini);
const panel = ini >= 0 && fin > ini ? src.slice(ini, fin) : '';
ok('el panel abre HorometroCorregirModal en modo inspector', /<HorometroCorregirModal[\s\S]*?modo="inspector"/.test(panel));
ok('el panel recarga las lecturas tras guardar (no deja datos viejos)', /setHoroEditRecarga\(\(n\) => n \+ 1\)/.test(panel));
ok('el modal NO se pinta duplicado fuera del panel', (src.match(/<HorometroCorregirModal/g) || []).length === 1);

// 2) Se pinta en la rama de jornada finalizada y en la de iniciar; no en la abierta.
const iAbierta = src.indexOf(') : jornadaStart ? (');
const iCerrada = src.indexOf(') : shiftClosed ? (', iAbierta);
const iIniciar = src.indexOf('{/*', iCerrada) >= 0 ? src.indexOf(') : (', iCerrada) : src.indexOf(') : (', iCerrada);
ok('existe la secuencia jornadaStart → shiftClosed → iniciar', iAbierta > 0 && iCerrada > iAbierta && iIniciar > iCerrada);
const ramaAbierta = src.slice(iAbierta, iCerrada);
const ramaCerrada = src.slice(iCerrada, iIniciar);
const ramaIniciar = src.slice(iIniciar, iIniciar + 20000);
ok('jornada FINALIZADA (shiftClosed) muestra el panel de corrección', ramaCerrada.includes('{panelCorregirHoro}'));
ok('jornada FINALIZADA sigue avisando que ya cerró', /ya cerró/.test(ramaCerrada));
ok('rama de iniciar jornada sigue mostrando el panel', ramaIniciar.includes('{panelCorregirHoro}'));
ok('jornada ABIERTA no muestra el panel (Finalizar pisaría la corrección)', !ramaAbierta.includes('panelCorregirHoro'));

// 3) La ventana sigue siendo hoy y ayer (la misma de siempre, sin días nuevos).
ok('las lecturas editables son las de HOY y AYER', /setHoroEditables\(\[\{ roundDate: today, lecturas: deHoy \}, \{ roundDate: yesterday, lecturas: deAyer \}\]\)/.test(src));

// 4) El modal sigue guardando por la ruta única (reemplaza la lectura del día/turno).
const modal = fs.readFileSync(path.join(ROOT, 'src/components/HorometroCorregirModal.tsx'), 'utf8');
ok('el modal guarda con guardarLecturaHorometro (ruta única)', /guardarLecturaHorometro\(machineryId, roundDate, turno,/.test(modal));
ok('el modal en modo inspector nunca hace reinicio y entra con origen inspector', /reinicio: esInspector \? false : reinicio/.test(modal) && /origen: esInspector \? 'inspector' : 'control'/.test(modal));

console.log(`\n${pass} OK · ${fail} fallas`);
if (fail) { for (const m of malas) console.log('  ✗ ' + m); process.exit(1); }
