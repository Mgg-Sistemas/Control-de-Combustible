// ============================================================================
// 🏭 CENTRO DE OPERACIONES — ⚙️ AJUSTES (24-oct-2026, fase 1).
//
// Tres bloques, todos de Full (la RLS lo exige también: sin 'full' la base no
// guarda y la capa de datos lo dice en español, que acá sale en un toast):
//
//   · 📍 SITIOS: crear, renombrar (con su nota) y desactivar / reactivar.
//     ⭐ Un sitio NUNCA se borra: desactivado deja de salir en el selector, pero
//        su flota, sus listas, sus textos y sus registros siguen ahí.
//   · 📚 LISTAS DE APOYO por clase (transportistas, orígenes, destinos,
//     materiales y patios —la clase `terraza`—): crear, renombrar y desactivar / reactivar, A→Z.
//     Un nombre puede ser de este sitio o «para todos los sitios» (sitio null).
//   · 📝 TEXTOS FIJOS DEL PAPEL, en cop_ajustes DEL SITIO: los dos títulos, la
//     presentación, las consideraciones y los logos (por defecto solo Golden
//     Touch). 📄 Reportes los trae puestos; ahí se cambian para un papel en
//     particular sin tocar estos.
//
// 📅 PARTE DIARIO (PD4, 24-oct-2026):
//   · Cada sitio lleva su GPS (latitud y longitud escritas), en «✏️ Editar».
//   · Los DESTINOS llevan su GPS y sus km POR CARRETERA desde el sitio. El botón
//     «📏 Sugerir km en línea recta» los calcula del GPS del sitio al del destino, dicho
//     como tal: en línea recta, por carretera es más (ella confirma los de verdad).
//   · Los MATERIALES llevan su factor t/m³ (agregados: 1,2) y los días hasta estar
//     disponible para la venta (bloques: 7).
//   · La clase `terraza` se muestra «Patio» (se sigue guardando como 'terraza').
//   Las cuentas (coordenadas, días, km) viven en src/lib/centroOperacionesMaquinariaBloques.ts.
//
// Se abre también SIN sitio: es donde se crea el primero. Al crear, renombrar o
// desactivar un sitio le avisa a la pantalla (`alCambiarSitios`) para que el
// selector de arriba se entere.
//
// ⭐ Habla SOLO con centroOperacionesDb (nunca directo con la base) y no tiene
//    ninguna función de borrar: lo vigila
//    scripts/test-centro-operaciones-ajustes-flota.mjs.
// ============================================================================
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from '../ui';
import { Toggle } from '../CubicajeTab';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets } from '../../lib/permissions';
import { cmpText, norm } from '../../lib/text';
import type { ClaseLista, ItemLista, Sitio } from '../../lib/centroOperaciones';
import {
  cargarSitios, guardarSitio, cargarListas, guardarItemLista, cargarAjustes, guardarAjuste,
} from '../../lib/centroOperacionesDb';
import { cifraDeCampo, parDeCoordenadas } from '../../lib/centroOperacionesCarga';
import {
  coordenadaDeCampo, diasDeCampo, kmSugerido, materialDeBloques, textoSugerenciaKm, tieneGps,
} from '../../lib/centroOperacionesMaquinariaBloques';
import { logosDe, textosDe } from '../../lib/centroOperacionesPapel';
import type { ClaveTextoCop, LogosCop, TextosCop } from '../../lib/centroOperacionesPapel';
import type { PropsAjustesCop } from '../../screens/CentroOperacionesScreen';

type Props = PropsAjustesCop & {
  /** La pantalla recarga su selector de sitios cuando acá se crea, renombra o desactiva uno. */
  alCambiarSitios?: () => void;
};

// ── Las cinco listas de apoyo (las clases de cop_listas) ─────────────────────
const CLASES: { clase: ClaseLista; label: string; ayuda: string }[] = [
  { clase: 'transportista', label: '🚚 Transportistas', ayuda: 'Las contratistas que traen o se llevan el material.' },
  { clase: 'origen', label: '📤 Orígenes', ayuda: 'De dónde viene: frentes, obras, canteras.' },
  { clase: 'destino', label: '📥 Destinos', ayuda: 'A dónde va lo que sale del sitio.' },
  { clase: 'material', label: '🪨 Materiales', ayuda: 'Escombro, arena, granzón…' },
  // La clase se llama 'terraza' en la base; en pantalla, «Patio» (24-oct-2026).
  { clase: 'terraza', label: '⛰️ Patios', ayuda: 'Los patios del sitio (A, B, C…): por dónde entra el material; se usan como origen y como destino.' },
];

/** Una cifra para mostrar (es-VE). */
const cifra = (n: number, dec = 2): string => n.toLocaleString('es-VE', { maximumFractionDigits: dec });
/** Una cifra guardada → el texto del campo (con coma decimal, como se escribe acá). */
const aCampo = (n: number | null | undefined): string => (n == null ? '' : String(n).replace('.', ','));

/** Lo que se está editando de un nombre de lista: el nombre y, según la clase, sus datos. */
type EdicionItem = {
  id: string; nombre: string; clase: ClaseLista; sitioId: string | null;
  lat: string; lng: string; km: string; factor: string; dias: string;
};

/** Lo que se está editando de un sitio: nombre, nota y GPS (como texto mientras se escribe). */
type EdicionSitio = { id: string; nombre: string; nota: string; lat: string; lng: string };

/**
 * Lo escrito en un campo de GPS. Si se pegó el par «lat, lng» como lo copia Google Maps
 * («10.6012, -66.9301»), se reparte en los dos campos (lote 5, B17); si no, va a su campo.
 */
function coordEscrita(campo: 'lat' | 'lng', v: string): { lat?: string; lng?: string } {
  const par = parDeCoordenadas(v);
  if (par) return { lat: par.lat, lng: par.lng };
  return campo === 'lat' ? { lat: v } : { lng: v };
}

// ── Los textos fijos del papel (claves de cop_ajustes) ───────────────────────
// ⭐ Cómo se LEEN (y el defecto de los logos) vive en la librería de los papeles
//    (`textosDe`, `logosDe`): 📄 Reportes lee lo mismo, así no se contradicen.
const TEXTOS: { clave: ClaveTextoCop; label: string; ayuda: string; largo: boolean }[] = [
  { clave: 'titulo_consolidado', label: '🏷️ Título del consolidado', ayuda: 'El encabezado del papel consolidado del sitio.', largo: false },
  { clave: 'titulo_corte', label: '🏷️ Título del corte por unidad', ayuda: 'El encabezado de cada hoja del corte.', largo: false },
  { clave: 'presentacion', label: '📝 Presentación', ayuda: 'El párrafo que abre el consolidado.', largo: true },
  { clave: 'consideraciones', label: '📌 Consideraciones', ayuda: 'Las notas que cierran el papel.', largo: true },
];

const LOGOS: { k: keyof LogosCop; label: string }[] = [
  { k: 'golden', label: '✨ Golden Touch' },
  { k: 'bcv', label: '🏦 Banco Central de Venezuela' },
  { k: 'sos', label: '🛟 SOS La Guaira' },
  { k: 'renace', label: '🇻🇪 Plan Venezuela Renace' },
  { k: 'jhenzaen', label: '🏗️ Jhenzaen 2.012 C.A' },
];

type Textos = TextosCop;

/** Sin nada guardado: los textos en blanco y el membrete por defecto (solo Golden Touch). */
const TEXTOS_VACIOS: Textos = textosDe({});

/** Mismo nombre escrito distinto («Terraza 1» y « terraza 1 ») = el mismo. */
const mismoNombre = (a: string, b: string): boolean => norm(a.trim().replace(/\s+/g, ' ')) === norm(b.trim().replace(/\s+/g, ' '));

export default function AjustesTab({ sitio, nivel, alCambiarSitios }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  // ⭐ Solo Full cambia algo (la RLS también lo exige). Sin Full, todo se ve y nada se toca.
  const puedeCambiar = levelMeets(nivel, 'full');

  const [cargando, setCargando] = useState(true);
  /** La carga falló: se dice, en vez de «Todavía no hay sitios» o «La lista está vacía»
   *  (que invitarían a crear de nuevo lo que ya existe). */
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // 📍 Sitios (TODOS, también los desactivados: acá se reactivan).
  const [sitios, setSitios] = useState<Sitio[]>([]);
  const [nuevoSitio, setNuevoSitio] = useState('');
  const [nuevaNota, setNuevaNota] = useState('');
  const [editSitio, setEditSitio] = useState<EdicionSitio | null>(null);

  // 📚 Listas del sitio (las suyas y las de todos los sitios).
  const [items, setItems] = useState<ItemLista[]>([]);
  const [clase, setClase] = useState<ClaseLista>('transportista');
  const [nuevoItem, setNuevoItem] = useState('');
  const [paraTodos, setParaTodos] = useState(false);
  const [editItem, setEditItem] = useState<EdicionItem | null>(null);
  /** El resultado de «Sugerir km en línea recta» (se muestra junto al campo de km). */
  const [sugerenciaKm, setSugerenciaKm] = useState<string | null>(null);
  const [verDesactivados, setVerDesactivados] = useState(false);

  // 📝 Textos fijos: lo guardado (base) y lo que se está escribiendo (form).
  const [base, setBase] = useState<Textos>(TEXTOS_VACIOS);
  const [form, setForm] = useState<Textos>(TEXTOS_VACIOS);
  const sucio = TEXTOS.some((t) => form[t.clave] !== base[t.clave]) || LOGOS.some(({ k }) => form.logos[k] !== base.logos[k]);
  // Al refrescar (volver a la pantalla, deslizar) no se pisa lo que se está
  // escribiendo sin guardar, salvo que se haya cambiado de sitio.
  const sucioRef = useRef(false);
  sucioRef.current = sucio;
  const textosDelSitio = useRef<string | null>(null);

  // ⭐ Depende del objeto `sitio`: la pantalla lo vuelve a crear cada vez que
  //    recarga (al entrar y al deslizar), así esta pestaña refresca con ella.
  // ⭐ Al cambiar de sitio la pantalla la vuelve a MONTAR (key = el sitio): las listas
  //    y los textos sin guardar del sitio anterior no quedan a la vista ni a mano.
  const cargar = useCallback(async () => {
    try {
      const [todos, listas, ajustes] = await Promise.all([
        cargarSitios(),
        sitio ? cargarListas(sitio.id) : Promise.resolve([] as ItemLista[]),
        sitio ? cargarAjustes(sitio.id) : Promise.resolve(null),
      ]);
      setSitios(todos);
      setItems(listas);
      if (sitio && ajustes) {
        const leidos = textosDe(ajustes);
        const otroSitio = textosDelSitio.current !== sitio.id;
        setBase(leidos);
        if (otroSitio || !sucioRef.current) setForm(leidos);
        textosDelSitio.current = sitio.id;
      }
      setError(null);
    } catch (e: any) {
      const msg = e?.message || 'No se pudieron cargar los ajustes.';
      setError(msg);
      toast.error(msg);
    } finally {
      setCargando(false);
    }
  }, [sitio]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  /** «🔄 Reintentar» la carga (revisión final B-M4): en web deslizar no hace nada. */
  const [reintentando, setReintentando] = useState(false);
  const reintentar = async () => {
    if (reintentando) return;
    setReintentando(true);
    try { await cargar(); } finally { setReintentando(false); }
  };

  /** Una escritura: avisa el resultado, recarga y (si toca sitios) avisa a la pantalla. */
  const hacer = async (accion: () => Promise<unknown>, exito: string, tocaSitios = false): Promise<boolean> => {
    if (ocupado) return false;
    setOcupado(true);
    try {
      await accion();
      toast.success(exito);
      await cargar();
      if (tocaSitios) alCambiarSitios?.();
      return true;
    } catch (e: any) {
      toast.error(e?.message || 'No se guardó.');
      return false;
    } finally {
      setOcupado(false);
    }
  };

  // ═══════════════════════════ 📍 Sitios ═══════════════════════════

  // Los activos primero, cada grupo A→Z.
  const sitiosOrdenados = useMemo(
    () => [...sitios].sort((a, b) => Number(b.activo) - Number(a.activo) || cmpText(a.nombre, b.nombre)),
    [sitios],
  );

  const crearSitio = async () => {
    const nombre = nuevoSitio.trim().replace(/\s+/g, ' ');
    if (!nombre) { toast.error('Escribe el nombre del sitio.'); return; }
    if (sitios.some((s) => s.activo && mismoNombre(s.nombre, nombre))) { toast.error('Ya existe un sitio activo con ese nombre.'); return; }
    const ok = await hacer(
      () => guardarSitio({ nombre, nota: nuevaNota.trim() || null, activo: true }),
      `Sitio «${nombre}» creado.`,
      true,
    );
    if (ok) { setNuevoSitio(''); setNuevaNota(''); }
  };

  // El GPS del sitio en edición, leído en vivo (coma o punto decimal).
  const latSitio = coordenadaDeCampo(editSitio?.lat ?? '', 'lat');
  const lngSitio = coordenadaDeCampo(editSitio?.lng ?? '', 'lng');

  const renombrarSitio = async () => {
    if (!editSitio) return;
    const nombre = editSitio.nombre.trim().replace(/\s+/g, ' ');
    if (!nombre) { toast.error('El sitio necesita un nombre.'); return; }
    const actual = sitios.find((s) => s.id === editSitio.id);
    if (sitios.some((s) => s.id !== editSitio.id && s.activo && actual?.activo && mismoNombre(s.nombre, nombre))) {
      toast.error('Ya existe un sitio activo con ese nombre.');
      return;
    }
    if (latSitio.error || lngSitio.error) { toast.error(`GPS: ${latSitio.error ?? lngSitio.error}`); return; }
    if ((latSitio.valor === null) !== (lngSitio.valor === null)) { toast.error('GPS: escribe la latitud y la longitud, o deja las dos vacías.'); return; }
    const lat = latSitio.valor;
    const lng = lngSitio.valor;
    const ok = await hacer(
      () => guardarSitio({ id: editSitio.id, nombre, nota: editSitio.nota.trim() || null, lat, lng }),
      `Sitio «${nombre}» guardado.`,
      true,
    );
    if (ok) setEditSitio(null);
  };

  const desactivarSitio = async (s: Sitio) => {
    const si = await confirm({
      title: 'Desactivar sitio',
      message: `«${s.nombre}» deja de salir en el selector. Su flota, sus listas, sus textos y sus registros se conservan, y vuelve con «Reactivar».`,
      confirmText: 'Desactivar',
      danger: true,
    });
    if (!si) return;
    await hacer(() => guardarSitio({ id: s.id, activo: false }), `Sitio «${s.nombre}» desactivado.`, true);
  };

  const reactivarSitio = (s: Sitio) =>
    hacer(() => guardarSitio({ id: s.id, activo: true }), `Sitio «${s.nombre}» reactivado.`, true);

  // ═══════════════════════════ 📚 Listas ═══════════════════════════

  const deLaClase = useMemo(() => items.filter((i) => i.clase === clase), [items, clase]);
  const activosClase = useMemo(
    () => deLaClase.filter((i) => i.activo).sort((a, b) => cmpText(a.nombre, b.nombre)),
    [deLaClase],
  );
  const desactivadosClase = useMemo(
    () => deLaClase.filter((i) => !i.activo).sort((a, b) => cmpText(a.nombre, b.nombre)),
    [deLaClase],
  );
  const infoClase = CLASES.find((c) => c.clase === clase) ?? CLASES[0];
  /** El material de 🧱 Bloques con LA regla de ese bloque (lote 5, B16): el que se llama
   *  «Bloques» o, si no hay, el primero marcado con días. Se marca en la lista. */
  const deBloques = useMemo(() => materialDeBloques(items), [items]);

  const crearItem = async () => {
    if (!sitio) return;
    const nombre = nuevoItem.trim().replace(/\s+/g, ' ');
    if (!nombre) { toast.error('Escribe el nombre.'); return; }
    if (activosClase.some((i) => mismoNombre(i.nombre, nombre))) { toast.error('Ese nombre ya está en la lista.'); return; }
    const ok = await hacer(
      () => guardarItemLista({ sitioId: paraTodos ? null : sitio.id, clase, nombre, activo: true }),
      `«${nombre}» agregado${paraTodos ? ' para todos los sitios' : ''}.`,
    );
    if (ok) setNuevoItem('');
  };

  /** Abre la edición de un nombre de lista, con sus datos según la clase. */
  const abrirItem = (i: ItemLista) => {
    setSugerenciaKm(null);
    setEditItem({
      id: i.id, nombre: i.nombre, clase: i.clase, sitioId: i.sitioId,
      lat: aCampo(i.lat), lng: aCampo(i.lng), km: aCampo(i.km), factor: aCampo(i.factorTM3), dias: aCampo(i.diasDisponible),
    });
  };

  // Los datos del nombre en edición, leídos en vivo (se ve lo que se va a guardar).
  const latItem = coordenadaDeCampo(editItem?.lat ?? '', 'lat');
  const lngItem = coordenadaDeCampo(editItem?.lng ?? '', 'lng');
  const kmItem = cifraDeCampo(editItem?.km ?? '');
  const factorItem = cifraDeCampo(editItem?.factor ?? '', { mayorQueCero: true });
  const diasItem = diasDeCampo(editItem?.dias ?? '');

  /** «📏 Sugerir km en línea recta»: del GPS del sitio al del destino. Pone la cifra en el
   *  campo de km (ella la corrige con los de carretera) y dice que es en línea recta. */
  const sugerirKm = () => {
    if (!editItem || !sitio) return;
    const destino = { lat: latItem.valor, lng: lngItem.valor };
    const km = kmSugerido(sitio, destino);
    setSugerenciaKm(textoSugerenciaKm(sitio, destino));
    if (km !== null) setEditItem((p) => (p ? { ...p, km: aCampo(km) } : p));
  };

  const renombrarItem = async () => {
    if (!editItem) return;
    const nombre = editItem.nombre.trim().replace(/\s+/g, ' ');
    if (!nombre) { toast.error('El nombre no puede quedar vacío.'); return; }
    if (activosClase.some((i) => i.id !== editItem.id && mismoNombre(i.nombre, nombre))) { toast.error('Ese nombre ya está en la lista.'); return; }
    let guardar: () => Promise<unknown>;
    if (editItem.clase === 'destino') {
      if (latItem.error || lngItem.error) { toast.error(`GPS: ${latItem.error ?? lngItem.error}`); return; }
      if ((latItem.valor === null) !== (lngItem.valor === null)) { toast.error('GPS: escribe la latitud y la longitud, o deja las dos vacías.'); return; }
      if (kmItem.error) { toast.error(`Km: ${kmItem.error}`); return; }
      if (editItem.km.trim() && kmItem.valor === null) { toast.error('Los km no se entienden: escribe solo la cifra (por ejemplo 12,5).'); return; }
      const lat = latItem.valor;
      const lng = lngItem.valor;
      const km = kmItem.valor;
      guardar = () => guardarItemLista({ id: editItem.id, nombre, lat, lng, km });
    } else if (editItem.clase === 'material') {
      if (factorItem.error) { toast.error(`Factor: ${factorItem.error}`); return; }
      if (editItem.factor.trim() && factorItem.valor === null) { toast.error('El factor no se entiende: escribe solo la cifra (por ejemplo 1,2).'); return; }
      if (diasItem.error) { toast.error(`Días: ${diasItem.error}`); return; }
      const factorTM3 = factorItem.valor;
      const diasDisponible = diasItem.valor;
      guardar = () => guardarItemLista({ id: editItem.id, nombre, factorTM3, diasDisponible });
    } else {
      guardar = () => guardarItemLista({ id: editItem.id, nombre });
    }
    const ok = await hacer(guardar, `«${nombre}» guardado.`);
    if (ok) { setEditItem(null); setSugerenciaKm(null); }
  };

  /** La línea de datos de un nombre de lista: GPS y km (destinos), factor y días (materiales). */
  const datosDeItem = (i: ItemLista): string => {
    if (i.clase === 'destino') {
      return [
        tieneGps(i) ? `📡 ${cifra(i.lat ?? 0, 6)}, ${cifra(i.lng ?? 0, 6)}` : '📡 sin GPS',
        i.km != null ? `🛣️ ${cifra(i.km, 1)} km por carretera` : '🛣️ sin km',
      ].join(' · ');
    }
    if (i.clase === 'material') {
      return [
        deBloques.listaId === i.id ? '🧱 material de los bloques' : '',
        i.factorTM3 != null ? `⚖️ ${cifra(i.factorTM3)} t/m³` : '⚖️ sin factor (en agregados se usa 1,2)',
        i.diasDisponible != null ? `⏳ ${i.diasDisponible} ${i.diasDisponible === 1 ? 'día' : 'días'} hasta estar disponible` : '',
      ].filter(Boolean).join(' · ');
    }
    return '';
  };

  const desactivarItem = async (i: ItemLista) => {
    const si = await confirm({
      title: 'Desactivar nombre',
      message: `«${i.nombre}» deja de ofrecerse al cargar${i.sitioId === null ? ' en TODOS los sitios' : ''}. Los registros que ya lo llevan lo conservan, y vuelve con «Reactivar».`,
      confirmText: 'Desactivar',
      danger: true,
    });
    if (!si) return;
    await hacer(() => guardarItemLista({ id: i.id, activo: false }), `«${i.nombre}» desactivado.`);
  };

  const reactivarItem = (i: ItemLista) =>
    hacer(() => guardarItemLista({ id: i.id, activo: true }), `«${i.nombre}» reactivado.`);

  // ═══════════════════════════ 📝 Textos fijos ═══════════════════════════

  const guardarTextos = async () => {
    if (!sitio || ocupado) return;
    // Lo escrito tiene que ser de ESTE sitio (lo leído en su carga): nunca se guarda en
    // un sitio lo que se escribió mirando otro.
    if (textosDelSitio.current !== sitio.id) { toast.error('Los textos todavía no se cargaron para este sitio: espera un momento.'); return; }
    const cambios: [string, unknown][] = TEXTOS.filter((t) => form[t.clave] !== base[t.clave]).map((t) => [t.clave, form[t.clave]]);
    if (LOGOS.some(({ k }) => form.logos[k] !== base.logos[k])) cambios.push(['logos', form.logos]);
    if (cambios.length === 0) { toast.info('No hay cambios que guardar.'); return; }
    setOcupado(true);
    // Se guardan uno por uno: si uno falla, se dice cuáles sí quedaron.
    const hechos: string[] = [];
    try {
      for (const [clave, valor] of cambios) {
        await guardarAjuste(sitio.id, clave, valor);
        hechos.push(clave);
      }
      setBase(form);
      toast.success(`Textos de «${sitio.nombre}» guardados.`);
      await cargar();
    } catch (e: any) {
      const motivo = e?.message || 'No se guardaron los textos.';
      const nombres = hechos.map((c) => (c === 'logos' ? 'Logos' : TEXTOS.find((t) => t.clave === c)?.label ?? c));
      toast.error(hechos.length ? `Se guardaron: ${nombres.join(', ')}. El resto no: ${motivo}` : motivo);
      // Se vuelve a leer lo guardado: lo que quedó deja de verse «sin guardar» y el botón
      // reintenta solo lo que falta (lo escrito en este sitio no se pisa).
      await cargar();
    } finally {
      setOcupado(false);
    }
  };

  // ═══════════════════════════ Pintura ═══════════════════════════

  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text,
  } as const;
  const titulo = { color: colors.brandText, fontSize: 15, fontWeight: '900' as const };
  const ayuda = { color: colors.muted, fontSize: 12 };
  const rotulo = { color: colors.muted, fontSize: 11, fontWeight: '800' as const, marginTop: spacing.xs };
  const fila = {
    flexDirection: 'row' as const, alignItems: 'center' as const, flexWrap: 'wrap' as const, gap: spacing.xs,
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border,
  };
  const boton = (tono: 'principal' | 'neutro' | 'peligro', deshabilitado = false) => ({
    borderWidth: 1,
    borderColor: tono === 'principal' ? colors.primary : tono === 'peligro' ? colors.danger : colors.border,
    backgroundColor: tono === 'principal' ? colors.primary : colors.surface,
    borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6,
    opacity: deshabilitado || ocupado ? 0.5 : 1,
  });
  const textoBoton = (tono: 'principal' | 'neutro' | 'peligro') => ({
    color: tono === 'principal' ? colors.primaryContrast : tono === 'peligro' ? colors.danger : colors.text,
    fontWeight: '800' as const, fontSize: 12,
  });
  const pastilla = (on: boolean) => ({
    paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1,
    borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface,
  });
  /** Lo leído de un campo, debajo de él: la cifra, el error o «sin dato». */
  const leidoCampo = (l: { valor: number | null; error: string | null }, texto: string, unidad: string, dec = 2) => (
    <Text style={{ fontSize: 11, fontWeight: '700', color: l.error ? colors.danger : l.valor !== null ? colors.success : colors.muted }}>
      {l.error ? `⚠️ ${l.error}` : l.valor !== null ? `Se guarda: ${cifra(l.valor, dec)}${unidad}` : texto.trim() ? '⚠️ No se entiende la cifra' : 'Sin dato'}
    </Text>
  );
  const leidoCoord = (l: { valor: number | null; error: string | null }) => (
    <Text style={{ fontSize: 11, fontWeight: '700', color: l.error ? colors.danger : l.valor !== null ? colors.success : colors.muted }}>
      {l.error ? `⚠️ ${l.error}` : l.valor !== null ? `Se guarda: ${cifra(l.valor, 6)}` : 'Sin dato'}
    </Text>
  );
  const mitad = { flexGrow: 1, flexBasis: 140, gap: 2 } as const;

  if (cargando) {
    return <Card><Text style={ayuda}>Cargando los ajustes…</Text></Card>;
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {!puedeCambiar ? (
        <Card style={{ borderColor: colors.warningSoftBorder, backgroundColor: colors.warningSoftBg }}>
          <Text style={{ color: colors.warningSoftText, fontWeight: '800', fontSize: 12 }}>
            Solo quien tiene Full en el módulo cambia los ajustes.
          </Text>
        </Card>
      ) : null}

      {error ? (
        <Card style={{ borderColor: colors.danger }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12, flex: 1, minWidth: 180 }}>
              ⚠️ No se pudieron cargar los ajustes: {error} — toca Reintentar (o desliza hacia abajo en el teléfono).
            </Text>
            <TouchableOpacity
              onPress={reintentar}
              disabled={reintentando}
              style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger, opacity: reintentando ? 0.5 : 1 }}
            >
              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>{reintentando ? 'Cargando…' : '🔄 Reintentar'}</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ) : null}

      {/* ── 📍 SITIOS ───────────────────────────────────────────────────── */}
      <Card>
        <Text style={titulo}>📍 Sitios</Text>
        <Text style={ayuda}>
          Cada sitio tiene su flota, sus listas y sus textos. Un sitio no se borra: se desactiva y todo lo suyo se conserva.
        </Text>

        {error && sitiosOrdenados.length === 0 ? (
          <Text style={[ayuda, { marginTop: spacing.xs }]}>No se sabe todavía qué sitios hay (la carga falló).</Text>
        ) : sitiosOrdenados.length === 0 ? (
          <Text style={[ayuda, { marginTop: spacing.xs }]}>Todavía no hay sitios. Crea el primero aquí abajo.</Text>
        ) : sitiosOrdenados.map((s) => (
          <View key={s.id} style={fila}>
            {editSitio?.id === s.id ? (
              <View style={{ flex: 1, minWidth: 220, gap: spacing.xs }}>
                <TextInput
                  value={editSitio.nombre}
                  onChangeText={(v) => setEditSitio((p) => (p ? { ...p, nombre: v } : p))}
                  placeholder="Nombre del sitio"
                  placeholderTextColor={colors.muted}
                  style={input}
                  autoFocus
                />
                <TextInput
                  value={editSitio.nota}
                  onChangeText={(v) => setEditSitio((p) => (p ? { ...p, nota: v } : p))}
                  placeholder="Nota (opcional)"
                  placeholderTextColor={colors.muted}
                  style={input}
                />
                <Text style={rotulo}>📡 GPS DEL SITIO (para sugerir los km hasta cada destino)</Text>
                <Text style={ayuda}>Puedes pegar las dos juntas, como las copia Google Maps («10.6012, -66.9301»): se reparten solas.</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  <View style={{ flexGrow: 1, flexBasis: 140, gap: 2 }}>
                    <TextInput
                      value={editSitio.lat}
                      onChangeText={(v) => setEditSitio((p) => (p ? { ...p, ...coordEscrita('lat', v) } : p))}
                      placeholder="Latitud (ej. 10,6012)"
                      placeholderTextColor={colors.muted}
                      keyboardType="numbers-and-punctuation"
                      autoCorrect={false}
                      style={input}
                    />
                    {leidoCoord(latSitio)}
                  </View>
                  <View style={{ flexGrow: 1, flexBasis: 140, gap: 2 }}>
                    <TextInput
                      value={editSitio.lng}
                      onChangeText={(v) => setEditSitio((p) => (p ? { ...p, ...coordEscrita('lng', v) } : p))}
                      placeholder="Longitud (ej. -66,9301)"
                      placeholderTextColor={colors.muted}
                      keyboardType="numbers-and-punctuation"
                      autoCorrect={false}
                      style={input}
                    />
                    {leidoCoord(lngSitio)}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  <TouchableOpacity disabled={ocupado} onPress={renombrarSitio} style={boton('principal')}>
                    <Text style={textoBoton('principal')}>💾 Guardar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={ocupado} onPress={() => setEditSitio(null)} style={boton('neutro')}>
                    <Text style={textoBoton('neutro')}>Cancelar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                <View style={{ flex: 1, minWidth: 160, opacity: s.activo ? 1 : 0.6 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
                    {s.activo ? '📍' : '⏸️'} {s.nombre}
                    {sitio && s.id === sitio.id ? <Text style={{ color: colors.brandText, fontSize: 11 }}>  · el que estás viendo</Text> : null}
                  </Text>
                  {s.nota ? <Text style={ayuda}>{s.nota}</Text> : null}
                  <Text style={ayuda}>{tieneGps(s) ? `📡 GPS ${cifra(s.lat ?? 0, 6)}, ${cifra(s.lng ?? 0, 6)}` : '📡 Sin GPS (se escribe en ✏️ Editar)'}</Text>
                  {!s.activo ? <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '700' }}>Desactivado: no sale en el selector</Text> : null}
                </View>
                {puedeCambiar ? (
                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                    <TouchableOpacity
                      disabled={ocupado}
                      onPress={() => setEditSitio({ id: s.id, nombre: s.nombre, nota: s.nota ?? '', lat: aCampo(s.lat), lng: aCampo(s.lng) })}
                      style={boton('neutro')}
                    >
                      <Text style={textoBoton('neutro')}>✏️ Editar</Text>
                    </TouchableOpacity>
                    {s.activo ? (
                      <TouchableOpacity disabled={ocupado} onPress={() => desactivarSitio(s)} style={boton('peligro')}>
                        <Text style={textoBoton('peligro')}>⏸️ Desactivar</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity disabled={ocupado} onPress={() => reactivarSitio(s)} style={boton('neutro')}>
                        <Text style={textoBoton('neutro')}>↩️ Reactivar</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}
              </>
            )}
          </View>
        ))}

        {puedeCambiar ? (
          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            <Text style={rotulo}>➕ SITIO NUEVO</Text>
            <TextInput
              value={nuevoSitio}
              onChangeText={setNuevoSitio}
              placeholder="Nombre del sitio (por ejemplo: CDT Norte)"
              placeholderTextColor={colors.muted}
              style={input}
            />
            <TextInput
              value={nuevaNota}
              onChangeText={setNuevaNota}
              placeholder="Nota (opcional)"
              placeholderTextColor={colors.muted}
              style={input}
            />
            <TouchableOpacity disabled={ocupado} onPress={crearSitio} style={[boton('principal'), { alignItems: 'center', paddingVertical: spacing.sm }]}>
              <Text style={textoBoton('principal')}>➕ Crear sitio</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </Card>

      {!sitio ? (
        <Card>
          <Text style={ayuda}>Cuando haya un sitio activo, aquí aparecen sus listas de apoyo y los textos fijos de sus papeles.</Text>
        </Card>
      ) : (
        <>
          {/* ── 📚 LISTAS DE APOYO ──────────────────────────────────────── */}
          <Card>
            <Text style={titulo}>📚 Listas de apoyo</Text>
            <Text style={ayuda}>
              Lo que se elige al cargar en {sitio.nombre}. Se puede escribir un nombre que no esté, pero lo de la lista sale siempre escrito igual en los papeles.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
              {CLASES.map((c) => {
                const on = c.clase === clase;
                const n = items.filter((i) => i.clase === c.clase && i.activo).length;
                return (
                  <TouchableOpacity key={c.clase} onPress={() => { setClase(c.clase); setEditItem(null); }} style={pastilla(on)}>
                    <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
                      {c.label} · {n}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[ayuda, { marginTop: spacing.xs }]}>{infoClase.ayuda}</Text>

            {error && items.length === 0 ? (
              <Text style={[ayuda, { marginTop: spacing.xs }]}>No se sabe todavía qué tiene la lista (la carga falló).</Text>
            ) : activosClase.length === 0 ? (
              <Text style={[ayuda, { marginTop: spacing.xs }]}>La lista está vacía.</Text>
            ) : null}
            {[...activosClase, ...(verDesactivados ? desactivadosClase : [])].map((i) => (
              <View key={i.id} style={fila}>
                {editItem?.id === i.id ? (
                  <View style={{ flex: 1, minWidth: 220, gap: spacing.xs }}>
                    <TextInput
                      value={editItem.nombre}
                      onChangeText={(v) => setEditItem((p) => (p ? { ...p, nombre: v } : p))}
                      placeholder="Nombre"
                      placeholderTextColor={colors.muted}
                      style={input}
                      autoFocus
                    />
                    {i.sitioId === null ? (
                      // Lote 5 A8: Ajustes no deja crear en el sitio un nombre que ya está «para
                      // todos»; si el duplicado existe (se creó el general desde otro sitio), al
                      // anotar manda el del sitio (itemDeLista).
                      <Text style={{ color: colors.warning, fontSize: 11 }}>
                        🌐 Es de todos los sitios: el nombre nuevo sale en todos
                        {editItem.clase === 'destino'
                          ? ', y sus km también. Si cada sitio queda a otra distancia, desactívalo y crea el destino en cada sitio con sus km (si un sitio tiene uno propio con el mismo nombre, en ese sitio manda el suyo).'
                          : editItem.clase === 'material'
                            ? ', y su factor y sus días también. Si un sitio necesita otros, desactívalo y crea el material en cada sitio (si un sitio tiene uno propio con el mismo nombre, en ese sitio manda el suyo).'
                            : '.'}
                      </Text>
                    ) : null}

                    {/* ── Destino: GPS y km por carretera ── */}
                    {editItem.clase === 'destino' ? (
                      <>
                        <Text style={rotulo}>📡 GPS DEL DESTINO</Text>
                        <Text style={ayuda}>Puedes pegar las dos juntas, como las copia Google Maps («10.6012, -66.9301»): se reparten solas.</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                          <View style={mitad}>
                            <TextInput
                              value={editItem.lat}
                              onChangeText={(v) => setEditItem((p) => (p ? { ...p, ...coordEscrita('lat', v) } : p))}
                              placeholder="Latitud (ej. 10,6012)"
                              placeholderTextColor={colors.muted}
                              keyboardType="numbers-and-punctuation"
                              autoCorrect={false}
                              style={input}
                            />
                            {leidoCoord(latItem)}
                          </View>
                          <View style={mitad}>
                            <TextInput
                              value={editItem.lng}
                              onChangeText={(v) => setEditItem((p) => (p ? { ...p, ...coordEscrita('lng', v) } : p))}
                              placeholder="Longitud (ej. -66,9301)"
                              placeholderTextColor={colors.muted}
                              keyboardType="numbers-and-punctuation"
                              autoCorrect={false}
                              style={input}
                            />
                            {leidoCoord(lngItem)}
                          </View>
                        </View>
                        <Text style={rotulo}>🛣️ KM POR CARRETERA DESDE {sitio.nombre.toUpperCase()}</Text>
                        <TextInput
                          value={editItem.km}
                          onChangeText={(v) => setEditItem((p) => (p ? { ...p, km: v } : p))}
                          placeholder="Km (ej. 12,5)"
                          placeholderTextColor={colors.muted}
                          keyboardType="decimal-pad"
                          style={input}
                        />
                        {leidoCampo(kmItem, editItem.km, ' km', 1)}
                        <TouchableOpacity disabled={ocupado} onPress={sugerirKm} style={[boton('neutro'), { alignSelf: 'flex-start' }]}>
                          <Text style={textoBoton('neutro')}>📏 Sugerir km en línea recta</Text>
                        </TouchableOpacity>
                        <Text style={ayuda}>
                          Calcula la distancia en línea recta, por carretera es más: confirma los km de verdad. Cada salida guarda los km del destino de ese momento.
                        </Text>
                        {sugerenciaKm ? <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>📏 {sugerenciaKm}</Text> : null}
                      </>
                    ) : null}

                    {/* ── Material: factor t/m³ y días hasta estar disponible ── */}
                    {editItem.clase === 'material' ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                        <View style={mitad}>
                          <Text style={rotulo}>⚖️ FACTOR (t/m³)</Text>
                          <TextInput
                            value={editItem.factor}
                            onChangeText={(v) => setEditItem((p) => (p ? { ...p, factor: v } : p))}
                            placeholder="Ej. 1,2 · vacío: en agregados se usa 1,2"
                            placeholderTextColor={colors.muted}
                            keyboardType="decimal-pad"
                            style={input}
                          />
                          {leidoCampo(factorItem, editItem.factor, ' t/m³')}
                        </View>
                        <View style={mitad}>
                          <Text style={rotulo}>⏳ DÍAS HASTA ESTAR DISPONIBLE</Text>
                          <TextInput
                            value={editItem.dias}
                            onChangeText={(v) => setEditItem((p) => (p ? { ...p, dias: v } : p))}
                            placeholder="Bloques: 7 · vacío = no aplica"
                            placeholderTextColor={colors.muted}
                            keyboardType="number-pad"
                            style={input}
                          />
                          {leidoCampo(diasItem, editItem.dias, ' días', 0)}
                        </View>
                        <Text style={[ayuda, { flexBasis: '100%' }]}>
                          El factor convierte m³ ↔ t en las salidas de agregados; sin factor se usa 1,2 (el aluminio y el plástico van en t o kg y no lo necesitan).
                        </Text>
                        <Text style={[ayuda, { flexBasis: '100%' }]}>
                          Los días son solo para el material de los bloques (el que se llama «Bloques»; si ninguno se llama así, el primero que tenga días pasa a serlo): dicen cuándo se vende lo producido (los bloques curan 7). En los demás materiales déjalo vacío.
                        </Text>
                      </View>
                    ) : null}

                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      <TouchableOpacity disabled={ocupado} onPress={renombrarItem} style={boton('principal')}>
                        <Text style={textoBoton('principal')}>💾 Guardar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity disabled={ocupado} onPress={() => { setEditItem(null); setSugerenciaKm(null); }} style={boton('neutro')}>
                        <Text style={textoBoton('neutro')}>Cancelar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <>
                    <View style={{ flex: 1, minWidth: 140, opacity: i.activo ? 1 : 0.6 }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                        {i.nombre}
                        {i.sitioId === null ? <Text style={{ color: colors.brandText, fontSize: 11 }}>  🌐 todos los sitios</Text> : null}
                      </Text>
                      {datosDeItem(i) ? <Text style={ayuda}>{datosDeItem(i)}</Text> : null}
                      {!i.activo ? <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '700' }}>Desactivado</Text> : null}
                    </View>
                    {puedeCambiar ? (
                      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                        <TouchableOpacity disabled={ocupado} onPress={() => abrirItem(i)} style={boton('neutro')}>
                          <Text style={textoBoton('neutro')}>{i.clase === 'destino' || i.clase === 'material' ? '✏️ Editar' : '✏️'}</Text>
                        </TouchableOpacity>
                        {i.activo ? (
                          <TouchableOpacity disabled={ocupado} onPress={() => desactivarItem(i)} style={boton('peligro')}>
                            <Text style={textoBoton('peligro')}>⏸️ Desactivar</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity disabled={ocupado} onPress={() => reactivarItem(i)} style={boton('neutro')}>
                            <Text style={textoBoton('neutro')}>↩️ Reactivar</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            ))}
            {desactivadosClase.length > 0 ? (
              <Toggle
                on={verDesactivados}
                label={`Ver los desactivados (${desactivadosClase.length})`}
                onPress={() => setVerDesactivados((v) => !v)}
              />
            ) : null}

            {puedeCambiar ? (
              <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                <Text style={rotulo}>➕ AGREGAR A {infoClase.label.toUpperCase()}</Text>
                <TextInput
                  value={nuevoItem}
                  onChangeText={setNuevoItem}
                  placeholder="Nombre nuevo"
                  placeholderTextColor={colors.muted}
                  style={input}
                  onSubmitEditing={crearItem}
                />
                <Toggle
                  on={paraTodos}
                  label="🌐 Para todos los sitios"
                  ayuda={paraTodos ? 'Sale en la lista de cada sitio.' : `Solo para ${sitio.nombre}.`}
                  onPress={() => setParaTodos((v) => !v)}
                />
                <TouchableOpacity disabled={ocupado} onPress={crearItem} style={[boton('principal'), { alignItems: 'center', paddingVertical: spacing.sm }]}>
                  <Text style={textoBoton('principal')}>➕ Agregar</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </Card>

          {/* ── 📝 TEXTOS FIJOS DEL PAPEL ───────────────────────────────── */}
          <Card>
            <Text style={titulo}>📝 Textos fijos de los papeles · {sitio.nombre}</Text>
            <Text style={ayuda}>
              📄 Reportes los trae puestos; ahí se pueden cambiar para un papel en particular sin tocar estos.
            </Text>
            {TEXTOS.map((t) => (
              <View key={t.clave} style={{ marginTop: spacing.xs, gap: 2 }}>
                <Text style={rotulo}>{t.label}</Text>
                <TextInput
                  value={form[t.clave]}
                  onChangeText={(v) => setForm((p) => ({ ...p, [t.clave]: v }))}
                  editable={puedeCambiar}
                  multiline={t.largo}
                  placeholder={t.ayuda}
                  placeholderTextColor={colors.muted}
                  style={[input, t.largo ? { minHeight: 90, textAlignVertical: 'top' as const } : null]}
                />
              </View>
            ))}
            <Text style={rotulo}>🏷️ LOGOS DEL MEMBRETE</Text>
            {LOGOS.map((l) => (
              <Toggle
                key={l.k}
                on={form.logos[l.k]}
                label={l.label}
                onPress={() => { if (puedeCambiar) setForm((p) => ({ ...p, logos: { ...p.logos, [l.k]: !p.logos[l.k] } })); }}
              />
            ))}
            {puedeCambiar ? (
              <TouchableOpacity
                disabled={ocupado || !sucio}
                onPress={guardarTextos}
                style={[boton('principal', !sucio), { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs }]}
              >
                <Text style={textoBoton('principal')}>{sucio ? '💾 Guardar textos' : '✓ Textos guardados'}</Text>
              </TouchableOpacity>
            ) : null}
          </Card>
        </>
      )}
    </View>
  );
}
