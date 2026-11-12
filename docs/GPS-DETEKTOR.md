# 📡 GPS de las máquinas con Detektor

Cómo está conectado y qué hace falta para encenderlo. **Aquí no va ningún usuario ni clave**: el
repositorio es público.

## Cómo funciona

- **Detektor** expone tres servicios web (según su manual «Web Services Datos Estadísticos»):
  `wsDetenciones`, `wsResumenActividadDiaria` y `wsEstadisticoREST`. Se llaman con POST de
  formulario (`application/x-www-form-urlencoded`) a
  `https://ve.detektorgps.com/gps_ve/framework/servicios/<servicio>/datos.php`.
  Esa dirección se comprobó el 12-nov-2026. La de `gt.detektorgps.com/gps_ve` da 404, y mandar
  los datos como multipart da 403.
- **El usuario y la clave de Detektor** viven solo en el puente de Supabase (la Edge Function
  `supabase/functions/gps-detektor`), como secretos. La app nunca los ve.
- **El puente:**
  - revisa la sesión y el permiso «GPS» de quien pide (`gps_puede_ver` / `gps_puede_editar`);
  - solo consulta las placas vinculadas en `gps_vehiculos`;
  - limita las fechas (31 días para el resumen y 7 para las detenciones);
  - guarda cada respuesta 1 minuto.
- **No se guardan posiciones.** Todo se consulta solo cuando alguien toca 📡 o «Consultar».
- **Ubicación:** Detektor no da la posición en vivo; da detenciones. El punto 📡 del Mapa es la
  **última detención**: «detenida aquí desde…» o «en movimiento: su última parada fue…».

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
