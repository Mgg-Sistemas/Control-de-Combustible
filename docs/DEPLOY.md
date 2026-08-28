# Despliegue de la web

> **Revisado el 28/08/2026 contra lo que hay en el repositorio.**
>
> ⚠️ **Este documento describía un despliegue en Vercel con un CNAME de GoDaddy. Eso ya no es
> así, y seguirlo era peligroso:** habría levantado un sitio paralelo y tocado el DNS de
> producción. Se reescribió con la cadena real. Lo de Vercel/Netlify se conserva al final, pero
> marcado como histórico.

---

## Lo que pasa hoy, en una frase

**Subes código a `main` → GitHub Actions compila la web en la nube y commitea `dist/` de vuelta
al repo → DigitalOcean sirve esa carpeta.** El sitio es **https://soslaguaira.com**.

**Nadie tiene que compilar en su PC.** Es todo automático.

---

## La cadena completa

| Paso | Quién lo hace | Dónde está definido |
|---|---|---|
| 1. Llega un push a `main` | — | — |
| 2. Se compila `npx expo export -p web` en un runner de Ubuntu | **GitHub Actions** | `.github/workflows/deploy-web.yml` |
| 3. Se escribe `dist/version.json` con el SHA del commit | GitHub Actions | mismo archivo |
| 4. Se inyectan los íconos de alta resolución en `index.html` | GitHub Actions | mismo archivo |
| 5. Se commitea `dist/` de vuelta a `main` | GitHub Actions | necesita `permissions: contents: write` |
| 6. Se detecta el push y se publica la carpeta | **DigitalOcean App Platform** | `.do/app.yaml` (`deploy_on_push: true`) |

DigitalOcean **no recompila nada**: sirve `dist/` tal cual (`output_dir: dist`, sin
`build_command`), con `catchall_document: index.html` para que la app de una sola página resuelva
todas sus rutas.

### Dos detalles que evitan problemas conocidos

- **`paths-ignore: dist/**`** — sin esto, el commit que hace el propio robot dispararía otro
  build, y otro, en bucle.
- **`cancel-in-progress: false`** — cuando dos personas suben cambios seguidos, los builds se
  **encolan** en vez de cancelarse. Antes cada push cancelaba al anterior y no terminaba ninguno.

---

## Los secretos

Están en **GitHub → Settings → Secrets and variables → Actions**, no en el panel de DigitalOcean
y no en el repositorio:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Quedan **incrustados en el bundle** al compilar. Por eso son la *anon key* y no la de servicio:
lo que va en `dist/` es público por definición.

---

## Compilar a mano (rara vez hace falta)

Existe `npm run deploy` (`scripts/deploy.mjs`), que compila en tu PC y commitea `dist/`. **Era el
método anterior.** Hoy solo sirve para publicar de urgencia si GitHub Actions está caído.

```powershell
npm run build:web    # solo compila, deja dist/ y no commitea
npm run deploy       # compila y commitea dist/
```

> ⚠️ Si compilas en tu PC, el bundle se lleva las variables de **tu `.env` local**. Comprueba que
> apunten a producción antes de publicar.

Las cabeceras de `.do/app.yaml` y `scripts/deploy.mjs` todavía describen ese método manual como
si fuera el vigente. **Manda este documento.**

---

## Cómo saber si un despliegue salió

1. **GitHub → pestaña Actions** → el job *"Compilar web (DigitalOcean)"* en verde.
2. **DigitalOcean → App Platform** → el despliegue más reciente en *Deployed*.
3. En el navegador, `https://soslaguaira.com/version.json` devuelve el SHA del commit publicado.
   La app compara ese valor con el que trae incrustado para avisarle al usuario que hay versión
   nueva.

Si Actions está en verde pero el sitio sigue viejo, el problema está entre los pasos 5 y 6:
mira si el commit de `dist/` llegó a `main`.

---

## Lo que este flujo **no** cubre

- **Las Edge Functions de Supabase.** No se despliegan con el CI. Hay que correr a mano:
  ```bash
  supabase functions deploy admin-create-user
  supabase functions deploy admin-manage-user
  ```
  Olvidarlo ya causó un bug real: el rol elegido al crear un usuario se perdía (ver el manual,
  §4.13, y `supabase/rol_coordinador_inspectores_enum.sql`).
- **El SQL.** Ningún `.sql` de `supabase/` se aplica solo. Se corren a mano en el editor SQL de
  Supabase. Editar el archivo **no lo aplica**.
- **Las apps nativas de iOS/Android.** Eso es EAS Build (`eas build`) y las tiendas; flujo aparte
  y hoy no configurado (`eas.json` no existe).

---

## Histórico — Vercel / Netlify (ya no se usa)

> Se conserva por si alguna vez hace falta un espejo. **`vercel.json` sigue en la raíz del
> repositorio pero no lo usa nadie**: puede borrarse.

La app web de Expo es un sitio estático, así que cualquier hosting estático sirve:

- **Build command:** `npx expo export -p web`
- **Output directory:** `dist`
- **Variables:** `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY` en el panel del
  hosting, nunca en el repo.
- **Dominio:** un subdominio se apunta con un registro **CNAME** al host que dé el proveedor
  (`cname.vercel-dns.com`, `tu-sitio.netlify.app`…). Solo el dominio raíz necesitaría un
  registro `A`.

⚠️ **No montes esto en paralelo al despliegue real sin hablarlo antes.** Dos sitios sirviendo la
misma app contra la misma base de datos es una fuente de confusión garantizada.
