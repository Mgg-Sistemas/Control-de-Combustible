// MODAL DE CARTA DE AUTORIZACIÓN PARA USO DE CUENTA BANCARIA DE TERCERO (13-nov-2026)
//
// Diseñado para verse y usarse con total comodidad en TELÉFONO (< 768px) y en PC (>= 768px):
// 1. Permite configurar los datos bancarios de la persona tercera (nombre completo, cédula,
//    parentesco/vínculo, banco con buscador, tipo de cuenta, número de cuenta de 20 dígitos
//    y Pago Móvil opcional), sincronizando automáticamente `bank_name`, `bank_account`,
//    `bank_holder` y `bank_cedula` en la ficha de `employees`.
// 2. Permite firmar digitalmente en pantalla (trabajador y tercero titular) o subir foto
//    de firma con 📷 Cámara / 🖼️ Galería.
// 3. Permite subir 1 o varios soportes digitales de la carta firmada / copia de cédula
//    con 📷 Cámara, 🖼️ Galería o 📄 Subir PDF.
// 4. Genera e imprime el PDF tamaño Carta con elección de membrete/logo y casillas de
//    «qué sale y qué se oculta» (o planilla en blanco para llenado manual en campo).

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  Linking,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Employee } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { DateField } from './DateField';
import { SignaturePadModal } from './SignaturePadModal';
import { fullName } from '../lib/carnet';
import { canonicalCargo } from '../lib/cargos';
import { norm, onlyDigits } from '../lib/text';
import { MEMBRETES_CONSTANCIA, MEMBRETE_POR_DEFECTO } from '../lib/constancia';
import { formatearSalarioSemanalReporte } from '../lib/empleadosReporte';
import { exportPdf } from '../lib/pdf';
import {
  takePhotoAndUpload,
  pickPhotoAndUpload,
  takeAndUploadDocPhoto,
  pickAndUploadDocFiles,
} from '../lib/photo';
import {
  BANCOS_VE_LIST,
  TIPOS_CUENTA_TERCERO,
  PARENTESCOS_TERCERO,
  MOTIVOS_AUTORIZACION_TERCERO,
  MOTIVO_AUTORIZACION_DEFECTO,
  TipoCuentaTercero,
  SoporteCartaBancoTercero,
  CartaBancoTerceroData,
  OpcionesCartaBancoTercero,
  OPCIONES_CARTA_BANCO_TERCERO_DEFECTO,
  MapaCartasBancoTercero,
  normalizarCartaBancoTercero,
  estadoCartaBancoTercero,
  generarCodigoCartaBancoTercero,
  generarCartaBancoTerceroHtml,
  nombreArchivoCartaBancoTercero,
} from '../lib/cartaBancoTercero';
import { guardarCartaBancoTerceroEmpleado } from '../lib/cartaBancoTerceroStorage';

type Props = {
  visible: boolean;
  emp: Employee | null;
  cartaActual?: CartaBancoTerceroData | null;
  currentUserName?: string | null;
  onClose: () => void;
  onSaved?: (res: { carta: CartaBancoTerceroData; mapa: MapaCartasBancoTercero }) => void;
};

export function CartaBancoTerceroModal({
  visible,
  emp,
  cartaActual,
  currentUserName,
  onClose,
  onSaved,
}: Props) {
  const { colors: c } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { width } = useWindowDimensions();
  const esPc = width >= 768;

  const [esTercero, setEsTercero] = useState<boolean>(true);
  const [codigo, setCodigo] = useState<string>('');
  const [fechaAutorizacion, setFechaAutorizacion] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [lugar, setLugar] = useState<string>('CAMURI CHICO, EDO. LA GUAIRA');
  const [membreteKey, setMembreteKey] = useState<string>(MEMBRETE_POR_DEFECTO.key);

  const [bancoNombre, setBancoNombre] = useState<string>('');
  const [bancoOpen, setBancoOpen] = useState<boolean>(false);
  const [bancoQ, setBancoQ] = useState<string>('');

  const [tipoCuenta, setTipoCuenta] = useState<TipoCuentaTercero>('corriente');
  const [numeroCuenta, setNumeroCuenta] = useState<string>('');
  const [titularNombre, setTitularNombre] = useState<string>('');
  const [titularCedula, setTitularCedula] = useState<string>('');
  const [titularTelefono, setTitularTelefono] = useState<string>('');
  const [parentesco, setParentesco] = useState<string>('Esposo(a) / Concubino(a)');

  const [pagoMovilBanco, setPagoMovilBanco] = useState<string>('');
  const [pagoMovilTelefono, setPagoMovilTelefono] = useState<string>('');
  const [pagoMovilCedula, setPagoMovilCedula] = useState<string>('');

  const [motivo, setMotivo] = useState<string>(MOTIVO_AUTORIZACION_DEFECTO);
  const [observaciones, setObservaciones] = useState<string>('');
  const [testigoNombre, setTestigoNombre] = useState<string>('');
  const [testigoCedula, setTestigoCedula] = useState<string>('');
  const [autorizadoEnRrhhPor, setAutorizadoEnRrhhPor] = useState<string>('');

  const [firmaTrabajadorUrl, setFirmaTrabajadorUrl] = useState<string>('');
  const [firmaTerceroUrl, setFirmaTerceroUrl] = useState<string>('');
  const [soportes, setSoportes] = useState<SoporteCartaBancoTercero[]>([]);

  const [opcionesPdfOpen, setOpcionesPdfOpen] = useState<boolean>(false);
  const [opcionesPdf, setOpcionesPdf] = useState<OpcionesCartaBancoTercero>(OPCIONES_CARTA_BANCO_TERCERO_DEFECTO);

  const [sigTarget, setSigTarget] = useState<'worker' | 'third_party' | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !emp) return;
    const normCarta = normalizarCartaBancoTercero(cartaActual ?? emp.carta_banco_tercero, emp);
    // Si se abre el modal de Carta de Banco de Tercero, por defecto activamos el modo tercero
    // salvo que el usuario lo cambie explícitamente a cuenta propia.
    setEsTercero(true);
    setCodigo(normCarta.codigo || generarCodigoCartaBancoTercero(emp.cedula));
    setFechaAutorizacion(normCarta.fechaAutorizacion || new Date().toISOString().slice(0, 10));
    setLugar(normCarta.lugar || 'CAMURI CHICO, EDO. LA GUAIRA');
    setMembreteKey(normCarta.membreteKey || MEMBRETE_POR_DEFECTO.key);
    setBancoNombre(normCarta.bancoNombre || emp.bank_name || '');
    setBancoOpen(false);
    setBancoQ('');
    setTipoCuenta(normCarta.tipoCuenta || 'corriente');
    setNumeroCuenta(normCarta.numeroCuenta || emp.bank_account || '');
    // Si el titular actual de la ficha es el mismo trabajador y aún no hay tercero configurado,
    // dejamos el titular listo para escribir el nombre del tercero.
    const mismoTitular =
      norm(normCarta.titularNombre) === norm(fullName(emp)) &&
      onlyDigits(normCarta.titularCedula) === onlyDigits(emp.cedula || '');
    setTitularNombre(mismoTitular && !cartaActual?.esTercero ? '' : normCarta.titularNombre);
    setTitularCedula(mismoTitular && !cartaActual?.esTercero ? '' : normCarta.titularCedula);
    setTitularTelefono(normCarta.titularTelefono || '');
    setParentesco(normCarta.parentesco || 'Esposo(a) / Concubino(a)');
    setPagoMovilBanco(normCarta.pagoMovilBanco || '');
    setPagoMovilTelefono(normCarta.pagoMovilTelefono || '');
    setPagoMovilCedula(normCarta.pagoMovilCedula || '');
    setMotivo(normCarta.motivo || MOTIVO_AUTORIZACION_DEFECTO);
    setObservaciones(normCarta.observaciones || '');
    setTestigoNombre(normCarta.testigoNombre || '');
    setTestigoCedula(normCarta.testigoCedula || '');
    setAutorizadoEnRrhhPor(normCarta.autorizadoEnRrhhPor || currentUserName || '');
    setFirmaTrabajadorUrl(normCarta.firmaTrabajadorUrl || '');
    setFirmaTerceroUrl(normCarta.firmaTerceroUrl || '');
    setSoportes(normCarta.soportes || []);
  }, [visible, emp?.id, cartaActual]);

  const bancosFiltrados = useMemo(() => {
    const q = norm(bancoQ.trim());
    if (!q) return BANCOS_VE_LIST;
    return BANCOS_VE_LIST.filter((b) => norm(b).includes(q));
  }, [bancoQ]);

  if (!emp) return null;

  const construirCartaActual = (): CartaBancoTerceroData => ({
    esTercero,
    codigo: codigo.trim() || generarCodigoCartaBancoTercero(emp.cedula, fechaAutorizacion),
    fechaAutorizacion: fechaAutorizacion.trim() || new Date().toISOString().slice(0, 10),
    lugar: lugar.trim() || 'CAMURI CHICO, EDO. LA GUAIRA',
    membreteKey,
    bancoNombre: bancoNombre.trim(),
    numeroCuenta: numeroCuenta.trim(),
    tipoCuenta,
    titularNombre: esTercero ? titularNombre.trim() : fullName(emp),
    titularCedula: esTercero ? titularCedula.trim() : (emp.cedula || ''),
    titularTelefono: titularTelefono.trim() || null,
    parentesco: esTercero ? parentesco.trim() : '',
    pagoMovilBanco: pagoMovilBanco.trim() || null,
    pagoMovilTelefono: pagoMovilTelefono.trim() || null,
    pagoMovilCedula: pagoMovilCedula.trim() || null,
    motivo: motivo.trim() || MOTIVO_AUTORIZACION_DEFECTO,
    observaciones: observaciones.trim() || null,
    testigoNombre: testigoNombre.trim() || null,
    testigoCedula: testigoCedula.trim() || null,
    autorizadoEnRrhhPor: autorizadoEnRrhhPor.trim() || null,
    firmaTrabajadorUrl: firmaTrabajadorUrl || null,
    firmaTerceroUrl: firmaTerceroUrl || null,
    soportes,
    updatedBy: currentUserName || null,
  });

  const estadoActual = estadoCartaBancoTercero(emp, construirCartaActual());
  const digitosCuenta = onlyDigits(numeroCuenta).length;

  const abrirUrl = (url: string) => {
    if (!url) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      Linking.openURL(url).catch(() => toast.error('No se pudo abrir el documento.'));
    }
  };

  const handleSubirFotoFirma = async (quien: 'worker' | 'third_party', origen: 'camara' | 'galeria') => {
    setUploading(`firma-${quien}-${origen}`);
    const folder = `cartas_banco_tercero_firmas_${quien}`;
    const res =
      origen === 'camara'
        ? await takePhotoAndUpload(emp.id, folder)
        : await pickPhotoAndUpload(emp.id, folder);
    setUploading(null);
    if (!res.ok) {
      if (res.error) toast.error(res.error);
      return;
    }
    if (res.url) {
      if (quien === 'worker') setFirmaTrabajadorUrl(res.url);
      else setFirmaTerceroUrl(res.url);
      toast.success('✅ Imagen de firma cargada.');
    }
  };

  const handleSubirSoporteCamara = async () => {
    setUploading('soporte-camara');
    const res = await takeAndUploadDocPhoto('cartas_banco_tercero', emp.id);
    setUploading(null);
    if (!res.ok) {
      if (res.error) toast.error(res.error);
      return;
    }
    if (res.url) {
      const nuevo: SoporteCartaBancoTercero = {
        id: `sop_${Date.now()}`,
        url: res.url,
        nombre: res.name || `Carta_firmada_${soportes.length + 1}.jpg`,
        tipo: 'image',
        fecha: new Date().toISOString().slice(0, 10),
        subidoPor: currentUserName || null,
      };
      setSoportes((prev) => [...prev, nuevo]);
      toast.success('📷 Foto de soporte agregada a la carta.');
    }
  };

  const handleSubirSoportesArchivos = async () => {
    setUploading('soporte-archivos');
    const res = await pickAndUploadDocFiles('cartas_banco_tercero', emp.id);
    setUploading(null);
    if (!res.ok) {
      if (res.error) toast.error(res.error);
      return;
    }
    if (res.files && res.files.length > 0) {
      const hoy = new Date().toISOString().slice(0, 10);
      const nuevos: SoporteCartaBancoTercero[] = res.files.map((f, i) => ({
        id: `sop_${Date.now()}_${i}`,
        url: f.url,
        nombre: f.name || (f.kind === 'pdf' ? `Carta_firmada_${soportes.length + i + 1}.pdf` : `Soporte_${soportes.length + i + 1}.jpg`),
        tipo: f.kind,
        fecha: hoy,
        subidoPor: currentUserName || null,
      }));
      setSoportes((prev) => [...prev, ...nuevos]);
      toast.success(`📎 ${nuevos.length} soporte(s) agregado(s) al expediente.`);
    }
  };

  const handleQuitarSoporte = async (sop: SoporteCartaBancoTercero) => {
    const ok = await confirm({
      title: 'Quitar documento adjunto',
      message: `¿Quitar "${sop.nombre}" de la carta de autorización de ${fullName(emp)}?`,
      confirmText: 'Quitar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    setSoportes((prev) => prev.filter((x) => x.id !== sop.id));
  };

  const handleImprimirPdf = async (cartaOverride?: CartaBancoTerceroData) => {
    const carta = cartaOverride ?? construirCartaActual();
    const memb = MEMBRETES_CONSTANCIA.find((m) => m.key === carta.membreteKey) ?? MEMBRETE_POR_DEFECTO;
    const html = generarCartaBancoTerceroHtml({
      trabajadorNombre: fullName(emp),
      trabajadorCedula: emp.cedula,
      trabajadorCargo: emp.cargo ? canonicalCargo(emp.cargo) : null,
      trabajadorDepartamento: emp.department,
      trabajadorFicha: emp.ficha_number,
      trabajadorFechaIngreso: emp.hire_date,
      trabajadorTelefono: emp.phone,
      trabajadorSalarioTexto: formatearSalarioSemanalReporte(emp),
      carta,
      membrete: memb,
      opciones: opcionesPdf,
    });
    const fileName = nombreArchivoCartaBancoTercero(fullName(emp), memb, opcionesPdf);
    await exportPdf(html, fileName);
  };

  const handleGuardar = async (imprimirDespues: boolean) => {
    if (esTercero) {
      if (!titularNombre.trim()) {
        toast.error('Escribe el nombre y apellido del tercero titular de la cuenta.');
        return;
      }
      if (!titularCedula.trim()) {
        toast.error('Escribe la cédula de identidad del tercero titular.');
        return;
      }
      if (!bancoNombre.trim() && !pagoMovilBanco.trim()) {
        toast.error('Selecciona o escribe el banco del tercero.');
        return;
      }
      if (tipoCuenta !== 'pago_movil' && !numeroCuenta.trim() && !pagoMovilTelefono.trim()) {
        toast.error('Indica el número de cuenta bancaria o los datos de Pago Móvil.');
        return;
      }
    }

    const carta = construirCartaActual();
    setSaving(true);
    const res = await guardarCartaBancoTerceroEmpleado({
      employeeId: emp.id,
      carta,
      sincronizarColumnasBanco: true,
    });
    setSaving(false);

    if (!res.ok) {
      toast.error(res.error || 'No se pudo guardar la autorización bancaria.');
      return;
    }

    toast.success(
      esTercero
        ? `✅ Autorización de banco de tercero guardada para ${fullName(emp)}.`
        : `✅ Datos de cuenta propia actualizados para ${fullName(emp)}.`
    );
    onSaved?.({ carta: res.carta, mapa: res.mapa });

    if (imprimirDespues) {
      await handleImprimirPdf(res.carta);
    } else {
      onClose();
    }
  };

  const lbl = { color: c.muted, fontSize: 12, fontWeight: '700' as const, marginTop: spacing.sm, marginBottom: 4 };
  const inp = {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: Platform.OS === 'web' ? 9 : 8,
    color: c.text,
    fontSize: 13.5,
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.68)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: esPc ? spacing.md : spacing.xs,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 880,
            maxHeight: '95%',
            backgroundColor: c.background,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: c.border,
            overflow: 'hidden',
          }}
        >
          {/* CABECERA */}
          <View
            style={{
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: c.surface,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.sm,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '900', fontSize: esPc ? 16 : 14 }}>
                🤝 Carta de Autorización — Banco de Tercero
              </Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>
                👷 {fullName(emp)} {emp.cedula ? `· C.I. ${emp.cedula}` : ''} {emp.cargo ? `· ${canonicalCargo(emp.cargo)}` : ''}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: radius.pill,
                backgroundColor: c.surfaceAlt,
                borderWidth: 1,
                borderColor: c.border,
              }}
            >
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>✕ Cerrar</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }} keyboardShouldPersistTaps="handled">
            {/* BANNER DE ESTADO EN VIVO */}
            <View
              style={{
                padding: spacing.sm,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor:
                  estadoActual.tono === 'success'
                    ? '#16A34A'
                    : estadoActual.tono === 'warning'
                      ? '#D97706'
                      : c.border,
                backgroundColor:
                  estadoActual.tono === 'success'
                    ? 'rgba(22, 163, 74, 0.10)'
                    : estadoActual.tono === 'warning'
                      ? 'rgba(217, 119, 6, 0.10)'
                      : c.surfaceAlt,
                marginBottom: spacing.sm,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: spacing.xs,
              }}
            >
              <View style={{ flex: 1, minWidth: 200 }}>
                <Text
                  style={{
                    color:
                      estadoActual.tono === 'success'
                        ? '#15803D'
                        : estadoActual.tono === 'warning'
                          ? '#B45309'
                          : c.text,
                    fontWeight: '900',
                    fontSize: 13,
                  }}
                >
                  {estadoActual.etiqueta}
                </Text>
                <Text style={{ color: c.muted, fontSize: 11.5, marginTop: 2 }}>
                  Al guardar aquí, los datos del titular y número de cuenta se actualizan automáticamente en la ficha del trabajador, en Pago a Personal, Pago por Persona y Excel bancario.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleImprimirPdf()}
                style={{
                  backgroundColor: '#1E3A5F',
                  paddingHorizontal: spacing.md,
                  paddingVertical: 8,
                  borderRadius: radius.md,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>🖨️ Vista previa / PDF</Text>
              </TouchableOpacity>
            </View>

            {/* INTERRUPTOR: CUENTA DE TERCERO vs CUENTA PROPIA */}
            <Text style={{ color: c.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 }}>
              ¿A quién pertenece la cuenta donde cobra el trabajador?
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
              <TouchableOpacity
                onPress={() => setEsTercero(true)}
                style={{
                  flex: 1,
                  minWidth: 220,
                  paddingVertical: 10,
                  paddingHorizontal: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 2,
                  borderColor: esTercero ? c.primary : c.border,
                  backgroundColor: esTercero ? c.primary : c.surface,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: esTercero ? c.primaryContrast : c.text, fontWeight: '900', fontSize: 13 }}>
                  🤝 Cuenta de un Tercero (Familiar / Otra persona)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setEsTercero(false);
                  setTitularNombre(fullName(emp));
                  setTitularCedula(emp.cedula || '');
                  setParentesco('');
                }}
                style={{
                  flex: 1,
                  minWidth: 220,
                  paddingVertical: 10,
                  paddingHorizontal: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 2,
                  borderColor: !esTercero ? '#16A34A' : c.border,
                  backgroundColor: !esTercero ? '#16A34A' : c.surface,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: !esTercero ? '#fff' : c.text, fontWeight: '900', fontSize: 13 }}>
                  👤 Cuenta Propia del Trabajador ({fullName(emp)})
                </Text>
              </TouchableOpacity>
            </View>

            {/* SECCIÓN 1: DATOS DEL TERCERO TITULAR */}
            {esTercero ? (
              <View
                style={{
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: c.surfaceAlt,
                  marginBottom: spacing.sm,
                }}
              >
                <Text style={{ color: c.primary, fontWeight: '900', fontSize: 13.5, marginBottom: 4 }}>
                  1. Datos de la Persona Titular de la Cuenta (Tercero Autorizado)
                </Text>

                <View style={{ flexDirection: esPc ? 'row' : 'column', gap: spacing.sm }}>
                  <View style={{ flex: 2 }}>
                    <Text style={lbl}>Nombre y Apellido del Titular (Tercero) *</Text>
                    <TextInput
                      value={titularNombre}
                      onChangeText={setTitularNombre}
                      placeholder="Ej. MARÍA RODRÍGUEZ"
                      placeholderTextColor={c.muted}
                      style={inp}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={lbl}>Cédula del Titular (C.I. / RIF) *</Text>
                    <TextInput
                      value={titularCedula}
                      onChangeText={setTitularCedula}
                      placeholder="Ej. V-14.555.888"
                      placeholderTextColor={c.muted}
                      style={inp}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={lbl}>Teléfono del Titular (opcional)</Text>
                    <TextInput
                      value={titularTelefono}
                      onChangeText={setTitularTelefono}
                      placeholder="Ej. 0412-0000000"
                      placeholderTextColor={c.muted}
                      keyboardType="phone-pad"
                      style={inp}
                    />
                  </View>
                </View>

                <Text style={lbl}>Parentesco o vínculo con el trabajador (toca uno o escríbelo) *</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {PARENTESCOS_TERCERO.map((par) => {
                    const sel = norm(parentesco) === norm(par);
                    return (
                      <TouchableOpacity
                        key={par}
                        onPress={() => setParentesco(par)}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: radius.pill,
                          borderWidth: 1,
                          borderColor: sel ? c.primary : c.border,
                          backgroundColor: sel ? c.primary : c.surface,
                        }}
                      >
                        <Text style={{ color: sel ? c.primaryContrast : c.text, fontWeight: '800', fontSize: 11.5 }}>
                          {sel ? '✓ ' : ''}{par}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  value={parentesco}
                  onChangeText={setParentesco}
                  placeholder="Parentesco o vínculo (ej. Esposa, Madre, Hermano…)"
                  placeholderTextColor={c.muted}
                  style={inp}
                />
              </View>
            ) : null}

            {/* SECCIÓN 2: DATOS BANCARIOS Y PAGO MÓVIL */}
            <View
              style={{
                padding: spacing.sm,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.surfaceAlt,
                marginBottom: spacing.sm,
              }}
            >
              <Text style={{ color: c.primary, fontWeight: '900', fontSize: 13.5, marginBottom: 4 }}>
                2. Datos Bancarios de la Cuenta Autorizada
              </Text>

              <Text style={lbl}>Modalidad / Tipo de Cuenta</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {TIPOS_CUENTA_TERCERO.map((tc) => {
                  const on = tipoCuenta === tc.key;
                  return (
                    <TouchableOpacity
                      key={tc.key}
                      onPress={() => setTipoCuenta(tc.key)}
                      style={{
                        flexGrow: 1,
                        minWidth: 140,
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: on ? c.primary : c.border,
                        backgroundColor: on ? c.primary : c.surface,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: on ? c.primaryContrast : c.text, fontWeight: '800', fontSize: 12 }}>
                        {tc.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={lbl}>Banco *</Text>
              <TouchableOpacity
                onPress={() => setBancoOpen((v) => !v)}
                style={{
                  ...inp,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={{ color: bancoNombre ? c.text : c.muted, fontWeight: bancoNombre ? '800' : '400', flex: 1 }}>
                  🏦 {bancoNombre || 'Toca para elegir el banco de Venezuela…'}
                </Text>
                <Text style={{ color: c.primary, fontWeight: '900', fontSize: 12 }}>{bancoOpen ? '▲ Cerrar' : '▼ Elegir'}</Text>
              </TouchableOpacity>

              {bancoOpen ? (
                <View
                  style={{
                    marginTop: 6,
                    padding: spacing.xs,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: c.border,
                    backgroundColor: c.background,
                  }}
                >
                  <TextInput
                    value={bancoQ}
                    onChangeText={setBancoQ}
                    placeholder="🔎 Buscar banco por nombre o código (ej. 0102, Banesco, Mercantil)…"
                    placeholderTextColor={c.muted}
                    style={{ ...inp, marginBottom: 6 }}
                  />
                  <ScrollView style={{ maxHeight: 170 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {bancosFiltrados.map((b) => {
                        const sel = bancoNombre === b;
                        return (
                          <TouchableOpacity
                            key={b}
                            onPress={() => {
                              setBancoNombre(b);
                              if (!pagoMovilBanco) setPagoMovilBanco(b);
                              setBancoOpen(false);
                            }}
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              borderRadius: radius.pill,
                              borderWidth: 1,
                              borderColor: sel ? c.primary : c.border,
                              backgroundColor: sel ? c.primary : c.surface,
                            }}
                          >
                            <Text style={{ color: sel ? c.primaryContrast : c.text, fontWeight: '700', fontSize: 11.5 }}>
                              {b}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </ScrollView>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm, marginBottom: 4 }}>
                <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>N° de Cuenta Bancaria (20 dígitos)</Text>
                <Text
                  style={{
                    color: digitosCuenta === 20 ? '#16A34A' : digitosCuenta > 0 ? '#D97706' : c.muted,
                    fontSize: 11,
                    fontWeight: '800',
                  }}
                >
                  {digitosCuenta}/20 dígitos
                </Text>
              </View>
              <TextInput
                value={numeroCuenta}
                onChangeText={setNumeroCuenta}
                placeholder="0102-0000-00-0000000000"
                placeholderTextColor={c.muted}
                keyboardType="numeric"
                style={{ ...inp, fontWeight: '800', letterSpacing: 0.6 }}
              />

              {/* PAGO MÓVIL OPCIONAL O CUANDO APLIQUE */}
              <View style={{ marginTop: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: c.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <Text style={{ color: c.text, fontSize: 12.5, fontWeight: '800' }}>
                    📲 Datos de Pago Móvil del Tercero (opcional)
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setPagoMovilBanco(bancoNombre);
                      setPagoMovilCedula(titularCedula);
                      if (titularTelefono) setPagoMovilTelefono(titularTelefono);
                      toast.success('Datos copiados a Pago Móvil.');
                    }}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: radius.pill,
                      backgroundColor: c.surface,
                      borderWidth: 1,
                      borderColor: c.primary,
                    }}
                  >
                    <Text style={{ color: c.primary, fontSize: 11, fontWeight: '800' }}>
                      ⚡ Copiar banco, cédula y teléfono del titular
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ flexDirection: esPc ? 'row' : 'column', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={lbl}>Teléfono Pago Móvil</Text>
                    <TextInput
                      value={pagoMovilTelefono}
                      onChangeText={setPagoMovilTelefono}
                      placeholder="Ej. 0414-1234567"
                      placeholderTextColor={c.muted}
                      keyboardType="phone-pad"
                      style={inp}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={lbl}>Cédula Pago Móvil</Text>
                    <TextInput
                      value={pagoMovilCedula}
                      onChangeText={setPagoMovilCedula}
                      placeholder={titularCedula || 'Ej. V-14.555.888'}
                      placeholderTextColor={c.muted}
                      style={inp}
                    />
                  </View>
                  <View style={{ flex: 1.3 }}>
                    <Text style={lbl}>Banco Pago Móvil</Text>
                    <TextInput
                      value={pagoMovilBanco}
                      onChangeText={setPagoMovilBanco}
                      placeholder={bancoNombre || 'Ej. 0102 - BANCO DE VENEZUELA'}
                      placeholderTextColor={c.muted}
                      style={inp}
                    />
                  </View>
                </View>
              </View>
            </View>

            {/* SECCIÓN 3: MOTIVO Y DATOS DEL DOCUMENTO */}
            {esTercero ? (
              <View
                style={{
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: c.surfaceAlt,
                  marginBottom: spacing.sm,
                }}
              >
                <Text style={{ color: c.primary, fontWeight: '900', fontSize: 13.5, marginBottom: 4 }}>
                  3. Motivo de la Solicitud y Control de RRHH
                </Text>

                <Text style={lbl}>Motivo por el que autoriza cuenta de tercero (toca uno o edítalo)</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {MOTIVOS_AUTORIZACION_TERCERO.map((m) => {
                    const sel = norm(motivo) === norm(m);
                    return (
                      <TouchableOpacity
                        key={m}
                        onPress={() => setMotivo(m)}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: radius.pill,
                          borderWidth: 1,
                          borderColor: sel ? c.primary : c.border,
                          backgroundColor: sel ? c.primary : c.surface,
                        }}
                      >
                        <Text style={{ color: sel ? c.primaryContrast : c.text, fontWeight: '700', fontSize: 11 }}>
                          {sel ? '✓ ' : ''}{m}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  value={motivo}
                  onChangeText={setMotivo}
                  placeholder="Describe el motivo de la autorización…"
                  placeholderTextColor={c.muted}
                  style={inp}
                />

                <View style={{ flexDirection: esPc ? 'row' : 'column', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={lbl}>Fecha de autorización</Text>
                    <DateField value={fechaAutorizacion} onChange={setFechaAutorizacion} />
                  </View>
                  <View style={{ flex: 1.5 }}>
                    <Text style={lbl}>Lugar de emisión</Text>
                    <TextInput value={lugar} onChangeText={setLugar} placeholder="CAMURI CHICO, EDO. LA GUAIRA" placeholderTextColor={c.muted} style={inp} />
                  </View>
                  <View style={{ flex: 1.5 }}>
                    <Text style={lbl}>Verificado en RRHH / Nómina por</Text>
                    <TextInput value={autorizadoEnRrhhPor} onChangeText={setAutorizadoEnRrhhPor} placeholder="Nombre de quien recibe" placeholderTextColor={c.muted} style={inp} />
                  </View>
                </View>

                <View style={{ flexDirection: esPc ? 'row' : 'column', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={lbl}>Testigo (opcional)</Text>
                    <TextInput value={testigoNombre} onChangeText={setTestigoNombre} placeholder="Nombre del testigo" placeholderTextColor={c.muted} style={inp} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={lbl}>Cédula del testigo (opcional)</Text>
                    <TextInput value={testigoCedula} onChangeText={setTestigoCedula} placeholder="C.I. del testigo" placeholderTextColor={c.muted} style={inp} />
                  </View>
                  <View style={{ flex: 1.5 }}>
                    <Text style={lbl}>Observaciones adicionales (opcional)</Text>
                    <TextInput value={observaciones} onChangeText={setObservaciones} placeholder="Notas internas o aclaratorias" placeholderTextColor={c.muted} style={inp} />
                  </View>
                </View>
              </View>
            ) : null}

            {/* SECCIÓN 4: FIRMAS Y DOCUMENTOS ESCANEADOS (CÁMARA + GALERÍA + PDF) */}
            {esTercero ? (
              <View
                style={{
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: c.surfaceAlt,
                  marginBottom: spacing.sm,
                }}
              >
                <Text style={{ color: c.primary, fontWeight: '900', fontSize: 13.5, marginBottom: 4 }}>
                  4. Firmas y Soportes de la Carta Firmada (Expediente Digital)
                </Text>
                <Text style={{ color: c.muted, fontSize: 11.5, marginBottom: spacing.xs }}>
                  Puedes imprimir la carta para que el trabajador la firme y ponga su huella, y luego subir la foto o el PDF firmado aquí; o bien firmar directamente en la pantalla del teléfono/PC.
                </Text>

                {/* SUBIDA DE CARTA FIRMADA / CÉDULA DEL TITULAR */}
                <View
                  style={{
                    padding: spacing.sm,
                    borderRadius: radius.md,
                    backgroundColor: c.surface,
                    borderWidth: 1,
                    borderColor: c.border,
                    marginBottom: spacing.sm,
                  }}
                >
                  <Text style={{ color: c.text, fontWeight: '800', fontSize: 12.5, marginBottom: 6 }}>
                    📎 Soportes Adjuntos (Carta firmada, foto con la carta, copia de C.I. del titular): {soportes.length} archivo(s)
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    <TouchableOpacity
                      disabled={!!uploading}
                      onPress={handleSubirSoporteCamara}
                      style={{
                        flexGrow: 1,
                        minWidth: 150,
                        backgroundColor: '#0F766E',
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: radius.md,
                        alignItems: 'center',
                        opacity: uploading ? 0.6 : 1,
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
                        {uploading === 'soporte-camara' ? 'Subiendo foto…' : '📷 Tomar Foto (Cámara)'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      disabled={!!uploading}
                      onPress={handleSubirSoportesArchivos}
                      style={{
                        flexGrow: 1,
                        minWidth: 180,
                        backgroundColor: '#2563EB',
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: radius.md,
                        alignItems: 'center',
                        opacity: uploading ? 0.6 : 1,
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
                        {uploading === 'soporte-archivos' ? 'Subiendo archivo(s)…' : '🖼️ Galería / 📄 Subir PDF (1 o varios)'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {soportes.length > 0 ? (
                    <View style={{ marginTop: spacing.sm, gap: 6 }}>
                      {soportes.map((sop) => (
                        <View
                          key={sop.id}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: 8,
                            borderRadius: radius.sm,
                            backgroundColor: c.surfaceAlt,
                            borderWidth: 1,
                            borderColor: c.border,
                            gap: 8,
                          }}
                        >
                          <TouchableOpacity onPress={() => abrirUrl(sop.url)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text style={{ fontSize: 16 }}>{sop.tipo === 'pdf' ? '📄' : '🖼️'}</Text>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: c.primary, fontWeight: '800', fontSize: 12 }} numberOfLines={1}>
                                {sop.nombre}
                              </Text>
                              <Text style={{ color: c.muted, fontSize: 10.5 }}>
                                {sop.fecha}{sop.subidoPor ? ` · Subido por ${sop.subidoPor}` : ''} · Toca para abrir
                              </Text>
                            </View>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleQuitarSoporte(sop)}
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 5,
                              borderRadius: radius.sm,
                              backgroundColor: 'rgba(220,38,38,0.12)',
                            }}
                          >
                            <Text style={{ color: c.danger, fontWeight: '800', fontSize: 11 }}>🗑️ Quitar</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>

                {/* FIRMA DIGITAL DEL TRABAJADOR Y DEL TERCERO */}
                <View style={{ flexDirection: esPc ? 'row' : 'column', gap: spacing.sm }}>
                  {/* Firma Trabajador */}
                  <View style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
                    <Text style={{ color: c.text, fontWeight: '800', fontSize: 12, marginBottom: 6 }}>
                      ✍️ Firma del Trabajador ({fullName(emp)})
                    </Text>
                    {firmaTrabajadorUrl ? (
                      <View style={{ alignItems: 'center', marginBottom: 6 }}>
                        <Image source={{ uri: firmaTrabajadorUrl }} style={{ width: 180, height: 60, resizeMode: 'contain', backgroundColor: '#fff', borderRadius: 4 }} />
                        <TouchableOpacity onPress={() => setFirmaTrabajadorUrl('')} style={{ marginTop: 4 }}>
                          <Text style={{ color: c.danger, fontSize: 11, fontWeight: '700' }}>🗑️ Quitar firma</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => setSigTarget('worker')}
                        style={{ flex: 1, minWidth: 110, backgroundColor: c.primary, paddingVertical: 7, borderRadius: radius.sm, alignItems: 'center' }}
                      >
                        <Text style={{ color: c.primaryContrast, fontWeight: '800', fontSize: 11 }}>✍️ Firmar en pantalla</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleSubirFotoFirma('worker', 'camara')}
                        style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border }}
                      >
                        <Text style={{ color: c.text, fontWeight: '700', fontSize: 11 }}>📷 Cámara</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleSubirFotoFirma('worker', 'galeria')}
                        style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border }}
                      >
                        <Text style={{ color: c.text, fontWeight: '700', fontSize: 11 }}>🖼️ Galería</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Firma Tercero Titular */}
                  <View style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
                    <Text style={{ color: c.text, fontWeight: '800', fontSize: 12, marginBottom: 6 }}>
                      ✍️ Firma del Titular de la Cuenta (opcional)
                    </Text>
                    {firmaTerceroUrl ? (
                      <View style={{ alignItems: 'center', marginBottom: 6 }}>
                        <Image source={{ uri: firmaTerceroUrl }} style={{ width: 180, height: 60, resizeMode: 'contain', backgroundColor: '#fff', borderRadius: 4 }} />
                        <TouchableOpacity onPress={() => setFirmaTerceroUrl('')} style={{ marginTop: 4 }}>
                          <Text style={{ color: c.danger, fontSize: 11, fontWeight: '700' }}>🗑️ Quitar firma</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => setSigTarget('third_party')}
                        style={{ flex: 1, minWidth: 110, backgroundColor: c.primary, paddingVertical: 7, borderRadius: radius.sm, alignItems: 'center' }}
                      >
                        <Text style={{ color: c.primaryContrast, fontWeight: '800', fontSize: 11 }}>✍️ Firmar en pantalla</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleSubirFotoFirma('third_party', 'camara')}
                        style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border }}
                      >
                        <Text style={{ color: c.text, fontWeight: '700', fontSize: 11 }}>📷 Cámara</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleSubirFotoFirma('third_party', 'galeria')}
                        style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border }}
                      >
                        <Text style={{ color: c.text, fontWeight: '700', fontSize: 11 }}>🖼️ Galería</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            ) : null}

            {/* SECCIÓN 5: MEMBRETE Y QUÉ SALE EN EL PAPEL PDF */}
            <View
              style={{
                padding: spacing.sm,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.surfaceAlt,
                marginBottom: spacing.sm,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Text style={{ color: c.primary, fontWeight: '900', fontSize: 13.5 }}>
                  🏢 Membrete y Opciones del PDF Imprimible
                </Text>
                <TouchableOpacity
                  onPress={() => setOpcionesPdfOpen((v) => !v)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: c.primary,
                    backgroundColor: c.surface,
                  }}
                >
                  <Text style={{ color: c.primary, fontWeight: '800', fontSize: 11.5 }}>
                    ⚙️ Personalizar qué sale en el papel {opcionesPdfOpen ? '▲' : '▼'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {MEMBRETES_CONSTANCIA.map((mb) => {
                  const on = membreteKey === mb.key;
                  return (
                    <TouchableOpacity
                      key={mb.key}
                      onPress={() => setMembreteKey(mb.key)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: on ? c.primary : c.border,
                        backgroundColor: on ? c.primary : c.surface,
                      }}
                    >
                      <Text style={{ color: on ? c.primaryContrast : c.text, fontWeight: '800', fontSize: 11.5 }}>
                        {mb.chip}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {opcionesPdfOpen ? (
                <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.border, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {(
                    [
                      ['mostrarLogo', '🖼️ Logo de la empresa'],
                      ['mostrarCargoYDepartamento', '🏷️ Cargo y departamento'],
                      ['mostrarFechaIngreso', '📅 Fecha de ingreso'],
                      ['mostrarSalario', '💵 Remuneración de referencia'],
                      ['mostrarPagoMovil', '📲 Fila de Pago Móvil'],
                      ['mostrarClausulaLiberacion', '⚖️ Cláusula de liberación de pago'],
                      ['mostrarRecuadroHuella', '☝️ Recuadro de huella dactilar'],
                      ['mostrarFirmaTercero', '✍️ Casilla firma del tercero'],
                      ['mostrarTestigo', '👁️ Casilla de testigo'],
                      ['mostrarRecepcionRrhh', '🏢 Casilla recepción RRHH'],
                      ['mostrarSoportesAdjuntos', '📎 Anexar fotos de soportes al PDF'],
                      ['modoPlanillaEnBlanco', '📄 Imprimir como planilla en blanco (llenar a mano)'],
                    ] as const
                  ).map(([key, label]) => {
                    const activo = opcionesPdf[key];
                    return (
                      <TouchableOpacity
                        key={key}
                        onPress={() => setOpcionesPdf((prev) => ({ ...prev, [key]: !prev[key] }))}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: radius.md,
                          borderWidth: 1,
                          borderColor: activo ? c.primary : c.border,
                          backgroundColor: activo ? c.primary + '18' : c.surface,
                        }}
                      >
                        <Text style={{ color: activo ? c.primary : c.muted, fontWeight: '800', fontSize: 11.5 }}>
                          {activo ? '☑️ ' : '⬜ '}{label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </View>
          </ScrollView>

          {/* PIE DE ACCIONES FIJO (TELÉFONO Y PC) */}
          <View
            style={{
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: c.surface,
              borderTopWidth: 1,
              borderTopColor: c.border,
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              gap: spacing.xs,
            }}
          >
            <TouchableOpacity
              onPress={onClose}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.surfaceAlt,
              }}
            >
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 12 }}>Cancelar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleImprimirPdf()}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: '#1E3A5F',
                backgroundColor: c.surface,
              }}
            >
              <Text style={{ color: '#1E3A5F', fontWeight: '900', fontSize: 12 }}>📄 Solo Imprimir PDF</Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={saving}
              onPress={() => handleGuardar(false)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: c.primary,
                backgroundColor: c.surface,
                opacity: saving ? 0.6 : 1,
              }}
            >
              <Text style={{ color: c.primary, fontWeight: '900', fontSize: 12 }}>
                💾 {saving ? 'Guardando…' : 'Guardar Autorización'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={saving}
              onPress={() => handleGuardar(true)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: radius.md,
                backgroundColor: '#0F766E',
                opacity: saving ? 0.6 : 1,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>
                🖨️ {saving ? 'Guardando…' : 'Guardar e Imprimir Carta PDF'}
              </Text>
            </TouchableOpacity>
          </View>

          <SignaturePadModal
            visible={sigTarget !== null}
            title={
              sigTarget === 'worker'
                ? `FIRMA DEL TRABAJADOR: ${fullName(emp).toUpperCase()}`
                : `FIRMA DEL TERCERO TITULAR: ${(titularNombre || 'TITULAR').toUpperCase()}`
            }
            subtitle="Al firmar autoriza expresamente el pago de salarios y beneficios laborales en la cuenta bancaria del tercero indicada en esta carta."
            folderKey={`cartas_banco_tercero_firmas/${emp.id}_${sigTarget || 'sig'}`}
            onClose={() => setSigTarget(null)}
            onSaveSignature={(uri) => {
              if (sigTarget === 'worker') setFirmaTrabajadorUrl(uri);
              else if (sigTarget === 'third_party') setFirmaTerceroUrl(uri);
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

