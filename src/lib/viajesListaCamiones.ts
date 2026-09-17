import { isVolteoVolqueta } from './equipos';

/**
 * QUÉ MÁQUINAS SALEN EN LA LISTA DE VIAJES DE CAMIONES (17-sep-2026).
 *
 * Pedido del cliente: «como admin poder quitarle o colocarle máquinas a ese módulo…
 * si quiero que vean más o que vean menos». Hasta ahora la lista la decidía SOLO el
 * texto del código (`isVolteoVolqueta`: volteo, volqueta, toronto).
 *
 * ⭐ El ajuste del admin MANDA; sin ajuste, sigue la regla del código. Así nada cambia
 *    para las máquinas que nadie tocó, y un ajuste se puede deshacer («volver a lo
 *    automático») sin tener que recordar cómo estaba.
 *
 * ⚠️ Esconder una máquina de la lista NO borra ni esconde sus viajes ya registrados, ni
 *    la saca del pago por viaje: es solo qué se le OFRECE al listero para registrar.
 */

export type AjusteListaViajes = {
  machinery_id: string;
  visible: boolean;
  updated_at?: string | null;
  updated_by_nombre?: string | null;
};

export type IndiceAjustesLista = Map<string, AjusteListaViajes>;

export function indexarAjustesLista(filas: AjusteListaViajes[] | null | undefined): IndiceAjustesLista {
  const idx: IndiceAjustesLista = new Map();
  (filas ?? []).forEach((f) => {
    if (!f?.machinery_id || typeof f.visible !== 'boolean') return;
    idx.set(f.machinery_id, f);
  });
  return idx;
}

/** ¿La máquina sale en la lista del listero? */
export function saleEnViajes(code: string | null | undefined, ajuste?: AjusteListaViajes | null): boolean {
  return ajuste ? ajuste.visible : isVolteoVolqueta(code || '');
}

export type EstadoEnLista = 'auto_sale' | 'auto_no_sale' | 'puesta' | 'quitada';

export function estadoEnLista(code: string | null | undefined, ajuste?: AjusteListaViajes | null): EstadoEnLista {
  if (ajuste) return ajuste.visible ? 'puesta' : 'quitada';
  return isVolteoVolqueta(code || '') ? 'auto_sale' : 'auto_no_sale';
}

export function etiquetaEstadoEnLista(e: EstadoEnLista): string {
  switch (e) {
    case 'auto_sale': return 'Sale (automático, por su código)';
    case 'auto_no_sale': return 'No sale (automático, por su código)';
    case 'puesta': return '✋ Sale (la pusiste tú)';
    case 'quitada': return '✋ No sale (la quitaste tú)';
  }
}
