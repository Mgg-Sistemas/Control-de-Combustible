import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useTable } from '../hooks/useTable';
import { useToast } from '../components/ToastProvider';
import { Machinery } from '../types/database';
import { useAuth } from '../context/AuthContext';
import {
  actaRecepcionHtml,
  ActaRecepcionData,
  ChecklistItem,
  FotoRecepcion,
} from '../lib/actaRecepcionEquipo';
import { exportPdf } from '../lib/pdf';
import { norm, cmpText } from '../lib/text';
import {
  cargarActasCompartidas,
  guardarActaCompartida,
  eliminarActaCompartida,
  ActaCompartida,
  STORAGE_ACTAS_COMPARTIDAS,
} from '../lib/actasYTrasladosDb';

export const STORAGE_ACTAS_KEY = STORAGE_ACTAS_COMPARTIDAS;
export type ActaRegistro = ActaCompartida;

const CHECKLIST_DEFAULT: ChecklistItem[] = [
  { item: 'Placa de Identificación / Serial (PIN)', estado: 'CONFORME', observaciones: 'Legible, fija en chasis' },
  { item: 'Estructura Principal y Pluma (Boom)', estado: 'OPERATIVO', observaciones: 'Estructura íntegra, desgaste normal de pintura por uso' },
  { item: 'Tren de Rodaje / Orugas y Cadenas', estado: 'OPERATIVO', observaciones: 'Zapatas y tejas alineadas, fijadas con cadenas de amarre para traslado' },
  { item: 'Sistema Hidráulico y Cilindros', estado: 'OPERATIVO', observaciones: 'Mangueras instaladas, sin fugas activas visibles al momento de descarga' },
  { item: 'Cabina del Operador y Panel de Control', estado: 'CONFORME', observaciones: 'Panel digital encendido registrando horas. Cristal intacto.' },
  { item: 'Aseguramiento de Carga en Lowboy', estado: 'CONFORME', observaciones: 'Amarrado con cadenas y tensores normativos de transporte pesado' },
];

const ESTADOS_OPTS = ['OPERATIVO', 'CONFORME', 'REGULAR', 'PENDIENTE', 'AVERÍA', 'NO APLICA'];

function hoyFechaHora(): { fecha: string; hora: string } {
  const d = new Date();
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const day = d.getDate();
  const month = meses[d.getMonth()];
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return {
    fecha: `${day} de ${month}, ${year}`,
    hora: `${hh}:${mm} hrs`,
  };
}

function generarCodigoActa(contador: number): string {
  const year = new Date().getFullYear();
  const pad = String(contador).padStart(3, '0');
  return `AR-EQ-${year}-${pad}`;
}

export default function ActaRecepcionScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const toast = useToast();
  const { role, canSee, fullName, session } = useAuth();
  const tienePermiso = role === 'admin' || canSee('actas_recepcion');

  const preselectedMachineId = route?.params?.machineId || null;
  const editActaIdParam = route?.params?.editActaId || null;

  const { data: machineryList, loading: loadingMaq } = useTable<Machinery>('machinery', { orderBy: 'code' });

  const [tab, setTab] = useState<'emitir' | 'historial'>('emitir');
  const [historico, setHistorico] = useState<ActaCompartida[]>([]);
  const [filtroHistorial, setFiltroHistorial] = useState('');
  const [cargandoHistorico, setCargandoHistorico] = useState(true);

  // Modo edición y eliminación
  const [editingActaId, setEditingActaId] = useState<string | null>(null);
  const [actaAEliminar, setActaAEliminar] = useState<ActaCompartida | null>(null);
  const [eliminando, setEliminando] = useState(false);

  // Metadatos
  const [codigo, setCodigo] = useState('');
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');
  const [departamento, setDepartamento] = useState('DEPARTAMENTO DE MAQUINARIA Y EQUIPO PESADO');

  // Selección de Maquinaria
  const [selectedMachine, setSelectedMachine] = useState<Machinery | null>(null);
  const [modalMaqOpen, setModalMaqOpen] = useState(false);
  const [busquedaMaq, setBusquedaMaq] = useState('');

  // Campos de Datos Generales
  const [equipoTipo, setEquipoTipo] = useState('');
  const [fabricante, setFabricante] = useState('CNH America LLC (Made in Japan)');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [serialPin, setSerialPin] = useState('');
  const [placa, setPlaca] = useState('');
  const [horometro, setHorometro] = useState('');
  const [ubicacionRecepcion, setUbicacionRecepcion] = useState('Patio Central / Zona de Descarga');
  const [modoTransporte, setModoTransporte] = useState('Lowboy / Batea de Transporte');
  const [entregadoPor, setEntregadoPor] = useState('');
  const [recibidoPor, setRecibidoPor] = useState('');

  // Visibilidad configurable (activar o quitar campos a gusto)
  const [mostrarChofer, setMostrarChofer] = useState(true);
  const [mostrarInspector, setMostrarInspector] = useState(true);
  const [mostrarFabricante, setMostrarFabricante] = useState(true);
  const [mostrarHorometro, setMostrarHorometro] = useState(true);
  const [mostrarTransporte, setMostrarTransporte] = useState(true);

  // Checklist dinámico (agregar / quitar componentes)
  const [checklist, setChecklist] = useState<ChecklistItem[]>(CHECKLIST_DEFAULT);
  const [nuevoItemNombre, setNuevoItemNombre] = useState('');

  // Observaciones generales
  const [observaciones, setObservaciones] = useState(
    'El equipo ingresa transportado en lowboy a patio. Se verifica correspondencia del número de serie/PIN y placa con la documentación presentada. Se autoriza la descarga al patio de almacenamiento/mantenimiento.'
  );

  // Fotos de evidencia
  const [fotos, setFotos] = useState<FotoRecepcion[]>([]);
  const [generandoPdf, setGenerandoPdf] = useState(false);

  // Cargar histórico de actas (compartido con Supabase y respaldo local)
  const cargarHistorico = async () => {
    try {
      setCargandoHistorico(true);
      const data = await cargarActasCompartidas();
      setHistorico(data);
    } catch {
      // noop
    } finally {
      setCargandoHistorico(false);
    }
  };

  useEffect(() => {
    cargarHistorico();
    const { fecha: f, hora: h } = hoyFechaHora();
    setFecha(f);
    setHora(h);
  }, []);

  useEffect(() => {
    if (!codigo && !editingActaId) {
      setCodigo(generarCodigoActa(historico.length + 1));
    }
  }, [historico.length, codigo, editingActaId]);

  // Si viene una máquina precargada por parámetro de navegación
  useEffect(() => {
    if (preselectedMachineId && machineryList.length > 0 && !selectedMachine && !editingActaId) {
      const target = machineryList.find((m) => m.id === preselectedMachineId);
      if (target) {
        seleccionarMaquina(target);
      }
    }
  }, [preselectedMachineId, machineryList, selectedMachine, editingActaId]);

  // Si viene una edición solicitada por parámetro
  useEffect(() => {
    if (editActaIdParam && historico.length > 0 && !editingActaId) {
      const target = historico.find((a) => a.id === editActaIdParam);
      if (target) {
        iniciarEdicion(target);
      }
    }
  }, [editActaIdParam, historico, editingActaId]);

  const iniciarEdicion = (item: ActaCompartida) => {
    setEditingActaId(item.id);
    setCodigo(item.codigo);
    const d = item.datos;
    const dg = d?.datosGenerales;
    setFecha(d?.fecha || hoyFechaHora().fecha);
    setHora(d?.hora || hoyFechaHora().hora);
    setDepartamento(d?.departamento || 'DEPARTAMENTO DE MAQUINARIA Y EQUIPO PESADO');
    setEquipoTipo(dg?.equipo || '');
    setFabricante(dg?.fabricante || 'CNH America LLC (Made in Japan)');
    setMarca(dg?.marca || '');
    setModelo(dg?.modelo || '');
    setSerialPin(dg?.serialPin || '');
    setPlaca(dg?.placa || '');
    setHorometro(dg?.horometro || '');
    setUbicacionRecepcion(dg?.ubicacionRecepcion || 'Patio Central / Zona de Descarga');
    setModoTransporte(dg?.modoTransporte || 'Lowboy / Batea de Transporte');
    setEntregadoPor(dg?.entregadoPor || '');
    setRecibidoPor(dg?.recibidoPor || '');
    if (d?.visibilidad) {
      setMostrarChofer(d.visibilidad.mostrarChofer ?? true);
      setMostrarInspector(d.visibilidad.mostrarInspector ?? true);
      setMostrarFabricante(d.visibilidad.mostrarFabricante ?? true);
      setMostrarHorometro(d.visibilidad.mostrarHorometro ?? true);
      setMostrarTransporte(d.visibilidad.mostrarTransporte ?? true);
    }
    setChecklist(d?.checklist?.length ? d.checklist : CHECKLIST_DEFAULT);
    setObservaciones(d?.observacionesGenerales || '');
    setFotos(d?.fotos || []);
    if (item.machineryId && machineryList.length > 0) {
      const targetM = machineryList.find((m) => m.id === item.machineryId);
      if (targetM) setSelectedMachine(targetM);
    }
    setTab('emitir');
    toast.info(`Modo edición activado para el acta ${item.codigo}`);
  };

  const cancelarEdicion = () => {
    setEditingActaId(null);
    setCodigo(generarCodigoActa(historico.length + 1));
    const { fecha: f, hora: h } = hoyFechaHora();
    setFecha(f);
    setHora(h);
    setSelectedMachine(null);
    setEquipoTipo('');
    setMarca('');
    setModelo('');
    setSerialPin('');
    setPlaca('');
    setHorometro('');
    setEntregadoPor('');
    setRecibidoPor('');
    setChecklist(CHECKLIST_DEFAULT);
    setFotos([]);
    toast.info('Edición cancelada.');
  };

  const confirmarEliminarActa = (item: ActaCompartida) => {
    setActaAEliminar(item);
  };

  const ejecutarEliminar = async () => {
    if (!actaAEliminar) return;
    try {
      setEliminando(true);
      await eliminarActaCompartida(actaAEliminar.id, { id: session?.user?.id, name: fullName });
      toast.success(`Acta ${actaAEliminar.codigo} eliminada correctamente.`);
      await cargarHistorico();
    } catch (e: any) {
      toast.error('Error al eliminar acta: ' + (e?.message || 'Error'));
    } finally {
      setEliminando(false);
      setActaAEliminar(null);
    }
  };

  const seleccionarMaquina = (m: Machinery) => {
    setSelectedMachine(m);
    setEquipoTipo(m.clasificacion || m.machinery_type || m.tipo || 'Maquinaria pesada');
    setMarca(m.marca || '');
    setModelo(m.modelo || '');
    setSerialPin(m.serial || '');
    setPlaca(m.plate || '');
    setHorometro(m.last_horometro != null ? `${m.last_horometro.toLocaleString()} Horas` : '');
    setModalMaqOpen(false);
  };

  // Buscador de maquinaria: Código + PLACA + Buscador
  const maquinasFiltradas = useMemo(() => {
    const q = norm(busquedaMaq.trim());
    const list = machineryList.filter((m) => m.active !== false);
    if (!q) return [...list].sort((a, b) => cmpText(a.code, b.code));
    return list
      .filter((m) => {
        const text = [m.code, m.plate, m.serial, m.marca, m.modelo, m.clasificacion, m.tipo].filter(Boolean).join(' ');
        return norm(text).includes(q);
      })
      .sort((a, b) => cmpText(a.code, b.code));
  }, [machineryList, busquedaMaq]);

  // Manejo de Checklist dinámico
  const agregarComponenteChecklist = () => {
    if (!nuevoItemNombre.trim()) {
      toast.error('Indica el nombre del componente o item a inspeccionar.');
      return;
    }
    const nuevo: ChecklistItem = {
      id: `chk_${Date.now()}`,
      item: nuevoItemNombre.trim(),
      estado: 'OPERATIVO',
      observaciones: 'Inspeccionado conforme.',
    };
    setChecklist([...checklist, nuevo]);
    setNuevoItemNombre('');
    toast.success('Componente agregado al checklist.');
  };

  const eliminarComponenteChecklist = (index: number) => {
    const copia = [...checklist];
    copia.splice(index, 1);
    setChecklist(copia);
  };

  const actualizarItemChecklist = (index: number, patch: Partial<ChecklistItem>) => {
    const copia = [...checklist];
    copia[index] = { ...copia[index], ...patch };
    setChecklist(copia);
  };

  // Manejo de Fotos (Anexo Fotográfico)
  const tomarOAdjuntarFoto = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.6,
        base64: true,
      });

      if (!res.canceled && res.assets && res.assets[0]) {
        const asset = res.assets[0];
        const uri = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
        const defaultTitulo = `Evidencia Fotográfica ${fotos.length + 1}`;
        setFotos([...fotos, { uri, titulo: defaultTitulo }]);
        toast.success('Foto agregada al anexo fotográfico.');
      }
    } catch (e: any) {
      toast.error('No se pudo cargar la foto: ' + (e?.message || 'Error'));
    }
  };

  const eliminarFoto = (index: number) => {
    const copia = [...fotos];
    copia.splice(index, 1);
    setFotos(copia);
  };

  const actualizarTituloFoto = (index: number, titulo: string) => {
    const copia = [...fotos];
    copia[index] = { ...copia[index], titulo };
    setFotos(copia);
  };

  // Armar datos del acta
  const armarDatosActa = (): ActaRecepcionData => {
    const equipoModeloHeader = `${marca.trim()} ${modelo.trim()}`.trim() || equipoTipo.trim() || 'MAQUINARIA';
    return {
      codigo: codigo.trim() || generarCodigoActa(historico.length + 1),
      fecha: fecha.trim() || hoyFechaHora().fecha,
      hora: hora.trim() || hoyFechaHora().hora,
      departamento: departamento.trim(),
      equipoModeloHeader,
      pinSerialHeader: serialPin.trim() || '—',
      placaHeader: placa.trim() || null,
      horometroHeader: horometro.trim() || '—',
      datosGenerales: {
        equipo: equipoTipo.trim() || '—',
        fabricante: fabricante.trim() || '—',
        marca: marca.trim() || '—',
        modelo: modelo.trim() || '—',
        serialPin: serialPin.trim() || '—',
        placa: placa.trim() || '—',
        horometro: horometro.trim() || '—',
        ubicacionRecepcion: ubicacionRecepcion.trim() || 'Patio Central',
        modoTransporte: modoTransporte.trim() || 'Lowboy',
        entregadoPor: entregadoPor.trim() || 'Transportista',
        recibidoPor: recibidoPor.trim() || 'Inspector de Patio',
      },
      visibilidad: {
        mostrarChofer,
        mostrarInspector,
        mostrarFabricante,
        mostrarHorometro,
        mostrarTransporte,
      },
      checklist,
      observacionesGenerales: observaciones.trim() || null,
      firmas: {
        entregadoPorNombre: entregadoPor.trim() || 'Transporte / Proveedor',
        recibidoPorNombre: recibidoPor.trim() || 'Inspector / Recepción',
      },
      fotos,
    };
  };

  // Guardar en el Historial compartido
  const guardarRegistro = async (datos: ActaRecepcionData): Promise<ActaCompartida> => {
    const saved = await guardarActaCompartida({
      id: editingActaId || undefined,
      codigo: datos.codigo,
      machineryId: selectedMachine?.id || null,
      machineCode: selectedMachine?.code || equipoTipo,
      machinePlate: placa || selectedMachine?.plate,
      datos,
      user: { id: session?.user?.id, name: fullName },
    });
    await cargarHistorico();
    return saved;
  };

  // Generar e Imprimir PDF
  const emitirEImprimir = async () => {
    if (!equipoTipo.trim() && !marca.trim()) {
      toast.error('Indica el tipo o marca del equipo.');
      return;
    }

    try {
      setGenerandoPdf(true);
      const datos = armarDatosActa();
      const html = actaRecepcionHtml(datos);

      // Guardar en historial compartido
      await guardarRegistro(datos);

      // Abrir PDF
      await exportPdf(html, `Acta-Recepcion-${datos.codigo}`);
      toast.success(editingActaId ? 'Acta de Recepción actualizada con éxito.' : 'Acta de Recepción generada e impresa con éxito.');

      if (editingActaId) {
        setEditingActaId(null);
      }
      // Generar nuevo código para la siguiente
      setCodigo(generarCodigoActa(historico.length + 2));
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo generar el acta.');
    } finally {
      setGenerandoPdf(false);
    }
  };

  // Reimprimir
  const reimprimir = async (item: ActaCompartida) => {
    try {
      const html = actaRecepcionHtml(item.datos || item);
      await exportPdf(html, `Acta-Recepcion-${item.codigo}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Error al reimprimir el acta.');
    }
  };

  // Filtrado de Historial
  const historicoFiltrado = useMemo(() => {
    const q = norm(filtroHistorial.trim());
    if (!q) return historico;
    return historico.filter((it) => {
      const dg = it.datos?.datosGenerales;
      const texto = [
        it.codigo,
        dg?.equipo,
        dg?.marca,
        dg?.modelo,
        dg?.serialPin,
        dg?.placa,
        dg?.entregadoPor,
        dg?.recibidoPor,
        it.datos?.observacionesGenerales,
        it.createdByName,
        it.updatedByName,
      ]
        .filter(Boolean)
        .join(' ');
      return norm(texto).includes(q);
    });
  }, [historico, filtroHistorial]);

  if (!tienePermiso) {
    return (
      <Screen>
        <Card style={{ marginTop: spacing.xl, padding: spacing.lg, alignItems: 'center' }}>
          <Text style={{ fontSize: 36, marginBottom: spacing.sm }}>🔒</Text>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, marginBottom: spacing.xs, textAlign: 'center' }}>
            Acceso Restringido
          </Text>
          <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginBottom: spacing.md, lineHeight: 18 }}>
            Este módulo es de acceso exclusivo para administradores o personal con permiso explícito en Actas de Recepción.
          </Text>
          <TouchableOpacity
            onPress={() => {
              if (navigation?.canGoBack?.()) navigation.goBack();
              else navigation.navigate('More');
            }}
            style={{ backgroundColor: colors.brand, paddingVertical: 10, paddingHorizontal: 20, borderRadius: radius.md }}
          >
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>← Volver</Text>
          </TouchableOpacity>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ marginBottom: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1, paddingRight: spacing.sm }}>
          <SectionTitle>📋 Acta de Recepción de Equipo</SectionTitle>
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
            Inspección inicial física, checklist de componentes, horómetro de llegada y anexo fotográfico.
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            if (navigation?.canGoBack?.()) navigation.goBack();
            else navigation.navigate('Equipos');
          }}
          style={{
            paddingVertical: 6,
            paddingHorizontal: 12,
            backgroundColor: colors.surfaceAlt,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>← Volver</Text>
        </TouchableOpacity>
      </View>

      {/* Selector de Pestañas: EMITIR vs HISTORIAL */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <TouchableOpacity
          onPress={() => setTab('emitir')}
          style={{
            flex: 1,
            paddingVertical: spacing.sm + 2,
            backgroundColor: tab === 'emitir' ? colors.brand : colors.surfaceAlt,
            borderRadius: radius.md,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: tab === 'emitir' ? colors.brand : colors.border,
          }}
        >
          <Text style={{ color: tab === 'emitir' ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13.5 }}>
            📄 Nueva Acta de Recepción
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setTab('historial')}
          style={{
            flex: 1,
            paddingVertical: spacing.sm + 2,
            backgroundColor: tab === 'historial' ? colors.brand : colors.surfaceAlt,
            borderRadius: radius.md,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: tab === 'historial' ? colors.brand : colors.border,
          }}
        >
          <Text style={{ color: tab === 'historial' ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13.5 }}>
            📋 Historial ({historico.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* VISTA 1: EMITIR ACTA */}
      {tab === 'emitir' && (
        <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {/* BANNER DE MODO EDICIÓN */}
          {editingActaId && (
            <View style={{ backgroundColor: '#FEF3C7', borderColor: '#B45309', borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1, paddingRight: spacing.xs }}>
                <Text style={{ color: '#92400E', fontWeight: '800', fontSize: 13.5 }}>
                  ✏️ Modo Edición: Acta {codigo}
                </Text>
                <Text style={{ color: '#B45309', fontSize: 11, marginTop: 1 }}>
                  Al guardar, se actualizarán los datos y quedará registrado que lo editaste tú ({fullName || 'Usuario'}).
                </Text>
              </View>
              <TouchableOpacity
                onPress={cancelarEdicion}
                style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#B45309', paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.sm }}
              >
                <Text style={{ color: '#B45309', fontWeight: '700', fontSize: 11 }}>✕ Cancelar</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* CABECERA Y METADATOS */}
          <Card>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1.2 }}>
                <Text style={styles.lbl}>Código del Acta:</Text>
                <TextInput
                  value={codigo}
                  onChangeText={setCodigo}
                  placeholder="AR-EQ-2026-XXX"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.lbl}>Fecha:</Text>
                <TextInput
                  value={fecha}
                  onChangeText={setFecha}
                  placeholder="DD de Mes, AAAA"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                />
              </View>
              <View style={{ flex: 0.8 }}>
                <Text style={styles.lbl}>Hora:</Text>
                <TextInput
                  value={hora}
                  onChangeText={setHora}
                  placeholder="HH:MM hrs"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                />
              </View>
            </View>

            <View style={{ marginTop: spacing.xs }}>
              <Text style={styles.lbl}>Departamento Emisor:</Text>
              <TextInput
                value={departamento}
                onChangeText={setDepartamento}
                placeholder="Departamento..."
                placeholderTextColor={colors.muted}
                style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
              />
            </View>
          </Card>

          {/* 1. DATOS GENERALES DEL EQUIPO */}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14.5 }}>
                🚜 1. Datos Generales del Equipo
              </Text>
              <TouchableOpacity
                onPress={() => setModalMaqOpen(true)}
                style={{
                  backgroundColor: colors.brand,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: radius.md,
                }}
              >
                <Text style={{ color: colors.brandContrast, fontWeight: '700', fontSize: 12 }}>
                  🔎 Seleccionar del Catálogo
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              {selectedMachine
                ? `Cargada: ${selectedMachine.code} · Placa: ${selectedMachine.plate || 'Sin placa'} · ${selectedMachine.marca || ''} ${selectedMachine.modelo || ''}`
                : 'Completa los datos de recepción o selecciona una máquina del catálogo.'}
            </Text>

            <View style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Equipo / Tipo:</Text>
                  <TextInput
                    value={equipoTipo}
                    onChangeText={setEquipoTipo}
                    placeholder="Excavadora de Cadenas"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Fabricante / Origen:</Text>
                  <TextInput
                    value={fabricante}
                    onChangeText={setFabricante}
                    placeholder="CNH America LLC (Made in Japan)"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Marca:</Text>
                  <TextInput
                    value={marca}
                    onChangeText={setMarca}
                    placeholder="CASE, CAT, Komatsu..."
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Modelo / Tipo:</Text>
                  <TextInput
                    value={modelo}
                    onChangeText={setModelo}
                    placeholder="CX330, 320D..."
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Serial / PIN:</Text>
                  <TextInput
                    value={serialPin}
                    onChangeText={setSerialPin}
                    placeholder="DAC331342"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>⭐ PLACA DE LA MAQUINARIA:</Text>
                  <TextInput
                    value={placa}
                    onChangeText={setPlaca}
                    placeholder="Ej. A97BE9P"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.brand, borderWidth: 1.5, color: colors.text, backgroundColor: colors.surface, fontWeight: '700' }]}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Horómetro de Llegada:</Text>
                  <TextInput
                    value={horometro}
                    onChangeText={setHorometro}
                    placeholder="8317.4 Horas"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Modo de Transporte:</Text>
                  <TextInput
                    value={modoTransporte}
                    onChangeText={setModoTransporte}
                    placeholder="Lowboy / Batea de Transporte"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>

              <View>
                <Text style={styles.lbl}>Ubicación de Recepción / Patio:</Text>
                <TextInput
                  value={ubicacionRecepcion}
                  onChangeText={setUbicacionRecepcion}
                  placeholder="Patio Central / Zona de Descarga"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                />
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Entregado Por (Transportista/Chofer):</Text>
                  <TextInput
                    value={entregadoPor}
                    onChangeText={setEntregadoPor}
                    placeholder="Nombre del Transportista / Empresa"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Recibido Por (Inspector/Receptor):</Text>
                  <TextInput
                    value={recibidoPor}
                    onChangeText={setRecibidoPor}
                    placeholder="Nombre del Inspector / Receptor"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>
            </View>

            {/* Configurar Visibilidad: Colocar o quitar campos a gusto */}
            <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ color: colors.muted, fontSize: 11.5, fontWeight: '700', marginBottom: 4 }}>
                ⚙️ Ajustar qué campos salen en el formato:
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {[
                  { label: 'Chofer / Transportista', val: mostrarChofer, set: setMostrarChofer },
                  { label: 'Inspector / Receptor', val: mostrarInspector, set: setMostrarInspector },
                  { label: 'Fabricante', val: mostrarFabricante, set: setMostrarFabricante },
                  { label: 'Horómetro', val: mostrarHorometro, set: setMostrarHorometro },
                  { label: 'Modo Transporte', val: mostrarTransporte, set: setMostrarTransporte },
                ].map((f) => (
                  <TouchableOpacity
                    key={f.label}
                    onPress={() => f.set(!f.val)}
                    style={{
                      paddingVertical: 4,
                      paddingHorizontal: 10,
                      borderRadius: radius.pill,
                      backgroundColor: f.val ? '#1E3A8A' : colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: f.val ? '#1E3A8A' : colors.border,
                    }}
                  >
                    <Text style={{ color: f.val ? '#fff' : colors.muted, fontSize: 11, fontWeight: '700' }}>
                      {f.val ? `✓ ${f.label}` : `✕ Sin ${f.label}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </Card>

          {/* 2. CHECKLIST DINÁMICO */}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14.5 }}>
                🔍 2. Lista de Verificación (Checklist Inicial)
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {checklist.length} componentes
              </Text>
            </View>

            <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: spacing.sm }}>
              Puedes agregar nuevos componentes, cambiar su estado, editar las observaciones o eliminar los que no apliquen.
            </Text>

            {/* Lista de Items del Checklist */}
            <View style={{ gap: spacing.sm }}>
              {checklist.map((c, i) => (
                <View
                  key={c.id || i}
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    padding: spacing.sm,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, flex: 1 }}>
                      #{i + 1} {c.item}
                    </Text>
                    <TouchableOpacity onPress={() => eliminarComponenteChecklist(i)}>
                      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>✕ Quitar</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Selector de Estado */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginVertical: 6 }}>
                    {ESTADOS_OPTS.map((est) => {
                      const sel = c.estado.toUpperCase() === est;
                      let bg = sel ? '#1E3A8A' : colors.surface;
                      let txt = sel ? '#fff' : colors.text;
                      if (sel && (est === 'CONFORME' || est === 'OPERATIVO')) bg = '#16A34A';
                      if (sel && (est === 'AVERÍA')) bg = '#DC2626';
                      if (sel && (est === 'REGULAR' || est === 'PENDIENTE')) bg = '#D97706';
                      return (
                        <TouchableOpacity
                          key={est}
                          onPress={() => actualizarItemChecklist(i, { estado: est })}
                          style={{
                            paddingVertical: 3,
                            paddingHorizontal: 8,
                            borderRadius: radius.sm,
                            backgroundColor: bg,
                            borderWidth: 1,
                            borderColor: sel ? bg : colors.border,
                          }}
                        >
                          <Text style={{ color: txt, fontSize: 10.5, fontWeight: '700' }}>
                            {est}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <TextInput
                    value={c.observaciones || ''}
                    onChangeText={(txt) => actualizarItemChecklist(i, { observaciones: txt })}
                    placeholder="Observaciones de este componente..."
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface, fontSize: 12, paddingVertical: 4 }]}
                  />
                </View>
              ))}
            </View>

            {/* Agregar nuevo componente */}
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
              <TextInput
                value={nuevoItemNombre}
                onChangeText={setNuevoItemNombre}
                placeholder="Nombre de nuevo componente (ej. Extintor, Luces...)"
                placeholderTextColor={colors.muted}
                style={[styles.input, { flex: 1, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
              />
              <TouchableOpacity
                onPress={agregarComponenteChecklist}
                style={{
                  backgroundColor: colors.brand,
                  paddingHorizontal: 14,
                  justifyContent: 'center',
                  borderRadius: radius.md,
                }}
              >
                <Text style={{ color: colors.brandContrast, fontWeight: '700', fontSize: 12 }}>
                  + Agregar
                </Text>
              </TouchableOpacity>
            </View>
          </Card>

          {/* 3. OBSERVACIONES GENERALES */}
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14.5, marginBottom: spacing.xs }}>
              📝 3. Observaciones y Comentarios de Recepción
            </Text>
            <TextInput
              value={observaciones}
              onChangeText={setObservaciones}
              placeholder="Detalle de recepción, hora de llegada, condiciones generales..."
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              style={[styles.input, { height: 75, textAlignVertical: 'top', borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
            />
          </Card>

          {/* 4. ANEXO FOTOGRÁFICO */}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <View>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14.5 }}>
                  📷 4. Evidencia Fotográfica (Anexo Página 2)
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {fotos.length} foto(s) agregada(s)
                </Text>
              </View>

              <TouchableOpacity
                onPress={tomarOAdjuntarFoto}
                style={{
                  backgroundColor: '#1E3A8A',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: radius.md,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                  📷 + Adjuntar Foto
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: spacing.sm }}>
              Fotos de la placa, horómetro, pluma, rodaje o amarre. Aparecerán ordenadas en la página 2 del acta.
            </Text>

            {fotos.length === 0 ? (
              <View style={{ padding: spacing.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Sin fotos adjuntas. (Si no agregas fotos, el documento saldrá en 1 sola página limpia).
                </Text>
              </View>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {fotos.map((f, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: 'row',
                      gap: spacing.sm,
                      backgroundColor: colors.surfaceAlt,
                      padding: spacing.xs,
                      borderRadius: radius.md,
                      alignItems: 'center',
                    }}
                  >
                    <Image source={{ uri: f.uri }} style={{ width: 60, height: 60, borderRadius: 4 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lbl}>Pie de foto / Descripción:</Text>
                      <TextInput
                        value={f.titulo || ''}
                        onChangeText={(txt) => actualizarTituloFoto(i, txt)}
                        placeholder="Ej. Placa de Identificación / Horómetro..."
                        placeholderTextColor={colors.muted}
                        style={[styles.input, { fontSize: 12, paddingVertical: 4, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                      />
                    </View>
                    <TouchableOpacity onPress={() => eliminarFoto(i)} style={{ paddingHorizontal: 6 }}>
                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 16 }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </Card>

          {/* BOTÓN PRINCIPAL: GENERAR E IMPRIMIR ACTA */}
          <TouchableOpacity
            onPress={emitirEImprimir}
            disabled={generandoPdf}
            activeOpacity={0.8}
            style={{
              backgroundColor: '#B45309',
              paddingVertical: spacing.md,
              borderRadius: radius.lg,
              alignItems: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.2,
              shadowRadius: 4,
            }}
          >
            {generandoPdf ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
                  🖨️ Generar e Imprimir Acta de Recepción (PDF)
                </Text>
                <Text style={{ color: '#FEF3C7', fontSize: 12, marginTop: 2 }}>
                  Guarda en la documentación del equipo y abre el PDF oficial
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* VISTA 2: HISTORIAL DE ACTAS */}
      {tab === 'historial' && (
        <View style={{ flex: 1, gap: spacing.sm }}>
          <TextInput
            value={filtroHistorial}
            onChangeText={setFiltroHistorial}
            placeholder="🔎 Buscar por código, máquina (placa/serial), inspector o transportista..."
            placeholderTextColor={colors.muted}
            style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
          />

          {cargandoHistorico ? (
            <Loading />
          ) : historicoFiltrado.length === 0 ? (
            <EmptyState
              title="Sin actas registradas"
              subtitle={
                filtroHistorial
                  ? 'No hay actas que coincidan con la búsqueda.'
                  : 'Las actas de recepción que generes aparecerán aquí y en la ficha de cada equipo.'
              }
            />
          ) : (
            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
              {historicoFiltrado.map((it) => {
                const dg = it.datos?.datosGenerales || (it as any).datosGenerales || {};
                return (
                  <Card key={it.id}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                          🚜 {dg.marca} {dg.modelo} · {dg.equipo}
                        </Text>
                        <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12.5, marginTop: 2 }}>
                          ⭐ Placa: {dg.placa || 'Sin placa'} · PIN/Serial: {dg.serialPin || '—'}
                        </Text>
                      </View>

                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: '#B45309', fontSize: 12, fontWeight: '800' }}>
                          {it.codigo}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>
                          {it.datos?.fecha || (it as any).fecha || ''}
                        </Text>
                      </View>
                    </View>

                    <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.xs }} />

                    <View style={{ gap: 2 }}>
                      <Text style={{ color: colors.text, fontSize: 12 }}>
                        <b>Horómetro:</b> {dg.horometro || '—'} &nbsp;·&nbsp; <b>Transporte:</b> {dg.modoTransporte || '—'}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        <b>Entregó:</b> {dg.entregadoPor || '—'} &nbsp;·&nbsp; <b>Recibió:</b> {dg.recibidoPor || '—'}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                        🔍 {it.datos?.checklist?.length || 0} componentes verificados &nbsp;·&nbsp; 📷 {it.datos?.fotos?.length || 0} fotos en anexo
                      </Text>
                    </View>

                    {/* AUDITORÍA COMPARTIDA */}
                    <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: 8, marginTop: spacing.xs, gap: 2, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>
                        👤 <Text style={{ fontWeight: '700', color: colors.text }}>Creado por:</Text> {it.createdByName || 'Personal'} · {it.createdAt ? new Date(it.createdAt).toLocaleDateString() : '—'}
                      </Text>
                      {it.updatedAt ? (
                        <Text style={{ color: colors.brand, fontSize: 11 }}>
                          ✏️ <Text style={{ fontWeight: '700' }}>Última edición:</Text> {it.updatedByName || 'Usuario'} · {new Date(it.updatedAt).toLocaleDateString()} {new Date(it.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      ) : null}
                    </View>

                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                      <TouchableOpacity
                        onPress={() => iniciarEdicion(it)}
                        style={{
                          backgroundColor: colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: colors.border,
                          paddingVertical: 6,
                          paddingHorizontal: 12,
                          borderRadius: radius.md,
                        }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                          ✏️ Editar
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => confirmarEliminarActa(it)}
                        style={{
                          backgroundColor: colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: colors.danger,
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: radius.md,
                        }}
                      >
                        <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>
                          🗑️ Eliminar
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => reimprimir(it)}
                        style={{
                          backgroundColor: '#B45309',
                          paddingVertical: 6,
                          paddingHorizontal: 12,
                          borderRadius: radius.md,
                        }}
                      >
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                          🧾 Reimprimir (PDF)
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </Card>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}

      {/* MODAL SELECTOR DE MAQUINARIA (Regla: Código + PLACA + Buscador) */}
      <Modal visible={modalMaqOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>
                🚜 Seleccionar Maquinaria
              </Text>
              <TouchableOpacity onPress={() => setModalMaqOpen(false)}>
                <Text style={{ color: colors.muted, fontSize: 20, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              value={busquedaMaq}
              onChangeText={setBusquedaMaq}
              placeholder="🔎 Buscar por código, placa, serial, marca o modelo..."
              placeholderTextColor={colors.muted}
              style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surfaceAlt, marginBottom: spacing.sm }]}
            />

            <ScrollView style={{ maxHeight: 380 }}>
              {maquinasFiltradas.length === 0 ? (
                <EmptyState title="Sin resultados" subtitle="No se encontró maquinaria con ese criterio." />
              ) : (
                maquinasFiltradas.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => seleccionarMaquina(m)}
                    style={{
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.md,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
                      🚜 {m.code}
                    </Text>
                    <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12, marginTop: 1 }}>
                      ⭐ Placa: {m.plate || 'Sin placa'}
                      {m.serial ? ` · Serial: ${m.serial}` : ''}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 1 }}>
                      {[m.clasificacion || m.tipo, m.marca, m.modelo].filter(Boolean).join(' · ')}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <TouchableOpacity
              onPress={() => setModalMaqOpen(false)}
              style={{
                marginTop: spacing.md,
                paddingVertical: spacing.sm,
                alignItems: 'center',
                backgroundColor: colors.surfaceAlt,
                borderRadius: radius.md,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL DE CONFIRMACIÓN DE ELIMINACIÓN */}
      <Modal visible={!!actaAEliminar} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxWidth: 420 }]}>
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 16, marginBottom: spacing.xs }}>
              🗑️ ¿Eliminar Acta de Recepción?
            </Text>
            <Text style={{ color: colors.text, fontSize: 13, marginBottom: spacing.sm, lineHeight: 19 }}>
              ¿Estás seguro de eliminar el acta <Text style={{ fontWeight: '800' }}>{actaAEliminar?.codigo}</Text>?
              {'\n\n'}
              Se mantendrá registrado en la auditoría que fue eliminada por <Text style={{ fontWeight: '700' }}>{fullName || 'tu usuario'}</Text>.
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity
                onPress={() => setActaAEliminar(null)}
                disabled={eliminando}
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={ejecutarEliminar}
                disabled={eliminando}
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.danger }}
              >
                {eliminando ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Eliminar Acta</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
  },
  lbl: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    marginBottom: 3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: radius.lg,
    padding: spacing.md,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
