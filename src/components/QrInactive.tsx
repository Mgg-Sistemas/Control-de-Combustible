import React from 'react';
import { View, Image } from 'react-native';

const LOGO = require('../../assets/logo.png');

/**
 * Pantalla de QR DESACTIVADO: se muestra cuando el empleado o la máquina de un
 * código QR ya fue ELIMINADO. Por seguridad no se muestra ningún dato ni ninguna
 * acción: SOLO el logo de la empresa, centrado en toda la pantalla. Tocarlo no
 * hace nada (no manda al login): el QR quedó muerto y así se queda.
 */
export default function QrInactive() {
  return (
    <View style={{ flex: 1, backgroundColor: '#EAF1FB', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Image source={LOGO} style={{ width: '70%', height: undefined, aspectRatio: 1 }} resizeMode="contain" />
    </View>
  );
}
