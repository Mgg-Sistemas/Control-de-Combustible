// Tasa del BCV (Bs/US$) para mostrar los precios del inventario en $ y en Bs.
// Fuente automática: ve.dolarapi.com (dólar oficial/BCV). La tasa del día se guarda
// en la tabla `bcv_rates` (una fila por día, compartida por toda la app, con
// histórico) y se puede AJUSTAR A MANO si el servicio falla o se quiere fijar otra.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { caracasParts } from './jornada';

export type BcvRate = { rate_date: string; rate: number; source: string | null; created_at?: string };

const OFICIAL_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';

/** Fecha de HOY (Caracas) en ISO 'YYYY-MM-DD'. */
export const todayIsoVE = () => caracasParts(new Date()).iso;

/** Trae la tasa oficial (BCV) desde el API. Lanza si no se puede leer. */
export async function fetchOfficialRate(): Promise<number> {
  const res = await fetch(OFICIAL_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`BCV API HTTP ${res.status}`);
  const j: any = await res.json();
  const rate = Number(j?.promedio ?? j?.venta ?? j?.compra);
  if (!isFinite(rate) || rate <= 0) throw new Error('Respuesta del BCV inválida');
  return Math.round(rate * 100) / 100;
}

/** Última tasa guardada (la más reciente), o null si no hay ninguna. */
export async function lastStoredRate(): Promise<BcvRate | null> {
  const { data } = await supabase.from('bcv_rates').select('rate_date, rate, source').order('rate_date', { ascending: false }).limit(1);
  return (data && data[0]) ? (data[0] as BcvRate) : null;
}

/** Guarda (o pisa) la tasa de una fecha. */
export async function upsertRate(rate_date: string, rate: number, source: string): Promise<void> {
  await supabase.from('bcv_rates').upsert({ rate_date, rate, source }, { onConflict: 'rate_date' });
}

/** Asegura la tasa de HOY: si ya está guardada la devuelve; si no, la baja del BCV
 *  y la guarda. Si el API falla, cae a la última tasa conocida. */
export async function ensureTodayRate(): Promise<BcvRate | null> {
  const today = todayIsoVE();
  const { data } = await supabase.from('bcv_rates').select('rate_date, rate, source').eq('rate_date', today).limit(1);
  if (data && data[0]) return data[0] as BcvRate;
  try {
    const rate = await fetchOfficialRate();
    await upsertRate(today, rate, 'BCV');
    return { rate_date: today, rate, source: 'BCV' };
  } catch {
    return await lastStoredRate(); // sin conexión: usa la última conocida
  }
}

// ── Conversión y formato ─────────────────────────────────────────────────────
export const bsFromUsd = (usd: number, rate: number) => (Number(usd) || 0) * (Number(rate) || 0);
export const usdFromBs = (bs: number, rate: number) => ((Number(rate) || 0) > 0 ? (Number(bs) || 0) / rate : 0);
export const fmtUsd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtBs = (n: number) => `Bs ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Hook: tasa del día (auto) con opción de refrescar y de fijarla a mano. */
export function useBcvRate() {
  const [rate, setRate] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    ensureTodayRate().then((r) => { if (!alive) return; if (r) { setRate(Number(r.rate)); setDate(r.rate_date); setSource(r.source); } setLoading(false); });
    return () => { alive = false; };
  }, []);

  /** Vuelve a bajar la tasa oficial del BCV para HOY y la guarda. */
  const refresh = async () => {
    setLoading(true);
    try {
      const today = todayIsoVE();
      const r = await fetchOfficialRate();
      await upsertRate(today, r, 'BCV');
      setRate(r); setDate(today); setSource('BCV');
    } finally { setLoading(false); }
  };

  /** Fija la tasa de HOY a mano (source = manual). */
  const setManual = async (value: number) => {
    const today = todayIsoVE();
    await upsertRate(today, value, 'manual');
    setRate(value); setDate(today); setSource('manual');
  };

  return { rate, date, source, loading, refresh, setManual };
}
