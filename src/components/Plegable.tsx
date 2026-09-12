// TARJETA QUE SE PLIEGA (12-sep-2026).
//
// Pedido del cliente para el panel de Viajes de camiones: que cada apartado sea
// un desplegable, como quedó el de «Obras y ubicaciones». El panel tenía cuatro
// bloques largos uno detrás de otro y llegar al de abajo era medio minuto de
// rueda del ratón; en el teléfono, peor.
//
// ⚠️ PLEGADO NO ES ESCONDIDO. El encabezado sigue diciendo QUÉ HAY DENTRO —un
//    conteo, un aviso— para que no haya que abrir las cuatro tarjetas a ver cuál
//    tiene lo que se busca. Un desplegable que no dice nada mientras está
//    cerrado convierte una lista larga en una búsqueda a ciegas, que es peor.
//
// ⚠️ Y NO GUARDA NADA. El estado vive en la pantalla mientras está abierta: al
//    salir y volver, cada tarjeta arranca como la dejó su `abiertaPorDefecto`.
//    Es a propósito: recordar el pliegue por dispositivo se va de las manos en
//    cuanto alguien abre el panel en otro teléfono y no entiende por qué lo ve
//    distinto.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Card } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme';

type Props = {
  /** Lo que va en la cabecera. Va tal cual, con su emoji si lo lleva. */
  titulo: string;
  /**
   * Lo que se ve SIN abrir: el conteo, el aviso, lo que haga falta para saber si
   * vale la pena abrirla. Cuando es un número, dilo con su unidad («3 camión(es)»)
   * y no pelado, que a solas no se sabe de qué es.
   */
  resumen?: string | null;
  /** Pinta el resumen como advertencia. Para cuando hay algo que atender. */
  alerta?: boolean;
  abiertaPorDefecto?: boolean;
  children: React.ReactNode;
};

export function Plegable({ titulo, resumen, alerta, abiertaPorDefecto = false, children }: Props) {
  const { colors } = useTheme();
  const [abierta, setAbierta] = useState(abiertaPorDefecto);

  return (
    <Card>
      <TouchableOpacity
        onPress={() => setAbierta((v) => !v)}
        activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{titulo}</Text>
          {resumen ? (
            <Text style={{ color: alerta ? colors.warning : colors.muted, fontSize: 12, fontWeight: alerta ? '800' : '400', marginTop: 2 }}>
              {resumen}
            </Text>
          ) : null}
        </View>
        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15 }}>{abierta ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {abierta ? <View style={{ marginTop: spacing.sm }}>{children}</View> : null}
    </Card>
  );
}
