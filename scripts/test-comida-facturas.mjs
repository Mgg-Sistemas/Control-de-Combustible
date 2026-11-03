// 🧾💵🙈 Cocina (03-nov-2026): empresas ocultas solo en cocina, facturas congeladas
// y pagos. Transpila las libs REALES. Datos inventados.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comida-fact-'));
const tr = (rel, out) => {
  let src = fs.readFileSync(path.join(raiz, rel), 'utf8');
  src = src.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(tmp, out), js);
};
tr('src/lib/comidaEmpresasOcultas.ts', 'comidaEmpresasOcultas.mjs');
tr('src/lib/comidaFacturas.ts', 'comidaFacturas.mjs');
tr('src/lib/comidaFacturaHtml.ts', 'comidaFacturaHtml.mjs');
const O = await import(pathToFileURL(path.join(tmp, 'comidaEmpresasOcultas.mjs')).href);
const F = await import(pathToFileURL(path.join(tmp, 'comidaFacturas.mjs')).href);
const H = await import(pathToFileURL(path.join(tmp, 'comidaFacturaHtml.mjs')).href);

// ── Ocultas ──
const ocultas = O.idsOcultas([{ company_id: 'a', oculta: true }, { company_id: 'b', oculta: false }, { company_id: 'c', oculta: true }]);
ok('ocultas: solo las que están en true', ocultas.has('a') && !ocultas.has('b') && ocultas.has('c'));
const emps = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
ok('se ofrecen solo las visibles', O.visiblesEnCocina(emps, ocultas).map((e) => e.id).join() === 'b');
ok('la ya elegida se conserva aunque esté oculta', O.visiblesEnCocina(emps, ocultas, ['c']).map((e) => e.id).join() === 'b,c');
ok('sin tabla / sin datos no se esconde nada', O.visiblesEnCocina(emps, new Set()).length === 3 && O.visiblesEnCocina(emps, null).length === 3);
ok('cuenta las ocultas', O.cuantasOcultas(emps, ocultas) === 2);
ok('reconoce la tabla que falta', O.esTablaFaltante({ code: '42P01' }) && O.esTablaFaltante({ code: 'PGRST205' }) && !O.esTablaFaltante({ code: '23505', message: 'duplicate' }) && !O.esTablaFaltante(null));

// ── Facturas ──
const EMP = '11111111-2222-3333-4444-555555555555';
const cuenta = {
  clave: EMP, nombre: ' CARBO PRUEBA ', comidas: 12, cobradas: 10, monto: 46, sinPrecio: 2,
  items: [
    { categoria: 'desayuno', plato: null, cantidad: 4, precio: 4, monto: 16, seCobra: true },
    { categoria: 'almuerzo', plato: null, cantidad: 6, precio: 5, monto: 30, seCobra: true },
    { categoria: 'cena', plato: null, cantidad: 2, precio: null, monto: 0, seCobra: true },
    { categoria: 'cena', plato: null, cantidad: 3, precio: 4, monto: 12, seCobra: false },
  ],
};
const fila = F.filaNuevaFactura(cuenta, '2026-10-01', '2026-10-31', (it) => `★${it.categoria}`, '  ');
ok('la factura congela el monto de ese momento', fila.monto_usd === 46);
ok('la factura cuenta SOLO las comidas que se cobran con precio', fila.comidas === 10 && fila.detalle.length === 2);
ok('lo interno y lo sin precio no van al detalle', !fila.detalle.some((d) => d.precio === null) && fila.detalle.every((d) => d.etiqueta.startsWith('★')));
ok('empresa con id: clase empresa y company_id', fila.cuenta_clase === 'empresa' && fila.company_id === EMP && fila.contacto_id === null);
ok('nombre limpio y nota vacía = null', fila.cuenta_nombre === 'CARBO PRUEBA' && fila.nota === null);
const CON = '99999999-8888-7777-6666-555555555555';
const filaC = F.filaNuevaFactura({ ...cuenta, clave: `contacto:${CON}`, clase: 'contacto' }, '2026-10-01', '2026-10-01', () => 'x');
ok('contacto: clase contacto y contacto_id', filaC.cuenta_clase === 'contacto' && filaC.contacto_id === CON && filaC.company_id === null);
ok('nómina y sin ficha no se facturan', !F.sePuedeFacturar({ ...cuenta, clave: 'nomina' }) && !F.sePuedeFacturar({ ...cuenta, clave: 'sin_ficha' }));
ok('en $0 no se factura', !F.sePuedeFacturar({ ...cuenta, monto: 0 }) && F.sePuedeFacturar(cuenta));

const fac = { id: 'f1', numero: 7, cuenta_clave: EMP, cuenta_nombre: 'CARBO PRUEBA', cuenta_clase: 'empresa', company_id: EMP, contacto_id: null, desde: '2026-10-01', hasta: '2026-10-31', comidas: 10, monto_usd: 46, detalle: fila.detalle, nota: null, created_at: '2026-11-01T10:00:00Z', created_by_nombre: 'Oficina', anulada_at: null, anulada_por_nombre: null, anulada_motivo: null };
const pago = (id, monto, extra = {}) => ({ id, factura_id: 'f1', monto_usd: monto, metodo: 'efectivo_usd', monto_bs: null, tasa: null, referencia: null, nota: null, comprobante_url: null, fecha_pago: '2026-11-02', created_at: `2026-11-02T1${id.length}:00:00Z`, created_by_nombre: 'Niliany', anulado_at: null, anulado_por_nombre: null, anulado_motivo: null, ...extra });
ok('sin pagos: FALTA POR PAGAR todo', F.estadoFactura(fac, []).estado === 'pendiente' && F.estadoFactura(fac, []).falta === 46);
ok('con abono: pagada en parte', F.estadoFactura(fac, [pago('p1', 20)]).estado === 'parcial' && F.estadoFactura(fac, [pago('p1', 20)]).falta === 26);
ok('completa: PAGADA', F.estadoFactura(fac, [pago('p1', 20), pago('p22', 26)]).estado === 'pagada');
ok('un pago anulado no cuenta', F.estadoFactura(fac, [pago('p1', 46, { anulado_at: '2026-11-03' })]).estado === 'pendiente');
ok('pagos de otra factura no cuentan', F.estadoFactura(fac, [{ ...pago('p1', 46), factura_id: 'otra' }]).falta === 46);
ok('anulada manda sobre todo', F.estadoFactura({ ...fac, anulada_at: '2026-11-03' }, [pago('p1', 20)]).estado === 'anulada');
ok('centavos redondos (0,1+0,2)', F.estadoFactura({ ...fac, monto_usd: 0.3 }, [pago('a', 0.1), pago('bb', 0.2)]).estado === 'pagada');

ok('rangos que se tocan', F.seCruzan('2026-10-01', '2026-10-31', '2026-10-31', '2026-11-05') && !F.seCruzan('2026-10-01', '2026-10-31', '2026-11-01', '2026-11-05'));
ok('facturas del período: solo vigentes de esa cuenta', F.facturasQueTocan([fac, { ...fac, id: 'f2', anulada_at: 'x' }, { ...fac, id: 'f3', cuenta_clave: 'otra' }], EMP, '2026-10-15', '2026-10-20').map((f) => f.id).join() === 'f1');
ok('diferencia si el mismo rango cambió', F.diferenciaDesdeFactura(fac, '2026-10-01', '2026-10-31', 50) === 4);
ok('sin diferencia en otro rango', F.diferenciaDesdeFactura(fac, '2026-10-01', '2026-10-15', 50) === 0);

const hoy = '2026-11-03';
ok('pago: pide forma de pago', /cómo pagó/i.test(F.validarPago({ montoUsd: 10, metodo: null }, 46, hoy)));
ok('pago: pide monto', /cuánto/i.test(F.validarPago({ montoUsd: 0, metodo: 'efectivo_usd' }, 46, hoy)));
ok('pago: no deja pagar de más', /más de lo que debe/.test(F.validarPago({ montoUsd: 50, metodo: 'efectivo_usd' }, 46, hoy)));
ok('pago en Bs pide tasa', /tasa/.test(F.validarPago({ montoUsd: 10, metodo: 'efectivo_bs' }, 46, hoy)));
ok('pago móvil pide referencia', /referencia/.test(F.validarPago({ montoUsd: 10, metodo: 'pago_movil', tasa: 40 }, 46, hoy)));
ok('no deja fecha de mañana', /mañana/.test(F.validarPago({ montoUsd: 10, metodo: 'efectivo_usd', fecha: '2026-11-04' }, 46, hoy)));
ok('pago completo y correcto pasa', F.validarPago({ montoUsd: 46, metodo: 'pago_movil', tasa: 40, referencia: '123' }, 46, hoy) === null);
const fp = F.filaNuevoPago('f1', { montoUsd: 10, metodo: 'pago_movil', tasa: 40.5, referencia: ' 77 ' }, hoy);
ok('pago en Bs guarda tasa y bolívares', fp.tasa === 40.5 && fp.monto_bs === 405 && fp.referencia === '77' && fp.fecha_pago === hoy);
const fu = F.filaNuevoPago('f1', { montoUsd: 10, metodo: 'zelle', tasa: 40, referencia: 'z' }, hoy);
ok('pago en $ no guarda Bs', fu.tasa === null && fu.monto_bs === null);
ok('la frase de confirmación dice todo', (() => { const t = F.fraseConfirmarPago(fac, { montoUsd: 46, metodo: 'pago_movil' }, 46); return t.includes('CARBO PRUEBA') && t.includes('COM-0007') && t.includes('del 01/10/2026 al 31/10/2026') && /PAGADA COMPLETA/.test(t); })());
ok('la frase dice lo que queda', /faltan \$26,00/.test(F.fraseConfirmarPago(fac, { montoUsd: 20, metodo: 'efectivo_usd' }, 46)));

const lista = [fac, { ...fac, id: 'f2', numero: 8, desde: '2026-09-01', hasta: '2026-09-30' }, { ...fac, id: 'f3', numero: 9, anulada_at: 'x' }];
const pagos = [pago('p1', 46)];
ok('por cobrar: no trae las pagadas ni anuladas', F.filtrarFacturas(lista, pagos, 'por_cobrar').map((x) => x.f.id).join() === 'f2');
ok('pagadas', F.filtrarFacturas(lista, pagos, 'pagadas').map((x) => x.f.id).join() === 'f1');
ok('anuladas aparte (no se pierden)', F.filtrarFacturas(lista, pagos, 'anuladas').map((x) => x.f.id).join() === 'f3');
ok('buscar por número', F.filtrarFacturas(lista, pagos, 'todas', 'com-0008').map((x) => x.f.id).join() === 'f2');
const res = F.resumenFacturas(lista, pagos);
ok('resumen sin anuladas', res.facturado === 92 && res.cobrado === 46 && res.porCobrar === 46 && res.pendientes === 1 && res.pagadas === 1);

// ── PDF ──
const html = H.cuerpoFacturaComida(fac, [pago('p1', 20), pago('p22', 5, { anulado_at: '2026-11-03', anulado_motivo: 'se duplicó', anulado_por_nombre: 'Oficina' })]);
ok('PDF: sello de lo que falta', html.includes('PAGADA EN PARTE') && html.includes('$26,00'));
ok('PDF: el pago anulado sale tachado con motivo', html.includes('class="anulado"') && html.includes('se duplicó'));
ok('PDF: dice a quién y qué días', html.includes('CARBO PRUEBA') && html.includes('del 01/10/2026 al 31/10/2026'));
ok('PDF: escapa el texto', !H.cuerpoFacturaComida({ ...fac, cuenta_nombre: '<script>' }, []).includes('<script>'));

// ── Pantallas ──
const leer = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const comida = leer('src/screens/ComidaScreen.tsx');
ok('ComidaScreen: QR y editor usan las visibles', comida.includes('companiesCocina.map((c) =>') && comida.includes('empresas={companiesCocina}'));
ok('ComidaScreen: la tarjeta de ocultar recibe TODAS', /<EmpresasOcultasCocina\s+empresas=\{companies\}/.test(comida));
const cocina = leer('src/screens/CocinaScreen.tsx');
ok('CocinaScreen: alta de contacto sin ocultas', cocina.includes('empresas={empresasParaElegir}'));
ok('CocinaScreen: botón de facturas para la cocina', cocina.includes('🧾 Facturas de comida · ¿quién pagó?') && cocina.includes("role === 'cocina'"));
ok('FoodCompanyScreen: QR de oculta registra con aviso', leer('src/screens/FoodCompanyScreen.tsx').includes('Esta empresa está oculta en cocina'));
const db = leer('src/lib/comidaFacturasDb.ts') + leer('src/lib/comidaEmpresasOcultasDb.ts');
ok('nada borra (sin .delete)', !/\.delete\(/.test(db));
ok('las escrituras comprueban la fila', (db.match(/\.select\(/g) || []).length >= 6);
ok('el panel de cocina no anula', /modo === 'control' && !p\.anulado_at/.test(leer('src/components/FacturasComidaPanel.tsx')));
ok('fotos: cámara Y galería', /📷 Cámara/.test(leer('src/components/PagoComidaModal.tsx')) && /🖼️ Galería/.test(leer('src/components/PagoComidaModal.tsx')));

if (fail) {
  console.error(failures.map((f) => `✗ ${f}`).join('\n'));
  console.error(`\n✗ comida facturas: ${fail} fallo(s), ${pass} ok`);
  process.exit(1);
}
console.log(`✓ comida facturas, pagos y ocultas: ${pass} pruebas ok`);
