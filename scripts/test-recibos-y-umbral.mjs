import assert from 'node:assert';

// ── LÓGICA DE CUENTAS POR PAGAR (Recibos y Abonos) ──
function extraerReciboPagoCuenta(c) {
  if (!c) return null;
  if (c.comprobante_url || c.recibo_pago_url) {
    return {
      url: c.comprobante_url || c.recibo_pago_url,
      tipo: c.comprobante_tipo === 'pdf' ? 'pdf' : 'image',
      nombre: c.comprobante_nombre || 'Recibo de pago',
      referencia: c.documento || null,
      fecha: c.settled_at?.slice(0, 10) || null,
    };
  }
  const nota = c.nota || '';
  const match = nota.match(/\[RECIBO_PAGO:\s*Url:\s*([^|]*)\|\s*Tipo:\s*([^|]*)\|\s*Nombre:\s*([^|]*)\|\s*Fecha:\s*([^|]*)\|\s*Ref:\s*([^|]*)\|\s*SubidoPor:\s*([^|]*)\|\s*SubidoAt:\s*([^\]]*)\]/i);
  if (match) {
    const url = match[1].trim();
    if (url) {
      return {
        url,
        tipo: match[2].trim() === 'pdf' ? 'pdf' : 'image',
        nombre: match[3].trim() || 'Recibo de pago',
        fecha: match[4].trim() || null,
        referencia: match[5].trim() || null,
        subidoPor: match[6].trim() || null,
        subidoAt: match[7].trim() || null,
      };
    }
  }
  return null;
}

function inyectarReciboPagoEnNota(notaActual, recibo) {
  let base = (notaActual || '').replace(/\[RECIBO_PAGO:[^\]]+\]/gi, '').trim();
  if (!recibo || !recibo.url) return base || null;
  const tag = `[RECIBO_PAGO: Url: ${recibo.url} | Tipo: ${recibo.tipo || 'image'} | Nombre: ${recibo.nombre || 'Recibo de pago'} | Fecha: ${recibo.fecha || ''} | Ref: ${recibo.referencia || ''} | SubidoPor: ${recibo.subidoPor || ''} | SubidoAt: ${recibo.subidoAt || new Date().toISOString()}]`;
  return base ? `${base}\n${tag}` : tag;
}

function extraerComprobanteAbono(a) {
  if (!a) return null;
  if (a.comprobante_url) {
    return {
      url: a.comprobante_url,
      tipo: a.comprobante_tipo === 'pdf' ? 'pdf' : 'image',
      nombre: a.comprobante_nombre || 'Comprobante de abono',
      fecha: a.fecha || null,
      referencia: a.referencia || null,
    };
  }
  const nota = a.nota || '';
  const match = nota.match(/\[COMPROBANTE_ABONO:\s*Url:\s*([^|]*)\|\s*Tipo:\s*([^|]*)\|\s*Nombre:\s*([^\]]*)\]/i);
  if (match) {
    const url = match[1].trim();
    if (url) {
      return {
        url,
        tipo: match[2].trim() === 'pdf' ? 'pdf' : 'image',
        nombre: match[3].trim() || 'Comprobante de abono',
        fecha: a.fecha || null,
        referencia: a.referencia || null,
      };
    }
  }
  return null;
}

function inyectarComprobanteEnAbonoNota(notaActual, comp) {
  let base = (notaActual || '').replace(/\[COMPROBANTE_ABONO:[^\]]+\]/gi, '').trim();
  if (!comp || !comp.url) return base || null;
  const tag = `[COMPROBANTE_ABONO: Url: ${comp.url} | Tipo: ${comp.tipo || 'image'} | Nombre: ${comp.nombre || 'Comprobante de abono'}]`;
  return base ? `${base}\n${tag}` : tag;
}

function limpiarNotaCuentasVisual(nota) {
  if (!nota) return '';
  return nota
    .replace(/\[RECIBO_PAGO:[^\]]+\]/gi, '')
    .replace(/\[COMPROBANTE_ABONO:[^\]]+\]/gi, '')
    .trim();
}

// ── LÓGICA DE REQUERIMIENTOS (Expediente Unificado 360) ──
function extraerReciboPago(r) {
  const obs = r?.observaciones || '';
  const match = obs.match(/\[RECIBO PAGO:\s*Url:\s*([^|]*)\|\s*Tipo:\s*([^|]*)\|\s*Nombre:\s*([^|]*)\|\s*Ref:\s*([^|]*)\|\s*Fecha:\s*([^|]*)\|\s*Metodo:\s*([^|]*)\|\s*SubidoPor:\s*([^|]*)\|\s*SubidoAt:\s*([^\]]*)\]/i);
  if (!match) return null;
  return {
    url: match[1].trim() || undefined,
    tipo: match[2].trim() || 'image',
    nombre: match[3].trim() || undefined,
    referencia: match[4].trim() || undefined,
    fecha: match[5].trim() || undefined,
    metodo: match[6].trim() || undefined,
    subidoPor: match[7].trim() || undefined,
    subidoAt: match[8].trim() || undefined,
  };
}

function inyectarReciboPagoEnObservaciones(obsActual, rec) {
  let base = (obsActual || '').replace(/\[RECIBO PAGO:[^\]]+\]/gi, '').trim();
  if (!rec || (!rec.url && !rec.referencia)) return base || null;
  const tag = `[RECIBO PAGO: Url: ${rec.url || ''} | Tipo: ${rec.tipo || 'image'} | Nombre: ${rec.nombre || 'Recibo de pago'} | Ref: ${rec.referencia || ''} | Fecha: ${rec.fecha || ''} | Metodo: ${rec.metodo || ''} | SubidoPor: ${rec.subidoPor || ''} | SubidoAt: ${rec.subidoAt || new Date().toISOString()}]`;
  return base ? `${base}\n${tag}` : tag;
}

function limpiarObservacionesUsuario(obs) {
  if (!obs) return '';
  return obs
    .replace(/\[RECIBO PAGO:[^\]]+\]/gi, '')
    .replace(/\[FACTURA FISCAL:[^\]]+\]/gi, '')
    .replace(/\[DESPACHO:[^\]]+\]/gi, '')
    .replace(/\[PROVEEDOR_SUGERIDO:[^\]]+\]/gi, '')
    .trim();
}

// ── LÓGICA DE EVALUACIÓN DINÁMICA DE UMBRAL ──
function calcularEstadoRequerimiento(r, rateBcv, proveedorGeneral, configOverride) {
  const config = configOverride || {
    montoLimiteUSD: 1000,
    empresaId: null,
    empresaNombre: 'Todas',
    aprobadoresIds: [],
    aprobadoresNombres: ['Gerencia General'],
    activo: true,
  };

  const totalUSD = (r.items || []).reduce((sum, item) => {
    const qty = Number(item.qty) || 0;
    const price = Number(item.est_price) || 0;
    const usd = item.currency === 'USD' ? price : (rateBcv > 0 ? price / rateBcv : 0);
    return sum + (usd * qty);
  }, 0);

  const limite = config.montoLimiteUSD > 0 ? config.montoLimiteUSD : 1000;
  const aplicaEmpresa = !config.empresaId || config.empresaId === r.company_id;
  const superaUmbral = config.activo && aplicaEmpresa && totalUSD >= limite;
  const requiereAprobacionGG = superaUmbral && !r.gerente_aprobado;

  return {
    totalUSD,
    requiereAprobacionGG,
    montoLimiteAplicado: limite,
    empresaReglaAplicada: config.empresaNombre || 'Todas las empresas',
    aprobadoresNombres: config.aprobadoresNombres?.length ? config.aprobadoresNombres.join(', ') : 'Gerencia General',
  };
}

// ──────────────────────────────────────────
// EJECUCIÓN DE PRUEBAS
// ──────────────────────────────────────────

console.log('--- TEST 1: Cuentas por Pagar - Recibo de Pago en Nota ---');
const notaOriginal = 'Pago acordado para el viernes a primera hora.';
const datosRecibo = {
  url: 'https://supabase.co/storage/recibo_pago_123.jpg',
  tipo: 'image',
  nombre: 'Comprobante Banplus',
  subidoPor: 'Finanzas Las Ilusiones',
};

const notaConRecibo = inyectarReciboPagoEnNota(notaOriginal, datosRecibo);
assert(notaConRecibo.includes('[RECIBO_PAGO:'));

const reciboExtraido = extraerReciboPagoCuenta({ nota: notaConRecibo });
assert.strictEqual(reciboExtraido.url, datosRecibo.url);
assert.strictEqual(reciboExtraido.nombre, datosRecibo.nombre);
assert.strictEqual(reciboExtraido.subidoPor, datosRecibo.subidoPor);

const notaLimpia = limpiarNotaCuentasVisual(notaConRecibo);
assert.strictEqual(notaLimpia, notaOriginal);
console.log('✓ Test 1 Exitoso: Inyección, extracción y limpieza de nota en Cuentas.');

console.log('--- TEST 2: Cuentas por Pagar - Comprobante de Abono ---');
const notaAbonoOriginal = 'Primer abono 50% anticipo';
const datosComprobante = {
  url: 'https://supabase.co/storage/abono_vouch.png',
  nombre: 'Captura Pago Móvil',
};
const notaAbonoConSoporte = inyectarComprobanteEnAbonoNota(notaAbonoOriginal, datosComprobante);
assert(notaAbonoConSoporte.includes('[COMPROBANTE_ABONO:'));

const compExtraido = extraerComprobanteAbono({ nota: notaAbonoConSoporte });
assert.strictEqual(compExtraido.url, datosComprobante.url);
assert.strictEqual(compExtraido.nombre, datosComprobante.nombre);

const notaAbonoLimpia = limpiarNotaCuentasVisual(notaAbonoConSoporte);
assert.strictEqual(notaAbonoLimpia, notaAbonoOriginal);
console.log('✓ Test 2 Exitoso: Comprobante en Abonos funciona perfecto.');

console.log('--- TEST 3: Requerimientos - Recibo de Pago en Observaciones (Expediente 360) ---');
const obsOriginal = 'Urgente para tractor John Deere en campo 4.';
const datosRecReq = {
  url: 'https://supabase.co/storage/req_recibo_99.pdf',
  tipo: 'pdf',
  nombre: 'Transferencia Banesco $1,250.pdf',
  referencia: 'TRX-8823901',
  fecha: '2026-10-26',
  metodo: 'Transferencia',
  subidoPor: 'Anthony',
};

const obsConRecibo = inyectarReciboPagoEnObservaciones(obsOriginal, datosRecReq);
assert(obsConRecibo.includes('[RECIBO PAGO:'));
assert(obsConRecibo.includes('TRX-8823901'));

const recReqExtraido = extraerReciboPago({ observaciones: obsConRecibo });
assert.strictEqual(recReqExtraido.referencia, 'TRX-8823901');
assert.strictEqual(recReqExtraido.metodo, 'Transferencia');
assert.strictEqual(recReqExtraido.url, datosRecReq.url);

const obsLimpia = limpiarObservacionesUsuario(obsConRecibo);
assert.strictEqual(obsLimpia, obsOriginal);
console.log('✓ Test 3 Exitoso: Expediente unificado en Requerimientos sin alterar observaciones.');

console.log('--- TEST 4: Umbral Dinámico de Aprobación (> $1,000 configurable) ---');
const reqEjemplo = {
  id: 'req-001',
  company_id: 'emp-golden',
  status: 'aprobado',
  gerente_aprobado: false,
  items: [
    { name: 'Repuesto hidráulico', qty: 2, est_price: 600, currency: 'USD' } // Total: 1200 USD
  ],
};

// Caso 1: Regla por defecto ($1,000 USD, Todas las empresas) -> Debe requerir GG
const evalDefault = calcularEstadoRequerimiento(reqEjemplo, 0, undefined, undefined);
assert.strictEqual(evalDefault.requiereAprobacionGG, true);
assert.strictEqual(evalDefault.montoLimiteAplicado, 1000);
console.log('✓ Caso Default: $1,200 USD supera $1,000 USD -> Requiere GG.');

// Caso 2: Umbral cambiado a $1,500 USD -> No debe requerir GG ($1,200 < $1,500)
const regla1500 = {
  montoLimiteUSD: 1500,
  empresaId: null,
  empresaNombre: 'Todas',
  aprobadoresIds: [],
  aprobadoresNombres: ['Gerencia General'],
  activo: true,
};
const eval1500 = calcularEstadoRequerimiento(reqEjemplo, 0, undefined, regla1500);
assert.strictEqual(eval1500.requiereAprobacionGG, false);
console.log('✓ Caso $1,500 USD: Total $1,200 está por debajo del umbral, no exige GG.');

// Caso 3: Regla asignada solo a 'emp-ilusiones' -> No debe bloquear requerimiento de 'emp-golden'
const reglaIlusiones = {
  montoLimiteUSD: 800,
  empresaId: 'emp-ilusiones',
  empresaNombre: 'Inversiones Las Ilusiones',
  aprobadoresIds: [],
  aprobadoresNombres: ['Director de Operaciones'],
  activo: true,
};
const evalIlusiones = calcularEstadoRequerimiento(reqEjemplo, 0, undefined, reglaIlusiones);
assert.strictEqual(evalIlusiones.requiereAprobacionGG, false);
console.log('✓ Caso Empresa Específica: Regla de Las Ilusiones no bloquea Golden Touch.');

// Caso 4: Regla asignada a 'emp-golden' con umbral $500 y persona autorizada 'Anthony'
const reglaGolden = {
  montoLimiteUSD: 500,
  empresaId: 'emp-golden',
  empresaNombre: 'Golden Touch',
  aprobadoresIds: [],
  aprobadoresNombres: ['Anthony'],
  activo: true,
};
const evalGolden = calcularEstadoRequerimiento(reqEjemplo, 0, undefined, reglaGolden);
assert.strictEqual(evalGolden.requiereAprobacionGG, true);
assert.strictEqual(evalGolden.aprobadoresNombres, 'Anthony');
console.log('✓ Caso Persona Asignada: Aprobador asignado dinámico "Anthony" reflejado.');

console.log('\n=============================================');
console.log('🎉 TODOS LOS TESTS DE AUDITORÍA Y LÓGICA PASARON 100%');
console.log('=============================================\n');
