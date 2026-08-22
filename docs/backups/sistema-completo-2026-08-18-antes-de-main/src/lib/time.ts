/** Devuelve un texto tipo "hace 3 d 5 h" desde una fecha ISO. */
export function elapsedSince(iso?: string | null): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `hace ${d} d ${h} h`;
  if (h > 0) return `hace ${h} h ${m} min`;
  if (m > 0) return `hace ${m} min`;
  return 'hace instantes';
}
