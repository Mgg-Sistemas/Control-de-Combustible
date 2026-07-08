import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert, Platform, Modal } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { exportPdf } from '../lib/pdf';
import { COMPANY_NAME, COMPANY_RIF } from '../lib/company';
import { useConfirm } from '../components/ConfirmProvider';
import { useAuth } from '../context/AuthContext';
import { Machinery, MachineRound, MachineDayOperator, ControlClosure, ClosureMachine } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

type Operator = { first_name: string; last_name: string; cedula: string };

export const ROUND_TIMES = ['07:00', '11:00', '15:00', '19:00'];
export const ROUND_LABELS = ['1ª RONDA', '2ª RONDA', '3ª RONDA', '4ª RONDA'];
/** Horas del turno completo (07:00 → 19:00). Las horas trabajadas = turno − parada. */
export const SHIFT_HOURS = 12;
/** Horas que representa cada ronda (12 h / 4 rondas = 3 h). */
export const HOURS_PER_ROUND = SHIFT_HOURS / 4;
export const workedHours = (hoursStopped: number) => Math.max(0, SHIFT_HOURS - (hoursStopped || 0));

/** Campo de fecha con calendario: en web usa <input type="date">; en nativo, texto. */
function DateField({ value, onChange, colors }: { value: string; onChange: (v: string) => void; colors: any }) {
  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'date',
      value: value || '',
      onChange: (e: any) => onChange(e.target.value),
      style: {
        padding: '9px',
        borderRadius: '10px',
        border: '1px solid ' + colors.border,
        background: colors.surface,
        color: colors.text,
        fontSize: '14px',
        width: '100%',
        boxSizing: 'border-box',
      },
    });
  }
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="AAAA-MM-DD"
      placeholderTextColor={colors.muted}
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
    />
  );
}

function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function shiftDay(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function ControlMaquinariaScreen({ navigation }: any) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const { session } = useAuth();
  const [date, setDate] = useState(todayISO());
  const [machines, setMachines] = useState<Machinery[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({}); // id → nombre
  const [rounds, setRounds] = useState<Record<string, MachineRound>>({}); // key: machineryId-roundNo
  const [operators, setOperators] = useState<Record<string, Operator>>({}); // machineId → operador del día
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [hoursInput, setHoursInput] = useState<Record<string, string>>({}); // texto en edición por máquina
  const [priceFor, setPriceFor] = useState<Machinery | null>(null); // máquina cuyo precio/hora se edita
  const [priceInput, setPriceInput] = useState('');

  // Operador (nombre, apellido, cédula)
  const [opFor, setOpFor] = useState<Machinery | null>(null);
  const [opFirst, setOpFirst] = useState('');
  const [opLast, setOpLast] = useState('');
  const [opCedula, setOpCedula] = useState('');

  // Cierre de control + histórico
  const [closing, setClosing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [closures, setClosures] = useState<ControlClosure[]>([]);
  const [closureSel, setClosureSel] = useState<ControlClosure | null>(null);

  const key = (mId: string, no: number) => `${mId}-${no}`;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [{ data: m }, { data: r }, { data: c }, { data: ops }] = await Promise.all([
      supabase.from('machinery').select('*').order('code', { ascending: true }),
      supabase.from('machine_rounds').select('*').eq('round_date', date),
      supabase.from('companies').select('id, name'),
      supabase.from('machine_day_operators').select('*').eq('round_date', date),
    ]);
    setMachines((m ?? []) as Machinery[]);
    const cmap: Record<string, string> = {};
    (c ?? []).forEach((row: any) => (cmap[row.id] = row.name));
    setCompanies(cmap);
    const map: Record<string, MachineRound> = {};
    (r ?? []).forEach((row: any) => (map[key(row.machinery_id, row.round_no)] = row));
    setRounds(map);
    const omap: Record<string, Operator> = {};
    (ops ?? []).forEach((o: MachineDayOperator) => {
      omap[o.machinery_id] = { first_name: o.first_name ?? '', last_name: o.last_name ?? '', cedula: o.cedula ?? '' };
    });
    setOperators(omap);
    // En recarga silenciosa (tiempo real) no borramos lo que el usuario esté escribiendo.
    if (!silent) setHoursInput({});
    setLoading(false);
  }, [date]);

  useEffect(() => {
    load();
    // Sincronización multiusuario: refresca (silencioso) al cambiar rondas/operadores/máquinas.
    let timer: any;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => load(true), 300); };
    const ch = supabase.channel('rt-control-maquinaria');
    ['machine_rounds', 'machine_day_operators', 'machinery'].forEach((t) =>
      ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: t }, bump)
    );
    ch.subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(ch); };
  }, [load]);

  const setRound = async (m: Machinery, no: number, status: 'operativa' | 'parada') => {
    const existing = rounds[key(m.id, no)];
    const payload: any = {
      machinery_id: m.id,
      round_date: date,
      round_no: no,
      status,
      hours_stopped: existing?.hours_stopped ?? 0,
    };
    const { data, error } = await supabase
      .from('machine_rounds')
      .upsert(payload, { onConflict: 'machinery_id,round_date,round_no' })
      .select()
      .single();
    if (error) return Alert.alert('Aviso', error.message);
    setRounds((p) => ({ ...p, [key(m.id, no)]: data as MachineRound }));
  };

  /** Cicla el estado de la ronda: gris (sin registro) → verde → rojo → gris. */
  const cycleRound = async (m: Machinery, no: number) => {
    const cur = rounds[key(m.id, no)];
    if (cur?.status === 'parada') {
      // Volver a gris: eliminar el registro de la ronda.
      const { error } = await supabase.from('machine_rounds').delete().eq('id', cur.id);
      if (error) return Alert.alert('Aviso', error.message);
      setRounds((p) => {
        const n = { ...p };
        delete n[key(m.id, no)];
        return n;
      });
      return;
    }
    const willBeOperative = cur?.status !== 'operativa';
    await setRound(m, no, cur?.status === 'operativa' ? 'parada' : 'operativa');
    // Al marcar en verde y si aún no hay operador del día, pedir sus datos.
    if (willBeOperative && !operators[m.id]) openOperator(m);
  };

  // ── Operador del día ────────────────────────────────────────────────────────
  const openOperator = (m: Machinery) => {
    const o = operators[m.id];
    setOpFor(m);
    setOpFirst(o?.first_name ?? '');
    setOpLast(o?.last_name ?? '');
    setOpCedula(o?.cedula ?? '');
  };

  const saveOperator = async () => {
    if (!opFor) return;
    const payload = {
      machinery_id: opFor.id,
      round_date: date,
      first_name: opFirst.trim() || null,
      last_name: opLast.trim() || null,
      cedula: opCedula.trim() || null,
    };
    const { error } = await supabase.from('machine_day_operators').upsert(payload, { onConflict: 'machinery_id,round_date' });
    if (error) return Alert.alert('Aviso', error.message);
    setOperators((p) => ({ ...p, [opFor.id]: { first_name: opFirst.trim(), last_name: opLast.trim(), cedula: opCedula.trim() } }));
    setOpFor(null);
  };

  // ── Cerrar control del día → guardar snapshot en el histórico ────────────────
  const buildSnapshot = (): ClosureMachine[] => {
    return machines
      .map((m) => {
        const statuses = [1, 2, 3, 4].map((no) => rounds[key(m.id, no)]?.status ?? null);
        const hasActivity = statuses.some((s) => s != null);
        if (!hasActivity) return null;
        const hoursStopped = rounds[key(m.id, 1)]?.hours_stopped ?? 0;
        const op = operators[m.id];
        return {
          code: m.code,
          company: m.company_id ? companies[m.company_id] ?? '' : 'Sin empresa',
          operator: op ? `${op.first_name} ${op.last_name}`.trim() : '',
          cedula: op?.cedula ?? '',
          statuses,
          hoursStopped: Number(hoursStopped),
          worked: workedHours(Number(hoursStopped)),
        } as ClosureMachine;
      })
      .filter(Boolean) as ClosureMachine[];
  };

  const cerrarControl = async () => {
    const snapshot = buildSnapshot();
    if (snapshot.length === 0) {
      setNotice('No hay máquinas con rondas marcadas hoy para cerrar.');
      return;
    }
    const ok = await confirm({
      title: 'Cerrar control',
      message: `¿Cerrar el control del ${date}? Se guardará en el histórico con ${snapshot.length} máquina(s) y sus operadores.`,
      confirmText: 'Cerrar y guardar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    setClosing(true);
    const { error } = await supabase.from('control_closures').insert({
      closure_date: date,
      closed_by: session?.user?.id ?? null,
      detail: { machines: snapshot, totalMachines: snapshot.length },
    });
    setClosing(false);
    if (error) return Alert.alert('Aviso', error.message);
    setNotice(`✅ Control del ${date} cerrado y guardado en el histórico.`);
  };

  const openHistorico = async () => {
    setHistOpen(true);
    const { data } = await supabase.from('control_closures').select('*').order('closure_date', { ascending: false }).limit(200);
    setClosures((data ?? []) as ControlClosure[]);
  };

  const cellTxt = (s: string | null) => (s === 'operativa' ? '✓' : s === 'parada' ? '✕' : '—');

  const downloadClosurePdf = async (c: ControlClosure) => {
    const machs = c.detail?.machines ?? [];
    const rows = machs
      .map(
        (m) =>
          `<tr><td>${m.code}</td><td>${m.company || '—'}</td><td>${m.operator || '—'}</td><td>${m.cedula || '—'}</td>` +
          m.statuses.map((s) => `<td style="text-align:center">${cellTxt(s)}</td>`).join('') +
          `<td style="text-align:center">${m.hoursStopped ? m.hoursStopped.toLocaleString() : '—'}</td><td style="text-align:center;font-weight:700">${m.worked} h</td></tr>`
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"/>
      <style>
        *{box-sizing:border-box}
        body{font-family:Tahoma,Geneva,Verdana,sans-serif;color:#222;padding:26px}
        h1{color:#1E3A5F;margin:0 0 2px;font-size:20px}
        .muted{color:#666;font-size:12px}
        table{width:100%;border-collapse:collapse;margin-top:14px;font-size:11px}
        th,td{border:1px solid #ccc;padding:5px 6px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        .foot{margin-top:18px;color:#888;font-size:10px;border-top:1px solid #ccc;padding-top:6px}
      </style></head><body>
      <h1>CONTROL DE MAQUINARIA</h1>
      <div class="muted">Cierre del ${c.closure_date} · ${machs.length} máquina(s)</div>
      <table><thead><tr><th>Máquina</th><th>Empresa</th><th>Operador</th><th>Cédula</th>
        ${ROUND_LABELS.map((l, i) => `<th>${l}<br/>${ROUND_TIMES[i]}</th>`).join('')}
        <th>H. PARADA</th><th>H. TRAB.</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10" style="text-align:center">Sin datos</td></tr>'}</tbody></table>
      <p class="muted" style="margin-top:8px">✓ Operativa · ✕ Parada · — Sin registro</p>
      <div class="foot">${COMPANY_NAME} · RIF ${COMPANY_RIF} · Documento generado por el sistema de control interno</div>
      </body></html>`;
    await exportPdf(html);
  };

  const setMoveDate = async (m: Machinery, field: 'entry_date' | 'exit_date', value: string | null) => {
    const { error } = await supabase.from('machinery').update({ [field]: value }).eq('id', m.id);
    if (error) return Alert.alert('Aviso', error.message);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? ({ ...x, [field]: value } as Machinery) : x)));
  };

  const openPrice = (m: Machinery) => {
    setPriceFor(m);
    setPriceInput(m.price_per_hour != null ? String(m.price_per_hour) : '');
  };

  const savePrice = async (m: Machinery, value: string) => {
    const n = Number(value.replace(',', '.'));
    const val = value.trim() === '' ? null : isFinite(n) && n >= 0 ? n : null;
    const { error } = await supabase.from('machinery').update({ price_per_hour: val }).eq('id', m.id);
    if (error) return Alert.alert('Aviso', error.message);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? ({ ...x, price_per_hour: val } as Machinery) : x)));
    setPriceFor(null);
  };

  const setHours = async (m: Machinery, hours: string) => {
    const h = Number(hours.replace(',', '.')) || 0;
    // Guarda las horas de parada en la 1ª ronda del día (registro base).
    const existing = rounds[key(m.id, 1)];
    const payload: any = {
      machinery_id: m.id,
      round_date: date,
      round_no: 1,
      status: existing?.status ?? 'operativa',
      hours_stopped: h,
    };
    const { data, error } = await supabase
      .from('machine_rounds')
      .upsert(payload, { onConflict: 'machinery_id,round_date,round_no' })
      .select()
      .single();
    if (error) return Alert.alert('Aviso', error.message);
    setRounds((p) => ({ ...p, [key(m.id, 1)]: data as MachineRound }));
  };

  const q = query.trim().toLowerCase();
  const shown = !q
    ? machines
    : machines.filter(
        (m) =>
          m.code.toLowerCase().includes(q) ||
          (m.serial ?? '').toLowerCase().includes(q) ||
          (m.company_id ? (companies[m.company_id] ?? '').toLowerCase().includes(q) : false),
      );

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Control de maquinaria</SectionTitle>

      {notice ? (
        <TouchableOpacity onPress={() => setNotice(null)}>
          <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{notice}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Toca para cerrar</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        <TouchableOpacity
          onPress={cerrarControl}
          disabled={closing}
          style={{ flex: 2, paddingVertical: spacing.md, backgroundColor: colors.danger, borderRadius: radius.md, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '800' }}>{closing ? 'Cerrando…' : '🔒 Cerrar control'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={openHistorico}
          style={{ flex: 1, paddingVertical: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>🗂️ Histórico</Text>
        </TouchableOpacity>
      </View>

      <Card>
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 2 }}>Día del control</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TouchableOpacity
            onPress={() => setDate(shiftDay(date, -1))}
            style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>◀</Text>
          </TouchableOpacity>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="AAAA-MM-DD"
            placeholderTextColor={colors.muted}
            style={{ flex: 1, minWidth: 0, textAlign: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontWeight: '700' }}
          />
          <TouchableOpacity
            onPress={() => setDate(shiftDay(date, 1))}
            style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>▶</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <TouchableOpacity
            onPress={() => setDate(todayISO())}
            style={{ flex: 1, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700' }}>📅 Hoy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation?.navigate('More', { screen: 'Reports', params: { autoReport: 'rounds', date, nonce: Date.now() } })}
            style={{ flex: 1, paddingVertical: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center' }}
          >
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>📊 Ver reporte</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
          Cada máquina tiene sus 4 rondas. Toca una vez = ✓ operativa (verde), otra = ✕ parada (rojo), otra = gris (sin registro).
        </Text>
      </Card>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔎 Buscar por nombre, serial o empresa…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title={query ? 'Sin resultados' : 'Sin maquinaria'} subtitle={query ? 'Prueba con otra búsqueda.' : 'Agrega máquinas en Equipos.'} />
      ) : (
        shown.map((m) => {
          const hours = rounds[key(m.id, 1)]?.hours_stopped ?? 0;
          return (
            <Card key={m.id}>
              <TouchableOpacity activeOpacity={0.6} onPress={() => openPrice(m)}>
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>
                  {m.code} <Text style={{ color: colors.primary, fontSize: 13 }}>✎</Text>
                </Text>
                <Text style={{ color: m.company_id ? colors.primary : colors.muted, fontSize: 13, fontWeight: '600' }}>
                  🏢 {m.company_id ? (companies[m.company_id] ?? 'Empresa') : 'Sin empresa'}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  💵 {m.price_per_hour != null ? `$${Number(m.price_per_hour).toLocaleString()} / hora · toca para editar` : 'Sin precio · toca el nombre para fijarlo'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => openOperator(m)} activeOpacity={0.6} style={{ marginBottom: spacing.xs }}>
                {operators[m.id] && (operators[m.id].first_name || operators[m.id].last_name || operators[m.id].cedula) ? (
                  <Text style={{ color: colors.text, fontSize: 12 }}>
                    👷 {`${operators[m.id].first_name} ${operators[m.id].last_name}`.trim()}
                    {operators[m.id].cedula ? ` · C.I ${operators[m.id].cedula}` : ''} <Text style={{ color: colors.primary }}>✎</Text>
                  </Text>
                ) : (
                  <Text style={{ color: colors.warning, fontSize: 12 }}>👷 Sin operador · toca para agregar</Text>
                )}
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {ROUND_TIMES.map((time, i) => {
                  const no = i + 1;
                  const r = rounds[key(m.id, no)];
                  const st = r?.status;
                  const bg = st === 'operativa' ? colors.success : st === 'parada' ? colors.danger : colors.surfaceAlt;
                  const fg = st ? '#fff' : colors.text;
                  return (
                    <TouchableOpacity
                      key={no}
                      onPress={() => cycleRound(m, no)}
                      style={{
                        flexGrow: 1,
                        flexBasis: 70,
                        minHeight: 56,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: st ? bg : colors.border,
                        backgroundColor: bg,
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingVertical: spacing.xs,
                      }}
                    >
                      <Text style={{ color: fg, fontWeight: '700', fontSize: 11 }}>{ROUND_LABELS[i]}</Text>
                      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{time}</Text>
                      <Text style={{ color: fg, fontSize: 10 }}>{st === 'operativa' ? '✓ Oper.' : st === 'parada' ? '✕ Parada' : '—'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Entrada / Salida (con calendario, solo si se tildan) */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                {(['entry_date', 'exit_date'] as const).map((field) => {
                  const label = field === 'entry_date' ? '📥 ENTRADA' : '📤 SALIDA';
                  const val = (m as any)[field] as string | null;
                  const active = !!val;
                  return (
                    <View key={field} style={{ flex: 1 }}>
                      <TouchableOpacity
                        onPress={() => setMoveDate(m, field, active ? null : date)}
                        style={{ paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surfaceAlt, alignItems: 'center' }}
                      >
                        <Text style={{ color: active ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>
                          {active ? '✓ ' : ''}{label}
                        </Text>
                      </TouchableOpacity>
                      {active ? (
                        <View style={{ marginTop: 4 }}>
                          <DateField value={val ?? ''} onChange={(v) => setMoveDate(m, field, v || null)} colors={colors} />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 13, flex: 1 }}>Horas parada</Text>
                <TextInput
                  value={hoursInput[m.id] !== undefined ? hoursInput[m.id] : hours ? String(hours) : ''}
                  onChangeText={(t) => setHoursInput((p) => ({ ...p, [m.id]: t }))}
                  onBlur={() => hoursInput[m.id] !== undefined && setHours(m, hoursInput[m.id])}
                  onSubmitEditing={() => hoursInput[m.id] !== undefined && setHours(m, hoursInput[m.id])}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  style={{ width: 90, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, textAlign: 'right' }}
                />
              </View>
              <View style={{ marginTop: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    Turno {SHIFT_HOURS}h − parada {hours || 0}h (≈ {(Number(hours) / HOURS_PER_ROUND).toFixed(1)} rondas)
                  </Text>
                  <Text style={{ color: workedHours(hours) === 0 ? colors.danger : colors.success, fontWeight: '700', fontSize: 13 }}>
                    Trabajadas: {workedHours(hours)} h
                  </Text>
                </View>
                {/* Barra: rojo = parada, verde = trabajadas (descontado del turno) */}
                <View style={{ flexDirection: 'row', height: 8, borderRadius: radius.pill, overflow: 'hidden', marginTop: 4, backgroundColor: colors.surfaceAlt }}>
                  <View style={{ flex: Math.min(SHIFT_HOURS, Number(hours) || 0), backgroundColor: colors.danger }} />
                  <View style={{ flex: workedHours(hours), backgroundColor: colors.success }} />
                </View>
              </View>
            </Card>
          );
        })
      )}

      {/* Modal: precio por hora trabajada → total */}
      <Modal visible={!!priceFor} transparent animationType="fade" onRequestClose={() => setPriceFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
            {priceFor ? (() => {
              const wh = workedHours(rounds[key(priceFor.id, 1)]?.hours_stopped ?? 0);
              const price = Number(priceInput.replace(',', '.')) || 0;
              const total = price * wh;
              return (
                <>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: 2 }}>{priceFor.code}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.md }}>
                    Precio por hora trabajada · {date}
                  </Text>

                  <Text style={{ color: colors.muted, fontSize: 12 }}>Precio por hora ($)</Text>
                  <TextInput
                    value={priceInput}
                    onChangeText={setPriceInput}
                    keyboardType="numeric"
                    placeholder="0.00"
                    placeholderTextColor={colors.muted}
                    autoFocus
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, fontSize: 16, marginTop: 4 }}
                  />

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Horas trabajadas hoy</Text>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{wh} h</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>Total del día</Text>
                    <Text style={{ color: colors.success, fontWeight: '800', fontSize: 18 }}>${total.toLocaleString()}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                    El precio se guarda por máquina; en Control de pagos se multiplica por las horas trabajadas de cada semana.
                  </Text>

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                    <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setPriceFor(null)}>
                      <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={() => savePrice(priceFor, priceInput)}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Guardar precio</Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })() : null}
          </View>
        </View>
      </Modal>

      {/* Modal: datos del operador (nombre, apellido, cédula) */}
      <Modal visible={!!opFor} transparent animationType="fade" onRequestClose={() => setOpFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>Operador</Text>
            {opFor ? <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.md }}>{opFor.code} · {date}</Text> : null}

            <Text style={{ color: colors.muted, fontSize: 12 }}>Nombre</Text>
            <TextInput value={opFirst} onChangeText={setOpFirst} placeholder="Nombre" placeholderTextColor={colors.muted} autoCapitalize="words"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, marginTop: 4, marginBottom: spacing.sm }} />
            <Text style={{ color: colors.muted, fontSize: 12 }}>Apellido</Text>
            <TextInput value={opLast} onChangeText={setOpLast} placeholder="Apellido" placeholderTextColor={colors.muted} autoCapitalize="words"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, marginTop: 4, marginBottom: spacing.sm }} />
            <Text style={{ color: colors.muted, fontSize: 12 }}>Cédula</Text>
            <TextInput value={opCedula} onChangeText={setOpCedula} placeholder="C.I" placeholderTextColor={colors.muted} keyboardType="numeric"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, marginTop: 4 }} />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setOpFor(null)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={saveOperator}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Histórico de cierres */}
      <Modal visible={histOpen} animationType="slide" onRequestClose={() => setHistOpen(false)}>
        <Screen>
          <SectionTitle>Histórico de controles</SectionTitle>
          {closures.length === 0 ? (
            <EmptyState title="Sin cierres" subtitle="Cierra un control del día y aparecerá aquí para reportarlo." />
          ) : (
            closures.map((c) => (
              <TouchableOpacity key={c.id} activeOpacity={0.7} onPress={() => setClosureSel(c)}>
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>📅 {c.closure_date}</Text>
                    <Text style={{ color: colors.primary, fontWeight: '800' }}>{c.detail?.totalMachines ?? 0} máq.</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Toca para ver e imprimir el reporte</Text>
                </Card>
              </TouchableOpacity>
            ))
          )}
          <TouchableOpacity style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={() => setHistOpen(false)}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Cerrar</Text>
          </TouchableOpacity>
        </Screen>
      </Modal>

      {/* Vista previa de un cierre + PDF */}
      <Modal visible={!!closureSel} animationType="slide" onRequestClose={() => setClosureSel(null)}>
        <Screen>
          {closureSel ? (
            <>
              <SectionTitle>Control del {closureSel.closure_date}</SectionTitle>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
                {closureSel.detail?.totalMachines ?? 0} máquina(s) · ✓ operativa · ✕ parada · — sin registro
              </Text>
              {(closureSel.detail?.machines ?? []).map((m, i) => (
                <Card key={i}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{m.code}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 {m.company || 'Sin empresa'}</Text>
                  <Text style={{ color: colors.text, fontSize: 12, marginTop: 2 }}>
                    👷 {m.operator || 'Sin operador'}{m.cedula ? ` · C.I ${m.cedula}` : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' }}>
                    {m.statuses.map((s, j) => (
                      <Text key={j} style={{ color: s === 'operativa' ? colors.success : s === 'parada' ? colors.danger : colors.muted, fontSize: 12, fontWeight: '700' }}>
                        {ROUND_LABELS[j]}: {cellTxt(s)}
                      </Text>
                    ))}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                    Parada {m.hoursStopped} h · Trabajadas {m.worked} h
                  </Text>
                </Card>
              ))}
              <TouchableOpacity style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={() => downloadClosurePdf(closureSel)}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>⬇️ Descargar PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setClosureSel(null)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </Screen>
      </Modal>
    </Screen>
  );
}
