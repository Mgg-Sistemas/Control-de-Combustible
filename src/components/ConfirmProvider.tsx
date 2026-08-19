// Diálogo de confirmación reutilizable (Aceptar / Cancelar) para TODO el sistema.
// En web Alert.alert no funciona, así que renderizamos un modal propio con el tema.
// Uso:  const confirm = useConfirm();  if (await confirm('¿Desea eliminar X?')) { ... }
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { colors, typography } = useTheme();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(typeof o === 'string' ? { message: o } : o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: boolean) => {
    setOpts(null);
    resolver.current?.(v);
    resolver.current = null;
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {/* ⚠️ El Modal se monta SOLO cuando hay algo que confirmar, y no con
          `visible={!!opts}` sobre un Modal siempre montado. NO lo cambies:
          en web todos los Modal salen con el mismo z-index (9999) y quedan
          apilados en el orden en que se montaron. Este vive en la raíz de la
          app, así que si estuviera siempre montado sería SIEMPRE el primero
          y CUALQUIER otra ventana abierta lo taparía: la pregunta salía
          detrás y parecía que el botón no hacía nada. Montándolo al vuelo
          entra de último y queda delante de todo. */}
      {opts ? (
      <Modal visible transparent animationType="fade" onRequestClose={() => close(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
            <Text style={[typography.title, { fontSize: 18, marginBottom: spacing.sm }]}>
              {opts?.title ?? 'Confirmar'}
            </Text>
            <Text style={{ color: colors.text, fontSize: 15, marginBottom: spacing.lg }}>
              {opts?.message}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity
                style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}
                onPress={() => close(false)}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>{opts?.cancelText ?? 'Cancelar'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: opts?.danger ? colors.danger : colors.primary }}
                onPress={() => close(true)}
              >
                <Text style={{ color: opts?.danger ? '#fff' : colors.primaryContrast, fontWeight: '700' }}>
                  {opts?.confirmText ?? 'Aceptar'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      ) : null}
    </ConfirmCtx.Provider>
  );
}
