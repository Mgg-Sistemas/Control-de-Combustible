/*
 * 📷 CADA FOTO EN SU RENGLÓN (28-oct-2026).
 * EL PEDIDO: «al adjuntar una foto para un objeto en un requerimiento o solicitud se la coloca a
 * todos; debería guardarse solo para el que le corresponde. Un requerimiento puede tener una o
 * varias fotos, y esas fotos son para el objeto específico».
 * LAS REGLAS:
 *  1. Crear una solicitud de VARIOS renglones (Pedir material) no copia la foto del primero como
 *     foto general de la solicitud; con UNO, sí (es la misma cosa).
 *  2. Editar en Compras → Solicitudes: igual.
 *  3. La tarjeta no muestra como «foto de la pieza / muestra adjunta» la COPIA de la foto de un
 *     renglón cuando hay varios (las solicitudes viejas que ya la tienen copiada se ven bien).
 *   node scripts/test-foto-por-renglon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (r) => fs.readFileSync(path.join(ROOT, r), 'utf8');
const pedir = leer('src/screens/SolicitudMaterialScreen.tsx');
const bandeja = leer('src/screens/SolicitudesCompraTab.tsx');
let ok = 0; const fallos = [];
const t = (n, c) => { if (c) ok++; else fallos.push(n); };
t('1. crear: solo con UN renglón la foto pasa a la solicitud', /const firstPhoto = compraItems\.length === 1 \? \(compraItems\[0\]\.fotoUrl \|\| null\) : null;/.test(pedir));
t('1b. crear: cada renglón conserva su propia foto', /image_url: ci\.fotoUrl \|\| null/.test(pedir));
t('2. editar: solo con UN renglón la foto pasa a la solicitud', /const firstPhoto = finalItems\.length === 1 \? \(finalItems\[0\]\.image_url \|\| null\) : null;/.test(bandeja));
t('2b. ya no se toma la PRIMERA foto encontrada de cualquier renglón', !/finalItems\.find\(\(it\) => it\.image_url\)\?\.image_url/.test(bandeja) && !/compraItems\.find\(\(c\) => c\.fotoUrl\)\?\.fotoUrl/.test(pedir));
t('3. la tarjeta no muestra la copia de la foto de un renglón como general', /esFotoDeRenglon\(r\.attachment_url\) \? r\.attachment_url : null/.test(bandeja));
console.log(`\n📷 Foto por renglón: ${ok} OK · ${fallos.length} FALLO(S)`);
fallos.forEach((f) => console.log('  ✗ ' + f));
process.exit(fallos.length ? 1 : 0);
