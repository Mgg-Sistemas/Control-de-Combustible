// CORREGIR LAS COMIDAS DE UN DÍA (18-sep-2026).
//
// Pedido del cliente: poder agregar comidas en cualquier día, corregir una
// cantidad que faltó o que sobró, y modificar el histórico de cualquier empresa
// o persona, DESDE EL TELÉFONO.
//
// Vive dentro de «Distribución de comida», en la pestaña «📅 Por día», que ya
// dejaba pararse en cualquier día pasado. Antes esa pestaña era de pura lectura:
// no tenía un solo botón de escribir.
//
// ⚠️ SOLO CON PERMISO COMPLETO DE COMIDA. La cocina sigue registrando lo suyo
//    del día por el QR y el carnet; esto es la corrección del jefe.
//
// ⚠️ PENSADO PARA PANTALLA ANGOSTA, como todo el sistema: nada de columnas
//    fijas. Botonera con `flexWrap`, formulario en hoja inferior con su propio
//    scroll, y el teclado numérico donde va un número. No hay breakpoints
//    porque en este proyecto no existen: la maquetación es fluida.
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Plegable } from './Plegable';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useConfirm } from './ConfirmProvider';
import { COMPANY_MEALS, MEALS, mealLabel } from '../lib/foodCompanyMeals';
import { FoodCompanyMeal, FoodDistribution, MealType } from '../types/database';
import {
  validarCambioEmpresa, validarCambioPersona, validarAltaEmpresa, validarAltaPersona,
  resumenCambioEmpresa, resumenCambioPersona,
} from '../lib/comidaEditar';
import {
  agregarEntregaEmpresa, agregarEntregaPersona, borrarEntregaEmpresa, borrarEntregaPersona,
  buscarPersonasComida, corregirEntregaEmpresa, corregirEntregaPersona, PersonaComida,
} from '../lib/comidaEditarDb';
import { saveExtraItem } from '../lib/foodCompanyMeals';
import { PlatoCatalogo, normPlato, ordenarPlatos, platoActivo, platoConNombre } from '../lib/comidaPlatos';

type Empresa = { id: string; name: string };

type Props = {
  /** El día que se está viendo (ISO Caracas). */
  fecha: string;
  hoy: string;
  entregasEmpresa: FoodCompanyMeal[];
  entregasPersona: FoodDistribution[];
  empresas: Empresa[];
  usuario: { id: string | null; nombre: string | null };
  /** Catálogo de platos de «Otros» (pestaña «🧾 Platos»), para elegir el plato con un toque. */
  platos?: PlatoCatalogo[] | null;
  /** Se llama después de guardar o borrar, para que la pantalla recargue. */
  onCambio: () => void;
};

type Formulario =
  | { modo: 'alta-empresa' }
  | { modo: 'alta-persona' }
  | { modo: 'editar-empresa'; fila: FoodCompanyMeal }
  | { modo: 'editar-persona'; fila: FoodDistribution };

const hora = (iso: unknown) => {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
};
const diaLargo = (iso: string) =>
  new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(iso + 'T12:00:00'));

/**
 * Un plato escrito a mano que no está en la lista se agrega a ella, igual que cuando
 * lo escribe la cocina: así aparece en «🧾 Platos» (en amarillo, sin precio) y alguien
 * se lo pone. Si falla, la entrega ya quedó guardada con su nombre: solo se avisa.
 */
async function anotarPlatoNuevo(nombre: string | null | undefined, platos: PlatoCatalogo[] | null | undefined): Promise<string> {
  if (!nombre || platoConNombre(platos, nombre)) return '';
  const { error } = await saveExtraItem(nombre);
  return error ? ` (El plato «${nombre}» no se pudo agregar a la lista de platos: ${error}.)` : ` «${nombre}» quedó en la lista de platos sin precio: pónselo en «🧾 Platos».`;
}

export function ComidaEditor({ fecha, hoy, entregasEmpresa, entregasPersona, empresas, usuario, platos, onCambio }: Props) {
  const { colors } = useTheme();
  const confirm = useConfirm();

  const [form, setForm] = useState<Formulario | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Campos del formulario (los comparten el alta y la edición: son los mismos).
  const [empresaId, setEmpresaId] = useState('');
  const [comida, setComida] = useState<MealType>('almuerzo');
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [plato, setPlato] = useState('');
  const [nota, setNota] = useState('');
  // Buscador de personas.
  const [busca, setBusca] = useState('');
  const [encontrados, setEncontrados] = useState<PersonaComida[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [persona, setPersona] = useState<PersonaComida | null>(null);

  const total = entregasEmpresa.length + entregasPersona.length;
  const esHoy = fecha === hoy;

  const abrir = (f: Formulario) => {
    setAviso(null);
    setBusca(''); setEncontrados([]); setPersona(null);
    if (f.modo === 'alta-empresa') {
      setEmpresaId(''); setComida('almuerzo'); setCantidad(''); setCosto(''); setPlato(''); setNota('');
    } else if (f.modo === 'alta-persona') {
      setComida('almuerzo'); setCantidad('1'); setNota('');
    } else if (f.modo === 'editar-empresa') {
      setEmpresaId(f.fila.company_id ?? '');
      setComida(f.fila.meal_type);
      setCantidad(String(f.fila.delivered ?? ''));
      setCosto(String(Number(f.fila.unit_cost) || 0));
      setPlato(f.fila.item_label ?? '');
      setNota(f.fila.note ?? '');
    } else {
      setComida((f.fila.meal_type ?? 'almuerzo') as MealType);
      setCantidad(String(f.fila.meals ?? ''));
      setNota(f.fila.note ?? '');
    }
    setForm(f);
  };

  // Cerrar a mano (✕ o tocar fuera) limpia el aviso: un error viejo del
  // formulario no tiene que quedar pegado en la tarjeta.
  const cerrar = () => { setForm(null); setAviso(null); };
  // ⚠️ Después de GUARDAR se cierra SIN limpiar el aviso. Si se usara `cerrar`,
  //    el «✅ Agregado…» se borraba en el mismo instante en que se escribía y
  //    quien corrigió nunca veía que se guardó.
  const cerrarTrasGuardar = () => setForm(null);

  const buscarPersona = async (t: string) => {
    setBusca(t);
    setPersona(null);
    if (t.trim().length < 2) { setEncontrados([]); return; }
    setBuscando(true);
    try { setEncontrados(await buscarPersonasComida(t, empresas)); } finally { setBuscando(false); }
  };

  const guardar = async () => {
    if (!form) return;
    setGuardando(true);
    setAviso(null);
    try {
      if (form.modo === 'alta-empresa') {
        const emp = empresas.find((e) => e.id === empresaId);
        const v = validarAltaEmpresa(
          { companyId: empresaId, companyName: emp?.name, mealType: comida, mealDate: fecha, cantidad, costo, plato, nota },
          hoy,
        );
        if (!v.ok) { setAviso('❌ ' + v.error); return; }
        const { error } = await agregarEntregaEmpresa(v.patch, usuario, esHoy ? new Date().toISOString() : undefined);
        if (error) { setAviso('❌ ' + error); onCambio(); return; }
        const avisoPlato = await anotarPlatoNuevo(v.patch.plato, platos);
        setAviso(`✅ Agregado: ${v.patch.cantidad} ${mealLabel(v.patch.mealType as MealType)}${v.patch.plato ? ` (${v.patch.plato})` : ''} a ${v.patch.companyName}.${avisoPlato}`);
        onCambio(); cerrarTrasGuardar(); return;
      }

      if (form.modo === 'alta-persona') {
        // Un contacto de cocina va por SU columna, con a quién se le cobra congelado.
        const esContacto = persona?.tipo === 'contacto';
        const v = validarAltaPersona(
          {
            employeeId: esContacto ? null : persona?.id, contactoId: esContacto ? persona?.id : null,
            employeeName: persona?.nombre, cedula: persona?.cedula, mealType: comida, distributionDate: fecha, cantidad, nota,
            cobrarA: persona?.cobrarA, contactoCompanyId: persona?.companyId, contactoCompanyNombre: persona?.companyName, plato,
          },
          hoy,
        );
        if (!v.ok) { setAviso('❌ ' + v.error); return; }
        const { error } = await agregarEntregaPersona(v.patch, usuario, esHoy ? new Date().toISOString() : undefined);
        if (error) { setAviso('❌ ' + error); onCambio(); return; }
        setAviso(`✅ Agregado: ${v.patch.cantidad} ${v.patch.itemLabel ? v.patch.itemLabel : mealLabel(v.patch.mealType as MealType)} a ${v.patch.employeeName}.`);
        onCambio(); cerrarTrasGuardar(); return;
      }

      if (form.modo === 'editar-empresa') {
        const v = validarCambioEmpresa(form.fila, { cantidad, costo, plato, nota });
        if (!v.ok) { setAviso('❌ ' + v.error); return; }
        const { error } = await corregirEntregaEmpresa(form.fila.id, v.patch);
        // Un rechazo puede ser que OTRO la borró mientras tanto: se recarga para
        // que la lista deje de ofrecer una entrega que ya no existe.
        if (error) { setAviso('❌ ' + error); onCambio(); return; }
        const avisoPlato = form.fila.meal_type === 'otros' ? await anotarPlatoNuevo(v.patch.plato, platos) : '';
        setAviso(resumenCambioEmpresa(form.fila, v.patch) + avisoPlato);
        onCambio(); cerrarTrasGuardar(); return;
      }

      const v = validarCambioPersona(form.fila, { cantidad, nota });
      if (!v.ok) { setAviso('❌ ' + v.error); return; }
      const { error } = await corregirEntregaPersona(form.fila.id, v.patch);
      if (error) { setAviso('❌ ' + error); onCambio(); return; }
      setAviso(resumenCambioPersona(form.fila, v.patch));
      onCambio(); cerrarTrasGuardar();
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (via: 'empresa' | 'persona', id: string, que: string) => {
    const ok = await confirm({
      title: '¿Borrar esta entrega?',
      message: `Se va a borrar ${que}.\n\nQueda registrado quién la borró y cuándo, con todos sus datos, en «🕵️ Quién tocó las comidas».`,
      confirmText: 'Sí, borrar',
      danger: true,
    });
    if (!ok) return;
    const { error } = via === 'empresa' ? await borrarEntregaEmpresa(id) : await borrarEntregaPersona(id);
    setAviso(error ? '❌ ' + error : '✅ Entrega borrada. Quedó el registro de quién la borró.');
    if (!error) onCambio();
  };

  // ── Piezas de la interfaz ────────────────────────────────────────────────
  const boton = (texto: string, onPress: () => void, color: string, contraste: string, deshabilitado = false) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={deshabilitado}
      style={{ flexGrow: 1, minWidth: 150, backgroundColor: color, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: 'center', opacity: deshabilitado ? 0.5 : 1 }}
    >
      <Text style={{ color: contraste, fontWeight: '800', fontSize: 13 }}>{texto}</Text>
    </TouchableOpacity>
  );

  const pastilla = (texto: string, encendida: boolean, onPress: () => void) => (
    <TouchableOpacity
      key={texto}
      onPress={onPress}
      style={{ borderRadius: radius.pill, borderWidth: 1.5, borderColor: encendida ? colors.brand : colors.border, backgroundColor: encendida ? colors.brand : colors.surface, paddingHorizontal: spacing.md, paddingVertical: 6 }}
    >
      <Text style={{ color: encendida ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{texto}</Text>
    </TouchableOpacity>
  );

  const campo = (etiqueta: string, valor: string, onChange: (v: string) => void, opts: { numerico?: boolean; placeholder?: string } = {}) => (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 2 }}>{etiqueta}</Text>
      <TextInput
        value={valor}
        onChangeText={onChange}
        placeholder={opts.placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={opts.numerico ? 'numeric' : 'default'}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, backgroundColor: colors.surface, fontSize: 15 }}
      />
    </View>
  );

  const renglon = (
    clave: string, icono: string, titulo: string, detalle: string,
    onEditar: () => void, onBorrar: () => void,
  ) => (
    <View key={clave} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
      <View style={{ flex: 1, minWidth: 160 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{icono} {titulo}</Text>
        <Text style={{ color: colors.muted, fontSize: 11 }}>{detalle}</Text>
      </View>
      <TouchableOpacity onPress={onEditar} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>✏️ Corregir</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onBorrar} style={{ borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
        <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑️</Text>
      </TouchableOpacity>
    </View>
  );

  const tituloForm = useMemo(() => {
    if (!form) return '';
    if (form.modo === 'alta-empresa') return '➕ Agregar comida a una empresa';
    if (form.modo === 'alta-persona') return '➕ Agregar comida a una persona';
    if (form.modo === 'editar-empresa') return '✏️ Corregir la entrega de la empresa';
    return '✏️ Corregir la entrega de la persona';
  }, [form]);

  const esEmpresa = form?.modo === 'alta-empresa' || form?.modo === 'editar-empresa';
  const esAlta = form?.modo === 'alta-empresa' || form?.modo === 'alta-persona';
  // «Otros» a un contacto de cocina (22-sep-2026): el plato sale del catálogo, sin costo escrito.
  const esContactoOtros = form?.modo === 'alta-persona' && persona?.tipo === 'contacto' && comida === 'otros';
  const platosEnLista = ordenarPlatos(platos).filter(platoActivo);

  return (
    <Plegable
      titulo="✏️ Agregar o corregir las comidas de este día"
      resumen={`${total} entrega(s) el ${diaLargo(fecha)}${esHoy ? '' : ' · día pasado'}`}
    >
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Se puede agregar lo que faltó y corregir lo que se pasó, en este día o en cualquier día anterior.
        Todo cambio queda registrado con tu nombre y la hora en «🕵️ Quién tocó las comidas».
      </Text>

      {aviso ? (
        <Text style={{ color: aviso.startsWith('❌') ? colors.danger : colors.success, fontSize: 12, fontWeight: '700', marginBottom: spacing.sm }}>{aviso}</Text>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {boton('➕ A una empresa', () => abrir({ modo: 'alta-empresa' }), colors.brand, colors.brandContrast)}
        {boton('➕ A una persona', () => abrir({ modo: 'alta-persona' }), colors.accent, colors.accentContrast)}
      </View>

      {entregasEmpresa.length === 0 && entregasPersona.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Este día no tiene ninguna entrega registrada todavía.</Text>
      ) : null}

      {entregasEmpresa.map((r) =>
        renglon(
          'e' + r.id,
          '🏢',
          `${r.company_name} · ${mealLabel(r.meal_type)}${r.item_label ? ` (${r.item_label})` : ''}`,
          `${r.delivered} plato(s)${Number(r.unit_cost) > 0 ? ` · $${Number(r.unit_cost)} c/u` : ''}${hora(r.delivered_at) ? ` · ${hora(r.delivered_at)}` : ''}${r.created_by_name ? ` · por ${r.created_by_name}` : ''}`,
          () => abrir({ modo: 'editar-empresa', fila: r }),
          () => borrar('empresa', r.id, `${r.delivered} ${mealLabel(r.meal_type)} de ${r.company_name}`),
        ),
      )}

      {entregasPersona.map((r) =>
        renglon(
          'p' + r.id,
          '👤',
          `${r.employee_name} · ${r.meal_type ? mealLabel(r.meal_type) : 'sin comida marcada'}${r.item_label ? ` (${r.item_label})` : ''}`,
          `${r.meals} comida(s)${hora(r.delivered_at) ? ` · ${hora(r.delivered_at)}` : ''}${r.created_by_name ? ` · por ${r.created_by_name}` : ''}`,
          () => abrir({ modo: 'editar-persona', fila: r }),
          () => borrar('persona', r.id, `${r.meals} ${r.item_label ? r.item_label : r.meal_type ? mealLabel(r.meal_type) : 'comida(s)'} de ${r.employee_name}`),
        ),
      )}

      {/* Formulario en HOJA INFERIOR: el mismo patrón del modal de reportes, que
          es el que ya funciona bien en el teléfono. */}
      <Modal visible={!!form} transparent animationType="slide" onRequestClose={cerrar}>
        <Pressable onPress={cerrar} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '90%', padding: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, flex: 1 }} numberOfLines={2}>{tituloForm}</Text>
              <TouchableOpacity onPress={cerrar} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>Cerrar ✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
              Día: <Text style={{ color: colors.text, fontWeight: '800', textTransform: 'capitalize' }}>{diaLargo(fecha)}</Text>
              {esHoy ? '' : ' (día pasado)'}
            </Text>

            <ScrollView keyboardShouldPersistTaps="handled">
              {/* Empresa: solo al dar de alta. Mover una entrega de empresa es
                  borrarla y hacerla de nuevo, para que quede el rastro. */}
              {form?.modo === 'alta-empresa' ? (
                <View style={{ marginTop: spacing.xs }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: spacing.xs }}>EMPRESA</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    {empresas.map((e) => pastilla(e.name, empresaId === e.id, () => setEmpresaId(e.id)))}
                  </View>
                </View>
              ) : null}

              {form?.modo === 'editar-empresa' ? (
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800', marginTop: spacing.xs }}>
                  🏢 {form.fila.company_name}
                  <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 11 }}>  · la empresa y el día no se cambian: para eso, borra y vuelve a agregar</Text>
                </Text>
              ) : null}

              {form?.modo === 'editar-persona' ? (
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800', marginTop: spacing.xs }}>
                  👤 {form.fila.employee_name}
                  <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 11 }}>  · la persona y el día no se cambian</Text>
                </Text>
              ) : null}

              {/* Buscador de personas, solo al dar de alta. */}
              {form?.modo === 'alta-persona' ? (
                <>
                  {campo('PERSONA (nombre, apellido o cédula)', busca, buscarPersona, { placeholder: 'Escribe al menos 2 letras…' })}
                  {buscando ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Buscando…</Text> : null}
                  {!buscando && !persona && busca.trim().length >= 2 && encontrados.length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>No se encontró a nadie con eso. Prueba con el apellido o la cédula.</Text>
                  ) : null}
                  {persona ? (
                    <Text style={{ color: colors.success, fontSize: 13, fontWeight: '800', marginTop: spacing.xs }}>
                      ✅ {persona.tipo === 'contacto' ? '📇 ' : ''}{persona.nombre}{persona.cedula ? ` · C.I ${persona.cedula}` : ''}
                      {persona.tipo === 'contacto' ? (
                        <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 11 }}>
                          {'  '}· contacto de cocina · se le cobra a {persona.cobrarA === 'empresa' ? persona.companyName : 'él mismo'}
                        </Text>
                      ) : null}
                    </Text>
                  ) : (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                      {/* Los contactos van marcados con 📇: a un contacto se le puede cargar
                          «Otros» y a alguien de nómina no, y conviene ver a cuál se le agrega. */}
                      {encontrados.map((p) =>
                        pastilla(`${p.tipo === 'contacto' ? '📇 ' : ''}${p.nombre}${p.cedula ? ` · ${p.cedula}` : ''}`, false, () => {
                          setPersona(p); setEncontrados([]);
                          // «Otros» es solo para contactos: si cambia a alguien de nómina, se baja.
                          if (p.tipo !== 'contacto' && comida === 'otros') { setComida('almuerzo'); setPlato(''); }
                        }),
                      )}
                    </View>
                  )}
                </>
              ) : null}

              {/* Comida: al dar de alta se elige; al corregir se muestra, porque
                  cambiar de comida es otra entrega distinta. */}
              {esAlta ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: spacing.xs }}>COMIDA</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    {(form?.modo === 'alta-empresa' || persona?.tipo === 'contacto' ? COMPANY_MEALS : MEALS).map((m) =>
                      pastilla(`${m.icon} ${m.label}`, comida === m.key, () => {
                        setComida(m.key);
                        // El nombre del plato es solo de «Otros»: al cambiar de comida
                        // se vacía, para que no se pegue a un almuerzo.
                        if (m.key !== 'otros') setPlato('');
                      }),
                    )}
                  </View>
                </View>
              ) : (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
                  Comida: <Text style={{ color: colors.text, fontWeight: '800' }}>{mealLabel(comida)}</Text> · para cambiarla, borra y vuelve a agregar
                </Text>
              )}

              {campo(esEmpresa ? 'CUÁNTOS PLATOS' : 'CUÁNTAS COMIDAS', cantidad, setCantidad, { numerico: true, placeholder: '0' })}

              {esEmpresa ? campo('COSTO POR PLATO EN $ (opcional)', costo, setCosto, { numerico: true, placeholder: '0,00' }) : null}
              {esEmpresa && (comida === 'otros' || (form?.modo === 'editar-empresa' && !!form.fila.item_label))
                ? campo(comida === 'otros' ? 'QUÉ FUE (postre, hielo, refresco…)' : 'NOMBRE DEL PLATO (bórralo si no corresponde)', plato, setPlato, { placeholder: 'Nombre del plato' })
                : null}
              {/* Los platos de la lista, con un toque: escribirlo a mano es como terminan
                  «Bolsa de yelo» y «bolsa hielo» siendo dos platos con dos precios. */}
              {(esEmpresa || esContactoOtros) && comida === 'otros' && platosEnLista.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                  {platosEnLista.map((p) => pastilla(`🧾 ${p.name}`, normPlato(p.name) === normPlato(plato), () => setPlato(p.name)))}
                </View>
              ) : null}
              {/* Al contacto se le cobra el precio del CATÁLOGO (decisión del cliente, 22-sep-2026):
                  por eso el plato se elige de la lista y no se escribe. */}
              {esContactoOtros ? (
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                  {platosEnLista.length
                    ? `Elige el plato de la lista${plato ? ` · elegido: ${plato}` : ''}. Se cobra al precio que tenga en «🧾 Platos».`
                    : 'No hay platos en la lista. Se agregan en «💲 Precios y cuentas → 🧾 Platos».'}
                </Text>
              ) : null}
              {esEmpresa && comida === 'otros' ? (
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                  Si el plato tiene precio en «🧾 Platos», se cobra ese precio; el costo de aquí cuenta solo mientras no lo tenga.
                </Text>
              ) : null}

              {campo('NOTA (opcional)', nota, setNota, { placeholder: 'Por qué se corrigió, por ejemplo' })}

              {aviso ? (
                <Text style={{ color: aviso.startsWith('❌') ? colors.danger : colors.success, fontSize: 12, fontWeight: '700', marginTop: spacing.sm }}>{aviso}</Text>
              ) : null}

              <TouchableOpacity
                onPress={guardar}
                disabled={guardando}
                style={{ marginTop: spacing.lg, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', opacity: guardando ? 0.6 : 1 }}
              >
                <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 14 }}>{guardando ? 'Guardando…' : '💾 Guardar'}</Text>
              </TouchableOpacity>
              <View style={{ height: spacing.xl }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Plegable>
  );
}
