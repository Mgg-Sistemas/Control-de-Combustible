import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { nameToEmail, validateName } from '../lib/username';
import {
  isBiometricSupported,
  isBiometricEnabled,
  authenticateBiometric,
} from '../lib/biometric';

type AuthState = {
  session: Session | null;
  loading: boolean;
  configured: boolean;
  /** Bloqueado a la espera de huella (sesión existe pero no se ha desbloqueado). */
  locked: boolean;
  signIn: (firstName: string, lastName: string, password: string) => Promise<{ error?: string }>;
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

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        configured: isSupabaseConfigured,
        locked,
        signIn,
        signUp,
        signOut,
        unlock,
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
