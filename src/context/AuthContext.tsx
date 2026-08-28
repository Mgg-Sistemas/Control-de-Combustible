import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { consumeSoftReload } from '../lib/version';
import { nameToEmail, validateName } from '../lib/username';
import { UserRole, AppRole } from '../types/database';
import { PermLevel, defaultLevel, maxLevel, MODULE_HEREDA_DE } from '../lib/permissions';
import { logAudit } from '../lib/audit';
import { clavesAProbar } from '../lib/password';
import {
  isBiometricSupported,
  isBiometricEnabled,
  authenticateBiometric,
  saveBiometricSession,
  getBiometricRefreshToken,
  clearBiometricSession,
} from '../lib/biometric';

type AuthState = {
  session: Session | null;
  loading: boolean;
  configured: boolean;
  /** Rol del usuario autenticado (admin/supervisor/operador/conductor). */
  role: UserRole | null;
  /** Rol DINÁMICO asignado (define qué módulos ve). null = usa el rol base + permisos. */
  appRole: AppRole | null;
  /** ¿Ya se resolvieron `role` Y `appRole` para la sesión actual? Úsalo antes de
   *  decidir a qué pantalla mandar al usuario (evita un salto al árbol equivocado
   *  mientras `appRole` todavía está cargando detrás de `role`). */
  roleReady: boolean;
  /** ¿el usuario puede ver el módulo de Auditoría (bitácora de todos)? */
  canAudit: boolean;
  /** Nombre completo del usuario autenticado (profiles.full_name). */
  fullName: string | null;
  /** IDs de usuarios conectados ahora mismo (Realtime Presence). */
  onlineIds: string[];
  /** Nivel de permiso del usuario para un módulo (admin = full). */
  moduleLevel: (moduleKey: string) => PermLevel;
  /** ¿el usuario puede ver/entrar al módulo? (nivel distinto de 'none'). */
  canSee: (moduleKey: string) => boolean;
  /** Bloqueado a la espera de huella (sesión existe pero no se ha desbloqueado). */
  locked: boolean;
  /** Hay una sesión guardada tras la huella: se puede ENTRAR con huella desde el login. */
  bioLoginAvailable: boolean;
  /** Inicia sesión con la huella reautenticando el refresh token guardado. */
  biometricLogin: () => Promise<{ error?: string }>;
  /** Guarda la sesión actual para poder entrar con huella (al activar la huella). */
  rememberBiometricSession: () => Promise<void>;
  signIn: (firstName: string, lastName: string, password: string) => Promise<{ error?: string }>;
  /** Inicio de sesión BLINDADO por cédula + contraseña (solo personas registradas con cédula). */
  signInWithCedula: (cedula: string, password: string) => Promise<{ error?: string }>;
  /** Inicio de sesión por USUARIO + contraseña (usuario máx. 10 caracteres). */
  signInWithUsername: (username: string, password: string) => Promise<{ error?: string }>;
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
  // ¿Ya terminó de cargar TANTO `role` como `appRole`? `role` llega primero (query
  // simple) y `appRole` un instante después (segunda consulta encadenada) — si la
  // navegación decide el árbol (pickTree) apenas `role` está listo pero `appRole`
  // TODAVÍA está en null, un usuario con rol dinámico (combustible, coordinador QR…)
  // cae un instante en el árbol genérico equivocado antes de corregirse solo, y esa
  // primera decisión puede dejarlo "atascado" ahí. `roleReady` deja esperar a que
  // los DOS estén resueltos antes de elegir el árbol.
  const [roleReady, setRoleReady] = useState(false);
  const [canAudit, setCanAudit] = useState(false);
  const [fullName, setFullName] = useState<string | null>(null);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Record<string, PermLevel>>({});
  const [bioLoginAvailable, setBioLoginAvailable] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    (async () => {
      // Recarga por ACTUALIZAR: restaura el token si el navegador móvil lo descartó
      // y evita re-exigir la huella en esta recarga (así ACTUALIZAR no "cierra la
      // sesión" en el teléfono). Debe correr ANTES de leer la sesión.
      const softReload = consumeSoftReload();
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      const enabled = await isBiometricEnabled();
      // Si hay sesión persistida y el usuario activó la huella, exigir desbloqueo.
      // Excepción: si venimos de una recarga por ACTUALIZAR, NO re-bloqueamos (el
      // usuario acaba de pulsar el botón, está presente).
      if (data.session) {
        const supported = await isBiometricSupported();
        if (enabled && supported && !softReload) setLocked(true);
      } else if (enabled) {
        // No hay sesión (venció o se limpió) pero la huella está activa y guardamos
        // el refresh token: ofrecer "Entrar con huella" en el login.
        const rt = await getBiometricRefreshToken();
        if (rt) setBioLoginAvailable(true);
      }
      setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      // Mantener fresco el refresh token protegido por huella (login y renovaciones).
      if (s?.refresh_token) isBiometricEnabled().then((en) => { if (en) saveBiometricSession(s.refresh_token); });
    });
    // En nativo (teléfono), Supabase SOLO renueva el token solo mientras la app está
    // en PRIMER PLANO: si el usuario la manda a segundo plano varias horas (cambia de
    // app, apaga pantalla), el temporizador de refresco no corre, el token vence, y al
    // volver la sesión ya no es válida → se cierra sola y bota al usuario a la pantalla
    // de login (perdiendo en qué vista estaba). Esto es lo que reportaban los admins.
    // Fix oficial de Supabase para RN: encender/apagar el auto-refresh según el estado
    // de la app. En web no aplica (el navegador ya mantiene los timers).
    let appStateSub: { remove: () => void } | null = null;
    if (Platform.OS !== 'web') {
      const onAppStateChange = (state: string) => {
        if (state === 'active') supabase.auth.startAutoRefresh();
        else supabase.auth.stopAutoRefresh();
      };
      appStateSub = AppState.addEventListener('change', onAppStateChange);
      if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
    }
    return () => { sub.subscription.unsubscribe(); appStateSub?.remove(); };
  }, []);

  // Carga el rol y anuncia/observa presencia cuando hay sesión.
  useEffect(() => {
    if (!session?.user) {
      setRole(null);
      setAppRole(null);
      setCanAudit(false);
      setFullName(null);
      setOnlineIds([]);
      setPermissions({});
      setRoleReady(true); // nada que cargar: sin sesión no hay rol que esperar.
      return;
    }
    const uid = session.user.id;
    let active = true;
    setRoleReady(false); // nueva sesión: vuelve a esperar role + appRole juntos.

    // Canal de realtime del ROL DINÁMICO actual (se recrea solo si cambia de rol).
    let roleCh: ReturnType<typeof supabase.channel> | null = null;
    let roleChId: string | null = null;

    // El ROL se carga con un query SIMPLE (nunca toca columnas de app_roles), para que
    // aunque falte una columna (p. ej. panel_type sin migrar) el admin no pierda su rol
    // ni sus módulos. El rol especial (app_role) se trae aparte, con respaldo.
    const loadRole = async () => {
      const { data } = await supabase.from('profiles').select('role, app_role_id, can_audit, full_name').eq('id', uid).single();
      if (!active) return;
      setRole((data?.role as UserRole) ?? null);
      // Auditoría: TODOS los admin la ven; además cualquiera con el flag can_audit.
      setCanAudit((data?.role as UserRole) === 'admin' || !!(data as any)?.can_audit);
      setFullName((data as any)?.full_name ?? null);
      const arId = (data as any)?.app_role_id ?? null;
      if (!arId) {
        setAppRole(null);
        if (roleCh) { supabase.removeChannel(roleCh); roleCh = null; roleChId = null; }
        setRoleReady(true);
        return;
      }
      // Intenta con panel_type; si la columna no existe todavía, cae al query sin ella.
      let ar = await supabase.from('app_roles').select('id, name, modules, panel_type, created_at').eq('id', arId).single();
      if (ar.error) ar = await supabase.from('app_roles').select('id, name, modules, created_at').eq('id', arId).single();
      if (!active) return;
      setAppRole((ar.data as AppRole) ?? null);
      setRoleReady(true);

      // Realtime: si un admin edita el ROL DINÁMICO en sí (p. ej. le agrega acceso a
      // "Combustible" al rol "Almacenista"), se aplica EN VIVO. Antes solo se escuchaba
      // la fila de `profiles` del usuario — editar el rol compartido (sin tocar profiles)
      // no llegaba a nadie hasta cerrar sesión y volver a entrar.
      if (roleChId !== arId) {
        if (roleCh) supabase.removeChannel(roleCh);
        const roleTopic = `approle-${arId}`;
        supabase
          .getChannels()
          .filter((c) => c.topic === roleTopic || c.topic === `realtime:${roleTopic}`)
          .forEach((c) => supabase.removeChannel(c));
        roleCh = supabase
          .channel(roleTopic)
          .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'app_roles', filter: `id=eq.${arId}` }, () => loadRole())
          .subscribe();
        roleChId = arId;
      }
    };
    loadRole();

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

    // Realtime: si un admin cambia el ROL del usuario (o su app_role), se aplica EN
    // VIVO — sin cerrar sesión. Antes solo se sincronizaban los permisos de módulo, así
    // que asignar el rol "coordinador de inspectores" (u otro) no surtía efecto hasta
    // re-loguear. Mismo blindaje anti-canal-duplicado que arriba.
    const profileTopic = `profile-${uid}`;
    supabase
      .getChannels()
      .filter((c) => c.topic === profileTopic || c.topic === `realtime:${profileTopic}`)
      .forEach((c) => supabase.removeChannel(c));
    let profileCh: ReturnType<typeof supabase.channel> | null = null;
    try {
      profileCh = supabase
        .channel(profileTopic)
        .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` }, () => loadRole())
        .subscribe();
    } catch (e) {
      console.warn('profile realtime no disponible:', e);
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
      if (profileCh) supabase.removeChannel(profileCh);
      if (roleCh) supabase.removeChannel(roleCh);
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  const signIn: AuthState['signIn'] = async (firstName, lastName, password) => {
    const v = validateName(firstName, lastName);
    if (v) return { error: v };
    const email = nameToEmail(firstName, lastName);
    const { data, error } = await intentarEntrar(email, password);
    if (error) {
      return {
        error:
          error.message.toLowerCase().includes('invalid')
            ? 'Nombre, apellido o contraseña incorrectos.'
            : error.message,
      };
    }
    logAudit('LOGIN', 'profiles', data.user?.id ?? null); // bitácora: inició sesión
    setLocked(false);
    return {};
  };

  /**
   * ⭐ EL INTENTO DE ENTRADA, CON EL PUENTE DE LAS CLAVES VIEJAS.
   *
   * Desde el 27-ago-2026 las contraseñas se guardan en MAYÚSCULA (regla del
   * cliente). Pero las que ya existían están cifradas y NO se pueden reescribir,
   * así que muchas siguen teniendo minúsculas. Por eso se prueba primero la
   * versión en mayúscula y, solo si esa falla y la persona escribió minúsculas,
   * se reintenta TAL CUAL lo tecleó. Ver `src/lib/password.ts`.
   *
   * ⚠️ EL REINTENTO NO PUEDE GASTAR UN INTENTO DEL BLOQUEO. El contador de los
   *    3 fallos lo lleva la app llamando a `register_failed_login*`, y esa
   *    llamada se hace FUERA de aquí, una sola vez, cuando ya fallaron todas
   *    las opciones. Si se registrara por cada opción, la gente con clave vieja
   *    se bloquearía al primer error de tecleo en vez de al tercero.
   */
  const intentarEntrar = async (email: string, password: string) => {
    const opciones = clavesAProbar(password);
    let ultimo: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>> | null = null;
    for (const clave of opciones) {
      const r = await supabase.auth.signInWithPassword({ email, password: clave });
      if (!r.error) return r;                       // entró
      ultimo = r;
      // Si el fallo NO es de credenciales (red, servidor, límite de peticiones),
      // no tiene sentido reintentar con otra clave: se devuelve tal cual.
      if (!r.error.message.toLowerCase().includes('invalid')) return r;
    }
    return ultimo!;
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
    const { data, error } = await intentarEntrar(String(email), password);
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
    logAudit('LOGIN', 'profiles', data.user?.id ?? null); // bitácora: inició sesión
    setLocked(false);
    return {};
  };

  // Inicio de sesión por USUARIO + contraseña. Igual de blindado que por cédula:
  // traduce el usuario al correo interno, respeta el BLOQUEO por intentos fallidos
  // y solo un administrador puede desbloquear.
  const signInWithUsername: AuthState['signInWithUsername'] = async (username, password) => {
    const u = (username ?? '').trim();
    if (!u) return { error: 'Ingresa tu usuario.' };
    if (!password) return { error: 'Ingresa tu contraseña.' };
    const { data: statusRows, error: rpcErr } = await supabase.rpc('login_status_for_username', { p_username: u });
    if (rpcErr) return { error: 'No se pudo validar el usuario. Revisa tu conexión e inténtalo de nuevo.' };
    const status: any = Array.isArray(statusRows) ? statusRows[0] : statusRows;
    const email = status?.email;
    if (!email) return { error: 'Usuario no registrado. Pídele al administrador de sistemas que te cree un usuario.' };
    if (status?.locked) return { error: '🔒 Usuario BLOQUEADO por intentos fallidos. Pídele al administrador de sistemas que lo desbloquee.' };
    const { data, error } = await intentarEntrar(String(email), password);
    if (error) {
      const invalid = error.message.toLowerCase().includes('invalid');
      if (!invalid) return { error: error.message };
      const { data: fRows } = await supabase.rpc('register_failed_login_username', { p_username: u });
      const f: any = Array.isArray(fRows) ? fRows[0] : fRows;
      if (f?.locked) return { error: '🔒 Usuario BLOQUEADO tras 3 intentos fallidos. El administrador de sistemas debe desbloquearlo.' };
      const left = Math.max(0, 3 - (Number(f?.attempts) || 0));
      return { error: `Usuario o contraseña incorrectos. ${left === 1 ? 'Te queda 1 intento' : `Te quedan ${left} intentos`} antes del bloqueo.` };
    }
    await supabase.rpc('reset_failed_login_username', { p_username: u });
    logAudit('LOGIN', 'profiles', data.user?.id ?? null); // bitácora: inició sesión
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
    // Bitácora: ANTES de cerrar sesión (auth.signOut ya invalida auth.uid() en el
    // servidor, así que si se llamara después quedaría sin usuario asociado).
    await logAudit('LOGOUT', 'profiles', session?.user?.id ?? null);
    await supabase.auth.signOut();
    await clearBiometricSession(); // salir explícito: la huella ya no reautentica esta cuenta
    setLocked(false);
    setBioLoginAvailable(false);
  };

  // Entrar con HUELLA reautenticando el refresh token guardado (aunque la sesión
  // de Supabase ya haya vencido). No guardamos contraseñas: solo el refresh token.
  const biometricLogin: AuthState['biometricLogin'] = async () => {
    const rt = await getBiometricRefreshToken();
    if (!rt) return { error: 'No hay una sesión de huella guardada en este dispositivo.' };
    const ok = await authenticateBiometric();
    if (!ok) return { error: 'No se pudo verificar la huella.' };
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: rt });
    if (error || !data?.session) {
      await clearBiometricSession();
      setBioLoginAvailable(false);
      return { error: 'La sesión de la huella venció. Entra con tu usuario y contraseña una vez.' };
    }
    await saveBiometricSession(data.session.refresh_token);
    setLocked(false);
    setBioLoginAvailable(false);
    return {};
  };

  // Guarda la sesión actual protegida por huella (al activar la huella estando dentro).
  const rememberBiometricSession = async () => {
    if (session?.refresh_token) await saveBiometricSession(session.refresh_token);
  };

  const unlock = async () => {
    const ok = await authenticateBiometric();
    if (ok) setLocked(false);
    return ok;
  };

  const moduleLevel = (moduleKey: string): PermLevel => {
    if (role === 'admin') return 'full';
    // Permiso EXPLÍCITO por módulo que un admin le asignó a este usuario (matriz de
    // "Permisos por módulo"). Solo existe si el admin lo marcó (sin default aquí).
    const explicit = permissions[moduleKey];
    // Módulo HEREDADO (ver MODULE_HEREDA_DE): 'servicio' salió de dividir
    // 'mantenimiento' en dos secciones. Si nadie le asignó un nivel propio —ni
    // por usuario ni por rol— toma el del módulo del que salió, para que la
    // división no le regale ni le quite el acceso a nadie.
    const padre = MODULE_HEREDA_DE[moduleKey];
    if (padre && !explicit && !appRole?.modules?.[moduleKey]) return moduleLevel(padre);
    // Rol personalizado: ve los módulos de su rol, PERO el permiso EXPLÍCITO que el
    // admin le puso a esa persona MANDA sobre el rol — para arriba y para abajo.
    //
    // Antes se tomaba el MAYOR de los dos (`maxLevel`), así que un permiso explícito
    // solo servía para SUBIR: si el admin le ponía "Lectura" a alguien cuyo rol daba
    // "Escritura", no pasaba nada y el usuario seguía escribiendo. Quitarle el
    // permiso a una persona era imposible sin cambiarle el módulo a TODO el rol (y
    // con eso se lo quitabas también a los demás que tienen ese mismo rol).
    // Pedido del cliente (21-ago-2026): «si yo le quito los permisos a alguien, no
    // importa el rol, se los pueda quitar y ya».
    //
    // Se conserva lo que buscaba el `maxLevel`: un explícito MAYOR sigue subiendo
    // (rol sin el módulo + explícito "full" = full). Lo único nuevo es que ahora
    // también puede bajar. Sin fila explícita, el rol manda como siempre.
    if (appRole) {
      const roleLvl = (appRole.modules?.[moduleKey] as PermLevel) ?? 'none';
      return explicit ?? roleLvl;
    }
    // El rol FIJO 'analista' tiene acceso mínimo de escritura a Control de
    // Asistencia aunque no tenga una fila explícita en module_permissions
    // (si el admin le dio explícitamente un nivel mayor, ese gana).
    if (role === 'analista' && moduleKey === 'asistencia') {
      return maxLevel('escritura', explicit ?? defaultLevel(moduleKey));
    }
    return explicit ?? defaultLevel(moduleKey);
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
        roleReady,
        canAudit,
        fullName,
        onlineIds,
        locked,
        bioLoginAvailable,
        biometricLogin,
        rememberBiometricSession,
        moduleLevel,
        canSee,
        signIn,
        signInWithCedula,
        signInWithUsername,
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
