// ============================================================================
// 🏭 CENTRO DE OPERACIONES — 🚛 FLOTA (24-oct-2026, fase 1).
//
// Las unidades (camiones, máquinas) de UN sitio. Todos los que tienen el módulo
// las ven; solo Full las cambia (la RLS también lo exige: sin 'full' la base no
// guarda y la capa de datos lo dice en español, que acá sale en un toast).
//
//   · «➕ Del catálogo»: buscador sobre el catálogo COMPLETO del sistema
//     (sugerenciasDelSistema().maquinas) por código, placa, serial y empresa —el
//     mismo criterio del buscador de FrentesTrabajo—. Al elegir una máquina se
//     COPIAN sus datos y quedan editables; desde ahí viven congelados en el
//     módulo: el catálogo no se toca nunca («recibe, no envía»).
//   · «🔄 Actualizar desde el catálogo», por unidad: vuelve a copiar los datos
//     del catálogo (código, descripción, placa, serial, marca, modelo y empresa),
//     mostrando antes qué cambia. La capacidad y la nota no se tocan.
//   · «➕ Propia»: una unidad que solo existe en este módulo, con todos los
//     campos de la ficha (7.2 del diseño). No aparece en Control de Maquinaria,
//     ni a los inspectores, ni en ningún reporte del sistema.
//   · 👷 CHOFER (Parte diario, 24-oct-2026): el de la unidad; cada salida con vehículo
//     propio lo copia solo. El ESTADO (disponible / averiada) NO va acá: se mira y se
//     cambia en el 📅 Parte diario (🚜 Maquinaria), un solo lugar.
//   · ↩️ REACTIVAR (mesa de maquinaria D7, 26-oct-2026): con `cambioAlReactivar` — una
//     vinculada vuelve a seguir a inspección (su marca vieja no revive); una del sitio
//     conserva su último estado con su «desde», y el aviso (`avisoAlReactivar`) se lo dice.
//
// ⭐ Una unidad NUNCA se borra: «Dar de baja» = `activo: false`. Deja de
//    ofrecerse al cargar, pero sus registros siguen y salen en los papeles con su
//    texto congelado. Vuelve con «Reactivar».
// ⭐ Habla SOLO con centroOperacionesDb (nunca directo con la base) y no tiene
//    ninguna función de borrar: lo vigila
//    scripts/test-centro-operaciones-ajustes-flota.mjs.
// ============================================================================
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from '../ui';
import { Toggle } from '../CubicajeTab';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets } from '../../lib/permissions';
import { cmpText, norm } from '../../lib/text';
import type { Unidad } from '../../lib/centroOperaciones';
// La placa repetida se compara con LA regla de placa del módulo (`clavePlaca`, la misma
// de la carga y de la pertenencia a la unidad), y la capacidad se lee con la regla de
// ✍️ Cargar (> 0, como exige la base).
import { cifraDeCampo, otraActivaConPlaca } from '../../lib/centroOperacionesCarga';
import { cargarUnidades, guardarUnidad, sugerenciasDelSistema } from '../../lib/centroOperacionesDb';
import type { MaquinaSugerida } from '../../lib/centroOperacionesDb';
import type { PropsPestanaCop } from '../../screens/CentroOperacionesScreen';
// Reactivar con LA regla del estado (mesa de maquinaria D7): vinculada → vuelve a mandar
// inspección; del sitio → conserva su marca con su «desde» viejo, y se le avisa.
import { avisoAlReactivar, cambioAlReactivar } from '../../lib/centroOperacionesMaquinariaBloques';

/** Cuánto se queda en pantalla un aviso largo (el de D7 al reactivar una del sitio): 3,5 s no alcanzan para leerlo. */
const DURACION_AVISO_LARGO_MS = 8000;

/** Cuántas máquinas del catálogo se pintan a la vez: con cientos, se afina la búsqueda. */
const MAX_RESULTADOS = 60;

/** El formulario de una unidad: todo como TEXTO mientras se escribe. */
type FormUnidad = {
  /** null = unidad nueva. */
  id: string | null;
  origen: 'catalogo' | 'propia';
  machineryId: string | null;
  codigo: string;
  descripcion: string;
  placa: string;
  serial: string;
  marca: string;
  modelo: string;
  dueno: string;
  /** Lo escrito, crudo: se lee con numeroDeCampo al guardar (punto o coma). */
  capacidad: string;
  nota: string;
  /** El chofer de la unidad (Parte diario): se copia solo en cada salida con vehículo propio. */
  chofer: string;
};

/** Los datos que vienen del catálogo (lo que «🔄 Actualizar» vuelve a copiar). */
type CampoCatalogo = 'codigo' | 'descripcion' | 'placa' | 'serial' | 'marca' | 'modelo' | 'dueno';
const ETIQUETA_CAMPO: Record<CampoCatalogo, string> = {
  codigo: 'Código', descripcion: 'Descripción', placa: 'Placa', serial: 'Serial',
  marca: 'Marca', modelo: 'Modelo', dueno: 'Empresa',
};

/** Lo que el catálogo dice de una máquina, con los nombres de la unidad. */
const datosDelCatalogo = (m: MaquinaSugerida): Record<CampoCatalogo, string | null> => ({
  codigo: m.codigo || null,
  descripcion: m.descripcion,
  placa: m.placa,
  serial: m.serial,
  marca: m.marca,
  modelo: m.modelo,
  dueno: m.empresa,
});

/** Una cifra para mostrar en pantalla (es-VE). */
const cifra = (n: number): string => n.toLocaleString('es-VE', { maximumFractionDigits: 2 });

/** La segunda línea de la ficha en la lista: empresa · marca modelo · serial. */
const lineaFicha = (u: Unidad): string =>
  [u.dueno ? `🏢 ${u.dueno}` : '', [u.marca, u.modelo].filter(Boolean).join(' '), u.serial ? `S/N ${u.serial}` : '']
    .filter(Boolean).join(' · ');

/** Un campo del formulario. Va FUERA del componente: definido adentro, cada
 *  tecla lo volvería a crear y el teclado perdería el foco. */
function Campo({ label, value, onChange, placeholder, numerico, largo, nota }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  numerico?: boolean; largo?: boolean; nota?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: largo ? '100%' : 150, minWidth: 140, gap: 2 }}>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={numerico ? 'decimal-pad' : 'default'}
        autoCorrect={false}
        multiline={largo}
        style={{
          backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
          paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text,
          ...(largo ? { minHeight: 64, textAlignVertical: 'top' as const } : null),
        }}
      />
      {nota}
    </View>
  );
}

export default function FlotaTab({ sitio, nivel }: PropsPestanaCop) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  // ⭐ Solo Full agrega, edita o da de baja (la RLS también lo exige).
  const puedeCambiar = levelMeets(nivel, 'full');

  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [cargando, setCargando] = useState(true);
  /** La carga falló: se dice, en vez de un «Todavía no hay unidades» falso que invite a
   *  crearlas de nuevo (una propia no tiene único en la base: quedaría duplicada). */
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [verBaja, setVerBaja] = useState(false);

  // Lo que está abierto arriba: el buscador del catálogo o el formulario.
  const [modo, setModo] = useState<'catalogo' | 'form' | null>(null);
  const [form, setForm] = useState<FormUnidad | null>(null);

  // El catálogo se pide SOLO al abrir «Del catálogo» o al actualizar una unidad.
  const [catalogo, setCatalogo] = useState<MaquinaSugerida[] | null>(null);
  const [cargandoCatalogo, setCargandoCatalogo] = useState(false);
  const [buscar, setBuscar] = useState('');

  // ⭐ Depende del objeto `sitio`: la pantalla lo vuelve a crear cada vez que
  //    recarga (al entrar y al deslizar), así esta pestaña refresca con ella.
  // ⭐ Al cambiar de sitio la pantalla la vuelve a MONTAR (key = el sitio): nada de
  //    lo que había queda a la vista ni a mano de los botones.
  const cargar = useCallback(async () => {
    try {
      setUnidades(await cargarUnidades(sitio.id));
      setError(null);
    } catch (e: any) {
      const msg = e?.message || 'No se pudieron cargar las unidades.';
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

  const activas = useMemo(() => unidades.filter((u) => u.activo), [unidades]);
  const deBaja = unidades.length - activas.length;

  /** Las máquinas del catálogo que ya están en la flota ACTIVA de este sitio. */
  const enFlota = useMemo(() => {
    const m = new Map<string, Unidad>();
    for (const u of activas) if (u.machineryId) m.set(u.machineryId, u);
    return m;
  }, [activas]);

  // La lista: filtro por texto; las activas primero, cada grupo A→Z por código.
  const visibles = useMemo(() => {
    const q = norm(filtro).trim();
    return unidades
      .filter((u) => verBaja || u.activo)
      .filter((u) => !q || [u.codigo, u.placa, u.serial, u.dueno, u.descripcion, u.marca, u.modelo].some((v) => norm(v).includes(q)))
      .sort((a, b) => Number(b.activo) - Number(a.activo) || cmpText(a.codigo, b.codigo));
  }, [unidades, filtro, verBaja]);

  // El buscador del catálogo: código, placa, serial y empresa (más marca, modelo
  // y descripción), sin tildes ni mayúsculas, sobre TODO el catálogo.
  const resultados = useMemo(() => {
    const q = norm(buscar).trim();
    const todos = catalogo ?? [];
    return todos
      .filter((m) => !q || [m.codigo, m.placa, m.serial, m.empresa, m.marca, m.modelo, m.descripcion].some((v) => norm(v).includes(q)))
      .sort((a, b) => cmpText(a.codigo, b.codigo));
  }, [catalogo, buscar]);

  /** El catálogo del sistema (solo lectura). `fresco` lo vuelve a pedir. */
  const traerCatalogo = async (fresco = false): Promise<MaquinaSugerida[]> => {
    if (catalogo && !fresco) return catalogo;
    setCargandoCatalogo(true);
    try {
      const maquinas = (await sugerenciasDelSistema()).maquinas;
      setCatalogo(maquinas);
      return maquinas;
    } finally {
      setCargandoCatalogo(false);
    }
  };

  // ═══════════════════════════ Abrir ═══════════════════════════

  const abrirCatalogo = async () => {
    setModo('catalogo');
    setForm(null);
    setBuscar('');
    try {
      await traerCatalogo();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo cargar el catálogo.');
    }
  };

  const elegirDelCatalogo = (m: MaquinaSugerida) => {
    const ya = enFlota.get(m.id);
    if (ya) { toast.info(`${m.codigo} ya está en la flota de ${sitio.nombre} como ${ya.codigo}.`); return; }
    const d = datosDelCatalogo(m);
    setForm({
      id: null, origen: 'catalogo', machineryId: m.id,
      codigo: d.codigo ?? '', descripcion: d.descripcion ?? '', placa: d.placa ?? '', serial: d.serial ?? '',
      marca: d.marca ?? '', modelo: d.modelo ?? '', dueno: d.dueno ?? '', capacidad: '', nota: '', chofer: '',
    });
    setModo('form');
  };

  const nuevaPropia = () => {
    setForm({
      id: null, origen: 'propia', machineryId: null,
      codigo: '', descripcion: '', placa: '', serial: '', marca: '', modelo: '', dueno: '', capacidad: '', nota: '', chofer: '',
    });
    setModo('form');
  };

  const editar = (u: Unidad) => {
    setForm({
      id: u.id, origen: u.origen, machineryId: u.machineryId,
      codigo: u.codigo, descripcion: u.descripcion ?? '', placa: u.placa ?? '', serial: u.serial ?? '',
      marca: u.marca ?? '', modelo: u.modelo ?? '', dueno: u.dueno ?? '',
      capacidad: u.capacidadM3 == null ? '' : String(u.capacidadM3).replace('.', ','),
      nota: u.nota ?? '',
      chofer: u.chofer ?? '',
    });
    setModo('form');
  };

  const cerrar = () => { setModo(null); setForm(null); };

  const poner = (k: keyof FormUnidad) => (v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  // ═══════════════════════════ Guardar ═══════════════════════════

  /** Una escritura: avisa el resultado (con `duracionMs` si el aviso es largo) y recarga la flota. */
  const escribir = async (accion: () => Promise<unknown>, exito: string, duracionMs?: number): Promise<boolean> => {
    if (ocupado) return false;
    setOcupado(true);
    try {
      await accion();
      toast.success(exito, duracionMs);
      await cargar();
      return true;
    } catch (e: any) {
      toast.error(e?.message || 'No se guardó la unidad.');
      return false;
    } finally {
      setOcupado(false);
    }
  };

  // ⭐ La capacidad con la regla de ✍️ Cargar: punto o coma, y MAYOR que cero (la base
  //    rechaza el 0 con un motivo que no tiene nada que ver: mejor decirlo acá).
  const capTexto = form?.capacidad.trim() ?? '';
  const capLeida = cifraDeCampo(capTexto, { mayorQueCero: true });
  const capNoSeEntiende = !!capTexto && capLeida.valor == null && !capLeida.error;

  const guardar = async () => {
    if (!form) return;
    const codigo = form.codigo.trim().replace(/\s+/g, ' ');
    if (!codigo) { toast.error('Escribe el código de la unidad (como se la conoce en el patio).'); return; }
    if (capNoSeEntiende) { toast.error('La capacidad no se entiende: escribe solo la cifra en m³ (por ejemplo 12,5).'); return; }
    if (capLeida.error) { toast.error(`Capacidad: ${capLeida.error}`); return; }
    const placa = form.placa.trim();
    const otraConPlaca = otraActivaConPlaca(placa, unidades, form.id);
    if (otraConPlaca) { toast.error(`La placa ${placa} ya es de ${otraConPlaca.codigo}, activa en este sitio.`); return; }
    if (!form.id && form.machineryId && enFlota.has(form.machineryId)) {
      toast.error('Esa máquina del catálogo ya está en la flota activa de este sitio.');
      return;
    }

    const datos: Partial<Unidad> = {
      codigo,
      descripcion: form.descripcion.trim() || null,
      placa: placa || null,
      serial: form.serial.trim() || null,
      marca: form.marca.trim() || null,
      modelo: form.modelo.trim() || null,
      dueno: form.dueno.trim() || null,
      capacidadM3: capLeida.valor,
      nota: form.nota.trim() || null,
      chofer: form.chofer.trim().replace(/\s+/g, ' ') || null,
    };
    const ok = await escribir(
      () => (form.id
        ? guardarUnidad({ id: form.id, ...datos })
        : guardarUnidad({
          ...datos,
          sitioId: sitio.id,
          origen: form.origen,
          machineryId: form.origen === 'catalogo' ? form.machineryId : null,
          activo: true,
        })),
      form.id ? `${codigo} guardada.` : `${codigo} agregada a la flota de ${sitio.nombre}.`,
    );
    if (ok) cerrar();
  };

  const darDeBaja = async (u: Unidad) => {
    const si = await confirm({
      title: 'Dar de baja',
      message: `${u.codigo} deja de ofrecerse al cargar. Sus registros se conservan y siguen saliendo en los papeles; vuelve con «Reactivar».`,
      confirmText: 'Dar de baja',
      danger: true,
    });
    if (!si) return;
    await escribir(() => guardarUnidad({ id: u.id, activo: false }), `${u.codigo} dada de baja.`);
  };

  const reactivar = async (u: Unidad) => {
    // Igual que al guardar: dos ACTIVAS con la misma placa apagarían en silencio la
    // vinculación sola de esa placa al cargar.
    const otraConPlaca = otraActivaConPlaca(u.placa, unidades, u.id);
    if (otraConPlaca) {
      toast.error(`No se reactivó ${u.codigo}: la placa ${u.placa} ya es de ${otraConPlaca.codigo}, activa en este sitio. Dale de baja a esa primero o corrige la placa.`);
      return;
    }
    // ⭐ D7: lo que se manda y el aviso salen de la misma regla (la marca de una vinculada no revive).
    //    El aviso con «su último estado» (~130 letras) se queda más tiempo que un toast normal (lote 6 B12).
    const aviso = avisoAlReactivar(u);
    await escribir(() => guardarUnidad({ id: u.id, ...cambioAlReactivar(u) }), aviso, /su último estado/.test(aviso) ? DURACION_AVISO_LARGO_MS : undefined);
  };

  const actualizarDesdeCatalogo = async (u: Unidad) => {
    if (!u.machineryId || ocupado) return;
    let maquinas: MaquinaSugerida[];
    try {
      maquinas = await traerCatalogo(true);
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo cargar el catálogo.');
      return;
    }
    const m = maquinas.find((x) => x.id === u.machineryId);
    if (!m) {
      toast.error(`${u.codigo} ya no está activa en el catálogo (o no tienes permiso de verlo): sus datos se quedan como están.`);
      return;
    }
    const nuevos = datosDelCatalogo(m);
    const campos = (Object.keys(ETIQUETA_CAMPO) as CampoCatalogo[])
      // Un catálogo sin código no le borra el código a la unidad.
      .filter((k) => !(k === 'codigo' && !nuevos.codigo))
      .filter((k) => (u[k] ?? '') !== (nuevos[k] ?? ''));
    if (campos.length === 0) { toast.info(`${u.codigo} ya está igual al catálogo.`); return; }
    const detalle = campos.map((k) => `· ${ETIQUETA_CAMPO[k]}: ${u[k] || '(vacío)'} → ${nuevos[k] || '(vacío)'}`).join('\n');
    const si = await confirm({
      title: '🔄 Actualizar desde el catálogo',
      message: `Se copian estos datos del catálogo a ${u.codigo}:\n${detalle}\n\nLa capacidad y la nota no se tocan. Lo ya cargado conserva el texto con que se anotó.`,
      confirmText: 'Actualizar',
    });
    if (!si) return;
    const cambio: Partial<Unidad> = { id: u.id };
    for (const k of campos) (cambio as Record<string, unknown>)[k] = nuevos[k] ?? null;
    await escribir(() => guardarUnidad(cambio), `${nuevos.codigo || u.codigo} actualizada desde el catálogo.`);
  };

  // ═══════════════════════════ Pintura ═══════════════════════════

  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text,
  } as const;
  const ayuda = { color: colors.muted, fontSize: 12 };
  const boton = (tono: 'principal' | 'acento' | 'neutro' | 'peligro') => ({
    borderWidth: 1,
    borderColor: tono === 'principal' ? colors.primary : tono === 'acento' ? colors.accent : tono === 'peligro' ? colors.danger : colors.border,
    backgroundColor: tono === 'principal' ? colors.primary : tono === 'acento' ? colors.accent : colors.surface,
    borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6, opacity: ocupado ? 0.5 : 1,
  });
  const textoBoton = (tono: 'principal' | 'acento' | 'neutro' | 'peligro') => ({
    color: tono === 'principal' ? colors.primaryContrast : tono === 'acento' ? colors.accentContrast : tono === 'peligro' ? colors.danger : colors.text,
    fontWeight: '800' as const, fontSize: 12,
  });
  const etiqueta = (bg: string, fg: string) => ({
    backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: spacing.xs, paddingVertical: 1,
    overflow: 'hidden' as const, color: fg, fontSize: 10, fontWeight: '800' as const,
  });

  if (cargando) return <Card><Text style={ayuda}>Cargando la flota…</Text></Card>;

  return (
    <View style={{ gap: spacing.sm }}>
      {/* ── ENCABEZADO: cuántas hay y cómo se agregan ─────────────────────── */}
      <Card>
        <Text style={{ color: colors.brandText, fontSize: 15, fontWeight: '900' }}>🚛 Flota de {sitio.nombre}</Text>
        <Text style={ayuda}>
          {activas.length} activa{activas.length === 1 ? '' : 's'}{deBaja > 0 ? ` · ${deBaja} de baja` : ''}
        </Text>
        {puedeCambiar ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
            <TouchableOpacity disabled={ocupado} onPress={abrirCatalogo} style={boton('acento')}>
              <Text style={textoBoton('acento')}>➕ Del catálogo</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={ocupado} onPress={nuevaPropia} style={boton('neutro')}>
              <Text style={textoBoton('neutro')}>➕ Propia</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[ayuda, { marginTop: spacing.xs }]}>Solo quien tiene Full en el módulo agrega o da de baja unidades.</Text>
        )}
      </Card>

      {/* ── ➕ DEL CATÁLOGO: el buscador ─────────────────────────────────── */}
      {puedeCambiar && modo === 'catalogo' ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '900' }}>➕ Del catálogo</Text>
          <Text style={ayuda}>Se copian sus datos y quedan editables. El catálogo del sistema no cambia.</Text>
          <TextInput
            value={buscar}
            onChangeText={setBuscar}
            placeholder="🔎 Buscar en el catálogo: código, placa, serial, empresa…"
            placeholderTextColor={colors.muted}
            style={[input, { marginTop: spacing.xs }]}
            autoCorrect={false}
            autoFocus
          />
          {cargandoCatalogo ? (
            <Text style={[ayuda, { marginTop: spacing.xs }]}>Cargando el catálogo…</Text>
          ) : (catalogo ?? []).length === 0 ? (
            <Text style={[ayuda, { marginTop: spacing.xs }]}>
              El catálogo no trajo máquinas (sin permiso de verlo o sin conexión). Puedes agregarla como «➕ Propia».
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 300, marginTop: spacing.xs }} nestedScrollEnabled>
              {resultados.length === 0 ? (
                <Text style={ayuda}>Ninguna máquina del catálogo coincide con la búsqueda.</Text>
              ) : resultados.slice(0, MAX_RESULTADOS).map((m) => {
                const ya = enFlota.get(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => elegirDelCatalogo(m)}
                    style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: ya ? 0.55 : 1 }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>
                      🚜 {m.codigo}{m.placa ? ` · ${m.placa}` : m.serial ? ` · ${m.serial}` : ''}
                      {ya ? <Text style={{ color: colors.success, fontSize: 11 }}>  ✓ ya en la flota</Text> : null}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                      {[m.empresa, [m.marca, m.modelo].filter(Boolean).join(' '), m.descripcion].filter(Boolean).join(' · ') || ' '}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {resultados.length > MAX_RESULTADOS ? (
                <Text style={[ayuda, { paddingVertical: spacing.xs }]}>
                  … y {resultados.length - MAX_RESULTADOS} más: escribe parte del código, la placa o la empresa para afinar.
                </Text>
              ) : null}
            </ScrollView>
          )}
          <TouchableOpacity onPress={cerrar} style={[boton('neutro'), { alignSelf: 'flex-start', marginTop: spacing.xs }]}>
            <Text style={textoBoton('neutro')}>Cerrar</Text>
          </TouchableOpacity>
        </Card>
      ) : null}

      {/* ── EL FORMULARIO: del catálogo (ya copiado), propia o editar ─────── */}
      {puedeCambiar && modo === 'form' && form ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '900' }}>
            {form.id ? `✏️ Editar ${form.codigo || 'unidad'}` : form.origen === 'catalogo' ? '➕ Del catálogo' : '➕ Propia'}
          </Text>
          <Text style={ayuda}>
            {form.origen === 'catalogo'
              ? 'Copiado del catálogo: puedes corregirlo. Queda congelado aquí; «🔄 Actualizar desde el catálogo» lo vuelve a copiar.'
              : 'Una unidad propia solo existe en este módulo: no aparece en Control de Maquinaria ni en ningún reporte del sistema.'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
            <Campo label="CÓDIGO *" value={form.codigo} onChange={poner('codigo')} placeholder="Como se la conoce en el patio" />
            <Campo label="DESCRIPCIÓN" value={form.descripcion} onChange={poner('descripcion')} placeholder="Camión volteo, payloader…" />
            <Campo label="PLACA" value={form.placa} onChange={poner('placa')} />
            <Campo label="SERIAL" value={form.serial} onChange={poner('serial')} />
            <Campo label="MARCA" value={form.marca} onChange={poner('marca')} />
            <Campo label="MODELO" value={form.modelo} onChange={poner('modelo')} />
            <Campo label="EMPRESA DUEÑA / TRANSPORTISTA" value={form.dueno} onChange={poner('dueno')} />
            <Campo label="CHOFER" value={form.chofer} onChange={poner('chofer')} placeholder="Sale solo en las salidas con esta unidad" />
            <Campo
              label="CAPACIDAD (m³)"
              value={form.capacidad}
              onChange={poner('capacidad')}
              placeholder="Opcional"
              numerico
              nota={(
                <Text style={{ color: capNoSeEntiende || capLeida.error ? colors.danger : colors.muted, fontSize: 11 }}>
                  {!capTexto ? 'Sin dato'
                    : capNoSeEntiende ? '⚠️ No se entiende la cifra'
                      : capLeida.error ? `⚠️ ${capLeida.error}`
                        : `Se guarda: ${cifra(capLeida.valor ?? 0)} m³`}
                </Text>
              )}
            />
            <Campo label="NOTA" value={form.nota} onChange={poner('nota')} largo />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
            <TouchableOpacity disabled={ocupado} onPress={guardar} style={[boton('principal'), { paddingVertical: spacing.sm, paddingHorizontal: spacing.md }]}>
              <Text style={textoBoton('principal')}>💾 Guardar unidad</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={ocupado} onPress={cerrar} style={[boton('neutro'), { paddingVertical: spacing.sm }]}>
              <Text style={textoBoton('neutro')}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ) : null}

      {/* ── LA FLOTA ─────────────────────────────────────────────────────── */}
      <Card>
        <TextInput
          value={filtro}
          onChangeText={setFiltro}
          placeholder="🔎 Filtrar la flota: código, placa, serial, empresa…"
          placeholderTextColor={colors.muted}
          style={input}
          autoCorrect={false}
        />
        {deBaja > 0 ? (
          <Toggle on={verBaja} label={`Ver las dadas de baja (${deBaja})`} onPress={() => setVerBaja((v) => !v)} />
        ) : null}

        {error ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
            <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', flex: 1, minWidth: 180 }}>
              ⚠️ No se pudo cargar la flota: {error} — toca Reintentar (o desliza hacia abajo en el teléfono).
            </Text>
            <TouchableOpacity
              onPress={reintentar}
              disabled={reintentando}
              style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger, opacity: reintentando ? 0.5 : 1 }}
            >
              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>{reintentando ? 'Cargando…' : '🔄 Reintentar'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {error && unidades.length === 0 ? null : unidades.length === 0 ? (
          <Text style={[ayuda, { marginTop: spacing.xs }]}>
            {puedeCambiar
              ? 'Todavía no hay unidades: agrégalas del catálogo o como propias.'
              : 'Todavía no hay unidades en este sitio.'}
          </Text>
        ) : visibles.length === 0 ? (
          <Text style={[ayuda, { marginTop: spacing.xs }]}>Ninguna unidad coincide con el filtro.</Text>
        ) : visibles.map((u) => (
          <View key={u.id} style={{ paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, opacity: u.activo ? 1 : 0.6 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
                🚛 {u.codigo}{u.placa ? ` · ${u.placa}` : ''}
              </Text>
              <Text style={etiqueta(colors.surfaceAlt, colors.text)}>{u.origen === 'catalogo' ? '📚 Catálogo' : '✍️ Propia'}</Text>
              {!u.activo ? <Text style={etiqueta(colors.warningSoftBg, colors.warningSoftText)}>De baja</Text> : null}
            </View>
            <View style={{ opacity: u.activo ? 1 : 0.6 }}>
              {u.descripcion ? <Text style={{ color: colors.text, fontSize: 12 }}>{u.descripcion}</Text> : null}
              {lineaFicha(u) ? <Text style={ayuda}>{lineaFicha(u)}</Text> : null}
              {u.capacidadM3 != null || u.nota || u.chofer ? (
                <Text style={ayuda}>
                  {[u.chofer ? `👷 ${u.chofer}` : '', u.capacidadM3 != null ? `📦 ${cifra(u.capacidadM3)} m³` : '', u.nota ? `📝 ${u.nota}` : ''].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
            {puedeCambiar ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 }}>
                {u.activo ? (
                  <>
                    <TouchableOpacity disabled={ocupado} onPress={() => editar(u)} style={boton('neutro')}>
                      <Text style={textoBoton('neutro')}>✏️ Editar</Text>
                    </TouchableOpacity>
                    {u.origen === 'catalogo' && u.machineryId ? (
                      <TouchableOpacity disabled={ocupado || cargandoCatalogo} onPress={() => actualizarDesdeCatalogo(u)} style={boton('neutro')}>
                        <Text style={textoBoton('neutro')}>🔄 Actualizar desde el catálogo</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity disabled={ocupado} onPress={() => darDeBaja(u)} style={boton('peligro')}>
                      <Text style={textoBoton('peligro')}>⏸️ Dar de baja</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity disabled={ocupado} onPress={() => reactivar(u)} style={boton('neutro')}>
                    <Text style={textoBoton('neutro')}>↩️ Reactivar</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
          </View>
        ))}
      </Card>
    </View>
  );
}
