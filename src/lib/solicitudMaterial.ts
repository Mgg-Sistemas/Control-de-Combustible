// ── Solicitudes de Material / Repuestos (Existencia vs Compra Técnica) ───────
// Separa el requerimiento operativo/técnico del flujo financiero de Compras.
// 1) Si hay existencia en Almacén: genera Solicitud de Despacho (inventory_stock_requests).
// 2) Si NO hay stock o es pieza nueva: genera Solicitud de Compra Técnica (inventory_requirements)
//    con medidas obligatorias, foto y soporte de ciclo de aclaratorias.

export function nextStockRequestCode(codes: (string | null | undefined)[], bump = 0): string {
  let max = 0;
  codes.forEach((c) => {
    const m = String(c ?? '').match(/(\d+)\s*$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return 'SOL-' + String(max + 1 + bump).padStart(4, '0');
}

export const URGENCIA_CONFIG = {
  normal: { label: 'Normal', color: '#0F766E', bg: '#CCFBF1', icon: '🟢' },
  alta: { label: 'Alta', color: '#D97706', bg: '#FEF3C7', icon: '🟡' },
  urgente: { label: 'Urgente / Parada', color: '#DC2626', bg: '#FEE2E2', icon: '🔴' },
};

export const ESTADO_EXISTENCIA_CONFIG = {
  pendiente: { label: 'Pendiente en Almacén', color: '#D97706', bg: '#FEF3C7', icon: '⏳' },
  despachado: { label: 'Despachado / Entregado', color: '#16A34A', bg: '#DCFCE7', icon: '✅' },
  rechazado: { label: 'Rechazado', color: '#DC2626', bg: '#FEE2E2', icon: '❌' },
  cancelado: { label: 'Cancelada por Solicitante', color: '#475569', bg: '#F1F5F9', icon: '🚫' },
};

export const ESTADO_COMPRA_CONFIG = {
  pendiente: { label: 'En revisión de Compras', color: '#2563EB', bg: '#DBEAFE', icon: '🛒' },
  aclaratoria_solicitada: { label: '⚠️ Requiere Aclaratoria Técnica', color: '#EA580C', bg: '#FFEDD5', icon: '⚠️' },
  aprobado: { label: 'Aprobado para Compra', color: '#059669', bg: '#D1FAE5', icon: '✅' },
  esperando_recepcion: { label: 'Esperando Recepción en Almacén', color: '#0D9488', bg: '#F0FDFA', icon: '📦' },
  pagado: { label: 'Esperando Recepción en Almacén', color: '#0D9488', bg: '#F0FDFA', icon: '📦' },
  recibido: { label: 'Recibido en Almacén', color: '#16A34A', bg: '#DCFCE7', icon: '📦' },
  rechazado: { label: 'Rechazado', color: '#DC2626', bg: '#FEE2E2', icon: '❌' },
  cancelado: { label: 'Cancelada por Solicitante', color: '#475569', bg: '#F1F5F9', icon: '🚫' },
};

export const MOTIVOS_CANCELACION_RAPIDOS = [
  { id: 'no_necesita', label: 'Ya no se necesita', icon: '🛠️' },
  { id: 'error_pedir', label: 'Error al pedir / repuesto equivocado', icon: '🔄' },
  { id: 'resuelto_taller', label: 'Se resolvió en taller', icon: '✅' },
  { id: 'duplicado', label: 'Pedido duplicado', icon: '📋' },
] as const;

export interface ParsedRejection {
  rejectedBy: string | null;
  rejectedAt: string | null;
  note: string;
  isCancelled?: boolean;
}

export interface ParsedCancelacion {
  isCancelled: boolean;
  cancelledBy: string | null;
  cancelledAt: string | null;
  note: string;
}

export function formatRejectionNote(quien: string, motivo: string): string {
  const ahora = new Date().toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `[Rechazado por: ${quien.trim()} · ${ahora}]: ${motivo.trim()}`;
}

export function formatCancellationNote(quien: string, motivo?: string | null): string {
  const ahora = new Date().toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const razon = String(motivo ?? '').trim() || 'Cancelada voluntariamente por el solicitante';
  const autor = String(quien ?? '').trim() || 'Solicitante';
  return `[Cancelado por solicitante: ${autor} · ${ahora}]: ${razon}`;
}

export const construirNotaCancelacionStock = formatCancellationNote;
export const construirNotaCancelacionCompra = formatCancellationNote;

export function isCancelledNote(raw?: string | null): boolean {
  if (!raw) return false;
  return /^\[Cancelad[oa](?:\s+por(?:\s+(?:el\s+)?solicitante)?)?:/i.test(raw.trim());
}

export function parseCancelacionNote(raw?: string | null): ParsedCancelacion {
  if (!raw) return { isCancelled: false, cancelledBy: null, cancelledAt: null, note: '' };
  const m = raw.trim().match(/^\[Cancelad[oa](?:\s+por(?:\s+(?:el\s+)?solicitante)?)?:\s*([^·|\]]+)(?:[·|]\s*([^\]]+))?\]\s*(?::\s*)?(.*)$/is);
  if (m) {
    return {
      isCancelled: true,
      cancelledBy: m[1]?.trim() || null,
      cancelledAt: m[2]?.trim() || null,
      note: m[3]?.trim() || 'Cancelada por el solicitante',
    };
  }
  return { isCancelled: false, cancelledBy: null, cancelledAt: null, note: raw.trim() };
}

export function extraerCancelacionCompra(req: any): ParsedCancelacion {
  if (!req) return { isCancelled: false, cancelledBy: null, cancelledAt: null, note: '' };
  const fromDecision = parseCancelacionNote(req.decision_note);
  if (fromDecision.isCancelled) return fromDecision;
  const fromObs = parseCancelacionNote(req.observaciones);
  if (fromObs.isCancelled) return fromObs;
  if (req.status === 'cancelado') {
    return {
      isCancelled: true,
      cancelledBy: req.decided_by_name || req.solicitante_nombre || 'Solicitante',
      cancelledAt: req.decided_at || null,
      note: req.decision_note || 'Cancelada por el solicitante',
    };
  }
  return { isCancelled: false, cancelledBy: null, cancelledAt: null, note: '' };
}

export function parseRejectionNote(raw?: string | null): ParsedRejection {
  if (!raw) return { rejectedBy: null, rejectedAt: null, note: '', isCancelled: false };
  const canc = parseCancelacionNote(raw);
  if (canc.isCancelled) {
    return {
      rejectedBy: canc.cancelledBy,
      rejectedAt: canc.cancelledAt,
      note: canc.note,
      isCancelled: true,
    };
  }
  const m = raw.match(/^\[Rechazado por:\s*([^·|\]]+)(?:[·|]\s*([^\]]+))?\]\s*(?::\s*)?(.*)$/s);
  if (m) {
    return {
      rejectedBy: m[1]?.trim() || null,
      rejectedAt: m[2]?.trim() || null,
      note: m[3]?.trim() || '',
      isCancelled: false,
    };
  }
  return { rejectedBy: null, rejectedAt: null, note: raw.trim(), isCancelled: false };
}

/**
 * Determina si un ítem o grupo de Solicitud de Existencia (Almacén) puede ser cancelado por el usuario actual.
 */
export function puedeCancelarSolicitudStock(
  itemOrGrupo: any,
  uid?: string | null,
  fullName?: string | null,
  esAdmin = false
): { ok: boolean; reason?: string; pendientesCount: number } {
  if (!itemOrGrupo) return { ok: false, reason: 'Solicitud inválida.', pendientesCount: 0 };

  const items = Array.isArray(itemOrGrupo.items) ? itemOrGrupo.items : [itemOrGrupo];
  const pendientes = items.filter((it: any) => it && it.status === 'pendiente' && !it.movement_id);

  if (pendientes.length === 0) {
    const yaDespachado = items.some((it: any) => it && (it.status === 'despachado' || it.movement_id));
    return {
      ok: false,
      reason: yaDespachado
        ? 'Ya fue despachada por Almacén y no puede cancelarse.'
        : 'Esta solicitud ya se encuentra cerrada o cancelada.',
      pendientesCount: 0,
    };
  }

  const normName = (s?: string | null) => String(s ?? '').trim().toLowerCase();
  const fn = normName(fullName);

  const esAutor = items.some((it: any) => {
    if (uid && it?.created_by && it.created_by === uid) return true;
    if (fn && it?.solicitante_nombre && normName(it.solicitante_nombre) === fn) return true;
    return false;
  });

  if (!esAdmin && !esAutor) {
    return {
      ok: false,
      reason: 'Solo la persona que creó la solicitud o un administrador puede cancelarla.',
      pendientesCount: pendientes.length,
    };
  }

  return { ok: true, pendientesCount: pendientes.length };
}

/**
 * Determina si una Solicitud de Compra Técnica (inventory_requirements) puede ser cancelada por el solicitante.
 */
export function puedeCancelarSolicitudCompra(
  req: any,
  uid?: string | null,
  fullName?: string | null,
  esAdmin = false
): { ok: boolean; reason?: string } {
  if (!req) return { ok: false, reason: 'Solicitud inválida.' };

  if (req.status === 'recibido' || req.despacho_estado === 'retirado') {
    return { ok: false, reason: 'El repuesto ya fue recibido en almacén y no puede cancelarse.' };
  }
  if (req.status === 'pagado' || req.status === 'esperando_recepcion' || req.pagado === true || req.factura_numero) {
    return { ok: false, reason: 'La compra ya tiene gestión de pago o factura registrada.' };
  }
  if (req.status === 'aprobado' || req.gerente_aprobado) {
    return { ok: false, reason: 'La solicitud ya fue aprobada para compra. Solicita la anulación a Compras/Gerencia.' };
  }
  if (req.status === 'rechazado' || req.status === 'cancelado') {
    return { ok: false, reason: 'La solicitud ya está cancelada o rechazada.' };
  }

  const normName = (s?: string | null) => String(s ?? '').trim().toLowerCase();
  const fn = normName(fullName);

  const esAutor =
    (Boolean(uid) && req.requested_by === uid) ||
    (Boolean(fn) &&
      (normName(req.solicitante_nombre) === fn || normName(req.requested_by_name) === fn));

  if (!esAdmin && !esAutor) {
    return { ok: false, reason: 'Solo el solicitante que registró el pedido o un administrador puede cancelarlo.' };
  }

  return { ok: true };
}

// ── Agrupación de solicitudes de stock por pedido ──────────────────────────────
export interface GrupoSolicitudStock {
  id: string;
  codigoVisible: string;
  solicitante_nombre: string | null;
  solicitante_employee_id: string | null;
  created_by: string | null;
  created_at: string;
  machinery_id: string | null;
  vehicle_id: string | null;
  area: string | null;
  urgency: 'normal' | 'alta' | 'urgente';
  urgencyMax?: 'normal' | 'alta' | 'urgente';
  items: any[]; // InventoryStockRequest[]
  pendientesCount: number;
  despachadosCount: number;
  rechazadosCount: number;
  canceladosCount?: number;
  todoCanceladoPorUsuario?: boolean;
  statusConsolidado: 'pendiente' | 'parcial' | 'despachado' | 'rechazado';
  // Aliases ergonómicos para pantallas y componentes
  codigoLote: string;
  estadoGrupo: 'pendiente' | 'parcial' | 'despachado' | 'rechazado';
  totalItems: number;
  despachados: number;
  pendientes: number;
  rechazados: number;
  cancelados?: number;
  solicitanteNombre: string;
  fechaCreacion: string;
}

export const ESTADO_GRUPO_CONFIG = {
  pendiente: { label: 'Pendiente en Almacén', color: '#D97706', bg: '#FEF3C7', icon: '⏳' },
  parcial: { label: 'Parcialmente Atendido', color: '#2563EB', bg: '#DBEAFE', icon: '🔄' },
  despachado: { label: 'Totalmente Despachado', color: '#16A34A', bg: '#DCFCE7', icon: '✅' },
  rechazado: { label: 'Rechazado', color: '#DC2626', bg: '#FEE2E2', icon: '❌' },
  cancelado: { label: 'Cancelada por Solicitante', color: '#475569', bg: '#F1F5F9', icon: '🚫' },
};

/**
 * Agrupa una lista plana de filas de `inventory_stock_requests` en solicitudes
 * consolidadas por orden. Detecta tanto etiquetas explícitas [ORDEN: ...] como
 * lotes históricos creados en el mismo minuto por el mismo solicitante y destino.
 */
export function agruparSolicitudesStock(requests: any[]): GrupoSolicitudStock[] {
  if (!requests || requests.length === 0) return [];

  const ordenadas = [...requests].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const grupos: GrupoSolicitudStock[] = [];

  ordenadas.forEach((req) => {
    const matchTag = String(req.reason ?? '').match(/\[(?:ORDEN|LOTE|PEDIDO):\s*([^\]]+)\]/i);
    const tagLote = matchTag ? matchTag[1].trim() : null;

    const reqTime = new Date(req.created_at).getTime();
    const reqDestino = `${req.machinery_id || ''}-${req.vehicle_id || ''}-${(req.area || '').trim().toUpperCase()}`;
    const reqSolicitante = (req.solicitante_nombre || req.created_by || '').trim().toUpperCase();

    const grupoExistente = grupos.find((g) => {
      if (tagLote) {
        return g.id === tagLote;
      }
      const gDestino = `${g.machinery_id || ''}-${g.vehicle_id || ''}-${(g.area || '').trim().toUpperCase()}`;
      const gSolicitante = (g.solicitante_nombre || g.created_by || '').trim().toUpperCase();
      const gTime = new Date(g.created_at).getTime();

      const mismaPersona = gSolicitante === reqSolicitante;
      const mismoDestino = gDestino === reqDestino;
      const mismaVentana = Math.abs(gTime - reqTime) <= 10 * 60 * 1000; // 10 minutos

      return mismaPersona && mismoDestino && mismaVentana;
    });

    if (grupoExistente) {
      grupoExistente.items.push(req);
      if (req.urgency === 'urgente') grupoExistente.urgency = 'urgente';
      else if (req.urgency === 'alta' && grupoExistente.urgency !== 'urgente') grupoExistente.urgency = 'alta';
    } else {
      const nuevoGrupoId = tagLote || req.code || req.id;
      grupos.push({
        id: nuevoGrupoId,
        codigoVisible: req.code,
        codigoLote: req.code,
        solicitante_nombre: req.solicitante_nombre,
        solicitanteNombre: req.solicitante_nombre || 'Personal Taller',
        solicitante_employee_id: req.solicitante_employee_id,
        created_by: req.created_by,
        created_at: req.created_at,
        fechaCreacion: req.created_at,
        machinery_id: req.machinery_id,
        vehicle_id: req.vehicle_id,
        area: req.area,
        urgency: req.urgency,
        urgencyMax: req.urgency,
        items: [req],
        totalItems: 1,
        pendientesCount: 0,
        pendientes: 0,
        despachadosCount: 0,
        despachados: 0,
        rechazadosCount: 0,
        rechazados: 0,
        statusConsolidado: 'pendiente',
        estadoGrupo: 'pendiente',
      });
    }
  });

  grupos.forEach((g) => {
    g.items.sort((a, b) => String(a.code ?? '').localeCompare(String(b.code ?? ''), undefined, { numeric: true }));

    const codigos = g.items.map((it) => it.code).filter(Boolean);
    if (codigos.length > 1) {
      g.codigoVisible = `${codigos[0]} … ${codigos[codigos.length - 1]} (${codigos.length} repuestos)`;
    } else {
      g.codigoVisible = codigos[0] || g.id;
    }
    g.codigoLote = g.codigoVisible;
    g.totalItems = g.items.length;
    g.urgencyMax = g.urgency;
    g.solicitanteNombre = g.solicitante_nombre || 'Personal Taller';
    g.fechaCreacion = g.created_at;

    g.pendientesCount = g.items.filter((it) => it.status === 'pendiente').length;
    g.despachadosCount = g.items.filter((it) => it.status === 'despachado').length;
    g.rechazadosCount = g.items.filter((it) => it.status === 'rechazado').length;
    g.canceladosCount = g.items.filter((it) => it.status === 'rechazado' && isCancelledNote(it.rejection_note)).length;

    g.pendientes = g.pendientesCount;
    g.despachados = g.despachadosCount;
    g.rechazados = g.rechazadosCount;
    g.cancelados = g.canceladosCount;
    g.todoCanceladoPorUsuario = g.pendientesCount === 0 && g.despachadosCount === 0 && g.canceladosCount === g.items.length && g.items.length > 0;

    if (g.pendientesCount === 0 && g.rechazadosCount === 0) {
      g.statusConsolidado = 'despachado';
    } else if (g.pendientesCount === 0 && g.despachadosCount === 0) {
      g.statusConsolidado = 'rechazado';
    } else if (g.despachadosCount > 0 || g.rechazadosCount > 0) {
      g.statusConsolidado = 'parcial';
    } else {
      g.statusConsolidado = 'pendiente';
    }
    g.estadoGrupo = g.statusConsolidado;

    // Limpiar etiquetas de lote en la descripción de cada ítem
    g.items.forEach((it) => {
      const c = String(it.reason ?? '')
        .replace(/\[(?:ORDEN|LOTE|PEDIDO):\s*[^\]]+\]\s*/gi, '')
        .trim();
      it.cleanReason = c || null;
    });
  });

  return grupos;
}

