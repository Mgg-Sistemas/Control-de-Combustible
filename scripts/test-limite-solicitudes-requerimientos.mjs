// Prueba sin red: límite máximo ajustable de ítems / cosas dentro de Solicitudes y Requerimientos.
// Corre con: node scripts/test-limite-solicitudes-requerimientos.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function cargarModuloTs(rutaRelativa, mocks = {}) {
  const src = readFileSync(new URL(rutaRelativa, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const exports = {};
  const module = { exports };
  const reqFn = (id) => {
    if (id in mocks) return mocks[id];
    throw new Error(`Import inesperado en prueba sin red: ${id}`);
  };
  runInContext(
    js,
    createContext({ module, exports, require: reqFn, Date, Math, Number, String, Array, Object, Set, Map, JSON }),
  );
  return module.exports;
}

const modFlujo = cargarModuloTs('../src/lib/requerimientoFlujo.ts');
const modCaracas = cargarModuloTs('../src/lib/caracasDay.ts');
const modLimites = cargarModuloTs('../src/lib/limitesCompras.ts', {
  './requerimientoFlujo': modFlujo,
  './caracasDay': modCaracas,
  './numeros': {
    leerNumero: (v) => {
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      const s = String(v ?? '').trim().replace(',', '.');
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    },
  },
});

const {
  normalizarConfigLimitesCompras,
  resolverLimitesParaUsuario,
  evaluarCupoSolicitudes,
  evaluarCupoRequerimientos,
  calcularTopeEfectivoItems,
  verificarPuedeAgregarItem,
  aplicarLimiteTarjetasVisibles,
  validarOperacionConLimite,
} = modLimites;

// 1. Valores por defecto seguros (50 ítems por solicitud y requerimiento, permitidoCrear siempre true)
{
  const cfg = normalizarConfigLimitesCompras(null);
  assert.equal(cfg.activo, true);
  assert.equal(cfg.maxItemsPorSolicitud, 50);
  assert.equal(cfg.maxItemsPorRequerimiento, 50);
  assert.equal(cfg.maxSolicitudesPorUsuario, 0);
  assert.equal(cfg.maxRequerimientosPorUsuario, 0);
  assert.equal(cfg.maxTarjetasVisibles, 50);
  assert.equal(cfg.aplicarAAdmins, false);

  const cupoSol = evaluarCupoSolicitudes({ reqs: [], cfg, userId: 'u-1', isAdmin: false, itemsActualesCount: 3 });
  assert.equal(cupoSol.permitidoCrear, true, 'El límite es de ítems dentro de la solicitud, no bloquea crear solicitudes nuevas');
  assert.equal(cupoSol.maxItems, 50);
  assert.equal(cupoSol.usados, 3);
  assert.equal(cupoSol.disponibles, 47);
}

// 2. Normalización defensiva ante basura o valores negativos
{
  const cfg = normalizarConfigLimitesCompras({
    activo: true,
    maxItemsPorSolicitud: '-9',
    maxItemsPorRequerimiento: '12,8',
    maxMontoUsdRequerimiento: '-100',
    maxTarjetasVisibles: 'abc',
    excepcionesPorUsuario: {
      'user-1': { maxItemsSolicitud: '25', maxItemsRequerimiento: '0', userName: 'Jefe de Taller' },
    },
  });
  assert.equal(cfg.activo, true);
  assert.equal(cfg.maxItemsPorSolicitud, 0, 'Negativo se normaliza a 0 (Sin límite)');
  assert.equal(cfg.maxItemsPorRequerimiento, 12, 'Trunca entero positivo');
  assert.equal(cfg.maxMontoUsdRequerimiento, 0);
  assert.equal(cfg.maxTarjetasVisibles, 0);
  assert.equal(cfg.excepcionesPorUsuario['user-1'].maxItemsSolicitud, 25);
  assert.equal(cfg.excepcionesPorUsuario['user-1'].maxItemsRequerimiento, 0);
  assert.equal(cfg.excepcionesPorUsuario['user-1'].userName, 'Jefe de Taller');
}

// 3. Tope de ítems en Solicitud: bloquea al intentar agregar el ítem N+1
{
  const cfg = normalizarConfigLimitesCompras({
    activo: true,
    maxItemsPorSolicitud: 3,
  });

  // Con 2 ítems puede agregar el 3°
  const chk2 = verificarPuedeAgregarItem({
    tipo: 'solicitud',
    itemsActualesCount: 2,
    cfg,
    userId: 'u-taller',
    isAdmin: false,
  });
  assert.equal(chk2.ok, true);
  assert.equal(chk2.disponibles, 1);

  // Con 3 ítems ya alcanzó el tope de 3: no deja agregar el 4°
  const chk3 = verificarPuedeAgregarItem({
    tipo: 'solicitud',
    itemsActualesCount: 3,
    cfg,
    userId: 'u-taller',
    isAdmin: false,
  });
  assert.equal(chk3.ok, false);
  assert.equal(chk3.disponibles, 0);
  assert.match(chk3.error, /máximo 3/i);

  // Validación final al guardar con 4 ítems falla, con 3 ítems pasa
  const val4 = validarOperacionConLimite({
    tipo: 'solicitud',
    esEdicion: false,
    cantidadItems: 4,
    cfg,
    userId: 'u-taller',
    isAdmin: false,
  });
  assert.equal(val4.ok, false);

  const val3 = validarOperacionConLimite({
    tipo: 'solicitud',
    esEdicion: false,
    cantidadItems: 3,
    cfg,
    userId: 'u-taller',
    isAdmin: false,
  });
  assert.equal(val3.ok, true);
}

// 4. Fusión de ítem de stock existente en el carrito NO consume cupo adicional de ítems
{
  const cfg = normalizarConfigLimitesCompras({
    activo: true,
    maxItemsPorSolicitud: 3,
  });

  const chkFusion = verificarPuedeAgregarItem({
    tipo: 'solicitud',
    itemsActualesCount: 3,
    esFusionDeStockExistente: true,
    cfg,
    userId: 'u-taller',
    isAdmin: false,
  });
  assert.equal(chkFusion.ok, true, 'Sumar cantidad a un ítem de stock ya presente en el carrito no agrega un renglón nuevo');
}

// 5. Tope de ítems en Requerimiento + reutilización de fila vacía
{
  const cfg = normalizarConfigLimitesCompras({
    activo: true,
    maxItemsPorRequerimiento: 4,
  });

  const chk3 = verificarPuedeAgregarItem({
    tipo: 'requerimiento',
    itemsActualesCount: 3,
    cfg,
    userId: 'u-compras',
    isAdmin: false,
  });
  assert.equal(chk3.ok, true);

  const chk4 = verificarPuedeAgregarItem({
    tipo: 'requerimiento',
    itemsActualesCount: 4,
    cfg,
    userId: 'u-compras',
    isAdmin: false,
  });
  assert.equal(chk4.ok, false);
  assert.match(chk4.error, /máximo 4/i);

  const chkReemplazo = verificarPuedeAgregarItem({
    tipo: 'requerimiento',
    itemsActualesCount: 4,
    esFusionDeStockExistente: true,
    cfg,
    userId: 'u-compras',
    isAdmin: false,
  });
  assert.equal(chkReemplazo.ok, true);
}

// 6. Grandfathering al editar: si un registro viejo tenía 10 ítems y el admin bajó el límite a 5, deja editar los 10 pero no subir a 11
{
  const cfg = normalizarConfigLimitesCompras({
    activo: true,
    maxItemsPorSolicitud: 5,
    maxItemsPorRequerimiento: 5,
  });

  const topeEfectivo = calcularTopeEfectivoItems(5, true, 10);
  assert.equal(topeEfectivo, 10, 'El tope efectivo al editar respeta los 10 ítems originales');

  const valEdit10 = validarOperacionConLimite({
    tipo: 'requerimiento',
    esEdicion: true,
    cantidadItems: 10,
    cantidadItemsOriginales: 10,
    cfg,
    userId: 'u-compras',
    isAdmin: false,
  });
  assert.equal(valEdit10.ok, true, 'Grandfathering: permite guardar los 10 ítems que ya tenía el requerimiento');

  const chkAdd11 = verificarPuedeAgregarItem({
    tipo: 'requerimiento',
    itemsActualesCount: 10,
    esEdicion: true,
    cantidadItemsOriginales: 10,
    cfg,
    userId: 'u-compras',
    isAdmin: false,
  });
  assert.equal(chkAdd11.ok, false);

  const valEdit11 = validarOperacionConLimite({
    tipo: 'requerimiento',
    esEdicion: true,
    cantidadItems: 11,
    cantidadItemsOriginales: 10,
    cfg,
    userId: 'u-compras',
    isAdmin: false,
  });
  assert.equal(valEdit11.ok, false);
}

// 7. Excepciones individuales por usuario y exención de Administrador
{
  const cfg = normalizarConfigLimitesCompras({
    activo: true,
    maxItemsPorSolicitud: 3,
    maxItemsPorRequerimiento: 4,
    aplicarAAdmins: false,
    excepcionesPorUsuario: {
      'u-especial': { maxItemsSolicitud: 20, maxItemsRequerimiento: 0 },
    },
  });

  const chkAdmin = verificarPuedeAgregarItem({
    tipo: 'solicitud',
    itemsActualesCount: 50,
    cfg,
    userId: 'u-admin',
    isAdmin: true,
  });
  assert.equal(chkAdmin.ok, true);

  const limEsp = resolverLimitesParaUsuario(cfg, 'u-especial', false);
  assert.equal(limEsp.tieneExcepcionPersonal, true);
  assert.equal(limEsp.maxItemsSolicitud, 20);
  assert.equal(limEsp.maxItemsRequerimiento, 0);

  const chkEspReq = verificarPuedeAgregarItem({
    tipo: 'requerimiento',
    itemsActualesCount: 80,
    cfg,
    userId: 'u-especial',
    isAdmin: false,
  });
  assert.equal(chkEspReq.ok, true);
}

// 8. Límite de tarjetas visibles en bandeja (slicing post-filtro)
{
  const lista = Array.from({ length: 60 }, (_, i) => ({ id: `r-${i + 1}` }));
  const r20 = aplicarLimiteTarjetasVisibles(lista, 20);
  assert.equal(r20.visibles.length, 20);
  assert.equal(r20.ocultosPorLimite, 40);
  assert.equal(r20.hayMas, true);

  const rTodas = aplicarLimiteTarjetasVisibles(lista, 0);
  assert.equal(rTodas.visibles.length, 60);
  assert.equal(rTodas.hayMas, false);
}

// 9. Integración en las 3 pantallas y componente ContadorLimiteItemsBar
{
  const solScreen = readFileSync(new URL('../src/screens/SolicitudMaterialScreen.tsx', import.meta.url), 'utf8');
  const solTab = readFileSync(new URL('../src/screens/SolicitudesCompraTab.tsx', import.meta.url), 'utf8');
  const reqTab = readFileSync(new URL('../src/screens/RequerimientoTab.tsx', import.meta.url), 'utf8');
  const bannerComp = readFileSync(new URL('../src/components/CupoLimiteBanner.tsx', import.meta.url), 'utf8');

  assert.match(bannerComp, /export function ContadorLimiteItemsBar/, 'CupoLimiteBanner debe exportar ContadorLimiteItemsBar');
  assert.match(solScreen, /<CupoLimiteBanner/, 'SolicitudMaterialScreen debe mostrar CupoLimiteBanner');
  assert.match(solScreen, /<ContadorLimiteItemsBar/, 'SolicitudMaterialScreen debe mostrar ContadorLimiteItemsBar dentro del formulario');
  assert.match(solScreen, /verificarPuedeAgregarItem/, 'SolicitudMaterialScreen debe validar al agregar ítems');

  assert.match(solTab, /<CupoLimiteBanner/, 'SolicitudesCompraTab debe mostrar CupoLimiteBanner');
  assert.match(solTab, /<ContadorLimiteItemsBar/, 'SolicitudesCompraTab debe mostrar ContadorLimiteItemsBar al editar renglones');
  assert.match(solTab, /verificarPuedeAgregarItem/, 'SolicitudesCompraTab debe validar al agregar renglón en edición');

  assert.match(reqTab, /<CupoLimiteBanner/, 'RequerimientoTab debe mostrar CupoLimiteBanner');
  assert.match(reqTab, /<ContadorLimiteItemsBar/, 'RequerimientoTab debe mostrar ContadorLimiteItemsBar en el modal de requerimiento');
  assert.match(reqTab, /verificarPuedeAgregarItem/, 'RequerimientoTab debe validar en addBlank y addFromProduct');
}

console.log('✅ test-limite-solicitudes-requerimientos: todas las pruebas de límite de ítems pasaron correctamente.');
