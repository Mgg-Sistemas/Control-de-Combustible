import React from 'react';
import { View, Image, Text, TouchableOpacity } from 'react-native';

const LOGO = require('../../assets/logo.png');

/**
 * Pantalla de QR DESACTIVADO: se muestra cuando el QR apunta a algo que NO debe
 * abrir el sistema — máquina/empleado ELIMINADO, o una máquina RETIRADA
 * (operational=false). Por seguridad no se muestra ningún dato ni ninguna acción:
 * SOLO el logo de la empresa, centrado.
 *
 * `onBack` (opcional): si se pasa, se muestra un botón "← Volver" para regresar
 * (p. ej. el inspector que escaneó una retirada desde el teléfono vuelve a su
 * vista). Si NO se pasa (QR público sin pila de navegación), queda solo el logo,
 * como antes.
 */
export default function QrInactive({ onBack }: { onBack?: () => void } = {}) {
  return (
    <View style={{ flex: 1, backgroundColor: '#EAF1FB', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Image source={LOGO} style={{ width: '70%', height: undefined, aspectRatio: 1 }} resizeMode="contain" />
      {onBack ? (
        <TouchableOpacity
          onPress={onBack}
          activeOpacity={0.85}
          style={{ marginTop: 28, backgroundColor: '#1D4ED8', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 36 }}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>← Volver</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
