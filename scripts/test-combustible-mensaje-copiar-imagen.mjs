/**
 * Pruebas unitarias para el Mensaje de Combustible (Copiar, Pegar, Placa/Serial/Nombre
 * de Maquinaria y Envío de Imagen Subida + Mensaje):
 * - `armarDatosMensajeDesdeDespacho`
 * - `construirMensajeWhatsapp`
 * - `copiarMensajeCombustible`
 * - `compartirImagenYMensajeCombustible`
 * - Integración en `DetalleDespachoModal.tsx`, `SurtidorMovil.tsx`, `DispatchesPilot.tsx`, `MaquinasApoyoPanel.tsx`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let ultimoTextoCopiado = '';
let ultimaUrlAbierta = '';

const customRequire = (id) => {
  if (id === 'react-native') {
    return {
      Linking: {
        canOpenURL: async () => true,
        openURL: async (u) => {
          ultimaUrlAbierta = u;
        },
      },
      Platform: { OS: 'web' },
    };
  }
  return require(id);
};

Object.defineProperty(globalThis, 'navigator', {
  value: {
    clipboard: {
      writeText: async (txt) => {
        ultimoTextoCopiado = txt;
      },
    },
  },
  configurable: true,
  writable: true,
});
globalThis.window = {
  open: (u) => {
    ultimaUrlAbierta = u;
  },
};

const mod = { exports: {} };
new Function(
  'exports',
  'module',
  'require',
  ts.transpileModule(leer('src/lib/fuelRules.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText
)(mod.exports, mod, customRequire);

const {
  armarDatosMensajeDesdeDespacho,
  armarDatosMensajeDesdeIngreso,
  construirMensajeWhatsapp,
  copiarMensajeCombustible,
  compartirImagenYMensajeCombustible,
  compartirPorWhatsapp,
} = mod.exports;

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name + (extra ? ` → ${extra}` : ''));
  }
};

console.log('COMBUSTIBLE — Mensaje copiable con Nombre, Placa, Serial e Imagen subida\n');

// 1. Maquinaria del catálogo por machinery_id + machineryList (SurtidorMovil)
{
  const machineryList = [
    { id: 'm-10', code: 'EXCAVADORA CAT 320D', plate: 'A88BC1K', serial: 'CAT0320DJK991' },
  ];
  const tanksList = [{ id: 't-1', name: 'TANQUE SURTIDOR GOLDEN' }];
  const mov = {
    id: 'disp-1',
    dispatch_date: '2026-11-05',
    created_at: '2026-11-05T23:35:00.000Z',
    machinery_id: 'm-10',
    tank_id: 't-1',
    liters: 32.03,
    fuel_start: 0,
    fuel_end: 33,
    hourmeter_h: 1450,
    driver_operator: 'ROBINSSON ROA',
    photos: ['https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/photos/bomba1.jpg'],
  };

  const datos = armarDatosMensajeDesdeDespacho(mov, {
    machineryList,
    tanksList,
    registradoPor: 'ROBINSSON ROA',
  });

  ok('Extrae el nombre/código de la maquinaria', datos.equipoCodigo === 'EXCAVADORA CAT 320D', datos.equipoCodigo);
  ok('Extrae la placa de la maquinaria', datos.equipoPlaca === 'A88BC1K', datos.equipoPlaca);
  ok('Extrae el serial de la maquinaria', datos.equipoSerial === 'CAT0320DJK991', datos.equipoSerial);
  ok('Extrae el tanque origen', datos.tanqueNombre === 'TANQUE SURTIDOR GOLDEN', datos.tanqueNombre);
  ok('Extrae las fotos subidas en la aplicación', Array.isArray(datos.fotos) && datos.fotos.length === 1);

  const msg = construirMensajeWhatsapp(datos);
  ok(
    'El mensaje incluye el nombre de la maquinaria, la placa y el serial en Equipo / Maquinaria',
    msg.includes('🚜 *Equipo / Maquinaria:* EXCAVADORA CAT 320D (Placa: A88BC1K) (Serial: CAT0320DJK991)'),
    msg
  );
  ok('El mensaje incluye línea dedicada de Placa', msg.includes('🚗 *Placa:* A88BC1K'), msg);
  ok('El mensaje incluye línea dedicada de Serial', msg.includes('🔢 *Serial:* CAT0320DJK991'), msg);
  ok('El mensaje NO incluye el enlace URL de la foto en el texto', !msg.includes('Foto del despacho:') && !msg.includes('https://'), msg);
  ok('El mensaje incluye litros, contador y autorizado', msg.includes('32,03 L') && msg.includes('0 → 33') && msg.includes('ROBINSSON ROA'), msg);
}

// 2. Maquinaria sin placa pero con serial (ej. JUMBO CON MARTILLO)
{
  const movSinPlaca = {
    id: 'disp-2',
    dispatch_date: '2026-11-06',
    machinery_id: 'm-20',
    liters: 120,
    machine: { code: 'JUMBO CON MARTILLO', plate: null, serial: 'SN-JUMBO-02' },
    tank: { name: 'CISTERNA 01' },
    photos: ['https://ejemplo.com/foto1.jpg', 'https://ejemplo.com/foto2.jpg'],
  };
  const datos = armarDatosMensajeDesdeDespacho(movSinPlaca);
  const msg = construirMensajeWhatsapp(datos);

  ok('En maquinaria sin placa muestra S/P y conserva el Serial', msg.includes('🚗 *Placa:* S/P') && msg.includes('🔢 *Serial:* SN-JUMBO-02'), msg);
  ok('Conserva las fotos en datos.fotos para compartir/copiar/descargar sin ensuciar el texto con URLs', datos.fotos.length === 2 && !msg.includes('https://'), msg);
}

// 3. Máquina de apoyo fuera de catálogo (con apoyo_nombre, apoyo_placa, apoyo_serial y apoyo_fotos)
{
  const movApoyo = {
    id: 'disp-3',
    dispatch_date: '2026-11-06',
    apoyo_nombre: 'RETROEXCAVADORA CASE',
    apoyo_placa: 'AP-991',
    apoyo_serial: 'CASE-7788',
    apoyo_empresa: 'CONSTRUCTORA SUR',
    liters: 75.5,
    photos: ['https://ejemplo.com/surtido.jpg'],
    apoyo_fotos: ['https://ejemplo.com/maquina.jpg'],
  };
  const datos = armarDatosMensajeDesdeDespacho(movApoyo);
  const msg = construirMensajeWhatsapp(datos);

  ok('Máquina de apoyo incluye nombre y empresa', datos.equipoCodigo.includes('RETROEXCAVADORA CASE') && datos.equipoCodigo.includes('CONSTRUCTORA SUR'));
  ok('Máquina de apoyo incluye placa y serial en el mensaje', msg.includes('🚗 *Placa:* AP-991') && msg.includes('🔢 *Serial:* CASE-7788'));
  ok('Combina fotos del surtido y de la máquina de apoyo', datos.fotos.length === 2);
}

// 4. Copiar mensaje al portapapeles (copiar y pegar)
{
  const datos = armarDatosMensajeDesdeDespacho({
    dispatch_date: '2026-11-06',
    liters: 50,
    machine: { code: 'VIBROCOMPACTADOR', plate: 'V-102', serial: 'VIB-900' },
    tank: { name: 'TANQUE PRINCIPAL' },
  });
  const copiado = await copiarMensajeCombustible(datos);
  ok('copiarMensajeCombustible devuelve true y escribe en el portapapeles', copiado === true && ultimoTextoCopiado.includes('VIBROCOMPACTADOR') && ultimoTextoCopiado.includes('V-102') && ultimoTextoCopiado.includes('VIB-900'));
}

// 5. Mensaje de Entrada (fuel_intakes) con múltiples fotos y sin enlace a la BD
{
  const ingreso = {
    id: 'in-1',
    intake_date: '2026-11-06',
    created_at: '2026-11-06T12:15:00.000Z',
    supplier: 'PDVSA',
    invoice_no: 'F-009812',
    fuel_type: 'DIESEL',
    liters: 15000,
    received_by: 'CARLOS PEREZ',
    notes: 'Cisterna OK https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/secreto.jpg',
    tank: { name: 'TANQUE PRINCIPAL 30.000L' },
    photos: [
      'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/guia1.jpg',
      'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/precinto2.jpg',
      'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/cisterna3.jpg',
    ],
  };

  const datosEntrada = armarDatosMensajeDesdeIngreso(ingreso);
  const msgEntrada = construirMensajeWhatsapp(datosEntrada);

  ok('armarDatosMensajeDesdeIngreso detecta tipo=entrada y conserva las 3 fotos', datosEntrada.tipo === 'entrada' && datosEntrada.fotos.length === 3);
  ok('El mensaje de entrada incluye tanque, proveedor, factura y litros recibidos', msgEntrada.includes('RECEPCIÓN DE COMBUSTIBLE') && msgEntrada.includes('TANQUE PRINCIPAL 30.000L') && msgEntrada.includes('PDVSA') && msgEntrada.includes('F-009812') && msgEntrada.includes('15.000 L'), msgEntrada);
  ok('El mensaje de entrada NUNCA incluye el link de la imagen en la base de datos', !msgEntrada.includes('https://') && !msgEntrada.includes('supabase.co'), msgEntrada);
}

// 6. Envío de múltiples imágenes en Consumo y Entrada con navigator.share
{
  let ultimoSharePayload = null;
  globalThis.fetch = async (u) => ({
    ok: true,
    blob: async () => new Blob(['fake-img-' + u], { type: 'image/jpeg' }),
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        writeText: async (txt) => {
          ultimoTextoCopiado = txt;
        },
      },
      canShare: ({ files }) => Array.isArray(files) && files.length > 0,
      share: async (payload) => {
        ultimoSharePayload = payload;
      },
    },
    configurable: true,
    writable: true,
  });

  const datosConsumoMulti = armarDatosMensajeDesdeDespacho({
    dispatch_date: '2026-11-06',
    liters: 85,
    machine: { code: 'CAMION VOLTEO', plate: 'A11BC2D', serial: 'VOL-01' },
    tank: { name: 'TANQUE SURTIDOR' },
    photos: [
      'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/f1.jpg',
      'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/f2.jpg',
      'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/f3.jpg',
    ],
  });

  const resConsumo = await compartirImagenYMensajeCombustible(datosConsumoMulti);
  ok(
    'compartirImagenYMensajeCombustible en Consumo envía TODAS las imágenes (3 archivos) y el texto sin links',
    resConsumo?.modo === 'nativo_archivos' &&
      resConsumo?.cantidadImagenes === 3 &&
      ultimoSharePayload &&
      Array.isArray(ultimoSharePayload.files) &&
      ultimoSharePayload.files.length === 3 &&
      !ultimoSharePayload.text.includes('https://')
  );

  ultimoSharePayload = null;
  await compartirPorWhatsapp({
    tipo: 'entrada',
    tanqueNombre: 'TANQUE PRINCIPAL',
    proveedor: 'PDVSA',
    factura: 'G-5544',
    litros: 10000,
    fotos: [
      'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/e1.jpg',
      'https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/machinery/e2.jpg',
    ],
  });
  ok(
    'compartirPorWhatsapp en Entrada con varias fotos comparte automáticamente todas las imágenes y el mensaje sin links',
    ultimoSharePayload &&
      Array.isArray(ultimoSharePayload.files) &&
      ultimoSharePayload.files.length === 2 &&
      !ultimoSharePayload.text.includes('https://')
  );
}

// 7. Verificación de componentes UI
{
  const modalSrc = leer('src/components/combustible/DetalleDespachoModal.tsx');
  const surtidorSrc = leer('src/components/combustible/SurtidorMovil.tsx');
  const consumosSrc = leer('src/screens/redesign/DispatchesPilot.tsx');
  const ingresosSrc = leer('src/screens/redesign/IntakesPilot.tsx');
  const apoyoSrc = leer('src/components/combustible/MaquinasApoyoPanel.tsx');

  ok('DetalleDespachoModal muestra Maquinaria, Placa y Serial y soporta Entradas', modalSrc.includes('PLACA:') && modalSrc.includes('SERIAL:') && modalSrc.includes('DETALLE DE LA ENTRADA'));
  ok('DetalleDespachoModal tiene botón COPIAR MENSAJE y cuadro seleccionable', modalSrc.includes('COPIAR MENSAJE') && modalSrc.includes('selectTextOnFocus'));
  ok('DetalleDespachoModal permite MANDAR LAS N IMÁGENES + MENSAJE, COPIAR IMAGEN y DESCARGAR FOTO', modalSrc.includes('IMÁGENES + MENSAJE') && modalSrc.includes('COPIAR IMAGEN') && modalSrc.includes('DESCARGAR FOTO'));
  ok('DetalleDespachoModal mantiene botón REENVIAR POR WHATSAPP', modalSrc.includes('REENVIAR POR WHATSAPP'));
  ok('SurtidorMovil, DispatchesPilot, IntakesPilot y MaquinasApoyoPanel integran DetalleDespachoModal', surtidorSrc.includes('<DetalleDespachoModal') && consumosSrc.includes('<DetalleDespachoModal') && ingresosSrc.includes('<DetalleDespachoModal') && apoyoSrc.includes('<DetalleDespachoModal'));
}

if (fail > 0) {
  console.error(`\n❌ ${fail} FALLO(S):`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
} else {
  console.log(`✅ ${pass} OK · 0 FALLOS`);
}
