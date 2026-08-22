// Aviso flotante (éxito/error/info) reutilizable para TODO el sistema.
// En web Alert.alert no funciona (ver ConfirmProvider.tsx), así que los avisos de
// "se guardó" / "hubo un error" pasaban desapercibidos ahí. Este toast SÍ se ve en
// web y en nativo, con el mismo estilo en ambos.
// Uso:  const toast = useToast();  toast.success('Guardado'); toast.error('Error: ...');
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

export type ToastType = 'success' | 'error' | 'info';
export type ToastOptions = { message: string; type?: ToastType; durationMs?: number };

type ToastFn = (opts: ToastOptions | string) => void;
type ToastApi = {
  show: ToastFn;
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
  info: (message: string, durationMs?: number) => void;
};

const noop: ToastApi = { show: () => {}, success: () => {}, error: () => {}, info: () => {} };
const ToastCtx = createContext<ToastApi>(noop);
export const useToast = () => useContext(ToastCtx);

const TONE: Record<ToastType, { bg: string; fg: string }> = {
  success: { bg: '#1E9E4A', fg: '#FFFFFF' },
  error: { bg: '#D22B2B', fg: '#FFFFFF' },
  info: { bg: '#2563EB', fg: '#FFFFFF' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { typography } = useTheme();
  const [item, setItem] = useState<{ message: string; type: ToastType } | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setItem(null));
  }, [anim]);

  const show = useCallback<ToastFn>((o) => {
    const opts: ToastOptions = typeof o === 'string' ? { message: o } : o;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setItem({ message: opts.message, type: opts.type ?? 'info' });
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    hideTimer.current = setTimeout(dismiss, opts.durationMs ?? 3500);
  }, [anim, dismiss]);

  const api: ToastApi = {
    show,
    success: (message, durationMs) => show({ message, type: 'success', durationMs }),
    error: (message, durationMs) => show({ message, type: 'error', durationMs: durationMs ?? 5000 }),
    info: (message, durationMs) => show({ message, type: 'info', durationMs }),
  };

  const tone = item ? TONE[item.type] : TONE.info;

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {item ? (
        <Animated.View
          pointerEvents="box-none"
          style={{
            position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.xl,
            opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={dismiss}
            style={{ backgroundColor: tone.bg, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}
          >
            <Text style={[typography.body, { color: tone.fg, fontWeight: '700' }]}>{item.message}</Text>
          </TouchableOpacity>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}
