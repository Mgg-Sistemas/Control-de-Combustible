// CAMIONES SIN MEDIDA DE TOLVA, A PROPÓSITO (09-sep-2026).
//
// Pedido del cliente: «no me deja colocarle la medición en 0, y al querer
// eliminar o apartar uno sigue saliendo en la lista de conteo de máquinas; la
// idea es que no salga para esa parte si lo aparto».
//
// ⚠️ POR QUÉ NO ES UNA FILA EN CERO.
//
//    `camion_cubicaje` exige alto, largo y ancho MAYORES QUE CERO, y hace bien:
//    una tolva de cero por cero no existe, y dos negativos multiplicados dan un
//    positivo muy creíble. Pero «este camión no tiene medida» es un hecho REAL
//    que alguien necesita poder afirmar, y hoy era indistinguible de «todavía
//    nadie la midió»: la hoja de cubicaje volvía a deducirla una y otra vez.
//
//    Así que se anota aparte: la lista de camiones a los que NO se les aplica
//    ninguna medida, ni la guardada ni la de la hoja.
//
// ⚠️ VIVE EN EL DISPOSITIVO, y eso hay que decirlo donde se usa. La tabla no
//    admite una fila «sin medida», así que no hay dónde más anotarlo sin un SQL
//    nuevo. Lo que sí se logra es que las DOS pantallas que muestran medidas
//    —Cubicaje y el conteo de Reportes— lean la MISMA lista: si se apartara en
//    una y no en la otra, los dos papeles dirían cosas distintas del mismo
//    camión, que es justo lo que se viene evitando en todo este módulo.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CLAVE_APARTADAS = 'cubicaje.apartadas.v1';

/** Los ids de camión apartados. Nunca lanza: sin lista, lista vacía. */
export async function leerApartadas(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(CLAVE_APARTADAS);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Guarda la lista. Nunca lanza: apartar no puede tumbar la pantalla. */
export async function guardarApartadas(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CLAVE_APARTADAS, JSON.stringify(ids));
  } catch {}
}
