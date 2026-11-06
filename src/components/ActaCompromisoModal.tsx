// MODAL DE ACTA DE COMPROMISO Y ENTREGA DE HERRAMIENTAS / IMPLEMENTOS (04-nov-2026)
//
// Permite durante la entrevista / ingreso del empleado o desde su ficha en Empleados:
// 1. Registrar las herramientas, equipos y EPP entregados (con chips rápidos + filas manuales).
// 2. Revisar las 4 cláusulas obligatorias (uso adecuado, cuidado/custodia, aceptación de
//    responsabilidad y autorización expresa de deducción salarial por daño o extravío).
// 3. Firmar digitalmente en pantalla (trabajador y responsable) o adjuntar foto con
//    📷 Cámara / 🖼️ Galería.
// 4. Guardar el acta en el expediente (`employee_commitment_acts` en Supabase) e imprimir
//    el PDF con membrete, o imprimir planilla en blanco para llenado manual.
// 5. Consultar, reimprimir, reusar/editar o anular (`anulado = true`, nunca DELETE)
//    las actas anteriores del trabajador.

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Modal, Image } from 'react-native';
import {
  Employee,
  Company,
  CommitmentToolItem,
  EmployeeCommitmentAct,
  EstadoRetornoHerramienta,
  ResultadoRecepcionActa,
} from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { fullName } from '../lib/carnet';
import { MEMBRETES_CONSTANCIA, MEMBRETE_POR_DEFECTO } from '../lib/constancia';
import {
  HERRAMIENTAS_SUGERIDAS,
  ESTADOS_RETORNO_HERRAMIENTA,
  MOTIVOS_RECEPCION_ACTA,
  actaCompromisoHtml,
  generarCodigoActaCompromiso,
  generarCodigoActaRecepcion,
  esActaRecepcion,
  normalizarEstadoRetorno,
  limpiarItemsActa,
  totalValorReposicionUsd,
  calcularCargoSugeridoItem,
  totalCargoReposicionUsd,
  resumenEstadosRetorno,
  evaluarResultadoRecepcion,
} from '../lib/actaCompromiso';
import {
  listarActasCompromisoEmpleado,
  guardarActaCompromiso,
  anularActaCompromiso,
} from '../lib/actasCompromisoDb';
import { leerNumero } from '../lib/numeros';
import { exportPdf } from '../lib/pdf';
import { takePhotoAndUpload, pickPhotoAndUpload } from '../lib/photo';
import { SignaturePadModal } from './SignaturePadModal';

type EditableItem = {
  nombre: string;
  cantidad: string;
  cantidad_devuelta: string;
  serial: string;
  estado: 'NUEVO' | 'BUENO' | 'USADO' | 'REPARADO';
  estado_retorno: EstadoRetornoHerramienta;
  observacion_retorno: string;
  valor_usd: string;
  cargo_usd: string;
};

type Props = {
  visible: boolean;
  emp: Employee | null;
  companies: Company[];
  allEmployees?: Employee[];
  currentUserId?: string | null;
  currentUserName?: string | null;
  initialTipoActa?: 'entrega' | 'recepcion';
  initialActaOrigen?: EmployeeCommitmentAct | null;
  onClose: () => void;
  onSaved?: () => void;
};

const ESTADOS_ITEM: Array<'NUEVO' | 'BUENO' | 'USADO' | 'REPARADO'> = ['NUEVO', 'BUENO', 'USADO', 'REPARADO'];

function normalizarEstadoItem(raw?: string | null): 'NUEVO' | 'BUENO' | 'USADO' | 'REPARADO' {
  const up = String(raw ?? '').toUpperCase();
  if (up.includes('BUENO')) return 'BUENO';
  if (up.includes('USADO')) return 'USADO';
  if (up.includes('REPARADO')) return 'REPARADO';
  return 'NUEVO';
}

function emptyEditableItem(): EditableItem {
  return {
    nombre: '',
    cantidad: '1',
    cantidad_devuelta: '1',
    serial: '',
    estado: 'NUEVO',
    estado_retorno: 'BUENO / OPERATIVO',
    observacion_retorno: '',
    valor_usd: '',
    cargo_usd: '',
  };
}

export function ActaCompromisoModal({
  visible,
  emp,
  companies,
  allEmployees = [],
  currentUserId,
  currentUserName,
  initialTipoActa = 'entrega',
  initialActaOrigen = null,
  onClose,
  onSaved,
}: Props) {
  const { colors: c } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();

  const [actasGuardadas, setActasGuardadas] = useState<EmployeeCommitmentAct[]>([]);
  const [loadingActas, setLoadingActas] = useState(false);
  const [saving, setSaving] = useState(false);

  // Estado del formulario actual
  const [tipoActa, setTipoActa] = useState<'entrega' | 'recepcion'>('entrega');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actCode, setActCode] = useState('');
  const [actDate, setActDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lugar, setLugar] = useState('CAMURI CHICO, EDO. LA GUAIRA');
  const [membreteKey, setMembreteKey] = useState<string>(MEMBRETE_POR_DEFECTO.key);
  const [entregadoPorNombre, setEntregadoPorNombre] = useState('');
  const [entregadoPorCargo, setEntregadoPorCargo] = useState('ALMACÉN / SEGURIDAD INDUSTRIAL / RRHH');
  const [testigoNombre, setTestigoNombre] = useState('');
  const [testigoCedula, setTestigoCedula] = useState('');
  const [buscarEntregador, setBuscarEntregador] = useState('');
  const [items, setItems] = useState<EditableItem[]>([emptyEditableItem()]);
  const [observaciones, setObservaciones] = useState('');
  const [employeeSignatureUrl, setEmployeeSignatureUrl] = useState<string>('');
  const [delivererSignatureUrl, setDelivererSignatureUrl] = useState<string>('');
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Estado adicional cuando es Acta de Recepción / Devolución
  const [actaOrigenId, setActaOrigenId] = useState<string | null>(null);
  const [actaOrigenCodigo, setActaOrigenCodigo] = useState('');
  const [fechaEntregaOrigen, setFechaEntregaOrigen] = useState('');
  const [motivoRecepcion, setMotivoRecepcion] = useState('');
  const [resultadoOverride, setResultadoOverride] = useState<ResultadoRecepcionActa | null>(null);

  // Modal de firma digital
  const [sigTarget, setSigTarget] = useState<'worker' | 'deliverer' | null>(null);

  const cargarExpediente = async (employeeId: string): Promise<EmployeeCommitmentAct[]> => {
    setLoadingActas(true);
    try {
      const res = await listarActasCompromisoEmpleado(employeeId);
      const rows = Array.isArray(res?.actas) ? res.actas : [];
      if (res?.error) {
        toast.error('Aviso al consultar actas: ' + res.error);
      }
      setActasGuardadas(rows);
      return rows;
    } catch (e: any) {
      toast.error('Error cargando actas: ' + (e?.message || 'Error'));
      setActasGuardadas([]);
      return [];
    } finally {
      setLoadingActas(false);
    }
  };

  const contarPorTipo = (rows: EmployeeCommitmentAct[]) => {
    const entregas = rows.filter((r) => !esActaRecepcion(r)).length;
    const recepciones = rows.filter((r) => esActaRecepcion(r)).length;
    return { entregas, recepciones };
  };

  const resetForm = (
    modo: 'entrega' | 'recepcion' = 'entrega',
    rowsActuales: EmployeeCommitmentAct[] = actasGuardadas
  ) => {
    const { entregas, recepciones } = contarPorTipo(rowsActuales);
    setTipoActa(modo);
    setEditingId(null);
    const hoy = new Date().toISOString().slice(0, 10);
    setActDate(hoy);
    setActCode(
      modo === 'recepcion'
        ? generarCodigoActaRecepcion(recepciones + 1, hoy)
        : generarCodigoActaCompromiso(entregas + 1, hoy)
    );
    setLugar('CAMURI CHICO, EDO. LA GUAIRA');
    setEntregadoPorNombre(currentUserName || '');
    setEntregadoPorCargo('ALMACÉN / SEGURIDAD INDUSTRIAL / RRHH');
    setTestigoNombre('');
    setTestigoCedula('');
    setItems([emptyEditableItem()]);
    setObservaciones('');
    setEmployeeSignatureUrl('');
    setDelivererSignatureUrl('');
    setPhotoUrl('');
    setActaOrigenId(null);
    setActaOrigenCodigo('');
    setFechaEntregaOrigen('');
    setMotivoRecepcion('');
    setResultadoOverride(null);
  };

  const iniciarRecepcionDesdeActa = (
    actaEntrega: EmployeeCommitmentAct,
    rowsActuales: EmployeeCommitmentAct[] = actasGuardadas,
    silencioso = false
  ) => {
    const { recepciones } = contarPorTipo(rowsActuales);
    const hoy = new Date().toISOString().slice(0, 10);
    setTipoActa('recepcion');
    setEditingId(null);
    setActDate(hoy);
    setActCode(generarCodigoActaRecepcion(recepciones + 1, hoy));
    setActaOrigenId(actaEntrega.id);
    setActaOrigenCodigo(actaEntrega.codigo || '');
    setFechaEntregaOrigen(actaEntrega.fecha_entrega || '');
    setEntregadoPorNombre(currentUserName || actaEntrega.entregado_por || '');
    setEntregadoPorCargo(actaEntrega.entregado_cargo || 'ALMACÉN / SEGURIDAD INDUSTRIAL / RRHH');
    setTestigoNombre('');
    setTestigoCedula('');
    setObservaciones('');
    setEmployeeSignatureUrl('');
    setDelivererSignatureUrl('');
    setPhotoUrl('');
    setResultadoOverride(null);

    const loadedItems: EditableItem[] = (actaEntrega.items || []).map((it) => {
      const cant = String(it.cantidad || 1);
      return {
        nombre: it.nombre || '',
        cantidad: cant,
        cantidad_devuelta: cant,
        serial: it.serial || '',
        estado: normalizarEstadoItem(it.estado),
        estado_retorno: 'BUENO / OPERATIVO',
        observacion_retorno: '',
        valor_usd: it.valor_usd != null ? String(it.valor_usd) : '',
        cargo_usd: '',
      };
    });
    setItems(loadedItems.length > 0 ? loadedItems : [emptyEditableItem()]);
    if (!silencioso) {
      toast.ok(`Cargados los implementos del acta ${actaEntrega.codigo || ''} para registrar su devolución y estado`);
    }
  };

  useEffect(() => {
    if (visible && emp?.id) {
      cargarExpediente(emp.id).then((rows) => {
        if (initialActaOrigen) {
          iniciarRecepcionDesdeActa(initialActaOrigen, rows, true);
        } else if (initialTipoActa === 'recepcion') {
          const entregas = rows.filter((r) => !esActaRecepcion(r));
          if (entregas.length > 0) {
            iniciarRecepcionDesdeActa(entregas[0], rows, true);
          } else {
            resetForm('recepcion', rows);
          }
        } else {
          resetForm('entrega', rows);
        }
      });
    }
  }, [visible, emp?.id, initialTipoActa, initialActaOrigen?.id]);

  if (!visible || !emp) return null;

  const membrete = MEMBRETES_CONSTANCIA.find((m) => m.key === membreteKey) || MEMBRETE_POR_DEFECTO;
  const companyObj = companies.find((co) => co.id === emp.company_id) || null;
  const esModoRecepcion = tipoActa === 'recepcion';
  const actasEntregaExistentes = actasGuardadas.filter((a) => !esActaRecepcion(a));

  const convertirItems = (): CommitmentToolItem[] => {
    const raw: CommitmentToolItem[] = items.map((it) => {
      const cant = leerNumero(it.cantidad);
      const cantidad = cant !== null && cant > 0 ? cant : 1;
      const val = it.valor_usd.trim() !== '' ? leerNumero(it.valor_usd) : null;
      const base: CommitmentToolItem = {
        nombre: it.nombre,
        cantidad,
        serial: it.serial || null,
        estado: it.estado,
        valor_usd: val !== null && val > 0 ? val : null,
        tipo_acta: esModoRecepcion ? 'recepcion' : 'entrega',
      };
      if (esModoRecepcion) {
        const devRaw = it.cantidad_devuelta.trim() !== '' ? leerNumero(it.cantidad_devuelta) : cantidad;
        base.cantidad_devuelta =
          it.estado_retorno === 'EXTRAVIADO / NO DEVUELTO' && it.cantidad_devuelta.trim() === ''
            ? 0
            : devRaw !== null && devRaw >= 0
              ? devRaw
              : cantidad;
        base.estado_retorno = it.estado_retorno || 'BUENO / OPERATIVO';
        base.observacion_retorno = it.observacion_retorno.trim() || null;
        const cargoRaw = it.cargo_usd.trim() !== '' ? leerNumero(it.cargo_usd) : null;
        base.cargo_usd = cargoRaw !== null && cargoRaw >= 0 ? cargoRaw : null;
      }
      return base;
    });
    return limpiarItemsActa(raw);
  };

  const itemsConvertidos = convertirItems();
  const totalReposicion = totalValorReposicionUsd(itemsConvertidos);
  const totalCargosRecepcion = totalCargoReposicionUsd(itemsConvertidos);
  const resumenRetorno = resumenEstadosRetorno(itemsConvertidos);
  const resultadoRecepcionActual: ResultadoRecepcionActa =
    resultadoOverride || evaluarResultadoRecepcion(itemsConvertidos);

  const agregarSugerido = (sug: { nombre: string; estado: string }) => {
    setItems((prev) => {
      const limpias = prev.filter((p) => p.nombre.trim() !== '');
      return [
        ...limpias,
        {
          nombre: sug.nombre,
          cantidad: '1',
          cantidad_devuelta: '1',
          serial: '',
          estado: normalizarEstadoItem(sug.estado),
          estado_retorno: 'BUENO / OPERATIVO',
          observacion_retorno: '',
          valor_usd: '',
          cargo_usd: '',
        },
      ];
    });
  };

  const actualizarItem = (idx: number, patch: Partial<EditableItem>) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        if (patch.estado_retorno) {
          if (patch.estado_retorno === 'EXTRAVIADO / NO DEVUELTO') {
            next.cantidad_devuelta = '0';
            const sug = calcularCargoSugeridoItem({
              cantidad: next.cantidad,
              cantidad_devuelta: '0',
              estado_retorno: patch.estado_retorno,
              valor_usd: next.valor_usd,
            });
            if (sug > 0 && !next.cargo_usd.trim()) next.cargo_usd = String(sug);
          } else if (patch.estado_retorno === 'DAÑADO / AVERIADO') {
            const sug = calcularCargoSugeridoItem({
              cantidad: next.cantidad,
              cantidad_devuelta: next.cantidad_devuelta,
              estado_retorno: patch.estado_retorno,
              valor_usd: next.valor_usd,
            });
            if (sug > 0 && !next.cargo_usd.trim()) next.cargo_usd = String(sug);
          } else if (patch.estado_retorno === 'BUENO / OPERATIVO' || patch.estado_retorno === 'DESGASTE NORMAL') {
            if (next.cantidad_devuelta === '0') next.cantidad_devuelta = next.cantidad || '1';
            next.cargo_usd = '';
          }
        }
        return next;
      })
    );
  };

  const marcarTodoConforme = () => {
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        cantidad_devuelta: it.cantidad || '1',
        estado_retorno: 'BUENO / OPERATIVO',
        observacion_retorno: it.observacion_retorno || 'Devuelto completo y operativo',
        cargo_usd: '',
      }))
    );
    setResultadoOverride('CONFORME');
    toast.ok('Todos los implementos marcados como devueltos en buen estado');
  };

  const quitarItem = (idx: number) => {
    setItems((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length > 0 ? next : [emptyEditableItem()];
    });
  };

  const construirHtml = (blankTemplate = false) => {
    const cleanItems = blankTemplate ? [] : itemsConvertidos;
    return actaCompromisoHtml({
      codigo: actCode,
      fullName: fullName(emp),
      cedula: emp.cedula,
      cargo: emp.cargo,
      department: emp.department,
      fichaNumber: emp.ficha_number,
      hireDate: emp.hire_date,
      city: emp.city,
      state: emp.state,
      lugar,
      fechaEntrega: actDate,
      items: cleanItems,
      observaciones,
      entregadoPor: entregadoPorNombre,
      entregadoCargo: entregadoPorCargo,
      testigoNombre,
      testigoCedula,
      firmaTrabajadorDataUri: blankTemplate ? null : employeeSignatureUrl || null,
      firmaEntregaDataUri: blankTemplate ? null : delivererSignatureUrl || null,
      companyName: membrete.nombre || companyObj?.name || 'SOS LA GUAIRA',
      logoDataUri: membrete.logo,
      tipoActa,
      actaOrigenCodigo: actaOrigenCodigo || null,
      fechaEntregaOrigen: fechaEntregaOrigen || null,
      motivoRecepcion: motivoRecepcion || null,
      resultadoRecepcion: resultadoRecepcionActual,
      soporteUrl: photoUrl || null,
    });
  };

  const handleGuardar = async (imprimirDespues: boolean) => {
    const cleanItems = itemsConvertidos;
    if (cleanItems.length === 0) {
      toast.warn(
        esModoRecepcion
          ? 'Agrega al menos 1 herramienta o implemento devuelto antes de guardar (o usa «Imprimir planilla en blanco»).'
          : 'Agrega al menos 1 herramienta o implemento entregado antes de guardar en el expediente (o usa «Imprimir planilla en blanco»).'
      );
      return;
    }
    setSaving(true);
    try {
      const { entregas, recepciones } = contarPorTipo(actasGuardadas);
      const codigoDefault = esModoRecepcion
        ? generarCodigoActaRecepcion(recepciones + 1, actDate)
        : generarCodigoActaCompromiso(entregas + 1, actDate);

      const res = await guardarActaCompromiso({
        id: editingId || undefined,
        employee_id: emp.id,
        codigo: actCode || codigoDefault,
        fecha_entrega: actDate || new Date().toISOString().slice(0, 10),
        cargo: emp.cargo || null,
        departamento: emp.department || null,
        items: cleanItems,
        observaciones,
        entregado_por: entregadoPorNombre,
        entregado_cargo: entregadoPorCargo,
        testigo_nombre: testigoNombre || null,
        testigo_cedula: testigoCedula || null,
        firma_trabajador_url: employeeSignatureUrl || null,
        firma_entrega_url: delivererSignatureUrl || null,
        soporte_url: photoUrl || null,
        acepta_clausulas: true,
        autoriza_deduccion: true,
        tipo_acta: tipoActa,
        acta_origen_id: esModoRecepcion ? actaOrigenId || null : null,
        acta_origen_codigo: esModoRecepcion ? actaOrigenCodigo || null : null,
        fecha_entrega_origen: esModoRecepcion ? fechaEntregaOrigen || null : null,
        motivo_recepcion: esModoRecepcion ? motivoRecepcion || null : null,
        resultado_recepcion: esModoRecepcion ? resultadoRecepcionActual : null,
        uid: currentUserId || null,
        userName: currentUserName || null,
      });
      if (res.error || !res.acta) {
        toast.error(res.error || 'No se pudo guardar el acta.');
        return;
      }
      const saved = res.acta;
      toast.ok(
        editingId
          ? 'Acta actualizada en el expediente'
          : esModoRecepcion
            ? 'Acta de Recepción / Devolución guardada en el expediente'
            : 'Acta de Compromiso y Entrega guardada en el expediente'
      );
      const rows = await cargarExpediente(emp.id);
      onSaved?.();
      if (imprimirDespues) {
        const html = actaCompromisoHtml({
          codigo: saved.codigo,
          fullName: fullName(emp),
          cedula: emp.cedula,
          cargo: saved.cargo || emp.cargo,
          department: saved.departamento || emp.department,
          fichaNumber: emp.ficha_number,
          hireDate: emp.hire_date,
          city: emp.city,
          state: emp.state,
          lugar,
          fechaEntrega: saved.fecha_entrega,
          items: saved.items,
          observaciones: saved.observaciones,
          entregadoPor: saved.entregado_por,
          entregadoCargo: saved.entregado_cargo || entregadoPorCargo,
          testigoNombre: saved.testigo_nombre,
          testigoCedula: saved.testigo_cedula,
          firmaTrabajadorDataUri: saved.firma_trabajador_url,
          firmaEntregaDataUri: saved.firma_entrega_url,
          companyName: membrete.nombre || companyObj?.name || 'SOS LA GUAIRA',
          logoDataUri: membrete.logo,
          tipoActa: saved.tipo_acta || tipoActa,
          actaOrigenCodigo: saved.acta_origen_codigo || actaOrigenCodigo || null,
          fechaEntregaOrigen: saved.fecha_entrega_origen || fechaEntregaOrigen || null,
          motivoRecepcion: saved.motivo_recepcion || motivoRecepcion || null,
          resultadoRecepcion: saved.resultado_recepcion || resultadoRecepcionActual,
          soporteUrl: saved.soporte_url || null,
        });
        const prefix = esActaRecepcion(saved) ? 'Acta_Recepcion' : 'Acta_Compromiso';
        await exportPdf(html, `${prefix}_${saved.codigo || fullName(emp).replace(/\s+/g, '_')}`);
      }
      resetForm(tipoActa, rows);
    } catch (e: any) {
      toast.error('No se pudo guardar el acta: ' + (e?.message || 'Error'));
    } finally {
      setSaving(false);
    }
  };

  const handleImprimirActaGuardada = async (acta: EmployeeCommitmentAct) => {
    const html = actaCompromisoHtml({
      codigo: acta.codigo,
      fullName: fullName(emp),
      cedula: emp.cedula,
      cargo: acta.cargo || emp.cargo,
      department: acta.departamento || emp.department,
      fichaNumber: emp.ficha_number,
      hireDate: emp.hire_date,
      city: emp.city,
      state: emp.state,
      lugar,
      fechaEntrega: acta.fecha_entrega,
      items: acta.items || [],
      observaciones: acta.observaciones,
      entregadoPor: acta.entregado_por,
      entregadoCargo: acta.entregado_cargo || entregadoPorCargo,
      testigoNombre: acta.testigo_nombre,
      testigoCedula: acta.testigo_cedula,
      firmaTrabajadorDataUri: acta.firma_trabajador_url,
      firmaEntregaDataUri: acta.firma_entrega_url,
      companyName: membrete.nombre || companyObj?.name || 'SOS LA GUAIRA',
      logoDataUri: membrete.logo,
      tipoActa: acta.tipo_acta || (esActaRecepcion(acta) ? 'recepcion' : 'entrega'),
      actaOrigenCodigo: acta.acta_origen_codigo || null,
      fechaEntregaOrigen: acta.fecha_entrega_origen || null,
      motivoRecepcion: acta.motivo_recepcion || null,
      resultadoRecepcion: acta.resultado_recepcion || null,
      soporteUrl: acta.soporte_url || null,
    });
    const prefix = esActaRecepcion(acta) ? 'Acta_Recepcion' : 'Acta_Compromiso';
    await exportPdf(html, `${prefix}_${acta.codigo || fullName(emp).replace(/\s+/g, '_')}`);
  };

  const handleCargarParaEditar = (acta: EmployeeCommitmentAct, comoNuevaCopia = false) => {
    const esRec = esActaRecepcion(acta);
    const { entregas, recepciones } = contarPorTipo(actasGuardadas);
    setTipoActa(esRec ? 'recepcion' : 'entrega');
    setEditingId(comoNuevaCopia ? null : acta.id);
    const hoy = new Date().toISOString().slice(0, 10);
    setActDate(comoNuevaCopia ? hoy : acta.fecha_entrega || hoy);
    setActCode(
      comoNuevaCopia
        ? esRec
          ? generarCodigoActaRecepcion(recepciones + 1, hoy)
          : generarCodigoActaCompromiso(entregas + 1, hoy)
        : acta.codigo || (esRec ? generarCodigoActaRecepcion(1, acta.fecha_entrega) : generarCodigoActaCompromiso(1, acta.fecha_entrega))
    );
    setEntregadoPorNombre(acta.entregado_por || '');
    setEntregadoPorCargo(acta.entregado_cargo || 'ALMACÉN / SEGURIDAD INDUSTRIAL / RRHH');
    setTestigoNombre(acta.testigo_nombre || '');
    setTestigoCedula(acta.testigo_cedula || '');
    setActaOrigenId(acta.acta_origen_id || null);
    setActaOrigenCodigo(acta.acta_origen_codigo || '');
    setFechaEntregaOrigen(acta.fecha_entrega_origen || '');
    setMotivoRecepcion(acta.motivo_recepcion || '');
    setResultadoOverride(acta.resultado_recepcion || null);
    const loadedItems: EditableItem[] = (acta.items || []).map((it) => ({
      nombre: it.nombre || '',
      cantidad: String(it.cantidad || 1),
      cantidad_devuelta: String(it.cantidad_devuelta != null ? it.cantidad_devuelta : it.cantidad || 1),
      serial: it.serial || '',
      estado: normalizarEstadoItem(it.estado),
      estado_retorno: normalizarEstadoRetorno(it.estado_retorno),
      observacion_retorno: it.observacion_retorno || '',
      valor_usd: it.valor_usd != null ? String(it.valor_usd) : '',
      cargo_usd: it.cargo_usd != null ? String(it.cargo_usd) : '',
    }));
    setItems(loadedItems.length > 0 ? loadedItems : [emptyEditableItem()]);
    setObservaciones(acta.observaciones || '');
    setEmployeeSignatureUrl(comoNuevaCopia ? '' : acta.firma_trabajador_url || '');
    setDelivererSignatureUrl(comoNuevaCopia ? '' : acta.firma_entrega_url || '');
    setPhotoUrl(comoNuevaCopia ? '' : acta.soporte_url || '');
    toast.ok(comoNuevaCopia ? 'Acta cargada como plantilla nueva' : `Editando acta ${acta.codigo || ''}`);
  };

  const handleAnular = async (acta: EmployeeCommitmentAct) => {
    const ok = await confirm({
      title: 'Anular acta de compromiso',
      message: `¿Anular el acta ${acta.codigo || ''} del ${acta.fecha_entrega}? Quedará oculta del expediente activo (no se borra de la base de datos).`,
      confirmText: 'Sí, anular',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await anularActaCompromiso(acta.id, currentUserId, currentUserName);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.ok('Acta anulada');
      await cargarExpediente(emp.id);
      onSaved?.();
    } catch (e: any) {
      toast.error('No se pudo anular: ' + (e?.message || 'Error'));
    }
  };

  const handleEvidenciaFoto = async (source: 'camera' | 'gallery') => {
    setUploadingPhoto(true);
    try {
      const fn = source === 'camera' ? takePhotoAndUpload : pickPhotoAndUpload;
      const r = await fn('actas-evidencia', emp.id);
      if (!r.ok || !r.url) {
        if (r.error) toast.error(r.error);
        return;
      }
      setPhotoUrl(r.url);
      toast.ok('Foto de soporte adjuntada');
    } catch (e: any) {
      toast.error('Error subiendo foto: ' + (e?.message || 'Error'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const empleadosCoincidentes = buscarEntregador.trim()
    ? allEmployees
        .filter((e) => {
          const q = buscarEntregador.trim().toLowerCase();
          return (
            fullName(e).toLowerCase().includes(q) ||
            (e.cedula || '').toLowerCase().includes(q) ||
            (e.cargo || '').toLowerCase().includes(q)
          );
        })
        .slice(0, 6)
    : [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.75)',
          justifyContent: 'center',
          padding: spacing.md,
        }}
      >
        <View
          style={{
            backgroundColor: c.surface,
            borderRadius: radius.lg,
            padding: spacing.md,
            borderWidth: 1,
            borderColor: c.border,
            maxWidth: 820,
            width: '100%',
            alignSelf: 'center',
            maxHeight: '94%',
          }}
        >
          {/* CABECERA */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: esModoRecepcion ? '#0F766E' : c.primary, fontSize: 16, fontWeight: '900' }}>
                {esModoRecepcion
                  ? '📥 ACTA DE RECEPCIÓN Y DEVOLUCIÓN DE HERRAMIENTAS / IMPLEMENTOS'
                  : '🤝 ACTA DE COMPROMISO Y ENTREGA DE HERRAMIENTAS / IMPLEMENTOS'}
              </Text>
              <Text style={{ color: c.text, fontSize: 13, fontWeight: '800', marginTop: 2 }}>
                {fullName(emp)} · C.I. {emp.cedula || '—'} · Ficha #{emp.ficha_number || '—'} · {(emp.cargo || 'SIN CARGO').toUpperCase()}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: c.border,
              }}
            >
              <Text style={{ color: c.muted, fontWeight: '800', fontSize: 12 }}>✕ CERRAR</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 620 }} showsVerticalScrollIndicator>
            {/* SECCIÓN 1: EXPEDIENTE DE ACTAS GUARDADAS DEL TRABAJADOR */}
            <View
              style={{
                backgroundColor: c.surfaceAlt,
                borderRadius: radius.md,
                padding: 10,
                borderWidth: 1,
                borderColor: c.border,
                marginBottom: 12,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                <Text style={{ color: c.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>
                  📁 EXPEDIENTE DE ACTAS DEL TRABAJADOR ({actasGuardadas.length})
                </Text>
                {editingId ? (
                  <TouchableOpacity
                    onPress={() => resetForm(tipoActa, actasGuardadas)}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: radius.sm,
                      backgroundColor: c.primary + '22',
                      borderWidth: 1,
                      borderColor: c.primary,
                    }}
                  >
                    <Text style={{ color: c.primary, fontSize: 10, fontWeight: '900' }}>+ NUEVA ACTA EN LIMPIO</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {loadingActas ? (
                <Text style={{ color: c.muted, fontSize: 11 }}>Cargando actas del expediente...</Text>
              ) : actasGuardadas.length === 0 ? (
                <Text style={{ color: c.muted, fontSize: 11 }}>
                  Este trabajador aún no tiene actas de entrega ni de recepción registradas en su expediente.
                </Text>
              ) : (
                <View style={{ gap: 6 }}>
                  {actasGuardadas.map((a) => {
                    const esRec = esActaRecepcion(a);
                    const cantItems = (a.items || []).reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0);
                    const totalUsd = totalValorReposicionUsd(a.items || []);
                    const totalCargo = totalCargoReposicionUsd(a.items || []);
                    const recepcionVinculada = !esRec
                      ? actasGuardadas.find(
                          (other) =>
                            esActaRecepcion(other) &&
                            (other.acta_origen_id === a.id || (a.codigo && other.acta_origen_codigo === a.codigo))
                        )
                      : null;
                    const resRet = esRec ? resumenEstadosRetorno(a.items || []) : null;
                    const resultadoRec = esRec ? a.resultado_recepcion || evaluarResultadoRecepcion(a.items || []) : null;

                    return (
                      <View
                        key={a.id}
                        style={{
                          backgroundColor: c.surface,
                          borderRadius: radius.sm,
                          padding: 8,
                          borderWidth: 1,
                          borderColor: editingId === a.id ? c.primary : esRec ? '#0F766E66' : c.border,
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <View style={{ flex: 1, minWidth: 200 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <View
                              style={{
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: 4,
                                backgroundColor: esRec ? '#0F766E22' : '#0369A122',
                              }}
                            >
                              <Text style={{ color: esRec ? '#0F766E' : '#0369A1', fontSize: 9, fontWeight: '900' }}>
                                {esRec ? '📥 RECEPCIÓN / DEVOLUCIÓN' : '📤 ENTREGA / COMPROMISO'}
                              </Text>
                            </View>
                            <Text style={{ color: c.text, fontWeight: '900', fontSize: 12 }}>
                              {a.codigo || 'ACTA'} · {a.fecha_entrega}
                            </Text>
                            <View
                              style={{
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: 4,
                                backgroundColor: a.firma_trabajador_url ? '#16a34a22' : '#d9770622',
                              }}
                            >
                              <Text
                                style={{
                                  color: a.firma_trabajador_url ? '#16a34a' : '#d97706',
                                  fontSize: 9,
                                  fontWeight: '900',
                                }}
                              >
                                {a.firma_trabajador_url ? '✍️ FIRMADA DIGITAL' : '📄 EMITIDA'}
                              </Text>
                            </View>
                            {recepcionVinculada ? (
                              <View
                                style={{
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  borderRadius: 4,
                                  backgroundColor: '#16a34a22',
                                  borderWidth: 1,
                                  borderColor: '#16a34a66',
                                }}
                              >
                                <Text style={{ color: '#16a34a', fontSize: 9, fontWeight: '900' }}>
                                  ✅ YA DEVUELTA ({recepcionVinculada.codigo})
                                </Text>
                              </View>
                            ) : null}
                            {esRec && resultadoRec ? (
                              <View
                                style={{
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  borderRadius: 4,
                                  backgroundColor:
                                    resultadoRec === 'CONFORME'
                                      ? '#16a34a22'
                                      : resultadoRec === 'PARCIAL'
                                        ? '#d9770622'
                                        : '#dc262622',
                                }}
                              >
                                <Text
                                  style={{
                                    color:
                                      resultadoRec === 'CONFORME'
                                        ? '#16a34a'
                                        : resultadoRec === 'PARCIAL'
                                          ? '#d97706'
                                          : '#dc2626',
                                    fontSize: 9,
                                    fontWeight: '900',
                                  }}
                                >
                                  {resultadoRec === 'CONFORME'
                                    ? '✓ PAZ Y SALVO'
                                    : resultadoRec === 'PARCIAL'
                                      ? '⏳ PARCIAL'
                                      : '⚠️ CON NOVEDAD'}
                                </Text>
                              </View>
                            ) : null}
                          </View>

                          {esRec ? (
                            <Text style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
                              {resRet ? `${resRet.totalDevueltos}/${resRet.totalEntregados} und. devueltas` : `${(a.items || []).length} renglón(es)`}
                              {a.acta_origen_codigo ? ` · Ref: ${a.acta_origen_codigo}` : ''}
                              {a.motivo_recepcion ? ` · ${a.motivo_recepcion}` : ''}
                              {totalCargo > 0 ? ` · Cargo: $${totalCargo.toFixed(2)}` : ''}
                              {a.entregado_por ? ` · Recibió: ${a.entregado_por}` : ''}
                            </Text>
                          ) : (
                            <Text style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
                              {(a.items || []).length} renglón(es) ({cantItems} und.)
                              {totalUsd > 0 ? ` · Valor reposición: $${totalUsd.toFixed(2)}` : ''}
                              {a.entregado_por ? ` · Entregó: ${a.entregado_por}` : ''}
                            </Text>
                          )}

                          <Text style={{ color: c.text, fontSize: 10, marginTop: 2 }} numberOfLines={2}>
                            {(a.items || [])
                              .map((it) =>
                                esRec
                                  ? `${it.cantidad_devuelta ?? it.cantidad}/${it.cantidad}x ${it.nombre} (${it.estado_retorno || 'BUENO'})`
                                  : `${it.cantidad}x ${it.nombre}`
                              )
                              .join(' · ')}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                          {!esRec ? (
                            <TouchableOpacity
                              onPress={() => iniciarRecepcionDesdeActa(a, actasGuardadas)}
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: radius.sm,
                                backgroundColor: '#0F766E',
                              }}
                            >
                              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>
                                📥 RECIBIR / DEVOLVER
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                          <TouchableOpacity
                            onPress={() => handleImprimirActaGuardada(a)}
                            style={{
                              paddingHorizontal: 9,
                              paddingVertical: 6,
                              borderRadius: radius.sm,
                              backgroundColor: c.primary,
                            }}
                          >
                            <Text style={{ color: c.primaryContrast, fontSize: 10, fontWeight: '900' }}>🖨️ PDF / REIMPRIMIR</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleCargarParaEditar(a, false)}
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 6,
                              borderRadius: radius.sm,
                              backgroundColor: c.surfaceAlt,
                              borderWidth: 1,
                              borderColor: c.border,
                            }}
                          >
                            <Text style={{ color: c.text, fontSize: 10, fontWeight: '800' }}>✎ EDITAR</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleCargarParaEditar(a, true)}
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 6,
                              borderRadius: radius.sm,
                              backgroundColor: c.surfaceAlt,
                              borderWidth: 1,
                              borderColor: c.border,
                            }}
                          >
                            <Text style={{ color: c.primary, fontSize: 10, fontWeight: '800' }}>📋 REUSAR</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleAnular(a)}
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 6,
                              borderRadius: radius.sm,
                              backgroundColor: c.danger + '18',
                              borderWidth: 1,
                              borderColor: c.danger,
                            }}
                          >
                            <Text style={{ color: c.danger, fontSize: 10, fontWeight: '800' }}>🚫 ANULAR</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* SELECTOR DE TIPO DE ACTA: ENTREGA VS RECEPCIÓN / DEVOLUCIÓN */}
            <Text style={{ color: c.muted, fontSize: 10, fontWeight: '800', marginBottom: 4 }}>
              ¿QUÉ DOCUMENTO DESEAS EMITIR O REGISTRAR?
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <TouchableOpacity
                onPress={() => {
                  if (tipoActa !== 'entrega') {
                    resetForm('entrega', actasGuardadas);
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 230,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: radius.md,
                  borderWidth: 2,
                  borderColor: !esModoRecepcion ? c.primary : c.border,
                  backgroundColor: !esModoRecepcion ? c.primary + '18' : c.surfaceAlt,
                }}
              >
                <Text style={{ color: !esModoRecepcion ? c.primary : c.text, fontSize: 12, fontWeight: '900' }}>
                  📤 ACTA DE ENTREGA / COMPROMISO
                </Text>
                <Text style={{ color: c.muted, fontSize: 10, marginTop: 2 }}>
                  Cuando entregas herramientas o implementos al trabajador y asume custodia.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  if (tipoActa !== 'recepcion') {
                    if (actasEntregaExistentes.length > 0) {
                      iniciarRecepcionDesdeActa(actasEntregaExistentes[0], actasGuardadas);
                    } else {
                      resetForm('recepcion', actasGuardadas);
                    }
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 230,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: radius.md,
                  borderWidth: 2,
                  borderColor: esModoRecepcion ? '#0F766E' : c.border,
                  backgroundColor: esModoRecepcion ? '#0F766E18' : c.surfaceAlt,
                }}
              >
                <Text style={{ color: esModoRecepcion ? '#0F766E' : c.text, fontSize: 12, fontWeight: '900' }}>
                  📥 ACTA DE RECEPCIÓN / DEVOLUCIÓN
                </Text>
                <Text style={{ color: c.muted, fontSize: 10, marginTop: 2 }}>
                  Cuando el trabajador regresa lo entregado y registras en qué estado volvió.
                </Text>
              </TouchableOpacity>
            </View>

            {/* SI ESTÁ EN MODO RECEPCIÓN Y HAY ACTAS DE ENTREGA PREVIAS, OFRECER TRAER SUS ÍTEMS CON 1 TOQUE */}
            {esModoRecepcion && actasEntregaExistentes.length > 0 ? (
              <View
                style={{
                  backgroundColor: '#0F766E14',
                  borderRadius: radius.md,
                  padding: 10,
                  borderWidth: 1,
                  borderColor: '#0F766E55',
                  marginBottom: 10,
                }}
              >
                <Text style={{ color: '#0F766E', fontSize: 11, fontWeight: '900', marginBottom: 4 }}>
                  🔗 CARGAR IMPLEMENTOS DESDE UN ACTA DE ENTREGA DEL TRABAJADOR:
                </Text>
                <Text style={{ color: c.muted, fontSize: 10, marginBottom: 6 }}>
                  Toca un acta de entrega para traer automáticamente todas las herramientas que se le dieron y solo marcar el estado en que regresaron:
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {actasEntregaExistentes.map((ae) => {
                    const selected = actaOrigenId === ae.id || (actaOrigenCodigo && actaOrigenCodigo === ae.codigo);
                    return (
                      <TouchableOpacity
                        key={ae.id}
                        onPress={() => iniciarRecepcionDesdeActa(ae, actasGuardadas)}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: radius.sm,
                          backgroundColor: selected ? '#0F766E' : c.surface,
                          borderWidth: 1,
                          borderColor: selected ? '#0F766E' : c.border,
                        }}
                      >
                        <Text style={{ color: selected ? '#fff' : c.text, fontSize: 10, fontWeight: '800' }}>
                          {selected ? '✓ ' : '📥 '}
                          {ae.codigo} ({ae.fecha_entrega}) · {(ae.items || []).length} ítem(s)
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  {actaOrigenCodigo ? (
                    <TouchableOpacity
                      onPress={() => {
                        setActaOrigenId(null);
                        setActaOrigenCodigo('');
                        setFechaEntregaOrigen('');
                      }}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 6,
                        borderRadius: radius.sm,
                        backgroundColor: c.surface,
                        borderWidth: 1,
                        borderColor: c.border,
                      }}
                    >
                      <Text style={{ color: c.muted, fontSize: 10, fontWeight: '800' }}>✕ Llenar sin acta previa</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* SECCIÓN 2: DATOS DEL ENCABEZADO Y MEMBRETE */}
            <Text style={{ color: esModoRecepcion ? '#0F766E' : c.primary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>
              {editingId
                ? `✏️ EDITANDO ACTA ${esModoRecepcion ? 'DE RECEPCIÓN' : 'DE COMPROMISO'}`
                : esModoRecepcion
                  ? '➕ NUEVA ACTA DE RECEPCIÓN Y DEVOLUCIÓN DE HERRAMIENTAS'
                  : '➕ NUEVA ACTA DE COMPROMISO Y ENTREGA'}
            </Text>

            <Text style={{ color: c.muted, fontSize: 10, fontWeight: '800', marginBottom: 4 }}>
              MEMBRETE DEL DOCUMENTO
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {MEMBRETES_CONSTANCIA.map((m) => {
                const active = membreteKey === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    onPress={() => setMembreteKey(m.key)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: active ? c.primary : c.border,
                      backgroundColor: active ? c.primary : c.surfaceAlt,
                    }}
                  >
                    <Text style={{ color: active ? c.primaryContrast : c.text, fontWeight: '800', fontSize: 11 }}>
                      {m.chip}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <View style={{ flex: 1, minWidth: 150 }}>
                <Text style={{ color: c.muted, fontSize: 10, fontWeight: '800', marginBottom: 3 }}>
                  {esModoRecepcion ? 'CÓDIGO ACTA RECEPCIÓN' : 'CÓDIGO DE ACTA'}
                </Text>
                <TextInput
                  value={actCode}
                  onChangeText={setActCode}
                  placeholder={esModoRecepcion ? 'AR-HER-2026-001' : 'AC-HER-2026-001'}
                  placeholderTextColor={c.muted}
                  style={{
                    color: c.text,
                    backgroundColor: c.surfaceAlt,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: radius.md,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    fontSize: 12,
                    fontWeight: '700',
                  }}
                />
              </View>
              <View style={{ flex: 1, minWidth: 135 }}>
                <Text style={{ color: c.muted, fontSize: 10, fontWeight: '800', marginBottom: 3 }}>
                  {esModoRecepcion ? 'FECHA DE RECEPCIÓN' : 'FECHA DE ENTREGA'}
                </Text>
                <TextInput
                  value={actDate}
                  onChangeText={setActDate}
                  placeholder="AAAA-MM-DD"
                  placeholderTextColor={c.muted}
                  style={{
                    color: c.text,
                    backgroundColor: c.surfaceAlt,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: radius.md,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    fontSize: 12,
                  }}
                />
              </View>
              <View style={{ flex: 1.5, minWidth: 190 }}>
                <Text style={{ color: c.muted, fontSize: 10, fontWeight: '800', marginBottom: 3 }}>LUGAR / OBRA</Text>
                <TextInput
                  value={lugar}
                  onChangeText={setLugar}
                  placeholder="CAMURI CHICO, EDO. LA GUAIRA"
                  placeholderTextColor={c.muted}
                  style={{
                    color: c.text,
                    backgroundColor: c.surfaceAlt,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: radius.md,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    fontSize: 12,
                  }}
                />
              </View>
            </View>

            {/* MOTIVO Y REFERENCIA CUANDO ES ACTA DE RECEPCIÓN */}
            {esModoRecepcion ? (
              <View
                style={{
                  backgroundColor: c.surfaceAlt,
                  borderRadius: radius.md,
                  padding: 8,
                  borderWidth: 1,
                  borderColor: c.border,
                  marginBottom: 10,
                }}
              >
                <Text style={{ color: c.muted, fontSize: 10, fontWeight: '800', marginBottom: 4 }}>
                  📋 MOTIVO DE LA DEVOLUCIÓN / RECEPCIÓN Y ACTA DE REFERENCIA
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                  {MOTIVOS_RECEPCION_ACTA.map((mot) => {
                    const act = motivoRecepcion === mot;
                    return (
                      <TouchableOpacity
                        key={mot}
                        onPress={() => setMotivoRecepcion(mot)}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: radius.sm,
                          backgroundColor: act ? '#0F766E' : c.surface,
                          borderWidth: 1,
                          borderColor: act ? '#0F766E' : c.border,
                        }}
                      >
                        <Text style={{ color: act ? '#fff' : c.text, fontSize: 10, fontWeight: '800' }}>{mot}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <TextInput
                    value={motivoRecepcion}
                    onChangeText={setMotivoRecepcion}
                    placeholder="Motivo de devolución (ej. Fin de relación laboral, cambio de cargo, cierre de turno...)"
                    placeholderTextColor={c.muted}
                    style={{
                      flex: 1.5,
                      minWidth: 200,
                      color: c.text,
                      backgroundColor: c.surface,
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: radius.sm,
                      paddingHorizontal: 8,
                      paddingVertical: 6,
                      fontSize: 11,
                    }}
                  />
                  <TextInput
                    value={actaOrigenCodigo}
                    onChangeText={setActaOrigenCodigo}
                    placeholder="Acta entrega origen (ej. AC-HER-2026-001)"
                    placeholderTextColor={c.muted}
                    style={{
                      flex: 1,
                      minWidth: 160,
                      color: c.text,
                      backgroundColor: c.surface,
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: radius.sm,
                      paddingHorizontal: 8,
                      paddingVertical: 6,
                      fontSize: 11,
                    }}
                  />
                </View>
              </View>
            ) : null}

            {/* RESPONSABLE QUE ENTREGA O RECIBE */}
            <View
              style={{
                backgroundColor: c.surfaceAlt,
                borderRadius: radius.md,
                padding: 8,
                borderWidth: 1,
                borderColor: c.border,
                marginBottom: 10,
              }}
            >
              <Text style={{ color: c.muted, fontSize: 10, fontWeight: '800', marginBottom: 4 }}>
                {esModoRecepcion
                  ? '👤 RESPONSABLE QUE RECIBE LA DEVOLUCIÓN (ALMACÉN / RRHH / SUPERVISOR)'
                  : '👤 RESPONSABLE DE LA ENTREGA (ALMACÉN / RRHH / SUPERVISOR)'}
              </Text>
              {allEmployees.length > 0 ? (
                <View style={{ marginBottom: 6 }}>
                  <TextInput
                    value={buscarEntregador}
                    onChangeText={setBuscarEntregador}
                    placeholder={
                      esModoRecepcion
                        ? '🔍 Buscar en el personal para autocompletar quién recibe...'
                        : '🔍 Buscar en el personal para autocompletar quién entrega...'
                    }
                    placeholderTextColor={c.muted}
                    style={{
                      color: c.text,
                      backgroundColor: c.surface,
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: radius.sm,
                      paddingHorizontal: 8,
                      paddingVertical: 5,
                      fontSize: 11,
                    }}
                  />
                  {empleadosCoincidentes.length > 0 ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {empleadosCoincidentes.map((e) => (
                        <TouchableOpacity
                          key={e.id}
                          onPress={() => {
                            setEntregadoPorNombre(fullName(e).toUpperCase());
                            setEntregadoPorCargo((e.cargo || 'SUPERVISOR / ALMACÉN').toUpperCase());
                            setBuscarEntregador('');
                          }}
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: radius.sm,
                            backgroundColor: c.primary + '22',
                            borderWidth: 1,
                            borderColor: c.primary,
                          }}
                        >
                          <Text style={{ color: c.primary, fontSize: 10, fontWeight: '800' }}>
                            + {fullName(e)} ({e.cargo || 'Sin cargo'})
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <TextInput
                  value={entregadoPorNombre}
                  onChangeText={setEntregadoPorNombre}
                  placeholder={esModoRecepcion ? 'Nombre y Apellido de quien recibe' : 'Nombre y Apellido de quien entrega'}
                  placeholderTextColor={c.muted}
                  style={{
                    flex: 1,
                    minWidth: 180,
                    color: c.text,
                    backgroundColor: c.surface,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: radius.sm,
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                    fontSize: 12,
                  }}
                />
                <TextInput
                  value={entregadoPorCargo}
                  onChangeText={setEntregadoPorCargo}
                  placeholder="Cargo (ej. Jefe de Almacén, RRHH)"
                  placeholderTextColor={c.muted}
                  style={{
                    flex: 1,
                    minWidth: 180,
                    color: c.text,
                    backgroundColor: c.surface,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: radius.sm,
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                    fontSize: 12,
                  }}
                />
              </View>
            </View>

            {/* SECCIÓN 3: HERRAMIENTAS / IMPLEMENTOS ENTREGADOS O RECIBIDOS */}
            <View
              style={{
                backgroundColor: c.surfaceAlt,
                borderRadius: radius.md,
                padding: 10,
                borderWidth: 1,
                borderColor: c.border,
                marginBottom: 10,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                <Text style={{ color: esModoRecepcion ? '#0F766E' : c.primary, fontSize: 11, fontWeight: '900' }}>
                  {esModoRecepcion
                    ? '📥 HERRAMIENTAS / IMPLEMENTOS DEVUELTOS Y ESTADO EN QUE REGRESARON'
                    : '🛠️ HERRAMIENTAS, EQUIPOS E IMPLEMENTOS ENTREGADOS'}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {esModoRecepcion ? (
                    <TouchableOpacity
                      onPress={marcarTodoConforme}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: radius.sm,
                        backgroundColor: '#16a34a22',
                        borderWidth: 1,
                        borderColor: '#16a34a',
                      }}
                    >
                      <Text style={{ color: '#15803D', fontSize: 10, fontWeight: '900' }}>
                        ✅ Todo regresó completo y en buen estado
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {totalReposicion > 0 ? (
                    <Text style={{ color: c.text, fontSize: 11, fontWeight: '900' }}>
                      Valor reposición: <Text style={{ color: c.primary }}>${totalReposicion.toFixed(2)} USD</Text>
                    </Text>
                  ) : null}
                  {esModoRecepcion && totalCargosRecepcion > 0 ? (
                    <Text style={{ color: c.danger, fontSize: 11, fontWeight: '900' }}>
                      Total cargo por daño/extravío: ${totalCargosRecepcion.toFixed(2)} USD
                    </Text>
                  ) : null}
                </View>
              </View>

              <Text style={{ color: c.muted, fontSize: 10, marginBottom: 4 }}>
                {esModoRecepcion
                  ? 'Agrega o verifica los implementos que el trabajador está devolviendo y marca en qué estado físico regresó cada uno:'
                  : 'Toca un implemento frecuente para agregarlo rápido o escríbelo abajo:'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {HERRAMIENTAS_SUGERIDAS.map((sug, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => agregarSugerido(sug)}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: radius.sm,
                      backgroundColor: c.surface,
                      borderWidth: 1,
                      borderColor: c.border,
                    }}
                  >
                    <Text style={{ color: c.text, fontSize: 10, fontWeight: '700' }}>+ {sug.nombre}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {items.map((it, idx) => {
                const cargoSug = esModoRecepcion
                  ? calcularCargoSugeridoItem({
                      cantidad: it.cantidad,
                      cantidad_devuelta: it.cantidad_devuelta,
                      estado_retorno: it.estado_retorno,
                      valor_usd: it.valor_usd,
                    })
                  : 0;
                return (
                  <View
                    key={idx}
                    style={{
                      backgroundColor: c.surface,
                      borderRadius: radius.sm,
                      padding: 8,
                      borderWidth: 1,
                      borderColor:
                        esModoRecepcion &&
                        (it.estado_retorno === 'DAÑADO / AVERIADO' ||
                          it.estado_retorno === 'EXTRAVIADO / NO DEVUELTO' ||
                          it.estado_retorno === 'INCOMPLETO')
                          ? '#fca5a5'
                          : c.border,
                      marginBottom: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Text style={{ color: c.primary, fontWeight: '900', fontSize: 11, width: 20 }}>{idx + 1}.</Text>
                      <TextInput
                        value={it.nombre}
                        onChangeText={(v) => actualizarItem(idx, { nombre: v })}
                        placeholder="Descripción de herramienta / equipo / EPP"
                        placeholderTextColor={c.muted}
                        style={{
                          flex: 2,
                          minWidth: 170,
                          color: c.text,
                          backgroundColor: c.surfaceAlt,
                          borderWidth: 1,
                          borderColor: c.border,
                          borderRadius: radius.sm,
                          paddingHorizontal: 8,
                          paddingVertical: 5,
                          fontSize: 12,
                          fontWeight: '700',
                        }}
                      />
                      <View style={{ alignItems: 'center' }}>
                        {esModoRecepcion ? (
                          <Text style={{ color: c.muted, fontSize: 8, fontWeight: '800' }}>ENTREG.</Text>
                        ) : null}
                        <TextInput
                          value={it.cantidad}
                          onChangeText={(v) => actualizarItem(idx, { cantidad: v })}
                          placeholder="Cant."
                          keyboardType="decimal-pad"
                          placeholderTextColor={c.muted}
                          style={{
                            width: 56,
                            color: c.text,
                            backgroundColor: c.surfaceAlt,
                            borderWidth: 1,
                            borderColor: c.border,
                            borderRadius: radius.sm,
                            paddingHorizontal: 6,
                            paddingVertical: 5,
                            fontSize: 12,
                            textAlign: 'center',
                          }}
                        />
                      </View>
                      {esModoRecepcion ? (
                        <View style={{ alignItems: 'center' }}>
                          <Text style={{ color: '#0F766E', fontSize: 8, fontWeight: '900' }}>DEVUELTO</Text>
                          <TextInput
                            value={it.cantidad_devuelta}
                            onChangeText={(v) => actualizarItem(idx, { cantidad_devuelta: v })}
                            placeholder="Dev."
                            keyboardType="decimal-pad"
                            placeholderTextColor={c.muted}
                            style={{
                              width: 58,
                              color: c.text,
                              backgroundColor: '#F0FDFA',
                              borderWidth: 1,
                              borderColor: '#0F766E',
                              borderRadius: radius.sm,
                              paddingHorizontal: 6,
                              paddingVertical: 5,
                              fontSize: 12,
                              fontWeight: '800',
                              textAlign: 'center',
                            }}
                          />
                        </View>
                      ) : null}
                      <TextInput
                        value={it.serial}
                        onChangeText={(v) => actualizarItem(idx, { serial: v })}
                        placeholder="Serial / Marca / Talla"
                        placeholderTextColor={c.muted}
                        style={{
                          flex: 1,
                          minWidth: 115,
                          color: c.text,
                          backgroundColor: c.surfaceAlt,
                          borderWidth: 1,
                          borderColor: c.border,
                          borderRadius: radius.sm,
                          paddingHorizontal: 8,
                          paddingVertical: 5,
                          fontSize: 11,
                        }}
                      />
                      <TextInput
                        value={it.valor_usd}
                        onChangeText={(v) => actualizarItem(idx, { valor_usd: v })}
                        placeholder="Valor $ (opc.)"
                        keyboardType="decimal-pad"
                        placeholderTextColor={c.muted}
                        style={{
                          width: 90,
                          color: c.text,
                          backgroundColor: c.surfaceAlt,
                          borderWidth: 1,
                          borderColor: c.border,
                          borderRadius: radius.sm,
                          paddingHorizontal: 6,
                          paddingVertical: 5,
                          fontSize: 11,
                        }}
                      />
                      <TouchableOpacity
                        onPress={() => quitarItem(idx)}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 5,
                          borderRadius: radius.sm,
                          backgroundColor: c.danger + '18',
                        }}
                      >
                        <Text style={{ color: c.danger, fontSize: 11, fontWeight: '900' }}>✕</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                      <Text style={{ color: c.muted, fontSize: 10, fontWeight: '800' }}>
                        {esModoRecepcion ? 'Estado en que se entregó:' : 'Estado:'}
                      </Text>
                      {ESTADOS_ITEM.map((est) => {
                        const act = it.estado === est;
                        return (
                          <TouchableOpacity
                            key={est}
                            onPress={() => actualizarItem(idx, { estado: est })}
                            style={{
                              paddingHorizontal: 7,
                              paddingVertical: 3,
                              borderRadius: 4,
                              backgroundColor: act ? c.primary : c.surfaceAlt,
                              borderWidth: 1,
                              borderColor: act ? c.primary : c.border,
                            }}
                          >
                            <Text style={{ color: act ? c.primaryContrast : c.muted, fontSize: 9, fontWeight: '900' }}>
                              {est}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* BLOQUE EXCLUSIVO DE RECEPCIÓN: ESTADO EN QUE REGRESÓ + OBSERVACIÓN + CARGO */}
                    {esModoRecepcion ? (
                      <View
                        style={{
                          marginTop: 8,
                          paddingTop: 8,
                          borderTopWidth: 1,
                          borderTopColor: c.border,
                          gap: 6,
                        }}
                      >
                        <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Text style={{ color: '#0F766E', fontSize: 10, fontWeight: '900' }}>
                            📥 ¿En qué estado regresó?:
                          </Text>
                          {ESTADOS_RETORNO_HERRAMIENTA.map((er) => {
                            const active = it.estado_retorno === er.key;
                            return (
                              <TouchableOpacity
                                key={er.key}
                                onPress={() => actualizarItem(idx, { estado_retorno: er.key })}
                                style={{
                                  paddingHorizontal: 8,
                                  paddingVertical: 4,
                                  borderRadius: 5,
                                  backgroundColor: active ? er.bg : c.surfaceAlt,
                                  borderWidth: active ? 1.5 : 1,
                                  borderColor: active ? er.color : c.border,
                                }}
                              >
                                <Text
                                  style={{
                                    color: active ? er.color : c.text,
                                    fontSize: 9.5,
                                    fontWeight: active ? '900' : '700',
                                  }}
                                >
                                  {er.label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>

                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <TextInput
                            value={it.observacion_retorno}
                            onChangeText={(v) => actualizarItem(idx, { observacion_retorno: v })}
                            placeholder="Observación de cómo regresó (ej. completo y operativo, mango partido, falta cargador...)"
                            placeholderTextColor={c.muted}
                            style={{
                              flex: 2,
                              minWidth: 210,
                              color: c.text,
                              backgroundColor: c.surfaceAlt,
                              borderWidth: 1,
                              borderColor: c.border,
                              borderRadius: radius.sm,
                              paddingHorizontal: 8,
                              paddingVertical: 5,
                              fontSize: 11,
                            }}
                          />
                          <TextInput
                            value={it.cargo_usd}
                            onChangeText={(v) => actualizarItem(idx, { cargo_usd: v })}
                            placeholder="Cargo daño $ (0)"
                            keyboardType="decimal-pad"
                            placeholderTextColor={c.muted}
                            style={{
                              width: 115,
                              color: c.text,
                              backgroundColor: c.surfaceAlt,
                              borderWidth: 1,
                              borderColor: it.cargo_usd.trim() ? c.danger : c.border,
                              borderRadius: radius.sm,
                              paddingHorizontal: 8,
                              paddingVertical: 5,
                              fontSize: 11,
                            }}
                          />
                          {cargoSug > 0 && it.cargo_usd !== String(cargoSug) ? (
                            <TouchableOpacity
                              onPress={() => actualizarItem(idx, { cargo_usd: String(cargoSug) })}
                              style={{
                                paddingHorizontal: 8,
                                paddingVertical: 5,
                                borderRadius: radius.sm,
                                backgroundColor: '#FEE2E2',
                                borderWidth: 1,
                                borderColor: '#B91C1C',
                              }}
                            >
                              <Text style={{ color: '#B91C1C', fontSize: 9.5, fontWeight: '900' }}>
                                Sugerido: ${cargoSug.toFixed(2)}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}

              <TouchableOpacity
                onPress={() => setItems((prev) => [...prev, emptyEditableItem()])}
                style={{
                  alignSelf: 'flex-start',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: radius.sm,
                  backgroundColor: c.primary + '22',
                  borderWidth: 1,
                  borderColor: c.primary,
                  marginTop: 2,
                }}
              >
                <Text style={{ color: c.primary, fontSize: 11, fontWeight: '900' }}>+ AGREGAR OTRO RENGLÓN</Text>
              </TouchableOpacity>
            </View>

            {/* RESUMEN DE CLÁUSULAS (EN ENTREGA) O RESUMEN DE SOLVENCIA (EN RECEPCIÓN) */}
            <View
              style={{
                backgroundColor: c.surfaceAlt,
                borderRadius: radius.md,
                padding: 10,
                borderWidth: 1,
                borderColor: c.border,
                marginBottom: 10,
              }}
            >
              {esModoRecepcion ? (
                <>
                  <Text style={{ color: '#0F766E', fontSize: 11, fontWeight: '900', marginBottom: 4 }}>
                    ⚖️ RESULTADO DE LA RECEPCIÓN Y SOLVENCIA (PAZ Y SALVO)
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 10, marginBottom: 6 }}>
                    Resumen actual: {resumenRetorno.totalDevueltos} de {resumenRetorno.totalEntregados} und. devueltas · 🟢 Buenos: {resumenRetorno.buenos} · 🟡 Desgaste: {resumenRetorno.desgaste} · 🟠 Incompletos: {resumenRetorno.incompletos} · 🔴 Dañados: {resumenRetorno.danados} · ⚫ Extraviados: {resumenRetorno.extraviados}
                    {totalCargosRecepcion > 0 ? ` · Cargo total: $${totalCargosRecepcion.toFixed(2)} USD` : ' · Sin cargos ($0.00)'}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                    {(
                      [
                        { key: 'CONFORME', label: '✅ CONFORME / PAZ Y SALVO', color: '#15803D', bg: '#DCFCE7' },
                        { key: 'CON_NOVEDAD', label: '⚠️ CON NOVEDAD (DAÑO / FALTANTE / EXTRAVÍO)', color: '#B91C1C', bg: '#FEE2E2' },
                        { key: 'PARCIAL', label: '⏳ DEVOLUCIÓN PARCIAL', color: '#B45309', bg: '#FEF3C7' },
                      ] as const
                    ).map((opt) => {
                      const active = resultadoRecepcionActual === opt.key;
                      return (
                        <TouchableOpacity
                          key={opt.key}
                          onPress={() => setResultadoOverride(opt.key)}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: radius.sm,
                            backgroundColor: active ? opt.bg : c.surface,
                            borderWidth: active ? 1.5 : 1,
                            borderColor: active ? opt.color : c.border,
                          }}
                        >
                          <Text style={{ color: active ? opt.color : c.text, fontSize: 10, fontWeight: '900' }}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              ) : (
                <>
                  <Text style={{ color: c.primary, fontSize: 11, fontWeight: '900', marginBottom: 4 }}>
                    ⚖️ CLÁUSULAS LEGALES INCLUIDAS EN EL ACTA IMPRESA / DIGITAL
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 10, lineHeight: 15 }}>
                    • <Text style={{ color: c.text, fontWeight: '800' }}>PRIMERA (Uso adecuado):</Text> Uso exclusivo para labores asignadas, prohibido préstamo a terceros.{'\n'}
                    • <Text style={{ color: c.text, fontWeight: '800' }}>SEGUNDA (Cuidado y custodia):</Text> Guarda segura y notificación inmediata de fallas al supervisor/almacén.{'\n'}
                    • <Text style={{ color: c.text, fontWeight: '800' }}>TERCERA (Aceptación de responsabilidad):</Text> Devolución obligatoria al requerimiento o al finalizar relación laboral.{'\n'}
                    • <Text style={{ color: c.text, fontWeight: '800' }}>CUARTA (Autorización de deducción salarial):</Text> Autorización expresa para descontar de salario, bonificaciones o liquidación el valor de reposición en caso de daño intencional, negligencia o extravío atribuible al trabajador.
                  </Text>
                </>
              )}

              <Text style={{ color: c.muted, fontSize: 10, fontWeight: '800', marginTop: 8, marginBottom: 3 }}>
                {esModoRecepcion
                  ? 'OBSERVACIONES GENERALES DE LA RECEPCIÓN / ESTADO DE DEVOLUCIÓN (OPCIONAL)'
                  : 'OBSERVACIONES GENERALES DE LA ENTREGA (OPCIONAL)'}
              </Text>
              <TextInput
                value={observaciones}
                onChangeText={setObservaciones}
                multiline
                placeholder={
                  esModoRecepcion
                    ? 'Observaciones sobre el estado en que regresaron las herramientas, acuerdos de reposición o solvencia...'
                    : 'Observaciones adicionales (ej. el equipo debe entregarse al finalizar el turno)...'
                }
                placeholderTextColor={c.muted}
                style={{
                  color: c.text,
                  backgroundColor: c.surface,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: radius.sm,
                  padding: 8,
                  minHeight: 46,
                  textAlignVertical: 'top',
                  fontSize: 11,
                }}
              />
            </View>

            {/* SECCIÓN 4: FIRMAS DIGITALES Y FOTO DE SOPORTE (CÁMARA + GALERÍA) */}
            <View
              style={{
                backgroundColor: c.surfaceAlt,
                borderRadius: radius.md,
                padding: 10,
                borderWidth: 1,
                borderColor: c.border,
                marginBottom: 10,
              }}
            >
              <Text style={{ color: c.primary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>
                ✍️ FIRMA DIGITAL EN PANTALLA Y FOTO DE SOPORTE
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                {/* Firma del trabajador */}
                <View
                  style={{
                    flex: 1,
                    minWidth: 210,
                    backgroundColor: c.surface,
                    borderRadius: radius.sm,
                    padding: 8,
                    borderWidth: 1,
                    borderColor: employeeSignatureUrl ? '#16a34a' : c.border,
                  }}
                >
                  <Text style={{ color: c.text, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>
                    {esModoRecepcion
                      ? `Firma del Trabajador que devuelve (${fullName(emp)})`
                      : `Firma del Trabajador (${fullName(emp)})`}
                  </Text>
                  {employeeSignatureUrl ? (
                    <View style={{ alignItems: 'center', marginBottom: 6 }}>
                      <Image
                        source={{ uri: employeeSignatureUrl }}
                        style={{ width: 180, height: 65, resizeMode: 'contain', backgroundColor: '#fff', borderRadius: 4 }}
                      />
                    </View>
                  ) : (
                    <Text style={{ color: c.muted, fontSize: 10, marginBottom: 6 }}>
                      Sin firma digital registrada (puede firmar en pantalla o imprimir para firma en físico).
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => setSigTarget('worker')}
                      style={{
                        flex: 1,
                        paddingVertical: 6,
                        borderRadius: radius.sm,
                        backgroundColor: c.primary,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: c.primaryContrast, fontSize: 10, fontWeight: '900' }}>
                        ✍️ {employeeSignatureUrl ? 'CAMBIAR FIRMA' : 'FIRMAR EN PANTALLA'}
                      </Text>
                    </TouchableOpacity>
                    {employeeSignatureUrl ? (
                      <TouchableOpacity
                        onPress={() => setEmployeeSignatureUrl('')}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          borderRadius: radius.sm,
                          backgroundColor: c.danger + '22',
                        }}
                      >
                        <Text style={{ color: c.danger, fontSize: 10, fontWeight: '900' }}>✕</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                {/* Firma de quien entrega o recibe */}
                <View
                  style={{
                    flex: 1,
                    minWidth: 210,
                    backgroundColor: c.surface,
                    borderRadius: radius.sm,
                    padding: 8,
                    borderWidth: 1,
                    borderColor: delivererSignatureUrl ? '#16a34a' : c.border,
                  }}
                >
                  <Text style={{ color: c.text, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>
                    {esModoRecepcion
                      ? `Firma de Quien Recibe (${entregadoPorNombre || 'Responsable'})`
                      : `Firma de Quien Entrega (${entregadoPorNombre || 'Responsable'})`}
                  </Text>
                  {delivererSignatureUrl ? (
                    <View style={{ alignItems: 'center', marginBottom: 6 }}>
                      <Image
                        source={{ uri: delivererSignatureUrl }}
                        style={{ width: 180, height: 65, resizeMode: 'contain', backgroundColor: '#fff', borderRadius: 4 }}
                      />
                    </View>
                  ) : (
                    <Text style={{ color: c.muted, fontSize: 10, marginBottom: 6 }}>
                      Sin firma digital registrada.
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => setSigTarget('deliverer')}
                      style={{
                        flex: 1,
                        paddingVertical: 6,
                        borderRadius: radius.sm,
                        backgroundColor: c.surfaceAlt,
                        borderWidth: 1,
                        borderColor: c.primary,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: c.primary, fontSize: 10, fontWeight: '900' }}>
                        ✍️ {delivererSignatureUrl ? 'CAMBIAR FIRMA' : esModoRecepcion ? 'FIRMAR RECEPCIÓN' : 'FIRMAR ENTREGA'}
                      </Text>
                    </TouchableOpacity>
                    {delivererSignatureUrl ? (
                      <TouchableOpacity
                        onPress={() => setDelivererSignatureUrl('')}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          borderRadius: radius.sm,
                          backgroundColor: c.danger + '22',
                        }}
                      >
                        <Text style={{ color: c.danger, fontSize: 10, fontWeight: '900' }}>✕</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </View>

              {/* Foto de evidencia (Cámara + Galería obligatorios) */}
              <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border }}>
                <Text style={{ color: c.muted, fontSize: 10, fontWeight: '800', marginBottom: 4 }}>
                  {esModoRecepcion
                    ? '📸 FOTO DE EVIDENCIA (ESTADO EN QUE REGRESARON LOS IMPLEMENTOS O ACTA FIRMADA):'
                    : '📸 FOTO DE EVIDENCIA (ENTREGA DE IMPLEMENTOS O ACTA FIRMADA EN FÍSICO):'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <TouchableOpacity
                    disabled={uploadingPhoto}
                    onPress={() => handleEvidenciaFoto('camera')}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: radius.sm,
                      backgroundColor: c.surface,
                      borderWidth: 1,
                      borderColor: c.border,
                    }}
                  >
                    <Text style={{ color: c.text, fontSize: 11, fontWeight: '800' }}>📷 Cámara</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={uploadingPhoto}
                    onPress={() => handleEvidenciaFoto('gallery')}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: radius.sm,
                      backgroundColor: c.surface,
                      borderWidth: 1,
                      borderColor: c.border,
                    }}
                  >
                    <Text style={{ color: c.text, fontSize: 11, fontWeight: '800' }}>🖼️ Galería</Text>
                  </TouchableOpacity>
                  {photoUrl ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Image source={{ uri: photoUrl }} style={{ width: 42, height: 42, borderRadius: 4 }} />
                      <TouchableOpacity onPress={() => setPhotoUrl('')}>
                        <Text style={{ color: c.danger, fontSize: 11, fontWeight: '800' }}>Quitar foto</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </ScrollView>

          {/* BOTONES DE ACCIÓN INFERIORES */}
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              marginTop: 10,
              paddingTop: 10,
              borderTopWidth: 1,
              borderTopColor: c.border,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            <TouchableOpacity
              onPress={async () => {
                const html = construirHtml(true);
                const prefix = esModoRecepcion ? 'Planilla_Acta_Recepcion' : 'Planilla_Acta_Compromiso';
                await exportPdf(html, `${prefix}_${fullName(emp).replace(/\s+/g, '_')}`);
              }}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: radius.md,
                backgroundColor: c.surfaceAlt,
                borderWidth: 1,
                borderColor: c.border,
              }}
            >
              <Text style={{ color: c.muted, fontWeight: '800', fontSize: 11 }}>
                📄 IMPRIMIR PLANILLA EN BLANCO
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={saving}
              onPress={() => handleGuardar(false)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: radius.md,
                backgroundColor: c.surfaceAlt,
                borderWidth: 1,
                borderColor: esModoRecepcion ? '#0F766E' : c.primary,
              }}
            >
              <Text style={{ color: esModoRecepcion ? '#0F766E' : c.primary, fontWeight: '900', fontSize: 11 }}>
                💾 {saving ? 'GUARDANDO...' : editingId ? 'GUARDAR CAMBIOS' : 'SOLO GUARDAR EN EXPEDIENTE'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={saving}
              onPress={() => handleGuardar(true)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: radius.md,
                backgroundColor: esModoRecepcion ? '#0F766E' : c.primary,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11 }}>
                🖨️ {saving ? 'GUARDANDO...' : esModoRecepcion ? 'GUARDAR RECEPCIÓN E IMPRIMIR PDF' : 'GUARDAR EN EXPEDIENTE E IMPRIMIR PDF'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* PIZARRA DE FIRMA DIGITAL */}
        <SignaturePadModal
          visible={sigTarget !== null}
          title={
            sigTarget === 'worker'
              ? `FIRMA DEL TRABAJADOR: ${fullName(emp).toUpperCase()}`
              : esModoRecepcion
                ? `FIRMA DE QUIEN RECIBE: ${(entregadoPorNombre || 'RESPONSABLE').toUpperCase()}`
                : `FIRMA DE QUIEN ENTREGA: ${(entregadoPorNombre || 'RESPONSABLE').toUpperCase()}`
          }
          subtitle={
            esModoRecepcion
              ? 'Al firmar se deja constancia de la devolución de los implementos y del estado físico en que fueron recibidos.'
              : 'Al firmar declara haber recibido los implementos y aceptar las cláusulas de uso, custodia y deducción por daño o extravío.'
          }
          folderKey={`actas_firmas/${emp.id}_${sigTarget || 'sig'}`}
          onClose={() => setSigTarget(null)}
          onSaveSignature={(uri) => {
            if (sigTarget === 'worker') setEmployeeSignatureUrl(uri);
            else if (sigTarget === 'deliverer') setDelivererSignatureUrl(uri);
          }}
        />
      </View>
    </Modal>
  );
}
