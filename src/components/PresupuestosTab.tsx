// ============================================================================
// 💼 PESTAÑA DE PRESUPUESTOS DE MAQUINARIA (en Módulo de Ventas)
// ============================================================================
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { EmptyState } from './ui';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { exportPdf } from '../lib/pdf';
import { useTable } from '../hooks/useTable';
import { useAuth } from '../context/AuthContext';
import { Company, Contacto, Machinery } from '../types/database';
import { Presupuesto, PresupuestoEstado } from '../types/presupuesto';
import {
  listarPresupuestos, cambiarEstadoPresupuesto, eliminarPresupuesto
} from '../lib/presupuestosStorage';
import { presupuestoDocumentoHtml } from '../lib/presupuestoDocumento';
import { PresupuestoFormModal } from './PresupuestoFormModal';

export function PresupuestosTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { fullName } = useAuth();

  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | PresupuestoEstado>('todos');
  const [companyFilter, setCompanyFilter] = useState<string>('todas');

  // Modal de crear / editar
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPresupuesto, setSelectedPresupuesto] = useState<Presupuesto | null>(null);

  // Tablas necesarias para el formulario
  const { data: empresas } = useTable<Company>('companies', { orderBy: 'name' });
  const { data: contactos } = useTable<Contacto>('contactos', { orderBy: 'name' });
  const { data: maquinaria } = useTable<Machinery>('machinery', { orderBy: 'code' });

  const reloadData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listarPresupuestos();
      setPresupuestos(list);
    } catch {
      toast.error('No se pudieron cargar los presupuestos.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    reloadData();
  }, [reloadData]);

  // Filtrado de presupuestos
  const filtrados = useMemo(() => {
    return presupuestos.filter((p) => {
      if (statusFilter !== 'todos' && p.status !== statusFilter) return false;
      if (companyFilter !== 'todas' && p.company_id !== companyFilter) return false;
      if (q.trim()) {
        const query = q.toLowerCase();
        const matchCode = p.code?.toLowerCase().includes(query);
        const matchClient = p.client_name?.toLowerCase().includes(query);
        const matchDoc = p.client_doc?.toLowerCase().includes(query);
        const matchProject = p.project_name?.toLowerCase().includes(query);
        const matchItems = p.items?.some((it) => it.description?.toLowerCase().includes(query));
        return matchCode || matchClient || matchDoc || matchProject || matchItems;
      }
      return true;
    });
  }, [presupuestos, statusFilter, companyFilter, q]);

  // KPIs
  const kpis = useMemo(() => {
    const totalUSD = presupuestos.reduce((acc, p) => acc + (p.total || 0), 0);
    const pendientes = presupuestos.filter((p) => p.status === 'emitido' || p.status === 'borrador').length;
    const aceptados = presupuestos.filter((p) => p.status === 'aceptado').length;
    const totalAceptadoUSD = presupuestos
      .filter((p) => p.status === 'aceptado')
      .reduce((acc, p) => acc + (p.total || 0), 0);

    return { totalUSD, pendientes, aceptados, totalAceptadoUSD };
  }, [presupuestos]);

  // Acciones
  const handleExportPdf = async (p: Presupuesto) => {
    try {
      const html = presupuestoDocumentoHtml(p);
      await exportPdf(html, `Presupuesto ${p.code} - ${p.client_name}`);
    } catch (e: any) {
      toast.error(e?.message || 'Error al exportar el documento.');
    }
  };

  const handleNuevo = () => {
    setSelectedPresupuesto(null);
    setModalOpen(true);
  };

  const handleEditar = (p: Presupuesto) => {
    setSelectedPresupuesto(p);
    setModalOpen(true);
  };

  const handleAceptar = async (p: Presupuesto) => {
    const ok = await confirm({
      title: `Aceptar Presupuesto ${p.code}`,
      message: `¿El cliente ${p.client_name} ha aceptado formalmente este presupuesto por un monto de $ ${p.total.toLocaleString()}?`,
      confirmText: 'Sí, Aceptar Oferta',
    });
    if (!ok) return;

    await cambiarEstadoPresupuesto(p.id, 'aceptado');
    toast.success(`Presupuesto ${p.code} marcado como ACEPTADO.`);
    reloadData();
  };

  const handleRechazar = async (p: Presupuesto) => {
    const ok = await confirm({
      title: `Rechazar Presupuesto ${p.code}`,
      message: `¿Marcar este presupuesto como RECHAZADO?`,
      confirmText: 'Sí, Rechazar',
    });
    if (!ok) return;

    await cambiarEstadoPresupuesto(p.id, 'rechazado');
    toast.info(`Presupuesto ${p.code} marcado como rechazado.`);
    reloadData();
  };

  const handleEliminar = async (p: Presupuesto) => {
    const ok = await confirm({
      title: `Eliminar ${p.code}`,
      message: `¿Estás seguro de eliminar el presupuesto de ${p.client_name}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar Presupuesto',
      danger: true,
    });
    if (!ok) return;

    await eliminarPresupuesto(p.id);
    toast.success(`Presupuesto ${p.code} eliminado.`);
    reloadData();
  };

  const badgeColor = (st: PresupuestoEstado) => {
    switch (st) {
      case 'aceptado': return '#16A34A';
      case 'rechazado': return '#DC2626';
      case 'vencido': return '#64748B';
      case 'borrador': return '#D97706';
      default: return '#2563EB';
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        {/* Banner superior con KPIs */}
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 140, padding: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: colors.muted, textTransform: 'uppercase' }}>Total Cotizado</Text>
            <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text, marginTop: 2 }}>$ {kpis.totalUSD.toLocaleString()}</Text>
            <Text style={{ fontSize: 9.5, color: colors.muted }}>{presupuestos.length} ofertas emitidas</Text>
          </View>
          <View style={{ flex: 1, minWidth: 140, padding: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: '#16A34A', textTransform: 'uppercase' }}>Aprobados / Cerrados</Text>
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#16A34A', marginTop: 2 }}>$ {kpis.totalAceptadoUSD.toLocaleString()}</Text>
            <Text style={{ fontSize: 9.5, color: colors.muted }}>{kpis.aceptados} contratos ganados</Text>
          </View>
          <View style={{ flex: 1, minWidth: 140, padding: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: '#2563EB', textTransform: 'uppercase' }}>Pendientes</Text>
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#2563EB', marginTop: 2 }}>{kpis.pendientes}</Text>
            <Text style={{ fontSize: 9.5, color: colors.muted }}>En espera de cliente</Text>
          </View>
        </View>

        {/* Barra de control: Botón nuevo + Buscador */}
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Buscar por cliente, N° presupuesto, equipo u obra..."
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                paddingHorizontal: spacing.sm,
                paddingVertical: 8,
                fontSize: 13,
                color: colors.text,
                backgroundColor: colors.surface,
              }}
            />
          </View>
          {canWrite && (
            <TouchableOpacity
              onPress={handleNuevo}
              style={{
                backgroundColor: colors.brand,
                paddingHorizontal: spacing.md,
                paddingVertical: 9,
                borderRadius: radius.md,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Text style={{ fontSize: 14 }}>➕</Text>
              <Text style={{ fontSize: 12.5, fontWeight: '800', color: colors.brandContrast }}>
                Nuevo Presupuesto
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Filtros por estado */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
          {[
            { key: 'todos', label: 'Todos' },
            { key: 'emitido', label: 'Emitidos' },
            { key: 'aceptado', label: 'Aceptados' },
            { key: 'borrador', label: 'Borradores' },
            { key: 'rechazado', label: 'Rechazados' },
            { key: 'vencido', label: 'Vencidos' },
          ].map((st) => {
            const on = statusFilter === st.key;
            return (
              <TouchableOpacity
                key={st.key}
                onPress={() => setStatusFilter(st.key as any)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: on ? colors.brand : colors.border,
                  backgroundColor: on ? colors.brand : colors.surfaceAlt,
                }}
              >
                <Text style={{ fontSize: 11.5, fontWeight: '700', color: on ? colors.brandContrast : colors.text }}>
                  {st.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Lista de presupuestos */}
        {filtrados.length === 0 ? (
          <EmptyState
            title="Sin presupuestos encontrados"
            subtitle={q ? 'No hay resultados que coincidan con la búsqueda.' : 'Aún no se han emitido presupuestos de maquinaria. Toca "Nuevo Presupuesto" para crear el primero.'}
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {filtrados.map((p) => {
              const bColor = badgeColor(p.status);
              return (
                <View
                  key={p.id}
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderLeftWidth: 5,
                    borderLeftColor: bColor,
                    padding: spacing.md,
                    gap: spacing.xs,
                  }}
                >
                  {/* Encabezado de la tarjeta */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, marginRight: spacing.sm }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 15, fontWeight: '900', color: colors.text }}>{p.code}</Text>
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: bColor }}>
                          <Text style={{ fontSize: 9.5, fontWeight: '800', color: '#fff', textTransform: 'uppercase' }}>
                            {p.status}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: colors.brand, marginTop: 2 }}>
                        {p.client_name}
                      </Text>
                      {p.client_doc ? (
                        <Text style={{ fontSize: 11, color: colors.muted }}>RIF: {p.client_doc}</Text>
                      ) : null}
                    </View>

                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: '#16A34A' }}>
                        $ {p.total.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                      </Text>
                      {p.total_bs ? (
                        <Text style={{ fontSize: 10.5, color: colors.muted }}>
                          Bs. {p.total_bs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                        </Text>
                      ) : null}
                      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
                        {p.company_name}
                      </Text>
                    </View>
                  </View>

                  {/* Resumen de equipos */}
                  <View style={{ marginVertical: 4, paddingVertical: 4, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }}>
                    <Text style={{ fontSize: 11, color: colors.text }}>
                      🚜 {p.items?.length || 0} equipo(s):{' '}
                      <Text style={{ fontWeight: '600', color: colors.muted }}>
                        {p.items?.map((it) => it.description || it.machine_code).filter(Boolean).join(' • ') || 'Sin detalle'}
                      </Text>
                    </Text>
                    {p.project_name ? (
                      <Text style={{ fontSize: 10.5, color: colors.muted, marginTop: 2 }}>
                        📍 Proyecto: <Text style={{ fontWeight: '600' }}>{p.project_name}</Text>
                      </Text>
                    ) : null}
                    <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
                      📅 Emisión: {p.date} · Vigente hasta: {p.valid_until}
                    </Text>
                  </View>

                  {/* Botones de acción */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => handleExportPdf(p)}
                        style={{
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 5,
                          borderRadius: radius.sm,
                          backgroundColor: colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: colors.border,
                        }}
                      >
                        <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.text }}>📄 PDF</Text>
                      </TouchableOpacity>

                      {canWrite && (
                        <TouchableOpacity
                          onPress={() => handleEditar(p)}
                          style={{
                            paddingHorizontal: spacing.sm,
                            paddingVertical: 5,
                            borderRadius: radius.sm,
                            backgroundColor: colors.surfaceAlt,
                            borderWidth: 1,
                            borderColor: colors.border,
                          }}
                        >
                          <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.text }}>✏️ Editar</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {canWrite && (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {p.status !== 'aceptado' && (
                          <TouchableOpacity
                            onPress={() => handleAceptar(p)}
                            style={{
                              paddingHorizontal: spacing.sm,
                              paddingVertical: 5,
                              borderRadius: radius.sm,
                              backgroundColor: '#DCFCE7',
                            }}
                          >
                            <Text style={{ fontSize: 11, fontWeight: '800', color: '#16A34A' }}>✅ Aceptar</Text>
                          </TouchableOpacity>
                        )}
                        {p.status !== 'rechazado' && (
                          <TouchableOpacity
                            onPress={() => handleRechazar(p)}
                            style={{
                              paddingHorizontal: spacing.sm,
                              paddingVertical: 5,
                              borderRadius: radius.sm,
                              backgroundColor: '#FEE2E2',
                            }}
                          >
                            <Text style={{ fontSize: 11, fontWeight: '800', color: '#DC2626' }}>❌ Rechazar</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => handleEliminar(p)}
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 5,
                            borderRadius: radius.sm,
                            backgroundColor: colors.surfaceAlt,
                          }}
                        >
                          <Text style={{ fontSize: 11, color: colors.muted }}>🗑️</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Modal de formulario */}
      <PresupuestoFormModal
        visible={modalOpen}
        presupuesto={selectedPresupuesto}
        empresas={empresas}
        contactos={contactos}
        maquinaria={maquinaria}
        userName={fullName}
        onClose={() => setModalOpen(false)}
        onGuardado={() => {
          reloadData();
        }}
      />
    </View>
  );
}
