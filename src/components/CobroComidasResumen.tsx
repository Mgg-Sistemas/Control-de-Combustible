// COBRO DE COMIDAS · lo que hay que cobrar (15-sep-2026).
//
// Tarjeta de la pestaña Reportes de Distribución de comida. Usa el MISMO rango y las
// MISMAS entregas que ya cargó la pantalla, y les pone precio: una cuenta por empresa
// (lo entregado por QR más lo de su gente por carnet), la nómina propia y lo que no tiene
// ficha. Tocar una cuenta muestra cuántas comidas de cada tipo, a qué precio y el monto.
//
// ⭐ Solo lee. No cambia cómo registra la cocina ni los conteos de la pantalla.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Plegable } from './Plegable';
import { CobroComidasPrecios } from './CobroComidasPrecios';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { MEALS } from '../lib/foodCompanyMeals';
import { FoodCompanyMeal, FoodDistribution } from '../types/database';
import {
  calcularCobroComidas,
  totalCobroComidas,
  CuentaComida,
  EmpresaDePersona,
  PrecioComida,
  SIN_CATEGORIA,
} from '../lib/cobroComidas';
import { cargarEmpresaDePersonas, cargarPreciosComida } from '../lib/cobroComidasDb';

type Props = {
  desde: string;
  hasta: string;
  hoy: string;
  /** Entregas por QR del rango (sin filtrar por empresa). */
  empresas: FoodCompanyMeal[];
  /** Entregas por carnet del rango. */
  personas: FoodDistribution[];
  /** 'all' o la clave de empresa del filtro de la pantalla (company_id o nombre). */
  filtroEmpresa: string;
  canEdit: boolean;
  usuarioId: string | null;
};

const usd = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const etiqueta = (k: string) => {
  if (k === SIN_CATEGORIA) return 'Sin comida marcada';
  const m = MEALS.find((x) => x.key === k);
  return m ? `${m.icon} ${m.label}` : k;
};

export function CobroComidasResumen({ desde, hasta, hoy, empresas, personas, filtroEmpresa, canEdit, usuarioId }: Props) {
  const { colors } = useTheme();
  const [precios, setPrecios] = useState<PrecioComida[] | null>(null);
  const [fichas, setFichas] = useState<Map<string, EmpresaDePersona> | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const idsPersonas = useMemo(
    () => Array.from(new Set(personas.map((p) => p.employee_id).filter(Boolean) as string[])).sort(),
    [personas],
  );
  const claveIds = idsPersonas.join(',');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [p, f] = await Promise.all([cargarPreciosComida(), cargarEmpresaDePersonas(claveIds ? claveIds.split(',') : [])]);
      setPrecios(p);
      setFichas(f);
      setError(null);
    } catch (e: any) {
      setError(`No se pudo leer el cobro de comidas (${e?.message ?? 'revisa la conexión'}). No se muestran montos a medias: toca «Actualizar».`);
    } finally {
      setCargando(false);
    }
  }, [claveIds]);

  useEffect(() => { cargar(); }, [cargar]);

  const cuentas = useMemo(() => {
    if (!precios || !fichas || error) return [] as CuentaComida[];
    const todas = calcularCobroComidas({ empresas, personas, empresaDePersona: fichas, precios });
    return filtroEmpresa === 'all' ? todas : todas.filter((c) => c.clave === filtroEmpresa);
  }, [precios, fichas, error, empresas, personas, filtroEmpresa]);

  const tot = useMemo(() => totalCobroComidas(cuentas), [cuentas]);

  const descargarPdf = async () => {
    const filas = cuentas.map((c) =>
      `<tr><td>${esc(c.nombre)}</td><td class="r">${c.porQr || '—'}</td><td class="r">${c.porCarnet || '—'}</td><td class="r">${c.sinPrecio || '—'}</td><td class="r b">${usd(c.monto)}</td></tr>`).join('');
    const detalle = cuentas.map((c) => `
      <h3>${esc(c.nombre)} — ${usd(c.monto)}</h3>
      <table><thead><tr><th>Comida</th><th class="r">Cantidad</th><th class="r">Precio</th><th class="r">Monto</th></tr></thead>
      <tbody>${c.items.map((it) => `<tr><td>${esc(etiqueta(it.categoria))}</td><td class="r">${it.cantidad}</td><td class="r">${it.precio === null ? 'sin precio' : usd(it.precio)}</td><td class="r b">${it.precio === null ? '—' : usd(it.monto)}</td></tr>`).join('')}</tbody></table>`).join('');
    const html = pdfDocument({
      title: 'Cobro de comidas',
      subtitle: `Del ${dmy(desde)} al ${dmy(hasta)}`,
      extraCss: `
        table{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 10px}
        th,td{border:1px solid #ccc;padding:4px 7px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        td.r,th.r{text-align:right}td.c{text-align:center}td.b{font-weight:700}
        tfoot td{background:#1E3A5F;color:#fff;font-weight:800}
        h3{font-size:13px;color:#1E3A5F;margin:14px 0 2px}`,
      body: `
        <table><thead><tr><th>Cuenta</th><th class="r">Por QR</th><th class="r">Por carnet</th><th class="r">Sin precio</th><th class="r">Total</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="5" class="c">Sin comidas en el rango</td></tr>'}</tbody>
        <tfoot><tr><td>TOTAL A COBRAR</td><td></td><td></td><td class="r">${tot.sinPrecio}</td><td class="r">${usd(tot.monto)}</td></tr></tfoot></table>
        ${detalle}`,
    });
    await exportPdf(html, `Cobro de comidas ${dmy(desde)} a ${dmy(hasta)}`);
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
        titulo="💵 Cobro de comidas"
        resumen={error ? '⚠️ no se pudo leer' : `${tot.cobradas} comida(s) · ${usd(tot.monto)} · ${dmy(desde)} al ${dmy(hasta)}`}
        alerta={!!error || tot.sinPrecio > 0}
      >
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          Lo entregado en el rango de arriba, con el precio de cada comida ese día. Lo que se entregó por QR va a la
          empresa del QR; lo que se entregó por carnet va a la empresa de la ficha de la persona.
        </Text>

        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
          {boton('💲 Precios', () => setPanelOpen(true))}
          {boton(cargando ? 'Actualizando…' : '↻ Actualizar', cargar, false, cargando)}
          {boton('📄 PDF del cobro', descargarPdf, true, !!error || !cuentas.length)}
        </View>

        {error ? (
          <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoftBg, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>⚠️ {error}</Text>
          </View>
        ) : (
          <View style={{ marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brand, padding: spacing.sm }}>
            <Text style={{ color: colors.brandContrast, opacity: 0.85, fontSize: 11, fontWeight: '800' }}>TOTAL A COBRAR</Text>
            <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 20, fontVariant: ['tabular-nums'] as any }}>{usd(tot.monto)}</Text>
            <Text style={{ color: colors.brandContrast, fontSize: 12 }}>
              {tot.cobradas} comida(s) con precio{tot.sinPrecio ? ` · ⚠️ ${tot.sinPrecio} sin precio` : ''}
            </Text>
          </View>
        )}

        {tot.sinPrecio > 0 && !error ? (
          <Text style={{ color: colors.warning, fontSize: 12, marginTop: spacing.xs }}>
            Hay comidas sin precio para su fecha: no suman al total. Ponles precio en «💲 Precios».
          </Text>
        ) : null}

        {cuentas.map((c) => {
          const open = abierta === c.clave;
          return (
            <View key={c.clave} style={{ marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setAbierta(open ? null : c.clave)}
                style={{ borderWidth: 1, borderColor: c.sinPrecio ? colors.warning : colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>🏢 {c.nombre}</Text>
                  <Text style={{ color: colors.brandText, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{usd(c.monto)}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {c.comidas} comida(s){c.porQr ? ` · ${c.porQr} por QR` : ''}{c.porCarnet ? ` · ${c.porCarnet} por carnet` : ''}
                  {c.sinPrecio ? ` · ⚠️ ${c.sinPrecio} sin precio` : ''} · {open ? '▲ ocultar' : '▼ ver detalle'}
                </Text>
              </TouchableOpacity>
              {open ? (
                <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: colors.border, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm }}>
                  {c.items.map((it) => (
                    <View key={`${it.categoria}|${it.precio}`} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                      <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>
                        {etiqueta(it.categoria)} · {it.cantidad} × {it.precio === null ? 'sin precio' : usd(it.precio)}
                      </Text>
                      <Text style={{ color: it.precio === null ? colors.warning : colors.text, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>
                        {it.precio === null ? '—' : usd(it.monto)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </Plegable>

      <CobroComidasPrecios
        visible={panelOpen}
        onClose={() => setPanelOpen(false)}
        canEdit={canEdit}
        usuarioId={usuarioId}
        hoy={hoy}
        onChanged={cargar}
      />
    </>
  );
}
