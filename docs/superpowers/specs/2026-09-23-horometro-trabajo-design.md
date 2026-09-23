# Horómetro de trabajo: diseño (v1, 23/09/2026)

> Estado: **diseño, sin código ni SQL.** Revisado por cuatro agentes (dos de código,
> dos adversariales) y corregido con sus hallazgos. Pendiente de nueve decisiones del
> cliente antes de construir. Nada de lo descrito aquí está en producción.

## 1. Qué se pide

Pagar las máquinas por **horómetro de trabajo** (lectura final menos lectura inicial de
la jornada) en vez de por horas de reloj, con estas condiciones del cliente:

- La jornada por reloj **sigue existiendo y guardándose** igual que hoy, para corregir en
  emergencias y para volver a esa modalidad si lo piden.
- **No se pierde ninguna información.** Nada retroactivo: lo pagado hasta hoy queda como
  está. La fecha de corte es el día en que se encienda, no el 14/09.
- El horómetro de trabajo se marca y corrige **desde Control de Maquinaria**.
- El horómetro de **mantenimiento** (alertas 200/220/250 h, `Confirmar mantenimiento`)
  se queda donde está y como está.
- Todo va **directo a producción sin pausar la operación**: lo existente no se edita, lo
  nuevo se construye al lado, nace apagado y se enciende por máquina.
- Máquinas **sin horómetro físico** (pick-ups, cisternas, lowboys…) siguen por jornada
  para siempre. Máquinas con horómetro **averiado** o **sin lectura** caen a jornada y el
  papel dice por qué.

## 2. Lo que dice la base (22/09/2026)

| Desde el 14 al 22 de septiembre | Cantidad |
|---|---|
| Jornadas con horas pagadas | 1.079 |
| Jornadas con horómetro inicial y final | 103 (33 máquinas de 212) |
| Lecturas que cuadran con el reloj a media hora | 22 de 103 |
| Lecturas con saltos absurdos (más de 14 h) | 8 |
| Máquinas activas que nunca han anotado horómetro | 93 de 182 (32 son vehículos de apoyo) |

Conclusión: pagar por horómetro retroactivamente es inventar datos. Primero hay que
capturar bien, después convivir, después encender.

## 3. Principios de construcción

1. **Solo se agrega.** Tabla nueva, función RPC nueva, librería nueva, columna nueva en
   Control, reporte nuevo. Ninguna columna, tabla, función ni cron existente se edita.
   *(Hallazgo adversarial: la RPC `upsert_machine_round` tiene lista cerrada de columnas y
   tres copias en SQL; meter el horómetro en `machine_rounds` obligaría a reescribirla.
   Por eso el horómetro de trabajo va en tabla propia.)*
2. **Todo nuevo nace apagado.** El modo por máquina, con fecha «desde», decide si paga.
   Con el modo apagado el sistema es idéntico a hoy, y una prueba lo demuestra contra la
   **salida de las pantallas**, no contra una función.
3. **Al inspector nunca se le bloquea.** Una lectura rara se acepta, se marca inválida y
   paga por jornada. Los bloqueos duros van solo en Control. Ninguna validación vive en
   la RPC de cierre de jornada (una parada encolada sin señal no puede quedar abierta).
4. **Lo manual manda, con mecanismo.** Una corrección desde Control lleva `corregido_por`
   y un disparador conserva ese valor salvo que el cambio traiga la marca de Control.
5. **Reversión de un solo gesto, y el primero es apagar.** Apagar el modo de una máquina
   es la reversión de emergencia. Restaurar copia es de segundo nivel. Volver el código
   atrás es de tercer nivel y tarda lo que tarde el robot (medido: de 2 a 30 minutos).

## 4. Arquitectura

### 4.1 Tabla nueva: `lecturas_horometro_trabajo`

Una fila por **máquina, día de jornada y turno** (día / noche). Nunca se borra; se corrige.

| Columna | Para qué |
|---|---|
| machinery_id, round_date, shift | La jornada y el turno a los que pertenece. Única. |
| inicial, final | Las dos lecturas. Pueden faltar. |
| foto_inicial_url, foto_final_url | Fotos. Obligatorias según decisión del cliente. |
| origen | inspector · qr · control · reinicio |
| valida, motivo_invalida | Calculadas por la base, no por el cliente. |
| horas | Generada: final − inicial cuando ambas existen y es válida. |
| corregido_por, corregido_at, motivo_correccion | Bitácora de Control. |
| reinicio | true cuando esta lectura sienta base nueva (aparato cambiado). |
| created_by, created_at | Sistema. |

Validaciones (marcan, no rechazan): final no menor que inicial; inicial no menor que la
**última lectura válida de esta tabla** para esa máquina (no `machinery.last_horometro`,
que hoy se escribe sin validar); diferencia con tope contra la **ventana del turno**
(07:00–19:00 o 19:00–07:00) más media hora, no contra la hora en que se capturó.

### 4.2 RPC nueva: `guardar_lectura_horometro`

Patch parcial como la de jornadas. Es la **única puerta** de escritura a la tabla, con
`SECURITY INVOKER` y política que usa `module_level('horometros')` (la función espejo de
la app, que ya conoce el módulo y lo cierra por defecto). *(Hallazgo: `can_write_module`
no conoce `horometros`, así que una política basada en ella dejaría el módulo abierto en
la base; por eso las políticas nuevas usan `module_level`.)*

### 4.3 Modo por máquina: `machinery_modo_pago`

Tabla que ya existe (jornada | viaje, con `desde`). Se le agrega el valor `horometro`.
**Solo filas nuevas, nunca editar una fila vieja.** Volver a jornada es una fila nueva con
otra fecha. La fecha «desde» siempre un lunes.

### 4.4 Una función de horas pagables: `horasPagables(ronda, lecturas, modo)`

Librería nueva `src/lib/horometroTrabajo.ts`, sin importar nada (probable sola).

- Modo jornada o sin lectura válida → devuelve exactamente `workedFromShifts`.
- Modo horómetro con lectura válida → devuelve `final − inicial` del turno. **No suma
  extras ni resta paradas**: el horómetro ya las incluye y excluye. *(Hallazgo: si no,
  paga doble las extras.)*
- Devuelve también `origen`: `jornada` · `horometro` · `sin_lectura` · `averiado` ·
  `sin_horometro_fisico`, para que el papel lo diga.

**Puntos de contacto que deben pasar por ella** (hoy llaman `workedFromShifts` o
recalculan a mano): Control de Maquinaria (tarjeta, modal de precio, cerrar control,
`syncClosedRound`, PDF del cierre, detalle del cierre, resumen), Informe por jornada,
Control de Pagos (`billableHours`, cotejo, por tipo), `jornadaPorMaquina.ts`,
`porEmpresaReport.ts`. *(Hallazgo: son más de tres pantallas; la equivalencia se prueba
sobre cada una.)*

### 4.5 Cierres

El snapshot de `control_closures` guarda además `modo`, `horas_horometro` y `origen` por
máquina y día. `syncClosedRound` usa `horasPagables`. Reabrir un cierre no toca el modo,
porque el modo vive en su tabla, no en el cierre.

### 4.6 Control de Maquinaria

Columna **⚙️ Horómetro** junto a Día y Noche, por turno. Tocarla abre inicial/final,
motivo obligatorio, foto según decisión. Botones: «Horómetro averiado» (rango con
motivo) y «Reinicio del aparato» (lectura base nueva con foto). Todo en componente nuevo
montado en la pantalla existente; la cuadrícula actual no cambia.

### 4.7 Teléfono del inspector y QR del operador

- Inspector: al abrir y cerrar pide la lectura del turno y la manda a la RPC nueva. Las
  horas de reloj se siguen guardando exactamente igual.
- **QR del operador (única excepción a «no editar»)**: hoy escribe `day_hours` = final −
  inicial, sin tope y con fecha de calendario. Propuesta: `day/night_hours` = mínimo de
  12 y horas de reloj (como Patio), y la lectura a la tabla nueva. Nunca dejar la jornada
  en cero. **Decisión del cliente.**
- Cola sin señal: hoy la parada encolada no lleva horómetro. O se agrega al paquete, o
  se acepta que las paradas sin señal paguen por jornada, y se dice. **Decisión.**

### 4.8 Catálogo

Check **«Sin horómetro»** en la ficha: modo jornada fijo, campos ocultos en el teléfono,
sin reclamo ni alerta. La lista inicial la da Control (32 vehículos de apoyo seguro; de
las 61 pesadas que nunca anotaron, Control decide cuáles).

### 4.9 Mantenimiento: sin cambios, con un filtro

Solo una lectura **válida** de trabajo actualiza `machinery.last_horometro`. Una inválida
no. `Confirmar mantenimiento` y `horometro_base` no se tocan. «Reinicio del aparato»
(pago) es distinto de «confirmar mantenimiento» (alertas) y no reutiliza `horometro_base`.

## 5. Escenarios

| Situación | Es | Cómo se marca | Qué paga | Dura |
|---|---|---|---|---|
| Horómetro con lectura válida | Normal | Sola | final − inicial | — |
| Modo horómetro sin lectura | Falta de dato | Sola | Jornada, «sin lectura» (ver decisión 3) | Hasta anotar |
| Lectura inválida | Error de captura | La base | Jornada, «inválida» | Hasta corregir |
| Sin horómetro físico | Permanente | Check en ficha | Jornada, sin reclamo | Hasta instalar |
| Averiado | Temporal | Control, rango + motivo | Jornada, «averiado» | Hasta reparación |
| Reinicio del aparato | Evento | Control, con foto | Base nueva | — |
| Dos turnos el mismo día | Normal | Una lectura por turno | Cada turno con su par | — |
| Noche que cruza medianoche | Normal | Fecha de negocio (7 am) | Tope contra ventana 19–07 | — |
| Volver a jornada | Decisión | Fila nueva de modo, lunes | Jornada desde esa fecha | — |
| Corrección de semana cerrada | Emergencia | Control, motivo | Cierre recalculado con precio congelado | — |
| Inspector reescribe lo corregido | Conflicto | Disparador conserva lo manual | Lo de Control | — |
| Robots de 12 h | Existente | No escriben lecturas | Caen en «sin lectura» | — |
| Parada sin señal | Existente | Cola | Jornada (ver decisión 8) | — |
| Camión por viaje | Existente | Modo viaje | Viaje; horómetro solo mantenimiento | — |
| En espera / retirada | Existente | Como hoy | Nada | — |

## 6. Fases

1. **Decisiones** (sección 8). Sin código.
2. **Preparación**: respaldo con ensayo de restauración; hoja de emergencia; `horometros`
   en `can_write_module`; medir el tiempo real de una publicación.
3. **Modo sombra**: tabla, RPC, librería con pruebas, captura en teléfono, columna en
   Control (solo lectura), reporte comparativo. **Paga jornada en todas las máquinas.**
4. **Convivencia**: mínimo una semana con un cierre de control real en medio. Cada lunes:
   máquinas sin lectura, inválidas, diferencias mayores a 3 h, pago sombra contra pago
   real.
5. **Encendido por máquina**: piloto con las que ya anotan, un lunes, y expansión según
   criterio de salida: cinco días seguidos con lectura válida, ninguna diferencia mayor a
   3 h sin explicación, inválidas revisadas por Control.
6. **Corrección de emergencia, averiado y reinicio** en Control.

Un cambio por vez, un cierre de corte real entre cambios que toquen dinero, revisión al
día siguiente contra la base (jornadas, segmentos de trabajo, cierres y precio congelado).

## 7. Seguridad y reversión

- **Respaldo** de jornadas, segmentos de trabajo, operadores del día y cierres, en un
  esquema aparte no expuesto a la llave pública, verificado como anónimo en la misma
  sesión. Restauración por actualización desde la copia limitada a las fechas tocadas,
  con disparadores de fila y crons pausados dentro de la misma transacción.
- **Reversión de emergencia** = apagar el modo de la máquina (fila nueva). Nada más.
- **Reversión de código** = commit de reversión desde rama propia, cherry-pick a main,
  esperar al robot. Nunca revertir «al commit anterior» a ciegas (arrastra trabajo ajeno).
- **Nunca se borra** columna, tabla, código ni lectura. Las lecturas guardadas durante
  una reversión quedan íntegras y reaparecen al reactivar.
- **Hoja de emergencia**: en el repositorio solo síntomas y a qué pantalla o persona
  acudir; los pasos con SQL y nombres de copias, fuera del repositorio.

## 8. Decisiones pendientes del cliente

1. Por máquina o toda la flota. *(Recomendado: por máquina.)*
2. Foto obligatoria en cada lectura, o solo en cierre, saltos, correcciones y reinicios.
3. **Sin lectura en modo horómetro**: pagar horas de reloj reales, o pagar 0 con alerta.
   *(Hallazgo: pagar «jornada» reproduce las 12 h automáticas del cron.)*
4. Quién corrige en Control, y si la corrección exige foto.
5. Quién marca un reinicio del aparato.
6. Qué hacer con el QR del operador (sección 4.7).
7. Extras y paradas cargadas en Control sobre una jornada por horómetro: se ignoran
   (recomendado) o se suman.
8. Paradas sin señal: agregar la lectura al paquete o aceptar que paguen por jornada.
9. Lista de máquinas «sin horómetro físico».

## 9. Fuera de alcance (documentado, no se toca)

- Control de Pagos no cobra un día con solo extras y aplica un precio congelado a toda la
  semana; el Informe hace ambas cosas distinto. Se deja como está salvo pedido.
- Pago de personal: los operadores cobran por sus asignaciones; el QR ya usa horómetro
  ahí. Alinear o no es otra decisión, otro proyecto.
- Los crons de 12 h automáticas siguen igual.
