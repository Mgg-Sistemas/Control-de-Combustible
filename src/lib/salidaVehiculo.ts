/**
 * VEHÍCULO DESTINO EN LA NOTA DE SALIDA (07-sep-2026).
 *
 * Pedido del cliente: «si yo le quiero dar salida a un starlink… tengo entendido
 * que se le asigna a una persona o maquinaria, pero yo se la quiero asignar a un
 * vehículo». La pestaña Salida de Inventario solo ofrecía las MÁQUINAS (tabla
 * `machinery`); los VEHÍCULOS viven en otra tabla (`vehicles`, la pestaña
 * Vehículos del Catálogo de equipos) y no aparecían por ningún lado.
 *
 * Acá va lo que no depende de la pantalla, para poder probarlo solo:
 *   - cómo se nombra un vehículo en la nota (mismo formato que la máquina:
 *     `NOMBRE · EMPRESA · Placa XXX`);
 *   - sobre qué texto busca el filtro del selector;
 *   - qué se le pega al motivo (reason) del movimiento;
 *   - y la lista de columnas de `inventory_movements` que llegaron por migración,
 *     para que el insert reintente sin la que todavía no exista en la base.
 */

export type VehiculoParaNota = {
  id: string;
  plate?: string | null;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  vehicle_type?: string | null;
  encargado?: string | null;
  serial?: string | null;
  company_id?: string | null;
};

const txt = (s: unknown): string => String(s ?? '').trim();

/** Nombre corto: su NOMBRE; si no tiene, marca + modelo; si no, el tipo; si no, "Vehículo". */
export function nombreVehiculo(v: VehiculoParaNota): string {
  return txt(v.name) || [txt(v.brand), txt(v.model)].filter(Boolean).join(' ') || txt(v.vehicle_type) || 'Vehículo';
}

/** Etiqueta con la que se ve y se imprime: `NOMBRE · EMPRESA · Placa XXX` (Serial si no hay placa). */
export function etiquetaVehiculo(v: VehiculoParaNota, empresa?: string | null): string {
  const placa = txt(v.plate);
  const serial = txt(v.serial);
  const identificador = placa ? `Placa ${placa}` : serial ? `Serial ${serial}` : '';
  return [nombreVehiculo(v), txt(empresa), identificador].filter(Boolean).join(' · ');
}

/** Texto sobre el que busca el filtro del selector (la pantalla lo pasa por `norm`). */
export function textoBusquedaVehiculo(v: VehiculoParaNota, empresa?: string | null): string {
  return [v.name, v.plate, v.brand, v.model, v.vehicle_type, v.encargado, v.serial, empresa].map(txt).filter(Boolean).join(' ');
}

/** Lo que se le pega al motivo (reason) del movimiento; vacío si no hay vehículo. */
export function detalleVehiculoNota(etiqueta: string | null | undefined): string {
  const e = txt(etiqueta);
  return e ? ` · VEHÍCULO: ${e}` : '';
}

/**
 * Columnas de `inventory_movements` que llegaron por migración y pueden no existir
 * todavía en la base. Si el insert falla por una de ellas, la pantalla reintenta sin
 * esa columna, de la más nueva a la más vieja. (PostgREST avisa con
 * «Could not find the 'vehicle_id' column of 'inventory_movements' in the schema cache».)
 */
export const PASOS_SIN_MIGRACION: { archivo: string; detecta: RegExp; columnas: string[] }[] = [
  { archivo: 'supabase/inventory_movements_vehiculo.sql', detecta: /vehicle_id|column/i, columnas: ['vehicle_id'] },
  { archivo: 'supabase/mantenimiento_reporte.sql', detecta: /machinery_id|column/i, columnas: ['machinery_id'] },
  { archivo: 'supabase/inventory_movements_employee.sql', detecta: /employee_ids|employees_detail|column/i, columnas: ['employee_ids', 'employees_detail'] },
];

/** Copia de las filas sin esas columnas (no toca las originales). */
export function quitarColumnas(filas: Record<string, unknown>[], columnas: string[]): Record<string, unknown>[] {
  const fuera = new Set(columnas);
  return filas.map((f) => {
    const copia: Record<string, unknown> = {};
    for (const k of Object.keys(f)) if (!fuera.has(k)) copia[k] = f[k];
    return copia;
  });
}

// ── NOTA DE TRASLADO ────────────────────────────────────────────────────────
// La nota de traslado mueve material de un lado a otro. Hasta hoy cada lado solo
// podia ser una MAQUINA o una PERSONA; ahora tambien un VEHICULO, igual que en la
// nota de salida. Mismo motivo: el Starlink (o cualquier material) va montado en
// una camioneta, que vive en la tabla `vehicles`, no en `machinery`.

/**
 * Un lado del traslado (origen o destino) en UNA linea.
 *
 * La maquina le sigue ganando a la persona, que es como se comportaba antes; el
 * vehiculo se SUMA en vez de competir, porque material que va a una maquina
 * montada sobre un vehiculo son las dos cosas a la vez y ocultar una miente.
 * Devuelve '' si no hay nada elegido, para que la pantalla ponga su propio texto
 * de respaldo (la empresa/persona no registrada, o el guion).
 */
export function ladoTrasladoEnPalabras(
  maquina: string | null | undefined,
  vehiculo: string | null | undefined,
  persona: string | null | undefined,
): string {
  const base = txt(maquina) || txt(persona);
  const veh = txt(vehiculo);
  if (!veh) return base;
  return base ? base + ' \u00b7 ' + veh : veh;
}

/**
 * Columnas de vehiculo en `inventory_transfers`. Las agrega el SQL
 * `inventory_transfers_vehiculo.sql`, que NO vive en el repositorio (el repo es
 * publico): esta en la carpeta de SQL pendientes que se le entrega al cliente.
 * Sin correrlo el traslado se guarda igual y el vehiculo queda en el PDF y en el
 * texto del movimiento; lo unico que se pierde es el vinculo consultable.
 */
export const PASOS_SIN_MIGRACION_TRASLADO: { archivo: string; detecta: RegExp; columnas: string[] }[] = [
  {
    archivo: 'inventory_transfers_vehiculo.sql (fuera del repo)',
    // Solo /vehicle/: `inventory_transfers` tiene OTRA columna que puede faltar
    // (to_company_name). Con un /column/ suelto se le quitaría el vehículo a un
    // error que no es del vehículo, y volvería a fallar igual.
    detecta: /vehicle/i,
    columnas: ['from_vehicle_id', 'from_vehicle_label', 'to_vehicle_id', 'to_vehicle_label'],
  },
];

/** Copia del objeto sin esas columnas (no toca el original). */
export function quitarColumnasFila(fila: Record<string, unknown>, columnas: string[]): Record<string, unknown> {
  return quitarColumnas([fila], columnas)[0] ?? {};
}
