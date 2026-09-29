// QUÉ SALE EN EL TICKET · configuración (12-sep-2026).
//
// Pedido del cliente: «ese ticket yo le pueda quitar o colocar cualquier logo, y
// colocar o quitar cualquier información que quiera que le salga, dejarlo
// programado, un chek para cada cosa».
//
// ⭐ LA CONFIGURACIÓN VIVE EN LA BASE, NO EN EL TELÉFONO. Es una sola fila para
//    todo el sistema (`tique_config`, con `id boolean` y su check, así que no
//    puede haber dos ni por error). Lo que marca el admin es lo que imprimen los
//    chamos en el CDT: si viviera en cada dispositivo, dos tickets del mismo día
//    saldrían distintos según quién los imprimió, y nadie sabría cuál es el
//    formato bueno.
//
// ⚠️ LO NUEVO ENTRA APAGADO. Es la regla de la casa: un campo que se agrega no
//    puede cambiarle el papel a nadie sin que lo pidan.

export type PapelTique = 'rollo80' | 'rollo58' | 'carta1' | 'carta2' | 'carta4' | 'carta6';

export type ClaveCampo =
  | 'folio' | 'fecha' | 'hora' | 'placa' | 'empresa' | 'cdt'
  | 'jornada' | 'turno' | 'codigo' | 'marcaModelo' | 'serial'
  | 'chofer' | 'listero' | 'm3'
  | 'pesoBruto' | 'pesoTara' | 'pesoNeto'
  | 'estado' | 'nota';

export type ClaveLogo = 'sos' | 'goldenTouch' | 'renace' | 'bcv';

export type TiqueConfig = {
  campos: Record<ClaveCampo, boolean>;
  logos: Record<ClaveLogo, boolean>;
  papel: PapelTique;
  /**
   * TEXTO PUESTO A MANO por campo (27-sep-2026). Pedido del cliente: cada
   * apartado del ticket «o toma el dato del sistema, o se coloca a mano, o se
   * quita». Una clave presente = ese campo imprime ESTE texto, igual en TODOS
   * los tickets, en vez del dato del viaje. Ausente = automático (como hoy).
   * Apagado el check, el texto no pinta nada: quitar manda sobre todo.
   *
   * ⚠️ El folio (CAMPO_FIJO) nunca acepta texto a mano: es el correlativo que
   *    identifica el ticket; un número fijo haría iguales a todos los papeles.
   */
  textos: Partial<Record<ClaveCampo, string>>;
  /**
   * EN QUÉ UNIDAD salen los pesos en el papel (27-sep-2026, a pedido): kilos
   * («32.540,00 Kg», el papel de muestra) o toneladas («32,540 Ton»). Solo
   * cambia el TEXTO impreso: el dato guardado es kilos siempre. 'kg' de
   * fábrica — sin tocar nada, el papel sale igual que siempre.
   */
  pesosUnidad: 'kg' | 't';
};

/** Tope del texto a mano. En el rollo de 58 caben ~32 letras por renglón; 80
 *  ya son dos renglones y medio — más que eso es un párrafo, no un dato. */
export const TEXTO_FIJO_MAX = 80;

/**
 * ⚠️ EL FOLIO NO SE PUEDE APAGAR, y es lo único que no.
 *
 * Un ticket sin número no identifica nada: no se puede cantar por radio, no se
 * puede reclamar y no se puede cruzar con el viaje. El cliente pidió «un chek
 * para cada cosa» y en todo lo demás lo tiene; acá la casilla se ve, se explica
 * y no se deja tocar, que es más honesto que esconderla.
 */
export const CAMPO_FIJO: ClaveCampo = 'folio';

/**
 * El orden en que salen en la pantalla Y en el papel. Es el mismo a propósito:
 * configurar en un orden y que imprima en otro es como se pierde la confianza.
 *
 * `label` es lo que se lee en la pantalla de configuración, con su emoji.
 * `corto` es lo que se IMPRIME al lado del dato.
 *
 * ⚠️ SON DOS TEXTOS DISTINTOS A PROPÓSITO. Una ticketera térmica no dibuja
 *    emojis: los saca como un cuadrito, o como nada, o le come el resto del
 *    renglón. En pantalla el emoji ayuda a encontrar el interruptor de un
 *    vistazo; en el papel estorba. Y en un rollo de 58 mm caben unos 32
 *    caracteres por renglón, así que la etiqueta tiene que ser corta o el dato
 *    se va a la línea de abajo.
 */
export const CAMPOS_TIQUE: { k: ClaveCampo; label: string; corto: string; ayuda?: string }[] = [
  { k: 'folio',       label: '🎫 Número del ticket', corto: 'Ticket',   ayuda: 'No se puede quitar: sin número el ticket no identifica nada.' },
  { k: 'fecha',       label: '📅 Fecha',            corto: 'Fecha' },
  { k: 'hora',        label: '🕐 Hora',             corto: 'Hora' },
  { k: 'placa',       label: '🚗 Placa',            corto: 'Placa',   ayuda: 'Si el camión no tiene placa cargada, sale su serial.' },
  { k: 'empresa',     label: '🏢 Empresa',          corto: 'Empresa' },
  { k: 'cdt',         label: '🏗️ CDT / obra',       corto: 'CDT' },
  { k: 'jornada',     label: '📆 Jornada',          corto: 'Jornada', ayuda: 'El día de trabajo, de 7am a 7am. Un viaje de las 2am cuenta para el día anterior.' },
  { k: 'turno',       label: '🌓 Turno',            corto: 'Turno',   ayuda: 'Día o noche. No es lo mismo que la jornada.' },
  { k: 'codigo',      label: '🚜 Equipo',           corto: 'Equipo' },
  { k: 'marcaModelo', label: '🏷️ Marca y modelo',   corto: 'Marca' },
  { k: 'serial',      label: '🔧 Serial',           corto: 'Serial' },
  { k: 'chofer',      label: '👤 Chofer',           corto: 'Chofer' },
  { k: 'listero',     label: '📝 Listero',          corto: 'Listero' },
  { k: 'm3',          label: '📐 Metros cúbicos',   corto: 'Volumen', ayuda: 'Sale de lo que se mida en Cubicaje. Hoy es un promedio del día, no una medición de ese viaje.' },
  // Los tres renglones del peso de romana (26-sep-2026), con los mismos nombres
  // del papel de muestra que mandó la encargada.
  // ⚠️ El `corto` de los pesos va COMPLETO a pedido del cliente (27-sep-2026):
  //    «peso entrada (bruto) / Peso salida (tara) / peso a pagar (neto)», como
  //    el papel de muestra. En el rollo la etiqueta se parte en 2–3 líneas y el
  //    cálculo del alto las cuenta (lineasDelValor sobre la etiqueta también).
  { k: 'pesoBruto',   label: '⚖️ Peso entrada (bruto)', corto: 'Peso entrada (bruto)', ayuda: 'El peso que tecleó el listero en la romana del CDT.' },
  { k: 'pesoTara',    label: '⚖️ Peso salida (tara)',   corto: 'Peso salida (tara)',   ayuda: 'La tara del camión, congelada al registrar ese viaje.' },
  { k: 'pesoNeto',    label: '⚖️ Peso a pagar (neto)',  corto: 'Peso a pagar (neto)',  ayuda: 'Bruto menos tara. Lo calcula la base de datos, nunca el teléfono. Los viajes anteriores al peso salen con raya.' },
  { k: 'estado',      label: '⚙️ Estado del camión', corto: 'Estado' },
  { k: 'nota',        label: '🗒️ Nota',             corto: 'Nota' },
];

export const LOGOS_TIQUE: { k: ClaveLogo; label: string }[] = [
  { k: 'sos',         label: 'SOS La Guaira' },
  { k: 'goldenTouch', label: 'Golden Touch' },
  { k: 'renace',      label: 'Plan Venezuela Renace' },
  { k: 'bcv',         label: 'BCV' },
];

export const PAPELES: { k: PapelTique; label: string; ayuda: string }[] = [
  { k: 'rollo80', label: 'Rollo 80 mm', ayuda: 'Ticketera de rollo ancha, la más común. Sin página: el ticket termina donde termina.' },
  { k: 'rollo58', label: 'Rollo 58 mm', ayuda: 'Ticketera de rollo angosta. Caben menos datos por renglón.' },
  { k: 'carta1',  label: '1 por hoja',  ayuda: 'Impresora normal, un ticket por página.' },
  { k: 'carta2',  label: '2 por hoja',  ayuda: 'Impresora normal, dos tickets por página.' },
  { k: 'carta4',  label: '4 por hoja',  ayuda: 'Impresora normal, cuatro por página.' },
  { k: 'carta6',  label: '6 por hoja',  ayuda: 'Impresora normal, seis por página. Salen chiquitos.' },
];

/** Los seis que el cliente pidió, encendidos. Todo lo demás apagado. */
export const CONFIG_POR_DEFECTO: TiqueConfig = {
  campos: {
    folio: true, fecha: true, hora: true, placa: true, empresa: true, cdt: true,
    jornada: false, turno: false, codigo: false, marcaModelo: false, serial: false,
    chofer: false, listero: false, m3: false,
    // Apagados de fábrica como TODO lo nuevo (regla de la casa). El pedido del
    // 26-sep es que salgan: se encienden los tres checks en la configuración.
    pesoBruto: false, pesoTara: false, pesoNeto: false,
    estado: false, nota: false,
  },
  logos: { sos: true, goldenTouch: true, renace: false, bcv: false },
  papel: 'carta1',
  // Ningún texto a mano de fábrica: todo automático, como siempre fue.
  textos: {},
  pesosUnidad: 'kg',
};

const esPapel = (v: unknown): v is PapelTique => PAPELES.some((p) => p.k === v);

/**
 * NORMALIZA LO QUE VENGA DE LA BASE.
 *
 * ⚠️ ESTO NO ES DEFENSA PARANOICA, ES EL CASO NORMAL. Cada vez que se agregue un
 *    campo nuevo al ticket, las filas ya guardadas NO van a tener esa clave, y
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
  // alguien lo apaga escribiendo en la tabla— el ticket saldría sin número.
  campos[CAMPO_FIJO] = true;

  // LOS TEXTOS A MANO viven ANIDADOS dentro del jsonb `campos` (clave `textos`),
  // no en una columna propia: así no hace falta tocar el esquema y una app vieja
  // simplemente no los ve (recorre solo las claves conocidas). Se acepta también
  // `bruto.textos` suelto por si algún día se muda a su columna. Solo entran
  // claves de campos reales, con texto de verdad, recortadas al tope — y NUNCA
  // el folio.
  const textos: Partial<Record<ClaveCampo, string>> = {};
  const dt = (dc && typeof dc === 'object' ? dc.textos : null) ?? bruto?.textos;
  if (dt && typeof dt === 'object') {
    (Object.keys(campos) as ClaveCampo[]).forEach((k) => {
      if (k === CAMPO_FIJO) return;
      const v = typeof dt[k] === 'string' ? dt[k].trim() : '';
      if (v) textos[k] = v.slice(0, TEXTO_FIJO_MAX);
    });
  }
  // La unidad de los pesos viaja en el mismo saco que los textos (dentro del
  // jsonb `campos`), por el mismo motivo: sin columna nueva y las apps viejas
  // la ignoran. Cualquier valor que no sea 'kg' o 't' cae al de fábrica.
  const du = (dc && typeof dc === 'object' ? dc.pesosUnidad : null) ?? bruto?.pesosUnidad;
  const pesosUnidad = du === 't' ? 't' as const : 'kg' as const;

  return { campos, logos, papel: esPapel(bruto?.papel) ? bruto.papel : CONFIG_POR_DEFECTO.papel, textos, pesosUnidad };
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
  // Cada texto puesto a mano es un cambio respecto a la fábrica (que no trae ninguno).
  n += Object.keys(c.textos ?? {}).length;
  if ((c.pesosUnidad ?? 'kg') !== 'kg') n++;
  return n;
}

/** Lo que se ve en el encabezado plegado: cuántos datos trae el papel. */
export function resumenConfig(c: TiqueConfig): string {
  const datos = (Object.keys(c.campos) as ClaveCampo[]).filter((k) => c.campos[k]).length;
  const logos = (Object.keys(c.logos) as ClaveLogo[]).filter((k) => c.logos[k]).length;
  const papel = PAPELES.find((p) => p.k === c.papel)?.label ?? c.papel;
  // Los textos a mano se anuncian en el encabezado: un ticket que no imprime el
  // dato del viaje es algo que hay que poder ver sin abrir la tarjeta.
  const aMano = Object.keys(c.textos ?? {}).filter((k) => c.campos[k as ClaveCampo]).length;
  const ton = (c.pesosUnidad ?? 'kg') === 't' ? ' · ⚖️ pesos en Ton' : '';
  return `${datos} dato(s) · ${logos} logo(s) · ${papel}${aMano > 0 ? ` · ✍️ ${aMano} a mano` : ''}${ton}`;
}
