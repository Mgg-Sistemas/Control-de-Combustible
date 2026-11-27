// 💱 26-nov-2026: tasas publicadas por el BCV (www.bcv.org.ve) en Bs por 1
// unidad de cada moneda. El HTML del BCV usa punto de miles y coma decimal:
// "1.016,86449384" = 1016.86449384 Bs/€. Puro, sin React ni Supabase, para
// poder probarlo en Node.
export const MONEDAS_BCV = ['USD', 'EUR', 'CNY', 'TRY', 'RUB'] as const;
export type MonedaBcv = (typeof MONEDAS_BCV)[number];

export type TasaBcv = {
  moneda: MonedaBcv;
  tasa: number;
  fecha_valor: string | null;
};

/** Convierte el número con formato venezolano del BCV. Nunca inventa: si no es válido, null. */
export function numeroBcv(texto: string | null | undefined): number | null {
  const limpio = String(texto ?? '').trim().replace(/\s+/g, '');
  if (!/^\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^\d+(?:,\d+)?$/.test(limpio)) return null;
  const n = Number(limpio.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const IDS: Record<MonedaBcv, string> = {
  USD: 'dolar', EUR: 'euro', CNY: 'yuan', TRY: 'lira', RUB: 'rublo',
};

/** Fecha "Valor" del BCV (YYYY-MM-DD) sin convertirla con Date: así no se mueve un día. */
export function fechaValorBcv(html: string): string | null {
  const m = html.match(/content="(\d{4}-\d{2}-\d{2})T/);
  return m?.[1] ?? null;
}

/** Lee las 5 tasas del HTML del BCV. Si una falta, se omite; no se rellena a cero. */
export function parsearTasasBcv(html: string): TasaBcv[] {
  const limpio = String(html ?? '').replace(/\s+/g, ' ');
  const fecha = fechaValorBcv(limpio);
  const out: TasaBcv[] = [];
  for (const moneda of MONEDAS_BCV) {
    const re = new RegExp(`id="${IDS[moneda]}"[\\s\\S]*?strong-tb">\\s*([0-9.,]+)\\s*</strong>`);
    const tasa = numeroBcv(limpio.match(re)?.[1]);
    if (tasa != null) out.push({ moneda, tasa, fecha_valor: fecha });
  }
  return out;
}

/** La tasa que manda en requerimientos/mensajes/PDF: la USD del BCV. */
export function tasaUsdDeBcv(tasas: readonly { moneda: string; tasa: number }[]): number | null {
  return tasas.find((t) => t.moneda === 'USD')?.tasa ?? null;
}

/** Texto corto para mostrar las 5 tasas de referencia, con coma decimal. */
export function formatearTasasBcv(tasas: readonly { moneda: string; tasa: number }[]): string {
  return tasas
    .map((t) => `${t.moneda} ${t.tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(' · ');
}

/** 2026-11-27 -> 27/11/2026 (sin pasar por Date, que desplazaría la fecha). */
export function fechaBcvLegible(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}
