// 🛵 DELIVERY · Fase 1 (09-nov-2026), adaptado del módulo de MGG / Golden Touch
// (src/modules/delivery/delivery.ts de Mgg-Sistemas/MGG).
//
// El requerimiento que Compras APROBÓ y Por Pagar marcó PAGADO, y que el almacén todavía no
// recibió, aparece «Por buscar» en el teléfono de los motorizados:
//   1) uno lo TOMA (la base no deja que otro lo tome)   → «Va al proveedor»
//   2) lo RECOGE donde el proveedor, con fotos           → «Lo lleva al almacén»
//   3) lo ENTREGA en el almacén, con fotos y nota         → «Entregado en almacén»
//   ·) o lo CANCELA con un motivo, y queda libre para otro.
// Si Compras ya le ASIGNÓ un motorizado al requerimiento, solo le aparece a él.
// «Entregado» NO marca el requerimiento como recibido: eso lo sigue haciendo el almacén.
// Nace APAGADO (delivery_config.activo) y el monto solo se ve si el administrador lo permite.
//
// Aquí vive lo que no toca la base: estados, motivos, mensajes de WhatsApp y enlaces.
// Lo prueba `scripts/test-delivery.mjs`.

export type EstadoDelivery = 'por_tomar' | 'aceptado' | 'en_ruta' | 'entregado' | 'cancelado';

export type ItemDelivery = { name?: string; qty?: number; unit?: string | null; note?: string | null };
export type EventoDelivery = { at: string; evento: string; actor?: string | null; motivo?: string | null };

export type PedidoDelivery = {
  requerimiento_id: string;
  codigo: string | null;
  titulo: string | null;
  prioridad: string | null;
  items: ItemDelivery[];
  nota: string | null;
  area: string | null;
  solicitante: string | null;
  proveedor_nombre: string | null;
  proveedor_telefono: string | null;
  proveedor_direccion: string | null;
  /** null = no se muestra (el administrador no lo permite). */
  monto: number | null;
  asignado_id: string | null;
  asignado_nombre: string | null;
  pedido_id: string | null;
  estado: EstadoDelivery;
  ultimo_cancelado: { por: string | null; motivo: string | null; en: string | null } | null;
  repartidor_id: string | null;
  repartidor_nombre: string | null;
  aceptado_en: string | null;
  en_ruta_en: string | null;
  entregado_en: string | null;
  cancelado_en: string | null;
  motivo_cancel: string | null;
  detalle_cancel: string | null;
  almacen_entrega: string | null;
  nota_entrega: string | null;
  fotos_recibo: string[];
  fotos_entrega: string[];
  historial: EventoDelivery[];
  es_mio: boolean;
};

export type ListadoDelivery = { activo: boolean; ver_monto: boolean; supervisa: boolean; motorizado: boolean; pedidos: PedidoDelivery[] };

export const ESTADO_DELIVERY: Record<EstadoDelivery, { label: string; emoji: string }> = {
  por_tomar: { label: 'Por buscar', emoji: '💰' },
  aceptado: { label: 'Va al proveedor', emoji: '🛵' },
  en_ruta: { label: 'Lo lleva al almacén', emoji: '🚚' },
  entregado: { label: 'Entregado en almacén', emoji: '✅' },
  cancelado: { label: 'Cancelado', emoji: '⛔' },
};

/** Motivos de cancelación (los de MGG; el último deja escribir). */
export const MOTIVOS_CANCELACION: string[] = [
  'El proveedor no tiene el pedido listo',
  'Proveedor cerrado o no atiende',
  'Dirección errada o zona inaccesible',
  'Avería del vehículo',
  'Condiciones climáticas / lluvia fuerte',
  'Falta de combustible',
  'Otro motivo',
];

export const MAX_FOTOS_DELIVERY = 6;

const txt = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number | null => { const n = typeof v === 'string' ? Number(v) : (v as number); return Number.isFinite(n) ? n : null; };
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const ESTADOS_VALIDOS: EstadoDelivery[] = ['por_tomar', 'aceptado', 'en_ruta', 'entregado', 'cancelado'];

/** Lo que manda la base, saneado. */
export function normalizarListado(r: any): ListadoDelivery {
  return {
    activo: !!r?.activo,
    ver_monto: !!r?.ver_monto,
    supervisa: !!r?.supervisa,
    motorizado: !!r?.motorizado,
    pedidos: arr<any>(r?.pedidos).map((p) => ({
      requerimiento_id: txt(p?.requerimiento_id),
      codigo: txt(p?.codigo) || null,
      titulo: txt(p?.titulo) || null,
      prioridad: txt(p?.prioridad) || null,
      items: arr<ItemDelivery>(p?.items),
      nota: txt(p?.nota) || null,
      area: txt(p?.area) || null,
      solicitante: txt(p?.solicitante) || null,
      proveedor_nombre: txt(p?.proveedor_nombre) || null,
      proveedor_telefono: txt(p?.proveedor_telefono) || null,
      proveedor_direccion: txt(p?.proveedor_direccion) || null,
      monto: p?.monto == null ? null : num(p.monto),
      asignado_id: txt(p?.asignado_id) || null,
      asignado_nombre: txt(p?.asignado_nombre) || null,
      pedido_id: txt(p?.pedido_id) || null,
      estado: (ESTADOS_VALIDOS.includes(p?.estado) ? p.estado : 'por_tomar') as EstadoDelivery,
      ultimo_cancelado: p?.ultimo_cancelado ? { por: p.ultimo_cancelado.por ?? null, motivo: p.ultimo_cancelado.motivo ?? null, en: p.ultimo_cancelado.en ?? null } : null,
      repartidor_id: txt(p?.repartidor_id) || null,
      repartidor_nombre: txt(p?.repartidor_nombre) || null,
      aceptado_en: p?.aceptado_en ?? null,
      en_ruta_en: p?.en_ruta_en ?? null,
      entregado_en: p?.entregado_en ?? null,
      cancelado_en: p?.cancelado_en ?? null,
      motivo_cancel: txt(p?.motivo_cancel) || null,
      detalle_cancel: txt(p?.detalle_cancel) || null,
      almacen_entrega: txt(p?.almacen_entrega) || null,
      nota_entrega: txt(p?.nota_entrega) || null,
      fotos_recibo: arr<string>(p?.fotos_recibo).filter((x) => typeof x === 'string' && x),
      fotos_entrega: arr<string>(p?.fotos_entrega).filter((x) => typeof x === 'string' && x),
      historial: arr<EventoDelivery>(p?.historial),
      es_mio: !!p?.es_mio,
    })),
  };
}

export const esUrgente = (p: Pick<PedidoDelivery, 'prioridad'>): boolean => /urgent/i.test(p.prioridad ?? '');

/** Las tres listas de la pantalla. */
export function separar(pedidos: PedidoDelivery[]): { porBuscar: PedidoDelivery[]; enCurso: PedidoDelivery[]; cerrados: PedidoDelivery[] } {
  const porBuscar = pedidos.filter((p) => p.estado === 'por_tomar');
  const enCurso = pedidos.filter((p) => p.estado === 'aceptado' || p.estado === 'en_ruta');
  const cerrados = pedidos.filter((p) => p.estado === 'entregado' || p.estado === 'cancelado')
    .sort((a, b) => String(b.entregado_en ?? b.cancelado_en ?? '').localeCompare(String(a.entregado_en ?? a.cancelado_en ?? '')));
  // Los urgentes primero (la base ya los ordena; aquí se asegura).
  porBuscar.sort((a, b) => Number(esUrgente(b)) - Number(esUrgente(a)));
  return { porBuscar, enCurso, cerrados };
}

export function montoTxt(n: number | null): string {
  if (n == null) return '';
  return `$${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fechaHoraVE(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function minutosEntre(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const m = (new Date(b).getTime() - new Date(a).getTime()) / 60000;
  return Number.isFinite(m) && m >= 0 ? Math.round(m) : null;
}

/** Los productos en una línea cada uno: «• Paños de microfibra — 12 UND». */
export function lineasItems(p: Pick<PedidoDelivery, 'items'>): string[] {
  return (p.items ?? []).filter((i) => txt(i?.name))
    .map((i) => `• ${txt(i.name)} — ${(num(i.qty) ?? 0).toLocaleString('es-VE', { maximumFractionDigits: 3 })}${txt(i.unit) ? ` ${txt(i.unit)}` : ''}`);
}

// ── Enlaces del teléfono ──

/** «tel:» con solo dígitos y el +. null si no hay teléfono. */
export function enlaceLlamar(tel: string | null | undefined): string | null {
  const t = txt(tel).replace(/[^\d+]/g, '');
  return t.length >= 7 ? `tel:${t}` : null;
}

/** WhatsApp a un número venezolano: 0414… → 58414…; con texto opcional. */
export function enlaceWhatsApp(tel: string | null | undefined, texto?: string): string | null {
  let t = txt(tel).replace(/\D/g, '');
  if (!t) return texto ? `https://wa.me/?text=${encodeURIComponent(texto)}` : null;
  if (t.startsWith('0')) t = '58' + t.slice(1);
  else if (t.length === 10) t = '58' + t;
  return `https://wa.me/${t}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}

/** Abre la dirección en Google Maps (búsqueda por texto). */
export function enlaceMapa(direccion: string | null | undefined, proveedor?: string | null): string | null {
  const q = [txt(proveedor), txt(direccion)].filter(Boolean).join(', ');
  return txt(direccion) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

// ── Mensajes de WhatsApp (como MGG; sin el selector U+FE0F) ──

const pie = (): string[] => ['', '🏢 *SOS LA GUAIRA* · Delivery de compras'];
const orden = (p: PedidoDelivery): string => `${p.codigo ?? 'REQ'}${p.titulo ? ` · ${p.titulo}` : ''}`;

export function mensajeTomado(p: PedidoDelivery, repartidor: string, cuando?: string | null): string {
  const l = ['🛵 *PEDIDO TOMADO · VA AL PROVEEDOR*', `🔹 *Requerimiento:* ${orden(p)}`, esUrgente(p) ? '🚨 *Prioridad:* URGENTE' : '🟢 *Prioridad:* Normal',
    `👤 *Delivery:* ${repartidor}`, `🏭 *Proveedor:* ${p.proveedor_nombre ?? '—'}`];
  if (p.proveedor_direccion) l.push(`📍 *Dirección:* ${p.proveedor_direccion}`);
  const items = lineasItems(p);
  if (items.length) l.push('', `📦 *Productos (${items.length}):*`, ...items);
  l.push('', `🕒 ${fechaHoraVE(cuando ?? new Date().toISOString())}`, ...pie());
  return l.join('\n');
}

export function mensajeRecogido(p: PedidoDelivery, repartidor: string, fotos: number, cuando?: string | null): string {
  const l = ['🚚 *PEDIDO RECOGIDO · VA AL ALMACÉN*', `🔹 *Requerimiento:* ${orden(p)}`, `👤 *Delivery:* ${repartidor}`, `🏭 *Proveedor:* ${p.proveedor_nombre ?? '—'}`];
  if (fotos > 0) l.push(`📷 *Fotos al recibir:* ${fotos}`);
  l.push(`🕒 ${fechaHoraVE(cuando ?? new Date().toISOString())}`, ...pie());
  return l.join('\n');
}

export function mensajeEntregado(p: PedidoDelivery, repartidor: string, almacen: string, nota: string | null, fotos: number, cuando?: string | null): string {
  const l = ['✅ *PEDIDO ENTREGADO EN ALMACÉN*', `🔹 *Requerimiento:* ${orden(p)}`, `👤 *Delivery:* ${repartidor}`, `🏭 *Proveedor:* ${p.proveedor_nombre ?? '—'}`, `🏬 *Almacén:* ${almacen}`];
  const items = lineasItems(p);
  if (items.length) l.push('', `📦 *Productos (${items.length}):*`, ...items);
  if (fotos > 0) l.push(`📷 *Fotos de la entrega:* ${fotos}`);
  if (txt(nota)) l.push(`📝 *Nota:* ${txt(nota)}`);
  const t = minutosEntre(p.aceptado_en, cuando ?? new Date().toISOString());
  if (t != null) l.push(`⏳ *Tiempo desde que lo tomó:* ${t} min`);
  l.push(`🕒 ${fechaHoraVE(cuando ?? new Date().toISOString())}`, ...pie());
  return l.join('\n');
}

export function mensajeCancelado(p: PedidoDelivery, repartidor: string, motivo: string, detalle?: string | null, cuando?: string | null): string {
  const l = ['⛔ *PEDIDO CANCELADO POR DELIVERY*', `🔹 *Requerimiento:* ${orden(p)}`, `👤 *Delivery:* ${repartidor}`, `🏭 *Proveedor:* ${p.proveedor_nombre ?? '—'}`, '', `❌ *Motivo:* ${motivo}`];
  if (txt(detalle)) l.push(`📝 *Detalle:* ${txt(detalle)}`);
  l.push('', '🔄 El pedido queda disponible para otro delivery.', `🕒 ${fechaHoraVE(cuando ?? new Date().toISOString())}`, ...pie());
  return l.join('\n');
}

/** Revisa la cancelación: motivo obligatorio; «Otro motivo» exige escribir el detalle. */
export function revisarCancelacion(motivo: string, detalle: string): string | null {
  if (!txt(motivo)) return 'Elige el motivo de la cancelación.';
  if (motivo === 'Otro motivo' && !txt(detalle)) return 'Escribe cuál es el otro motivo.';
  return null;
}

/** Revisa la entrega: el almacén es obligatorio. */
export function revisarEntrega(almacen: string): string | null {
  return txt(almacen) ? null : 'Escribe en qué almacén lo entregaste.';
}

/** Cuántos pedidos lleva cada delivery (para quien supervisa). */
export function resumenPorDelivery(pedidos: PedidoDelivery[]): { repartidor: string; entregados: number; cancelados: number; enCurso: number; minutosPromedio: number | null }[] {
  const acc = new Map<string, { entregados: number; cancelados: number; enCurso: number; minutos: number[] }>();
  for (const p of pedidos) {
    const quien = p.repartidor_nombre ?? (p.estado === 'cancelado' ? p.ultimo_cancelado?.por ?? null : null);
    if (!quien || p.estado === 'por_tomar') continue;
    const a = acc.get(quien) ?? { entregados: 0, cancelados: 0, enCurso: 0, minutos: [] };
    if (p.estado === 'entregado') { a.entregados++; const m = minutosEntre(p.aceptado_en, p.entregado_en); if (m != null) a.minutos.push(m); }
    else if (p.estado === 'cancelado') a.cancelados++;
    else a.enCurso++;
    acc.set(quien, a);
  }
  return [...acc.entries()].map(([repartidor, a]) => ({
    repartidor, entregados: a.entregados, cancelados: a.cancelados, enCurso: a.enCurso,
    minutosPromedio: a.minutos.length ? Math.round(a.minutos.reduce((s, x) => s + x, 0) / a.minutos.length) : null,
  })).sort((x, y) => y.entregados - x.entregados || x.repartidor.localeCompare(y.repartidor, 'es'));
}
