// 📇 FORMULARIO DE UN CONTACTO (persona o empresa) — 23-sep-2026.
//
// Pedido del cliente, textual: «permitir poder editar, deshabilitar, y agregar un
// nuevo contacto ya sea persona o proveedor, con los datos básicos que sería
// nombre, apellido, razón social, cédula, rif. Y además no permitas agregar si ya
// existe esa cédula o RIF».
//
// ⭐ UN SOLO FORMULARIO PARA TODOS LOS SITIOS: el módulo 📇 Contactos y el «＋»
//    que sale dentro de NUEVA VENTA. Si cada pantalla armara el suyo, el mismo
//    contacto quedaría escrito distinto según por dónde se creó, y la lista
//    terminaría con «PEDRO PEREZ» y «Perez, Pedro» como dos contactos.
//
// ⚠️ ESTE COMPONENTE VIVE A NIVEL DE MÓDULO, NO DENTRO DE OTRO COMPONENTE. Un
//    componente con TextInput declarado dentro de otro se vuelve a crear en cada
//    tecleo y el campo pierde el foco letra por letra. Es una trampa que este
//    proyecto ya pisó.
//
// La regla vive en src/lib/contactos.ts y se prueba sola: scripts/test-contactos.mjs
import React, { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Card } from './ui';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { Contacto } from '../types/database';
import {
  DOC_LETRAS, docCanonico, docDuplicado, docTipoLabel, esPersona, filaContacto,
  limpiarNombre, partirNombre, repartirBusqueda, rubrosUsados, validarContacto,
} from '../lib/contactos';

type Props = {
  /** El contacto que se EDITA. Sin él, es uno nuevo. */
  contacto?: Contacto | null;
  /** Los que ya están, para no repetir una cédula ni un RIF. */
  contactos: Contacto[];
  /** Quién lo crea (queda en `created_by`). */
  usuarioId?: string | null;
  /** Lo que se escribió en el buscador: se aprovecha para no teclearlo de nuevo. */
  textoBuscado?: string | null;
  /** Con qué marca nace. Desde una venta, cliente; desde Compras, proveedor. */
  nacePara?: 'cliente' | 'proveedor';
  /** Corto = sin correo, dirección ni rubros. Es el que sale dentro de la venta. */
  compacto?: boolean;
  onCancelar: () => void;
  /** Recibe el contacto ya guardado (para dejarlo elegido donde se llamó). */
  onGuardado: (c: Contacto) => void;
};

export function ContactoForm({
  contacto, contactos, usuarioId, textoBuscado, nacePara = 'cliente', compacto, onCancelar, onGuardado,
}: Props) {
  const { colors } = useTheme();
  const previo = useMemo(() => repartirBusqueda(contacto ? '' : textoBuscado), [contacto, textoBuscado]);
  // Un contacto sin desglose (los 55 que vinieron de Compras) se PROPONE partido
  // por el último espacio, y esa propuesta se vuelve a componer igualita: quien
  // entre a cambiarle el teléfono y guarde sin mirar, lo deja llamándose igual.
  const partido = useMemo(
    () => (contacto && !contacto.first_name && !contacto.last_name ? partirNombre(contacto.name) : null),
    [contacto],
  );

  const [letra, setLetra] = useState<string>(contacto?.doc_letter ?? (nacePara === 'proveedor' ? 'J' : 'V'));
  const [numero, setNumero] = useState(contacto?.doc_number ?? previo.numero);
  const [nombre, setNombre] = useState(contacto ? (contacto.first_name ?? partido?.nombre ?? '') : previo.nombre);
  const [apellido, setApellido] = useState(contacto ? (contacto.last_name ?? partido?.apellido ?? '') : '');
  const [razon, setRazon] = useState(contacto ? (contacto.razon_social ?? contacto.name ?? '') : previo.nombre);
  const [telefono, setTelefono] = useState(contacto?.phone ?? '');
  const [correo, setCorreo] = useState(contacto?.email ?? '');
  const [direccion, setDireccion] = useState(contacto?.address ?? '');
  const [esCliente, setEsCliente] = useState(contacto ? !!contacto.es_cliente : nacePara === 'cliente');
  const [esProveedor, setEsProveedor] = useState(contacto ? !!contacto.es_proveedor : nacePara === 'proveedor');
  const [rubros, setRubros] = useState<string[]>(contacto?.tags ?? []);
  const [rubroNuevo, setRubroNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const persona = esPersona(letra);
  const datos = {
    letra, numero, nombre, apellido, razonSocial: razon,
    telefono, correo, direccion, esCliente, esProveedor, rubros,
  };
  const choca = docDuplicado(contactos as any, letra, numero, contacto?.id ?? null);
  const sugeridos = useMemo(() => rubrosUsados(contactos as any).slice(0, 14), [contactos]);

  const alternarRubro = (r: string) =>
    setRubros((prev) => (prev.some((x) => limpiarNombre(x) === limpiarNombre(r))
      ? prev.filter((x) => limpiarNombre(x) !== limpiarNombre(r))
      : [...prev, limpiarNombre(r)]));

  const guardar = async () => {
    const m = validarContacto(datos, contactos as any, contacto?.id ?? null);
    if (m) { setAviso(`❌ ${m}`); return; }
    setGuardando(true); setAviso(null);
    try {
      const fila = filaContacto(datos);
      // ⚠️ Siempre con .select(): con RLS, un «no tienes permiso» llega como 0 filas
      //    y SIN error. Sin pedir la fila de vuelta, la pantalla diría «✅ listo» a
      //    algo que no se guardó.
      const { data, error } = contacto
        ? await supabase.from('contactos').update(fila).eq('id', contacto.id).select().single()
        : await supabase.from('contactos').insert({ ...fila, created_by: usuarioId ?? null }).select().single();
      if (error) {
        if (/contactos|relation|does not exist/i.test(error.message)) {
          setAviso('❌ Falta correr «contactos.sql» en Supabase. Avisa al administrador.');
        } else if (/duplicate|unique|contactos_doc_key/i.test(error.message)) {
          // Otro teléfono lo creó en el mismo momento: el índice único lo frena.
          setAviso(`❌ Ese ${docTipoLabel(letra).toLowerCase()} ya está registrado. Búscalo en la lista.`);
        } else {
          setAviso(`❌ ${error.message}`);
        }
        return;
      }
      if (!data) { setAviso('❌ No se guardó: te falta permiso de escritura.'); return; }
      onGuardado(data as Contacto);
    } finally {
      setGuardando(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const rotulo = (t: string) => <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>{t}</Text>;
  const casilla = (on: boolean, texto: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.xs }}>
      <Text style={{ fontSize: 15 }}>{on ? '☑️' : '⬜'}</Text>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 }}>{texto}</Text>
    </TouchableOpacity>
  );

  return (
    <Card>
      {/* PERSONA O EMPRESA. No es una pregunta aparte: lo dice la letra del
          documento (V/E/P = persona, J/G = empresa), que es el dato que el usuario
          tiene en la mano. Una pregunta de más es una pregunta que se responde mal. */}
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
        {persona ? '👤 Persona · cédula' : '🏢 Empresa · RIF'}
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: 4 }}>
        {DOC_LETRAS.map((l) => {
          const on = letra === l;
          return (
            <TouchableOpacity
              key={l}
              onPress={() => {
                // Al pasar de persona a empresa (o al revés) se arrastra lo escrito,
                // para no volver a teclear el nombre por haberse equivocado de letra.
                if (esPersona(l) !== persona) {
                  if (esPersona(l)) { const p = partirNombre(razon); setNombre(p.nombre); setApellido(p.apellido); }
                  else { setRazon([nombre, apellido].filter(Boolean).join(' ')); }
                }
                setLetra(l);
              }}
              style={{ flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingVertical: spacing.xs, alignItems: 'center' }}
            >
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{l}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TextInput
        value={numero} onChangeText={(t) => setNumero(t.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad" inputMode="numeric"
        placeholder={persona ? 'Cédula · solo los números' : 'RIF · solo los números'}
        placeholderTextColor={colors.muted}
        style={[input, { borderColor: choca ? colors.danger : colors.border }]}
      />
      <Text style={{ color: choca ? colors.danger : colors.muted, fontSize: 11, marginTop: 3, fontWeight: choca ? '800' : '400' }}>
        {choca
          ? `⚠️ Ese ${docTipoLabel(letra).toLowerCase()} ya está registrado a nombre de «${choca.name}». Búscalo en la lista en vez de crear otro.`
          : numero
            ? `Quedará como ${docCanonico(letra, numero)} · ${docTipoLabel(letra)}`
            : `Si no lo tienes a mano, déjalo en blanco: el contacto queda avisado hasta que se lo pongas.`}
      </Text>

      {persona ? (
        <>
          {rotulo('Nombre')}
          <TextInput value={nombre} onChangeText={(t) => setNombre(t.toUpperCase())} autoCapitalize="characters" placeholder="PEDRO" placeholderTextColor={colors.muted} style={input} />
          {rotulo('Apellido')}
          <TextInput value={apellido} onChangeText={(t) => setApellido(t.toUpperCase())} autoCapitalize="characters" placeholder="PÉREZ" placeholderTextColor={colors.muted} style={input} />
        </>
      ) : (
        <>
          {rotulo('Razón social')}
          <TextInput value={razon} onChangeText={(t) => setRazon(t.toUpperCase())} autoCapitalize="characters" placeholder="CONSTRUCTORA EJEMPLO, C.A." placeholderTextColor={colors.muted} style={input} />
        </>
      )}

      {rotulo('Teléfono (opcional)')}
      <TextInput value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" placeholder="0414-1112233" placeholderTextColor={colors.muted} style={input} />

      {!compacto ? (
        <>
          {rotulo('Correo (opcional)')}
          <TextInput value={correo} onChangeText={setCorreo} autoCapitalize="none" keyboardType="email-address" placeholder="correo@ejemplo.com" placeholderTextColor={colors.muted} style={input} />
          {rotulo('Dirección (opcional)')}
          <TextInput value={direccion} onChangeText={setDireccion} placeholder="Dirección fiscal / de entrega" placeholderTextColor={colors.muted} style={input} />
        </>
      ) : null}

      {/* 👤 CLIENTE / 🏭 PROVEEDOR: dos marcas, NO dos listas. A mucha gente se le
          vende Y se le compra; tenerla dos veces es tener su cuenta partida en dos. */}
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.md }}>¿Qué es? (puede ser las dos)</Text>
      {casilla(esCliente, '👤 Cliente · se le vende', () => setEsCliente((v) => !v))}
      {casilla(esProveedor, '🏭 Proveedor · se le compra (sale en Compras)', () => setEsProveedor((v) => !v))}

      {/* RUBRO: es como Compras filtra a sus proveedores. Si se perdiera al mudarlo
          al catálogo, Compras saldría peor de lo que estaba. */}
      {!compacto && esProveedor ? (
        <>
          {rotulo('Rubro (qué vende): ferretería, repuestos, aceites…')}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {rubros.map((r) => (
              <TouchableOpacity key={r} onPress={() => alternarRubro(r)} style={{ borderRadius: radius.pill, backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '700', fontSize: 12 }}>{r} ✕</Text>
              </TouchableOpacity>
            ))}
            {sugeridos.filter((r) => !rubros.some((x) => limpiarNombre(x) === r)).map((r) => (
              <TouchableOpacity key={r} onPress={() => alternarRubro(r)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.text, fontSize: 12 }}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
            <TextInput value={rubroNuevo} onChangeText={(t) => setRubroNuevo(t.toUpperCase())} autoCapitalize="characters" placeholder="Otro rubro…" placeholderTextColor={colors.muted} style={[input, { flex: 1 }]} />
            <TouchableOpacity
              onPress={() => { if (limpiarNombre(rubroNuevo)) { alternarRubro(rubroNuevo); setRubroNuevo(''); } }}
              style={{ paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ color: colors.brandText, fontWeight: '800' }}>➕</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {aviso ? (
        <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.sm }}>{aviso}</Text>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <TouchableOpacity onPress={onCancelar} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={guardando} onPress={guardar} style={{ flex: 2, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: guardando ? 0.6 : 1 }}>
          <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>
            {guardando ? 'Guardando…' : contacto ? '💾 Guardar cambios' : compacto ? '💾 Guardar y usarlo' : '💾 Registrar contacto'}
          </Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}
