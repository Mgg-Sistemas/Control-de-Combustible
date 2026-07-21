import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

const FLAG_KEY = 'biometric_enabled';
const CRED_KEY = 'biometric_cred_id'; // credencial WebAuthn (solo web)
const SESS_KEY = 'biometric_refresh'; // refresh token de Supabase, para reautenticar con huella

const isWeb = Platform.OS === 'web';
// En web usamos las APIs del navegador (WebAuthn). Casteamos a any para no
// depender de los tipos del DOM en el tsconfig de React Native.
const g: any = globalThis as any;

// ---------- utilidades base64 <-> ArrayBuffer (web) ----------
function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return g.btoa(bin);
}
function b64ToBuf(b64: string): ArrayBuffer {
  const bin = g.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  g.crypto.getRandomValues(a);
  return a;
}

// ============================================================
// ¿El dispositivo soporta biometría?
// ============================================================
export async function isBiometricSupported(): Promise<boolean> {
  if (isWeb) {
    try {
      const PKC = g.PublicKeyCredential;
      if (!PKC || !PKC.isUserVerifyingPlatformAuthenticatorAvailable) return false;
      return await PKC.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHardware && enrolled;
  } catch {
    return false;
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(FLAG_KEY)) === '1';
}

// ============================================================
// Activar / desactivar
// ============================================================
/** Activa la biometría. En web registra una credencial WebAuthn (huella/Face/Hello). */
export async function enableBiometric(label = 'Control de Combustible'): Promise<boolean> {
  if (isWeb) {
    try {
      const cred = await g.navigator.credentials.create({
        publicKey: {
          challenge: randomBytes(32),
          rp: { name: 'Control de Combustible', id: g.location.hostname },
          user: { id: randomBytes(16), name: label, displayName: label },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60000,
          attestation: 'none',
        },
      });
      if (!cred) return false;
      await AsyncStorage.setItem(CRED_KEY, bufToB64(cred.rawId));
      await AsyncStorage.setItem(FLAG_KEY, '1');
      return true;
    } catch {
      return false;
    }
  }
  // Nativo: confirmar identidad antes de activar
  const ok = await authenticateBiometric();
  if (ok) await AsyncStorage.setItem(FLAG_KEY, '1');
  return ok;
}

export async function disableBiometric(): Promise<void> {
  await AsyncStorage.removeItem(FLAG_KEY);
  await AsyncStorage.removeItem(CRED_KEY);
  await AsyncStorage.removeItem(SESS_KEY);
}

// ============================================================
// Sesión protegida por huella (para "Entrar con huella" tras vencer la sesión)
// ============================================================
/** Guarda el refresh token para poder reautenticar con la huella más adelante. */
export async function saveBiometricSession(refreshToken?: string | null): Promise<void> {
  if (!refreshToken) return;
  try { await AsyncStorage.setItem(SESS_KEY, refreshToken); } catch {}
}
/** Devuelve el refresh token guardado (o null). */
export async function getBiometricRefreshToken(): Promise<string | null> {
  try { return await AsyncStorage.getItem(SESS_KEY); } catch { return null; }
}
/** Borra el refresh token guardado (al cerrar sesión explícitamente). */
export async function clearBiometricSession(): Promise<void> {
  try { await AsyncStorage.removeItem(SESS_KEY); } catch {}
}

// ============================================================
// Autenticar (desbloquear)
// ============================================================
export async function authenticateBiometric(): Promise<boolean> {
  if (isWeb) {
    try {
      const stored = await AsyncStorage.getItem(CRED_KEY);
      const allow = stored
        ? [{ type: 'public-key', id: b64ToBuf(stored), transports: ['internal'] }]
        : [];
      const assertion = await g.navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32),
          allowCredentials: allow,
          userVerification: 'required',
          rpId: g.location.hostname,
          timeout: 60000,
        },
      });
      return !!assertion;
    } catch {
      return false;
    }
  }
  if (!(await isBiometricSupported())) return false;
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Confirma tu identidad',
    cancelLabel: 'Cancelar',
    disableDeviceFallback: false,
  });
  return res.success;
}
