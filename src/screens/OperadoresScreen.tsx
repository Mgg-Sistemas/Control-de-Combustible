import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase, selectAllRows } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const SHIFT_LBL: Record<string, string> = { day: '☀️ Día', night: '🌙 Noche' };

/** ISO (AAAA-MM-DD) en horario de Caracas del momento `d`. */
function caracasISO(d: Date): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).reduce((a: any, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
/** Suma días a una fecha ISO (AAAA-MM-DD) en UTC y devuelve ISO. */
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
/** Domingo de la semana que contiene a `iso` (semanas domingo→sábado). */
function weekStart(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return addDays(iso, -dt.getUTCDay());
}
function fmtDMY(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso || '';
}
function dayName(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

type Asg = {
  id: string;
  first_name: string; last_name: string; cedula: string;
  machinery_id: string; company_name: string | null;
  work_date: string; shift: string | null;
  worked_hours: number | null; horometro_inicial: number | null; horometro_final: number | null;
  code: string; plate: string | null; serial: string | null;
};
type OperatorGroup = { cedula: string; name: string; rows: Asg[] };

/**
 * OPERADORES: operadores que iniciaron jornada (al escanear el QR), por semana.
 * Buscable por nombre/cédula. Muestra la máquina asignada cada día y su empresa.
 * Un operador puede tener varias máquinas en la semana, pero solo 1 por día.
 */
export default function OperadoresScreen() {
  const { colors } = useTheme();
  const { canSee } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Asg[]>([]);
  const [q, setQ] = useState('');
  const [ws, setWs] = useState<string>(() => weekStart(caracasISO(new Date())));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}); // cédula → desplegado

  const weekEnd = addDays(ws, 6);

  const load = async () => {
    setLoading(true);
    try {
      const data = await selectAllRows(
        'operator_assignments',
        'id, first_name, last_name, cedula, machinery_id, company_name, work_date, shift, worked_hours, horometro_inicial, horometro_final, machinery:machinery_id(code, plate, serial)',
        (query) => query.gte('work_date', ws).lte('work_date', weekEnd),
      );
      const mapped: Asg[] = (data ?? []).map((r: any) => ({
        id: r.id, first_name: r.first_name, last_name: r.last_name, cedula: r.cedula,
        machinery_id: r.machinery_id, company_name: r.company_name, work_date: r.work_date,
        shift: r.shift, worked_hours: r.worked_hours, horometro_inicial: r.horometro_inicial,
        horometro_final: r.horometro_final, code: r.machinery?.code ?? '—',
        plate: r.machinery?.plate ?? null, serial: r.machinery?.serial ?? null,
      }));
      setRows(mapped);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ws]);

  const groups = useMemo<OperatorGroup[]>(() => {
    const term = q.trim().toLowerCase();
    const byCedula = new Map<string, OperatorGroup>();
    rows.forEach((r) => {
      const name = `${r.first_name} ${r.last_name}`.trim();
      const g = byCedula.get(r.cedula) ?? { cedula: r.cedula, name, rows: [] };
      g.rows.push(r);
      byCedula.set(r.cedula, g);
    });
    let list = [...byCedula.values()];
    if (term) list = list.filter((g) => g.name.toLowerCase().includes(term) || g.cedula.toLowerCase().includes(term));
    list.forEach((g) => g.rows.sort((a, b) => a.work_date.localeCompare(b.work_date)));
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, q]);

  const shiftWeek = (delta: number) => setWs(addDays(ws, delta * 7));

  const downloadPdf = async () => {
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const blocks = groups
      .map((g) => {
        const trs = g.rows
          .map(
            (r) =>
              `<tr><td>${esc(dayName(r.work_date))} ${esc(fmtDMY(r.work_date))}</td><td>${esc(r.code)}</td><td>${esc(r.plate || r.serial || '—')}</td><td>${esc(r.company_name || '—')}</td><td>${esc(r.shift ? (SHIFT_LBL[r.shift] || r.shift) : '—')}</td><td style="text-align:right">${r.horometro_inicial ?? '—'}</td><td style="text-align:right">${r.horometro_final ?? '—'}</td><td style="text-align:right;font-weight:700">${r.worked_hours != null ? r.worked_hours + ' h' : '—'}</td></tr>`,
          )
          .join('');
        const maquinas = new Set(g.rows.map((r) => r.code)).size;
        const horas = Math.round(g.rows.reduce((s, r) => s + (Number(r.worked_hours) || 0), 0) * 100) / 100;
        return `<h3 class="op">👷 ${esc(g.name)} <span class="ci">· C.I ${esc(g.cedula)}</span> <span class="mm">— ${maquinas} máquina(s) · ${g.rows.length} jornada(s)</span></h3>
          <table><thead><tr><th>Día</th><th>Máquina</th><th>Placa/Serial</th><th>Empresa</th><th>Jornada</th><th style="text-align:right">HI</th><th style="text-align:right">HF</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>${trs}</tbody>
          <tfoot><tr><td colspan="7" style="text-align:right;font-weight:800">TOTAL HORAS SEMANA</td><td style="text-align:right;font-weight:800">${horas} h</td></tr></tfoot></table>`;
      })
      .join('');
    const html = pdfDocument({
      title: 'Operadores por semana',
      subtitle: `Semana del ${fmtDMY(ws)} al ${fmtDMY(weekEnd)} · ${groups.length} operador(es)`,
      extraCss: `
        h3.op{font-size:13px;color:#1E3A5F;margin:14px 0 4px}
        h3.op .ci{color:#666;font-weight:400}
        h3.op .mm{color:#888;font-weight:400;font-size:12px}
        table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:6px}
        th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}
        th{background:#1E3A5F;color:#fff}`,
      body: blocks || '<p style="color:#666">Sin operadores en esta semana.</p>',
    });
    await exportPdf(html, 'Operadores - Reporte semanal');
  };

  if (!canSee('operadores')) {
    return (
      <Screen>
        <SectionTitle>Operadores</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }

  const totalOps = groups.length;
  const totalMach = new Set(rows.map((r) => r.machinery_id)).size;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Operadores</SectionTitle>

      {/* Selector de semana */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={() => shiftWeek(-1)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>◀</Text>
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>Semana</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>del {fmtDMY(ws)} al {fmtDMY(weekEnd)}</Text>
          </View>
          <TouchableOpacity onPress={() => shiftWeek(1)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>▶</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{totalOps} operador(es) · {totalMach} máquina(s)</Text>
          <TouchableOpacity onPress={() => setWs(weekStart(caracasISO(new Date())))}>
            <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Semana actual</Text>
          </TouchableOpacity>
        </View>
      </Card>

      {/* Buscador */}
      <TextInput
        value={q} onChangeText={setQ} placeholder="Buscar por nombre o cédula…" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      <TouchableOpacity onPress={downloadPdf} style={{ padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, marginBottom: spacing.sm }}>
        <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>⬇️ Descargar reporte (PDF)</Text>
      </TouchableOpacity>

      {loading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <EmptyState title="Sin operadores" subtitle="Aquí aparecerán los operadores que inicien jornada al escanear el QR de una máquina." />
      ) : (
        groups.map((g) => {
          const maquinas = new Set(g.rows.map((r) => r.code)).size;
          const horas = g.rows.reduce((s, r) => s + (Number(r.worked_hours) || 0), 0);
          const open = expanded[g.cedula] ?? false;
          return (
            <Card key={g.cedula}>
              {/* Cabecera: toca para desplegar el detalle del operador. */}
              <TouchableOpacity activeOpacity={0.7} onPress={() => setExpanded((p) => ({ ...p, [g.cedula]: !open }))}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>👷 {g.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>C.I {g.cedula}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{maquinas} máquina(s) · {g.rows.length} jornada(s)</Text>
                  <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '800' }}>Total semana: {Math.round(horas * 100) / 100} h {open ? '▴' : '▾'}</Text>
                </View>
              </TouchableOpacity>

              {open ? g.rows.map((r) => (
                <View key={r.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 6, marginTop: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 }}>{dayName(r.work_date)} {fmtDMY(r.work_date)}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{r.shift ? (SHIFT_LBL[r.shift] || r.shift) : ''}</Text>
                  </View>
                  <Text style={{ color: colors.text, fontSize: 13 }}>🚜 {r.code} <Text style={{ color: colors.muted }}>· {r.company_name || 'Sin empresa'}</Text></Text>
                  {r.plate || r.serial ? (
                    <Text style={{ color: colors.muted, fontSize: 11 }}>🔖 {r.plate ? `Placa: ${r.plate}` : ''}{r.plate && r.serial ? ' · ' : ''}{r.serial ? `Serial: ${r.serial}` : ''}</Text>
                  ) : null}
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    🕒 Horómetro: {r.horometro_inicial ?? '—'} → {r.horometro_final ?? '—'} · <Text style={{ color: colors.success, fontWeight: '700' }}>Total: {r.worked_hours != null ? `${r.worked_hours} h` : '—'}</Text>
                  </Text>
                </View>
              )) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
