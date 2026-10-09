// 🛠️ REPORTE PERSONALIZADO DE MAQUINARIA — pestaña de Reportes (09-oct-2026).
//
// Pedido del cliente: «un reporte independiente, que reciba información pero no
// envíe; que yo le pueda cargar o quitar máquinas, colocar o quitar nombres de
// empresas, cambiar estados y la fecha en que lo saco… todo modificable, sin que
// me dañe nada en el sistema».
//
// Cómo cumple eso:
// - SOLO LEE. Al abrirse baja el catálogo (machinery), y las averías pendientes
//   para sugerir el estado real. No hay ni un insert/update/delete/rpc en este
//   archivo; un candado de la suite lo vigila.
// - Todo lo demás es estado LOCAL de la tarjeta: lo que se escribe, agrega,
//   quita o reordena vive aquí y muere al salir de la pantalla. El catálogo
//   original no se toca.
// - La fecha de emisión del papel es elegible (interruptor `emitida` de
//   pdfDocument); el título, el subtítulo, la nota, las columnas y los logos
//   también.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { DateField } from './DateField';
import { Toggle } from './CubicajeTab';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { selectAllRows } from '../lib/supabase';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { caracasToday } from '../lib/caracasDay';
import { norm } from '../lib/text';
import {
  CSS_REPORTE_PERSONALIZADO, ESTADOS_PERSONALIZADO, FilaPersonalizada, OpcionesPersonalizado,
  OPCIONES_PERSONALIZADO_INICIAL, PASTILLAS_PERSONALIZADO,
  alternarPersonalizado, cuerpoReportePersonalizado, dmyPersonalizado, emitidaTexto, filaVacia,
  ocultosPersonalizadoEnPalabras, sufijoArchivoPersonalizado,
} from '../lib/reporteMaquinariaPersonalizado';

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const n2 = (v: unknown) => Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** «alto × largo × ancho m» de la ficha (las mismas columnas que Acarreo). */
const medidasFicha = (alto: unknown, largo: unknown, ancho: unknown) => {
  const v = [alto, largo, ancho].map(Number);
  return v.every((x) => Number.isFinite(x) && x > 0) ? `${n2(v[0])} × ${n2(v[1])} × ${n2(v[2])} m` : '';
};

type Logos = { bcv: boolean; sos: boolean; golden: boolean; renace: boolean; jhenzaen: boolean };
// Membrete de siempre de Reportes: BCV + SOS encendidos; los demás se piden.
const LOGOS_POR_DEFECTO: Logos = { bcv: true, sos: true, golden: false, renace: false, jhenzaen: false };
const LOGOS: { k: keyof Logos; label: string }[] = [
  { k: 'bcv', label: '🏦 Banco Central de Venezuela' },
  { k: 'sos', label: '🛟 SOS La Guaira' },
  { k: 'golden', label: '✨ Golden Touch' },
  { k: 'renace', label: '🇻🇪 Plan Venezuela Renace' },
  { k: 'jhenzaen', label: '🏗️ Jhenzaen 2.012 C.A' },
];

const MAX_PASTILLAS_CATALOGO = 40;

export function ReporteMaquinariaPersonalizadoCard() {
  const { colors } = useTheme();

  // ⚡ Carga perezosa: este componente solo se monta al elegir la pestaña
  //    «Personalizado», así que Reportes no pide nada de esto al arrancar.
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogo, setCatalogo] = useState<FilaPersonalizada[]>([]);

  // Lo editable (TODO local; nada vuelve a la base):
  const [filas, setFilas] = useState<FilaPersonalizada[]>([]);
  const [titulo, setTitulo] = useState('Reporte de maquinaria');
  const [subtitulo, setSubtitulo] = useState('Reporte personalizado');
  const [nota, setNota] = useState('');
  const [fechaEmision, setFechaEmision] = useState(caracasToday());
  const [conRango, setConRango] = useState(false);
  const [desde, setDesde] = useState(caracasToday());
  const [hasta, setHasta] = useState(caracasToday());
  const [opciones, setOpciones] = useState<OpcionesPersonalizado>(OPCIONES_PERSONALIZADO_INICIAL);
  const [logos, setLogos] = useState<Logos>(LOGOS_POR_DEFECTO);
  const [marcaTexto, setMarcaTexto] = useState(true);
  const [busca, setBusca] = useState('');
  const [fuente, setFuente] = useState<'todos' | 'maq' | 'veh'>('todos');
  const [manuales, setManuales] = useState(0);
  const [confirmaVaciar, setConfirmaVaciar] = useState(false);
  const [descargando, setDescargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const [maqs, averias, vehs] = await Promise.all([
        selectAllRows(
          'machinery',
          'id, code, marca, modelo, clasificacion, serial, plate, zona, location, encargado, operational, en_espera, active, weight_ton, length_m, width_m, height_m, last_horometro, company:company_id(name)',
        ),
        // Las averías solo SUGIEREN el estado: si este rol no puede leerlas
        // (RLS de otro módulo), el papel sale igual, con «Operativa» de base.
        selectAllRows('maintenance_requests', 'machinery_id, material', (q: any) => q.eq('status', 'pendiente')).catch(() => [] as any[]),
        // 🚗 Vehículos (09-oct-2026, a pedido): entran al taller igual que las
        //    máquinas. Algunas columnas de su ficha llegaron por SQL opcional,
        //    así que si el select completo falla se cae a lo básico, y si ni
        //    eso se puede leer, el taller sigue solo con la maquinaria.
        selectAllRows('vehicles', 'id, plate, name, brand, model, vehicle_type, clasificacion, serial, encargado, en_espera, active, company:company_id(name)')
          .catch(() => selectAllRows('vehicles', 'id, plate, brand, model, vehicle_type, active').catch(() => [] as any[])),
      ]);
      // Avería pendiente → sugiere Parada (si fue «MÁQUINA PARADA») o Averiada.
      const averiaDe = new Map<string, string>();
      (averias as any[]).forEach((a) => {
        const prev = averiaDe.get(String(a.machinery_id));
        const esta = limpio(a.material) === 'MÁQUINA PARADA' ? 'Parada' : 'Averiada';
        if (prev !== 'Averiada') averiaDe.set(String(a.machinery_id), prev === 'Parada' && esta === 'Averiada' ? 'Averiada' : esta);
      });
      const filasMaq = (((maqs as any[]) ?? []).map((m) => ({
        id: String(m.id),
        code: limpio(m.code),
        marca: limpio(m.marca),
        modelo: limpio(m.modelo),
        clasificacion: limpio(m.clasificacion),
        serial: limpio(m.serial),
        plate: limpio(m.plate),
        empresa: limpio(m.company?.name),
        zona: limpio(m.location) || limpio(m.zona),
        encargado: limpio(m.encargado),
        // El mismo orden de prioridad del conteo de Equipos:
        estado: m.active === false ? 'Inactiva'
          : m.operational === false ? 'Retirada'
          : m.en_espera === true ? 'Esperando instrucciones'
          : averiaDe.get(String(m.id)) ?? 'Operativa',
        horometro: Number.isFinite(Number(m.last_horometro)) && Number(m.last_horometro) > 0 ? n2(m.last_horometro) : '',
        peso: Number.isFinite(Number(m.weight_ton)) && Number(m.weight_ton) > 0 ? `${n2(m.weight_ton)} t` : '',
        medidas: medidasFicha(m.height_m, m.length_m, m.width_m),
        nota: '',
      })) as FilaPersonalizada[]).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
      // El vehículo entra con el prefijo «veh-» en su clave local: así la
      // tarjeta sabe pintarle el 🚗 sin agregarle campos a la fila (que sigue
      // siendo puro texto editable, igual que la de una máquina).
      const filasVeh = ((((vehs as any[]) ?? []).map((v) => ({
        id: `veh-${String(v.id)}`,
        code: limpio(v.name) || limpio(v.plate),
        marca: limpio(v.brand),
        modelo: limpio(v.model),
        clasificacion: limpio(v.clasificacion) || limpio(v.vehicle_type),
        serial: limpio(v.serial),
        plate: limpio(v.plate),
        empresa: limpio(v.company?.name),
        zona: '',
        encargado: limpio(v.encargado),
        // Los vehículos no tienen «operational» ni averías de taller:
        estado: v.active === false ? 'Inactiva' : v.en_espera === true ? 'Esperando instrucciones' : 'Operativa',
        horometro: '',
        peso: '',
        medidas: '',
        nota: '',
      })) as FilaPersonalizada[])).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
      setCatalogo([...filasMaq, ...filasVeh]);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const enPapel = useMemo(() => new Set(filas.map((f) => f.id)), [filas]);
  const esVehiculo = (id: string) => id.startsWith('veh-');
  const coincidentes = useMemo(() => {
    const q = norm(busca);
    return catalogo.filter((m) =>
      (fuente === 'todos' || (fuente === 'veh') === esVehiculo(m.id))
      && (!q || norm(`${m.code} ${m.plate} ${m.serial} ${m.marca} ${m.modelo} ${m.clasificacion} ${m.empresa}`).includes(q)));
  }, [catalogo, busca, fuente]);

  // Quitar y reordenar: SIN tocar nada fuera de la tarjeta (es puro estado local).
  const agregar = (m: FilaPersonalizada) => setFilas((prev) => (prev.some((f) => f.id === m.id) ? prev : [...prev, { ...m }]));
  const quitar = (id: string) => setFilas((prev) => prev.filter((f) => f.id !== id));
  const mover = (i: number, dir: -1 | 1) => setFilas((prev) => {
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const copia = [...prev];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    return copia;
  });
  const editar = (id: string, campo: keyof FilaPersonalizada, valor: string) =>
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  const agregarManual = () => { setManuales((n) => n + 1); setFilas((prev) => [...prev, filaVacia(`manual-${manuales + 1}`)]); };
  const vaciar = () => {
    if (!confirmaVaciar) { setConfirmaVaciar(true); setTimeout(() => setConfirmaVaciar(false), 3000); return; }
    setConfirmaVaciar(false); setFilas([]);
  };

  const subtituloPapel = useMemo(() => {
    const partes = [conRango ? `Del ${dmyPersonalizado(desde)} al ${dmyPersonalizado(hasta)}` : '', limpio(subtitulo)].filter(Boolean);
    return partes.join(' · ');
  }, [conRango, desde, hasta, subtitulo]);

  const descargarPdf = async () => {
    setDescargando(true);
    try {
      const html = pdfDocument({
        title: limpio(titulo) || 'Reporte de maquinaria',
        subtitle: subtituloPapel,
        extraCss: CSS_REPORTE_PERSONALIZADO,
        logos,
        marcaTexto,
        // 📅 La fecha de emisión que eligió el usuario; si no sirve, la real.
        emitida: emitidaTexto(fechaEmision) || undefined,
        body: cuerpoReportePersonalizado({ filas, opciones, nota }),
      });
      await exportPdf(html, `Reporte personalizado ${sufijoArchivoPersonalizado(fechaEmision, opciones)}`.replace(/\//g, '-'));
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
  const campo = (f: FilaPersonalizada, k: keyof FilaPersonalizada, label: string, flex = 1) => (
    <View key={String(k)} style={{ flexGrow: flex, flexBasis: '30%', minWidth: 110 }}>
      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>{label}</Text>
      <TextInput
        value={f[k]}
        onChangeText={(v) => editar(f.id, k, v)}
        placeholder="—"
        placeholderTextColor={colors.muted}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 5, color: colors.text, fontSize: 12, backgroundColor: colors.surface }}
      />
    </View>
  );

  return (
    <View>
      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>🛠️ Reporte personalizado de maquinaria</Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.xs }}>
        {cargando ? 'Leyendo el catálogo…' : filas.length === 0 ? 'El papel está vacío: busca y agrega máquinas o vehículos abajo.' : `${filas.length} equipo(s) en el papel.`}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
        Taller de papel: el sistema te PRESTA los datos del catálogo (máquinas y vehículos) como punto de
        partida y de ahí todo es tuyo — agrega o quita equipos, corrige empresas, estados, fechas, lo que
        sea. Nada de lo que edites aquí se guarda ni toca el catálogo: al salir de la pantalla, el
        borrador se borra.
      </Text>
      {error ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>⚠️ {error}</Text> : null}

      {rotulo('📝 ENCABEZADO DEL PAPEL (todo editable)')}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        <View style={{ flexGrow: 1, flexBasis: '45%', minWidth: 160 }}>
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>Título</Text>
          <TextInput value={titulo} onChangeText={setTitulo} placeholder="Reporte de maquinaria" placeholderTextColor={colors.muted}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6, color: colors.text, fontSize: 13, backgroundColor: colors.surface }} />
        </View>
        <View style={{ flexGrow: 1, flexBasis: '45%', minWidth: 160 }}>
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>Subtítulo</Text>
          <TextInput value={subtitulo} onChangeText={setSubtitulo} placeholder="Reporte personalizado" placeholderTextColor={colors.muted}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6, color: colors.text, fontSize: 13, backgroundColor: colors.surface }} />
        </View>
      </View>
      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', marginTop: spacing.xs }}>Nota (sale debajo del resumen; vacía no sale)</Text>
      <TextInput value={nota} onChangeText={setNota} multiline placeholder="Ej.: Inventario levantado con el encargado de patio." placeholderTextColor={colors.muted}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6, color: colors.text, fontSize: 12, backgroundColor: colors.surface, minHeight: 40 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs, alignItems: 'flex-end' }}>
        <View>
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>Fecha de emisión (la línea «Emitida» del papel)</Text>
          <DateField value={fechaEmision} onChange={setFechaEmision} />
        </View>
      </View>
      <Toggle on={conRango} label={conRango ? 'Con rango de fechas en el subtítulo' : 'Sin rango de fechas (solo el subtítulo)'} onPress={() => setConRango((v) => !v)} />
      {conRango ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <View><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>Desde</Text><DateField value={desde} onChange={setDesde} /></View>
          <View><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>Hasta</Text><DateField value={hasta} onChange={setHasta} /></View>
        </View>
      ) : null}

      {rotulo('🚜 AGREGAR MÁQUINAS Y VEHÍCULOS DEL CATÁLOGO (toca para meter o sacar)')}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
        {pastilla('f-todos', 'Todos', fuente === 'todos', () => setFuente('todos'))}
        {pastilla('f-maq', '🚜 Máquinas', fuente === 'maq', () => setFuente('maq'))}
        {pastilla('f-veh', '🚗 Vehículos', fuente === 'veh', () => setFuente('veh'))}
      </View>
      <TextInput value={busca} onChangeText={setBusca} placeholder="🔎 Buscar por código, placa, serial, marca o empresa…" placeholderTextColor={colors.muted}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6, color: colors.text, fontSize: 13, backgroundColor: colors.surface }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
        {coincidentes.slice(0, MAX_PASTILLAS_CATALOGO).map((m) =>
          pastilla(m.id, `${enPapel.has(m.id) ? '✓ ' : ''}${esVehiculo(m.id) ? '🚗 ' : ''}${m.code || m.plate || m.serial || '—'}`, enPapel.has(m.id),
            () => (enPapel.has(m.id) ? quitar(m.id) : agregar(m))))}
      </View>
      {coincidentes.length > MAX_PASTILLAS_CATALOGO ? (
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>…y {coincidentes.length - MAX_PASTILLAS_CATALOGO} más: afina la búsqueda para verlas.</Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
        {pastilla('todas', `➕ Agregar las ${coincidentes.length} de la búsqueda`, false, () => coincidentes.forEach(agregar))}
        {pastilla('manual', '➕ Agregar fila manual (en blanco)', false, agregarManual)}
        {filas.length > 0 ? pastilla('vaciar', confirmaVaciar ? '⚠️ ¿Seguro? Toca otra vez' : '🧹 Vaciar el papel', confirmaVaciar, vaciar) : null}
      </View>

      {filas.length > 0 ? rotulo(`✏️ LAS ${filas.length} FILA(S) DEL PAPEL (toca cualquier celda y corrígela)`) : null}
      {filas.map((f, i) => (
        <View key={f.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs, backgroundColor: colors.surfaceAlt }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>{i + 1}. {esVehiculo(f.id) ? '🚗 ' : ''}{f.code || '(sin código)'}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {pastilla(`up${f.id}`, '↑', false, () => mover(i, -1))}
              {pastilla(`dn${f.id}`, '↓', false, () => mover(i, 1))}
              {pastilla(`rm${f.id}`, '✕ Quitar', false, () => quitar(f.id))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
            {campo(f, 'code', 'Código')}
            {campo(f, 'marca', 'Marca')}
            {campo(f, 'modelo', 'Modelo')}
            {campo(f, 'clasificacion', 'Clasificación')}
            {campo(f, 'serial', 'Serial')}
            {campo(f, 'plate', 'Placa')}
            {campo(f, 'empresa', 'Empresa')}
            {campo(f, 'zona', 'Zona / ubicación')}
            {campo(f, 'encargado', 'Encargado')}
            {campo(f, 'horometro', 'Horómetro')}
            {campo(f, 'peso', 'Peso')}
            {campo(f, 'medidas', 'Medidas')}
            {campo(f, 'nota', 'Nota de la fila', 2)}
          </View>
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', marginTop: spacing.xs }}>Estado (toca uno o escribe el tuyo)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 }}>
            {ESTADOS_PERSONALIZADO.map((e) => pastilla(`${f.id}-${e}`, e, f.estado === e, () => editar(f.id, 'estado', e)))}
          </View>
          <TextInput value={f.estado} onChangeText={(v) => editar(f.id, 'estado', v)} placeholder="Estado libre…" placeholderTextColor={colors.muted}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 5, color: colors.text, fontSize: 12, backgroundColor: colors.surface, marginTop: 4 }} />
        </View>
      ))}

      {rotulo('🖨️ ¿QUÉ SE OCULTA EN EL PAPEL?')}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {PASTILLAS_PERSONALIZADO.map((p) => pastilla('p' + p.key, p.chip, opciones[p.key], () => setOpciones((o) => alternarPersonalizado(o, p.key))))}
      </View>
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
        Encendida = NO sale (encargado, horómetro, peso, medidas, notas y el cuadro por empresa nacen ocultos: tócalos para INCLUIRLOS). {ocultosPersonalizadoEnPalabras(opciones)}
      </Text>

      {rotulo('🏷️ QUÉ LOGOS LLEVA EL MEMBRETE')}
      {LOGOS.map((l) => (
        <Toggle key={l.k} on={logos[l.k]} label={l.label} onPress={() => setLogos((p) => ({ ...p, [l.k]: !p[l.k] }))} />
      ))}
      <Toggle on={marcaTexto} label="Marca en texto «BCV / SOS La Guaira» (línea y pie)" onPress={() => setMarcaTexto((v) => !v)} />

      <TouchableOpacity
        disabled={descargando || cargando || filas.length === 0}
        onPress={descargarPdf}
        style={{ marginTop: spacing.sm, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', backgroundColor: descargando || cargando || filas.length === 0 ? colors.border : colors.brand }}>
        <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{descargando ? 'Armando el papel…' : '📄 Descargar el reporte (PDF)'}</Text>
      </TouchableOpacity>
    </View>
  );
}
