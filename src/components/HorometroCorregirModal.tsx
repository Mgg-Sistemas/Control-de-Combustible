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
import { Image, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LecturaTrabajo, Turno, validarCorreccionHorometro, numeroDeTexto, soloHorometro } from '../lib/horometroTrabajo';
import { guardarLecturaHorometro } from '../lib/horometroTrabajoDb';
import { captureAndUploadPhoto, pickPhotoFromGalleryAndUpload } from '../lib/photo';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  code: string;
  machineryId: string;
  roundDate: string; // YYYY-MM-DD
  lecturas: readonly LecturaTrabajo[]; // las de ESA máquina y ESE día (0-2)
  onClose: () => void;
  onSaved: () => void; // para recargar las lecturas de la pantalla
  /**
   * ✏️ MODO INSPECTOR (02-oct-2026, decisión del cliente: «sí»). El inspector
   * corrige LO QUE ÉL CARGÓ: entra con origen `inspector` (la base no le exige
   * módulo, pero sí conserva lo que Control haya corregido —«lo manual manda»—),
   * sin el interruptor de REINICIO (eso es de Control) y con motivo obligatorio,
   * que el reporte muestra como «✎ corregido por el inspector». Por defecto,
   * 'control': el modal de siempre, byte a byte.
   */
  modo?: 'control' | 'inspector';
};

const fmt = (n: number | null | undefined) => (n == null ? '' : String(n));

export function HorometroCorregirModal({ code, machineryId, roundDate, lecturas, onClose, onSaved, modo = 'control' }: Props) {
  const { colors } = useTheme();
  const esInspector = modo === 'inspector';
  const [turno, setTurno] = useState<Turno>('day');
  const [ini, setIni] = useState('');
  const [fin, setFin] = useState('');
  const [fotoIni, setFotoIni] = useState<string | null>(null);
  const [fotoFin, setFotoFin] = useState<string | null>(null);
  const [busyFoto, setBusyFoto] = useState<null | 'ini_cam' | 'ini_gal' | 'fin_cam' | 'fin_gal'>(null);
  const [previewFoto, setPreviewFoto] = useState<string | null>(null);
  const [reinicio, setReinicio] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actual = lecturas.find((l) => l.shift === turno) ?? null;

  // Al cambiar de turno se precargan los números y fotos REGISTRADOS de ese turno.
  useEffect(() => {
    setIni(fmt(actual?.inicial));
    setFin(fmt(actual?.final));
    setFotoIni(actual?.fotoInicialUrl ?? null);
    setFotoFin(actual?.fotoFinalUrl ?? null);
    setReinicio(actual?.reinicio === true);
    setError(null);
  }, [turno, actual?.inicial, actual?.final, actual?.reinicio, actual?.fotoInicialUrl, actual?.fotoFinalUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const tomarFoto = async (cual: 'ini' | 'fin', via: 'cam' | 'gal') => {
    if (busy || busyFoto) return;
    const tag = `${cual}_${via}` as const;
    setBusyFoto(tag);
    setError(null);
    try {
      const res = via === 'cam'
        ? await captureAndUploadPhoto(machineryId, 'horometro')
        : await pickPhotoFromGalleryAndUpload(machineryId, 'horometro');
      if (!res.ok || !res.url) {
        if (res.error) setError(res.error);
        return;
      }
      if (cual === 'ini') setFotoIni(res.url);
      else setFotoFin(res.url);
    } catch (e: any) {
      setError(e?.message ?? 'Error al subir la foto.');
    } finally {
      setBusyFoto(null);
    }
  };

  const guardar = async () => {
    if (busy) return;
    // El inspector NO pisa una corrección de Control. La base también lo impide
    // (el disparador conserva lo de Control ante un origen 'inspector'), pero
    // decirlo aquí evita un «guardé» que en realidad no cambió nada.
    if (esInspector && actual?.corregidoPor) { setError('Esta lectura ya la corrigió Control: no puedes cambiarla. Pide la corrección en la oficina.'); return; }
    const malo = validarCorreccionHorometro({ inicial: ini, final: fin, motivo, tieneFoto: !!(fotoIni || fotoFin) });
    if (malo) { setError(malo); return; }
    setBusy(true); setError(null);
    // Patch COMPLETO de los campos: lo que quedó vacío BORRA el número / foto.
    // Origen 'control' siempre (también con reinicio marcado): así la base exige
    // módulo y motivo, y la corrección queda protegida contra pisadas del teléfono.
    const r = await guardarLecturaHorometro(machineryId, roundDate, turno, {
      inicial: numeroDeTexto(ini) === false ? null : (numeroDeTexto(ini) as number | null),
      final: numeroDeTexto(fin) === false ? null : (numeroDeTexto(fin) as number | null),
      fotoInicialUrl: fotoIni,
      fotoFinalUrl: fotoFin,
      // Inspector: nunca reinicio (eso es de Control) y origen 'inspector', para que
      // la base no le exija módulo y el papel diga «corregido por el inspector».
      reinicio: esInspector ? false : reinicio,
      origen: esInspector ? 'inspector' : 'control',
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
        <View style={{ width: '100%', maxWidth: 460, maxHeight: '90%', backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>{esInspector ? '✏️ Corregir el horómetro que cargué' : '✎ Corregir horómetro de trabajo'}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm }}>
              {code} · {dmy} · {esInspector
                ? 'solo lo que tú cargaste, de hoy o de ayer; puedes corregir números o fotos. Queda con tu nombre y tu motivo en el reporte.'
                : 'solo la lectura del modo sombra: no toca horas pagadas ni mantenimiento.'}
            </Text>

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
              <Text style={{ color: esInspector ? colors.danger : colors.muted, fontSize: 11, marginBottom: spacing.xs }}>
                {esInspector ? '🔒 Esta lectura ya la corrigió Control: no puedes cambiarla.' : '✎ Ya fue corregida antes desde Control.'}
              </Text>
            ) : null}

            {/* Horómetro Inicial */}
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Horómetro inicial (vacío = borrar el número)</Text>
            <TextInput value={ini} onChangeText={(t) => setIni(soloHorometro(t))} keyboardType="numeric" inputMode="decimal" placeholder="—" placeholderTextColor={colors.muted} style={[input, { marginBottom: 6 }]} />
            
            {/* Foto horómetro inicial */}
            <View style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                <TouchableOpacity
                  onPress={() => tomarFoto('ini', 'cam')}
                  disabled={busy || !!busyFoto}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, opacity: (busy || busyFoto) ? 0.6 : 1 }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>
                    {busyFoto === 'ini_cam' ? 'Subiendo…' : '📷 Foto inicial'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => tomarFoto('ini', 'gal')}
                  disabled={busy || !!busyFoto}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, opacity: (busy || busyFoto) ? 0.6 : 1 }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>
                    {busyFoto === 'ini_gal' ? 'Subiendo…' : '🖼️ Galería inicial'}
                  </Text>
                </TouchableOpacity>
              </View>
              {fotoIni ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4, padding: 6, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                  <TouchableOpacity onPress={() => setPreviewFoto(fotoIni)}>
                    <Image source={{ uri: fotoIni }} style={{ width: 36, height: 36, borderRadius: 4, backgroundColor: colors.border }} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setPreviewFoto(fotoIni)} style={{ flex: 1 }}>
                    <Text style={{ color: colors.success, fontSize: 11, fontWeight: '700' }}>✓ Foto inicial adjunta</Text>
                    <Text style={{ color: colors.muted, fontSize: 10 }}>Toca la imagen para verla en grande</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setFotoIni(null)} disabled={busy} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>✕ Quitar</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            {/* Horómetro Final */}
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Horómetro final (vacío = borrar el número)</Text>
            <TextInput value={fin} onChangeText={(t) => setFin(soloHorometro(t))} keyboardType="numeric" inputMode="decimal" placeholder="—" placeholderTextColor={colors.muted} style={[input, { marginBottom: 6 }]} />

            {/* Foto horómetro final */}
            <View style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                <TouchableOpacity
                  onPress={() => tomarFoto('fin', 'cam')}
                  disabled={busy || !!busyFoto}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, opacity: (busy || busyFoto) ? 0.6 : 1 }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>
                    {busyFoto === 'fin_cam' ? 'Subiendo…' : '📷 Foto final'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => tomarFoto('fin', 'gal')}
                  disabled={busy || !!busyFoto}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, opacity: (busy || busyFoto) ? 0.6 : 1 }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>
                    {busyFoto === 'fin_gal' ? 'Subiendo…' : '🖼️ Galería final'}
                  </Text>
                </TouchableOpacity>
              </View>
              {fotoFin ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4, padding: 6, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                  <TouchableOpacity onPress={() => setPreviewFoto(fotoFin)}>
                    <Image source={{ uri: fotoFin }} style={{ width: 36, height: 36, borderRadius: 4, backgroundColor: colors.border }} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setPreviewFoto(fotoFin)} style={{ flex: 1 }}>
                    <Text style={{ color: colors.success, fontSize: 11, fontWeight: '700' }}>✓ Foto final adjunta</Text>
                    <Text style={{ color: colors.muted, fontSize: 10 }}>Toca la imagen para verla en grande</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setFotoFin(null)} disabled={busy} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>✕ Quitar</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            {/* El REINICIO es de Control: al inspector ni se le ofrece. */}
            {!esInspector ? (
              <TouchableOpacity onPress={() => setReinicio((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
                <Text style={{ fontSize: 16 }}>{reinicio ? '☑️' : '⬜'}</Text>
                <Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>Le cambiaron el horómetro (reinicio): el número puede ser menor que el de ayer y la base no la marcará mala por eso.</Text>
              </TouchableOpacity>
            ) : null}

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
          </ScrollView>
        </View>

        {previewFoto ? (
          <Modal visible transparent animationType="fade" onRequestClose={() => setPreviewFoto(null)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: spacing.md, zIndex: 10000 }}>
              <View style={{ width: '100%', maxWidth: 420, alignItems: 'center' }}>
                <Image source={{ uri: previewFoto }} style={{ width: '100%', height: 340, borderRadius: radius.md }} resizeMode="contain" />
                <TouchableOpacity onPress={() => setPreviewFoto(null)} style={{ marginTop: spacing.md, backgroundColor: '#fff', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.pill }}>
                  <Text style={{ color: '#000', fontWeight: '800', fontSize: 13 }}>Cerrar vista</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        ) : null}
      </View>
    </Modal>
  );
}
