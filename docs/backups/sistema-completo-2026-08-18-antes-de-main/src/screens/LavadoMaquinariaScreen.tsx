import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ScrollView, ActivityIndicator, RefreshControl, Image } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import QrScanner from '../components/QrScanner';
import { parseMachineId } from './ScanQrScreen';
import { captureAndUploadPhoto } from '../lib/photo';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import {
  listWashMachines, listWashesInRange, listWashTypes, registerWash, getWashMachine, addWashType,
  LmMachine, LmWash, LmWashType,
} from '../lib/lavadoMaquinaria';

type Periodo = 'hoy' | 'semana' | 'mes';
const PERIODOS: { key: Periodo; label: string }[] = [
  { key: 'hoy', label: 'Hoy' }, { key: 'semana', label: 'Semana' }, { key: 'mes', label: 'Mes' },
];

// Rango [from, to) en hora Caracas (UTC-4, sin horario de verano) para el periodo.
function rangoDe(p: Periodo): { fromISO: string; toISO: string } {
  const now = new Date();
  // "Hoy" de negocio en Caracas: el día calendario Caracas.
  const car = new Date(now.getTime() - 4 * 3600000); // desplaza a "reloj Caracas"
  const y = car.getUTCFullYear(), m = car.getUTCMonth(), d = car.getUTCDate();
  const startOfDay = Date.UTC(y, m, d, 4, 0, 0); // 00:00 Caracas = 04:00 UTC
  const toISO = new Date(startOfDay + 24 * 3600000).toISOString(); // mañana 00:00 Caracas
  let fromMs = startOfDay;
  if (p === 'semana') fromMs = startOfDay - 6 * 24 * 3600000;       // últimos 7 días
  else if (p === 'mes') fromMs = Date.UTC(y, m, 1, 4, 0, 0);        // 1° del mes Caracas
  return { fromISO: new Date(fromMs).toISOString(), toISO };
}

const horaCaracas = (iso: string) =>
  new Date(iso).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });

/**
 * Vista de TELÉFONO del módulo LAVADO DE MAQUINARIA. El lavador ve el tablero por
 * estado — 🚿 Por lavar / ✅ Lavadas — del periodo elegido (Hoy/Semana/Mes). Elige
 * la máquina de la lista o escanea su QR, y registra el lavado (tipo, observación,
 * foto). Todo va a lm_washes; nada toca inspecciones.
 */
export default function LavadoMaquinariaScreen() {
  const { colors } = useTheme();
  const { session, signOut } = useAuth();
  const uid = session?.user?.id ?? '';

  const [fullName, setFullName] = useState('');
  const [periodo, setPeriodo] = useState<Periodo>('hoy');
  const [machines, setMachines] = useState<LmMachine[]>([]);
  const [washes, setWashes] = useState<LmWash[]>([]);
  const [types, setTypes] = useState<LmWashType[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [scanOpen, setScanOpen] = useState(false);
  const [target, setTarget] = useState<LmMachine | null>(null); // máquina a registrar
  const [tipo, setTipo] = useState<string | null>(null);
  const [obs, setObs] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoUp, setPhotoUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState('');

  useEffect(() => {
    if (!uid) return;
    supabase.from('profiles').select('full_name').eq('id', uid).single()
      .then(({ data }) => setFullName((data as any)?.full_name ?? 'Lavador'));
  }, [uid]);

  const load = useCallback(async () => {
    try {
      const { fromISO, toISO } = rangoDe(periodo);
      const [ms, ws, ts] = await Promise.all([listWashMachines(), listWashesInRange(fromISO, toISO), listWashTypes()]);
      setMachines(ms); setWashes(ws); setTypes(ts);
    } catch (e: any) {
      setNotice('❌ ' + (e?.message ?? 'Error al cargar'));
    } finally {
      setLoading(false);
    }
  }, [periodo]);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['lm_washes', 'lm_wash_types'], () => load(), { debounceMs: 800, maxWaitMs: 3000 });

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Máquinas ya lavadas en el periodo (para separar el tablero).
  const washedIds = useMemo(() => new Set(washes.map((w) => w.machinery_id)), [washes]);
  const norm = (s: string) => s.toLowerCase().trim();
  const porLavar = useMemo(() => {
    const term = norm(q);
    return machines
      .filter((m) => !washedIds.has(m.id))
      .filter((m) => !term || `${m.code} ${m.serial ?? ''} ${m.plate ?? ''} ${m.marca ?? ''} ${m.modelo ?? ''} ${m.company}`.toLowerCase().includes(term));
  }, [machines, washedIds, q]);

  // Abre el modal de registro para una máquina.
  const abrirRegistro = (m: LmMachine) => {
    setTarget(m); setTipo(types[0]?.name ?? null); setObs(''); setPhoto(null); setAddingType(false); setNewType('');
  };

  const onDetected = async (text: string) => {
    setScanOpen(false);
    const id = parseMachineId(text);
    if (!id) { setNotice('❌ QR no reconocido. Escanea el QR de una máquina.'); return; }
    const m = await getWashMachine(id);
    if (!m) { setNotice('❌ No se encontró esa máquina (o está inactiva).'); return; }
    abrirRegistro(m);
  };

  const subirFoto = async () => {
    if (!target) return;
    setPhotoUp(true);
    const r = await captureAndUploadPhoto(target.id, 'lavados');
    setPhotoUp(false);
    if (r.ok && r.url) setPhoto(r.url);
    else if (r.error) setNotice('❌ ' + r.error);
  };

  const agregarTipo = async () => {
    const name = newType.trim();
    if (!name) return;
    try {
      const saved = await addWashType(name);
      const ts = await listWashTypes();
      setTypes(ts); setTipo(saved); setAddingType(false); setNewType('');
    } catch (e: any) { setNotice('❌ ' + (e?.message ?? 'No se pudo agregar el tipo')); }
  };

  const guardar = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await registerWash({
        machineryId: target.id, washedBy: uid || null, washedByName: fullName || null,
        tipo, observaciones: obs.trim() || null, photo,
      });
      setTarget(null);
      setNotice(`✅ ${target.code} marcada como lavada.`);
      await load();
    } catch (e: any) {
      setNotice('❌ ' + (e?.message ?? 'No se pudo registrar el lavado'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <View>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>🚿 Lavado de maquinaria</Text>
          {!!fullName && <Text style={{ color: colors.muted, fontSize: 12 }}>{fullName}</Text>}
        </View>
        <TouchableOpacity onPress={() => signOut()} style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>Salir</Text>
        </TouchableOpacity>
      </View>
      <ConfigBanner />

      {!!notice && (
        <TouchableOpacity onPress={() => setNotice(null)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.text, fontSize: 13 }}>{notice}</Text>
        </TouchableOpacity>
      )}

      {/* Periodo */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.sm }}>
        {PERIODOS.map((p) => {
          const on = periodo === p.key;
          return (
            <TouchableOpacity key={p.key} onPress={() => setPeriodo(p.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
              <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '800', fontSize: 13 }}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Escanear + buscar */}
      <TouchableOpacity onPress={() => setScanOpen(true)} style={{ backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
        <Text style={{ color: '#fff', fontWeight: '800' }}>📷 Escanear QR de máquina</Text>
      </TouchableOpacity>
      <TextInput
        value={q} onChangeText={setQ} placeholder="Buscar máquina, placa, serial, empresa…" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brand} />
      ) : (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}>
          {/* POR LAVAR */}
          <SectionTitle>🚿 Por lavar · {porLavar.length}</SectionTitle>
          {porLavar.length === 0 ? (
            <Card><Text style={{ color: colors.muted }}>Todas las máquinas están lavadas en este periodo. 🎉</Text></Card>
          ) : porLavar.map((m) => (
            <TouchableOpacity key={m.id} onPress={() => abrirRegistro(m)}>
              <Card style={{ marginBottom: spacing.xs }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>{m.code}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {[m.marca, m.modelo].filter(Boolean).join(' ') || m.tipo || '—'}{m.serial ? ` · ${m.serial}` : ''} · {m.company}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Lavar</Text>
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          ))}

          {/* LAVADAS */}
          <SectionTitle>✅ Lavadas · {washes.length}</SectionTitle>
          {washes.length === 0 ? (
            <Card><Text style={{ color: colors.muted }}>Aún no hay lavados en este periodo.</Text></Card>
          ) : washes.map((w) => (
            <Card key={w.id} style={{ marginBottom: spacing.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                {w.photo ? <Image source={{ uri: w.photo }} style={{ width: 40, height: 40, borderRadius: radius.sm }} /> : <Text style={{ fontSize: 22 }}>✅</Text>}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>{w.machine_code}{w.tipo ? ` · ${w.tipo}` : ''}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{horaCaracas(w.washed_at)}{w.washed_by_name ? ` · ${w.washed_by_name}` : ''}</Text>
                  {!!w.observaciones && <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>{w.observaciones}</Text>}
                </View>
              </View>
            </Card>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Escáner */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <QrScanner onDetected={onDetected} onClose={() => setScanOpen(false)} />
      </Modal>

      {/* Modal registrar lavado */}
      <Modal visible={!!target} animationType="slide" transparent onRequestClose={() => setTarget(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '88%' }}>
            <ScrollView>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 4 }}>Registrar lavado</Text>
              {!!target && <Text style={{ color: colors.muted, marginBottom: spacing.md }}>{target.code}{target.serial ? ` · ${target.serial}` : ''} · {target.company}</Text>}

              <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 6 }}>Tipo de lavado</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
                {types.map((t) => {
                  const on = tipo === t.name;
                  return (
                    <TouchableOpacity key={t.id} onPress={() => setTipo(t.name)} style={{ backgroundColor: on ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.brand : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>{t.name}</Text>
                    </TouchableOpacity>
                  );
                })}
                {addingType ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <TextInput value={newType} onChangeText={setNewType} placeholder="Nuevo tipo" placeholderTextColor={colors.muted} autoFocus
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, color: colors.text, minWidth: 110 }} />
                    <TouchableOpacity onPress={agregarTipo}><Text style={{ color: colors.success, fontWeight: '800' }}>✓</Text></TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setAddingType(true)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 13 }}>+ Agregar</Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 6 }}>Observaciones (opcional)</Text>
              <TextInput value={obs} onChangeText={setObs} placeholder="Ej. muy sucia, faltó agua…" placeholderTextColor={colors.muted} multiline
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, minHeight: 60, marginBottom: spacing.md }} />

              <TouchableOpacity onPress={subirFoto} disabled={photoUp} style={{ borderWidth: 1, borderColor: photo ? colors.success : colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md }}>
                <Text style={{ color: photo ? colors.success : colors.text, fontWeight: '700' }}>{photoUp ? 'Subiendo…' : photo ? '✅ Foto adjunta (cambiar)' : '📸 Adjuntar foto (opcional)'}</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={guardar} disabled={saving} style={{ backgroundColor: '#059669', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: saving ? 0.6 : 1 }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>{saving ? 'Guardando…' : '✅ Marcar como lavada'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setTarget(null)} style={{ padding: spacing.sm, alignItems: 'center', marginTop: 4 }}>
                <Text style={{ color: colors.muted }}>Cancelar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
