import React, { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

/**
 * Botón + modal para que CUALQUIER usuario logueado cambie su propia contraseña.
 * Usa supabase.auth.updateUser({ password }); no requiere la contraseña actual
 * (la sesión ya está autenticada). Sirve para todos los roles.
 *
 * `variant`:
 *  - 'chip'  → botoncito compacto (para barras junto a "Salir").
 *  - 'row'   → fila ancha (para menús tipo "Más").
 */
export function ChangePasswordButton({ variant = 'chip' }: { variant?: 'chip' | 'row' }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const reset = () => { setP1(''); setP2(''); setShow(false); setMsg(null); setOkMsg(null); setBusy(false); };
  const close = () => { setOpen(false); reset(); };

  const guardar = async () => {
    setMsg(null); setOkMsg(null);
    const a = p1.trim(); const b = p2.trim();
    if (a.length < 6) { setMsg('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (a !== b) { setMsg('Las contraseñas no coinciden.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: a });
    setBusy(false);
    if (error) {
      const m = error.message.toLowerCase();
      if (m.includes('should be different') || m.includes('different from')) { setMsg('La nueva contraseña debe ser distinta a la actual.'); return; }
      setMsg(error.message);
      return;
    }
    setOkMsg('✅ Contraseña actualizada. Úsala la próxima vez que inicies sesión.');
    setP1(''); setP2('');
  };

  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.sm, color: colors.text,
  } as const;

  return (
    <>
      {variant === 'row' ? (
        <TouchableOpacity onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }}>
          <Text style={{ fontSize: 18 }}>🔑</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>Cambiar mi contraseña</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Actualiza tu clave de acceso.</Text>
          </View>
          <Text style={{ color: colors.primary, fontWeight: '800' }}>›</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={() => setOpen(true)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>🔑 Contraseña</Text>
        </TouchableOpacity>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '85%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>🔑 Cambiar contraseña</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4, marginBottom: spacing.md }}>
                Escribe tu nueva contraseña (mínimo 6 caracteres) y confírmala.
              </Text>

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Nueva contraseña</Text>
              <TextInput value={p1} onChangeText={setP1} secureTextEntry={!show} placeholder="Nueva contraseña" placeholderTextColor={colors.muted} style={input} autoCapitalize="none" />

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4, marginTop: spacing.sm }}>Repetir contraseña</Text>
              <TextInput value={p2} onChangeText={setP2} secureTextEntry={!show} placeholder="Repite la contraseña" placeholderTextColor={colors.muted} style={input} autoCapitalize="none" />

              <TouchableOpacity onPress={() => setShow((v) => !v)} style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>{show ? '🙈 Ocultar contraseñas' : '👁️ Mostrar contraseñas'}</Text>
              </TouchableOpacity>

              {msg ? <Text style={{ color: colors.danger, fontSize: 13, marginTop: spacing.sm, fontWeight: '700' }}>{msg}</Text> : null}
              {okMsg ? <Text style={{ color: colors.success, fontSize: 13, marginTop: spacing.sm, fontWeight: '700' }}>{okMsg}</Text> : null}

              {okMsg ? (
                <TouchableOpacity onPress={close} style={{ marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                  <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>Listo</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity onPress={guardar} disabled={busy} style={{ marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                    {busy ? <ActivityIndicator color={colors.primaryContrast} /> : <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>Guardar contraseña</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={close} style={{ marginTop: spacing.sm, padding: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
