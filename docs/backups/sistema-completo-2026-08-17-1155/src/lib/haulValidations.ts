// ACARREO · Validaciones automáticas de una orden de acarreo.
// Puras (sin acceso a red) salvo `overlapCheck`, que recibe las órdenes ya leídas.
// Devuelven advertencias legibles; la UI decide si son bloqueo suave (admin puede forzar).
import { HaulOrder, HaulTruck, HaulTrailer, HaulDriver, HaulDocument, Machinery } from '../types/database';

export type HaulWarning = { level: 'error' | 'warn'; text: string };

/** Peso total de los equipos vs. capacidad del remolque (y arrastre del chuto). */
export function weightWarnings(
  machines: Machinery[],
  trailer: HaulTrailer | null,
  truck: HaulTruck | null
): HaulWarning[] {
  const out: HaulWarning[] = [];
  const total = machines.reduce((s, m) => s + (Number(m.weight_ton) || 0), 0);
  const sinPeso = machines.filter((m) => m.weight_ton == null);
  if (sinPeso.length) {
    out.push({ level: 'warn', text: `${sinPeso.length} equipo(s) sin peso cargado: no se puede validar la carga (${sinPeso.map((m) => m.code).join(', ')}).` });
  }
  if (trailer?.max_load_ton != null && total > Number(trailer.max_load_ton)) {
    out.push({ level: 'error', text: `La carga (${total.toFixed(1)} t) supera la capacidad del remolque ${trailer.plate} (${trailer.max_load_ton} t).` });
  }
  if (truck?.max_tow_ton != null && total > Number(truck.max_tow_ton)) {
    out.push({ level: 'error', text: `La carga (${total.toFixed(1)} t) supera el arrastre del chuto ${truck.plate} (${truck.max_tow_ton} t).` });
  }
  return out;
}

/** Documentos/licencias vencidos del chofer, chuto y remolque a la fecha dada (ISO). */
export function expiryWarnings(
  todayISO: string,
  driver: HaulDriver | null,
  truck: HaulTruck | null,
  trailer: HaulTrailer | null,
  docs: HaulDocument[]
): HaulWarning[] {
  const out: HaulWarning[] = [];
  if (driver?.license_expires_at && driver.license_expires_at < todayISO) {
    out.push({ level: 'error', text: `La licencia del chofer ${driver.full_name} está vencida (${driver.license_expires_at}).` });
  }
  if (driver?.hazmat_expires_at && driver.hazmat_expires_at < todayISO) {
    out.push({ level: 'warn', text: `El certificado de carga peligrosa de ${driver.full_name} está vencido (${driver.hazmat_expires_at}).` });
  }
  const docFor = (ownerId: string | null | undefined, ownerLabel: string) => {
    if (!ownerId) return;
    docs.filter((d) => d.owner_id === ownerId && d.expires_at && d.expires_at < todayISO)
      .forEach((d) => out.push({ level: 'warn', text: `${ownerLabel}: documento vencido (${d.doc_type}, venció ${d.expires_at}).` }));
  };
  docFor(truck?.id, `Chuto ${truck?.plate ?? ''}`.trim());
  docFor(trailer?.id, `Remolque ${trailer?.plate ?? ''}`.trim());
  docFor(driver?.id, `Chofer ${driver?.full_name ?? ''}`.trim());
  return out;
}

/** ¿Dos ventanas [aStart,aEnd) y [bStart,bEnd) se solapan? (fechas ISO/timestamp comparables como texto). */
function overlaps(aStart?: string | null, aEnd?: string | null, bStart?: string | null, bEnd?: string | null): boolean {
  const s1 = aStart ?? '', e1 = aEnd ?? aStart ?? '', s2 = bStart ?? '', e2 = bEnd ?? bStart ?? '';
  if (!s1 || !s2) return false;
  return s1 <= (e2 || s2) && s2 <= (e1 || s1);
}

/** Chofer / chuto / remolque ya asignados a otra orden ACTIVA que solapa la ventana. */
export function overlapWarnings(
  current: { id?: string; driver_id?: string | null; truck_id?: string | null; trailer_id?: string | null; requested_departure_at?: string | null; required_arrival_at?: string | null },
  others: HaulOrder[]
): HaulWarning[] {
  const out: HaulWarning[] = [];
  const activos = others.filter((o) => o.id !== current.id && o.status !== 'completado' && o.status !== 'cancelado');
  const win = (o: { requested_departure_at?: string | null; required_arrival_at?: string | null }) =>
    overlaps(current.requested_departure_at, current.required_arrival_at, o.requested_departure_at, o.required_arrival_at);
  if (current.driver_id) {
    const c = activos.filter((o) => o.driver_id === current.driver_id && win(o));
    if (c.length) out.push({ level: 'warn', text: `El chofer ya tiene ${c.length} viaje(s) en esa ventana (${c.map((o) => o.folio).join(', ')}).` });
  }
  if (current.truck_id) {
    const c = activos.filter((o) => o.truck_id === current.truck_id && win(o));
    if (c.length) out.push({ level: 'warn', text: `El chuto ya tiene ${c.length} viaje(s) en esa ventana (${c.map((o) => o.folio).join(', ')}).` });
  }
  if (current.trailer_id) {
    const c = activos.filter((o) => o.trailer_id === current.trailer_id && win(o));
    if (c.length) out.push({ level: 'warn', text: `El remolque ya tiene ${c.length} viaje(s) en esa ventana (${c.map((o) => o.folio).join(', ')}).` });
  }
  return out;
}

/** Junta todas las validaciones. `error` = bloqueo suave; `warn` = aviso. */
export function allWarnings(input: {
  todayISO: string;
  machines: Machinery[];
  truck: HaulTruck | null;
  trailer: HaulTrailer | null;
  driver: HaulDriver | null;
  docs: HaulDocument[];
  current: Parameters<typeof overlapWarnings>[0];
  others: HaulOrder[];
}): HaulWarning[] {
  return [
    ...weightWarnings(input.machines, input.trailer, input.truck),
    ...expiryWarnings(input.todayISO, input.driver, input.truck, input.trailer, input.docs),
    ...overlapWarnings(input.current, input.others),
  ];
}
