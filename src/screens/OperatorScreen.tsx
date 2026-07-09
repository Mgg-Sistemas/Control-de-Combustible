import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { useAuth } from '../context/AuthContext';
import { supabase, selectAllRows } from '../lib/supabase';
import { Machinery } from '../types/database';
import { upsertMachineRound, getMachineRound } from '../lib/machineRounds';
import { insertMachineDispatch } from '../lib/dispatches';
import { SHIFT_OPTS, workedFromShifts } from './ControlMaquinariaScreen';
import QrScanner from '../components/QrScanner';
import { parseMachineId } from './ScanQrScreen';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

/** Fecha local de hoy en "AAAA-MM-DD". */
function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
const numOrNull = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) && s.trim() !== '' ? n : null; };

/**
 * Vista del OPERADOR: su propia pantalla (independiente de la administración).
 * Ve su máquina asignada (puede cambiarla) y registra su jornada y el combustible.
 * Todo guarda en las mismas tablas del sistema (machine_rounds, dispatches).
 */
export default function OperatorScreen() {
  const { colors } = useTheme();
  const { session, signOut } = useAuth();
  const uid = session?.user?.id ?? '';

  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState<(Machinery & { companyName?: string })[]>([]);
  const [sel, setSel] = useState<(Machinery & { companyName?: string }) | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [tanks, setTanks] = useState<{ id: string; name: string; fuel: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // ── Jornada ────────────────────────────────────────────────────────────────
  const [date, setDate] = useState(todayISO());
  const [dayH, setDayH] = useState(0);
  const [nightH, setNightH] = useState(0);
  const [stopped, setStopped] = useState('');
  const [overtime, setOvertime] = useState('');
  const [savingRound, setSavingRound] = useState(false);

  // ── Combustible ──────────────────────────────────────────────────────────────
  const [fDate, setFDate] = useState(todayISO());
  const [fLiters, setFLiters] = useState('');
  const [fTank, setFTank] = useState('');
  const [fKmIda, setFKmIda] = useState('');
  const [fKmVuelta, setFKmVuelta] = useState('');
  const [fStart, setFStart] = useState('');
  const [fEnd, setFEnd] = useState('');
  const [savingFuel, setSavingFuel] = useState(false);

  // Carga inicial: perfil, máquinas (asignadas primero) y tanques.
  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    (async () => {
      const [{ data: prof }, mach, { data: tk }] = await Promise.all([
        supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle(),
        selectAllRows('machinery', 'id, code, tipo, referencia, daily_consumption_l, operator_id, company:company_id(name)'),
        supabase.from('tanks').select('id, name, fuel').eq('active', true).order('name'),
      ]);
      setFullName((prof as any)?.full_name ?? '');
      const list = ((mach ?? []) as any[]).map((m) => ({ ...m, companyName: m.company?.name ?? 'Sin empresa' })) as (Machinery & { companyName?: string })[];
      list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      setMachines(list);
      const mine = list.filter((m) => m.operator_id === uid);
      setSel(mine[0] ?? null);
      const tks = ((tk ?? []) as { id: string; name: string; fuel: string }[]);
      setTanks(tks);
      setFTank(tks[0]?.id ?? '');
      setLoading(false);
    })();
  }, [uid]);

  // Al cambiar de máquina o de fecha, precarga la jornada ya registrada de ese día.
  useEffect(() => {
    if (!sel) return;
    let active = true;
    getMachineRound(sel.id, date).then((r) => {
      if (!active) return;
      setDayH(Number(r?.day_hours ?? 0));
      setNightH(Number(r?.night_hours ?? 0));
      setStopped(r?.hours_stopped != null && Number(r.hours_stopped) > 0 ? String(r.hours_stopped) : '');
      setOvertime(r?.overtime_hours != null && Number(r.overtime_hours) > 0 ? String(r.overtime_hours) : '');
    });
    return () => { active = false; };
  }, [sel?.id, date]);

  const mine = useMemo(() => machines.filter((m) => m.operator_id === uid), [machines, uid]);
  const workedPreview = workedFromShifts(dayH, nightH, numOrNull(stopped) ?? 0, numOrNull(overtime) ?? 0);

  const guardarJornada = async () => {
    if (!sel) return;
    setSavingRound(true);
    setNotice(null);
    const { error } = await upsertMachineRound(
      sel.id,
      date,
      {
        day_hours: dayH,
        night_hours: nightH,
        hours_stopped: numOrNull(stopped) ?? 0,
        overtime_hours: numOrNull(overtime) ?? 0,
        // Registra al operador logueado como responsable de los turnos que trabajó.
        ...(dayH > 0 ? { day_operator: fullName } : {}),
        ...(nightH > 0 ? { night_operator: fullName } : {}),
      },
      uid
    );
    setSavingRound(false);
    if (error) { setNotice('❌ ' + error); return; }
    setNotice('✅ Jornada guardada.');
  };

  const registrarCombustible = async () => {
    if (!sel) return;
    setSavingFuel(true);
    setNotice(null);
    const { error } = await insertMachineDispatch({
      machineryId: sel.id,
      dispatchDate: fDate,
      liters: Number((fLiters || '').replace(',', '.')),
      tankId: fTank,
      operator: fullName,
      kmIda: numOrNull(fKmIda),
      kmVuelta: numOrNull(fKmVuelta),
      fuelStart: numOrNull(fStart),
      fuelEnd: numOrNull(fEnd),
      dailyConsumptionL: sel.daily_consumption_l,
      createdBy: uid,
    });
    setSavingFuel(false);
    if (error) { setNotice('❌ ' + error); return; }
    setFLiters(''); setFKmIda(''); setFKmVuelta(''); setFStart(''); setFEnd('');
    setNotice('✅ Combustible registrado.');
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const lbl = { color: colors.muted, fontSize: 12, marginBottom: 2, marginTop: spacing.xs } as const;

  if (loading) return <Screen><ConfigBanner /><Loading /></Screen>;

  const pickList = machines.filter((m) => {
    const q = pickQuery.trim().toLowerCase();
    return !q || (m.code || '').toLowerCase().includes(q) || (m.companyName || '').toLowerCase().includes(q);
  });

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Operador</Text>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{fullName || 'Mi jornada'}</Text>
        </View>
        <TouchableOpacity onPress={signOut} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Salir</Text>
        </TouchableOpacity>
      </View>

      {/* Máquina seleccionada */}
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12 }}>Mi máquina</Text>
        {sel ? (
          <>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{sel.code}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {(sel.tipo || 'Sin tipo')}{sel.referencia ? ` · ${sel.referencia}` : ''} · {sel.companyName}
            </Text>
          </>
        ) : (
          <Text style={{ color: colors.warning, fontWeight: '700', marginTop: 2 }}>No tienes una máquina asignada. Elige una para registrar.</Text>
        )}
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
          <TouchableOpacity onPress={() => { setPickQuery(''); setPickerOpen(true); }} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>🔁 Cambiar máquina</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setScanOpen(true)} style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 13 }}>📷 Escanear QR</Text>
          </TouchableOpacity>
        </View>
        {mine.length > 0 && sel && sel.operator_id !== uid ? (
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>Estás usando una máquina distinta a la que tienes asignada.</Text>
        ) : null}
      </Card>

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('❌') ? colors.danger : colors.success, fontWeight: '700' }}>{notice}</Text></Card>
      ) : null}

      {sel ? (
        <>
          {/* ── JORNADA ── */}
          <SectionTitle>Registrar mi jornada</SectionTitle>
          <Card>
            <Text style={lbl}>Fecha</Text>
            <DateField value={date} onChange={setDate} maxISO={todayISO()} />

            <Text style={lbl}>Turno de día</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {SHIFT_OPTS.map((o) => {
                const on = dayH === o.hours;
                return (
                  <TouchableOpacity key={'d' + o.hours} onPress={() => setDayH(o.hours)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                    <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={lbl}>Turno de noche</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {SHIFT_OPTS.map((o) => {
                const on = nightH === o.hours;
                return (
                  <TouchableOpacity key={'n' + o.hours} onPress={() => setNightH(o.hours)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                    <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={lbl}>Horas paradas</Text>
                <TextInput value={stopped} onChangeText={setStopped} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={lbl}>Horas extra</Text>
                <TextInput value={overtime} onChangeText={setOvertime} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={input} />
              </View>
            </View>

            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
              Horas trabajadas: <Text style={{ color: colors.text, fontWeight: '800' }}>{workedPreview} h</Text> (día + noche − paradas + extras)
            </Text>

            <TouchableOpacity onPress={guardarJornada} disabled={savingRound} style={{ marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{savingRound ? 'Guardando…' : '💾 Guardar mi jornada'}</Text>
            </TouchableOpacity>
          </Card>

          {/* ── COMBUSTIBLE ── */}
          <SectionTitle>Registrar combustible</SectionTitle>
          <Card>
            <Text style={lbl}>Fecha</Text>
            <DateField value={fDate} onChange={setFDate} maxISO={todayISO()} />

            <Text style={lbl}>Litros surtidos</Text>
            <TextInput value={fLiters} onChangeText={setFLiters} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={input} />
            {sel.daily_consumption_l != null && Number(sel.daily_consumption_l) > 0 ? (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Tope: {(Number(sel.daily_consumption_l) * 2).toLocaleString()} L (2× el consumo diario de {Number(sel.daily_consumption_l).toLocaleString()} L).</Text>
            ) : null}

            <Text style={lbl}>Tanque de origen</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {tanks.map((t) => {
                const on = fTank === t.id;
                return (
                  <TouchableOpacity key={t.id} onPress={() => setFTank(t.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: on ? colors.primaryContrast : colors.text, fontSize: 13, fontWeight: on ? '700' : '400' }}>{t.name}</Text>
                  </TouchableOpacity>
                );
              })}
              {tanks.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>No hay tanques activos.</Text> : null}
            </View>

            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, fontWeight: '700' }}>Recorrido de la ruta (opcional)</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={lbl}>Km ida</Text>
                <TextInput value={fKmIda} onChangeText={setFKmIda} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={lbl}>Km vuelta</Text>
                <TextInput value={fKmVuelta} onChangeText={setFKmVuelta} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={input} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={lbl}>Combustible inicial</Text>
                <TextInput value={fStart} onChangeText={setFStart} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={lbl}>Combustible final</Text>
                <TextInput value={fEnd} onChangeText={setFEnd} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted} style={input} />
              </View>
            </View>

            <TouchableOpacity onPress={registrarCombustible} disabled={savingFuel} style={{ marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{savingFuel ? 'Registrando…' : '⛽ Registrar combustible'}</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>Solo se permite una carga por máquina al día.</Text>
          </Card>
        </>
      ) : (
        <EmptyState title="Elige tu máquina" subtitle="Toca “Cambiar máquina” para seleccionar la que vas a operar." />
      )}

      {/* Escáner de QR: al detectar, selecciona esa máquina. */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner
            onClose={() => setScanOpen(false)}
            onDetected={(text) => {
              setScanOpen(false);
              const id = parseMachineId(text);
              const found = id ? machines.find((m) => m.id === id) : null;
              if (found) { setSel(found); setNotice('✅ Máquina seleccionada: ' + found.code); }
              else setNotice('❌ El QR no corresponde a una máquina registrada.');
            }}
          />
        </View>
      </Modal>

      {/* Selector de máquina */}
      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Screen>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <SectionTitle>Elegir máquina</SectionTitle>
            <TouchableOpacity onPress={() => setPickerOpen(false)}><Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15 }}>Cerrar</Text></TouchableOpacity>
          </View>
          <TextInput value={pickQuery} onChangeText={setPickQuery} placeholder="🔎 Buscar por nombre o empresa…" placeholderTextColor={colors.muted} style={input} />
          {mine.length > 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, fontWeight: '700' }}>Asignada(s) a ti</Text>
          ) : null}
          <ScrollView style={{ marginTop: spacing.xs }}>
            {pickList.map((m) => {
              const assigned = m.operator_id === uid;
              const on = sel?.id === m.id;
              return (
                <TouchableOpacity key={m.id} onPress={() => { setSel(m); setPickerOpen(false); }} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface, marginBottom: spacing.xs }}>
                  <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800' }}>{m.code}{assigned ? ' ⭐' : ''}</Text>
                  <Text style={{ color: on ? colors.primaryContrast : colors.muted, fontSize: 12 }}>{(m.tipo || 'Sin tipo')} · {m.companyName}</Text>
                </TouchableOpacity>
              );
            })}
            {pickList.length === 0 ? <Text style={{ color: colors.muted, marginTop: spacing.md }}>Sin resultados.</Text> : null}
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}
