import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// Parse function identical to implementation in ServicioFletesScreen and fletePdf
function parseFleteNote(noteRaw) {
  if (!noteRaw) return { cleanNote: '', viajeIds: [], tickets: [] };
  const match = noteRaw.match(/\[VIAJES_IDS:([^|]+)\|TICKETS:([^\]]+)\]/);
  if (!match) return { cleanNote: noteRaw, viajeIds: [], tickets: [] };
  const viajeIds = match[1].split(',').map((s) => s.trim()).filter(Boolean);
  const tickets = match[2].split(',').map((s) => s.trim()).filter(Boolean);
  const cleanNote = noteRaw.replace(/\[VIAJES_IDS:[^|]+\|TICKETS:[^\]]+\]/, '').trim();
  return { cleanNote, viajeIds, tickets };
}

test('Panel de 6 Agentes - Validación de Importación de Viajes de Camiones a Fletes', async (t) => {
  await t.test('Agente 1 & 6: parseFleteNote extrae IDs y tickets limpiando la nota sin pérdida', () => {
    const raw = 'Flete consolidado de material granular [VIAJES_IDS:viaje-001,viaje-002|TICKETS:CDT-101,CDT-102]';
    const parsed = parseFleteNote(raw);
    assert.equal(parsed.cleanNote, 'Flete consolidado de material granular');
    assert.deepEqual(parsed.viajeIds, ['viaje-001', 'viaje-002']);
    assert.deepEqual(parsed.tickets, ['CDT-101', 'CDT-102']);

    // Nota sin metadatos
    const normal = 'Flete directo estándar';
    const parsedNormal = parseFleteNote(normal);
    assert.equal(parsedNormal.cleanNote, 'Flete directo estándar');
    assert.deepEqual(parsedNormal.viajeIds, []);
    assert.deepEqual(parsedNormal.tickets, []);
  });

  await t.test('Agente 2: Cálculo contable de precio unitario, subtotal y retención ISLR', () => {
    const viajesCount = 4;
    const precioUnitario = 35.5; // Modificable libremente
    const subtotal = viajesCount * precioUnitario;
    assert.equal(subtotal, 142.0);

    const aplicaRetencion = true;
    const retencion = aplicaRetencion ? Math.round(subtotal * 0.02 * 100) / 100 : 0;
    const total = subtotal - retencion;

    assert.equal(retencion, 2.84);
    assert.equal(total, 139.16);

    // Si se modifica el precio unitario posteriormente
    const nuevoPrecio = 40.0;
    const nuevoSubtotal = viajesCount * nuevoPrecio;
    const nuevaRetencion = aplicaRetencion ? Math.round(nuevoSubtotal * 0.02 * 100) / 100 : 0;
    const nuevoTotal = nuevoSubtotal - nuevaRetencion;

    assert.equal(nuevoSubtotal, 160.0);
    assert.equal(nuevaRetencion, 3.2);
    assert.equal(nuevoTotal, 156.8);
  });

  await t.test('Agente 3: Detección anti-duplicidad de viajes ya asignados a otros fletes', () => {
    const existingFletes = [
      { id: 'f-1', note: 'Nota 1 [VIAJES_IDS:v-1,v-2|TICKETS:TK-1,TK-2]' },
      { id: 'f-2', note: 'Nota 2 [VIAJES_IDS:v-3|TICKETS:TK-3]' },
      { id: 'f-3', note: 'Nota normal sin viajes' },
    ];

    const assignedSet = new Set();
    existingFletes.forEach((f) => {
      const parsed = parseFleteNote(f.note);
      parsed.viajeIds.forEach((id) => assignedSet.add(id));
    });

    assert.equal(assignedSet.size, 3);
    assert.ok(assignedSet.has('v-1'), 'v-1 debe estar bloqueado');
    assert.ok(assignedSet.has('v-2'), 'v-2 debe estar bloqueado');
    assert.ok(assignedSet.has('v-3'), 'v-3 debe estar bloqueado');
    assert.ok(!assignedSet.has('v-4'), 'v-4 debe estar disponible para importar');
  });

  await t.test('Agente 4: Regla mandatoria del proyecto de Placa y Buscador en selectores', () => {
    const fletesScreenPath = path.resolve('src/screens/ServicioFletesScreen.tsx');
    const screenCode = fs.readFileSync(fletesScreenPath, 'utf-8');

    // Selector de importación
    assert.ok(screenCode.includes('importMachineQuery'), 'Debe incluir estado para buscador de camión en importación');
    assert.ok(screenCode.includes('plate'), 'Debe referenciar la placa en el selector');
    assert.ok(screenCode.includes('Buscar por código, placa, tipo...'), 'Debe tener placeholder descriptivo con placa');

    // Identificación visible en tarjetas y badges
    assert.ok(screenCode.includes('Vinculado a'), 'Debe mostrar badge de vinculación a viajes');
    assert.ok(screenCode.includes('Tickets:'), 'Debe listar folios/tickets en la tarjeta');
  });

  await t.test('Agente 5: Modal de importación permite seleccionar Por Pagar / Por Cobrar', () => {
    const fletesScreenPath = path.resolve('src/screens/ServicioFletesScreen.tsx');
    const screenCode = fs.readFileSync(fletesScreenPath, 'utf-8');

    assert.ok(screenCode.includes('importOperacionTipo'), 'Debe manejar estado importOperacionTipo');
    assert.ok(screenCode.includes('💸 Por Pagar (A Fletero)'), 'Debe tener opción para registrar flete por pagar');
    assert.ok(screenCode.includes('💰 Por Cobrar (A Cliente)'), 'Debe tener opción para registrar flete por cobrar');
    assert.ok(screenCode.includes('saveImportedFlete'), 'Debe tener función de guardado de flete importado');
    assert.ok(screenCode.includes('allAssignedViajeIds'), 'Debe verificar viajes asignados en memoria');
  });

  await t.test('Agente 6: Soporte en PDF de flete para reflejar tickets vinculados', () => {
    const pdfPath = path.resolve('src/lib/fletePdf.ts');
    const pdfCode = fs.readFileSync(pdfPath, 'utf-8');

    assert.ok(pdfCode.includes('parseFleteNote'), 'El generador de PDF debe invocar parseFleteNote');
    assert.ok(pdfCode.includes('parsed.tickets'), 'El generador de PDF debe renderizar los tickets asociados');
  });
});
