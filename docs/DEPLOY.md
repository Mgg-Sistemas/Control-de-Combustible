# Despliegue web en un subdominio de GoDaddy

La app web de Expo es un sitio estático. La estrategia recomendada es:
**hostear el build en Vercel (gratis) y apuntar un subdominio de GoDaddy con un registro CNAME.**

> Ejemplo de subdominio: `combustible.tudominio.com`

---

## Opción A — Vercel (recomendada, con deploy automático desde GitHub)

### 1. Generar el build localmente (opcional, para probar)
```powershell
npx expo export -p web
```
Esto crea la carpeta `dist/` con el sitio estático. Para previsualizar:
```powershell
npx serve dist
```

### 2. Conectar el repo a Vercel
1. Entra a [vercel.com](https://vercel.com) e inicia sesión con GitHub.
2. **Add New → Project** → importa `Mgg-Sistemas/Control-de-Combustible`.
3. Vercel detectará `vercel.json`. Si pide configuración manual:
   - **Build Command:** `npx expo export -p web`
   - **Output Directory:** `dist`
4. **Environment Variables** (¡importante! el `.env` no se sube al repo). Agrega:
   - `EXPO_PUBLIC_SUPABASE_URL` = `https://ddcwqmuqdqnsrtpticpx.supabase.co`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` = (tu anon key)
5. **Deploy**. Te dará una URL tipo `control-de-combustible.vercel.app`.

### 3. Agregar tu subdominio en Vercel
1. En el proyecto → **Settings → Domains**.
2. Escribe `combustible.tudominio.com` → **Add**.
3. Vercel te mostrará el valor CNAME a usar (normalmente `cname.vercel-dns.com`).

### 4. Configurar el DNS en GoDaddy
1. Entra a [godaddy.com](https://godaddy.com) → **My Products → Domains → DNS** del dominio.
2. **Add New Record:**
   | Campo | Valor |
   |---|---|
   | **Type** | `CNAME` |
   | **Name (Host)** | `combustible`  *(solo el subdominio, sin el dominio)* |
   | **Value / Points to** | `cname.vercel-dns.com`  *(el que indique Vercel)* |
   | **TTL** | `1 Hour` (o el menor disponible) |
3. **Save**. La propagación DNS tarda de minutos hasta ~1 hora.
4. Vuelve a Vercel → Domains; cuando verifique, emite el certificado **HTTPS** automáticamente.

✅ Listo: la app quedará en `https://combustible.tudominio.com`.

---

## Opción B — Netlify (alternativa equivalente)
- Build command `npx expo export -p web`, publish directory `dist`.
- Mismas variables `EXPO_PUBLIC_*`.
- En GoDaddy, CNAME del subdominio → el host que te dé Netlify (`tu-sitio.netlify.app`).

---

## Notas
- **Subdominio = CNAME.** Solo el dominio raíz (`tudominio.com`) necesitaría registro `A`; un subdominio siempre usa `CNAME`.
- Si el subdominio ya existía con otro registro, edítalo en vez de duplicarlo.
- Cada `git push` a la rama conectada **redepliega** automáticamente.
- Las variables `EXPO_PUBLIC_*` se definen en el panel del hosting, **no** en el repo.
- Esto publica la versión **web**. Para las apps nativas de **iOS/Android** se usa EAS Build (`eas build`) y las tiendas — es un flujo aparte.
