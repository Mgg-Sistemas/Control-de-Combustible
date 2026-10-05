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
import { COMPANY_MEALS, MEALS, OTROS_TITULO, mealLabel } from '../lib/foodCompanyMeals';
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
import { LineaCesta, avisoCesta, lineasConCantidad, totalCesta, validarCesta } from '../lib/comidaCesta';

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

/** 🧺 Una línea de la cesta del ALTA POR EMPRESA (05-oct-2026): la línea pura de
 *  comidaCesta.ts + su costo POR LÍNEA tal como se teclea y su rótulo. `nueva`
 *  marca la fila «➕ Otra opción», la única con el nombre del plato editable. */
type LineaCestaAlta = LineaCesta & { costo: string; icon: string; nombre: string; nueva?: boolean };

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
  // ➕ (23-sep-2026): el campo para ESCRIBIR una opción de «Otros» sale solo al tocar
  // el ➕. Con HIELO y AGUA en la lista, lo normal es elegir; escribir es la excepción.
  const [nuevaOpcion, setNuevaOpcion] = useState(false);
  const [nota, setNota] = useState('');
  // Buscador de personas.
  const [busca, setBusca] = useState('');
  const [encontrados, setEncontrados] = useState<PersonaComida[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [persona, setPersona] = useState<PersonaComida | null>(null);
  // 🧺 LA CESTA DEL ALTA POR EMPRESA (05-oct-2026). Pedido del cliente: «yo le
  // registro el desayuno al GNB y no puedo registrar más nada ahí […] la idea es
  // poder registrar varios o los que yo quiera o necesite». En vez de elegir UNA
  // comida: una casilla por cada una, con su costo POR LÍNEA, más los platos de
  // «otros». El alta por PERSONA y las correcciones siguen EXACTAMENTE igual.
  const [cestaEmpresa, setCestaEmpresa] = useState<LineaCestaAlta[]>([]);

  const total = entregasEmpresa.length + entregasPersona.length;
  const esHoy = fecha === hoy;

  // La cesta se arma al abrir el alta: las 4 comidas + los platos ACTIVOS del
  // catálogo + la fila ➕ para estrenar una opción (lo que hoy hace `nuevaOpcion`).
  const armarCestaEmpresa = (): LineaCestaAlta[] => [
    ...MEALS.map((m) => ({ mealType: m.key as string, itemLabel: null, cantidad: '', costo: '', icon: m.icon, nombre: m.label })),
    ...ordenarPlatos(platos).filter(platoActivo).map((p) => ({ mealType: 'otros', itemLabel: p.name, cantidad: '', costo: '', icon: '🧾', nombre: p.name })),
    { mealType: 'otros', itemLabel: '', cantidad: '', costo: '', icon: '➕', nombre: '', nueva: true },
  ];

  // El nombre con el que una línea se valida y se cuenta: el plato en «otros»,
  // la comida en las demás. Es el `labelDe` que pide validarCesta.
  const nombreDeLineaCesta = (l: LineaCesta): string =>
    l.mealType === 'otros' ? (l.itemLabel ?? '').trim() : mealLabel(l.mealType as MealType);

  const ponLineaCesta = (i: number, cambio: Partial<LineaCestaAlta>) =>
    setCestaEmpresa((prev) => prev.map((x, j) => (j === i ? { ...x, ...cambio } : x)));

  const abrir = (f: Formulario) => {
    setAviso(null);
    setBusca(''); setEncontrados([]); setPersona(null); setNuevaOpcion(false);
    if (f.modo === 'alta-empresa') {
      setEmpresaId(''); setComida('almuerzo'); setCantidad(''); setCosto(''); setPlato(''); setNota('');
      // 🧺 (05-oct-2026) El alta por empresa ya no elige UNA comida: arma la cesta.
      setCestaEmpresa(armarCestaEmpresa());
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
        // 🧺 CESTA (05-oct-2026): cada casilla con cantidad es UNA entrega, que
        // pasa por validarAltaEmpresa y agregarEntregaEmpresa como siempre.
        // Primero la empresa y la cesta ENTERA (validarCesta): si algo no
        // cuadra, no se guarda NADA.
        const emp = empresas.find((e) => e.id === empresaId);
        if (!emp) { setAviso('❌ Elige la empresa.'); return; }
        const motivo = validarCesta(cestaEmpresa, nombreDeLineaCesta);
        if (motivo) { setAviso('❌ ' + motivo); return; }
        const ok: string[] = [];
        const fallos: { nombre: string; error: string }[] = [];
        const guardadas = new Set<LineaCesta>();
        let avisoPlatos = '';
        // El filtro devuelve las MISMAS líneas de la cesta, por eso el cast es seguro.
        for (const l of lineasConCantidad(cestaEmpresa) as LineaCestaAlta[]) {
          const nombre = nombreDeLineaCesta(l) || l.mealType;
          const v = validarAltaEmpresa(
            { companyId: empresaId, companyName: emp.name, mealType: l.mealType, mealDate: fecha, cantidad: l.cantidad, costo: l.costo, plato: l.itemLabel ?? '', nota },
            hoy,
          );
          // Si una línea falla, se SIGUE con las demás: el aviso final dice el
          // saldo (avisoCesta), para que nadie repita lo que sí entró.
          if (!v.ok) { fallos.push({ nombre, error: v.error }); continue; }
          const { error } = await agregarEntregaEmpresa(v.patch, usuario, esHoy ? new Date().toISOString() : undefined);
          if (error) { fallos.push({ nombre, error }); continue; }
          ok.push(`${v.patch.cantidad} ${nombre}`);
          guardadas.add(l);
          // Una opción estrenada en la fila ➕ queda en la lista de platos, como hoy.
          if (l.nueva) avisoPlatos += await anotarPlatoNuevo(v.patch.plato, platos);
        }
        setAviso(avisoCesta({ ok, fallos }) + avisoPlatos);
        if (ok.length) onCambio();
        if (fallos.length === 0) { cerrarTrasGuardar(); return; }
        // Con fallos el formulario queda ABIERTO: las fallidas conservan su
        // cantidad para reintentar, y las guardadas quedan en blanco para que
        // un segundo toque no las duplique.
        setCestaEmpresa((prev) => prev.map((x) => (guardadas.has(x) ? { ...x, cantidad: '' } : x)));
        return;
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
        // Una opción escrita a mano acá también tiene que quedar en la lista: si no,
        // la entrega no encuentra su precio y nadie sabe que falta ponérselo.
        const avisoPlatoP = await anotarPlatoNuevo(v.patch.itemLabel, platos);
        setAviso(`✅ Agregado: ${v.patch.cantidad} ${v.patch.itemLabel ? v.patch.itemLabel : mealLabel(v.patch.mealType as MealType)} a ${v.patch.employeeName}.${avisoPlatoP}`);
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

  // 🧺 Una fila de la cesta del alta por empresa (05-oct-2026): rótulo (o el
  // nombre a estrenar, en la fila ➕), cantidad y costo POR LÍNEA. Vacía = esa
  // comida no va (regla de comidaCesta.ts). Mismos estilos de `campo`.
  const entradaCesta = { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, color: colors.text, backgroundColor: colors.surface, fontSize: 14 } as const;
  const filaCesta = (l: LineaCestaAlta, i: number) => (
    <View key={'cesta' + i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs }}>
      {l.nueva ? (
        <TextInput
          value={l.itemLabel ?? ''}
          onChangeText={(t) => ponLineaCesta(i, { itemLabel: t })}
          editable={!guardando}
          placeholder="➕ Otra opción (hielo, refresco…)"
          placeholderTextColor={colors.muted}
          style={[entradaCesta, { flex: 1 }]}
        />
      ) : (
        <Text style={{ flex: 1, color: colors.text, fontSize: 13, fontWeight: '700' }}>{l.icon} {l.nombre}</Text>
      )}
      <TextInput
        value={l.cantidad}
        onChangeText={(t) => ponLineaCesta(i, { cantidad: t.replace(/[^0-9]/g, '') })}
        editable={!guardando}
        keyboardType="numeric" placeholder="0" placeholderTextColor={colors.muted}
        style={[entradaCesta, { width: 60, textAlign: 'center', fontWeight: '800' }]}
      />
      <TextInput
        value={l.costo}
        onChangeText={(t) => ponLineaCesta(i, { costo: t.replace(/[^0-9.,]/g, '') })}
        editable={!guardando}
        keyboardType="numeric" placeholder="0,00" placeholderTextColor={colors.muted}
        style={[entradaCesta, { width: 74, textAlign: 'center' }]}
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

  // 🧺 (05-oct-2026) El alta por empresa ya va por la CESTA: los campos sueltos
  // de comida/cantidad/costo/plato quedan para la corrección y el alta por persona.
  const esEditarEmpresa = form?.modo === 'editar-empresa';
  // «Otros» a un contacto de cocina (22-sep-2026): el plato sale del catálogo, sin costo escrito.
  const esContactoOtros = form?.modo === 'alta-persona' && persona?.tipo === 'contacto' && comida === 'otros';
  const platosEnLista = ordenarPlatos(platos).filter(platoActivo);
  /**
   * El campo de texto para el nombre sale SOLO cuando hace falta: al estrenar una
   * opción con el ➕, cuando la lista está vacía, o al corregir una entrega vieja
   * cuyo nombre ya no está en la lista (si no, no habría cómo verlo ni arreglarlo).
   * El último caso es el de siempre: una fila de empresa que quedó con nombre de
   * plato pero con otra comida, para poder borrárselo.
   */
  const platoFueraDeLista = comida === 'otros' && !!plato.trim() && !platoConNombre(platos, plato);
  const mostrarCampoPlato =
    ((esEditarEmpresa || esContactoOtros) && comida === 'otros' && (nuevaOpcion || !platosEnLista.length || platoFueraDeLista))
    || (form?.modo === 'editar-empresa' && comida !== 'otros' && !!form.fila.item_label);

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

              {/* 🧺 ALTA POR EMPRESA (05-oct-2026): la CESTA. Pedido del cliente:
                  «yo le registro el desayuno al GNB y no puedo registrar más nada
                  ahí […] poder registrar varios o los que yo quiera o necesite».
                  Una casilla por comida y por plato de «otros», cada una con su
                  costo POR LÍNEA; la cantidad vacía no se registra. */}
              {form?.modo === 'alta-empresa' ? (
                <View style={{ marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs }}>
                    <Text style={{ flex: 1, color: colors.muted, fontSize: 11, fontWeight: '800' }}>COMIDAS · la cantidad vacía no va</Text>
                    <Text style={{ width: 60, color: colors.muted, fontSize: 10, fontWeight: '800', textAlign: 'center' }}>CANT.</Text>
                    <Text style={{ width: 74, color: colors.muted, fontSize: 10, fontWeight: '800', textAlign: 'center' }}>$ C/U</Text>
                  </View>
                  {cestaEmpresa.map((l, i) => (l.mealType === 'otros' ? null : filaCesta(l, i)))}
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800', marginTop: spacing.sm }}>🧾 {OTROS_TITULO}</Text>
                  {cestaEmpresa.map((l, i) => (l.mealType === 'otros' ? filaCesta(l, i) : null))}
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                    🧺 {totalCesta(cestaEmpresa)} plato(s) en total. Si el plato tiene precio en «🧾 Platos», se cobra ese; el $ de aquí cuenta solo mientras no lo tenga.
                  </Text>
                </View>
              ) : null}

              {/* Comida: en el alta por PERSONA se elige; al corregir se muestra,
                  porque cambiar de comida es otra entrega distinta. */}
              {form?.modo === 'alta-persona' ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: spacing.xs }}>COMIDA</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    {(persona?.tipo === 'contacto' ? COMPANY_MEALS : MEALS).map((m) =>
                      pastilla(`${m.icon} ${m.key === 'otros' ? OTROS_TITULO : m.label}`, comida === m.key, () => {
                        setComida(m.key);
                        // El nombre del plato es solo de «Otros»: al cambiar de comida
                        // se vacía, para que no se pegue a un almuerzo.
                        if (m.key !== 'otros') setPlato('');
                      }),
                    )}
                  </View>
                </View>
              ) : null}
              {form?.modo === 'editar-empresa' || form?.modo === 'editar-persona' ? (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
                  Comida: <Text style={{ color: colors.text, fontWeight: '800' }}>{mealLabel(comida)}</Text> · para cambiarla, borra y vuelve a agregar
                </Text>
              ) : null}

              {form?.modo !== 'alta-empresa'
                ? campo(esEditarEmpresa ? 'CUÁNTOS PLATOS' : 'CUÁNTAS COMIDAS', cantidad, setCantidad, { numerico: true, placeholder: '0' })
                : null}

              {esEditarEmpresa ? campo('COSTO POR PLATO EN $ (opcional)', costo, setCosto, { numerico: true, placeholder: '0,00' }) : null}
              {/* HIELO, AGUA y las que hayan agregado: se ELIGEN con un toque. Escribirlo
                  a mano es como terminan «Bolsa de yelo» y «bolsa hielo» siendo dos
                  opciones con dos precios. El ➕ es para estrenar una, no para volver a
                  escribir cada día la misma (23-sep-2026). */}
              {(esEditarEmpresa || esContactoOtros) && comida === 'otros' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                  {platosEnLista.map((p) => pastilla(
                    `🧾 ${p.name}`,
                    !nuevaOpcion && normPlato(p.name) === normPlato(plato),
                    () => { setNuevaOpcion(false); setPlato(p.name); },
                  ))}
                  {pastilla('➕ Otra opción', nuevaOpcion, () => { setNuevaOpcion(true); setPlato(''); })}
                </View>
              ) : null}
              {mostrarCampoPlato
                ? campo(comida === 'otros' ? 'QUÉ FUE (hielo, agua, refresco…)' : 'NOMBRE DEL PLATO (bórralo si no corresponde)', plato, setPlato, { placeholder: 'Nombre de la opción' })
                : null}
              {/* Al contacto se le cobra el precio del CATÁLOGO (decisión del cliente, 22-sep-2026):
                  por eso el plato se elige de la lista y no se escribe. */}
              {esContactoOtros ? (
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                  {platosEnLista.length
                    ? `Elige la opción de la lista${plato ? ` · elegida: ${plato}` : ''}. Se cobra al precio que tenga en «🧾 Platos».`
                    : 'La lista está vacía: deberían estar HIELO y AGUA. Agrégalas con ➕ o en «💲 Precios y cuentas → 🧾 Platos», que es donde se les pone el precio.'}
                </Text>
              ) : null}
              {esEditarEmpresa && comida === 'otros' ? (
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
