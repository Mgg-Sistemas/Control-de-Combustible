// ============================================================================
// 📄 INFORME TÉCNICO Y DE COSTOS — la pestaña que lo emite.
//
// Reemplaza el Word que la oficina armaba a mano por máquina para entregárselo
// al dueño del equipo. Acá SOLO se elige la máquina, el período y los datos
// editoriales (a quién va, quién lo firma, conclusiones); el historial, las
// cuentas y el papel los pone el sistema — ver `src/lib/informeTecnico.ts`.
//
// ⚠️ LOS COSTOS NO ESTÁN EN EL MÓDULO DE SERVICIO. Viven en una tabla PROPIA
//    del informe (`machinery_tech_report_costs`), una hoja por intervención, y
//    se cargan ACÁ. El formulario de 🧾 Servicios no pide precios y la hoja que
//    firma el técnico en el patio no los imprime: pedido del cliente —«que sea
//    independiente en el módulo, que no afecte nada, es un reporte nuevo»—.
//
//    Además evita una trampa: al editar un servicio sus repuestos se BORRAN y
//    se vuelven a insertar, así que un precio guardado en
//    `machinery_service_parts` se perdía en silencio con cualquier corrección.
//
// ⚠️ Necesita `informe_tecnico_costos.sql` y `informe_tecnico_costos_aparte.sql`
//    corridos A MANO. Sin ellos la pestaña NO revienta: avisa con un banner y el
//    informe sale con los totales en cero.
//
// ⚠️ LOS COMPONENTES CON CAMPO DE TEXTO VIVEN A NIVEL DE MÓDULO, no dentro del
//    componente. Un componente declarado adentro es una función nueva en cada
//    render, React lo trata como OTRO componente, desmonta el <TextInput> y el
//    campo pierde el foco a cada tecla. Ya pasó en `ServicioRegistroTab.tsx` y
//    está documentado allá con todas sus letras.
// ============================================================================
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { Card, EmptyState, Loading } from '../components/ui';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { machineLabel as etiquetaMaquina, machineMatches } from '../lib/machineLabel';
import { REPORT_BRAND, exportPdf } from '../lib/pdf';
import { cmpText } from '../lib/text';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import {
  informeTecnicoHtml, antecedentesAuto, totalesInforme, money, dmy,
  horometroInforme, nombreArchivoInforme, conCostos, hojaPropuesta,
  costoRepuestos, subtotalIntervencion, descripcionIntervencion, totalRepuesto, numero,
  EquipoInforme, IntervencionInforme, HojaCosto, RepuestoInforme,
} from '../lib/informeTecnico';

/** Lo que la pantalla madre ya trae de cada máquina. Incluye el horómetro para
 *  poder mostrar el «próximo servicio» ANTES de generar nada; la ficha completa
 *  (foto, marca, modelo, RIF) se busca recién al imprimir. */
type Mach = {
  id: string; code: string; plate: string | null; serial: string | null;
  tipo: string | null; company: string; operational: boolean;
  encargado?: string | null;
  last_horometro?: number | null; horometro_base?: number | null;
};

/** Un informe ya emitido, tal como sale de `machinery_tech_reports`. */
type Emitido = {
  id: string; code: string; machinery_id: string; report_date: string;
  desde: string | null; hasta: string | null;
  dirigido_a: string | null; elaborado_por: string | null;
  empresa_propietaria: string | null; encargado_sitio: string | null;
  ubicacion: string | null; estado_informe: string | null;
  antecedentes: string | null; estado_operatividad: string | null;
  proximo_pm: string | null; recomendaciones: string[] | null;
  firma1_nombre: string | null; firma1_cargo: string | null; firma1_empresa: string | null;
  firma2_nombre: string | null; firma2_cargo: string | null; firma2_empresa: string | null;
  con_fotos: boolean | null;
};

/** Ordena los repuestos por su posición: sin eso Postgres los devuelve como
 *  quiera y la línea de insumos sale distinta en cada impresión. */
const normalizar = (o: any): IntervencionInforme & { id: string } => ({
  ...o,
  parts: (o.parts ?? []).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)),
});

/**
 * Las hojas de costo de esas intervenciones.
 *
 * Si la tabla no existe todavía (falta correr el SQL) NO revienta: avisa por
 * `setFalta` y devuelve vacío, así la pestaña sigue sirviendo para ver el
 * historial y emitir el informe sin precios.
 */
async function traerHojas(ids: string[], setFalta: (v: boolean) => void): Promise<HojaCosto[]> {
  if (!ids.length) { setFalta(false); return []; }
  const { data, error } = await supabase
    .from('machinery_tech_report_costs')
    .select('service_order_id, labor_cost, items')
    .in('service_order_id', ids);
  setFalta(!!error);
  return (data ?? []) as HojaCosto[];
}

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function Campo(p: {
  colors: AppColors; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; multiline?: boolean; ayuda?: string;
}) {
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={{ color: p.colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: .4 }}>{p.label.toUpperCase()}</Text>
      <TextInput
        value={p.value} onChangeText={p.onChange} placeholder={p.placeholder}
        placeholderTextColor={p.colors.muted} multiline={p.multiline}
        style={{
          marginTop: 3, backgroundColor: p.colors.surface, borderWidth: 1, borderColor: p.colors.border,
          borderRadius: radius.md, padding: spacing.sm, color: p.colors.text, fontSize: 13.5,
          minHeight: p.multiline ? 74 : undefined, textAlignVertical: p.multiline ? 'top' : 'center',
        }}
      />
      {p.ayuda ? <Text style={{ color: p.colors.muted, fontSize: 10.5, marginTop: 2 }}>{p.ayuda}</Text> : null}
    </View>
  );
}

export default function InformeTecnicoTab(
  { machines, canWrite, uid }: { machines: Mach[]; canWrite: boolean; uid: string | null }
) {
  const { colors } = useTheme();
  const { fullName } = useAuth();
  const toast = useToast();

  const [q, setQ] = useState('');
  const [maquinaId, setMaquinaId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const [items, setItems] = useState<(IntervencionInforme & { id: string })[]>([]);
  const [hojas, setHojas] = useState<HojaCosto[]>([]);
  const [cargando, setCargando] = useState(false);
  // `true` = el SQL de costos no está corrido. No bloquea nada: solo avisa.
  const [faltaSql, setFaltaSql] = useState(false);

  const [fechaEmision, setFechaEmision] = useState(hoyISO());
  const [dirigidoA, setDirigidoA] = useState('');
  const [elaboradoPor, setElaboradoPor] = useState(fullName ?? '');
  const [empresaProp, setEmpresaProp] = useState('');
  const [encargado, setEncargado] = useState('');
  const [ubicacion, setUbicacion] = useState(REPORT_BRAND);
  const [estadoInforme, setEstadoInforme] = useState('Consolidado final de servicios');
  const [antecedentes, setAntecedentes] = useState('');
  const [estadoOper, setEstadoOper] = useState('');
  const [proximoPm, setProximoPm] = useState('');
  const [recos, setRecos] = useState('');
  const [conFotos, setConFotos] = useState(true);
  const [f1Nombre, setF1Nombre] = useState(fullName ?? '');
  const [f1Cargo, setF1Cargo] = useState('');
  const [f2Nombre, setF2Nombre] = useState('');
  const [f2Cargo, setF2Cargo] = useState('');

  const [emitidos, setEmitidos] = useState<Emitido[]>([]);
  const [busy, setBusy] = useState(false);

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    const xs = machines.filter((m) => !t || machineMatches(m, q) || (m.company ?? '').toLowerCase().includes(t));
    return xs.slice().sort((a, b) => cmpText(etiquetaMaquina(a), etiquetaMaquina(b)));
  }, [machines, q]);

  const maquina = useMemo(() => machines.find((m) => m.id === maquinaId) ?? null, [machines, maquinaId]);

  // Al elegir la máquina se propone su encargado, pero SOLO si el campo está
  // vacío: si quien emite ya escribió otro nombre, cambiar de máquina no se lo
  // puede borrar de abajo.
  useEffect(() => {
    if (maquina?.encargado) setEncargado((v) => v.trim() || maquina.encargado!);
  }, [maquina]);

  // ── Trae el historial de la máquina, y la hoja de costos de cada trabajo ──
  //
  // Son DOS consultas contra DOS tablas, y eso es el punto: el historial es del
  // módulo de Servicio (que no lleva dinero) y los costos son del informe. La
  // segunda puede fallar sin que la primera se entere — si falta correr el SQL,
  // el historial igual se ve y el informe sale con los totales en cero.
  useEffect(() => {
    if (!maquinaId) { setItems([]); setHojas([]); return; }
    let vivo = true;
    (async () => {
      setCargando(true);
      try {
        let qy = supabase
          .from('machinery_service_orders')
          .select('id, service_date, origen, technician, provider, problem, work_done, notes, photos, parts:machinery_service_parts(quantity, description, estado, position)')
          .eq('machinery_id', maquinaId);
        if (desde) qy = qy.gte('service_date', desde);
        if (hasta) qy = qy.lte('service_date', hasta);
        const { data } = await qy;
        if (!vivo) return;
        const ordenes = ((data ?? []) as any[]).map(normalizar);
        setItems(ordenes);
        setHojas(await traerHojas(ordenes.map((o) => o.id).filter(Boolean) as string[], setFaltaSql));
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [maquinaId, desde, hasta]);

  // ── Informes ya emitidos para esa máquina ─────────────────────────────────
  const cargarEmitidos = async (id: string) => {
    if (!id) return setEmitidos([]);
    const { data } = await supabase
      .from('machinery_tech_reports').select('*')
      .eq('machinery_id', id).order('report_date', { ascending: false })
      .then((r) => r, () => ({ data: [] as any[] }));
    setEmitidos((data ?? []) as Emitido[]);
  };
  useEffect(() => { cargarEmitidos(maquinaId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [maquinaId]);

  // Lo que de verdad se imprime: el historial con su hoja de costos pegada.
  const conCosto = useMemo(() => conCostos(items, hojas), [items, hojas]);
  const totales = useMemo(() => totalesInforme(conCosto), [conCosto]);


  // ── La hoja de costos que se está editando ────────────────────────────────
  // Se edita UNA a la vez y en un estado aparte (no dentro de `hojas`): así lo
  // que se teclea no se pierde si llega un refresco, y cancelar es de verdad
  // cancelar. Al guardar se vuelve a leer todo desde la base.
  const [costoAbierto, setCostoAbierto] = useState<string | null>(null);
  const [edMano, setEdMano] = useState('');
  const [edItems, setEdItems] = useState<RepuestoInforme[]>([]);

  /** Abre (o cierra) la hoja de una intervención. Si no tiene hoja todavía, se
   *  le PROPONE la lista de repuestos que el taller ya cargó, sin precios. */
  const abrirCosto = (it: IntervencionInforme & { id: string }) => {
    if (costoAbierto === it.id) return setCostoAbierto(null);
    const h = hojas.find((x) => x.service_order_id === it.id);
    setEdMano(h?.labor_cost == null ? '' : String(h.labor_cost));
    setEdItems(h?.items?.length ? h.items.map((p) => ({ ...p })) : hojaPropuesta(it));
    setCostoAbierto(it.id);
  };

  const guardarCosto = async (serviceOrderId: string) => {
    setBusy(true);
    try {
      // Los renglones sin nombre no se guardan (el último suele quedar vacío).
      // El monto se normaliza acá y no en la base: «45,50» tiene que entrar
      // como 45.5 igual que en el resto del sistema.
      // ⚠️ NO se llama `items`: ese nombre ya es el del historial cargado y
      //    sombrearlo hacía que la relectura de las hojas mirara la lista
      //    equivocada.
      const renglones = edItems
        .filter((p) => String(p.description ?? '').trim() !== '')
        .map((p) => ({
          description: String(p.description).trim(),
          qty: p.quantity == null || String(p.quantity).trim() === '' ? null : numero(p.quantity),
          unit_cost: p.unit_cost == null || String(p.unit_cost).trim() === '' ? null : numero(p.unit_cost),
        }));
      const mano = edMano.trim() === '' ? null : numero(edMano);

      const { error } = await supabase
        .from('machinery_tech_report_costs')
        .upsert({
          service_order_id: serviceOrderId, labor_cost: mano, items: renglones,
          updated_by: uid, updated_at: new Date().toISOString(),
        }, { onConflict: 'service_order_id' });
      if (error) return toast.error(error.message);

      setHojas(await traerHojas(items.map((o) => o.id).filter(Boolean) as string[], setFaltaSql));
      setCostoAbierto(null);
      toast.success('Costos guardados.');
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudieron guardar los costos.');
    } finally {
      setBusy(false);
    }
  };


  /** La ficha completa del equipo. La pantalla madre solo trae lo básico. */
  const traerEquipo = async (id: string): Promise<EquipoInforme> => {
    const { data } = await supabase
      .from('machinery')
      .select('id, code, plate, serial, identifier, tipo, marca, modelo, photo_url, encargado, last_horometro, horometro_base, company:company_id(name, rif)')
      .eq('id', id).maybeSingle();
    const m: any = data ?? {};
    return { ...m, companyName: m.company?.name ?? null, companyRif: m.company?.rif ?? null };
  };

  const cabeceraDe = (code: string | null) => ({
    code,
    reportDate: fechaEmision,
    dirigidoA, elaboradoPor,
    empresaPropietaria: empresaProp,
    encargadoSitio: encargado,
    ubicacion, estadoInforme,
    antecedentes,
    estadoOperatividad: estadoOper,
    proximoPm,
    recomendaciones: recos.split('\n').map((r) => r.trim()).filter(Boolean),
    firma1Nombre: f1Nombre, firma1Cargo: f1Cargo, firma1Empresa: REPORT_BRAND.split(' / ').pop() ?? '',
    firma2Nombre: f2Nombre, firma2Cargo: f2Cargo, firma2Empresa: empresaProp,
    conFotos,
  });

  /**
   * Emite el informe: lo guarda (para tener el correlativo y poder reimprimirlo
   * igual) y saca el PDF.
   *
   * ⚠️ PRIMERO SE GUARDA Y DESPUÉS SE IMPRIME, y el número del papel es el que
   *    devolvió la base. Al revés —imprimir y después guardar— el PDF saldría
   *    con un correlativo inventado por la pantalla, y dos personas emitiendo a
   *    la vez entregarían dos informes distintos con el mismo número.
   *
   * Si el guardado falla (la tabla no existe porque el SQL no se corrió), el PDF
   * SE GENERA IGUAL, sin correlativo y avisando. Quedarse sin el documento por
   * no poder anotarlo sería la peor de las dos mitades.
   */
  const emitir = async () => {
    if (!maquinaId) return toast.error('Elige primero la máquina.');
    setBusy(true);
    try {
      let code: string | null = null;
      let aviso: string | null = null;
      if (canWrite) {
        const { data, error } = await supabase
          .from('machinery_tech_reports')
          .insert({
            machinery_id: maquinaId, report_date: fechaEmision,
            desde: desde || null, hasta: hasta || null,
            dirigido_a: dirigidoA.trim() || null, elaborado_por: elaboradoPor.trim() || null,
            empresa_propietaria: empresaProp.trim() || null, encargado_sitio: encargado.trim() || null,
            ubicacion: ubicacion.trim() || null, estado_informe: estadoInforme.trim() || null,
            antecedentes: antecedentes.trim() || null,
            estado_operatividad: estadoOper.trim() || null, proximo_pm: proximoPm.trim() || null,
            recomendaciones: recos.split('\n').map((r) => r.trim()).filter(Boolean),
            firma1_nombre: f1Nombre.trim() || null, firma1_cargo: f1Cargo.trim() || null,
            firma2_nombre: f2Nombre.trim() || null, firma2_cargo: f2Cargo.trim() || null,
            con_fotos: conFotos, created_by: uid,
          })
          .select('code').single();
        if (error) aviso = `El informe se generó, pero no quedó registrado: ${error.message}`;
        else code = (data as any)?.code ?? null;
      }

      const equipo = await traerEquipo(maquinaId);
      const html = informeTecnicoHtml({
        equipo, items: conCosto, cabecera: cabeceraDe(code), empresaEmisora: REPORT_BRAND,
      });
      await exportPdf(html, nombreArchivoInforme(equipo, code));
      await cargarEmitidos(maquinaId);
      if (aviso) toast.error(aviso);
      else toast.success(`Informe ${code ?? ''} generado.`);
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo generar el informe.');
    } finally {
      setBusy(false);
    }
  };

  /** Reimprime uno ya emitido, con SU cabecera guardada y SU rango. El historial
   *  se vuelve a leer: si se corrigió un costo mal cargado, el informe corregido
   *  es el que sale. */
  const reimprimir = async (e: Emitido) => {
    setBusy(true);
    try {
      let qy = supabase
        .from('machinery_service_orders')
        .select('id, service_date, origen, technician, provider, problem, work_done, notes, photos, parts:machinery_service_parts(quantity, description, estado, position)')
        .eq('machinery_id', e.machinery_id);
      if (e.desde) qy = qy.gte('service_date', e.desde);
      if (e.hasta) qy = qy.lte('service_date', e.hasta);
      const { data } = await qy;
      const ordenes = ((data ?? []) as any[]).map(normalizar);
      // El historial y los costos se vuelven a LEER: si se corrigió un precio mal
      // cargado, el informe corregido es el que sale.
      const suHojas = await traerHojas(ordenes.map((o) => o.id).filter(Boolean) as string[], () => {});
      const equipo = await traerEquipo(e.machinery_id);
      const html = informeTecnicoHtml({
        equipo, items: conCostos(ordenes, suHojas), empresaEmisora: REPORT_BRAND,
        cabecera: {
          code: e.code, reportDate: e.report_date, dirigidoA: e.dirigido_a,
          elaboradoPor: e.elaborado_por, empresaPropietaria: e.empresa_propietaria,
          encargadoSitio: e.encargado_sitio, ubicacion: e.ubicacion, estadoInforme: e.estado_informe,
          antecedentes: e.antecedentes, estadoOperatividad: e.estado_operatividad,
          proximoPm: e.proximo_pm, recomendaciones: e.recomendaciones,
          firma1Nombre: e.firma1_nombre, firma1Cargo: e.firma1_cargo, firma1Empresa: e.firma1_empresa,
          firma2Nombre: e.firma2_nombre, firma2Cargo: e.firma2_cargo, firma2Empresa: e.firma2_empresa,
          conFotos: e.con_fotos !== false,
        },
      });
      await exportPdf(html, nombreArchivoInforme(equipo, e.code));
    } catch (err: any) {
      toast.error(err?.message ?? 'No se pudo reimprimir.');
    } finally {
      setBusy(false);
    }
  };

  const etiqueta = { color: colors.brand, fontWeight: '900' as const, fontSize: 12, marginTop: spacing.md };

  return (
    <View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Arma el «Informe Técnico y de Costos» de UNA máquina: su ficha, todas las intervenciones del
        período con mano de obra y repuestos, los totales consolidados y las firmas. Las cuentas las
        hace el sistema con lo que ya está cargado en 🧾 Servicios.
      </Text>

      {faltaSql ? (
        <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: colors.danger, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '800' }}>⚠️ Falta correr el SQL de costos</Text>
          <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>
            El informe se genera igual, pero no se pueden cargar costos y los totales saldrán en cero.
            Corre `supabase/informe_tecnico_costos_aparte.sql` en Supabase → SQL Editor.
          </Text>
        </View>
      ) : null}

      {/* ── 1) La máquina ── */}
      <Text style={etiqueta}>1. EQUIPO</Text>
      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar máquina, placa, serial, empresa…"
        placeholderTextColor={colors.muted}
        style={{ marginTop: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
      <ScrollView style={{ maxHeight: 190, marginTop: spacing.xs }} nestedScrollEnabled>
        {lista.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.sm }}>Sin resultados.</Text>
        ) : lista.map((m) => {
          const on = m.id === maquinaId;
          return (
            <TouchableOpacity key={m.id} onPress={() => setMaquinaId(on ? '' : m.id)} activeOpacity={0.7}
              style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, marginBottom: 3,
                borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
              <Text numberOfLines={1} style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>
                {etiquetaMaquina(m)}
              </Text>
              <Text numberOfLines={1} style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>{m.company}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {!maquinaId ? (
        <EmptyState title="Elige una máquina" subtitle="Para ver su historial de servicios y emitir el informe." />
      ) : (
        <>
          {/* ── 2) El período ── */}
          <Text style={etiqueta}>2. PERÍODO</Text>
          <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 2 }}>
            Dejar las dos fechas vacías trae TODO el historial de la máquina.
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
            <View style={{ flex: 1 }}><DateField value={desde} onChange={setDesde} placeholder="Desde" /></View>
            <View style={{ flex: 1 }}><DateField value={hasta} onChange={setHasta} placeholder="Hasta" /></View>
          </View>

          {/* ── Lo que va a salir ── */}
          {cargando ? <Loading /> : (
            <Card style={{ marginTop: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
                {totales.intervenciones === 0 ? 'Sin intervenciones en el período'
                  : `${totales.intervenciones} ${totales.intervenciones === 1 ? 'intervención' : 'intervenciones'}`}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
                Mano de obra {money(totales.manoObra)} · Repuestos {money(totales.repuestos)}
              </Text>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginTop: 3 }}>
                Total {money(totales.total)}
                <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>
                  {'  '}· promedio {money(totales.promedio)} por intervención
                </Text>
              </Text>
              {maquina ? (
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                  Horómetro: {horometroInforme(maquina)}
                </Text>
              ) : null}
              {items.length > 0 && totales.total === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                  Hay intervenciones pero ninguna tiene costos cargados. Se cargan abajo, en «2b. Costos de cada intervención».
                </Text>
              ) : null}
            </Card>
          )}


          {/* ── 2b) LOS COSTOS DEL INFORME ──────────────────────────────────
              Se cargan ACÁ, no en 🧾 Servicios: el módulo de Servicio no lleva
              dinero. Cada intervención tiene su hoja, y la hoja se propone con
              los repuestos que el taller ya cargó para no escribirlos de nuevo. */}
          {items.length ? (
            <>
              <Text style={etiqueta}>2b. COSTOS DE CADA INTERVENCIÓN</Text>
              <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 2 }}>
                Opcional. Lo que dejes sin precio sale en el informe nombrado pero sin monto, y no ensucia los totales.
              </Text>
              {conCosto.map((it) => {
                const abierta = costoAbierto === it.id;
                const sub = subtotalIntervencion(it);
                return (
                  <View key={it.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginTop: spacing.xs, backgroundColor: colors.surface }}>
                    <TouchableOpacity onPress={() => abrirCosto(it)} activeOpacity={0.7}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>
                          {dmy(it.service_date)} · {descripcionIntervencion(it).slice(0, 60)}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                          {sub > 0 ? `Mano de obra ${money(it.labor_cost)} · repuestos ${money(costoRepuestos(it.parts))}` : 'Sin costos cargados'}
                        </Text>
                      </View>
                      <Text style={{ color: sub > 0 ? colors.text : colors.muted, fontWeight: '900', fontSize: 13 }}>{money(sub)}</Text>
                      <Text style={{ color: colors.muted, fontSize: 15 }}>{abierta ? '▾' : '›'}</Text>
                    </TouchableOpacity>

                    {abierta ? (
                      <View style={{ padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.xs }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                          <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '700', flex: 1 }}>Mano de obra</Text>
                          <TextInput value={edMano} onChangeText={setEdMano} keyboardType="numeric"
                            placeholder="$ 0,00" placeholderTextColor={colors.muted}
                            style={{ width: 108, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, textAlign: 'right' }} />
                        </View>

                        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.xs }}>INSUMOS</Text>
                        {edItems.length === 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 11.5 }}>Esta intervención no cargó repuestos. Puedes agregar un renglón igual.</Text>
                        ) : null}
                        {edItems.map((p, i) => {
                          // El total del renglón, en vivo: es lo que delata haber
                          // puesto el total donde va el precio de UNO.
                          const tot = totalRepuesto(p);
                          return (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                              <TextInput value={p.quantity == null ? '' : String(p.quantity)} keyboardType="numeric"
                                placeholder="Cant." placeholderTextColor={colors.muted}
                                onChangeText={(v) => setEdItems((xs) => xs.map((x, j) => j === i ? { ...x, quantity: v } : x))}
                                style={{ width: 54, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                              <TextInput value={String(p.description ?? '')} placeholder="Insumo"
                                placeholderTextColor={colors.muted}
                                onChangeText={(v) => setEdItems((xs) => xs.map((x, j) => j === i ? { ...x, description: v } : x))}
                                style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                              <TextInput value={p.unit_cost == null ? '' : String(p.unit_cost)} keyboardType="numeric"
                                placeholder="$ c/u" placeholderTextColor={colors.muted}
                                onChangeText={(v) => setEdItems((xs) => xs.map((x, j) => j === i ? { ...x, unit_cost: v } : x))}
                                style={{ width: 78, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, textAlign: 'right' }} />
                              <Text style={{ color: tot > 0 ? colors.text : colors.muted, fontSize: 11, fontWeight: '800', width: 62, textAlign: 'right' }}>
                                {tot > 0 ? money(tot) : '—'}
                              </Text>
                              <TouchableOpacity onPress={() => setEdItems((xs) => xs.filter((_, j) => j !== i))}>
                                <Text style={{ color: colors.danger, fontSize: 15 }}>🗑</Text>
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                        <TouchableOpacity onPress={() => setEdItems((xs) => [...xs, { description: '', quantity: null, unit_cost: null }])}>
                          <Text style={{ color: colors.brand, fontWeight: '800', fontSize: 12 }}>+ Agregar insumo</Text>
                        </TouchableOpacity>

                        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                          <TouchableOpacity onPress={() => setCostoAbierto(null)}
                            style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5 }}>Cancelar</Text>
                          </TouchableOpacity>
                          <TouchableOpacity disabled={busy || !canWrite} onPress={() => guardarCosto(it.id)}
                            style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', opacity: busy || !canWrite ? 0.5 : 1 }}>
                            <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12.5 }}>💾 Guardar costos</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : null}

          {/* ── 3) La cabecera del documento ── */}
          <Text style={etiqueta}>3. DATOS DEL INFORME</Text>
          <View style={{ marginTop: spacing.xs }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: .4 }}>FECHA DE EMISIÓN</Text>
            <DateField value={fechaEmision} onChange={setFechaEmision} />
          </View>
          <Campo colors={colors} label="Dirigido a" value={dirigidoA} onChange={setDirigidoA}
            placeholder="Sr. Samuel Nasser (Propietario)" />
          <Campo colors={colors} label="Elaborado por" value={elaboradoPor} onChange={setElaboradoPor}
            placeholder="Nombre y apellido" />
          <Campo colors={colors} label="Empresa / propietario" value={empresaProp} onChange={setEmpresaProp}
            placeholder="A quién pertenece el equipo" />
          <Campo colors={colors} label="Encargado de sitio" value={encargado} onChange={setEncargado}
            placeholder="Quién responde en obra" />
          <Campo colors={colors} label="Ubicación de operación" value={ubicacion} onChange={setUbicacion} />
          <Campo colors={colors} label="Estado del informe" value={estadoInforme} onChange={setEstadoInforme} />

          <Campo colors={colors} label="Antecedentes" value={antecedentes} onChange={setAntecedentes} multiline
            placeholder="Se redacta solo si lo dejas vacío"
            ayuda="Vacío = lo redacta el sistema con el período, el equipo y la cantidad de intervenciones." />
          <TouchableOpacity
            onPress={() => setAntecedentes(antecedentesAuto({
              equipo: (maquina ?? {}) as any, items, dirigidoA, ubicacion,
            }))}
            style={{ marginTop: spacing.xs }}>
            <Text style={{ color: colors.brand, fontWeight: '800', fontSize: 12 }}>✍️ Redactarlo por mí (para corregirlo)</Text>
          </TouchableOpacity>

          {/* ── 4) Conclusiones ── */}
          <Text style={etiqueta}>4. CONCLUSIONES Y RECOMENDACIONES</Text>
          <Campo colors={colors} label="Estado de operatividad" value={estadoOper} onChange={setEstadoOper} multiline
            placeholder="En observación / operativo con restricción…" />
          <Campo colors={colors} label="Próximo mantenimiento preventivo" value={proximoPm} onChange={setProximoPm}
            placeholder={maquina ? horometroInforme(maquina) : 'Horómetro del próximo servicio'}
            ayuda="Vacío = se calcula con el horómetro de la máquina (intervalo de 250 h)." />
          <Campo colors={colors} label="Recomendaciones" value={recos} onChange={setRecos} multiline
            placeholder={'Una por línea'} ayuda="Cada línea sale como un punto de la lista." />

          {/* ── 5) Firmas y registro fotográfico ── */}
          <Text style={etiqueta}>5. FIRMAS Y FOTOS</Text>
          <Campo colors={colors} label="Firma 1 · nombre" value={f1Nombre} onChange={setF1Nombre} />
          <Campo colors={colors} label="Firma 1 · cargo" value={f1Cargo} onChange={setF1Cargo}
            placeholder="Jefa de Almacén y Compras" />
          <Campo colors={colors} label="Firma 2 · nombre" value={f2Nombre} onChange={setF2Nombre}
            placeholder="Quién recibe el informe" />
          <Campo colors={colors} label="Firma 2 · cargo" value={f2Cargo} onChange={setF2Cargo}
            placeholder="Propietario de la maquinaria" />
          <TouchableOpacity onPress={() => setConFotos((v) => !v)} activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
            <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: colors.brand, alignItems: 'center', justifyContent: 'center', backgroundColor: conFotos ? colors.brand : 'transparent' }}>
              {conFotos ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
            </View>
            <Text style={{ color: colors.text, fontSize: 12.5, flex: 1 }}>
              Incluir el registro fotográfico (usa las fotos de cada servicio; donde no haya, deja el recuadro para pegarlas).
            </Text>
          </TouchableOpacity>

          {/* ── Emitir ── */}
          <TouchableOpacity disabled={busy} onPress={emitir} activeOpacity={0.85}
            style={{ marginTop: spacing.lg, backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 14 }}>
              {busy ? 'Generando…' : '📄 Generar informe técnico'}
            </Text>
          </TouchableOpacity>
          {!canWrite ? (
            <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 4, textAlign: 'center' }}>
              Sin permiso de escritura el informe se genera pero no queda registrado (sale sin correlativo).
            </Text>
          ) : null}

          {/* ── Ya emitidos ── */}
          {emitidos.length ? (
            <>
              <Text style={etiqueta}>INFORMES YA EMITIDOS</Text>
              {emitidos.map((e) => (
                <TouchableOpacity key={e.id} disabled={busy} onPress={() => reimprimir(e)} activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{e.code}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      {dmy(e.report_date)}{e.dirigido_a ? ` · ${e.dirigido_a}` : ''}
                      {e.desde || e.hasta ? ` · ${dmy(e.desde)} → ${dmy(e.hasta)}` : ' · todo el historial'}
                    </Text>
                  </View>
                  <Text style={{ color: colors.brand, fontWeight: '800', fontSize: 12 }}>📄 Reimprimir</Text>
                </TouchableOpacity>
              ))}
            </>
          ) : null}
        </>
      )}
      <View style={{ height: spacing.xl }} />
    </View>
  );
}
