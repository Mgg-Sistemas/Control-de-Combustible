import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, Switch, TextInput } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import {
  isBiometricSupported,
  isBiometricEnabled,
  enableBiometric,
  disableBiometric,
} from '../lib/biometric';
import { supabase } from '../lib/supabase';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { norm } from '../lib/text';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { ChangePasswordButton } from '../components/ChangePasswordButton';

const MAQUINAS_TOGGLE_KEY = 'maquinas_bulk_toggle';

type ToggleProfile = { id: string; full_name: string | null; username: string | null };
type SearchProfile = { id: string; full_name: string | null; username: string | null; cedula: string | null };

/**
 * AJUSTES — preferencias de la cuenta y del dispositivo, reunidas en un módulo
 * propio: apariencia (modo oscuro), seguridad (contraseña + huella/Face ID) y
 * cerrar sesión. Antes vivían al final de la pantalla "Más"; se separaron para
 * que "Más" sea solo el menú de módulos.
 */
export default function AjustesScreen() {
  const { signOut, session, configured, role } = useAuth();
  const { colors, scheme, toggle } = useTheme();
  const toast = useToast();
  const [bioSupported, setBioSupported] = useState(false);
  const [bioOn, setBioOn] = useState(false);

  // Panel "🔧 Activar/desactivar máquinas por supervisor" (feature_toggles.maquinas_bulk_toggle).
  const [maqEnabled, setMaqEnabled] = useState(true);
  const [maqConfigured, setMaqConfigured] = useState(true); // false = la fila aún no existe en la BD
  const [maqExtraIds, setMaqExtraIds] = useState<string[]>([]);
  const [maqSaving, setMaqSaving] = useState(false);
  const [maqExtraProfiles, setMaqExtraProfiles] = useState<ToggleProfile[]>([]);
  const [allProfiles, setAllProfiles] = useState<SearchProfile[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerBusyId, setPickerBusyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setBioSupported(await isBiometricSupported());
      setBioOn(await isBiometricEnabled());
    })();
  }, []);

  const loadMaqToggle = async () => {
    if (role !== 'admin') return;
    const { data } = await supabase
      .from('feature_toggles')
      .select('enabled, extra_user_ids')
      .eq('key', MAQUINAS_TOGGLE_KEY)
      .maybeSingle();
    if (!data) {
      setMaqConfigured(false);
      setMaqEnabled(true);
      setMaqExtraIds([]);
      return;
    }
    setMaqConfigured(true);
    setMaqEnabled(!!data.enabled);
    setMaqExtraIds(Array.isArray(data.extra_user_ids) ? data.extra_user_ids : []);
  };

  const loadAllProfiles = async () => {
    if (role !== 'admin') return;
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, username, cedula')
      .order('full_name');
    setAllProfiles((data as SearchProfile[]) ?? []);
  };

  useEffect(() => {
    loadMaqToggle();
    loadAllProfiles();
  }, [role]);

  const loadExtraProfiles = async () => {
    if (role !== 'admin' || maqExtraIds.length === 0) {
      setMaqExtraProfiles([]);
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, username')
      .in('id', maqExtraIds);
    setMaqExtraProfiles((data as ToggleProfile[]) ?? []);
  };

  useEffect(() => { loadExtraProfiles(); }, [role, maqExtraIds]);

  // Panel de admin: se sincroniza en vivo si otro admin cambia el toggle o la
  // lista de accesos extra desde otro dispositivo.
  useRealtimeRefresh(['feature_toggles', 'profiles'], () => {
    loadMaqToggle();
    loadAllProfiles();
    loadExtraProfiles();
  });

  const saveMaqToggle = async (patch: { enabled?: boolean; extra_user_ids?: string[] }) => {
    setMaqSaving(true);
    const { error } = await supabase.from('feature_toggles').upsert({
      key: MAQUINAS_TOGGLE_KEY,
      enabled: patch.enabled ?? maqEnabled,
      extra_user_ids: patch.extra_user_ids ?? maqExtraIds,
      updated_at: new Date().toISOString(),
      updated_by: session?.user?.id ?? null,
    });
    setMaqSaving(false);
    if (error) {
      toast.error(`No se pudo guardar: ${error.message}`);
      return false;
    }
    setMaqConfigured(true);
    return true;
  };

  const toggleMaq = async (value: boolean) => {
    const prev = maqEnabled;
    setMaqEnabled(value);
    const ok = await saveMaqToggle({ enabled: value });
    if (!ok) {
      setMaqEnabled(prev);
      return;
    }
    toast.success(value ? 'Panel activado.' : 'Panel desactivado.');
  };

  const addExtraUser = async (p: SearchProfile) => {
    if (maqExtraIds.includes(p.id)) return;
    const next = [...maqExtraIds, p.id];
    setPickerBusyId(p.id);
    const ok = await saveMaqToggle({ extra_user_ids: next });
    setPickerBusyId(null);
    if (!ok) return;
    setMaqExtraIds(next);
    toast.success('Acceso agregado.');
  };

  const removeExtraUser = async (id: string) => {
    const next = maqExtraIds.filter((x) => x !== id);
    setPickerBusyId(id);
    const ok = await saveMaqToggle({ extra_user_ids: next });
    setPickerBusyId(null);
    if (!ok) return;
    setMaqExtraIds(next);
    toast.success('Acceso quitado.');
  };

  const pq = norm(pickerQuery.trim());
  const pickerResults = !pq
    ? []
    : allProfiles
        .filter(
          (p) =>
            !maqExtraIds.includes(p.id) &&
            (norm(p.full_name).includes(pq) || norm(p.username).includes(pq) || norm(p.cedula).includes(pq))
        )
        .slice(0, 8);

  const toggleBio = async (value: boolean) => {
    if (value) {
      const ok = await enableBiometric();
      if (!ok) {
        toast.error('No se pudo activar. Tu dispositivo debe tener huella o Face ID configurado.');
        return;
      }
    } else {
      await disableBiometric();
    }
    setBioOn(value);
  };

  return (
    <Screen>
      <SectionTitle>Apariencia</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Modo oscuro</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {scheme === 'dark' ? 'Activado' : 'Desactivado'} · cambia el tema de la app
            </Text>
          </View>
          <Switch value={scheme === 'dark'} onValueChange={toggle} />
        </View>
      </Card>

      <SectionTitle>Seguridad</SectionTitle>
      <View style={{ marginBottom: spacing.md }}>
        <ChangePasswordButton variant="row" />
      </View>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Iniciar sesión con huella</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {bioSupported
                ? 'Pide tu huella o Face ID al abrir la app.'
                : 'Tu dispositivo no tiene huella o Face ID configurado.'}
            </Text>
          </View>
          <Switch value={bioOn} onValueChange={toggleBio} disabled={!bioSupported} />
        </View>
      </Card>

      {role === 'admin' ? (
        <>
          <SectionTitle>Herramientas avanzadas</SectionTitle>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1, paddingRight: spacing.md }}>
                <Text style={{ fontWeight: '700', color: colors.text }}>
                  Panel de activar/desactivar máquinas por supervisor
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  Controla si el panel del dashboard de Inspecciones para activar/desactivar máquinas está disponible.
                  {!maqConfigured ? ' (aún no configurado en la base de datos)' : ''}
                </Text>
              </View>
              <Switch value={maqEnabled} onValueChange={toggleMaq} disabled={maqSaving} />
            </View>

            <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Personas con acceso extra</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                Además de los administradores, estas personas también pueden usar el panel.
              </Text>
              {maqExtraProfiles.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>Nadie tiene acceso extra todavía.</Text>
              ) : (
                maqExtraProfiles.map((p) => (
                  <View
                    key={p.id}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}
                  >
                    <Text style={{ color: colors.text, fontSize: 13 }}>{p.full_name ?? p.username ?? p.id}</Text>
                    <TouchableOpacity onPress={() => removeExtraUser(p.id)} disabled={pickerBusyId === p.id}>
                      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>
                        {pickerBusyId === p.id ? '…' : '✕ Quitar'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}

              <TouchableOpacity onPress={() => setPickerOpen((o) => !o)} style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                  {pickerOpen ? '▴ Cerrar buscador' : '▾ + Agregar persona'}
                </Text>
              </TouchableOpacity>
              {pickerOpen ? (
                <View style={{ marginTop: spacing.xs }}>
                  <TextInput
                    value={pickerQuery}
                    onChangeText={setPickerQuery}
                    placeholder="🔎 Buscar por nombre, usuario o cédula…"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      padding: spacing.sm,
                      color: colors.text,
                    }}
                  />
                  {pickerResults.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => addExtraUser(p)}
                      disabled={pickerBusyId === p.id}
                      style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs }}
                    >
                      <Text style={{ color: colors.text, fontSize: 13 }}>
                        {p.full_name ?? 'Sin nombre'}
                        {p.username ? ` · ${p.username}` : ''}
                      </Text>
                      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>
                        {pickerBusyId === p.id ? '…' : '+ Agregar'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {pq && pickerResults.length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Sin resultados.</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </Card>
        </>
      ) : null}

      <View style={{ height: spacing.lg }} />
      {configured && session ? (
        <TouchableOpacity onPress={signOut}>
          <Card style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.danger, fontWeight: '700' }}>Cerrar sesión</Text>
          </Card>
        </TouchableOpacity>
      ) : null}
    </Screen>
  );
}
