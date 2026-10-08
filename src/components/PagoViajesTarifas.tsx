// PAGO DE VIAJES · tarifas (15-sep-2026).
//
// Pestaña «💲 Tarifas» de la ventana del pago de viajes. Una tarifa se le pone a todos
// los camiones, a una empresa, a un grupo de camiones (p. ej. los chutos de una empresa)
// o a un solo camión; en Este, en Oeste o en ambas zonas; desde una fecha o blindada a
// un rango. Si a un viaje le tocan varias, manda la más específica (src/lib/pagoViajes.ts,
// tarifaViajeEn). Los camiones de un grupo se fijan al crearlo. Nunca se borran: se anulan.
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Card } from './ui';
import { DateField } from './DateField';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { esCamionDeViajes } from '../lib/equipos';
import { cmpText, onlyDecimal } from '../lib/text';
import {
  alcanceTarifa,
  anuladaModo,
  etiquetaZonaTarifa,
  retroDeTarifa,
  tarifaViajeEn,
  validarTarifa,
  AlcanceTarifa,
  AnuladaModo,
  TarifaViaje,
} from '../lib/pagoViajes';
import { anularTarifaViaje, contarViajesEnJornadas, crearTarifaViaje, CamionCatalogo } from '../lib/pagoViajesDb';

type Props = {
  tarifas: TarifaViaje[];
  maquinas: CamionCatalogo[];
  /** Máquinas que el admin puso a mano en Viajes: se pueden elegir aunque su código no sea de camión. */
  puestasEnViajes?: Set<string>;
  cargando: boolean;
  canEdit: boolean;
  usuarioId: string | null;
  hoy: string;
  /** Recarga las tarifas y avisa al resumen para que recalcule. */
  onChanged: () => Promise<void>;
};

const ALCANCES: { key: AlcanceTarifa; label: string; ayuda: string }[] = [
  { key: 'general', label: '🌐 Todos', ayuda: 'Para todos los camiones por viaje que no tengan una tarifa especial.' },
  { key: 'empresa', label: '🏢 Una empresa', ayuda: 'Solo para los viajes de esa empresa.' },
  { key: 'grupo', label: '👥 Grupo de camiones', ayuda: 'Solo para los camiones que elijas (p. ej. los chutos de una empresa).' },
  { key: 'camion', label: '🚛 Un camión', ayuda: 'Solo para ese camión. Con «Ambas zonas» le fijas su precio por viaje vaya al Este o al Oeste, sin tocar el de las zonas.' },
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
const usd = (n: unknown) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const esChuto = (code: string) => norm(code).trim().startsWith('chuto');

export function PagoViajesTarifas({ tarifas, maquinas, puestasEnViajes, cargando, canEdit, usuarioId, hoy, onChanged }: Props) {
  const { colors } = useTheme();
  const [aviso, setAviso] = useState<string | null>(null);

  const [alcance, setAlcance] = useState<AlcanceTarifa>('general');
  const [zona, setZona] = useState<ZonaForm>('este');
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

  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  // 🕓 Qué pasa con los días que la tarifa YA rigió (08-oct-2026). Ver `anuladaModo`.
  const [modoAnular, setModoAnular] = useState<AnuladaModo>('desde_ahora');
  // ⚠️ Viajes ya registrados que pisaría una fecha «desde» del pasado.
  const [retroViajes, setRetroViajes] = useState<number | null>(null);
  const [confirmaRetro, setConfirmaRetro] = useState(false);
  const [verAnuladas, setVerAnuladas] = useState(false);
  const [filtroHist, setFiltroHist] = useState<'todas' | AlcanceTarifa>('todas');

  const catalogo = useMemo(
    () => maquinas.filter((m) => m.activa && (esCamionDeViajes(m.code) || !!puestasEnViajes?.has(m.id))).sort((a, b) => cmpText(a.company, b.company) || cmpText(a.code, b.code)),
    [maquinas, puestasEnViajes],
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
    const m = new Map<string, TarifaViaje>();
    tarifas
      .slice()
      .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
      .forEach((t) => {
        if (alcanceTarifa(t) === 'grupo' && t.grupo_nombre && (t.machinery_ids ?? []).length) m.set(norm(t.grupo_nombre.trim()), t);
      });
    return Array.from(m.values()).sort((a, b) => cmpText(a.grupo_nombre ?? '', b.grupo_nombre ?? ''));
  }, [tarifas]);

  const especialesHoy = useMemo(
    () => tarifas.filter((t) => !t.anulada_at && alcanceTarifa(t) !== 'general'
      && String(t.desde).slice(0, 10) <= hoy && (!t.hasta || String(t.hasta).slice(0, 10) >= hoy)).length,
    [tarifas, hoy],
  );

  const historial = useMemo(
    () => tarifas
      .filter((t) => (verAnuladas || !t.anulada_at) && (filtroHist === 'todas' || alcanceTarifa(t) === filtroHist))
      .slice()
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))),
    [tarifas, verAnuladas, filtroHist],
  );

  const codigo = (id: string) => porId.get(id)?.code ?? 'camión fuera del catálogo';
  const describir = (t: TarifaViaje) => {
    const ids = t.machinery_ids ?? [];
    switch (alcanceTarifa(t)) {
      case 'empresa': return `🏢 ${nombreEmpresa.get(t.company_id ?? '') ?? 'Empresa'}`;
      case 'grupo': return `👥 ${t.grupo_nombre ?? 'Grupo'} (${ids.length} camión(es))`;
      case 'camion': return `🚛 ${ids[0] ? codigo(ids[0]) : 'Camión'}`;
      case 'general': return '🌐 Todos';
      default: return '❓ Tarifa desconocida';
    }
  };

  const cambiarAlcance = (a: AlcanceTarifa) => {
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
    const t = (z: 'este' | 'oeste') => tarifaViajeEn(tarifas, z, hoy, ctx);
    return { nombre: ctx.nombre, este: t('este'), oeste: t('oeste') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conCamiones, camiones, alcance, companyId, tarifas, hoy, porId, nombreEmpresa]);

  // 📅 «Desde» sigue a HOY mientras no lo toquen a mano (08-oct-2026). Antes era
  //    `useState(hoy)` y se congelaba en el primer render: con la ventana abierta al
  //    cruzar las 7am —o al reabrirla al día siguiente— proponía la fecha de AYER, y
  //    una tarifa con fecha de ayer reprecia los viajes de ayer sin que nadie lo pida.
  const [desdeTocado, setDesdeTocado] = useState(false);
  useEffect(() => { if (!desdeTocado) { setDesde(hoy); setHasta(hoy); } }, [hoy, desdeTocado]);

  // El tramo de días YA TRABAJADOS que pisaría esta tarifa, y cuántos viajes hay ahí.
  const retro = useMemo(() => retroDeTarifa(desde, hoy, conHasta ? hasta : null), [desde, hoy, conHasta, hasta]);
  useEffect(() => {
    let vivo = true;
    setConfirmaRetro(false);
    if (!retro) { setRetroViajes(null); return () => { vivo = false; }; }
    setRetroViajes(null);
    contarViajesEnJornadas(retro.desdeJornada, retro.hastaJornada)
      .then((n) => { if (vivo) setRetroViajes(n); })
      .catch(() => { if (vivo) setRetroViajes(null); });
    return () => { vivo = false; };
  }, [retro?.desdeJornada, retro?.hastaJornada]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async () => {
    setAviso(null);
    const elegidos = conCamiones ? camiones : [];
    const motivo = validarTarifa({ zona, precio, desde, hasta: conHasta ? hasta : null, alcance, companyId, camiones: elegidos, grupoNombre });
    if (motivo) { setAviso(`❌ ${motivo}`); return; }
    // ⚠️ FECHA DEL PASADO: no se prohíbe (a veces el precio se acordó la semana
    //    pasada), pero NO puede pasar sin querer: hay que confirmarlo a sabiendas de
    //    cuántos viajes ya registrados cambian de precio.
    if (retro && !confirmaRetro) {
      setConfirmaRetro(true);
      setAviso(`⚠️ Ojo: con esa fecha cambias el precio de ${retroViajes == null ? 'los' : retroViajes} viaje(s) YA REGISTRADOS del ${dmy(retro.desdeJornada)} al ${dmy(retro.hastaJornada)}. Si solo quieres que rija de hoy en adelante, pon ${dmy(hoy)}. Vuelve a tocar «Guardar» para confirmar.`);
      return;
    }
    setGuardando(true);
    const { error } = await crearTarifaViaje({
      zona: zona === 'ambas' ? null : zona,
      precio: Number(precio.replace(',', '.')),
      desde,
      hasta: conHasta ? hasta : null,
      nota,
      alcance,
      companyId,
      grupoNombre,
      camiones: elegidos,
    });
    setGuardando(false);
    if (error) { setAviso(`❌ ${error}`); return; }
    const aQuien = alcance === 'empresa' ? `🏢 ${nombreEmpresa.get(companyId ?? '') ?? 'Empresa'}`
      : alcance === 'grupo' ? `👥 ${grupoNombre.trim()} (${elegidos.length} camión(es))`
        : alcance === 'camion' ? `🚛 ${codigo(elegidos[0])}`
          : '🌐 Todos';
    const zonaTxt = ZONAS.find((z) => z.key === zona)?.label ?? '';
    setAviso(`✅ ${aQuien} · ${zonaTxt} · ${usd(precio.replace(',', '.'))} ${conHasta
      ? `blindada del ${dmy(desde)} al ${dmy(hasta)}. Fuera de ese rango no cambia nada.`
      : `desde el ${dmy(desde)} en adelante. Los días anteriores conservan su tarifa.`}`);
    setPrecio('');
    setNota('');
    setConfirmaRetro(false);
    await onChanged();
  };

  const confirmarAnular = async (t: TarifaViaje) => {
    if (!motivoAnular.trim()) { setAviso('❌ Escribe el motivo de la anulación.'); return; }
    const { error } = await anularTarifaViaje(t.id, motivoAnular, usuarioId, modoAnular);
    if (error) { setAviso(`❌ ${error}`); return; }
    setAnulando(null);
    setMotivoAnular('');
    setModoAnular('desde_ahora');
    setAviso(modoAnular === 'desde_ahora'
      ? '✅ Tarifa anulada de hoy en adelante. Los días que ya había regido conservan ESTE precio; de hoy en adelante los viajes toman la tarifa que les toque.'
      : '✅ Tarifa anulada EN TODAS LAS FECHAS (era un error). Los viajes que cubría vuelven a tomar la tarifa que les toque, también los de días pasados.');
    await onChanged();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const chip = (activo: boolean) => ({ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: activo ? colors.brand : colors.border, backgroundColor: activo ? colors.brand : colors.surface });
  const chipTxt = (activo: boolean) => ({ color: activo ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });
  const etiqueta = { color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 } as const;

  return (
    <ScrollView style={{ flex: 1 }}>
      {aviso ? (
        <TouchableOpacity onPress={() => setAviso(null)} style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: aviso.startsWith('❌') ? colors.danger : colors.success, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.text, fontSize: 13 }}>{aviso}</Text>
        </TouchableOpacity>
      ) : null}

      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>Tarifa para todos, vigente hoy ({dmy(hoy)})</Text>
        {(['este', 'oeste'] as const).map((z) => {
          const t = tarifaViajeEn(tarifas, z, hoy);
          return (
            <Text key={z} style={{ color: colors.text, fontSize: 13 }}>
              {z === 'este' ? 'Este' : 'Oeste'}: <Text style={{ fontWeight: '800' }}>{t ? usd(t.precio) : 'sin tarifa'}</Text>
              {t ? <Text style={{ color: colors.muted }}>{t.hasta ? `  · blindada ${dmy(t.desde)} → ${dmy(t.hasta)}` : `  · desde ${dmy(t.desde)}`}</Text> : null}
            </Text>
          );
        })}
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
          {especialesHoy ? `${especialesHoy} tarifa(s) especial(es) vigente(s) hoy (empresa, grupo o camión).` : 'Sin tarifas especiales vigentes hoy.'}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
          Si a un viaje le tocan varias, manda la más específica: camión → grupo → empresa → todos. Entre dos del mismo tipo,
          la blindada; si no, la de fecha más reciente.
        </Text>
      </Card>

      {canEdit ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>➕ Nueva tarifa</Text>

          <Text style={{ ...etiqueta, marginTop: 0 }}>¿A quién aplica?</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
            {ALCANCES.map((a) => (
              <TouchableOpacity key={a.key} onPress={() => cambiarAlcance(a.key)} style={chip(alcance === a.key)}>
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
                  <TouchableOpacity key={e.id} onPress={() => setCompanyId(e.id)} style={chip(companyId === e.id)}>
                    <Text style={chipTxt(companyId === e.id)}>{e.nombre}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : null}

          {alcance === 'grupo' ? (
            <>
              <Text style={etiqueta}>Nombre del grupo</Text>
              <TextInput value={grupoNombre} onChangeText={setGrupoNombre} placeholder="Ej. Chutos de la empresa" placeholderTextColor={colors.muted} style={input} />
              {gruposAnteriores.length ? (
                <>
                  <Text style={etiqueta}>Usar un grupo anterior</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                    {gruposAnteriores.map((g) => (
                      <TouchableOpacity key={g.id} onPress={() => { setGrupoNombre(g.grupo_nombre ?? ''); setCamiones([...(g.machinery_ids ?? [])]); }} style={chip(false)}>
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
              <TextInput value={buscar} onChangeText={setBuscar} placeholder="🔎 Buscar camión, placa o empresa…" placeholderTextColor={colors.muted} style={input} />
              {alcance === 'grupo' ? (
                <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.xs }}>
                  <TouchableOpacity onPress={() => agregar(visibles.map((c) => c.id))} style={chip(false)}>
                    <Text style={chipTxt(false)}>＋ Todos los que se ven ({visibles.length})</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => agregar(visibles.filter((c) => esChuto(c.code)).map((c) => c.id))} style={chip(false)}>
                    <Text style={chipTxt(false)}>＋ Solo chutos que se ven ({visibles.filter((c) => esChuto(c.code)).length})</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setCamiones([])} style={chip(false)}>
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
                          <TouchableOpacity key={c.id} onPress={() => tocarCamion(c.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: on ? colors.surfaceAlt : 'transparent' }}>
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
              <TouchableOpacity key={z.key} onPress={() => setZona(z.key)} style={chip(zona === z.key)}>
                <Text style={chipTxt(zona === z.key)}>{z.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={etiqueta}>Precio por viaje ($)</Text>
          <TextInput value={precio} onChangeText={(v) => setPrecio(onlyDecimal(v))} keyboardType="numeric" inputMode="decimal" placeholder="0,00" placeholderTextColor={colors.muted} style={input} />
          {/* 📅 ¿DESDE CUÁNDO RIGE? (06-oct-2026, a pedido: «aún no está el
              desde–hasta por si quiero colocar la tarifa en un rango específico,
              solo está el desde»). El rango SIEMPRE existió, pero vivía detrás de
              un check «🔒 Blindar…» que parecía un rótulo y nadie tocaba. Ahora es
              una elección a la vista, con las mismas pastillas que la zona. */}
          <Text style={etiqueta}>¿Desde cuándo rige?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            <TouchableOpacity onPress={() => setConHasta(false)} style={chip(!conHasta)}>
              <Text style={chipTxt(!conHasta)}>📅 Desde una fecha en adelante</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setConHasta(true)} style={chip(conHasta)}>
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
              <DateField value={desde} onChange={(v) => { setDesdeTocado(true); setDesde(v); }} />
            </View>
            {conHasta ? (
              <View style={{ flex: 1, minWidth: 140 }}>
                <Text style={etiqueta}>Hasta</Text>
                <DateField value={hasta} onChange={(v) => { setDesdeTocado(true); setHasta(v); }} />
              </View>
            ) : null}
          </View>

          {/* ⚠️ AVISO DE FECHA DEL PASADO (08-oct-2026, a pedido: «si coloco una tarifa
              hoy debería aplicarse para lo que se empiece a registrar ese día, y no
              para los días anteriores»). No se prohíbe —a veces el precio se acordó
              la semana pasada—, pero se dice EXACTAMENTE a cuántos viajes ya
              registrados les cambia el precio, y hay que confirmarlo. */}
          {retro ? (
            <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoftBg }}>
              <Text style={{ color: colors.warningSoftText, fontWeight: '800', fontSize: 12 }}>
                ⚠️ Esta fecha pisa días ya trabajados
              </Text>
              <Text style={{ color: colors.warningSoftText, fontSize: 12, marginTop: 2 }}>
                Le cambia el precio a {retroViajes == null ? '…' : retroViajes} viaje(s) YA REGISTRADOS, del {dmy(retro.desdeJornada)} al {dmy(retro.hastaJornada)} ({retro.dias} día(s)).
                {' '}Para que rija solo de hoy en adelante, pon {dmy(hoy)}.
              </Text>
              <TouchableOpacity onPress={() => { setDesdeTocado(false); setDesde(hoy); setHasta(hoy); }} style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>📅 Ponerla desde hoy ({dmy(hoy)})</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <Text style={etiqueta}>Nota (opcional)</Text>
          <TextInput value={nota} onChangeText={setNota} placeholder="Motivo del cambio…" placeholderTextColor={colors.muted} style={input} />

          {vistaHoy ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
              Hoy, con lo ya guardado, {vistaHoy.nombre} cobra: Este {vistaHoy.este ? usd(vistaHoy.este.precio) : 'sin tarifa'} · Oeste {vistaHoy.oeste ? usd(vistaHoy.oeste.precio) : 'sin tarifa'}
            </Text>
          ) : null}

          <TouchableOpacity disabled={guardando} onPress={guardar} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: guardando ? 0.6 : 1 }}>
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
      {historial.map((t) => {
        const ids = t.machinery_ids ?? [];
        return (
          <Card key={t.id} style={t.anulada_at ? { opacity: 0.55 } : undefined}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>
                {describir(t)} · {etiquetaZonaTarifa(t)} · {usd(t.precio)}
              </Text>
              <Text style={{ color: t.hasta ? colors.warning : colors.muted, fontSize: 12, fontWeight: '700' }}>
                {t.hasta ? `🔒 ${dmy(t.desde)} → ${dmy(t.hasta)}` : `desde ${dmy(t.desde)}`}
              </Text>
            </View>
            {alcanceTarifa(t) === 'grupo' && ids.length ? (
              <Text style={{ color: colors.text, fontSize: 12 }}>
                {ids.slice(0, 12).map(codigo).join(', ')}{ids.length > 12 ? ` y ${ids.length - 12} más` : ''}
              </Text>
            ) : null}
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              {t.created_by_nombre ? `${t.created_by_nombre} · ` : ''}{t.created_at ? new Date(t.created_at).toLocaleString('es-VE', { timeZone: 'America/Caracas' }) : ''}
              {t.nota ? ` · ${t.nota}` : ''}
            </Text>
            {t.anulada_at ? (
              <Text style={{ color: colors.danger, fontSize: 11 }}>
                {anuladaModo(t) === 'desde_ahora'
                  ? `Anulada · rigió hasta el ${dmy(t.anulada_at)}`
                  : 'Anulada en TODAS las fechas (fue un error)'}
                {t.anulada_motivo ? `: ${t.anulada_motivo}` : ''}
              </Text>
            ) : canEdit ? (
              anulando === t.id ? (
                <View style={{ marginTop: spacing.xs }}>
                  {/* 🕒 QUÉ PASA CON LOS DÍAS QUE YA RIGIÓ (08-oct-2026). Hasta hoy
                      anular borraba la tarifa de TODAS las fechas, también de los días
                      que ya había pagado: el 04-oct se anularon las de $30 y $50 y los
                      viajes del 14 al 27 de sep se quedaron «sin tarifa» en $0. Ahora
                      se elige, y lo que propone es conservar el histórico. */}
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, marginBottom: 4 }}>¿Qué pasa con los días que ya rigió?</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    <TouchableOpacity onPress={() => setModoAnular('desde_ahora')} style={chip(modoAnular === 'desde_ahora')}>
                      <Text style={chipTxt(modoAnular === 'desde_ahora')}>📅 Dejó de regir hoy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setModoAnular('siempre')} style={chip(modoAnular === 'siempre')}>
                      <Text style={chipTxt(modoAnular === 'siempre')}>⚠️ Fue un error: borrar de todas las fechas</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                    {modoAnular === 'desde_ahora'
                      ? 'Lo normal al cambiar un precio: los viajes ya registrados conservan ESTE precio y de hoy en adelante toman el que pongas.'
                      : '⚠️ Los viajes de días pasados que cobraban con ella quedan SIN TARIFA ($0) hasta que otra los cubra. Solo para una tarifa que nunca debió existir.'}
                  </Text>
                  <TextInput value={motivoAnular} onChangeText={setMotivoAnular} placeholder="Motivo de la anulación (obligatorio)" placeholderTextColor={colors.muted} style={[input, { marginTop: spacing.xs }]} />
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                    <TouchableOpacity onPress={() => { setAnulando(null); setMotivoAnular(''); setModoAnular('desde_ahora'); }} style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                      <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => confirmarAnular(t)} style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.danger, opacity: motivoAnular.trim() ? 1 : 0.6 }}>
                      <Text style={{ color: '#fff', fontWeight: '800' }}>Sí, anular</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity onPress={() => { setAnulando(t.id); setMotivoAnular(''); setModoAnular('desde_ahora'); }} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                  <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🚫 Anular</Text>
                </TouchableOpacity>
              )
            ) : null}
          </Card>
        );
      })}
      <View style={{ height: spacing.lg }} />
    </ScrollView>
  );
}
