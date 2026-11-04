// Prueba del listado de proveedores en PDF (03-nov-2026): rubros, conteo,
// teléfono, dirección corta, columnas y escapado.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'url';
import os from 'os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src/lib/proveedoresListado.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
const tmp = path.join(os.tmpdir(), `proveedoresListado-${process.pid}.mjs`);
fs.writeFileSync(tmp, js);
const L = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
const fallos = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fallos.push(`  ✗ ${n}`); } };
const eq = (n, a, b) => { const c = JSON.stringify(a) === JSON.stringify(b); if (c) pass++; else { fail++; fallos.push(`  ✗ ${n}\n    esperado: ${JSON.stringify(b)}\n    obtenido: ${JSON.stringify(a)}`); } };

const P = [
  { id: '1', name: 'Ferretería El Clavo', phone: '0412-1111111', address: 'Av. Soublette, local 3, frente a la plaza, Maiquetía, estado La Guaira, Venezuela', tags: ['FERRETERIA'] },
  { id: '2', name: 'Aseo Total', phone: null, pago_movil_phone: '0414-2222222', address: 'Catia la Mar', tags: ['limpieza', 'HIGIENE'] },
  { id: '3', name: 'Multiservicios <b>X</b> & Cía', phone: '0212', address: null, tags: ['FERRETERIA', 'LIMPIEZA'] },
  { id: '4', name: 'Sin Etiqueta CA', phone: '', address: '', tags: null },
  { id: '5', name: 'Inactivo SA', phone: '1', address: 'x', tags: ['FERRETERIA'], active: false },
];

eq('rubros en mayúscula y sin repetir; sin etiquetas = SIN RUBRO', [L.rubrosDe(P[1]), L.rubrosDe(P[3])], [['LIMPIEZA', 'HIGIENE'], ['SIN RUBRO']]);
eq('teléfono: el de contacto o, si falta, el de Pago Móvil', [L.telefonoDe(P[0]), L.telefonoDe(P[1]), L.telefonoDe(P[3])], ['0412-1111111', '0414-2222222', '']);
const dc = L.direccionCorta(P[0].address);
ok('dirección corta: cabe en el largo, corta en palabra y termina en «…»', dc.length <= L.LARGO_DIRECCION_CORTA + 1 && dc.endsWith('…') && !dc.includes('Venezuela'));
eq('una dirección corta no se toca', L.direccionCorta('  Catia   la Mar '), 'Catia la Mar');

const activos = L.filtrarProveedores(P, []);
eq('sin rubro elegido salen todos los ACTIVOS, por nombre', activos.map((p) => p.id), ['2', '1', '3', '4']);
eq('¿cuántas ferreterías? (el inactivo no cuenta)', L.conteoPorRubro(activos).find((c) => c.rubro === 'FERRETERIA').n, 2);
eq('filtro por un rubro', L.filtrarProveedores(P, ['LIMPIEZA']).map((p) => p.id), ['2', '3']);
eq('filtro por dos rubros: cada proveedor una sola vez', L.filtrarProveedores(P, ['LIMPIEZA', 'FERRETERIA']).map((p) => p.id), ['2', '1', '3']);

const sel = ['FERRETERIA', 'LIMPIEZA'];
const elegidos = L.filtrarProveedores(P, sel);
const g = L.gruposPorRubro(elegidos, sel);
eq('agrupado: solo los rubros elegidos, con su gente', g.map((x) => [x.rubro, x.proveedores.map((p) => p.id)]), [['FERRETERIA', ['1', '3']], ['LIMPIEZA', ['2', '3']]]);
eq('SIN RUBRO va al final', L.gruposPorRubro(activos, []).map((x) => x.rubro).at(-1), 'SIN RUBRO');

const O = L.OPCIONES_LISTADO_PROVEEDORES_INICIAL;
const html = L.cuerpoListadoProveedores({ proveedores: elegidos, rubrosSel: sel, opciones: O });
ok('lo pedido sale: proveedor, teléfono y dirección', /<th>Proveedor<\/th>/.test(html) && /<th>Teléfono<\/th>/.test(html) && /<th>Dirección<\/th>/.test(html));
ok('RIF y correo nacen ocultos', !/<th>RIF<\/th>/.test(html) && !/<th>Correo<\/th>/.test(html));
ok('una tabla por rubro con cuántos hay', /🏷️ FERRETERIA <span>· 2 proveedores<\/span>/.test(html) && /🏷️ LIMPIEZA <span>· 2 proveedores<\/span>/.test(html));
ok('el cuadro de arriba cuenta cada proveedor UNA vez (3, no 4)', /<div class="t">3<\/div><div class="s">Proveedores<\/div>/.test(html));
ok('y avisa que uno con varios rubros sale en cada uno', /sale en cada uno/.test(html));
ok('🔒 el nombre va escapado', !html.includes('<b>X</b>') && html.includes('&lt;b&gt;X&lt;/b&gt; &amp; Cía'));
ok('lo vacío sale «—»', /<td class="tel">—<\/td>|<td>—<\/td>/.test(L.cuerpoListadoProveedores({ proveedores: [P[3]], rubrosSel: [], opciones: O })));
const plano = L.cuerpoListadoProveedores({ proveedores: elegidos, rubrosSel: sel, opciones: { ...O, agrupar: false, sinRif: false, sinResumen: true } });
ok('sin agrupar: una sola tabla con la columna Rubro', (plano.match(/<table>/g) || []).length === 1 && /<th>Rubro<\/th>/.test(plano) && /<th>RIF<\/th>/.test(plano));
ok('apagar el resumen lo quita sin rastro', !/class="tiles"/.test(plano));
ok('apagar teléfono quita la columna', !/<th>Teléfono<\/th>/.test(L.cuerpoListadoProveedores({ proveedores: elegidos, rubrosSel: sel, opciones: { ...O, sinTelefono: true } })));
eq('subtítulo dice los rubros', [L.subtituloListadoProveedores([]), L.subtituloListadoProveedores(['FERRETERIA'])], ['Todos los rubros', 'Rubro: FERRETERIA']);
ok('el nombre del archivo dice los rubros', L.nombreArchivoListadoProveedores(['FERRETERIA'], '03-11-2026') === 'Proveedores (FERRETERIA) 03-11-2026');

const comp = fs.readFileSync(path.join(ROOT, 'src/components/ListadoProveedoresPdf.tsx'), 'utf8');
const compras = fs.readFileSync(path.join(ROOT, 'src/screens/ComprasScreen.tsx'), 'utf8');
ok('la pestaña Proveedores monta el listado', /<ListadoProveedoresPdf proveedores=\{suppliers\} \/>/.test(compras));
ok('el listado solo lee (no escribe en la base)', !/supabase|\.insert\(|\.update\(|\.delete\(/.test(comp));

console.log(`\n🖨️ Listado de proveedores: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { console.error(fallos.join('\n')); process.exit(1); }
