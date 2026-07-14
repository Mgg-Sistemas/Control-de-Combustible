import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Image } from 'react-native';
import { Screen, Card, SectionTitle, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { FoodDistribution } from '../types/database';
import { saveFoodDistribution, listForEmployeeDay, deleteFoodDistribution } from '../lib/foodDistributions';
import QrScanner from '../components/QrScanner';
import { parseEmployeeId } from './ScanQrScreen';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasClock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}

type Person = { id: string; name: string; cedula: string | null; cargo: string | null; photo_url: string | null; companyName: string };

/**
 * Vista de COCINA: reparte la comida. Escanea el carnet de la persona (o la
 * busca por cédula), ve sus datos y registra cuántas comidas se le entregaron y
 * a qué hora. Todo queda guardado en el módulo "Distribución de comida".
 */
export default function CocinaScreen() {
  const { colors } = useTheme();
  const { session, signOut } = useAuth();
  const uid = session?.user?.id ?? '';
  const today = caracasToday();

  const [myName, setMyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [todayList, setTodayList] = useState<FoodDistribution[]>([]);
  const [meals, setMeals] = useState(1);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cedula, setCedula] = useState('');
  const [searching, setSearching] = useState(false);

  React.useEffect(() => {
    if (!uid) { setLoading(false); return; }
    supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle().then(({ data }) => {
      setMyName((data as any)?.full_name ?? '');
      setLoading(false);
    });
  }, [uid]);

  const openPerson = async (employeeId: string) => {
    setScanOpen(false);
    setNotice(null);
    const { data } = await supabase
      .from('employees')
      .select('id, first_name, last_name, cedula, cargo, photo_url, company:company_id(name)')
      .eq('id', employeeId)
      .maybeSingle();
    if (!data) { setNotice('❌ El carnet no corresponde a una persona registrada.'); return; }
    const p: Person = {
      id: (data as any).id,
      name: `${(data as any).first_name ?? ''} ${(data as any).last_name ?? ''}`.trim() || 'Sin nombre',
      cedula: (data as any).cedula ?? null,
      cargo: (data as any).cargo ?? null,
      photo_url: (data as any).photo_url ?? null,
      companyName: (data as any).company?.name ?? 'Sin empresa',
    };
    setPerson(p);
    setMeals(1);
    setNote('');
    setTodayList(await listForEmployeeDay(p.id, today));
  };

  const buscarPorCedula = async () => {
    const ci = cedula.trim();
    if (ci.length < 5) { setNotice('❌ Escribe la cédula completa.'); return; }
    setSearching(true); setNotice(null);
    const { data } = await supabase.from('employees').select('id').eq('cedula', ci).limit(1);
    setSearching(false);
    const emp = data && data[0];
    if (emp) { setCedula(''); openPerson((emp as any).id); }
    else setNotice('❌ No hay ninguna persona con esa cédula.');
  };

  const registrar = async () => {
    if (!person || meals < 1) return;
    setSaving(true); setNotice(null);
    const { data, error } = await saveFoodDistribution({
      employeeId: person.id,
      employeeName: person.name,
      cedula: person.cedula,
      meals,
      distributionDate: today,
      note,
      createdBy: uid || null,
      createdByName: myName || null,
    });
    setSaving(false);
    if (error || !data) { setNotice('❌ ' + (error ?? 'No se pudo registrar.')); return; }
    setTodayList((prev) => [data, ...prev]);
    setNote('');
    setMeals(1);
    setNotice(`✅ ${data.meals} comida(s) entregada(s) a ${person.name} · ${caracasClock(data.delivered_at)}.`);
  };

  const borrar = async (id: string) => {
    const { error } = await deleteFoodDistribution(id);
    if (error) { setNotice('❌ ' + error); return; }
    setTodayList((prev) => prev.filter((d) => d.id !== id));
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  if (loading) return <Screen><ConfigBanner /><Loading /></Screen>;

  const totalHoy = todayList.reduce((a, d) => a + (Number(d.meals) || 0), 0);

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Cocina</Text>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{myName || 'Distribución de comida'}</Text>
        </View>
        <TouchableOpacity onPress={signOut} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Salir</Text>
        </TouchableOpacity>
      </View>

      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🍽️ Entregar comida</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Escanea el carnet de la persona para registrar su comida.</Text>
        <TouchableOpacity onPress={() => setScanOpen(true)} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>📷 Escanear carnet</Text>
        </TouchableOpacity>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>¿No lee el carnet? Busca por cédula:</Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
          <TextInput value={cedula} onChangeText={(t) => setCedula(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" inputMode="numeric" placeholder="Cédula" placeholderTextColor={colors.muted} style={[input, { flex: 1 }]} />
          <TouchableOpacity onPress={buscarPorCedula} disabled={searching} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{searching ? '…' : 'Buscar'}</Text>
          </TouchableOpacity>
        </View>
      </Card>

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('❌') ? colors.danger : colors.success, fontWeight: '700' }}>{notice}</Text></Card>
      ) : null}

      {person ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              {person.photo_url ? (
                <Image source={{ uri: person.photo_url }} style={{ width: 64, height: 74, borderRadius: 8, backgroundColor: colors.surfaceAlt }} resizeMode="cover" />
              ) : (
                <View style={{ width: 64, height: 74, borderRadius: 8, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 34 }}>👤</Text></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 17 }}>{person.name}</Text>
                {person.cargo ? <Text style={{ color: colors.muted, fontSize: 12, textTransform: 'uppercase' }}>{person.cargo}</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 12 }}>{person.cedula ? `C.I ${person.cedula} · ` : ''}{person.companyName}</Text>
              </View>
            </View>
          </Card>

          <Card>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>¿Cuántas comidas se le entregan ahora?</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg }}>
              <TouchableOpacity onPress={() => setMeals((m) => Math.max(1, m - 1))} style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontSize: 26, fontWeight: '900' }}>−</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.text, fontSize: 40, fontWeight: '900', minWidth: 60, textAlign: 'center' }}>{meals}</Text>
              <TouchableOpacity onPress={() => setMeals((m) => Math.min(20, m + 1))} style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }}>
                <Text style={{ color: colors.primaryContrast, fontSize: 26, fontWeight: '900' }}>＋</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: spacing.xs }}>Hora de entrega: {caracasClock(new Date().toISOString())} (se guarda al registrar)</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nota (opcional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="Observación…" placeholderTextColor={colors.muted} style={input} />
            <TouchableOpacity onPress={registrar} disabled={saving} style={{ marginTop: spacing.md, backgroundColor: '#1E9E4A', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: saving ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>{saving ? 'Guardando…' : `🍽️ Registrar ${meals} comida(s)`}</Text>
            </TouchableOpacity>
          </Card>

          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>Hoy a {person.name.split(' ')[0]}</Text>
              <Text style={{ color: colors.primary, fontWeight: '900' }}>{totalHoy} comida(s)</Text>
            </View>
            {todayList.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Aún no se le ha entregado comida hoy.</Text>
            ) : (
              todayList.map((d) => (
                <View key={d.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>🍽️ {d.meals} · {caracasClock(d.delivered_at)}{d.note ? ` · ${d.note}` : ''}</Text>
                  <TouchableOpacity onPress={() => borrar(d.id)}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑</Text></TouchableOpacity>
                </View>
              ))
            )}
          </Card>

          <TouchableOpacity onPress={() => { setPerson(null); setNotice(null); }} style={{ padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, marginBottom: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>← Escanear otra persona</Text>
          </TouchableOpacity>
        </>
      ) : null}

      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner
            onClose={() => setScanOpen(false)}
            onDetected={(text) => {
              const id = parseEmployeeId(text);
              if (id) openPerson(id);
              else { setScanOpen(false); setNotice('❌ Ese QR no es un carnet de persona.'); }
            }}
          />
        </View>
      </Modal>
    </Screen>
  );
}
