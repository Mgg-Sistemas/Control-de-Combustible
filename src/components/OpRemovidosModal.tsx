// ⛰️ M³ REMOVIDOS HOY — POR EDIFICIO (Obras Públicas), MULTI-SELECCIÓN.
// Segmento INDEPENDIENTE (no por máquina): se muestra la lista de edificios
// agrupada por SUB-SECTOR y en cada fila se teclea la cantidad de m³ removidos
// del día. Un solo "Guardar" registra TODOS los que tengan cantidad. El acumulado
// se teclea manual la 1ª vez (base) por edificio y luego crece con los removidos.
// Cada cantidad suma a los totales del día Y a los acumulados.
// Ver src/lib/obrasPublicas.ts y supabase/op_edificio_removidos.sql.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { norm, cmpText } from '../lib/text';
import { fetchEdificiosConSector, addEdificio, EdificioConSector } from '../lib/edificios';
import { fetchEdificioResumen, saveEdificioRemovido, OpEdificioResumen } from '../lib/obrasPublicas';
import { useToast } from './ToastProvider';

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

  // Agregar un edificio nuevo al catálogo.
  const [addName, setAddName] = useState('');
  const [addSector, setAddSector] = useState('');
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [r, e] = await Promise.all([fetchEdificioResumen(date), fetchEdificiosConSector()]);
      setResumen(r);
      setEdificios(e);
      // Precarga: los removidos ya registrados HOY se muestran para poder corregirlos.
      const v: Record<string, string> = {};
      Object.values(r).forEach((x) => { if (x.removido_hoy > 0) v[x.edificio] = String(x.removido_hoy); });
      setValues(v);
      setBases({});
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

  const setVal = (edif: string, s: string) => setValues((p) => ({ ...p, [edif]: s }));
  const setBase = (edif: string, s: string) => setBases((p) => ({ ...p, [edif]: s }));

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
    const aGuardar = Object.entries(values)
      .map(([edif, s]) => ({ edif, m3: numOf(s) }))
      .filter(({ m3 }) => isFinite(m3) && m3 > 0);
    if (aGuardar.length === 0) { setMsg({ tone: 'err', text: 'Escribe la cantidad de m³ en al menos un edificio.' }); return; }
    // Primeras veces (sin base): exigen el acumulado base.
    const faltaBase = aGuardar.filter(({ edif }) => !resumen[edif]?.tiene_base && !(numOf(bases[edif] ?? '') >= 0 && (bases[edif] ?? '').trim() !== ''));
    if (faltaBase.length) {
      setMsg({ tone: 'err', text: `1ª vez de: ${faltaBase.map((x) => x.edif).join(', ')} — escribe su acumulado base.` });
      return;
    }
    setSaving(true); setMsg(null);
    try {
      for (const { edif, m3 } of aGuardar) {
        const tieneBase = !!resumen[edif]?.tiene_base;
        const base = tieneBase ? null : numOf(bases[edif] ?? '');
        await saveEdificioRemovido({ edificio: edif, date, m3, base, supervisorId, supervisorName });
      }
      await reload();
      setMsg({ tone: 'ok', text: `✅ Guardados ${aGuardar.length} edificio(s) · ${fmt(aGuardar.reduce((a, x) => a + x.m3, 0))} m³ hoy.` });
      toast.success('m³ por edificio guardados.');
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

          {/* Barra inferior: guardar TODO */}
          <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
            <TouchableOpacity onPress={guardar} disabled={saving || marcados === 0} style={{ backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: saving || marcados === 0 ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{saving ? 'Guardando…' : `✅ Guardar ${marcados} edificio(s) · ${fmt(totalHoy)} m³`}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
