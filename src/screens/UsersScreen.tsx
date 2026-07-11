import React, { useEffect, useMemo, useState } from 'react';
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
import { norm } from '../lib/text';
import { Profile, UserRole } from '../types/database';
import { MODULES, LEVELS, PermLevel, defaultLevel } from '../lib/permissions';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { useConfirm } from '../components/ConfirmProvider';

const ROLES: UserRole[] = ['admin', 'supervisor', 'analista', 'operador', 'conductor'];

export default function UsersScreen() {
  const { role, onlineIds, session } = useAuth();
  const { colors, typography } = useTheme();
  const confirm = useConfirm();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data: users, loading, refetch } = useTable<Profile>('profiles', { orderBy: 'full_name', ascending: true });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [query, setQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [delError, setDelError] = useState<string | null>(null);

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
  const q = norm(query.trim());
  const filtered = !q
    ? users
    : users.filter((u) => norm(u.full_name).includes(q) || norm(u.role).includes(q));

  const changeRole = async (id: string, newRole: UserRole) => {
    await supabase.from('profiles').update({ role: newRole }).eq('id', id);
    refetch();
  };

  const removeUser = async (u: Profile) => {
    const ok = await confirm({
      title: 'Eliminar usuario',
      message: `¿Desea eliminar a "${u.full_name ?? 'este usuario'}"? Esta acción no se puede deshacer.`,
      confirmText: 'Aceptar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    setDeletingId(u.id);
    setDelError(null);
    const { data, error } = await supabase.functions.invoke('admin-manage-user', {
      body: { action: 'delete', id: u.id },
    });
    setDeletingId(null);
    if (error || (data as any)?.error) {
      setDelError(`${u.full_name ?? 'Usuario'}: ${(data as any)?.error ?? error?.message ?? 'No se pudo eliminar.'}`);
      return;
    }
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

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔎 Buscar usuario por nombre o rol…"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />

      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState title={query ? 'Sin resultados' : 'Sin usuarios'} subtitle={query ? 'Prueba con otra búsqueda.' : undefined} />
      ) : (
        filtered.map((u) => {
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

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                <TouchableOpacity
                  onPress={() => setEditing(u)}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                >
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>✏️ Editar / contraseña</Text>
                </TouchableOpacity>
                {!isSelf ? (
                  <TouchableOpacity
                    onPress={() => removeUser(u)}
                    disabled={deletingId === u.id}
                    style={{ borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                  >
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>
                      {deletingId === u.id ? 'Eliminando…' : '🗑️ Eliminar'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {delError && delError.startsWith((u.full_name ?? 'Usuario')) ? (
                <Text style={{ color: colors.danger, fontSize: 12, marginTop: spacing.xs }}>{delError}</Text>
              ) : null}
            </Card>
          );
        })
      )}

      <NewUserForm visible={formOpen} onClose={() => setFormOpen(false)} onSaved={refetch} />
      <EditUserForm
        user={editing}
        isSelf={editing?.id === session?.user?.id}
        onClose={() => setEditing(null)}
        onSaved={refetch}
      />
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
  const [showPass, setShowPass] = useState(false);
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
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Contraseña (mín. 6)" placeholderTextColor={colors.muted} value={password} onChangeText={setPassword} secureTextEntry={!showPass} autoCapitalize="none" />
              <TouchableOpacity onPress={() => setShowPass((v) => !v)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{showPass ? '🙈 Ocultar' : '👁 Ver'}</Text>
              </TouchableOpacity>
            </View>
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

function EditUserForm({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: Profile | null;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [perms, setPerms] = useState<Record<string, PermLevel>>({});
  const { colors, typography } = useTheme();
  const confirm = useConfirm();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    setFullName(user?.full_name ?? '');
    setPassword('');
    setShowPass(false);
    setError(null);
    setPerms({});
    if (user) {
      supabase
        .from('module_permissions')
        .select('module, level')
        .eq('user_id', user.id)
        .then(({ data }) => {
          const m: Record<string, PermLevel> = {};
          (data ?? []).forEach((r: any) => (m[r.module] = r.level));
          setPerms(m);
        });
    }
  }, [user]);

  const setPerm = async (moduleKey: string, level: PermLevel) => {
    if (!user) return;
    setPerms((p) => ({ ...p, [moduleKey]: level }));
    await supabase
      .from('module_permissions')
      .upsert({ user_id: user.id, module: moduleKey, level }, { onConflict: 'user_id,module' });
  };

  if (!user) return null;
  const isAdminUser = user.role === 'admin';

  const save = async () => {
    setError(null);
    if (!fullName.trim()) {
      setError('El nombre no puede quedar vacío.');
      return;
    }
    if (password && password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('admin-manage-user', {
      body: { action: 'update', id: user.id, full_name: fullName, password: password || undefined },
    });
    setSaving(false);
    if (error || (data as any)?.error) {
      setError((data as any)?.error ?? error?.message ?? 'No se pudo guardar.');
      return;
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Eliminar usuario',
      message: `¿Desea eliminar a "${user.full_name ?? 'este usuario'}"? Esta acción no se puede deshacer.`,
      confirmText: 'Aceptar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke('admin-manage-user', {
      body: { action: 'delete', id: user.id },
    });
    setDeleting(false);
    if (error || (data as any)?.error) {
      setError((data as any)?.error ?? error?.message ?? 'No se pudo eliminar.');
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal visible={!!user} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={[typography.title, { marginBottom: spacing.md }]}>Editar usuario</Text>
          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: spacing.sm }}>
            <Text style={typography.muted}>Nombre completo</Text>
            <TextInput style={styles.input} placeholder="Nombre y apellido" placeholderTextColor={colors.muted} value={fullName} onChangeText={setFullName} autoCapitalize="words" />
            <Text style={typography.muted}>Nueva contraseña (opcional)</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Dejar vacío para no cambiar" placeholderTextColor={colors.muted} value={password} onChangeText={setPassword} secureTextEntry={!showPass} autoCapitalize="none" />
              <TouchableOpacity onPress={() => setShowPass((v) => !v)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{showPass ? '🙈' : '👁'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={[typography.muted, { marginTop: spacing.sm }]}>Permisos por módulo</Text>
            {isAdminUser ? (
              <Text style={{ color: colors.success, fontSize: 12 }}>
                Este usuario es administrador: tiene acceso total a todos los módulos.
              </Text>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 11 }}>
                — Sin acceso · L Lectura · E Escritura · F Full control
              </Text>
            )}
            {MODULES.map((mod) => {
              const cur = perms[mod.key] ?? defaultLevel(mod.key);
              return (
                <View key={mod.key} style={{ marginTop: 2 }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{mod.label}</Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginTop: 3 }}>
                    {LEVELS.map((lv) => {
                      const active = cur === lv.value;
                      return (
                        <TouchableOpacity
                          key={lv.value}
                          onPress={() => setPerm(mod.key, lv.value)}
                          style={{ flex: 1, paddingVertical: 7, borderRadius: radius.md, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surface, alignItems: 'center' }}
                        >
                          <Text style={{ color: active ? colors.primaryContrast : colors.text, fontSize: 11, fontWeight: '700' }}>{lv.short}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}

            {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surfaceAlt }]} onPress={onClose}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={save} disabled={saving}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{saving ? 'Guardando…' : 'Guardar'}</Text>
            </TouchableOpacity>
          </View>
          {!isSelf ? (
            <TouchableOpacity
              style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.danger }}
              onPress={remove}
              disabled={deleting}
            >
              <Text style={{ color: colors.danger, fontWeight: '700' }}>
                {deleting ? 'Eliminando…' : '🗑️ Eliminar usuario'}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm, textAlign: 'center' }}>
              No puedes eliminar tu propio usuario.
            </Text>
          )}
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
