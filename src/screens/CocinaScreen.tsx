import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Image, Platform } from 'react-native';
import { Screen, Card, SectionTitle, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { FoodDistribution, MealType } from '../types/database';
import { saveFoodDistribution, listForEmployeeDay, deleteFoodDistribution } from '../lib/foodDistributions';
import { MEALS, mealLabel } from '../lib/foodCompanyMeals';
import QrScanner from '../components/QrScanner';
import { parseEmployeeId, parseComidaId } from './ScanQrScreen';
import { norm } from '../lib/text';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { ChangePasswordButton } from '../components/ChangePasswordButton';
import { useRealtimeRefresh } from '../hooks/useRealtime';

// Solo el personal de cocina/alimentación puede ingresar cantidades. Se valida por
// el CARGO en nómina (ayudante de cocina, alimentación, cocinero, cocina, …).
const COOK_KEYS = ['cocina', 'cociner', 'aliment'];
const isCookCargo = (cargo?: string | null): boolean => {
  const n = norm(cargo ?? '');
  return !!n && COOK_KEYS.some((k) => n.includes(k));
};

/** Abre la DISTRIBUCIÓN DE COMIDA de una empresa (QR de empresa ?comida=<id>).
 *  En web navega al deep-link, que enruta a la pantalla de la empresa. */
function openCompanyFood(companyId: string): boolean {
  if (Platform.OS !== 'web') return false;
  try {
    const w: any = globalThis;
    w.history.replaceState({}, '', `${w.location.pathname}?comida=${companyId}`);
    w.location.reload();
    return true;
  } catch { return false; }
}

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasClock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}
/** Comida sugerida según la hora de Caracas: desayuno < 11, almuerzo < 16, cena. */
function servingByTime(): MealType {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: CARACAS_TZ, hour: '2-digit', hour12: false }).format(new Date())) % 24;
  return h < 11 ? 'desayuno' : h < 16 ? 'almuerzo' : 'cena';
}

type Person = { id: string; name: string; cedula: string | null; cargo: string | null; photo_url: string | null; companyName: string };

/**
 * Vista de COCINA: reparte la comida. Escanea el carnet de la persona (o la
 * busca por cédula), ve sus datos y registra cuántas comidas se le entregaron y
 * a qué hora. Todo queda guardado en el módulo "Distribución de comida".
 */
export default function CocinaScreen({ initialEmployeeId, onConsumed }: { initialEmployeeId?: string; onConsumed?: () => void } = {}) {
  const { colors } = useTheme();
  const { session, signOut } = useAuth();
  const uid = session?.user?.id ?? '';
  const today = caracasToday();
  const consumedRef = React.useRef(false);

  const [myName, setMyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [todayList, setTodayList] = useState<FoodDistribution[]>([]);
  const [savingMeal, setSavingMeal] = useState<MealType | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cedula, setCedula] = useState('');
  const [searching, setSearching] = useState(false);
  // Persona de cocina VERIFICADA (por su propio carnet) que habilita el registro.
  const [cook, setCook] = useState<{ name: string; cargo: string } | null>(null);
  const [scanMode, setScanMode] = useState<'cook' | 'person' | 'quick'>('quick');
  const [cookCedula, setCookCedula] = useState('');
  const [verifying, setVerifying] = useState(false);
  // Comida que se está sirviendo AHORA (torniquete): cada carnet escaneado registra
  // esa comida a la persona; solo puede pasar una vez por comida al día.
  const [serving, setServing] = useState<MealType>(servingByTime());
  const [served, setServed] = useState(0); // contador de esta sesión
  // Modo de entrega: torniquete (registra la comida fija de la sesión) o
  // "elegir por persona" (al escanear abre a la persona y el cocinero elige la
  // comida — p. ej. alguien que llega a almorzar a las 4pm).
  const [scanChoose, setScanChoose] = useState(false);

  React.useEffect(() => {
    if (!uid) { setLoading(false); return; }
    supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle().then(({ data }) => {
      setMyName((data as any)?.full_name ?? '');
      setLoading(false);
    });
  }, [uid]);

  // TIEMPO REAL: si otro dispositivo registra/borra una comida de la persona
  // que tengo abierta, su lista de hoy se actualiza sola.
  useRealtimeRefresh(['food_distributions'], () => {
    if (person) listForEmployeeDay(person.id, today).then(setTodayList);
  });

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
    setTodayList(await listForEmployeeDay(p.id, today));
  };

  // Si llegó por el carnet físico (?empleado=) tras iniciar sesión como Cocina:
  // abre directo el registro de esa persona (una sola vez) y limpia la URL.
  React.useEffect(() => {
    if (consumedRef.current || !initialEmployeeId || loading) return;
    consumedRef.current = true;
    openPerson(initialEmployeeId);
    onConsumed?.();
  }, [initialEmployeeId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const buscarPorCedula = async () => {
    const ci = cedula.trim();
    if (ci.length < 5) { setNotice('❌ Escribe la cédula completa.'); return; }
    setSearching(true); setNotice(null);
    const { data } = await supabase.from('employees').select('id').eq('cedula', ci).limit(1);
    setSearching(false);
    const emp = data && data[0];
    if (emp) { setCedula(''); scanChoose ? openPerson((emp as any).id) : quickDeliver((emp as any).id); }
    else setNotice('❌ No hay ninguna persona con esa cédula.');
  };

  // ── Entrega RÁPIDA (torniquete): al escanear el carnet, registra la comida que
  //    se está sirviendo. Cada persona solo puede pasar UNA vez por comida al día. ─
  const quickDeliver = async (employeeId: string) => {
    setScanOpen(false); setNotice(null);
    if (!cook) { setNotice('❌ Primero verifícate escaneando tu carnet de cocina.'); return; }
    const { data } = await supabase
      .from('employees')
      .select('id, first_name, last_name, cedula, cargo, photo_url, company:company_id(name)')
      .eq('id', employeeId)
      .maybeSingle();
    if (!data) { setPerson(null); setNotice('❌ El carnet no corresponde a una persona registrada.'); return; }
    const p: Person = {
      id: (data as any).id,
      name: `${(data as any).first_name ?? ''} ${(data as any).last_name ?? ''}`.trim() || 'Sin nombre',
      cedula: (data as any).cedula ?? null,
      cargo: (data as any).cargo ?? null,
      photo_url: (data as any).photo_url ?? null,
      companyName: (data as any).company?.name ?? 'Sin empresa',
    };
    setPerson(p);
    const list = await listForEmployeeDay(p.id, today);
    setTodayList(list);
    // ¿Ya pasó por esta comida hoy? No se registra de nuevo.
    const already = list.find((d) => d.meal_type === serving);
    if (already) {
      setNotice(`⚠️ ${p.name} YA pasó por ${mealLabel(serving).toUpperCase()} hoy (${caracasClock(already.delivered_at)}). No se registró de nuevo.`);
      return;
    }
    const { data: saved, error } = await saveFoodDistribution({
      employeeId: p.id, employeeName: p.name, cedula: p.cedula,
      meals: 1, mealType: serving, distributionDate: today, note: '',
      createdBy: uid || null, createdByName: cook?.name || myName || null,
    });
    if (error || !saved) { setNotice('❌ ' + (error ?? 'No se pudo registrar.')); return; }
    setTodayList((prev) => [saved, ...prev]);
    setServed((s) => s + 1);
    setNotice(`✅ ${mealLabel(serving).toUpperCase()} entregado a ${p.name} · ${caracasClock(saved.delivered_at)}.`);
  };

  // ── Verificación del que reparte: escanea SU carnet (o busca por cédula). Solo
  //    si su cargo en nómina es de cocina/alimentación queda habilitado.
  const verifyCookByEmployee = (empData: any): boolean => {
    const cargo = empData?.cargo ?? '';
    const name = `${empData?.first_name ?? ''} ${empData?.last_name ?? ''}`.trim() || 'Sin nombre';
    if (!isCookCargo(cargo)) {
      setCook(null);
      setNotice(`❌ ${name}${cargo ? ` (${cargo})` : ''} no tiene cargo de cocina/alimentación: no puede ingresar cantidades.`);
      return false;
    }
    setCook({ name, cargo });
    setNotice(`✅ Verificado: ${name} — ${cargo}. Ya puedes registrar las comidas.`);
    return true;
  };

  const verifyCook = async (employeeId: string) => {
    setScanOpen(false);
    setVerifying(true); setNotice(null);
    const { data } = await supabase.from('employees').select('first_name, last_name, cargo').eq('id', employeeId).maybeSingle();
    setVerifying(false);
    if (!data) { setNotice('❌ Ese carnet no corresponde a una persona registrada.'); return; }
    verifyCookByEmployee(data);
  };

  const buscarCookPorCedula = async () => {
    const ci = cookCedula.trim();
    if (ci.length < 5) { setNotice('❌ Escribe tu cédula completa.'); return; }
    setVerifying(true); setNotice(null);
    const { data } = await supabase.from('employees').select('first_name, last_name, cargo').eq('cedula', ci).limit(1);
    setVerifying(false);
    const emp = data && data[0];
    if (!emp) { setNotice('❌ No hay ninguna persona con esa cédula.'); return; }
    if (verifyCookByEmployee(emp)) setCookCedula('');
  };

  const doneMeal = (mt: MealType) => todayList.find((d) => d.meal_type === mt) || null;

  const registrarMeal = async (mealType: MealType) => {
    if (!cook) { setNotice('❌ Primero verifícate escaneando tu carnet de cocina.'); return; }
    if (!person) return;
    if (doneMeal(mealType)) { setNotice(`ℹ️ ${mealLabel(mealType)} ya se registró hoy para ${person.name}.`); return; }
    setSavingMeal(mealType); setNotice(null);
    const { data, error } = await saveFoodDistribution({
      employeeId: person.id,
      employeeName: person.name,
      cedula: person.cedula,
      meals: 1,
      mealType,
      distributionDate: today,
      note: '',
      createdBy: uid || null,
      createdByName: cook?.name || myName || null,
    });
    setSavingMeal(null);
    if (error || !data) { setNotice('❌ ' + (error ?? 'No se pudo registrar.')); return; }
    setTodayList((prev) => [data, ...prev]);
    setNotice(`✅ ${mealLabel(mealType)} registrado para ${person.name} · ${caracasClock(data.delivered_at)}.`);
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <ChangePasswordButton />
          <TouchableOpacity onPress={signOut} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Salir</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!cook ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🔒 Verifícate para repartir</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            Solo el personal de cocina/alimentación puede ingresar cantidades. Escanea TU carnet para habilitar el registro.
          </Text>
          <TouchableOpacity onPress={() => { setScanMode('cook'); setScanOpen(true); }} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>📷 Escanear mi carnet</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>¿No lee el carnet? Verifícate por cédula:</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
            <TextInput value={cookCedula} onChangeText={(t) => setCookCedula(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" inputMode="numeric" placeholder="Tu cédula" placeholderTextColor={colors.muted} style={[input, { flex: 1 }]} />
            <TouchableOpacity onPress={buscarCookPorCedula} disabled={verifying} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{verifying ? '…' : 'Verificar'}</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ) : (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.success, fontWeight: '800', fontSize: 14 }}>👨‍🍳 {cook.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 11 }}>{cook.cargo} · autorizado para repartir</Text>
            </View>
            <TouchableOpacity onPress={() => { setCook(null); setPerson(null); setNotice(null); }} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cambiar</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {cook ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🍽️ Entregar comida</Text>
          {/* Modo de entrega. */}
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
            {[
              { on: false, icon: '⚡', label: 'Torniquete', hint: 'comida fija' },
              { on: true, icon: '🖐', label: 'Elegir por persona', hint: 'p. ej. almuerzo 4pm' },
            ].map((m) => {
              const active = scanChoose === m.on;
              return (
                <TouchableOpacity
                  key={String(m.on)}
                  onPress={() => setScanChoose(m.on)}
                  style={{ flex: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: radius.md, alignItems: 'center', backgroundColor: active ? colors.primary : colors.surface, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}
                >
                  <Text style={{ color: active ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{m.icon} {m.label}</Text>
                  <Text style={{ color: active ? colors.primaryContrast : colors.muted, fontSize: 10, marginTop: 1 }}>{m.hint}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {scanChoose ? (
            <>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Al escanear se abre a la persona y tú eliges la comida (desayuno / almuerzo / cena). Ideal cuando alguien llega fuera de hora.</Text>
              <TouchableOpacity onPress={() => { setScanMode('quick'); setScanOpen(true); }} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>📷 Escanear carnet — elegir comida</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Elige la comida que se está sirviendo. Cada carnet escaneado registra esa comida (solo puede pasar una vez por comida).</Text>
              {/* Selector de la comida que se está sirviendo ahora. */}
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                {MEALS.map((mt) => {
                  const active = serving === mt.key;
                  return (
                    <TouchableOpacity
                      key={mt.key}
                      onPress={() => setServing(mt.key)}
                      style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: active ? mt.color : colors.surface, borderWidth: 1, borderColor: active ? mt.color : colors.border }}
                    >
                      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '800', fontSize: 13 }}>{mt.icon} {mt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>Sirviendo: <Text style={{ color: colors.text, fontWeight: '800' }}>{mealLabel(serving).toUpperCase()}</Text> · Entregadas en esta sesión: <Text style={{ color: colors.primary, fontWeight: '800' }}>{served}</Text></Text>
              <TouchableOpacity onPress={() => { setScanMode('quick'); setScanOpen(true); }} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>📷 Escanear carnet — entregar {mealLabel(serving).toUpperCase()}</Text>
              </TouchableOpacity>
            </>
          )}

          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>💡 También puedes escanear el QR de una EMPRESA para registrar sus comidas.</Text>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>¿No lee el carnet? Busca por cédula:</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
            <TextInput value={cedula} onChangeText={(t) => setCedula(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" inputMode="numeric" placeholder="Cédula" placeholderTextColor={colors.muted} style={[input, { flex: 1 }]} />
            <TouchableOpacity onPress={buscarPorCedula} disabled={searching} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{searching ? '…' : (scanChoose ? 'Abrir' : 'Entregar')}</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ) : null}

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('❌') ? colors.danger : notice.startsWith('⚠️') ? colors.warning : colors.success, fontWeight: '700' }}>{notice}</Text></Card>
      ) : null}

      {cook && person ? (
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
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Marca la comida que se le entrega (1 vez por día cada una):</Text>
            <View style={{ gap: spacing.sm }}>
              {MEALS.map((mt) => {
                const done = doneMeal(mt.key);
                const busy = savingMeal === mt.key;
                return (
                  <TouchableOpacity
                    key={mt.key}
                    onPress={() => registrarMeal(mt.key)}
                    disabled={!!done || busy}
                    style={{ borderRadius: radius.md, padding: spacing.md, backgroundColor: done ? colors.surfaceAlt : mt.color, borderWidth: done ? 1 : 0, borderColor: colors.border, opacity: busy ? 0.6 : 1 }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ color: done ? colors.text : '#fff', fontWeight: '900', fontSize: 18 }}>{mt.icon} {mt.label}</Text>
                      {done ? (
                        <Text style={{ color: colors.success, fontWeight: '900', fontSize: 13 }}>✅ {caracasClock(done.delivered_at)}</Text>
                      ) : (
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{busy ? 'Guardando…' : 'Marcar ›'}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
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
                  <Text style={{ color: colors.text, fontSize: 13 }}>🍽️ {d.meal_type ? mealLabel(d.meal_type) : `${d.meals} comida(s)`} · {caracasClock(d.delivered_at)}{d.note ? ` · ${d.note}` : ''}</Text>
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
              if (id) {
                if (scanMode === 'cook') verifyCook(id);
                else if (scanMode === 'quick') { scanChoose ? openPerson(id) : quickDeliver(id); }
                else openPerson(id);
                return;
              }
              // ¿Es un QR de EMPRESA (distribución de comida)? Abre esa empresa.
              const companyId = parseComidaId(text);
              if (companyId) { setScanOpen(false); if (!openCompanyFood(companyId)) setNotice('❌ No se pudo abrir la empresa desde este dispositivo.'); return; }
              setScanOpen(false);
              setNotice('❌ Ese QR no es un carnet de persona ni de empresa.');
            }}
          />
        </View>
      </Modal>
    </Screen>
  );
}
