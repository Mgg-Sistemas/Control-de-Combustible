// 🕐 CORREGIR LA HORA DE INICIO DE UNA JORNADA QUE SIGUE ABIERTA (28-oct-2026).
//
// El inspector se equivocó al tocar «Iniciar» y la jornada sigue EN CURSO. Las
// reglas viven en `lib/corregirHorasJornada.ts` (`puedeCorregirInicioAbierta` y
// `validarCorreccionInicioAbierta`, puras, con su prueba); acá solo se leen los
// datos FRESCOS, se valida otra vez y se guarda UNA sola cosa:
//   · `machine_rounds.jornada_start_at` (y la traza AGREGADA a `notes`), con
//     candado: solo si la ronda sigue con el MISMO inicio que se leyó. 0 filas =
//     error visible, nada se pisa.
// NO se toca `jornada_marked_at` (hora REAL del toque, la usa la reactivación), ni
// las horas bancadas, ni los tramos, ni las paradas. Las horas en vivo y el
// FINALIZAR salen del inicio guardado: la pantalla recibe el nuevo en `onSaved`.
// Componente a NIVEL DE MÓDULO (sus TextInput no pierden el foco) y se monta al
// final del árbol de la pantalla (en web gana el último modal montado).
import React, { useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { businessRoundDateOf } from '../lib/caracasDay';
import {
  TramoTurno, Turno, MarcaAveria, puedeCorregirInicioAbierta, validarCorreccionInicioAbierta,
  trazaInicioAbierta, notasConTraza, hhmmCaracas, ventanaTurno,
} from '../lib/corregirHorasJornada';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  code: string;
  machineryId: string;
  shift: Turno;
  /** `jornada_start_at` que la pantalla tiene en memoria (el que se ve «desde HH:MM»). */
  inicioActual: string;
  today: string;
  yesterday: string;
  asignadoEnTurno: boolean;
  onClose: () => void;
  /** Se llama con el inicio NUEVO ya guardado: la pantalla lo pone en su estado
   *  (de ahí salen las horas en vivo y el FINALIZAR) y recarga lo demás. */
  onSaved: (nuevoInicioIso: string, aviso: string) => void;
};

const COLS = 'id, shift, source, started_at, ended_at, hours, recorded_by, notes, close_reason';

export function CorregirInicioJornadaAbiertaModal({ code, machineryId, shift, inicioActual, today, yesterday, asignadoEnTurno, onClose, onSaved }: Props) {
  const { colors } = useTheme();
  const [ini, setIni] = useState(hhmmCaracas(new Date(inicioActual).getTime()));
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fecha de NEGOCIO de la jornada: la MISMA cuenta que usa el FINALIZAR.
  const roundDate = businessRoundDateOf(new Date(inicioActual), shift);

  // Vista previa con lo que la pantalla ya tiene (el guardado vuelve a leer todo).
  const previa = validarCorreccionInicioAbierta({ roundDate, shift, inicioActualIso: inicioActual, inicioTexto: ini, motivo: motivo || '·', tramosDelTurno: [], marcas: [] });

  const guardar = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      // 1. La ronda FRESCA: tiene que seguir abierta, en el mismo turno y con el MISMO inicio.
      const { data: ronda, error: rErr } = await supabase.from('machine_rounds')
        .select('id, jornada_start_at, jornada_shift, notes')
        .eq('machinery_id', machineryId).eq('round_date', roundDate).eq('round_no', 1)
        .maybeSingle();
      if (rErr) { setError('No se pudo leer la jornada: ' + rErr.message); return; }
      const r: any = ronda;
      const perm = puedeCorregirInicioAbierta({ abierta: !!r?.jornada_start_at, roundDate, today, yesterday, asignadoEnTurno });
      if (!perm.ok) { setError(perm.error); return; }
      if ((r.jornada_shift ?? shift) !== shift) { setError('La jornada abierta cambió de turno mientras corregías. Recarga la pantalla.'); return; }
      if (new Date(r.jornada_start_at).getTime() !== new Date(inicioActual).getTime()) {
        setError(`No se guardó: el inicio de la jornada cambió mientras corregías (ahora dice ${hhmmCaracas(new Date(r.jornada_start_at).getTime())}). Recarga e intenta de nuevo.`);
        return;
      }
      // 2. Tramos ya cerrados del turno y averías/paradas de la máquina alrededor del turno.
      const anteriorMs = new Date(r.jornada_start_at).getTime();
      const v = ventanaTurno(roundDate, shift);
      const desde = new Date(Math.min(v.inicioMs, anteriorMs)).toISOString();
      const hasta = new Date(Math.max(v.finMs, anteriorMs) + 60000).toISOString();
      const [segs, marcas] = await Promise.all([
        supabase.from('machine_work_segments').select(COLS).eq('machinery_id', machineryId).eq('round_date', roundDate).eq('shift', shift),
        supabase.from('maintenance_requests').select('id, material, status, created_at').eq('machinery_id', machineryId).gte('created_at', desde).lt('created_at', hasta),
      ]);
      if (segs.error) { setError('No se pudieron leer los tramos del turno: ' + segs.error.message); return; }
      if (marcas.error) { setError('No se pudieron leer las averías/paradas: ' + marcas.error.message); return; }
      const val = validarCorreccionInicioAbierta({
        roundDate, shift, inicioActualIso: r.jornada_start_at, inicioTexto: ini, motivo,
        tramosDelTurno: (segs.data ?? []) as TramoTurno[], marcas: (marcas.data ?? []) as MarcaAveria[],
      });
      if (!val.ok) { setError(val.error); return; }
      // 3. ACTUALIZA solo el inicio (+ la traza en notas), con candado sobre el inicio leído.
      const nuevoIso = new Date(val.startMs).toISOString();
      const traza = trazaInicioAbierta({ nowMs: Date.now(), anteriorMs, nuevoMs: val.startMs, motivo });
      const { data: upd, error: updErr } = await supabase.from('machine_rounds')
        .update({ jornada_start_at: nuevoIso, notes: notasConTraza(r.notes, traza) })
        .eq('id', r.id).eq('jornada_start_at', r.jornada_start_at)
        .select('id');
      if (updErr) { setError('No se guardó la corrección: ' + updErr.message); return; }
      if (!upd || upd.length !== 1) { setError('No se guardó: la jornada cambió mientras corregías o no tienes permiso (0 filas). Recarga e intenta de nuevo.'); return; }
      const antes = hhmmCaracas(anteriorMs);
      const despues = hhmmCaracas(val.startMs);
      logAudit('JORNADA_INICIO', 'machinery', machineryId, `${code} · ✏️ inicio corregido por el inspector con la jornada ABIERTA (${roundDate}, ${shift === 'night' ? 'noche' : 'día'}): ${antes} → ${despues} (${val.diferenciaMin > 0 ? '+' : ''}${val.diferenciaMin} min) · Motivo: ${motivo.trim()}`);
      onSaved(nuevoIso, `🕐 Inicio corregido: ${antes} → ${despues}. La jornada sigue abierta y cuenta desde las ${despues}. Queda con tu nombre y tu motivo.`);
      onClose();
    } catch (e: any) {
      setError('No se guardó: ' + (e?.message ?? 'error de red'));
    } finally {
      setBusy(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const dmy = roundDate.split('-').reverse().join('/');
  const rango = shift === 'night' ? '19:00 a 07:00 del día siguiente' : '07:00 a 19:00';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,15,25,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.md, zIndex: 9999 }}>
        <View style={{ width: '100%', maxWidth: 460, maxHeight: '90%', backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>🕐 Corregir hora de inicio</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm }}>
              {code} · {dmy} · {shift === 'night' ? '🌙 noche' : '☀️ día'} ({rango}). Jornada EN CURSO desde las {hhmmCaracas(new Date(inicioActual).getTime())}. Solo cambia la hora de inicio; la jornada sigue abierta. Queda con tu nombre y tu motivo.
            </Text>

            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Hora real de inicio</Text>
            <TextInput value={ini} onChangeText={(t) => setIni(t.replace(/[^0-9:]/g, '').slice(0, 5))} placeholder="07:30" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" autoCapitalize="none" autoCorrect={false} style={[input, { marginBottom: 6 }]} />
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>Escríbela como HH:MM (24 h, hora de Caracas), dentro del turno y no en el futuro. No puede quedar antes del fin de otro tramo del turno ni cruzar una parada/avería marcada.</Text>

            {previa.ok ? (
              <Text style={{ color: colors.text, fontSize: 12, marginBottom: spacing.sm }}>
                La jornada contará desde las <Text style={{ fontWeight: '900' }}>{hhmmCaracas(previa.startMs)}</Text> ({previa.diferenciaMin > 0 ? `${previa.diferenciaMin} min más tarde` : `${-previa.diferenciaMin} min antes`}).
              </Text>
            ) : (ini.trim() && ini.trim() !== hhmmCaracas(new Date(inicioActual).getTime()) ? <Text style={{ color: colors.danger, fontSize: 12, marginBottom: spacing.sm }}>⚠️ {previa.error}</Text> : null)}

            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Motivo de la corrección · OBLIGATORIO (queda grabado con tu nombre)</Text>
            <TextInput value={motivo} onChangeText={setMotivo} placeholder="Ej.: la máquina arrancó a las 7:30, marqué tarde" placeholderTextColor={colors.muted} multiline style={[input, { minHeight: 54, textAlignVertical: 'top', marginBottom: spacing.sm }]} />

            {error ? <Text style={{ color: colors.danger, fontSize: 12, marginBottom: spacing.sm }}>❌ {error}</Text> : null}

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity onPress={onClose} disabled={busy} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', backgroundColor: colors.surface }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardar} disabled={busy} style={{ flex: 1, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>{busy ? 'Guardando…' : '🕐 Guardar'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
