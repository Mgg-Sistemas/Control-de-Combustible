// 🔁 CAMBIO DE HORÓMETRO COMPLETO — desde Control de Horómetros (10-oct-2026).
//
// Pedido del cliente: «cuando un horómetro está malo se coloca uno nuevo que
// comience de 0; poder sumarle o restarle horas por si durante el cambio se
// perdió una hora; que el acumulado siga su secuencia; que el reporte diga que
// hubo cambio de horómetro; y poder subir fotos si las tengo (opcional)».
//
// QUÉ HACE AL GUARDAR (dos escrituras, las dos con rastro):
//   1. La LECTURA del día queda con el aparato NUEVO y la marca `reinicio`:
//      sienta base nueva y la base NO la marca «menor que la última lectura
//      válida». Va con origen 'control' (la base protege lecturas ya corregidas
//      contra otros orígenes) y motivo obligatorio.
//   2. El REGISTRO del cambio en `horometro_cambios`: lectura final del viejo,
//      inicial del nuevo, ± horas reconocidas, motivo y fotos. Las ± horas
//      suman o restan al pago de ESE día con el precio que regía, y el reporte
//      ⚙️ Horómetro dice «Cambio de horómetro» como causa.
//
// Las fotos son OPCIONALES: cámara o galería (regla de la casa), van al bucket
// de siempre y además quedan en el histórico de fotos del horómetro (salen en
// la galería del reporte, con tu nombre y la hora).
import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { DateField } from './DateField';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useAuth } from '../context/AuthContext';
import { LecturaTrabajo, numeroDeTexto, soloHorometro } from '../lib/horometroTrabajo';
import { guardarLecturaHorometro } from '../lib/horometroTrabajoDb';
import { CambioHorometro, validarCambioHorometro } from '../lib/pagoHorometro';
import { anularCambioHorometro, crearCambioHorometro } from '../lib/pagoHorometroDb';
import { takePhotoAndUpload, pickPhotoFromGalleryAndUpload } from '../lib/photo';
import { agregarFotoHorometro } from '../lib/horometroFotosDb';

type Props = {
  code: string;
  machineryId: string;
  /** El día con el que abre (se puede cambiar dentro). */
  roundDate: string;
  /** Las lecturas del inspector de ESA máquina en el rango cargado. */
  lecturas: readonly LecturaTrabajo[];
  /** Los cambios de horómetro de ESA máquina en el rango cargado. */
  cambios: readonly CambioHorometro[];
  onClose: () => void;
  onSaved: (mensaje: string) => void;
};

const dmy = (iso: string) => String(iso ?? '').slice(0, 10).split('-').reverse().join('/');

export function HorometroCambioModal({ code, machineryId, roundDate, lecturas, cambios, onClose, onSaved }: Props) {
  const { colors } = useTheme();
  const { session, fullName } = useAuth();
  const [fecha, setFecha] = useState(roundDate);
  const [turno, setTurno] = useState<'day' | 'night'>('day');
  const [vieja, setVieja] = useState('');
  const [nuevaIni, setNuevaIni] = useState('0');
  const [nuevaFin, setNuevaFin] = useState('');
  const [signo, setSigno] = useState<1 | -1>(1);
  const [horasTxt, setHorasTxt] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fotoVieja, setFotoVieja] = useState<string | null>(null);
  const [fotoNueva, setFotoNueva] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);

  const delInspector = useMemo(
    () => lecturas.find((l) => String(l.roundDate).slice(0, 10) === fecha && l.shift === turno) ?? null,
    [lecturas, fecha, turno],
  );
  const activos = useMemo(
    () => cambios.filter((c) => !c.anulada_at).sort((a, b) => String(b.round_date).localeCompare(String(a.round_date))),
    [cambios],
  );

  const numDe = (t: string): number | null => {
    const n = numeroDeTexto(t);
    return n === false || n == null ? null : (n as number);
  };

  const subirFoto = async (cual: 'vieja' | 'nueva', via: 'cam' | 'gal') => {
    if (busy) return;
    setBusy(`${cual}-${via}`); setError(null);
    try {
      const r = via === 'cam'
        ? await takePhotoAndUpload(machineryId, 'horometro')
        : await pickPhotoFromGalleryAndUpload(machineryId, 'horometro');
      if (!r.ok || !r.url) { if (r.error) setError(r.error); return; }
      if (cual === 'vieja') setFotoVieja(r.url); else setFotoNueva(r.url);
    } finally {
      setBusy(null);
    }
  };

  const guardar = async () => {
    if (busy) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { setError('Elige el día del cambio.'); return; }
    const nIni = numDe(nuevaIni);
    const nFin = nuevaFin.trim() ? numDe(nuevaFin) : null;
    const horas = (numDe(horasTxt) ?? 0) * signo;
    const malo = validarCambioHorometro({ nuevaInicial: nIni, nuevaFinal: nFin, horasAjuste: horas, motivo });
    if (malo) { setError(malo); return; }
    setError(null); setBusy('guardar');
    try {
      // 1) La lectura del día: el aparato NUEVO sienta base (reinicio).
      const r1 = await guardarLecturaHorometro(machineryId, fecha, turno, {
        inicial: nIni,
        ...(nFin != null ? { final: nFin } : {}),
        origen: 'control',
        reinicio: true,
        motivoCorreccion: `Cambio de horómetro: ${motivo.trim()}`,
      });
      if (!r1.ok) { setError(r1.error ?? 'No se pudo escribir la lectura del día. Intenta de nuevo.'); return; }
      // 2) El registro del cambio, con sus ± horas y sus fotos.
      const r2 = await crearCambioHorometro({
        machineryId, roundDate: fecha, shift: turno,
        lecturaVieja: vieja.trim() ? numDe(vieja) : null,
        lecturaNueva: nIni as number, horasAjuste: horas, motivo: motivo.trim(),
        fotoViejaUrl: fotoVieja, fotoNuevaUrl: fotoNueva,
      });
      if (r2.error) { setError(`La lectura quedó guardada, pero el registro del cambio no: ${r2.error}`); return; }
      // 3) Las fotos también al histórico del horómetro (salen en el reporte).
      //    Si esto falla no se daña nada: el cambio ya quedó con sus URLs.
      for (const url of [fotoVieja, fotoNueva]) {
        if (!url) continue;
        try {
          await agregarFotoHorometro({ machineryId, roundDate: fecha, shift: turno, url, userId: session?.user?.id ?? null, userName: fullName || null });
        } catch { /* la galería es un extra: el registro del cambio ya tiene la foto */ }
      }
      onSaved(`🔁 Cambio de horómetro guardado para ${code} el ${dmy(fecha)}: el aparato nuevo sienta base${horas ? ` y se reconocieron ${horas > 0 ? '+' : ''}${horas} h` : ''}. El reporte ⚙️ Horómetro lo dirá como «Cambio de horómetro».`);
      onClose();
    } finally {
      setBusy(null);
    }
  };

  const anular = async (c: CambioHorometro) => {
    if (busy) return;
    if (anulando !== c.id) { setAnulando(c.id); setError('Escribe el motivo abajo y toca otra vez ↺ Anular.'); return; }
    const m = motivo.trim();
    if (!m) { setError('Escribe en el campo Motivo por qué se anula ese cambio.'); return; }
    setBusy('anular'); setError(null);
    try {
      const r = await anularCambioHorometro(c.id, m);
      if (r.error) { setError(r.error); return; }
      onSaved(`↺ Cambio de horómetro del ${dmy(c.round_date)} anulado: sus ± horas dejan de contar. La lectura del día no se tocó (corrígela aparte si hace falta).`);
      onClose();
    } finally {
      setBusy(null); setAnulando(null);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const pastilla = (on: boolean) => ({ flex: 1, alignItems: 'center' as const, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface });
  const btnFoto = (label: string, key: string, onPress: () => void) => (
    <TouchableOpacity key={key} onPress={onPress} disabled={!!busy}
      style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>{busy === key ? '…' : label}</Text>
    </TouchableOpacity>
  );
  const filaFoto = (titulo: string, cual: 'vieja' | 'nueva', url: string | null, setUrl: (v: string | null) => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' }}>
      <Text style={{ color: colors.muted, fontSize: 11, flexShrink: 1 }}>{titulo}</Text>
      {btnFoto('📷 Tomar foto', `${cual}-cam`, () => subirFoto(cual, 'cam'))}
      {btnFoto('🖼️ Galería', `${cual}-gal`, () => subirFoto(cual, 'gal'))}
      {url ? (
        <TouchableOpacity onPress={() => setUrl(null)}>
          <Text style={{ color: colors.success, fontWeight: '800', fontSize: 11 }}>✅ subida (toca para quitarla)</Text>
        </TouchableOpacity>
      ) : <Text style={{ color: colors.muted, fontSize: 11 }}>opcional</Text>}
    </View>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,15,25,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.md, zIndex: 9999 }}>
        <View style={{ width: '100%', maxWidth: 520, maxHeight: '92%', backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border }}>
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>🔁 Cambio de horómetro · {code}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm }}>
              Para cuando el aparato se dañó y se instaló uno NUEVO. Sienta base (nada se marca «menor que ayer»),
              la secuencia sigue desde el nuevo, y las ± horas que se perdieron en el cambio se reconocen en el pago
              de ese día. No toca Control de jornadas.
            </Text>

            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Día del cambio (jornada)</Text>
            <DateField value={fecha} onChange={setFecha} />
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginVertical: spacing.sm }}>
              {(['day', 'night'] as const).map((t) => (
                <TouchableOpacity key={t} onPress={() => setTurno(t)} style={pastilla(turno === t)}>
                  <Text style={{ color: turno === t ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{t === 'day' ? '☀️ Día' : '🌙 Noche'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
              Lo que hay cargado ese turno: {delInspector ? `inicial ${delInspector.inicial ?? '—'} · final ${delInspector.final ?? '—'}${delInspector.valida === false ? ` · ⚠️ ${delInspector.motivoInvalida || 'inválida'}` : ''}` : 'nada todavía'}.
              Al guardar, ese turno queda con los números del aparato NUEVO.
            </Text>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Última lectura del aparato VIEJO (opcional)</Text>
                <TextInput value={vieja} onChangeText={(t) => setVieja(soloHorometro(t))} keyboardType="numeric" inputMode="decimal" placeholder="—" placeholderTextColor={colors.muted} style={input} />
              </View>
            </View>
            {filaFoto('Foto del aparato viejo:', 'vieja', fotoVieja, setFotoVieja)}

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>El NUEVO arranca en</Text>
                <TextInput value={nuevaIni} onChangeText={(t) => setNuevaIni(soloHorometro(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Final del nuevo ese día (si ya cerró)</Text>
                <TextInput value={nuevaFin} onChangeText={(t) => setNuevaFin(soloHorometro(t))} keyboardType="numeric" inputMode="decimal" placeholder="—" placeholderTextColor={colors.muted} style={input} />
              </View>
            </View>
            {filaFoto('Foto del aparato nuevo:', 'nueva', fotoNueva, setFotoNueva)}

            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>
              Horas a reconocer por el cambio (opcional): lo trabajado que el aparato nuevo no marcó
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
              <TouchableOpacity onPress={() => setSigno(1)} style={pastilla(signo === 1)}>
                <Text style={{ color: signo === 1 ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>➕ Sumar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSigno(-1)} style={pastilla(signo === -1)}>
                <Text style={{ color: signo === -1 ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>➖ Restar</Text>
              </TouchableOpacity>
              <TextInput value={horasTxt} onChangeText={(t) => setHorasTxt(soloHorometro(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={[input, { flex: 1 }]} />
              <Text style={{ color: colors.muted, fontSize: 12 }}>h</Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 2 }}>
              Se suman (o restan) a las horas de ESE día en el pago por horómetro, con el precio que regía, y el
              reporte las dice como «reconocidas por el cambio». Tope: 24 h.
            </Text>

            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Motivo · OBLIGATORIO (queda grabado con tu nombre)</Text>
            <TextInput value={motivo} onChangeText={setMotivo} placeholder="Ej.: el tablero se dañó y se instaló uno nuevo en 0" placeholderTextColor={colors.muted} multiline style={[input, { minHeight: 50, textAlignVertical: 'top', marginBottom: spacing.sm }]} />

            {error ? <Text style={{ color: colors.danger, fontSize: 12, marginBottom: spacing.sm }}>❌ {error}</Text> : null}

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity onPress={onClose} disabled={!!busy} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', backgroundColor: colors.surface }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardar} disabled={!!busy} style={{ flex: 1, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>{busy === 'guardar' ? 'Guardando…' : '💾 Registrar el cambio'}</Text>
              </TouchableOpacity>
            </View>

            {activos.length ? (
              <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>🕘 Cambios registrados de esta máquina (en el rango)</Text>
                {activos.map((c) => (
                  <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, flex: 1 }}>
                      {dmy(c.round_date)} · {c.shift === 'night' ? '🌙' : '☀️'} · nuevo desde {String(c.lectura_nueva ?? 0)}
                      {Number(c.horas_ajuste) ? ` · ${Number(c.horas_ajuste) > 0 ? '+' : ''}${c.horas_ajuste} h` : ''} — {c.motivo}
                      {c.created_by_nombre ? ` (${c.created_by_nombre})` : ''}
                    </Text>
                    <TouchableOpacity onPress={() => anular(c)} disabled={!!busy}>
                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>{anulando === c.id ? '↺ ¿Anular? (con el motivo)' : '↺ Anular'}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
