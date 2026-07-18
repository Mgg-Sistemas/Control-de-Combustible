import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { nameToEmail, validateName } from '../lib/username';
import { UserRole, AppRole } from '../types/database';
import { PermLevel, defaultLevel } from '../lib/permissions';
import {
  isBiometricSupported,
  isBiometricEnabled,
  authenticateBiometric,
} from '../lib/biometric';

type AuthState = {
  session: Session | null;
  loading: boolean;
  configured: boolean;
  /** Rol del usuario autenticado (admin/supervisor/operador/conductor). */
  role: UserRole | null;
  /** Rol DINÁMICO asignado (define qué módulos ve). null = usa el rol base + permisos. */
  appRole: AppRole | null;
  /** IDs de usuarios conectados ahora mismo (Realtime Presence). */
  onlineIds: string[];
  /** Nivel de permiso del usuario para un módulo (admin = full). */
  moduleLevel: (moduleKey: string) => PermLevel;
  /** ¿el usuario puede ver/entrar al módulo? (nivel distinto de 'none'). */
  canSee: (moduleKey: string) => boolean;
  /** Bloqueado a la espera de huella (sesión existe pero no se ha desbloqueado). */
  locked: boolean;
  signIn: (firstName: string, lastName: string, password: string) => Promise<{ error?: string }>;
  /** Inicio de sesión BLINDADO por cédula + contraseña (solo personas registradas con cédula). */
  signInWithCedula: (cedula: string, password: string) => Promise<{ error?: string }>;
  signUp: (
    firstName: string,
    lastName: string,
    password: string
  ) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  unlock: () => Promise<boolean>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [appRole, setAppRole] = useState<AppRole | null>(null);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Record<string, PermLevel>>({});

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      // Si hay sesión persistida y el usuario activó la huella, exigir desbloqueo.
      if (data.session) {
        const enabled = await isBiometricEnabled();
        const supported = await isBiometricSupported();
        if (enabled && supported) setLocked(true);
      }
      setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Carga el rol y anuncia/observa presencia cuando hay sesión.
  useEffect(() => {
    if (!session?.user) {
      setRole(null);
      setAppRole(null);
      setOnlineIds([]);
      setPermissions({});
      return;
    }
    const uid = session.user.id;
    let active = true;

    supabase
      .from('profiles')
      .select('role, app_role:app_role_id(id, name, modules, created_at)')
      .eq('id', uid)
      .single()
      .then(({ data }) => {
        if (!active) return;
        setRole((data?.role as UserRole) ?? null);
        setAppRole(((data as any)?.app_role as AppRole) ?? null);
      });

    // Permisos por módulo del usuario.
    const loadPerms = () =>
      supabase
        .from('module_permissions')
        .select('module, level')
        .eq('user_id', uid)
        .then(({ data }) => {
          if (!active) return;
          const map: Record<string, PermLevel> = {};
          (data ?? []).forEach((r: any) => (map[r.module] = r.level));
          setPermissions(map);
        });
    loadPerms();

    // Realtime: si un admin cambia los permisos del usuario, se aplican EN VIVO
    // (sin necesidad de cerrar y volver a iniciar sesión).
    // Blindaje: si por cualquier razón quedó un canal previo con este mismo topic
    // (efecto reejecutado, StrictMode, reconexión), lo eliminamos ANTES de crear
    // el nuevo. Así nunca se agrega un listener sobre un canal ya suscrito
    // (error "cannot add postgres_changes callbacks after subscribe()").
    const permTopic = `perms-${uid}`;
    supabase
      .getChannels()
      .filter((c) => c.topic === permTopic || c.topic === `realtime:${permTopic}`)
      .forEach((c) => supabase.removeChannel(c));
    let permCh: ReturnType<typeof supabase.channel> | null = null;
    try {
      permCh = supabase
        .channel(permTopic)
        .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'module_permissions', filter: `user_id=eq.${uid}` }, () => loadPerms())
        .subscribe();
    } catch (e) {
      // Si aun así falla, no rompemos la app: los permisos se cargaron arriba con
      // loadPerms() y se recargan al reingresar. Solo perdemos el "en vivo".
      console.warn('perms realtime no disponible:', e);
    }

    // Realtime Presence: cada usuario logueado se anuncia en este canal.
    supabase
      .getChannels()
      .filter((c) => c.topic === 'online-users' || c.topic === 'realtime:online-users')
      .forEach((c) => supabase.removeChannel(c));
    const channel = supabase.channel('online-users', {
      config: { presence: { key: uid } },
    });
    channel
      .on('presence', { event: 'sync' }, () => {
        setOnlineIds(Object.keys(channel.presenceState()));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      active = false;
      if (permCh) supabase.removeChannel(permCh);
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  const signIn: AuthState['signIn'] = async (firstName, lastName, password) => {
    const v = validateName(firstName, lastName);
    if (v) return { error: v };
    const email = nameToEmail(firstName, lastName);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return {
        error:
          error.message.toLowerCase().includes('invalid')
            ? 'Nombre, apellido o contraseña incorrectos.'
            : error.message,
      };
    }
    setLocked(false);
    return {};
  };

  // Inicio de sesión BLINDADO: por CÉDULA + contraseña. La cédula se traduce al
  // correo interno con una función segura de la BD; si la cédula no está registrada
  // (o el usuario no tiene cédula asignada), no deja entrar y pide avisar al admin.
  const signInWithCedula: AuthState['signInWithCedula'] = async (cedula, password) => {
    const ci = (cedula ?? '').trim();
    if (!ci) return { error: 'Ingresa tu cédula.' };
    if (!password) return { error: 'Ingresa tu contraseña.' };
    // Estado del usuario: correo interno + si está BLOQUEADO por intentos fallidos.
    const { data: statusRows, error: rpcErr } = await supabase.rpc('login_status_for_cedula', { p_cedula: ci });
    if (rpcErr) return { error: 'No se pudo validar la cédula. Revisa tu conexión e inténtalo de nuevo.' };
    const status: any = Array.isArray(statusRows) ? statusRows[0] : statusRows;
    const email = status?.email;
    if (!email) return { error: 'Pídele al administrador de sistemas que agregue la CÉDULA para poder ingresar.' };
    if (status?.locked) return { error: '🔒 Usuario BLOQUEADO por intentos fallidos. Pídele al administrador de sistemas que lo desbloquee.' };
    const { error } = await supabase.auth.signInWithPassword({ email: String(email), password });
    if (error) {
      const invalid = error.message.toLowerCase().includes('invalid');
      if (!invalid) return { error: error.message };
      // Contraseña incorrecta: registra el intento; al 3ro se bloquea el usuario.
      const { data: fRows } = await supabase.rpc('register_failed_login', { p_cedula: ci });
      const f: any = Array.isArray(fRows) ? fRows[0] : fRows;
      if (f?.locked) return { error: '🔒 Usuario BLOQUEADO tras 3 intentos fallidos. El administrador de sistemas debe desbloquearlo.' };
      const left = Math.max(0, 3 - (Number(f?.attempts) || 0));
      return { error: `Cédula o contraseña incorrectas. ${left === 1 ? 'Te queda 1 intento' : `Te quedan ${left} intentos`} antes del bloqueo.` };
    }
    // Éxito: limpia el contador de intentos fallidos.
    await supabase.rpc('reset_failed_login', { p_cedula: ci });
    setLocked(false);
    return {};
  };

  const signUp: AuthState['signUp'] = async (firstName, lastName, password) => {
    const v = validateName(firstName, lastName);
    if (v) return { error: v };
    const email = nameToEmail(firstName, lastName);
    const full_name = `${firstName.trim()} ${lastName.trim()}`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name, first_name: firstName.trim(), last_name: lastName.trim() } },
    });
    if (error) {
      return {
        error: error.message.toLowerCase().includes('already')
          ? 'Ya existe un usuario con ese nombre y apellido.'
          : error.message,
      };
    }
    return {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setLocked(false);
  };

  const unlock = async () => {
    const ok = await authenticateBiometric();
    if (ok) setLocked(false);
    return ok;
  };

  const moduleLevel = (moduleKey: string): PermLevel => {
    if (role === 'admin') return 'full';
    // Rol DINÁMICO: el usuario ve SOLO los módulos definidos en su rol (lo demás 'none').
    if (appRole) return (appRole.modules?.[moduleKey] as PermLevel) ?? 'none';
    return permissions[moduleKey] ?? defaultLevel(moduleKey);
  };
  const canSee = (moduleKey: string) => moduleLevel(moduleKey) !== 'none';

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        configured: isSupabaseConfigured,
        role,
        appRole,
        onlineIds,
        locked,
        moduleLevel,
        canSee,
        signIn,
        signInWithCedula,
        signOut,
        unlock,
        signUp,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
