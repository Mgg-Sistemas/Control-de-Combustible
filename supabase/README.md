# Backend Supabase — Control de Combustible

## 1. Crear el proyecto
1. Entra a [supabase.com](https://supabase.com) y crea un proyecto nuevo.
2. Ve a **Project Settings → API** y copia:
   - **Project URL** → `EXPO_PUBLIC_SUPABASE_URL`
   - **anon public key** → `EXPO_PUBLIC_SUPABASE_ANON_KEY`
3. En la raíz del repo copia `.env.example` a `.env` y pega esos valores.

## 2. Crear el esquema
En **SQL Editor** de Supabase, pega y ejecuta el contenido de:
1. [`schema.sql`](./schema.sql) — tablas, enums, vista de niveles, triggers de stock y políticas RLS.
2. (Opcional) [`seed.sql`](./seed.sql) — datos de demostración.

## 3. Autenticación
- **Auth → Providers → Email**: habilitado por defecto.
- Para pruebas rápidas, **Auth → Providers → Email → "Confirm email"** puede desactivarse para no requerir confirmación.
- Al registrarse, un trigger crea automáticamente el perfil en `public.profiles` con rol `conductor`.
- Para asignar el primer **admin**, ejecuta en SQL Editor:
  ```sql
  update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'tu@correo.com');
  ```

## Modelo de datos (resumen)
| Tabla | Rol |
|---|---|
| `profiles` | Usuarios y roles (admin/supervisor/operador/conductor) |
| `tanks` | Tanques (capacidad, tipo de combustible) |
| `vehicles` / `machinery` | Activos con placa/código y rendimiento |
| `fuel_intakes` | Ingresos de combustible (suman stock) |
| `dispatches` | Consumos/despachos (restan stock) |
| `transfers` | Traslados entre tanques |
| `authorizations` | Autorizaciones de despacho |
| `stock_movements` | Ledger fuente de verdad del stock (lo llenan los triggers) |
| `tank_levels` (vista) | Nivel actual y % de cada tanque |

El nivel de cada tanque **se calcula** a partir de `stock_movements`; nunca se edita a mano.
Consulta [`../docs/PLAN.md`](../docs/PLAN.md) para el diseño completo.
