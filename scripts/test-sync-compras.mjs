// 🔗 Candado: sincronización de Compras (29-oct-2026).
//
// Pedido: «si yo edito en por pagar debería reflejarse también en el requerimiento
// (p. ej. el proveedor) … evitando pérdida de datos»; «seleccionar el motorizado
// responsable, que puede ser un almacenista»; «colocar el nivel de prioridad del
// requerimiento, y que se vea en el por pagar».
// Reglas vigiladas:
//  · cuentas.order_id es el id de la ORDEN: el requerimiento NUNCA se busca con él
//    (ni `.eq('id', c.order_id)` en Por pagar, ni `.eq('order_id', r.id)` en
//    Requerimientos); se usa inventory_requirement_id;
//  · la factura ya no se escribe en «cualquier cuenta del mismo proveedor»;
//  · prioridad y motorizado van en un update APARTE y nunca con null en un alta.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
// Sin comentarios `//` para que no den falsos positivos.
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const cxp = leer('src/screens/CuentasScreen.tsx');
const req = leer('src/screens/RequerimientoTab.tsx');
const sol = leer('src/screens/SolicitudesCompraTab.tsx');
const com = leer('src/screens/ComprasScreen.tsx');
const lib = leer('src/lib/prioridadCompra.ts');

ok('Por pagar ya no busca el requerimiento con order_id', !/\.eq\(\s*'id'\s*,\s*(c|abonoDe)\.order_id\s*\)/.test(cxp));
ok('Por pagar busca el requerimiento por inventory_requirement_id', (cxp.match(/\.eq\('id', (c|abonoDe)\.inventory_requirement_id\)/g) || []).length >= 6);
ok('Requerimientos ya no busca la cuenta con order_id = id del requerimiento', !/\.eq\(\s*'order_id'\s*,\s*(r|recvFor|facturaTarget)\.id\s*\)/.test(req));
ok('la factura ya no cae en cualquier cuenta del mismo proveedor', !/order_id\.eq\.\$\{facturaTarget\.id\},supplier_id\.eq/.test(req));
ok('Requerimientos busca la cuenta por inventory_requirement_id (factura, revertir, recibir)', (req.match(/\.eq\('inventory_requirement_id', (r|recvFor|facturaTarget)\.id\)/g) || []).length >= 3);
ok('revertir desde Requerimientos ya no borra abonos sin avisar', !/from\('cuenta_abonos'\)\.delete\(\)/.test(req));
ok('la recepción no reenvía el monto a la cuenta atada', !/monto: totalMontoRecv > 0 \? totalMontoRecv : undefined/.test(req));
ok('el formulario de Por pagar no reenvía monto ni orden de una cuenta atada', /if \(edit\?\.inventory_requirement_id\) \{ delete \(fila as any\)\.monto; delete \(fila as any\)\.order_id; \}/.test(cxp));
ok('Por pagar avisa «Se sincroniza con REQ-…»', cxp.includes('🔗 Se sincroniza con'));
ok('la orden atada no reenvía renglones ni total', /atadaReq \? \{\} : \{ items, total: linesTotal\(items\) \}/.test(com));

ok('el alta del requerimiento NO lleva prioridad ni motorizado', !/insert\(\{[^}]*\b(prioridad|motorizado_)/s.test(req.slice(req.indexOf("from('inventory_requirements').insert({"), req.indexOf("from('inventory_requirements').insert({") + 600)));
ok('prioridad y motorizado van en un update aparte', req.includes('parcheExtrasReq(antes, { prioridad: prioridadReq, motorizado_user_id: motoId, motorizado_nombre: motoNombre })'));
ok('la solicitud aceptada pone la prioridad con su propio update', sol.includes(".update({ prioridad: p }).eq('id', r.id)"));

// La regla del parche (se evalúa de verdad, quitando los tipos).
const js = fs.readFileSync(path.join(ROOT, 'src/lib/prioridadCompra.ts'), 'utf8');
const ini = js.indexOf('const limpio');
const cuerpo = js.slice(ini)
  .replace(/export function parcheExtrasReq\(antes: ExtrasReq \| null, ahora: ExtrasReq\): Record<string, any>/, 'function parcheExtrasReq(antes, ahora)')
  .replace(/\(v: string \| null \| undefined\)/, '(v)')
  .replace(/const p: Record<string, any> = \{\};/, 'const p = {};');
const esP = (v) => v === 'alta' || v === 'media' || v === 'baja';
const parche = new Function('esPrioridadCompra', cuerpo + '\nreturn parcheExtrasReq;')(esP);
ok('alta sin valores → parche vacío (nada de null)', Object.keys(parche(null, { prioridad: null, motorizado_user_id: null, motorizado_nombre: '' })).length === 0);
ok('alta con motorizado → id y nombre', JSON.stringify(parche(null, { prioridad: 'alta', motorizado_user_id: 'u1', motorizado_nombre: 'Ana' })) === JSON.stringify({ prioridad: 'alta', motorizado_nombre: 'Ana', motorizado_user_id: 'u1' }));
ok('edición sin cambios → parche vacío', Object.keys(parche({ prioridad: 'baja', motorizado_user_id: null, motorizado_nombre: 'Luis' }, { prioridad: 'baja', motorizado_user_id: null, motorizado_nombre: 'Luis' })).length === 0);
ok('edición que quita la prioridad → manda null', JSON.stringify(parche({ prioridad: 'alta' }, { prioridad: null })) === JSON.stringify({ prioridad: null }));
ok('la lib reconoce el error de columna faltante', /schema cache/.test(lib));

console.log(failures.map((f) => '  ✗ ' + f).join('\n'));
console.log(`🔗 Sincronización de Compras: ${pass} OK · ${fail} FALLO(S)`);
process.exit(fail ? 1 : 0);
