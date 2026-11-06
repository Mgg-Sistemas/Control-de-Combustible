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
  construirMensajeWhatsapp,
  copiarMensajeCombustible,
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
  ok('El mensaje incluye la foto subida del despacho', msg.includes('📷 *Foto del despacho:* https://ddcwqmuqdqnsrtpticpx.supabase.co/storage/v1/object/public/photos/bomba1.jpg'), msg);
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
  ok('Con múltiples fotos incluye todas las fotos numeradas', msg.includes('📷 *Foto 1:* https://ejemplo.com/foto1.jpg') && msg.includes('📷 *Foto 2:* https://ejemplo.com/foto2.jpg'), msg);

  const msgSinFoto = construirMensajeWhatsapp({ ...datos, incluirFotosEnTexto: false });
  ok('Permite desactivar la foto en el texto si el usuario lo prefiere', !msgSinFoto.includes('📷 *Foto'));
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

// 5. Verificación de componentes UI
{
  const modalSrc = leer('src/components/combustible/DetalleDespachoModal.tsx');
  const surtidorSrc = leer('src/components/combustible/SurtidorMovil.tsx');
  const consumosSrc = leer('src/screens/redesign/DispatchesPilot.tsx');
  const apoyoSrc = leer('src/components/combustible/MaquinasApoyoPanel.tsx');

  ok('DetalleDespachoModal muestra Maquinaria, Placa y Serial', modalSrc.includes('PLACA:') && modalSrc.includes('SERIAL:') && modalSrc.includes('MAQUINARIA / EQUIPO:'));
  ok('DetalleDespachoModal tiene botón COPIAR MENSAJE y cuadro seleccionable', modalSrc.includes('COPIAR MENSAJE') && modalSrc.includes('selectTextOnFocus'));
  ok('DetalleDespachoModal permite MANDAR IMAGEN + MENSAJE, COPIAR IMAGEN y DESCARGAR FOTO', modalSrc.includes('MANDAR IMAGEN + MENSAJE') && modalSrc.includes('COPIAR IMAGEN') && modalSrc.includes('DESCARGAR FOTO'));
  ok('DetalleDespachoModal mantiene botón REENVIAR POR WHATSAPP', modalSrc.includes('REENVIAR POR WHATSAPP'));
  ok('SurtidorMovil, DispatchesPilot y MaquinasApoyoPanel integran DetalleDespachoModal', surtidorSrc.includes('<DetalleDespachoModal') && consumosSrc.includes('<DetalleDespachoModal') && apoyoSrc.includes('<DetalleDespachoModal'));
}

if (fail > 0) {
  console.error(`\n❌ ${fail} FALLO(S):`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
} else {
  console.log(`✅ ${pass} OK · 0 FALLOS`);
}
