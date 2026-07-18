import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { norm, onlyDecimal } from '../lib/text';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const MAT_ICON: Record<string, string> = { caucho: '🛞', aceite: '🛢️', filtro: '🧴', repuesto: '🔩' };
const matLabel = (m: string) => (m ? m.charAt(0).toUpperCase() + m.slice(1) : '—');
const todayISO = () => { const d = new Date(); const p = (n: number) => `${n}`.padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const fmtDMY = (iso?: string | null) => { if (!iso) return '—'; const [y, m, d] = String(iso).split('T')[0].split('-'); return y && m && d ? `${d}/${m}/${y}` : String(iso); };
function fmtDT(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => `${n}`.padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Req = { id: string; machinery_id: string; material: string; quantity: number | null; notes: string | null; status: string; created_at: string; code: string; tipo: string | null; company: string };
type Rep = { id: string; machinery_id: string; tipo: string; out_at: string; estimated_days: number | null; estimated_note: string | null; work_done: string | null; back_at: string | null; status: string; created_at: string; code: string; company: string };
type Mach = { id: string; code: string; tipo: string | null; company: string; operational: boolean };

type Tab = 'averias' | 'reparacion' | 'historial';

/**
 * MANTENIMIENTO DE MAQUINARIA (coordinadores de mantenimiento).
 *  - Averías por empresa → máquina (lo que reporta el operador por QR).
 *  - Enviar una máquina a reparación (salida, tiempo estimado, tipo) → queda No operativa.
 *  - Registrar el retorno operativo (qué se le cambió + fecha) → vuelve a Operativa.
 *  - Historial de reparaciones por máquina.
 */
export default function MantenimientoMaquinariaScreen() {
  const { colors } = useTheme();
  const { canSee, session } = useAuth();
  const confirm = useConfirm();
  const uid = session?.user?.id ?? null;

  const [reqs, setReqs] = useState<Req[]>([]);
  const [repairs, setRepairs] = useState<Rep[]>([]);
  const [machines, setMachines] = useState<Mach[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('averias');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // Enviar a reparación
  const [repFor, setRepFor] = useState<Mach | null>(null);
  const [rTipo, setRTipo] = useState<'preventivo' | 'correctivo'>('correctivo');
  const [rOut, setROut] = useState(todayISO());
  const [rDays, setRDays] = useState('');
  const [rNote, setRNote] = useState('');
  const [rWork, setRWork] = useState('');

  // Registrar retorno operativo
  const [retFor, setRetFor] = useState<Rep | null>(null);
  const [retBack, setRetBack] = useState(todayISO());
  const [retWork, setRetWork] = useState('');

  // Selector de máquina (para enviar cualquiera a reparación)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState('');

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const load = async () => {
    setLoading(true);
    const [{ data: mr }, { data: rp }, { data: mac }] = await Promise.all([
      supabase.from('maintenance_requests').select('id, machinery_id, material, quantity, notes, status, created_at, machinery:machinery_id(code, tipo, company:company_id(name))').order('created_at', { ascending: false }),
      supabase.from('machinery_repairs').select('id, machinery_id, tipo, out_at, estimated_days, estimated_note, work_done, back_at, status, created_at, machinery:machinery_id(code, company:company_id(name))').order('created_at', { ascending: false }),
      supabase.from('machinery').select('id, code, tipo, operational, active, company:company_id(name)').eq('active', true).order('code'),
    ]);
    setReqs((mr ?? []).map((r: any) => ({ id: r.id, machinery_id: r.machinery_id, material: r.material, quantity: r.quantity != null ? Number(r.quantity) : null, notes: r.notes ?? null, status: r.status, created_at: r.created_at, code: r.machinery?.code ?? '—', tipo: r.machinery?.tipo ?? null, company: r.machinery?.company?.name ?? 'Sin empresa' })));
    setRepairs((rp ?? []).map((r: any) => ({ id: r.id, machinery_id: r.machinery_id, tipo: r.tipo, out_at: r.out_at, estimated_days: r.estimated_days != null ? Number(r.estimated_days) : null, estimated_note: r.estimated_note ?? null, work_done: r.work_done ?? null, back_at: r.back_at ?? null, status: r.status, created_at: r.created_at, code: r.machinery?.code ?? '—', company: r.machinery?.company?.name ?? 'Sin empresa' })));
    setMachines((mac ?? []).map((m: any) => ({ id: m.id, code: m.code, tipo: m.tipo ?? null, company: m.company?.name ?? 'Sin empresa', operational: m.operational !== false })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Reparación ACTIVA por máquina (si existe).
  const activeRepairByMachine = useMemo(() => {
    const m = new Map<string, Rep>();
    repairs.forEach((r) => { if (r.status === 'en_reparacion' && !m.has(r.machinery_id)) m.set(r.machinery_id, r); });
    return m;
  }, [repairs]);

  const marcarRealizado = async (r: Req) => {
    const ok = await confirm({ title: 'Mantenimiento realizado', message: `¿Marcar como REALIZADO el ${matLabel(r.material)} de "${r.code}"?`, confirmText: 'Sí, realizado', cancelText: 'Cancelar' });
    if (!ok) return;
    setBusy(r.id);
    const { error } = await supabase.from('maintenance_requests').update({ status: 'realizado', resolved_by: uid, resolved_at: new Date().toISOString() }).eq('id', r.id);
    setBusy(null);
    if (error) return Alert.alert('Aviso', error.message);
    setReqs((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: 'realizado' } : x)));
  };

  // ── Enviar a reparación ─────────────────────────────────────────────────────
  const openRepair = (m: Mach) => {
    setRepFor(m); setRTipo('correctivo'); setROut(todayISO()); setRDays(''); setRNote(''); setRWork('');
    setPickerOpen(false);
  };
  const enviarReparacion = async () => {
    if (!repFor) return;
    setBusy('rep');
    const payload = {
      machinery_id: repFor.id, tipo: rTipo, out_at: rOut,
      estimated_days: rDays.trim() ? Number(rDays.replace(',', '.')) : null,
      estimated_note: rNote.trim() || null, work_done: rWork.trim() || null,
      status: 'en_reparacion', created_by: uid,
    };
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('machinery_repairs').insert(payload),
      supabase.from('machinery').update({ operational: false }).eq('id', repFor.id),
    ]);
    setBusy(null);
    if (e1 || e2) return Alert.alert('Aviso', (e1?.message || e2?.message) as string);
    setRepFor(null);
    await load();
    setTab('reparacion');
  };

  // ── Registrar retorno operativo ─────────────────────────────────────────────
  const openReturn = (r: Rep) => { setRetFor(r); setRetBack(todayISO()); setRetWork(r.work_done ?? ''); };
  const registrarRetorno = async () => {
    if (!retFor) return;
    if (!retWork.trim()) return Alert.alert('Aviso', 'Indica qué se le cambió / reparó a la máquina.');
    setBusy('ret');
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('machinery_repairs').update({ status: 'operativa', back_at: retBack, work_done: retWork.trim(), closed_by: uid }).eq('id', retFor.id),
      supabase.from('machinery').update({ operational: true, en_espera: false }).eq('id', retFor.machinery_id),
    ]);
    setBusy(null);
    if (e1 || e2) return Alert.alert('Aviso', (e1?.message || e2?.message) as string);
    setRetFor(null);
    await load();
  };

  // ── Agrupaciones por pestaña ────────────────────────────────────────────────
  const nq = norm(query.trim());
  const matchesQ = (code: string, company: string) => !nq || norm(company).includes(nq) || norm(code).includes(nq);

  // AVERÍAS pendientes por empresa → máquina.
  const averiaGroups = useMemo(() => {
    const shown = reqs.filter((r) => r.status === 'pendiente' && matchesQ(r.code, r.company));
    const byCompany = new Map<string, Map<string, Req[]>>();
    shown.forEach((r) => {
      const comp = byCompany.get(r.company) ?? new Map<string, Req[]>();
      const arr = comp.get(r.code) ?? []; arr.push(r); comp.set(r.code, arr); byCompany.set(r.company, comp);
    });
    return Array.from(byCompany.entries()).map(([company, mm]) => ({ company, machines: Array.from(mm.entries()).map(([code, items]) => ({ code, items, machinery_id: items[0].machinery_id, tipo: items[0]?.tipo ?? null })).sort((a, b) => a.code.localeCompare(b.code)) }))
      .sort((a, b) => a.company.localeCompare(b.company));
  }, [reqs, nq]);

  const enReparacion = useMemo(() => repairs.filter((r) => r.status === 'en_reparacion' && matchesQ(r.code, r.company)), [repairs, nq]);
  const historial = useMemo(() => repairs.filter((r) => r.status === 'operativa' && matchesQ(r.code, r.company)), [repairs, nq]);

  const pendientes = reqs.filter((r) => r.status === 'pendiente').length;
  const enRepCount = repairs.filter((r) => r.status === 'en_reparacion').length;

  if (!canSee('mantenimiento')) {
    return (<Screen><SectionTitle>Mantenimiento de Maquinaria</SectionTitle><EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo." /></Screen>);
  }

  const TIPO_BADGE = (t: string) => (t === 'preventivo' ? { label: '🩺 Preventivo', tone: 'muted' as const } : { label: '🔧 Correctivo', tone: 'warning' as const });

  const pickerList = machines.filter((m) => { const q = norm(pickerQ.trim()); return !q || norm(m.code).includes(q) || norm(m.company).includes(q); });

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Mantenimiento de Maquinaria</SectionTitle>

      {/* Pestañas */}
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        {([['averias', `⏳ Averías (${pendientes})`], ['reparacion', `🔧 En reparación (${enRepCount})`], ['historial', '✓ Historial']] as const).map(([k, label]) => {
          const on = tab === k;
          return (
            <TouchableOpacity key={k} onPress={() => setTab(k)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
              <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity onPress={() => { setPickerQ(''); setPickerOpen(true); }} style={{ backgroundColor: '#B45309', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
        <Text style={{ color: '#fff', fontWeight: '800' }}>🔧 Enviar una máquina a reparación</Text>
      </TouchableOpacity>

      <TextInput value={query} onChangeText={setQuery} placeholder="🔎 Buscar empresa o máquina…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />

      {loading ? (
        <Loading />
      ) : tab === 'averias' ? (
        averiaGroups.length === 0 ? (
          <EmptyState title="Sin averías pendientes" subtitle="Cuando un operador reporte una avería, aparecerá aquí por máquina." />
        ) : (
          averiaGroups.map((g) => (
            <View key={g.company}>
              <Card style={{ backgroundColor: colors.surfaceAlt, marginTop: spacing.sm }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🏢 {g.company}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>🚜 {g.machines.length} máquina(s) con avería</Text>
              </Card>
              {g.machines.map((mm) => {
                const rep = activeRepairByMachine.get(mm.machinery_id);
                const mac = machines.find((m) => m.id === mm.machinery_id) ?? { id: mm.machinery_id, code: mm.code, tipo: mm.tipo, company: g.company, operational: true };
                return (
                  <Card key={mm.code}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{mm.code}{mm.tipo ? <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '400' }}>  ·  {mm.tipo}</Text> : null}</Text>
                    {mm.items.map((r) => (
                      <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ fontSize: 24 }}>{MAT_ICON[r.material] ?? '🔧'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '700' }}>{matLabel(r.material)}{r.quantity != null ? ` · ${r.quantity.toLocaleString()}` : ''}</Text>
                          {r.notes ? <Text style={{ color: colors.muted, fontSize: 12 }}>{r.notes}</Text> : null}
                          <Text style={{ color: colors.muted, fontSize: 11 }}>{fmtDT(r.created_at)}</Text>
                        </View>
                        <TouchableOpacity onPress={() => marcarRealizado(r)} disabled={busy === r.id} style={{ backgroundColor: colors.success, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{busy === r.id ? '…' : '✓ Realizado'}</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {rep ? (
                      <View style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.warning }}>
                        <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>🔧 En reparación desde {fmtDMY(rep.out_at)}{rep.estimated_days != null ? ` · estimado ${rep.estimated_days} día(s)` : ''}</Text>
                        <TouchableOpacity onPress={() => openReturn(rep)} style={{ marginTop: spacing.xs, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.xs, alignItems: 'center' }}>
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✓ Registrar retorno operativo</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => openRepair(mac)} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: '#B45309', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                        <Text style={{ color: '#B45309', fontWeight: '800', fontSize: 12 }}>🔧 Enviar a reparación</Text>
                      </TouchableOpacity>
                    )}
                  </Card>
                );
              })}
            </View>
          ))
        )
      ) : tab === 'reparacion' ? (
        enReparacion.length === 0 ? (
          <EmptyState title="Ninguna máquina en reparación" subtitle="Usa “Enviar una máquina a reparación” para registrar una salida." />
        ) : (
          enReparacion.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{r.code}</Text>
                <Badge {...TIPO_BADGE(r.tipo)} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🏢 {r.company}</Text>
              <Text style={{ color: colors.warning, fontSize: 13, fontWeight: '700', marginTop: spacing.xs }}>🔧 Salió a reparación: {fmtDMY(r.out_at)}{r.estimated_days != null ? ` · estimado ${r.estimated_days} día(s)` : ''}</Text>
              {r.estimated_note ? <Text style={{ color: colors.muted, fontSize: 12 }}>⏱️ {r.estimated_note}</Text> : null}
              {r.work_done ? <Text style={{ color: colors.muted, fontSize: 12 }}>🔩 {r.work_done}</Text> : null}
              <TouchableOpacity onPress={() => openReturn(r)} style={{ marginTop: spacing.sm, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>✓ Registrar retorno operativo</Text>
              </TouchableOpacity>
            </Card>
          ))
        )
      ) : (
        historial.length === 0 ? (
          <EmptyState title="Sin reparaciones cerradas" subtitle="Las reparaciones terminadas (máquina de vuelta operativa) aparecerán aquí." />
        ) : (
          historial.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{r.code}</Text>
                <Badge {...TIPO_BADGE(r.tipo)} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🏢 {r.company}</Text>
              <Text style={{ color: colors.text, fontSize: 13, marginTop: spacing.xs }}>📅 {fmtDMY(r.out_at)} → {fmtDMY(r.back_at)} <Text style={{ color: colors.success, fontWeight: '700' }}>· Operativa</Text></Text>
              {r.work_done ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🔩 Se cambió: {r.work_done}</Text> : null}
            </Card>
          ))
        )
      )}

      {/* Modal: selector de máquina para enviar a reparación */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '85%' }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: spacing.sm }}>Elige la máquina a reparar</Text>
            <TextInput value={pickerQ} onChangeText={setPickerQ} placeholder="🔎 Buscar máquina o empresa…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />
            <ScrollView>
              {pickerList.map((m) => {
                const inRep = activeRepairByMachine.has(m.id);
                return (
                  <TouchableOpacity key={m.id} onPress={() => !inRep && openRepair(m)} disabled={inRep} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs, backgroundColor: colors.surface, opacity: inRep ? 0.5 : 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>{m.code}{inRep ? '  · ya en reparación' : ''}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{m.company}{m.operational ? '' : ' · No operativa'}</Text>
                  </TouchableOpacity>
                );
              })}
              {pickerList.length === 0 ? <EmptyState title="Sin resultados" subtitle="Prueba con otro nombre." /> : null}
            </ScrollView>
            <TouchableOpacity onPress={() => setPickerOpen(false)} style={{ marginTop: spacing.sm, padding: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: enviar a reparación */}
      <Modal visible={!!repFor} transparent animationType="slide" onRequestClose={() => setRepFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '90%' }}>
            {repFor ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>🔧 Enviar a reparación</Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>{repFor.code} · {repFor.company}</Text>

                <Text style={{ color: colors.muted, fontSize: 12 }}>Tipo</Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                  {(['correctivo', 'preventivo'] as const).map((t) => (
                    <TouchableOpacity key={t} onPress={() => setRTipo(t)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: rTipo === t ? colors.primary : colors.border, backgroundColor: rTipo === t ? colors.primary : colors.surface }}>
                      <Text style={{ color: rTipo === t ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{t === 'correctivo' ? '🔧 Correctivo' : '🩺 Preventivo'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Fecha de salida a reparación</Text>
                <DateField value={rOut} onChange={setROut} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Por cuánto tiempo? (días estimados)</Text>
                <TextInput value={rDays} onChangeText={(t) => setRDays(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="Ej. 5" placeholderTextColor={colors.muted} style={input} />
                <TextInput value={rNote} onChangeText={setRNote} placeholder="Detalle del tiempo (opcional, ej. 'espera de repuesto')" placeholderTextColor={colors.muted} style={{ ...input, marginTop: spacing.xs }} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Qué se le va a cambiar? (opcional, se puede llenar al volver)</Text>
                <TextInput value={rWork} onChangeText={setRWork} placeholder="Ej. cambio de bomba hidráulica…" placeholderTextColor={colors.muted} multiline style={{ ...input, minHeight: 60 }} />

                <Text style={{ color: colors.warning, fontSize: 11, marginTop: spacing.sm }}>⚠️ Al enviar, la máquina queda marcada como “No operativa” en todo el sistema.</Text>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <TouchableOpacity onPress={() => setRepFor(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={enviarReparacion} disabled={busy === 'rep'} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#B45309', opacity: busy === 'rep' ? 0.7 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{busy === 'rep' ? 'Guardando…' : '🔧 Enviar a reparación'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: spacing.lg }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Modal: registrar retorno operativo */}
      <Modal visible={!!retFor} transparent animationType="slide" onRequestClose={() => setRetFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '90%' }}>
            {retFor ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>✓ Retorno operativo</Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>{retFor.code} · salió el {fmtDMY(retFor.out_at)}</Text>

                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>¿Cuándo volvió operativa?</Text>
                <DateField value={retBack} onChange={setRetBack} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Qué se le cambió / reparó?</Text>
                <TextInput value={retWork} onChangeText={setRetWork} placeholder="Ej. se cambió la bomba hidráulica y filtros…" placeholderTextColor={colors.muted} multiline style={{ ...input, minHeight: 70 }} />

                <Text style={{ color: colors.success, fontSize: 11, marginTop: spacing.sm }}>✓ Al registrar, la máquina vuelve a “Operativa” en todo el sistema.</Text>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <TouchableOpacity onPress={() => setRetFor(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={registrarRetorno} disabled={busy === 'ret'} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.success, opacity: busy === 'ret' ? 0.7 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{busy === 'ret' ? 'Guardando…' : '✓ Marcar operativa'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: spacing.lg }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
