// VIAJES DE CAMIONES — resumen GLOBALIZADO por camión, agrupado por empresa.
//
// Pedido del cliente (20-ago-2026): el reporte de viajes no siempre debe salir
// desglosado viaje por viaje. Hace falta poder pedir "camión X → N viajes", con
// varios camiones a la vez, y que al filtrar por empresa salgan TODOS sus
// camiones, el número global de viajes de la empresa y su desglose.
//
// Vive aparte (sin imports) para que sea una función PURA testeable: la pantalla
// `ViajesCamionesScreen` solo le pasa las filas ya filtradas y el catálogo de
// camiones. Ver `scripts/test-viajes-resumen.mjs`.

/** Clave de los camiones sin empresa asignada: van todos a una sola cubeta. */
export const SIN_EMPRESA = '__sin_empresa__';

/** Clave de los camiones que el listero anotó a mano por no estar en el catálogo. */
export const FUERA_CATALOGO = '__fuera_catalogo__';

/** Lo mínimo que el resumen necesita de un viaje. */
export type ViajeMin = { machineryId: string | null; machineCode: string; fueraCatalogo?: boolean };

/**
 * Clave con la que se cuenta un camión dentro de su empresa.
 *
 * ⚠️ Los camiones FUERA DE CATÁLOGO no tienen id, así que si se agruparan por
 * `machineryId` caerían TODOS en la misma cubeta (`null`) y "VOLTEO 88" y
 * "VOLTEO 99" saldrían sumados como si fueran un solo camión. Se agrupan por su
 * código escrito, normalizado, que es lo único que los distingue.
 */
export function claveCamion(v: ViajeMin): string {
  if (v.machineryId) return v.machineryId;
  return FUERA_CATALOGO + ':' + String(v.machineCode ?? '').trim().toUpperCase();
}

/** Lo mínimo que necesita del camión (sale de `machinery`). */
export type CamionMin = { companyId: string | null; companyName: string; plate: string | null; serial: string | null };

export type CamionResumen = { code: string; placa: string; viajes: number };
export type EmpresaResumen = { key: string; name: string; total: number; camiones: CamionResumen[] };
export type ResumenViajes = { empresas: EmpresaResumen[]; total: number; totalCamiones: number };

/** Compara textos como el resto de la app (sin distinguir mayúsculas ni acentos). */
const cmp = (a: string, b: string) =>
  a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });

/**
 * Agrupa viajes → empresa → camión, contando cuántos viajes hizo cada uno.
 *
 * · Las empresas salen de MAYOR a menor cantidad de viajes (desempate alfabético).
 * · Dentro de cada empresa, los camiones igual: de más viajes a menos.
 * · La placa es la del camión; si no tiene, su serial; si tampoco, '—'.
 * · Un viaje de un camión que ya no está en el catálogo NO se pierde: cae en
 *   "Sin empresa" con su código, para que el total general siempre cuadre con la
 *   cantidad de filas recibidas.
 */
export function resumirViajes(
  rows: ViajeMin[],
  camionPorId: (id: string) => CamionMin | undefined
): ResumenViajes {
  const emp = new Map<string, { key: string; name: string; total: number; camiones: Map<string, CamionResumen> }>();

  for (const r of rows) {
    // Un camión fuera de catálogo no se busca: no está y nunca va a estar.
    const t = r.machineryId ? camionPorId(r.machineryId) : undefined;
    const key = t?.companyId ?? SIN_EMPRESA;
    const name = t?.companyName || 'Sin empresa';

    const g = emp.get(key) ?? { key, name, total: 0, camiones: new Map<string, CamionResumen>() };
    g.total += 1;

    const ck = claveCamion(r);
    const cam = g.camiones.get(ck) ?? {
      code: r.machineCode,
      // Los de fuera de catálogo no tienen placa en el sistema (no hay ficha que
      // consultar): se marcan para que quien lee el reporte sepa que ese camión
      // lo anotó un listero a mano y no está en la flota.
      placa: r.machineryId ? (t?.plate || t?.serial || '—') : 'FUERA DE CATÁLOGO',
      viajes: 0,
    };
    cam.viajes += 1;
    g.camiones.set(ck, cam);
    emp.set(key, g);
  }

  const empresas: EmpresaResumen[] = Array.from(emp.values())
    .map((g) => ({
      key: g.key,
      name: g.name,
      total: g.total,
      camiones: Array.from(g.camiones.values()).sort((a, b) => b.viajes - a.viajes || cmp(a.code, b.code)),
    }))
    .sort((a, b) => b.total - a.total || cmp(a.name, b.name));

  return {
    empresas,
    total: rows.length,
    totalCamiones: empresas.reduce((s, e) => s + e.camiones.length, 0),
  };
}
