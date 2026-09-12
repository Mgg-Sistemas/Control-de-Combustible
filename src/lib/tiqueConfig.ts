// QUÉ SALE EN EL TIQUE · configuración (12-sep-2026).
//
// Pedido del cliente: «ese ticket yo le pueda quitar o colocar cualquier logo, y
// colocar o quitar cualquier información que quiera que le salga, dejarlo
// programado, un chek para cada cosa».
//
// ⭐ LA CONFIGURACIÓN VIVE EN LA BASE, NO EN EL TELÉFONO. Es una sola fila para
//    todo el sistema (`tique_config`, con `id boolean` y su check, así que no
//    puede haber dos ni por error). Lo que marca el admin es lo que imprimen los
//    chamos en el CDT: si viviera en cada dispositivo, dos tiques del mismo día
//    saldrían distintos según quién los imprimió, y nadie sabría cuál es el
//    formato bueno.
//
// ⚠️ LO NUEVO ENTRA APAGADO. Es la regla de la casa: un campo que se agrega no
//    puede cambiarle el papel a nadie sin que lo pidan.

export type PapelTique = 'rollo80' | 'rollo58' | 'carta1' | 'carta2' | 'carta4' | 'carta6';

export type ClaveCampo =
  | 'folio' | 'fecha' | 'hora' | 'placa' | 'empresa' | 'cdt'
  | 'jornada' | 'turno' | 'codigo' | 'marcaModelo' | 'serial'
  | 'chofer' | 'listero' | 'm3' | 'estado' | 'nota';

export type ClaveLogo = 'sos' | 'goldenTouch' | 'renace' | 'bcv';

export type TiqueConfig = {
  campos: Record<ClaveCampo, boolean>;
  logos: Record<ClaveLogo, boolean>;
  papel: PapelTique;
};

/**
 * ⚠️ EL FOLIO NO SE PUEDE APAGAR, y es lo único que no.
 *
 * Un tique sin número no identifica nada: no se puede cantar por radio, no se
 * puede reclamar y no se puede cruzar con el viaje. El cliente pidió «un chek
 * para cada cosa» y en todo lo demás lo tiene; acá la casilla se ve, se explica
 * y no se deja tocar, que es más honesto que esconderla.
 */
export const CAMPO_FIJO: ClaveCampo = 'folio';

/** El orden en que salen en la pantalla Y en el papel. Es el mismo a propósito:
 *  configurar en un orden y que imprima en otro es como se pierde la confianza. */
export const CAMPOS_TIQUE: { k: ClaveCampo; label: string; ayuda?: string }[] = [
  { k: 'folio',       label: '🎫 Número del tique', ayuda: 'No se puede quitar: sin número el tique no identifica nada.' },
  { k: 'fecha',       label: '📅 Fecha' },
  { k: 'hora',        label: '🕐 Hora' },
  { k: 'placa',       label: '🚗 Placa', ayuda: 'Si el camión no tiene placa cargada, sale su serial.' },
  { k: 'empresa',     label: '🏢 Empresa' },
  { k: 'cdt',         label: '🏗️ CDT / obra' },
  { k: 'jornada',     label: '📆 Jornada', ayuda: 'El día de trabajo, de 7am a 7am. Un viaje de las 2am cuenta para el día anterior.' },
  { k: 'turno',       label: '🌓 Turno', ayuda: 'Día o noche. No es lo mismo que la jornada.' },
  { k: 'codigo',      label: '🚜 Equipo' },
  { k: 'marcaModelo', label: '🏷️ Marca y modelo' },
  { k: 'serial',      label: '🔧 Serial' },
  { k: 'chofer',      label: '👤 Chofer' },
  { k: 'listero',     label: '📝 Listero' },
  { k: 'm3',          label: '📐 Metros cúbicos', ayuda: 'Sale de lo que se mida en Cubicaje. Hoy es un promedio del día, no una medición de ese viaje.' },
  { k: 'estado',      label: '⚙️ Estado del camión' },
  { k: 'nota',        label: '🗒️ Nota' },
];

export const LOGOS_TIQUE: { k: ClaveLogo; label: string }[] = [
  { k: 'sos',         label: 'SOS La Guaira' },
  { k: 'goldenTouch', label: 'Golden Touch' },
  { k: 'renace',      label: 'Plan Venezuela Renace' },
  { k: 'bcv',         label: 'BCV' },
];

export const PAPELES: { k: PapelTique; label: string; ayuda: string }[] = [
  { k: 'rollo80', label: 'Rollo 80 mm', ayuda: 'Tiquetera de rollo ancha, la más común. Sin página: el tique termina donde termina.' },
  { k: 'rollo58', label: 'Rollo 58 mm', ayuda: 'Tiquetera de rollo angosta. Caben menos datos por renglón.' },
  { k: 'carta1',  label: '1 por hoja',  ayuda: 'Impresora normal, un tique por página.' },
  { k: 'carta2',  label: '2 por hoja',  ayuda: 'Impresora normal, dos tiques por página.' },
  { k: 'carta4',  label: '4 por hoja',  ayuda: 'Impresora normal, cuatro por página.' },
  { k: 'carta6',  label: '6 por hoja',  ayuda: 'Impresora normal, seis por página. Salen chiquitos.' },
];

/** Los seis que el cliente pidió, encendidos. Todo lo demás apagado. */
export const CONFIG_POR_DEFECTO: TiqueConfig = {
  campos: {
    folio: true, fecha: true, hora: true, placa: true, empresa: true, cdt: true,
    jornada: false, turno: false, codigo: false, marcaModelo: false, serial: false,
    chofer: false, listero: false, m3: false, estado: false, nota: false,
  },
  logos: { sos: true, goldenTouch: true, renace: false, bcv: false },
  papel: 'carta1',
};

const esPapel = (v: unknown): v is PapelTique => PAPELES.some((p) => p.k === v);

/**
 * NORMALIZA LO QUE VENGA DE LA BASE.
 *
 * ⚠️ ESTO NO ES DEFENSA PARANOICA, ES EL CASO NORMAL. Cada vez que se agregue un
 *    campo nuevo al tique, las filas ya guardadas NO van a tener esa clave, y
 *    leerlas crudas daría `undefined` — que en un `if` se comporta como apagado
 *    pero en un interruptor se ve como una casilla rota. Se mezcla sobre los
 *    valores por defecto para que la clave nueva entre con su valor de fábrica y
 *    lo que el admin ya marcó no se pise.
 *
 *    Es el mismo tropiezo que ya costó una prueba en el cubicaje: un objeto
 *    escrito a mano dejaba las claves nuevas en `undefined` sin que nada avisara.
 */
export function normalizarConfig(bruto: any): TiqueConfig {
  const campos = { ...CONFIG_POR_DEFECTO.campos };
  const logos = { ...CONFIG_POR_DEFECTO.logos };
  const dc = bruto?.campos;
  const dl = bruto?.logos;
  if (dc && typeof dc === 'object') {
    (Object.keys(campos) as ClaveCampo[]).forEach((k) => {
      if (typeof dc[k] === 'boolean') campos[k] = dc[k];
    });
  }
  if (dl && typeof dl === 'object') {
    (Object.keys(logos) as ClaveLogo[]).forEach((k) => {
      if (typeof dl[k] === 'boolean') logos[k] = dl[k];
    });
  }
  // El folio manda sobre lo guardado: si una fila vieja lo trae apagado —o
  // alguien lo apaga escribiendo en la tabla— el tique saldría sin número.
  campos[CAMPO_FIJO] = true;
  return { campos, logos, papel: esPapel(bruto?.papel) ? bruto.papel : CONFIG_POR_DEFECTO.papel };
}

/** ¿Cuántos interruptores están distintos de como vienen de fábrica? */
export function cambiosRespectoAlDefecto(c: TiqueConfig): number {
  let n = 0;
  (Object.keys(CONFIG_POR_DEFECTO.campos) as ClaveCampo[]).forEach((k) => {
    if (c.campos[k] !== CONFIG_POR_DEFECTO.campos[k]) n++;
  });
  (Object.keys(CONFIG_POR_DEFECTO.logos) as ClaveLogo[]).forEach((k) => {
    if (c.logos[k] !== CONFIG_POR_DEFECTO.logos[k]) n++;
  });
  if (c.papel !== CONFIG_POR_DEFECTO.papel) n++;
  return n;
}

/** Lo que se ve en el encabezado plegado: cuántos datos trae el papel. */
export function resumenConfig(c: TiqueConfig): string {
  const datos = (Object.keys(c.campos) as ClaveCampo[]).filter((k) => c.campos[k]).length;
  const logos = (Object.keys(c.logos) as ClaveLogo[]).filter((k) => c.logos[k]).length;
  const papel = PAPELES.find((p) => p.k === c.papel)?.label ?? c.papel;
  return `${datos} dato(s) · ${logos} logo(s) · ${papel}`;
}
