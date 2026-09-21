// REGISTRAR UNA PERSONA EN LA AGENDA DE COCINA (21-sep-2026).
//
// El MISMO formulario para los dos lados: la cocina lo abre cuando llega alguien
// nuevo al mostrador, y la oficina lo abre desde «📇 Contactos» para corregir. Si
// fueran dos formularios, uno de los dos terminaría pidiendo distinto que el otro.
//
// ⭐ LOS TELÉFONOS Y LA EMPRESA NO DICEN «OPCIONAL». Pedido del cliente: «2 números
//    de teléfono que sea opcional sin que diga que es opcional, al igual lo de la
//    empresa». Se dejan vacíos y no reclama, y ya.
//
// ⭐ LA CÉDULA SE REVISA MIENTRAS SE ESCRIBE, contra la nómina Y contra la agenda.
//    Si ya es de nómina, NO deja crear: esa persona se atiende con su carnet, y su
//    comida va a la cuenta que ya tiene. Si ya es un contacto, se abre ese.
//
// Las reglas viven en src/lib/comidaContactos.ts; lo que escribe, en comidaContactosDb.ts.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Screen, SectionTitle, Card } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import {
  ContactoCocina, Hallazgo,
  contactoActivo, formatearCedula, limpiarTexto, mensajeDeHallazgo, nombreDeContacto,
  normalizarCedula, posiblesDuplicados, validarContacto,
} from '../lib/comidaContactos';
// ⭐ La cédula es OBLIGATORIA (decisión del cliente, 21-sep-2026). No hay casilla de
//    «no la tiene a la mano»: sin cédula no se registra a nadie, y la base lo exige
//    igual, así que por acá tampoco puede colarse.
import { actualizarContacto, crearContacto, reconocerCedula } from '../lib/comidaContactosDb';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Contacto a corregir. null (o sin pasar) = crear uno nuevo. */
  contacto?: ContactoCocina | null;
  /** Los que ya están registrados, para no duplicar a nadie. */
  contactos: ContactoCocina[];
  empresas: { id: string; name: string }[];
  /** La cédula que se buscó y no apareció: el formulario abre con ella puesta. */
  cedulaInicial?: string;
  canEdit: boolean;
  quien?: { id?: string | null; nombre?: string | null };
  /** Se llama con el contacto ya guardado. `creado` distingue alta de corrección. */
  onGuardado: (contacto: ContactoCocina, creado: boolean) => void;
  /** La cédula ya es de un contacto: la pantalla decide si lo abre o lo atiende. */
  onYaExiste?: (contacto: ContactoCocina) => void;
};

export function ContactoCocinaForm({
  visible, onClose, contacto, contactos, empresas, cedulaInicial, canEdit, quien, onGuardado, onYaExiste,
}: Props) {
  const { colors } = useTheme();
  const editando = !!contacto;

  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [cedula, setCedula] = useState('');
  const [tel1, setTel1] = useState('');
  const [tel2, setTel2] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [nota, setNota] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Lo que dijo el reconocimiento de la cédula, y si todavía está buscando.
  const [hallazgo, setHallazgo] = useState<Hallazgo | null>(null);
  const [revisando, setRevisando] = useState(false);
  // Segundo toque para guardar cuando hay parecidos (mismo nombre, mismo teléfono).
  const [confirmar, setConfirmar] = useState(false);

  // Al abrir: los datos del contacto que se corrige, o el formulario en blanco con
  // la cédula que se venía buscando.
  useEffect(() => {
    if (!visible) return;
    setNombre(contacto?.nombre ?? '');
    setApellido(contacto?.apellido ?? '');
    setCedula(contacto?.cedula ?? cedulaInicial ?? '');
    setTel1(contacto?.telefono1 ?? '');
    setTel2(contacto?.telefono2 ?? '');
    setCompanyId(contacto?.company_id ?? '');
    setNota(contacto?.nota ?? '');
    setAviso(null);
    setHallazgo(null);
    setConfirmar(false);
  }, [visible, contacto, cedulaInicial, editando]);

  // ── EL RECONOCIMIENTO ─────────────────────────────────────────────────────
  //
  // ⚠️ Con espera y con turno. Sin la espera consultaría la nómina en cada tecla;
  //    sin el turno, una respuesta lenta de hace tres letras pisaría a la de ahora
  //    y el aviso hablaría de una cédula que ya nadie está escribiendo.
  const turno = useRef(0);
  useEffect(() => {
    if (!visible) { setHallazgo(null); setRevisando(false); return; }
    const d = normalizarCedula(cedula);
    // La cédula que ya tenía el contacto que se corrige no se revisa contra sí misma.
    if (d.length < 5 || (editando && d === normalizarCedula(contacto?.cedula))) {
      setHallazgo(null); setRevisando(false); return;
    }
    const mio = ++turno.current;
    setRevisando(true);
    const t = setTimeout(async () => {
      try {
        const h = await reconocerCedula(d, contactos);
        if (turno.current === mio) setHallazgo(h);
      } catch {
        // No se pudo consultar la nómina. NO se dice «libre»: decir que no está
        // cuando en realidad no se supo es lo que crea el contacto duplicado.
        if (turno.current === mio) setHallazgo(null);
      } finally {
        if (turno.current === mio) setRevisando(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [visible, cedula, contactos, editando, contacto]);

  const yaEsContacto = hallazgo?.tipo === 'contacto' ? hallazgo.contacto : null;
  const esDeNomina = hallazgo?.tipo === 'nomina';

  const datos = { nombre, apellido, cedula, telefono1: tel1, telefono2: tel2, companyId, nota };
  const parecidos = useMemo(
    () => posiblesDuplicados({ nombre, apellido, telefono1: tel1, telefono2: tel2 }, contactos, contacto?.id ?? null),
    [nombre, apellido, tel1, tel2, contactos, contacto],
  );

  // Los parecidos cambian mientras se escribe: un «confirmar» de hace dos letras no
  // vale para una lista distinta de parecidos.
  useEffect(() => { setConfirmar(false); }, [nombre, apellido, tel1, tel2]);

  const guardar = async () => {
    setAviso(null);
    if (!canEdit) { setAviso('❌ Hace falta permiso de escritura en Distribución de comida.'); return; }
    if (esDeNomina) { setAviso(`❌ ${mensajeDeHallazgo(hallazgo!)}`); return; }
    if (!editando && yaEsContacto) { setAviso(`❌ ${mensajeDeHallazgo(hallazgo!)}`); return; }
    const motivo = validarContacto(datos, contactos, contacto?.id ?? null);
    if (motivo) { setAviso(`❌ ${motivo}`); return; }
    if (parecidos.length > 0 && !confirmar) {
      setConfirmar(true);
      setAviso(`⚠️ Ya hay ${parecidos.length === 1 ? 'alguien parecido' : `${parecidos.length} parecidos`} en la lista (abajo). Si de verdad es otra persona, toca «Guardar» de nuevo.`);
      return;
    }
    setGuardando(true);
    const r = editando
      ? await actualizarContacto(contacto!.id, datos)
      : await crearContacto(datos, quien);
    setGuardando(false);
    if (r.error || !r.contacto) { setAviso(`❌ ${r.error ?? 'No se guardó.'}`); setConfirmar(false); return; }
    onGuardado(r.contacto, !editando);
  };

  // ── Estilos locales ───────────────────────────────────────────────────────
  const campo = {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    color: colors.text, backgroundColor: colors.surface, marginBottom: spacing.xs,
  };
  const rotulo = { color: colors.muted, fontSize: 12, fontWeight: '700' as const, marginBottom: 2 };
  const chip = (activo: boolean) => ({
    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: activo ? colors.brand : colors.surfaceAlt,
    borderWidth: 1, borderColor: activo ? colors.brand : colors.border,
  });
  const chipTxt = (activo: boolean) => ({
    color: activo ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12,
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <TouchableOpacity onPress={onClose} style={{ paddingVertical: spacing.xs, marginBottom: spacing.xs }}>
          <Text style={{ color: colors.brandText, fontWeight: '800' }}>← Volver</Text>
        </TouchableOpacity>
        <SectionTitle>{editando ? '✏️ Corregir contacto' : '➕ Persona nueva'}</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          Es una agenda de la cocina: no entra en nómina, ni en asistencia, ni en carnets. Sirve para entregarle
          comida y para sacarle su cuenta.
        </Text>

        {aviso ? (
          <TouchableOpacity
            onPress={() => setAviso(null)}
            style={{
              backgroundColor: colors.surfaceAlt, borderLeftWidth: 4,
              borderLeftColor: aviso.startsWith('❌') ? colors.danger : colors.warning,
              borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 13 }}>{aviso}</Text>
          </TouchableOpacity>
        ) : null}

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <Card>
            <Text style={rotulo}>Nombre</Text>
            <TextInput
              value={nombre} onChangeText={setNombre} style={campo} placeholder="Nombre"
              placeholderTextColor={colors.muted} autoCapitalize="words"
            />
            <Text style={rotulo}>Apellido</Text>
            <TextInput
              value={apellido} onChangeText={setApellido} style={campo} placeholder="Apellido"
              placeholderTextColor={colors.muted} autoCapitalize="words"
            />

            <Text style={rotulo}>Cédula</Text>
            <TextInput
              value={cedula} onChangeText={setCedula} style={campo}
              placeholder="V-12.345.678" placeholderTextColor={colors.muted}
              keyboardType="default" autoCapitalize="characters"
            />

            {revisando ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Revisando la cédula…</Text>
            ) : null}
            {hallazgo && hallazgo.tipo !== 'libre' ? (
              <View style={{
                borderWidth: 1, borderColor: esDeNomina ? colors.danger : colors.border,
                backgroundColor: esDeNomina ? colors.dangerSoftBg : colors.surfaceAlt,
                borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs,
              }}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{mensajeDeHallazgo(hallazgo)}</Text>
                {yaEsContacto && onYaExiste ? (
                  <TouchableOpacity
                    onPress={() => onYaExiste(yaEsContacto)}
                    style={{ marginTop: spacing.xs, alignSelf: 'flex-start', ...chip(true) }}
                  >
                    <Text style={chipTxt(true)}>
                      {contactoActivo(yaEsContacto) ? `Abrir a ${nombreDeContacto(yaEsContacto)}` : `Ver a ${nombreDeContacto(yaEsContacto)}`}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            <Text style={rotulo}>Teléfono</Text>
            <TextInput
              value={tel1} onChangeText={setTel1} style={campo} placeholder="0412-0000000"
              placeholderTextColor={colors.muted} keyboardType="phone-pad" inputMode="tel"
            />
            <Text style={rotulo}>Otro teléfono</Text>
            <TextInput
              value={tel2} onChangeText={setTel2} style={campo} placeholder="0212-0000000"
              placeholderTextColor={colors.muted} keyboardType="phone-pad" inputMode="tel"
            />

            <Text style={rotulo}>Empresa</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
              <TouchableOpacity onPress={() => setCompanyId('')} style={chip(!companyId)}>
                <Text style={chipTxt(!companyId)}>Sin empresa</Text>
              </TouchableOpacity>
              {empresas.map((e) => (
                <TouchableOpacity key={e.id} onPress={() => setCompanyId(e.id)} style={chip(companyId === e.id)}>
                  <Text style={chipTxt(companyId === e.id)}>{e.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {companyId ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                Lo que pida se le cobra a esa empresa. Se puede cambiar a que pague él desde su ficha.
              </Text>
            ) : null}

            <Text style={rotulo}>Nota</Text>
            <TextInput
              value={nota} onChangeText={setNota} style={campo} placeholder="Lo que haga falta recordar"
              placeholderTextColor={colors.muted} multiline
            />
          </Card>

          {parecidos.length > 0 ? (
            <Card>
              <Text style={{ color: colors.warning, fontWeight: '800', marginBottom: spacing.xs }}>
                ⚠️ Posibles repetidos
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                Se llaman igual o tienen el mismo teléfono. Míralos antes de crear otro.
              </Text>
              {parecidos.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => onYaExiste?.(c)}
                  style={{ paddingVertical: 4 }}
                >
                  <Text style={{ color: colors.text, fontSize: 13 }}>
                    • <Text style={{ fontWeight: '700' }}>{nombreDeContacto(c)}</Text>
                    {c.cedula ? ` · ${formatearCedula(c.cedula)}` : ''}
                    {c.telefono1 ? ` · ${limpiarTexto(c.telefono1)}` : ''}
                    {contactoActivo(c) ? '' : ' · quitado de la lista'}
                  </Text>
                </TouchableOpacity>
              ))}
            </Card>
          ) : null}

          <TouchableOpacity
            onPress={guardar}
            disabled={guardando || esDeNomina || (!editando && !!yaEsContacto)}
            style={{
              backgroundColor: confirmar ? colors.warning : colors.brand,
              opacity: guardando || esDeNomina || (!editando && !!yaEsContacto) ? 0.5 : 1,
              borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', marginTop: spacing.sm,
            }}
          >
            <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>
              {guardando ? 'Guardando…' : confirmar ? 'Guardar de todos modos' : editando ? 'Guardar cambios' : 'Crear contacto'}
            </Text>
          </TouchableOpacity>
          <View style={{ height: spacing.lg }} />
        </ScrollView>
      </Screen>
    </Modal>
  );
}
