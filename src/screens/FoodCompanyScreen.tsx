import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal } from 'react-native';
import { Screen, Card, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import QrScanner from '../components/QrScanner';
import { parseEmployeeId } from './ScanQrScreen';
import {
  MEALS, mealLabel, suggestedMeals, countCompanyMachines,
  listForCompanyDay, saveCompanyMeal, isCookCargo, maxDeliverable, MEAL_TOLERANCE,
} from '../lib/foodCompanyMeals';
import { FoodCompanyMeal, MealType } from '../types/database';
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
function caracasNiceDate(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(iso + 'T12:00:00'));
}

/**
 * Distribución de comida POR EMPRESA. Se abre al escanear el QR de una empresa
 * (?comida=<id>). El personal de COCINA se verifica con su carnet (cargo de
 * cocina/alimentación) y registra, una vez por día, cuántas comidas entregó en
 * cada tiempo (desayuno / almuerzo / cena). Sugerido = máquinas × 2 + 15.
 */
export default function FoodCompanyScreen({ companyId, onExit }: { companyId: string; onExit?: () => void }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const uid = session?.user?.id ?? '';
  const isAnon = !!(session?.user as any)?.is_anonymous;
  const authorId = isAnon ? null : (uid || null);
  const today = caracasToday();

  const [loading, setLoading] = useState(true);
  const [companyName, setCompanyName] = useState('');
  const [machines, setMachines] = useState(0);
  const [meals, setMeals] = useState<FoodCompanyMeal[]>([]);
  const [cook, setCook] = useState<{ name: string; cargo: string } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [cookCedula, setCookCedula] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Modal de cantidad
  const [mealFor, setMealFor] = useState<MealType | null>(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const suggested = suggestedMeals(machines);
  const maxAllowed = maxDeliverable(suggested); // sugerido + margen permitido

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, cnt, todays] = await Promise.all([
      supabase.from('companies').select('name').eq('id', companyId).maybeSingle(),
      countCompanyMachines(companyId),
      listForCompanyDay(companyId, today),
    ]);
    setCompanyName((c as any)?.name ?? 'Empresa');
    setMachines(cnt);
    setMeals(todays);
    setLoading(false);
  }, [companyId, today]);

  useEffect(() => {
    let active = true;
    (async () => {
      // En el flujo del QR la sesión suele ser ANÓNIMA (para poder registrar sin login).
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { try { await supabase.auth.signInAnonymously(); } catch {} }
      if (active) load();
    })();
    return () => { active = false; };
  }, [load]);

  // ── Verificación del cocinero por su carnet/cédula ────────────────────────────
  const verifyByEmployee = (emp: any): boolean => {
    const cargo = emp?.cargo ?? '';
    const name = `${emp?.first_name ?? ''} ${emp?.last_name ?? ''}`.trim() || 'Sin nombre';
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
    setScanOpen(false); setVerifying(true); setNotice(null);
    const { data } = await supabase.from('employees').select('first_name, last_name, cargo').eq('id', employeeId).maybeSingle();
    setVerifying(false);
    if (!data) { setNotice('❌ Ese carnet no corresponde a una persona registrada.'); return; }
    verifyByEmployee(data);
  };
  const verifyCookByCedula = async () => {
    const ci = cookCedula.trim();
    if (ci.length < 5) { setNotice('❌ Escribe tu cédula completa.'); return; }
    setVerifying(true); setNotice(null);
    const { data } = await supabase.from('employees').select('first_name, last_name, cargo').eq('cedula', ci).limit(1);
    setVerifying(false);
    const emp = data && data[0];
    if (!emp) { setNotice('❌ No hay ninguna persona con esa cédula.'); return; }
    if (verifyByEmployee(emp)) setCookCedula('');
  };

  const doneOf = (mt: MealType) => meals.find((x) => x.meal_type === mt) || null;

  const openMeal = (mt: MealType) => {
    if (!cook) { setNotice('❌ Primero verifícate escaneando tu carnet de cocina.'); return; }
    if (doneOf(mt)) { setNotice(`ℹ️ ${mealLabel(mt)} ya se registró hoy para ${companyName}.`); return; }
    setMealFor(mt); setQty(String(suggested)); setNote(''); setNotice(null);
  };

  const registrar = async () => {
    if (!mealFor || !cook) return;
    const delivered = Math.max(0, parseInt(qty || '0', 10) || 0);
    // No se puede pasar del sugerido más allá del margen permitido (evita inflar comidas).
    if (delivered > maxAllowed) {
      setNotice(`❌ Máximo permitido: ${maxAllowed} comidas (sugerido ${suggested} + margen de ${MEAL_TOLERANCE}). Ajusta la cantidad.`);
      return;
    }
    setSaving(true); setNotice(null);
    const { data, error } = await saveCompanyMeal({
      companyId, companyName, mealType: mealFor, mealDate: today,
      machines, suggested, delivered, note,
      createdBy: authorId, createdByName: cook.name, createdByCargo: cook.cargo,
    });
    setSaving(false);
    if (error || !data) { setNotice('❌ ' + (error ?? 'No se pudo registrar.')); if (error) load(); return; }
    setMeals((prev) => [...prev, data]);
    setMealFor(null);
    setNotice(`✅ ${mealLabel(mealFor)}: ${delivered} comida(s) registradas para ${companyName}.`);
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  if (loading) return <Screen><ConfigBanner /><Loading /></Screen>;

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>🍽️ Distribución de comida</Text>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '900' }}>🏢 {companyName}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, textTransform: 'capitalize' }}>{caracasNiceDate(today)}</Text>
        </View>
        {onExit ? (
          <TouchableOpacity onPress={onExit} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Salir</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: '900' }}>{machines}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>Máquinas</Text>
          </View>
          <View style={{ flex: 2, alignItems: 'center', borderLeftWidth: 1, borderLeftColor: colors.border }}>
            <Text style={{ color: colors.primary, fontSize: 22, fontWeight: '900' }}>{suggested}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>Sugerido por comida (máquinas × 2 + 15)</Text>
          </View>
        </View>
      </Card>

      {!cook ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🔒 Verifícate para registrar</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            Solo el personal de cocina/alimentación puede ingresar cantidades. Escanea TU carnet.
          </Text>
          <TouchableOpacity onPress={() => setScanOpen(true)} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>📷 Escanear mi carnet</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>¿No lee el carnet? Verifícate por cédula:</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
            <TextInput value={cookCedula} onChangeText={(t) => setCookCedula(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" inputMode="numeric" placeholder="Tu cédula" placeholderTextColor={colors.muted} style={[input, { flex: 1 }]} />
            <TouchableOpacity onPress={verifyCookByCedula} disabled={verifying} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' }}>
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
            <TouchableOpacity onPress={() => { setCook(null); setNotice(null); }} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cambiar</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('❌') ? colors.danger : notice.startsWith('ℹ️') ? colors.text : colors.success, fontWeight: '700' }}>{notice}</Text></Card>
      ) : null}

      {/* 3 botones grandes: desayuno / almuerzo / cena */}
      {MEALS.map((mt) => {
        const done = doneOf(mt.key);
        return (
          <TouchableOpacity
            key={mt.key}
            activeOpacity={0.85}
            onPress={() => openMeal(mt.key)}
            disabled={!!done}
            style={{
              borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.xs,
              backgroundColor: done ? colors.surfaceAlt : mt.color,
              borderWidth: done ? 1 : 0, borderColor: colors.border,
              opacity: !cook && !done ? 0.7 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: done ? colors.text : '#fff', fontWeight: '900', fontSize: 22 }}>{mt.icon} {mt.label}</Text>
              {done ? (
                <Text style={{ color: colors.success, fontWeight: '900', fontSize: 16 }}>✅ {done.delivered}</Text>
              ) : (
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{cook ? 'Registrar ›' : '🔒'}</Text>
              )}
            </View>
            {done ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                Entregadas {done.delivered} · sugerido {done.suggested} · {caracasClock(done.delivered_at)}{done.created_by_name ? ` · por ${done.created_by_name}` : ''}
              </Text>
            ) : (
              <Text style={{ color: '#fff', fontSize: 12, marginTop: 4, opacity: 0.9 }}>Sugerido: {suggested} comida(s) · 1 vez por día</Text>
            )}
          </TouchableOpacity>
        );
      })}

      <View style={{ height: spacing.xl }} />

      {/* Modal de cantidad */}
      <Modal visible={!!mealFor} transparent animationType="fade" onRequestClose={() => setMealFor(null)}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>{mealFor ? mealLabel(mealFor) : ''} · {companyName}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
              Sugerido: {suggested} ({machines} máquinas × 2 + 15). Escribe cuántas comidas entregaste realmente.
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.md }}>Comidas entregadas (máx. {maxAllowed})</Text>
            <TextInput
              value={qty}
              onChangeText={(t) => setQty(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad" inputMode="numeric"
              style={[input, { fontSize: 28, fontWeight: '900', textAlign: 'center', marginTop: 4, borderColor: (parseInt(qty || '0', 10) || 0) > maxAllowed ? colors.danger : colors.border }]}
            />
            {(parseInt(qty || '0', 10) || 0) > maxAllowed ? (
              <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4, fontWeight: '700' }}>
                Supera el máximo permitido ({maxAllowed} = sugerido {suggested} + margen {MEAL_TOLERANCE}).
              </Text>
            ) : null}
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nota (opcional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="Observación…" placeholderTextColor={colors.muted} style={input} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setMealFor(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={registrar} disabled={saving} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#1E9E4A', opacity: saving ? 0.6 : 1 }}>
                <Text style={{ color: '#fff', fontWeight: '900' }}>{saving ? 'Guardando…' : '🍽️ Registrar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Escáner del carnet del cocinero */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner
            onClose={() => setScanOpen(false)}
            onDetected={(text) => {
              const id = parseEmployeeId(text);
              if (id) verifyCook(id);
              else { setScanOpen(false); setNotice('❌ Ese QR no es un carnet de persona.'); }
            }}
          />
        </View>
      </Modal>
    </Screen>
  );
}
