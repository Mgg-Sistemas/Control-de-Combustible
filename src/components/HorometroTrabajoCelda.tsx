// HORÓMETRO DE TRABAJO — celda de SOLO LECTURA («modo sombra», 23-sep-2026).
//
// Pinta, debajo de las horas de Día/Noche de una máquina y un día en Control, cuántas
// horas dice el horómetro de trabajo (final − inicial por turno). NO paga, NO edita, NO
// toca `upsertRound`: es para que Control VEA si el aparato cuadra con la jornada antes
// de encender el modo horómetro en esa máquina. Recibe las lecturas de UNA máquina y UN
// día (0, 1 o 2 filas: day/night). La regla de horas vive en src/lib/horometroTrabajo.ts.
import React from 'react';
import { Text, View } from 'react-native';
import { LecturaTrabajo, Turno, horasDeLectura } from '../lib/horometroTrabajo';
import type { AppColors } from '../theme';

type Props = {
  lecturas: readonly LecturaTrabajo[];
  colors: Pick<AppColors, 'text' | 'muted' | 'danger'>;
};

/** Horas con coma decimal y sin ceros de sobra («8,2», «12»). */
const fmtH = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

export function HorometroTrabajoCelda({ lecturas, colors }: Props) {
  const del = (lecturas ?? []).filter(Boolean);
  const porTurno = (t: Turno) => del.find((l) => l.shift === t) ?? null;
  const dia = porTurno('day');
  const noche = porTurno('night');
  const hDia = dia ? horasDeLectura(dia) : null;
  const hNoche = noche ? horasDeLectura(noche) : null;
  const invalida = del.find((l) => l.valida === false) ?? null;
  const corregida = del.some((l) => l.corregidoPor != null);

  let texto: string;
  if (hDia != null && hNoche != null) texto = `⚙️ ${fmtH(hDia + hNoche)} h`;
  else if (hDia != null || hNoche != null) texto = `⚙️ ${hDia != null ? fmtH(hDia) : '—'} ☀️ · ${hNoche != null ? fmtH(hNoche) : '—'} 🌙`;
  else texto = '⚙️ —';
  if (invalida) texto = `⚠️ ${texto}`;
  if (corregida) texto = `${texto} ✎`;

  const color = invalida ? colors.danger : hDia != null || hNoche != null ? colors.text : colors.muted;
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={{ color, fontSize: 11, fontWeight: invalida ? '700' : '600', fontVariant: ['tabular-nums'] as any }}>{texto}</Text>
      {invalida?.motivoInvalida ? (
        <Text style={{ color: colors.danger, fontSize: 10 }}>{invalida.motivoInvalida}</Text>
      ) : null}
    </View>
  );
}

export default HorometroTrabajoCelda;
