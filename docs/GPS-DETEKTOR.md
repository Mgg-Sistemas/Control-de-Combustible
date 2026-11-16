# 📡 GPS de las máquinas con Detektor

Cómo está conectado y qué hace falta para encenderlo. **Aquí no va ningún usuario ni clave**: el
repositorio es público.

## Cómo funciona

- **Detektor** expone en Venezuela (`ve.detektorgps.com/gps_ve`):
  1. **Tres servicios REST** (según su manual «Web Services Datos Estadísticos»):
     `wsDetenciones`, `wsResumenActividadDiaria` y `wsEstadisticoREST`. Se llaman con POST de
     formulario (`application/x-www-form-urlencoded`) a
     `https://ve.detektorgps.com/gps_ve/framework/servicios/<servicio>/datos.php`.
     (Si se configura por error `gt.detektorgps.com` o `gps_gt`, el puente lo normaliza automáticamente
     a `ve.detektorgps.com` y `gps_ve`).
  2. **Servicio SOAP de Último Punto (`ultimo_punto` en `VehiculosCercanosWSDL`)**:
     `https://ve.detektorgps.com/gps_ve/ws/servicio_v3.php` (versión activa en PHP 8 en Venezuela) y
     `https://ve.detektorgps.com/gps_ve/ws/servicio_v2.php?wsdl`. Recibe `usuario`, `clave`, `campos` vacío
     y `placa`, devolviendo `<xml_dat>` con la última posición transmitida por el GPS.
     El manual FR-DCT-018 indica que `campos` solo solicita datos adicionales; fecha y coordenadas vienen por defecto.
     `ultimo_punto` se consulta por cada placa vinculada: el manual pide una placa concreta y no documenta `*`.
- **El usuario y la clave de Detektor** viven solo en el puente de Supabase (la Edge Function
  `supabase/functions/gps-detektor`), como secretos. La app nunca los ve.
- **El puente:**
  - revisa la sesión y el permiso «GPS» de quien pide (`gps_puede_ver` / `gps_puede_editar`);
  - solo consulta las placas vinculadas en `gps_vehiculos`;
  - limita las fechas (31 días para el resumen y 7 para las detenciones);
  - guarda las respuestas de reportes REST durante 1 minuto; cada toque de ubicación consulta de nuevo el último punto.
- **No se guardan posiciones.** Todo se consulta solo cuando alguien toca 📡 o «Consultar».
- **Permiso del proveedor:** si `ultimo_punto` responde `ERROR Sin Permisos`, la cuenta de Detektor
  necesita acceso al Web Service de coordenadas. La actividad diaria puede funcionar aunque ese
  permiso falte. El error HTTP 500 de `wsDetenciones` también debe revisarlo Detektor.
- **Ubicación:** cada toque de 📡 consulta el último punto disponible en Detektor, también si la
  máquina está en movimiento. El punto muestra la hora de la última señal; si el servicio de último
  punto no entrega coordenadas, se consultan las detenciones como respaldo. No es transmisión continua.
  `fecha_gps` puede incluir el sufijo horario `-04`; el puente entrega la fecha en hora de Caracas
  para que la web existente dibuje el punto. La respuesta de ubicación incluye también el resumen diario.

## Para encenderlo

1. **SQL**: crea la tabla `gps_vehiculos`, las funciones `gps_puede_ver` y `gps_puede_editar`, y
   deja cerrado el permiso `gps`. Se corre a mano en el SQL Editor y no está en el repo.
2. **Secretos del puente**, en Supabase → Edge Functions → Secrets (o con la consola):
   ```bash
   supabase secrets set DETEKTOR_USUARIO=<usuario> DETEKTOR_CLAVE=<clave>
   # opcional, si Detektor cambia la dirección:
   supabase secrets set DETEKTOR_URL=https://ve.detektorgps.com/gps_ve/framework/servicios
   ```
3. **Desplegar el puente** (el CI no despliega las Edge Functions):
   ```bash
   supabase functions deploy gps-detektor
   ```
   O, desde el panel de Supabase: Edge Functions → Deploy a new function → nombre `gps-detektor`,
   pegando `supabase/functions/gps-detektor/index.ts`.
4. **Permiso**: dar «GPS de los vehículos (Detektor)» en 👥 Usuarios. Lectura sirve para ver la
   ubicación y la actividad; escritura, para vincular placas.
5. En la app, ir a **Más → GPS de los vehículos → 🔍 Buscar vehículos en Detektor** y vincular
   cada placa con su máquina del Catálogo.

## Qué se ve

- **🗺️ Mapa → panel «📡 GPS de las máquinas»**: actualizar una, las marcadas o todas, con una
  sola consulta. Los puntos salen en el mismo mapa de la maquinaria.
- **Más → GPS de los vehículos**:
  - vincular placas con máquinas;
  - **📊 Actividad diaria**: primer encendido, último apagado, horas efectivas, horas detenida
    con el motor encendido y km por día, con PDF.
