import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useTable } from '../../hooks/useTable';
import { Tank, TankLevel, Machinery, Vehicle, Dispatch, FuelIntake, Transfer } from '../../types/database';
import { takePhotoAndUpload, pickPhotoFromGalleryAndUpload } from '../../lib/photo';
import PhotoSourceSheet from '../PhotoSourceSheet';
import {
  contadorFinalPropuesto,
  horasTrabajadas,
  errorHorometro,
  mermaDeRecepcion,
  compartirPorWhatsapp,
  DatosMensajeCombustible,
} from '../../lib/fuelRules';
import { exportarJornadaSurtidorPdf, FilaDespachoSurtidorPdf } from '../../lib/combustiblePdf';
import { useToast } from '../ToastProvider';
import { norm, cmpText } from '../../lib/text';

interface SurtidorMovilProps {
  onClose?: () => void;
  isStandalone?: boolean;
}

const fmtNum = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });

const todayIso = () => new Date().toISOString().slice(0, 10);
const nowTime = () =>
  new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });

export default function SurtidorMovil({ onClose, isStandalone = false }: SurtidorMovilProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const { fullName, session } = useAuth();
  const currentUserName = fullName || session?.user?.email || 'Operador de combustible';

  // 1. Datos principales
  const { data: tanks, loading: loadingTanks, refetch: refetchTanks } = useTable<Tank>('tanks', {
    realtimeFrom: ['tanks', 'stock_movements', 'dispatches', 'fuel_intakes', 'transfers'],
  });
  const { data: tankLevels, refetch: refetchLevels } = useTable<TankLevel>('tank_levels', {
    realtimeFrom: ['stock_movements', 'tanks', 'dispatches', 'fuel_intakes', 'transfers'],
  });
  const { data: machineryList } = useTable<Machinery>('machinery', {
    realtimeFrom: ['machinery'],
    orderBy: 'code',
  });
  const { data: vehiclesList } = useTable<Vehicle>('vehicles', {
    realtimeFrom: ['vehicles'],
    orderBy: 'plate',
  });
  const { data: dispatches, refetch: refetchDispatches } = useTable<Dispatch>('dispatches', {
    realtimeFrom: ['dispatches'],
    orderBy: 'created_at',
    ascending: false,
  });

  // Tanque activo seleccionado
  const [selectedTankId, setSelectedTankId] = useState<string>('');

  const activeTanks = useMemo(() => {
    return (tanks || []).filter((t) => t.active !== false);
  }, [tanks]);

  useEffect(() => {
    if (!selectedTankId && activeTanks.length > 0) {
      setSelectedTankId(activeTanks[0].id);
    }
  }, [activeTanks, selectedTankId]);

  const selectedTank = useMemo(() => {
    return activeTanks.find((t) => t.id === selectedTankId) || activeTanks[0] || null;
  }, [activeTanks, selectedTankId]);

  const selectedTankLevel = useMemo(() => {
    if (!selectedTank) return null;
    return (tankLevels || []).find((l) => l.id === selectedTank.id) || null;
  }, [tankLevels, selectedTank]);

  // Movimientos recientes del tanque actual (últimos 10)
  const tankDispatches = useMemo(() => {
    if (!selectedTank) return [];
    return (dispatches || [])
      .filter((d) => d.tank_id === selectedTank.id)
      .slice(0, 10);
  }, [dispatches, selectedTank]);

  // Estado para los formularios modales
  const [modalMode, setModalMode] = useState<'ninguno' | 'surtir' | 'traslado' | 'entrada'>('ninguno');
  const [viewDetailMov, setViewDetailMov] = useState<Dispatch | null>(null);

  // Formulario de Surtido a Equipo
  const [targetType, setTargetType] = useState<'maquinaria' | 'vehiculo'>('maquinaria');
  const [searchEquipQuery, setSearchEquipQuery] = useState('');
  const [selectedMachine, setSelectedMachine] = useState<Machinery | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [liters, setLiters] = useState('');
  const [pricePerLiter, setPricePerLiter] = useState('');
  const [hi, setHi] = useState('');
  const [hf, setHf] = useState('');
  const [km, setKm] = useState('');
  const [ci, setCi] = useState('');
  const [cf, setCf] = useState('');
  const [autorizadoPor, setAutorizadoPor] = useState('');
  const [nota, setNota] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Formulario de Traslado
  const [toTankId, setToTankId] = useState('');
  const [transferLiters, setTransferLiters] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferCi, setTransferCi] = useState('');
  const [transferCf, setTransferCf] = useState('');

  // Formulario de Entrada
  const [intakeSupplier, setIntakeSupplier] = useState('PDVSA');
  const [intakeGuideLiters, setIntakeGuideLiters] = useState('');
  const [intakeRealLiters, setIntakeRealLiters] = useState('');
  const [intakeInvoiceNo, setIntakeInvoiceNo] = useState('');
  const [intakeNotes, setIntakeNotes] = useState('');

  // Reporte móvil de jornada
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportDate, setReportDate] = useState(todayIso());
  const [generatingReport, setGeneratingReport] = useState(false);

  // Último contador registrado en el tanque seleccionado
  useEffect(() => {
    if (!selectedTank) return;
    const lastWithCounter = (dispatches || []).find(
      (d) => d.tank_id === selectedTank.id && (d.fuel_end != null || d.fuel_start != null)
    );
    if (lastWithCounter?.fuel_end != null) {
      setCi(String(lastWithCounter.fuel_end));
      setTransferCi(String(lastWithCounter.fuel_end));
    } else {
      setCi('');
      setTransferCi('');
    }
  }, [selectedTank, dispatches]);

  // Selección de maquinaria: precargar último horómetro y placa
  const handleSelectMachine = (m: Machinery) => {
    setSelectedMachine(m);
    setSelectedVehicle(null);
    setSearchEquipQuery('');
    if (m.last_horometro != null) {
      setHi(String(m.last_horometro));
    } else {
      setHi('');
    }
    setHf('');
  };

  const handleSelectVehicle = (v: Vehicle) => {
    setSelectedVehicle(v);
    setSelectedMachine(null);
    setSearchEquipQuery('');
    setHi('');
    setHf('');
  };

  // Cálculo en vivo de horas trabajadas y propuesta de contador final
  const litrosNum = Number(liters.replace(',', '.')) || 0;
  const hiNum = hi !== '' ? Number(hi.replace(',', '.')) : null;
  const hfNum = hf !== '' ? Number(hf.replace(',', '.')) : null;
  const ciNum = ci !== '' ? Number(ci.replace(',', '.')) : null;
  const cfNum = cf !== '' ? Number(cf.replace(',', '.')) : null;

  const hrsCalculadas = horasTrabajadas(hiNum, hfNum);
  const cfPropuesto = contadorFinalPropuesto(ciNum, litrosNum);

  // Al escribir litros, si el contador final está vacío, sugerir contador final
  useEffect(() => {
    if (cfPropuesto != null && cf === '') {
      // sugerencia visual
    }
  }, [cfPropuesto, cf]);

  // Lista filtrada de maquinarias (Código + PLACA siempre visible)
  const filteredMachinery = useMemo(() => {
    const q = norm(searchEquipQuery);
    if (!q) return (machineryList || []).slice(0, 15);
    return (machineryList || [])
      .filter((m) => {
        return (
          norm(m.code).includes(q) ||
          norm(m.plate || '').includes(q) ||
          norm(m.tipo || '').includes(q) ||
          norm(m.marca || '').includes(q) ||
          norm(m.modelo || '').includes(q)
        );
      })
      .slice(0, 20);
  }, [machineryList, searchEquipQuery]);

  const filteredVehicles = useMemo(() => {
    const q = norm(searchEquipQuery);
    if (!q) return (vehiclesList || []).slice(0, 15);
    return (vehiclesList || [])
      .filter((v) => {
        return (
          norm(v.plate).includes(q) ||
          norm(v.name || '').includes(q) ||
          norm(v.brand || '').includes(q) ||
          norm(v.model || '').includes(q)
        );
      })
      .slice(0, 20);
  }, [vehiclesList, searchEquipQuery]);

  // Limpiar formulario de surtido
  const resetSurtirForm = () => {
    setSelectedMachine(null);
    setSelectedVehicle(null);
    setLiters('');
    setPricePerLiter('');
    setHi('');
    setHf('');
    setKm('');
    setCf('');
    setAutorizadoPor('');
    setNota('');
    setPhotos([]);
    setSearchEquipQuery('');
  };

  // Guardar Surtido
  const handleGuardarSurtido = async () => {
    if (!selectedTank) {
      toast.error('Selecciona un tanque de origen.');
      return;
    }
    if (litrosNum <= 0) {
      toast.error('Ingresa una cantidad de litros válida (mayor a 0).');
      return;
    }
    if (targetType === 'maquinaria' && !selectedMachine) {
      toast.error('Selecciona la maquinaria a surtir.');
      return;
    }
    if (targetType === 'vehiculo' && !selectedVehicle) {
      toast.error('Selecciona el vehículo a surtir.');
      return;
    }

    // Validación de horómetro
    const errHor = errorHorometro(hiNum, hfNum);
    if (errHor) {
      toast.error(errHor);
      return;
    }

    // Contador final efectivo
    const contadorFinalEfectivo = cfNum ?? cfPropuesto ?? null;

    setSaving(true);
    try {
      const price = pricePerLiter ? Number(pricePerLiter.replace(',', '.')) : null;
      const totalAmount = price ? Math.round(price * litrosNum * 100) / 100 : null;

      const payload: any = {
        dispatch_date: todayIso(),
        asset_kind: targetType,
        machinery_id: targetType === 'maquinaria' ? selectedMachine?.id : null,
        vehicle_id: targetType === 'vehiculo' ? selectedVehicle?.id : null,
        liters: litrosNum,
        tank_id: selectedTank.id,
        driver_operator: autorizadoPor.trim() || currentUserName,
        odometer_km: km ? Number(km.replace(',', '.')) : null,
        hourmeter_h: hfNum ?? (selectedMachine?.last_horometro || null),
        fuel_start: ciNum,
        fuel_end: contadorFinalEfectivo,
        created_by: session?.user?.id || null,
        price_per_liter: price,
        total_amount: totalAmount,
        photos: photos,
      };

      const { data: newDispatch, error: errInsert } = await supabase
        .from('dispatches')
        .insert(payload)
        .select()
        .single();

      if (errInsert) {
        throw new Error(errInsert.message);
      }

      // Si es maquinaria y se ingresó horómetro final, actualizar maquinaria
      if (targetType === 'maquinaria' && selectedMachine && hfNum != null && hfNum > 0) {
        await supabase
          .from('machinery')
          .update({ last_horometro: hfNum })
          .eq('id', selectedMachine.id);
      }

      toast.success('Despacho registrado con éxito.');

      // Preguntar o preparar compartir por WhatsApp
      const datosWhatsapp: DatosMensajeCombustible = {
        tipo: 'surtido',
        tanqueNombre: selectedTank.name,
        equipoCodigo: selectedMachine ? selectedMachine.code : selectedVehicle?.name || 'Vehículo',
        equipoPlaca: selectedMachine ? selectedMachine.plate : selectedVehicle?.plate,
        litros: litrosNum,
        contadorIni: ciNum,
        contadorFin: contadorFinalEfectivo,
        horometroIni: hiNum,
        horometroFin: hfNum,
        horasTrabajadas: hrsCalculadas,
        kilometraje: km ? Number(km) : null,
        autorizadoPor: autorizadoPor.trim() || currentUserName,
        registradoPor: currentUserName,
        nota: nota.trim() || undefined,
      };

      resetSurtirForm();
      setModalMode('ninguno');
      refetchTanks();
      refetchLevels();
      refetchDispatches();

      // Compartir por WhatsApp inmediatamente
      compartirPorWhatsapp(datosWhatsapp);
    } catch (err: any) {
      toast.error('Error al registrar surtido: ' + (err?.message || 'Error'));
    } finally {
      setSaving(false);
    }
  };

  // Guardar Traslado
  const handleGuardarTraslado = async () => {
    if (!selectedTank) return;
    if (!toTankId || toTankId === selectedTank.id) {
      toast.error('Selecciona un tanque destino diferente al origen.');
      return;
    }
    const l = Number(transferLiters.replace(',', '.')) || 0;
    if (l <= 0) {
      toast.error('Ingresa los litros a transferir.');
      return;
    }

    setSaving(true);
    try {
      const destTank = activeTanks.find((t) => t.id === toTankId);
      const { error: errTr } = await supabase.from('transfers').insert({
        transfer_date: todayIso(),
        from_tank_id: selectedTank.id,
        to_tank_id: toTankId,
        liters: l,
        notes: transferNotes.trim() || null,
        created_by: session?.user?.id || null,
      });

      if (errTr) throw new Error(errTr.message);

      toast.success('Traslado de combustible registrado con éxito.');

      const datosWhatsapp: DatosMensajeCombustible = {
        tipo: 'traslado',
        tanqueNombre: selectedTank.name,
        tanqueDestinoNombre: destTank?.name || 'Tanque receptor',
        litros: l,
        contadorIni: transferCi ? Number(transferCi) : null,
        contadorFin: transferCf ? Number(transferCf) : null,
        autorizadoPor: currentUserName,
        registradoPor: currentUserName,
        nota: transferNotes.trim() || undefined,
      };

      setTransferLiters('');
      setTransferNotes('');
      setModalMode('ninguno');
      refetchTanks();
      refetchLevels();
      compartirPorWhatsapp(datosWhatsapp);
    } catch (err: any) {
      toast.error('Error al registrar traslado: ' + (err?.message || 'Error'));
    } finally {
      setSaving(false);
    }
  };

  // Guardar Entrada de Combustible
  const handleGuardarEntrada = async () => {
    if (!selectedTank) return;
    const env = Number(intakeGuideLiters.replace(',', '.')) || 0;
    const rec = intakeRealLiters ? Number(intakeRealLiters.replace(',', '.')) : env;
    if (env <= 0) {
      toast.error('Ingresa los litros según la guía de PDVSA / proveedor.');
      return;
    }

    const { ok: mermaInfo, error: errMerma } = mermaDeRecepcion(env, rec);
    if (errMerma) {
      toast.error(errMerma);
      return;
    }

    setSaving(true);
    try {
      const { error: errIn } = await supabase.from('fuel_intakes').insert({
        intake_date: todayIso(),
        supplier: intakeSupplier.trim() || 'PDVSA',
        fuel: selectedTank.fuel,
        liters: rec, // Entran los litros medidos reales
        tank_id: selectedTank.id,
        invoice_no: intakeInvoiceNo.trim() || null,
        created_by: session?.user?.id || null,
      });

      if (errIn) throw new Error(errIn.message);

      toast.success('Entrada de combustible registrada con éxito.');

      const datosWhatsapp: DatosMensajeCombustible = {
        tipo: 'entrada',
        tanqueNombre: selectedTank.name,
        litros: rec,
        autorizadoPor: currentUserName,
        registradoPor: currentUserName,
        nota: [
          `Guía: ${env} L · Recibido: ${rec} L`,
          mermaInfo && mermaInfo.merma > 0 ? `Merma: ${mermaInfo.merma} L (${mermaInfo.pct}%)` : '',
          intakeNotes ? `Obs: ${intakeNotes}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      };

      setIntakeGuideLiters('');
      setIntakeRealLiters('');
      setIntakeInvoiceNo('');
      setIntakeNotes('');
      setModalMode('ninguno');
      refetchTanks();
      refetchLevels();
      compartirPorWhatsapp(datosWhatsapp);
    } catch (err: any) {
      toast.error('Error al registrar entrada: ' + (err?.message || 'Error'));
    } finally {
      setSaving(false);
    }
  };

  // Exportar PDF de jornada
  const handleExportarJornada = async () => {
    setGeneratingReport(true);
    try {
      const dayDispatches = (dispatches || []).filter(
        (d) => String(d.dispatch_date).slice(0, 10) === reportDate
      );

      if (dayDispatches.length === 0) {
        toast.info('No hay despachos registrados en la fecha ' + reportDate);
        return;
      }

      const rows: FilaDespachoSurtidorPdf[] = dayDispatches.map((d: any) => {
        const m = (machineryList || []).find((x) => x.id === d.machinery_id);
        const v = (vehiclesList || []).find((x) => x.id === d.vehicle_id);
        const t = (activeTanks || []).find((x) => x.id === d.tank_id);
        const horas =
          d.fuel_start != null && d.fuel_end != null
            ? Number(d.fuel_end) - Number(d.fuel_start)
            : null;

        return {
          fecha: d.dispatch_date,
          hora: d.created_at ? new Date(d.created_at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : '',
          equipoCodigo: m ? m.code : v ? v.name || 'Vehículo' : 'General',
          equipoPlaca: m ? m.plate || '' : v ? v.plate || '' : '',
          tanqueNombre: t ? t.name : 'Bomba directa',
          litros: Number(d.liters) || 0,
          contadorIni: d.fuel_start,
          contadorFin: d.fuel_end,
          horometroIni: null,
          horometroFin: d.hourmeter_h,
          horasTrabajadas: horas,
          autorizadoPor: d.driver_operator,
        };
      });

      await exportarJornadaSurtidorPdf({
        choferNombre: currentUserName,
        fechaJornada: reportDate,
        despachos: rows,
      });

      setReportModalOpen(false);
      toast.success('Parte diario descargado con éxito.');
    } catch (e: any) {
      toast.error('Error al generar PDF: ' + (e?.message || 'Error'));
    } finally {
      setGeneratingReport(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Cabecera / Selector de Tanques con Saldos en Vivo */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          paddingVertical: spacing.sm,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: spacing.md,
            marginBottom: spacing.xs,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 18 }}>🛢️</Text>
            <Text style={{ fontWeight: '800', color: colors.text, fontSize: 15 }}>
              Tanques & Cisternas
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setReportModalOpen(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: colors.surfaceAlt,
              paddingHorizontal: spacing.sm,
              paddingVertical: 5,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ fontSize: 13 }}>📄</Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>
              Parte Diario
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.md, gap: 8, paddingBottom: 2 }}
        >
          {loadingTanks ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : activeTanks.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 13 }}>No hay tanques registrados.</Text>
          ) : (
            activeTanks.map((t) => {
              const isSelected = t.id === selectedTank?.id;
              const lvl = (tankLevels || []).find((l) => l.id === t.id);
              const disp = lvl ? lvl.current_l : 0;
              const pct = lvl?.pct ?? (t.capacity_l > 0 ? Math.round((disp / t.capacity_l) * 100) : 0);
              const isLow = pct < 20;

              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setSelectedTankId(t.id)}
                  activeOpacity={0.8}
                  style={{
                    backgroundColor: isSelected ? colors.primary : colors.surfaceAlt,
                    borderRadius: radius.md,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    width: 142,
                    borderWidth: 1,
                    borderColor: isSelected ? colors.primary : colors.border,
                    shadowColor: isSelected ? colors.primary : 'transparent',
                    shadowOpacity: isSelected ? 0.2 : 0,
                    shadowRadius: 4,
                    elevation: isSelected ? 2 : 0,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        fontWeight: '800',
                        fontSize: 12,
                        color: isSelected ? colors.primaryContrast : colors.text,
                      }}
                    >
                      {t.name}
                    </Text>
                    {t.is_mobile ? <Text style={{ fontSize: 11 }}>🚚</Text> : null}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 3 }}>
                    <Text
                      style={{
                        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
                        fontSize: 16,
                        fontWeight: '900',
                        color: isSelected ? colors.primaryContrast : isLow ? colors.danger : colors.text,
                      }}
                    >
                      {fmtNum(disp)}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: isSelected ? colors.primaryContrast : colors.muted,
                        fontWeight: '600',
                      }}
                    >
                      L
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2, alignItems: 'center' }}>
                    <Text style={{ fontSize: 10, color: isSelected ? colors.primaryContrast : colors.muted, textTransform: 'capitalize' }}>
                      {t.fuel}
                    </Text>
                    <View
                      style={{
                        backgroundColor: isSelected ? 'rgba(255,255,255,0.2)' : isLow ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
                        paddingHorizontal: 5,
                        paddingVertical: 1,
                        borderRadius: radius.pill,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 9.5,
                          fontWeight: '800',
                          color: isSelected ? colors.primaryContrast : isLow ? colors.danger : colors.success,
                        }}
                      >
                        {pct}%
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}>
        {/* Banner de Estado del Tanque Seleccionado */}
        {selectedTank && (
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              padding: spacing.md,
              marginBottom: spacing.md,
              shadowColor: '#000',
              shadowOpacity: 0.05,
              shadowRadius: 5,
              elevation: 1,
            }}
          >
            {/* Fila superior: Badge de tipo y Capacidad total a la derecha */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: colors.surfaceAlt,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: radius.pill,
                }}
              >
                <Text style={{ fontSize: 11 }}>{selectedTank.is_mobile ? '🚚' : '🛢️'}</Text>
                <Text
                  style={{
                    fontSize: 10.5,
                    fontWeight: '800',
                    color: colors.primary,
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                  }}
                >
                  {selectedTank.is_mobile ? 'Cisterna Móvil Activa' : 'Tanque Fijo'}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, flexShrink: 0 }}>
                <Text style={{ fontSize: 11, color: colors.muted }}>Capacidad:</Text>
                <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>
                  {fmtNum(selectedTank.capacity_l)} L
                </Text>
              </View>
            </View>

            {/* Nombre del Tanque */}
            <Text
              numberOfLines={2}
              style={{
                fontSize: 18,
                fontWeight: '900',
                color: colors.text,
                letterSpacing: 0.2,
                marginBottom: 2,
              }}
            >
              {selectedTank.name}
            </Text>

            {/* Datos operativos: Chofer / Encargado y Ubicación */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2, marginBottom: spacing.sm }}>
              {(selectedTank.responsable || selectedTank.chofer) ? (
                <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.muted }}>
                  👤 <Text style={{ fontWeight: '700', color: colors.text }}>
                    {selectedTank.chofer || selectedTank.responsable}
                  </Text>
                </Text>
              ) : null}
              {selectedTank.location ? (
                <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.muted }}>
                  📍 <Text style={{ color: colors.text }}>{selectedTank.location}</Text>
                </Text>
              ) : null}
            </View>

            {/* Gran Métrica Central: Litros Disponibles y % Lleno */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: colors.surfaceAlt,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radius.md,
                marginBottom: spacing.xs,
              }}
            >
              <View>
                <Text style={{ fontSize: 10, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  Disponible ({selectedTank.fuel.toUpperCase()})
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 1 }}>
                  <Text
                    style={{
                      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
                      fontSize: 24,
                      fontWeight: '900',
                      color:
                        (selectedTankLevel?.pct || 0) < 20
                          ? colors.danger
                          : colors.text,
                    }}
                  >
                    {fmtNum(selectedTankLevel?.current_l ?? 0)}
                  </Text>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: colors.muted }}>L</Text>
                </View>
              </View>

              <View
                style={{
                  backgroundColor:
                    (selectedTankLevel?.pct || 0) < 20
                      ? colors.danger
                      : (selectedTankLevel?.pct || 0) < 40
                      ? colors.accent
                      : colors.success,
                  paddingHorizontal: 9,
                  paddingVertical: 4,
                  borderRadius: radius.pill,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '900', color: '#fff' }}>
                  {selectedTankLevel?.pct ?? (selectedTank.capacity_l > 0 ? Math.round(((selectedTankLevel?.current_l ?? 0) / selectedTank.capacity_l) * 100) : 0)}%
                </Text>
              </View>
            </View>

            {/* Barra de progreso de llenado */}
            <View style={{ marginTop: 4 }}>
              <View
                style={{
                  height: 7,
                  backgroundColor: colors.border,
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(0, selectedTankLevel?.pct || 0))}%`,
                    backgroundColor:
                      (selectedTankLevel?.pct || 0) < 20
                        ? colors.danger
                        : (selectedTankLevel?.pct || 0) < 40
                        ? colors.accent
                        : colors.primary,
                  }}
                />
              </View>
            </View>
          </View>
        )}

        {/* 3 Botones de Acción Grande Estilo Golden */}
        <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
          <TouchableOpacity
            onPress={() => {
              resetSurtirForm();
              setModalMode('surtir');
            }}
            activeOpacity={0.88}
            style={{
              backgroundColor: colors.primary,
              borderRadius: radius.lg,
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
              shadowColor: colors.primary,
              shadowOpacity: 0.25,
              shadowRadius: 5,
              elevation: 3,
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: 'rgba(255,255,255,0.2)',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: spacing.md,
              }}
            >
              <Text style={{ fontSize: 24 }}>⛽</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '900', color: colors.primaryContrast, letterSpacing: 0.3 }}>
                SURTIR A UN EQUIPO
              </Text>
              <Text style={{ fontSize: 11, color: colors.primaryContrast, opacity: 0.88, marginTop: 2, lineHeight: 14 }}>
                Despachar combustible a maquinaria con horómetro y contador
              </Text>
            </View>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity
              onPress={() => setModalMode('traslado')}
              activeOpacity={0.85}
              style={{
                flex: 1,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: spacing.md,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 20, marginRight: spacing.sm }}>🔄</Text>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>
                  Pasar a otro tanque
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 10.5, color: colors.muted }}>Traslado interno</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setModalMode('entrada')}
              activeOpacity={0.85}
              style={{
                flex: 1,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: spacing.md,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 20, marginRight: spacing.sm }}>📥</Text>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>
                  Entrada
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 10.5, color: colors.muted }}>Recepción cisterna</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Historial Inmediato de los Últimos 10 Despachos del Tanque */}
        <View style={{ marginTop: spacing.xs }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: spacing.sm,
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '900', color: colors.text, flex: 1, marginRight: 8 }}>
              Últimos movimientos · {selectedTank?.name || 'Tanque'}
            </Text>
            <Text style={{ fontSize: 11.5, color: colors.muted, flexShrink: 0 }}>{tankDispatches.length} reciente(s)</Text>
          </View>

          {tankDispatches.length === 0 ? (
            <View
              style={{
                backgroundColor: colors.surface,
                padding: spacing.xl,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 32, marginBottom: spacing.xs }}>⛽</Text>
              <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>
                Sin movimientos recientes
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 2 }}>
                Toca "Surtir a un equipo" para registrar el primer despacho de este tanque.
              </Text>
            </View>
          ) : (
            <View style={{ gap: spacing.xs }}>
              {tankDispatches.map((m: any) => {
                const maq = (machineryList || []).find((x) => x.id === m.machinery_id);
                const veh = (vehiclesList || []).find((x) => x.id === m.vehicle_id);
                const codeLabel = maq ? maq.code : veh ? veh.name || 'Vehículo' : 'Surtido directo';
                const placaLabel = maq?.plate || veh?.plate || '';
                const timeStr = m.created_at
                  ? new Date(m.created_at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
                  : '';

                return (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => setViewDetailMov(m)}
                    activeOpacity={0.7}
                    style={{
                      backgroundColor: colors.surface,
                      borderRadius: radius.md,
                      padding: spacing.md,
                      borderWidth: 1,
                      borderColor: colors.border,
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                      <View
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 19,
                          backgroundColor: colors.surfaceAlt,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 18 }}>🚜</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }}>
                            {codeLabel}
                          </Text>
                          {placaLabel ? (
                            <View
                              style={{
                                backgroundColor: colors.dangerSoftBg,
                                paddingHorizontal: 6,
                                paddingVertical: 1,
                                borderRadius: radius.sm,
                                borderWidth: 0.5,
                                borderColor: colors.danger,
                              }}
                            >
                              <Text style={{ fontSize: 10.5, fontWeight: '800', color: colors.danger }}>
                                PLACA: {placaLabel}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 2 }}>
                          {m.dispatch_date} {timeStr ? `· ${timeStr}` : ''}
                          {m.driver_operator ? ` · ${m.driver_operator}` : ''}
                        </Text>
                      </View>
                    </View>

                    <View style={{ alignItems: 'flex-end', marginLeft: spacing.sm }}>
                      <Text
                        style={{
                          fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
                          fontSize: 16,
                          fontWeight: '900',
                          color: colors.primary,
                        }}
                      >
                        -{fmtNum(m.liters)} L
                      </Text>
                      {m.fuel_end != null && (
                        <Text style={{ fontSize: 10, color: colors.muted }}>
                          Bomba: {fmtNum(m.fuel_end)}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* MODAL: Surtir a un Equipo */}
      <Modal visible={modalMode === 'surtir'} animationType="slide" transparent={false}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: colors.surface,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.md,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <TouchableOpacity onPress={() => setModalMode('ninguno')}>
              <Text style={{ fontSize: 15, color: colors.danger, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text }}>
              ⛽ Surtir Combustible
            </Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
            {/* Banner de Tanque Origen */}
            <View
              style={{
                backgroundColor: colors.surfaceAlt,
                padding: spacing.sm,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>
                Origen: <Text style={{ color: colors.primary }}>{selectedTank?.name}</Text>
              </Text>
              <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>
                Saldo disp.: {fmtNum(selectedTankLevel?.current_l || 0)} L
              </Text>
            </View>

            {/* Selector Maquinaria vs Vehículo */}
            <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 3 }}>
              <TouchableOpacity
                onPress={() => {
                  setTargetType('maquinaria');
                  setSelectedVehicle(null);
                }}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  alignItems: 'center',
                  borderRadius: radius.sm,
                  backgroundColor: targetType === 'maquinaria' ? colors.surface : 'transparent',
                }}
              >
                <Text style={{ fontWeight: '800', fontSize: 13, color: targetType === 'maquinaria' ? colors.primary : colors.muted }}>
                  🚜 Maquinaria
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setTargetType('vehiculo');
                  setSelectedMachine(null);
                }}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  alignItems: 'center',
                  borderRadius: radius.sm,
                  backgroundColor: targetType === 'vehiculo' ? colors.surface : 'transparent',
                }}
              >
                <Text style={{ fontWeight: '800', fontSize: 13, color: targetType === 'vehiculo' ? colors.primary : colors.muted }}>
                  🚗 Vehículo
                </Text>
              </TouchableOpacity>
            </View>

            {/* Selector con Buscador Obligatorio de Maquinaria (Código + PLACA) */}
            <View>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
                {targetType === 'maquinaria' ? 'Seleccionar Maquinaria (Buscador por Código o Placa)' : 'Seleccionar Vehículo (Buscador por Placa o Nombre)'}
              </Text>
              <TextInput
                value={searchEquipQuery}
                onChangeText={setSearchEquipQuery}
                placeholder={targetType === 'maquinaria' ? 'Buscar por código, placa, tipo...' : 'Buscar por placa o marca...'}
                placeholderTextColor={colors.muted}
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  padding: spacing.sm,
                  fontSize: 14,
                  color: colors.text,
                }}
              />

              {/* Maquinaria/Vehículo actualmente seleccionado */}
              {(selectedMachine || selectedVehicle) && (
                <View
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1.5,
                    borderColor: colors.primary,
                    marginTop: spacing.xs,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '900', color: colors.text }}>
                        {selectedMachine ? selectedMachine.code : selectedVehicle?.name || 'Vehículo'}
                      </Text>
                      {/* REGLA DEL PROYECTO: MOSTRAR SIEMPRE LA PLACA */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        <View style={{ backgroundColor: colors.danger, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3 }}>
                          <Text style={{ fontSize: 11, fontWeight: '900', color: '#fff' }}>
                            PLACA: {selectedMachine?.plate || selectedVehicle?.plate || 'SIN PLACA'}
                          </Text>
                        </View>
                        {selectedMachine?.tipo ? (
                          <Text style={{ fontSize: 11.5, color: colors.muted }}>{selectedMachine.tipo}</Text>
                        ) : null}
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedMachine(null);
                        setSelectedVehicle(null);
                      }}
                      style={{ padding: spacing.xs }}
                    >
                      <Text style={{ fontSize: 13, color: colors.danger, fontWeight: '800' }}>Cambiar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Lista desplegable de opciones si no hay selección o está buscando */}
              {(!selectedMachine && !selectedVehicle) && (
                <View
                  style={{
                    maxHeight: 180,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    marginTop: 4,
                  }}
                >
                  <ScrollView nestedScrollEnabled>
                    {targetType === 'maquinaria' ? (
                      filteredMachinery.length === 0 ? (
                        <Text style={{ padding: spacing.md, color: colors.muted, textAlign: 'center' }}>
                          No se encontraron maquinarias
                        </Text>
                      ) : (
                        filteredMachinery.map((m) => (
                          <TouchableOpacity
                            key={m.id}
                            onPress={() => handleSelectMachine(m)}
                            style={{
                              padding: spacing.sm,
                              borderBottomWidth: 1,
                              borderBottomColor: colors.border,
                              flexDirection: 'row',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <View>
                              <Text style={{ fontWeight: '800', color: colors.text, fontSize: 13.5 }}>{m.code}</Text>
                              <Text style={{ fontSize: 11, color: colors.muted }}>{m.tipo || 'Sin tipo'}</Text>
                            </View>
                            <View style={{ backgroundColor: colors.dangerSoftBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 }}>
                              <Text style={{ fontSize: 11, fontWeight: '800', color: colors.danger }}>
                                PLACA: {m.plate || 'S/P'}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))
                      )
                    ) : (
                      filteredVehicles.length === 0 ? (
                        <Text style={{ padding: spacing.md, color: colors.muted, textAlign: 'center' }}>
                          No se encontraron vehículos
                        </Text>
                      ) : (
                        filteredVehicles.map((v) => (
                          <TouchableOpacity
                            key={v.id}
                            onPress={() => handleSelectVehicle(v)}
                            style={{
                              padding: spacing.sm,
                              borderBottomWidth: 1,
                              borderBottomColor: colors.border,
                              flexDirection: 'row',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <View>
                              <Text style={{ fontWeight: '800', color: colors.text, fontSize: 13.5 }}>{v.plate}</Text>
                              <Text style={{ fontSize: 11, color: colors.muted }}>{v.name || v.brand || 'Vehículo'}</Text>
                            </View>
                          </TouchableOpacity>
                        ))
                      )
                    )}
                  </ScrollView>
                </View>
              )}
            </View>

            {/* Litros Dispensados */}
            <View>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
                Litros Surtidos (L) *
              </Text>
              <TextInput
                value={liters}
                onChangeText={setLiters}
                keyboardType="numeric"
                placeholder="Ej. 120"
                placeholderTextColor={colors.muted}
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.primary,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  fontSize: 22,
                  fontWeight: '900',
                  color: colors.primary,
                  fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
                }}
              />
            </View>

            {/* Bloque de Contadores de la Bomba / Surtidor */}
            <View
              style={{
                backgroundColor: colors.surface,
                padding: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                gap: spacing.sm,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 16 }}>🔢</Text>
                <Text style={{ fontWeight: '800', color: colors.text, fontSize: 13.5 }}>
                  Contador de la Bomba (Totalizador continuo)
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Contador Inicial</Text>
                  <TextInput
                    value={ci}
                    onChangeText={setCi}
                    keyboardType="numeric"
                    placeholder="Arranca en..."
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      padding: spacing.sm,
                      fontSize: 14,
                      color: colors.text,
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>
                    Contador Final {cfPropuesto ? `(Sugerido: ${cfPropuesto})` : ''}
                  </Text>
                  <TextInput
                    value={cf}
                    onChangeText={setCf}
                    keyboardType="numeric"
                    placeholder={cfPropuesto ? String(cfPropuesto) : 'Lectura final'}
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      padding: spacing.sm,
                      fontSize: 14,
                      color: colors.text,
                    }}
                  />
                </View>
              </View>
            </View>

            {/* Bloque de Horómetro (si es Maquinaria) o Odómetro (si es Vehículo) */}
            {targetType === 'maquinaria' ? (
              <View
                style={{
                  backgroundColor: colors.surface,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  gap: spacing.sm,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 16 }}>⏱️</Text>
                  <Text style={{ fontWeight: '800', color: colors.text, fontSize: 13.5 }}>
                    Horómetro de la Maquinaria
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Horómetro Inicial</Text>
                    <TextInput
                      value={hi}
                      onChangeText={setHi}
                      keyboardType="numeric"
                      placeholder="Último horómetro"
                      placeholderTextColor={colors.muted}
                      style={{
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        padding: spacing.sm,
                        fontSize: 14,
                        color: colors.text,
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Horómetro Final</Text>
                    <TextInput
                      value={hf}
                      onChangeText={setHf}
                      keyboardType="numeric"
                      placeholder="Lectura actual"
                      placeholderTextColor={colors.muted}
                      style={{
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        padding: spacing.sm,
                        fontSize: 14,
                        color: colors.text,
                      }}
                    />
                  </View>
                </View>

                {hrsCalculadas != null && (
                  <View style={{ backgroundColor: colors.surfaceAlt, padding: spacing.xs, borderRadius: radius.sm }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: hrsCalculadas >= 0 ? colors.primary : colors.danger }}>
                      {hrsCalculadas >= 0
                        ? `✅ Horas trabajadas calculadas: ${hrsCalculadas} h`
                        : `❌ Error: Horómetro final menor al inicial (${hrsCalculadas} h)`}
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <View>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
                  Kilometraje del Odómetro (km)
                </Text>
                <TextInput
                  value={km}
                  onChangeText={setKm}
                  keyboardType="numeric"
                  placeholder="Ej. 145000"
                  placeholderTextColor={colors.muted}
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    padding: spacing.sm,
                    fontSize: 14,
                    color: colors.text,
                  }}
                />
              </View>
            )}

            {/* Autorizado por y Nota */}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 2 }}>
                  Autorizado por
                </Text>
                <TextInput
                  value={autorizadoPor}
                  onChangeText={setAutorizadoPor}
                  placeholder="Ej. Ing. Carlos"
                  placeholderTextColor={colors.muted}
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.sm,
                    padding: spacing.sm,
                    fontSize: 13,
                    color: colors.text,
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 2 }}>
                  Precio por Litro ($)
                </Text>
                <TextInput
                  value={pricePerLiter}
                  onChangeText={setPricePerLiter}
                  keyboardType="numeric"
                  placeholder="Ej. 0.50"
                  placeholderTextColor={colors.muted}
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.sm,
                    padding: spacing.sm,
                    fontSize: 13,
                    color: colors.text,
                  }}
                />
              </View>
            </View>

            {/* Fotos / Evidencia */}
            <View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>
                  Fotos de respaldo ({photos.length})
                </Text>
                <TouchableOpacity
                  onPress={() => setPhotoSheetOpen(true)}
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 4,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>📷 Tomar Foto</Text>
                </TouchableOpacity>
              </View>

              {photos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
                  {photos.map((uri, idx) => (
                    <View key={idx} style={{ position: 'relative' }}>
                      <Image source={{ uri }} style={{ width: 70, height: 70, borderRadius: radius.sm }} />
                      <TouchableOpacity
                        onPress={() => setPhotos(photos.filter((_, i) => i !== idx))}
                        style={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          backgroundColor: 'rgba(0,0,0,0.6)',
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>

            {/* Botón Guardar */}
            <TouchableOpacity
              onPress={handleGuardarSurtido}
              disabled={saving}
              style={{
                backgroundColor: colors.primary,
                borderRadius: radius.md,
                paddingVertical: spacing.md,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: spacing.md,
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? (
                <ActivityIndicator color={colors.primaryContrast} />
              ) : (
                <Text style={{ fontSize: 16, fontWeight: '900', color: colors.primaryContrast }}>
                  💾 Guardar Despacho & Compartir
                </Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* MODAL: Traslado entre Tanques */}
      <Modal visible={modalMode === 'traslado'} animationType="slide" transparent={false}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: colors.surface,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.md,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <TouchableOpacity onPress={() => setModalMode('ninguno')}>
              <Text style={{ fontSize: 15, color: colors.danger, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text }}>
              🔄 Traslado de Combustible
            </Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
            <View style={{ backgroundColor: colors.surfaceAlt, padding: spacing.md, borderRadius: radius.md }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>Tanque Origen (Sale combustible)</Text>
              <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text, marginTop: 2 }}>{selectedTank?.name}</Text>
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '800', marginTop: 2 }}>
                Saldo disponible: {fmtNum(selectedTankLevel?.current_l || 0)} L
              </Text>
            </View>

            <View>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
                Tanque Destino (Recibe combustible) *
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
                {activeTanks
                  .filter((t) => t.id !== selectedTank?.id)
                  .map((t) => (
                    <TouchableOpacity
                      key={t.id}
                      onPress={() => setToTankId(t.id)}
                      style={{
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.sm,
                        borderRadius: radius.md,
                        backgroundColor: toTankId === t.id ? colors.primary : colors.surface,
                        borderWidth: 1,
                        borderColor: toTankId === t.id ? colors.primary : colors.border,
                      }}
                    >
                      <Text style={{ fontWeight: '800', fontSize: 13, color: toTankId === t.id ? colors.primaryContrast : colors.text }}>
                        {t.name}
                      </Text>
                      <Text style={{ fontSize: 11, color: toTankId === t.id ? colors.primaryContrast : colors.muted }}>
                        Cap: {fmtNum(t.capacity_l)} L
                      </Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            </View>

            <View>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
                Litros a Trasladar *
              </Text>
              <TextInput
                value={transferLiters}
                onChangeText={setTransferLiters}
                keyboardType="numeric"
                placeholder="Ej. 1000"
                placeholderTextColor={colors.muted}
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.primary,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  fontSize: 20,
                  fontWeight: '900',
                  color: colors.primary,
                }}
              />
            </View>

            <View>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 2 }}>
                Observaciones / Conductor de Cisterna
              </Text>
              <TextInput
                value={transferNotes}
                onChangeText={setTransferNotes}
                placeholder="Ej. Traslado a cisterna móvil para frente este"
                placeholderTextColor={colors.muted}
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.sm,
                  padding: spacing.sm,
                  fontSize: 13,
                  color: colors.text,
                }}
              />
            </View>

            <TouchableOpacity
              onPress={handleGuardarTraslado}
              disabled={saving}
              style={{
                backgroundColor: colors.primary,
                borderRadius: radius.md,
                paddingVertical: spacing.md,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: spacing.md,
              }}
            >
              {saving ? (
                <ActivityIndicator color={colors.primaryContrast} />
              ) : (
                <Text style={{ fontSize: 16, fontWeight: '900', color: colors.primaryContrast }}>
                  🔄 Registrar Traslado
                </Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* MODAL: Entrada de Combustible */}
      <Modal visible={modalMode === 'entrada'} animationType="slide" transparent={false}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: colors.surface,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.md,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <TouchableOpacity onPress={() => setModalMode('ninguno')}>
              <Text style={{ fontSize: 15, color: colors.danger, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text }}>
              📥 Entrada de Combustible
            </Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
            <View style={{ backgroundColor: colors.surfaceAlt, padding: spacing.md, borderRadius: radius.md }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>Tanque Receptor</Text>
              <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text, marginTop: 2 }}>{selectedTank?.name}</Text>
            </View>

            <View>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
                Proveedor *
              </Text>
              <TextInput
                value={intakeSupplier}
                onChangeText={setIntakeSupplier}
                placeholder="Ej. PDVSA / Proveedor"
                placeholderTextColor={colors.muted}
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  padding: spacing.sm,
                  fontSize: 14,
                  color: colors.text,
                }}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 2 }}>
                  Litros según Guía *
                </Text>
                <TextInput
                  value={intakeGuideLiters}
                  onChangeText={setIntakeGuideLiters}
                  keyboardType="numeric"
                  placeholder="Guía/Factura"
                  placeholderTextColor={colors.muted}
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.sm,
                    padding: spacing.sm,
                    fontSize: 15,
                    color: colors.text,
                    fontWeight: '700',
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 2 }}>
                  Litros Medidos (Reales)
                </Text>
                <TextInput
                  value={intakeRealLiters}
                  onChangeText={setIntakeRealLiters}
                  keyboardType="numeric"
                  placeholder="Medido en tanque"
                  placeholderTextColor={colors.muted}
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.primary,
                    borderRadius: radius.sm,
                    padding: spacing.sm,
                    fontSize: 15,
                    color: colors.primary,
                    fontWeight: '800',
                  }}
                />
              </View>
            </View>

            {intakeGuideLiters && intakeRealLiters && Number(intakeGuideLiters) > Number(intakeRealLiters) && (
              <View style={{ backgroundColor: colors.dangerSoftBg, padding: spacing.sm, borderRadius: radius.sm }}>
                <Text style={{ fontSize: 12, color: colors.danger, fontWeight: '800' }}>
                  ⚠️ Merma de recepción detectada: {(Number(intakeGuideLiters) - Number(intakeRealLiters)).toFixed(2)} L ({(((Number(intakeGuideLiters) - Number(intakeRealLiters)) / Number(intakeGuideLiters)) * 100).toFixed(1)}%)
                </Text>
              </View>
            )}

            <View>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 2 }}>
                N° de Guía o Factura
              </Text>
              <TextInput
                value={intakeInvoiceNo}
                onChangeText={setIntakeInvoiceNo}
                placeholder="Ej. F-008234"
                placeholderTextColor={colors.muted}
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.sm,
                  padding: spacing.sm,
                  fontSize: 13,
                  color: colors.text,
                }}
              />
            </View>

            <TouchableOpacity
              onPress={handleGuardarEntrada}
              disabled={saving}
              style={{
                backgroundColor: colors.primary,
                borderRadius: radius.md,
                paddingVertical: spacing.md,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: spacing.md,
              }}
            >
              {saving ? (
                <ActivityIndicator color={colors.primaryContrast} />
              ) : (
                <Text style={{ fontSize: 16, fontWeight: '900', color: colors.primaryContrast }}>
                  📥 Registrar Entrada & Notificar
                </Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* MODAL: Detalle de Movimiento con botón WhatsApp */}
      <Modal visible={viewDetailMov != null} animationType="fade" transparent={true}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, maxHeight: '80%' }}>
            {viewDetailMov && (
              <ScrollView>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text }}>Detalle del Despacho</Text>
                  <TouchableOpacity onPress={() => setViewDetailMov(null)}>
                    <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.muted }}>✕</Text>
                  </TouchableOpacity>
                </View>

                <View style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted }}>Fecha y hora:</Text>
                    <Text style={{ fontWeight: '700', color: colors.text }}>
                      {viewDetailMov.dispatch_date} {viewDetailMov.created_at ? new Date(viewDetailMov.created_at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted }}>Litros surtidos:</Text>
                    <Text style={{ fontWeight: '900', color: colors.primary, fontSize: 16 }}>{fmtNum(viewDetailMov.liters)} L</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted }}>Contador bomba:</Text>
                    <Text style={{ fontWeight: '700', color: colors.text }}>
                      {viewDetailMov.fuel_start ?? '—'} ➔ {viewDetailMov.fuel_end ?? '—'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted }}>Horómetro:</Text>
                    <Text style={{ fontWeight: '700', color: colors.text }}>
                      {viewDetailMov.hourmeter_h ?? '—'} h
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.muted }}>Autorizado / Operador:</Text>
                    <Text style={{ fontWeight: '700', color: colors.text }}>{viewDetailMov.driver_operator || '—'}</Text>
                  </View>

                  {/* Fotos adjuntas */}
                  {viewDetailMov.photos && viewDetailMov.photos.length > 0 && (
                    <View style={{ marginTop: spacing.sm }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 4 }}>Fotos ({viewDetailMov.photos.length})</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
                        {viewDetailMov.photos.map((url, i) => (
                          <Image key={i} source={{ uri: url }} style={{ width: 80, height: 80, borderRadius: radius.sm }} />
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  <TouchableOpacity
                    onPress={() => {
                      const maq = (machineryList || []).find((x) => x.id === viewDetailMov.machinery_id);
                      const veh = (vehiclesList || []).find((x) => x.id === viewDetailMov.vehicle_id);
                      const t = (activeTanks || []).find((x) => x.id === viewDetailMov.tank_id);

                      compartirPorWhatsapp({
                        tipo: 'surtido',
                        tanqueNombre: t ? t.name : 'Bomba directa',
                        equipoCodigo: maq ? maq.code : veh ? veh.name || 'Vehículo' : 'General',
                        equipoPlaca: maq?.plate || veh?.plate,
                        litros: viewDetailMov.liters,
                        contadorIni: viewDetailMov.fuel_start,
                        contadorFin: viewDetailMov.fuel_end,
                        horometroFin: viewDetailMov.hourmeter_h,
                        autorizadoPor: viewDetailMov.driver_operator,
                        fecha: viewDetailMov.dispatch_date,
                      });
                    }}
                    style={{
                      backgroundColor: '#25D366',
                      borderRadius: radius.md,
                      paddingVertical: spacing.sm,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginTop: spacing.md,
                      flexDirection: 'row',
                      gap: 6,
                    }}
                  >
                    <Text style={{ fontSize: 16 }}>💬</Text>
                    <Text style={{ fontWeight: '900', color: '#fff', fontSize: 14 }}>
                      Reenviar por WhatsApp
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* MODAL: Reporte Diario del Surtidor */}
      <Modal visible={reportModalOpen} animationType="slide" transparent={true}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
              <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text }}>
                📄 Parte Diario de Surtido (PDF)
              </Text>
              <TouchableOpacity onPress={() => setReportModalOpen(false)}>
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.muted }}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: spacing.sm }}>
              Genera e imprime el reporte oficial con todos los despachos de combustible realizados en la jornada.
            </Text>

            <View style={{ marginBottom: spacing.md }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 2 }}>
                Fecha de la Jornada (AAAA-MM-DD)
              </Text>
              <TextInput
                value={reportDate}
                onChangeText={setReportDate}
                placeholder="2026-10-24"
                placeholderTextColor={colors.muted}
                style={{
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.sm,
                  padding: spacing.sm,
                  fontSize: 14,
                  color: colors.text,
                }}
              />
            </View>

            <TouchableOpacity
              onPress={handleExportarJornada}
              disabled={generatingReport}
              style={{
                backgroundColor: colors.primary,
                borderRadius: radius.md,
                paddingVertical: spacing.md,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {generatingReport ? (
                <ActivityIndicator color={colors.primaryContrast} />
              ) : (
                <Text style={{ fontWeight: '900', color: colors.primaryContrast, fontSize: 14 }}>
                  📥 Descargar Reporte en PDF
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Sheet de Selección de Foto */}
      <PhotoSourceSheet
        visible={photoSheetOpen}
        onClose={() => setPhotoSheetOpen(false)}
        onPickCamera={async () => {
          setPhotoSheetOpen(false);
          const targetId = selectedMachine?.id || selectedVehicle?.id || 'combustible-general';
          const r = await takePhotoAndUpload(targetId, 'combustible');
          if (r.ok && typeof r.url === 'string') {
            const url = r.url;
            setPhotos((prev) => [...prev, url]);
          }
        }}
        onPickGallery={async () => {
          setPhotoSheetOpen(false);
          const targetId = selectedMachine?.id || selectedVehicle?.id || 'combustible-general';
          const r = await pickPhotoFromGalleryAndUpload(targetId, 'combustible');
          if (r.ok && typeof r.url === 'string') {
            const url = r.url;
            setPhotos((prev) => [...prev, url]);
          }
        }}
      />
    </View>
  );
}
