// PAGO POR PESO · tarifas (03-oct-2026).
//
// Se abre desde la tarjeta «⚖️ Pago por peso» de Viajes de camiones. Calcado de
// PagoViajesPanel + PagoViajesTarifas, pero SIN la pestaña de camiones: en el pago
// por peso TODO camión entra, así que lo único que se configura son las tarifas.
//
// Una tarifa dice el precio POR TONELADA o POR KILO; se le pone a todos los camiones,
// a una empresa, a un grupo de camiones o a un solo camión; en Este, en Oeste o en
// ambas zonas; desde una fecha o blindada a un rango. Si a un viaje le tocan varias,
// manda la más específica (src/lib/pagoPeso.ts, tarifaPesoEn). Nunca se borran: se anulan.
//
// ⭐ Tabla propia (viaje_tarifas_peso). Si todavía no existe en la base, la pantalla
//    lo dice y el formulario queda apagado, en vez de reventar.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Screen, SectionTitle, Card } from './ui';
import { DateField } from './DateField';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { esCamionDeViajes } from '../lib/equipos';
import { cmpText, onlyDecimal } from '../lib/text';
import {
  AlcancePeso,
  TarifaPeso,
  UnidadTarifaPeso,
  alcancePeso,
  etiquetaAlcancePeso,
  etiquetaZonaPeso,
  jornadaDeInstantePeso,
  tarifaPesoEn,
  textoPrecioPeso,
  validarTarifaPeso,
} from '../lib/pagoPeso';
import { anularTarifaPeso, cargarTarifasPeso, crearTarifaPeso } from '../lib/pagoPesoDb';
import { cargarMaquinasCatalogo, CamionCatalogo } from '../lib/pagoViajesDb';

type Props = {
  visible: boolean;
  onClose: () => void;
  canEdit: boolean;
  usuarioId: string | null;
  /** Se llama después de guardar algo, para que el resumen del pago recalcule. */
  onChanged: () => void;
};

const UNIDADES: { key: UnidadTarifaPeso; label: string }[] = [
  { key: 'ton', label: 'Por tonelada' },
  { key: 'kg', label: 'Por kilo' },
];
const ALCANCES: { key: AlcancePeso; label: string; ayuda: string }[] = [
  { key: 'general', label: '🌐 Todos', ayuda: 'Para todos los camiones que no tengan una tarifa especial.' },
  { key: 'empresa', label: '🏢 Una empresa', ayuda: 'Solo para los viajes de esa empresa.' },
  { key: 'grupo', label: '👥 Grupo de camiones', ayuda: 'Solo para los camiones que elijas (p. ej. los chutos de una empresa).' },
  { key: 'camion', label: '🚛 Un camión', ayuda: 'Solo para ese camión. Con «Ambas zonas» le fijas su precio vaya al Este o al Oeste.' },
];
type ZonaForm = 'este' | 'oeste' | 'ambas';
const ZONAS: { key: ZonaForm; label: string }[] = [
  { key: 'este', label: 'Este' },
  { key: 'oeste', label: 'Oeste' },
  { key: 'ambas', label: 'Ambas zonas' },
];

const dmy = (iso?: string | null) => {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const esChuto = (code: string) => norm(code).trim().startsWith('chuto');

export function PagoPesoPanel({ visible, onClose, canEdit, usuarioId, onChanged }: Props) {
  const { colors } = useTheme();
  const hoy = jornadaDeInstantePeso(new Date().toISOString());

  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [faltaSql, setFaltaSql] = useState(false);
  const [tarifas, setTarifas] = useState<TarifaPeso[]>([]);
  const [maquinas, setMaquinas] = useState<CamionCatalogo[]>([]);

  // Formulario
  const [unidad, setUnidad] = useState<UnidadTarifaPeso>('ton');
  const [alcance, setAlcance] = useState<AlcancePeso>('general');
  // Ambas zonas por defecto: en el peso lo normal es un solo precio, vaya donde vaya.
  const [zona, setZona] = useState<ZonaForm>('ambas');
  const [precio, setPrecio] = useState('');
  const [desde, setDesde] = useState(hoy);
  const [conHasta, setConHasta] = useState(false);
  const [hasta, setHasta] = useState(hoy);
  const [nota, setNota] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [camiones, setCamiones] = useState<string[]>([]);
  const [grupoNombre, setGrupoNombre] = useState('');
  const [buscar, setBuscar] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Historial
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [verAnuladas, setVerAnuladas] = useState(false);
  const [filtroHist, setFiltroHist] = useState<'todas' | AlcancePeso>('todas');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [t, maq] = await Promise.all([cargarTarifasPeso(), cargarMaquinasCatalogo()]);
      setTarifas(t.tarifas);
      setFaltaSql(t.faltaSql);
      setMaquinas(maq);
    } catch (e: any) {
      setError(`No se pudo leer las tarifas por peso (${e?.message ?? 'revisa la conexión'}).`);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (visible) { setAviso(null); cargar(); }
  }, [visible, cargar]);

  const puedeEditar = canEdit && !faltaSql;

  // Catálogo: los camiones activos del pago, igual que en el pago por viaje.
  const catalogo = useMemo(
    () => maquinas.filter((m) => m.activa && esCamionDeViajes(m.code)).sort((a, b) => cmpText(a.company, b.company) || cmpText(a.code, b.code)),
    [maquinas],
  );
  const porId = useMemo(() => new Map(maquinas.map((m) => [m.id, m])), [maquinas]);
  const nombreEmpresa = useMemo(() => {
    const m = new Map<string, string>();
    maquinas.forEach((c) => { if (c.companyId) m.set(c.companyId, c.company); });
    return m;
  }, [maquinas]);
  const empresas = useMemo(() => {
    const m = new Map<string, string>();
    catalogo.forEach((c) => { if (c.companyId) m.set(c.companyId, c.company); });
    return Array.from(m, ([id, nombre]) => ({ id, nombre })).sort((a, b) => cmpText(a.nombre, b.nombre));
  }, [catalogo]);

  const visibles = useMemo(() => {
    const q = norm(buscar.trim());
    return catalogo.filter((c) => !q || norm(`${c.code} ${c.plate ?? ''} ${c.serial ?? ''} ${c.company}`).includes(q));
  }, [catalogo, buscar]);
  const visiblesPorEmpresa = useMemo(() => {
    const m = new Map<string, CamionCatalogo[]>();
    visibles.forEach((c) => { const a = m.get(c.company) ?? []; a.push(c); m.set(c.company, a); });
    return Array.from(m.entries());
  }, [visibles]);

  // Grupos ya usados, para no volver a elegir camión por camión (el último guardado con ese nombre).
  const gruposAnteriores = useMemo(() => {
    const m = new Map<string, TarifaPeso>();
    tarifas
      .slice()
      .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
      .forEach((t) => {
        if (alcancePeso(t) === 'grupo' && t.grupo_nombre && (t.machinery_ids ?? []).length) m.set(norm(t.grupo_nombre.trim()), t);
      });
    return Array.from(m.values()).sort((a, b) => cmpText(a.grupo_nombre ?? '', b.grupo_nombre ?? ''));
  }, [tarifas]);

  // ── Vigentes hoy ── la de todos (Este / Oeste) y las empresas con tarifa propia.
  const vigentesTodos = useMemo(
    () => (['este', 'oeste'] as const).map((z) => ({ zona: z, t: tarifaPesoEn(tarifas, z, hoy) })),
    [tarifas, hoy],
  );
  const vigentesEmpresa = useMemo(
    () => empresas
      .map((e) => ({
        ...e,
        este: tarifaPesoEn(tarifas, 'este', hoy, { companyId: e.id }),
        oeste: tarifaPesoEn(tarifas, 'oeste', hoy, { companyId: e.id }),
      }))
      .filter((e) => alcancePeso(e.este) === 'empresa' || alcancePeso(e.oeste) === 'empresa'),
    [empresas, tarifas, hoy],
  );
  const especialesHoy = useMemo(
    () => tarifas.filter((t) => !t.anulada_at && alcancePeso(t) !== 'general'
      && String(t.desde).slice(0, 10) <= hoy && (!t.hasta || String(t.hasta).slice(0, 10) >= hoy)).length,
    [tarifas, hoy],
  );

  const historial = useMemo(
    () => tarifas
      .filter((t) => (verAnuladas || !t.anulada_at) && (filtroHist === 'todas' || alcancePeso(t) === filtroHist))
      .slice()
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))),
    [tarifas, verAnuladas, filtroHist],
  );

  const codigo = (id: string) => porId.get(id)?.code ?? 'camión fuera del catálogo';
  const describir = (t: TarifaPeso) => {
    const ids = t.machinery_ids ?? [];
    switch (alcancePeso(t)) {
      case 'empresa': return `🏢 ${nombreEmpresa.get(t.company_id ?? '') ?? 'Empresa'}`;
      case 'grupo': return `👥 ${t.grupo_nombre ?? 'Grupo'} (${ids.length} camión(es))`;
      case 'camion': return `🚛 ${ids[0] ? codigo(ids[0]) : 'Camión'}`;
      case 'general': return '🌐 Todos';
      default: return '❓ Tarifa desconocida';
    }
  };

  const cambiarAlcance = (a: AlcancePeso) => {
    setAlcance(a);
    if (a === 'camion') setCamiones((prev) => prev.slice(0, 1));
  };
  const tocarCamion = (id: string) => {
    if (alcance === 'camion') setCamiones((prev) => (prev[0] === id ? [] : [id]));
    else setCamiones((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const agregar = (ids: string[]) => setCamiones((prev) => Array.from(new Set([...prev, ...ids])));

  const conCamiones = alcance === 'grupo' || alcance === 'camion';

  // Qué cobra HOY el camión (o la empresa) elegido con las tarifas ya guardadas.
  const vistaHoy = useMemo(() => {
    const ctx = conCamiones && camiones.length === 1
      ? { machineryId: camiones[0], companyId: porId.get(camiones[0])?.companyId ?? null, nombre: codigo(camiones[0]) }
      : alcance === 'empresa' && companyId
        ? { machineryId: null, companyId, nombre: nombreEmpresa.get(companyId) ?? 'la empresa' }
        : null;
    if (!ctx) return null;
    const t = (z: 'este' | 'oeste') => tarifaPesoEn(tarifas, z, hoy, ctx);
    return { nombre: ctx.nombre, este: t('este'), oeste: t('oeste') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conCamiones, camiones, alcance, companyId, tarifas, hoy, porId, nombreEmpresa]);

  const guardar = async () => {
    setAviso(null);
    const elegidos = conCamiones ? camiones : [];
    const motivo = validarTarifaPeso({ unidad, zona, precio, desde, hasta: conHasta ? hasta : null, alcance, companyId, camiones: elegidos, grupoNombre });
    if (motivo) { setAviso(`❌ ${motivo}`); return; }
    setGuardando(true);
    const precioNum = Number(precio.replace(',', '.'));
    const { error: err } = await crearTarifaPeso({
      unidad,
      zona: zona === 'ambas' ? null : zona,
      precio: precioNum,
      desde,
      hasta: conHasta ? hasta : null,
      nota,
      alcance,
      companyId,
      grupoNombre,
      camiones: elegidos,
    });
    setGuardando(false);
    if (err) { setAviso(`❌ ${err}`); return; }
    const aQuien = alcance === 'empresa' ? `🏢 ${nombreEmpresa.get(companyId ?? '') ?? 'Empresa'}`
      : alcance === 'grupo' ? `👥 ${grupoNombre.trim()} (${elegidos.length} camión(es))`
        : alcance === 'camion' ? `🚛 ${codigo(elegidos[0])}`
          : '🌐 Todos';
    const zonaTxt = ZONAS.find((z) => z.key === zona)?.label ?? '';
    const precioTxt = textoPrecioPeso({ id: '', unidad, precio: precioNum, desde });
    setAviso(`✅ ${aQuien} · ${zonaTxt} · ${precioTxt} ${conHasta
      ? `blindada del ${dmy(desde)} al ${dmy(hasta)}. Fuera de ese rango no cambia nada.`
      : `desde el ${dmy(desde)} en adelante. Los días anteriores conservan su tarifa.`}`);
    setPrecio('');
    setNota('');
    await cargar();
    onChanged();
  };

  const confirmarAnular = async (t: TarifaPeso) => {
    if (!motivoAnular.trim()) { setAviso('❌ Escribe el motivo de la anulación.'); return; }
    const { error: err } = await anularTarifaPeso(t.id, motivoAnular, usuarioId);
    if (err) { setAviso(`❌ ${err}`); return; }
    setAnulando(null);
    setMotivoAnular('');
    setAviso('✅ Tarifa anulada. Los viajes que cubría vuelven a tomar la tarifa que les toque.');
    await cargar();
    onChanged();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const chip = (activo: boolean) => ({ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: activo ? colors.brand : colors.border, backgroundColor: activo ? colors.brand : colors.surface });
  const chipTxt = (activo: boolean) => ({ color: activo ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });
  const etiqueta = { color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 } as const;
  const textoVigente = (t: TarifaPeso | null) => (t ? textoPrecioPeso(t) : 'sin tarifa');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <TouchableOpacity onPress={onClose} style={{ paddingVertical: spacing.xs, marginBottom: spacing.xs }}>
          <Text style={{ color: colors.brandText, fontWeight: '800' }}>← Volver</Text>
        </TouchableOpacity>
        <SectionTitle>⚖️ Tarifas por peso</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          Cada viaje se paga por el neto de la romana (bruto − tara) al precio por tonelada o por kilo que le toque:
          el de todos, o uno especial de su empresa, de un grupo o del camión; en Este, en Oeste o en ambas zonas.
          Todo camión entra. Esto no toca las jornadas ni el pago por viaje. Todo cambio rige desde la fecha que elijas
          y no toca lo anterior.
        </Text>

        {error ? (
          <View style={{ borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoftBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.danger, fontWeight: '700' }}>⚠️ {error}</Text>
          </View>
        ) : null}
        {faltaSql ? (
          <View style={{ borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoftBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 13 }}>
              ⚠️ Falta correr el SQL de las tarifas por peso en la base. Hasta entonces no se pueden guardar tarifas y todo sale «sin tarifa».
            </Text>
          </View>
        ) : null}
        {!canEdit ? (
          <Text style={{ color: colors.warning, fontSize: 12, marginBottom: spacing.sm }}>Solo lectura: para cambiar tarifas hace falta permiso completo en Viajes de camiones.</Text>
        ) : null}

        <ScrollView style={{ flex: 1 }}>
          {aviso ? (
            <TouchableOpacity onPress={() => setAviso(null)} style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: aviso.startsWith('❌') ? colors.danger : colors.success, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
              <Text style={{ color: colors.text, fontSize: 13 }}>{aviso}</Text>
            </TouchableOpacity>
          ) : null}

          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>Vigentes hoy ({dmy(hoy)})</Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Para todos</Text>
            {vigentesTodos.map(({ zona: z, t }) => (
              <Text key={z} style={{ color: colors.text, fontSize: 13 }}>
                {z === 'este' ? 'Este' : 'Oeste'}: <Text style={{ fontWeight: '800' }}>{textoVigente(t)}</Text>
                {t ? <Text style={{ color: colors.muted }}>{t.hasta ? `  · blindada ${dmy(t.desde)} → ${dmy(t.hasta)}` : `  · desde ${dmy(t.desde)}`}</Text> : null}
              </Text>
            ))}
            {vigentesEmpresa.length ? (
              <>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs, marginBottom: 2 }}>Empresas con tarifa propia</Text>
                {vigentesEmpresa.map((e) => (
                  <Text key={e.id} style={{ color: colors.text, fontSize: 13 }}>
                    🏢 {e.nombre}: <Text style={{ fontWeight: '800' }}>Este {textoVigente(e.este)} · Oeste {textoVigente(e.oeste)}</Text>
                  </Text>
                ))}
              </>
            ) : null}
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
              {especialesHoy ? `${especialesHoy} tarifa(s) especial(es) vigente(s) hoy (empresa, grupo o camión).` : 'Sin tarifas especiales vigentes hoy.'}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
              Si a un viaje le tocan varias, manda la más específica: camión → grupo → empresa → todos. Entre dos del mismo tipo,
              la blindada; si no, la de fecha más reciente.
            </Text>
          </Card>

          {canEdit ? (
            <Card style={faltaSql ? { opacity: 0.55 } : undefined}>
              <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>➕ Nueva tarifa</Text>

              <Text style={{ ...etiqueta, marginTop: 0 }}>Unidad del precio</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                {UNIDADES.map((u) => (
                  <TouchableOpacity key={u.key} disabled={!puedeEditar} onPress={() => setUnidad(u.key)} style={chip(unidad === u.key)}>
                    <Text style={chipTxt(unidad === u.key)}>{u.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={etiqueta}>¿A quién aplica?</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                {ALCANCES.map((a) => (
                  <TouchableOpacity key={a.key} disabled={!puedeEditar} onPress={() => cambiarAlcance(a.key)} style={chip(alcance === a.key)}>
                    <Text style={chipTxt(alcance === a.key)}>{a.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>{ALCANCES.find((a) => a.key === alcance)?.ayuda}</Text>

              {alcance === 'empresa' ? (
                <>
                  <Text style={etiqueta}>Empresa</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                    {empresas.map((e) => (
                      <TouchableOpacity key={e.id} disabled={!puedeEditar} onPress={() => setCompanyId(e.id)} style={chip(companyId === e.id)}>
                        <Text style={chipTxt(companyId === e.id)}>{e.nombre}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : null}

              {alcance === 'grupo' ? (
                <>
                  <Text style={etiqueta}>Nombre del grupo</Text>
                  <TextInput editable={puedeEditar} value={grupoNombre} onChangeText={setGrupoNombre} placeholder="Ej. Chutos de la empresa" placeholderTextColor={colors.muted} style={input} />
                  {gruposAnteriores.length ? (
                    <>
                      <Text style={etiqueta}>Usar un grupo anterior</Text>
                      <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                        {gruposAnteriores.map((g) => (
                          <TouchableOpacity key={g.id} disabled={!puedeEditar} onPress={() => { setGrupoNombre(g.grupo_nombre ?? ''); setCamiones([...(g.machinery_ids ?? [])]); }} style={chip(false)}>
                            <Text style={chipTxt(false)}>↺ {g.grupo_nombre} ({(g.machinery_ids ?? []).length})</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  ) : null}
                </>
              ) : null}

              {conCamiones ? (
                <>
                  <Text style={etiqueta}>{alcance === 'camion' ? 'Camión' : 'Camiones del grupo'}</Text>
                  <TextInput editable={puedeEditar} value={buscar} onChangeText={setBuscar} placeholder="🔎 Buscar camión, placa o empresa…" placeholderTextColor={colors.muted} style={input} />
                  {alcance === 'grupo' ? (
                    <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.xs }}>
                      <TouchableOpacity disabled={!puedeEditar} onPress={() => agregar(visibles.map((c) => c.id))} style={chip(false)}>
                        <Text style={chipTxt(false)}>＋ Todos los que se ven ({visibles.length})</Text>
                      </TouchableOpacity>
                      <TouchableOpacity disabled={!puedeEditar} onPress={() => agregar(visibles.filter((c) => esChuto(c.code)).map((c) => c.id))} style={chip(false)}>
                        <Text style={chipTxt(false)}>＋ Solo chutos que se ven ({visibles.filter((c) => esChuto(c.code)).length})</Text>
                      </TouchableOpacity>
                      <TouchableOpacity disabled={!puedeEditar} onPress={() => setCamiones([])} style={chip(false)}>
                        <Text style={chipTxt(false)}>✕ Quitar todos ({camiones.length})</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  <Text style={{ color: camiones.length ? colors.text : colors.muted, fontSize: 12, marginTop: spacing.xs }}>
                    {camiones.length
                      ? `Elegido(s): ${camiones.slice(0, 8).map(codigo).join(', ')}${camiones.length > 8 ? ` y ${camiones.length - 8} más` : ''}`
                      : 'Toca los camiones para elegirlos.'}
                  </Text>
                  <View style={{ maxHeight: 320, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginTop: spacing.xs }}>
                    <ScrollView nestedScrollEnabled>
                      {cargando && !catalogo.length ? <Text style={{ color: colors.muted, padding: spacing.sm }}>Cargando…</Text> : null}
                      {visiblesPorEmpresa.map(([empresa, lista]) => (
                        <View key={empresa}>
                          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', paddingHorizontal: spacing.sm, paddingTop: spacing.xs }}>{empresa}</Text>
                          {lista.map((c) => {
                            const on = camiones.includes(c.id);
                            return (
                              <TouchableOpacity key={c.id} disabled={!puedeEditar} onPress={() => tocarCamion(c.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: on ? colors.surfaceAlt : 'transparent' }}>
                                <Text style={{ fontSize: 15 }}>{alcance === 'camion' ? (on ? '🔘' : '⚪') : on ? '☑️' : '⬜'}</Text>
                                <Text style={{ color: colors.text, fontSize: 13, fontWeight: on ? '800' : '500', flex: 1 }}>
                                  {c.code}{c.plate ? ` · ${c.plate}` : c.serial ? ` · ${c.serial}` : ''}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                </>
              ) : null}

              <Text style={etiqueta}>Zona</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                {ZONAS.map((z) => (
                  <TouchableOpacity key={z.key} disabled={!puedeEditar} onPress={() => setZona(z.key)} style={chip(zona === z.key)}>
                    <Text style={chipTxt(zona === z.key)}>{z.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={etiqueta}>Precio {unidad === 'kg' ? 'por kilo' : 'por tonelada'} ($)</Text>
              <TextInput editable={puedeEditar} value={precio} onChangeText={(v) => setPrecio(onlyDecimal(v))} keyboardType="numeric" inputMode="decimal" placeholder={unidad === 'kg' ? '0,0000' : '0,00'} placeholderTextColor={colors.muted} style={input} />
              {/* 📅 ¿DESDE CUÁNDO RIGE? (06-oct-2026): mismo arreglo que en las
                  tarifas por viaje — el rango estaba detrás de un check que
                  parecía un rótulo. Ahora es una elección a la vista. */}
              <Text style={etiqueta}>¿Desde cuándo rige?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                <TouchableOpacity disabled={!puedeEditar} onPress={() => setConHasta(false)} style={chip(!conHasta)}>
                  <Text style={chipTxt(!conHasta)}>📅 Desde una fecha en adelante</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={!puedeEditar} onPress={() => setConHasta(true)} style={chip(conHasta)}>
                  <Text style={chipTxt(conHasta)}>🔒 Solo en un rango (desde → hasta)</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                {conHasta
                  ? 'Rige SOLO del «desde» al «hasta» y, en esas fechas, manda sobre las tarifas del mismo tipo. Al salir del rango vuelve la de siempre.'
                  : 'Rige desde esa fecha en adelante, hasta que pongas otra.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={etiqueta}>Desde</Text>
                  <DateField value={desde} onChange={setDesde} />
                </View>
                {conHasta ? (
                  <View style={{ flex: 1, minWidth: 140 }}>
                    <Text style={etiqueta}>Hasta</Text>
                    <DateField value={hasta} onChange={setHasta} />
                  </View>
                ) : null}
              </View>
              <Text style={etiqueta}>Nota (opcional)</Text>
              <TextInput editable={puedeEditar} value={nota} onChangeText={setNota} placeholder="Motivo del cambio…" placeholderTextColor={colors.muted} style={input} />

              {vistaHoy ? (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
                  Hoy, con lo ya guardado, {vistaHoy.nombre} cobra: Este {textoVigente(vistaHoy.este)} · Oeste {textoVigente(vistaHoy.oeste)}
                </Text>
              ) : null}

              <TouchableOpacity disabled={guardando || !puedeEditar} onPress={guardar} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: guardando || !puedeEditar ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{guardando ? 'Guardando…' : '💾 Guardar tarifa'}</Text>
              </TouchableOpacity>
            </Card>
          ) : null}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>Historial de tarifas</Text>
            <TouchableOpacity onPress={() => setVerAnuladas((v) => !v)}>
              <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>{verAnuladas ? 'Ocultar anuladas' : 'Ver anuladas'}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.xs }}>
            <TouchableOpacity onPress={() => setFiltroHist('todas')} style={chip(filtroHist === 'todas')}>
              <Text style={chipTxt(filtroHist === 'todas')}>Todas</Text>
            </TouchableOpacity>
            {ALCANCES.map((a) => (
              <TouchableOpacity key={a.key} onPress={() => setFiltroHist(a.key)} style={chip(filtroHist === a.key)}>
                <Text style={chipTxt(filtroHist === a.key)}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {cargando && !tarifas.length ? <Text style={{ color: colors.muted, marginTop: spacing.sm }}>Cargando…</Text> : null}
          {!cargando && !tarifas.length && !faltaSql ? <Text style={{ color: colors.muted, marginTop: spacing.sm, fontSize: 12 }}>Todavía no hay tarifas por peso guardadas.</Text> : null}
          {historial.map((t) => {
            const ids = t.machinery_ids ?? [];
            const anulada = !!t.anulada_at;
            return (
              <Card key={t.id} style={anulada ? { opacity: 0.55 } : undefined}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                  <Text style={{ color: anulada ? colors.muted : colors.text, fontWeight: '800', flex: 1, textDecorationLine: anulada ? 'line-through' : 'none' }}>
                    {describir(t)} · {etiquetaZonaPeso(t)} · {textoPrecioPeso(t)}
                  </Text>
                  <Text style={{ color: t.hasta ? colors.warning : colors.muted, fontSize: 12, fontWeight: '700' }}>
                    {t.hasta ? `🔒 ${dmy(t.desde)} → ${dmy(t.hasta)}` : `desde ${dmy(t.desde)}`}
                  </Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 11 }}>{etiquetaAlcancePeso(t)}</Text>
                {alcancePeso(t) === 'grupo' && ids.length ? (
                  <Text style={{ color: colors.text, fontSize: 12 }}>
                    {ids.slice(0, 12).map(codigo).join(', ')}{ids.length > 12 ? ` y ${ids.length - 12} más` : ''}
                  </Text>
                ) : null}
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {t.created_by_nombre ? `${t.created_by_nombre} · ` : ''}{t.created_at ? new Date(t.created_at).toLocaleString('es-VE', { timeZone: 'America/Caracas' }) : ''}
                  {t.nota ? ` · ${t.nota}` : ''}
                </Text>
                {anulada ? (
                  <Text style={{ color: colors.danger, fontSize: 11 }}>Anulada{t.anulada_motivo ? `: ${t.anulada_motivo}` : ''}</Text>
                ) : puedeEditar ? (
                  anulando === t.id ? (
                    <View style={{ marginTop: spacing.xs }}>
                      <TextInput value={motivoAnular} onChangeText={setMotivoAnular} placeholder="Motivo de la anulación (obligatorio)" placeholderTextColor={colors.muted} style={input} />
                      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                        <TouchableOpacity onPress={() => { setAnulando(null); setMotivoAnular(''); }} style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                          <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => confirmarAnular(t)} style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.danger, opacity: motivoAnular.trim() ? 1 : 0.6 }}>
                          <Text style={{ color: '#fff', fontWeight: '800' }}>Sí, anular</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => { setAnulando(t.id); setMotivoAnular(''); }} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🚫 Anular</Text>
                    </TouchableOpacity>
                  )
                ) : null}
              </Card>
            );
          })}
          <View style={{ height: spacing.lg }} />
        </ScrollView>
      </Screen>
    </Modal>
  );
}
