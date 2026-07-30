import React from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { COMPANY_NAME } from '../lib/company';

const LOGO = require('../../assets/logo.png');

/**
 * Pantalla de ENTRADA al escanear el QR de una máquina: muestra el logo y dos
 * botones.
 *  - 🔓 INICIAR SESIÓN → LOGIN (usuario y contraseña); luego, sin importar el rol,
 *                    cae en la VISTA DE INSPECCIÓN de esta máquina. Los
 *                    coordinadores de patio conservan su pantalla + jornada/avería.
 *  - 🚜 Operadores → vista de operador que EXIGE escanear el carnet para poder
 *                    hacer algo (si no escanea, no ve ni registra nada).
 */
export default function MachineQrEntry({ onLogin, onOperator }: { onLogin: () => void; onOperator: () => void }) {
  const { colors } = useTheme();
  const boton = (emoji: string, label: string, sub: string, onPress: () => void) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{ backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginTop: spacing.sm, alignItems: 'center' }}
    >
      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 16 }}>{emoji} {label}</Text>
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>{sub}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={{ flex: 1, backgroundColor: '#EAF1FB', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <Image source={LOGO} style={{ width: 170, height: 170 }} resizeMode="contain" />
      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, marginTop: spacing.md }}>{COMPANY_NAME}</Text>
      <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2, marginBottom: spacing.lg, textAlign: 'center' }}>
        ¿Cómo vas a ingresar?
      </Text>
      <View style={{ width: '100%', maxWidth: 380 }}>
        {boton('🔓', 'INICIAR SESIÓN', 'Entra con tu usuario y contraseña', onLogin)}
        {boton('🚜', 'Operadores', 'Escanea tu carnet para operar la máquina', onOperator)}
      </View>
    </View>
  );
}
