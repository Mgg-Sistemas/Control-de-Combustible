// COBRO DE COMIDAS · lo que hay que cobrar (15-sep-2026).
//
// Tarjeta de la pestaña Reportes de Distribución de comida. Usa el MISMO rango y las
// MISMAS entregas que ya cargó la pantalla, y les pone precio: una cuenta por empresa
// (lo entregado por QR más lo de su gente por carnet), la nómina propia y lo que no tiene
// ficha; o, si se elige, una por ENCARGADO. Lo que no se cobra (consumo interno) se valora
// aparte y no suma al total a cobrar.
//
// ⭐ Solo lee. No cambia cómo registra la cocina ni los conteos de la pantalla.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Plegable } from './Plegable';
import { CobroComidasPrecios } from './CobroComidasPrecios';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { COMPANY_MEALS, OTROS_MEAL } from '../lib/foodCompanyMeals';
import { FoodCompanyMeal, FoodDistribution } from '../types/database';
import {
  calcularCobroComidas,
  indexarConfigCuentas,
  totalCobroComidas,
  ConfigCuenta,
  CATEGORIA_OTROS,
  CuentaComida,
  EjeCobro,
  ItemCobro,
  EmpresaDePersona,
  PrecioComida,
  SIN_CATEGORIA,
} from '../lib/cobroComidas';
import { cargarConfigCuentas, cargarEmpresaDePersonas, cargarEncargados, cargarPreciosComida, EncargadoCatalogo } from '../lib/cobroComidasDb';
import { PlatoCatalogo, nombreDeOpcion, resolverPlatos } from '../lib/comidaPlatos';
import { cargarPlatos } from '../lib/comidaPlatosDb';

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
  /** Nombre de quien usa la pantalla: queda en el contacto de cocina que cree. */
  usuarioNombre?: string | null;
};

const usd = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const etiqueta = (k: string) => {
  if (k === SIN_CATEGORIA) return 'Sin comida marcada';
  const m = COMPANY_MEALS.find((x) => x.key === k);
  return m ? `${m.icon} ${m.label}` : k;
};
/**
 * Cómo se llama el renglón en la factura. Un «Otros» se llama POR SU OPCIÓN —«🧾 HIELO»,
 * «🧾 AGUA»—, no «🧾 Otros · HIELO»: al cliente se le cobra hielo, y «Otros» es el nombre
 * de la gaveta del sistema, no el de lo que se le entregó (pedido del cliente, 23-sep-2026).
 * Uno viejo sin nombre se sigue llamando «Otros»: mejor eso que un renglón en blanco.
 */
const etiquetaItem = (it: ItemCobro) => {
  const opcion = nombreDeOpcion(it.categoria, it.plato);
  return opcion ? `${OTROS_MEAL.icon} ${opcion}` : etiqueta(it.categoria);
};
/** Cuando el precio de un plato de «Otros» lo escribió la cocina (no tiene precio propio), se dice. */
const precioItem = (it: ItemCobro) =>
  it.precio === null
    ? 'sin precio'
    : `${usd(it.precio)}${it.fuente === 'cocina' ? ' (costo de la cocina)' : ''}`;
/** Cuántas comidas de los renglones que cumplen `cond`, y de qué platos. */
const contarItems = (cuentas: CuentaComida[], cond: (it: ItemCobro) => boolean) => {
  let n = 0;
  const platos = new Set<string>();
  cuentas.forEach((c) => c.items.filter(cond).forEach((it) => { n += it.cantidad; if (it.plato) platos.add(it.plato); }));
  return { n, platos: Array.from(platos).sort((a, b) => a.localeCompare(b, 'es')) };
};
const resumirDetalle = (d: string[]) => (d.length > 4 ? `${d.slice(0, 4).join(', ')} y ${d.length - 4} más` : d.join(', '));

export function CobroComidasResumen({ desde, hasta, hoy, empresas, personas, filtroEmpresa, canEdit, usuarioId, usuarioNombre }: Props) {
  const { colors } = useTheme();
  const [precios, setPrecios] = useState<PrecioComida[] | null>(null);
  const [fichas, setFichas] = useState<Map<string, EmpresaDePersona> | null>(null);
  const [config, setConfig] = useState<ConfigCuenta[] | null>(null);
  const [encargados, setEncargados] = useState<EncargadoCatalogo[]>([]);
  const [platos, setPlatos] = useState<PlatoCatalogo[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [eje, setEje] = useState<EjeCobro>('cuenta');

  const idsPersonas = useMemo(
    () => Array.from(new Set(personas.map((p) => p.employee_id).filter(Boolean) as string[])).sort(),
    [personas],
  );
  const claveIds = idsPersonas.join(',');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [p, f, c, e, pl] = await Promise.all([
        cargarPreciosComida(),
        cargarEmpresaDePersonas(claveIds ? claveIds.split(',') : []),
        cargarConfigCuentas(),
        cargarEncargados(),
        cargarPlatos(),
      ]);
      setPrecios(p);
      setPlatos(pl);
      setFichas(f);
      setConfig(c);
      setEncargados(e);
      setError(null);
    } catch (e: any) {
      setError(`No se pudo leer el cobro de comidas (${e?.message ?? 'revisa la conexión'}). No se muestran montos a medias: toca «Actualizar».`);
    } finally {
      setCargando(false);
    }
  }, [claveIds]);

  useEffect(() => { cargar(); }, [cargar]);

  const cuentas = useMemo(() => {
    // Sin los platos no se sabe el precio de «Otros»: nada de montos a medias.
    if (!precios || !fichas || !config || !platos || error) return [] as CuentaComida[];
    const todas = calcularCobroComidas({
      empresas,
      personas,
      empresaDePersona: fichas,
      precios,
      config: indexarConfigCuentas(config),
      encargados: new Map(encargados.map((e) => [e.id, e.name])),
      eje,
      platoAPrecio: resolverPlatos(platos),
    });
    // El filtro de empresa de la pantalla solo tiene sentido viendo por cuenta.
    return eje === 'cuenta' && filtroEmpresa !== 'all' ? todas.filter((c) => c.clave === filtroEmpresa) : todas;
  }, [precios, fichas, config, platos, encargados, error, empresas, personas, filtroEmpresa, eje]);

  const tot = useMemo(() => totalCobroComidas(cuentas), [cuentas]);
  // Dos avisos distintos porque se arreglan en sitios distintos: a una comida fija le
  // falta el precio en la tabla; a un plato de «Otros», el costo que escribe la cocina.
  const sinPrecioFijas = useMemo(() => contarItems(cuentas, (it) => it.precio === null && it.categoria !== CATEGORIA_OTROS).n, [cuentas]);
  // «Todos deben tener precio»: un plato de «Otros» sin precio propio se cobra con el
  // costo de la cocina, pero se avisa igual, con su nombre, para que se lo pongan.
  const otrosConCostoCocina = useMemo(() => contarItems(cuentas, (it) => it.fuente === 'cocina'), [cuentas]);
  const otrosSinNada = useMemo(() => contarItems(cuentas, (it) => it.precio === null && it.categoria === CATEGORIA_OTROS), [cuentas]);

  const descargarPdf = async () => {
    const filas = cuentas.map((c) =>
      `<tr><td>${esc(c.nombre)}</td><td class="r">${c.porQr || '—'}</td><td class="r">${c.porCarnet || '—'}</td><td class="r">${c.porContacto || '—'}</td><td class="r">${c.sinPrecio || '—'}</td><td class="r">${c.montoInterno ? usd(c.montoInterno) : '—'}</td><td class="r b">${usd(c.monto)}</td></tr>`).join('');
    const detalle = cuentas.map((c) => `
      <h3>${esc(c.nombre)} — ${usd(c.monto)}${c.montoInterno ? ` · interno ${usd(c.montoInterno)}` : ''}</h3>
      ${c.detalle.length ? `<p class="n">${esc(c.detalle.join(', '))}</p>` : ''}
      <table><thead><tr><th>Comida</th><th class="r">Cantidad</th><th class="r">Precio</th><th class="r">Monto</th><th>Se cobra</th></tr></thead>
      <tbody>${c.items.map((it) => `<tr><td>${esc(etiquetaItem(it))}</td><td class="r">${it.cantidad}</td><td class="r">${esc(precioItem(it))}</td><td class="r b">${it.precio === null ? '—' : usd(it.monto)}</td><td>${it.seCobra ? 'Sí' : 'No (interno)'}</td></tr>`).join('')}</tbody></table>`).join('');
    const html = pdfDocument({
      title: 'Cobro de comidas',
      subtitle: `Del ${dmy(desde)} al ${dmy(hasta)} · ${eje === 'encargado' ? 'por encargado' : 'por cuenta'}`,
      extraCss: `
        table{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 10px}
        th,td{border:1px solid #ccc;padding:4px 7px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        td.r,th.r{text-align:right}td.c{text-align:center}td.b{font-weight:700}
        tfoot td{background:#1E3A5F;color:#fff;font-weight:800}
        h3{font-size:13px;color:#1E3A5F;margin:14px 0 2px}
        p.n{font-size:10px;color:#666;margin:0 0 4px}`,
      body: `
        <table><thead><tr><th>${eje === 'encargado' ? 'Encargado' : 'Cuenta'}</th><th class="r">Por QR</th><th class="r">Por carnet</th><th class="r">Contactos</th><th class="r">Sin precio</th><th class="r">Consumo interno</th><th class="r">A cobrar</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="7" class="c">Sin comidas en el rango</td></tr>'}</tbody>
        <tfoot><tr><td>TOTAL</td><td></td><td></td><td></td><td class="r">${tot.sinPrecio}</td><td class="r">${usd(tot.montoInterno)}</td><td class="r">${usd(tot.monto)}</td></tr></tfoot></table>
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
  const chipEje = (key: EjeCobro, label: string) => {
    const on = eje === key;
    return (
      <TouchableOpacity key={key} onPress={() => { setEje(key); setAbierta(null); }}
        style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <Plegable
        titulo="💵 Cobro de comidas"
        resumen={error ? '⚠️ no se pudo leer' : `${usd(tot.monto)} a cobrar${tot.montoInterno ? ` · interno ${usd(tot.montoInterno)}` : ''} · ${dmy(desde)} al ${dmy(hasta)}`}
        alerta={!!error || tot.sinPrecio > 0 || otrosConCostoCocina.n > 0}
      >
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          Lo entregado en el rango de arriba, con el precio de cada comida ese día. Lo que se entregó por QR va a la
          empresa del QR; lo que se entregó por carnet va a la empresa de la ficha de la persona; y lo de un 📇 contacto
          de cocina va a su empresa o a su propia cuenta, según como quedó en cada entrega. Lo que no se cobra
          (consumo interno) se muestra aparte y no suma al total. Los platos de «Otros» se cobran con su precio de
          «🧾 Platos»; si todavía no tienen, con el costo por plato que escribió la cocina.
        </Text>

        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginBottom: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 12, alignSelf: 'center' }}>Agrupar por:</Text>
          {chipEje('cuenta', '🏢 Cuenta')}
          {chipEje('encargado', '👤 Encargado')}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
          {boton('💲 Precios y cuentas', () => setPanelOpen(true))}
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
              {tot.cobradas} comida(s) a cobrar{tot.sinPrecio ? ` · ⚠️ ${tot.sinPrecio} sin precio` : ''}
            </Text>
            {tot.comidasInternas ? (
              <Text style={{ color: colors.brandContrast, fontSize: 12, marginTop: 2 }}>
                🏠 Consumo interno (no se cobra): {usd(tot.montoInterno)} · {tot.comidasInternas} comida(s)
              </Text>
            ) : null}
          </View>
        )}

        {sinPrecioFijas > 0 && !error ? (
          <Text style={{ color: colors.warning, fontSize: 12, marginTop: spacing.xs }}>
            Hay {sinPrecioFijas} comida(s) sin precio para su fecha: no suman. Ponles precio en «💲 Precios y cuentas».
          </Text>
        ) : null}
        {otrosSinNada.n > 0 && !error ? (
          <Text style={{ color: colors.warning, fontSize: 12, marginTop: spacing.xs }}>
            Hay {otrosSinNada.n} plato(s) de «Otros» sin precio ni costo de la cocina: no suman
            {otrosSinNada.platos.length ? ` (${otrosSinNada.platos.join(', ')})` : ''}. Ponles precio en «💲 Precios y cuentas» →
            «🧾 Platos».
          </Text>
        ) : null}
        {otrosConCostoCocina.n > 0 && !error ? (
          <Text style={{ color: colors.warning, fontSize: 12, marginTop: spacing.xs }}>
            {otrosConCostoCocina.n} plato(s) de «Otros» sin precio propio se están cobrando con el costo que escribió la
            cocina{otrosConCostoCocina.platos.length ? ` (${otrosConCostoCocina.platos.join(', ')})` : ''}. Ponles precio en
            «💲 Precios y cuentas» → «🧾 Platos».
          </Text>
        ) : null}

        {cuentas.map((c) => {
          const open = abierta === c.clave;
          return (
            <View key={c.clave} style={{ marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setAbierta(open ? null : c.clave)}
                style={{ borderWidth: 1, borderColor: c.sinPrecio ? colors.warning : colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{eje === 'encargado' ? '👤' : c.clase === 'contacto' ? '📇' : '🏢'} {c.nombre}</Text>
                  <Text style={{ color: colors.brandText, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{usd(c.monto)}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {c.comidas} comida(s){c.porQr ? ` · ${c.porQr} por QR` : ''}{c.porCarnet ? ` · ${c.porCarnet} por carnet` : ''}{c.porContacto ? ` · ${c.porContacto} a contactos` : ''}
                  {c.comidasInternas ? ` · 🏠 interno ${usd(c.montoInterno)}` : ''}
                  {c.sinPrecio ? ` · ⚠️ ${c.sinPrecio} sin precio` : ''} · {open ? '▲ ocultar' : '▼ ver detalle'}
                </Text>
                {(eje === 'encargado' || c.detalle.length > 1) && c.detalle.length ? (
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{resumirDetalle(c.detalle)}</Text>
                ) : null}
              </TouchableOpacity>
              {open ? (
                <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: colors.border, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm }}>
                  {c.detalle.length > 4 ? <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>{c.detalle.join(', ')}</Text> : null}
                  {c.items.map((it) => (
                    <View key={`${it.categoria}|${it.plato ?? ''}|${it.precio}|${it.seCobra}`} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                      <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>
                        {etiquetaItem(it)} · {it.cantidad} × {precioItem(it)}{it.seCobra ? '' : '  · 🏠 interno'}
                      </Text>
                      <Text style={{ color: it.precio === null ? colors.warning : it.seCobra ? colors.text : colors.muted, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>
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
        usuarioNombre={usuarioNombre}
        hoy={hoy}
        onChanged={cargar}
      />
    </>
  );
}
