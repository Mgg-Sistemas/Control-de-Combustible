import React from 'react';

/**
 * Muestra un QR (cadena SVG) en WEB inyectando el SVG directo en el DOM
 * (react-native-web corre sobre react-dom). Así el QR se ve nítido en la
 * vista previa, sin depender de data-URI en <Image>.
 */
export default function QrImage({ svg, size = 240 }: { svg: string; size?: number }) {
  // Fuerza que el SVG llene el contenedor.
  const html = svg
    .replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1')
    .replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1')
    .replace(/<svg /, '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" ');
  return <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: html }} />;
}
