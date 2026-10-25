// QUÉ SALE EN EL TICKET · la pantalla de configuración (12-sep-2026).
//
// Pedido del cliente: «un chek para cada cosa, placa, modelo, todo lo que deba
// llevar el ticket, yo pueda activar o desactivar para que cuando lo impriman le
// salga o no les salga».
//
// ⚠️ LA VISTA PREVIA NO ES ADORNO. Sin ella, la única manera de saber cómo quedó
//    el ticket es imprimir uno y mirarlo, y eso son diez viajes al patio. El
//    ejemplo de la derecha se arma con LAS MISMAS funciones que arman el papel,
//    así que lo que se ve es lo que sale.
//
// ⚠️ SE GUARDA CUANDO TOCAS «Guardar», NO A CADA CLIC. Guardar en cada
//    interruptor manda quince escrituras seguidas mientras alguien está
//    decidiendo, y deja el formato a medio cambiar si se va la señal en el
//    medio. Mientras hay cambios sin guardar, la tarjeta lo dice.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Plegable } from './Plegable';
import { Toggle } from './CubicajeTab';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import {
  CAMPOS_TIQUE, CAMPO_FIJO, CONFIG_POR_DEFECTO, LOGOS_TIQUE, PAPELES, TEXTO_FIJO_MAX,
  cambiosRespectoAlDefecto, resumenConfig,
  FormatoTique, FORMATO_DEFECTO_ID, crearFormatoDefecto,
  type ClaveCampo, type ClaveLogo, type PapelTique, type TiqueConfig,
} from '../lib/tiqueConfig';
import { guardarConfigTique, leerConfigTique } from '../lib/tiqueConfigDatos';
import { avisoDeCapacidad, renglonesDelTique } from '../lib/tiqueDocumento';
import { UNIDADES_PESO, pesosParaTique } from '../lib/viajesPeso';
import { listListeros } from '../lib/camionViajes';

/**
 * Un viaje de mentira para la vista previa.
 *
 * ⚠️ LA PLACA Y EL SERIAL SON INVENTADOS, Y TIENEN QUE SEGUIR SIÉNDOLO. Dos
 *    motivos: uno, que nadie confunda el ejemplo con un ticket de verdad; dos,
 *    que ESTE REPOSITORIO ES PÚBLICO y una placa o un serial de la flota acá
 *    quedan publicados. Se escriben con pura X y ceros para que se reconozcan
 *    de un vistazo. Lo vigila `scripts/test-tique.mjs`.
 *
 * ⚠️ ACÁ SOLO VAN LOS VALORES. Las etiquetas («Ticket», «Placa»…) salen de
 *    `CAMPOS_TIQUE`, las mismas que imprime el papel, y el orden lo decide
 *    `renglonesDelTique`. Cuando el ejemplo traía sus propias etiquetas eran
 *    DOS listas que había que acordarse de mover juntas, y ese es justo el
 *    error que hace que el admin configure mirando una cosa y le salga otra.
 */
const EJEMPLO: Record<ClaveCampo, string> = {
  folio:       'CDT-000001',
  fecha:       '14/09/2026',
  hora:        '08:42 a. m.',
  placa:       'A31KM7B',
  empresa:     'GOLDEN TOUCH 1127 CA',
  cdt:         'CDT Parque del Agua',
  jornada:     '14/09/2026',
  turno:       'Día',
  codigo:      'CAMION VOLTEO TORONTO',
  marcaModelo: 'IVECO EUROTRAKKER',
  serial:      'X0000X0000',
  chofer:      'Chofer del turno',
  listero:     'Listero del CDT',
  m3:          '16,82 m³',
  // El ejemplo del peso es el MISMO del papel de muestra de la encargada
  // (26-sep-2026): bruto − tara = neto, y se ve que cuadra.
  pesoBruto:   '32.540,00 Kg',
  pesoTara:    '11.340,00 Kg',
  pesoNeto:    '21.200,00 Kg',
  estado:      'Operativa',
  nota:        'Sin nota',
};

export function TiqueConfigCard({
  uid,
  onGuardado,
  listeros: listerosProp,
}: {
  uid: string | null;
  onGuardado?: (
    c: TiqueConfig,
    formatos?: FormatoTique[],
    asignaciones?: Record<string, string>,
    foliosFormatos?: Record<string, string>
  ) => void;
  listeros?: { id: string; full_name?: string | null; email?: string | null }[];
}) {
  const { colors } = useTheme();
  const toast = useToast();

  const [formatos, setFormatos] = useState<FormatoTique[]>([crearFormatoDefecto()]);
  const [formatoActivoId, setFormatoActivoId] = useState<string>(FORMATO_DEFECTO_ID);
  const [asignaciones, setAsignaciones] = useState<Record<string, string>>({});
  const [foliosFormatos, setFoliosFormatos] = useState<Record<string, string>>({});

  const [guardadoFormatos, setGuardadoFormatos] = useState<FormatoTique[]>([crearFormatoDefecto()]);
  const [guardadoAsignaciones, setGuardadoAsignaciones] = useState<Record<string, string>>({});

  const [config, setConfig] = useState<TiqueConfig>(CONFIG_POR_DEFECTO);
  const [guardado, setGuardado] = useState<TiqueConfig>(CONFIG_POR_DEFECTO);
  const [cargando, setCargando] = useState(true);
  const [sinTabla, setSinTabla] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  // Listeros disponibles para asignar
  const [listerosLocales, setListerosLocales] = useState<{ id: string; full_name?: string | null; email?: string | null }[]>([]);
  useEffect(() => {
    if (listerosProp && listerosProp.length > 0) {
      setListerosLocales(listerosProp);
      return;
    }
    let vivo = true;
    listListeros()
      .then((res) => {
        if (!vivo) return;
        const deRol = res.filter((l) => l.esListero);
        const lista = deRol.length > 0 ? deRol : res;
        setListerosLocales(lista);
      })
      .catch((e) => console.warn('[tiqueConfig] no se pudo leer listeros:', e));
    return () => { vivo = false; };
  }, [listerosProp]);

  // Carga inicial desde Supabase
  useEffect(() => {
    let vivo = true;
    leerConfigTique().then((r) => {
      if (!vivo) return;
      setConfig(r.config);
      setGuardado(r.config);
      setFormatos(r.formatos);
      setGuardadoFormatos(JSON.parse(JSON.stringify(r.formatos)));
      setAsignaciones(r.asignaciones);
      setGuardadoAsignaciones(JSON.parse(JSON.stringify(r.asignaciones)));
      setFoliosFormatos(r.foliosFormatos);
      const def = r.formatos.find((f) => f.esDefecto) || r.formatos[0];
      if (def) {
        setFormatoActivoId(def.id);
        setConfig(def.config);
        setGuardado(def.config);
      }
      setSinTabla(r.sinTabla);
      setCargando(false);
      if (r.error) toast.error(`No se pudo leer la configuración del ticket: ${r.error}`);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatoActivo = useMemo(() => {
    return formatos.find((f) => f.id === formatoActivoId) || formatos[0] || crearFormatoDefecto(config);
  }, [formatos, formatoActivoId, config]);

  // Detectar cambios sin guardar
  const sucio = useMemo(() => {
    return (
      JSON.stringify(config) !== JSON.stringify(guardado) ||
      JSON.stringify(formatos) !== JSON.stringify(guardadoFormatos) ||
      JSON.stringify(asignaciones) !== JSON.stringify(guardadoAsignaciones)
    );
  }, [config, guardado, formatos, guardadoFormatos, asignaciones, guardadoAsignaciones]);

  const cambios = useMemo(() => cambiosRespectoAlDefecto(config), [config]);

  // Cambiar de formato activo en la UI
  const seleccionarFormato = (id: string) => {
    if (id === formatoActivoId) return;
    const target = formatos.find((f) => f.id === id);
    if (!target) return;
    // Sincronizar profundamente el formato que se deja
    setFormatos((prev) =>
      prev.map((f) => (f.id === formatoActivoId ? { ...f, config: JSON.parse(JSON.stringify(config)) } : f))
    );
    setFormatoActivoId(target.id);
    setConfig(JSON.parse(JSON.stringify(target.config)));
  };

  // Crear nuevo formato
  const crearNuevoFormato = () => {
    const nuevoId = `fmt_${Date.now()}`;
    const nuevoNum = formatos.length + 1;
    const nuevoFmt: FormatoTique = {
      id: nuevoId,
      nombre: `Formato ${nuevoNum}`,
      esDefecto: false,
      config: JSON.parse(JSON.stringify(config)),
      listeroIds: [],
    };
    // Sincronizar el formato actual antes de cambiar
    const actualizados = formatos.map((f) => (f.id === formatoActivoId ? { ...f, config: JSON.parse(JSON.stringify(config)) } : f));
    setFormatos([...actualizados, nuevoFmt]);
    setFormatoActivoId(nuevoId);
    setConfig(JSON.parse(JSON.stringify(nuevoFmt.config)));
    toast.success(`Formato «Formato ${nuevoNum}» creado. Configura sus campos y asigna sus listeros.`);
  };

  // Clonar formato actual
  const clonarFormatoActual = () => {
    const nuevoId = `fmt_${Date.now()}`;
    const clonado: FormatoTique = {
      id: nuevoId,
      nombre: `${formatoActivo.nombre} (copia)`,
      esDefecto: false,
      config: JSON.parse(JSON.stringify(config)),
      listeroIds: [],
    };
    const actualizados = formatos.map((f) => (f.id === formatoActivoId ? { ...f, config: JSON.parse(JSON.stringify(config)) } : f));
    setFormatos([...actualizados, clonado]);
    setFormatoActivoId(nuevoId);
    setConfig(JSON.parse(JSON.stringify(clonado.config)));
    toast.success(`Copia creada: «${clonado.nombre}».`);
  };

  // Eliminar formato (solo no-defecto)
  const eliminarFormato = (id: string) => {
    const objetivo = formatos.find((f) => f.id === id);
    if (!objetivo || objetivo.esDefecto) {
      toast.error('No se puede eliminar el formato principal por defecto.');
      return;
    }
    // Reasignar listeros al formato por defecto
    const nuevasAsignaciones = { ...asignaciones };
    (objetivo.listeroIds ?? []).forEach((lid: string) => {
      delete nuevasAsignaciones[lid];
    });
    setAsignaciones(nuevasAsignaciones);

    const filtrados = formatos.filter((f) => f.id !== id);
    setFormatos(filtrados);
    const def = filtrados.find((f) => f.esDefecto) || filtrados[0];
    setFormatoActivoId(def.id);
    setConfig(JSON.parse(JSON.stringify(def.config)));
    toast.success(`Formato «${objetivo.nombre}» eliminado.`);
  };

  // Establecer formato como principal / por defecto
  const hacerPrincipal = (id: string) => {
    setFormatos((prev) =>
      prev.map((f) => ({
        ...f,
        esDefecto: f.id === id,
      }))
    );
    toast.success('Este formato es ahora el principal / por defecto.');
  };

  // Renombrar formato activo
  const cambiarNombreFormato = (nuevoNombre: string) => {
    setFormatos((prev) =>
      prev.map((f) => (f.id === formatoActivoId ? { ...f, nombre: nuevoNombre } : f))
    );
  };

  // Asignar / Desasignar listero al formato activo
  const toggleListeroEnFormatoActivo = (listeroId: string) => {
    const limpioId = listeroId.trim();
    if (!limpioId) return;

    const asignadoActual = asignaciones[limpioId];
    const estaEnEste = asignadoActual === formatoActivoId || (formatoActivo.esDefecto && !asignadoActual);

    const nuevasAsignaciones = { ...asignaciones };

    if (estaEnEste) {
      if (formatoActivo.esDefecto) {
        // En defecto ya está por descarte
        return;
      }
      // Se desasigna de este formato y vuelve al defecto
      delete nuevasAsignaciones[limpioId];
    } else {
      // Se asigna a este formato
      if (formatoActivo.esDefecto) {
        delete nuevasAsignaciones[limpioId];
      } else {
        nuevasAsignaciones[limpioId] = formatoActivoId;
      }
    }

    setAsignaciones(nuevasAsignaciones);

    // Sincronizar listeroIds de los formatos
    setFormatos((prev) =>
      prev.map((f) => {
        const ids = new Set(f.listeroIds || []);
        if (f.id === formatoActivoId) {
          if (estaEnEste && !f.esDefecto) ids.delete(limpioId);
          else if (!estaEnEste && !f.esDefecto) ids.add(limpioId);
        } else {
          ids.delete(limpioId);
        }
        return { ...f, listeroIds: Array.from(ids) };
      })
    );
  };

  const campo = (k: ClaveCampo) => {
    setConfig((c) => {
      const nc = { ...c, campos: { ...c.campos, [k]: !c.campos[k] } };
      setFormatos((prev) => prev.map((f) => (f.id === formatoActivoId ? { ...f, config: nc } : f)));
      return nc;
    });
  };

  const logo = (k: ClaveLogo) => {
    setConfig((c) => {
      const nc = { ...c, logos: { ...c.logos, [k]: !c.logos[k] } };
      setFormatos((prev) => prev.map((f) => (f.id === formatoActivoId ? { ...f, config: nc } : f)));
      return nc;
    });
  };

  const papel = (p: PapelTique) => {
    setConfig((c) => {
      const nc = { ...c, papel: p };
      setFormatos((prev) => prev.map((f) => (f.id === formatoActivoId ? { ...f, config: nc } : f)));
      return nc;
    });
  };

  // ✍️ EL TEXTO A MANO por campo (27-sep-2026)
  const [textoAbierto, setTextoAbierto] = useState<ClaveCampo | null>(null);
  const texto = (k: ClaveCampo, v: string) => {
    setConfig((c) => {
      const t = { ...c.textos };
      if (v) t[k] = v; else delete t[k];
      const nc = { ...c, textos: t };
      setFormatos((prev) => prev.map((f) => (f.id === formatoActivoId ? { ...f, config: nc } : f)));
      return nc;
    });
  };

  const guardar = async () => {
    setOcupado(true);
    // Sincronizar el formato activo antes de guardar
    const formatosFinales = formatos.map((f) =>
      f.id === formatoActivoId ? { ...f, config: JSON.parse(JSON.stringify(config)) } : f
    );
    const def = formatosFinales.find((f) => f.esDefecto) || formatosFinales[0] || crearFormatoDefecto(config);

    void (() => guardarConfigTique(config, uid));
    const r = await guardarConfigTique(config, uid, {
      formatos: formatosFinales,
      asignaciones,
      foliosFormatos,
    });
    setOcupado(false);
    if (r.sinTabla) { setSinTabla(true); toast.error('Falta correr el SQL de la ticketera. La configuración no se guardó.'); return; }
    if (r.error) { toast.error(`No se pudo guardar: ${r.error}`); return; }

    setGuardado(JSON.parse(JSON.stringify(config)));
    setGuardadoFormatos(JSON.parse(JSON.stringify(formatosFinales)));
    setGuardadoAsignaciones(JSON.parse(JSON.stringify(asignaciones)));
    // La pantalla de viajes tiene su propia copia para poder imprimir sin abrir
    // esta tarjeta. Si no se le avisa, el primer ticket después de cambiar el
    // formato sale con el formato viejo y parece que el guardado no funcionó.
    onGuardado?.(config);
    toast.success('Listo. Los formatos de ticket y sus listeros asignados quedaron guardados.');
  };

  const enRollo = config.papel === 'rollo80' || config.papel === 'rollo58';
  // El ejemplo de los pesos se arma con el MISMO formateador del papel
  // (pesosParaTique) y la unidad elegida: si dice Ton en la vista previa es
  // porque va a decir Ton en el ticket. Los números son los del papel de muestra.
  const ejemplo = useMemo(() => ({
    ...EJEMPLO,
    ...pesosParaTique({ pesoBrutoKg: 32540, pesoTaraKg: 11340, pesoNetoKg: 21200 }, config.pesosUnidad),
  }), [config.pesosUnidad]);
  const renglones = useMemo(() => renglonesDelTique(ejemplo, config), [ejemplo, config]);
  /**
   * ⚠️ ESTE AVISO EXISTE POR UN TICKET CORTADO.
   */
  const aviso = useMemo(() => avisoDeCapacidad(config), [config]);

  const listerosParaMostrar = listerosLocales;

  return (
    <Plegable
      titulo="🎫 Qué sale en el ticket"
      resumen={cargando ? 'Leyendo la configuración…' : sucio ? '⚠️ Tienes cambios sin guardar' : aviso ? 'No caben todos los datos en ese papel' : resumenConfig(config, formatos.length)}
      alerta={sucio || sinTabla || !!aviso}
    >
      {sinTabla ? (
        <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>⏳ Falta correr el SQL de la ticketera</Text>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
            Puedes mirar cómo quedaría, pero lo que marques no se guarda todavía.
          </Text>
        </View>
      ) : null}

      {/* ── SELECTOR DE FORMATOS DE TICKET ── */}
      <View style={{ marginBottom: spacing.md, backgroundColor: colors.surface, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>
            🏷️ FORMATOS DE TICKET ({formatos.length})
          </Text>
          <TouchableOpacity
            onPress={crearNuevoFormato}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.brand, borderWidth: 1, borderColor: colors.brand }}
          >
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 11.5 }}>➕ Nuevo formato</Text>
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: 2 }}>
          {formatos.map((fmt) => {
            const activo = fmt.id === formatoActivoId;
            const listerosDelFmt = listerosParaMostrar.filter((l) => {
              const asig = asignaciones[l.id];
              return fmt.esDefecto ? (!asig || asig === fmt.id) : asig === fmt.id;
            });
            return (
              <TouchableOpacity
                key={fmt.id}
                onPress={() => seleccionarFormato(fmt.id)}
                style={{
                  borderRadius: radius.md,
                  borderWidth: 1.5,
                  borderColor: activo ? colors.brand : colors.border,
                  backgroundColor: activo ? (colors.brand + '20') : colors.surface,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 6,
                  minWidth: 110,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 12 }}>{fmt.esDefecto ? '⭐' : '🎟️'}</Text>
                  <Text style={{ color: activo ? colors.brandText : colors.text, fontWeight: activo ? '800' : '600', fontSize: 12 }} numberOfLines={1}>
                    {fmt.nombre}
                  </Text>
                </View>
                <Text style={{ color: activo ? colors.brandText : colors.muted, fontSize: 10, marginTop: 2 }}>
                  {fmt.esDefecto ? `Defecto (${listerosDelFmt.length})` : `${listerosDelFmt.length} listero(s)`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Panel del formato seleccionado */}
        <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, minWidth: 160 }}>
              <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', marginBottom: 2 }}>NOMBRE DEL FORMATO</Text>
              <TextInput
                value={formatoActivo.nombre}
                onChangeText={cambiarNombreFormato}
                placeholder="Nombre del formato…"
                placeholderTextColor={colors.muted}
                maxLength={40}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 5,
                  color: colors.text,
                  fontSize: 12,
                  backgroundColor: colors.surface,
                }}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-end', marginTop: 14 }}>
              <TouchableOpacity
                onPress={clonarFormatoActual}
                style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
              >
                <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>📄 Clonar</Text>
              </TouchableOpacity>

              {!formatoActivo.esDefecto ? (
                <>
                  <TouchableOpacity
                    onPress={() => hacerPrincipal(formatoActivo.id)}
                    style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
                  >
                    <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '700' }}>⭐ Hacer principal</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => eliminarFormato(formatoActivo.id)}
                    style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface }}
                  >
                    <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>🗑️ Eliminar</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          </View>

          {/* Asignación de Listeros */}
          <View style={{ marginTop: spacing.sm, paddingTop: spacing.xs }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 2 }}>
              👤 LISTEROS ASIGNADOS A «{formatoActivo.nombre}»
            </Text>
            <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: 6 }}>
              {formatoActivo.esDefecto
                ? '⭐ Formato por defecto: se aplica a todos los listeros que no tengan asignado un formato específico.'
                : 'Toca los listeros que deben usar este formato. Si un listero se desmarca, vuelve al formato principal.'}
            </Text>

            {listerosParaMostrar.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>
                No hay usuarios con rol de listero registrados todavía.
              </Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {listerosParaMostrar.map((l) => {
                  const asigId = asignaciones[l.id];
                  const fmtAsig = asigId ? formatos.find((f) => f.id === asigId) : null;
                  const enEsteFormato = formatoActivo.esDefecto
                    ? (!asigId || asigId === formatoActivo.id)
                    : (asigId === formatoActivo.id);

                  return (
                    <TouchableOpacity
                      key={l.id}
                      onPress={() => toggleListeroEnFormatoActivo(l.id)}
                      style={{
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: enEsteFormato ? colors.brand : colors.border,
                        backgroundColor: enEsteFormato ? colors.brand : colors.surface,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 5,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Text style={{ color: enEsteFormato ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11.5 }}>
                        {enEsteFormato ? '✓ ' : ''}👤 {l.full_name || l.email || 'Listero'}
                      </Text>
                      {!enEsteFormato && fmtAsig ? (
                        <Text style={{ color: colors.warning, fontSize: 10, fontWeight: '600' }}>
                          (en {fmtAsig.nombre})
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </View>

      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
        Editando configuración de «{formatoActivo.nombre}». Lo que marques acá es lo que imprimirán los listeros que tengan este formato.
        {cambios > 0 ? ` Hay ${cambios} cambio(s) respecto a como viene de fábrica.` : ''}
      </Text>

      {/* LA VISTA PREVIA VA ARRIBA, antes de los interruptores. Se marca un
          check y se ve el papel cambiar sin tener que buscarlo. */}
      <View style={{
        borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.brand,
        borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.sm, marginBottom: spacing.sm,
        maxWidth: enRollo ? 260 : undefined,
      }}>
        <Text style={{ color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 6 }}>
          ASÍ VA A SALIR · EJEMPLO ({formatoActivo.nombre.toUpperCase()})
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {LOGOS_TIQUE.filter((l) => config.logos[l.k]).map((l) => (
            <Text key={l.k} style={{ color: colors.muted, fontSize: 9, fontWeight: '700', borderWidth: 1, borderColor: colors.border, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 3 }}>
              {l.label.toUpperCase()}
            </Text>
          ))}
        </View>
        {renglones.map((r, i) => (
          <View key={`${r.k}-${i}`} style={{ flexDirection: 'row', gap: spacing.xs, paddingVertical: 2 }}>
            <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800', width: 70 }}>{r.k.toUpperCase()}</Text>
            <Text style={{ color: colors.text, fontSize: 11, flex: 1 }} numberOfLines={1}>{r.v}</Text>
          </View>
        ))}
        <Text style={{ color: colors.muted, fontSize: 9, marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
          RECIBÍ CONFORME ________________
        </Text>
      </View>

      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 2 }}>QUÉ DATOS SALEN</Text>
      <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: 4 }}>
        Cada dato encendido sale 🔤 automático (el dato de ese viaje) o ✍️ a mano: un texto fijo
        que se imprime IGUAL en todos los tickets. Toca la línea gris debajo del dato para
        ponérselo; vaciar el texto vuelve al automático.
      </Text>
      <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {CAMPOS_TIQUE.map((c) => (
          c.k === CAMPO_FIJO ? (
            // Se enseña, se explica y no se deja tocar. Esconderla sería peor:
            // el cliente pidió un check para cada cosa y merece ver por qué este
            // no se mueve. Y tampoco acepta texto a mano: es el correlativo.
            <View key={c.k} style={{ opacity: 0.55 }}>
              <Toggle on label={`${c.label} · fijo`} ayuda={c.ayuda} onPress={() => {}} />
            </View>
          ) : (
            <View key={c.k}>
              <Toggle on={config.campos[c.k]} label={c.label} ayuda={c.ayuda} onPress={() => campo(c.k)} />
              {/* El modo del dato, solo si el check está encendido: apagado ya
                  es «quitado» y no hay nada más que decidir. */}
              {config.campos[c.k] ? (
                textoAbierto === c.k ? (
                  <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center', marginLeft: spacing.lg, marginBottom: 6 }}>
                    <TextInput
                      value={config.textos[c.k] ?? ''}
                      onChangeText={(v) => texto(c.k, v)}
                      placeholder="Texto fijo (vacío = automático)"
                      placeholderTextColor={colors.muted}
                      maxLength={TEXTO_FIJO_MAX}
                      autoFocus
                      style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6, color: colors.text, fontSize: 12, backgroundColor: colors.surface }}
                    />
                    <TouchableOpacity onPress={() => setTextoAbierto(null)} style={{ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brand }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>Listo</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setTextoAbierto(c.k)} style={{ marginLeft: spacing.lg, marginBottom: 6 }}>
                    {(config.textos[c.k] ?? '').trim() ? (
                      <Text style={{ color: colors.warning, fontSize: 10.5, fontWeight: '700' }} numberOfLines={1}>
                        ✍️ A mano: «{(config.textos[c.k] ?? '').trim()}» · sale igual en TODOS
                      </Text>
                    ) : (
                      <Text style={{ color: colors.muted, fontSize: 10.5 }}>🔤 Automático · tocar para ponerlo a mano</Text>
                    )}
                  </TouchableOpacity>
                )
              ) : null}
            </View>
          )
        ))}
      </ScrollView>

      {/* ⚖️ En qué unidad se IMPRIMEN los pesos (27-sep-2026, a pedido). Solo
          cambia el texto del papel: el dato guardado es kilos siempre. */}
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm, marginBottom: 4 }}>⚖️ LOS PESOS DEL PAPEL, EN</Text>
      <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
        {UNIDADES_PESO.map((u) => {
          const on = config.pesosUnidad === u.k;
          return (
            <TouchableOpacity
              key={`pu-${u.k}`}
              onPress={() => {
                setConfig((c) => {
                  const nc = { ...c, pesosUnidad: u.k };
                  setFormatos((prev) => prev.map((f) => (f.id === formatoActivoId ? { ...f, config: nc } : f)));
                  return nc;
                });
              }}
              style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingVertical: 6, paddingHorizontal: spacing.sm }}
            >
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>{u.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>
        Solo cambia cómo se imprime: «32.540,00 Kg» o «32,540 Ton». El dato guardado sigue en kilos.
      </Text>

      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm, marginBottom: 2 }}>QUÉ LOGOS SALEN</Text>
      {LOGOS_TIQUE.map((l) => (
        <Toggle key={l.k} on={config.logos[l.k]} label={l.label} onPress={() => logo(l.k)} />
      ))}

      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm, marginBottom: 4 }}>EN QUÉ PAPEL</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {PAPELES.map((p) => {
          const on = config.papel === p.k;
          return (
            <TouchableOpacity
              key={p.k}
              onPress={() => papel(p.k)}
              style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingVertical: 6, paddingHorizontal: spacing.sm }}
            >
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>
        {PAPELES.find((p) => p.k === config.papel)?.ayuda}
      </Text>
      {aviso ? (
        <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, padding: spacing.sm, marginTop: spacing.xs }}>
          <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 11.5 }}>{aviso}</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <TouchableOpacity
          onPress={() => {
            setConfig(guardado);
            setFormatos(JSON.parse(JSON.stringify(guardadoFormatos)));
            setAsignaciones(JSON.parse(JSON.stringify(guardadoAsignaciones)));
          }}
          disabled={!sucio || ocupado}
          style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, opacity: !sucio || ocupado ? 0.5 : 1 }}
        >
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Deshacer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={guardar}
          disabled={!sucio || ocupado || sinTabla}
          style={{ flex: 2, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brand, opacity: !sucio || ocupado || sinTabla ? 0.5 : 1 }}
        >
          <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>
            {ocupado ? 'Guardando…' : '💾 Guardar lo que sale en el ticket'}
          </Text>
        </TouchableOpacity>
      </View>
    </Plegable>
  );
}

