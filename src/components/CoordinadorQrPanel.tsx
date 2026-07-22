import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { Screen, Card, SectionTitle } from './ui';
import { ConfigBanner } from './ConfigBanner';
import { BiometricToggle } from './BiometricToggle';
import { ChangePasswordButton } from './ChangePasswordButton';
import { SurtidoGasoilModal } from './SurtidoGasoil';
import QrScanner from './QrScanner';
import { parseMachineId } from '../screens/ScanQrScreen';
import { captureAndUploadPhoto } from '../lib/photo';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

const AV_MATERIALS: { key: string; label: string; icon: string }[] = [
  { key: 'caucho', label: 'Caucho', icon: '🛞' },
  { key: 'aceite', label: 'Aceite', icon: '🛢️' },
  { key: 'filtro', label: 'Filtro', icon: '🧴' },
  { key: 'repuesto', label: 'Repuesto', icon: '🔩' },
];
const numOrNull = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) && s.trim() !== '' ? n : null; };

type Action = 'gasoil' | 'averia' | 'lista';
type Mach = { id: string; code: string; plate: string | null };

/**
 * Panel reusable de COORDINADOR con escáner QR. Tres acciones rápidas: escanea el QR
 * de la máquina y elige — ⛽ Surtir gasoil (horómetro + litros, surtido vs consumido),
 * 🛠️ Registrar avería (va a Mantenimiento), ✅ Marcar máquina lista (cierra sus averías
 * pendientes y la vuelve Operativa). Incluye cambiar contraseña, huella y salir.
 */
export default function CoordinadorQrPanel({ title = 'Mi panel' }: { title?: string }) {
  const { colors } = useTheme();
  const { session, signOut } = useAuth();
  const uid = session?.user?.id ?? '';

  const [fullName, setFullName] = useState('');
  const [scanFor, setScanFor] = useState<Action | null>(null); // escáner abierto y para qué acción
  const [machine, setMachine] = useState<Mach | null>(null);
  const [action, setAction] = useState<Action | null>(null);   // acción a ejecutar con la máquina escaneada
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Avería
  const [avMaterial, setAvMaterial] = useState<string | null>(null);
  const [avQty, setAvQty] = useState('');
  const [avNote, setAvNote] = useState('');
  const [avPhoto, setAvPhoto] = useState<string | null>(null);
  const [avPhotoUp, setAvPhotoUp] = useState(false);

  useEffect(() => {
    if (!uid) return;
    supabase.from('profiles').select('full_name').eq('id', uid).single()
      .then(({ data }) => setFullName((data as any)?.full_name ?? 'Coordinador'));
  }, [uid]);

  const onDetected = async (text: string) => {
    const act = scanFor;
    setScanFor(null);
    const id = parseMachineId(text);
    if (!id) { setNotice('❌ QR no reconocido. Escanea el QR de una máquina.'); return; }
    setBusy(true);
    const { data } = await supabase.from('machinery').select('id, code, plate').eq('id', id).maybeSingle();
    setBusy(false);
    if (!data) { setNotice('❌ No se encontró esa máquina.'); return; }
    setMachine(data as Mach);
    setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null);
    setAction(act);
  };

  const subirFotoAveria = async () => {
    if (!machine) return;
    setAvPhotoUp(true);
    const r = await captureAndUploadPhoto(machine.id, 'averias');
    setAvPhotoUp(false);
    if (r.ok && r.url) setAvPhoto(r.url);
    else if (r.error) setNotice('❌ ' + r.error);
  };

  const registrarAveria = async () => {
    if (!machine || !avMaterial) return;
    setBusy(true);
    const { error } = await supabase.from('maintenance_requests').insert({
      machinery_id: machine.id, material: avMaterial, quantity: numOrNull(avQty),
      notes: avNote.trim() || null, status: 'pendiente', requested_by: uid || null,
      photo_url: avPhoto,
    });
    setBusy(false);
    const code = machine.code;
    setMachine(null); setAction(null);
    if (error) { setNotice('❌ ' + error.message); return; }
    setNotice(`✅ Avería registrada · ${code}. Va a Mantenimiento de Maquinaria.`);
  };

  const marcarLista = async () => {
    if (!machine) return;
    setBusy(true);
    const now = new Date().toISOString();
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('maintenance_requests').update({ status: 'realizado', resolved_by: uid || null, resolved_at: now }).eq('machinery_id', machine.id).eq('status', 'pendiente'),
      supabase.from('machinery').update({ operational: true, en_espera: false }).eq('id', machine.id),
    ]);
    setBusy(false);
    const code = machine.code;
    setMachine(null); setAction(null);
    if (e1 || e2) { setNotice('❌ ' + ((e1?.message || e2?.message) as string)); return; }
    setNotice(`✅ ${code} marcada LISTA: sus averías se cerraron y vuelve a Operativa.`);
  };

  const bigBtn = (label: string, sub: string, color: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ backgroundColor: color, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md }}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 19, textAlign: 'center' }}>{label}</Text>
      <Text style={{ color: '#fff', fontSize: 12, marginTop: 4, opacity: 0.9, textAlign: 'center' }}>{sub}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>{title}</SectionTitle>
        <TouchableOpacity onPress={() => signOut()} style={{ paddingHorizontal: spacing.md, paddingVertical: 4 }}>
          <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>Salir</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.md }}>Hola{fullName ? `, ${fullName}` : ''}. Escanea el QR de la máquina y elige la acción.</Text>

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('✅') ? colors.success : colors.danger, fontWeight: '700' }}>{notice}</Text></Card>
      ) : null}

      {bigBtn('⛽  SURTIR GASOIL', 'Horómetro + litros (surtido vs consumido)', '#15803D', () => setScanFor('gasoil'))}
      {bigBtn('🛠️  AVERÍA DE MAQUINARIA', 'Reportar una falla (va a Mantenimiento)', '#B45309', () => setScanFor('averia'))}
      {bigBtn('✅  MÁQUINA LISTA', 'Cierra sus averías y la vuelve Operativa', '#2563EB', () => setScanFor('lista'))}

      <SectionTitle>Seguridad</SectionTitle>
      <ChangePasswordButton variant="row" />
      <BiometricToggle />

      {busy ? <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View> : null}

      {/* Escáner */}
      <Modal visible={scanFor !== null} animationType="slide" onRequestClose={() => setScanFor(null)}>
        <QrScanner onClose={() => setScanFor(null)} onDetected={onDetected} />
      </Modal>

      {/* Surtir gasoil */}
      <SurtidoGasoilModal
        machineId={action === 'gasoil' ? machine?.id ?? null : null}
        onClose={() => { setMachine(null); setAction(null); }}
        authorName={fullName}
        authorId={uid || null}
      />

      {/* Confirmar MÁQUINA LISTA */}
      <Modal visible={action === 'lista' && !!machine} transparent animationType="fade" onRequestClose={() => { setMachine(null); setAction(null); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, textAlign: 'center' }}>✅ {machine?.code}</Text>
            <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginVertical: spacing.sm }}>¿Marcar esta máquina como LISTA? Se cerrarán sus averías pendientes y volverá a Operativa.</Text>
            <TouchableOpacity onPress={marcarLista} disabled={busy} style={{ backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Sí, marcar lista</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setMachine(null); setAction(null); }} style={{ padding: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
          </Card>
        </View>
      </Modal>

      {/* Registrar AVERÍA */}
      <Modal visible={action === 'averia' && !!machine} transparent animationType="fade" onRequestClose={() => { setMachine(null); setAction(null); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <ScrollView>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, textAlign: 'center' }}>🛠️ Avería · {machine?.code}</Text>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.sm, marginBottom: 4 }}>¿Qué necesita?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {AV_MATERIALS.map((mt) => {
                  const on = avMaterial === mt.key;
                  return (
                    <TouchableOpacity key={mt.key} onPress={() => setAvMaterial(mt.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: on ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.primary : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text>{mt.icon}</Text>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{mt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 4 }}>Cantidad (opcional)</Text>
              <TextInput value={avQty} onChangeText={setAvQty} keyboardType="numeric" placeholder="Ej: 2" placeholderTextColor={colors.muted}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 4 }}>Nota (opcional)</Text>
              <TextInput value={avNote} onChangeText={setAvNote} placeholder="Detalle de la falla" placeholderTextColor={colors.muted} multiline
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, minHeight: 60 }} />
              <TouchableOpacity onPress={subirFotoAveria} disabled={avPhotoUp} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: avPhoto ? colors.success : colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: avPhoto ? colors.success : colors.text, fontWeight: '700' }}>{avPhotoUp ? 'Subiendo…' : avPhoto ? '✓ Foto de referencia adjunta' : '📷 Foto de referencia (opcional)'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={registrarAveria} disabled={busy || !avMaterial} style={{ marginTop: spacing.md, backgroundColor: '#B45309', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy || !avMaterial ? 0.6 : 1 }}>
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Registrar avería</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setMachine(null); setAction(null); }} style={{ padding: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
            </ScrollView>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}
