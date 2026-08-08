import React from 'react';
import { Text, View, TouchableOpacity, Modal, Pressable, Switch, ScrollView, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from './ToastProvider';
import { isBiometricSupported, isBiometricEnabled, enableBiometric, disableBiometric } from '../lib/biometric';
import { ChangePasswordButton } from './ChangePasswordButton';
import { forceReloadLatest } from '../lib/version';

/**
 * TUERCA ⚙️ del encabezado (junto a la campana). Reemplaza la fila "Ajustes" del
 * menú "Más": un popover rápido con Modo oscuro, Iniciar sesión con huella y Cambiar
 * contraseña. "Más ajustes" abre la pantalla completa (herramientas avanzadas).
 */
export default function HeaderSettings() {
  const { colors, scheme, toggle } = useTheme();
  const toast = useToast();
  const navigation = useNavigation<any>();
  const [open, setOpen] = React.useState(false);
  const [bioSupported, setBioSupported] = React.useState(false);
  const [bioOn, setBioOn] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      setBioSupported(await isBiometricSupported());
      setBioOn(await isBiometricEnabled());
    })();
  }, []);

  const toggleBio = async (value: boolean) => {
    if (value) {
      const ok = await enableBiometric();
      if (!ok) { toast.error('No se pudo activar. Tu dispositivo debe tener huella o Face ID configurado.'); return; }
    } else {
      await disableBiometric();
    }
    setBioOn(value);
  };

  // Abre la pantalla completa de Ajustes desde CUALQUIER pantalla. Ojo: en React
  // Navigation `navigate('Ajustes')` NO lanza si la ruta no existe en el stack
  // actual — solo emite un warning y no hace nada. Por eso el try/catch anterior
  // no servía: desde una pestaña como Inicio (cuyo navegador es el Tab, que solo
  // tiene el tab "More", no "Ajustes") el botón quedaba muerto. Aquí subimos por
  // los navegadores (actual → padres) y actuamos sobre el PRIMERO que conozca la
  // ruta: si tiene el tab "More" navegamos anidado a Ajustes; si tiene "Ajustes"
  // directo (paneles de rol) vamos ahí.
  const goAjustes = () => {
    setOpen(false);
    let nav: any = navigation;
    while (nav) {
      const names: string[] = nav.getState?.()?.routeNames ?? [];
      if (names.includes('More')) { nav.navigate('More', { screen: 'Ajustes' }); return; }
      if (names.includes('Ajustes')) { nav.navigate('Ajustes'); return; }
      nav = nav.getParent?.();
    }
    // Último recurso.
    navigation.navigate('Ajustes');
  };

  return (
    <View>
      <TouchableOpacity onPress={() => setOpen(true)} style={{ paddingHorizontal: 8, paddingVertical: 4 }} accessibilityLabel="Ajustes">
        <Text style={{ fontSize: 19 }}>⚙️</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' }} onPress={() => setOpen(false)}>
          <Pressable
            onPress={(e) => e.stopPropagation?.()}
            style={{
              position: 'absolute', top: Platform.OS === 'web' ? 56 : 84, right: 10,
              width: 320, maxWidth: '92%', maxHeight: 440,
              backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
              shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
              overflow: 'hidden',
            }}
          >
            <View style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>⚙️ Ajustes</Text>
            </View>
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
              {/* Modo oscuro */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ fontWeight: '700', color: colors.text }}>Modo oscuro</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{scheme === 'dark' ? 'Activado' : 'Desactivado'} · cambia el tema</Text>
                </View>
                <Switch value={scheme === 'dark'} onValueChange={toggle} />
              </View>

              {/* Iniciar sesión con huella */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ fontWeight: '700', color: colors.text }}>Iniciar sesión con huella</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {bioSupported ? 'Pide tu huella o Face ID al abrir la app.' : 'Tu dispositivo no tiene huella o Face ID.'}
                  </Text>
                </View>
                <Switch value={bioOn} onValueChange={toggleBio} disabled={!bioSupported} />
              </View>

              {/* Cambiar contraseña */}
              <ChangePasswordButton variant="row" />

              {/* Nota: "Actualizar app" ya NO va dentro de la tuerca; es un botón propio
                  al lado del engranaje (ver UpdateAppButton en el encabezado). */}

              {/* Más ajustes (herramientas avanzadas) */}
              <TouchableOpacity onPress={goAjustes} style={{ paddingVertical: 4 }}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>⚙️ Más ajustes →</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * Botón 🔄 del encabezado (al lado de la tuerca ⚙️): fuerza la recarga a la ÚLTIMA
 * versión del app (bundle nuevo) por si el aviso automático no llega a salir (caché
 * del host). Solo web (en móvil nativo no aplica). Va como pieza propia del header,
 * no dentro del menú de ajustes.
 */
export function UpdateAppButton() {
  if (Platform.OS !== 'web') return null;
  return (
    <TouchableOpacity onPress={forceReloadLatest} style={{ paddingHorizontal: 8, paddingVertical: 4 }} accessibilityLabel="Actualizar app (última versión)">
      <Text style={{ fontSize: 18 }}>🔄</Text>
    </TouchableOpacity>
  );
}
