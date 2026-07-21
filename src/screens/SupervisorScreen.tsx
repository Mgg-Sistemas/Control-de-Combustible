import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { BiometricToggle } from '../components/BiometricToggle';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { supabase, selectAllRows } from '../lib/supabase';
import { norm } from '../lib/text';
import { Machinery, SupervisorVisit, VisitStatus } from '../types/database';
import { getCurrentCoords, warmLocation } from '../lib/location';
import { captureAndUploadPhoto } from '../lib/photo';
import { saveVisit, myVisitsToday, haversineM, VISIT_NEAR_M } from '../lib/supervisorVisits';
import QrScanner from '../components/QrScanner';
import { parseMachineId, parseEmployeeId } from './ScanQrScreen';
import { startJornada, isOperatorCargo } from '../lib/jornada';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { ChangePasswordButton } from '../components/ChangePasswordButton';

const CARACAS_TZ = 'America/Caracas';
/** Día ISO (AAAA-MM-DD) de hoy en horario de Caracas. */
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasClock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}

type Mach = Machinery & { companyName?: string; latitude?: number | null; longitude?: number | null };

const STATUS_OPTS: { key: VisitStatus; label: string; icon: string; color: string }[] = [
  { key: 'trabajando', label: 'Trabajando', icon: '🟢', color: '#1E9E4A' },
  { key: 'parada', label: 'Parada', icon: '🟡', color: '#D9A200' },
  { key: 'no_esta', label: 'No está', icon: '🔴', color: '#D22B2B' },
];
const statusLabel = (s: VisitStatus) => STATUS_OPTS.find((o) => o.key === s)?.label ?? s;

// Materiales de la avería de maquinaria (igual que la vista del operador). Cae en
// el módulo de Mantenimiento de Maquinaria (tabla maintenance_requests).
const AV_MATERIALS: { key: string; label: string; icon: string }[] = [
  { key: 'caucho', label: 'Caucho', icon: '🛞' },
  { key: 'aceite', label: 'Aceite', icon: '🛢️' },
  { key: 'filtro', label: 'Filtro', icon: '🧴' },
  { key: 'repuesto', label: 'Repuesto', icon: '🔩' },
];
const avNumOrNull = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) && s.trim() !== '' ? n : null; };

/**
 * Vista del SUPERVISOR: sale a revisar máquinas. Por cada una hace un check-in
 * ("Revisé la máquina") con hora + GPS + estado (trabajando/parada/no está).
 * Ese check-in VALIDA la jornada: sin visita, la máquina-día queda sin validar
 * (el operador no cobra). Ve sus máquinas asignadas (🪖) y puede escanear el QR.
 */
export default function SupervisorScreen({ initialMachineId, onConsumed }: { initialMachineId?: string; onConsumed?: () => void } = {}) {
  const { colors } = useTheme();
  const { session, signOut } = useAuth();
  const uid = session?.user?.id ?? '';
  const today = caracasToday();
  const consumedRef = useRef(false);

  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState<Mach[]>([]);
  const [mineIds, setMineIds] = useState<Set<string>>(new Set());
  const [visits, setVisits] = useState<Record<string, SupervisorVisit>>({});
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // ── Check-in ──────────────────────────────────────────────────────────────
  const [ci, setCi] = useState<Mach | null>(null);
  const [ciStatus, setCiStatus] = useState<VisitStatus>('trabajando');
  const [ciNote, setCiNote] = useState('');
  const [ciSaving, setCiSaving] = useState(false);
  const [savingMachLoc, setSavingMachLoc] = useState(false); // guardar la ubicación de la MÁQUINA desde el check-in
  // Avería de maquinaria (igual que el operador) → maintenance_requests.
  const [avOpen, setAvOpen] = useState(false);
  const [avMaterial, setAvMaterial] = useState<string | null>(null);
  const [avQty, setAvQty] = useState('');
  const [avNote, setAvNote] = useState('');
  const [avSaving, setAvSaving] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsErr, setGpsErr] = useState<string | null>(null);

  // ── Registrar operador SIN teléfono: el supervisor escanea el carnet del
  //    operador y coteja su cédula; si coincide, inicia la jornada del operador
  //    en esta máquina (mismo flujo que si el operador escaneara con su teléfono).
  const [opScanOpen, setOpScanOpen] = useState(false);
  const [opEmp, setOpEmp] = useState<{ id: string; first: string; last: string; name: string; cargo: string | null; cedula: string } | null>(null);
  const [opConfirmCedula, setOpConfirmCedula] = useState('');
  const [opHoro, setOpHoro] = useState('');
  const [opHoroPhoto, setOpHoroPhoto] = useState<string | null>(null);
  const [opHoroUploading, setOpHoroUploading] = useState(false);
  const [opBusy, setOpBusy] = useState(false);

  useEffect(() => { warmLocation(); }, []);

  const load = async () => {
    if (!uid) { setLoading(false); return; }
    const [{ data: prof }, mach] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle(),
      selectAllRows('machinery', 'id, code, tipo, referencia, latitude, longitude, operational, company:company_id(name)'),
    ]);
    const name = (prof as any)?.full_name ?? '';
    setFullName(name);
    const list = ((mach ?? []) as any[]).map((m) => ({ ...m, companyName: m.company?.name ?? 'Sin empresa' })) as Mach[];
    list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    setMachines(list);
    // Mis máquinas = las que custodio según el botón 🪖 (machine_guards activo con mi nombre).
    const { data: guards } = await supabase
      .from('machine_guards')
      .select('machinery_id')
      .eq('active', true)
      .ilike('guard_name', name || '___nunca___');
    setMineIds(new Set(((guards ?? []) as any[]).map((g) => g.machinery_id as string)));
    setVisits(await myVisitsToday(uid, today));
    setLoading(false);
  };
  useEffect(() => { load(); }, [uid]);

  const mine = useMemo(() => machines.filter((m) => mineIds.has(m.id)), [machines, mineIds]);
  const searchList = useMemo(() => {
    const q = norm(query.trim());
    return machines.filter((m) => !q || norm(m.code).includes(q) || norm(m.companyName || '').includes(q));
  }, [machines, query]);

  const openCheckin = (m: Mach) => {
    setCi(m);
    setCiStatus('trabajando');
    setCiNote('');
    setAvOpen(false); setAvMaterial(null); setAvQty(''); setAvNote('');
    setGps(null);
    setGpsErr(null);
    setScanOpen(false);
    // Limpia el registro de operador para esta máquina.
    setOpScanOpen(false);
    setOpEmp(null);
    setOpConfirmCedula('');
    setOpHoro('');
    setOpHoroPhoto(null);
    // Captura el GPS del supervisor al abrir (para medir la distancia a la máquina).
    setGpsBusy(true);
    getCurrentCoords().then((r) => {
      setGpsBusy(false);
      if (r.ok && r.lat != null && r.lng != null) setGps({ lat: r.lat, lng: r.lng });
      else setGpsErr(r.error ?? 'Sin ubicación.');
    });
  };

  // Si llegó por el QR físico (?maquina=) tras iniciar sesión: abre directo el
  // check-in de esa máquina (una sola vez) y limpia el parámetro de la URL.
  useEffect(() => {
    if (consumedRef.current || !initialMachineId || machines.length === 0) return;
    consumedRef.current = true;
    const found = machines.find((m) => m.id === initialMachineId);
    if (found) openCheckin(found);
    onConsumed?.();
  }, [initialMachineId, machines]); // eslint-disable-line react-hooks/exhaustive-deps

  const recapture = () => {
    setGpsBusy(true); setGpsErr(null);
    getCurrentCoords().then((r) => {
      setGpsBusy(false);
      if (r.ok && r.lat != null && r.lng != null) setGps({ lat: r.lat, lng: r.lng });
      else setGpsErr(r.error ?? 'Sin ubicación.');
    });
  };

  // Guarda TU posición actual como la UBICACIÓN de la máquina (queda en el mapa y
  // en el monitoreo con tu nombre). Estás en la máquina, así que sirve para ubicarla.
  const guardarUbicacionMaquina = async () => {
    if (!ci) return;
    setSavingMachLoc(true);
    let lat = gps?.lat ?? null, lng = gps?.lng ?? null;
    if (lat == null || lng == null) {
      const r = await getCurrentCoords();
      if (!r.ok || r.lat == null || r.lng == null) { setSavingMachLoc(false); setNotice('❌ ' + (r.error ?? 'No se pudo obtener tu ubicación.')); return; }
      lat = r.lat; lng = r.lng; setGps({ lat, lng });
    }
    const { error } = await supabase.rpc('update_machine_location', { p_id: ci.id, p_lat: lat, p_lng: lng });
    setSavingMachLoc(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    setCi((c) => (c ? { ...c, latitude: lat as number, longitude: lng as number } as Mach : c));
    setNotice('✅ Ubicación de la máquina guardada.');
    load();
  };

  // Reporta una AVERÍA de la máquina (misma función que el operador): cae en el
  // módulo de Mantenimiento de Maquinaria como solicitud pendiente.
  const registrarAveria = async () => {
    if (!ci || !avMaterial) return;
    setAvSaving(true);
    const { error } = await supabase.from('maintenance_requests').insert({
      machinery_id: ci.id,
      material: avMaterial,
      quantity: avNumOrNull(avQty),
      notes: avNote.trim() || null,
      status: 'pendiente',
      requested_by: uid || null,
    });
    setAvSaving(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    setAvMaterial(null); setAvQty(''); setAvNote(''); setAvOpen(false);
    setNotice('✅ Avería registrada. Va al módulo de Mantenimiento de Maquinaria.');
  };

  // Distancia del supervisor a la máquina (si ambos tienen coordenadas).
  const dist = useMemo(() => {
    if (!ci || !gps || ci.latitude == null || ci.longitude == null) return null;
    return haversineM(gps.lat, gps.lng, Number(ci.latitude), Number(ci.longitude));
  }, [ci, gps]);
  const near = dist == null ? null : dist <= VISIT_NEAR_M;

  const confirmCheckin = async () => {
    if (!ci) return;
    setCiSaving(true);
    setNotice(null);
    const { data, error } = await saveVisit({
      machineryId: ci.id,
      supervisorId: uid || null,
      supervisorName: fullName || 'Inspector',
      visitDate: today,
      status: ciStatus,
      lat: gps?.lat ?? null,
      lng: gps?.lng ?? null,
      note: ciNote,
      machineLat: ci.latitude ?? null,
      machineLng: ci.longitude ?? null,
    });
    setCiSaving(false);
    if (error || !data) { setNotice('❌ ' + (error ?? 'No se pudo guardar la visita.')); return; }
    setVisits((prev) => ({ ...prev, [ci.id]: data }));
    const dtxt = data.distance_m != null ? ` · a ~${data.distance_m} m${data.near ? ' (en sitio ✓)' : ' (lejos ⚠️)'}` : '';
    setNotice(`✅ ${ci.code} revisada · ${statusLabel(ciStatus)}${dtxt}.`);
    setCi(null);
  };

  // Escanea el carnet del operador (QR ?empleado=<id>): valida que exista, que su
  // cargo pueda operar y que tenga cédula en nómina. Luego se coteja la cédula.
  const onOperatorCarnet = async (text: string) => {
    setOpScanOpen(false);
    const id = parseEmployeeId(text);
    if (!id) { setNotice('❌ Ese QR no es un carnet de empleado.'); return; }
    const { data } = await supabase.from('employees').select('id, first_name, last_name, cargo, cedula').eq('id', id).maybeSingle();
    const emp = data as any;
    if (!emp) { setOpEmp(null); setNotice('❌ Ese carnet no corresponde a un empleado registrado.'); return; }
    const nombre = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
    if (!isOperatorCargo(emp.cargo)) { setOpEmp(null); setNotice(`❌ ${nombre}${emp.cargo ? ` (${emp.cargo})` : ''} no es OPERADOR, CHOFER, SERVICIOS GENERALES ni OBRERO. No puede iniciar jornada.`); return; }
    if (!(emp.cedula || '').trim()) { setOpEmp(null); setNotice(`❌ ${nombre} no tiene CÉDULA en nómina. Pídele al administrador que la agregue.`); return; }
    setOpEmp({ id: emp.id, first: (emp.first_name || '').trim(), last: (emp.last_name || '').trim(), name: nombre, cargo: emp.cargo ?? null, cedula: String(emp.cedula).trim() });
    setOpConfirmCedula('');
    setNotice(`📇 Carnet de ${nombre} leído. Coteja su cédula e ingresa el horómetro para iniciar la jornada.`);
  };

  // Coteja la cédula (debe coincidir con el carnet) e inicia la jornada del operador
  // en la máquina del check-in, con la ubicación del supervisor como punto de inicio.
  const confirmOperatorJornada = async () => {
    if (!ci || !opEmp || opBusy) return;
    const digits = (s: string) => (s || '').replace(/\D/g, '');
    if (digits(opConfirmCedula).length < 6) { setNotice('❌ Escribe la cédula del operador para cotejar.'); return; }
    if (digits(opConfirmCedula) !== digits(opEmp.cedula)) { setNotice('❌ La cédula no coincide con el carnet escaneado.'); return; }
    const hi = Number((opHoro || '').replace(',', '.'));
    if (!isFinite(hi) || hi < 0) { setNotice('❌ Ingresa el horómetro inicial de la máquina.'); return; }
    setOpBusy(true); setNotice(null);
    const res = await startJornada({
      machineId: ci.id, companyName: ci.companyName ?? null,
      first: opEmp.first, last: opEmp.last, cedula: opEmp.cedula, horometroInicial: hi,
      horometroPhoto: opHoroPhoto,
      createdBy: uid || null, recordedBy: uid || null, startCoords: gps,
    });
    setOpBusy(false);
    if (!res.ok) { setNotice('❌ ' + res.error); return; }
    setNotice(`✅ Jornada iniciada para ${opEmp.name} en ${ci.code} · ${res.shift.label} · Horómetro ${hi}. (Registrada por el supervisor.)`);
    setOpEmp(null); setOpConfirmCedula(''); setOpHoro(''); setOpHoroPhoto(null);
  };

  // Foto del horómetro (cámara → sube y guarda la URL) para el inicio de jornada.
  const tomarFotoHoroSup = async () => {
    if (!ci) return;
    setOpHoroUploading(true);
    const r = await captureAndUploadPhoto(ci.id, 'horometro');
    setOpHoroUploading(false);
    if (!r.ok) { if (r.error) setNotice('⚠️ ' + r.error); return; }
    setOpHoroPhoto(r.url ?? null);
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  if (loading) return <Screen><ConfigBanner /><Loading /></Screen>;

  const renderMachine = (m: Mach) => {
    const v = visits[m.id];
    const so = v ? STATUS_OPTS.find((o) => o.key === v.status) : null;
    return (
      <TouchableOpacity
        key={m.id}
        onPress={() => openCheckin(m)}
        style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: v ? colors.success : colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{m.code}</Text>
          {v ? (
            <Text style={{ color: colors.success, fontSize: 12, fontWeight: '800' }}>✓ {caracasClock(v.visited_at)}</Text>
          ) : (
            <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '800' }}>⏳ Pendiente</Text>
          )}
        </View>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{(m.tipo || 'Sin tipo')} · {m.companyName}</Text>
        {v && so ? (
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
            {so.icon} {so.label}{v.distance_m != null ? ` · a ~${v.distance_m} m${v.near ? ' (en sitio)' : ' (lejos)'}` : ''}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  const revisadas = Object.keys(visits).length;

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Inspector</Text>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{fullName || 'Mi ronda'}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <ChangePasswordButton />
          <TouchableOpacity onPress={signOut} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Salir</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🪖 Mi ronda de hoy</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
          Revisadas hoy: <Text style={{ color: colors.success, fontWeight: '800' }}>{revisadas}</Text>
          {mine.length > 0 ? <> · Mis máquinas: <Text style={{ color: colors.text, fontWeight: '800' }}>{mine.length}</Text></> : null}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
          Toca una máquina o escanea su QR para marcarla. Si no la marcas, esa jornada queda sin validar.
        </Text>
        <TouchableOpacity onPress={() => setScanOpen(true)} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>📷 Escanear QR de la máquina</Text>
        </TouchableOpacity>
      </Card>

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('❌') ? colors.danger : colors.success, fontWeight: '700' }}>{notice}</Text></Card>
      ) : null}

      {mine.length > 0 && !showAll ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionTitle>Mis máquinas a revisar</SectionTitle>
            <TouchableOpacity onPress={() => setShowAll(true)}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Ver todas</Text></TouchableOpacity>
          </View>
          {mine.map(renderMachine)}
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionTitle>Todas las máquinas</SectionTitle>
            {mine.length > 0 ? <TouchableOpacity onPress={() => setShowAll(false)}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Solo las mías</Text></TouchableOpacity> : null}
          </View>
          <TextInput value={query} onChangeText={setQuery} placeholder="🔎 Buscar por nombre o empresa…" placeholderTextColor={colors.muted} style={input} />
          <View style={{ marginTop: spacing.xs }}>
            {searchList.slice(0, 100).map(renderMachine)}
            {searchList.length === 0 ? <EmptyState title="Sin resultados" subtitle="Prueba con otro nombre o empresa." /> : null}
          </View>
        </>
      )}

      {/* Seguridad: iniciar sesión con huella (disponible para todos los usuarios). */}
      <SectionTitle>Seguridad</SectionTitle>
      <BiometricToggle />

      {/* Escáner de QR → abre el check-in de esa máquina. */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner
            onClose={() => setScanOpen(false)}
            onDetected={(text) => {
              const id = parseMachineId(text);
              const found = id ? machines.find((m) => m.id === id) : null;
              if (found) openCheckin(found);
              else { setScanOpen(false); setNotice('❌ El QR no corresponde a una máquina registrada.'); }
            }}
          />
        </View>
      </Modal>

      {/* Modal de check-in: GPS + estado + nota. */}
      <Modal visible={!!ci} transparent animationType="fade" onRequestClose={() => setCi(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '85%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>✅ Revisé la máquina</Text>
              {ci ? <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>{ci.code} · {(ci.tipo || 'Sin tipo')} · {ci.companyName}</Text> : null}

              {/* GPS / cercanía */}
              <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, borderLeftWidth: 3, borderLeftColor: gpsBusy ? colors.border : near === true ? colors.success : near === false ? colors.warning : colors.border }}>
                {gpsBusy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <ActivityIndicator color={colors.primary} /><Text style={{ color: colors.muted, fontSize: 12 }}>Obteniendo tu ubicación…</Text>
                  </View>
                ) : gps ? (
                  ci && ci.latitude != null && ci.longitude != null ? (
                    <Text style={{ color: near ? colors.success : colors.warning, fontWeight: '800', fontSize: 13 }}>
                      {near ? `📍 En sitio ✓ · a ~${dist} m de la máquina` : `📍 Estás a ~${dist} m (lejos ⚠️)`}
                    </Text>
                  ) : (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>📍 Ubicación tomada. La máquina aún no tiene ubicación guardada para comparar.</Text>
                  )
                ) : (
                  <Text style={{ color: colors.danger, fontSize: 12 }}>⚠️ {gpsErr ?? 'Sin ubicación.'}</Text>
                )}
                <TouchableOpacity onPress={recapture} disabled={gpsBusy} style={{ marginTop: 6 }}>
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>↻ Volver a tomar ubicación</Text>
                </TouchableOpacity>
                {/* Guardar TU posición como la ubicación de la máquina (queda en el mapa). */}
                <TouchableOpacity onPress={guardarUbicacionMaquina} disabled={savingMachLoc || gpsBusy} style={{ marginTop: spacing.sm, backgroundColor: '#2563EB', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: (savingMachLoc || gpsBusy) ? 0.6 : 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
                    {savingMachLoc ? 'Guardando…' : (ci && ci.latitude != null ? '📍 Actualizar ubicación de la máquina' : '📍 Guardar ubicación de la máquina')}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>¿Cómo está la máquina?</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
                {STATUS_OPTS.map((o) => {
                  const on = ciStatus === o.key;
                  return (
                    <TouchableOpacity key={o.key} onPress={() => setCiStatus(o.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 2, borderColor: on ? o.color : colors.border, backgroundColor: on ? o.color : colors.surface }}>
                      <Text style={{ fontSize: 20 }}>{o.icon}</Text>
                      <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '800', fontSize: 12, marginTop: 2 }}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Nota (opcional)</Text>
              <TextInput value={ciNote} onChangeText={setCiNote} placeholder="Observación…" placeholderTextColor={colors.muted} style={input} />

              {/* ── Registrar operador SIN teléfono: escanear su carnet + cotejar cédula
                     → inicia su jornada en esta máquina. Es opcional (independiente
                     de marcar la máquina como revisada). ───────────────────────── */}
              <View style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>👷 Iniciar jornada del operador</Text>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                  Si el operador no tiene teléfono: escanea su carnet y coteja su cédula para arrancar su jornada en esta máquina.
                </Text>
                <TouchableOpacity onPress={() => { setNotice(null); setOpScanOpen(true); }} style={{ marginTop: spacing.sm, backgroundColor: '#0EA5E9', borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>📷 {opEmp ? 'Volver a escanear carnet' : 'Escanear carnet del operador'}</Text>
                </TouchableOpacity>

                {opEmp ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.success }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>📇 {opEmp.name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{opEmp.cargo || 'Sin cargo'}</Text>
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Coteja la cédula del operador</Text>
                    <TextInput value={opConfirmCedula} onChangeText={(t) => setOpConfirmCedula(t.replace(/\D/g, ''))} keyboardType="number-pad" inputMode="numeric" placeholder="Cédula del operador" placeholderTextColor={colors.muted} style={input} />
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Horómetro inicial</Text>
                    <TextInput value={opHoro} onChangeText={(t) => setOpHoro(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={input} />
                    <TouchableOpacity onPress={tomarFotoHoroSup} disabled={opHoroUploading} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: opHoroPhoto ? colors.success : colors.border, backgroundColor: colors.surface }}>
                      <Text style={{ color: opHoroPhoto ? colors.success : colors.text, fontWeight: '700' }}>{opHoroUploading ? 'Subiendo…' : opHoroPhoto ? '✓ Foto del horómetro adjunta' : '📷 Foto del horómetro'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={confirmOperatorJornada} disabled={opBusy} style={{ marginTop: spacing.md, backgroundColor: '#1E9E4A', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: opBusy ? 0.6 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '800' }}>{opBusy ? 'Guardando…' : '🟢 Iniciar jornada del operador'}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>

              {/* ── Avería de maquinaria (misma función que el operador) → Mantenimiento ── */}
              <View style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border }}>
                <TouchableOpacity onPress={() => setAvOpen((v) => !v)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🛠️ Avería de maquinaria</Text>
                  <Text style={{ color: colors.primary, fontWeight: '800' }}>{avOpen ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {avOpen ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>Toca el material que se necesita cambiar. Va al módulo de Mantenimiento de Maquinaria.</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      {AV_MATERIALS.map((mt) => {
                        const on = avMaterial === mt.key;
                        return (
                          <TouchableOpacity key={mt.key} onPress={() => setAvMaterial(mt.key)} style={{ width: '47%', alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: on ? '#2563EB' : colors.border, backgroundColor: on ? '#2563EB' : colors.surface }}>
                            <Text style={{ fontSize: 28 }}>{mt.icon}</Text>
                            <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '800', marginTop: 2, fontSize: 13 }}>{mt.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {avMaterial ? (
                      <View style={{ marginTop: spacing.sm }}>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>Cantidad a cambiar</Text>
                        <TextInput value={avQty} onChangeText={(t) => setAvQty(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={input} />
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Nota (opcional)</Text>
                        <TextInput value={avNote} onChangeText={setAvNote} placeholder="Detalle…" placeholderTextColor={colors.muted} style={input} />
                        <TouchableOpacity onPress={registrarAveria} disabled={avSaving} style={{ marginTop: spacing.sm, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: avSaving ? 0.6 : 1 }}>
                          <Text style={{ color: '#fff', fontWeight: '800' }}>{avSaving ? 'Guardando…' : '🛠️ Registrar avería'}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>

              <TouchableOpacity onPress={confirmCheckin} disabled={ciSaving} style={{ marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: ciSaving ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{ciSaving ? 'Guardando…' : '✅ Marcar como revisada'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setCi(null)} style={{ marginTop: spacing.sm, padding: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Escáner del carnet del operador (QR ?empleado=<id>) → coteja e inicia jornada. */}
      <Modal visible={opScanOpen} animationType="slide" onRequestClose={() => setOpScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner onClose={() => setOpScanOpen(false)} onDetected={onOperatorCarnet} />
        </View>
      </Modal>
    </Screen>
  );
}
