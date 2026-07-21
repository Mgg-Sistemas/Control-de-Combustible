import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Card } from './ui';
import { supabase } from '../lib/supabase';
import { TruckYardLog } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

const CARACAS_TZ = 'America/Caracas';
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];

/** Fecha (YYYY-MM-DD) de un ISO en horario de Caracas. */
function caracasDate(iso: string): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso)).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
/** Hora (hh:mm a.m./p.m.) de un ISO en horario de Caracas. */
function caracasClock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}
function caracasTodayParts(): { y: number; m: number; d: number } {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

/**
 * Calendario de ENTRADA / SALIDA de camiones al patio. Muestra el mes en cuadrícula;
 * cada día trae cuántos camiones ENTRARON y SALIERON. Al tocar un día se ve el detalle
 * (hora, sentido, camión y quién lo registró). Usado por el Coordinador de Patio y por
 * el administrador (submódulo de Inspecciones).
 */
export default function TruckYardCalendar() {
  const { colors } = useTheme();
  const t = caracasTodayParts();
  const [year, setYear] = useState(t.y);
  const [month, setMonth] = useState(t.m); // 1..12
  const [logs, setLogs] = useState<TruckYardLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selDay, setSelDay] = useState<string | null>(null); // YYYY-MM-DD

  // Carga los registros del mes visible (con margen para zona horaria).
  useEffect(() => {
    let active = true;
    setLoading(true);
    const from = `${year}-${String(month).padStart(2, '0')}-01T00:00:00-04:00`;
    const nextM = month === 12 ? 1 : month + 1;
    const nextY = month === 12 ? year + 1 : year;
    const to = `${nextY}-${String(nextM).padStart(2, '0')}-01T00:00:00-04:00`;
    supabase
      .from('truck_yard_logs')
      .select('*')
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!active) return;
        setLogs((data as TruckYardLog[]) ?? []);
        setLoading(false);
      });
    return () => { active = false; };
  }, [year, month]);

  // Conteo por día: { 'YYYY-MM-DD': { entrada, salida } }.
  const byDay = useMemo(() => {
    const m: Record<string, { entrada: number; salida: number }> = {};
    logs.forEach((l) => {
      const d = caracasDate(l.created_at);
      const cell = m[d] ?? { entrada: 0, salida: 0 };
      if (l.direction === 'entrada') cell.entrada++; else cell.salida++;
      m[d] = cell;
    });
    return m;
  }, [logs]);

  // Estructura de la cuadrícula: primer día de la semana + total de días.
  const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Do
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear((y) => y - 1); } else setMonth((mo) => mo - 1); setSelDay(null); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear((y) => y + 1); } else setMonth((mo) => mo + 1); setSelDay(null); };

  const totMes = useMemo(() => logs.reduce((a, l) => { if (l.direction === 'entrada') a.e++; else a.s++; return a; }, { e: 0, s: 0 }), [logs]);
  const isFuture = year > t.y || (year === t.y && month > t.m);

  const iso = (d: number) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const selLogs = selDay ? logs.filter((l) => caracasDate(l.created_at) === selDay) : [];

  return (
    <>
      <Card>
        {/* Navegación de mes */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={prevMonth} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>◀</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{MESES[month - 1]} {year}</Text>
          <TouchableOpacity onPress={nextMonth} disabled={isFuture} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, opacity: isFuture ? 0.4 : 1 }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>▶</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: spacing.xs }}>
          Este mes: <Text style={{ color: '#15803D', fontWeight: '800' }}>{totMes.e} entradas</Text> · <Text style={{ color: '#B45309', fontWeight: '800' }}>{totMes.s} salidas</Text>
        </Text>

        {/* Cabecera de días */}
        <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
          {DIAS.map((d) => (
            <Text key={d} style={{ flex: 1, textAlign: 'center', color: colors.muted, fontWeight: '700', fontSize: 11 }}>{d}</Text>
          ))}
        </View>

        {loading ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
            {cells.map((d, i) => {
              if (d == null) return <View key={i} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
              const key = iso(d);
              const c = byDay[key];
              const isToday = year === t.y && month === t.m && d === t.d;
              const sel = selDay === key;
              const has = !!c && (c.entrada > 0 || c.salida > 0);
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => setSelDay(sel ? null : key)}
                  activeOpacity={0.7}
                  style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}
                >
                  <View style={{ flex: 1, borderRadius: radius.sm, borderWidth: sel ? 2 : 1, borderColor: sel ? colors.primary : isToday ? colors.primary : colors.border, backgroundColor: has ? colors.surfaceAlt : 'transparent', alignItems: 'center', justifyContent: 'center', padding: 1 }}>
                    <Text style={{ color: isToday ? colors.primary : colors.text, fontWeight: isToday ? '800' : '600', fontSize: 12 }}>{d}</Text>
                    {has ? (
                      <View style={{ alignItems: 'center' }}>
                        {c!.entrada > 0 ? <Text style={{ color: '#15803D', fontSize: 9, fontWeight: '800' }}>↓{c!.entrada}</Text> : null}
                        {c!.salida > 0 ? <Text style={{ color: '#B45309', fontSize: 9, fontWeight: '800' }}>↑{c!.salida}</Text> : null}
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: spacing.xs }}>
          <Text style={{ color: '#15803D', fontWeight: '800' }}>↓ entradas</Text> · <Text style={{ color: '#B45309', fontWeight: '800' }}>↑ salidas</Text> · toca un día para ver el detalle
        </Text>
      </Card>

      {/* Detalle del día seleccionado */}
      {selDay ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>
            🚚 {selDay.split('-').reverse().join('/')} — {selLogs.length} movimiento(s)
          </Text>
          {selLogs.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 13 }}>Sin entradas ni salidas registradas ese día.</Text>
          ) : (
            selLogs.map((l) => (
              <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ fontSize: 18 }}>{l.direction === 'entrada' ? '🟢' : '🟠'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                    {l.direction === 'entrada' ? 'Entrada' : 'Salida'} · {l.machine_code || 'Camión'}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{caracasClock(l.created_at)}{l.logged_by_name ? ` · ${l.logged_by_name}` : ''}</Text>
                </View>
              </View>
            ))
          )}
        </Card>
      ) : null}
    </>
  );
}
