// Fuente global del sistema: Tahoma en toda la app.
// React Native no tiene "fuente por defecto", así que parcheamos el render de
// Text y TextInput una sola vez para inyectar la familia tipográfica. Como la
// ponemos primero en el arreglo de estilos, cualquier estilo explícito (tamaño,
// peso, color) se conserva; solo se hereda la familia Tahoma.
import React from 'react';
import { Text, TextInput } from 'react-native';

export const FONT_FAMILY = 'Tahoma, Geneva, Verdana, sans-serif';

function applyFont(Component: any) {
  if (!Component || Component.__fontPatched) return;
  const original = Component.render;
  if (typeof original !== 'function') return;
  Component.render = function (...args: any[]) {
    const element = original.apply(this, args);
    if (!element) return element;
    return React.cloneElement(element, {
      style: [{ fontFamily: FONT_FAMILY }, (element.props as any)?.style],
    });
  };
  Component.__fontPatched = true;
}

applyFont(Text);
applyFont(TextInput);
