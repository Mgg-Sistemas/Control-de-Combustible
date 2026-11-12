// 🏭 CENTRO DE OPERACIONES — 🔁 MOVIMIENTO ENTRE PATIOS (11-nov-2026).
//
// Pedido: «agregar una parte que diga movimiento de vestigios entre terrazas, donde me indique
// los patios que yo cree y me deje mover los vestigios por m³ y viajes desde un patio a otro;
// básicamente es movimiento interno».
//
// ⭐ NO ES ALGO NUEVO EN LA BASE: es el tipo «interno» (terraza → terraza) que ya existe en
//    ✍️ Carga libre y que el Reporte completo y el Corte de viajes ya suman. Este bloque solo
//    lo pone A LA VISTA en el 📅 Parte diario con un formulario corto, y guarda con la MISMA
//    validación (`validarCarga`) y el MISMO guardado (`guardarMovimiento`). Lo cargado antes por
//    Carga libre aparece aquí, y lo de aquí aparece allá y en los reportes.
//
// Pura (sin pantalla ni base): se prueba en scripts/test-centro-operaciones-internos.mjs.
import type { ItemLista, Movimiento } from './centroOperaciones';
import { m3De } from './centroOperaciones';
import { formularioNuevo, validarCarga, cifraDeCampo, viajesDeCampo, type DatosCarga } from './centroOperacionesCarga';

/** Los patios ACTIVOS del sitio (la clase «terraza»), A→Z. */
export function patiosActivos(listas: ItemLista[]): ItemLista[] {
  return (listas ?? []).filter((i) => i.clase === 'terraza' && i.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
}

/** Los materiales ACTIVOS (para decir qué se movió: vestigios, arena…), A→Z. */
export function materialesActivos(listas: ItemLista[]): ItemLista[] {
  return (listas ?? []).filter((i) => i.clase === 'material' && i.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
}

/** Los movimientos internos del día (de Carga libre o de este bloque), en orden de carga. */
export function internosDelDia(delDia: Movimiento[]): Movimiento[] {
  return (delDia ?? []).filter((m) => m.tipo === 'interno');
}

/** «3 movimientos · 12 viajes · 96,00 m³» (los «por confirmar» no suman, como en los reportes). */
export function resumenInternos(lista: Movimiento[]): string {
  if (!lista.length) return 'Sin movimientos entre patios este día';
  const conf = lista.filter((m) => m.estado !== 'por_confirmar');
  const viajes = conf.reduce((s, m) => s + (Number(m.viajes) || 0), 0);
  const m3 = conf.reduce((s, m) => s + (m3De(m) ?? 0), 0);
  const pend = lista.length - conf.length;
  const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${lista.length} movimiento(s) · ${viajes} viaje(s) · ${fmt(m3)} m³${pend ? ` · ${pend} por confirmar` : ''}`;
}

/** Por patio: lo que SALIÓ y lo que ENTRÓ por movimiento interno ese día (viajes y m³). */
export function balancePorPatio(lista: Movimiento[]): { patio: string; salenViajes: number; salenM3: number; entranViajes: number; entranM3: number }[] {
  const mapa = new Map<string, { patio: string; salenViajes: number; salenM3: number; entranViajes: number; entranM3: number }>();
  const de = (p: string) => { const k = p.trim().toUpperCase(); if (!mapa.has(k)) mapa.set(k, { patio: p.trim(), salenViajes: 0, salenM3: 0, entranViajes: 0, entranM3: 0 }); return mapa.get(k)!; };
  for (const m of lista) {
    if (m.estado === 'por_confirmar') continue;
    const v = Number(m.viajes) || 0;
    const q = m3De(m) ?? 0;
    if (m.origen) { const o = de(m.origen); o.salenViajes += v; o.salenM3 += q; }
    if (m.destino) { const d = de(m.destino); d.entranViajes += v; d.entranM3 += q; }
  }
  return [...mapa.values()].sort((a, b) => a.patio.localeCompare(b.patio, 'es', { numeric: true }));
}

/** Lo que se escribe en el formulario corto (los números como TEXTO, como en Carga libre). */
export type FormInterno = {
  fecha: string;
  origenId: string | null;
  destinoId: string | null;
  viajes: string;
  /** m³ por viaje (capacidad). Con viajes, da el total solo. */
  capacidad: string;
  /** m³ totales escritos a mano (mandan sobre viajes × capacidad). */
  m3: string;
  materialId: string | null;
  observacion: string;
};

export const formInternoVacio = (fecha: string): FormInterno => ({ fecha, origenId: null, destinoId: null, viajes: '1', capacidad: '', m3: '', materialId: null, observacion: '' });

/** Los m³ que va a contar: los escritos, o viajes × m³ por viaje; null si falta un dato. */
export function m3DelFormulario(f: FormInterno): number | null {
  return m3De({ m3: cifraDeCampo(f.m3).valor, viajes: viajesDeCampo(f.viajes).valor, capacidadM3: cifraDeCampo(f.capacidad, { mayorQueCero: true }).valor } as Movimiento);
}

/**
 * Revisa el formulario y arma lo que se guarda, con LA validación de Carga libre
 * (`validarCarga`: fecha, viajes enteros, m³ ≥ 0, capacidad > 0, no jornadas futuras) más
 * lo propio de este bloque: los dos patios, distintos, y algo con qué medir (viajes o m³).
 */
export function validarInterno(f: FormInterno, listas: ItemLista[], hoy?: string): { errores: string[]; datos: DatosCarga } {
  const patios = patiosActivos(listas);
  const materiales = materialesActivos(listas);
  const origen = patios.find((p) => p.id === f.origenId) ?? null;
  const destino = patios.find((p) => p.id === f.destinoId) ?? null;
  const material = materiales.find((p) => p.id === f.materialId) ?? null;
  const base = formularioNuevo(f.fecha);
  const { errores, datos } = validarCarga({
    ...base,
    tipo: 'interno',
    origen: { texto: origen?.nombre ?? '', listaId: origen?.id ?? null },
    destino: { texto: destino?.nombre ?? '', listaId: destino?.id ?? null },
    material: { texto: material?.nombre ?? '', listaId: material?.id ?? null },
    viajes: f.viajes,
    capacidad: f.capacidad,
    m3: f.m3,
    estado: 'confirmado',
    observacion: f.observacion,
  }, hoy);
  const propios: string[] = [];
  if (!origen) propios.push('Elige el patio DE DÓNDE sale.');
  if (!destino) propios.push('Elige el patio A DÓNDE va.');
  if (origen && destino && origen.id === destino.id) propios.push('El patio de origen y el de destino tienen que ser distintos.');
  if (!(Number(datos.viajes) > 0) && !(Number(datos.m3) > 0)) propios.push('Escribe los viajes o los m³ movidos.');
  return { errores: [...propios, ...errores], datos };
}
