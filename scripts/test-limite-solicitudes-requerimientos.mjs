// Pruebas de unidad e integración para el Límite Máximo Ajustable de
// Solicitudes de Compra y Requerimientos (src/lib/limitesCompras.ts,
// src/lib/limitesComprasStorage.ts, src/components/CupoLimiteBanner.tsx y pantallas).
// Corre con: node scripts/test-limite-solicitudes-requerimientos.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadTsModule(relPath, mocks = {}) {
  const fullPath = new URL(`../${relPath}`, import.meta.url);
  const src = readFileSync(fullPath, 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const mod = { exports: {} };
  const req = (id) => {
    if (id in mocks) return mocks[id];
    throw new Error(`Import inesperado en prueba (${relPath}): ${id}`);
  };
  new Function('exports', 'require', 'module', outputText)(mod.exports, req, mod);
  return mod.exports;
}

const numerosMod = loadTsModule('src/lib/numeros.ts');
const caracasDayMod = loadTsModule('src/lib/caracasDay.ts');
const reqFlujoMod = loadTsModule('src/lib/requerimientoFlujo.ts', {
  './numeros': numerosMod,
});
const limitesMod = loadTsModule('src/lib/limitesCompras.ts', {
  './numeros': numerosMod,
  './caracasDay': caracasDayMod,
  './requerimientoFlujo': reqFlujoMod,
});

const {
  KEY_FEATURE_LIMITES_COMPRAS,
  CONFIG_LIMITES_COMPRAS_DEFAULT,
  OPCIONES_RAPIDAS_TOPE,
  OPCIONES_TARJETAS_VISIBLES,
  normalizarTopeEntero,
  normalizarTopeMontoUsd,
  normalizarConfigLimitesCompras,
  resolverLimitesParaUsuario,
  contarSolicitudesDeUsuario,
  contarRequerimientosDeUsuario,
  evaluarCupoSolicitudes,
  evaluarCupoRequerimientos,
  validarOperacionConLimite,
  aplicarLimiteTarjetasVisibles,
} = limitesMod;

let ok = 0;
function check(name, fn) {
  try {
    fn();
    ok++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('=== Pruebas: Límite Máximo Ajustable de Solicitudes y Requerimientos ===');

check('1. Clave en feature_toggles es compras_limites_usuarios y defaults son ilimitados (0)', () => {
  assert.equal(KEY_FEATURE_LIMITES_COMPRAS, 'compras_limites_usuarios');
  assert.equal(CONFIG_LIMITES_COMPRAS_DEFAULT.maxSolicitudesPorUsuario, 0);
  assert.equal(CONFIG_LIMITES_COMPRAS_DEFAULT.maxRequerimientosPorUsuario, 0);
  assert.equal(CONFIG_LIMITES_COMPRAS_DEFAULT.maxItemsPorSolicitud, 50);
  assert.equal(CONFIG_LIMITES_COMPRAS_DEFAULT.maxItemsPorRequerimiento, 50);
  assert.equal(CONFIG_LIMITES_COMPRAS_DEFAULT.maxMontoUsdRequerimiento, 0);
  assert.equal(CONFIG_LIMITES_COMPRAS_DEFAULT.maxTarjetasVisibles, 50);
  assert.equal(CONFIG_LIMITES_COMPRAS_DEFAULT.aplicarAAdmins, false);
  assert.ok(OPCIONES_RAPIDAS_TOPE.includes(0));
  assert.ok(OPCIONES_TARJETAS_VISIBLES.includes(0));
});

check('2. normalizarTopeEntero y normalizarTopeMontoUsd aceptan punto/coma y 0 = Sin límite', () => {
  assert.equal(normalizarTopeEntero(0), 0);
  assert.equal(normalizarTopeEntero('0'), 0);
  assert.equal(normalizarTopeEntero(''), 0);
  assert.equal(normalizarTopeEntero(null), 0);
  assert.equal(normalizarTopeEntero(-5), 0);
  assert.equal(normalizarTopeEntero('Sin límite'), 0);
  assert.equal(normalizarTopeEntero('15'), 15);
  assert.equal(normalizarTopeEntero('12,8'), 12);
  assert.equal(normalizarTopeEntero(999999, 5000), 5000);

  assert.equal(normalizarTopeMontoUsd(0), 0);
  assert.equal(normalizarTopeMontoUsd(''), 0);
  assert.equal(normalizarTopeMontoUsd('-100'), 0);
  assert.equal(normalizarTopeMontoUsd('1250,50'), 1250.5);
  assert.equal(normalizarTopeMontoUsd('1.250,75'), 1250.75);
});

check('3. normalizarConfigLimitesCompras sanea JSON corrupto o parcial sin lanzar excepción', () => {
  const vacio = normalizarConfigLimitesCompras(null);
  assert.deepEqual(vacio, CONFIG_LIMITES_COMPRAS_DEFAULT);

  const parcial = normalizarConfigLimitesCompras({
    maxSolicitudesPorUsuario: '5',
    modoConteoSolicitudes: 'jornada',
    maxRequerimientosPorUsuario: '3',
    modoConteoRequerimientos: 'activos',
    maxItemsPorSolicitud: '25',
    maxItemsPorRequerimiento: '40',
    maxMontoUsdRequerimiento: '1500,50',
    maxTarjetasVisibles: '100',
    aplicarAAdmins: true,
    excepcionesPorUsuario: {
      'user-1': {
        userId: 'user-1',
        userName: 'Diana',
        maxSolicitudes: '10',
        maxRequerimientos: '8',
        maxMontoUsd: '5000',
      },
    },
  });
  assert.equal(parcial.maxSolicitudesPorUsuario, 5);
  assert.equal(parcial.modoConteoSolicitudes, 'jornada');
  assert.equal(parcial.maxRequerimientosPorUsuario, 3);
  assert.equal(parcial.maxItemsPorSolicitud, 25);
  assert.equal(parcial.maxItemsPorRequerimiento, 40);
  assert.equal(parcial.maxMontoUsdRequerimiento, 1500.5);
  assert.equal(parcial.maxTarjetasVisibles, 100);
  assert.equal(parcial.aplicarAAdmins, true);
  assert.equal(parcial.excepcionesPorUsuario['user-1'].maxSolicitudes, 10);
  assert.equal(parcial.excepcionesPorUsuario['user-1'].maxRequerimientos, 8);
  assert.equal(parcial.excepcionesPorUsuario['user-1'].maxMontoUsd, 5000);
});

check('4. resolverLimitesParaUsuario respeta exención de admin y excepciones por usuario', () => {
  const cfg = normalizarConfigLimitesCompras({
    maxSolicitudesPorUsuario: 3,
    maxRequerimientosPorUsuario: 2,
    maxMontoUsdRequerimiento: 500,
    aplicarAAdmins: false,
    excepcionesPorUsuario: {
      'u-especial': {
        userId: 'u-especial',
        maxSolicitudes: 12,
        maxRequerimientos: 0, // Sin límite para este usuario
        maxMontoUsd: 2500,
      },
    },
  });

  // Usuario normal
  const normal = resolverLimitesParaUsuario(cfg, 'u-normal', false);
  assert.equal(normal.maxSolicitudes, 3);
  assert.equal(normal.maxRequerimientos, 2);
  assert.equal(normal.maxMontoUsdRequerimiento, 500);
  assert.equal(normal.exentoPorRol, false);
  assert.equal(normal.tieneExcepcionPersonal, false);

  // Usuario con excepción individual
  const especial = resolverLimitesParaUsuario(cfg, 'u-especial', false);
  assert.equal(especial.maxSolicitudes, 12);
  assert.equal(especial.maxRequerimientos, 0);
  assert.equal(especial.maxMontoUsdRequerimiento, 2500);
  assert.equal(especial.tieneExcepcionPersonal, true);

  // Admin cuando aplicarAAdmins = false -> exentoPorRol = true
  const adminExento = resolverLimitesParaUsuario(cfg, 'u-admin', true);
  assert.equal(adminExento.exentoPorRol, true);

  // Admin cuando aplicarAAdmins = true -> exentoPorRol = false
  const cfgConAdmin = normalizarConfigLimitesCompras({ ...cfg, aplicarAAdmins: true });
  const adminConLimite = resolverLimitesParaUsuario(cfgConAdmin, 'u-admin', true);
  assert.equal(adminConLimite.exentoPorRol, false);
  assert.equal(adminConLimite.maxSolicitudes, 3);
  assert.equal(adminConLimite.maxRequerimientos, 2);
});

check('5. Conteo de Solicitudes distingue modo activos vs jornada (7am–7am Caracas) y excluye almacén', () => {
  const refNow = new Date('2026-11-12T14:00:00.000Z');
  const filas = [
    // Solicitud activa de compra de hoy
    { id: '1', requested_by: 'u1', observaciones: '[ORIGEN:SOLICITUD]', status: 'pendiente', created_at: '2026-11-12T12:00:00.000Z' },
    // Solicitud en aclaratoria de ayer (activa, pero de jornada anterior)
    { id: '2', requested_by: 'u1', observaciones: '[ORIGEN:SOLICITUD]', status: 'aclaratoria_solicitada', created_at: '2026-11-11T15:00:00.000Z' },
    // Solicitud ya convertida en requerimiento (tiene [CONVERTIDO_EN_REQ], no cuenta como solicitud pendiente activa, pero sí se creó hoy)
    { id: '3', requested_by: 'u1', observaciones: '[ORIGEN:SOLICITUD] [CONVERTIDO_EN_REQ]', status: 'pendiente', created_at: '2026-11-12T13:00:00.000Z' },
    // Solicitud rechazada hoy (nunca cuenta)
    { id: '4', requested_by: 'u1', observaciones: '[ORIGEN:SOLICITUD]', status: 'rechazado', created_at: '2026-11-12T13:30:00.000Z' },
    // Requerimiento directo (sin [ORIGEN:SOLICITUD], nunca cuenta en cupo de solicitud)
    { id: '5', requested_by: 'u1', observaciones: '', status: 'pendiente', created_at: '2026-11-12T12:30:00.000Z' },
    // De otro usuario
    { id: '6', requested_by: 'u2', observaciones: '[ORIGEN:SOLICITUD]', status: 'pendiente', created_at: '2026-11-12T12:30:00.000Z' },
  ];

  // Modo activos: cuenta id '1' y '2' = 2
  const activos = contarSolicitudesDeUsuario(filas, 'u1', 'activos', refNow);
  assert.equal(activos, 2);

  // Modo jornada (hoy 2026-11-12 7am-7am Caracas): cuenta id '1' y '3' = 2
  const jornada = contarSolicitudesDeUsuario(filas, 'u1', 'jornada', refNow);
  assert.equal(jornada, 2);
});

check('6. Conteo de Requerimientos distingue activos vs jornada (7am–7am Caracas) y excluye aprobados/rechazados', () => {
  const refNow = new Date('2026-11-12T14:00:00.000Z');
  const reqs = [
    { id: 'r1', requested_by: 'u1', observaciones: '', status: 'pendiente', created_at: '2026-11-10T15:00:00.000Z' },
    { id: 'r2', requested_by: 'u1', observaciones: '', status: 'aclaratoria_solicitada', created_at: '2026-11-12T12:00:00.000Z' },
    { id: 'r3', requested_by: 'u1', observaciones: '', status: 'aprobado', created_at: '2026-11-12T13:00:00.000Z' },
    { id: 'r4', requested_by: 'u1', observaciones: '', status: 'rechazado', created_at: '2026-11-12T13:40:00.000Z' },
  ];

  // Modo activos: r1 y r2 = 2
  assert.equal(contarRequerimientosDeUsuario(reqs, 'u1', 'activos', refNow), 2);

  // Modo jornada de hoy: r2 y r3 = 2 (r1 es del 10/11, r4 está rechazado)
  assert.equal(contarRequerimientosDeUsuario(reqs, 'u1', 'jornada', refNow), 2);
});

check('7. validarOperacionConLimite bloquea SOLO creaciones nuevas cuando se alcanza el tope y NUNCA bloquea ediciones', () => {
  const cfg = normalizarConfigLimitesCompras({
    maxSolicitudesPorUsuario: 2,
    maxRequerimientosPorUsuario: 1,
    maxItemsPorSolicitud: 3,
    maxItemsPorRequerimiento: 4,
    maxMontoUsdRequerimiento: 500,
    aplicarAAdmins: false,
  });

  const filasSol = [
    { id: 's1', requested_by: 'u1', observaciones: '[ORIGEN:SOLICITUD]', status: 'pendiente', created_at: '2026-11-12T12:00:00.000Z' },
    { id: 's2', requested_by: 'u1', observaciones: '[ORIGEN:SOLICITUD]', status: 'pendiente', created_at: '2026-11-12T12:10:00.000Z' },
  ];
  const cupoSol = evaluarCupoSolicitudes({ reqs: filasSol, cfg, userId: 'u1', isAdmin: false });
  assert.equal(cupoSol.usados, 2);
  assert.equal(cupoSol.limite, 2);
  assert.equal(cupoSol.enTope, true);
  assert.equal(cupoSol.permitidoCrear, false);

  // Crear nueva solicitud -> bloqueado por cupo
  const intentoCrear = validarOperacionConLimite({
    tipo: 'solicitud',
    esEdicion: false,
    cantidadItems: 1,
    reqs: filasSol,
    cfg,
    userId: 'u1',
    isAdmin: false,
  });
  assert.equal(intentoCrear.ok, false);
  assert.ok(intentoCrear.error.includes('límite máximo'));

  // Editar solicitud existente o responder aclaratoria -> PERMITIDO aunque el cupo esté lleno (2/2)
  const intentoEditar = validarOperacionConLimite({
    tipo: 'solicitud',
    esEdicion: true,
    cantidadItems: 2,
    reqs: filasSol,
    cfg,
    userId: 'u1',
    isAdmin: false,
  });
  assert.equal(intentoEditar.ok, true);

  // Exceder renglones por solicitud -> bloqueado
  const intentoMuchosItems = validarOperacionConLimite({
    tipo: 'solicitud',
    esEdicion: true,
    cantidadItems: 5,
    reqs: filasSol,
    cfg,
    userId: 'u1',
    isAdmin: false,
  });
  assert.equal(intentoMuchosItems.ok, false);
  assert.ok(intentoMuchosItems.error.includes('productos/renglones'));

  // Requerimiento que supera el monto máximo en USD -> bloqueado
  const intentoMontoExcedido = validarOperacionConLimite({
    tipo: 'requerimiento',
    esEdicion: false,
    cantidadItems: 2,
    montoTotalUsd: 750,
    reqs: [],
    cfg,
    userId: 'u1',
    isAdmin: false,
  });
  assert.equal(intentoMontoExcedido.ok, false);
  assert.ok(intentoMontoExcedido.error.includes('supera el límite máximo permitido'));
});

check('8. aplicarLimiteTarjetasVisibles recorta DESPUÉS de filtrar y soporta 0 = Todas', () => {
  const items = Array.from({ length: 85 }, (_, i) => ({ id: i + 1 }));
  const r30 = aplicarLimiteTarjetasVisibles(items, 30);
  assert.equal(r30.visibles.length, 30);
  assert.equal(r30.totalFiltrados, 85);
  assert.equal(r30.ocultosPorLimite, 55);
  assert.equal(r30.hayMas, true);

  // Con ampliación (60)
  const r60 = aplicarLimiteTarjetasVisibles(items, 60);
  assert.equal(r60.visibles.length, 60);
  assert.equal(r60.ocultosPorLimite, 25);

  // Con tope 0 (Sin límite = Todas)
  const rTodas = aplicarLimiteTarjetasVisibles(items, 0);
  assert.equal(rTodas.visibles.length, 85);
  assert.equal(rTodas.ocultosPorLimite, 0);
  assert.equal(rTodas.hayMas, false);
});

check('9. Integración en SolicitudMaterialScreen.tsx, SolicitudesCompraTab.tsx y RequerimientoTab.tsx', () => {
  const solMatSrc = readFileSync(new URL('../src/screens/SolicitudMaterialScreen.tsx', import.meta.url), 'utf8');
  const solTabSrc = readFileSync(new URL('../src/screens/SolicitudesCompraTab.tsx', import.meta.url), 'utf8');
  const reqTabSrc = readFileSync(new URL('../src/screens/RequerimientoTab.tsx', import.meta.url), 'utf8');
  const bannerSrc = readFileSync(new URL('../src/components/CupoLimiteBanner.tsx', import.meta.url), 'utf8');

  assert.ok(solMatSrc.includes('CupoLimiteBanner'), 'SolicitudMaterialScreen debe renderizar CupoLimiteBanner');
  assert.ok(solMatSrc.includes('validarOperacionConLimite'), 'SolicitudMaterialScreen debe validar el límite al crear');
  assert.ok(solMatSrc.includes('aplicarLimiteTarjetasVisibles'), 'SolicitudMaterialScreen debe usar el límite ajustable de tarjetas');

  assert.ok(solTabSrc.includes('CupoLimiteBanner'), 'SolicitudesCompraTab debe renderizar CupoLimiteBanner');
  assert.ok(solTabSrc.includes('evaluarCupoSolicitudes'), 'SolicitudesCompraTab debe evaluar el cupo de solicitudes');
  assert.ok(solTabSrc.includes('aplicarLimiteTarjetasVisibles'), 'SolicitudesCompraTab debe usar el límite ajustable de tarjetas');

  assert.ok(reqTabSrc.includes('CupoLimiteBanner'), 'RequerimientoTab debe renderizar CupoLimiteBanner');
  assert.ok(reqTabSrc.includes('validarOperacionConLimite'), 'RequerimientoTab debe validar el límite al crear requerimiento');
  assert.ok(reqTabSrc.includes('aplicarLimiteTarjetasVisibles'), 'RequerimientoTab debe usar el límite ajustable de tarjetas');

  assert.ok(bannerSrc.includes('useWindowDimensions'), 'CupoLimiteBanner debe ser responsivo para teléfono y PC');
  assert.ok(bannerSrc.includes('Límite máximo') && bannerSrc.includes('Ajustar'), 'CupoLimiteBanner debe permitir abrir el modal de ajuste de límites');
});

console.log(`\n✅ Todas las ${ok} pruebas de límites ajustables de Solicitudes y Requerimientos pasaron.`);
