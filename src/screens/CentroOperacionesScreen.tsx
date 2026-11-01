// ============================================================================
// 🏭 CENTRO DE OPERACIONES — la pantalla (23-oct-2026, fase 1).
//
// Un mini sistema AISLADO para operar un sitio (el primero es un CDT): lo que
// entra, se mueve, se procesa y sale, con sus papeles. Solo lee y escribe sus
// tablas propias, a través de src/lib/centroOperacionesDb.ts; nunca le escribe a
// otro módulo (lo vigila scripts/test-centro-operaciones-aislamiento.mjs).
//
// QUIÉN VE QUÉ (permiso del módulo `centro_operaciones`, nace en «Sin acceso»):
//   · Lectura   → 📅 Parte diario, 📋 Registros, 🚛 Flota y 📄 Reportes, sin botones
//                 de cambio.
//   · Escritura → además carga el 📅 Parte diario y ✍️ Carga libre (carga y corrige
//                 movimientos renglón por renglón).
//   · Full      → además ⚙️ Ajustes (sitios, listas, textos), cambia la 🚛 Flota y borra.
//
// 📅 PARTE DIARIO ES LA PRIMERA PESTAÑA (24-oct-2026), la que se abre por defecto: la
// hoja diaria de la encargada. La carga renglón por renglón queda como la ÚLTIMA,
// «✍️ Carga libre» (R26: ocultar no es eliminar).
// ⭐ LA JORNADA DEL PARTE DIARIO VIVE AQUÍ (lote 5 B2), no dentro de la pestaña: ir a
//    ⚙️ Ajustes o a 🚛 Flota (los mismos mensajes del Parte diario mandan allá) o cambiar
//    de sitio y volver NO la devuelve sola a hoy (lo que se anotara después caería en
//    otro día). La pestaña igual se monta de nuevo al volver y recarga lo recién puesto.
// ⭐ PERO SI ELLA ESTABA «EN HOY» Y CAMBIA EL DÍA (revisión final B-I4: la pantalla queda
//    montada en el stack de «Más», o la app en segundo plano), pasa sola al nuevo hoy: se
//    revisa al enfocar la pantalla, al volver la app a primer plano y cada minuto. Una fecha
//    elegida a propósito se respeta, y con algo sin guardar NO se muda (lo dice un toast;
//    nunca una pregunta: un temporizador no puede pisar otra confirmación abierta).
// ⭐ SALIR DEL PARTE DIARIO CON ALGO «✏️ SIN GUARDAR» PREGUNTA (revisión final B-I1):
//    cambiar de pestaña o de sitio desmonta la pestaña y lo escrito se pierde, así que antes
//    se pregunta «Descartar» / «Seguir aquí». NO se deja montada y escondida (lote 5: rompía
//    el refresco al volver de ⚙️ Ajustes).
//
// ARRIBA, EL SITIO: el selector solo aparece si hay más de uno activo; con uno
// solo no se pregunta. Sin sitios, Full ve «Crea el primer sitio» (abre ⚙️) y el
// resto ve «Todavía no hay sitios». Si la carga de los sitios FALLÓ, ninguna de las dos
// (revisión final B-I2: invitaría a crear uno repetido): solo el error y «🔄 Reintentar».
//
// Sin tiempo real: refresca al entrar a la pantalla y al deslizar hacia abajo.
// Cada pestaña recibe { sitio, nivel } y vive en src/components/centroOperaciones/.
// ⭐ Las pestañas refrescan al enfocarse (useFocusEffect) y cuando esta pantalla
//    recarga: el objeto `sitio` se vuelve a crear y sus cargas dependen de él (no de
//    `sitio.id`). Al CAMBIAR de sitio se vuelven a montar (key = el sitio). ⚙️ Ajustes
//    avisa con `alCambiarSitios` cuando crea, renombra o desactiva un sitio.
// ============================================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Screen, Card, EmptyState, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';
import { useAuth } from '../context/AuthContext';
import { levelMeets, PermLevel } from '../lib/permissions';
import { cmpText } from '../lib/text';
import { caracasBusinessToday } from '../lib/caracasDay';
import type { Sitio } from '../lib/centroOperaciones';
import { cargarSitios } from '../lib/centroOperacionesDb';
import { sitioElegido } from '../lib/centroOperacionesCarga';
import FlotaTab from '../components/centroOperaciones/FlotaTab';
import AjustesTab from '../components/centroOperaciones/AjustesTab';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { CargarTab } from '../components/centroOperaciones/CargarTab';
import { RegistrosTab } from '../components/centroOperaciones/RegistrosTab';
import { ReportesTab } from '../components/centroOperaciones/ReportesTab';
import { ParteDiarioTab } from '../components/centroOperaciones/ParteDiarioTab';
import { jornadaAlVolver, textoSalirSinGuardar } from '../components/centroOperaciones/pantallaParteDiario';
import type { ClaveSinGuardar } from '../components/centroOperaciones/pantallaParteDiario';

/** Lo que recibe cada pestaña: el sitio elegido y el nivel de quien mira. */
export type PropsPestanaCop = { sitio: Sitio; nivel: PermLevel };
/** ⚙️ Ajustes también se abre SIN sitio: es donde se crea el primero. */
export type PropsAjustesCop = { sitio: Sitio | null; nivel: PermLevel };

type ClavePestana = 'parte' | 'cargar' | 'registros' | 'flota' | 'reportes' | 'ajustes';

/** Las pestañas, en orden, con el nivel mínimo para verlas. La primera visible es la
 *  que se abre: 📅 Parte diario. ✍️ Carga libre va al final (R26). */
const PESTANAS: { key: ClavePestana; label: string; necesita: PermLevel }[] = [
  { key: 'parte', label: '📅 Parte diario', necesita: 'lectura' },
  { key: 'registros', label: '📋 Registros', necesita: 'lectura' },
  { key: 'flota', label: '🚛 Flota', necesita: 'lectura' },
  { key: 'reportes', label: '📄 Reportes', necesita: 'lectura' },
  { key: 'ajustes', label: '⚙️ Ajustes', necesita: 'full' },
  { key: 'cargar', label: '✍️ Carga libre', necesita: 'escritura' },
];

export default function CentroOperacionesScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const nivel = moduleLevel('centro_operaciones');
  const esFull = levelMeets(nivel, 'full');

  const [sitios, setSitios] = useState<Sitio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sitioId, setSitioId] = useState<string | null>(null);
  const [pestana, setPestana] = useState<ClavePestana | null>(null);
  /** La jornada del 📅 Parte diario: sobrevive al cambio de pestaña y de sitio (B2). */
  const [fechaParte, setFechaParte] = useState<string>(() => caracasBusinessToday());
  const fechaParteRef = useRef(fechaParte);
  fechaParteRef.current = fechaParte;
  /** B-I4: ¿ella estaba «en hoy»? (la fecha era la de hoy cuando se puso). Si lo estaba y cambia el día, pasa sola. */
  const parteEnHoy = useRef(true);
  const cambiarFechaParte = useCallback((f: string) => {
    parteEnHoy.current = f === caracasBusinessToday();
    setFechaParte(f);
  }, []);
  /** B-I1: los bloques del Parte diario con algo escrito sin guardar (los avisa la pestaña). */
  const sinGuardarParte = useRef<ClaveSinGuardar[]>([]);
  const alSinGuardarParte = useCallback((claves: ClaveSinGuardar[]) => { sinGuardarParte.current = claves; }, []);
  // El toast cambia de identidad en cada render del proveedor: el reloj lo lee de un ref.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  /** El «hoy» de la última revisión: si cambia, se vuelve a pintar (▶, el calendario y
   *  «↩ Volver a hoy» de la pestaña calculan su hoy al pintarse). */
  const hoyVisto = useRef(caracasBusinessToday());
  const [, setDiaNuevo] = useState(0);

  /** B-I4: si ella estaba «en hoy» y cambió el día, la jornada pasa sola (o se queda, si hay algo sin guardar). */
  const revisarJornada = useCallback(() => {
    const hoy = caracasBusinessToday();
    const cambioElDia = hoy !== hoyVisto.current;
    hoyVisto.current = hoy;
    const d = jornadaAlVolver({ fecha: fechaParteRef.current, enHoy: parteEnHoy.current, hoy, sinGuardar: sinGuardarParte.current.length > 0 });
    if (cambioElDia) setDiaNuevo((n) => n + 1);
    if (d.accion === 'pasar') {
      parteEnHoy.current = true;
      fechaParteRef.current = d.fecha;
      setFechaParte(d.fecha);
      toastRef.current.info(d.aviso);
    } else if (d.accion === 'quedarse') {
      // Desde ahora es una fecha elegida: no se vuelve a avisar en cada vuelta del reloj.
      parteEnHoy.current = false;
      toastRef.current.info(d.aviso);
    }
  }, []);
  // Al volver la app a primer plano y cada minuto (la pantalla puede quedar abierta de un día al otro).
  useEffect(() => {
    // (En web, sin documento visible, react-native-web no devuelve suscripción: de ahí el «?.».)
    const sub = AppState.addEventListener('change', (estado) => { if (estado === 'active') revisarJornada(); });
    const reloj = setInterval(revisarJornada, 60_000);
    return () => { sub?.remove(); clearInterval(reloj); };
  }, [revisarJornada]);

  const recargar = useCallback(async () => {
    setError(null);
    try {
      // Todos los sitios; el selector muestra solo los activos (⚙️ Ajustes, todos).
      const lista = await cargarSitios();
      const activos = lista.filter((s) => s.activo).sort((a, b) => cmpText(a.nombre, b.nombre));
      setSitios(activos);
      // ⭐ El sitio queda FIJO: si aparece otro que ordena antes, no se cambia solo (ella
      //    seguiría cargando sin darse cuenta en otro sitio). Solo si el suyo ya no está.
      setSitioId((id) => sitioElegido(id, activos));
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los sitios.');
    } finally {
      setCargando(false);
    }
  }, []);

  // Refresca al entrar (y al volver) a la pantalla; no hay tiempo real. Y revisa la jornada (B-I4).
  useFocusEffect(useCallback(() => { recargar(); revisarJornada(); }, [recargar, revisarJornada]));

  const alDeslizar = async () => {
    setRefrescando(true);
    try { await recargar(); } finally { setRefrescando(false); }
  };
  /** «🔄 Reintentar» la carga de los sitios (B-I2): en web deslizar no hace nada. */
  const reintentar = async () => {
    if (refrescando) return;
    setRefrescando(true);
    try { await recargar(); } finally { setRefrescando(false); }
  };

  const visibles = PESTANAS.filter((p) => levelMeets(nivel, p.necesita));
  // Si la pestaña elegida ya no se puede ver (o no se eligió), va la primera visible.
  const activa: ClavePestana | null = visibles.some((p) => p.key === pestana) ? pestana : (visibles[0]?.key ?? null);
  const sitio = sitios.find((s) => s.id === sitioId) ?? sitios[0] ?? null;

  /** B-I1: antes de salir del 📅 Parte diario con algo «✏️ sin guardar», se pregunta. */
  const puedeSalirDelParte = async (): Promise<boolean> => {
    if (activa !== 'parte' || sinGuardarParte.current.length === 0) return true;
    return confirm({
      title: 'Quedó algo sin guardar',
      message: textoSalirSinGuardar(sinGuardarParte.current),
      confirmText: 'Descartar',
      cancelText: 'Seguir aquí',
      danger: true,
    });
  };
  const irAPestana = async (k: ClavePestana) => {
    if (k === activa) return;
    if (!(await puedeSalirDelParte())) return;
    setPestana(k);
  };
  const irASitio = async (id: string) => {
    if (sitio && id === sitio.id) return;
    if (!(await puedeSalirDelParte())) return;
    setSitioId(id);
  };

  const pastilla = (on: boolean) => ({
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1,
    borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface,
  });
  const textoPastilla = (on: boolean) => ({ color: on ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });

  if (nivel === 'none') {
    return (
      <Screen>
        <EmptyState title="No tienes acceso a este módulo" subtitle="Pídele al administrador el permiso de Centro de Operaciones." />
      </Screen>
    );
  }

  if (cargando) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  return (
    // keyboardShouldPersistTaps="handled": en el teléfono, las sugerencias de ✍️ Cargar se
    // pueden tocar con el teclado abierto (si no, el primer toque solo lo cerraba).
    <Screen onRefresh={alDeslizar} refreshing={refrescando} keyboardShouldPersistTaps="handled">
      <ConfigBanner />

      {error ? (
        <Card style={{ borderColor: colors.danger, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.danger, fontWeight: '800' }}>⚠️ {error}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
            <Text style={{ color: colors.muted, fontSize: 12, flex: 1, minWidth: 180 }}>
              Para intentar de nuevo, toca Reintentar (o desliza hacia abajo en el teléfono).
            </Text>
            <TouchableOpacity
              onPress={reintentar}
              disabled={refrescando}
              style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger, opacity: refrescando ? 0.5 : 1 }}
            >
              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>{refrescando ? 'Cargando…' : '🔄 Reintentar'}</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ) : null}

      {error && sitios.length === 0 ? (
        // ── LA CARGA DE LOS SITIOS FALLÓ (B-I2): no se sabe si hay sitios, así que ni
        //    «Crea el primer sitio» (quedaría uno repetido) ni «Todavía no hay sitios». Si
        //    Full ya estaba en ⚙️ Ajustes (creando el primero), Ajustes se queda.
        esFull && pestana === 'ajustes' ? (
          <AjustesTab sitio={null} nivel={nivel} alCambiarSitios={recargar} />
        ) : null
      ) : !sitio ? (
        // ── SIN SITIOS ─────────────────────────────────────────────────────
        esFull ? (
          pestana === 'ajustes' ? (
            <AjustesTab sitio={null} nivel={nivel} alCambiarSitios={recargar} />
          ) : (
            <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>Crea el primer sitio</Text>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.xs, textAlign: 'center' }}>
                Los sitios se crean en ⚙️ Ajustes. Después se le agrega su flota y se empieza a cargar.
              </Text>
              <TouchableOpacity
                onPress={() => setPestana('ajustes')}
                style={{ marginTop: spacing.md, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg }}
              >
                <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>⚙️ Abrir Ajustes</Text>
              </TouchableOpacity>
            </Card>
          )
        ) : (
          <EmptyState title="Todavía no hay sitios" subtitle="Cuando quien administra el módulo cree el primero, aparece aquí." />
        )
      ) : (
        <>
          {/* ── EL SITIO: el selector solo si hay más de uno ───────────────── */}
          {sitios.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {sitios.map((s) => {
                  const on = s.id === sitio.id;
                  return (
                    <TouchableOpacity key={s.id} onPress={() => irASitio(s.id)} style={pastilla(on)}>
                      <Text style={textoPastilla(on)}>📍 {s.nombre}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          ) : (
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: spacing.sm }}>📍 {sitio.nombre}</Text>
          )}

          {/* ── LAS PESTAÑAS: cada una según el nivel ─────────────────────── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {visibles.map((p) => {
                const on = activa === p.key;
                return (
                  <TouchableOpacity key={p.key} onPress={() => irAPestana(p.key)} style={pastilla(on)}>
                    <Text style={textoPastilla(on)}>{p.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* ⭐ Se monta SOLO si es la pestaña activa (B-I1: no montada y escondida); salir con
               algo sin guardar pregunta antes (irAPestana / irASitio). */}
          {activa === 'parte' ? (
            <ParteDiarioTab key={sitio.id} sitio={sitio} nivel={nivel} fecha={fechaParte} alCambiarFecha={cambiarFechaParte} alSinGuardar={alSinGuardarParte} />
          ) : null}
          {activa === 'cargar' ? <CargarTab key={sitio.id} sitio={sitio} nivel={nivel} /> : null}
          {activa === 'registros' ? <RegistrosTab key={sitio.id} sitio={sitio} nivel={nivel} /> : null}
          {/* ⭐ key = el sitio: al cambiar de sitio cada pestaña se vuelve a montar, así
               nunca muestra ni toca (ni guarda) lo del sitio anterior. */}
          {activa === 'flota' ? <FlotaTab key={sitio.id} sitio={sitio} nivel={nivel} /> : null}
          {activa === 'reportes' ? <ReportesTab key={sitio.id} sitio={sitio} nivel={nivel} /> : null}
          {activa === 'ajustes' ? <AjustesTab key={sitio.id} sitio={sitio} nivel={nivel} alCambiarSitios={recargar} /> : null}
        </>
      )}
    </Screen>
  );
}
