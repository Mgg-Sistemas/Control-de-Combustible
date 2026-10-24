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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useTable } from '../hooks/useTable';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { Machinery, Company } from '../types/database';
import { LogosConfig } from '../lib/notaEntrega';
import { autorizacionTrasladoHtml, AutorizacionTrasladoData } from '../lib/autorizacionTraslado';
import { exportPdf } from '../lib/pdf';
import { norm, cmpText } from '../lib/text';
import { caracasParts } from '../lib/jornada';
import {
  cargarTrasladosCompartidos,
  guardarTrasladoCompartido,
  eliminarTrasladoCompartido,
  TrasladoCompartido,
  STORAGE_TRASLADOS_COMPARTIDOS,
} from '../lib/actasYTrasladosDb';

export const STORAGE_KEY = STORAGE_TRASLADOS_COMPARTIDOS;
export type TrasladoRegistro = TrasladoCompartido;

function hoyDmy(): string {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day} / ${month} / ${year}`;
}

function generarFolio(contador: number): string {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const pad = String(contador).padStart(3, '0');
  return `AT-${year}-${day}${month}${pad}`;
}

export default function TrasladoMaquinariaScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const toast = useToast();
  const { role, canSee, fullName, session } = useAuth();
  const tienePermiso = role === 'admin' || canSee('traslados_maquinaria');

  const preselectedMachineId = route?.params?.machineId || null;
  const editTrasladoIdParam = route?.params?.editTrasladoId || null;

  // Datos de empresas y maquinaria desde Supabase
  const { data: companies, loading: loadingComp } = useTable<Company>('companies', { orderBy: 'name' });
  const { data: machineryList, loading: loadingMaq } = useTable<Machinery>('machinery', { orderBy: 'code' });

  // Pestaña activa: 'emitir' | 'historial'
  const [tab, setTab] = useState<'emitir' | 'historial'>('emitir');

  // Historial de traslados compartidos
  const [historico, setHistorico] = useState<TrasladoCompartido[]>([]);
  const [filtroHistorial, setFiltroHistorial] = useState('');
  const [cargandoHistorico, setCargandoHistorico] = useState(true);

  // Modo edición y eliminación
  const [editingTrasladoId, setEditingTrasladoId] = useState<string | null>(null);
  const [trasladoAEliminar, setTrasladoAEliminar] = useState<TrasladoCompartido | null>(null);
  const [eliminando, setEliminando] = useState(false);

  // Estados del Formulario:
  // 1. Membrete y Empresa
  const [empresaId, setEmpresaId] = useState<string>('');
  const [empresaLibre, setEmpresaLibre] = useState<string>('');
  const [empresaRif, setEmpresaRif] = useState<string>('');
  const [logos, setLogos] = useState<LogosConfig>({});

  // 2. Control y Fecha
  const [numeroControl, setNumeroControl] = useState('');
  const [fecha, setFecha] = useState(hoyDmy());

  // 3. Maquinaria seleccionada o escrita
  const [selectedMachine, setSelectedMachine] = useState<Machinery | null>(null);
  const [modalMaqOpen, setModalMaqOpen] = useState(false);
  const [busquedaMaq, setBusquedaMaq] = useState('');

  const [maqTipo, setMaqTipo] = useState('');
  const [maqMarca, setMaqMarca] = useState('');
  const [maqModelo, setMaqModelo] = useState('');
  const [maqAnio, setMaqAnio] = useState('');
  const [maqColor, setMaqColor] = useState('');
  const [maqSerial, setMaqSerial] = useState('');
  const [maqPlaca, setMaqPlaca] = useState('');
  const [maqPeso, setMaqPeso] = useState('');
  const [maqPotencia, setMaqPotencia] = useState('');
  const [maqCodigo, setMaqCodigo] = useState('');

  // 4. Origen y Destino
  const [origen, setOrigen] = useState('Camurí Chico / La Guaira');
  const [destino, setDestino] = useState('');

  // 5. Transporte y Chofer
  const [choferNombre, setChoferNombre] = useState('');
  const [choferCedula, setChoferCedula] = useState('');
  const [choferTelefono, setChoferTelefono] = useState('');
  const [vehiculoChuto, setVehiculoChuto] = useState('Chuto');
  const [placaChuto, setPlacaChuto] = useState('');
  const [vehiculoLowboy, setVehiculoLowboy] = useState('Lowboy');
  const [placaLowboy, setPlacaLowboy] = useState('');
  const [vigencia, setVigencia] = useState('');

  // 6. Estado del equipo al salir
  const [estadoOperativo, setEstadoOperativo] = useState(true);
  const [combustiblePct, setCombustiblePct] = useState('80');
  const [limpiezaAceptable, setLimpiezaAceptable] = useState(true);
  const [observaciones, setObservaciones] = useState('');

  // 7. Firmas
  const [autorizadoPor, setAutorizadoPor] = useState('');

  // 8. Servicio de Flete / Cobro (Opcional)
  const [aplicaServicio, setAplicaServicio] = useState(false);
  const [modalidadServicio, setModalidadServicio] = useState<'monto_fijo' | 'por_jornada' | 'traslado_interno'>('monto_fijo');
  const [montoFlete, setMontoFlete] = useState('');
  const [diasJornada, setDiasJornada] = useState('1');
  const [tarifaJornada, setTarifaJornada] = useState('');
  const [clienteProveedor, setClienteProveedor] = useState('');
  const [estadoPago, setEstadoPago] = useState<'pendiente' | 'cobrado' | 'pagado'>('pendiente');

  const [generandoPdf, setGenerandoPdf] = useState(false);

  // Cargar Historial compartido
  const cargarHistorico = async () => {
    try {
      setCargandoHistorico(true);
      const data = await cargarTrasladosCompartidos();
      setHistorico(data);
    } catch {
      // noop
    } finally {
      setCargandoHistorico(false);
    }
  };

  useEffect(() => {
    cargarHistorico();
  }, []);

  // Pre-generar número de control si está vacío y no estamos en edición
  useEffect(() => {
    if (!numeroControl && !editingTrasladoId) {
      setNumeroControl(generarFolio(historico.length + 1));
    }
  }, [historico.length, numeroControl, editingTrasladoId]);

  // Si se envió una máquina por parámetro (desde EquiposScreen), cargarla de una vez
  useEffect(() => {
    if (preselectedMachineId && machineryList.length > 0 && !selectedMachine && !editingTrasladoId) {
      const target = machineryList.find((m) => m.id === preselectedMachineId);
      if (target) {
        seleccionarMaquina(target);
      }
    }
  }, [preselectedMachineId, machineryList, selectedMachine, editingTrasladoId]);

  // Si se solicita editar un traslado específico por parámetro
  useEffect(() => {
    if (editTrasladoIdParam && historico.length > 0 && !editingTrasladoId) {
      const target = historico.find((t) => t.id === editTrasladoIdParam);
      if (target) {
        iniciarEdicion(target);
      }
    }
  }, [editTrasladoIdParam, historico, editingTrasladoId]);

  const iniciarEdicion = (item: TrasladoCompartido) => {
    setEditingTrasladoId(item.id);
    setNumeroControl(item.numeroControl); // Mantener folio original intacto
    const d: any = item.datos;
    setFecha(d?.fecha || hoyDmy());
    setEmpresaId(d?.empresaId || '');
    setEmpresaLibre(d?.empresaNombre || '');
    setEmpresaRif(d?.empresaRif || '');
    setLogos(d?.logos || {});

    const m = d?.maquinaria;
    setMaqTipo(m?.tipo || '');
    setMaqMarca(m?.marca || '');
    setMaqModelo(m?.modelo || '');
    setMaqAnio(m?.anio || '');
    setMaqColor(m?.color || '');
    setMaqSerial(m?.serial || '');
    setMaqPlaca(m?.placa || '');
    setMaqPeso(m?.peso || '');
    setMaqPotencia(m?.potencia || '');
    setMaqCodigo(m?.codigo || '');

    setOrigen(d?.origen || 'Camurí Chico / La Guaira');
    setDestino(d?.destino || '');

    const t = d?.transporte;
    setChoferNombre(t?.conductorNombre || '');
    setChoferCedula(t?.conductorCedula || '');
    setChoferTelefono(t?.conductorTelefono || '');
    setVehiculoChuto(t?.vehiculoChuto || 'Chuto');
    setPlacaChuto(t?.placaChuto || '');
    setVehiculoLowboy(t?.vehiculoLowboy || 'Lowboy');
    setPlacaLowboy(t?.placaLowboy || '');
    setVigencia(t?.vigencia || '');

    const est = d?.estadoEquipo;
    setEstadoOperativo(est?.operativo ?? true);
    setCombustiblePct(est?.nivelTanquePct ? String(est.nivelTanquePct) : '80');
    setLimpiezaAceptable(est?.limpio ?? true);
    setObservaciones(est?.observaciones || '');

    setAutorizadoPor(d?.firmas?.autorizadoPorNombre || '');

    if (d?.servicio) {
      setAplicaServicio(true);
      setModalidadServicio(d.servicio.modalidad || 'monto_fijo');
      setMontoFlete(d.servicio.monto ? String(d.servicio.monto) : '');
      setDiasJornada(d.servicio.jornadas ? String(d.servicio.jornadas) : '1');
      setTarifaJornada(d.servicio.tarifaJornada ? String(d.servicio.tarifaJornada) : '');
      setClienteProveedor(d.servicio.clienteOProveedor || '');
      setEstadoPago(d.servicio.estadoPago || 'pendiente');
    } else {
      setAplicaServicio(false);
    }

    if (item.machineryId && machineryList.length > 0) {
      const targetM = machineryList.find((maq) => maq.id === item.machineryId);
      if (targetM) setSelectedMachine(targetM);
    }

    setTab('emitir');
    toast.info(`Modo edición activado para traslado ${item.numeroControl}`);
  };

  const cancelarEdicion = () => {
    setEditingTrasladoId(null);
    setNumeroControl(generarFolio(historico.length + 1));
    setFecha(hoyDmy());
    setSelectedMachine(null);
    setMaqTipo('');
    setMaqMarca('');
    setMaqModelo('');
    setMaqSerial('');
    setMaqPlaca('');
    setDestino('');
    setChoferNombre('');
    setChoferCedula('');
    toast.info('Edición cancelada.');
  };

  const confirmarEliminarTraslado = (item: TrasladoCompartido) => {
    setTrasladoAEliminar(item);
  };

  const ejecutarEliminar = async () => {
    if (!trasladoAEliminar) return;
    try {
      setEliminando(true);
      await eliminarTrasladoCompartido(trasladoAEliminar.id, { id: session?.user?.id, name: fullName });
      toast.success(`Traslado ${trasladoAEliminar.numeroControl} eliminado correctamente.`);
      await cargarHistorico();
    } catch (e: any) {
      toast.error('Error al eliminar traslado: ' + (e?.message || 'Error'));
    } finally {
      setEliminando(false);
      setTrasladoAEliminar(null);
    }
  };

  // Si cambian las empresas, pre-seleccionar Liccione o Golden Touch
  useEffect(() => {
    if (!empresaId && companies.length > 0) {
      const liccione = companies.find((c) => /liccione/i.test(c.name));
      const golden = companies.find((c) => /golden/i.test(c.name));
      const first = liccione || golden || companies[0];
      if (first) {
        setEmpresaId(first.id);
        setEmpresaRif(first.rif || '');
        if (/golden/i.test(first.name)) {
          setLogos({ golden: true });
        }
      }
    }
  }, [companies, empresaId]);

  // Manejar cambio de empresa
  const onSelectEmpresa = (id: string) => {
    setEmpresaId(id);
    if (id === '__libre__') {
      setEmpresaLibre('');
      setEmpresaRif('');
      return;
    }
    const c = companies.find((comp) => comp.id === id);
    if (c) {
      setEmpresaLibre('');
      setEmpresaRif(c.rif || '');
      if (/golden/i.test(c.name)) {
        setLogos({ golden: true });
      } else if (/sos/i.test(c.name)) {
        setLogos({ sos: true });
      } else {
        setLogos({});
      }
    }
  };

  // Función para rellenar datos al tocar una máquina del selector
  const seleccionarMaquina = (m: Machinery) => {
    setSelectedMachine(m);
    setMaqCodigo(m.code || '');
    setMaqTipo(m.clasificacion || m.machinery_type || m.tipo || '');
    setMaqMarca(m.marca || '');
    setMaqModelo(m.modelo || '');
    setMaqAnio((m as any).year ? String((m as any).year) : '');
    setMaqColor((m as any).color || '');
    setMaqSerial(m.serial || '');
    setMaqPlaca(m.plate || '');
    setMaqPeso(m.weight_ton != null ? `${m.weight_ton * 1000} kg` : '');
    setMaqPotencia((m as any).power_hp != null ? `${(m as any).power_hp} HP` : '');
    setModalMaqOpen(false);
  };

  // Filtrado de máquinas: siempre muestra Código + PLACA + Buscador
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

  // Calcular monto final del flete si es por jornadas
  const totalFleteCalculado = useMemo(() => {
    if (modalidadServicio === 'monto_fijo') {
      return Number(montoFlete) || 0;
    }
    if (modalidadServicio === 'por_jornada') {
      const dias = Number(diasJornada) || 0;
      const tarifa = Number(tarifaJornada) || 0;
      return dias * tarifa;
    }
    return 0;
  }, [modalidadServicio, montoFlete, diasJornada, tarifaJornada]);

  // Construir objeto de datos para la Autorización
  const armarDatosDocumento = (): AutorizacionTrasladoData => {
    const compObj = companies.find((c) => c.id === empresaId);
    const nombreEmisora = empresaId === '__libre__' || !compObj
      ? (empresaLibre.trim() || 'CONSTRUCCIONES LICCIONE, C.A.')
      : compObj.name;
    const rifEmisora = empresaRif.trim() || compObj?.rif || null;

    return {
      numeroControl: numeroControl.trim() || generarFolio(historico.length + 1),
      fecha: fecha.trim() || hoyDmy(),
      empresaEmisora: {
        nombre: nombreEmisora,
        rif: rifEmisora,
      },
      logos,
      maquinaria: {
        codigo: maqCodigo.trim() || selectedMachine?.code || null,
        tipo: maqTipo.trim() || 'Maquinaria pesada',
        marca: maqMarca.trim() || '—',
        modelo: maqModelo.trim() || '—',
        anio: maqAnio.trim() || '—',
        color: maqColor.trim() || '—',
        serial: maqSerial.trim() || '—',
        placa: maqPlaca.trim() || '—',
        pesoOperativo: maqPeso.trim() || '—',
        potenciaMotor: maqPotencia.trim() || '—',
      },
      origen: origen.trim() || 'Patio',
      destino: destino.trim() || 'Destino de entrega',
      transporte: {
        conductorNombre: choferNombre.trim() || '—',
        conductorCedula: choferCedula.trim() || '—',
        vehiculoChuto: vehiculoChuto.trim() || 'Chuto',
        placaChuto: placaChuto.trim() || '—',
        vehiculoLowboy: vehiculoLowboy.trim() || 'Lowboy',
        placaLowboy: placaLowboy.trim() || '—',
        telefonoContacto: choferTelefono.trim() || '—',
        vigenciaTraslado: vigencia.trim() || '—',
      },
      estado: {
        operativo: estadoOperativo,
        inoperativo: !estadoOperativo,
        combustiblePct: combustiblePct.trim() || null,
        limpiezaAceptable,
        observacionesDanios: observaciones.trim() || null,
      },
      firmas: {
        autorizadoPorEmpresa: autorizadoPor.trim() || nombreEmisora,
        transportistaNombre: choferNombre.trim() || 'Transportista',
      },
      servicio: aplicaServicio
        ? {
            registraServicio: true,
            modalidad: modalidadServicio,
            monto: totalFleteCalculado,
            jornadas: modalidadServicio === 'por_jornada' ? Number(diasJornada) || 1 : null,
            tarifaJornada: modalidadServicio === 'por_jornada' ? Number(tarifaJornada) || null : null,
            moneda: 'USD',
            estadoPago,
            clienteOProveedor: clienteProveedor.trim() || null,
          }
        : null,
    };
  };

  // Guardar en el Historial compartido
  const guardarRegistro = async (datos: AutorizacionTrasladoData): Promise<TrasladoCompartido> => {
    const saved = await guardarTrasladoCompartido({
      id: editingTrasladoId || undefined,
      numeroControl: datos.numeroControl,
      machineryId: selectedMachine?.id || null,
      machineCode: selectedMachine?.code || maqCodigo || maqTipo,
      machinePlate: maqPlaca || selectedMachine?.plate,
      tipoOperacion: aplicaServicio ? 'servicio_flete' : 'salida_simple',
      datos,
      user: { id: session?.user?.id, name: fullName },
    });
    await cargarHistorico();
    return saved;
  };

  // Generar e Imprimir PDF
  const emitirEImprimir = async () => {
    if (!origen.trim()) {
      toast.error('Indica el lugar de origen.');
      return;
    }
    if (!destino.trim()) {
      toast.error('Indica el lugar de destino.');
      return;
    }
    if (!choferNombre.trim()) {
      toast.error('Indica el nombre del conductor o transportista.');
      return;
    }

    try {
      setGenerandoPdf(true);
      const datos = armarDatosDocumento();
      const html = autorizacionTrasladoHtml(datos);

      // Guardar en historial compartido
      await guardarRegistro(datos);

      // Abrir PDF
      await exportPdf(html, `Autorizacion-Traslado-${datos.numeroControl}`);
      toast.success(editingTrasladoId ? 'Autorización de Traslado actualizada con éxito.' : 'Autorización de Traslado generada con éxito.');

      if (editingTrasladoId) {
        setEditingTrasladoId(null);
      }
      // Generar nuevo folio para la siguiente
      setNumeroControl(generarFolio(historico.length + 2));
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo generar la autorización.');
    } finally {
      setGenerandoPdf(false);
    }
  };

  // Reimprimir desde el historial
  const reimprimir = async (item: TrasladoCompartido) => {
    try {
      const html = autorizacionTrasladoHtml(item.datos || item);
      await exportPdf(html, `Autorizacion-Traslado-${item.numeroControl}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Error al reimprimir la autorización.');
    }
  };

  // Filtrado de Historial
  const historicoFiltrado = useMemo(() => {
    const q = norm(filtroHistorial.trim());
    if (!q) return historico;
    return historico.filter((it) => {
      const m = it.datos?.maquinaria;
      const t = it.datos?.transporte;
      const texto = [
        it.numeroControl,
        m?.codigo,
        m?.placa,
        m?.tipo,
        m?.marca,
        m?.modelo,
        it.datos?.destino,
        it.datos?.origen,
        t?.conductorNombre,
        t?.placaChuto,
        t?.placaLowboy,
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
            Este módulo es de acceso exclusivo para administradores o personal con permiso explícito en Traslados y Salidas de Maquinaria.
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
          <SectionTitle>🚜 Traslados y Salidas de Maquinaria</SectionTitle>
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
            Emisión de salvoconductos y orden de movilización física, control de retiros de patio y fletes.
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
            📄 Emitir Autorización
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

      {/* VISTA 1: EMITIR AUTORIZACIÓN */}
      {tab === 'emitir' && (
        <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {/* BANNER DE MODO EDICIÓN */}
          {editingTrasladoId && (
            <View style={{ backgroundColor: '#DBEAFE', borderColor: '#1E3A8A', borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1, paddingRight: spacing.xs }}>
                <Text style={{ color: '#1E3A8A', fontWeight: '800', fontSize: 13.5 }}>
                  ✏️ Modo Edición: Traslado {numeroControl}
                </Text>
                <Text style={{ color: '#1E40AF', fontSize: 11, marginTop: 1 }}>
                  Al guardar, se actualizarán los datos y quedará registrado que lo editaste tú ({fullName || 'Usuario'}).
                </Text>
              </View>
              <TouchableOpacity
                onPress={cancelarEdicion}
                style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#1E3A8A', paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.sm }}
              >
                <Text style={{ color: '#1E3A8A', fontWeight: '700', fontSize: 11 }}>✕ Cancelar</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* BLOQUE A: EMPRESA EMISORA Y LOGOS */}
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14.5, marginBottom: spacing.xs }}>
              🏢 Empresa Emisora del Documento
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              Selecciona cuál empresa autoriza el tránsito o escribe una libre.
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
              {companies.map((c) => {
                const sel = empresaId === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => onSelectEmpresa(c.id)}
                    style={{
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      borderRadius: radius.pill,
                      backgroundColor: sel ? colors.brand : colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: sel ? colors.brand : colors.border,
                    }}
                  >
                    <Text style={{ color: sel ? colors.brandContrast : colors.text, fontWeight: sel ? '800' : '600', fontSize: 12 }}>
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                onPress={() => onSelectEmpresa('__libre__')}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: radius.pill,
                  backgroundColor: empresaId === '__libre__' ? colors.brand : colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: empresaId === '__libre__' ? colors.brand : colors.border,
                }}
              >
                <Text style={{ color: empresaId === '__libre__' ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
                  ✏️ Otra empresa libre…
                </Text>
              </TouchableOpacity>
            </View>

            {empresaId === '__libre__' && (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                <TextInput
                  value={empresaLibre}
                  onChangeText={setEmpresaLibre}
                  placeholder="Nombre de la empresa…"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { flex: 2, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                />
                <TextInput
                  value={empresaRif}
                  onChangeText={setEmpresaRif}
                  placeholder="RIF (ej. J-12345678-9)"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { flex: 1, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                />
              </View>
            )}

            {/* Selector de Logos */}
            <View style={{ marginTop: spacing.xs }}>
              <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: 4 }}>
                🏷️ Logos en el encabezado:
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {[
                  { key: 'golden' as const, label: '✨ Golden Touch' },
                  { key: 'sos' as const, label: '🛟 SOS La Guaira' },
                  { key: 'renace' as const, label: '🇻🇪 Ven. Renace' },
                  { key: 'jhenzaen' as const, label: '🏗️ Jhenzaen' },
                  { key: 'bcv' as const, label: '🏦 BCV' },
                ].map((l) => {
                  const on = !!logos[l.key];
                  return (
                    <TouchableOpacity
                      key={l.key}
                      onPress={() => setLogos({ ...logos, [l.key]: !on })}
                      style={{
                        paddingVertical: 4,
                        paddingHorizontal: 10,
                        borderRadius: radius.pill,
                        backgroundColor: on ? '#1E3A8A' : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: on ? '#1E3A8A' : colors.border,
                      }}
                    >
                      <Text style={{ color: on ? '#fff' : colors.text, fontSize: 11.5, fontWeight: on ? '700' : '500' }}>
                        {l.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  onPress={() => setLogos({})}
                  style={{
                    paddingVertical: 4,
                    paddingHorizontal: 10,
                    borderRadius: radius.pill,
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.muted, fontSize: 11.5, fontWeight: '700' }}>
                    ✕ Quitar todos (Sin logo)
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Card>

          {/* BLOQUE B: CONTROL Y FECHA */}
          <Card>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12, marginBottom: 4 }}>
                  Nº de Control
                </Text>
                <TextInput
                  value={numeroControl}
                  onChangeText={setNumeroControl}
                  placeholder="AT-2026-XXXX"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12, marginBottom: 4 }}>
                  Fecha de Emisión
                </Text>
                <TextInput
                  value={fecha}
                  onChangeText={setFecha}
                  placeholder="DD / MM / AAAA"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                />
              </View>
            </View>
          </Card>

          {/* BLOQUE 1: IDENTIFICACIÓN DE LA MAQUINARIA */}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14.5 }}>
                🚜 1. Identificación de la Maquinaria
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
                : 'Puedes seleccionar una del sistema o completar los datos a mano.'}
            </Text>

            <View style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Equipo / Tipo:</Text>
                  <TextInput
                    value={maqTipo}
                    onChangeText={setMaqTipo}
                    placeholder="Minishover, Excavadora, etc."
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Marca:</Text>
                  <TextInput
                    value={maqMarca}
                    onChangeText={setMaqMarca}
                    placeholder="Lovol, Caterpillar, etc."
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Modelo:</Text>
                  <TextInput
                    value={maqModelo}
                    onChangeText={setMaqModelo}
                    placeholder="FSL75, 320D, etc."
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Año:</Text>
                  <TextInput
                    value={maqAnio}
                    onChangeText={setMaqAnio}
                    placeholder="2025"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Color:</Text>
                  <TextInput
                    value={maqColor}
                    onChangeText={setMaqColor}
                    placeholder="Amarillo / Negro"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Serial / Chasis:</Text>
                  <TextInput
                    value={maqSerial}
                    onChangeText={setMaqSerial}
                    placeholder="CLW09L58VSH000104"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>⭐ PLACA DE LA MAQUINARIA:</Text>
                  <TextInput
                    value={maqPlaca}
                    onChangeText={setMaqPlaca}
                    placeholder="Ej. A97BE9P"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.brand, borderWidth: 1.5, color: colors.text, backgroundColor: colors.surface, fontWeight: '700' }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Peso Operativo:</Text>
                  <TextInput
                    value={maqPeso}
                    onChangeText={setMaqPeso}
                    placeholder="3.500 kg"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Potencia de motor:</Text>
                  <TextInput
                    value={maqPotencia}
                    onChangeText={setMaqPotencia}
                    placeholder="55KW"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Código interno:</Text>
                  <TextInput
                    value={maqCodigo}
                    onChangeText={setMaqCodigo}
                    placeholder="MIN-01"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>
            </View>
          </Card>

          {/* BLOQUE 2: ORIGEN Y DESTINO */}
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14.5, marginBottom: spacing.xs }}>
              📍 2. Datos de Origen y Destino
            </Text>
            <View style={{ gap: spacing.xs }}>
              <View>
                <Text style={styles.lbl}>Lugar de Origen:</Text>
                <TextInput
                  value={origen}
                  onChangeText={setOrigen}
                  placeholder="Camurí Chico / La Guaira"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                />
              </View>
              <View>
                <Text style={styles.lbl}>Lugar de Destino:</Text>
                <TextInput
                  value={destino}
                  onChangeText={setDestino}
                  placeholder="Puerto Ordaz / Estado Bolívar"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                />
              </View>
            </View>
          </Card>

          {/* BLOQUE 3: TRANSPORTE Y CHOFER */}
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14.5, marginBottom: spacing.xs }}>
              🚛 3. Empresa de Transporte y Conductor
            </Text>
            <View style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1.2 }}>
                  <Text style={styles.lbl}>Nombre Conductor:</Text>
                  <TextInput
                    value={choferNombre}
                    onChangeText={setChoferNombre}
                    placeholder="José Gregorio Gómez"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 0.8 }}>
                  <Text style={styles.lbl}>C.I. Conductor:</Text>
                  <TextInput
                    value={choferCedula}
                    onChangeText={setChoferCedula}
                    placeholder="V-11.683.953"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Vehículo / Chuto:</Text>
                  <TextInput
                    value={vehiculoChuto}
                    onChangeText={setVehiculoChuto}
                    placeholder="Chuto"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>⭐ Placa Chuto:</Text>
                  <TextInput
                    value={placaChuto}
                    onChangeText={setPlacaChuto}
                    placeholder="A22CY0J"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Batea / Lowboy:</Text>
                  <TextInput
                    value={vehiculoLowboy}
                    onChangeText={setVehiculoLowboy}
                    placeholder="Lowboy"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>⭐ Placa Lowboy / Batea:</Text>
                  <TextInput
                    value={placaLowboy}
                    onChangeText={setPlacaLowboy}
                    placeholder="A97BE9P"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Teléfono Contacto:</Text>
                  <TextInput
                    value={choferTelefono}
                    onChangeText={setChoferTelefono}
                    placeholder="0426-4902690"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbl}>Vigencia Traslado:</Text>
                  <TextInput
                    value={vigencia}
                    onChangeText={setVigencia}
                    placeholder="Del 17/9 al 23/9"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>
            </View>
          </Card>

          {/* BLOQUE 4: ESTADO DEL EQUIPO AL SALIR */}
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14.5, marginBottom: spacing.xs }}>
              ⚙️ 4. Estado del Equipo al Momento de Salida
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.xs }}>
              <TouchableOpacity
                onPress={() => setEstadoOperativo(true)}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: radius.md,
                  backgroundColor: estadoOperativo ? '#16A34A' : colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: estadoOperativo ? '#16A34A' : colors.border,
                }}
              >
                <Text style={{ color: estadoOperativo ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>
                  {estadoOperativo ? '☑ Operativo' : '☐ Operativo'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setEstadoOperativo(false)}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: radius.md,
                  backgroundColor: !estadoOperativo ? '#DC2626' : colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: !estadoOperativo ? '#DC2626' : colors.border,
                }}
              >
                <Text style={{ color: !estadoOperativo ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>
                  {!estadoOperativo ? '☑ Inoperativo / Averiado' : '☐ Inoperativo / Averiado'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setLimpiezaAceptable(!limpiezaAceptable)}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: radius.md,
                  backgroundColor: limpiezaAceptable ? '#2563EB' : colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: limpiezaAceptable ? '#2563EB' : colors.border,
                }}
              >
                <Text style={{ color: limpiezaAceptable ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>
                  {limpiezaAceptable ? '☑ Limpieza Aceptable' : '☐ Limpieza Aceptable'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginVertical: spacing.xs }}>
              <Text style={styles.lbl}>Combustible (%) al salir:</Text>
              <TextInput
                value={combustiblePct}
                onChangeText={setCombustiblePct}
                placeholder="75"
                keyboardType="numeric"
                placeholderTextColor={colors.muted}
                style={[styles.input, { width: 120, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
              />
            </View>

            <View style={{ marginTop: spacing.xs }}>
              <Text style={styles.lbl}>Observaciones / Daños Preexistentes:</Text>
              <TextInput
                value={observaciones}
                onChangeText={setObservaciones}
                placeholder="Sin daños reportados, pintura aceptable, etc."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={2}
                style={[styles.input, { height: 60, textAlignVertical: 'top', borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
              />
            </View>
          </Card>

          {/* BLOQUE OPCIONAL: REGISTRO DE SERVICIO / FLETE */}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1, paddingRight: spacing.sm }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
                  💰 ¿Prestamos nosotros el servicio de transporte?
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>
                  Si vino un tercero a retirarla, déjalo desactivado (solo salida física). Si cobras o pagas por este flete, actívalo.
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => setAplicaServicio(!aplicaServicio)}
                style={{
                  backgroundColor: aplicaServicio ? colors.brand : colors.surfaceAlt,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: aplicaServicio ? colors.brand : colors.border,
                }}
              >
                <Text style={{ color: aplicaServicio ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>
                  {aplicaServicio ? '✓ Servicio activo' : '✕ No aplica'}
                </Text>
              </TouchableOpacity>
            </View>

            {aplicaServicio && (
              <View style={{ marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm }}>
                <Text style={styles.lbl}>Modalidad de Cobro / Pago:</Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  {[
                    { key: 'monto_fijo' as const, label: '💵 Monto Fijo ($)' },
                    { key: 'por_jornada' as const, label: '⏱️ Por Jornada (Días × $)' },
                    { key: 'traslado_interno' as const, label: '🏢 Traslado Interno' },
                  ].map((m) => {
                    const sel = modalidadServicio === m.key;
                    return (
                      <TouchableOpacity
                        key={m.key}
                        onPress={() => setModalidadServicio(m.key)}
                        style={{
                          flex: 1,
                          paddingVertical: 6,
                          alignItems: 'center',
                          borderRadius: radius.md,
                          backgroundColor: sel ? colors.brand : colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: sel ? colors.brand : colors.border,
                        }}
                      >
                        <Text style={{ color: sel ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>
                          {m.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {modalidadServicio === 'monto_fijo' && (
                  <View>
                    <Text style={styles.lbl}>Monto total del flete ($ USD):</Text>
                    <TextInput
                      value={montoFlete}
                      onChangeText={setMontoFlete}
                      placeholder="Ej. 1200"
                      keyboardType="numeric"
                      placeholderTextColor={colors.muted}
                      style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                    />
                  </View>
                )}

                {modalidadServicio === 'por_jornada' && (
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lbl}>Cantidad de Jornadas (Días):</Text>
                      <TextInput
                        value={diasJornada}
                        onChangeText={setDiasJornada}
                        placeholder="1"
                        keyboardType="numeric"
                        placeholderTextColor={colors.muted}
                        style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lbl}>Tarifa por Jornada ($):</Text>
                      <TextInput
                        value={tarifaJornada}
                        onChangeText={setTarifaJornada}
                        placeholder="Ej. 400"
                        keyboardType="numeric"
                        placeholderTextColor={colors.muted}
                        style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                      />
                    </View>
                  </View>
                )}

                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1.2 }}>
                    <Text style={styles.lbl}>Cliente / Obra a quien se le factura:</Text>
                    <TextInput
                      value={clienteProveedor}
                      onChangeText={setClienteProveedor}
                      placeholder="Empresa o proyecto..."
                      placeholderTextColor={colors.muted}
                      style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                    />
                  </View>
                  <View style={{ flex: 0.8 }}>
                    <Text style={styles.lbl}>Estado de Cobro:</Text>
                    <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                      <TouchableOpacity
                        onPress={() => setEstadoPago('pendiente')}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 8,
                          borderRadius: radius.sm,
                          backgroundColor: estadoPago === 'pendiente' ? '#F59E0B' : colors.surfaceAlt,
                        }}
                      >
                        <Text style={{ color: estadoPago === 'pendiente' ? '#fff' : colors.text, fontSize: 11, fontWeight: '700' }}>
                          Pendiente
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setEstadoPago('cobrado')}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 8,
                          borderRadius: radius.sm,
                          backgroundColor: estadoPago === 'cobrado' ? '#16A34A' : colors.surfaceAlt,
                        }}
                      >
                        <Text style={{ color: estadoPago === 'cobrado' ? '#fff' : colors.text, fontSize: 11, fontWeight: '700' }}>
                          Cobrado
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                <View style={{ backgroundColor: colors.surfaceAlt, padding: spacing.sm, borderRadius: radius.md, marginTop: 4 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                    Total Flete: ${totalFleteCalculado.toLocaleString()} USD
                  </Text>
                </View>
              </View>
            )}
          </Card>

          {/* BOTÓN PRINCIPAL: EMITIR E IMPRIMIR */}
          <TouchableOpacity
            onPress={emitirEImprimir}
            disabled={generandoPdf}
            activeOpacity={0.8}
            style={{
              backgroundColor: '#1E3A8A',
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
                  🖨️ Generar e Imprimir Autorización (PDF)
                </Text>
                <Text style={{ color: '#BFDBFE', fontSize: 12, marginTop: 2 }}>
                  Crea el documento oficial con salvoconducto y guarda en historial
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* VISTA 2: HISTORIAL DE TRASLADOS */}
      {tab === 'historial' && (
        <View style={{ flex: 1, gap: spacing.sm }}>
          <TextInput
            value={filtroHistorial}
            onChangeText={setFiltroHistorial}
            placeholder="🔎 Buscar por máquina (código/placa), chofer, destino o control..."
            placeholderTextColor={colors.muted}
            style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
          />

          {cargandoHistorico ? (
            <Loading />
          ) : historicoFiltrado.length === 0 ? (
            <EmptyState
              title="Sin traslados registrados"
              subtitle={
                filtroHistorial
                  ? 'No hay registros que coincidan con la búsqueda.'
                  : 'Las autorizaciones de traslado que generes aparecerán aquí para consultarlas o reimprimirlas.'
              }
            />
          ) : (
            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
              {historicoFiltrado.map((it) => {
                const m = it.datos?.maquinaria || (it as any).maquinaria;
                const t = it.datos?.transporte || (it as any).transporte;
                const esFlete = it.tipoOperacion === 'servicio_flete';
                const serv = it.datos?.servicio || (it as any).servicio;
                return (
                  <Card key={it.id}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                          🚜 {m?.codigo || 'Equipo'} · {m?.tipo || ''}
                        </Text>
                        <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12.5, marginTop: 2 }}>
                          ⭐ Placa: {m?.placa || 'Sin placa'} · Serial: {m?.serial || '—'}
                        </Text>
                      </View>

                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>
                          {it.numeroControl}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>
                          {it.datos?.fecha || (it as any).fecha || ''}
                        </Text>
                      </View>
                    </View>

                    <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.xs }} />

                    <View style={{ gap: 2 }}>
                      <Text style={{ color: colors.text, fontSize: 12 }}>
                        <b>Ruta:</b> {it.datos?.origen || (it as any).origen} ➔ {it.datos?.destino || (it as any).destino}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        <b>Transporte:</b> {t?.conductorNombre || '—'} · Chuto: {t?.placaChuto || '—'} · Lowboy: {t?.placaLowboy || '—'}
                      </Text>
                      {esFlete && serv ? (
                        <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700', marginTop: 2 }}>
                          💰 Flete: ${serv.monto?.toLocaleString() || 0} USD ({serv.estadoPago?.toUpperCase() || 'PENDIENTE'})
                        </Text>
                      ) : (
                        <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                          📦 Salida / Retiro simple de patio
                        </Text>
                      )}
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
                        onPress={() => confirmarEliminarTraslado(it)}
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
                          backgroundColor: '#1E3A8A',
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
      <Modal visible={!!trasladoAEliminar} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxWidth: 420 }]}>
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 16, marginBottom: spacing.xs }}>
              🗑️ ¿Eliminar Autorización de Traslado?
            </Text>
            <Text style={{ color: colors.text, fontSize: 13, marginBottom: spacing.sm, lineHeight: 19 }}>
              ¿Estás seguro de eliminar el traslado <Text style={{ fontWeight: '800' }}>{trasladoAEliminar?.numeroControl}</Text>?
              {'\n\n'}
              Se mantendrá registrado en la auditoría que fue eliminado por <Text style={{ fontWeight: '700' }}>{fullName || 'tu usuario'}</Text>.
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity
                onPress={() => setTrasladoAEliminar(null)}
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
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Eliminar Traslado</Text>
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
    fontSize: 11.5,
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
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
