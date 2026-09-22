// ============================================================================
// 📄 INFORME TÉCNICO Y DE COSTOS — la pestaña que lo emite.
//
// Reemplaza el Word que la oficina armaba a mano por máquina para entregárselo
// al dueño del equipo. Acá SOLO se elige la máquina, el período y los datos
// editoriales (a quién va, quién lo firma, conclusiones); el historial, las
// cuentas y el papel los pone el sistema — ver `src/lib/informeTecnico.ts`.
//
// ⚠️ Necesita `supabase/informe_tecnico_costos.sql` corrido A MANO. Mientras no
//    se corra, ni `labor_cost`/`unit_cost` ni la tabla de informes existen. La
//    pestaña NO revienta: avisa arriba con un banner y sigue dejando generar el
//    PDF (saldría con los costos en cero). Mismo criterio que el catálogo de
//    tipos de intervención, que también vive dentro de un try/catch.
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
  horometroInforme, nombreArchivoInforme,
  EquipoInforme, IntervencionInforme,
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
const normalizar = (o: any): IntervencionInforme => ({
  ...o,
  parts: (o.parts ?? []).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)),
});

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

  const [items, setItems] = useState<IntervencionInforme[]>([]);
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

  // ── Trae el historial de la máquina elegida ───────────────────────────────
  useEffect(() => {
    if (!maquinaId) { setItems([]); return; }
    let vivo = true;
    (async () => {
      setCargando(true);
      try {
        let qy = supabase
          .from('machinery_service_orders')
          .select('id, service_date, origen, technician, provider, problem, work_done, notes, labor_cost, photos, parts:machinery_service_parts(quantity, description, estado, unit_cost, position)')
          .eq('machinery_id', maquinaId);
        if (desde) qy = qy.gte('service_date', desde);
        if (hasta) qy = qy.lte('service_date', hasta);
        const { data, error } = await qy;
        if (!vivo) return;
        if (error) {
          // La columna no existe todavía → el SQL no está corrido. Se reintenta
          // SIN los campos de dinero para que la pestaña siga sirviendo.
          setFaltaSql(true);
          let q2 = supabase
            .from('machinery_service_orders')
            .select('id, service_date, origen, technician, provider, problem, work_done, notes, photos, parts:machinery_service_parts(quantity, description, estado, position)')
            .eq('machinery_id', maquinaId);
          if (desde) q2 = q2.gte('service_date', desde);
          if (hasta) q2 = q2.lte('service_date', hasta);
          const r2 = await q2;
          if (!vivo) return;
          setItems(((r2.data ?? []) as any[]).map(normalizar));
        } else {
          setFaltaSql(false);
          setItems(((data ?? []) as any[]).map(normalizar));
        }
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

  const totales = useMemo(() => totalesInforme(items), [items]);

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
        equipo, items, cabecera: cabeceraDe(code), empresaEmisora: REPORT_BRAND,
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
        .select('id, service_date, origen, technician, provider, problem, work_done, notes, labor_cost, photos, parts:machinery_service_parts(quantity, description, estado, unit_cost, position)')
        .eq('machinery_id', e.machinery_id);
      if (e.desde) qy = qy.gte('service_date', e.desde);
      if (e.hasta) qy = qy.lte('service_date', e.hasta);
      const { data } = await qy;
      const equipo = await traerEquipo(e.machinery_id);
      const html = informeTecnicoHtml({
        equipo, items: ((data ?? []) as any[]).map(normalizar), empresaEmisora: REPORT_BRAND,
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
            El informe se genera igual, pero la mano de obra y el precio de los repuestos saldrán en cero.
            Corre `supabase/informe_tecnico_costos.sql` en Supabase → SQL Editor.
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
                  Hay intervenciones pero ninguna tiene costos cargados. Se cargan en 🧾 Servicios → editar el servicio → «6. Costos».
                </Text>
              ) : null}
            </Card>
          )}

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
