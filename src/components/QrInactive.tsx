import React from 'react';
import { View, Image, TouchableWithoutFeedback } from 'react-native';

const LOGO = require('../../assets/logo.png');

/**
 * Pantalla de QR DESACTIVADO: se muestra cuando el empleado o la máquina de un
 * código QR ya fue ELIMINADO. Por seguridad no se muestra ningún dato: solo el
 * logo de la empresa, centrado en toda la pantalla. Si se pasa `onExit`, tocar
 * la pantalla vuelve al sistema (afordancia invisible, no se ve ningún botón).
 */
export default function QrInactive({ onExit }: { onExit?: () => void }) {
  const content = (
    <View style={{ flex: 1, backgroundColor: '#EAF1FB', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Image source={LOGO} style={{ width: '70%', height: undefined, aspectRatio: 1 }} resizeMode="contain" />
    </View>
  );
  if (onExit) {
    return <TouchableWithoutFeedback onPress={onExit}>{content}</TouchableWithoutFeedback>;
  }
  return content;
}
