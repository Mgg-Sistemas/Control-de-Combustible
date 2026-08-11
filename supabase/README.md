# Backend Supabase — Control de Combustible

## 1. Crear el proyecto
1. Entra a [supabase.com](https://supabase.com) y crea un proyecto nuevo.
2. Ve a **Project Settings → API** y copia:
   - **Project URL** → `EXPO_PUBLIC_SUPABASE_URL`
   - **anon public key** → `EXPO_PUBLIC_SUPABASE_ANON_KEY`
3. En la raíz del repo copia `.env.example` a `.env` y pega esos valores.

## 2. Crear el esquema
En **SQL Editor** de Supabase, pega y ejecuta EN ESTE ORDEN:
1. [`schema.sql`](./schema.sql) — tablas, enums, vista de niveles, triggers de stock y políticas RLS.
2. **Parches de seguridad OBLIGATORIOS** (schema.sql aún contiene políticas antiguas inseguras; estos las corrigen):
   - [`fix_rls_anon_nomina.sql`](./fix_rls_anon_nomina.sql) y [`fix_rls_anon_nomina_v2.sql`](./fix_rls_anon_nomina_v2.sql) — cierran sueldos/datos bancarios a sesiones anónimas.
   - [`fix_stock_race_condition.sql`](./fix_stock_race_condition.sql) — lock anti-sobregiro de combustible.
   - [`security_hardening_2026-08-11.sql`](./security_hardening_2026-08-11.sql) — endurecimiento tras la auditoría (guardia de profile, RLS de machine_rounds y tablas sensibles, can_write_module fail-closed, grants, locks TOCTOU). **Fuente de verdad de esos cambios.**
3. (Opcional) [`seed.sql`](./seed.sql) — datos de demostración.

> ⚠️ `schema.sql` **no** es hoy la única fuente de verdad de las políticas RLS: varios parches de seguridad ya aplicados en producción no se han fusionado de vuelta. Corre siempre los parches del paso 2 al reconstruir un entorno.

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
