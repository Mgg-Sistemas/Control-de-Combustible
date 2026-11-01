// 📜 Solicitudes e Histórico (31-oct-2026): editar una solicitud o un requerimiento queda
// en el Histórico, las marcas internas no se pierden al editar, y el solicitante puede
// cancelar SU solicitud (o quitarle un renglón) aunque no tenga permiso de Compras.
import fs from 'node:fs';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const flujo = fs.readFileSync('src/lib/requerimientoFlujo.ts', 'utf8');
// Las mismas expresiones del código (se leen del archivo, no se copian a mano).
const reBloque = new RegExp(flujo.match(/const REGEX_MARCA_BLOQUE = \/(.+)\/g;/)[1], 'g');
const reSuelta = new RegExp(flujo.match(/const REGEX_MARCA_SUELTA = \/(.+)\/g;/)[1], 'g');
const marcas = (t) => [...(t.replace(reBloque, '').match(reSuelta) || []), ...(t.match(reBloque) || [])];
const quitar = (t) => t.replace(reBloque, '').replace(reSuelta, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const obs = [
  'Para MÁQUINA 1',
  '[CONDICIONES_PAGO: CONTADO]',
  '[IVA_CUENTA: 16]',
  '[FACTURA PROVEEDOR: Nro: 1 | Empresa: X]',
  '[RECEPCIÓN ALMACÉN: Factura N° 1]',
  '[[FORMATOS_ADJUNTOS:%5B%5D:FIN_FORMATOS]]',
  '[[HISTORIAL_COMPRA:%5B%5D:FIN_HISTORIAL]]',
].join('\n');
const m = marcas(obs);
ok('reconoce las marcas sin espacios', m.includes('[CONDICIONES_PAGO: CONTADO]') && m.includes('[IVA_CUENTA: 16]'));
ok('reconoce las marcas con espacios', m.includes('[FACTURA PROVEEDOR: Nro: 1 | Empresa: X]'));
ok('reconoce las marcas con acentos', m.includes('[RECEPCIÓN ALMACÉN: Factura N° 1]'));
ok('reconoce los bloques', m.some((x) => x.startsWith('[[FORMATOS_ADJUNTOS')) && m.some((x) => x.startsWith('[[HISTORIAL_COMPRA')));
ok('al quitar marcas queda solo lo que escribió la persona', quitar(obs) === 'Para MÁQUINA 1');
ok('el texto normal en minúscula entre corchetes no se toca', quitar('ver [nota de campo]') === 'ver [nota de campo]');

// Fuentes
const sol = fs.readFileSync('src/screens/SolicitudesCompraTab.tsx', 'utf8');
ok('editar una solicitud anota «solicitud_editada»', sol.includes("tipo: 'solicitud_editada'"));
ok('editar renglones de una solicitud anota «items_modificados»', sol.includes("tipo: 'items_modificados'"));
ok('si el destino no cambió, las observaciones se guardan como estaban', sol.includes('destinoCambio') && sol.includes('preservarTodasLasMarcasEnObservaciones('));
ok('rechazar verifica que la base guardó', /\.eq\('id', rechazoTarget\.id\)\s*\.select\('id'\)/.test(sol));
ok('eliminar verifica que la base borró', sol.includes('borradas.length === 0'));
const req = fs.readFileSync('src/screens/RequerimientoTab.tsx', 'utf8');
ok('editar la cabecera de un requerimiento queda en el Histórico', req.includes("titulo: 'Requerimiento editado'") && req.includes('resumirCambiosCabeceraCompra(['));
const pm = fs.readFileSync('src/screens/SolicitudMaterialScreen.tsx', 'utf8');
ok('cancelar su solicitud recurre a la función de la base', pm.includes("rpc('solicitud_propia_cancelar'"));
ok('quitar un renglón recurre a la función de la base', pm.includes("rpc('solicitud_propia_quitar_renglon'"));
ok('la función solo cuenta si devolvió true', (pm.match(/okRpc !== true/g) || []).length >= 2);
const hist = fs.readFileSync('src/lib/comprasHistorico.ts', 'utf8');
ok('el resumen de cabecera ignora mayúsculas y espacios', hist.includes('a.toLowerCase() === d.toLowerCase()'));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
