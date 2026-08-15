import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { supabase } from '../lib/supabase';
import { norm, cmpText } from '../lib/text';
import { Profile, UserRole, AppRole } from '../types/database';
import { MODULES, PermLevel, defaultLevel, maxLevel, roleLabel } from '../lib/permissions';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import {
  CompanyScopeRow,
  MachineScopeRow,
  listCompanyScope,
  listMachineScope,
  addCompanyScope,
  removeCompanyScope,
  addMachineScope,
  removeMachineScope,
} from '../lib/coordinatorScope';
import {
  AveriaEntry,
  JornadaEntry,
  InspByShiftEntry,
  fetchAveriaCat,
  fetchJornadaCat,
  fetchInspByShift,
  makeLiveStatusOf,
} from '../lib/machineLiveStatus';

const ROLES: UserRole[] = ['admin', 'supervisor', 'analista', 'operador', 'conductor', 'cocina', 'coordinador_patio', 'coordinador_inspectores'];

// Escalera de niveles (acumulativa): none < lectura < escritura < full.
const LADDER: PermLevel[] = ['none', 'lectura', 'escritura', 'full'];
const RANK: Record<PermLevel, number> = { none: 0, lectura: 1, escritura: 2, full: 3 };

// Selector de permisos por módulo en forma de CHECKBOXES ACUMULATIVOS:
// ☐ Lectura · ☐ Escritura · ☐ Full control. Marcar un nivel tilda automáticamente
// los inferiores (Full ⇒ Lectura + Escritura; Escritura ⇒ Lectura). Volver a tocar
// el nivel más alto marcado lo baja un escalón; tocar Lectura cuando es lo único
// marcado lo quita del todo (Sin acceso). Sin ninguna casilla marcada = sin acceso.
function PermChecks({ value, onChange, colors }: { value: PermLevel; onChange: (l: PermLevel) => void; colors: AppColors }) {
  const cur = RANK[value] ?? 0;
  const boxes: { lvl: PermLevel; label: string }[] = [
    { lvl: 'lectura', label: 'Lectura' },
    { lvl: 'escritura', label: 'Escritura' },
    { lvl: 'full', label: 'Full control' },
  ];
  const toggle = (lvl: PermLevel) => {
    const r = RANK[lvl];
    // Tocar el nivel que ya es el tope actual ⇒ baja un escalón; si no, salta a ese nivel.
    onChange(cur === r ? LADDER[r - 1] : lvl);
  };
  return (
    <View style={{ flexDirection: 'row', gap: 4, marginTop: 3 }}>
      {boxes.map((b) => {
        const checked = cur >= RANK[b.lvl];
        return (
          <TouchableOpacity
            key={b.lvl}
            onPress={() => toggle(b.lvl)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: checked ? colors.brand : colors.border, backgroundColor: checked ? colors.brand : colors.surface }}
          >
            <Text style={{ color: checked ? colors.brandContrast : colors.muted, fontSize: 13, fontWeight: '800' }}>{checked ? '☑' : '☐'}</Text>
            <Text style={{ color: checked ? colors.brandContrast : colors.text, fontSize: 11.5, fontWeight: '700' }}>{b.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Devuelve un token de sesión VÁLIDO. Si `force` es true (o el token está por
// vencer/ya venció) fuerza un refresh. Evita el 401 "No autenticado" cuando la
// pestaña estuvo inactiva y el token quedó rancio.
async function freshToken(force = false): Promise<string | null> {
  if (!force) {
    const { data } = await supabase.auth.getSession();
    const expMs = data.session?.expires_at ? data.session.expires_at * 1000 : 0;
    if (data.session && expMs - Date.now() > 60_000) return data.session.access_token ?? null;
  }
  const { data: r } = await supabase.auth.refreshSession();
  return r.session?.access_token ?? null;
}

// Extrae el mensaje REAL de un error de Edge Function. supabase.functions.invoke,
// ante un status no-2xx, deja `data` en null y `error.message` genérico
// ("Edge Function returned a non-2xx status code"); el cuerpo real está en
// `error.context` (un Response). Esto lo lee para mostrar la causa exacta.
async function fnErrorMessage(error: any, data: any, fallback = 'No se pudo completar la operación.'): Promise<string> {
  if (data?.error) return String(data.error);
  try {
    const ctx = error?.context;
    if (ctx && typeof ctx.clone === 'function') {
      const body = await ctx.clone().json().catch(() => null);
      if (body?.error) return String(body.error);
      const txt = await ctx.clone().text().catch(() => '');
      if (txt) return txt;
    }
  } catch {}
  return error?.message ?? fallback;
}

// Llama a una Edge Function de administración con el token del admin. Si el token
// fue rechazado (401 / "No autenticado" — token rancio), fuerza un refresh COMPLETO
// y reintenta UNA vez. Devuelve un mensaje claro en vez del críptico "No autenticado".
async function adminInvoke(fn: string, body: any): Promise<{ data: any; errorMsg: string | null }> {
  const call = (token: string | null) =>
    supabase.functions.invoke(fn, { body, headers: token ? { Authorization: `Bearer ${token}` } : undefined });

  let token = await freshToken();
  // Sesión no recuperable → cerrar sesión: el listener de auth pone la sesión en
  // null y la app va DIRECTO al login (sin el callejón "cierra sesión y vuelve a
  // entrar"). No se toca la sesión de huella, así se puede reentrar con huella.
  if (!token) { supabase.auth.signOut(); return { data: null, errorMsg: 'Tu sesión expiró. Inicia sesión de nuevo.' }; }

  let { data, error } = await call(token);
  if (error || (data as any)?.error) {
    const msg = await fnErrorMessage(error, data, '');
    // ¿El token fue rechazado? Fuerza un refresh completo y reintenta una sola vez.
    if (/no autenticado|jwt|token|401|unauthor/i.test(msg)) {
      token = await freshToken(true);
      if (!token) { supabase.auth.signOut(); return { data: null, errorMsg: 'Tu sesión expiró. Inicia sesión de nuevo.' }; }
      ({ data, error } = await call(token));
    }
  }
  if (error || (data as any)?.error) return { data: null, errorMsg: await fnErrorMessage(error, data) };
  return { data, errorMsg: null };
}

export default function UsersScreen() {
  const { role, onlineIds, session } = useAuth();
  const { colors, typography } = useTheme();
  const confirm = useConfirm();
  const toast = useToast();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data: users, loading, refetch } = useTable<Profile>('profiles', { orderBy: 'full_name', ascending: true });
  const { data: appRoles, refetch: refetchRoles } = useTable<AppRole>('app_roles', { orderBy: 'name', ascending: true });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [query, setQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [delError, setDelError] = useState<string | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);      // gestor de roles
  const roleName = (id?: string | null) => appRoles.find((r) => r.id === id)?.name ?? null;
  // Cuántos usuarios tiene vinculado cada rol dinámico (para bloquear su borrado).
  const roleUserCounts = useMemo(() => {
    const m: Record<string, number> = {};
    users.forEach((u) => { if (u.app_role_id) m[u.app_role_id] = (m[u.app_role_id] ?? 0) + 1; });
    return m;
  }, [users]);

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

  const unlockUser = async (u: Profile) => {
    const { error } = await supabase.from('profiles').update({ locked: false, failed_attempts: 0, locked_at: null }).eq('id', u.id);
    if (error) { toast.error(`No se pudo desbloquear: ${error.message}`); return; }
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
    const { errorMsg } = await adminInvoke('admin-manage-user', { action: 'delete', id: u.id });
    setDeletingId(null);
    if (errorMsg) { setDelError(`${u.full_name ?? 'Usuario'}: ${errorMsg}`); return; }
    refetch();
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Usuarios</SectionTitle>
        <TouchableOpacity style={styles.addBtn} onPress={() => setFormOpen(true)}>
          <Text style={{ color: colors.accentContrast, fontWeight: '700' }}>+ Nuevo</Text>
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

              {/* Rol UNIFICADO: se muestra un solo rol (el especial si lo tiene; si no, su rol base).
                  El cambio de rol se hace en "Editar" (lista desplegable con todos los roles). */}
              <View style={{ marginTop: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
                <Text style={typography.muted}>Rol asignado:</Text>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 14 }}>
                  {(roleName(u.app_role_id) ?? roleLabel(u.role)).toUpperCase()}
                </Text>
              </View>

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

      <NewUserForm visible={formOpen} roles={appRoles} onClose={() => setFormOpen(false)} onSaved={refetch} />
      <EditUserForm
        user={editing}
        roles={appRoles}
        isSelf={editing?.id === session?.user?.id}
        onClose={() => setEditing(null)}
        onSaved={refetch}
      />
      <RolesManagerModal visible={rolesOpen} roles={appRoles} userCounts={roleUserCounts} onClose={() => setRolesOpen(false)} onChanged={refetchRoles} />
    </Screen>
  );
}

/** Selección de rol UNIFICADA: un rol base del sistema o un rol personalizado. */
export type RoleSel = { kind: 'base'; role: UserRole } | { kind: 'app'; id: string };

/** Etiqueta legible de una selección de rol (para mostrar el rol asignado). */
function selLabel(sel: RoleSel, roles: AppRole[]): string {
  if (sel.kind === 'base') return roleLabel(sel.role);
  return roles.find((r) => r.id === sel.id)?.name ?? 'Rol';
}

/** Lista desplegable con TODOS los roles: los fijos del sistema + los personalizados
 *  (los que se crean en "🏷️ Roles del sistema"). Devuelve la selección elegida. */
function UnifiedRolePicker({ visible, roles, current, onPick, onClose }: {
  visible: boolean; roles: AppRole[]; current: RoleSel | null; onPick: (sel: RoleSel) => void; onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [q, setQ] = useState('');
  const nq = norm(q.trim());
  const baseList = ROLES.filter((r) => !nq || norm(roleLabel(r)).includes(nq));
  const appList = roles.filter((r) => !nq || norm(r.name).includes(nq));
  const isCur = (sel: RoleSel) => current && current.kind === sel.kind && (sel.kind === 'base' ? (current as any).role === sel.role : (current as any).id === sel.id);
  const rowStyle = (on: boolean) => ({ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, marginBottom: spacing.xs, backgroundColor: on ? colors.brand : colors.surface });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { maxHeight: '82%' }]}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: spacing.xs }}>Elegir rol</Text>
          <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar rol…" placeholderTextColor={colors.muted} style={styles.input} />
          <ScrollView style={{ marginTop: spacing.sm }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>ROLES DEL SISTEMA</Text>
            {baseList.map((r) => {
              const on = !!isCur({ kind: 'base', role: r });
              return (
                <TouchableOpacity key={r} onPress={() => onPick({ kind: 'base', role: r })} style={rowStyle(on)}>
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800' }}>{roleLabel(r)}</Text>
                </TouchableOpacity>
              );
            })}
            {appList.length ? <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm, marginBottom: 4 }}>ROLES PERSONALIZADOS</Text> : null}
            {appList.map((r) => {
              const on = !!isCur({ kind: 'app', id: r.id });
              return (
                <TouchableOpacity key={r.id} onPress={() => onPick({ kind: 'app', id: r.id })} style={rowStyle(on)}>
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800' }}>{r.name}</Text>
                  <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>{r.panel_type === 'coordinador_qr' ? 'Panel coordinador QR' : r.panel_type === 'chofer_combustible' ? 'Panel chofer de combustible' : r.panel_type === 'conductor' ? 'Panel conductor (Surtir · Camiones · Asistencia)' : `${Object.keys(r.modules ?? {}).length} módulo(s)`}</Text>
                </TouchableOpacity>
              );
            })}
            {baseList.length + appList.length === 0 ? <Text style={{ color: colors.muted, textAlign: 'center', marginVertical: spacing.md }}>Sin coincidencias.</Text> : null}
          </ScrollView>
          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.sm, padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/** Catálogo de ROLES dinámicos: crea, edita, elimina (bloqueado si tiene usuarios),
 *  y define el TIPO DE PANEL de cada rol (módulos o coordinador con escáner QR). */
function RolesManagerModal({ visible, roles, userCounts, onClose, onChanged }: { visible: boolean; roles: AppRole[]; userCounts: Record<string, number>; onClose: () => void; onChanged: () => void }) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const toast = useToast();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);       // formulario abierto (crear o editar)
  const [editId, setEditId] = useState<string | null>(null); // null = crear
  const [name, setName] = useState('');
  const [panelType, setPanelType] = useState<'modulos' | 'coordinador_qr' | 'chofer_combustible' | 'conductor'>('modulos');
  const [mods, setMods] = useState<Record<string, PermLevel>>({});
  const [busy, setBusy] = useState(false);

  const nq = norm(q.trim());
  const list = !nq ? roles : roles.filter((r) => norm(r.name).includes(nq));

  const resetForm = () => { setEditing(false); setEditId(null); setName(''); setPanelType('modulos'); setMods({}); };
  const openCreate = () => { resetForm(); setEditing(true); };
  const openEdit = (r: AppRole) => {
    setEditId(r.id); setName(r.name);
    setPanelType(r.panel_type === 'coordinador_qr' || r.panel_type === 'chofer_combustible' || r.panel_type === 'conductor' ? r.panel_type : 'modulos');
    setMods((r.modules ?? {}) as Record<string, PermLevel>);
    setEditing(true);
  };

  const guardar = async () => {
    if (!name.trim()) { toast.error('Escribe el nombre del rol.'); return; }
    const modules = panelType === 'coordinador_qr' || panelType === 'chofer_combustible'
      ? {} // estos paneles especiales solo escanean QR / surten: no usan módulos
      : Object.fromEntries(Object.entries(mods).filter(([, lv]) => lv && lv !== 'none'));
    if (panelType === 'modulos' && Object.keys(modules).length === 0) { toast.error('Elige al menos un módulo para el rol.'); return; }
    setBusy(true);
    const payload = { name: name.trim(), modules, panel_type: panelType };
    const { error } = editId
      ? await supabase.from('app_roles').update(payload).eq('id', editId)
      : await supabase.from('app_roles').insert(payload);
    setBusy(false);
    if (error) { toast.error(/duplicate|unique/i.test(error.message) ? 'Ya existe un rol con ese nombre.' : error.message); return; }
    resetForm();
    onChanged();
  };

  const borrarRol = async (r: AppRole) => {
    const linked = userCounts[r.id] ?? 0;
    if (linked > 0) { toast.error(`No se puede eliminar: el rol "${r.name}" tiene ${linked} usuario(s) vinculado(s). Quítaselo a esos usuarios antes de eliminar el rol.`); return; }
    const ok = await confirm({ title: 'Eliminar rol', message: `¿Eliminar el rol "${r.name}"?`, confirmText: 'Eliminar', cancelText: 'Cancelar', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('app_roles').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    onChanged();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { maxHeight: '92%' }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>🏷️ Roles del sistema</Text>
            <TouchableOpacity onPress={() => (editing ? resetForm() : openCreate())} style={{ backgroundColor: editing ? colors.surfaceAlt : colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: editing ? colors.text : colors.brandContrast, fontWeight: '800', fontSize: 13 }}>{editing ? 'Cancelar' : '+ Crear rol'}</Text>
            </TouchableOpacity>
          </View>

          {editing ? (
            <ScrollView style={{ maxHeight: '78%' }} contentContainerStyle={{ gap: spacing.xs }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Nombre del rol</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Ej. Coordinador de Preventivo" placeholderTextColor={colors.muted} style={styles.input} />

              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Tipo de panel</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 3, flexWrap: 'wrap' }}>
                {([['modulos', '📋 Módulos'], ['coordinador_qr', '📷 Coordinador QR'], ['chofer_combustible', '⛽ Chofer combustible'], ['conductor', '🚚 Conductor']] as const).map(([v, l]) => {
                  const on = panelType === v;
                  return (
                    <TouchableOpacity key={v} onPress={() => setPanelType(v)} style={{ flexGrow: 1, minWidth: '46%', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, alignItems: 'center' }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{l}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {panelType === 'coordinador_qr' || panelType === 'chofer_combustible' ? (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>{panelType === 'coordinador_qr'
                  ? 'Este rol verá un panel para escanear el QR de la máquina y: ⛽ surtir gasoil, 🛠️ registrar avería y ✅ marcar la máquina lista. No usa módulos.'
                  : 'Este rol verá el panel de CHOFER DE COMBUSTIBLE (teléfono): escanear o elegir la máquina y surtir combustible (litros + monto por litro + fotos). No usa módulos.'}</Text>
              ) : (
                <>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
                    {panelType === 'conductor'
                      ? 'Este rol verá el panel de CONDUCTOR (teléfono): 3 pestañas — ⛽ Surtir, 🚪 Camiones y 📋 Asistencia. Los módulos de abajo son opcionales (solo si además necesita reportes/permisos de otras pantallas).'
                      : 'Rol fijo: navega por la app normal (pestañas + Más) mostrando SOLO los módulos que marques aquí.'}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Qué módulos ve? Marca lo que puede hacer; Full control tilda solo Lectura y Escritura. Sin nada marcado = sin acceso.</Text>
                  {MODULES.map((mod) => {
                    const cur = mods[mod.key] ?? 'none';
                    return (
                      <View key={mod.key} style={{ marginTop: 6 }}>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{mod.label}</Text>
                        <PermChecks value={cur} onChange={(l) => setMods((p) => ({ ...p, [mod.key]: l }))} colors={colors} />
                      </View>
                    );
                  })}
                </>
              )}
              <TouchableOpacity onPress={guardar} disabled={busy} style={{ marginTop: spacing.md, backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.7 : 1 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : editId ? 'Guardar cambios' : 'Crear rol'}</Text>
              </TouchableOpacity>
              <View style={{ height: spacing.lg }} />
            </ScrollView>
          ) : (
            <>
              <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar rol…" placeholderTextColor={colors.muted} style={styles.input} />
              <ScrollView style={{ marginTop: spacing.sm, maxHeight: '74%' }}>
                {list.map((r) => {
                  const linked = userCounts[r.id] ?? 0;
                  const isQr = r.panel_type === 'coordinador_qr';
                  const isChofer = r.panel_type === 'chofer_combustible';
                  const isConductor = r.panel_type === 'conductor';
                  return (
                    <View key={r.id} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs, backgroundColor: colors.surface }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                        <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{r.name}</Text>
                        <TouchableOpacity onPress={() => openEdit(r)} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>✏️ Editar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => borrarRol(r)} style={{ borderWidth: 1, borderColor: linked > 0 ? colors.border : colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4, opacity: linked > 0 ? 0.5 : 1 }}>
                          <Text style={{ color: linked > 0 ? colors.muted : colors.danger, fontWeight: '700', fontSize: 12 }}>🗑️ Quitar</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                        {isQr ? '📷 Panel coordinador QR (gasoil · avería · lista)' : isChofer ? '⛽ Panel chofer de combustible (surtir)' : isConductor ? `🚚 Panel conductor (Surtir · Camiones · Asistencia)${Object.keys(r.modules ?? {}).length ? ` · +${Object.keys(r.modules ?? {}).length} módulo(s)` : ''}` : (Object.keys(r.modules ?? {}).map((k) => MODULES.find((m) => m.key === k)?.label ?? k).join(', ') || 'Sin módulos')}
                        {linked > 0 ? `  ·  👤 ${linked} usuario(s)` : ''}
                      </Text>
                    </View>
                  );
                })}
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
  roles,
  onClose,
  onSaved,
}: {
  visible: boolean;
  roles: AppRole[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [cedula, setCedula] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [sel, setSel] = useState<RoleSel>({ kind: 'base', role: 'conductor' });
  const [pickerOpen, setPickerOpen] = useState(false);
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
    setSel({ kind: 'base', role: 'conductor' });
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
    // Rol UNIFICADO: si es un rol personalizado, el usuario se crea con un rol base
    // neutro (conductor) y luego se le vincula el rol personalizado (app_role_id).
    const baseRole: UserRole = sel.kind === 'base' ? sel.role : 'conductor';
    const appRoleId = sel.kind === 'app' ? sel.id : null;
    const { data, errorMsg } = await adminInvoke('admin-create-user', {
      first_name: firstName, last_name: lastName, password, role: baseRole, cedula: ci || undefined, username: un,
    });
    if (errorMsg) {
      setError(errorMsg);
      setSaving(false);
      return;
    }
    // Respaldo: fijamos cédula/usuario y el rol personalizado por el id devuelto.
    const newId = (data as any)?.id ?? (data as any)?.user?.id;
    if (newId) { await supabase.from('profiles').update({ cedula: ci || null, username: un, app_role_id: appRoleId }).eq('id', newId); }
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
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Contraseña (mín. 6)" placeholderTextColor={colors.muted} value={password} onChangeText={setPassword} secureTextEntry={!showPass} autoCapitalize="none" autoCorrect={false} spellCheck={false} />
              <TouchableOpacity onPress={() => setShowPass((v) => !v)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{showPass ? '🙈 Ocultar' : '👁 Ver'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={typography.muted}>Rol asignado</Text>
            <TouchableOpacity onPress={() => setPickerOpen(true)} style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>{selLabel(sel, roles)}</Text>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Cambiar ▾</Text>
            </TouchableOpacity>
            {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          </ScrollView>
          <UnifiedRolePicker
            visible={pickerOpen}
            roles={roles}
            current={sel}
            onPick={(s) => { setSel(s); setPickerOpen(false); }}
            onClose={() => setPickerOpen(false)}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surfaceAlt }]} onPress={onClose}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.brand }]} onPress={submit} disabled={saving}>
              <Text style={{ color: colors.brandContrast, fontWeight: '700' }}>
                {saving ? 'Creando…' : 'Crear usuario'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Ficha completa de una máquina en el selector "Agregar máquina suelta" del
// alcance del coordinador — el admin necesita ver encargado/marca/modelo/etc.
// para reconocer la máquina, no solo el código (pedido del cliente 12-ago-2026).
type MachinePickRow = {
  id: string; code: string; plate: string | null; serial: string | null;
  clasificacion: string | null; marca: string | null; modelo: string | null;
  encargado: string | null; sector: string | null; companyId: string | null; companyName: string;
  operational: boolean; enEspera: boolean;
};

// Mismos 4 estados EXCLUYENTES que las tarjetas y el reporte de Catálogo
// (EquiposScreen: retirada > esperando > averiada/parada en vivo > operativa),
// para poder filtrar el selector de "máquina suelta" por estado (pedido cliente
// 12-ago-2026: "que pueda filtrar las que estan averiadas, o en espera...").
type EstadoConteo = 'operativa' | 'averiada' | 'parada' | 'retirada' | 'espera';
const ESTADO_CONTEO_ORDER: EstadoConteo[] = ['operativa', 'averiada', 'parada', 'retirada', 'espera'];

function EditUserForm({
  user,
  roles,
  isSelf,
  onClose,
  onSaved,
}: {
  user: Profile | null;
  roles: AppRole[];
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
  // Rol UNIFICADO del usuario en edición (rol personalizado si lo tiene; si no, su rol base).
  const [sel, setSel] = useState<RoleSel>({ kind: 'base', role: 'conductor' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const { colors, typography } = useTheme();
  const confirm = useConfirm();
  const toast = useToast();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Alcance de máquinas del Coordinador de Operadores (ver src/lib/coordinatorScope.ts):
  // qué empresas completas / máquinas sueltas puede ver y asignar ESTE usuario.
  const [companyScope, setCompanyScope] = useState<CompanyScopeRow[]>([]);
  const [machineScope, setMachineScope] = useState<MachineScopeRow[]>([]);
  const [scopeMissing, setScopeMissing] = useState(false);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [companyPickOpen, setCompanyPickOpen] = useState(false);
  const [companyPickLoading, setCompanyPickLoading] = useState(false);
  const [companyPickQuery, setCompanyPickQuery] = useState('');
  const [companyPickList, setCompanyPickList] = useState<{ id: string; name: string }[]>([]);
  const [machinePickOpen, setMachinePickOpen] = useState(false);
  const [machinePickLoading, setMachinePickLoading] = useState(false);
  const [machinePickQuery, setMachinePickQuery] = useState('');
  const [machinePickList, setMachinePickList] = useState<MachinePickRow[]>([]);
  // Datos crudos de estatus EN VIVO (avería/jornada/inspector), mismas queries que
  // Catálogo (`src/lib/machineLiveStatus.ts`), para poder clasificar cada máquina del
  // selector como operativa/averiada/parada/retirada/esperando — igual que el reporte.
  const [machineAveriaCat, setMachineAveriaCat] = useState<Record<string, AveriaEntry>>({});
  const [machineJornadaCat, setMachineJornadaCat] = useState<Record<string, JornadaEntry>>({});
  const [machineInspByShift, setMachineInspByShift] = useState<Record<string, InspByShiftEntry>>({});
  const [machineNowTick, setMachineNowTick] = useState(0);
  // Filtros del selector "Agregar máquina suelta" — por empresa, categoría y estado,
  // multi-selección (igual patrón que el reporte de Catálogo: chips togglables con
  // Set, vacío = todas/todos). Pedido del cliente 12-ago-2026.
  const [machineCompanySel, setMachineCompanySel] = useState<Set<string>>(new Set());
  const [machineClaseSel, setMachineClaseSel] = useState<Set<string>>(new Set());
  const [machineEstadoSel, setMachineEstadoSel] = useState<Set<EstadoConteo>>(new Set());
  const SIN_EMPRESA_PICK = '__none__';
  const SIN_CLASE_PICK = 'Sin categoría';
  const toggleMachineCompany = (id: string) => setMachineCompanySel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleMachineClase = (c: string) => setMachineClaseSel((prev) => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const toggleMachineEstado = (e: EstadoConteo) => setMachineEstadoSel((prev) => { const n = new Set(prev); n.has(e) ? n.delete(e) : n.add(e); return n; });
  const ESTADO_CONTEO_META: Record<EstadoConteo, { label: string; icon: string; color: string }> = {
    operativa: { label: 'Operativa', icon: '✅', color: colors.success },
    averiada: { label: 'Averiada', icon: '🔴', color: colors.danger },
    parada: { label: 'Parada', icon: '🟡', color: colors.warning },
    retirada: { label: 'Retirada', icon: '⬛', color: colors.muted },
    espera: { label: 'Esperando instrucciones', icon: '⏳', color: colors.warning },
  };
  // Mismo estado EN VIVO (con reactivación por jornada nueva) que usan las tarjetas y
  // el reporte de Catálogo — evita que esta lista diga "Operativa" cuando la ficha real
  // ya muestra "Averiada" (o viceversa).
  const machineLiveStatusOf = useMemo(
    () => makeLiveStatusOf({ jornadaCat: machineJornadaCat, averiaCat: machineAveriaCat, inspByShift: machineInspByShift, retiredIds: new Set(), nowTick: machineNowTick }),
    [machineJornadaCat, machineAveriaCat, machineInspByShift, machineNowTick]
  );
  const machineEstadoOf = (m: MachinePickRow): EstadoConteo => {
    if (!m.operational) return 'retirada';
    if (m.enEspera) return 'espera';
    const live = machineLiveStatusOf(m.id).estado;
    if (live === 'averiada') return 'averiada';
    if (live === 'parada') return 'parada';
    return 'operativa';
  };

  // Módulos editados HACE POCO por este admin (clave → timestamp). Protege la edición
  // reciente de que un refetch en vivo (que puede leer ANTES de que el upsert sea
  // visible por lag de replicación) la pise y devuelva los módulos a "sin acceso".
  const editedAt = useRef<Record<string, number>>({});
  const EDIT_PROTECT_MS = 10000;

  // Carga (o recarga) SOLO los permisos por módulo del usuario en edición, sin
  // tocar el resto del formulario (nombre, usuario, contraseña…) que el admin
  // puede estar editando — así el refresco en vivo no le borra lo que escribió.
  const loadPerms = async (userId: string) => {
    const { data } = await supabase.from('module_permissions').select('module, level').eq('user_id', userId);
    const m: Record<string, PermLevel> = {};
    (data ?? []).forEach((r: any) => (m[r.module] = r.level));
    // No pisar lo recién tocado: conserva el valor local de las claves editadas dentro
    // de la ventana de protección (el upsert quizá aún no se refleja en esta lectura).
    setPerms((prev) => {
      const now = Date.now();
      const merged = { ...m };
      Object.entries(editedAt.current).forEach(([key, ts]) => {
        if (now - ts < EDIT_PROTECT_MS && prev[key] !== undefined) merged[key] = prev[key];
      });
      return merged;
    });
  };

  // Carga (o recarga) el alcance de máquinas del Coordinador de Operadores.
  const loadScope = async (userId: string) => {
    setScopeLoading(true);
    const [companies, machines] = await Promise.all([listCompanyScope(userId), listMachineScope(userId)]);
    setCompanyScope(companies.rows);
    setMachineScope(machines.rows);
    setScopeMissing(companies.missing || machines.missing);
    setScopeLoading(false);
  };

  useEffect(() => {
    setFullName(user?.full_name ?? '');
    setCedula(user?.cedula ?? '');
    setUsername(user?.username ?? '');
    setPassword('');
    setShowPass(false);
    setError(null);
    setPerms({});
    editedAt.current = {}; // otro usuario: no arrastrar la protección de edición del anterior
    setSel(user?.app_role_id ? { kind: 'app', id: user.app_role_id } : { kind: 'base', role: (user?.role ?? 'conductor') });
    setCompanyScope([]);
    setMachineScope([]);
    setScopeMissing(false);
    if (user) { loadPerms(user.id); loadScope(user.id); }
  }, [user]);
  useRealtimeRefresh(['module_permissions'], () => { if (user) loadPerms(user.id); });

  const addCompanyToScope = async (companyId: string) => {
    if (!user) return;
    const { error: e, missing } = await addCompanyScope(user.id, companyId);
    if (missing) { setScopeMissing(true); return; }
    if (e) { toast.error(e); return; }
    loadScope(user.id);
  };
  const removeCompanyFromScope = async (companyId: string) => {
    if (!user) return;
    const { error: e } = await removeCompanyScope(user.id, companyId);
    if (e) { toast.error(e); return; }
    loadScope(user.id);
  };
  const addMachineToScope = async (machineryId: string) => {
    if (!user) return;
    const { error: e, missing } = await addMachineScope(user.id, machineryId);
    if (missing) { setScopeMissing(true); return; }
    if (e) { toast.error(e); return; }
    loadScope(user.id);
  };
  const removeMachineFromScope = async (machineryId: string) => {
    if (!user) return;
    const { error: e } = await removeMachineScope(user.id, machineryId);
    if (e) { toast.error(e); return; }
    loadScope(user.id);
  };

  const openCompanyPicker = async () => {
    setCompanyPickOpen(true);
    setCompanyPickQuery('');
    setCompanyPickLoading(true);
    const { data, error: e } = await supabase.from('companies').select('id, name').order('name');
    setCompanyPickLoading(false);
    if (e) { toast.error(e.message); return; }
    setCompanyPickList((data ?? []) as { id: string; name: string }[]);
  };
  const openMachinePicker = async () => {
    setMachinePickOpen(true);
    setMachinePickQuery('');
    setMachineCompanySel(new Set());
    setMachineClaseSel(new Set());
    setMachineEstadoSel(new Set());
    setMachinePickLoading(true);
    setMachineNowTick(Date.now());
    const [{ data, error: e }, averiaCat, jornadaCat, inspByShift] = await Promise.all([
      supabase
        .from('machinery')
        .select('id, code, plate, serial, clasificacion, marca, modelo, encargado, sector, company_id, operational, en_espera, company:company_id(name)')
        .eq('active', true).order('code'),
      fetchAveriaCat(),
      fetchJornadaCat(),
      fetchInspByShift(),
    ]);
    setMachinePickLoading(false);
    if (e) { toast.error(e.message); return; }
    setMachineAveriaCat(averiaCat);
    setMachineJornadaCat(jornadaCat);
    setMachineInspByShift(inspByShift);
    setMachinePickList(((data ?? []) as any[]).map((m) => ({
      id: m.id, code: m.code, plate: m.plate ?? null, serial: m.serial ?? null,
      clasificacion: m.clasificacion ?? null, marca: m.marca ?? null, modelo: m.modelo ?? null,
      encargado: m.encargado ?? null, sector: m.sector ?? null,
      companyId: m.company_id ?? null, companyName: m.company?.name ?? 'Sin empresa',
      operational: m.operational !== false, enEspera: !!m.en_espera,
    })));
  };
  // Opciones de EMPRESA y CATEGORÍA (con conteo) para los chips del selector —
  // solo entre las máquinas realmente cargadas en el picker.
  const machineCompanyOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    machinePickList.forEach((m) => {
      const id = m.companyId ?? SIN_EMPRESA_PICK;
      const e = map.get(id) ?? { id, name: m.companyName, count: 0 };
      e.count += 1; map.set(id, e);
    });
    return Array.from(map.values()).sort((a, b) => a.id === SIN_EMPRESA_PICK ? 1 : b.id === SIN_EMPRESA_PICK ? -1 : cmpText(a.name, b.name));
  }, [machinePickList]);
  const machineClaseOptions = useMemo(() => {
    const map = new Map<string, number>();
    machinePickList.forEach((m) => { const k = (m.clasificacion || '').trim() || SIN_CLASE_PICK; map.set(k, (map.get(k) ?? 0) + 1); });
    return Array.from(map.entries()).map(([key, count]) => ({ key, count }))
      .sort((a, b) => a.key === SIN_CLASE_PICK ? 1 : b.key === SIN_CLASE_PICK ? -1 : cmpText(a.key, b.key));
  }, [machinePickList]);
  const machineEstadoOptions = useMemo(() => {
    const counts: Record<EstadoConteo, number> = { operativa: 0, averiada: 0, parada: 0, retirada: 0, espera: 0 };
    machinePickList.forEach((m) => { counts[machineEstadoOf(m)] += 1; });
    return ESTADO_CONTEO_ORDER.map((key) => ({ key, count: counts[key] })).filter((o) => o.count > 0);
  }, [machinePickList, machineLiveStatusOf]);

  const nqCompanyPick = norm(companyPickQuery.trim());
  const companyPickFiltered = companyPickList.filter(
    (c) => !companyScope.some((s) => s.companyId === c.id) && (!nqCompanyPick || norm(c.name).includes(nqCompanyPick))
  );
  // Busca por código, categoría, marca/modelo, placa/serial, encargado, sector o
  // empresa — igual criterio "buscar por cualquier cosa" que ya usa Mantenimiento
  // de Maquinaria (el admin necesita poder ubicar la máquina por CUALQUIERA de
  // estos datos, no solo por código).
  const nqMachinePick = norm(machinePickQuery.trim());
  const machinePickFiltered = machinePickList.filter(
    (m) => !machineScope.some((s) => s.machineryId === m.id)
      && (machineCompanySel.size === 0 || machineCompanySel.has(m.companyId ?? SIN_EMPRESA_PICK))
      && (machineClaseSel.size === 0 || machineClaseSel.has((m.clasificacion || '').trim() || SIN_CLASE_PICK))
      && (machineEstadoSel.size === 0 || machineEstadoSel.has(machineEstadoOf(m)))
      && (!nqMachinePick ||
        [m.code, m.clasificacion, m.marca, m.modelo, m.plate, m.serial, m.encargado, m.sector, m.companyName]
          .some((f) => f != null && norm(String(f)).includes(nqMachinePick)))
  );

  const setPerm = async (moduleKey: string, level: PermLevel) => {
    if (!user) return;
    editedAt.current[moduleKey] = Date.now();
    setPerms((p) => ({ ...p, [moduleKey]: level }));
    await supabase
      .from('module_permissions')
      .upsert({ user_id: user.id, module: moduleKey, level }, { onConflict: 'user_id,module' });
  };

  // Cambia el rol del usuario (unificado): un rol base del sistema o uno personalizado.
  // Base → fija profiles.role y quita el rol personalizado. Personalizado → vincula
  // app_role_id (y si era admin, baja su rol base a conductor para que vea SOLO su rol).
  const applyRole = async (s: RoleSel) => {
    if (!user || isSelf) return;
    setSel(s);
    setPickerOpen(false);
    setSavingRole(true);
    const patch: Record<string, any> = s.kind === 'base'
      ? { role: s.role, app_role_id: null }
      : { app_role_id: s.id, ...(user.role === 'admin' ? { role: 'conductor' } : {}) };
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
    setSavingRole(false);
    if (error) { setError(`No se pudo cambiar el rol: ${error.message}`); return; }
    onSaved();
  };

  // Aplica un nivel a TODOS los módulos de una vez (p. ej. Full control a todo).
  const setAllPerms = async (level: PermLevel) => {
    if (!user) return;
    const next: Record<string, PermLevel> = {};
    const now = Date.now();
    MODULES.forEach((m) => { next[m.key] = level; editedAt.current[m.key] = now; });
    setPerms(next);
    await supabase
      .from('module_permissions')
      .upsert(MODULES.map((m) => ({ user_id: user.id, module: m.key, level })), { onConflict: 'user_id,module' });
  };

  if (!user) return null;
  const isAdminUser = user.role === 'admin';

  // ¿Tiene activo el módulo "coordinacion_operadores" este usuario? Mismo criterio
  // que resuelve el nivel efectivo de un módulo en AuthContext.moduleLevel: rol
  // personalizado (modules del app_role) combinado con el permiso EXPLÍCITO por
  // módulo (el mayor de los dos); rol base → el explícito o el default (none).
  const coordModuleActive = !isAdminUser && (() => {
    const explicit = perms['coordinacion_operadores'];
    if (sel.kind === 'app') {
      const appRole = roles.find((r) => r.id === sel.id);
      const roleLvl = (appRole?.modules?.['coordinacion_operadores'] as PermLevel) ?? 'none';
      return (explicit ? maxLevel(roleLvl, explicit) : roleLvl) !== 'none';
    }
    return (explicit ?? defaultLevel('coordinacion_operadores')) !== 'none';
  })();

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
    const { errorMsg } = await adminInvoke('admin-manage-user', {
      action: 'update', id: user.id, full_name: fullName, password: password || undefined,
    });
    if (errorMsg) {
      setError(errorMsg);
      setSaving(false);
      return;
    }
    // Cédula y USUARIO: se guardan directo en el perfil (índices únicos → no se repiten).
    const ci = cedula.trim() || null;
    const un = username.trim() || null;
    if (!un) { setSaving(false); setError('El USUARIO es obligatorio (con él inicia sesión).'); return; }
    // No permitir que el USUARIO choque con OTRA persona (case-insensitive, excluye al
    // propio). Aviso amigable ANTES del índice único de la BD (que también lo bloquea).
    const { data: dupU } = await supabase.from('profiles').select('id').ilike('username', un).neq('id', user.id).limit(1);
    if (dupU && dupU.length) { setSaving(false); setError('Ya existe otro usuario con ese "Usuario". Elige otro.'); return; }
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
    const { errorMsg } = await adminInvoke('admin-manage-user', { action: 'delete', id: user.id });
    setDeleting(false);
    if (errorMsg) {
      setError(errorMsg);
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
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Dejar vacío para no cambiar" placeholderTextColor={colors.muted} value={password} onChangeText={setPassword} secureTextEntry={!showPass} autoCapitalize="none" autoCorrect={false} spellCheck={false} />
              <TouchableOpacity onPress={() => setShowPass((v) => !v)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{showPass ? '🙈' : '👁'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={[typography.muted, { marginTop: spacing.sm }]}>Rol asignado</Text>
            {isSelf ? (
              <View style={styles.input}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>{selLabel(sel, roles)}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>No puedes cambiar tu propio rol.</Text>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setPickerOpen(true)} disabled={savingRole} style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>{savingRole ? 'Guardando…' : selLabel(sel, roles)}</Text>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Cambiar ▾</Text>
              </TouchableOpacity>
            )}

            <Text style={[typography.muted, { marginTop: spacing.sm }]}>Permisos por módulo</Text>
            {isAdminUser ? (
              <Text style={{ color: colors.success, fontSize: 12 }}>
                Este usuario es administrador: tiene acceso total a todos los módulos.
              </Text>
            ) : (
              <>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  Marca lo que puede hacer en cada módulo. Full control tilda solo Lectura y Escritura; sin nada marcado = sin acceso.
                </Text>
                {/* Atajos: aplicar a TODOS los módulos de una vez. */}
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                  <TouchableOpacity onPress={() => setAllPerms('full')} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand }}>
                    <Text style={{ color: colors.brandContrast, fontSize: 12, fontWeight: '800' }}>✅ Full a todo</Text>
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
                <View key={mod.key} style={{ marginTop: 6 }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{mod.label}</Text>
                  <PermChecks value={cur} onChange={(l) => setPerm(mod.key, l)} colors={colors} />
                </View>
              );
            })}

            {coordModuleActive ? (
              <Card style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🚜 Máquinas que puede coordinar</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  Restringe qué máquinas ve y puede asignar este coordinador. Sin nada configurado abajo, ve TODAS las máquinas de todas las empresas.
                </Text>
                {scopeMissing ? (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    ⏳ Esta función todavía no está activa (falta aplicar una actualización pendiente en la base de datos).
                  </Text>
                ) : scopeLoading ? (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando alcance…</Text>
                ) : (
                  <>
                    {companyScope.length === 0 && machineScope.length === 0 ? (
                      <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>
                        🌐 Sin restricción: ve TODAS las máquinas
                      </Text>
                    ) : (
                      <>
                        {companyScope.length > 0 ? (
                          <View>
                            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>EMPRESAS COMPLETAS</Text>
                            {companyScope.map((c) => (
                              <View key={c.companyId} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
                                <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>🏢 {c.companyName}</Text>
                                <TouchableOpacity onPress={() => removeCompanyFromScope(c.companyId)}>
                                  <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕ Quitar</Text>
                                </TouchableOpacity>
                              </View>
                            ))}
                          </View>
                        ) : null}
                        {machineScope.length > 0 ? (
                          <View>
                            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>MÁQUINAS SUELTAS</Text>
                            {machineScope.map((m) => (
                              <View key={m.machineryId} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
                                <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>
                                  🚜 {m.code}{(m.plate || m.serial) ? ` · ${m.plate || m.serial}` : ''}
                                </Text>
                                <TouchableOpacity onPress={() => removeMachineFromScope(m.machineryId)}>
                                  <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕ Quitar</Text>
                                </TouchableOpacity>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </>
                    )}
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <TouchableOpacity onPress={openCompanyPicker} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>➕ Agregar empresa completa</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={openMachinePicker} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>➕ Agregar máquina suelta</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </Card>
            ) : null}

            {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surfaceAlt }]} onPress={onClose}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.brand }]} onPress={save} disabled={saving}>
              <Text style={{ color: colors.brandContrast, fontWeight: '700' }}>{saving ? 'Guardando…' : 'Guardar'}</Text>
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
          <UnifiedRolePicker
            visible={pickerOpen}
            roles={roles}
            current={sel}
            onPick={applyRole}
            onClose={() => setPickerOpen(false)}
          />

          {/* Selector: agregar una EMPRESA COMPLETA al alcance del coordinador. */}
          <Modal visible={companyPickOpen} animationType="slide" transparent onRequestClose={() => setCompanyPickOpen(false)}>
            <View style={styles.backdrop}>
              <View style={[styles.sheet, { maxHeight: '82%' }]}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: spacing.xs }}>➕ Agregar empresa completa</Text>
                <TextInput value={companyPickQuery} onChangeText={setCompanyPickQuery} placeholder="🔎 Buscar empresa…" placeholderTextColor={colors.muted} style={styles.input} />
                {companyPickLoading ? (
                  <Loading />
                ) : (
                  <ScrollView style={{ marginTop: spacing.sm }}>
                    {companyPickFiltered.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        onPress={() => addCompanyToScope(c.id)}
                        style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs, backgroundColor: colors.surface }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700' }}>🏢 {c.name}</Text>
                      </TouchableOpacity>
                    ))}
                    {companyPickFiltered.length === 0 ? <Text style={{ color: colors.muted, textAlign: 'center', marginVertical: spacing.md }}>Sin coincidencias.</Text> : null}
                  </ScrollView>
                )}
                <TouchableOpacity onPress={() => setCompanyPickOpen(false)} style={{ marginTop: spacing.sm, padding: spacing.md, alignItems: 'center' }}>
                  <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* Selector: agregar una MÁQUINA SUELTA al alcance del coordinador. */}
          <Modal visible={machinePickOpen} animationType="slide" transparent onRequestClose={() => setMachinePickOpen(false)}>
            <View style={styles.backdrop}>
              <View style={[styles.sheet, { maxHeight: '82%' }]}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: spacing.xs }}>➕ Agregar máquina suelta</Text>
                <TextInput value={machinePickQuery} onChangeText={setMachinePickQuery} placeholder="🔎 Buscar por código, marca, modelo, categoría, placa, serial, encargado o sector…" placeholderTextColor={colors.muted} style={styles.input} />
                {/* Filtros por empresa y categoría — multi-selección con chips, igual
                    patrón que el reporte de Catálogo (Set + toggle, vacío = todas). */}
                {!machinePickLoading && machineCompanyOptions.length > 1 ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>
                      EMPRESA{machineCompanySel.size > 0 ? ` (${machineCompanySel.size})` : ' (todas)'}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                      {machineCompanyOptions.map((o) => {
                        const on = machineCompanySel.has(o.id);
                        return (
                          <TouchableOpacity
                            key={o.id}
                            onPress={() => toggleMachineCompany(o.id)}
                            style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                          >
                            <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>🏢 {o.name}</Text>
                            <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>({o.count})</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
                {!machinePickLoading && machineClaseOptions.length > 1 ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>
                      CATEGORÍA{machineClaseSel.size > 0 ? ` (${machineClaseSel.size})` : ' (todas)'}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                      {machineClaseOptions.map((o) => {
                        const on = machineClaseSel.has(o.key);
                        return (
                          <TouchableOpacity
                            key={o.key}
                            onPress={() => toggleMachineClase(o.key)}
                            style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                          >
                            <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{o.key}</Text>
                            <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>({o.count})</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
                {!machinePickLoading && machineEstadoOptions.length > 1 ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>
                      ESTADO{machineEstadoSel.size > 0 ? ` (${machineEstadoSel.size})` : ' (todos)'}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                      {(() => {
                        const allOn = machineEstadoSel.size === 0;
                        return (
                          <TouchableOpacity
                            onPress={() => setMachineEstadoSel(new Set())}
                            style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: allOn ? colors.brand : colors.border, backgroundColor: allOn ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5 }}
                          >
                            <Text style={{ color: allOn ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>Todas</Text>
                          </TouchableOpacity>
                        );
                      })()}
                      {machineEstadoOptions.map((o) => {
                        const meta = ESTADO_CONTEO_META[o.key];
                        const on = machineEstadoSel.has(o.key);
                        return (
                          <TouchableOpacity
                            key={o.key}
                            onPress={() => toggleMachineEstado(o.key)}
                            style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? meta.color : colors.border, backgroundColor: on ? meta.color : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                          >
                            <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{meta.icon} {meta.label}</Text>
                            <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>({o.count})</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
                {(machineCompanySel.size > 0 || machineClaseSel.size > 0 || machineEstadoSel.size > 0) ? (
                  <TouchableOpacity onPress={() => { setMachineCompanySel(new Set()); setMachineClaseSel(new Set()); setMachineEstadoSel(new Set()); }} style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }}>
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>✕ Limpiar filtros</Text>
                  </TouchableOpacity>
                ) : null}
                {machinePickLoading ? (
                  <Loading />
                ) : (
                  <ScrollView style={{ marginTop: spacing.sm }}>
                    {machinePickFiltered.map((m) => (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => addMachineToScope(m.id)}
                        style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs, backgroundColor: colors.surface }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={{ color: colors.text, fontWeight: '700', flexShrink: 1 }}>
                            🚜 {m.code}{(m.marca || m.modelo) ? ` · ${[m.marca, m.modelo].filter(Boolean).join(' ')}` : ''}
                          </Text>
                          <Text style={{ color: ESTADO_CONTEO_META[machineEstadoOf(m)].color, fontWeight: '700', fontSize: 12 }}>
                            {ESTADO_CONTEO_META[machineEstadoOf(m)].icon} {ESTADO_CONTEO_META[machineEstadoOf(m)].label}
                          </Text>
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          {[m.clasificacion, m.plate ? `Placa ${m.plate}` : null, m.serial ? `Serial ${m.serial}` : null].filter(Boolean).join(' · ') || 'Sin categoría/placa/serial'}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          {[m.encargado ? `👤 ${m.encargado}` : null, m.sector ? `📍 ${m.sector}` : null, `🏢 ${m.companyName}`].filter(Boolean).join(' · ')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    {machinePickFiltered.length === 0 ? <Text style={{ color: colors.muted, textAlign: 'center', marginVertical: spacing.md }}>Sin coincidencias.</Text> : null}
                  </ScrollView>
                )}
                <TouchableOpacity onPress={() => setMachinePickOpen(false)} style={{ marginTop: spacing.sm, padding: spacing.md, alignItems: 'center' }}>
                  <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  addBtn: {
    backgroundColor: colors.accent,
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
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
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
