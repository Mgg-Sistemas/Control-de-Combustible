import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

const FLAG_KEY = 'biometric_enabled';

/** ¿El dispositivo soporta biometría (huella/Face ID)? Falso en web. */
export async function isBiometricSupported(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHardware && enrolled;
  } catch {
    return false;
  }
}

/** ¿El usuario activó el inicio con huella en esta app? */
export async function isBiometricEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(FLAG_KEY)) === '1';
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  if (enabled) await AsyncStorage.setItem(FLAG_KEY, '1');
  else await AsyncStorage.removeItem(FLAG_KEY);
}

/** Lanza el prompt de huella/Face ID. Devuelve true si se autenticó. */
export async function authenticateBiometric(): Promise<boolean> {
  if (!(await isBiometricSupported())) return false;
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Confirma tu identidad',
    cancelLabel: 'Cancelar',
    disableDeviceFallback: false,
  });
  return res.success;
}
