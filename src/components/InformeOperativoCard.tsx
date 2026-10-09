// 📊 INFORME OPERATIVO DE TRANSPORTE Y CARGA · tarjeta (09-oct-2026).
//
// Pedido del cliente, con un consolidado de otra empresa en la mano: «¿cómo
// puedo sacar un reporte como ese desde el módulo de viajes de camiones?
// constrúyelo, y con todas las opciones posibles por si necesito quitar una
// columna o necesito colocar o quitar logos».
//
// Vive en el panel de información de Viajes de camiones, hermana de 💰 Pago de
// viajes y ⚖️ Pago por peso — pero NO es de plata: flota, viajes y toneladas
// por día, con su gráfico. Las reglas del cálculo viven en
// src/lib/informeOperativo.ts (pura, con su propia suite).
//
// ⚡ CONSULTA PEREZOSA (regla del 06-oct, «el sistema va lento»): cerrada no
//    pide nada; al abrirla baja SOLO los viajes del rango elegido, no desde el
//    inicio de los tiempos.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Plegable } from './Plegable';
import { DateField } from './DateField';
import { Toggle } from './CubicajeTab';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { selectAllRows } from '../lib/supabase';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { norm } from '../lib/text';
import {
  CSS_INFORME_OPERATIVO, FiltroOperativo, OpcionesInformeOperativo, OPCIONES_OPERATIVO_INICIAL,
  PASTILLAS_OPERATIVO, ViajeOperativo,
  acotarFiltroOperativo, alternarOperativo, camionesOperativo, cuerpoInformeOperativo,
  empresasOperativo, filtrarViajesOperativo, jornadaOperativa, nro, obrasOperativo,
  ocultosOperativoEnPalabras, resumenOperativo, sufijoArchivoOperativo, textoPicoFlota, zonasOperativo,
} from '../lib/informeOperativo';

type Props = {
  /** Solo se monta con nivel full (lo decide la pantalla), pero se recibe por claridad. */
  canVer: boolean;
};

const dmy = (iso: string) => {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesDe = (iso: string) => sumarDias(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
const primeroDelMes = (iso: string) => `${iso.slice(0, 7)}-01`;

// Lo que se le pide a la base por cada viaje: lo mínimo para contar y filtrar.
const COLS_OPERATIVO = 'id, machinery_id, machine_code, company_id, zona_pago, registered_at, peso_neto_kg, ubicacion_nombre, placa_snap, fuera_catalogo';

type Logos = { bcv: boolean; sos: boolean; golden: boolean; renace: boolean; jhenzaen: boolean };
// 🏷️ Regla de la casa en Viajes de camiones: el papel nace SIN logos y sin la
//    marca en texto; el que lo necesite enciende el suyo.
const LOGOS_POR_DEFECTO: Logos = { bcv: false, sos: false, golden: false, renace: false, jhenzaen: false };
const LOGOS: { k: keyof Logos; label: string }[] = [
  { k: 'bcv', label: '🏦 Banco Central de Venezuela' },
  { k: 'sos', label: '🛟 SOS La Guaira' },
  { k: 'golden', label: '✨ Golden Touch' },
  { k: 'renace', label: '🇻🇪 Plan Venezuela Renace' },
  { k: 'jhenzaen', label: '🏗️ Jhenzaen 2.012 C.A' },
];

export function InformeOperativoCard({ canVer }: Props) {
  const { colors } = useTheme();
  const hoy = jornadaOperativa(new Date().toISOString());

  const [desde, setDesde] = useState(() => lunesDe(jornadaOperativa(new Date().toISOString())));
  const [hasta, setHasta] = useState(() => jornadaOperativa(new Date().toISOString()));

  // ⚡ Solo consulta cuando la tarjeta se ABRE (Plegable onAbrir).
  const [yaPedido, setYaPedido] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viajes, setViajes] = useState<ViajeOperativo[]>([]);
  const [nombresEmpresa, setNombresEmpresa] = useState<Map<string, string>>(new Map());

  // Filtros del papel (vacío = todas) y opciones.
  const [empresasSel, setEmpresasSel] = useState<Set<string>>(new Set());
  const [obrasSel, setObrasSel] = useState<Set<string>>(new Set());
  const [zonasSel, setZonasSel] = useState<Set<string>>(new Set());
  const [camionesSel, setCamionesSel] = useState<Set<string>>(new Set());
  const [buscaCam, setBuscaCam] = useState('');
  const [opciones, setOpciones] = useState<OpcionesInformeOperativo>(OPCIONES_OPERATIVO_INICIAL);
  const [logos, setLogos] = useState<Logos>(LOGOS_POR_DEFECTO);
  const [descargando, setDescargando] = useState(false);

  const rangoInvalido = hasta < desde;

  const cargar = useCallback(async () => {
    if (rangoInvalido) return;
    setCargando(true);
    setError(null);
    try {
      // La jornada va de 7am a 7am: el rango en instantes es [desde 7am, hasta+1 7am).
      const finExclusivo = sumarDias(hasta, 1);
      const [filas, empresas] = await Promise.all([
        selectAllRows('camion_viajes', COLS_OPERATIVO, (q: any) =>
          q.gte('registered_at', `${desde}T07:00:00-04:00`).lt('registered_at', `${finExclusivo}T07:00:00-04:00`)),
        selectAllRows('companies', 'id, name'),
      ]);
      setViajes(filas as ViajeOperativo[]);
      setNombresEmpresa(new Map((empresas as any[]).map((c) => [c.id as string, String(c.name ?? '')])));
    } catch (e: any) {
      // Con datos a medias el informe diría números equivocados: mejor decirlo.
      setError(e?.message ?? 'No se pudo leer los viajes.');
      setViajes([]);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, rangoInvalido]);

  useEffect(() => { if (yaPedido) cargar(); }, [yaPedido, cargar]);

  // Catálogos del rango (para las pastillas de filtro) y el filtro acotado.
  const empresasHay = useMemo(() => empresasOperativo(viajes), [viajes]);
  const obrasHay = useMemo(() => obrasOperativo(viajes), [viajes]);
  const zonasHay = useMemo(() => zonasOperativo(viajes), [viajes]);
  const camionesHay = useMemo(() => camionesOperativo(viajes), [viajes]);
  const camionesVistos = useMemo(() => {
    const q = norm(buscaCam.trim());
    if (!q) return camionesHay;
    return camionesHay.filter((c) => [c.code, c.placa ?? ''].some((v) => norm(v).includes(q)));
  }, [camionesHay, buscaCam]);

  const filtro: FiltroOperativo = useMemo(() => acotarFiltroOperativo(
    { empresas: Array.from(empresasSel), obras: Array.from(obrasSel), zonas: Array.from(zonasSel), camiones: Array.from(camionesSel) },
    { empresas: empresasHay.map((x) => x.id), obras: obrasHay.map((x) => x.id), zonas: zonasHay.map((x) => x.id), camiones: camionesHay.map((x) => x.id) },
  ), [empresasSel, obrasSel, zonasSel, camionesSel, empresasHay, obrasHay, zonasHay, camionesHay]);

  const filtrados = useMemo(() => filtrarViajesOperativo(viajes, filtro), [viajes, filtro]);
  const filtrado = filtro.empresas.length > 0 || filtro.obras.length > 0 || filtro.zonas.length > 0 || filtro.camiones.length > 0;
  const resumen = useMemo(() => resumenOperativo(filtrados, desde, hasta), [filtrados, desde, hasta]);

  const descargarPdf = async () => {
    setDescargando(true);
    try {
      const html = pdfDocument({
        title: 'Informe operativo de transporte y carga',
        subtitle: `Del ${dmy(desde)} al ${dmy(hasta)} · por jornada (7am a 7am) · sin montos${filtrado ? ' · FILTRADO' : ''}`,
        extraCss: CSS_INFORME_OPERATIVO,
        logos,
        // Regla de la casa en este módulo: sin la marca en texto «BCV / SOS».
        marcaTexto: false,
        body: cuerpoInformeOperativo({
          resumen, viajes: filtrados, desde, hasta,
          // Un papel FILTRADO siempre lleva su alcance, aunque lo hayan apagado.
          opciones: filtrado ? { ...opciones, sinAlcance: false } : opciones,
          filtro, nombresEmpresa,
        }),
      });
      await exportPdf(html, `Informe operativo ${sufijoArchivoOperativo(desde, hasta, opciones, filtrado)}`.replace(/\//g, '-'));
    } finally {
      setDescargando(false);
    }
  };

  const pastilla = (key: string, label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} onPress={onPress}
      style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
  const rotulo = (t: string) => <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm, marginBottom: 4 }}>{t}</Text>;
  const alternarSel = (set: Set<string>, poner: (x: Set<string>) => void, k: string) => {
    const n = new Set(set);
    if (n.has(k)) n.delete(k); else n.add(k);
    poner(n);
  };
  const atajo = (label: string, d: string, h: string) => {
    const on = desde === d && hasta === h;
    return (
      <TouchableOpacity key={label} onPress={() => { setDesde(d); setHasta(h); }}
        style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
      </TouchableOpacity>
    );
  };

  if (!canVer) return null;

  // Los cuadros grandes, también en pantalla (los mismos cuatro del papel).
  const tiles = [
    { k: 'ton', titulo: 'Toneladas', valor: `${nro(resumen.toneladas)} t`, nota: resumen.sinPeso > 0 ? `${nro(resumen.conPeso, 0)} viaje(s) pesados` : 'carga transportada' },
    { k: 'via', titulo: 'Viajes', valor: nro(resumen.viajes, 0), nota: `${nro(resumen.viajesPorDiaProm, 1)} por día` },
    { k: 'flo', titulo: 'Flota máxima', valor: `${nro(resumen.flotaMax, 0)} camión(es)`, nota: textoPicoFlota(resumen.flotaMaxJornadas) || `${nro(resumen.flotaRango, 0)} en el rango` },
    { k: 'efi', titulo: 'T/Viaje', valor: resumen.tPorViajeProm == null ? '—' : nro(resumen.tPorViajeProm), nota: 'sobre viajes con peso' },
  ];

  return (
    <Plegable
      titulo="📊 Informe operativo (carga y flota)"
      resumen={error ? '⚠️ no se pudo leer'
        : !yaPedido ? 'toca para armar el consolidado del rango'
          : cargando ? 'leyendo los viajes…'
            : `${nro(resumen.viajes, 0)} viaje(s) · ${nro(resumen.toneladas)} t · flota máx ${nro(resumen.flotaMax, 0)}`}
      alerta={!!error}
      onAbrir={(abierta) => { if (abierta) setYaPedido(true); }}
    >
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        El consolidado del día a día: flota, viajes, toneladas y T/viaje — SIN montos. Entran TODOS los
        viajes registrados (no mira modos de pago ni «no facturó»). Las toneladas salen del peso de romana
        congelado en cada viaje; un viaje sin pesar cuenta como viaje y suma 0 kg, y el papel lo dice.
      </Text>

      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Desde</Text>
          <DateField value={desde} onChange={setDesde} />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Hasta</Text>
          <DateField value={hasta} onChange={setHasta} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.sm }}>
        {atajo('Esta semana', lunesDe(hoy), hoy)}
        {atajo('Semana pasada', sumarDias(lunesDe(hoy), -7), sumarDias(lunesDe(hoy), -1))}
        {atajo('Hoy', hoy, hoy)}
        {atajo('Este mes', primeroDelMes(hoy), hoy)}
      </View>
      {rangoInvalido ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>La fecha «hasta» no puede ser anterior a «desde».</Text> : null}
      {error ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: spacing.sm }}>❌ {error}</Text> : null}

      {!error && yaPedido ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
          {tiles.map((t) => (
            <View key={t.k} style={{ flexGrow: 1, flexBasis: 130, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
              <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' }}>{t.titulo}</Text>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, fontVariant: ['tabular-nums'] as any }}>{t.valor}</Text>
              {t.nota ? <Text style={{ color: colors.muted, fontSize: 11 }}>{t.nota}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      {!error && yaPedido && resumen.sinPeso > 0 ? (
        <Text style={{ color: colors.warning, fontSize: 12, marginTop: 4 }}>
          ⚠️ {nro(resumen.sinPeso, 0)} viaje(s) del rango sin peso de romana: cuentan como viajes, no suman toneladas.
        </Text>
      ) : null}

      <TouchableOpacity
        disabled={descargando || cargando || rangoInvalido || !yaPedido || !!error || resumen.viajes === 0}
        onPress={descargarPdf}
        style={{ marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: descargando || cargando || rangoInvalido || !yaPedido || !!error || resumen.viajes === 0 ? 0.5 : 1 }}>
        <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{descargando ? 'Armando el papel…' : '📄 Descargar el informe (PDF)'}</Text>
      </TouchableOpacity>

      <Plegable
        titulo="⚙️ Opciones del informe"
        resumen={`${filtrado ? 'filtrado · ' : ''}${ocultosOperativoEnPalabras(opciones)}`}
        alerta={filtrado}
      >
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          Esto cambia SOLO el papel. Sin marcar nada, sale como el informe de muestra. Ocultar no cambia
          ningún número; FILTRAR sí, y entonces el papel sale marcado «FILTRADO».
        </Text>

        {rotulo(`🧭 ZONAS (vacío = todas · ${zonasHay.length})`)}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {pastilla('z-todas', '✅ Todas', filtro.zonas.length === 0, () => setZonasSel(new Set()))}
          {zonasHay.map((x) => pastilla('z' + x.id, `${x.name} (${x.viajes})`, filtro.zonas.includes(x.id), () => alternarSel(zonasSel, setZonasSel, x.id)))}
        </View>

        {rotulo(`📍 OBRAS (vacío = todas · ${obrasHay.length})`)}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {pastilla('o-todas', '✅ Todas', filtro.obras.length === 0, () => setObrasSel(new Set()))}
          {obrasHay.map((x) => pastilla('o' + x.id, `${x.name} (${x.viajes})`, filtro.obras.includes(x.id), () => alternarSel(obrasSel, setObrasSel, x.id)))}
        </View>

        {rotulo(`🏢 EMPRESAS (vacío = todas · ${empresasHay.length})`)}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {pastilla('e-todas', '✅ Todas', filtro.empresas.length === 0, () => setEmpresasSel(new Set()))}
          {empresasHay.map((x) => pastilla('e' + x.id, `${nombresEmpresa.get(x.id) ?? (x.id === '(sin empresa)' ? 'Sin empresa' : 'Empresa')} (${x.viajes})`, filtro.empresas.includes(x.id), () => alternarSel(empresasSel, setEmpresasSel, x.id)))}
        </View>

        {rotulo(`🚜 CAMIONES (vacío = todos · ${camionesHay.length})`)}
        <TextInput
          value={buscaCam}
          onChangeText={setBuscaCam}
          placeholder="🔎 Buscar por código o placa…"
          placeholderTextColor={colors.muted}
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.xs }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {pastilla('c-todas', '✅ Todos', filtro.camiones.length === 0, () => setCamionesSel(new Set()))}
          {camionesVistos.map((c) => pastilla('c' + c.id, `${c.code}${c.placa ? ` · ${c.placa}` : ''} (${c.viajes})`, filtro.camiones.includes(c.id), () => alternarSel(camionesSel, setCamionesSel, c.id)))}
        </View>
        {filtro.camiones.length > 0 && camionesVistos.length < camionesHay.length ? (
          <Text style={{ color: colors.warning, fontSize: 11, marginTop: 4 }}>La búsqueda esconde camiones, pero los marcados siguen filtrando.</Text>
        ) : null}

        {rotulo('🖨️ ¿QUÉ SE OCULTA EN EL PAPEL?')}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {PASTILLAS_OPERATIVO.map((p) => pastilla('p' + p.key, p.chip, opciones[p.key], () => setOpciones((o) => alternarOperativo(o, p.key))))}
        </View>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
          Encendida = NO sale (los dos cuadros extra nacen ocultos: tócalos para INCLUIRLOS). {ocultosOperativoEnPalabras(opciones)}
        </Text>

        {rotulo('🏷️ QUÉ LOGOS LLEVA EL MEMBRETE')}
        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>
          Este papel nace SIN logos y sin el pie «Banco Central de Venezuela / SOS La Guaira». Enciende el que necesites.
        </Text>
        {LOGOS.map((l) => (
          <Toggle key={l.k} on={logos[l.k]} label={l.label} onPress={() => setLogos((p) => ({ ...p, [l.k]: !p[l.k] }))} />
        ))}
      </Plegable>
    </Plegable>
  );
}
