import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Modal, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { norm, cmpText } from '../lib/text';
import { equipCategory } from '../lib/equipos';
import { exportPdf } from '../lib/pdf';
import { inspeccionHtml, InspeccionPdfItem } from '../lib/inspeccion';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { levelMeets } from '../lib/permissions';
import { spacing, radius } from '../theme';
import type { MachineInspection, InspectionItem, InspectionNote } from '../types/database';

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasNowTime(): string {
  const p: any = new Intl.DateTimeFormat('en-GB', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.hour}:${p.minute}`;
}
/** "AAAA-MM-DD" → "dd/mm/aaaa". */
function dmy(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
/** "HH:MM" (24h) → "12:48 pm". */
function to12h(hhmm: string): string {
  const [hs, ms] = (hhmm || '').split(':');
  let h = Number(hs); const m = ms ?? '00';
  if (!isFinite(h)) return hhmm;
  const ap = h < 12 ? 'am' : 'pm';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m} ${ap}`;
}

type Machine = { id: string; code: string; plate: string | null; serial: string | null; tipo: string | null; clasificacion: string | null; company: string };

const NIVELES: { v: 'ok' | 'warn' | 'bad'; label: string; color: string }[] = [
  { v: 'ok', label: '🟢 Bien', color: '#15803D' },
  { v: 'warn', label: '🟠 Regular', color: '#EA6A1F' },
  { v: 'bad', label: '🔴 Falla', color: '#DC2626' },
];
const nivelColor = (n: string) => NIVELES.find((x) => x.v === n)?.color ?? '#15803D';

type EditItem = { descripcion: string; cantidad: string; unidad: string; serial: string; estado: string; nivel: 'ok' | 'warn' | 'bad' };
const blankItem = (): EditItem => ({ descripcion: '', cantidad: '1', unidad: 'Unid.', serial: '', estado: 'Operativo', nivel: 'ok' });

/**
 * INSPECCIONES DE MAQUINARIA (control por equipo): lista buscable de equipos; al
 * tocar uno se ve su detalle + historial de inspecciones y se puede crear una
 * NUEVA inspección (inventario de equipos/herramientas con su estado) que genera
 * el REPORTE DE INSPECCIÓN en PDF con los estilos del sistema.
 */
export default function InspeccionesScreen() {
  const { colors } = useTheme();
  const { session, moduleLevel } = useAuth();
  const canWrite = levelMeets(moduleLevel('inspecciones_maq'), 'escritura');

  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Machine | null>(null);
  const [history, setHistory] = useState<MachineInspection[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  // Formulario de nueva inspección.
  const [inspDate, setInspDate] = useState(caracasToday());
  const [inspTime, setInspTime] = useState(caracasNowTime());
  const [items, setItems] = useState<EditItem[]>([blankItem()]);
  const [condicion, setCondicion] = useState('');
  const [notas, setNotas] = useState<InspectionNote[]>([]);
  const [inspector, setInspector] = useState('');
  const [operador, setOperador] = useState('');
  const [busy, setBusy] = useState(false);

  const loadMachines = React.useCallback(async () => {
    const { data } = await supabase
      .from('machinery')
      .select('id, code, plate, serial, tipo, clasificacion, company:company_id(name)')
      .order('code', { ascending: true });
    setMachines((data ?? []).map((m: any) => ({
      id: m.id, code: m.code ?? '—', plate: m.plate ?? null, serial: m.serial ?? null,
      tipo: m.tipo ?? null, clasificacion: m.clasificacion ?? null, company: m.company?.name ?? 'Sin empresa',
    })));
  }, []);
  useEffect(() => { loadMachines(); }, [loadMachines]);

  const loadHistory = React.useCallback(async (machineId: string) => {
    setHistory(null);
    const { data } = await supabase
      .from('machine_inspections')
      .select('*')
      .eq('machinery_id', machineId)
      .order('inspected_at', { ascending: false })
      .limit(100);
    setHistory((data as MachineInspection[]) ?? []);
  }, []);

  const machineType = (m: Machine) => (m.tipo && m.tipo.trim()) || equipCategory(m.code) || m.code;

  const nq = norm(q.trim());
  const shown = useMemo(() => {
    const list = machines ?? [];
    if (!nq) return list;
    return list.filter((m) => norm([m.code, m.plate, m.serial, m.tipo, m.clasificacion, m.company].filter(Boolean).join(' ')).includes(nq));
  }, [machines, nq]);

  const openMachine = (m: Machine) => { setSelected(m); loadHistory(m.id); };

  // Abre el formulario: si hay inspecciones previas, PRECARGA los ítems de la última
  // (control por equipo: el inventario del equipo se mantiene y solo se ajusta).
  const openForm = () => {
    const last = (history ?? [])[0];
    if (last && Array.isArray(last.items) && last.items.length) {
      setItems(last.items.map((it) => ({
        descripcion: it.descripcion ?? '', cantidad: String(it.cantidad ?? 1), unidad: it.unidad ?? 'Unid.',
        serial: it.serial ?? '', estado: it.estado ?? '', nivel: (it.nivel as any) ?? 'ok',
      })));
      setCondicion(last.condicion_general ?? '');
      setNotas(Array.isArray(last.observaciones) ? last.observaciones : []);
    } else {
      setItems([blankItem()]); setCondicion(''); setNotas([]);
    }
    setInspDate(caracasToday()); setInspTime(caracasNowTime());
    setInspector(''); setOperador('');
    setFormOpen(true);
  };

  const setItem = (i: number, patch: Partial<EditItem>) => setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((prev) => [...prev, blankItem()]);
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const addNota = () => setNotas((prev) => [...prev, { label: '', text: '' }]);
  const setNota = (i: number, patch: Partial<InspectionNote>) => setNotas((prev) => prev.map((n, idx) => (idx === i ? { ...n, ...patch } : n)));
  const removeNota = (i: number) => setNotas((prev) => prev.filter((_, idx) => idx !== i));

  // Construye los ítems limpios (para guardar y para el PDF).
  const cleanItems = (): InspectionItem[] => items
    .filter((it) => it.descripcion.trim())
    .map((it) => ({
      descripcion: it.descripcion.trim(), cantidad: Number(it.cantidad) || 0, unidad: it.unidad.trim() || 'Unid.',
      serial: it.serial.trim() || null, estado: it.estado.trim() || '—', nivel: it.nivel,
    }));
  const cleanNotas = (): InspectionNote[] => notas.filter((n) => n.label.trim() || n.text.trim()).map((n) => ({ label: n.label.trim(), text: n.text.trim() }));

  const buildPdfData = (m: Machine, its: InspeccionPdfItem[], cond: string, obs: InspectionNote[], fecha: string, hora: string, insp: string, oper: string) => ({
    machineName: m.code, machineType: machineType(m), plate: m.plate, serial: m.serial,
    fecha, hora, items: its, condicionGeneral: cond || null, observaciones: obs, inspector: insp || null, operator: oper || null,
  });

  const guardarYPdf = async () => {
    if (!selected) return;
    const its = cleanItems();
    if (its.length === 0) return Alert.alert('Aviso', 'Agrega al menos un ítem con descripción.');
    setBusy(true);
    const inspectedAt = `${inspDate}T${inspTime || '00:00'}:00-04:00`;
    const obs = cleanNotas();
    const { error } = await supabase.from('machine_inspections').insert({
      machinery_id: selected.id, machine_code: selected.code, machine_type: machineType(selected),
      machine_plate: selected.plate, machine_serial: selected.serial, inspected_at: inspectedAt,
      inspector_name: inspector.trim() || null, operator_name: operador.trim() || null,
      condicion_general: condicion.trim() || null, observaciones: obs, items: its,
      created_by: session?.user?.id ?? null,
    });
    setBusy(false);
    if (error) return Alert.alert('Aviso', error.message);
    setFormOpen(false);
    loadHistory(selected.id);
    await exportPdf(
      inspeccionHtml(buildPdfData(selected, its, condicion.trim(), obs, dmy(inspDate), to12h(inspTime), inspector.trim(), operador.trim())),
      `REPORTE DE INSPECCION - ${selected.code}`
    );
  };

  // Reimprime una inspección guardada del historial.
  const reimprimir = async (m: Machine, r: MachineInspection) => {
    const its: InspeccionPdfItem[] = (r.items ?? []).map((it) => ({ descripcion: it.descripcion, cantidad: it.cantidad, unidad: it.unidad, serial: it.serial, estado: it.estado, nivel: it.nivel }));
    const dt = new Date(r.inspected_at);
    const fecha = new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(dt);
    const hora = new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(dt);
    await exportPdf(
      inspeccionHtml(buildPdfData(m, its, r.condicion_general ?? '', r.observaciones ?? [], fecha, hora, r.inspector_name ?? '', r.operator_name ?? '')),
      `REPORTE DE INSPECCION - ${m.code}`
    );
  };

  const histFmt = (iso: string) => {
    try { return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso)); } catch { return iso; }
  };

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>🔍 Inspecciones de Maquinaria</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Busca un equipo por placa/serial o nombre, tócalo para ver su detalle y generar su REPORTE DE INSPECCIÓN.
      </Text>

      <TextInput
        value={q} onChangeText={setQ}
        placeholder="🔎 Buscar por placa, serial o nombre…" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
      />

      {machines === null ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title={nq ? 'Sin resultados' : 'Sin equipos'} subtitle={nq ? 'Prueba con otra búsqueda.' : undefined} />
      ) : (
        shown.map((m) => (
          <TouchableOpacity key={m.id} onPress={() => openMachine(m)} activeOpacity={0.7}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text style={{ fontSize: 20 }}>🔧</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{m.code}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {[m.plate && `Placa: ${m.plate}`, m.serial && `Serial: ${m.serial}`].filter(Boolean).join(' · ') || 'Sin placa/serial'}
                  </Text>
                  <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>🏢 {m.company}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
              </View>
            </Card>
          </TouchableOpacity>
        ))
      )}

      {/* Detalle del equipo + historial de inspecciones */}
      <Modal visible={!!selected} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '88%' }}>
            {selected ? (
              <>
                <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, paddingRight: spacing.sm }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>{selected.code}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{machineType(selected)}</Text>
                    </View>
                    <TouchableOpacity onPress={() => setSelected(null)}>
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 20 }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ marginTop: spacing.xs, gap: 2 }}>
                    {selected.plate ? <Text style={{ color: colors.text, fontSize: 12 }}>🔖 Placa: <Text style={{ fontWeight: '700' }}>{selected.plate}</Text></Text> : null}
                    {selected.serial ? <Text style={{ color: colors.text, fontSize: 12 }}>🔖 Serial: <Text style={{ fontWeight: '700' }}>{selected.serial}</Text></Text> : null}
                    <Text style={{ color: colors.text, fontSize: 12 }}>🏢 Empresa: <Text style={{ fontWeight: '700' }}>{selected.company}</Text></Text>
                    {selected.clasificacion ? <Text style={{ color: colors.text, fontSize: 12 }}>🗂️ {selected.clasificacion}</Text> : null}
                  </View>

                  {canWrite ? (
                    <TouchableOpacity onPress={openForm} style={{ marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>📋 REPORTE DE INSPECCIÓN (nueva)</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>Historial de inspecciones</Text>
                  {history === null ? (
                    <Loading />
                  ) : history.length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Aún no hay inspecciones de este equipo.</Text>
                  ) : history.map((r) => (
                    <TouchableOpacity key={r.id} onPress={() => reimprimir(selected, r)} style={{ paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>🗓️ {histFmt(r.inspected_at)}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{(r.items ?? []).length} ítem(s){r.inspector_name ? ` · Inspector: ${r.inspector_name}` : ''}</Text>
                      </View>
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>📄 PDF</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Formulario de NUEVA inspección */}
      <Modal visible={formOpen} animationType="slide" transparent onRequestClose={() => setFormOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '92%' }}>
            <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>Nueva inspección · {selected?.code}</Text>
              <TouchableOpacity onPress={() => setFormOpen(false)}><Text style={{ color: colors.primary, fontWeight: '800', fontSize: 20 }}>✕</Text></TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm }}>
              {/* Fecha y hora */}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3 }}>Fecha</Text>
                  <DateField value={inspDate} onChange={setInspDate} maxISO={caracasToday()} />
                </View>
                <View style={{ width: 110 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3 }}>Hora (HH:MM)</Text>
                  <TextInput value={inspTime} onChangeText={(t) => setInspTime(t.replace(/[^0-9:]/g, '').slice(0, 5))} placeholder="12:48" placeholderTextColor={colors.muted}
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                </View>
              </View>

              {/* Inspector / operador */}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3 }}>Inspector (firma)</Text>
                  <TextInput value={inspector} onChangeText={setInspector} placeholder="Nombre del inspector" placeholderTextColor={colors.muted}
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 3 }}>Chofer / Operador</Text>
                  <TextInput value={operador} onChangeText={setOperador} placeholder="Nombre del operador" placeholderTextColor={colors.muted}
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                </View>
              </View>

              {/* Ítems del inventario */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>1. Inventario de equipos / herramientas</Text>
                <TouchableOpacity onPress={addItem} style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 }}>
                  <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>+ Ítem</Text>
                </TouchableOpacity>
              </View>

              {items.map((it, i) => (
                <View key={i} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: 6, backgroundColor: colors.surface }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>Ítem {i + 1}</Text>
                    {items.length > 1 ? <TouchableOpacity onPress={() => removeItem(i)}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>Quitar</Text></TouchableOpacity> : null}
                  </View>
                  <TextInput value={it.descripcion} onChangeText={(t) => setItem(i, { descripcion: t })} placeholder="Descripción del equipo / herramienta" placeholderTextColor={colors.muted}
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.xs, color: colors.text }} />
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TextInput value={it.cantidad} onChangeText={(t) => setItem(i, { cantidad: t.replace(/[^0-9.]/g, '') })} keyboardType="numeric" placeholder="Cant." placeholderTextColor={colors.muted}
                      style={{ width: 60, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.xs, color: colors.text }} />
                    <TextInput value={it.unidad} onChangeText={(t) => setItem(i, { unidad: t })} placeholder="Unid." placeholderTextColor={colors.muted}
                      style={{ width: 80, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.xs, color: colors.text }} />
                    <TextInput value={it.serial} onChangeText={(t) => setItem(i, { serial: t })} placeholder="Serial / Especificación" placeholderTextColor={colors.muted}
                      style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.xs, color: colors.text }} />
                  </View>
                  <TextInput value={it.estado} onChangeText={(t) => setItem(i, { estado: t })} placeholder="Estado / Condición (ej. Operativo, Verificado…)" placeholderTextColor={colors.muted}
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.xs, color: nivelColor(it.nivel), fontWeight: '700' }} />
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {NIVELES.map((n) => {
                      const on = it.nivel === n.v;
                      return (
                        <TouchableOpacity key={n.v} onPress={() => setItem(i, { nivel: n.v })} style={{ flex: 1, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: on ? n.color : colors.border, backgroundColor: on ? n.color : colors.surface, alignItems: 'center' }}>
                          <Text style={{ color: on ? '#fff' : colors.text, fontSize: 11, fontWeight: '800' }}>{n.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}

              {/* Observaciones */}
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginTop: spacing.sm }}>2. Observaciones generales</Text>
              <TextInput value={condicion} onChangeText={setCondicion} placeholder="Condición general del equipo…" placeholderTextColor={colors.muted} multiline
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, minHeight: 54, textAlignVertical: 'top' }} />
              {notas.map((n, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                  <TextInput value={n.label} onChangeText={(t) => setNota(i, { label: t })} placeholder="Título" placeholderTextColor={colors.muted}
                    style={{ width: 110, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.xs, color: colors.text }} />
                  <TextInput value={n.text} onChangeText={(t) => setNota(i, { text: t })} placeholder="Detalle" placeholderTextColor={colors.muted} multiline
                    style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.xs, color: colors.text }} />
                  <TouchableOpacity onPress={() => removeNota(i)} style={{ paddingTop: spacing.xs }}><Text style={{ color: colors.danger, fontWeight: '800' }}>✕</Text></TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity onPress={addNota}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>+ Agregar observación</Text></TouchableOpacity>

              <TouchableOpacity onPress={guardarYPdf} disabled={busy} style={{ marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.7 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : '💾 Guardar y generar REPORTE DE INSPECCIÓN'}</Text>
              </TouchableOpacity>
              <View style={{ height: spacing.lg }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
