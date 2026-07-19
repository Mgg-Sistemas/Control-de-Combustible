import React from 'react';
import { View } from 'react-native';

/**
 * Ícono de "ojo" dibujado con vistas nativas (sin dependencias ni emojis).
 * `open`: ojo abierto (mostrar) / con línea diagonal = oculto.
 */
export function EyeIcon({ size = 20, color = '#333', open = true }: { size?: number; color?: string; open?: boolean }) {
  const stroke = Math.max(1.6, size * 0.09);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size,
          height: size * 0.66,
          borderWidth: stroke,
          borderColor: color,
          borderRadius: size * 0.5,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: size * 0.3, height: size * 0.3, borderRadius: size * 0.15, backgroundColor: color }} />
      </View>
      {!open ? (
        <View
          style={{
            position: 'absolute',
            width: size * 1.18,
            height: stroke,
            backgroundColor: color,
            borderRadius: stroke,
            transform: [{ rotate: '45deg' }],
          }}
        />
      ) : null}
    </View>
  );
}

export default EyeIcon;
