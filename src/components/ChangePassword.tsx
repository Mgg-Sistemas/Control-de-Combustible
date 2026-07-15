import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

/**
 * Botón + modal para que CUALQUIER usuario logueado cambie su propia contraseña.
 * Reutilizable en las vistas por rol (operador, supervisor, cocina) donde no hay
 * menú "Más". `variant`: 'card' (tarjeta) o 'icon' (botón compacto para cabecera).
 */
export default function ChangePassword({ variant = 'card' }: { variant?: 'card' | 'icon' }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const openModal = () => { setPw1(''); setPw2(''); setError(null); setOk(false); setShowPw(false); setOpen(true); };

  const save = async () => {
    setError(null);
    if (pw1.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (pw1 !== pw2) { setError('Las contraseñas no coinciden.'); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setPw1(''); setPw2(''); setOk(true);
  };

  return (
    <>
      {variant === 'icon' ? (
        <TouchableOpacity onPress={openModal} style={{ paddingHorizontal: 10, paddingVertical: 4 }} accessibilityLabel="Cambiar contraseña">
          <Text style={{ fontSize: 18 }}>🔑</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={openModal} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
          <Text style={{ fontSize: 20 }}>🔑</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Cambiar mi contraseña</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Actualiza la contraseña de tu cuenta</Text>
          </View>
        </TouchableOpacity>
      )}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 18, marginBottom: spacing.md }}>Cambiar mi contraseña</Text>
            {ok ? (
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
                {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
              </ScrollView>
            )}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{ok ? 'Cerrar' : 'Cancelar'}</Text>
              </TouchableOpacity>
              {!ok ? (
                <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={save} disabled={saving}>
                  <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{saving ? 'Guardando…' : 'Guardar'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
