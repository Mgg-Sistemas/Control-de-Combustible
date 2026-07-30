import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { BiometricToggle } from '../components/BiometricToggle';
import { ChangePasswordButton } from '../components/ChangePasswordButton';
import { SurtidoGasoilModal } from '../components/SurtidoGasoil';
import QrScanner from '../components/QrScanner';
import { parseMachineId } from './ScanQrScreen';
import { captureAndUploadPhoto } from '../lib/photo';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { getMachineRound, upsertMachineRound } from '../lib/machineRounds';
import { saveVisit } from '../lib/supervisorVisits';
import { shiftOf, caracasParts } from '../lib/jornada';
import { logAudit } from '../lib/audit';

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasClock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}
/** Tiempo transcurrido "Xh YYm" desde el inicio (ISO) hasta ahora. */
function elapsedLabel(startISO: string): string {
  const ms = Math.max(0, Date.now() - new Date(startISO).getTime());
  const min = Math.floor(ms / 60000);
  return `${Math.floor(min / 60)}h ${(min % 60).toString().padStart(2, '0')}m`;
}

const AV_MATERIALS: { key: string; label: string; icon: string }[] = [
  { key: 'caucho', label: 'Caucho', icon: '🛞' },
  { key: 'aceite', label: 'Aceite', icon: '🛢️' },
  { key: 'filtro', label: 'Filtro', icon: '🧴' },
  { key: 'repuesto', label: 'Repuesto', icon: '🔩' },
];
const numOrNull = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) && s.trim() !== '' ? n : null; };

type Mode = 'camion' | 'averia' | 'gasoil' | 'jornada';
type Mach = { id: string; code: string; plate: string | null };
type OpenJornada = { id: string; code: string; start: string; shift: 'day' | 'night' };
type PendingFin = { id: string; code: string; start: string; shift: 'day' | 'night' };

/**
 * Panel del COORDINADOR DE PATIO (rol fijo). Dos acciones grandes:
 *  • ESCANEAR QR → registra ENTRADA o SALIDA del camión (él elige cada vez).
 *  • AVERÍA DE MAQUINARIA → registra una avería (va a Mantenimiento de Maquinaria).
 * Además puede abrir el calendario de entradas/salidas.
 */
export default function PatioScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { session, signOut } = useAuth();
  const uid = session?.user?.id ?? '';

  const [fullName, setFullName] = useState('');
  const [scanMode, setScanMode] = useState<Mode | null>(null); // scanner abierto y para qué
  const [machine, setMachine] = useState<Mach | null>(null);   // máquina escaneada
  const [avStarted, setAvStarted] = useState(false);           // true = flujo de avería (no camión)
  const [gasoilId, setGasoilId] = useState<string | null>(null); // máquina para surtir gasoil
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Jornada de camión por escaneo (asistencia): abre/cierra jornada del camión.
  const [openJornadas, setOpenJornadas] = useState<OpenJornada[]>([]);
  const [pendingFin, setPendingFin] = useState<PendingFin | null>(null);
  const [jornBusy, setJornBusy] = useState(false);

  // Formulario de avería.
  const [avMaterial, setAvMaterial] = useState<string | null>(null);
  const [avQty, setAvQty] = useState('');
  const [avNote, setAvNote] = useState('');
  const [avPhoto, setAvPhoto] = useState<string | null>(null);
  const [avPhotoUp, setAvPhotoUp] = useState(false);

  const subirFotoAveria = async () => {
    if (!machine) return;
    setAvPhotoUp(true);
    const r = await captureAndUploadPhoto(machine.id, 'averias');
    setAvPhotoUp(false);
    if (r.ok && r.url) setAvPhoto(r.url);
    else if (r.error) setNotice('❌ ' + r.error);
  };

  useEffect(() => {
    if (!uid) return;
    supabase.from('profiles').select('full_name').eq('id', uid).single()
      .then(({ data }) => setFullName((data as any)?.full_name ?? 'Coordinador'));
  }, [uid]);

  // Camiones con JORNADA ABIERTA hoy (para la lista de "asistencia" del patio).
  const loadOpen = async () => {
    const { data } = await supabase
      .from('machine_rounds')
      .select('machinery_id, jornada_start_at, jornada_shift, machine:machinery_id(code)')
      .eq('round_date', caracasToday())
      .not('jornada_start_at', 'is', null);
    setOpenJornadas(((data ?? []) as any[]).map((r) => ({
      id: r.machinery_id as string,
      code: r.machine?.code ?? '—',
      start: r.jornada_start_at as string,
      shift: (r.jornada_shift as 'day' | 'night') ?? 'day',
    })));
  };
  useEffect(() => { loadOpen(); }, []);

  // Al detectar un QR: busca la máquina y abre el flujo (camión, avería, gasoil o jornada).
  const onDetected = async (text: string) => {
    const id = parseMachineId(text);
    const mode = scanMode;
    setScanMode(null);
    if (!id) { setNotice('❌ QR no reconocido. Escanea el QR de una máquina.'); return; }
    setBusy(true);
    const { data } = await supabase.from('machinery').select('id, code, plate, serial, latitude, longitude').eq('id', id).single();
    setBusy(false);
    if (!data) { setNotice('❌ No se encontró esa máquina.'); return; }
    if (mode === 'gasoil') { setGasoilId((data as Mach).id); return; }
    if (mode === 'jornada') { await handleJornadaScan(data as any); return; }
    setMachine(data as Mach);
    if (mode === 'averia') { setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null); }
    // Si era modo camión, el modal de Entrada/Salida se muestra solo (machine != null && no avería).
  };

  // Escaneo de JORNADA: si el camión no tiene jornada abierta hoy → la INICIA
  // (marca en Inspecciones y guarda la hora); si ya tiene una abierta → pide
  // confirmar y la FINALIZA (horas = fin − inicio → Control de maquinaria).
  const handleJornadaScan = async (m: { id: string; code: string; latitude: number | null; longitude: number | null }) => {
    const today = caracasToday();
    setJornBusy(true);
    const round = await getMachineRound(m.id, today);
    if (!(round as any)?.jornada_start_at) {
      const now = new Date();
      const sh = shiftOf(caracasParts(now).hour).key;
      await saveVisit({
        machineryId: m.id, supervisorId: uid || null, supervisorName: fullName || 'Patio',
        visitDate: today, status: 'trabajando', lat: null, lng: null,
        note: 'Jornada de camión (patio)', machineLat: m.latitude ?? null, machineLng: m.longitude ?? null,
      });
      const res = await upsertMachineRound(m.id, today, { jornada_start_at: now.toISOString(), jornada_shift: sh }, uid || null);
      setJornBusy(false);
      if (res.error) { setNotice('❌ ' + res.error); return; }
      logAudit('JORNADA_INICIO', 'machinery', m.id, m.code);
      setNotice(`🟢 Jornada INICIADA · ${m.code} · ${caracasClock(now.toISOString())}. Aparece en Control e Inspecciones.`);
      loadOpen();
    } else {
      setJornBusy(false);
      setPendingFin({ id: m.id, code: m.code, start: (round as any).jornada_start_at, shift: ((round as any).jornada_shift as 'day' | 'night') ?? 'day' });
    }
  };

  // Confirma la FINALIZACIÓN de la jornada del camión: suma las horas al turno.
  const confirmarFin = async () => {
    if (!pendingFin || jornBusy) return;
    setJornBusy(true);
    const today = caracasToday();
    const horas = Math.max(0, Math.round((Date.now() - new Date(pendingFin.start).getTime()) / 3600000 * 100) / 100);
    const round = await getMachineRound(pendingFin.id, today);
    const key = pendingFin.shift === 'night' ? 'night_hours' : 'day_hours';
    const base = Number((round as any)?.[key] ?? 0);
    const res = await upsertMachineRound(pendingFin.id, today, { [key]: Math.round((base + horas) * 100) / 100, jornada_start_at: null }, uid || null);
    setJornBusy(false);
    if (res.error) { setNotice('❌ ' + res.error); return; }
    logAudit('JORNADA_FIN', 'machinery', pendingFin.id, `${pendingFin.code} · ${horas.toFixed(2)} h`);
    setNotice(`🏁 Jornada FINALIZADA · ${pendingFin.code} · ${horas.toFixed(2)} h → Control de maquinaria (turno ${pendingFin.shift === 'night' ? 'noche' : 'día'}).`);
    setPendingFin(null);
    loadOpen();
  };

  // Registra ENTRADA o SALIDA del camión escaneado.
  const registrarMov = async (direction: 'entrada' | 'salida') => {
    if (!machine) return;
    setBusy(true);
    const { error } = await supabase.from('truck_yard_logs').insert({
      machinery_id: machine.id,
      machine_code: machine.code,
      direction,
      logged_by: uid || null,
      logged_by_name: fullName || null,
    });
    setBusy(false);
    setMachine(null);
    if (error) { setNotice('❌ ' + error.message); return; }
    setNotice(`✅ ${direction === 'entrada' ? 'ENTRADA' : 'SALIDA'} registrada · ${machine.code}`);
  };

  // Registra una avería de la máquina escaneada.
  const registrarAveria = async () => {
    if (!machine || !avMaterial) return;
    setBusy(true);
    const { error } = await supabase.from('maintenance_requests').insert({
      machinery_id: machine.id,
      material: avMaterial,
      quantity: numOrNull(avQty),
      notes: avNote.trim() || null,
      status: 'pendiente',
      requested_by: uid || null,
      photo_url: avPhoto,
    });
    setBusy(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    const code = machine.code;
    setMachine(null); setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null);
    setNotice(`✅ Avería registrada · ${code}. Va a Mantenimiento de Maquinaria.`);
  };

  const bigBtn = (label: string, sub: string, color: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ backgroundColor: color, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md }}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 20, textAlign: 'center' }}>{label}</Text>
      <Text style={{ color: '#fff', fontSize: 12, marginTop: 4, opacity: 0.9, textAlign: 'center' }}>{sub}</Text>
    </TouchableOpacity>
  );

  // Modal de Entrada/Salida: hay máquina escaneada y NO estamos en el flujo de avería.
  const showMov = !!machine && !avStarted;

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Coordinador de Patio</SectionTitle>
        <TouchableOpacity onPress={() => signOut()} style={{ paddingHorizontal: spacing.md, paddingVertical: 4 }}>
          <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>Salir</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.md }}>Hola{fullName ? `, ${fullName}` : ''}. Escanea el QR del camión para INICIAR su jornada; al escanearlo de nuevo se FINALIZA y las horas van a Control.</Text>

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('✅') ? colors.success : colors.danger, fontWeight: '700' }}>{notice}</Text></Card>
      ) : null}

      {bigBtn('🕒  JORNADA DE CAMIÓN', 'Escanea para INICIAR; escanea otra vez para FINALIZAR', '#0F766E', () => { setAvStarted(false); setScanMode('jornada'); })}

      {/* Asistencia del patio: camiones con jornada ABIERTA ahora mismo. */}
      {openJornadas.length > 0 ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>🟢 Camiones en jornada ({openJornadas.length})</Text>
          {openJornadas.map((j) => (
            <View key={j.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{j.code} <Text style={{ color: colors.muted, fontWeight: '400' }}>· {j.shift === 'night' ? '🌙 noche' : '☀️ día'}</Text></Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>Desde {caracasClock(j.start)} · ⏱️ {elapsedLabel(j.start)}</Text>
              </View>
              <TouchableOpacity onPress={() => setPendingFin({ id: j.id, code: j.code, start: j.start, shift: j.shift })} style={{ backgroundColor: '#2563EB', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>🏁 Finalizar</Text>
              </TouchableOpacity>
            </View>
          ))}
        </Card>
      ) : null}

      {bigBtn('📷  ENTRADA / SALIDA', 'Registrar ENTRADA o SALIDA del camión (patio)', '#2563EB', () => { setAvStarted(false); setScanMode('camion'); })}
      {bigBtn('⛽  SURTIR GASOIL', 'Horómetro + litros (surtido vs consumido)', '#15803D', () => { setAvStarted(false); setScanMode('gasoil'); })}
      {bigBtn('🛠️  AVERÍA DE MAQUINARIA', 'Reportar una avería (va a Mantenimiento)', '#B45309', () => { setAvStarted(true); setScanMode('averia'); })}
      {bigBtn('🕒  ASISTENCIA EMPLEADOS', 'Marcar entrada/salida escaneando el carnet', '#4F46E5', () => navigation.navigate('Asistencia'))}

      <TouchableOpacity onPress={() => navigation.navigate('Camiones')} activeOpacity={0.8}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Text style={{ fontSize: 26 }}>🚚</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: colors.text, fontSize: 15 }}>Entrada y salida de camiones</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Calendario: cuántos entraron y salieron cada día</Text>
            </View>
            <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>›</Text>
          </View>
        </Card>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('Manual')} activeOpacity={0.8}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Text style={{ fontSize: 26 }}>📖</Text>
            <Text style={{ fontWeight: '800', color: colors.text, fontSize: 15 }}>Manual / Ayuda</Text>
          </View>
        </Card>
      </TouchableOpacity>

      <SectionTitle>Seguridad</SectionTitle>
      <ChangePasswordButton variant="row" />
      <BiometricToggle />

      {busy ? <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View> : null}

      {/* Escáner */}
      <Modal visible={scanMode !== null} animationType="slide" onRequestClose={() => setScanMode(null)}>
        <QrScanner onClose={() => setScanMode(null)} onDetected={onDetected} />
      </Modal>

      {/* Confirmar FINALIZAR jornada del camión (muestra el total de horas). */}
      <Modal visible={!!pendingFin} transparent animationType="fade" onRequestClose={() => setPendingFin(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            {pendingFin ? (
              <>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, textAlign: 'center' }}>🏁 Finalizar jornada</Text>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, textAlign: 'center', marginTop: 4 }}>{pendingFin.code}</Text>
                <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: spacing.sm }}>
                  Inició {caracasClock(pendingFin.start)} ({pendingFin.shift === 'night' ? '🌙 noche' : '☀️ día'})
                </Text>
                <Text style={{ color: colors.text, fontSize: 15, textAlign: 'center', marginTop: 2 }}>
                  Total trabajado: <Text style={{ fontWeight: '900' }}>{elapsedLabel(pendingFin.start)}</Text>
                  {'  '}({((Date.now() - new Date(pendingFin.start).getTime()) / 3600000).toFixed(2)} h)
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 2, marginBottom: spacing.md }}>
                  Se sumarán a Control de maquinaria en el turno de {pendingFin.shift === 'night' ? 'noche' : 'día'}.
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TouchableOpacity onPress={() => setPendingFin(null)} disabled={jornBusy} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={confirmarFin} disabled={jornBusy} style={{ flex: 1, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: jornBusy ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{jornBusy ? 'Guardando…' : 'Sí, finalizar'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </Card>
        </View>
      </Modal>

      {/* Surtir gasoil */}
      <SurtidoGasoilModal machineId={gasoilId} onClose={() => setGasoilId(null)} authorName={fullName} authorId={uid || null} />

      {/* Elegir ENTRADA o SALIDA (modo camión) */}
      <Modal visible={showMov} transparent animationType="fade" onRequestClose={() => setMachine(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, textAlign: 'center' }}>{machine?.code}</Text>
            {machine?.plate ? <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginBottom: spacing.sm }}>Placa: {machine.plate}</Text> : null}
            <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginBottom: spacing.md }}>¿El camión está ENTRANDO o SALIENDO del patio?</Text>
            <TouchableOpacity onPress={() => registrarMov('entrada')} disabled={busy} style={{ backgroundColor: '#15803D', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>🟢  ENTRADA</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => registrarMov('salida')} disabled={busy} style={{ backgroundColor: '#B45309', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>🟠  SALIDA</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMachine(null)} style={{ padding: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
          </Card>
        </View>
      </Modal>

      {/* Formulario de AVERÍA (modo avería, con máquina escaneada) */}
      <Modal visible={!!machine && avStarted} transparent animationType="fade" onRequestClose={() => { setMachine(null); setAvStarted(false); }}>
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
              <TouchableOpacity onPress={() => { setMachine(null); setAvStarted(false); }} style={{ padding: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
            </ScrollView>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}
