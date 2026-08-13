import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, RefreshControl, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { caracasParts, shiftOf } from '../lib/jornada';
import { getCurrentCoords } from '../lib/location';
import { cmpText } from '../lib/text';
import { useToast } from '../components/ToastProvider';
import {
  listMyOpMachineIds, fetchOpRounds, fetchOpMaintPending,
  opStartJornada, opFinishJornada, opMarkMaint, opRegistrarVisita, updateMachineLocation,
  opAddM3, opSetM3, fetchOpM3Total,
  fetchMyDailyReport, saveDailyReport, OpDailyReport,
  OpRound, OpMaint,
} from '../lib/obrasPublicas';
import { generateObrasPublicasDailyReport, generateOpActivityReport } from '../lib/obrasPublicasReport';
import InspectorKpiGrid, { KpiItem } from '../components/redesign/InspectorKpiGrid';
import EdificioPicker from '../components/EdificioPicker';

type Maquina = { id: string; code?: string | null } & Record<string, any>;

// Materiales para "PARADA · por avería" (mismo criterio que el inspector).
const AV_MATERIALS = [
  { key: 'caucho', label: 'Caucho', icon: '🛞' },
  { key: 'aceite', label: 'Aceite', icon: '🛢️' },
  { key: 'filtro', label: 'Filtro', icon: '🧯' },
  { key: 'repuesto', label: 'Repuesto', icon: '🔩' },
  { key: 'otro', label: 'Otro', icon: '🔧' },
];

const ESTADO_META: Record<string, { label: string; color: string }> = {
  averia: { label: '🔴 Averiada', color: '#B91C1C' },
  parada: { label: '🟡 Parada', color: '#D9A200' },
  trabajando: { label: '🟢 Trabajando', color: '#16A34A' },
  cerrada: { label: '🔵 Trabajó hoy', color: '#2563EB' },
  pendiente: { label: '⏳ Por revisar', color: '#6B7280' },
};

/**
 * Vista de teléfono del SUPERVISOR EXTERNO OBRAS PÚBLICAS. Igual en espíritu a la
 * del inspector, pero TOTALMENTE AISLADA: solo ve SUS máquinas asignadas (desde el
 * catálogo) y sus jornadas/averías/paradas/visitas se guardan en las tablas op_*
 * — NO afectan al módulo de inspectores. La ubicación SÍ se sincroniza con el mapa.
 */
export default function ObrasPublicasScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { session, fullName } = useAuth();
  const uid = session?.user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [machines, setMachines] = useState<Maquina[]>([]);
  const [rounds, setRounds] = useState<Record<string, OpRound>>({});
  const [maint, setMaint] = useState<Record<string, OpMaint>>({});
  const [m3Total, setM3Total] = useState(0); // m³ acumulados (todas las fechas) de mis máquinas
  const [q, setQ] = useState('');
  const [kpiFilter, setKpiFilter] = useState<'trabajando' | 'averia' | null>(null);
  const [reporting, setReporting] = useState(false);

  // Reporte de Actividades OPP (consolidado del día de la supervisora).
  const [dailyOpen, setDailyOpen] = useState(false);
  const [daily, setDaily] = useState<OpDailyReport | null>(null);
  const [dailyBusy, setDailyBusy] = useState(false);
  const [dailyPdf, setDailyPdf] = useState(false);

  // Detalle / acciones de una máquina.
  const [ci, setCi] = useState<Maquina | null>(null);
  const [busy, setBusy] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [paradaTab, setParadaTab] = useState<'averia' | 'no_trabajo'>('averia');
  const [avMat, setAvMat] = useState<string | null>(null);
  const [avMotivo, setAvMotivo] = useState('');
  const [ntMotivo, setNtMotivo] = useState('');
  const [m3Input, setM3Input] = useState(''); // captura de m³ en el detalle

  const nowParts = caracasParts(new Date());
  const roundDate = nowParts.iso;
  const shift = shiftOf(nowParts.hour).key;

  const load = useCallback(async () => {
    if (!uid) { setLoading(false); return; }
    try {
      const ids = await listMyOpMachineIds(uid);
      if (!ids.length) { setMachines([]); setRounds({}); setMaint({}); setM3Total(0); return; }
      const [{ data: machs }, r, mt, m3t] = await Promise.all([
        supabase.from('machinery').select('*').in('id', ids),
        fetchOpRounds(ids, roundDate),
        fetchOpMaintPending(ids),
        fetchOpM3Total(ids),
      ]);
      setMachines(((machs ?? []) as Maquina[]).sort((a, b) => cmpText(a.code ?? '', b.code ?? '')));
      setRounds(r); setMaint(mt); setM3Total(m3t);
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudieron cargar tus máquinas.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, roundDate]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const estadoOf = (id: string): keyof typeof ESTADO_META => {
    const mt = maint[id];
    if (mt?.tipo === 'averia') return 'averia';
    if (mt?.tipo === 'parada') return 'parada';
    const r = rounds[id];
    if (r?.jornada_start_at) return 'trabajando';
    if (r && (r.day_hours > 0 || r.night_hours > 0)) return 'cerrada';
    return 'pendiente';
  };

  const lista = useMemo(() => {
    let base = machines;
    if (kpiFilter) base = base.filter((m) => (kpiFilter === 'averia' ? estadoOf(m.id) === 'averia' : estadoOf(m.id) === 'trabajando'));
    const needle = q.trim().toLowerCase();
    if (!needle) return base;
    return base.filter((m) =>
      [m.code, m.plate, m.serial, m.marca, m.modelo, m.tipo, m.parroquia, m.sector, m.referencia]
        .filter(Boolean).join(' ').toLowerCase().includes(needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines, q, kpiFilter, rounds, maint]);

  // KPIs (solo MIS máquinas asignadas).
  const kpis = useMemo<KpiItem[]>(() => {
    let trabajando = 0, averiadas = 0;
    const edificiosSet = new Set<string>();
    let m3Hoy = 0;
    machines.forEach((m) => {
      const est = estadoOf(m.id);
      if (est === 'trabajando') trabajando += 1;
      if (est === 'averia') averiadas += 1;
      const ed = (m.referencia ?? '').trim();
      if (ed) edificiosSet.add(ed.toLowerCase());
      m3Hoy += rounds[m.id]?.m3 ?? 0;
    });
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return [
      { key: 'm3hoy', label: 'm³ removidos hoy', value: r1(m3Hoy), tone: 'accent', icon: '⛰️' },
      { key: 'edificios', label: 'Edificios', value: edificiosSet.size, tone: 'warning', icon: '🏢' },
      { key: 'asignadas', label: 'Máquinas asignadas', value: machines.length, tone: 'brand', icon: '🚜' },
      { key: 'trabajando', label: 'Trabajando', value: trabajando, tone: 'success', icon: '🟢' },
      { key: 'averiadas', label: 'Averiadas', value: averiadas, tone: 'danger', icon: '🔧' },
      { key: 'm3tot', label: 'm³ totales', value: r1(m3Total), tone: 'accent', icon: '📦' },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines, rounds, maint, m3Total]);

  const onKpi = (k: string) => {
    if (k === 'trabajando') setKpiFilter((p) => (p === 'trabajando' ? null : 'trabajando'));
    else if (k === 'averiadas') setKpiFilter((p) => (p === 'averia' ? null : 'averia'));
    else setKpiFilter(null); // asignadas / edificios / m³ → mostrar todas
  };
  const kpiActiveKey = kpiFilter === 'trabajando' ? 'trabajando' : kpiFilter === 'averia' ? 'averiadas' : null;

  const openDetail = (m: Maquina) => {
    setCi(m); setGps(null); setParadaTab('averia'); setAvMat(null); setAvMotivo(''); setNtMotivo(''); setM3Input('');
  };

  const capturarGps = async (): Promise<{ lat: number; lng: number } | null> => {
    const r = await getCurrentCoords();
    if (r.ok && r.lat != null && r.lng != null) { const c = { lat: r.lat, lng: r.lng }; setGps(c); return c; }
    toast.error(r.error ?? 'No se pudo obtener tu ubicación.');
    return null;
  };

  const registrarVisita = async (status: string) => {
    if (!ci) return;
    setBusy(true);
    try {
      const c = gps ?? (await capturarGps());
      await opRegistrarVisita({
        machineryId: ci.id, supervisorId: uid, supervisorName: fullName || 'Supervisor',
        visitDate: roundDate, status, lat: c?.lat ?? null, lng: c?.lng ?? null,
        machineLat: ci.latitude ?? null, machineLng: ci.longitude ?? null,
      });
      toast.success('Visita registrada.');
    } catch (e: any) { toast.error(e?.message ?? 'No se pudo registrar la visita.'); }
    finally { setBusy(false); }
  };

  const iniciarJornada = async () => {
    if (!ci) return;
    setBusy(true);
    try { await opStartJornada(ci.id, roundDate, shift, uid); await load(); toast.success('Jornada iniciada.'); setCi(null); }
    catch (e: any) { toast.error(e?.message ?? 'No se pudo iniciar la jornada.'); }
    finally { setBusy(false); }
  };

  const finalizarJornada = async () => {
    if (!ci) return;
    const r = rounds[ci.id];
    if (!r?.jornada_start_at) { toast.error('No hay jornada abierta.'); return; }
    setBusy(true);
    try { await opFinishJornada(r, uid); await load(); toast.success('Jornada finalizada.'); setCi(null); }
    catch (e: any) { toast.error(e?.message ?? 'No se pudo finalizar.'); }
    finally { setBusy(false); }
  };

  const marcarParada = async () => {
    if (!ci) return;
    if (paradaTab === 'averia' && (!avMat || !avMotivo.trim())) { toast.error('Elige el material y describe la falla.'); return; }
    if (paradaTab === 'no_trabajo' && !ntMotivo.trim()) { toast.error('Escribe el motivo.'); return; }
    setBusy(true);
    try {
      if (paradaTab === 'averia') {
        await opMarkMaint(ci.id, avMat!, avMotivo.trim(), shift, roundDate, uid);          // avería real
        await opMarkMaint(ci.id, 'MÁQUINA PARADA', avMotivo.trim(), shift, roundDate, uid); // + deja parada
      } else {
        await opMarkMaint(ci.id, 'MÁQUINA PARADA', `NO TRABAJÓ · ${ntMotivo.trim()}`, shift, roundDate, uid);
      }
      await load(); toast.success('Máquina marcada como parada.'); setCi(null);
    } catch (e: any) { toast.error(e?.message ?? 'No se pudo marcar.'); }
    finally { setBusy(false); }
  };

  const actualizarUbicacion = async () => {
    if (!ci) return;
    setBusy(true);
    try {
      const c = gps ?? (await capturarGps());
      if (!c) { setBusy(false); return; }
      await updateMachineLocation(ci.id, c.lat, c.lng);
      setMachines((prev) => prev.map((m) => (m.id === ci.id ? { ...m, latitude: c.lat, longitude: c.lng } : m)));
      toast.success('Ubicación actualizada (se refleja en el mapa).');
    } catch (e: any) { toast.error(e?.message ?? 'No se pudo actualizar la ubicación.'); }
    finally { setBusy(false); }
  };

  const registrarM3 = async (modo: 'sumar' | 'fijar') => {
    if (!ci) return;
    const val = Number((m3Input || '').replace(',', '.'));
    if (!isFinite(val) || val < 0) { toast.error('Escribe una cantidad de m³ válida.'); return; }
    setBusy(true);
    try {
      const nuevo = modo === 'sumar'
        ? await opAddM3(ci.id, roundDate, val)
        : await opSetM3(ci.id, roundDate, val);
      setRounds((prev) => ({ ...prev, [ci.id]: { ...(prev[ci.id] ?? { machinery_id: ci.id, round_date: roundDate, day_hours: 0, night_hours: 0, jornada_start_at: null, jornada_shift: null, m3: 0 }), m3: nuevo } }));
      setM3Input('');
      await load();
      toast.success(modo === 'sumar' ? `+${val} m³ registrados.` : `Total fijado en ${nuevo} m³.`);
    } catch (e: any) { toast.error(e?.message ?? 'No se pudieron registrar los m³.'); }
    finally { setBusy(false); }
  };

  const generarReporte = async () => {
    setReporting(true);
    try { await generateObrasPublicasDailyReport({ supervisorId: uid, supervisorName: fullName || 'Supervisor', roundDate }); }
    catch (e: any) { toast.error(e?.message ?? 'No se pudo generar el reporte.'); }
    finally { setReporting(false); }
  };

  const abrirReporteDia = async () => {
    setDailyBusy(true); setDailyOpen(true);
    try { setDaily(await fetchMyDailyReport(uid, roundDate, fullName || 'Supervisor')); }
    catch (e: any) { toast.error(e?.message ?? 'No se pudo cargar el reporte.'); setDailyOpen(false); }
    finally { setDailyBusy(false); }
  };

  const setDf = (patch: Partial<OpDailyReport>) => setDaily((p) => (p ? { ...p, ...patch } : p));
  const numOf = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) && n >= 0 ? n : 0; };

  const guardarReporteDia = async () => {
    if (!daily) return;
    setDailyBusy(true);
    try { const saved = await saveDailyReport({ ...daily, supervisor_id: uid, supervisor_name: fullName || 'Supervisor' }, uid); setDaily(saved); toast.success('Reporte del día guardado.'); }
    catch (e: any) { toast.error(e?.message ?? 'No se pudo guardar el reporte.'); }
    finally { setDailyBusy(false); }
  };

  const pdfReporteDia = async () => {
    if (!daily) return;
    setDailyPdf(true);
    try {
      const saved = await saveDailyReport({ ...daily, supervisor_id: uid, supervisor_name: fullName || 'Supervisor' }, uid);
      setDaily(saved);
      await generateOpActivityReport({ supervisorId: uid, supervisorName: fullName || 'Supervisor', roundDate, report: saved });
    } catch (e: any) { toast.error(e?.message ?? 'No se pudo generar el PDF.'); }
    finally { setDailyPdf(false); }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text } as const;

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: spacing.md, gap: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>🏛️ Mis máquinas · Obras Públicas</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{machines.length} asignada(s) · {shiftOf(nowParts.hour).label}</Text>
        <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar máquina…" placeholderTextColor={colors.muted} style={input} />
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <TouchableOpacity onPress={abrirReporteDia} style={{ flex: 1, backgroundColor: '#7C3AED', borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>📋 Reporte del día</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={generarReporte} disabled={reporting} style={{ flex: 1, backgroundColor: '#0EA5E9', borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', opacity: reporting ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{reporting ? 'Generando…' : '📄 Mis máquinas'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingTop: 0, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {machines.length > 0 ? (
          <View style={{ marginBottom: spacing.sm }}>
            <InspectorKpiGrid items={kpis} activeKey={kpiActiveKey} onSelect={onKpi} />
            {kpiFilter ? (
              <TouchableOpacity onPress={() => setKpiFilter(null)} style={{ alignSelf: 'center', marginTop: spacing.xs }}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Ver todas ✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {machines.length === 0 ? (
          <Text style={{ color: colors.muted, textAlign: 'center', marginTop: spacing.xl }}>
            Todavía no tienes máquinas asignadas. Pídele al administrador que te las asigne desde el catálogo (botón 🏛️ Obras Públicas).
          </Text>
        ) : lista.map((m) => {
          const est = estadoOf(m.id);
          const meta = ESTADO_META[est];
          const r = rounds[m.id];
          const horas = r ? (r.day_hours + r.night_hours) : 0;
          const m3 = r?.m3 ?? 0;
          const label = [m.plate || m.serial, m.marca, m.modelo].filter(Boolean).join(' · ');
          return (
            <TouchableOpacity key={m.id} onPress={() => openDetail(m)} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{m.code}</Text>
                  {label ? <Text style={{ color: colors.muted, fontSize: 11 }}>{label}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: meta.color, fontSize: 12, fontWeight: '800' }}>{meta.label}</Text>
                  {horas > 0 ? <Text style={{ color: colors.muted, fontSize: 11 }}>{horas.toFixed(2)} h</Text> : null}
                  {m3 > 0 ? <Text style={{ color: colors.accentSoftText, fontSize: 11, fontWeight: '700' }}>⛰️ {m3} m³</Text> : null}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Detalle / acciones de la máquina */}
      <Modal visible={!!ci} animationType="slide" transparent onRequestClose={() => setCi(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '90%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
              {ci ? (<>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>{ci.code}</Text>
                  <TouchableOpacity onPress={() => setCi(null)}><Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar ✕</Text></TouchableOpacity>
                </View>
                <Text style={{ color: ESTADO_META[estadoOf(ci.id)].color, fontWeight: '800' }}>{ESTADO_META[estadoOf(ci.id)].label}</Text>

                {/* Visita / check-in */}
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Dejar constancia de la visita (con tu ubicación)</Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  {[['trabajando', '🟢 Trabajando'], ['parada', '🟡 Parada'], ['no_esta', '⚪ No está']].map(([st, lbl]) => (
                    <TouchableOpacity key={st} onPress={() => registrarVisita(st)} disabled={busy} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{lbl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Jornada */}
                {rounds[ci.id]?.jornada_start_at ? (
                  <TouchableOpacity onPress={finalizarJornada} disabled={busy} style={{ backgroundColor: '#B91C1C', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm, opacity: busy ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>⏹️ Finalizar jornada</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={iniciarJornada} disabled={busy} style={{ backgroundColor: '#16A34A', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm, opacity: busy ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>▶️ Iniciar jornada</Text>
                  </TouchableOpacity>
                )}

                {/* m³ removidos hoy */}
                <View style={{ borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoftBg, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm, gap: spacing.xs }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.accentSoftText, fontWeight: '800', fontSize: 13 }}>⛰️ m³ removidos hoy</Text>
                    <Text style={{ color: colors.accentSoftText, fontWeight: '900', fontSize: 16 }}>{(rounds[ci.id]?.m3 ?? 0)} m³</Text>
                  </View>
                  <TextInput
                    value={m3Input}
                    onChangeText={setM3Input}
                    placeholder="Cantidad de m³"
                    placeholderTextColor={colors.muted}
                    keyboardType="numeric"
                    style={input}
                  />
                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                    <TouchableOpacity onPress={() => registrarM3('sumar')} disabled={busy} style={{ flex: 2, backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>➕ Sumar m³</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => registrarM3('fijar')} disabled={busy} style={{ flex: 1, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                      <Text style={{ color: colors.accentSoftText, fontWeight: '800', fontSize: 12 }}>✏️ Fijar total</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Parada / avería */}
                <View style={{ borderWidth: 1, borderColor: colors.warningSoftBorder, backgroundColor: colors.warningSoftBg, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm, gap: spacing.xs }}>
                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                    {(['averia', 'no_trabajo'] as const).map((t) => {
                      const on = paradaTab === t;
                      return (
                        <TouchableOpacity key={t} onPress={() => setParadaTab(t)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: on ? '#8A6A00' : colors.warningSoftBorder, backgroundColor: on ? '#8A6A00' : 'transparent' }}>
                          <Text style={{ color: on ? '#fff' : colors.warningSoftText, fontWeight: '800', fontSize: 12 }}>{t === 'averia' ? '🔧 Por avería' : '📍 No trabajó'}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {paradaTab === 'averia' ? (<>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      {AV_MATERIALS.map((mt) => {
                        const on = avMat === mt.key;
                        return (
                          <TouchableOpacity key={mt.key} onPress={() => setAvMat(mt.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: on ? '#8A6A00' : colors.surface, borderWidth: 1, borderColor: on ? '#8A6A00' : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                            <Text>{mt.icon}</Text><Text style={{ color: on ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>{mt.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <TextInput value={avMotivo} onChangeText={setAvMotivo} placeholder="Falla (obligatorio)" placeholderTextColor={colors.muted} style={input} />
                  </>) : (
                    <TextInput value={ntMotivo} onChangeText={setNtMotivo} placeholder="Motivo: sin combustible, sin operador…" placeholderTextColor={colors.muted} style={input} />
                  )}
                  <TouchableOpacity onPress={marcarParada} disabled={busy} style={{ backgroundColor: '#D9A200', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>🟡 Confirmar parada</Text>
                  </TouchableOpacity>
                </View>

                {/* Ubicación (se sincroniza con el mapa) */}
                <TouchableOpacity onPress={actualizarUbicacion} disabled={busy} style={{ backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm, opacity: busy ? 0.6 : 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>📍 Actualizar ubicación (mapa)</Text>
                </TouchableOpacity>
                {busy ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} /> : null}
              </>) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Reporte de Actividades OPP (consolidado del día) */}
      <Modal visible={dailyOpen} animationType="slide" transparent onRequestClose={() => setDailyOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '92%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>📋 Reporte de Actividades OPP</Text>
                <TouchableOpacity onPress={() => setDailyOpen(false)}><Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar ✕</Text></TouchableOpacity>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{fullName || 'Supervisor'} · {nowParts.iso.split('-').reverse().join('/')}</Text>

              {daily == null ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
              ) : (<>
                {([
                  ['N° de reporte OPP', 'reporte_no'],
                  ['M³ removidos controlada (día)', 'm3_removidos_dia'],
                  ['M³ acarreo de vestigios (día)', 'm3_acarreo_dia'],
                  ['Cuerpos siniestrados (día)', 'cuerpos_dia'],
                  ['Traslado camión (día)', 'traslado_camion_dia'],
                ] as const).map(([label, key]) => (
                  <View key={key} style={{ gap: 4 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>{label}</Text>
                    <TextInput
                      value={(daily as any)[key] ? String((daily as any)[key]) : ''}
                      onChangeText={(t) => setDf({ [key]: key === 'reporte_no' ? (t.trim() === '' ? null : Math.round(numOf(t))) : (key === 'cuerpos_dia' || key === 'traslado_camion_dia') ? Math.round(numOf(t)) : numOf(t) } as any)}
                      placeholder="0"
                      placeholderTextColor={colors.muted}
                      keyboardType="numeric"
                      style={input}
                    />
                  </View>
                ))}

                <EdificioPicker value={daily.edificio ?? ''} onChange={(name) => setDf({ edificio: name })} label="Edificio" placeholder="Selecciona o escribe el edificio…" />

                <View style={{ gap: 4, marginTop: spacing.sm }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>Observación del día</Text>
                  <TextInput
                    value={daily.observacion ?? ''}
                    onChangeText={(t) => setDf({ observacion: t })}
                    placeholder="Novedades, incidencias, comentarios…"
                    placeholderTextColor={colors.muted}
                    multiline
                    style={[input, { minHeight: 80, textAlignVertical: 'top' }]}
                  />
                </View>

                <Text style={{ color: colors.muted, fontSize: 11 }}>Los acumulados "desde inicio" se calculan automáticamente (base + todos los reportes). Se ven en el PDF y en el panel de Obras Públicas.</Text>

                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                  <TouchableOpacity onPress={guardarReporteDia} disabled={dailyBusy || dailyPdf} style={{ flex: 1, backgroundColor: '#16A34A', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: (dailyBusy || dailyPdf) ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{dailyBusy ? 'Guardando…' : '💾 Guardar'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={pdfReporteDia} disabled={dailyBusy || dailyPdf} style={{ flex: 1, backgroundColor: '#0EA5E9', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: (dailyBusy || dailyPdf) ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{dailyPdf ? 'Generando…' : '⬇️ Descargar PDF'}</Text>
                  </TouchableOpacity>
                </View>
              </>)}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
