// scripts/test-formatos-ticket-no-choque.mjs
// Auditoría de persistencia, resolución y renderizado de tickets múltiples.
// Verifica que no haya choque entre formatos y que no se pierda información.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const cacheTs = new Map();
function cargar(rel) {
  const p = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (cacheTs.has(p)) return cacheTs.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cacheTs.set(p, m.exports);
  m.require = (spec) => {
    if (spec.startsWith('.')) {
      const base = path.resolve(path.dirname(p), spec);
      for (const cand of [base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) {
        if (fs.existsSync(cand)) return cargar(cand);
      }
    }
    return require(spec);
  };
  m._compile(js, p);
  cacheTs.set(p, m.exports);
  return m.exports;
}

const {
  CONFIG_POR_DEFECTO,
  FORMATO_DEFECTO_ID,
  FORMATO_DEFECTO_NOMBRE,
  crearFormatoDefecto,
  normalizarFormatos,
  resolverFormatoParaListero,
  resolverFormatoDeViaje,
} = cargar('src/lib/tiqueConfig.ts');

const {
  htmlDeUnTique,
  documentoDeTiques,
} = cargar('src/lib/tiqueDocumento.ts');

let pass = 0;
let fail = 0;
const failures = [];

const ok = (nombre, cond) => {
  if (cond) {
    pass++;
    return;
  }
  fail++;
  failures.push(`✗ ${nombre}`);
};

const eq = (nombre, a, b) => {
  const iguales = JSON.stringify(a) === JSON.stringify(b);
  if (iguales) {
    pass++;
    return;
  }
  fail++;
  failures.push(`✗ ${nombre}\n    obtenido: ${JSON.stringify(a)}\n    esperado: ${JSON.stringify(b)}`);
};

console.log('--- INICIANDO AUDITORÍA: FORMATOS DE TICKET SIN CHOQUE NI PÉRDIDA ---');

// 1. Verificación de Formato Defecto
const fmtDefecto = crearFormatoDefecto();
ok('Formato por defecto tiene ID correcto', fmtDefecto.id === FORMATO_DEFECTO_ID);
ok('Formato por defecto tiene Nombre correcto', fmtDefecto.nombre === FORMATO_DEFECTO_NOMBRE);
ok('Formato por defecto esDefecto === true', fmtDefecto.esDefecto === true);
ok('Formato por defecto tiene campos iniciales', fmtDefecto.config.campos.folio === true);

// Configuramos chofer=true explícitamente en el Formato 1 (Principal)
fmtDefecto.config.campos.chofer = true;

// 2. Creación de Formato Secundario con configuración diferente
const fmtSecundario = {
  id: 'fmt_personalizado_b',
  nombre: 'Formato Mina Norte',
  esDefecto: false,
  config: {
    ...CONFIG_POR_DEFECTO,
    campos: {
      ...CONFIG_POR_DEFECTO.campos,
      nota: true,
      chofer: false,        // En Mina Norte no se imprime chofer
      m3: true,
      pesoNeto: true,       // En Mina Norte se imprime peso neto
    },
    textos: {
      nota: 'Entrega controlada',
    },
    pesosUnidad: 't',
  },
  listeroIds: ['usr_listero_mina'],
};

// 3. Normalización sin choque ni pérdida
const formatosGuardadosSimulados = [fmtDefecto, fmtSecundario];
const asignacionesSimuladas = { usr_listero_mina: 'fmt_personalizado_b' };
const foliosSimulados = { 'TK-0001': 'Formato Principal', 'TK-0002': 'Formato Mina Norte' };

const brutoGuardado = {
  campos: {
    ...fmtDefecto.config.campos,
    formatos: formatosGuardadosSimulados,
    asignaciones: asignacionesSimuladas,
    foliosFormatos: foliosSimulados,
  },
  logos: fmtDefecto.config.logos,
  papel: fmtDefecto.config.papel,
};

const normalizado = normalizarFormatos(brutoGuardado, CONFIG_POR_DEFECTO);
eq('Deben existir exactamente 2 formatos normalizados', normalizado.formatos.length, 2);
eq('El primer formato debe ser el principal', normalizado.formatos[0].id, FORMATO_DEFECTO_ID);
eq('El segundo formato debe ser Formato Mina Norte', normalizado.formatos[1].id, 'fmt_personalizado_b');

// Comprobar que los campos de cada uno no se contaminaron
ok('Formato 1 conserva chofer=true', normalizado.formatos[0].config.campos.chofer === true);
ok('Formato 2 conserva chofer=false', normalizado.formatos[1].config.campos.chofer === false);
ok('Formato 2 conserva pesoNeto=true', normalizado.formatos[1].config.campos.pesoNeto === true);
eq('Formato 2 conserva texto nota personalizado', normalizado.formatos[1].config.textos.nota, 'Entrega controlada');

// 4. Auditoría de resolución por listero y por folio
// Listero A (no asignado) -> debe recibir Formato Principal
const viajeListeroGeneral = { folio: 'TK-100', listeroId: 'usr_listero_general' };
const resGeneral = resolverFormatoDeViaje(viajeListeroGeneral, normalizado.formatos, normalizado.asignaciones, normalizado.foliosFormatos);
eq('Listero no asignado resuelve al Formato Principal', resGeneral.id, FORMATO_DEFECTO_ID);
ok('Listero no asignado tiene chofer=true', resGeneral.config.campos.chofer === true);

// Listero B (asignado a Mina Norte) -> debe recibir Formato Mina Norte
const viajeListeroMina = { folio: 'TK-101', listeroId: 'usr_listero_mina' };
const resMina = resolverFormatoDeViaje(viajeListeroMina, normalizado.formatos, normalizado.asignaciones, normalizado.foliosFormatos);
eq('Listero asignado resuelve a Formato Mina Norte', resMina.id, 'fmt_personalizado_b');
ok('Listero asignado tiene chofer=false', resMina.config.campos.chofer === false);
eq('Listero asignado tiene nota personalizada', resMina.config.textos.nota, 'Entrega controlada');

// Folio ya emitido con Formato Mina Norte consultado por cualquier listero -> debe recibir Formato Mina Norte
const viajeFolioSellado = { folio: 'TK-0002', listeroId: 'otro_listero' };
const resSellado = resolverFormatoDeViaje(viajeFolioSellado, normalizado.formatos, normalizado.asignaciones, normalizado.foliosFormatos);
eq('Folio sellado previamente resuelve al Formato Mina Norte', resSellado.id, 'fmt_personalizado_b');

// 5. Auditoría de impresión por lote (documentoDeTiques)
const ticketsParaLote = [
  {
    datos: {
      folio: 'TK-100',
      chofer: 'Carlos Pérez',
      m3: '12.0',
    },
    config: resGeneral.config,
  },
  {
    datos: {
      folio: 'TK-101',
      chofer: 'Carlos Pérez',
      m3: '14.5',
      nota: 'Entrega controlada',
    },
    config: resMina.config,
  },
];

const htmlIndividual1 = htmlDeUnTique(ticketsParaLote[0], CONFIG_POR_DEFECTO, {});
const htmlIndividual2 = htmlDeUnTique(ticketsParaLote[1], CONFIG_POR_DEFECTO, {});

// En el ticket 1 debe figurar el chofer 'Carlos Pérez'
ok('Ticket 1 muestra chofer en su HTML', htmlIndividual1.includes('Carlos Pérez'));

// En el ticket 2 NO debe figurar el chofer (estaba apagado en Formato 2) pero SÍ la nota
ok('Ticket 2 NO muestra chofer porque su formato lo tiene desactivado', !htmlIndividual2.includes('Carlos Pérez'));
ok('Ticket 2 muestra la nota personalizada', htmlIndividual2.includes('Entrega controlada'));

// Imprimir el documento completo por lote
const htmlDocumentoLote = documentoDeTiques(ticketsParaLote, CONFIG_POR_DEFECTO, {});
ok('El documento de lote incluye el ticket 1', htmlDocumentoLote.includes('TK-100'));
ok('El documento de lote incluye el ticket 2', htmlDocumentoLote.includes('TK-101'));
ok('El documento de lote respeta la nota del ticket 2', htmlDocumentoLote.includes('Entrega controlada'));

// Reporte de resultados
console.log(`\nResultados: ${pass} pasados, ${fail} fallados.`);
if (failures.length > 0) {
  console.error('\nFallos encontrados:');
  failures.forEach((f) => console.error(f));
  process.exit(1);
} else {
  console.log('--- AUDITORÍA FINALIZADA CON ÉXITO: 0 CONFLICTOS, 0 SOBREESCRITURAS ---');
}
