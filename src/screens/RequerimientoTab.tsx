// ── Requerimiento de compra ──────────────────────────────────────────────────
// Lista de productos (del inventario o NUEVOS) que se pasa al jefe para que
// APRUEBE o RECHACE la compra. Vive en el módulo COMPRAS (antes en Inventario).
// Si se aprueba con proveedor → genera orden + cuenta por pagar (trigger de BD
// `req_sync_compra`). Si se compra, se RECIBE en el inventario (genera entradas
// con el precio real). La recepción de stock sigue necesitando permiso de
// inventario. Solo los administradores aprueban/rechazan.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Platform, Image, Linking } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, ExpandableCard, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { norm, onlyDecimal } from '../lib/text';
import { leerNumero } from '../lib/numeros';
import { InventoryRequirement, RequirementLine, InventoryLevel, Company, Supplier, RequirementStatus } from '../types/database';
import { exportPdf, urlToDataUri } from '../lib/pdf';
import { pickAndUploadRequirementFile, captureAndUploadPhoto } from '../lib/photo';
import { requerimientoHtml, requerimientosBulkHtml, requerimientosResumenHtml, ReqPdfData } from '../lib/requerimiento';
// 👤 Quién solicitó / quién autorizó, para qué (vehículo o maquinaria), a qué
//    área, y las observaciones del final (20-oct-2026, a pedido).
import { PersonaNominaPicker } from '../components/PersonaNominaPicker';
import {
  areasSugeridas, camposRequerimiento, contactoDesdeNombre, destinoLabel, personasDeNomina,
  DESTINOS, SIN_PERSONA, faltaColumnaNueva,
  type PersonaElegida, type PersonaNomina,
} from '../lib/requerimientoPersonas';
import { useBcvRate, bsFromUsd, usdFromBs, fmtBs } from '../lib/bcv';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();
// ⚠️ 19-sep-2026: antes botaba la coma («12,50» se guardaba como 1250). Ahora punto
//    y coma valen igual; la regla vive en src/lib/numeros.ts.
const parseNum = leerNumero;
const nowISO = () => new Date().toISOString();

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

type ReqRow = { key: string; product_id: string | null; name: string; unit: string; qty: string; price: string; currency: 'USD' | 'VES'; note: string; image_url: string };
const REQ_STATUS: Record<string, { label: string; color: string; short: string }> = {
  pendiente: { label: '⏳ Pendiente por aprobación del Gerente General', color: '#D97706', short: 'Pendiente' },
  aprobado: { label: '✅ Aprobado', color: '#2563EB', short: 'Aprobado' },
  rechazado: { label: '❌ Rechazado', color: '#DC2626', short: 'Rechazado' },
  recibido: { label: '📦 Recibido', color: '#16A34A', short: 'Recibido' },
  aclaratoria_solicitada: { label: '⚠️ Aclaratoria Técnica Solicitada', color: '#EA580C', short: 'En Aclaratoria' },
};
function nextReqCode(codes: (string | null | undefined)[], bump = 0): string {
  let max = 0;
  codes.forEach((c) => { const m = String(c ?? '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } });
  return 'REQ-' + String(max + 1 + bump).padStart(4, '0');
}
const dmyOf = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };

export function RequerimientoTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const { session, role, moduleLevel } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const isAdmin = role === 'admin';
  // Full control de Inventario (no solo admin) también puede marcar "Recibido" —
  // pedido directo del cliente (04/08/2026): que el permiso "todos los permisos de
  // inventario" alcance para cambiar ese estado, sin depender del rol.
  const canReceive = isAdmin || levelMeets(moduleLevel('inventario'), 'full');
  const uid = session?.user?.id ?? null;
  const { rate } = useBcvRate();
  const { data: reqs, loading, refetch } = useTable<InventoryRequirement>('inventory_requirements', { orderBy: 'created_at', ascending: false });
  // Filtro por estatus del requerimiento (+ "sin precio" para ubicar los que faltan cargar precio).
  const [filterStatus, setFilterStatus] = useState<'todos' | 'pendiente' | 'aprobado' | 'rechazado' | 'recibido' | 'sin_precio' | 'aclaratoria_solicitada'>('todos');
  const faltaPrecioDe = (r: InventoryRequirement) => r.items.some((it) => !(Number(it.est_price) > 0));
  // Búsqueda libre (código, título, nota, solicitante, empresa, nombre de los ítems) +
  // rango de fecha (por created_at, ISO AAAA-MM-DD) — se combinan con el filtro de estatus.
  const [listQuery, setListQuery] = useState('');
  const [reqDateFrom, setReqDateFrom] = useState('');
  const [reqDateTo, setReqDateTo] = useState('');
  // Selección manual (checkbox) para descargar en UN SOLO PDF a los elegidos; si no hay
  // ninguno seleccionado, el PDF por lote toma a TODOS los que quedaron filtrados.
  const [reqSelIds, setReqSelIds] = useState<Set<string>>(new Set());
  const toggleReqSel = (id: string) => setReqSelIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const { data: levels } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name', ascending: true });
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? null : null);
  // Proveedores del catálogo (para asignar al requerimiento — opcional).
  const { data: suppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });

  // Crear / editar requerimiento (editId != null → estamos editando ese requerimiento)
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null); // empresa del requerimiento
  const [supplierId, setSupplierId] = useState<string | null>(null); // proveedor (opcional) → orden + cuenta por pagar
  // 🏢 Empresa Pagadora (Fase previa a Tesorería)
  const [empresaPagadoraId, setEmpresaPagadoraId] = useState<string | null>(null);
  const [empresaPagadoraNombre, setEmpresaPagadoraNombre] = useState<string | null>(null);

  // 💳 Modal de edición rápida de datos de pago del proveedor en tiempo real
  const [modalPagoProvOpen, setModalPagoProvOpen] = useState(false);
  const [provParaPago, setProvParaPago] = useState<Supplier | null>(null);
  const [provBanco, setProvBanco] = useState('');
  const [provNumCuenta, setProvNumCuenta] = useState('');
  const [provTipoCuenta, setProvTipoCuenta] = useState('Corriente');
  const [provTitular, setProvTitular] = useState('');
  const [provDocTitular, setProvDocTitular] = useState('');
  const [provPagoMovilTel, setProvPagoMovilTel] = useState('');
  const [provPagoMovilDoc, setProvPagoMovilDoc] = useState('');
  const [provPagoMovilBanco, setProvPagoMovilBanco] = useState('');
  const [provBinanceId, setProvBinanceId] = useState('');
  const [provNotasPago, setProvNotasPago] = useState('');
  const [guardandoPagoProv, setGuardandoPagoProv] = useState(false);

  // 🔄 Ciclo de Retroalimentación Técnica (Bucle de Cotización)
  const [aclaratoriaOpen, setAclaratoriaOpen] = useState(false);
  const [aclaratoriaTarget, setAclaratoriaTarget] = useState<InventoryRequirement | null>(null);
  const [aclaratoriaMotivo, setAclaratoriaMotivo] = useState('');
  const [aclaratoriaBusy, setAclaratoriaBusy] = useState(false);

  // 📝 Responder Aclaratoria Técnica (Solicitante)
  const [respuestaOpen, setRespuestaOpen] = useState(false);
  const [respuestaTarget, setRespuestaTarget] = useState<InventoryRequirement | null>(null);
  const [respuestaTexto, setRespuestaTexto] = useState('');
  const [respuestaBusy, setRespuestaBusy] = useState(false);

  const [rows, setRows] = useState<ReqRow[]>([]);
  const [q, setQ] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [supQ, setSupQ] = useState('');       // búsqueda de proveedor
  const [supOpen, setSupOpen] = useState(false); // desplegable de proveedor abierto
  // 👤 RESPONSABLE (17-oct-2026, a pedido): quien lo CREA sale solo (requested_by_name);
  // el RESPONSABLE se elige entre los usuarios del rol ALMACENISTA y al elegido le llega
  // un aviso a su campana. ES OPCIONAL pero el rótulo no lo dice (pedido textual: «el
  // encargado es opcional, colócalo sin que diga opcional»).
  const [respId, setRespId] = useState<string | null>(null);
  const [respNombre, setRespNombre] = useState<string | null>(null);
  const [almacenistas, setAlmacenistas] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!createOpen) return;
    (async () => {
      try {
        // Mismo criterio que Compras usa para reconocer al almacenista: el NOMBRE del
        // rol dinámico contiene «almacen» (esAlmacenista en ComprasScreen).
        const { data } = await supabase.from('profiles').select('id, full_name, app_role:app_role_id(name)');
        setAlmacenistas(((data ?? []) as any[])
          .filter((p) => /almacen/i.test(String(p.app_role?.name ?? '')) && String(p.full_name ?? '').trim())
          .map((p) => ({ id: String(p.id), name: String(p.full_name).trim() }))
          .sort((a, b) => a.name.localeCompare(b.name, 'es')));
      } catch { setAlmacenistas([]); }
    })();
  }, [createOpen]);

  // 👤 SOLICITÓ / AUTORIZÓ / PARA QUÉ / ÁREA / OBSERVACIONES (20-oct-2026, a pedido).
  // La nómina SOLO SE LEE (ni un insert ni un update sobre `employees`): la ficha
  // elegida se copia al requerimiento. Lo único que llega a escribirse es un
  // CONTACTO, y solo si el usuario escribe un nombre que no está en ninguna lista.
  const [solicitante, setSolicitante] = useState<PersonaElegida>(SIN_PERSONA);
  const [autorizado, setAutorizado] = useState<PersonaElegida>(SIN_PERSONA);
  const [destino, setDestino] = useState<string | null>(null);
  const [area, setArea] = useState<string>('');
  const [areaLibre, setAreaLibre] = useState(false);     // escribir un área que no está en la lista
  const [observaciones, setObservaciones] = useState('');
  const [personas, setPersonas] = useState<PersonaNomina[]>([]);
  const [contactosLista, setContactosLista] = useState<{ id: string; name: string }[]>([]);
  const [cargandoNomina, setCargandoNomina] = useState(false);
  useEffect(() => {
    if (!createOpen) return;
    (async () => {
      setCargandoNomina(true);
      // Si alguna lectura falla, se sigue con la lista vacía: el nombre siempre se
      // puede escribir a mano, así que el formulario nunca se queda trancado.
      // Ojo: el builder de supabase-js es un `PromiseLike`, no una `Promise` — no
      // tiene `.catch`. El segundo callback de `then` es el que atrapa el fallo.
      const [emp, cont] = await Promise.all([
        supabase.from('employees').select('id, first_name, last_name, cedula, cargo, department, status')
          .then((r) => r.data ?? [], () => [] as any[]),
        supabase.from('contactos').select('id, name').then((r) => r.data ?? [], () => [] as any[]),
      ]);
      setPersonas(personasDeNomina(emp as any[]));
      setContactosLista((cont as any[]).map((c) => ({ id: String(c.id), name: String(c.name ?? '') })));
      setCargandoNomina(false);
    })();
  }, [createOpen]);
  // Las áreas que se ofrecen: las de la nómina + las ya usadas en requerimientos.
  // No hay catálogo nuevo que mantener (dos listas se desincronizan en una semana).
  const areas = React.useMemo(
    () => areasSugeridas(personas.map((p) => p.area), (reqs ?? []).map((r) => r.area)),
    [personas, reqs],
  );
  /**
   * Guarda en CONTACTOS un nombre escrito a mano. Devuelve el aviso si NO quedó.
   * El `.select('id')` es obligatorio: la RLS de `contactos` pide permiso de
   * compras/ventas/contactos, y a quien solo tiene inventario le rechaza la fila
   * SIN error y con 0 filas — el clásico borrado que finge éxito, al revés.
   */
  const guardarContacto = async (nombre: string): Promise<string | null> => {
    const fila = contactoDesdeNombre(nombre);
    if (!fila) return null;
    const { data, error } = await supabase.from('contactos')
      .insert({ ...fila, created_by: uid ?? null }).select('id');
    if (error) {
      return /duplicate|unique/i.test(error.message)
        ? null // ya estaba: el nombre igual queda en el requerimiento
        : `El nombre quedó en el requerimiento, pero no se pudo agregar a Contactos: ${error.message}`;
    }
    if (!data || data.length === 0) {
      return 'El nombre quedó en el requerimiento, pero no se agregó a Contactos (no tienes permiso de Compras ni de Contactos).';
    }
    setContactosLista((p) => [...p, { id: String(data[0].id), name: nombre }]);
    return null;
  };
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);                    // error visible DENTRO del Modal (el toast queda tapado)
  const [subiendoId, setSubiendoId] = useState<string | null>(null);              // formato subiendo
  const [previewReq, setPreviewReq] = useState<InventoryRequirement | null>(null); // vista previa del formato
  // Formato (imagen/PDF) adjuntado AL CREAR/EDITAR el requerimiento (antes de guardar).
  const [formato, setFormato] = useState<{ url: string; kind: 'image' | 'pdf'; name: string } | null>(null);
  const [subiendoNuevo, setSubiendoNuevo] = useState(false);
  const [subiendoImgKey, setSubiendoImgKey] = useState<string | null>(null); // imagen de producto subiéndose

  // Recibir en inventario
  const [recvFor, setRecvFor] = useState<InventoryRequirement | null>(null);
  const [recvRows, setRecvRows] = useState<{ product_id: string | null; name: string; unit: string | null; qty: string; price: string; currency: 'USD' | 'VES' }[]>([]);
  const [recvBusy, setRecvBusy] = useState(false);

  const inp = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  let seq = 0;
  const newKey = () => `${Date.now()}-${seq++}-${rows.length}`;
  const addBlank = () => setRows((r) => [...r, { key: newKey(), product_id: null, name: '', unit: '', qty: '1', price: '0', currency: 'USD', note: '', image_url: '' }]);
  const addFromProduct = (it: InventoryLevel) => {
    setRows((r) => [...r, { key: newKey(), product_id: it.id, name: it.name, unit: it.unit || '', qty: '1', price: String(Number(it.avg_cost) || 0), currency: 'USD', note: '', image_url: '' }]);
    setPickOpen(false); setQ('');
  };
  const upd = (key: string, field: keyof ReqRow, val: string) => setRows((r) => r.map((x) => (x.key === key ? { ...x, [field]: val } : x)));
  const rm = (key: string) => setRows((r) => r.filter((x) => x.key !== key));

  // Sube una IMAGEN de referencia de un producto (toma foto o elige de galería) y la
  // deja en esa fila. Se guarda dentro del ítem (JSON) al enviar el requerimiento y
  // sale en el PDF junto a la descripción del producto.
  const subirImagenProducto = async (key: string) => {
    setSubiendoImgKey(key);
    try {
      const res = await captureAndUploadPhoto('requerimientos', 'productos');
      if (!res.ok) { if (res.error) toast.error(res.error); return; }
      upd(key, 'image_url', res.url!);
    } finally {
      setSubiendoImgKey(null);
    }
  };

  const nq = norm(q);
  const productos = levels.filter((it) => !nq || norm(it.name).includes(nq) || norm(it.sku ?? '').includes(nq)).slice(0, 25);

  const perfilNombre = async (): Promise<string | null> => {
    if (!uid) return null;
    const { data } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle();
    return (data as any)?.full_name ?? null;
  };

  // Adjunta el formato (imagen/PDF) AL CREAR/EDITAR: sube el archivo y lo deja en
  // memoria (`formato`); se guarda junto con el requerimiento al enviar.
  const adjuntarFormatoNuevo = async () => {
    setSubiendoNuevo(true);
    try {
      const folder = editId || `nuevo-${Date.now()}`;
      const res = await pickAndUploadRequirementFile(folder);
      if (!res.ok) { if (res.error) toast.error(res.error); return; }
      setFormato({ url: res.url!, kind: res.kind!, name: res.name ?? 'formato' });
    } finally {
      setSubiendoNuevo(false);
    }
  };

  /** Deja el formulario en blanco. En UNA función: con 12 campos, resetear a mano
   *  en cada salida terminaba dejando alguno pegado del requerimiento anterior. */
  const limpiarForm = () => {
    setEditId(null); setTitle(''); setNote(''); setCompanyId(null); setSupplierId(null);
    setEmpresaPagadoraId(null); setEmpresaPagadoraNombre(null);
    setRows([]); setFormato(null); setRespId(null); setRespNombre(null);
    setSolicitante(SIN_PERSONA); setAutorizado(SIN_PERSONA);
    setDestino(null); setArea(''); setAreaLibre(false); setObservaciones('');
  };

  // 💳 Modal de edición rápida de datos financieros del proveedor
  const abrirEditarPagoProv = (s: Supplier) => {
    setProvParaPago(s);
    setProvBanco(s.bank_name ?? '');
    setProvNumCuenta(s.account_number ?? '');
    setProvTipoCuenta(s.account_type ?? 'Corriente');
    setProvTitular(s.account_holder ?? s.name);
    setProvDocTitular(s.account_id_doc ?? (s.rif ?? ''));
    setProvPagoMovilTel(s.pago_movil_phone ?? (s.phone ?? ''));
    setProvPagoMovilDoc(s.pago_movil_id ?? (s.rif ?? ''));
    setProvPagoMovilBanco(s.pago_movil_bank ?? (s.bank_name ?? ''));
    setProvBinanceId(s.binance_id ?? '');
    setProvNotasPago(s.payment_notes ?? '');
    setModalPagoProvOpen(true);
  };

  const guardarPagoProv = async () => {
    if (!provParaPago) return;
    setGuardandoPagoProv(true);
    try {
      const payload = {
        bank_name: provBanco.trim() || null,
        account_number: provNumCuenta.trim() || null,
        account_type: provTipoCuenta.trim() || null,
        account_holder: provTitular.trim() || null,
        account_id_doc: provDocTitular.trim() || null,
        pago_movil_phone: provPagoMovilTel.trim() || null,
        pago_movil_id: provPagoMovilDoc.trim() || null,
        pago_movil_bank: provPagoMovilBanco.trim() || null,
        binance_id: provBinanceId.trim() || null,
        payment_notes: provNotasPago.trim() || null,
      };
      const { error } = await supabase.from('suppliers').update(payload).eq('id', provParaPago.id);
      if (error) throw error;
      setModalPagoProvOpen(false);
      await refetch();
      toast.success('Coordenadas de pago del proveedor actualizadas con éxito.');
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudieron guardar las coordenadas.');
    } finally {
      setGuardandoPagoProv(false);
    }
  };

  // 🔄 Ciclo de Retroalimentación Técnica (Bucle de Cotización)
  const abrirSolicitarAclaratoria = (r: InventoryRequirement) => {
    setAclaratoriaTarget(r);
    setAclaratoriaMotivo('');
    setAclaratoriaOpen(true);
  };

  const enviarSolicitudAclaratoria = async () => {
    if (!aclaratoriaTarget) return;
    if (!aclaratoriaMotivo.trim()) {
      toast.error('Indica qué especificaciones o aclaratorias técnicas exige el proveedor.');
      return;
    }
    setAclaratoriaBusy(true);
    try {
      const decName = await perfilNombre();
      const { error } = await supabase.from('inventory_requirements').update({
        status: 'aclaratoria_solicitada',
        aclaratoria_motivo: aclaratoriaMotivo.trim(),
        aclaratoria_solicitada_por: decName || session?.user?.email || 'Compras',
        aclaratoria_fecha_solicitud: nowISO(),
      }).eq('id', aclaratoriaTarget.id);
      if (error) throw error;
      setAclaratoriaOpen(false);
      setAclaratoriaTarget(null);
      refetch();
      toast.info('Ticket devuelto al solicitante con solicitud de aclaratoria técnica.');
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo enviar la solicitud de aclaratoria.');
    } finally {
      setAclaratoriaBusy(false);
    }
  };

  // 📝 Responder Aclaratoria Técnica (Solicitante)
  const abrirResponderAclaratoria = (r: InventoryRequirement) => {
    setRespuestaTarget(r);
    setRespuestaTexto(r.aclaratoria_respuesta ?? '');
    setRespuestaOpen(true);
  };

  const enviarRespuestaAclaratoria = async () => {
    if (!respuestaTarget) return;
    if (!respuestaTexto.trim()) {
      toast.error('Escribe los detalles técnicos solicitados (medidas, material, etc.).');
      return;
    }
    setRespuestaBusy(true);
    try {
      const { error } = await supabase.from('inventory_requirements').update({
        status: 'pendiente', // vuelve a la cola de revisión
        aclaratoria_respuesta: respuestaTexto.trim(),
        aclaratoria_fecha_respuesta: nowISO(),
      }).eq('id', respuestaTarget.id);
      if (error) throw error;
      setRespuestaOpen(false);
      setRespuestaTarget(null);
      refetch();
      toast.success('Aclaratoria técnica enviada. El ticket volvió a revisión de compras.');
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo enviar la respuesta.');
    } finally {
      setRespuestaBusy(false);
    }
  };

  const crear = async () => {
    setFormErr(null);
    const items: RequirementLine[] = rows.filter((x) => x.name.trim()).map((x) => ({
      product_id: x.product_id, name: x.name.trim().toUpperCase(), unit: x.unit.trim().toUpperCase() || null,
      qty: parseNum(x.qty), est_price: parseNum(x.price), currency: x.currency, note: x.note.trim() || null,
      image_url: x.image_url || null,
    }));
    if (items.length === 0) { const m = 'Agrega al menos un producto (del inventario o nuevo) antes de guardar.'; setFormErr(m); return toast.error(m); }
    setBusy(true);
    // EDITAR: actualiza el requerimiento existente (conserva su código y estado).
    // Columna nueva (17-oct-2026): si el SQL del responsable aún no se corrió, el
    // guardado NO se cae — se reintenta sin esos campos y se avisa.
    const faltaColResp = (msg: string) => /responsable/i.test(msg) && /column|does not exist|schema cache|no existe/i.test(msg);
    if (editId) {
      const adj = formato ? { attachment_url: formato.url, attachment_type: formato.kind, attachment_name: formato.name } : {};
      const base = {
        title: title.trim() || null, note: note.trim() || null, company_id: companyId, supplier_id: supplierId,
        empresa_pagadora_id: empresaPagadoraId, empresa_pagadora_nombre: empresaPagadoraNombre,
        items, ...adj
      };
      // 👤 Solicitante, autorizado, destino, área y observaciones (20-oct-2026).
      const conResp = { ...base, responsable_id: respId, responsable_nombre: respNombre };
      const nuevos = camposRequerimiento({ solicitante, autorizado, destino, area, observaciones });
      let respGuardado = true;
      let nuevosGuardados = true;
      let { error } = await supabase.from('inventory_requirements').update({ ...conResp, ...nuevos }).eq('id', editId);
      // Si el SQL de empresa pagadora aún no se corrió, reintenta sin ella
      if (error && /empresa_pagadora/i.test(error.message)) {
        delete (conResp as any).empresa_pagadora_id;
        delete (conResp as any).empresa_pagadora_nombre;
        ({ error } = await supabase.from('inventory_requirements').update({ ...conResp, ...nuevos }).eq('id', editId));
      }
      // Si el SQL del 20-oct todavía no se corrió, se guarda SIN esos campos en vez
      // de perder la edición entera (mismo trato que tuvo el responsable el 17-oct).
      if (error && faltaColumnaNueva(error.message)) {
        nuevosGuardados = false;
        ({ error } = await supabase.from('inventory_requirements').update(conResp).eq('id', editId));
      }
      if (error && faltaColResp(error.message)) {
        respGuardado = false;
        ({ error } = await supabase.from('inventory_requirements').update(base).eq('id', editId));
      }
      setBusy(false);
      if (error) { setFormErr(error.message); return toast.error(error.message); }
      setCreateOpen(false); limpiarForm();
      refetch();
      const faltas = [!respGuardado ? 'el responsable' : '', !nuevosGuardados ? 'quién solicitó/autorizó, el área y las observaciones' : '']
        .filter(Boolean).join(' ni ');
      toast.success(faltas
        ? `Requerimiento actualizado (no se guardó ${faltas}: falta correr el SQL).`
        : 'Requerimiento actualizado.');
      return;
    }
    // CREAR: código correlativo (REQ-000N). Se lee el máximo actual; si la lectura
    // FALLA, se ABORTA (NUNCA se reinicia a 0001 con una lectura vacía). El índice
    // único en `code` impide duplicados; si dos requerimientos chocan en el mismo
    // código, se reintenta con el siguiente número.
    const reqName = await perfilNombre();
    const adj = formato ? { attachment_url: formato.url, attachment_type: formato.kind, attachment_name: formato.name } : {};
    let code = '';
    let saved = false;
    // Campos del responsable: si la columna aún no existe (falta el SQL), se quitan
    // y el requerimiento se guarda igual — el AVISO al almacenista sí se envía.
    let respCampos: Record<string, any> = respId ? { responsable_id: respId, responsable_nombre: respNombre } : {};
    let respFaltaSql = false;
    // 🏢 Empresa Pagadora (22-oct-2026): entidad responsable del desembolso
    let empresaCampos: Record<string, any> = empresaPagadoraId ? { empresa_pagadora_id: empresaPagadoraId, empresa_pagadora_nombre: empresaPagadoraNombre } : {};
    let empresaFaltaSql = false;
    // 👤 Lo pedido el 20-oct: quién solicitó, quién autorizó, para qué, a qué área
    //    y las observaciones. Mismo trato defensivo que el responsable.
    let nuevosCampos: Record<string, any> = camposRequerimiento({ solicitante, autorizado, destino, area, observaciones });
    let nuevosFaltaSql = false;
    for (let intento = 0; intento < 6 && !saved; intento++) {
      const { data: codeRows, error: readErr } = await supabase.from('inventory_requirements').select('code');
      if (readErr || !codeRows) {
        setBusy(false);
        const m = 'No se pudo leer el número de requerimiento (correlativo). Revisa tu conexión e inténtalo de nuevo.';
        setFormErr(m); return toast.error(m);
      }
      code = nextReqCode(codeRows.map((r: any) => r.code), intento);
      // La BASE reasigna el código con un trigger (correlativo a prueba de fallos);
      // leemos el código REAL que quedó para mostrarlo.
      const { data: inserted, error } = await supabase.from('inventory_requirements').insert({
        code, title: title.trim() || null, note: note.trim() || null, company_id: companyId, supplier_id: supplierId, status: 'pendiente', items,
        requested_by: uid, requested_by_name: reqName, ...adj, ...respCampos, ...nuevosCampos, ...empresaCampos,
      }).select('id, code').single();
      if (!error) { if ((inserted as any)?.code) code = (inserted as any).code; saved = true; break; }
      // Falta la columna de empresa pagadora: se reintenta sin ella
      if (Object.keys(empresaCampos).length && /empresa_pagadora/i.test(error.message)) { empresaCampos = {}; empresaFaltaSql = true; intento--; continue; }
      // Falta la columna del responsable: se reintenta SIN ella (mismo número).
      if (Object.keys(respCampos).length && faltaColResp(error.message)) { respCampos = {}; respFaltaSql = true; intento--; continue; }
      // Faltan las columnas del 20-oct: igual, se reintenta sin ellas.
      if (Object.keys(nuevosCampos).length && faltaColumnaNueva(error.message)) { nuevosCampos = {}; nuevosFaltaSql = true; intento--; continue; }
      // Código ya usado (índice único): reintenta con el siguiente número.
      if (/duplicate key|already exists|unique|_code_key|23505/i.test(error.message)) continue;
      setBusy(false);
      setFormErr(error.message); return toast.error(error.message);
    }
    setBusy(false);
    if (!saved) { const m = 'No se pudo asignar un número único al requerimiento. Inténtalo de nuevo.'; setFormErr(m); return toast.error(m); }
    // 🔔 EL AVISO AL RESPONSABLE LO MANDA LA BASE, NO LA APP (18-oct-2026). El
    // trigger trg_notify_requirement_responsable (gemelo del que avisa a los admin)
    // crea la notificación dirigida (recipient_id) al INSERTAR con responsable y al
    // CAMBIARLO en ✏️ Editar. Desde la app NO se inserta: la política notif_insert
    // exige is_staff() y los almacenistas son rol base 'conductor' — un aviso
    // insertado desde el cliente se les caía EN SILENCIO (borrados-que-fingen-éxito,
    // versión insert). El trigger es SECURITY DEFINER y no depende de quién crea.
    setCreateOpen(false); limpiarForm();
    refetch();
    const sinSql = [
      respFaltaSql ? 'el responsable' : '',
      nuevosFaltaSql ? 'quién solicitó/autorizó, el área y las observaciones' : '',
      empresaFaltaSql ? 'la empresa pagadora' : '',
    ].filter(Boolean).join(' ni ');
    toast.success(sinSql
      ? `Requerimiento ${code} enviado. ⚠️ No se guardó ${sinSql} (falta correr el SQL); el aviso sí se envió.`
      : `Requerimiento ${code} enviado. El jefe podrá aprobarlo o rechazarlo.`);
  };

  // Abrir el formulario para EDITAR: precarga título, nota e ítems del requerimiento.
  const abrirEditar = (r: InventoryRequirement) => {
    setEditId(r.id);
    setTitle(r.title ?? '');
    setNote(r.note ?? '');
    setCompanyId(r.company_id ?? null);
    setSupplierId(r.supplier_id ?? null);
    setEmpresaPagadoraId(r.empresa_pagadora_id ?? null);
    setEmpresaPagadoraNombre(r.empresa_pagadora_nombre ?? null);
    setRespId(r.responsable_id ?? null);
    setRespNombre(r.responsable_nombre ?? null);
    // 👤 Lo del 20-oct. Un requerimiento viejo no los trae: quedan en blanco y el
    //    formulario se ve igual que siempre.
    setSolicitante({ nombre: r.solicitante_nombre ?? null, employeeId: r.solicitante_employee_id ?? null });
    setAutorizado({ nombre: r.autorizado_nombre ?? null, employeeId: r.autorizado_employee_id ?? null });
    setDestino(r.destino_tipo ?? null);
    setArea(r.area ?? '');
    setAreaLibre(false);
    setObservaciones(r.observaciones ?? '');
    setFormato(r.attachment_url ? { url: r.attachment_url, kind: (r.attachment_type as 'image' | 'pdf') || 'image', name: r.attachment_name || 'formato' } : null);
    let s = 0;
    setRows(r.items.map((it) => ({
      key: `${Date.now()}-${s++}`, product_id: it.product_id, name: it.name, unit: it.unit ?? '',
      qty: String(it.qty), price: String(it.est_price ?? 0), currency: (it.currency as 'USD' | 'VES') || 'USD', note: it.note ?? '',
      image_url: it.image_url ?? '',
    })));
    setFormErr(null);
    setCreateOpen(true);
  };

  // Eliminar TODO el requerimiento (con confirmación). No revierte movimientos de
  // inventario ya registrados si estaba "recibido"; solo borra el documento.
  const eliminar = async (r: InventoryRequirement) => {
    const recibido = r.status === 'recibido';
    const ok = await confirm({
      title: 'Eliminar requerimiento',
      message: `¿Eliminar el requerimiento ${r.code ?? ''}? Esta acción no se puede deshacer.` +
        (recibido ? '\n\nNota: ya fue recibido en inventario; sus entradas de stock NO se revierten.' : ''),
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('inventory_requirements').delete().eq('id', r.id);
    if (error) return toast.error(error.message);
    refetch();
  };

  const decidir = async (r: InventoryRequirement, status: 'aprobado' | 'rechazado') => {
    if (r.status === 'aclaratoria_solicitada' && status === 'aprobado') {
      return toast.error('No se puede aprobar un requerimiento con aclaratoria técnica pendiente. Espera la respuesta técnica del solicitante.');
    }
    const decName = await perfilNombre();
    const { error } = await supabase.from('inventory_requirements').update({
      status, decided_by: uid, decided_by_name: decName, decided_at: nowISO(),
    }).eq('id', r.id);
    if (error) return toast.error(error.message);
    refetch();
    // Al APROBAR, si trae formato adjunto, se abre la vista previa para ver y descargar.
    if (status === 'aprobado' && r.attachment_url) setPreviewReq({ ...r, status });
  };

  // APROBACIÓN EN LOTE: el gerente marca (☑) varios requerimientos PENDIENTES y los
  // aprueba todos de un click. Solo toca los pendientes seleccionados; el trigger
  // req_sync_compra genera la orden/cuenta de cada uno igual que al aprobar uno a uno.
  const aprobarLote = async () => {
    const ids = reqs.filter((r) => reqSelIds.has(r.id) && r.status === 'pendiente').map((r) => r.id);
    if (!ids.length) return toast.error('Marca (☑) requerimientos PENDIENTES para aprobar en lote.');
    const ok = await confirm({ title: 'Aprobar en lote', message: `¿Aprobar ${ids.length} requerimiento(s) pendiente(s) de una vez?`, confirmText: `Aprobar ${ids.length}` });
    if (!ok) return;
    const decName = await perfilNombre();
    const { error } = await supabase.from('inventory_requirements').update({ status: 'aprobado', decided_by: uid, decided_by_name: decName, decided_at: nowISO() }).in('id', ids);
    if (error) return toast.error(error.message);
    setReqSelIds(new Set());
    refetch();
    toast.success(`${ids.length} requerimiento(s) aprobados en lote.`);
  };

  // ANULAR un requerimiento YA APROBADO: el mismo gerente lo rechaza. Pasa a
  // RECHAZADO y el trigger de la BD (req_sync_compra) anula automáticamente la
  // orden de compra y la cuenta por pagar que se hubieran generado. No revierte
  // stock ya recibido (para eso está "recibido", que no permite anular acá).
  const anularAprobado = async (r: InventoryRequirement) => {
    const ok = await confirm({
      title: 'Anular requerimiento aprobado',
      message: `¿Anular (rechazar) el requerimiento ${r.code ?? ''} que ya estaba APROBADO?\n\n` +
        'Quedará RECHAZADO y, si generó orden de compra y cuenta por pagar, se anulan automáticamente. No revierte stock ya recibido.',
      confirmText: 'Anular / Rechazar', cancelText: 'Cancelar', danger: true,
    });
    if (!ok) return;
    await decidir(r, 'rechazado');
  };

  // Sube un FORMATO (imagen o PDF) al requerimiento y lo guarda en la fila.
  const subirFormato = async (r: InventoryRequirement) => {
    setSubiendoId(r.id);
    try {
      const res = await pickAndUploadRequirementFile(r.id);
      if (!res.ok) { if (res.error) toast.error(res.error); return; }
      const { data, error } = await supabase.from('inventory_requirements')
        .update({ attachment_url: res.url, attachment_type: res.kind, attachment_name: res.name ?? null })
        .eq('id', r.id).select('id');
      if (error) {
        if (/attachment|column/i.test(error.message)) { toast.error('Corre "requerimientos_adjunto.sql" en Supabase para guardar el formato.'); return; }
        toast.error(error.message); return;
      }
      if (!data || data.length === 0) { toast.error('No tienes permiso de escritura en inventario.'); return; }
      await refetch();
      toast.success('El formato quedó guardado en el requerimiento.');
    } finally {
      setSubiendoId(null);
    }
  };

  // Descarga (o abre) el formato adjunto.
  const descargarFormato = (r: InventoryRequirement) => {
    if (!r.attachment_url) return;
    if (Platform.OS === 'web') {
      const a = document.createElement('a');
      a.href = r.attachment_url; a.download = r.attachment_name || 'formato'; a.target = '_blank'; a.rel = 'noopener';
      a.click();
    } else {
      Linking.openURL(r.attachment_url);
    }
  };

  // Revierte un requerimiento RECHAZADO de vuelta a PENDIENTE (p. ej. si el rechazo
  // fue un error de dedo). Limpia la decisión y NOTIFICA a los admin (el trigger de
  // la BD solo notifica al crear; al revertir insertamos la notificación a mano).
  const revertirRechazo = async (r: InventoryRequirement) => {
    const ok = await confirm({
      title: 'Volver a pendiente',
      message: `¿Devolver el requerimiento ${r.code ?? ''} a estado PENDIENTE? Se notificará a los administradores.`,
      confirmText: 'Volver a pendiente', cancelText: 'Cancelar',
    });
    if (!ok) return;
    const { data, error } = await supabase.from('inventory_requirements')
      .update({ status: 'pendiente', decided_by: null, decided_by_name: null, decided_at: null })
      .eq('id', r.id).select();
    if (error) { await confirm({ title: 'No se pudo', message: error.message, confirmText: 'OK', cancelText: '' }); return; }
    if (!data || data.length === 0) { await confirm({ title: 'No se pudo', message: 'No tienes permiso o el requerimiento ya no existe.', confirmText: 'OK', cancelText: '' }); return; }
    // Notifica a los admin que el requerimiento volvió a PENDIENTE.
    try {
      await supabase.from('notifications').insert({
        type: 'requerimiento',
        title: 'Requerimiento de vuelta a pendiente',
        body: [r.code, r.title].filter(Boolean).join(' · '),
        target_role: 'admin', entity_type: 'inventory_requirement', entity_id: String(r.id),
        created_by: uid, meta: { code: r.code, status: 'pendiente' },
      });
    } catch {}
    refetch();
  };

  // Cambio de estado MANUAL (corrección administrativa): a diferencia de "Recibir
  // en inventario" (que crea las entradas de stock), esto SOLO cambia la etiqueta
  // del documento — pedido directo del cliente (04/08/2026) para poder corregir un
  // estado sin tener que rehacer todo el flujo. Solo para quien tenga `canReceive`.
  const [statusPickerId, setStatusPickerId] = useState<string | null>(null);
  const cambiarEstadoManual = async (r: InventoryRequirement, status: RequirementStatus) => {
    const ok = await confirm({
      title: 'Cambiar estado manualmente',
      message: `¿Cambiar ${r.code ?? ''} a "${REQ_STATUS[status].short}"? Esto SOLO cambia la etiqueta del documento — no crea ni revierte entradas de stock en el inventario.` +
        (status === 'recibido' ? '\n\nSi todavía no se recibió físicamente, usa "📥 Recibir en inventario" en su lugar para que el stock quede registrado.' : ''),
      confirmText: 'Cambiar', cancelText: 'Cancelar',
    });
    if (!ok) return;
    const patch: Record<string, any> = { status };
    if (status === 'recibido' && !r.received_at) patch.received_at = nowISO();
    const { error } = await supabase.from('inventory_requirements').update(patch).eq('id', r.id);
    if (error) return toast.error(error.message);
    setStatusPickerId(null);
    refetch();
    toast.success('Estado actualizado.');
  };

  // Abrir "Recibir": precarga los ítems con su precio estimado (para editarlo al real).
  const abrirRecibir = (r: InventoryRequirement) => {
    setRecvFor(r);
    setRecvRows(r.items.map((it) => ({ product_id: it.product_id, name: it.name, unit: it.unit, qty: String(it.qty), price: String(it.est_price || 0), currency: it.currency || 'USD' })));
  };

  const recibir = async () => {
    if (!recvFor) return;
    for (const it of recvRows) { if (parseNum(it.qty) <= 0) return toast.error(`Indica la cantidad recibida de "${it.name}".`); }
    setRecvBusy(true);
    // SKU incremental para los productos NUEVOS.
    const { data: skuRows } = await supabase.from('inventory_items').select('sku');
    let maxN = 0;
    (skuRows ?? []).forEach((r: any) => { const m = String(r.sku ?? '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > maxN) maxN = n; } });
    const pad = (n: number) => 'INV-' + String(n).padStart(4, '0');
    try {
      for (const it of recvRows) {
        let itemId = it.product_id;
        if (!itemId) { // producto NUEVO: se crea a raíz del requerimiento
          maxN += 1;
          const { data: ins, error } = await supabase.from('inventory_items')
            .insert({ name: it.name.toUpperCase(), unit: it.unit || null, sku: pad(maxN), category: 'otros', min_stock: 0, machinery_id: null, company_id: null })
            .select('id').single();
          if (error) throw error;
          itemId = ins.id;
        }
        const priceUsd = it.currency === 'USD' ? parseNum(it.price) : usdFromBs(parseNum(it.price), rate || 0);
        const { error: mErr } = await supabase.from('inventory_movements').insert({
          item_id: itemId, kind: 'entrada', qty: parseNum(it.qty), unit_cost: Math.round((priceUsd || 0) * 10000) / 10000,
          reason: `RECIBIDO DE REQUERIMIENTO ${recvFor.code ?? ''}`.trim(), company_id: null, created_by: uid,
        });
        if (mErr) throw mErr;
      }
      const items2 = recvFor.items.map((it) => ({ ...it, received: true }));
      const { error: uErr } = await supabase.from('inventory_requirements').update({ status: 'recibido', received_at: nowISO(), items: items2 }).eq('id', recvFor.id);
      if (uErr) throw uErr;
      setRecvBusy(false); setRecvFor(null); setRecvRows([]);
      refetch();
      toast.success('Recibido en el inventario. Las entradas quedaron registradas con su precio.');
    } catch (e: any) {
      setRecvBusy(false);
      toast.error(e?.message ?? 'No se pudo recibir en inventario.');
    }
  };

  const totalUsdDe = (r: InventoryRequirement) => r.items.reduce((s, it) => s + (it.currency === 'USD' ? Number(it.est_price) || 0 : usdFromBs(Number(it.est_price) || 0, rate || 0)) * (Number(it.qty) || 0), 0);

  // Convierte los ítems al formato del PDF, incrustando la imagen de cada producto
  // como data-URI (para que salga SÍ o SÍ en el PDF, sin depender de CORS ni de que
  // la imagen cargue a tiempo al imprimir). En nativo urlToDataUri devuelve null →
  // se usa la URL directa (expo-print sí carga imágenes remotas).
  const itemsToPdf = (r: InventoryRequirement) => Promise.all(r.items.map(async (it) => ({
    name: it.name, unit: it.unit, qty: it.qty, est_price: it.est_price, currency: it.currency,
    isNew: !it.product_id, note: it.note,
    image: it.image_url ? ((await urlToDataUri(it.image_url)) || it.image_url) : null,
  })));

  const buildReqPdfData = async (r: InventoryRequirement): Promise<ReqPdfData> => {
    const selectedSupplier = suppliers.find((s) => s.id === r.supplier_id);
    return {
      code: r.code, fecha: dmyOf(r.created_at), title: r.title, note: r.note,
      company: companyName(r.company_id),
      empresaPagadora: r.empresa_pagadora_nombre ?? null,
      proveedor: selectedSupplier?.name ?? null,
      proveedorDatosPago: selectedSupplier ? {
        banco: selectedSupplier.bank_name,
        cuenta: selectedSupplier.account_number,
        titular: selectedSupplier.account_holder,
        cedulaRif: selectedSupplier.account_id_doc,
        pagoMovil: selectedSupplier.pago_movil_phone ? `${selectedSupplier.pago_movil_bank ?? ''} - ${selectedSupplier.pago_movil_phone} (${selectedSupplier.pago_movil_id ?? ''})` : null,
        binance: selectedSupplier.binance_id,
      } : null,
      requestedBy: r.requested_by_name, responsable: r.responsable_nombre ?? null, statusLabel: REQ_STATUS[r.status]?.short ?? r.status, rate,
      /* 👤 Lo declarado en el papel (20-oct-2026). Lo vacío no sale impreso. */
      solicitante: r.solicitante_nombre ?? null, autorizadoPor: r.autorizado_nombre ?? null,
      destino: destinoLabel(r.destino_tipo), area: r.area ?? null, observaciones: r.observaciones ?? null,
      aclaratoria: r.aclaratoria_motivo ? {
        motivo: r.aclaratoria_motivo,
        solicitadaPor: r.aclaratoria_solicitada_por ?? null,
        fechaSolicitud: r.aclaratoria_fecha_solicitud ? dmyOf(r.aclaratoria_fecha_solicitud) : null,
        respuesta: r.aclaratoria_respuesta ?? null,
        fechaRespuesta: r.aclaratoria_fecha_respuesta ? dmyOf(r.aclaratoria_fecha_respuesta) : null,
      } : null,
      approved: r.status === 'aprobado', decidedBy: r.decided_by_name,
      items: await itemsToPdf(r),
    };
  };

  const pdf = async (r: InventoryRequirement) => {
    try {
      await exportPdf(requerimientoHtml(await buildReqPdfData(r)), `Requerimiento ${r.code ?? dmyOf(r.created_at)}`);
    } catch (e: any) { toast.error('No se pudo generar el PDF: ' + (e?.message ?? e)); }
  };

  const createTotalUsd = rows.reduce((s, x) => s + (x.currency === 'USD' ? parseNum(x.price) : usdFromBs(parseNum(x.price), rate || 0)) * parseNum(x.qty), 0);

  if (loading) return <Screen><SkeletonList /></Screen>;

  return (
    <Screen onRefresh={refetch} refreshing={loading}>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Requerimientos</SectionTitle>
        {canWrite ? (
          <TouchableOpacity onPress={() => { setEditId(null); setTitle(''); setNote(''); setCompanyId(null); setSupplierId(null); setEmpresaPagadoraId(null); setEmpresaPagadoraNombre(null); setSupOpen(false); setSupQ(''); setRows([]); setFormato(null); setFormErr(null); setCreateOpen(true); }} style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>➕ Nuevo</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Pide productos del inventario o nuevos para que el jefe apruebe la compra. Si se compra, se recibe en el inventario con su precio. {rate ? `Tasa hoy: ${fmtBs(rate)}/US$.` : ''}
      </Text>

      {/* Filtro por estatus */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {([
          { k: 'todos', label: 'Todos', color: colors.brandText },
          { k: 'pendiente', label: '⏳ Pendientes', color: '#D97706' },
          { k: 'aclaratoria_solicitada', label: '⚠️ En Aclaratoria', color: '#D97706' },
          { k: 'sin_precio', label: '❗ Sin precio', color: '#DC2626' },
          { k: 'aprobado', label: '✅ Aprobados', color: '#2563EB' },
          { k: 'rechazado', label: '❌ Rechazados', color: '#DC2626' },
          { k: 'recibido', label: '📦 Recibidos', color: '#16A34A' },
        ] as const).map((f) => {
          const on = filterStatus === f.k;
          const n = f.k === 'todos' ? reqs.length : f.k === 'sin_precio' ? reqs.filter(faltaPrecioDe).length : reqs.filter((r) => r.status === f.k).length;
          return (
            <TouchableOpacity key={f.k} onPress={() => setFilterStatus(f.k)} style={{ borderWidth: 1.5, borderColor: f.color, backgroundColor: on ? f.color : 'transparent', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
              <Text style={{ color: on ? '#fff' : f.color, fontWeight: '800', fontSize: 12 }}>{f.label} ({n})</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Búsqueda libre (código, título, nota, solicitante, empresa, ítems) + rango de fecha. */}
      <TextInput
        value={listQuery}
        onChangeText={setListQuery}
        placeholder="🔎 Buscar: código, título, nota, solicitante, empresa, producto…"
        placeholderTextColor={colors.muted}
        style={{ ...inp, marginBottom: spacing.xs }}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
          <DateField value={reqDateFrom} onChange={setReqDateFrom} placeholder="Cualquiera" maxISO={reqDateTo || undefined} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
          <DateField value={reqDateTo} onChange={setReqDateTo} placeholder="Cualquiera" minISO={reqDateFrom || undefined} />
        </View>
        {reqDateFrom || reqDateTo ? (
          <TouchableOpacity onPress={() => { setReqDateFrom(''); setReqDateTo(''); }} style={{ alignSelf: 'flex-end', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm }}>
            <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>✕ Limpiar</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {(() => {
        const nq = norm(listQuery);
        const filteredReqs = reqs
          .filter((r) => filterStatus === 'todos' ? true : filterStatus === 'sin_precio' ? faltaPrecioDe(r) : r.status === filterStatus)
          .filter((r) => !reqDateFrom || r.created_at.slice(0, 10) >= reqDateFrom)
          .filter((r) => !reqDateTo || r.created_at.slice(0, 10) <= reqDateTo)
          .filter((r) => {
            if (!nq) return true;
            const haystack = [r.code, r.title, r.note, r.requested_by_name, r.decided_by_name, companyName(r.company_id), ...r.items.map((it) => it.name)]
              .filter(Boolean).join(' ');
            return norm(haystack).includes(nq);
          });
        const allSel = filteredReqs.length > 0 && filteredReqs.every((r) => reqSelIds.has(r.id));
        const selectedOrFiltered = () => reqSelIds.size ? filteredReqs.filter((r) => reqSelIds.has(r.id)) : filteredReqs;
        const toReqPdfData = (r: (typeof filteredReqs)[number]): Promise<ReqPdfData> => buildReqPdfData(r);
        const pdfMultiple = async () => {
          const base = selectedOrFiltered();
          if (base.length === 0) return;
          try {
            await exportPdf(requerimientosBulkHtml(await Promise.all(base.map(toReqPdfData))), `Requerimientos ${dmyOf(new Date().toISOString())}`);
          } catch (e: any) { toast.error('No se pudo generar el PDF: ' + (e?.message ?? e)); }
        };
        const pdfResumen = async () => {
          const base = selectedOrFiltered();
          if (base.length === 0) return;
          try {
            await exportPdf(requerimientosResumenHtml(await Promise.all(base.map(toReqPdfData))), `Resumen requerimientos ${dmyOf(new Date().toISOString())}`);
          } catch (e: any) { toast.error('No se pudo generar el resumen: ' + (e?.message ?? e)); }
        };
        return filteredReqs.length === 0 ? (
        <EmptyState title="Sin requerimientos" subtitle={filterStatus === 'todos' && !listQuery && !reqDateFrom && !reqDateTo ? 'Crea uno con ➕ Nuevo para pasárselo al jefe.' : 'Ningún requerimiento coincide con el filtro/búsqueda.'} />
      ) : (
        <>
          {/* Selección para el PDF por lote: "Seleccionar todos" marca los VISIBLES (ya
              filtrados/buscados); el botón exporta solo los marcados, o todos los
              filtrados si no hay ninguno marcado. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm, flexWrap: 'wrap', gap: spacing.xs }}>
            <TouchableOpacity onPress={() => setReqSelIds(allSel ? new Set() : new Set(filteredReqs.map((r) => r.id)))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: allSel ? colors.brand : colors.border, backgroundColor: allSel ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {allSel ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
              </View>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Seleccionar todos ({filteredReqs.length})</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <TouchableOpacity onPress={pdfResumen} style={{ backgroundColor: colors.surfaceAlt ?? colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>📄 Resumen{reqSelIds.size ? ` (${reqSelIds.size})` : ` (${filteredReqs.length})`}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={pdfMultiple} style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>📥 PDF{reqSelIds.size ? ` (${reqSelIds.size})` : ` (${filteredReqs.length})`}</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* APROBACIÓN EN LOTE (solo admin): aparece cuando hay ≥1 requerimiento
              PENDIENTE marcado; aprueba todos los marcados de un solo click. */}
          {isAdmin && (() => {
            const nPend = filteredReqs.filter((r) => reqSelIds.has(r.id) && r.status === 'pendiente').length;
            if (!nPend) return null;
            return (
              <TouchableOpacity onPress={aprobarLote} style={{ backgroundColor: colors.infoSoftBorder, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', marginBottom: spacing.sm }}>
                <Text style={{ color: colors.brandContrast ?? '#fff', fontWeight: '900', fontSize: 14 }}>✅ Aprobar en lote ({nPend})</Text>
              </TouchableOpacity>
            );
          })()}
          {filteredReqs.map((r) => {
            const rSel = reqSelIds.has(r.id);
            return (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs }}>
              <TouchableOpacity onPress={() => toggleReqSel(r.id)} style={{ paddingTop: spacing.md }}>
                <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: rSel ? colors.brand : colors.border, backgroundColor: rSel ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {rSel ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
                </View>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
              {(() => {
        const st = REQ_STATUS[r.status] ?? REQ_STATUS.pendiente;
        const tUsd = totalUsdDe(r);
        const faltaPrecio = faltaPrecioDe(r);
        return (
          <ExpandableCard
            key={r.id}
            summary={
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }} numberOfLines={1}>{r.code ?? 'REQ'} · {r.title || `${r.items.length} ítem(s)`}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{dmyOf(r.created_at)}{companyName(r.company_id) ? ` · 🏢 ${companyName(r.company_id)}` : ''}{r.requested_by_name ? ` · ${r.requested_by_name}` : ''}{r.responsable_nombre ? ` · 📦 Resp.: ${r.responsable_nombre}` : ''}</Text>
                    {r.empresa_pagadora_nombre ? (
                      <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700', marginTop: 1 }}>💳 Pagadora: {r.empresa_pagadora_nombre}</Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4, maxWidth: 170 }}>
                    {canReceive ? (
                      <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); setStatusPickerId((id) => (id === r.id ? null : r.id)); }}>
                        <Pill label={`${st.label} ${statusPickerId === r.id ? '▴' : '▾'}`} color={st.color} />
                      </TouchableOpacity>
                    ) : (
                      <Pill label={st.label} color={st.color} />
                    )}
                    {faltaPrecio ? <Pill label="❗ Pendiente por cargar precio" color={colors.danger} /> : null}
                  </View>
                </View>

                {tUsd >= 1000 ? (
                  <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: '#FEF2F2', borderColor: '#DC2626', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                    <Text style={{ color: '#DC2626', fontWeight: '800', fontSize: 11 }}>🚨 Umbral &gt; $1,000 USD (Req. Doble Aprobación / Tesorería)</Text>
                  </View>
                ) : null}

                {r.status === 'aclaratoria_solicitada' && r.aclaratoria_motivo ? (
                  <View style={{ backgroundColor: '#FEF3C7', borderColor: '#F59E0B', borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs }}>
                    <Text style={{ color: '#92400E', fontWeight: '800', fontSize: 12 }}>⚠️ Aclaratoria Técnica Solicitada por Compras</Text>
                    <Text style={{ color: '#B45309', fontSize: 12, marginTop: 2 }}>{r.aclaratoria_motivo}</Text>
                    {r.aclaratoria_solicitada_por ? (
                      <Text style={{ color: '#92400E', fontSize: 10, marginTop: 2 }}>Solicitado por: {r.aclaratoria_solicitada_por}{r.aclaratoria_fecha_solicitud ? ` (${dmyOf(r.aclaratoria_fecha_solicitud)})` : ''}</Text>
                    ) : null}
                  </View>
                ) : null}

                {r.aclaratoria_respuesta ? (
                  <View style={{ backgroundColor: '#ECFDF5', borderColor: '#10B981', borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs }}>
                    <Text style={{ color: '#065F46', fontWeight: '800', fontSize: 12 }}>💬 Respuesta Técnica Registrada</Text>
                    <Text style={{ color: '#047857', fontSize: 12, marginTop: 2 }}>{r.aclaratoria_respuesta}</Text>
                    {r.aclaratoria_fecha_respuesta ? (
                      <Text style={{ color: '#065F46', fontSize: 10, marginTop: 2 }}>Respondido: {dmyOf(r.aclaratoria_fecha_respuesta)}</Text>
                    ) : null}
                  </View>
                ) : null}

                {/* Cambiar estado A MANO, tocando el badge de arriba — no crea ni revierte
                    stock, solo corrige la etiqueta. Aparte del pill "sin precio". */}
                {canReceive && statusPickerId === r.id ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: spacing.xs, justifyContent: 'flex-end' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Cambiar a:</Text>
                    {(['pendiente', 'aclaratoria_solicitada', 'aprobado', 'rechazado', 'recibido'] as const).filter((s) => s !== r.status).map((s) => (
                      <TouchableOpacity key={s} onPress={(e) => { e.stopPropagation?.(); cambiarEstadoManual(r, s); }} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>{REQ_STATUS[s].short}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            }
            detail={
              <View>
                {r.items.map((it, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, paddingVertical: 3, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                    <View style={{ flex: 1 }}>
                      {/* 🔢 El mismo número que la columna «#» del PDF y que el
                          formulario: así «el renglón 3» es el mismo para todos. */}
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}><Text style={{ color: colors.muted }}>{i + 1}. </Text>{it.name} {it.product_id ? '' : <Text style={{ color: colors.success, fontSize: 11 }}>· NUEVO</Text>}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{qtyFmt(it.qty)} {it.unit || ''} · {it.currency === 'USD' ? usd(it.est_price) : fmtBs(it.est_price)} c/u</Text>
                    </View>
                    {it.image_url ? <Image source={{ uri: it.image_url }} style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }} /> : null}
                  </View>
                ))}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                  <Text style={{ color: colors.text, fontWeight: '900' }}>TOTAL ESTIMADO</Text>
                  <Text style={{ color: colors.brandText, fontWeight: '900' }}>{usd(tUsd)}{rate ? ` · ${fmtBs(bsFromUsd(tUsd, rate))}` : ''}</Text>
                </View>
                {r.status === 'aprobado' && r.decided_by_name ? <Text style={{ color: colors.infoSoftText, fontSize: 11, marginTop: 2 }}>Aprobado por {r.decided_by_name}</Text> : null}
                {r.status === 'rechazado' && r.decided_by_name ? <Text style={{ color: colors.danger, fontSize: 11, marginTop: 2 }}>Rechazado por {r.decided_by_name}</Text> : null}
                {r.status === 'recibido' ? <Text style={{ color: colors.success, fontSize: 11, marginTop: 2 }}>Recibido en inventario{r.received_at ? ` · ${dmyOf(r.received_at)}` : ''}</Text> : null}
                {r.attachment_url ? <Text style={{ color: colors.brandText, fontSize: 11, marginTop: 2, fontWeight: '700' }}>📎 Formato adjunto{r.attachment_type === 'pdf' ? ' (PDF)' : ' (imagen)'}</Text> : null}

                {r.supplier_id ? (() => {
                  const s = suppliers.find((sup) => sup.id === r.supplier_id);
                  if (!s) return null;
                  const hasBank = !!(s.bank_name || s.account_number);
                  const hasPm = !!s.pago_movil_phone;
                  const hasBin = !!s.binance_id;
                  return (
                    <View style={{ marginTop: spacing.xs, padding: spacing.xs, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text }}>Proveedor: {s.name}</Text>
                      {hasBank || hasPm || hasBin ? (
                        <Text style={{ fontSize: 10, color: colors.muted }}>
                          {hasBank ? `🏦 ${s.bank_name} (${s.account_number?.slice(-4) || '—'}) ` : ''}
                          {hasPm ? `📱 PM: ${s.pago_movil_phone} ` : ''}
                          {hasBin ? `🟡 Binance: ${s.binance_id}` : ''}
                        </Text>
                      ) : (
                        <Text style={{ fontSize: 10, color: '#D97706' }}>⚠️ Proveedor sin datos bancarios ni de pago móvil registrados</Text>
                      )}
                    </View>
                  );
                })() : null}

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                  <TouchableOpacity onPress={() => pdf(r)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🧾 PDF</Text>
                  </TouchableOpacity>
                  {/* Subir formato (imagen o PDF) al requerimiento. */}
                  {canWrite ? (
                    <TouchableOpacity onPress={() => subirFormato(r)} disabled={subiendoId === r.id} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: subiendoId === r.id ? 0.6 : 1 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>{subiendoId === r.id ? '⏳ Subiendo…' : r.attachment_url ? '📎 Cambiar formato' : '📎 Subir formato'}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Ver formato adjunto (vista previa + descarga). */}
                  {r.attachment_url ? (
                    <TouchableOpacity onPress={() => setPreviewReq(r)} style={{ backgroundColor: colors.infoSoftBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>👁️ Ver formato</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Solicitar aclaratoria técnica si está pendiente */}
                  {canWrite && r.status === 'pendiente' ? (
                    <TouchableOpacity onPress={() => abrirSolicitarAclaratoria(r)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: '#F59E0B', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: '#D97706', fontWeight: '800', fontSize: 12 }}>🔄 Solicitar Aclaratoria</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Responder aclaratoria técnica si está en aclaratoria */}
                  {r.status === 'aclaratoria_solicitada' ? (
                    <TouchableOpacity onPress={() => abrirResponderAclaratoria(r)} style={{ backgroundColor: '#F59E0B', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>📝 Responder Aclaratoria</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Editar datos de pago del proveedor si tiene proveedor asignado */}
                  {r.supplier_id && canWrite ? (() => {
                    const s = suppliers.find((sup) => sup.id === r.supplier_id);
                    if (!s) return null;
                    return (
                      <TouchableOpacity onPress={() => abrirEditarPagoProv(s)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>💳 Datos de Pago Prov.</Text>
                      </TouchableOpacity>
                    );
                  })() : null}
                  {isAdmin && r.status === 'pendiente' ? (
                    <>
                      <TouchableOpacity onPress={() => decidir(r, 'aprobado')} style={{ backgroundColor: colors.infoSoftBorder, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>✅ Aprobar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => decidir(r, 'rechazado')} style={{ backgroundColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>❌ Rechazar</Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                  {canReceive && r.status === 'aprobado' ? (
                    <TouchableOpacity onPress={() => abrirRecibir(r)} style={{ backgroundColor: colors.success, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>📥 Recibir en inventario</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Anular un requerimiento YA APROBADO: el mismo gerente lo rechaza y la
                      BD anula la orden de compra + cuenta por pagar generadas. */}
                  {isAdmin && r.status === 'aprobado' ? (
                    <TouchableOpacity onPress={() => anularAprobado(r)} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>⛔ Anular (rechazar)</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Revertir un rechazo (error de dedo) → vuelve a PENDIENTE y notifica. */}
                  {isAdmin && r.status === 'rechazado' ? (
                    <TouchableOpacity onPress={() => revertirRechazo(r)} style={{ backgroundColor: colors.warning, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>↩ Volver a pendiente</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Editar todo el requerimiento (no si ya se recibió en inventario). */}
                  {canWrite && r.status !== 'recibido' ? (
                    <TouchableOpacity onPress={() => abrirEditar(r)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>✏️ Editar</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Eliminar todo el requerimiento. */}
                  {canWrite ? (
                    <TouchableOpacity onPress={() => eliminar(r)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑️ Eliminar</Text>
                    </TouchableOpacity>
                  ) : null}
                  {!isAdmin && r.status === 'pendiente' ? <Text style={{ color: colors.muted, fontSize: 11, alignSelf: 'center' }}>Esperando aprobación del jefe…</Text> : null}
                  {r.status === 'aclaratoria_solicitada' ? <Text style={{ color: '#B45309', fontSize: 11, alignSelf: 'center', fontWeight: '700' }}>⚠️ Esperando respuesta técnica para reanudar aprobación</Text> : null}
                </View>
              </View>
            }
          />
        );
      })()}
              </View>
            </View>
            );
          })}
        </>
      );
      })()}

      {/* ── Crear requerimiento ── */}
      <Modal visible={createOpen} animationType="slide" onRequestClose={() => { setCreateOpen(false); limpiarForm(); }}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>{editId ? 'Editar requerimiento' : 'Nuevo requerimiento'}</SectionTitle>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Título (opcional)</Text>
              <TextInput value={title} onChangeText={setTitle} placeholder="EJ. REPUESTOS EXCAVADORA 320" placeholderTextColor={colors.muted} style={inp} />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Nota / justificación (opcional)</Text>
              <TextInput value={note} onChangeText={setNote} placeholder="Para qué se necesita…" placeholderTextColor={colors.muted} multiline style={[inp, { minHeight: 60, textAlignVertical: 'top' }]} />

              {/* Empresa para la que se hace el requerimiento (opcional). */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Empresa (opcional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingRight: spacing.md }}>
                {[{ id: null as string | null, name: 'Sin empresa' }, ...companies].map((c) => {
                  const on = companyId === c.id;
                  return (
                    <TouchableOpacity key={c.id ?? '__none__'} onPress={() => setCompanyId(c.id)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Proveedor (opcional): al asignarlo y APROBAR, la orden pasa a
                  "aprobada" y se genera la CUENTA POR PAGAR (trigger req_sync_compra).
                  Sin proveedor la orden queda en BORRADOR. Los proveedores se crean
                  en la pestaña "Proveedores" de Compras. */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Proveedor (opcional)</Text>
              {/* Selector buscable: muestra el proveedor elegido; al tocarlo abre
                  un buscador con la lista filtrada (hay muchos proveedores). */}
              <TouchableOpacity onPress={() => setSupOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: supplierId ? colors.brand : colors.border, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                <Text style={{ color: supplierId ? colors.text : colors.muted, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
                  {supplierId ? (suppliers.find((s) => s.id === supplierId)?.name ?? '—') : 'Sin proveedor'}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{supOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {supOpen ? (
                <View style={{ marginTop: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
                  <TextInput value={supQ} onChangeText={setSupQ} placeholder="Buscar proveedor…" placeholderTextColor={colors.muted} style={[inp, { margin: 6 }]} />
                  <View style={{ maxHeight: 200 }}>
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                      {[{ id: null as string | null, name: 'Sin proveedor' }, ...suppliers.filter((s) => !supQ.trim() || norm(s.name).includes(norm(supQ)))].map((s) => {
                        const on = supplierId === s.id;
                        return (
                          <TouchableOpacity key={s.id ?? '__none__'} onPress={() => { setSupplierId(s.id); setSupOpen(false); setSupQ(''); }} style={{ paddingVertical: 9, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: on ? colors.brand : 'transparent' }}>
                            <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{s.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      {suppliers.filter((s) => !supQ.trim() || norm(s.name).includes(norm(supQ))).length === 0 ? (
                        <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.md }}>Sin coincidencias.</Text>
                      ) : null}
                    </ScrollView>
                  </View>
                </View>
              ) : null}
              <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>Al asignar proveedor y aprobar, se generan la orden de compra y la cuenta por pagar automáticamente.</Text>

              {/* Coordenadas financieras del proveedor seleccionado */}
              {supplierId ? (() => {
                const s = suppliers.find((sup) => sup.id === supplierId);
                if (!s) return null;
                const hasBank = !!(s.bank_name || s.account_number);
                const hasPm = !!s.pago_movil_phone;
                const hasBin = !!s.binance_id;
                return (
                  <View style={{ marginTop: 6, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>💳 Datos de Pago del Proveedor</Text>
                      <TouchableOpacity onPress={() => abrirEditarPagoProv(s)}>
                        <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 11 }}>✏️ {hasBank || hasPm || hasBin ? 'Actualizar datos' : 'Registrar datos'}</Text>
                      </TouchableOpacity>
                    </View>
                    {hasBank || hasPm || hasBin ? (
                      <View style={{ marginTop: 4, gap: 2 }}>
                        {hasBank ? <Text style={{ fontSize: 11, color: colors.muted }}>🏦 {s.bank_name} · Cta: {s.account_number ? `...${s.account_number.slice(-4)}` : '—'} · {s.account_holder} ({s.account_id_doc})</Text> : null}
                        {hasPm ? <Text style={{ fontSize: 11, color: colors.muted }}>📱 PM: {s.pago_movil_phone} · {s.pago_movil_bank ?? '—'} · {s.pago_movil_id ?? '—'}</Text> : null}
                        {hasBin ? <Text style={{ fontSize: 11, color: colors.muted }}>🟡 Binance Pay ID: {s.binance_id}</Text> : null}
                      </View>
                    ) : (
                      <Text style={{ fontSize: 11, color: '#D97706', marginTop: 2 }}>⚠️ Sin coordenadas financieras registradas. Toca "Registrar datos" para agilizar el envío a Tesorería.</Text>
                    )}
                  </View>
                );
              })() : null}

              {/* 🏢 Empresa Pagadora (Tesorería / Desembolso) */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Empresa Pagadora (Tesorería)</Text>
              <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 4 }}>Entidad que realizará el desembolso financiero (ej. Construcciones Liscioni, C.A. vs Golden Touch 1127, C.A.).</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingRight: spacing.md }}>
                {[{ id: null as string | null, name: 'Por definir / Sin asignar' }, ...companies].map((c) => {
                  const on = empresaPagadoraId === c.id;
                  return (
                    <TouchableOpacity key={c.id ?? '__pagadora_none__'} onPress={() => { setEmpresaPagadoraId(c.id); setEmpresaPagadoraNombre(c.id ? c.name : null); }} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* 👤 RESPONSABLE: elegible entre los del rol ALMACENISTA; al elegido le
                  llega un aviso a su campana. Quien lo crea sale solo. Es opcional, pero
                  el rótulo NO lo dice (pedido textual, 17-oct-2026). */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Responsable</Text>
              <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 4 }}>✍️ Quien lo crea sale solo. El responsable se elige entre los almacenistas, y le llega un aviso con este requerimiento.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[{ id: null as string | null, name: 'Sin responsable' }, ...almacenistas].map((a) => {
                  const on = respId === a.id;
                  return (
                    <TouchableOpacity key={a.id ?? '__none__'} onPress={() => { setRespId(a.id); setRespNombre(a.id ? a.name : null); }} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{a.id ? `📦 ${a.name}` : a.name}</Text>
                    </TouchableOpacity>
                  );
                })}
                {almacenistas.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 11 }}>No hay usuarios con rol de almacenista todavía (se asigna en Usuarios).</Text>
                ) : null}
              </View>

              {/* 👤 QUIÉN LO SOLICITÓ Y QUIÉN LO AUTORIZÓ (20-oct-2026, a pedido).
                  Salen de la NÓMINA —que acá solo se lee— y, si la persona no está,
                  se escribe y queda en Contactos. No se confunden con «Solicita»
                  (el usuario que registra) ni con quien aprueba en el sistema. */}
              <PersonaNominaPicker
                titulo="Solicitado por"
                ayuda="👥 De la lista de la nómina. Si la persona no está, escribe su nombre y queda en Contactos."
                icono="👤"
                valor={solicitante}
                onElegir={setSolicitante}
                personas={personas}
                contactos={contactosLista}
                onGuardarContacto={guardarContacto}
                cargando={cargandoNomina}
              />
              <PersonaNominaPicker
                titulo="Autorizado por"
                ayuda="✅ Quién autorizó la compra. La aprobación dentro del sistema la sigue dando el jefe."
                icono="✅"
                valor={autorizado}
                onElegir={setAutorizado}
                personas={personas}
                contactos={contactosLista}
                onGuardarContacto={guardarContacto}
                cargando={cargandoNomina}
              />

              {/* 🚜 ¿Para qué es? Vehículo o maquinaria. Se puede dejar sin elegir. */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>¿Para qué es?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[{ key: null as string | null, chip: 'Sin especificar' }, ...DESTINOS].map((d) => {
                  const on = destino === d.key;
                  return (
                    <TouchableOpacity key={d.key ?? '__none__'} onPress={() => setDestino(d.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{d.chip}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* 🏢 Área a la que va dirigido. La lista sale de las áreas que YA
                  existen (nómina + requerimientos anteriores); si falta una, se
                  escribe con «✏️ Otra» — sin catálogo nuevo que mantener. */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Área a la que va dirigido</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <TouchableOpacity onPress={() => { setArea(''); setAreaLibre(false); }} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: !area && !areaLibre ? colors.brand : colors.border, backgroundColor: !area && !areaLibre ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: !area && !areaLibre ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>Sin área</Text>
                </TouchableOpacity>
                {areas.map((a) => {
                  const on = !areaLibre && area === a;
                  return (
                    <TouchableOpacity key={a} onPress={() => { setArea(a); setAreaLibre(false); }} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>🏢 {a}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity onPress={() => { setAreaLibre(true); }} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: areaLibre ? colors.brand : colors.border, backgroundColor: areaLibre ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: areaLibre ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>✏️ Otra</Text>
                </TouchableOpacity>
              </View>
              {areaLibre ? (
                <TextInput value={area} onChangeText={setArea} placeholder="Escribe el área (ej. ADMINISTRACIÓN)" placeholderTextColor={colors.muted} autoCapitalize="characters" style={[inp, { marginTop: 6 }]} />
              ) : null}
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity onPress={() => setPickOpen((v) => !v)} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>📦 Del inventario</Text></TouchableOpacity>
              <TouchableOpacity onPress={addBlank} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>＋ Producto nuevo</Text></TouchableOpacity>
            </View>

            {pickOpen ? (
              <Card>
                <TextInput value={q} onChangeText={setQ} placeholder="Buscar producto por nombre o SKU…" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />
                <View style={{ maxHeight: 200 }}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {productos.map((it) => (
                      <TouchableOpacity key={it.id} onPress={() => addFromProduct(it)} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{it.name}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{it.sku ? `${it.sku} · ` : ''}Stock {qtyFmt(it.stock)} · PMP {usd(it.avg_cost)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </Card>
            ) : null}

            {rows.map((x, i) => {
              const otra = x.currency === 'USD' ? fmtBs(bsFromUsd(parseNum(x.price), rate || 0)) : usd(usdFromBs(parseNum(x.price), rate || 0));
              return (
                <Card key={x.key}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                      {/* 🔢 Número del renglón (16-oct-2026, a pedido: «que me los vaya
                          enumerando»). Va por POSICIÓN, así que al quitar uno del medio
                          los de abajo se recorren solos y nunca queda un hueco. Es el
                          MISMO número que sale en la columna «#» del PDF. */}
                      <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                        <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>{i + 1}</Text>
                      </View>
                      <Text style={{ color: x.product_id ? colors.muted : colors.success, fontSize: 11, fontWeight: '700' }}>{x.product_id ? 'Del inventario' : 'Producto NUEVO'}</Text>
                    </View>
                    <TouchableOpacity onPress={() => rm(x.key)}><Text style={{ color: colors.danger, fontWeight: '800' }}>🗑 Quitar</Text></TouchableOpacity>
                  </View>
                  <TextInput value={x.name} onChangeText={(t) => upd(x.key, 'name', t)} editable={!x.product_id} placeholder="Nombre del producto" placeholderTextColor={colors.muted} style={[inp, x.product_id ? { color: colors.muted } : null]} />
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 6, alignItems: 'flex-end' }}>
                    <View style={{ width: 64 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cant</Text><TextInput value={x.qty} onChangeText={(t) => upd(x.key, 'qty', onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'center' }]} /></View>
                    <View style={{ width: 70 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Unidad</Text><TextInput value={x.unit} onChangeText={(t) => upd(x.key, 'unit', t.toUpperCase())} placeholder="UND" placeholderTextColor={colors.muted} style={inp} /></View>
                    <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Precio est.</Text><TextInput value={x.price} onChangeText={(t) => upd(x.key, 'price', onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'right' }]} /></View>
                    <TouchableOpacity onPress={() => upd(x.key, 'currency', x.currency === 'USD' ? 'VES' : 'USD')} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{x.currency === 'USD' ? '$' : 'Bs'}</Text>
                    </TouchableOpacity>
                  </View>
                  {parseNum(x.price) > 0 && rate ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'right' }}>≈ {otra} c/u</Text> : null}
                  {/* Imagen de referencia del producto: sale en el PDF junto a su descripción. */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
                    {x.image_url ? (
                      <Image source={{ uri: x.image_url }} style={{ width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }} />
                    ) : (
                      <View style={{ width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 22 }}>📷</Text>
                      </View>
                    )}
                    <TouchableOpacity onPress={() => subirImagenProducto(x.key)} disabled={subiendoImgKey === x.key} style={{ flex: 1, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: subiendoImgKey === x.key ? 0.6 : 1 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>{subiendoImgKey === x.key ? '⏳ Subiendo…' : x.image_url ? '🖼️ Cambiar imagen' : '🖼️ Imagen del producto'}</Text>
                    </TouchableOpacity>
                    {x.image_url ? (
                      <TouchableOpacity onPress={() => upd(x.key, 'image_url', '')}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>Quitar</Text></TouchableOpacity>
                    ) : null}
                  </View>
                </Card>
              );
            })}

            {rows.length ? (
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: colors.text, fontWeight: '900' }}>TOTAL ESTIMADO</Text><Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 16 }}>{usd(createTotalUsd)}</Text></View>
                {rate ? <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'right' }}>{fmtBs(bsFromUsd(createTotalUsd, rate))}</Text> : null}
              </Card>
            ) : <EmptyState title="Sin productos" subtitle="Agrega productos del inventario o nuevos." />}

            {/* Adjuntar FORMATO (imagen o PDF): cotización, foto del repuesto, planilla… */}
            <Card>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: 2 }}>📎 Formato (opcional)</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Adjunta una imagen o un PDF (cotización, foto del repuesto, planilla…). El jefe lo verá al aprobar.</Text>
              {formato ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
                  {formato.kind === 'image' ? <Image source={{ uri: formato.url }} style={{ width: 46, height: 46, borderRadius: radius.sm }} /> : <Text style={{ fontSize: 30 }}>📄</Text>}
                  <Text style={{ color: colors.text, fontSize: 12, flex: 1 }} numberOfLines={1}>{formato.name}{formato.kind === 'pdf' ? ' (PDF)' : ''}</Text>
                  <TouchableOpacity onPress={() => setFormato(null)}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>Quitar</Text></TouchableOpacity>
                </View>
              ) : null}
              <TouchableOpacity onPress={adjuntarFormatoNuevo} disabled={subiendoNuevo} style={{ borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: subiendoNuevo ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13 }}>{subiendoNuevo ? '⏳ Subiendo…' : formato ? '📎 Cambiar formato' : '📎 Adjuntar imagen o PDF'}</Text>
              </TouchableOpacity>
            </Card>

            {/* 📝 OBSERVACIONES — al final, como se pidió: «un espacio de
                observaciones para escribir cualquier cosa que necesite o
                información adicional». Sale impreso al final del formato. */}
            <Card>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: 2 }}>📝 Observaciones (opcional)</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Cualquier información adicional. Sale al final del formato que ve el jefe.</Text>
              <TextInput
                value={observaciones}
                onChangeText={setObservaciones}
                placeholder="Escribe aquí lo que haga falta…"
                placeholderTextColor={colors.muted}
                multiline
                style={[inp, { minHeight: 80, textAlignVertical: 'top' }]}
              />
            </Card>

            {formErr ? (
              <View style={{ marginTop: spacing.sm, backgroundColor: colors.dangerSoftBg, borderWidth: 1, borderColor: colors.dangerSoftBorder, borderRadius: radius.md, padding: spacing.sm }}>
                <Text style={{ color: colors.dangerSoftText, fontWeight: '700', fontSize: 13 }}>⚠️ {formErr}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => { setCreateOpen(false); limpiarForm(); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={crear} disabled={busy} style={{ flex: 2, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}><Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : (editId ? '💾 Guardar cambios' : '📤 Enviar al jefe')}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Vista previa del FORMATO adjunto (imagen o PDF) + descarga ── */}
      <Modal visible={!!previewReq} animationType="fade" transparent onRequestClose={() => setPreviewReq(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '90%', overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>📎 {previewReq?.attachment_name || 'Formato'}</Text>
              <TouchableOpacity onPress={() => setPreviewReq(null)} style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: spacing.md }}>
              {previewReq?.attachment_url ? (
                previewReq.attachment_type === 'pdf' ? (
                  Platform.OS === 'web'
                    ? React.createElement('iframe', { src: previewReq.attachment_url, style: { width: '100%', height: '65vh', border: 'none', borderRadius: 8 } })
                    : <Text style={{ color: colors.muted, fontSize: 13 }}>Toca "⬇️ Descargar / Abrir" para ver el PDF.</Text>
                ) : (
                  <Image source={{ uri: previewReq.attachment_url }} style={{ width: '100%', height: 420, borderRadius: radius.md }} resizeMode="contain" />
                )
              ) : null}
            </ScrollView>
            <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
              <TouchableOpacity onPress={() => previewReq && descargarFormato(previewReq)} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>⬇️ Descargar / Abrir</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Recibir en inventario ── */}
      <Modal visible={!!recvFor} animationType="slide" onRequestClose={() => setRecvFor(null)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>Recibir en inventario</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Confirma la cantidad y el PRECIO REAL de compra de cada producto. Se registrará como ENTRADA (los nuevos se crean solos). {recvFor?.code ?? ''}</Text>
            {recvRows.map((it, idx) => {
              const otra = it.currency === 'USD' ? fmtBs(bsFromUsd(parseNum(it.price), rate || 0)) : usd(usdFromBs(parseNum(it.price), rate || 0));
              return (
                <Card key={idx}>
                  {/* 🔢 Numerado igual que el requerimiento y su PDF, para ir
                      tachando renglón por renglón al recibir. */}
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}><Text style={{ color: colors.muted }}>{idx + 1}. </Text>{it.name} {it.product_id ? '' : <Text style={{ color: colors.success, fontSize: 11 }}>· NUEVO</Text>}</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 6, alignItems: 'flex-end' }}>
                    <View style={{ width: 70 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cantidad</Text><TextInput value={it.qty} onChangeText={(t) => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, qty: onlyDecimal(t) } : r))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'center' }]} /></View>
                    <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Precio real (unit.)</Text><TextInput value={it.price} onChangeText={(t) => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, price: onlyDecimal(t) } : r))} keyboardType="numeric" inputMode="decimal" style={[inp, { textAlign: 'right' }]} /></View>
                    <TouchableOpacity onPress={() => setRecvRows((p) => p.map((r, i) => i === idx ? { ...r, currency: r.currency === 'USD' ? 'VES' : 'USD' } : r))} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{it.currency === 'USD' ? '$' : 'Bs'}</Text>
                    </TouchableOpacity>
                  </View>
                  {parseNum(it.price) > 0 && rate ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'right' }}>≈ {otra} c/u</Text> : null}
                </Card>
              );
            })}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => setRecvFor(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity onPress={recibir} disabled={recvBusy} style={{ flex: 2, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: recvBusy ? 0.6 : 1 }}><Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{recvBusy ? 'Recibiendo…' : '📥 Confirmar entrada'}</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Modal: Datos Financieros del Proveedor (en tiempo real) ── */}
      <Modal visible={modalPagoProvOpen} animationType="slide" onRequestClose={() => setModalPagoProvOpen(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>Datos de Pago del Proveedor</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              Registra o actualiza las coordenadas de pago de {provParaPago?.name ?? 'el proveedor'} para agilizar la transición a Tesorería.
            </Text>

            <Card>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>🏦 Transferencia Bancaria (Nacional)</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Banco</Text>
              <TextInput value={provBanco} onChangeText={setProvBanco} placeholder="Ej. Banesco, Mercantil, BDV…" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Número de Cuenta (20 dígitos)</Text>
              <TextInput value={provNumCuenta} onChangeText={(t) => setProvNumCuenta(t.replace(/\D/g, '').slice(0, 20))} keyboardType="numeric" placeholder="0134..." placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Tipo de Cuenta</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: 6 }}>
                {(['Corriente', 'Ahorro'] as const).map((tipo) => (
                  <TouchableOpacity key={tipo} onPress={() => setProvTipoCuenta(tipo)} style={{ flex: 1, paddingVertical: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: provTipoCuenta === tipo ? colors.brand : colors.border, backgroundColor: provTipoCuenta === tipo ? colors.brand : colors.surfaceAlt, alignItems: 'center' }}>
                    <Text style={{ color: provTipoCuenta === tipo ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{tipo}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Nombre del Titular</Text>
              <TextInput value={provTitular} onChangeText={setProvTitular} placeholder="Nombre de la empresa o titular" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cédula / RIF del Titular</Text>
              <TextInput value={provDocTitular} onChangeText={(t) => setProvDocTitular(t.toUpperCase())} placeholder="J-12345678-9 o V-12345678" placeholderTextColor={colors.muted} style={inp} />
            </Card>

            <Card>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>📱 Pago Móvil</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Banco Pago Móvil</Text>
              <TextInput value={provPagoMovilBanco} onChangeText={setProvPagoMovilBanco} placeholder="Ej. Banesco, BDV, Mercantil…" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Teléfono Pago Móvil</Text>
              <TextInput value={provPagoMovilTel} onChangeText={setProvPagoMovilTel} keyboardType="phone-pad" placeholder="0414-1234567" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cédula / RIF Pago Móvil</Text>
              <TextInput value={provPagoMovilDoc} onChangeText={(t) => setProvPagoMovilDoc(t.toUpperCase())} placeholder="V-12345678 o J-12345678-9" placeholderTextColor={colors.muted} style={inp} />
            </Card>

            <Card>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>🟡 Billetera Digital (Binance Pay / Cripto)</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Binance Pay ID / Correo</Text>
              <TextInput value={provBinanceId} onChangeText={setProvBinanceId} placeholder="Binance ID o correo de cuenta" placeholderTextColor={colors.muted} style={[inp, { marginBottom: 6 }]} />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Notas adicionales de pago (opcional)</Text>
              <TextInput value={provNotasPago} onChangeText={setProvNotasPago} placeholder="Instrucciones especiales de pago…" placeholderTextColor={colors.muted} multiline style={[inp, { minHeight: 50, textAlignVertical: 'top' }]} />
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity onPress={() => setModalPagoProvOpen(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardarPagoProv} disabled={guardandoPagoProv} style={{ flex: 2, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: guardandoPagoProv ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{guardandoPagoProv ? 'Guardando…' : '💾 Guardar Datos de Pago'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Modal: Solicitar Aclaratoria Técnica (Bucle de Cotización) ── */}
      <Modal visible={aclaratoriaOpen} animationType="fade" transparent onRequestClose={() => setAclaratoriaOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>🔄 Solicitud de Información Adicional</Text>
              <TouchableOpacity onPress={() => setAclaratoriaOpen(false)}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: spacing.sm }}>
              Requerimiento {aclaratoriaTarget?.code ?? ''}: El ticket volverá al departamento solicitante y no podrá ser aprobado hasta recibir las especificaciones técnicas requeridas.
            </Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
              Detalles técnicos requeridos (tolerancias, medidas, fotos, material):
            </Text>
            <TextInput
              value={aclaratoriaMotivo}
              onChangeText={setAclaratoriaMotivo}
              placeholder="Indica qué medidas, tolerancias, dimensiones o especificaciones de catálogo hacen falta para poder cotizar..."
              placeholderTextColor={colors.muted}
              multiline
              style={[inp, { minHeight: 90, textAlignVertical: 'top', marginBottom: spacing.md }]}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity onPress={() => setAclaratoriaOpen(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={enviarSolicitudAclaratoria} disabled={aclaratoriaBusy} style={{ flex: 2, backgroundColor: '#D97706', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: aclaratoriaBusy ? 0.6 : 1 }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>{aclaratoriaBusy ? 'Enviando…' : '⚠️ Enviar Solicitud'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modal: Responder Aclaratoria Técnica (Solicitante) ── */}
      <Modal visible={respuestaOpen} animationType="fade" transparent onRequestClose={() => setRespuestaOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>📝 Respuesta Técnica de Aclaratoria</Text>
              <TouchableOpacity onPress={() => setRespuestaOpen(false)}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: spacing.xs }}>
              Requerimiento {respuestaTarget?.code ?? ''}: Ingresa las especificaciones o dimensiones solicitadas por Compras. Al responder, el ticket volverá a la cola de aprobación.
            </Text>
            {respuestaTarget?.aclaratoria_motivo ? (
              <View style={{ backgroundColor: '#FEF3C7', padding: spacing.sm, borderRadius: radius.md, marginBottom: spacing.sm }}>
                <Text style={{ color: '#92400E', fontWeight: '800', fontSize: 11 }}>Información solicitada por Compras:</Text>
                <Text style={{ color: '#B45309', fontSize: 12, marginTop: 2 }}>{respuestaTarget.aclaratoria_motivo}</Text>
              </View>
            ) : null}
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
              Respuesta / Especificaciones técnicas:
            </Text>
            <TextInput
              value={respuestaTexto}
              onChangeText={setRespuestaTexto}
              placeholder="Escribe las dimensiones exactas, tolerancia, material, número de parte o detalles técnicos..."
              placeholderTextColor={colors.muted}
              multiline
              style={[inp, { minHeight: 90, textAlignVertical: 'top', marginBottom: spacing.md }]}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity onPress={() => setRespuestaOpen(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={enviarRespuestaAclaratoria} disabled={respuestaBusy} style={{ flex: 2, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: respuestaBusy ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{respuestaBusy ? 'Enviando…' : '📤 Enviar Respuesta Técnica'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
