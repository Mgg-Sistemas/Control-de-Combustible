// ACARREO · Generación de los PDFs del módulo: Guía de Traslado, Acta de
// Recepción (con fotos), Liquidación de Viaje y Consolidado de Acarreos.
import { supabase } from '../supabase';
import { pdfDocument, exportPdf, urlToDataUri, nowStamp } from '../pdf';
import {
  HaulOrder, HaulClient, HaulLocation, HaulTruck, HaulTrailer, HaulDriver,
  HaulCheck, HaulPhoto, HaulExpense, HaulIncident,
} from '../../types/database';

export type HaulNameRefs = {
  clients: HaulClient[]; locations: HaulLocation[]; trucks: HaulTruck[];
  trailers: HaulTrailer[]; drivers: HaulDriver[];
};

const EXTRA_CSS = `
  table{width:100%;border-collapse:collapse;margin:8px 0 4px;font-size:11px}
  th,td{border:1px solid #C9D2DE;padding:5px 7px;text-align:left;vertical-align:top}
  th{background:#1E3A5F;color:#fff;font-weight:700}
  .kv{font-size:12px;line-height:1.7;margin:6px 0}
  .kv b{color:#1E3A5F}
  .sec{font-size:13px;font-weight:800;color:#1E3A5F;margin:14px 0 4px;text-transform:uppercase}
  .sign{display:flex;gap:40px;margin-top:34px}
  .sign > div{flex:1;border-top:1px solid #333;padding-top:5px;font-size:11px;text-align:center}
  .photos{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
  .photos img{width:150px;height:110px;object-fit:cover;border:1px solid #C9D2DE}
  .tot{font-weight:800;color:#1E3A5F}
`;

function maps(refs: HaulNameRefs) {
  return {
    client: new Map(refs.clients.map((c) => [c.id, c.name])),
    loc: new Map(refs.locations.map((l) => [l.id, l.name])),
    truck: new Map(refs.trucks.map((t) => [t.id, t])),
    trailer: new Map(refs.trailers.map((t) => [t.id, t])),
    driver: new Map(refs.drivers.map((d) => [d.id, d])),
  };
}

async function loadItems(orderId: string) {
  const { data } = await supabase.from('haul_order_items')
    .select('weight_ton_snap, horometro_ini, horometro_fin, km_ini, km_fin, machinery:machinery_id(code, serial, tipo, weight_ton, length_m, width_m, height_m)')
    .eq('order_id', orderId);
  return (data ?? []) as any[];
}

const fecha = (s?: string | null) => (s ? s.slice(0, 10) : '—');

/** 1) GUÍA DE TRASLADO / ORDEN DE ACARREO — documento para el chofer. */
export async function exportGuiaTraslado(order: HaulOrder, refs: HaulNameRefs): Promise<boolean> {
  const m = maps(refs);
  const items = await loadItems(order.id);
  const truck = order.truck_id ? m.truck.get(order.truck_id) : null;
  const trailer = order.trailer_id ? m.trailer.get(order.trailer_id) : null;
  const driver = order.driver_id ? m.driver.get(order.driver_id) : null;
  const totalTon = items.reduce((s, it) => s + (Number(it.weight_ton_snap ?? it.machinery?.weight_ton) || 0), 0);

  const rows = items.map((it) => `<tr>
    <td>${it.machinery?.code ?? '—'}</td><td>${it.machinery?.serial ?? ''}</td>
    <td>${it.machinery?.tipo ?? ''}</td>
    <td>${it.weight_ton_snap ?? it.machinery?.weight_ton ?? '—'}</td>
    <td>${[it.machinery?.length_m, it.machinery?.width_m, it.machinery?.height_m].some((x: any) => x != null) ? `${it.machinery?.length_m ?? '?'}×${it.machinery?.width_m ?? '?'}×${it.machinery?.height_m ?? '?'}` : '—'}</td>
  </tr>`).join('');

  const body = `
    <div class="kv">
      <b>Folio:</b> ${order.folio} &nbsp;·&nbsp; <b>Origen:</b> ${m.loc.get(order.origin_location_id ?? '') ?? '—'}
      &nbsp;→&nbsp; <b>Destino:</b> ${m.loc.get(order.dest_location_id ?? '') ?? '—'}<br/>
      <b>Emisor:</b> ${m.client.get(order.client_from_id ?? '') ?? '—'} &nbsp;·&nbsp; <b>Receptor:</b> ${m.client.get(order.client_to_id ?? '') ?? '—'}<br/>
      <b>Salida requerida:</b> ${fecha(order.requested_departure_at)} &nbsp;·&nbsp; <b>Llegada requerida:</b> ${fecha(order.required_arrival_at)}
    </div>
    <div class="sec">Unidad y chofer</div>
    <div class="kv">
      <b>Chuto:</b> ${truck?.plate ?? '—'} ${truck?.brand ? `(${truck.brand} ${truck.model ?? ''})` : ''} &nbsp;·&nbsp;
      <b>Remolque:</b> ${trailer?.plate ?? '—'} ${trailer ? `(${trailer.kind}${trailer.max_load_ton != null ? `, ${trailer.max_load_ton} t` : ''})` : ''}<br/>
      <b>Chofer:</b> ${driver?.full_name ?? '—'} &nbsp;·&nbsp; <b>Licencia:</b> ${driver?.license_number ?? '—'}
    </div>
    <div class="sec">Maquinaria transportada — Carga total: ${totalTon.toFixed(1)} t</div>
    <table><thead><tr><th>Código</th><th>Serial</th><th>Modelo</th><th>Peso (t)</th><th>L×A×H (m)</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">Sin equipos.</td></tr>'}</tbody></table>
    <div class="kv"><b>Ruta autorizada:</b> ${order.route_km_est != null ? `${order.route_km_est} km` : '____________'} &nbsp;·&nbsp; <b>Peajes:</b> ${order.tolls_est ?? '____'}</div>
    ${order.notes ? `<div class="kv"><b>Notas:</b> ${order.notes}</div>` : ''}
    <div class="sign"><div>Firma SALIDA (origen)</div><div>Firma LLEGADA (destino)</div></div>
  `;
  const html = pdfDocument({ title: 'Guía de Traslado', subtitle: `Orden de acarreo ${order.folio}`, body, extraCss: EXTRA_CSS });
  return exportPdf(html, `Guia-${order.folio}`);
}

/** 2) ACTA DE RECEPCIÓN E INSPECCIÓN — estado pre/post con fotos y firmas. */
export async function exportActaRecepcion(order: HaulOrder, refs: HaulNameRefs): Promise<boolean> {
  const m = maps(refs);
  const items = await loadItems(order.id);
  const [{ data: checks }, { data: photos }] = await Promise.all([
    supabase.from('haul_checks').select('*').eq('order_id', order.id).order('at'),
    supabase.from('haul_photos').select('*').eq('order_id', order.id).order('at'),
  ]);
  const salida = (checks ?? []).find((c: any) => c.kind === 'salida') as HaulCheck | undefined;
  const recep = (checks ?? []).find((c: any) => c.kind === 'recepcion') as HaulCheck | undefined;

  // Incrusta las fotos (data-uri) para que salgan en el PDF.
  const embed = async (tags: string[]) => {
    const ps = (photos ?? []).filter((p: any) => tags.includes(p.tag)).slice(0, 6) as HaulPhoto[];
    const uris = await Promise.all(ps.map((p) => urlToDataUri(p.url)));
    return uris.filter(Boolean).map((u) => `<img src="${u}"/>`).join('');
  };
  const antes = await embed(['antes', 'amarre']);
  const despues = await embed(['despues']);
  const firmaUri = recep?.signature_url ? await urlToDataUri(recep.signature_url) : null;

  const chkTxt = (c?: HaulCheck) => c ? `Combustible: ${c.fuel_level ?? '—'} · Cauchos: ${c.tires_ok ? 'OK' : 'REVISAR'} · Amarre: ${c.straps_ok ? 'OK' : 'REVISAR'}${(c.checklist as any)?.nota ? ` · ${(c.checklist as any).nota}` : ''}` : 'Sin registro';

  const body = `
    <div class="kv"><b>Folio:</b> ${order.folio} &nbsp;·&nbsp; <b>Ruta:</b> ${m.loc.get(order.origin_location_id ?? '') ?? '—'} → ${m.loc.get(order.dest_location_id ?? '') ?? '—'}</div>
    <div class="sec">Maquinaria</div>
    <table><thead><tr><th>Código</th><th>Serial</th><th>Horómetro ini/fin</th><th>Km ini/fin</th></tr></thead>
      <tbody>${items.map((it) => `<tr><td>${it.machinery?.code ?? '—'}</td><td>${it.machinery?.serial ?? ''}</td><td>${it.horometro_ini ?? '—'} / ${it.horometro_fin ?? '—'}</td><td>${it.km_ini ?? '—'} / ${it.km_fin ?? '—'}</td></tr>`).join('') || '<tr><td colspan="4">Sin equipos.</td></tr>'}</tbody></table>
    <div class="sec">Estado a la SALIDA</div><div class="kv">${chkTxt(salida)}</div>
    ${antes ? `<div class="photos">${antes}</div>` : ''}
    <div class="sec">Estado a la RECEPCIÓN</div><div class="kv">${chkTxt(recep)}${(recep?.checklist as any)?.nota ? '' : ''}</div>
    ${despues ? `<div class="photos">${despues}</div>` : ''}
    <div class="sign">
      <div>Entregado por (origen)</div>
      <div>${recep?.signed_by_name ? `Recibido: ${recep.signed_by_name}` : 'Recibido por (destino)'}${firmaUri ? `<br/><img src="${firmaUri}" style="height:44px;margin-top:4px"/>` : ''}</div>
    </div>
  `;
  const html = pdfDocument({ title: 'Acta de Recepción', subtitle: `Inspección de traslado ${order.folio}`, body, extraCss: EXTRA_CSS });
  return exportPdf(html, `Acta-${order.folio}`);
}

/** 3) LIQUIDACIÓN DE VIAJE (interno) — resumen financiero de la orden. */
export async function exportLiquidacion(order: HaulOrder, refs: HaulNameRefs): Promise<boolean> {
  const m = maps(refs);
  const [{ data: exp }, { data: inc }] = await Promise.all([
    supabase.from('haul_expenses').select('*').eq('order_id', order.id).order('at'),
    supabase.from('haul_incidents').select('*').eq('order_id', order.id).order('at'),
  ]);
  const expenses = (exp ?? []) as HaulExpense[];
  const incidents = (inc ?? []) as HaulIncident[];
  const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const viatComp = expenses.filter((e) => e.kind.startsWith('viatico')).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const combL = expenses.filter((e) => e.kind === 'combustible').reduce((s, e) => s + (Number(e.liters) || 0), 0);
  const otorgado = Number(order.per_diem_advanced) || 0;
  const money = (n: number) => `$${n.toFixed(2)}`;

  const body = `
    <div class="kv"><b>Folio:</b> ${order.folio} &nbsp;·&nbsp; <b>Ruta:</b> ${m.loc.get(order.origin_location_id ?? '') ?? '—'} → ${m.loc.get(order.dest_location_id ?? '') ?? '—'} &nbsp;·&nbsp; <b>Chofer:</b> ${order.driver_id ? m.driver.get(order.driver_id)?.full_name ?? '—' : '—'}</div>
    <div class="sec">Gastos</div>
    <table><thead><tr><th>Tipo</th><th>Litros</th><th>Nota</th><th>Monto</th></tr></thead>
      <tbody>${expenses.map((e) => `<tr><td>${e.kind}</td><td>${e.liters ?? ''}</td><td>${e.note ?? ''}</td><td>${money(Number(e.amount) || 0)}</td></tr>`).join('') || '<tr><td colspan="4">Sin gastos.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3" class="tot">TOTAL</td><td class="tot">${money(total)}</td></tr></tfoot></table>
    <div class="kv">
      <b>Viáticos otorgados:</b> ${money(otorgado)} &nbsp;·&nbsp; <b>comprobados:</b> ${money(viatComp)} &nbsp;·&nbsp; <b>diferencia:</b> ${money(otorgado - viatComp)}<br/>
      <b>Combustible:</b> ${combL.toFixed(0)} L ${order.route_km_est != null && combL > 0 ? `· Rendimiento ${(Number(order.route_km_est) / combL).toFixed(1)} km/L` : ''}<br/>
      <b>Km recorridos (est.):</b> ${order.route_km_est ?? '—'}${order.billed_amount != null ? ` &nbsp;·&nbsp; <b>Valorizado:</b> ${money(Number(order.billed_amount))}` : ''}
    </div>
    <div class="sec">Incidencias</div>
    <div class="kv">${incidents.length ? incidents.map((i) => `• ${i.type}: ${i.description ?? ''}`).join('<br/>') : 'Sin incidencias.'}</div>
    <div class="sign"><div>Elaborado por</div><div>Aprobado por</div></div>
  `;
  const html = pdfDocument({ title: 'Liquidación de Viaje', subtitle: `Orden ${order.folio}`, body, extraCss: EXTRA_CSS });
  return exportPdf(html, `Liquidacion-${order.folio}`);
}

/** 4) CONSOLIDADO DE ACARREOS — resumen de un conjunto de órdenes (con filtros ya aplicados). */
export async function exportConsolidado(orders: HaulOrder[], refs: HaulNameRefs, subtitle: string): Promise<boolean> {
  const m = maps(refs);
  const rows = orders.map((o) => `<tr>
    <td>${o.folio}</td>
    <td>${m.loc.get(o.origin_location_id ?? '') ?? '—'} → ${m.loc.get(o.dest_location_id ?? '') ?? '—'}</td>
    <td>${o.driver_id ? m.driver.get(o.driver_id)?.full_name ?? '—' : '—'}</td>
    <td>${o.status}</td>
    <td>${fecha(o.requested_departure_at)}</td>
    <td>${o.billed_amount != null ? `$${Number(o.billed_amount).toFixed(2)}` : '—'}</td>
  </tr>`).join('');
  const completadas = orders.filter((o) => o.status === 'completado').length;
  const facturado = orders.reduce((s, o) => s + (Number(o.billed_amount) || 0), 0);

  const body = `
    <div class="kv"><b>Total acarreos:</b> ${orders.length} &nbsp;·&nbsp; <b>Completados:</b> ${completadas} &nbsp;·&nbsp; <b>Valorizado:</b> $${facturado.toFixed(2)}</div>
    <table><thead><tr><th>Folio</th><th>Ruta</th><th>Chofer</th><th>Estado</th><th>Salida</th><th>Valorizado</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">Sin acarreos.</td></tr>'}</tbody></table>
    <div class="foot" style="margin-top:14px">Generado ${nowStamp()}</div>
  `;
  const html = pdfDocument({ title: 'Consolidado de Acarreos', subtitle, body, extraCss: EXTRA_CSS });
  return exportPdf(html, `Consolidado-acarreos`);
}
