// PAGO DE VIAJES · lo que hay que pagar (15-sep-2026).
//
// Tarjeta del panel de información de Viajes de camiones. Por rango de fechas (por
// jornada, 7am a 7am): cada empresa con sus viajes pagados, los que no facturaron, los
// que quedaron sin pagar y el total. Tocar una empresa abre el detalle por camión y por
// viaje (PagoViajesDetalle), donde se marca «facturó / no facturó».
//
// ⭐ Vive SOLO en este módulo: no toca jornadas, Control de Maquinaria ni Control de Pagos.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Plegable } from './Plegable';
import { DateField } from './DateField';
import { PagoViajesPanel } from './PagoViajesPanel';
import { PagoViajesDetalle } from './PagoViajesDetalle';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { cmpText } from '../lib/text';
import { exportPdf, pdfDocument } from '../lib/pdf';
import {
  calcularPagoViajes,
  indexarMarcas,
  indexarModos,
  INICIO_PAGO_VIAJES,
  itemsViajePagados,
  jornadaDeInstante,
  viajesEnRango,
  PagoViajesGrupo,
} from '../lib/pagoViajes';
import { cargarDatosPagoViajes, DatosPagoViajes } from '../lib/pagoViajesDb';

type Props = {
  canEdit: boolean;
  usuarioId: string | null;
};

const usd = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesDe = (iso: string) => sumarDias(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function PagoViajesResumen({ canEdit, usuarioId }: Props) {
  const { colors } = useTheme();
  const hoy = jornadaDeInstante(new Date().toISOString());
  const [desde, setDesde] = useState(() => lunesDe(hoy));
  const [hasta, setHasta] = useState(hoy);
  const [datos, setDatos] = useState<DatosPagoViajes | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await cargarDatosPagoViajes());
      setError(null);
    } catch (e: any) {
      setError(`No se pudo leer el pago de viajes (${e?.message ?? 'revisa la conexión'}). No se muestran montos a medias: toca «Actualizar».`);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const empresas = useMemo(() => {
    if (!datos || error) return [] as { clave: string; nombre: string; g: PagoViajesGrupo }[];
    const grupos = calcularPagoViajes({
      viajes: viajesEnRango(datos.viajes, desde, hasta),
      modos: indexarModos(datos.modos),
      tarifas: datos.tarifas,
      marcas: indexarMarcas(datos.marcas),
      semanaDe: () => 'rango',
    });
    return Array.from(grupos.entries())
      .map(([clave, g]) => ({ clave, g, nombre: g.companyId ? datos.empresas.get(g.companyId) || 'Empresa' : 'Sin empresa (fuera del catálogo)' }))
      .sort((a, b) => cmpText(a.nombre, b.nombre));
  }, [datos, error, desde, hasta]);

  const tot = useMemo(() => empresas.reduce(
    (a, { g }) => ({ monto: a.monto + g.montoUSD, viajes: a.viajes + g.viajes, pagados: a.pagados + g.pagados, noFacturados: a.noFacturados + g.noFacturados, pendientes: a.pendientes + g.pendientes }),
    { monto: 0, viajes: 0, pagados: 0, noFacturados: 0, pendientes: 0 },
  ), [empresas]);

  const rangoInvalido = hasta < desde;

  const descargarPdf = async () => {
    const filas = empresas.map(({ nombre, g }) =>
      `<tr><td>${esc(nombre)}</td><td class="r">${g.pagados}</td><td class="r">${g.noFacturados || '—'}</td><td class="r">${g.pendientes || '—'}</td><td class="r b">${usd(g.montoUSD)}</td></tr>`).join('');
    const detalle = empresas.map(({ nombre, g }) => {
      const items = itemsViajePagados(g.lineas);
      return `<h3>${esc(nombre)} — ${usd(g.montoUSD)}</h3>
        <table><thead><tr><th>Camión</th><th>Zona</th><th class="r">Viajes</th><th class="r">Tarifa</th><th class="r">Monto</th></tr></thead>
        <tbody>${items.map((it) => `<tr><td>${esc(it.code)}</td><td>${it.zona === 'oeste' ? 'Oeste' : 'Este'}</td><td class="r">${it.viajes}</td><td class="r">${usd(it.precio)}</td><td class="r b">${usd(it.viajes * it.precio)}</td></tr>`).join('') || '<tr><td colspan="5" class="c">Sin viajes pagados</td></tr>'}</tbody></table>
        ${g.noFacturados || g.pendientes ? `<p class="n">${g.noFacturados ? `${g.noFacturados} viaje(s) marcados «no facturó». ` : ''}${g.pendientes ? `${g.pendientes} viaje(s) sin pagar (sin zona, sin tarifa o sin empresa).` : ''}</p>` : ''}`;
    }).join('');
    const html = pdfDocument({
      title: 'Pago de viajes de camiones',
      subtitle: `Del ${dmy(desde)} al ${dmy(hasta)} · por jornada (7am a 7am)`,
      extraCss: `
        table{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 10px}
        th,td{border:1px solid #ccc;padding:4px 7px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        td.r,th.r{text-align:right}td.c{text-align:center}td.b{font-weight:700}
        tfoot td{background:#1E3A5F;color:#fff;font-weight:800}
        h3{font-size:13px;color:#1E3A5F;margin:14px 0 2px}
        p.n{font-size:10px;color:#666;margin:0 0 8px}`,
      body: `
        <table><thead><tr><th>Empresa</th><th class="r">Viajes pagados</th><th class="r">No facturó</th><th class="r">Sin pagar</th><th class="r">Total</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="5" class="c">Sin viajes en el rango</td></tr>'}</tbody>
        <tfoot><tr><td>TOTAL A PAGAR</td><td class="r">${tot.pagados}</td><td class="r">${tot.noFacturados}</td><td class="r">${tot.pendientes}</td><td class="r">${usd(tot.monto)}</td></tr></tfoot></table>
        ${detalle}`,
    });
    await exportPdf(html, `Pago de viajes ${dmy(desde)} a ${dmy(hasta)}`);
  };

  const atajo = (label: string, d: string, h: string) => {
    const on = desde === d && hasta === h;
    return (
      <TouchableOpacity key={label} onPress={() => { setDesde(d); setHasta(h); }}
        style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
      </TouchableOpacity>
    );
  };
  const boton = (label: string, onPress: () => void, principal = false, disabled = false) => (
    <TouchableOpacity key={label} disabled={disabled} onPress={onPress}
      style={{ flexGrow: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: principal ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: principal ? colors.brand : colors.border, opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: principal ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <>
      <Plegable
        titulo="💰 Pago de viajes"
        resumen={error ? '⚠️ no se pudo leer' : `${tot.pagados} viaje(s) · ${usd(tot.monto)} · ${dmy(desde)} al ${dmy(hasta)}`}
        alerta={!!error || tot.pendientes > 0}
      >
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          Lo que se le paga a cada empresa por los viajes de sus camiones, con la tarifa que le toque (la de la zona
          del CDT, o la especial de su empresa, grupo o camión). Se cuenta
          por jornada (7am a 7am). El pago por viaje arranca el {dmy(INICIO_PAGO_VIAJES)}.
        </Text>

        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Desde</Text>
            <DateField value={desde} onChange={setDesde} />
          </View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Hasta</Text>
            <DateField value={hasta} onChange={setHasta} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.sm }}>
          {atajo('Esta semana', lunesDe(hoy), hoy)}
          {atajo('Semana pasada', sumarDias(lunesDe(hoy), -7), sumarDias(lunesDe(hoy), -1))}
          {atajo('Hoy', hoy, hoy)}
        </View>
        {rangoInvalido ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>La fecha «hasta» no puede ser anterior a «desde».</Text> : null}

        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.sm }}>
          {boton('⚙️ Tarifas y camiones', () => setPanelOpen(true))}
          {boton(cargando ? 'Actualizando…' : '↻ Actualizar', cargar, false, cargando)}
          {boton('📄 PDF', descargarPdf, true, !!error || rangoInvalido || !empresas.length)}
        </View>

        {error ? (
          <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoftBg, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>⚠️ {error}</Text>
          </View>
        ) : null}

        {!error ? (
          <View style={{ marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brand, padding: spacing.sm }}>
            <Text style={{ color: colors.brandContrast, opacity: 0.85, fontSize: 11, fontWeight: '800' }}>TOTAL A PAGAR</Text>
            <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 20, fontVariant: ['tabular-nums'] as any }}>{usd(tot.monto)}</Text>
            <Text style={{ color: colors.brandContrast, fontSize: 12 }}>
              {tot.pagados} viaje(s) pagados{tot.noFacturados ? ` · ${tot.noFacturados} no facturó` : ''}{tot.pendientes ? ` · ${tot.pendientes} sin pagar` : ''}
            </Text>
          </View>
        ) : null}

        {!error && !cargando && datos && !empresas.length && !rangoInvalido ? (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
            No hay viajes para pagar en ese rango. Revisa que los camiones estén marcados «por viaje» en «⚙️ Tarifas y camiones».
          </Text>
        ) : null}

        {empresas.map(({ clave, nombre, g }) => {
          const open = abierta === clave;
          return (
            <View key={clave} style={{ marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setAbierta(open ? null : clave)}
                style={{ borderWidth: 1, borderColor: g.pendientes ? colors.warning : colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>🏢 {nombre}</Text>
                  <Text style={{ color: colors.brandText, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{usd(g.montoUSD)}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {g.pagados} pagado(s){g.noFacturados ? ` · ${g.noFacturados} no facturó` : ''}{g.pendientes ? ` · ⚠️ ${g.pendientes} sin pagar` : ''} · {open ? '▲ ocultar' : '▼ ver detalle'}
                </Text>
              </TouchableOpacity>
              {open ? <PagoViajesDetalle grupo={g} canEdit={canEdit} onChanged={cargar} /> : null}
            </View>
          );
        })}
      </Plegable>

      <PagoViajesPanel
        visible={panelOpen}
        onClose={() => setPanelOpen(false)}
        canEdit={canEdit}
        usuarioId={usuarioId}
        onChanged={cargar}
      />
    </>
  );
}
