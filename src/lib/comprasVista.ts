// 🗂️ Lógica pura para las vistas de Compras (Actual · Kanban · Lista) (18-nov-2026)
//
// Módulo 100% puro (sin React Native ni Supabase) para poder probarlo en Node.
// Clasifica Solicitudes, Requerimientos y Cuentas por Pagar en columnas Kanban
// mutuamente excluyentes sin dejar ninguna orden huérfana, y arma filas de Lista
// con totales exactos.

export type ModoVistaCompras = 'actual' | 'kanban' | 'lista';

export type ContextoVistaCompras =
  | 'solicitudes'
  | 'requerimientos'
  | 'por_pagar'
  | 'directas'
  | 'servicios';

export const MODO_VISTA_DEFAULT: ModoVistaCompras = 'actual';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const memoriaVista = new Map<string, string>();

function claveStorageVista(contexto: ContextoVistaCompras, userId?: string | null): string {
  const uid = String(userId ?? '').trim() || 'anon';
  return `compras_vista_${contexto}_${uid}`;
}

export function normalizarModoVista(
  v: unknown,
  permitidos: readonly ModoVistaCompras[] = ['actual', 'kanban', 'lista'],
): ModoVistaCompras {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'kanban' && permitidos.includes('kanban')) return 'kanban';
  if (s === 'lista' && permitidos.includes('lista')) return 'lista';
  if (s === 'actual' && permitidos.includes('actual')) return 'actual';
  return MODO_VISTA_DEFAULT;
}

export function tonoDeEstadoReq(
  codigo?: string | null,
): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
  const c = String(codigo ?? '').trim().toLowerCase();
  if (c === 'rechazado' || c === 'cancelado') return 'danger';
  if (c === 'aclaratoria_solicitada') return 'warning';
  if (c === 'esperando_proveedor' || c === 'esperando_cotizacion' || c === 'esperando_aprobacion_gg' || c === 'pendiente') {
    return 'warning';
  }
  if (c === 'recibido' || c === 'despachado' || c === 'entrega_directa' || c === 'esperando_recepcion' || c === 'pagado') {
    return 'success';
  }
  return 'info';
}

function getDefaultStorage(): StorageLike | null {
  try {
    const g = globalThis as any;
    if (g && g.window && g.window.localStorage) {
      return g.window.localStorage as StorageLike;
    }
  } catch {
    // ignore
  }
  return null;
}

export function obtenerVistaPreferidaCompras(
  contexto: ContextoVistaCompras,
  userId?: string | null,
  storage?: StorageLike | null,
  permitidos: readonly ModoVistaCompras[] = ['actual', 'kanban', 'lista'],
): ModoVistaCompras {
  const key = claveStorageVista(contexto, userId);
  try {
    const st = storage ?? getDefaultStorage();
    const raw = st ? st.getItem(key) : memoriaVista.get(key) ?? null;
    return normalizarModoVista(raw, permitidos);
  } catch {
    return MODO_VISTA_DEFAULT;
  }
}

export function guardarVistaPreferidaCompras(
  contexto: ContextoVistaCompras,
  modo: ModoVistaCompras,
  userId?: string | null,
  storage?: StorageLike | null,
  permitidos: readonly ModoVistaCompras[] = ['actual', 'kanban', 'lista'],
): ModoVistaCompras {
  const limpio = normalizarModoVista(modo, permitidos);
  const key = claveStorageVista(contexto, userId);
  memoriaVista.set(key, limpio);
  try {
    const st = storage ?? getDefaultStorage();
    if (st) st.setItem(key, limpio);
  } catch {
    // ignore
  }
  return limpio;
}

export interface ColumnaKanbanDef {
  id: string;
  titulo: string;
  icono: string;
  tono: 'warning' | 'info' | 'success' | 'danger' | 'neutral';
}

export const COLUMNAS_SOLICITUDES: readonly ColumnaKanbanDef[] = [
  { id: 'por_cotizar', titulo: 'Pendientes por Convertir', icono: '📥', tono: 'warning' },
  { id: 'aclaratoria', titulo: 'En Aclaratoria', icono: '⚠️', tono: 'danger' },
  { id: 'en_gestion', titulo: 'En Requerimientos / Gestión', icono: '🔄', tono: 'info' },
  { id: 'aprobacion_gg', titulo: 'Por Pagar · Aprobación GG', icono: '👔', tono: 'warning' },
  { id: 'finalizadas', titulo: 'Por Pagar / Pagado / Almacén', icono: '💳', tono: 'success' },
  { id: 'rechazadas', titulo: 'Rechazadas / Canceladas', icono: '⛔', tono: 'danger' },
];

export const COLUMNAS_REQUERIMIENTOS: readonly ColumnaKanbanDef[] = [
  { id: 'por_completar', titulo: 'Falta Prov. / Precio / Aclaratoria', icono: '🏢', tono: 'warning' },
  { id: 'listo_por_pagar', titulo: 'Listos para Por Pagar', icono: '✅', tono: 'info' },
  { id: 'esperando_aprobacion_gg', titulo: 'Esperando Aprobación GG', icono: '👔', tono: 'warning' },
  { id: 'en_por_pagar', titulo: 'En Por Pagar (Esperando Pago)', icono: '💸', tono: 'info' },
  { id: 'esperando_recepcion', titulo: 'Pagado · Por Recibir', icono: '📦', tono: 'success' },
  { id: 'completado', titulo: 'Recibidos / Despachados', icono: '🏁', tono: 'success' },
  { id: 'rechazado', titulo: 'Rechazados / Cancelados', icono: '⛔', tono: 'danger' },
];

export const COLUMNAS_POR_PAGAR: readonly ColumnaKanbanDef[] = [
  { id: 'esperando_aprobacion', titulo: 'Esperando Aprobación', icono: '👔', tono: 'warning' },
  { id: 'vencida', titulo: 'Vencidas', icono: '🔴', tono: 'danger' },
  { id: 'por_pagar', titulo: 'Pendientes / Por Vencer', icono: '⏳', tono: 'info' },
  { id: 'pagada', titulo: 'Pagadas', icono: '✅', tono: 'success' },
  { id: 'anulada', titulo: 'Anuladas', icono: '⛔', tono: 'neutral' },
];

export function columnasDeContexto(contexto: ContextoVistaCompras): readonly ColumnaKanbanDef[] {
  if (contexto === 'solicitudes') return COLUMNAS_SOLICITUDES;
  if (contexto === 'requerimientos') return COLUMNAS_REQUERIMIENTOS;
  if (contexto === 'por_pagar') return COLUMNAS_POR_PAGAR;
  return [];
}

export function esOrdenUrgente(params: {
  prioridad?: string | null;
  urgency?: string | null;
  situacion?: string | null;
}): { esUrgente: boolean; motivoUrgencia: string | null } {
  const prio = String(params.prioridad ?? '').trim().toLowerCase();
  const urg = String(params.urgency ?? '').trim().toLowerCase();
  const sit = String(params.situacion ?? '').trim().toLowerCase();

  if (prio === 'alta') return { esUrgente: true, motivoUrgencia: 'Prioridad Alta' };
  if (urg === 'urgente') return { esUrgente: true, motivoUrgencia: 'Urgente / Parada' };
  if (sit === 'vencida') return { esUrgente: true, motivoUrgencia: 'Vencida' };
  return { esUrgente: false, motivoUrgencia: null };
}

/**
 * Clasifica una solicitud o requerimiento en una columna de `solicitudes`.
 * Garantiza que ningún estado conocido quede sin columna.
 */
export function resolverColumnaSolicitud(params: {
  estadoCodigo?: string | null;
  status?: string | null;
  yaConvertido?: boolean;
  requiereAprobacionGG?: boolean;
}): string {
  const cod = String(params.estadoCodigo ?? params.status ?? '').trim().toLowerCase();
  const yaConv = !!params.yaConvertido;
  const reqGG = !!params.requiereAprobacionGG;

  if (cod === 'rechazado' || cod === 'cancelado') return 'rechazadas';
  if (cod === 'aclaratoria_solicitada') return 'aclaratoria';
  if (!yaConv) {
    if (cod === 'recibido' || cod === 'despachado' || cod === 'entrega_directa') return 'finalizadas';
    if (cod === 'esperando_aprobacion_gg') return 'aprobacion_gg';
    if (cod === 'aprobado' || cod === 'esperando_recepcion' || cod === 'pagado') return 'finalizadas';
    return 'por_cotizar';
  }
  if (cod === 'esperando_aprobacion_gg' || reqGG) return 'aprobacion_gg';
  if (
    cod === 'aprobado' ||
    cod === 'esperando_recepcion' ||
    cod === 'pagado' ||
    cod === 'recibido' ||
    cod === 'despachado' ||
    cod === 'entrega_directa'
  ) {
    return 'finalizadas';
  }
  return 'en_gestion';
}

/**
 * Clasifica un requerimiento en una columna de `requerimientos`.
 * Cubre los 11 valores de `CodigoEstadoDinamico` y los `RequirementStatus`.
 */
export function resolverColumnaRequerimiento(params: {
  estadoCodigo?: string | null;
  status?: string | null;
}): string {
  const cod = String(params.estadoCodigo ?? params.status ?? '').trim().toLowerCase();
  switch (cod) {
    case 'rechazado':
    case 'cancelado':
      return 'rechazado';
    case 'recibido':
    case 'despachado':
    case 'entrega_directa':
      return 'completado';
    case 'esperando_recepcion':
    case 'pagado':
      return 'esperando_recepcion';
    case 'esperando_aprobacion_gg':
      return 'esperando_aprobacion_gg';
    case 'aprobado':
      return 'en_por_pagar';
    case 'esperando_pago':
      return 'listo_por_pagar';
    case 'esperando_proveedor':
    case 'esperando_cotizacion':
    case 'aclaratoria_solicitada':
    case 'pendiente':
    default:
      return 'por_completar';
  }
}

/**
 * Clasifica una cuenta de Por Pagar en una columna mutuamente excluyente.
 */
export function resolverColumnaPorPagar(params: {
  situacion?: string | null;
  aprobacionEstado?: string | null;
}): string {
  const sit = String(params.situacion ?? '').trim().toLowerCase();
  const aprob = String(params.aprobacionEstado ?? '').trim().toLowerCase();

  if (sit === 'anulada') return 'anulada';
  if (sit === 'pagada' || aprob === 'pagada') return 'pagada';
  if (aprob === 'esperando_aprobacion') return 'esperando_aprobacion';
  if (sit === 'vencida') return 'vencida';
  return 'por_pagar';
}

export interface OrdenVistaItem<T = any> {
  id: string;
  origen: ContextoVistaCompras;
  codigo: string;
  titulo: string;
  empresaNombre: string;
  solicitanteNombre: string;
  proveedorNombre: string;
  maquinariaTexto: string | null;
  itemsCount: number;
  estadoCodigo: string;
  estadoLabel: string;
  estadoTono: 'warning' | 'info' | 'success' | 'danger' | 'neutral';
  columnaId: string;
  montoUsd: number;
  saldoUsd: number;
  monedaBadge: string | null;
  montoBsTexto: string | null;
  prioridad: string | null;
  esUrgente: boolean;
  motivoUrgencia: string | null;
  fechaIso: string;
  fechaCorta: string;
  raw: T;
}

export interface ColumnaKanbanConItems<T = any> {
  id: string;
  titulo: string;
  icono: string;
  tono: 'warning' | 'info' | 'success' | 'danger' | 'neutral';
  items: OrdenVistaItem<T>[];
  count: number;
  totalUsd: number;
  totalSaldoUsd: number;
  urgentesCount: number;
}

export interface ResumenVistaCompras {
  totalItems: number;
  totalUsd: number;
  totalSaldoUsd: number;
  totalUrgentes: number;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function construirColumnasKanban<T>(
  contexto: ContextoVistaCompras,
  items: OrdenVistaItem<T>[],
): { columnas: ColumnaKanbanConItems<T>[]; resumen: ResumenVistaCompras } {
  const defs = columnasDeContexto(contexto);
  const mapa = new Map<string, OrdenVistaItem<T>[]>();
  for (const d of defs) mapa.set(d.id, []);

  for (const it of items) {
    const colId = mapa.has(it.columnaId) ? it.columnaId : defs[0]?.id;
    if (colId) mapa.get(colId)!.push(it);
  }

  const columnas: ColumnaKanbanConItems<T>[] = defs.map((d) => {
    const list = mapa.get(d.id) ?? [];
    // Dentro de cada columna, urgentes primero y luego más recientes
    const ordenados = [...list].sort((a, b) => {
      if (a.esUrgente !== b.esUrgente) return a.esUrgente ? -1 : 1;
      return String(b.fechaIso || '').localeCompare(String(a.fechaIso || ''));
    });
    const totalUsd = r2(ordenados.reduce((s, x) => s + (Number(x.montoUsd) || 0), 0));
    const totalSaldoUsd = r2(ordenados.reduce((s, x) => s + (Number(x.saldoUsd) || 0), 0));
    const urgentesCount = ordenados.filter((x) => x.esUrgente).length;
    return {
      ...d,
      items: ordenados,
      count: ordenados.length,
      totalUsd,
      totalSaldoUsd,
      urgentesCount,
    };
  });

  const resumen: ResumenVistaCompras = {
    totalItems: items.length,
    totalUsd: r2(items.reduce((s, x) => s + (Number(x.montoUsd) || 0), 0)),
    totalSaldoUsd: r2(items.reduce((s, x) => s + (Number(x.saldoUsd) || 0), 0)),
    totalUrgentes: items.filter((x) => x.esUrgente).length,
  };

  return { columnas, resumen };
}

export function construirFilasLista<T>(
  items: OrdenVistaItem<T>[],
): { filas: OrdenVistaItem<T>[]; resumen: ResumenVistaCompras } {
  const filas = [...items].sort((a, b) => {
    if (a.esUrgente !== b.esUrgente) return a.esUrgente ? -1 : 1;
    return String(b.fechaIso || '').localeCompare(String(a.fechaIso || ''));
  });

  const resumen: ResumenVistaCompras = {
    totalItems: filas.length,
    totalUsd: r2(filas.reduce((s, x) => s + (Number(x.montoUsd) || 0), 0)),
    totalSaldoUsd: r2(filas.reduce((s, x) => s + (Number(x.saldoUsd) || 0), 0)),
    totalUrgentes: filas.filter((x) => x.esUrgente).length,
  };

  return { filas, resumen };
}
