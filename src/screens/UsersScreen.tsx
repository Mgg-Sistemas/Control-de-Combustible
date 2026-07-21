import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { norm } from '../lib/text';
import { Profile, UserRole, AppRole } from '../types/database';
import { MODULES, LEVELS, PermLevel, defaultLevel, roleLabel } from '../lib/permissions';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { useConfirm } from '../components/ConfirmProvider';

const ROLES: UserRole[] = ['admin', 'supervisor', 'analista', 'operador', 'conductor', 'cocina', 'coordinador_patio'];

export default function UsersScreen() {
  const { role, onlineIds, session } = useAuth();
  const { colors, typography } = useTheme();
  const confirm = useConfirm();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data: users, loading, refetch } = useTable<Profile>('profiles', { orderBy: 'full_name', ascending: true });
  const { data: appRoles, refetch: refetchRoles } = useTable<AppRole>('app_roles', { orderBy: 'name', ascending: true });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [query, setQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [delError, setDelError] = useState<string | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);      // gestor de roles
  const [pickRoleFor, setPickRoleFor] = useState<Profile | null>(null); // asignar rol a un usuario
  const roleName = (id?: string | null) => appRoles.find((r) => r.id === id)?.name ?? null;

  const assignAppRole = async (u: Profile, roleId: string | null) => {
    const { error } = await supabase.from('profiles').update({ app_role_id: roleId }).eq('id', u.id);
    if (error) { Alert.alert('Aviso', `No se pudo asignar el rol: ${error.message}`); return; }
    setPickRoleFor(null);
    refetch();
  };

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
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', id);
    if (error) { Alert.alert('Aviso', `No se pudo cambiar el rol a "${newRole}": ${error.message}`); return; }
    refetch();
  };

  const unlockUser = async (u: Profile) => {
    const { error } = await supabase.from('profiles').update({ locked: false, failed_attempts: 0, locked_at: null }).eq('id', u.id);
    if (error) { Alert.alert('Aviso', `No se pudo desbloquear: ${error.message}`); return; }
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
      // Cuando la función responde con un código de error, supabase-js pone el
      // mensaje genérico en error.message y el detalle real en error.context
      // (la respuesta HTTP). Lo leemos para mostrar el motivo verdadero.
      let motivo = (data as any)?.error ?? error?.message ?? 'No se pudo eliminar.';
      try {
        const body = await (error as any)?.context?.json?.();
        if (body?.error) motivo = body.error;
      } catch { /* si no se puede leer el cuerpo, queda el mensaje genérico */ }
      setDelError(`${u.full_name ?? 'Usuario'}: ${motivo}`);
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

      {/* Gestión de ROLES dinámicos (coordinadores…): crear, buscar, quitar. */}
      <TouchableOpacity onPress={() => setRolesOpen(true)}>
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🏷️ Roles del sistema</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{appRoles.length} rol(es). Crea roles (coordinadores…), elige qué módulos ve cada uno y quítalos.</Text>
            </View>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>Administrar ›</Text>
          </View>
        </Card>
      </TouchableOpacity>

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
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: colors.text }}>
                      {u.full_name ?? 'Sin nombre'}
                      {isSelf ? ' (tú)' : ''}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{u.username ? `👤 ${u.username}` : '⚠️ Sin usuario'}{u.cedula ? ` · C.I. ${u.cedula}` : ''}</Text>
                    {u.locked ? <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '800' }}>🔒 BLOQUEADO por intentos fallidos</Text> : null}
                  </View>
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
                        {roleLabel(r)}
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

              {/* Rol ESPECIAL (dinámico): si se asigna, el usuario ve SOLO los módulos de ese rol. */}
              {u.role !== 'admin' ? (
                <View style={{ marginTop: spacing.xs, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                  <Text style={[typography.muted, { marginBottom: 2 }]}>Rol especial (coordinador) — ve SOLO sus módulos</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={{ color: roleName(u.app_role_id) ? colors.primary : colors.muted, fontWeight: '700', fontSize: 13, flex: 1 }} numberOfLines={1}>
                      {roleName(u.app_role_id) ?? 'Ninguno (usa su rol base y permisos)'}
                    </Text>
                    <TouchableOpacity onPress={() => setPickRoleFor(u)} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>{roleName(u.app_role_id) ? 'Cambiar' : 'Asignar'}</Text>
                    </TouchableOpacity>
                    {u.app_role_id ? (
                      <TouchableOpacity onPress={() => assignAppRole(u, null)} style={{ borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                        <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>Quitar</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                <TouchableOpacity
                  onPress={() => setEditing(u)}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                >
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>✏️ Editar / contraseña</Text>
                </TouchableOpacity>
                {u.locked ? (
                  <TouchableOpacity
                    onPress={() => unlockUser(u)}
                    style={{ borderWidth: 1, borderColor: colors.success, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                  >
                    <Text style={{ color: colors.success, fontWeight: '700', fontSize: 13 }}>🔓 Desbloquear</Text>
                  </TouchableOpacity>
                ) : null}
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
      <RolePickerModal
        user={pickRoleFor}
        roles={appRoles}
        onPick={(roleId) => pickRoleFor && assignAppRole(pickRoleFor, roleId)}
        onClose={() => setPickRoleFor(null)}
      />
      <RolesManagerModal visible={rolesOpen} roles={appRoles} onClose={() => setRolesOpen(false)} onChanged={refetchRoles} />
    </Screen>
  );
}

/** Elige (o quita) el ROL ESPECIAL de un usuario. Lista buscable de roles. */
function RolePickerModal({ user, roles, onPick, onClose }: { user: Profile | null; roles: AppRole[]; onPick: (roleId: string | null) => void; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [q, setQ] = useState('');
  const nq = norm(q.trim());
  const list = !nq ? roles : roles.filter((r) => norm(r.name).includes(nq));
  return (
    <Modal visible={!!user} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { maxHeight: '80%' }]}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: spacing.xs }}>Rol especial de {user?.full_name ?? 'usuario'}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Si asignas un rol, el usuario verá SOLO los módulos de ese rol.</Text>
          <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar rol…" placeholderTextColor={colors.muted} style={styles.input} />
          <ScrollView style={{ marginTop: spacing.sm }}>
            <TouchableOpacity onPress={() => onPick(null)} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs, backgroundColor: colors.surface }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Ninguno (usar rol base y permisos)</Text>
            </TouchableOpacity>
            {list.map((r) => (
              <TouchableOpacity key={r.id} onPress={() => onPick(r.id)} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: user?.app_role_id === r.id ? colors.primary : colors.border, marginBottom: spacing.xs, backgroundColor: user?.app_role_id === r.id ? colors.primary : colors.surface }}>
                <Text style={{ color: user?.app_role_id === r.id ? colors.primaryContrast : colors.text, fontWeight: '800' }}>{r.name}</Text>
                <Text style={{ color: user?.app_role_id === r.id ? colors.primaryContrast : colors.muted, fontSize: 11 }}>{Object.keys(r.modules ?? {}).length} módulo(s)</Text>
              </TouchableOpacity>
            ))}
            {list.length === 0 ? <Text style={{ color: colors.muted, textAlign: 'center', marginVertical: spacing.md }}>Sin roles. Créalos en “🏷️ Roles del sistema”.</Text> : null}
          </ScrollView>
          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.sm, padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/** Crea, lista (buscable) y elimina ROLES dinámicos, cada uno con sus módulos. */
function RolesManagerModal({ visible, roles, onClose, onChanged }: { visible: boolean; roles: AppRole[]; onClose: () => void; onChanged: () => void }) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [mods, setMods] = useState<Record<string, PermLevel>>({});
  const [busy, setBusy] = useState(false);

  const nq = norm(q.trim());
  const list = !nq ? roles : roles.filter((r) => norm(r.name).includes(nq));

  const resetCreate = () => { setCreating(false); setName(''); setMods({}); };

  const crearRol = async () => {
    if (!name.trim()) { Alert.alert('Aviso', 'Escribe el nombre del rol.'); return; }
    const modules = Object.fromEntries(Object.entries(mods).filter(([, lv]) => lv && lv !== 'none'));
    if (Object.keys(modules).length === 0) { Alert.alert('Aviso', 'Elige al menos un módulo para el rol.'); return; }
    setBusy(true);
    const { error } = await supabase.from('app_roles').insert({ name: name.trim(), modules });
    setBusy(false);
    if (error) { Alert.alert('Aviso', /duplicate|unique/i.test(error.message) ? 'Ya existe un rol con ese nombre.' : error.message); return; }
    resetCreate();
    onChanged();
  };

  const borrarRol = async (r: AppRole) => {
    const ok = await confirm({ title: 'Eliminar rol', message: `¿Eliminar el rol "${r.name}"? Los usuarios que lo tengan quedarán sin rol especial.`, confirmText: 'Eliminar', cancelText: 'Cancelar', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('app_roles').delete().eq('id', r.id);
    if (error) { Alert.alert('Aviso', error.message); return; }
    onChanged();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { maxHeight: '92%' }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>🏷️ Roles del sistema</Text>
            <TouchableOpacity onPress={() => (creating ? resetCreate() : setCreating(true))} style={{ backgroundColor: creating ? colors.surfaceAlt : colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: creating ? colors.text : colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>{creating ? 'Cancelar' : '+ Crear rol'}</Text>
            </TouchableOpacity>
          </View>

          {creating ? (
            <ScrollView style={{ maxHeight: '78%' }} contentContainerStyle={{ gap: spacing.xs }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Nombre del rol</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Ej. Coordinador de Operadores" placeholderTextColor={colors.muted} style={styles.input} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Qué módulos ve? (— sin acceso · L · E · F)</Text>
              {MODULES.map((mod) => {
                const cur = mods[mod.key] ?? 'none';
                return (
                  <View key={mod.key} style={{ marginTop: 2 }}>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{mod.label}</Text>
                    <View style={{ flexDirection: 'row', gap: 4, marginTop: 3 }}>
                      {LEVELS.map((lv) => {
                        const active = cur === lv.value;
                        return (
                          <TouchableOpacity key={lv.value} onPress={() => setMods((p) => ({ ...p, [mod.key]: lv.value }))} style={{ flex: 1, paddingVertical: 7, borderRadius: radius.md, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surface, alignItems: 'center' }}>
                            <Text style={{ color: active ? colors.primaryContrast : colors.text, fontSize: 11, fontWeight: '700' }}>{lv.short}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
              <TouchableOpacity onPress={crearRol} disabled={busy} style={{ marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.7 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{busy ? 'Creando…' : 'Crear rol'}</Text>
              </TouchableOpacity>
              <View style={{ height: spacing.lg }} />
            </ScrollView>
          ) : (
            <>
              <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar rol…" placeholderTextColor={colors.muted} style={styles.input} />
              <ScrollView style={{ marginTop: spacing.sm, maxHeight: '74%' }}>
                {list.map((r) => (
                  <View key={r.id} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs, backgroundColor: colors.surface }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{r.name}</Text>
                      <TouchableOpacity onPress={() => borrarRol(r)} style={{ borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                        <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑️ Quitar</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>{Object.keys(r.modules ?? {}).map((k) => MODULES.find((m) => m.key === k)?.label ?? k).join(', ') || 'Sin módulos'}</Text>
                  </View>
                ))}
                {list.length === 0 ? <Text style={{ color: colors.muted, textAlign: 'center', marginVertical: spacing.md }}>Sin roles todavía. Toca “+ Crear rol”.</Text> : null}
              </ScrollView>
            </>
          )}

          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.sm, padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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
  const [cedula, setCedula] = useState('');
  const [username, setUsername] = useState('');
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
    setCedula('');
    setUsername('');
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
    const ci = cedula.trim();
    const un = username.trim();
    if (!un) { setError('El USUARIO es obligatorio (con él inicia sesión).'); return; }
    // No permitir dos usuarios con la misma cédula.
    if (ci) {
      const { data: dup } = await supabase.from('profiles').select('id').eq('cedula', ci).limit(1);
      if (dup && dup.length) { setError('Ya existe un usuario con esa cédula.'); return; }
    }
    // No permitir dos personas con el mismo usuario (sin distinguir mayúsculas).
    const { data: dupU } = await supabase.from('profiles').select('id').ilike('username', un).limit(1);
    if (dupU && dupU.length) { setError('Ya existe ese usuario. Elige otro.'); return; }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: { first_name: firstName, last_name: lastName, password, role, cedula: ci || undefined, username: un },
    });
    if (error || (data as any)?.error) {
      setSaving(false);
      setError((data as any)?.error ?? error?.message ?? 'No se pudo crear el usuario.');
      return;
    }
    // Respaldo: fijamos cédula y usuario por el id devuelto (por si la función no los guardó).
    const newId = (data as any)?.id ?? (data as any)?.user?.id;
    if (newId) { await supabase.from('profiles').update({ cedula: ci || null, username: un }).eq('id', newId); }
    setSaving(false);
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
            <TextInput style={styles.input} placeholder="Cédula (opcional, única)" placeholderTextColor={colors.muted} value={cedula} onChangeText={(t) => setCedula(t.replace(/[^0-9]/g, ''))} keyboardType="numeric" inputMode="numeric" />
            <TextInput style={styles.input} placeholder="Usuario (para entrar · máx 10)" placeholderTextColor={colors.muted} value={username} onChangeText={(t) => setUsername(t.replace(/\s/g, '').slice(0, 10))} maxLength={10} autoCapitalize="none" autoCorrect={false} />
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
                  <Text style={{ color: role === r ? colors.primaryContrast : colors.text, fontSize: 13 }}>{roleLabel(r)}</Text>
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
  const [cedula, setCedula] = useState('');
  const [username, setUsername] = useState('');
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
    setCedula(user?.cedula ?? '');
    setUsername(user?.username ?? '');
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

  // Aplica un nivel a TODOS los módulos de una vez (p. ej. Full control a todo).
  const setAllPerms = async (level: PermLevel) => {
    if (!user) return;
    const next: Record<string, PermLevel> = {};
    MODULES.forEach((m) => { next[m.key] = level; });
    setPerms(next);
    await supabase
      .from('module_permissions')
      .upsert(MODULES.map((m) => ({ user_id: user.id, module: m.key, level })), { onConflict: 'user_id,module' });
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
    if (error || (data as any)?.error) {
      setSaving(false);
      setError((data as any)?.error ?? error?.message ?? 'No se pudo guardar.');
      return;
    }
    // Cédula y USUARIO: se guardan directo en el perfil (índices únicos → no se repiten).
    const ci = cedula.trim() || null;
    const un = username.trim() || null;
    if (!un) { setSaving(false); setError('El USUARIO es obligatorio (con él inicia sesión).'); return; }
    const { error: ciErr } = await supabase.from('profiles').update({ cedula: ci, username: un }).eq('id', user.id);
    setSaving(false);
    if (ciErr) {
      setError(/duplicate|unique/i.test(ciErr.message) ? 'Ya existe otro usuario con esa cédula o ese usuario.' : ciErr.message);
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
            <Text style={typography.muted}>Cédula</Text>
            <TextInput style={styles.input} placeholder="Cédula (opcional, única)" placeholderTextColor={colors.muted} value={cedula} onChangeText={(t) => setCedula(t.replace(/[^0-9]/g, ''))} keyboardType="numeric" inputMode="numeric" />
            <Text style={typography.muted}>Usuario (para iniciar sesión · máx 10)</Text>
            <TextInput style={styles.input} placeholder="Usuario (único)" placeholderTextColor={colors.muted} value={username} onChangeText={(t) => setUsername(t.replace(/\s/g, '').slice(0, 10))} maxLength={10} autoCapitalize="none" autoCorrect={false} />
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
              <>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  — Sin acceso · L Lectura · E Escritura · F Full control
                </Text>
                {/* Atajos: aplicar a TODOS los módulos de una vez. */}
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                  <TouchableOpacity onPress={() => setAllPerms('full')} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }}>
                    <Text style={{ color: colors.primaryContrast, fontSize: 12, fontWeight: '800' }}>✅ Full a todo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setAllPerms('lectura')} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>📖 Lectura a todo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setAllPerms('none')} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface }}>
                    <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>🚫 Quitar todo</Text>
                  </TouchableOpacity>
                </View>
              </>
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
