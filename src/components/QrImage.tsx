import React from 'react';
import { Image } from 'react-native';
import { svgDataUri } from '../lib/qr';

/** Muestra un QR (cadena SVG) en NATIVO mediante <Image> con data-URI. */
export default function QrImage({ svg, size = 240 }: { svg: string; size?: number }) {
  return <Image source={{ uri: svgDataUri(svg) }} style={{ width: size, height: size }} resizeMode="contain" />;
}
