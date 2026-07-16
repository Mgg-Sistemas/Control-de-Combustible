import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { supabase, selectAllRows } from '../lib/supabase';
import { norm } from '../lib/text';
import { Machinery, SupervisorVisit, VisitStatus } from '../types/database';
import { getCurrentCoords, warmLocation } from '../lib/location';
import { saveVisit, myVisitsToday, haversineM, VISIT_NEAR_M } from '../lib/supervisorVisits';
import QrScanner from '../components/QrScanner';
import { parseMachineId } from './ScanQrScreen';
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
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsErr, setGpsErr] = useState<string | null>(null);

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
    setGps(null);
    setGpsErr(null);
    setScanOpen(false);
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
      supervisorName: fullName || 'Supervisor',
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
          <Text style={{ color: colors.muted, fontSize: 12 }}>Supervisor</Text>
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
    </Screen>
  );
}
