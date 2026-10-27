// 📍 RUTA DEL FLETE DESDE «TRASLADOS Y SALIDAS» (27/10/2026).
//
// El pedido: «dame la opción de modificar el origen o destino en esos fletes» y «una
// opción con la que yo también pueda traerme esa información de Traslados y salidas».
// Los fletes importados de viajes de camión salían en el comprobante con «Punto de
// origen no especificado»; el traslado del mismo chuto ese día SÍ tiene su ruta.
//
// Reglas (librería pura, sin base de datos):
//   · Solo LEE los traslados: nada se escribe en Traslados y salidas.
//   · El traslado no guarda el chuto como máquina, solo su placa en texto; el flete es de
//     una máquina del catálogo con placa compuesta («CHUTO/LOWBOY»). Se cruzan por los
//     PEDAZOS de esa placa (separada por «/», «,» o «;»), en mayúsculas y solo letras y
//     números, contra la placa del chuto o del lowboy del traslado.
//   · La fecha del traslado es texto «dd / mm / aaaa»; si no se puede leer, cuenta el día
//     (hora de Caracas) en que se registró.
//   · El traslado no guarda hora ni tique: con varios el mismo día NO se sabe cuál viaje fue
//     cuál. Por eso se PROPONEN (mismo chuto y fecha primero) y la persona elige; o usa todas
//     las del día, que quedan como «A / B» en origen y destino, en el orden en que se registraron.
//   · Lo que se trae va a los campos del formulario: se revisa y se puede cambiar antes de guardar.

/** Un traslado reducido a lo que necesita la ruta del flete (sin montos ni firmas). */
export type TrasladoRuta = {
  id: string;
  numero: string;
  /** La fecha tal como la escribieron («19 / 10 / 2026»). */
  fechaTxt: string;
  /** AAAA-MM-DD: la fecha escrita o, si no se puede leer, el día en que se registró. */
  fechaIso: string | null;
  origen: string;
  destino: string;
  /** Placa del chuto como la escribieron (para mostrarla). */
  chutoTxt: string;
  /** Placas normalizadas del chuto y del lowboy (para cruzar). */
  chuto: string;
  lowboy: string;
  equipo: string;
  creadoMs: number;
};

/** Mayúsculas y solo letras y números: «ab12-cd 3e» → «AB12CD3E». */
export function normalizarPlaca(s?: string | null): string {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Los pedazos de una placa compuesta («A/B», «A, B»), normalizados; los de menos de 3 signos no cuentan. */
export function pedazosPlaca(plate?: string | null): string[] {
  return String(plate ?? '')
    .split(/[\/,;]/)
    .map(normalizarPlaca)
    .filter((p) => p.length >= 3);
}

/** «19 / 10 / 2026», «19/10/2026», «1-9-2026» → AAAA-MM-DD; null si no es una fecha válida. */
export function fechaTrasladoIso(txt?: string | null): string | null {
  const m = String(txt ?? '').match(/^\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4})\s*$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mes = Number(m[2]);
  const a = Number(m[3]);
  const f = new Date(Date.UTC(a, mes - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** El día (AAAA-MM-DD) de un instante en hora de Caracas (UTC−4, sin horario de verano). */
export function diaCaracas(iso?: string | null): string | null {
  const ms = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Lo que Traslados guarda cuando el campo se dejó en blanco (`TrasladoMaquinariaScreen`:
 * «Patio», «Destino de entrega», «—») no es una ruta: se trata como vacío.
 */
export function limpiarLugar(s?: string | null): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  const k = t.toUpperCase();
  if (!t || /^[-–—.\s]+$/.test(t) || k === 'PATIO' || k === 'DESTINO DE ENTREGA') return '';
  return t;
}

/** Una fila leída de `traslados_maquinaria` (columnas mínimas) → TrasladoRuta; null si no sirve. */
export function filaATrasladoRuta(row: any): TrasladoRuta | null {
  if (!row || row.id == null || row.is_deleted === true || row.deleted_at) return null;
  const fechaTxt = String(row.fecha ?? '').trim();
  const chutoTxt = String(row.placa_chuto ?? '').trim();
  const equipo = [row.machine_code, row.equipo_codigo, row.equipo_tipo]
    .map((x) => String(x ?? '').trim())
    .find((x) => x && !/^[-–—]+$/.test(x)) ?? '';
  const creadoMs = Date.parse(String(row.created_at ?? ''));
  return {
    id: String(row.id),
    numero: String(row.numero_control ?? '').trim(),
    fechaTxt,
    fechaIso: fechaTrasladoIso(fechaTxt) ?? diaCaracas(row.created_at),
    origen: limpiarLugar(row.origen),
    destino: limpiarLugar(row.destino),
    chutoTxt: /^[-–—\s]*$/.test(chutoTxt) ? '' : chutoTxt,
    chuto: normalizarPlaca(chutoTxt),
    lowboy: normalizarPlaca(row.placa_lowboy),
    equipo,
    creadoMs: Number.isFinite(creadoMs) ? creadoMs : 0,
  };
}

const porRegistro = (a: TrasladoRuta, b: TrasladoRuta) => a.creadoMs - b.creadoMs;

/**
 * Los traslados que se le proponen a un flete:
 *   · `sugeridos`: mismo chuto (o lowboy) y misma fecha — lo más probable.
 *   · `mismaFecha`: otros traslados de ese día (otro chuto o placa mal escrita).
 * Cada lista en el orden en que se registraron.
 */
export function clasificarTraslados(
  lista: TrasladoRuta[],
  flete: { plate?: string | null; fecha?: string | null },
): { sugeridos: TrasladoRuta[]; mismaFecha: TrasladoRuta[] } {
  const pedazos = pedazosPlaca(flete.plate);
  const delChuto = (t: TrasladoRuta) =>
    pedazos.length > 0 && ((!!t.chuto && pedazos.includes(t.chuto)) || (!!t.lowboy && pedazos.includes(t.lowboy)));
  const delDia = lista.filter((t) => !!flete.fecha && t.fechaIso === flete.fecha);
  return {
    sugeridos: delDia.filter(delChuto).sort(porRegistro),
    mismaFecha: delDia.filter((t) => !delChuto(t)).sort(porRegistro),
  };
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Búsqueda libre por número, fecha, origen, destino, equipo o placa (los más nuevos primero). */
export function buscarTraslados(lista: TrasladoRuta[], q: string, max = 50): TrasladoRuta[] {
  const k = sinAcentos(String(q ?? '').trim());
  if (!k) return [];
  const kPlaca = normalizarPlaca(q);
  return lista
    .filter((t) => {
      const texto = sinAcentos([t.numero, t.fechaTxt, t.origen, t.destino, t.equipo, t.chutoTxt].join(' '));
      return texto.includes(k) || (kPlaca.length >= 3 && (t.chuto.includes(kPlaca) || t.lowboy.includes(kPlaca)));
    })
    .sort((a, b) => b.creadoMs - a.creadoMs)
    .slice(0, max);
}

/** Las rutas DISTINTAS (origen → destino) de unos traslados, en el orden en que se registraron; sin las vacías. */
export function paresDeRuta(lista: TrasladoRuta[]): { o: string; d: string }[] {
  const pares: { o: string; d: string }[] = [];
  const vistos = new Set<string>();
  for (const t of [...lista].sort(porRegistro)) {
    if (!t.origen && !t.destino) continue;
    const k = `${t.origen.toUpperCase()}→${t.destino.toUpperCase()}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    pares.push({ o: t.origen, d: t.destino });
  }
  return pares;
}

/** Lo más largo que cabe en el origen o el destino de un flete (lo mismo que guarda la nota). */
export const MAX_LUGAR_FLETE = 240;

/**
 * La ruta que queda en el flete a partir de uno o varios traslados: con uno, su origen y su
 * destino; con varios, «A / B» en cada campo, en el orden en que se registraron (sin repetir
 * la misma ruta). null si ninguno trae ruta.
 */
export function rutaDeTraslados(lista: TrasladoRuta[]): { origen: string; destino: string } | null {
  const pares = paresDeRuta(lista);
  if (pares.length === 0) return null;
  if (pares.length === 1) return { origen: pares[0].o, destino: pares[0].d };
  return {
    origen: pares.map((p) => p.o || 'sin dato').join(' / '),
    destino: pares.map((p) => p.d || 'sin dato').join(' / '),
  };
}
