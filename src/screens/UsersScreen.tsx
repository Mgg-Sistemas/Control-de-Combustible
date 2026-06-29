import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { Profile, UserRole } from '../types/database';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const ROLES: UserRole[] = ['admin', 'supervisor', 'operador', 'conductor'];

export default function UsersScreen() {
  const { role, onlineIds, session } = useAuth();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data: users, loading, refetch } = useTable<Profile>('profiles', { orderBy: 'full_name', ascending: true });
  const [formOpen, setFormOpen] = useState(false);

  if (role !== 'admin') {
    return (
      <Screen>
        <SectionTitle>Usuarios</SectionTitle>
        <EmptyState
          title="Solo administradores"
          subtitle="No tienes permisos para gestionar usuarios."
        />
      </Screen>
    );
  }

  const onlineCount = users.filter((u) => onlineIds.includes(u.id)).length;

  const changeRole = async (id: string, newRole: UserRole) => {
    await supabase.from('profiles').update({ role: newRole }).eq('id', id);
    refetch();
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Usuarios</SectionTitle>
        <TouchableOpacity style={styles.addBtn} onPress={() => setFormOpen(true)}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nuevo</Text>
        </TouchableOpacity>
      </View>

      <Card>
        <Text style={{ color: colors.muted, fontSize: 12 }}>Conectados ahora</Text>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.success }}>
          {onlineCount} / {users.length}
        </Text>
      </Card>

      {loading ? (
        <Loading />
      ) : users.length === 0 ? (
        <EmptyState title="Sin usuarios" />
      ) : (
        users.map((u) => {
          const online = onlineIds.includes(u.id);
          const isSelf = u.id === session?.user?.id;
          return (
            <Card key={u.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: online ? colors.success : colors.border,
                    }}
                  />
                  <Text style={{ fontWeight: '700', color: colors.text }}>
                    {u.full_name ?? 'Sin nombre'}
                    {isSelf ? ' (tú)' : ''}
                  </Text>
                </View>
                <Badge label={online ? 'En línea' : 'Desconectado'} tone={online ? 'success' : 'muted'} />
              </View>

              <Text style={[typography.muted, { marginTop: spacing.xs }]}>Rol</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {ROLES.map((r) => {
                  const activeRole = u.role === r;
                  return (
                    <TouchableOpacity
                      key={r}
                      disabled={isSelf}
                      onPress={() => changeRole(u.id, r)}
                      style={[styles.chip, activeRole && styles.chipActive, isSelf && { opacity: 0.5 }]}
                    >
                      <Text style={{ color: activeRole ? colors.primaryContrast : colors.text, fontSize: 13 }}>
                        {r}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {isSelf ? (
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  No puedes cambiar tu propio rol.
                </Text>
              ) : null}
            </Card>
          );
        })
      )}

      <NewUserForm visible={formOpen} onClose={() => setFormOpen(false)} onSaved={refetch} />
    </Screen>
  );
}

function NewUserForm({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('conductor');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const reset = () => {
    setFirstName('');
    setLastName('');
    setPassword('');
    setRole('conductor');
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!firstName.trim() || !lastName.trim() || !password) {
      setError('Nombre, apellido y contraseña son obligatorios.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: { first_name: firstName, last_name: lastName, password, role },
    });
    setSaving(false);
    if (error || (data as any)?.error) {
      setError((data as any)?.error ?? error?.message ?? 'No se pudo crear el usuario.');
      return;
    }
    reset();
    onSaved();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={[typography.title, { marginBottom: spacing.md }]}>Nuevo usuario</Text>
          <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
            <TextInput style={styles.input} placeholder="Nombre" placeholderTextColor={colors.muted} value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
            <TextInput style={styles.input} placeholder="Apellido" placeholderTextColor={colors.muted} value={lastName} onChangeText={setLastName} autoCapitalize="words" />
            <TextInput style={styles.input} placeholder="Contraseña (mín. 6)" placeholderTextColor={colors.muted} value={password} onChangeText={setPassword} secureTextEntry />
            <Text style={typography.muted}>Rol</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {ROLES.map((r) => (
                <TouchableOpacity key={r} onPress={() => setRole(r)} style={[styles.chip, role === r && styles.chipActive]}>
                  <Text style={{ color: role === r ? colors.primaryContrast : colors.text, fontSize: 13 }}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surfaceAlt }]} onPress={onClose}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={submit} disabled={saving}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>
                {saving ? 'Creando…' : 'Crear usuario'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
  },
  btn: { flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center' },
});
