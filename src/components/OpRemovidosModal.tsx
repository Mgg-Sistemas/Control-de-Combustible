// ⛰️ M³ REMOVIDOS HOY — POR EDIFICIO (Obras Públicas), MULTI-SELECCIÓN.
// Segmento INDEPENDIENTE (no por máquina): se muestra la lista de edificios
// agrupada por SUB-SECTOR y en cada fila se teclea la cantidad de m³ removidos
// del día. Un solo "Guardar" registra TODOS los que tengan cantidad. El acumulado
// se teclea manual la 1ª vez (base) por edificio y luego crece con los removidos.
// Cada cantidad suma a los totales del día Y a los acumulados.
// Ver src/lib/obrasPublicas.ts y supabase/op_edificio_removidos.sql.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, ActivityIndicator, Switch, Linking } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { norm, cmpText } from '../lib/text';
import { fetchEdificiosConSector, addEdificio, EdificioConSector } from '../lib/edificios';
import { fetchEdificioResumen, saveEdificioRemovido, fetchEdificioReportesDia, listMyOpMachines, listOpExternalMachines, addOpExternalMachine, OpEdificioResumen, OpEdificioDetalle, OpMyMachine } from '../lib/obrasPublicas';
import { buildOpEdificioWhatsApp } from '../lib/obrasPublicasReport';
import { useToast } from './ToastProvider';

// El detalle (Fase 2) se teclea como texto y se convierte a números al guardar.
type DetForm = {
  m3_acarreados?: string; viajes?: string; avance?: string;
  maq_en_uso?: string; maq_inoperativo?: string; maq_requerimiento?: string;
  supervivientes?: string; fallecidos?: string; actividades?: string; entregado?: boolean;
};
const hasDetForm = (f?: DetForm): boolean =>
  !!f && (!!(f.m3_acarreados || '').trim() || !!(f.viajes || '').trim() || !!(f.avance || '').trim() ||
    !!(f.maq_en_uso || '').trim() || !!(f.maq_inoperativo || '').trim() || !!(f.maq_requerimiento || '').trim() ||
    !!(f.supervivientes || '').trim() || !!(f.fallecidos || '').trim() || !!(f.actividades || '').trim() || !!f.entregado);

const SIN_SECTOR = 'SIN SUB-SECTOR';
const fmt = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return (Number.isInteger(r) ? r.toString() : r.toFixed(2)).replace('.', ',');
};
const numOf = (s: string) => Number((s || '').replace(',', '.'));

export default function OpRemovidosModal({
  visible, onClose, date, supervisorId, supervisorName, onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  date: string;                       // fecha del día (YYYY-MM-DD)
  supervisorId?: string | null;
  supervisorName?: string | null;
  onChanged?: () => void;             // avisa al padre para refrescar KPIs
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resumen, setResumen] = useState<Record<string, OpEdificioResumen>>({});
  const [edificios, setEdificios] = useState<EdificioConSector[]>([]);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const [q, setQ] = useState('');
  const [sectorFiltro, setSectorFiltro] = useState<string | null>(null);
  // Cantidades tecleadas por edificio (m³ hoy) y base (acumulado 1ª vez).
  const [values, setValues] = useState<Record<string, string>>({});
  const [bases, setBases] = useState<Record<string, string>>({});
  // Detalle (Fase 2) por edificio + qué edificios tienen el detalle abierto.
  const [detalles, setDetalles] = useState<Record<string, DetForm>>({});
  const [openDet, setOpenDet] = useState<Record<string, boolean>>({});
  const [sharing, setSharing] = useState(false);
  // Máquinas para "maquinaria por requerimiento" = asignadas ∪ externas (fuera del catálogo).
  const [misMaquinas, setMisMaquinas] = useState<OpMyMachine[]>([]);
  const [addMaq, setAddMaq] = useState<Record<string, string>>({}); // texto "nueva máquina externa" por edificio
  const [addingMaq, setAddingMaq] = useState(false);

  // Agregar un edificio nuevo al catálogo.
  const [addName, setAddName] = useState('');
  const [addSector, setAddSector] = useState('');
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [r, e, reps, maqs, ext] = await Promise.all([
        // Por usuario: cada supervisor ve SOLO sus edificios/removidos.
        fetchEdificioResumen(date, supervisorId), fetchEdificiosConSector(), fetchEdificioReportesDia(date, supervisorId),
        supervisorId ? listMyOpMachines(supervisorId).catch(() => [] as OpMyMachine[]) : Promise.resolve([] as OpMyMachine[]),
        // Máquinas externas: si aún no se corrió op_external_machines.sql, degrada a [].
        listOpExternalMachines(supervisorId).catch(() => [] as OpMyMachine[]),
      ]);
      setResumen(r);
      setEdificios(e);
      // asignadas ∪ externas, sin duplicar por código.
      const merged: OpMyMachine[] = [...maqs];
      ext.forEach((m) => { if (!merged.some((x) => norm(x.code) === norm(m.code))) merged.push(m); });
      setMisMaquinas(merged.sort((a, b) => cmpText(a.code, b.code)));
      // Precarga: los removidos ya registrados HOY se muestran para poder corregirlos.
      const v: Record<string, string> = {};
      Object.values(r).forEach((x) => { if (x.removido_hoy > 0) v[x.edificio] = String(x.removido_hoy); });
      setValues(v);
      setBases({});
      // Precarga del detalle ya guardado (Fase 2), para poder corregirlo.
      const dmap: Record<string, DetForm> = {};
      reps.forEach((rep) => {
        const f: DetForm = {};
        if (rep.m3_acarreados) f.m3_acarreados = String(rep.m3_acarreados);
        if (rep.viajes) f.viajes = String(rep.viajes);
        if (rep.avance != null) f.avance = String(rep.avance);
        if (rep.maq_en_uso) f.maq_en_uso = rep.maq_en_uso;
        if (rep.maq_inoperativo) f.maq_inoperativo = rep.maq_inoperativo;
        if (rep.maq_requerimiento) f.maq_requerimiento = rep.maq_requerimiento;
        if (rep.supervivientes) f.supervivientes = String(rep.supervivientes);
        if (rep.fallecidos) f.fallecidos = String(rep.fallecidos);
        if (rep.actividades) f.actividades = rep.actividades;
        if (rep.entregado) f.entregado = true;
        if (Object.keys(f).length) dmap[rep.edificio] = f;
      });
      setDetalles(dmap);
      setOpenDet({});
    } catch (err: any) {
      setMsg({ tone: 'err', text: 'No se pudo cargar: ' + (err?.message ?? 'error') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) { setMsg(null); setQ(''); setSectorFiltro(null); setAddName(''); setAddSector(''); reload(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Sub-sectores para el filtro de chips.
  const sectores = useMemo(() => {
    const set = new Set<string>();
    edificios.forEach((e) => set.add((e.sub_sector ?? '').trim() || SIN_SECTOR));
    return Array.from(set).sort(cmpText);
  }, [edificios]);

  // Lista agrupada por sub-sector (filtrada por búsqueda + sub-sector).
  const grupos = useMemo(() => {
    const n = norm(q);
    const filt = edificios.filter((e) => {
      const sec = (e.sub_sector ?? '').trim() || SIN_SECTOR;
      if (sectorFiltro && sec !== sectorFiltro) return false;
      return !n || norm(e.name).includes(n) || norm(sec).includes(n);
    });
    const map = new Map<string, string[]>();
    filt.forEach((e) => {
      const sec = (e.sub_sector ?? '').trim() || SIN_SECTOR;
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push(e.name);
    });
    return Array.from(map.entries()).sort((a, b) => cmpText(a[0], b[0]))
      .map(([sec, items]) => [sec, items.sort(cmpText)] as [string, string[]]);
  }, [edificios, q, sectorFiltro]);

  // Totales: hoy (en vivo, según lo tecleado) y acumulado (guardado).
  const totalHoy = useMemo(
    () => Object.values(values).reduce((a, s) => { const n = numOf(s); return a + (isFinite(n) && n > 0 ? n : 0); }, 0),
    [values],
  );
  const totalAcum = useMemo(() => Object.values(resumen).reduce((a, r) => a + r.acumulado, 0), [resumen]);
  const marcados = useMemo(() => Object.entries(values).filter(([, s]) => { const n = numOf(s); return isFinite(n) && n > 0; }).length, [values]);
  // Edificios a guardar = con m³ (>0) ∪ con detalle (Fase 2).
  const savables = useMemo(() => {
    const set = new Set<string>();
    Object.entries(values).forEach(([e, s]) => { const n = numOf(s); if (isFinite(n) && n > 0) set.add(e); });
    Object.keys(detalles).forEach((e) => { if (hasDetForm(detalles[e])) set.add(e); });
    return set.size;
  }, [values, detalles]);

  const setVal = (edif: string, s: string) => setValues((p) => ({ ...p, [edif]: s }));
  const setBase = (edif: string, s: string) => setBases((p) => ({ ...p, [edif]: s }));
  const setDet = (edif: string, patch: Partial<DetForm>) =>
    setDetalles((p) => ({ ...p, [edif]: { ...(p[edif] || {}), ...patch } }));

  // "Maquinaria por requerimiento" = selección de las máquinas asignadas.
  // Se guarda como códigos separados por coma en el campo de texto maq_requerimiento.
  const reqCodes = (edif: string): string[] =>
    (detalles[edif]?.maq_requerimiento || '').split(',').map((s) => s.trim()).filter(Boolean);
  const toggleReq = (edif: string, code: string) => {
    const cur = reqCodes(edif);
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    setDet(edif, { maq_requerimiento: next.join(', ') });
  };
  // Añade una máquina EXTERNA (fuera del catálogo), la agrega al picker y la marca.
  // NO recarga (para no perder el detalle sin guardar); solo suma a misMaquinas.
  const agregarMaqExterna = async (edif: string) => {
    const nombre = (addMaq[edif] ?? '').trim();
    if (!nombre) return;
    setAddingMaq(true);
    try {
      const code = await addOpExternalMachine(nombre, supervisorId);
      if (code) {
        setMisMaquinas((p) => (p.some((m) => norm(m.code) === norm(code))
          ? p
          : [...p, { id: `ext:${code}`, code, plate: null, serial: null }].sort((a, b) => cmpText(a.code, b.code))));
        if (!reqCodes(edif).includes(code)) toggleReq(edif, code); // auto-marca
        setAddMaq((p) => ({ ...p, [edif]: '' }));
      }
    } catch (e: any) {
      setMsg({ tone: 'err', text: 'No se pudo agregar la máquina externa: ' + (e?.message ?? 'error') });
    } finally { setAddingMaq(false); }
  };

  // DetForm (texto) → OpEdificioDetalle (números) para guardar.
  const toDetalle = (f?: DetForm): OpEdificioDetalle | undefined => {
    if (!hasDetForm(f)) return undefined;
    const g = f!;
    return {
      m3_acarreados: numOf(g.m3_acarreados || '') || 0,
      viajes: Math.round(numOf(g.viajes || '') || 0),
      avance: (g.avance || '').trim() === '' ? null : Math.round(numOf(g.avance || '') || 0),
      maq_en_uso: (g.maq_en_uso || '').trim() || null,
      maq_inoperativo: (g.maq_inoperativo || '').trim() || null,
      maq_requerimiento: (g.maq_requerimiento || '').trim() || null,
      supervivientes: Math.round(numOf(g.supervivientes || '') || 0),
      fallecidos: Math.round(numOf(g.fallecidos || '') || 0),
      actividades: (g.actividades || '').trim() || null,
      entregado: !!g.entregado,
    };
  };

  // Enviar por WhatsApp el reporte del día (usa lo YA guardado).
  const enviarWhatsApp = async () => {
    setSharing(true); setMsg(null);
    try {
      const texto = await buildOpEdificioWhatsApp(date, supervisorId);
      if (!texto) { setMsg({ tone: 'err', text: 'No hay nada reportado hoy. Guarda primero los m³/detalle.' }); return; }
      await Linking.openURL('https://wa.me/?text=' + encodeURIComponent(texto));
    } catch {
      setMsg({ tone: 'err', text: 'No se pudo abrir WhatsApp.' });
    } finally { setSharing(false); }
  };

  const agregarEdificio = async () => {
    const nombre = addName.trim();
    if (!nombre) return;
    setAdding(true);
    try {
      const saved = await addEdificio(nombre, addSector.trim() || null);
      if (!saved) { setMsg({ tone: 'err', text: 'No se pudo agregar el edificio.' }); return; }
      setAddName(''); setAddSector('');
      await reload();
      setMsg({ tone: 'ok', text: `Edificio agregado: ${saved}. Ya puedes ponerle m³.` });
    } finally { setAdding(false); }
  };

  const guardar = async () => {
    // Edificios con una cantidad válida (>0) tecleada.
    const conM3 = Object.entries(values)
      .map(([edif, s]) => ({ edif, m3: numOf(s) }))
      .filter(({ m3 }) => isFinite(m3) && m3 > 0);
    // Edificios SIN m³ pero con detalle (Fase 2) → también se guardan (m³ = lo ya guardado).
    const soloDetalle = Object.keys(detalles)
      .filter((edif) => hasDetForm(detalles[edif]) && !conM3.some((x) => x.edif === edif));
    const edifs = [...conM3.map((x) => x.edif), ...soloDetalle];
    if (edifs.length === 0) { setMsg({ tone: 'err', text: 'Escribe m³ o completa el detalle de al menos un edificio.' }); return; }
    // Primeras veces (sin base) CON m³: exigen el acumulado base.
    const faltaBase = conM3.filter(({ edif }) => !resumen[edif]?.tiene_base && !(numOf(bases[edif] ?? '') >= 0 && (bases[edif] ?? '').trim() !== ''));
    if (faltaBase.length) {
      setMsg({ tone: 'err', text: `1ª vez de: ${faltaBase.map((x) => x.edif).join(', ')} — escribe su acumulado base.` });
      return;
    }
    setSaving(true); setMsg(null);
    try {
      for (const edif of edifs) {
        const m3typed = numOf(values[edif] ?? '');
        // Si no tecleó m³ (fila solo-detalle), conserva el removido ya guardado hoy (no lo pisa a 0).
        const m3 = isFinite(m3typed) && m3typed > 0 ? m3typed : (resumen[edif]?.removido_hoy ?? 0);
        const tieneBase = !!resumen[edif]?.tiene_base;
        const base = m3 > 0 && !tieneBase ? numOf(bases[edif] ?? '') : null;
        await saveEdificioRemovido({ edificio: edif, date, m3, base, supervisorId, supervisorName, detalle: toDetalle(detalles[edif]) });
      }
      await reload();
      setMsg({ tone: 'ok', text: `✅ Guardados ${edifs.length} edificio(s) · ${fmt(conM3.reduce((a, x) => a + x.m3, 0))} m³ hoy.` });
      toast.success('Reporte por edificio guardado.');
      onChanged?.();
    } catch (e: any) {
      setMsg({ tone: 'err', text: 'No se pudo guardar: ' + (e?.message ?? 'error') });
    } finally { setSaving(false); }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text } as const;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '92%' }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>⛰️ Removidos hoy · por edificio</Text>
              <TouchableOpacity onPress={onClose}><Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar ✕</Text></TouchableOpacity>
            </View>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{date.split('-').reverse().join('/')} · escribe los m³ de cada edificio y guarda</Text>

            {/* Totales */}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoftBg, borderRadius: radius.md, padding: spacing.sm }}>
                <Text style={{ color: colors.accentSoftText, fontSize: 11, fontWeight: '700' }}>M³ REMOVIDOS HOY</Text>
                <Text style={{ color: colors.accentSoftText, fontWeight: '900', fontSize: 18 }}>{fmt(totalHoy)} m³</Text>
              </View>
              <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>M³ ACUMULADOS</Text>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>{fmt(totalAcum)} m³</Text>
              </View>
            </View>

            {msg ? (
              <Text style={{ color: msg.tone === 'ok' ? colors.success : colors.danger, fontSize: 12, fontWeight: '700' }}>{msg.text}</Text>
            ) : null}

            {/* Buscar + filtro por sub-sector */}
            <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar edificio o sub-sector…" placeholderTextColor={colors.muted} style={input} />
            {sectores.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: 2 }}>
                {[null, ...sectores].map((s) => {
                  const on = sectorFiltro === s;
                  return (
                    <TouchableOpacity key={s ?? '__todos'} onPress={() => setSectorFiltro(s)}
                      style={{ paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt }}>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 11 }}>{s ?? 'Todos'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : null}

            {/* Lista de edificios (agrupada por sub-sector), cantidad por fila */}
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
            ) : grupos.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 13 }}>No hay edificios. Agrega uno abajo.</Text>
            ) : (
              grupos.map(([sec, items]) => (
                <View key={sec} style={{ gap: 4 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.xs }}>📍 {sec}</Text>
                  {items.map((edif) => {
                    const r = resumen[edif];
                    const val = values[edif] ?? '';
                    const tieneVal = numOf(val) > 0;
                    const primeraVez = !r?.tiene_base;
                    return (
                      <View key={edif} style={{ borderWidth: 1, borderColor: tieneVal ? colors.accent : colors.border, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13.5 }}>{edif}</Text>
                            <Text style={{ color: colors.muted, fontSize: 11 }}>Acumulado: {fmt(r?.acumulado ?? 0)} m³{r?.removido_hoy ? ` · hoy: ${fmt(r.removido_hoy)}` : ''}</Text>
                          </View>
                          <TextInput
                            value={val}
                            onChangeText={(t) => setVal(edif, t)}
                            placeholder="m³ hoy"
                            placeholderTextColor={colors.muted}
                            keyboardType="numeric"
                            style={{ ...input, width: 96, textAlign: 'right' }}
                          />
                        </View>
                        {primeraVez && tieneVal ? (
                          <TextInput
                            value={bases[edif] ?? ''}
                            onChangeText={(t) => setBase(edif, t)}
                            placeholder="Acumulado base (1ª vez de este edificio)"
                            placeholderTextColor={colors.muted}
                            keyboardType="numeric"
                            style={input}
                          />
                        ) : null}
                        {/* Detalle Fase 2 (opcional): maquinaria, acarreo, cuerpos, actividades… */}
                        {(() => {
                          const abierto = !!openDet[edif];
                          const d = detalles[edif] ?? {};
                          const tieneDet = hasDetForm(d);
                          return (
                            <>
                              <TouchableOpacity onPress={() => setOpenDet((p) => ({ ...p, [edif]: !abierto }))}
                                style={{ alignSelf: 'flex-start' }}>
                                <Text style={{ color: colors.primary, fontSize: 11.5, fontWeight: '700' }}>
                                  {abierto ? '▴ Ocultar detalle' : `▾ Detalle${tieneDet ? ' ✓' : ''}`}
                                </Text>
                              </TouchableOpacity>
                              {abierto ? (
                                <View style={{ gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>M³ ACARREADOS</Text>
                                      <TextInput value={d.m3_acarreados ?? ''} onChangeText={(t) => setDet(edif, { m3_acarreados: t })}
                                        placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" style={input} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>VIAJES</Text>
                                      <TextInput value={d.viajes ?? ''} onChangeText={(t) => setDet(edif, { viajes: t })}
                                        placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" style={input} />
                                    </View>
                                  </View>
                                  <TextInput value={d.maq_en_uso ?? ''} onChangeText={(t) => setDet(edif, { maq_en_uso: t })}
                                    placeholder="🚜 Maquinaria en uso" placeholderTextColor={colors.muted} style={input} />
                                  <TextInput value={d.maq_inoperativo ?? ''} onChangeText={(t) => setDet(edif, { maq_inoperativo: t })}
                                    placeholder="🛑 Maquinaria inoperativa" placeholderTextColor={colors.muted} style={input} />
                                  <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>📋 MAQUINARIA POR REQUERIMIENTO (marca con ✓)</Text>
                                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                                    {/* Asignadas ∪ externas + cualquier código suelto ya marcado. */}
                                    {Array.from(new Set([...misMaquinas.map((m) => m.code), ...reqCodes(edif)])).map((code) => {
                                      const on = reqCodes(edif).includes(code);
                                      return (
                                        <TouchableOpacity key={code} onPress={() => toggleReq(edif, code)}
                                          style={{ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt }}>
                                          <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 11.5 }}>
                                            {on ? '✓ ' : ''}{code}
                                          </Text>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </View>
                                  {/* Añadir máquina EXTERNA (no va al catálogo). */}
                                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                                    <TextInput value={addMaq[edif] ?? ''} onChangeText={(t) => setAddMaq((p) => ({ ...p, [edif]: t }))}
                                      placeholder="➕ Máquina externa (fuera del catálogo)" placeholderTextColor={colors.muted}
                                      onSubmitEditing={() => agregarMaqExterna(edif)} style={{ ...input, flex: 1 }} />
                                    <TouchableOpacity onPress={() => agregarMaqExterna(edif)} disabled={addingMaq || !(addMaq[edif] ?? '').trim()}
                                      style={{ backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: addingMaq || !(addMaq[edif] ?? '').trim() ? 0.6 : 1 }}>
                                      <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{addingMaq ? '…' : 'Añadir'}</Text>
                                    </TouchableOpacity>
                                  </View>
                                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>SUPERVIVIENTES</Text>
                                      <TextInput value={d.supervivientes ?? ''} onChangeText={(t) => setDet(edif, { supervivientes: t })}
                                        placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" style={input} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>FALLECIDOS</Text>
                                      <TextInput value={d.fallecidos ?? ''} onChangeText={(t) => setDet(edif, { fallecidos: t })}
                                        placeholder="0" placeholderTextColor={colors.muted} keyboardType="numeric" style={input} />
                                    </View>
                                  </View>
                                  <TextInput value={d.actividades ?? ''} onChangeText={(t) => setDet(edif, { actividades: t })}
                                    placeholder="📝 Actividades del día" placeholderTextColor={colors.muted} multiline
                                    style={{ ...input, minHeight: 56, textAlignVertical: 'top' }} />
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                                    <Switch value={!!d.entregado} onValueChange={(v) => setDet(edif, { entregado: v })} />
                                    <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '700' }}>✅ Frente entregado</Text>
                                  </View>
                                </View>
                              ) : null}
                            </>
                          );
                        })()}
                      </View>
                    );
                  })}
                </View>
              ))
            )}

            {/* Agregar edificio nuevo al catálogo */}
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs, marginTop: spacing.xs }}>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>➕ ¿Falta un edificio? Agrégalo</Text>
              <TextInput value={addName} onChangeText={setAddName} placeholder="Nombre del edificio" placeholderTextColor={colors.muted} style={input} />
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <TextInput value={addSector} onChangeText={setAddSector} placeholder="Sub-sector (opcional)" placeholderTextColor={colors.muted} style={{ ...input, flex: 1 }} />
                <TouchableOpacity onPress={agregarEdificio} disabled={adding || !addName.trim()} style={{ backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: adding || !addName.trim() ? 0.6 : 1 }}>
                  <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{adding ? '…' : 'Agregar'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ height: spacing.xl }} />
          </ScrollView>

          {/* Barra inferior: guardar TODO + enviar por WhatsApp */}
          <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm }}>
            <TouchableOpacity onPress={guardar} disabled={saving || savables === 0} style={{ backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: saving || savables === 0 ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{saving ? 'Guardando…' : `✅ Guardar ${savables} edificio(s) · ${fmt(totalHoy)} m³`}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={enviarWhatsApp} disabled={sharing} style={{ borderWidth: 1, borderColor: '#25D366', borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', opacity: sharing ? 0.6 : 1 }}>
              <Text style={{ color: '#25D366', fontWeight: '800' }}>{sharing ? 'Abriendo…' : '📤 Enviar reporte por WhatsApp'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
