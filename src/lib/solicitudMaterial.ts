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
};

export const ESTADO_COMPRA_CONFIG = {
  pendiente: { label: 'En revisión de Compras', color: '#2563EB', bg: '#DBEAFE', icon: '🛒' },
  aclaratoria_solicitada: { label: '⚠️ Requiere Aclaratoria Técnica', color: '#EA580C', bg: '#FFEDD5', icon: '⚠️' },
  aprobado: { label: 'Aprobado para Compra', color: '#059669', bg: '#D1FAE5', icon: '✅' },
  recibido: { label: 'Recibido en Almacén', color: '#16A34A', bg: '#DCFCE7', icon: '📦' },
  rechazado: { label: 'Rechazado', color: '#DC2626', bg: '#FEE2E2', icon: '❌' },
};

export interface ParsedRejection {
  rejectedBy: string | null;
  rejectedAt: string | null;
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

export function parseRejectionNote(raw?: string | null): ParsedRejection {
  if (!raw) return { rejectedBy: null, rejectedAt: null, note: '' };
  const m = raw.match(/^\[Rechazado por:\s*([^·|\]]+)(?:[·|]\s*([^\]]+))?\]\s*(?::\s*)?(.*)$/s);
  if (m) {
    return {
      rejectedBy: m[1]?.trim() || null,
      rejectedAt: m[2]?.trim() || null,
      note: m[3]?.trim() || '',
    };
  }
  return { rejectedBy: null, rejectedAt: null, note: raw.trim() };
}
