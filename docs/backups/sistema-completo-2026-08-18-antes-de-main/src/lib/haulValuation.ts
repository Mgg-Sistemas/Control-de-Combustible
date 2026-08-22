// ACARREO · Valorización de una orden a partir del tarifario (servicio a terceros).
import { HaulOrder, HaulTariff } from '../types/database';

/** Elige la tarifa más específica aplicable: cliente+ruta > cliente > ruta > general. */
export function pickTariff(order: HaulOrder, tariffs: HaulTariff[]): HaulTariff | null {
  const client = order.client_to_id ?? order.client_from_id ?? null;
  const from = order.origin_location_id ?? null;
  const to = order.dest_location_id ?? null;
  const active = tariffs.filter((t) => t.active !== false);
  const score = (t: HaulTariff) => {
    let s = 0;
    if (t.client_id) { if (t.client_id !== client) return -1; s += 2; }
    if (t.route_from_id || t.route_to_id) {
      if ((t.route_from_id && t.route_from_id !== from) || (t.route_to_id && t.route_to_id !== to)) return -1;
      s += 1;
    }
    return s;
  };
  let best: HaulTariff | null = null, bestS = -1;
  for (const t of active) {
    const s = score(t);
    if (s > bestS) { bestS = s; best = t; }
  }
  return bestS >= 0 ? best : null;
}

/** Horas del viaje (salida real → llegada real), o null. */
function tripHours(order: HaulOrder): number | null {
  if (!order.departed_at || !order.arrived_at) return null;
  const ms = new Date(order.arrived_at).getTime() - new Date(order.departed_at).getTime();
  return ms > 0 ? ms / 3_600_000 : null;
}

/** Monto valorizado según el modo de la tarifa. `totalTon` = suma del peso de los equipos. */
export function computeValuation(order: HaulOrder, tariff: HaulTariff, totalTon: number): { amount: number | null; detail: string } {
  const p = Number(tariff.unit_price) || 0;
  switch (tariff.mode) {
    case 'plana':
      return { amount: p, detail: 'tarifa plana' };
    case 'km': {
      const km = order.route_km_est != null ? Number(order.route_km_est) : null;
      return { amount: km != null ? p * km : null, detail: km != null ? `${km} km × $${p}` : 'falta distancia (km)' };
    }
    case 'ton':
      return { amount: totalTon > 0 ? p * totalTon : null, detail: totalTon > 0 ? `${totalTon.toFixed(1)} t × $${p}` : 'falta el peso de los equipos' };
    case 'hora': {
      const h = tripHours(order);
      return { amount: h != null ? p * h : null, detail: h != null ? `${h.toFixed(1)} h × $${p}` : 'falta salida/llegada real' };
    }
    default:
      return { amount: null, detail: '—' };
  }
}
