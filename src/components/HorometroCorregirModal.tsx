// ✎ CORREGIR EL HORÓMETRO DE TRABAJO DESDE CONTROL (24-sep-2026).
//
// Decisión del cliente (24-sep-2026): «los admins pueden corregir, y basta el
// motivo escrito» — sin foto. La pantalla lo esconde para quien no tenga el
// módulo `horometros` con escritura (admin = full), pero EL CANDADO REAL ESTÁ
// EN LA BASE: la RPC exige sesión, módulo y motivo; sin ellos, no guarda.
//
// ⭐ SOLO TOCA LA TABLA DEL MODO SOMBRA (`lecturas_horometro_trabajo`). No toca
//    `machine_rounds`, ni horas pagadas, ni el horómetro de mantenimiento: lo
//    que hoy paga y lo que el taller mira siguen exactamente igual.
//
// ⭐ REINICIO: cuando al equipo le CAMBIARON el aparato (arranca en 0), se marca
//    el interruptor y la base deja de exigirle «no menor que la última lectura»
//    a ESA lectura. El motivo escrito queda grabado junto al cambio, y la fila
//    guarda quién corrigió y cuándo (corregido_por / bitácora de auditoría).
import React, { useEffect, useState } from 'react';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LecturaTrabajo, Turno, validarCorreccionHorometro, numeroDeTexto } from '../lib/horometroTrabajo';
import { guardarLecturaHorometro } from '../lib/horometroTrabajoDb';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  code: string;
  machineryId: string;
  roundDate: string; // YYYY-MM-DD
  lecturas: readonly LecturaTrabajo[]; // las de ESA máquina y ESE día (0-2)
  onClose: () => void;
  onSaved: () => void; // para recargar las lecturas de la pantalla
};

const fmt = (n: number | null | undefined) => (n == null ? '' : String(n));

export function HorometroCorregirModal({ code, machineryId, roundDate, lecturas, onClose, onSaved }: Props) {
  const { colors } = useTheme();
  const [turno, setTurno] = useState<Turno>('day');
  const [ini, setIni] = useState('');
  const [fin, setFin] = useState('');
  const [reinicio, setReinicio] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actual = lecturas.find((l) => l.shift === turno) ?? null;

  // Al cambiar de turno se precargan los números REGISTRADOS de ese turno.
  useEffect(() => {
    setIni(fmt(actual?.inicial));
    setFin(fmt(actual?.final));
    setReinicio(actual?.reinicio === true);
    setError(null);
  }, [turno, actual?.inicial, actual?.final, actual?.reinicio]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async () => {
    if (busy) return;
    const malo = validarCorreccionHorometro({ inicial: ini, final: fin, motivo });
    if (malo) { setError(malo); return; }
    setBusy(true); setError(null);
    // Patch COMPLETO de los tres campos: lo que quedó vacío BORRA el número.
    // Origen 'control' siempre (también con reinicio marcado): así la base exige
    // módulo y motivo, y la corrección queda protegida contra pisadas del teléfono.
    const r = await guardarLecturaHorometro(machineryId, roundDate, turno, {
      inicial: numeroDeTexto(ini) === false ? null : (numeroDeTexto(ini) as number | null),
      final: numeroDeTexto(fin) === false ? null : (numeroDeTexto(fin) as number | null),
      reinicio,
      origen: 'control',
      motivoCorreccion: motivo.trim(),
    });
    setBusy(false);
    if (!r.ok) { setError(r.error ?? 'No se guardó. Intenta de nuevo.'); return; }
    onSaved();
    onClose();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const dmy = roundDate.split('-').reverse().join('/');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,15,25,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.md, zIndex: 9999 }}>
        <View style={{ width: '100%', maxWidth: 460, backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>✎ Corregir horómetro de trabajo</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm }}>{code} · {dmy} · solo la lectura del modo sombra: no toca horas pagadas ni mantenimiento.</Text>

          <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
            {(['day', 'night'] as const).map((t) => {
              const on = turno === t;
              return (
                <TouchableOpacity key={t} onPress={() => setTurno(t)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{t === 'day' ? '☀️ Día' : '🌙 Noche'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {actual?.valida === false ? (
            <Text style={{ color: colors.danger, fontSize: 11, marginBottom: spacing.xs }}>⚠️ La lectura actual está marcada mala: {actual.motivoInvalida || 'sin motivo'}.</Text>
          ) : null}
          {actual?.corregidoPor ? (
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>✎ Ya fue corregida antes desde Control.</Text>
          ) : null}

          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Horómetro inicial (vacío = borrar el número)</Text>
          <TextInput value={ini} onChangeText={(t) => setIni(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="—" placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.sm }]} />
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Horómetro final (vacío = borrar el número)</Text>
          <TextInput value={fin} onChangeText={(t) => setFin(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="—" placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.sm }]} />

          <TouchableOpacity onPress={() => setReinicio((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
            <Text style={{ fontSize: 16 }}>{reinicio ? '☑️' : '⬜'}</Text>
            <Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>Le cambiaron el horómetro (reinicio): el número puede ser menor que el de ayer y la base no la marcará mala por eso.</Text>
          </TouchableOpacity>

          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Motivo de la corrección · OBLIGATORIO (queda grabado con tu nombre)</Text>
          <TextInput value={motivo} onChangeText={setMotivo} placeholder="Ej.: foto del tablero llegó tarde; el inspector tecleó 791,9 y era 7.919" placeholderTextColor={colors.muted} multiline style={[input, { minHeight: 54, textAlignVertical: 'top', marginBottom: spacing.sm }]} />

          {error ? <Text style={{ color: colors.danger, fontSize: 12, marginBottom: spacing.sm }}>❌ {error}</Text> : null}

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity onPress={onClose} disabled={busy} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', backgroundColor: colors.surface }}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={guardar} disabled={busy} style={{ flex: 1, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{busy ? 'Guardando…' : '✎ Guardar corrección'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
