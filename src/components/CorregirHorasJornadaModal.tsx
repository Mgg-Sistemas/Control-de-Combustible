// 🕐 CORREGIR LA HORA DE INICIO / FIN DE UNA JORNADA YA FINALIZADA (28-oct-2026).
//
// El inspector corrige, desde el teléfono, el inicio y el fin del tramo que ÉL
// finalizó (hoy o ayer). Las reglas viven en `lib/corregirHorasJornada.ts` (pura,
// con su prueba); acá solo se leen los datos FRESCOS, se valida otra vez y se
// guarda en dos pasos verificados:
//   1) ACTUALIZA el mismo tramo de `machine_work_segments` (inicio, fin, horas y la
//      traza agregada a `notes`). Candado optimista: solo si el tramo sigue con las
//      horas que se leyeron; 0 filas = error visible, nada se pisa.
//   2) Ajusta `machine_rounds` del turno por la DIFERENCIA (tope 0..12) con el RPC
//      atómico de siempre. Si este paso falla, se intenta devolver el tramo a como
//      estaba y se avisa con claridad (qué quedó y qué no).
// Nunca borra filas ni crea tramos. Componente a NIVEL DE MÓDULO (sus TextInput no
// pierden el foco) y se monta al final del árbol de la pantalla.
import React, { useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { getMachineRound, upsertMachineRound } from '../lib/machineRounds';
import { logAudit } from '../lib/audit';
import {
  TramoTurno, Turno, puedeCorregirHoras, validarCorreccionHoras, nuevasHorasRonda,
  trazaCorreccion, notasConTraza, hhmmCaracas,
} from '../lib/corregirHorasJornada';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  code: string;
  machineryId: string;
  roundDate: string; // YYYY-MM-DD (fecha de negocio del tramo)
  tramo: TramoTurno; // el tramo de cierre manual que se va a corregir
  uid: string;
  today: string;
  yesterday: string;
  asignadoEnTurno: boolean;
  onClose: () => void;
  onSaved: (aviso: string) => void;
};

const COLS = 'id, shift, source, started_at, ended_at, hours, recorded_by, notes, close_reason';

export function CorregirHorasJornadaModal({ code, machineryId, roundDate, tramo, uid, today, yesterday, asignadoEnTurno, onClose, onSaved }: Props) {
  const { colors } = useTheme();
  const shift: Turno = tramo.shift === 'night' ? 'night' : 'day';
  const [ini, setIni] = useState(hhmmCaracas(new Date(tramo.started_at).getTime()));
  const [fin, setFin] = useState(hhmmCaracas(new Date(tramo.ended_at).getTime()));
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vista previa con lo que la pantalla ya tiene (el guardado vuelve a leer todo).
  const previa = validarCorreccionHoras({ roundDate, shift, inicioTexto: ini, finTexto: fin, motivo: motivo || '·', tramo, tramosDelTurno: [tramo] });

  const guardar = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      // 1. Datos FRESCOS: el tramo y todos los del turno (otro pudo tocarlos).
      const { data: segs, error: segErr } = await supabase.from('machine_work_segments').select(COLS)
        .eq('machinery_id', machineryId).eq('round_date', roundDate).eq('shift', shift);
      if (segErr) { setError('No se pudieron leer los tramos: ' + segErr.message); return; }
      const delTurno = (segs ?? []) as TramoTurno[];
      const actual = delTurno.find((s) => s.id === tramo.id);
      if (!actual) { setError('Ese tramo ya no existe. Recarga la pantalla.'); return; }
      const perm = puedeCorregirHoras({ tramo: actual, uid, roundDate, today, yesterday, asignadoEnTurno, tramosDelTurno: delTurno });
      if (!perm.ok) { setError(perm.error); return; }
      const v = validarCorreccionHoras({ roundDate, shift, inicioTexto: ini, finTexto: fin, motivo, tramo: actual, tramosDelTurno: delTurno });
      if (!v.ok) { setError(v.error); return; }
      // 2. La ronda del turno: tiene que existir y no tener una jornada ABIERTA en ese turno.
      const ronda: any = await getMachineRound(machineryId, roundDate);
      if (!ronda) { setError('No encontré la jornada de ese día en Control. Pídeselo a Control.'); return; }
      if (ronda.jornada_start_at && (ronda.jornada_shift ?? shift) === shift) { setError('Hay una jornada ABIERTA en ese turno: finalízala primero y luego corrige.'); return; }
      const key = shift === 'night' ? 'night_hours' : 'day_hours';
      const horasRondaAntes = Number(ronda[key] ?? 0);
      const nr = nuevasHorasRonda(horasRondaAntes, v.diferencia);
      if (!nr.ok) { setError(nr.error); return; }
      // 3. ACTUALIZA el mismo tramo (candado: solo si sigue como se leyó).
      const traza = trazaCorreccion({ nowMs: Date.now(), tramo: actual, motivo });
      const nuevoIni = new Date(v.startMs).toISOString();
      const nuevoFin = new Date(v.endMs).toISOString();
      const { data: upd, error: updErr } = await supabase.from('machine_work_segments')
        .update({ started_at: nuevoIni, ended_at: nuevoFin, hours: v.horasNuevas, notes: notasConTraza(actual.notes, traza) })
        .eq('id', actual.id).eq('started_at', actual.started_at).eq('ended_at', actual.ended_at)
        .select('id');
      if (updErr) { setError('No se guardó la corrección: ' + updErr.message); return; }
      if (!upd || upd.length !== 1) { setError('No se guardó: el tramo cambió mientras corregías o no tienes permiso (0 filas). Recarga e intenta de nuevo.'); return; }
      // 4. Ronda del turno por la DIFERENCIA.
      if (nr.horas !== horasRondaAntes) {
        const res = await upsertMachineRound(machineryId, roundDate, { [key]: nr.horas } as any, uid || null);
        if (res.error || !res.data) {
          // Devolver el tramo a como estaba, para que tramo y ronda no se descuadren.
          const { data: rev } = await supabase.from('machine_work_segments')
            .update({ started_at: actual.started_at, ended_at: actual.ended_at, hours: actual.hours, notes: actual.notes ?? null })
            .eq('id', actual.id).eq('started_at', nuevoIni).eq('ended_at', nuevoFin)
            .select('id');
          const deshecho = !!rev && rev.length === 1;
          setError(deshecho
            ? `No se pudieron ajustar las horas de Control (${res.error ?? 'sin respuesta'}). La corrección se DESHIZO: nada cambió. Intenta de nuevo.`
            : `⚠️ La hora del tramo SÍ se cambió, pero las horas de Control NO se ajustaron (${res.error ?? 'sin respuesta'}) y no se pudo deshacer. Avísale a Control: ${code}, ${roundDate.split('-').reverse().join('/')}, turno ${shift === 'night' ? 'noche' : 'día'}, diferencia ${v.diferencia > 0 ? '+' : ''}${v.diferencia} h.`);
          return;
        }
      }
      logAudit('JORNADA_FIN', 'machinery', machineryId, `${code} · ✏️ hora corregida por el inspector (${roundDate}, ${shift === 'night' ? 'noche' : 'día'}): ${hhmmCaracas(new Date(actual.started_at).getTime())}–${hhmmCaracas(new Date(actual.ended_at).getTime())} (${Number(actual.hours)} h) → ${ini.trim()}–${fin.trim()} (${v.horasNuevas} h) · turno ${horasRondaAntes} h → ${nr.horas} h · Motivo: ${motivo.trim()}`);
      onSaved(`🕐 Horas corregidas: ${ini.trim()}–${fin.trim()} (${v.horasNuevas.toFixed(2)} h). Turno en Control: ${horasRondaAntes.toFixed(2)} h → ${nr.horas.toFixed(2)} h. Queda con tu nombre y tu motivo.`);
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
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>🕐 Corregir hora de inicio / fin</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm }}>
              {code} · {dmy} · {shift === 'night' ? '🌙 noche' : '☀️ día'} ({rango}). Registrado: {hhmmCaracas(new Date(tramo.started_at).getTime())}–{hhmmCaracas(new Date(tramo.ended_at).getTime())} ({Number(tramo.hours).toFixed(2)} h). Queda con tu nombre y tu motivo.
            </Text>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Hora de inicio</Text>
                <TextInput value={ini} onChangeText={setIni} placeholder="07:30" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} style={[input, { marginBottom: 6 }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Hora de fin</Text>
                <TextInput value={fin} onChangeText={setFin} placeholder="17:00" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} style={[input, { marginBottom: 6 }]} />
              </View>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>Escríbelas como HH:MM (24 h, hora de Caracas), dentro del turno. Máximo 12 h, sin pisar paradas ni otros tramos.</Text>

            {previa.ok ? (
              <Text style={{ color: colors.text, fontSize: 12, marginBottom: spacing.sm }}>
                Con esas horas: <Text style={{ fontWeight: '900' }}>{previa.horasNuevas.toFixed(2)} h</Text> ({previa.diferencia > 0 ? '+' : ''}{previa.diferencia.toFixed(2)} h al turno en Control)
              </Text>
            ) : (ini.trim() && fin.trim() ? <Text style={{ color: colors.danger, fontSize: 12, marginBottom: spacing.sm }}>⚠️ {previa.error}</Text> : null)}

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
