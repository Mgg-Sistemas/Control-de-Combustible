import { cmpText, norm } from './text';

/**
 * UBICACIONES (obra / destino) del módulo de Viajes de camiones.
 *
 * Una ubicación es la obra donde está trabajando un listero: CDT Parque del
 * Agua, SanteDubi, CDF, CDT Playa Escondida. Se pueden crear, renombrar,
 * desactivar y borrar, y un listero se puede mover de una a otra.
 *
 * ── Por qué el VIAJE guarda su propia ubicación ────────────────────────────
 * Si la obra viviera solo en el listero, moverlo de obra REESCRIBIRÍA EL
 * PASADO: sus viajes de agosto en Parque del Agua pasarían a contarse en Playa
 * Escondida, y un reporte ya entregado dejaría de cuadrar con el que se saque
 * mañana del mismo rango. Por eso cada viaje se lleva la obra puesta en el
 * momento de registrarse —una foto, igual que `listero_name`— y el reporte lee
 * esa foto, nunca la ficha de hoy.
 *
 * ── Y por qué los viajes viejos NO se adivinan ─────────────────────────────
 * Los viajes registrados antes de que existieran las ubicaciones no traen
 * ninguna, y no hay forma honesta de deducirla: la obra donde está el listero
 * HOY no dice dónde estaba en agosto. Esos viajes caen en SIN UBICACIÓN, que es
 * lo único cierto que se puede decir de ellos. Rellenarlos con la obra actual
 * daría un reporte completo y equivocado, que es peor que uno incompleto y
 * honesto: el incompleto se nota, el equivocado no.
 *
 * Sin React ni Supabase, para poder probarla de verdad
 * (scripts/test-ubicaciones-obra.mjs).
 */

/** Una obra del catálogo. */
export type UbicacionObra = {
  id: string;
  nombre: string;
  active: boolean;
  nota?: string | null;
};

/** Cubeta de los viajes que no tienen obra: los de antes de que esto existiera. */
export const SIN_UBICACION = '__sin_ubicacion__';

/** Cómo se rotula esa cubeta en pantalla y en el papel. */
export const SIN_UBICACION_LABEL = 'Sin ubicación';

/** Largo máximo del nombre. Más que esto no cabe en una columna del PDF. */
export const MAX_NOMBRE = 60;

/**
 * El nombre tal como se guarda: sin espacios sobrantes ni dobles.
 *
 * No se fuerza a MAYÚSCULAS a propósito: "CDT Parque del Agua" se lee mejor que
 * "CDT PARQUE DEL AGUA", y quien escribe el nombre sabe cómo quiere que salga
 * en el reporte que va a entregar.
 */
export function nombreLimpio(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * La clave con la que se decide si dos obras son la misma.
 *
 * Compara sin tildes, sin mayúsculas y sin espacios de más, porque "CDF", "cdf"
 * y "CDF " son la misma obra escrita por tres personas distintas. Si se colaran
 * como tres filas, el reporte por ubicación saldría partido en tres y ningún
 * total cuadraría con otro.
 */
export function claveUbicacion(nombre: unknown): string {
  return norm(nombreLimpio(nombre));
}

/**
 * Valida un nombre antes de guardarlo. Devuelve el motivo del rechazo, o null
 * si está bien.
 *
 * `exceptoId` es la obra que se está editando: al renombrar "CDF" a "CDF" no se
 * puede decir que ya existe, porque la que existe es ella misma.
 */
export function validarNombre(
  nombre: unknown,
  existentes: UbicacionObra[],
  exceptoId?: string | null,
): string | null {
  const limpio = nombreLimpio(nombre);
  if (!limpio) return 'Escribe el nombre de la obra.';
  if (limpio.length > MAX_NOMBRE) return `El nombre no puede pasar de ${MAX_NOMBRE} letras.`;
  const clave = claveUbicacion(limpio);
  const choca = existentes.find((u) => u.id !== exceptoId && claveUbicacion(u.nombre) === clave);
  if (choca) return `Ya existe una obra que se llama "${choca.nombre}".`;
  return null;
}

/**
 * Las obras en orden alfabético, con las DESACTIVADAS al final.
 *
 * Una obra cerrada sigue existiendo porque tiene viajes colgando, pero no tiene
 * por qué estorbar arriba del desplegable cuando se busca la de hoy.
 */
export function ordenarUbicaciones(lista: UbicacionObra[]): UbicacionObra[] {
  return lista.slice().sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return cmpText(a.nombre, b.nombre);
  });
}

/**
 * La obra que le toca a un viaje al REGISTRARLO: la del listero que lo anota.
 *
 * Devuelve las dos cosas que se graban en la fila —el id y el nombre— porque el
 * nombre es la FOTO: si mañana se borra la obra del catálogo, el id se queda en
 * null pero el nombre sigue diciendo dónde fue ese viaje.
 */
export function obraParaGrabar(
  ubicacionId: string | null | undefined,
  catalogo: UbicacionObra[],
): { ubicacionId: string | null; ubicacionNombre: string | null } {
  const id = String(ubicacionId ?? '').trim();
  if (!id) return { ubicacionId: null, ubicacionNombre: null };
  const u = catalogo.find((x) => x.id === id);
  return { ubicacionId: id, ubicacionNombre: u ? u.nombre : null };
}

/*
 * ⚠️ LA CLAVE CON LA QUE SE AGRUPA UN VIAJE POR OBRA **NO** VIVE AQUÍ.
 *    Vive en `claveUbicacionViaje` de src/lib/viajesResumen.ts, que es donde se
 *    agrupa el reporte. Tenerla en dos sitios es la forma segura de que el
 *    filtro y el resumen acaben contando distinto el día que una de las dos
 *    copias se toque y la otra no.
 */
