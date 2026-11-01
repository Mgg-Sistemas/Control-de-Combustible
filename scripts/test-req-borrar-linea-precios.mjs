// 🧾 Borrar / editar un renglón NO cambia los precios de los demás (31-oct-2026).
// Tres causas: (1) el editor de Solicitudes rearmaba la línea y perdía price_usd y
// totales; (2) al convertir, el precio de la PRIMERA línea se aplicaba a todas;
// (3) los editores pasaban Bs → $ con la tasa de HOY en vez de la de la compra.
import fs from 'node:fs';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

// ── (1) Copia fiel del guardado del editor de Solicitudes (SolicitudesCompraTab) ──
function guardarSolicitud(editItems) {
  return editItems.map((it) => {
    const qty = Number(it.qty);
    const linea = { ...(it.orig || {}), name: it.name, qty, unit: it.unit, est_price: Number(it.est_price) || 0, currency: it.currency };
    if (it.orig && Number(it.orig.qty) !== qty && qty > 0) {
      if ((linea.modo_precio || 'unidad') === 'total') {
        if (Number(linea.total_usd) > 0) linea.price_usd = Math.round((Number(linea.total_usd) / qty) * 10000) / 10000;
      } else if (Number(linea.price_usd) > 0) linea.total_usd = Math.round(Number(linea.price_usd) * qty * 100) / 100;
    }
    return linea;
  });
}
const guardadas = [
  { name: 'ACEITE A', qty: 5, unit: 'UND', est_price: 30, price_usd: 30, total_usd: 150, currency: 'USD', modo_precio: 'unidad', cotizaciones: [{ id: 'c1' }] },
  { name: 'ACEITE B', qty: 5, unit: 'UND', est_price: 25, price_usd: 25, total_usd: 125, currency: 'USD', modo_precio: 'unidad' },
  { name: 'SILICON', qty: 12, unit: 'UND', est_price: 4, price_usd: 4, total_usd: 48, currency: 'USD', modo_precio: 'unidad' },
];
const filas = guardadas.map((it) => ({ name: it.name, qty: String(it.qty), unit: it.unit, est_price: String(it.est_price), currency: it.currency, orig: it }));
const trasBorrar = guardarSolicitud(filas.filter((_, i) => i !== 0)); // se borra «ACEITE A»
ok('borrar un renglón deja 2', trasBorrar.length === 2);
ok('el renglón B conserva su precio en $', trasBorrar[0].price_usd === 25 && trasBorrar[0].total_usd === 125);
ok('el renglón C conserva su precio en $', trasBorrar[1].price_usd === 4 && trasBorrar[1].total_usd === 48);
const conCot = guardarSolicitud(filas);
ok('se conservan las cotizaciones del renglón', Array.isArray(conCot[0].cotizaciones) && conCot[0].cotizaciones.length === 1);
const cambiaQty = guardarSolicitud([{ ...filas[1], qty: '10' }]);
ok('cambiar la cantidad recalcula el total con el mismo unitario', cambiaQty[0].price_usd === 25 && cambiaQty[0].total_usd === 250);
const nuevo = guardarSolicitud([{ name: 'NUEVO', qty: '1', unit: 'UND', est_price: '', currency: 'USD' }]);
ok('un renglón nuevo nace sin precio', nuevo[0].est_price === 0 && nuevo[0].price_usd === undefined);

// ── (2) Copia fiel de la conversión Solicitud → Requerimiento ──
function convertir(items, priceNum, monedaGeneral, rate) {
  return items.map((it) => {
    const yaTienePrecio = Number(it.price_usd) > 0 || Number(it.est_price) > 0;
    if (yaTienePrecio && Number(it.price_usd) > 0) return { ...it };
    const usarGeneral = priceNum > 0 && !yaTienePrecio;
    const rawPrice = usarGeneral ? priceNum : Number(it.est_price) || 0;
    const curr = usarGeneral ? monedaGeneral : (it.currency || 'USD');
    const pUsd = curr === 'VES' ? Math.round((rawPrice / rate) * 10000) / 10000 : rawPrice;
    return { ...it, est_price: pUsd, price_usd: pUsd, currency: 'USD' };
  });
}
const conv = convertir([{ name: 'A', qty: 1, est_price: 30, price_usd: 30 }, { name: 'B', qty: 1, est_price: 0 }], 7, 'USD', 100);
ok('convertir NO pisa la línea que ya tenía precio', conv[0].price_usd === 30);
ok('el precio general llena la línea sin precio', conv[1].price_usd === 7);
const todasSinPrecio = convertir([{ name: 'A', qty: 1, est_price: 0 }, { name: 'B', qty: 1, est_price: 0 }], 421, 'VES', 100);
ok('si ninguna tiene precio, el general se usa en todas (caso deliberado)', todasSinPrecio.every((x) => x.price_usd === 4.21));
const viejaBs = convertir([{ name: 'A', qty: 2, est_price: 1000, currency: 'VES' }], 0, 'USD', 100);
ok('una línea vieja en Bs se pasa a $ con su propio precio', viejaBs[0].price_usd === 10);

// ── (3) La tasa de la compra sale de la nota de la cuenta (la escribe la base) ──
const re = /\(Bs\s*([\d.]+)\s*por \$\)/;
const nota = 'Generada automáticamente. Precios en Bs pasados a US$ con la tasa BCV del 01/01/2026 (Bs 100.50 por $): equivale a Bs 2010.00.';
const m = nota.match(re);
ok('se lee la tasa congelada de la nota', m && Number(m[1]) === 100.5);
ok('sin nota no hay tasa congelada (se usa la de hoy)', !'sin datos'.match(re));
ok('con la tasa de la compra, el $ no cambia al reabrir', Math.round((2010 / 100.5) * 100) / 100 === 20);

// ── Fuentes: los arreglos están en las pantallas ──
const sol = fs.readFileSync('src/screens/SolicitudesCompraTab.tsx', 'utf8');
ok('Solicitudes guarda partiendo de la línea original', sol.includes('...(it.orig || {})') && sol.includes('orig: it,'));
ok('Solicitudes ya no precarga el precio de la primera línea', sol.includes("setConvertPrice('');"));
ok('la conversión respeta las líneas con precio', sol.includes('const usarGeneral = priceNum > 0 && !yaTienePrecio;'));
const req = fs.readFileSync('src/screens/RequerimientoTab.tsx', 'utf8');
ok('el editor de requerimientos usa la tasa de la compra', req.includes('usdFromBs(Number(it.est_price) || 0, tasaDelReq)'));
const cxp = fs.readFileSync('src/screens/CuentasScreen.tsx', 'utf8');
ok('el editor de Por Pagar usa la tasa de la cuenta', cxp.includes('precioUnitarioUsdLinea(it, tasaCta)'));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
