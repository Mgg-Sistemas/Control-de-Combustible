// 🚜 DESPLEGABLE BUSCABLE DE MÁQUINAS DE UN CONTACTO (23-sep-2026).
//
// Pedido del cliente, textual: «que se muestre las maquinarias mediante un buscable
// desplegable, buscable por todas sus características. Mostrando todos los datos de
// la maquinaria […] que se busque un encargado o una empresa y me salga las máquinas
// registradas. También permite la opción de una máquina que no exista».
//
// TRES LISTAS EN UNA SOLA BÚSQUEDA:
//   1. Las que YA están en el catálogo propio del contacto.
//   2. Las del CATÁLOGO DE EQUIPOS de su empresa, para copiarlas de un toque.
//   3. El «➕ Registrar una máquina que no está», para lo que no existe en ninguno.
//
// ⭐ COPIA, NO APUNTA. Elegir una del catálogo de equipos guarda una COPIA en el
//    catálogo del contacto; `machinery` no se toca nunca. Ver contactoMaquinas.ts.
//
// ⚠️ COMPONENTE DE NIVEL DE MÓDULO. Declararlo dentro de otro lo remonta en cada
//    tecla y el buscador pierde el foco letra por letra.
import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Screen, Card, SectionTitle } from './ui';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import {
  EmpresaRow, MachineryRow, MaquinaContacto, buscarMaquinas, datosMaquina, desdeMachinery,
  empresasConMaquinas, encargadosDe, etiquetaMaquina, filaMaquina, maquinasPorEmpresa,
  proponerMaquinas, validarMaquina,
} from '../lib/contactoMaquinas';

type Props = {
  visible: boolean;
  /** De quién son las máquinas. Sin contacto no hay a quién guardárselas. */
  contactoId?: string | null;
  contactoNombre?: string | null;
  /** Si el contacto es una empresa registrada, para proponerle SUS máquinas. */
  companyId?: string | null;
  /** Las empresas internas, para poder enlazarlo AQUÍ mismo si falta. */
  companies?: EmpresaRow[];
  /** Se enlazó (o se desenlazó) la empresa: hay que releer los contactos. */
  onEmpresaEnlazada?: (companyId: string | null) => Promise<void> | void;
  /** Las que ya tiene guardadas. */
  maquinas: MaquinaContacto[];
  /** El catálogo de equipos, SOLO para proponer (nunca se escribe). */
  machinery: MachineryRow[];
  usuarioId?: string | null;
  onCerrar: () => void;
  /** Se eligió una: el que llama decide qué hace con ella. */
  onElegir: (m: MaquinaContacto) => void;
  /** Se guardó una nueva (copiada o escrita): hay que releer la lista. */
  onCambio: () => Promise<void> | void;
};

const VACIA: MaquinaContacto = {};

export function MaquinaPicker({
  visible, contactoId, contactoNombre, companyId, companies, maquinas, machinery,
  usuarioId, onCerrar, onElegir, onCambio, onEmpresaEnlazada,
}: Props) {
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const [nueva, setNueva] = useState(false);
  const [form, setForm] = useState<MaquinaContacto>(VACIA);
  const [verDetalle, setVerDetalle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // 🏢 Enlazar el contacto con su empresa interna SIN salirse de aquí.
  const [buscaEmp, setBuscaEmp] = useState('');
  const [verEmp, setVerEmp] = useState(false);

  const propias = useMemo(() => buscarMaquinas(maquinas, q), [maquinas, q]);
  // ⭐ Sin empresa enlazada se busca en TODO el catálogo: así se encuentra la
  //    máquina de un encargado aunque no se sepa de qué empresa es.
  const propuestas = useMemo(
    () => proponerMaquinas(machinery, {
      companyId, texto: q, yaCopiadas: maquinas.map((m) => m.machinery_id),
    }).slice(0, 60),
    [machinery, companyId, q, maquinas],
  );
  const encargados = useMemo(() => encargadosDe(machinery).slice(0, 12), [machinery]);

  // 🏢 Las empresas internas, buscables, con cuántas máquinas tiene cada una.
  const empresas = useMemo(
    () => empresasConMaquinas(companies, machinery, buscaEmp).slice(0, 40),
    [companies, machinery, buscaEmp],
  );
  const empresaActual = useMemo(
    () => (companyId ? (companies ?? []).find((e) => e.id === companyId) ?? null : null),
    [companies, companyId],
  );
  const cuentaEmpresas = useMemo(() => maquinasPorEmpresa(machinery), [machinery]);

  /**
   * Deja dicho DE CUÁL EMPRESA INTERNA es este contacto.
   *
   * ⚠️ Escribe en `contactos`, no en `machinery`: enlazar no le quita ni le pone
   *    una máquina a nadie, solo permite PROPONER las de esa empresa.
   */
  const enlazarEmpresa = async (id: string | null) => {
    if (!contactoId) { setAviso('❌ Primero elige el contacto.'); return; }
    setBusy(true); setAviso(null);
    try {
      const { data, error } = await supabase
        .from('contactos').update({ company_id: id }).eq('id', contactoId).select().single();
      if (error) { setAviso(`❌ ${error.message}`); return; }
      // ⚠️ Con RLS, un «no tienes permiso» llega como 0 filas y SIN error.
      if (!data) { setAviso('❌ No se guardó: te falta permiso de escritura en Contactos.'); return; }
      setVerEmp(false); setBuscaEmp('');
      await onEmpresaEnlazada?.(id);
    } finally {
      setBusy(false);
    }
  };

  const guardar = async (fila: MaquinaContacto) => {
    if (!contactoId) { setAviso('❌ Primero elige el contacto.'); return; }
    setBusy(true); setAviso(null);
    try {
      const { data, error } = await supabase
        .from('contacto_maquinas')
        .insert({ ...filaMaquina(fila, contactoId), created_by: usuarioId ?? null })
        .select().single();
      if (error) {
        if (/contacto_maquinas|relation|does not exist/i.test(error.message)) {
          setAviso('❌ Falta correr «contacto_maquinas.sql» en Supabase. Avisa al administrador.');
        } else if (/duplicate|unique/i.test(error.message)) {
          setAviso('❌ Esa máquina ya está en la lista de este contacto.');
        } else setAviso(`❌ ${error.message}`);
        return;
      }
      // ⚠️ Con RLS, un «no tienes permiso» llega como 0 filas y SIN error.
      if (!data) { setAviso('❌ No se guardó: te falta permiso de escritura.'); return; }
      await onCambio();
      setNueva(false); setForm(VACIA); setQ('');
      onElegir(data as MaquinaContacto);
    } finally {
      setBusy(false);
    }
  };

  const copiar = (m: MachineryRow) => guardar(desdeMachinery(m, contactoId));

  const crear = () => {
    const err = validarMaquina(form);
    if (err) { setAviso(`❌ ${err}`); return; }
    guardar(form);
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const campo = (rotulo: string, k: keyof MaquinaContacto, ph: string, numerico = false) => (
    <View style={{ marginTop: spacing.xs }}>
      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>{rotulo}</Text>
      <TextInput
        value={form[k] == null ? '' : String(form[k])}
        onChangeText={(t) => setForm((p) => ({ ...p, [k]: numerico ? t.replace(/[^0-9.,]/g, '') : t.toUpperCase() }))}
        keyboardType={numerico ? 'decimal-pad' : 'default'}
        autoCapitalize={numerico ? 'none' : 'characters'}
        placeholder={ph} placeholderTextColor={colors.muted} style={input}
      />
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCerrar}>
      <Screen>
        {nueva ? (
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>Máquina que no está en el catálogo</SectionTitle>
            <Card>
              {/* ⭐ Se pide MUY POCO: basta con una cosa que la identifique. Una
                  pantalla que exige diez campos termina con diez campos llenos de
                  «X», que es peor que tenerlos vacíos porque la «X» no se nota. */}
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                Se guarda SOLO para {contactoNombre || 'este contacto'}. No se agrega al catálogo de equipos
                de la empresa: es una lista aparte. Con el código, la descripción, el serial o la placa basta.
              </Text>
              {campo('Código', 'codigo', 'EX-012')}
              {campo('Descripción', 'descripcion', 'EXCAVADORA')}
              {campo('Tipo', 'tipo', 'EXCAVADORA / VOLTEO / RETRO…')}
              {campo('Marca', 'marca', 'CATERPILLAR')}
              {campo('Modelo', 'modelo', '320D')}
              {campo('Serial', 'serial', 'SERIAL')}
              {campo('Placa', 'placa', 'A12BC3D')}
              {campo('Encargado', 'encargado', 'A quién responde')}
              {campo('Ubicación', 'ubicacion', 'Dónde está')}
              {campo('Horómetro', 'horometro', '0', true)}
              {campo('Precio por hora ($)', 'precio_hora', '0,00', true)}
              {campo('Nota', 'nota', 'Lo que haga falta aclarar')}

              {aviso ? <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.sm }}>{aviso}</Text> : null}

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <TouchableOpacity onPress={() => { setNueva(false); setAviso(null); }} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={busy} onPress={crear} style={{ flex: 2, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                  <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>{busy ? 'Guardando…' : '💾 Guardar y usarla'}</Text>
                </TouchableOpacity>
              </View>
            </Card>
            <View style={{ height: spacing.xl }} />
          </ScrollView>
        ) : (
          <>
            <SectionTitle>Máquina{contactoNombre ? ` · ${contactoNombre}` : ''}</SectionTitle>

            {/* 🏢 ¿DE CUÁL EMPRESA INTERNA ES? Pedido del cliente: «si es una
                empresa interna se muestra la lista, si es externa se agrega la
                máquina sin que afecte el catálogo».

                Sin este enlace el desplegable no tiene de dónde proponer nada, y
                antes solo se podía hacer en la ficha completa del contacto: había
                que abandonar la venta a medias para volver a empezarla. */}
            {onEmpresaEnlazada ? (
              verEmp ? (
                <View style={{ borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs, backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>
                    ¿De cuál empresa interna es {contactoNombre || 'este contacto'}? Al enlazarla salen SUS máquinas.
                  </Text>
                  <TextInput
                    value={buscaEmp} onChangeText={setBuscaEmp}
                    placeholder="🔎 Busca la empresa por nombre o RIF…"
                    placeholderTextColor={colors.muted} style={input}
                  />
                  <ScrollView style={{ maxHeight: 210, marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                    {empresas.map(({ empresa, maquinas: cuantas }) => (
                      <TouchableOpacity
                        key={empresa.id} disabled={busy} onPress={() => enlazarEmpresa(empresa.id)}
                        style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: busy ? 0.6 : 1 }}
                      >
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>🏢 {empresa.name}</Text>
                        <Text style={{ color: cuantas ? colors.muted : colors.danger, fontSize: 11 }}>
                          {cuantas ? `${cuantas} máquina${cuantas === 1 ? '' : 's'} en el catálogo de equipos` : 'sin máquinas en el catálogo'}
                          {empresa.rif ? ` · ${empresa.rif}` : ''}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    {!empresas.length ? (
                      <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
                        {buscaEmp ? `Ninguna empresa con «${buscaEmp}».` : 'No hay empresas registradas.'}
                        {' '}Si es de AFUERA, no la enlaces: cárgale la máquina con «➕» aquí abajo.
                      </Text>
                    ) : null}
                  </ScrollView>
                  <TouchableOpacity onPress={() => { setVerEmp(false); setBuscaEmp(''); }} style={{ marginTop: spacing.xs }}>
                    <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '800' }}>Cancelar</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => { setVerEmp(true); setBuscaEmp(''); setAviso(null); }}
                  style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderStyle: companyId ? 'solid' : 'dashed', borderColor: colors.border, backgroundColor: colors.surfaceAlt, marginBottom: spacing.xs }}
                >
                  <Text style={{ color: companyId ? colors.text : colors.brandText, fontSize: 13, fontWeight: '700' }}>
                    {companyId
                      ? `🏢 ${empresaActual?.name ?? 'Empresa enlazada'} · ${cuentaEmpresas[companyId] ?? 0} máquinas`
                      : '🏢 ¿Es una empresa interna? Enlázala y salen sus máquinas'}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {companyId ? 'Tocar para cambiarla' : 'Si es de afuera, déjalo así y cárgale la máquina con «➕»'}
                  </Text>
                </TouchableOpacity>
              )
            ) : null}

            {companyId && onEmpresaEnlazada && !verEmp ? (
              <TouchableOpacity disabled={busy} onPress={() => enlazarEmpresa(null)} style={{ marginBottom: spacing.xs }}>
                <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>Desenlazar la empresa</Text>
              </TouchableOpacity>
            ) : null}

            <TextInput
              value={q} onChangeText={setQ}
              placeholder="🔎 Código, descripción, tipo, marca, modelo, serial, placa, encargado, zona…"
              placeholderTextColor={colors.muted} style={input}
            />

            {/* «Que se busque un encargado […] y me salga las máquinas registradas»:
                los encargados que existen, para no tener que acordarse del nombre. */}
            {!q && encargados.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.xs }}>
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  <Text style={{ color: colors.muted, fontSize: 11, alignSelf: 'center' }}>Encargados:</Text>
                  {encargados.map((e) => (
                    <TouchableOpacity key={e} onPress={() => setQ(e)} style={{ paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                      <Text style={{ color: colors.text, fontSize: 11 }}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            ) : null}

            <TouchableOpacity
              onPress={() => { setNueva(true); setForm(VACIA); setAviso(null); }}
              style={{ backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}
            >
              <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>➕ Registrar una máquina que no está</Text>
            </TouchableOpacity>

            {aviso ? <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.sm }}>{aviso}</Text> : null}

            <ScrollView style={{ marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
              {propias.length ? (
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>
                  SUS MÁQUINAS ({propias.length})
                </Text>
              ) : null}
              {propias.map((m) => {
                const abierta = verDetalle === m.id;
                return (
                  <View key={m.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginBottom: spacing.xs, backgroundColor: colors.surface }}>
                    <TouchableOpacity onPress={() => onElegir(m)} style={{ padding: spacing.sm }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{etiquetaMaquina(m)}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>
                        {m.origen === 'catalogo' ? '📋 del catálogo de equipos' : '✍️ cargada a mano'}
                        {m.encargado ? ` · 👤 ${m.encargado}` : ''}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setVerDetalle(abierta ? null : (m.id ?? null))} style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm }}>
                      <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>
                        {abierta ? '▾ Ocultar datos' : '› Ver todos los datos'}
                      </Text>
                    </TouchableOpacity>
                    {abierta ? (
                      <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: 2 }}>
                        {datosMaquina(m).map((d) => (
                          <View key={d.rotulo} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                            <Text style={{ color: colors.muted, fontSize: 11 }}>{d.rotulo}</Text>
                            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>{d.valor}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}

              {propuestas.length ? (
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm, marginBottom: 4 }}>
                  DEL CATÁLOGO DE EQUIPOS ({propuestas.length}) · tócala para copiarla
                </Text>
              ) : null}
              {propuestas.map((m) => (
                <TouchableOpacity
                  key={m.id} disabled={busy} onPress={() => copiar(m)}
                  style={{ padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: busy ? 0.6 : 1 }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                    {etiquetaMaquina(desdeMachinery(m))}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {[m.serial ? `Serial ${m.serial}` : '', m.plate ? `Placa ${m.plate}` : '', m.encargado ? `👤 ${m.encargado}` : '', m.zona ?? '']
                      .filter(Boolean).join(' · ') || 'Sin más datos'}
                  </Text>
                </TouchableOpacity>
              ))}

              {!propias.length && !propuestas.length ? (
                <Text style={{ color: colors.muted, marginTop: spacing.md, fontSize: 13 }}>
                  {q
                    ? `Ninguna máquina con «${q}».`
                    : companyId
                      ? 'Esta empresa no tiene máquinas en el catálogo de equipos.'
                      : 'Este contacto no está enlazado a una empresa interna, así que no hay máquinas que proponerle: enlázala aquí arriba, o si es de afuera cárgasela a mano.'}
                  {' '}Tócale «➕ Registrar una máquina que no está» aquí arriba.
                </Text>
              ) : null}
              <View style={{ height: spacing.xl }} />
            </ScrollView>

            <TouchableOpacity onPress={onCerrar} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </>
        )}
      </Screen>
    </Modal>
  );
}
