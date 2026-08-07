// Pantalla de TELÉFONO para el rol "Chofer de combustible".
// Escanea el QR de una máquina o la elige manualmente (lista buscable por todo)
// y SURTE combustible: litros + monto por litro (monto total automático) + fotos.
// Al elegir la máquina se muestran SECTOR y PARROQUIA en SOLO LECTURA.
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  Image,
  ScrollView,
} from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useAuth } from '../context/AuthContext';
import { supabase, selectAllRows } from '../lib/supabase';
import { norm, cmpText, onlyDecimal } from '../lib/text';
import QrScanner from '../components/QrScanner';
import { parseMachineId } from './ScanQrScreen';
import { captureAndUploadPhoto } from '../lib/photo';
import { insertMachineDispatch } from '../lib/dispatches';
import { ChangePasswordButton } from '../components/ChangePasswordButton';
import EdificioPicker from '../components/EdificioPicker';

// Máquina cargada del catálogo (solo los campos que usamos aquí).
type Machine = {
  id: string;
  code: string | null;
  tipo: string | null;
  serial: string | null;
  plate: string | null;
  referencia: string | null;
  encargado: string | null;
  parroquia: string | null;
  sector: string | null;
  expected_lph: number | null;
  daily_consumption_l: number | null;
  last_horometro: number | null;
  companyName: string;
};

// Tipos de avería (mismos que la vista rápida del operador). "otro" = falla libre.
const AVERIA_MATERIALS: { key: string; label: string; icon: string }[] = [
  { key: 'caucho', label: 'Caucho', icon: '🛞' },
  { key: 'aceite', label: 'Aceite', icon: '🛢️' },
  { key: 'filtro', label: 'Filtro', icon: '🧴' },
  { key: 'repuesto', label: 'Repuesto', icon: '🔩' },
  { key: 'otro', label: 'Otro', icon: '✏️' },
];

/** Fecha de hoy en formato AAAA-MM-DD (hora local). */
function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Convierte el texto de un input decimal ("12,5") a número (12.5). */
function toNum(s: string): number {
  const t = String(s ?? '').replace(',', '.');
  const n = Number(t);
  return isFinite(n) ? n : NaN;
}

export default function FuelDriverScreen() {
  const { colors } = useTheme();
  const { session, signOut } = useAuth();
  const uid = session?.user?.id ?? '';

  const [driverName, setDriverName] = useState('');
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);

  // Buscador manual.
  const [query, setQuery] = useState('');

  // Escáner.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMsg, setScanMsg] = useState('');

  // Máquina seleccionada para surtir (abre el formulario).
  const [selected, setSelected] = useState<Machine | null>(null);

  // Formulario de surtido.
  const [liters, setLiters] = useState('');
  const [pricePerLiter, setPricePerLiter] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Reporte de AVERÍA (se vincula al módulo de Mantenimiento vía maintenance_requests).
  const [averiaOpen, setAveriaOpen] = useState(false);
  const [averiaMaterial, setAveriaMaterial] = useState<string | null>(null);
  const [averiaNote, setAveriaNote] = useState('');
  const [averiaPhotos, setAveriaPhotos] = useState<string[]>([]);
  const [averiaAddingPhoto, setAveriaAddingPhoto] = useState(false);
  const [savingAveria, setSavingAveria] = useState(false);

  // Nombre del chofer (profiles.full_name por uid).
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data }) => {
        if (alive && data?.full_name) setDriverName(String(data.full_name));
      });
    return () => {
      alive = false;
    };
  }, [uid]);

  // Carga de TODAS las máquinas del catálogo.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const rows = await selectAllRows(
        'machinery',
        'id, code, tipo, serial, plate, referencia, encargado, parroquia, sector, expected_lph, daily_consumption_l, last_horometro, company:company_id(name)'
      );
      if (!alive) return;
      const mapped: Machine[] = (rows ?? []).map((m: any) => ({
        id: m.id,
        code: m.code ?? null,
        tipo: m.tipo ?? null,
        serial: m.serial ?? null,
        plate: m.plate ?? null,
        referencia: m.referencia ?? null,
        encargado: m.encargado ?? null,
        parroquia: m.parroquia ?? null,
        sector: m.sector ?? null,
        expected_lph: m.expected_lph ?? null,
        daily_consumption_l: m.daily_consumption_l ?? null,
        last_horometro: m.last_horometro ?? null,
        companyName: m.company?.name ?? 'Sin empresa',
      }));
      mapped.sort((a, b) => cmpText(a.code, b.code));
      setMachines(mapped);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Búsqueda: casa contra code, empresa, serial, placa, encargado, referencia y tipo.
  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return machines.slice(0, 150);
    const out: Machine[] = [];
    for (const m of machines) {
      const hay = [
        m.code,
        m.companyName,
        m.serial,
        m.plate,
        m.encargado,
        m.referencia,
        m.tipo,
      ].some((v) => norm(v).includes(q));
      if (hay) out.push(m);
      if (out.length >= 150) break;
    }
    return out;
  }, [machines, query]);

  // Monto total = litros × monto por litro (calculado, no editable).
  const total = useMemo(() => {
    const l = toNum(liters);
    const p = toNum(pricePerLiter);
    if (!isFinite(l) || !isFinite(p)) return null;
    return Math.round(l * p * 100) / 100;
  }, [liters, pricePerLiter]);

  const openMachine = (m: Machine) => {
    setSelected(m);
    setLiters('');
    setPricePerLiter('');
    setPhotos([]);
    setResult(null);
  };

  // Guarda el EDIFICIO de la máquina (campo único machinery.referencia) desde el
  // desplegable compartido. Optimista: actualiza en pantalla y persiste en la base.
  const guardarEdificio = async (name: string) => {
    if (!selected) return;
    const clean = (name ?? '').trim();
    const mid = selected.id;
    setSelected((s) => (s ? { ...s, referencia: clean } : s));
    setMachines((list) => list.map((m) => (m.id === mid ? { ...m, referencia: clean } : m)));
    await supabase.from('machinery').update({ referencia: clean }).eq('id', mid);
  };

  const closeForm = () => {
    setSelected(null);
    setLiters('');
    setPricePerLiter('');
    setPhotos([]);
    setResult(null);
  };

  // Escáner: al detectar, resuelve el id y busca la máquina en la lista cargada.
  const onDetected = (text: string) => {
    setScanOpen(false);
    const id = parseMachineId(text);
    const m = id ? machines.find((x) => x.id === id) : null;
    if (m) {
      setScanMsg('');
      openMachine(m);
    } else {
      setScanMsg('QR no corresponde a una máquina');
    }
  };

  const addPhoto = async () => {
    if (!selected || addingPhoto) return;
    setAddingPhoto(true);
    try {
      const r = await captureAndUploadPhoto(selected.id, 'dispatches');
      if (r.ok && r.url) setPhotos((prev) => [...prev, r.url as string]);
      else if (r.error) setResult({ ok: false, msg: `❌ ${r.error}` });
    } finally {
      setAddingPhoto(false);
    }
  };

  const removePhotoAt = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (!selected || saving) return;
    const l = toNum(liters);
    const p = toNum(pricePerLiter);
    if (!isFinite(l) || l <= 0) {
      setResult({ ok: false, msg: '❌ Ingresa los litros surtidos (mayor a 0).' });
      return;
    }
    if (!isFinite(p) || p < 0) {
      setResult({ ok: false, msg: '❌ Ingresa un monto por litro válido (0 o más).' });
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const { error } = await insertMachineDispatch({
        machineryId: selected.id,
        dispatchDate: today(),
        liters: l,
        pricePerLiter: p,
        photos,
        operator: driverName || null,
        createdBy: uid || null,
        dailyConsumptionL: selected.daily_consumption_l,
        skipDailyCap: true,
      });
      if (error) {
        setResult({ ok: false, msg: `❌ ${error}` });
      } else {
        setResult({ ok: true, msg: '✅ Surtido registrado' });
        // Limpia para el siguiente surtido (mantiene la máquina abierta).
        setLiters('');
        setPricePerLiter('');
        setPhotos([]);
      }
    } finally {
      setSaving(false);
    }
  };

  // ── AVERÍA: adjunta foto(s) y reporta al módulo de Mantenimiento ──────────────
  const addAveriaPhoto = async () => {
    if (!selected || averiaAddingPhoto) return;
    setAveriaAddingPhoto(true);
    try {
      const r = await captureAndUploadPhoto(selected.id, 'averias');
      if (r.ok && r.url) setAveriaPhotos((prev) => [...prev, r.url as string]);
      else if (r.error) setResult({ ok: false, msg: `❌ ${r.error}` });
    } finally {
      setAveriaAddingPhoto(false);
    }
  };
  const removeAveriaPhotoAt = (idx: number) => setAveriaPhotos((prev) => prev.filter((_, i) => i !== idx));
  const marcarAveria = async () => {
    if (!selected || savingAveria) return;
    if (!averiaMaterial) { setResult({ ok: false, msg: '❌ Elige el tipo de avería.' }); return; }
    if (averiaMaterial === 'otro' && !averiaNote.trim()) { setResult({ ok: false, msg: '❌ Describe la falla para "Otro".' }); return; }
    setSavingAveria(true);
    setResult(null);
    try {
      const { error } = await supabase.from('maintenance_requests').insert({
        machinery_id: selected.id,
        material: averiaMaterial,
        notes: averiaNote.trim() || null,
        status: 'pendiente',
        requested_by: uid || null,
        photo_url: averiaPhotos[0] ?? null,
        photos: averiaPhotos.length ? averiaPhotos : null,
      });
      if (error) { setResult({ ok: false, msg: `❌ ${error.message}` }); return; }
      setResult({ ok: true, msg: '✅ Avería reportada a Mantenimiento.' });
      setAveriaMaterial(null); setAveriaNote(''); setAveriaPhotos([]); setAveriaOpen(false);
    } finally {
      setSavingAveria(false);
    }
  };

  const showVal = (v: string | null | undefined) => (v && String(v).trim() ? String(v) : '—');

  return (
    <Screen>
      {/* Encabezado */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.md,
          gap: spacing.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>
            ⛽ Surtir combustible
          </Text>
          {driverName ? (
            <Text style={{ color: colors.muted, marginTop: 2 }}>{driverName}</Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={signOut}
          style={{
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            borderRadius: radius.pill,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>Salir</Text>
        </TouchableOpacity>
      </View>
      <View style={{ marginBottom: spacing.md }}>
        <ChangePasswordButton />
      </View>

      {/* Botón grande: ESCANEAR MÁQUINA */}
      <TouchableOpacity
        onPress={() => {
          setScanMsg('');
          setScanOpen(true);
        }}
        style={{
          backgroundColor: colors.primary,
          borderRadius: radius.md,
          paddingVertical: spacing.lg,
          alignItems: 'center',
          marginBottom: spacing.sm,
        }}
      >
        <Text style={{ color: colors.primaryContrast, fontSize: 18, fontWeight: '800' }}>
          📷 ESCANEAR MÁQUINA
        </Text>
      </TouchableOpacity>
      {scanMsg ? (
        <Text style={{ color: colors.danger, marginBottom: spacing.sm }}>{scanMsg}</Text>
      ) : null}

      {/* Entrada MANUAL: buscador + lista */}
      <SectionTitle>O elige la máquina</SectionTitle>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar por código, empresa, serial, placa…"
        placeholderTextColor={colors.muted}
        style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          color: colors.text,
          marginBottom: spacing.sm,
        }}
      />

      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Sin resultados"
          subtitle="No se encontraron máquinas con esa búsqueda."
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {filtered.map((m) => (
            <TouchableOpacity key={m.id} onPress={() => openMachine(m)}>
              <Card>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>
                  {showVal(m.code)}
                </Text>
                <Text style={{ color: colors.muted }}>
                  {m.companyName}
                  {m.tipo ? ` · ${m.tipo}` : ''}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Sector: {showVal(m.sector)} · Parroquia: {showVal(m.parroquia)}
                </Text>
              </Card>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Modal del escáner QR */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <QrScanner onClose={() => setScanOpen(false)} onDetected={onDetected} />
      </Modal>

      {/* Modal del formulario de surtido */}
      <Modal
        visible={!!selected}
        animationType="slide"
        transparent={false}
        onRequestClose={closeForm}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
            {selected ? (
              <>
                {/* Cabecera del formulario */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text, flex: 1 }}>
                    {showVal(selected.code)}
                  </Text>
                  <TouchableOpacity
                    onPress={closeForm}
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.md,
                      borderRadius: radius.pill,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
                  </TouchableOpacity>
                </View>

                {/* SECTOR y PARROQUIA — SOLO LECTURA */}
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted }}>Sector</Text>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {showVal(selected.sector)}
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      marginTop: spacing.xs,
                    }}
                  >
                    <Text style={{ color: colors.muted }}>Parroquia</Text>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {showVal(selected.parroquia)}
                    </Text>
                  </View>
                </Card>

                {/* EDIFICIO — desplegable compartido (con ➕ agregar). Campo único de
                    ubicación; se guarda al elegir/agregar. */}
                <Card>
                  <EdificioPicker value={selected.referencia ?? ''} onChange={guardarEdificio} />
                </Card>

                {/* AVERÍA — reporta al módulo de Mantenimiento (maintenance_requests),
                    con foto(s). Colapsable para no estorbar el surtido. */}
                <Card>
                  <TouchableOpacity onPress={() => setAveriaOpen((v) => !v)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>🔧 Reportar avería</Text>
                    <Text style={{ color: colors.brandText, fontSize: 16 }}>{averiaOpen ? '▴' : '▾'}</Text>
                  </TouchableOpacity>
                  {averiaOpen ? (
                    <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>Tipo de avería / material a cambiar:</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                        {AVERIA_MATERIALS.map((mt) => {
                          const on = averiaMaterial === mt.key;
                          return (
                            <TouchableOpacity key={mt.key} onPress={() => setAveriaMaterial(mt.key)} style={{ width: '47%', alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                              <Text style={{ fontSize: 28 }}>{mt.icon}</Text>
                              <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', marginTop: 2 }}>{mt.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      {averiaMaterial ? (
                        <>
                          <Text style={{ color: colors.muted, fontSize: 12 }}>{averiaMaterial === 'otro' ? '¿Qué falla presenta? (describe la avería)' : 'Nota (opcional)'}</Text>
                          <TextInput
                            value={averiaNote}
                            onChangeText={setAveriaNote}
                            placeholder={averiaMaterial === 'otro' ? 'Ej. no arranca, fuga de aceite…' : 'Detalle…'}
                            placeholderTextColor={colors.muted}
                            multiline={averiaMaterial === 'otro'}
                            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, minHeight: averiaMaterial === 'otro' ? 60 : undefined }}
                          />
                          <TouchableOpacity onPress={addAveriaPhoto} disabled={averiaAddingPhoto} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: averiaAddingPhoto ? 0.6 : 1 }}>
                            <Text style={{ color: colors.text, fontWeight: '700' }}>{averiaAddingPhoto ? 'Subiendo…' : '📷 Agregar foto de la avería'}</Text>
                          </TouchableOpacity>
                          {averiaPhotos.length > 0 ? (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                              {averiaPhotos.map((uri, idx) => (
                                <View key={`${uri}-${idx}`} style={{ position: 'relative' }}>
                                  <Image source={{ uri }} style={{ width: 84, height: 84, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }} />
                                  <TouchableOpacity onPress={() => removeAveriaPhotoAt(idx)} style={{ position: 'absolute', top: -6, right: -6, backgroundColor: colors.danger, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
                                    <Text style={{ color: '#fff', fontWeight: '800' }}>×</Text>
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </View>
                          ) : null}
                          <TouchableOpacity onPress={marcarAveria} disabled={savingAveria} style={{ backgroundColor: '#2563EB', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: savingAveria ? 0.6 : 1 }}>
                            <Text style={{ color: '#fff', fontWeight: '800' }}>{savingAveria ? 'Guardando…' : '🔧 Reportar avería a Mantenimiento'}</Text>
                          </TouchableOpacity>
                        </>
                      ) : null}
                    </View>
                  ) : null}
                </Card>

                {/* Litros surtidos */}
                <View>
                  <Text style={{ color: colors.text, marginBottom: spacing.xs, fontWeight: '700' }}>
                    Litros surtidos
                  </Text>
                  <TextInput
                    value={liters}
                    onChangeText={(t) => setLiters(onlyDecimal(t))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      color: colors.text,
                    }}
                  />
                </View>

                {/* Monto por litro */}
                <View>
                  <Text style={{ color: colors.text, marginBottom: spacing.xs, fontWeight: '700' }}>
                    Monto por litro
                  </Text>
                  <TextInput
                    value={pricePerLiter}
                    onChangeText={(t) => setPricePerLiter(onlyDecimal(t))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      color: colors.text,
                    }}
                  />
                </View>

                {/* Monto total — CALCULADO */}
                <Card style={{ backgroundColor: colors.surfaceAlt }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted, fontWeight: '700' }}>Monto total</Text>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>
                      {total != null ? total.toLocaleString() : '—'}
                    </Text>
                  </View>
                </Card>

                {/* Fotos */}
                <View>
                  <TouchableOpacity
                    onPress={addPhoto}
                    disabled={addingPhoto}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      paddingVertical: spacing.md,
                      alignItems: 'center',
                      opacity: addingPhoto ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {addingPhoto ? 'Subiendo…' : '📷 Agregar foto'}
                    </Text>
                  </TouchableOpacity>
                  {photos.length > 0 ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: spacing.sm,
                        marginTop: spacing.sm,
                      }}
                    >
                      {photos.map((uri, idx) => (
                        <View key={`${uri}-${idx}`} style={{ position: 'relative' }}>
                          <Image
                            source={{ uri }}
                            style={{
                              width: 84,
                              height: 84,
                              borderRadius: radius.sm,
                              borderWidth: 1,
                              borderColor: colors.border,
                            }}
                          />
                          <TouchableOpacity
                            onPress={() => removePhotoAt(idx)}
                            style={{
                              position: 'absolute',
                              top: -6,
                              right: -6,
                              backgroundColor: colors.danger,
                              width: 22,
                              height: 22,
                              borderRadius: 11,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Text style={{ color: '#fff', fontWeight: '800' }}>×</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>

                {/* Resultado ✅/❌ */}
                {result ? (
                  <Text
                    style={{
                      color: result.ok ? colors.success : colors.danger,
                      fontWeight: '700',
                    }}
                  >
                    {result.msg}
                  </Text>
                ) : null}

                {/* Registrar surtido */}
                <TouchableOpacity
                  onPress={submit}
                  disabled={saving}
                  style={{
                    backgroundColor: colors.primary,
                    borderRadius: radius.md,
                    paddingVertical: spacing.lg,
                    alignItems: 'center',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: colors.primaryContrast, fontSize: 18, fontWeight: '800' }}>
                    {saving ? 'Guardando…' : 'Registrar surtido'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}
