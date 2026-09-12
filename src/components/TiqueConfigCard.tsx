// QUÉ SALE EN EL TIQUE · la pantalla de configuración (12-sep-2026).
//
// Pedido del cliente: «un chek para cada cosa, placa, modelo, todo lo que deba
// llevar el ticket, yo pueda activar o desactivar para que cuando lo impriman le
// salga o no les salga».
//
// ⚠️ LA VISTA PREVIA NO ES ADORNO. Sin ella, la única manera de saber cómo quedó
//    el tique es imprimir uno y mirarlo, y eso son diez viajes al patio. El
//    ejemplo de la derecha se arma con LAS MISMAS funciones que arman el papel,
//    así que lo que se ve es lo que sale.
//
// ⚠️ SE GUARDA CUANDO TOCAS «Guardar», NO A CADA CLIC. Guardar en cada
//    interruptor manda quince escrituras seguidas mientras alguien está
//    decidiendo, y deja el formato a medio cambiar si se va la señal en el
//    medio. Mientras hay cambios sin guardar, la tarjeta lo dice.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Plegable } from './Plegable';
import { Toggle } from './CubicajeTab';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import {
  CAMPOS_TIQUE, CAMPO_FIJO, CONFIG_POR_DEFECTO, LOGOS_TIQUE, PAPELES,
  cambiosRespectoAlDefecto, resumenConfig,
  type ClaveCampo, type ClaveLogo, type PapelTique, type TiqueConfig,
} from '../lib/tiqueConfig';
import { guardarConfigTique, leerConfigTique } from '../lib/tiqueConfigDatos';

/** Un viaje de mentira para la vista previa. Datos inventados a propósito: la
 *  placa no es de ningún camión de la flota, para que nadie confunda el ejemplo
 *  con un tique de verdad. */
const EJEMPLO: Record<ClaveCampo, { k: string; v: string }> = {
  folio:       { k: 'Tique',    v: 'CDT-000001' },
  fecha:       { k: 'Fecha',    v: '14/09/2026' },
  hora:        { k: 'Hora',     v: '08:42 a. m.' },
  placa:       { k: 'Placa',    v: 'A31KM7B' },
  empresa:     { k: 'Empresa',  v: 'GOLDEN TOUCH 1127 CA' },
  cdt:         { k: 'CDT',      v: 'CDT Parque del Agua' },
  jornada:     { k: 'Jornada',  v: '14/09/2026' },
  turno:       { k: 'Turno',    v: 'Día' },
  codigo:      { k: 'Equipo',   v: 'CAMION VOLTEO TORONTO' },
  marcaModelo: { k: 'Marca',    v: 'IVECO EUROTRAKKER' },
  serial:      { k: 'Serial',   v: 'T6757T4936' },
  chofer:      { k: 'Chofer',   v: 'Chofer del turno' },
  listero:     { k: 'Listero',  v: 'Listero del CDT' },
  m3:          { k: 'Volumen',  v: '16,82 m³' },
  estado:      { k: 'Estado',   v: 'Operativa' },
  nota:        { k: 'Nota',     v: '—' },
};

export function TiqueConfigCard({ uid }: { uid: string | null }) {
  const { colors } = useTheme();
  const toast = useToast();
  const [config, setConfig] = useState<TiqueConfig>(CONFIG_POR_DEFECTO);
  const [guardado, setGuardado] = useState<TiqueConfig>(CONFIG_POR_DEFECTO);
  const [cargando, setCargando] = useState(true);
  const [sinTabla, setSinTabla] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    leerConfigTique().then((r) => {
      if (!vivo) return;
      setConfig(r.config);
      setGuardado(r.config);
      setSinTabla(r.sinTabla);
      setCargando(false);
      if (r.error) toast.error(`No se pudo leer la configuración del tique: ${r.error}`);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sucio = useMemo(() => JSON.stringify(config) !== JSON.stringify(guardado), [config, guardado]);
  const cambios = useMemo(() => cambiosRespectoAlDefecto(config), [config]);

  const campo = (k: ClaveCampo) => setConfig((c) => ({ ...c, campos: { ...c.campos, [k]: !c.campos[k] } }));
  const logo = (k: ClaveLogo) => setConfig((c) => ({ ...c, logos: { ...c.logos, [k]: !c.logos[k] } }));
  const papel = (p: PapelTique) => setConfig((c) => ({ ...c, papel: p }));

  const guardar = async () => {
    setOcupado(true);
    const r = await guardarConfigTique(config, uid);
    setOcupado(false);
    if (r.sinTabla) { setSinTabla(true); toast.error('Falta correr el SQL de la tiquetera. La configuración no se guardó.'); return; }
    if (r.error) { toast.error(`No se pudo guardar: ${r.error}`); return; }
    setGuardado(config);
    toast.success('Listo. Los tiques van a salir así desde ahora.');
  };

  const enRollo = config.papel === 'rollo80' || config.papel === 'rollo58';
  const visibles = CAMPOS_TIQUE.filter((c) => config.campos[c.k]);

  return (
    <Plegable
      titulo="🎫 Qué sale en el tique"
      resumen={cargando ? 'Leyendo la configuración…' : sucio ? '⚠️ Tienes cambios sin guardar' : resumenConfig(config)}
      alerta={sucio || sinTabla}
    >
      {sinTabla ? (
        <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>⏳ Falta correr el SQL de la tiquetera</Text>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
            Puedes mirar cómo quedaría, pero lo que marques no se guarda todavía.
          </Text>
        </View>
      ) : null}

      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
        Esto vale para TODOS: lo que marques acá es lo que imprimen los chamos en el CDT.
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
          ASÍ VA A SALIR · EJEMPLO
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {LOGOS_TIQUE.filter((l) => config.logos[l.k]).map((l) => (
            <Text key={l.k} style={{ color: colors.muted, fontSize: 9, fontWeight: '700', borderWidth: 1, borderColor: colors.border, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 3 }}>
              {l.label.toUpperCase()}
            </Text>
          ))}
        </View>
        {visibles.map((c) => (
          <View key={c.k} style={{ flexDirection: 'row', gap: spacing.xs, paddingVertical: 2 }}>
            <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800', width: 70 }}>{EJEMPLO[c.k].k.toUpperCase()}</Text>
            <Text style={{ color: colors.text, fontSize: 11, flex: 1 }} numberOfLines={1}>{EJEMPLO[c.k].v}</Text>
          </View>
        ))}
        <Text style={{ color: colors.muted, fontSize: 9, marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
          RECIBÍ CONFORME ________________
        </Text>
      </View>

      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 2 }}>QUÉ DATOS SALEN</Text>
      <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled>
        {CAMPOS_TIQUE.map((c) => (
          c.k === CAMPO_FIJO ? (
            // Se enseña, se explica y no se deja tocar. Esconderla sería peor:
            // el cliente pidió un check para cada cosa y merece ver por qué este
            // no se mueve.
            <View key={c.k} style={{ opacity: 0.55 }}>
              <Toggle on label={`${c.label} · fijo`} ayuda={c.ayuda} onPress={() => {}} />
            </View>
          ) : (
            <Toggle key={c.k} on={config.campos[c.k]} label={c.label} ayuda={c.ayuda} onPress={() => campo(c.k)} />
          )
        ))}
      </ScrollView>

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

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <TouchableOpacity
          onPress={() => setConfig(guardado)}
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
            {ocupado ? 'Guardando…' : '💾 Guardar lo que sale en el tique'}
          </Text>
        </TouchableOpacity>
      </View>
    </Plegable>
  );
}
