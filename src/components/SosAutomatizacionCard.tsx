// EL CHECK DE LA AUTOMATIZACIÓN DEL INSPECTOR SOS (21-sep-2026). Solo administradores.
//
// Va en Inspecciones. Quien no es admin NO la ve: la tarjeta pregunta el rol, y además
// la base no le devuelve la fila (las dos barreras; la que manda es la de la base).
//
// ⚠️ APAGAR PIDE DOS TOQUES. Con la automatización apagada, las 72 máquinas del SOS
//    dejan de sumar horas solas, y esas horas son lo que se le paga a las empresas. No
//    puede pasar de un roce. Encender es de un toque: volver a lo de siempre no asusta.
//
// Qué apaga y qué no, en src/lib/sosAutomatizacion.ts.
import React, { useCallback, useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Card } from './ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { EstadoSosAuto, cambiarSosAutomatizacion, leerSosAutomatizacion } from '../lib/sosAutomatizacion';

const cuando = (iso: string | null) => {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
  } catch { return ''; }
};

export function SosAutomatizacionCard() {
  const { colors } = useTheme();
  const { role, session, fullName } = useAuth();
  const esAdmin = role === 'admin';
  const [estado, setEstado] = useState<EstadoSosAuto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarApagar, setConfirmarApagar] = useState(false);

  const cargar = useCallback(async () => {
    if (!esAdmin) return;
    try {
      setEstado(await leerSosAutomatizacion());
      setError(null);
    } catch (e: any) {
      setError(`No se pudo leer el interruptor (${e?.message ?? 'revisa la conexión'}).`);
    }
  }, [esAdmin]);

  useEffect(() => { cargar(); }, [cargar]);

  // Ni admin, ni fila visible (o falta el SQL): no hay tarjeta.
  if (!esAdmin || (!estado && !error)) return null;

  const cambiar = async (activa: boolean) => {
    setAviso(null);
    if (!activa && !confirmarApagar) {
      setConfirmarApagar(true);
      setAviso('⚠️ Con esto apagado, las máquinas asignadas al Inspector SOS dejan de iniciar jornada y de sumar horas por su cuenta: solo contarán las que una persona inicie. Toca «Apagar» de nuevo para confirmar.');
      return;
    }
    setConfirmarApagar(false);
    setOcupado(true);
    const r = await cambiarSosAutomatizacion(activa, { id: session?.user?.id ?? null, nombre: fullName ?? null });
    setOcupado(false);
    if (r.error) { setAviso(`❌ ${r.error}`); return; }
    setAviso(activa
      ? '✅ Automatización ENCENDIDA. Desde el próximo ciclo (máximo 10 minutos) las máquinas del SOS vuelven a iniciar y sumar horas solas.'
      : '✅ Automatización APAGADA. Las jornadas que ya estaban abiertas se cierran normal; no se abre ninguna nueva ni se llenan horas hasta que la enciendas.');
    await cargar();
  };

  const activa = estado?.activa !== false;
  const boton = (label: string, onPress: () => void, fondo: string, on: boolean) => (
    <TouchableOpacity onPress={onPress} disabled={ocupado || on}
      style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: on ? fondo : colors.border, backgroundColor: on ? fondo : colors.surface, opacity: ocupado ? 0.6 : 1 }}>
      <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Card>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
        🤖 Automatización del Inspector SOS <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 11 }}>· solo administradores</Text>
      </Text>
      {error ? (
        <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>⚠️ {error}</Text>
      ) : (
        <>
          <Text style={{ color: activa ? colors.success : colors.warning, fontWeight: '800', fontSize: 13, marginTop: 4 }}>
            {activa ? '🟢 ENCENDIDA — sus máquinas inician jornada y suman horas solas' : '⏸️ APAGADA — sus máquinas NO suman horas solas'}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
            El Inspector SOS no es una persona: es el usuario del sistema que cubre las máquinas sin inspector. Esto enciende o apaga
            los procesos que les inician la jornada (7am y 7pm) y les llenan el turno. No cambia que salgan como «trabajando», ni
            el cierre de las jornadas ya abiertas.
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
            {boton('🟢 Encendida', () => cambiar(true), colors.success, activa)}
            {boton(confirmarApagar ? '⏸️ Apagar · confirmar' : '⏸️ Apagar', () => cambiar(false), colors.warning, !activa)}
          </View>
          {estado?.cambiadoPor ? (
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
              Último cambio: {estado.cambiadoPor}{cuando(estado.cambiadoAt) ? ` · ${cuando(estado.cambiadoAt)}` : ''}
            </Text>
          ) : null}
        </>
      )}
      {aviso ? (
        <TouchableOpacity onPress={() => { setAviso(null); setConfirmarApagar(false); }}>
          <Text style={{ color: aviso.startsWith('❌') ? colors.danger : aviso.startsWith('⚠️') ? colors.warning : colors.success, fontSize: 12, marginTop: spacing.xs }}>{aviso}</Text>
        </TouchableOpacity>
      ) : null}
    </Card>
  );
}
