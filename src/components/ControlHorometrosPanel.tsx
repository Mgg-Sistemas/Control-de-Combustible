// ⚙️ CONTROL DE HORÓMETROS (02-oct-2026) — el apartado hermano de Control de
// jornadas, pero pagando por HORÓMETRO de trabajo.
//
// Pedido del cliente: «crear otro apartado como el de control de las jornadas,
// pero para los horómetros, para colocar los precios (…) que los dos existan y
// que puedan usar los dos sin que choque (…) asignar los precios también en un
// rango en específico (…) y un reporte aparte de los pagos en base a los
// horómetros».
//
// ⭐ NO TOCA NADA DE CONTROL DE JORNADAS. Lee las lecturas del horómetro de
//    trabajo y SUS PROPIOS precios (`horometro_precios`); no lee ni escribe
//    rondas, cierres ni el precio de la jornada. Se abre desde Control con un
//    botón y vive en su propio panel: quien no lo abra, no nota ningún cambio.
//
// Las reglas del cálculo están en `src/lib/pagoHorometro.ts` (puro y probado).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Screen, Card, SectionTitle } from './ui';
import { DateField } from './DateField';
import { Plegable } from './Plegable';
import { Toggle } from './CubicajeTab';
import { HorometroAjusteModal } from './HorometroAjusteModal';
import { useToast } from './ToastProvider';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { caracasBusinessToday } from '../lib/caracasDay';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { LecturaTrabajo } from '../lib/horometroTrabajo';
import { cargarLecturasHorometro } from '../lib/horometroTrabajoDb';
import {
  AjusteHorometro, CSS_PAGO_HOROMETRO, OPCIONES_PAGO_HOROMETRO, OpcionesPagoHorometro, PASTILLAS_PAGO_HOROMETRO,
  PrecioHorometro, cuerpoPagoHorometro, filasPagoHorometro, fmtHoras, motivoAlertaDia, pagoPorEmpresa,
  sufijoArchivoPagoHorometro, textoPrecioHorometro, totalPagoHorometro, usd, validarPrecioHorometro,
} from '../lib/pagoHorometro';
import {
  MaquinaConReferencia, anularPrecioHorometro, cargarAjustesHorometro, cargarMaquinasPagoHorometro, cargarPreciosHorometro,
  crearPrecioHorometro,
} from '../lib/pagoHorometroDb';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Puede poner y anular precios (escritura en Control y no ser analista). */
  canEdit: boolean;
  /** Puede CAMBIAR la lectura del inspector (módulo horómetros con escritura;
   *  admin = full). Sin esto igual puede ajustar «solo para horómetros». */
  puedeCorregirHoro: boolean;
};

type Logos = { bcv: boolean; sos: boolean; golden: boolean; renace: boolean; jhenzaen: boolean };

const dmy = (iso: string) => String(iso ?? '').slice(0, 10).split('-').reverse().join('/');
const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesDe = (iso: string) => sumarDias(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const aNumero = (t: string) => Number(String(t).replace(',', '.'));

export function ControlHorometrosPanel({ visible, onClose, canEdit, puedeCorregirHoro }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const hoy = caracasBusinessToday();

  const [desde, setDesde] = useState(() => lunesDe(hoy));
  const [hasta, setHasta] = useState(hoy);
  const [maquinas, setMaquinas] = useState<MaquinaConReferencia[]>([]);
  const [lecturas, setLecturas] = useState<LecturaTrabajo[]>([]);
  const [precios, setPrecios] = useState<PrecioHorometro[]>([]);
  // 🧾 Ajustes «solo para Control de horómetros»: mandan sobre la lectura del inspector.
  const [ajustes, setAjustes] = useState<AjusteHorometro[]>([]);
  const [faltaSql, setFaltaSql] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  // Filtros (cambian QUÉ máquinas entran: el papel lo dice).
  const [busca, setBusca] = useState('');
  const [empresasSel, setEmpresasSel] = useState<Set<string>>(new Set());
  const [soloAlertas, setSoloAlertas] = useState(false);
  // Editor de precio (se abre dentro de la fila de la máquina).
  const [abierta, setAbierta] = useState<string | null>(null);
  const [pPrecio, setPPrecio] = useState('');
  const [pDesde, setPDesde] = useState(hoy);
  const [pBlindar, setPBlindar] = useState(false);
  const [pHasta, setPHasta] = useState(hoy);
  const [pNota, setPNota] = useState('');
  const [pTodaEmpresa, setPTodaEmpresa] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [anularId, setAnularId] = useState<string | null>(null);
  const [anularMotivo, setAnularMotivo] = useState('');
  // Acomodar el horómetro de un día: solo para este módulo, o cambiando la del inspector.
  const [editLectura, setEditLectura] = useState<{ machineryId: string; code: string; fecha: string } | null>(null);
  // El PDF.
  const [opciones, setOpciones] = useState<OpcionesPagoHorometro>({ ...OPCIONES_PAGO_HOROMETRO });
  const [logos, setLogos] = useState<Logos>({ bcv: true, sos: true, golden: false, renace: false, jhenzaen: false });
  const [pdfBusy, setPdfBusy] = useState(false);

  const rangoInvalido = hasta < desde;

  const cargar = useCallback(async () => {
    if (rangoInvalido) return;
    setCargando(true); setError(null);
    try {
      const [ms, ls, ps, as] = await Promise.all([
        cargarMaquinasPagoHorometro(),
        cargarLecturasHorometro(desde, hasta),
        cargarPreciosHorometro(),
        cargarAjustesHorometro(desde, hasta),
      ]);
      setMaquinas(ms); setLecturas(ls); setPrecios(ps.precios); setAjustes(as.ajustes);
      setFaltaSql(ps.missing || as.missing);
      if (ps.error && !ps.missing) setError(ps.error);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, rangoInvalido]);

  useEffect(() => { if (visible) void cargar(); }, [visible, cargar, recarga]);

  const filasTodas = useMemo(
    () => filasPagoHorometro({ maquinas, lecturas, precios, desde, hasta, ajustes }),
    [maquinas, lecturas, precios, desde, hasta, ajustes],
  );
  const empresasDisp = useMemo(() => pagoPorEmpresa(filasTodas).map((e) => ({ nombre: e.empresa, maquinas: e.total.maquinas })), [filasTodas]);
  const filas = useMemo(() => {
    const q = norm(busca).trim();
    return filasTodas.filter((f) =>
      (empresasSel.size === 0 || empresasSel.has(f.maquina.empresa))
      && (!soloAlertas || f.alertas > 0)
      && (!q || norm(`${f.maquina.code} ${f.maquina.placa} ${f.maquina.empresa} ${f.maquina.marca} ${f.maquina.modelo}`).includes(q)));
  }, [filasTodas, busca, empresasSel, soloAlertas]);
  const tot = useMemo(() => totalPagoHorometro(filas), [filas]);
  const grupos = useMemo(() => pagoPorEmpresa(filas), [filas]);
  const filtrado = empresasSel.size > 0 || !!busca.trim() || soloAlertas;
  const referencia = useMemo(() => new Map(maquinas.map((m) => [m.id, m.precioJornada])), [maquinas]);

  const abrirPrecio = (id: string, vigente: number | null) => {
    if (abierta === id) { setAbierta(null); return; }
    setAbierta(id);
    setPPrecio(vigente != null ? String(vigente) : '');
    setPDesde(desde); setPBlindar(false); setPHasta(hasta); setPNota(''); setPTodaEmpresa(false);
    setAnularId(null); setAnularMotivo('');
  };

  const guardarPrecio = async (id: string, empresa: string) => {
    if (guardando) return;
    const precio = aNumero(pPrecio);
    const malo = validarPrecioHorometro({ precio, desde: pDesde, hasta: pBlindar ? pHasta : null });
    if (malo) { toast.error(malo); return; }
    const ids = pTodaEmpresa ? filas.filter((f) => f.maquina.empresa === empresa).map((f) => f.maquina.id) : [id];
    setGuardando(true);
    const r = await crearPrecioHorometro({ machineryIds: ids, precioHora: precio, desde: pDesde, hasta: pBlindar ? pHasta : null, nota: pNota });
    setGuardando(false);
    if (r.error) { toast.error(r.error); return; }
    toast.success(`${usd(precio)}/h para ${r.guardadas} máquina(s) ${pBlindar ? `del ${dmy(pDesde)} al ${dmy(pHasta)} (blindado)` : `desde el ${dmy(pDesde)}`}. Lo anterior a esa fecha no cambia.`);
    setAbierta(null);
    setRecarga((n) => n + 1);
  };

  const anular = async () => {
    if (!anularId) return;
    const r = await anularPrecioHorometro(anularId, anularMotivo);
    if (r.error) { toast.error(r.error); return; }
    toast.success('Precio anulado. Los días que cubría vuelven al precio anterior (o quedan sin precio).');
    setAnularId(null); setAnularMotivo('');
    setRecarga((n) => n + 1);
  };

  const descargarPdf = async () => {
    if (pdfBusy || !filas.length) return;
    setPdfBusy(true);
    try {
      const html = pdfDocument({
        title: 'Pago por horómetro',
        // El FILTRO sí se dice (cambia el total). Lo OCULTO con pastillas, no: no deja rastro.
        subtitle: `Del ${dmy(desde)} al ${dmy(hasta)} · por horómetro de trabajo${filtrado ? ' · FILTRADO' : ''}`,
        extraCss: CSS_PAGO_HOROMETRO,
        body: cuerpoPagoHorometro({ desde, hasta, filas }, opciones),
        logos,
        marcaTexto: false,
      });
      await exportPdf(html, `Pago por horometro ${dmy(desde)} a ${dmy(hasta)}${filtrado ? ' (filtrado)' : ''}${sufijoArchivoPagoHorometro(opciones)}`.replace(/\//g, '-'));
    } catch (e: any) {
      toast.error(`No se pudo generar el PDF: ${String(e?.message ?? e)}`);
    } finally {
      setPdfBusy(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const chip = (on: boolean, aviso = false) => ({ paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : aviso ? colors.warning : colors.border, backgroundColor: on ? colors.brand : colors.surface });
  const chipTxt = (on: boolean) => ({ color: on ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });
  const atajo = (label: string, d: string, h: string) => {
    const on = desde === d && hasta === h;
    return (
      <TouchableOpacity key={label} onPress={() => { setDesde(d); setHasta(h); }} style={chip(on)}>
        <Text style={chipTxt(on)}>{label}</Text>
      </TouchableOpacity>
    );
  };
  const alternarEmpresa = (n: string) => setEmpresasSel((prev) => { const s = new Set(prev); if (s.has(n)) s.delete(n); else s.add(n); return s; });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <TouchableOpacity onPress={onClose} style={{ paddingVertical: spacing.xs, marginBottom: spacing.xs }}>
          <Text style={{ color: colors.brandText, fontWeight: '800' }}>← Volver a Control de jornadas</Text>
        </TouchableOpacity>
        <SectionTitle>⚙️ Control de horómetros</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          Lo que corresponde pagar por las HORAS DE HORÓMETRO de cada máquina (final − inicial de cada turno), con su
          propio precio por hora. Es independiente de Control de jornadas: no lee ni cambia sus horas, sus precios ni sus
          cierres. Cada día se paga con el precio que regía ese día.
        </Text>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {faltaSql ? (
            <View style={{ borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
              <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>
                ⚠️ Todavía no existen en la base las tablas de precios y de ajustes de horómetro. Las horas ya se ven; los
                precios, los montos y los ajustes aparecen en cuanto el administrador las cree.
              </Text>
            </View>
          ) : null}
          {error ? <Text style={{ color: colors.danger, fontWeight: '700', marginBottom: spacing.sm }}>⚠️ {error}</Text> : null}

          <Card>
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
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
            </View>
            {rangoInvalido ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>La fecha «hasta» no puede ser anterior a «desde».</Text> : null}
            <TextInput value={busca} onChangeText={setBusca} placeholder="🔎 Buscar máquina: código, placa, serial, empresa, marca…" placeholderTextColor={colors.muted} autoCorrect={false} style={{ ...input, marginTop: spacing.sm }} />
            {empresasDisp.length > 1 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                <TouchableOpacity onPress={() => setEmpresasSel(new Set())} style={chip(empresasSel.size === 0)}>
                  <Text style={chipTxt(empresasSel.size === 0)}>✅ Todas las empresas</Text>
                </TouchableOpacity>
                {empresasDisp.map((e) => (
                  <TouchableOpacity key={e.nombre} onPress={() => alternarEmpresa(e.nombre)} style={chip(empresasSel.has(e.nombre))}>
                    <Text style={chipTxt(empresasSel.has(e.nombre))}>{e.nombre} ({e.maquinas})</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <Toggle on={soloAlertas} label="⚠️ Solo las máquinas con días por revisar" ayuda="Lecturas inválidas o incompletas, y horas sin precio." onPress={() => setSoloAlertas((v) => !v)} />
          </Card>

          <View style={{ backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.brandContrast, fontSize: 11, fontWeight: '800' }}>TOTAL A PAGAR POR HORÓMETRO{filtrado ? ' · FILTRADO' : ''}</Text>
            <Text style={{ color: colors.brandContrast, fontSize: 22, fontWeight: '900' }}>{usd(tot.monto)}</Text>
            <Text style={{ color: colors.brandContrast, fontSize: 12 }}>
              {fmtHoras(tot.horas)} h · {tot.maquinas} máquina(s){tot.alertas ? ` · ⚠️ ${tot.alertas} día(s) por revisar` : ''}{tot.sinPrecio ? ` · ${tot.sinPrecio} sin precio` : ''}
            </Text>
          </View>

          <Plegable
            titulo="📄 Reporte de pago por horómetro"
            resumen={`${tot.maquinas} máquina(s) · ${usd(tot.monto)}${filtrado ? ' · filtrado' : ''}`}
          >
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>🖨️ ¿QUÉ SE OCULTA EN EL PDF?</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {PASTILLAS_PAGO_HOROMETRO.map((p) => (
                <TouchableOpacity key={p.key} onPress={() => setOpciones((o) => ({ ...o, [p.key]: !o[p.key] }))} style={chip(opciones[p.key])}>
                  <Text style={chipTxt(opciones[p.key])}>{p.chip}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Encendida = NO sale. Ocultar no cambia el total; filtrar sí.</Text>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm }}>🏷️ QUÉ LOGOS LLEVA EL MEMBRETE</Text>
            {([['bcv', '🏦 Banco Central de Venezuela'], ['sos', '🛟 SOS La Guaira'], ['golden', '✨ Golden Touch'], ['renace', '🇻🇪 Plan Venezuela Renace'], ['jhenzaen', '🏗️ Jhenzaen 2.012 C.A']] as const).map(([k, label]) => (
              <Toggle key={k} on={logos[k]} label={label} onPress={() => setLogos((l) => ({ ...l, [k]: !l[k] }))} />
            ))}
            <TouchableOpacity onPress={descargarPdf} disabled={pdfBusy || !filas.length}
              style={{ marginTop: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: pdfBusy || !filas.length ? 0.5 : 1 }}>
              <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{pdfBusy ? 'Generando…' : '📄 PDF del pago por horómetro'}</Text>
            </TouchableOpacity>
          </Plegable>

          {cargando && !filas.length ? <Text style={{ color: colors.muted, marginTop: spacing.sm }}>Cargando…</Text> : null}
          {!cargando && !filas.length && !rangoInvalido ? (
            <Card>
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {filasTodas.length ? 'Ninguna máquina coincide con el filtro.' : 'No hay lecturas de horómetro en ese rango. Las cargan los inspectores al iniciar y finalizar la jornada.'}
              </Text>
            </Card>
          ) : null}

          {grupos.map((g) => (
            <Card key={g.empresa}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '900', flex: 1 }}>🏢 {g.empresa}</Text>
                <Text style={{ color: colors.brandText, fontWeight: '900' }}>{usd(g.total.monto)}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{g.total.maquinas} máquina(s) · {fmtHoras(g.total.horas)} h</Text>
              {g.filas.map((f) => {
                const m = f.maquina;
                const dias = f.dias.filter((d) => d.estado !== 'sin_lectura');
                const histo = precios.filter((p) => p.machinery_id === m.id).sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
                const ref = referencia.get(m.id) ?? null;
                return (
                  <View key={m.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ flex: 1, paddingRight: spacing.sm }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{m.code}{m.placa ? ` · ${m.placa}` : ''}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>
                          {[m.marca, m.modelo].filter(Boolean).join(' ') || ' '}
                          {'  '}{f.precioVigente != null ? `💲 ${usd(f.precioVigente)}/h${f.variosPrecios ? ' (cambió en el rango)' : ''}` : '⚠️ sin precio por hora'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>{usd(f.monto)}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{fmtHoras(f.horas)} h</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {dias.map((d) => {
                        const aviso = !!motivoAlertaDia(d);
                        return (
                          <TouchableOpacity key={d.fecha} disabled={!canEdit || faltaSql}
                            onPress={() => setEditLectura({ machineryId: m.id, code: m.code, fecha: d.fecha })}
                            style={chip(false, aviso)}>
                            <Text style={{ color: aviso ? colors.warning : colors.text, fontWeight: '700', fontSize: 11 }}>
                              {aviso ? '⚠️ ' : ''}{d.ajustado ? '🧾 ' : ''}{dmy(d.fecha).slice(0, 5)} · {fmtHoras(d.horas)} h{d.precio != null && d.horas > 0 ? ` · ${usd(d.monto)}` : ''}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {f.alertas > 0 ? (
                      <Text style={{ color: colors.warning, fontSize: 11, marginTop: 2 }}>
                        {dias.map((d) => { const mo = motivoAlertaDia(d); return mo ? `${dmy(d.fecha).slice(0, 5)}: ${mo}` : ''; }).filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                    {canEdit && !faltaSql ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: 4 }}>
                        <TouchableOpacity onPress={() => abrirPrecio(m.id, f.precioVigente)}>
                          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>{abierta === m.id ? '▲ Cerrar precio' : '💲 Poner / cambiar precio por hora'}</Text>
                        </TouchableOpacity>
                        {/* 🧾 Acomodar un día cualquiera (también uno SIN lectura del inspector). */}
                        <TouchableOpacity onPress={() => setEditLectura({ machineryId: m.id, code: m.code, fecha: hasta })}>
                          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>🧾 Acomodar el horómetro de un día</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}

                    {abierta === m.id ? (
                      <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginTop: spacing.xs }}>
                        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Precio por HORA de horómetro (USD)</Text>
                        <TextInput value={pPrecio} onChangeText={setPPrecio} keyboardType="numeric" inputMode="decimal" placeholder="0,00" placeholderTextColor={colors.muted} style={input} />
                        {aNumero(pPrecio) > 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Equivale a {usd(aNumero(pPrecio) * 12)} por 12 horas de horómetro.</Text>
                        ) : null}
                        {ref != null ? (
                          <TouchableOpacity onPress={() => setPPrecio(String(Math.round((ref / 12) * 100) / 100))}>
                            <Text style={{ color: colors.brandText, fontSize: 11, marginTop: 2 }}>
                              Referencia: en Control de jornadas la jornada vale {usd(ref)} → {usd(ref / 12)}/h · tocar para usarlo
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Rige desde</Text>
                        <DateField value={pDesde} onChange={setPDesde} />
                        <Toggle on={pBlindar} label="🔒 Blindar a un rango de fechas" ayuda="Rige SOLO entre esas fechas y manda sobre el precio abierto. Apagado: rige desde esa fecha en adelante." onPress={() => setPBlindar((v) => !v)} />
                        {pBlindar ? (
                          <View>
                            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Hasta (inclusive)</Text>
                            <DateField value={pHasta} onChange={setPHasta} />
                          </View>
                        ) : null}
                        <TextInput value={pNota} onChangeText={setPNota} placeholder="Nota (opcional)" placeholderTextColor={colors.muted} style={{ ...input, marginTop: spacing.sm }} />
                        <Toggle on={pTodaEmpresa} label={`Aplicar a TODAS las máquinas de ${m.empresa} que se ven (${g.filas.length})`} onPress={() => setPTodaEmpresa((v) => !v)} />
                        <TouchableOpacity onPress={() => guardarPrecio(m.id, m.empresa)} disabled={guardando}
                          style={{ backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', marginTop: spacing.xs, opacity: guardando ? 0.6 : 1 }}>
                          <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{guardando ? 'Guardando…' : '💾 Guardar precio'}</Text>
                        </TouchableOpacity>
                        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Un precio nuevo no cambia los días anteriores a su fecha. No se edita ni se borra: se anula.</Text>

                        {histo.length ? (
                          <View style={{ marginTop: spacing.sm }}>
                            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>HISTORIAL DE PRECIOS DE ESTA MÁQUINA</Text>
                            {histo.map((p) => (
                              <View key={p.id} style={{ paddingVertical: 3, borderTopWidth: 1, borderTopColor: colors.border }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                  <Text style={{ color: p.anulada_at ? colors.muted : colors.text, fontSize: 12, flex: 1, textDecorationLine: p.anulada_at ? 'line-through' : 'none' }}>
                                    {textoPrecioHorometro(p)}{p.created_by_nombre ? ` · ${p.created_by_nombre}` : ''}
                                  </Text>
                                  {!p.anulada_at ? (
                                    <TouchableOpacity onPress={() => { setAnularId(anularId === p.id ? null : p.id); setAnularMotivo(''); }}>
                                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>Anular</Text>
                                    </TouchableOpacity>
                                  ) : null}
                                </View>
                                {p.anulada_at ? <Text style={{ color: colors.muted, fontSize: 11 }}>Anulado: {p.anulada_motivo || 'sin motivo'}</Text> : null}
                                {p.nota ? <Text style={{ color: colors.muted, fontSize: 11 }}>{p.nota}</Text> : null}
                                {anularId === p.id ? (
                                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
                                    <TextInput value={anularMotivo} onChangeText={setAnularMotivo} placeholder="Motivo de la anulación (obligatorio)" placeholderTextColor={colors.muted} style={{ ...input, flex: 1 }} />
                                    <TouchableOpacity onPress={anular} style={{ backgroundColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' }}>
                                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Anular</Text>
                                    </TouchableOpacity>
                                  </View>
                                ) : null}
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          ))}
          <View style={{ height: spacing.lg }} />
        </ScrollView>

        {editLectura ? (
          <HorometroAjusteModal
            code={editLectura.code}
            machineryId={editLectura.machineryId}
            roundDate={editLectura.fecha}
            lecturas={lecturas.filter((l) => l.machineryId === editLectura.machineryId)}
            ajustes={ajustes.filter((a) => a.machinery_id === editLectura.machineryId)}
            puedeCambiarInspector={puedeCorregirHoro}
            onClose={() => setEditLectura(null)}
            onSaved={(mensaje) => { toast.success(mensaje); setRecarga((n) => n + 1); }}
          />
        ) : null}
      </Screen>
    </Modal>
  );
}
