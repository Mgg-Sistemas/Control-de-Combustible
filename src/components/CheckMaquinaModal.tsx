import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { Screen, EmptyState, SkeletonList } from './ui';
import { supabase, selectAllRows } from '../lib/supabase';
import { norm, cmpText } from '../lib/text';
import { Machinery } from '../types/database';
import { listInspectorAssignments, assignInspector, unassignInspector, Shift, shiftIcon, shiftLabel, PLACEHOLDER_INSPECTOR_ID, soloAdminPuedeAsignar } from '../lib/machineInspectors';
import { logAudit } from '../lib/audit';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

type Mach = Machinery & { companyName?: string };
type SlotInfo = { id: string | null; name: string };
type CheckFilterMode = 'mine' | 'pending' | 'all';

/**
 * ✅ CHECK MÁQUINA — asignar/reasignar el inspector (día/noche) de cada máquina.
 * Réplica del CHECK MÁQUINA de la vista de teléfono (SupervisorScreen.tsx) como
 * componente independiente y AUTOCONTENIDO (carga sus propios datos, no comparte
 * estado con el teléfono) para poder abrirse también desde la vista de escritorio
 * (Inspecciones) — pedido del cliente: "que sea exactamente lo mismo". Tocar este
 * archivo NUNCA afecta al teléfono, y viceversa.
 */
export default function CheckMaquinaModal({ visible, onClose, isAdmin }: { visible: boolean; onClose: () => void; isAdmin: boolean }) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState<Mach[]>([]);
  const [assignMap, setAssignMap] = useState<Record<string, { day?: SlotInfo; night?: SlotInfo }>>({});
  const [inspectors, setInspectors] = useState<{ id: string; name: string; role: string | null }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMachines = async () => {
    const mach = await selectAllRows('machinery', 'id, code, tipo, serial, plate, referencia, encargado, latitude, longitude, active, operational, en_espera, company:company_id(name)');
    const list = ((mach ?? []) as any[]).map((m) => ({ ...m, companyName: m.company?.name ?? 'Sin empresa' })) as Mach[];
    list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    setMachines(list);
  };
  const reloadAssigns = async () => {
    const { rows, missing } = await listInspectorAssignments();
    const map: Record<string, { day?: SlotInfo; night?: SlotInfo }> = {};
    rows.forEach((a) => { (map[a.machinery_id] ||= {})[a.shift] = { id: a.inspector_id, name: a.inspector_name }; });
    setAssignMap(map);
    if (missing) setNotice('⚠️ Para asignar máquinas (CHECK) falta correr supabase/inspector_asignacion.sql en Supabase.');
  };
  const loadInspectors = async () => {
    const { data: insp } = await supabase.from('profiles').select('id, full_name, role').in('role', ['supervisor', 'coordinador_patio']).order('full_name');
    // El placeholder "MÁQUINAS FALTANTES" y el inspector REAL "SOS LA GUAIRA" solo los
    // puede ASIGNAR un ADMIN (mismo criterio que el teléfono, SupervisorScreen.tsx) —
    // quitarles una máquina y dársela a otro sigue abierto a cualquier coordinador.
    const rows = ((insp ?? []) as any[]).filter((p) => (p.full_name || '').trim() && (isAdmin || !soloAdminPuedeAsignar(p)));
    setInspectors(rows.map((p) => ({ id: p.id as string, name: p.full_name as string, role: (p.role ?? null) as string | null })));
  };
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    Promise.all([loadMachines(), reloadAssigns(), loadInspectors()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isAdmin]);
  useRealtimeRefresh(['machine_inspectors'], () => { if (visible) reloadAssigns(); });
  useRealtimeRefresh(['machinery'], () => { if (visible) loadMachines(); });

  // ── PASO 1: elegir inspector ────────────────────────────────────────────
  const [checkMode, setCheckMode] = useState<'assign' | 'resumen'>('assign');
  const [checkInspector, setCheckInspector] = useState<{ id: string; name: string } | null>(null);
  const [inspQuery, setInspQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExp = (k: string) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // ── PASO 2: asignar máquinas al inspector elegido ──────────────────────
  const [checkQuery, setCheckQuery] = useState('');
  const [checkFilter, setCheckFilter] = useState<CheckFilterMode>('mine');
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [assignBusy, setAssignBusy] = useState<string | null>(null);

  // ── Pendientes por asignar ──────────────────────────────────────────────
  const [pendOpen, setPendOpen] = useState(false);
  const [pendQuery, setPendQuery] = useState('');
  const [pendMode, setPendMode] = useState<'sin_nadie' | 'sin_real'>('sin_nadie');
  const [pendSelected, setPendSelected] = useState<Set<string>>(new Set());
  const [pendBatchOpen, setPendBatchOpen] = useState(false);
  const [pendBatchShift, setPendBatchShift] = useState<Shift>('day');
  const [pendBatchQuery, setPendBatchQuery] = useState('');
  const [pendBatchBusy, setPendBatchBusy] = useState(false);

  // ── Asignar/quitar UNA máquina en un turno, desde su ficha ─────────────
  const [assignFor, setAssignFor] = useState<Mach | null>(null);
  const [pickShift, setPickShift] = useState<Shift | null>(null);
  const [assignForQuery, setAssignForQuery] = useState('');

  // ── Reasignar (lote o individual) a otro inspector ─────────────────────
  const [reassign, setReassign] = useState<{ ids: string[] } | null>(null);
  const [reassignTo, setReassignTo] = useState<{ id: string; name: string } | null>(null);
  const [reassignQuery, setReassignQuery] = useState('');
  const [reassignBusy, setReassignBusy] = useState(false);

  const close = () => {
    setCheckMode('assign'); setCheckInspector(null); setInspQuery(''); setCheckQuery(''); setCheckFilter('mine');
    setSelIds(new Set()); setPendOpen(false); setPendQuery(''); setPendSelected(new Set()); setPendBatchOpen(false);
    setAssignFor(null); setPickShift(null); setReassign(null); setReassignTo(null); setNotice(null);
    onClose();
  };

  // Busca por cualquier característica de la máquina Y por el INSPECTOR que la
  // tiene asignada (☀️ día y 🌙 noche). Lo del inspector hace falta sobre todo en
  // el CHECK: para mover a alguien de turno hay que poder juntar SUS máquinas
  // escribiendo su nombre, y por código/empresa no hay forma de agruparlas.
  // `assignMap` ya está cargado aquí para pintar los turnos de cada fila.
  const matchQuery = (m: Mach, q: string) => {
    if (!q) return true;
    const asg = assignMap[m.id];
    return norm(m.code).includes(q)
      || norm(m.companyName || '').includes(q)
      || norm((m as any).serial || '').includes(q)
      || norm((m as any).plate || '').includes(q)
      || norm((m as any).encargado || '').includes(q)
      || norm((m as any).referencia || '').includes(q)
      || norm((m as any).tipo || '').includes(q)
      || norm(asg?.day?.name || '').includes(q)
      || norm(asg?.night?.name || '').includes(q);
  };

  // Listado del CHECK: máquinas ACTIVAS y OPERATIVAS (mismo criterio que el teléfono).
  // Tampoco EN ESPERA DE INSTRUCCIONES (pedido del cliente 11-ago-2026, congeladas):
  // antes esta lista SÍ las dejaba pasar aunque `necesitaInspector`/`visibleResumen`
  // (abajo) ya las excluían — la asignación real de inspector no estaba protegida.
  const checkList = useMemo(() => {
    const q = norm(checkQuery.trim());
    return machines.filter((m) => m.active !== false && m.operational !== false && !m.en_espera && matchQuery(m, q));
    // `assignMap`: ahora se busca también por inspector, así que la lista tiene que
    // recalcularse cuando llegan (o cambian) las asignaciones.
  }, [machines, checkQuery, assignMap]);

  const necesitaInspector = (m: Mach) => m.active !== false && (m as any).operational !== false && !m.en_espera;
  const esVirtual = (id?: string | null) => id === PLACEHOLDER_INSPECTOR_ID;
  const faltaTurno = (m: Mach) => {
    if (!necesitaInspector(m)) return { day: false, night: false };
    const s = assignMap[m.id] || {};
    return { day: !s.day?.id, night: !s.night?.id };
  };
  const faltaEncargadoReal = (m: Mach) => {
    if (!necesitaInspector(m)) return { day: false, night: false };
    const s = assignMap[m.id] || {};
    const dayFalta = !s.day?.id || (pendMode === 'sin_real' && esVirtual(s.day.id));
    const nightFalta = !s.night?.id || (pendMode === 'sin_real' && esVirtual(s.night.id));
    return { day: dayFalta, night: nightFalta };
  };
  const pendientesList = useMemo(() => {
    const q = norm(pendQuery.trim());
    return machines
      .filter((m) => { const f = faltaEncargadoReal(m); return f.day || f.night; })
      .filter((m) => matchQuery(m, q))
      .sort((a, b) => {
        const asg = (m: Mach) => { const s = assignMap[m.id] || {}; return (s.day?.id && !esVirtual(s.day.id) ? 1 : 0) + (s.night?.id && !esVirtual(s.night.id) ? 1 : 0); };
        const d = asg(a) - asg(b);
        return d !== 0 ? d : cmpText(a.code, b.code);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines, assignMap, pendQuery, pendMode]);
  const pendientesCount = useMemo(
    () => machines.reduce((n, m) => { const f = faltaEncargadoReal(m); return n + (f.day || f.night ? 1 : 0); }, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [machines, assignMap, pendMode]
  );

  // Visibles en el RESUMEN: activas y no en espera de recepción (una averiada/parada
  // pero activa sigue contando con su estado real — regla confirmada 08-ago-2026).
  const visibleResumen = (m: Mach) => m.active !== false && !m.en_espera;
  const resumenInspectores = useMemo(() => {
    const byId: Record<string, { id: string; name: string; day: Mach[]; night: Mach[] }> = {};
    const ensure = (id: string, name: string) => (byId[id] ||= { id, name, day: [], night: [] });
    machines.filter(visibleResumen).forEach((m) => {
      const s = assignMap[m.id] || {};
      if (s.day?.id) ensure(s.day.id, s.day.name).day.push(m);
      if (s.night?.id) ensure(s.night.id, s.night.name).night.push(m);
    });
    return Object.values(byId).sort((a, b) => cmpText(a.name, b.name));
  }, [machines, assignMap]);

  const edificioDe = (m: Mach): string | null => {
    const t = ((m as any).referencia ?? '').trim();
    return t && !/^[\d.,\s-]+$/.test(t) ? t : null;
  };
  const inspCount = (id: string) => Object.values(assignMap).filter((s) => s.day?.id === id || s.night?.id === id).length;
  const inspMachText = useMemo(() => {
    const acc: Record<string, string[]> = {};
    machines.forEach((m) => {
      const s = assignMap[m.id] || {};
      const ids: string[] = [];
      if (s.day?.id) ids.push(s.day.id);
      if (s.night?.id && s.night.id !== s.day?.id) ids.push(s.night.id);
      if (!ids.length) return;
      const mm = m as any;
      const txt = [m.code, m.companyName, mm.serial, mm.plate, mm.encargado, mm.referencia, mm.tipo]
        .filter(Boolean).join(' ');
      ids.forEach((id) => { (acc[id] ??= []).push(txt); });
    });
    const out: Record<string, string> = {};
    Object.keys(acc).forEach((id) => { out[id] = norm(acc[id].join(' ')); });
    return out;
  }, [machines, assignMap]);
  const matchInsp = (p: { id: string; name: string; role?: string | null }, q: string): boolean => {
    const nq = norm((q || '').trim());
    if (!nq) return true;
    if (norm(`${p.name} ${p.role || 'inspector'} ${inspCount(p.id)} maquinas`).includes(nq)) return true;
    return (inspMachText[p.id] || '').includes(nq);
  };

  // ── Acciones (idénticas al teléfono) ───────────────────────────────────
  const assignShift = async (m: Mach, shift: Shift) => {
    const target = checkInspector;
    if (!target || assignBusy) return;
    const slot = assignMap[m.id]?.[shift];
    const same = slot?.id === target.id;
    setAssignBusy(m.id + shift); setNotice(null);
    const res = same ? await unassignInspector(m.id, target.id, shift) : await assignInspector(m.id, target.id, target.name, shift);
    setAssignBusy(null);
    if (res.error) {
      setNotice(res.missing ? '❌ Falta activar la asignación: corre supabase/inspector_turno.sql en Supabase.' : '❌ ' + res.error);
      return;
    }
    await reloadAssigns();
    if (!same) logAudit('CHECK', 'machinery', m.id, `${m.code} · ${shiftLabel(shift)} → ${target.name}`);
    setNotice(same
      ? `➖ ${m.code} · ${shiftIcon(shift)} ${shiftLabel(shift)} quitado a ${target.name}.`
      : `✅ ${m.code} · ${shiftIcon(shift)} ${shiftLabel(shift)} asignada a ${target.name}.`);
  };

  const assignBatch = async (mode: 'day' | 'night' | 'both' | 'remove') => {
    const target = checkInspector;
    if (!target || batchBusy || selIds.size === 0) return;
    setBatchBusy(true); setNotice(null);
    const ids = Array.from(selIds);
    const shifts: Shift[] = mode === 'day' ? ['day'] : mode === 'night' ? ['night'] : ['day', 'night'];
    let ok = 0, err = 0, res: { error?: string; missing?: boolean } | null = null;
    for (const id of ids) {
      for (const sh of shifts) {
        if (mode === 'remove') {
          if (assignMap[id]?.[sh]?.id !== target.id) continue;
          res = await unassignInspector(id, target.id, sh);
        } else {
          res = await assignInspector(id, target.id, target.name, sh);
        }
        if (res?.error) err++; else ok++;
      }
    }
    await reloadAssigns();
    setBatchBusy(false);
    setSelIds(new Set());
    logAudit('CHECK', 'machinery', ids[0] ?? '', `LOTE ${mode} · ${ids.length} máquina(s) → ${target.name}`);
    if (err > 0 && ok === 0) {
      setNotice(res?.missing ? '❌ Falta activar la asignación: corre supabase/inspector_turno.sql en Supabase.' : `❌ No se pudo asignar el lote (${err} error/es).`);
      return;
    }
    const que = mode === 'both' ? 'Día + Noche' : mode === 'remove' ? 'quitado' : shiftLabel(mode as Shift);
    setNotice(mode === 'remove'
      ? `➖ Quitadas ${ok} asignación(es) a ${target.name}.${err ? ` (${err} con error)` : ''}`
      : `✅ ${que} asignado a ${ids.length} máquina(s) → ${target.name}.${err ? ` (${err} con error)` : ''}`);
  };
  const toggleSel = (id: string) => setSelIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const doReassign = async (mode: 'day' | 'night' | 'both') => {
    if (!reassign || !reassignTo || reassignBusy) return;
    setReassignBusy(true); setNotice(null);
    const ids = reassign.ids;
    const shifts: Shift[] = mode === 'day' ? ['day'] : mode === 'night' ? ['night'] : ['day', 'night'];
    let ok = 0, err = 0, res: { error?: string; missing?: boolean } | null = null;
    for (const id of ids) {
      for (const sh of shifts) {
        res = await assignInspector(id, reassignTo.id, reassignTo.name, sh);
        if (res?.error) err++; else ok++;
      }
    }
    await reloadAssigns();
    logAudit('CHECK', 'machinery', ids[0] ?? '', `REASIGNAR ${mode} · ${ids.length} máquina(s) → ${reassignTo.name}`);
    const que = mode === 'both' ? 'Día + Noche' : shiftLabel(mode as Shift);
    const dest = reassignTo.name;
    setReassignBusy(false); setSelIds(new Set());
    setReassign(null); setReassignTo(null); setReassignQuery('');
    if (err > 0 && ok === 0) {
      setNotice(res?.missing ? '❌ Falta activar la asignación: corre supabase/inspector_turno.sql en Supabase.' : `❌ No se pudo reasignar (${err} error/es).`);
      return;
    }
    setNotice(`↪ Reasignada(s) ${ids.length} máquina(s) · ${que} → ${dest}.${err ? ` (${err} con error)` : ''}`);
  };

  const setInspectorFor = async (m: Mach, shift: Shift, insp: { id: string; name: string } | null) => {
    if (assignBusy) return;
    setAssignBusy(m.id + shift); setNotice(null);
    const curId = assignMap[m.id]?.[shift]?.id ?? '';
    const res = insp
      ? await assignInspector(m.id, insp.id, insp.name, shift)
      : await unassignInspector(m.id, curId, shift);
    setAssignBusy(null);
    if (res.error) { setNotice(res.missing ? '❌ Falta activar la asignación: corre supabase/inspector_turno.sql en Supabase.' : '❌ ' + res.error); return; }
    await reloadAssigns();
    if (insp) logAudit('CHECK', 'machinery', m.id, `${m.code} · ${shiftLabel(shift)} → ${insp.name}`);
    setNotice(insp
      ? `✅ ${m.code} · ${shiftIcon(shift)} ${shiftLabel(shift)} → ${insp.name}.`
      : `➖ ${m.code} · ${shiftIcon(shift)} ${shiftLabel(shift)} quitado.`);
    setPickShift(null);
  };

  const assignPendBatch = async (insp: { id: string; name: string }) => {
    if (pendBatchBusy || pendSelected.size === 0) return;
    setPendBatchBusy(true); setNotice(null);
    const ids = Array.from(pendSelected);
    let ok = 0, fail = 0;
    for (const mid of ids) {
      const m = machines.find((x) => x.id === mid);
      const res = await assignInspector(mid, insp.id, insp.name, pendBatchShift);
      if (res.error) { fail++; }
      else { ok++; if (m) logAudit('CHECK', 'machinery', mid, `${m.code} · ${shiftLabel(pendBatchShift)} → ${insp.name} (lote)`); }
    }
    setPendBatchBusy(false);
    await reloadAssigns();
    setPendSelected(new Set());
    setPendBatchOpen(false);
    setNotice(`✅ Asignación por lotes: ${ok} máquina(s) OK${fail > 0 ? ` · ⚠️ ${fail} fallaron` : ''} · ${shiftIcon(pendBatchShift)} ${shiftLabel(pendBatchShift)} → ${insp.name}.`);
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <Screen>
        {loading ? <SkeletonList /> : (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>✅ CHECK máquina</Text>
                <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>
                  {checkInspector ? <>Inspector: <Text style={{ color: colors.primary, fontWeight: '800' }}>{checkInspector.name}</Text></> : 'Elige el inspector'}
                </Text>
              </View>
              <TouchableOpacity onPress={close} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Listo</Text>
              </TouchableOpacity>
            </View>

            {!pendOpen ? (
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
                {(['assign', 'resumen'] as const).map((mk) => {
                  const on = checkMode === mk;
                  return (
                    <TouchableOpacity key={mk} onPress={() => setCheckMode(mk)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{mk === 'assign' ? '👮 Asignar' : '📋 Resumen'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            {checkMode === 'resumen' && !pendOpen ? (
              <>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Máquinas asignadas por inspector (toca para desplegar) y las que faltan por asignar.</Text>
                <ScrollView style={{ marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                  {resumenInspectores.map((g) => {
                    const open = expanded.has(g.id);
                    return (
                      <View key={g.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: spacing.xs, overflow: 'hidden' }}>
                        <TouchableOpacity onPress={() => toggleExp(g.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md }}>
                          <Text style={{ fontSize: 18 }}>👮</Text>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800' }}>{g.name}</Text>
                            <Text style={{ color: colors.muted, fontSize: 11 }}>☀️ {g.day.length} día · 🌙 {g.night.length} noche</Text>
                          </View>
                          <Text style={{ color: colors.primary, fontWeight: '900' }}>{open ? '▲' : '▼'}</Text>
                        </TouchableOpacity>
                        {open ? (
                          <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
                            {(['day', 'night'] as const).map((sh) => (
                              g[sh].length > 0 ? (
                                <View key={sh} style={{ marginTop: spacing.xs }}>
                                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>{sh === 'day' ? '☀️ Día' : '🌙 Noche'} ({g[sh].length})</Text>
                                  {g[sh].map((m) => (
                                    <Text key={m.id} numberOfLines={1} style={{ color: colors.muted, fontSize: 12, paddingLeft: spacing.sm }}>• {m.code}{m.tipo ? ` · 🏷️ ${m.tipo}` : ''} · {m.companyName}</Text>
                                  ))}
                                </View>
                              ) : null
                            ))}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {resumenInspectores.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Aún no hay máquinas asignadas.</Text> : null}
                  <View style={{ borderWidth: 1.5, borderColor: colors.warning, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: spacing.sm, overflow: 'hidden' }}>
                    <TouchableOpacity onPress={() => toggleExp('pend')} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md }}>
                      <Text style={{ fontSize: 18 }}>🕓</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '900' }}>Faltan por asignar</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{pendientesCount} máquina(s) sin inspector en algún turno</Text>
                      </View>
                      <Text style={{ color: colors.warning, fontWeight: '900' }}>{expanded.has('pend') ? '▲' : String(pendientesCount)}</Text>
                    </TouchableOpacity>
                    {expanded.has('pend') ? (
                      <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
                        {pendientesList.map((m) => {
                          const f = faltaEncargadoReal(m);
                          return (
                            <Text key={m.id} numberOfLines={1} style={{ color: colors.muted, fontSize: 12, paddingVertical: 1 }}>
                              • {m.code}{m.tipo ? ` · 🏷️ ${m.tipo}` : ''} · {m.companyName} — {f.day && f.night ? 'falta día+noche' : f.day ? 'falta día' : 'falta noche'}
                            </Text>
                          );
                        })}
                        {pendientesList.length === 0 ? <Text style={{ color: colors.success, fontSize: 12 }}>Todo asignado 🎉</Text> : null}
                      </View>
                    ) : null}
                  </View>
                  <View style={{ height: spacing.xl }} />
                </ScrollView>
              </>
            ) : !checkInspector && pendOpen && pendBatchOpen ? (
              <>
                <TouchableOpacity onPress={() => setPendBatchOpen(false)} style={{ alignSelf: 'flex-start', marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>‹ Volver a la lista</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>📋 Asignar {pendSelected.size} máquina(s) por lotes</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Elige el turno y luego el inspector — se les asigna a TODAS las seleccionadas de una vez.</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                  {(['day', 'night'] as Shift[]).map((s) => (
                    <TouchableOpacity key={s} onPress={() => setPendBatchShift(s)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: pendBatchShift === s ? colors.primary : colors.border, backgroundColor: pendBatchShift === s ? colors.primary : colors.surface }}>
                      <Text style={{ color: pendBatchShift === s ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{shiftIcon(s)} {shiftLabel(s)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput value={pendBatchQuery} onChangeText={setPendBatchQuery} placeholder="🔎 Buscar inspector (nombre, rol, o cualquier dato de sus máquinas)…" placeholderTextColor={colors.muted} style={input} />
                <ScrollView style={{ marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                  {inspectors.filter((p) => matchInsp(p, pendBatchQuery)).map((p) => (
                    <TouchableOpacity key={p.id} disabled={pendBatchBusy} onPress={() => assignPendBatch({ id: p.id, name: p.name })} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs, opacity: pendBatchBusy ? 0.6 : 1 }}>
                      <Text style={{ fontSize: 20 }}>👮</Text>
                      <Text style={{ flex: 1, color: colors.text, fontWeight: '800' }}>{p.name}</Text>
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 18 }}>›</Text>
                    </TouchableOpacity>
                  ))}
                  {pendBatchBusy ? <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: spacing.sm }}>Asignando…</Text> : null}
                  <View style={{ height: spacing.xl }} />
                </ScrollView>
              </>
            ) : !checkInspector && pendOpen ? (
              <>
                <TouchableOpacity onPress={() => { setPendOpen(false); setPendQuery(''); setPendSelected(new Set()); }} style={{ alignSelf: 'flex-start', marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>‹ Volver a inspectores</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>🕓 Pendientes por asignar <Text style={{ color: colors.warning }}>({pendientesCount})</Text></Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                  {pendMode === 'sin_real'
                    ? 'Máquinas sin un inspector REAL: incluye las que no tienen a nadie y las que solo tiene el usuario de sistema 🤖 MAQUINAS FALTANTES (acumulan horas automáticas, pero nadie real las está inspeccionando).'
                    : 'Máquinas sin NINGÚN inspector, ni siquiera el del sistema (p. ej. quedaron sin dueño al borrar un inspector).'}
                  {' '}Toca <Text style={{ fontWeight: '800', color: colors.primary }}>👮 Asignar inspector</Text> para reasignarlas de una en una, o marca varias con el check ☑ para asignarlas por lotes.
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs }}>
                  {([['Sin encargado real', 'sin_real'], ['Sin nadie (estricto)', 'sin_nadie']] as const).map(([lbl, v]) => {
                    const on = pendMode === v;
                    return (
                      <TouchableOpacity key={v} onPress={() => setPendMode(v)} style={{ flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                        <Text numberOfLines={1} style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{lbl}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
                  <TouchableOpacity
                    onPress={() => setPendSelected((prev) => (prev.size === pendientesList.length ? new Set() : new Set(pendientesList.map((m) => m.id))))}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
                  >
                    <Text style={{ fontSize: 14 }}>{pendSelected.size > 0 && pendSelected.size === pendientesList.length ? '☑' : '☐'}</Text>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Seleccionar todas</Text>
                  </TouchableOpacity>
                  {pendSelected.size > 0 ? (
                    <TouchableOpacity onPress={() => setPendBatchOpen(true)} style={{ flex: 1, alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 6 }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>📋 Asignar {pendSelected.size} seleccionada(s)…</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <TextInput value={pendQuery} onChangeText={setPendQuery} placeholder="🔎 Buscar: nombre, serial, placa, tipo, empresa, encargado…" placeholderTextColor={colors.muted} style={input} />
                <ScrollView style={{ marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                  {pendientesList.slice(0, 200).map((m) => {
                    const f = faltaEncargadoReal(m);
                    const slots = assignMap[m.id] || {};
                    const edif = edificioDe(m);
                    const checked = pendSelected.has(m.id);
                    const turnoLabel = (sh: 'day' | 'night', falta: boolean) => {
                      const icon = sh === 'day' ? '☀️' : '🌙';
                      const slot = sh === 'day' ? slots.day : slots.night;
                      if (!slot?.id) return { text: `${icon} falta ${sh === 'day' ? 'día' : 'noche'}`, color: colors.warning };
                      if (esVirtual(slot.id)) return { text: `${icon} 🤖 sin encargado real`, color: colors.primary };
                      return { text: `${icon} ${slot.name}`, color: colors.success };
                    };
                    const dl = turnoLabel('day', f.day);
                    const nl = turnoLabel('night', f.night);
                    return (
                      <View key={m.id} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.surface, marginBottom: spacing.xs, flexDirection: 'row', gap: spacing.sm }}>
                        <TouchableOpacity
                          onPress={() => setPendSelected((prev) => { const n = new Set(prev); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}
                          style={{ paddingTop: 2 }}
                        >
                          <Text style={{ fontSize: 18 }}>{checked ? '☑' : '☐'}</Text>
                        </TouchableOpacity>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800' }}>🕓 {m.code}</Text>
                          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{((m as any).tipo || 'Sin tipo')} · {m.companyName} · {((m as any).plate || (m as any).serial || '—')}</Text>
                          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>📍 {edif || 'Sin edificio/referencia'}</Text>
                          {(m as any).encargado ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>👤 Encargado: {(m as any).encargado}</Text> : <View style={{ marginBottom: spacing.xs }} />}
                          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs, flexWrap: 'wrap' }}>
                            <Text style={{ fontSize: 11, fontWeight: '800', color: dl.color }}>{dl.text}</Text>
                            <Text style={{ fontSize: 11, fontWeight: '800', color: nl.color }}>{nl.text}</Text>
                          </View>
                          <TouchableOpacity onPress={() => { setAssignFor(m); setPickShift(f.day ? 'day' : 'night'); setAssignForQuery(''); }} style={{ alignSelf: 'flex-start', borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>👮 Asignar inspector</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                  {pendientesList.length === 0 ? <EmptyState title="Nada pendiente 🎉" subtitle="Todas las máquinas tienen inspector de día y de noche." /> : null}
                  <View style={{ height: spacing.xl }} />
                </ScrollView>
              </>
            ) : !checkInspector ? (
              <>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Selecciona el inspector al que le vas a asignar máquinas.</Text>
                <TouchableOpacity onPress={() => { setPendOpen(true); setPendQuery(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.warning, backgroundColor: colors.surface, marginBottom: spacing.sm }}>
                  <Text style={{ fontSize: 20 }}>🕓</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '900' }}>Pendientes por asignar</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{pendientesCount > 0 ? `${pendientesCount} máquina(s) sin inspector en algún turno` : 'Todo asignado'}</Text>
                  </View>
                  <Text style={{ color: colors.warning, fontWeight: '900', fontSize: 16 }}>{pendientesCount > 0 ? pendientesCount : '✓'}</Text>
                </TouchableOpacity>
                <TextInput value={inspQuery} onChangeText={setInspQuery} placeholder="🔎 Buscar inspector (nombre, rol, o cualquier dato de sus máquinas)…" placeholderTextColor={colors.muted} style={input} />
                <ScrollView style={{ marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                  {inspectors.filter((p) => matchInsp(p, inspQuery)).map((p) => {
                    const count = inspCount(p.id);
                    return (
                      <TouchableOpacity key={p.id} onPress={() => { setCheckInspector({ id: p.id, name: p.name }); setCheckQuery(''); setCheckFilter('mine'); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs }}>
                        <Text style={{ fontSize: 20 }}>👮</Text>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800' }}>{p.name}</Text>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>{p.role || 'inspector'}{count > 0 ? ` · ${count} máquina(s)` : ''}</Text>
                        </View>
                        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 18 }}>›</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {inspectors.length === 0 ? <EmptyState title="Sin inspectores" subtitle="No hay usuarios (no-admin) para asignar." /> : null}
                  <View style={{ height: spacing.xl }} />
                </ScrollView>
              </>
            ) : (
              (() => {
                const filtered = checkList.filter((m) => {
                  if (checkFilter === 'pending') { const f = faltaTurno(m); return f.day || f.night; }
                  if (checkFilter === 'mine') { const s = assignMap[m.id] || {}; return s.day?.id === checkInspector.id || s.night?.id === checkInspector.id; }
                  return true;
                });
                const shown = filtered.slice(0, 300);
                const allSel = shown.length > 0 && shown.every((m) => selIds.has(m.id));
                return (
                  <>
                    <TouchableOpacity onPress={() => { setCheckInspector(null); setInspQuery(''); setSelIds(new Set()); setCheckFilter('mine'); }} style={{ alignSelf: 'flex-start', marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>‹ Cambiar inspector</Text>
                    </TouchableOpacity>
                    <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                      Marca varias con ☑️ y asígnalas por LOTE a <Text style={{ fontWeight: '800', color: colors.text }}>{checkInspector.name}</Text>, o toca ☀️/🌙 en una para asignar/quitar directo. Reasignar es directo (si la tiene otro, se la pasas al elegido).
                    </Text>
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs }}>
                      {([['👤 Suyas', 'mine'], ['Todas', 'all'], ['Pendientes', 'pending']] as const).map(([lbl, v]) => {
                        const on = checkFilter === v;
                        return (
                          <TouchableOpacity key={lbl} onPress={() => setCheckFilter(v)} style={{ flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                            <Text numberOfLines={1} style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{lbl}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <TextInput value={checkQuery} onChangeText={setCheckQuery} placeholder="🔎 Buscar: nombre, serial, placa, tipo, empresa, encargado, inspector…" placeholderTextColor={colors.muted} style={input} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs }}>
                      <TouchableOpacity onPress={() => setSelIds(allSel ? new Set() : new Set(shown.map((m) => m.id)))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: allSel ? colors.primary : colors.border, backgroundColor: allSel ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                          {allSel ? <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
                        </View>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Seleccionar todas ({shown.length})</Text>
                      </TouchableOpacity>
                      {selIds.size > 0 ? <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>{selIds.size} seleccionada(s)</Text> : null}
                    </View>
                    {selIds.size > 0 ? (
                      <>
                        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>Asignar a <Text style={{ fontWeight: '800', color: colors.text }}>{checkInspector.name}</Text>:</Text>
                        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' }}>
                          {([['☀️ Día', 'day'], ['🌙 Noche', 'night'], ['☀️🌙 Ambos', 'both'], ['✖ Quitar', 'remove']] as const).map(([lbl, mode]) => (
                            <TouchableOpacity key={mode} disabled={batchBusy} onPress={() => assignBatch(mode)} style={{ flexGrow: 1, alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: mode === 'remove' ? colors.danger : colors.primary, backgroundColor: mode === 'remove' ? colors.surface : colors.primary, opacity: batchBusy ? 0.6 : 1 }}>
                              <Text style={{ color: mode === 'remove' ? colors.danger : colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{batchBusy ? '⏳' : lbl}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <TouchableOpacity onPress={() => { setReassign({ ids: Array.from(selIds) }); setReassignTo(null); setReassignQuery(''); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.xs, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.accent, backgroundColor: colors.accentSoftBg }}>
                          <Text style={{ color: colors.accentSoftText, fontWeight: '900', fontSize: 12 }}>↪ Reasignar {selIds.size} a otro inspector…</Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                    <ScrollView style={{ marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                      {shown.map((m) => {
                        const slots = assignMap[m.id] || {};
                        const on = slots.day?.id === checkInspector.id || slots.night?.id === checkInspector.id;
                        const sel = selIds.has(m.id);
                        const edif = edificioDe(m);
                        const shiftBtn = (shift: Shift) => {
                          const slot = slots[shift];
                          const mineHere = slot?.id === checkInspector.id;
                          const taken = !!slot && !mineHere;
                          const busy = assignBusy === m.id + shift;
                          return (
                            <TouchableOpacity
                              key={shift}
                              onPress={() => assignShift(m, shift)}
                              disabled={busy}
                              style={{ flex: 1, borderRadius: radius.md, borderWidth: 1.5, borderStyle: slot ? 'solid' : 'dashed', borderColor: mineHere ? colors.success : taken ? colors.warning : colors.border, backgroundColor: mineHere ? colors.successSoftBg : colors.surface, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}
                            >
                              <Text style={{ fontSize: 13, fontWeight: '800', color: mineHere ? colors.successSoftText : colors.text }}>
                                {busy ? '⏳ ' : ''}{shiftIcon(shift)} {shiftLabel(shift)}
                              </Text>
                              <Text numberOfLines={1} style={{ fontSize: 11, color: mineHere ? colors.success : taken ? colors.primary : colors.muted, fontWeight: '700' }}>
                                {mineHere ? '✓ Asignada (quitar)' : taken ? `↪ Reasignar (ahora: ${slot!.name})` : '＋ Asignar'}
                              </Text>
                            </TouchableOpacity>
                          );
                        };
                        return (
                          <View key={m.id} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: sel ? colors.primary : on ? colors.success : colors.border, backgroundColor: sel ? colors.surfaceAlt : on ? colors.successSoftBg : colors.surface, marginBottom: spacing.xs }}>
                            <TouchableOpacity onPress={() => toggleSel(m.id)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                              <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                                {sel ? <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
                              </View>
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800' }}>{on ? '✅ ' : ''}{m.code}</Text>
                                <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{((m as any).tipo || 'Sin tipo')} · {m.companyName} · {((m as any).plate || (m as any).serial || '—')}</Text>
                                <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>📍 {edif || 'Sin edificio/referencia'}</Text>
                                {(m as any).encargado ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>👤 Encargado: {(m as any).encargado}</Text> : null}
                              </View>
                            </TouchableOpacity>
                            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                              {shiftBtn('day')}
                              {shiftBtn('night')}
                            </View>
                            <TouchableOpacity onPress={() => { setReassign({ ids: [m.id] }); setReassignTo(null); setReassignQuery(''); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.xs, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoftBg }}>
                              <Text style={{ color: colors.accentSoftText, fontWeight: '800', fontSize: 11 }}>↪ Reasignar a otro inspector…</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                      {filtered.length === 0 ? (
                        <EmptyState
                          title="Sin resultados"
                          subtitle={checkFilter === 'mine' ? `${checkInspector.name} no tiene máquinas asignadas todavía. Toca "Todas" para buscar y asignarle.` : 'Prueba con otro nombre o quita el filtro.'}
                        />
                      ) : null}
                      <View style={{ height: spacing.xl }} />
                    </ScrollView>
                  </>
                );
              })()
            )}
            {notice ? <Text style={{ color: notice.startsWith('❌') || notice.startsWith('⚠️') ? colors.danger : colors.success, fontWeight: '700', marginTop: spacing.xs }}>{notice}</Text> : null}
          </>
        )}
      </Screen>

      {/* 👮 ASIGNAR/REASIGNAR INSPECTOR desde una máquina (usado por "Pendientes por asignar"). */}
      <Modal visible={!!assignFor} animationType="slide" onRequestClose={() => { setAssignFor(null); setPickShift(null); }}>
        <Screen>
          {assignFor ? (() => {
            const af = assignFor;
            return (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>👮 Asignar inspector</Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{af.code} · {af.companyName}</Text>
                    {af.tipo ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>🏷️ {af.tipo}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => { setAssignFor(null); setPickShift(null); }} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Listo</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                  Elige el inspector de <Text style={{ fontWeight: '800', color: colors.text }}>☀️ Día</Text> y <Text style={{ fontWeight: '800', color: colors.text }}>🌙 Noche</Text>. Reasignar es directo (no hace falta quitar antes).
                </Text>
                <ScrollView keyboardShouldPersistTaps="handled">
                  {(['day', 'night'] as Shift[]).map((sh) => {
                    const cur = assignMap[af.id]?.[sh];
                    const busy = assignBusy === af.id + sh;
                    return (
                      <View key={sh} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.surface }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: colors.text, fontWeight: '800' }}>{shiftIcon(sh)} {shiftLabel(sh)}</Text>
                            <Text numberOfLines={1} style={{ color: cur ? colors.primary : colors.muted, fontWeight: '700', fontSize: 13, marginTop: 2 }}>
                              {busy ? '⏳ Guardando…' : cur ? cur.name : 'Sin asignar'}
                            </Text>
                          </View>
                          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                            <TouchableOpacity onPress={() => { setPickShift(pickShift === sh ? null : sh); setAssignForQuery(''); }} disabled={busy} style={{ borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: busy ? 0.6 : 1 }}>
                              <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>{cur ? '↪ Cambiar' : '＋ Asignar'}</Text>
                            </TouchableOpacity>
                            {cur ? (
                              <TouchableOpacity onPress={() => setInspectorFor(af, sh, null)} disabled={busy} style={{ borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: busy ? 0.6 : 1 }}>
                                <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>Quitar</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        </View>
                        {pickShift === sh ? (
                          <View style={{ marginTop: spacing.sm }}>
                            <TextInput value={assignForQuery} onChangeText={setAssignForQuery} placeholder="🔎 Buscar inspector (nombre, rol, o cualquier dato de sus máquinas)…" placeholderTextColor={colors.muted} style={input} />
                            <ScrollView style={{ maxHeight: 240, marginTop: spacing.xs }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                              {inspectors.filter((p) => matchInsp(p, assignForQuery)).map((p) => (
                                <TouchableOpacity key={p.id} onPress={() => setInspectorFor(af, sh, { id: p.id, name: p.name })} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: cur?.id === p.id ? colors.success : colors.border, backgroundColor: cur?.id === p.id ? colors.successSoftBg : colors.surface, marginBottom: spacing.xs }}>
                                  <Text style={{ fontSize: 18 }}>👮</Text>
                                  <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontWeight: '800' }}>{p.name}</Text>
                                  {cur?.id === p.id ? <Text style={{ color: colors.success, fontWeight: '800', fontSize: 12 }}>✓ actual</Text> : null}
                                </TouchableOpacity>
                              ))}
                              {inspectors.length === 0 ? <EmptyState title="Sin inspectores" subtitle="No hay inspectores/coordinadores para asignar." /> : null}
                            </ScrollView>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {notice ? <Text style={{ color: notice.startsWith('❌') ? colors.danger : colors.success, fontWeight: '700', marginBottom: spacing.sm }}>{notice}</Text> : null}
                  <View style={{ height: spacing.xl }} />
                </ScrollView>
              </>
            );
          })() : null}
        </Screen>
      </Modal>

      {/* ↪ REASIGNAR a OTRO inspector (lote o individual). */}
      <Modal visible={!!reassign} transparent animationType="fade" onRequestClose={() => { setReassign(null); setReassignTo(null); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '85%', overflow: 'hidden' }}>
            <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>↪ Reasignar a otro inspector</Text>
                <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{reassign ? `${reassign.ids.length} máquina(s)` : ''}{reassignTo ? ` → ${reassignTo.name}` : ''}</Text>
              </View>
              <TouchableOpacity onPress={() => { setReassign(null); setReassignTo(null); }} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            {!reassignTo ? (
              <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Elige el inspector destino:</Text>
                <TextInput value={reassignQuery} onChangeText={setReassignQuery} placeholder="🔎 Buscar inspector (nombre, rol, o cualquier dato de sus máquinas)…" placeholderTextColor={colors.muted} style={input} />
                <ScrollView style={{ maxHeight: 320, marginTop: spacing.xs }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {inspectors.filter((p) => matchInsp(p, reassignQuery)).map((p) => (
                    <TouchableOpacity key={p.id} onPress={() => setReassignTo({ id: p.id, name: p.name })} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs }}>
                      <Text style={{ fontSize: 18 }}>👮</Text>
                      <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontWeight: '800' }}>{p.name}</Text>
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 18 }}>›</Text>
                    </TouchableOpacity>
                  ))}
                  {inspectors.length === 0 ? <EmptyState title="Sin inspectores" subtitle="No hay inspectores/coordinadores para asignar." /> : null}
                </ScrollView>
              </View>
            ) : (
              <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
                <TouchableOpacity onPress={() => { setReassignTo(null); setReassignQuery(''); }} style={{ alignSelf: 'flex-start', marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>‹ Cambiar inspector</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
                  Mover {reassign?.ids.length} máquina(s) a <Text style={{ fontWeight: '900', color: colors.text }}>{reassignTo.name}</Text>. ¿En qué turno?
                </Text>
                <View style={{ gap: spacing.xs }}>
                  {([['☀️ Día', 'day'], ['🌙 Noche', 'night'], ['☀️🌙 Ambos (día y noche)', 'both']] as const).map(([lbl, mode]) => (
                    <TouchableOpacity key={mode} disabled={reassignBusy} onPress={() => doReassign(mode)} style={{ alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primary, opacity: reassignBusy ? 0.6 : 1 }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 14 }}>{reassignBusy ? '⏳ Moviendo…' : lbl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </Modal>
  );
}
