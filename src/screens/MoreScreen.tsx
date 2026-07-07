import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, Switch, Alert, Modal, TextInput, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  isBiometricSupported,
  isBiometricEnabled,
  enableBiometric,
  disableBiometric,
} from '../lib/biometric';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const items: { label: string; route: string; desc: string; icon: string }[] = [
  { label: 'Catálogo maquinaria/vehículos', route: 'Equipos', desc: 'Registra vehículos, maquinaria y maquinaria pesada', icon: '🚜' },
  { label: 'Control Maquinaria', route: 'ControlMaquinaria', desc: 'Rondas 07/11/15/19 y horas de parada', icon: '🛠️' },
  { label: 'Mapa', route: 'Map', desc: 'Ubicación de las máquinas en Venezuela', icon: '🗺️' },
  { label: 'Autorizaciones', route: 'Authorizations', desc: 'Solicitudes y aprobaciones', icon: '✅' },
  { label: 'Traslados', route: 'Transfers', desc: 'Movimientos entre tanques', icon: '🔄' },
  { label: 'Reportes', route: 'Reports', desc: 'Combustible y rondas (PDF)', icon: '📊' },
];

export default function MoreScreen({ navigation }: any) {
  const { signOut, session, configured, role } = useAuth();
  const { colors, scheme, toggle } = useTheme();
  const [bioSupported, setBioSupported] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  const changeMyPassword = async () => {
    setPwError(null);
    if (pw1.length < 6) {
      setPwError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (pw1 !== pw2) {
      setPwError('Las contraseñas no coinciden.');
      return;
    }
    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setPwSaving(false);
    if (error) {
      setPwError(error.message);
      return;
    }
    setPw1('');
    setPw2('');
    setPwOk(true);
  };

  useEffect(() => {
    (async () => {
      setBioSupported(await isBiometricSupported());
      setBioOn(await isBiometricEnabled());
    })();
  }, []);

  const toggleBio = async (value: boolean) => {
    if (value) {
      const ok = await enableBiometric();
      if (!ok) {
        Alert.alert('Biometría', 'No se pudo activar. Tu dispositivo debe tener huella o Face ID configurado.');
        return;
      }
    } else {
      await disableBiometric();
    }
    setBioOn(value);
  };

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Más</SectionTitle>
      {items.map((it) => (
        <TouchableOpacity key={it.route} onPress={() => navigation.navigate(it.route)}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Text style={{ fontSize: 26 }}>{it.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>{it.label}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{it.desc}</Text>
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      ))}

      {role === 'admin' ? (
        <TouchableOpacity onPress={() => navigation.navigate('Users')}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Text style={{ fontSize: 26 }}>👥</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>Usuarios</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Crear personas, ver conectados y asignar roles</Text>
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      ) : null}

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

      <TouchableOpacity
        onPress={() => {
          setPw1('');
          setPw2('');
          setPwError(null);
          setPwOk(false);
          setShowPw(false);
          setPwOpen(true);
        }}
      >
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Text style={{ fontSize: 22 }}>🔑</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: colors.text }}>Cambiar mi contraseña</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Actualiza la contraseña de tu cuenta</Text>
            </View>
          </View>
        </Card>
      </TouchableOpacity>

      {/* Cambiar contraseña propia */}
      <Modal visible={pwOpen} animationType="slide" transparent onRequestClose={() => setPwOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 18, marginBottom: spacing.md }}>Cambiar mi contraseña</Text>
            {pwOk ? (
              <Text style={{ color: colors.success, fontWeight: '600', marginBottom: spacing.md }}>
                ✅ Contraseña actualizada. Úsala la próxima vez que inicies sesión.
              </Text>
            ) : (
              <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <TextInput
                    style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text }}
                    placeholder="Nueva contraseña (mín. 6)"
                    placeholderTextColor={colors.muted}
                    value={pw1}
                    onChangeText={setPw1}
                    secureTextEntry={!showPw}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowPw((v) => !v)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{showPw ? '🙈' : '👁'}</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text }}
                  placeholder="Repetir contraseña"
                  placeholderTextColor={colors.muted}
                  value={pw2}
                  onChangeText={setPw2}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                />
                {pwError ? <Text style={{ color: colors.danger }}>{pwError}</Text> : null}
              </ScrollView>
            )}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setPwOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{pwOk ? 'Cerrar' : 'Cancelar'}</Text>
              </TouchableOpacity>
              {!pwOk ? (
                <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={changeMyPassword} disabled={pwSaving}>
                  <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{pwSaving ? 'Guardando…' : 'Guardar'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

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
