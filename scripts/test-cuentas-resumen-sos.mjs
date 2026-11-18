// Prueba del modo Solo Resumen (Estilo Tesorería SOS), moneda real, plan de pagos,
// notas, datos bancarios y filtros por empresa/moneda en Cuentas por Pagar (18-nov-2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const leer = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const resSrc = leer('src/lib/cuentaPagoResuelto.ts');
const repSrc = leer('src/lib/cuentasReporte.ts');
const msgSrc = leer('src/lib/cuentaMensaje.ts');
const modalSrc = leer('src/components/ReporteCuentasModal.tsx');
const screenSrc = leer('src/screens/CuentasScreen.tsx');

// 1. Fuente única de verdad en cuentaPagoResuelto.ts
assert(resSrc.includes('export function resolverPagoCuenta'), 'Falta resolverPagoCuenta');
assert(resSrc.includes("'USDT'") && resSrc.includes("'USD_EFECTIVO'") && resSrc.includes("'ZELLE'") && resSrc.includes("'MIXTO'") && resSrc.includes("'POR_DEFINIR'"), 'Deben existir todas las monedas reales');
assert(resSrc.includes('if (canalesBs && canalesUsd) return null'), 'Ficha multi-canal sin especificar en orden no debe adivinar');

// 2. cuentasReporte.ts integrado con PagoResueltoCuenta y datos completos del mensaje
assert(repSrc.includes("from './cuentaPagoResuelto'"), 'cuentasReporte debe tipar PagoResueltoCuenta');
assert(repSrc.includes('TOTALES POR MONEDA REAL A PAGAR'), 'Modo resumen debe mostrar totales por moneda real');
assert(repSrc.includes('Plan / Desglose:'), 'Modo resumen debe incluir plan de pagos / desglose');
assert(repSrc.includes('Nota:'), 'Modo resumen debe incluir notas y nota de espera');
assert(repSrc.includes('Banco:'), 'Modo resumen debe incluir datos bancarios');
assert(repSrc.includes('Solicita:') && repSrc.includes('Autorizó:'), 'Modo resumen debe incluir solicitante y autorizador');

// 3. ReporteCuentasModal.tsx: filtros propios por empresa y moneda + toggles
assert(modalSrc.includes('FILTRAR POR EMPRESA EN ESTE REPORTE'), 'Modal debe permitir filtrar por empresa propia');
assert(modalSrc.includes('FILTRAR POR MONEDA REAL A PAGAR'), 'Modal debe permitir filtrar por moneda real');
assert(modalSrc.includes('incluirPlanResumen') && modalSrc.includes('incluirNotasResumen') && modalSrc.includes('incluirBancoResumen'), 'Modal debe ofrecer toggles del resumen');

// 4. CuentasScreen.tsx pasa plan, notaEspera, alicuotaIva y pagoResuelto al reporte
assert(screenSrc.includes('planDeCuenta(c)?.plan ?? null') && screenSrc.includes('ultimaNotaActiva(') && screenSrc.includes('resolverPagoCuenta('), 'CuentasScreen debe enriquecer filas con resolverPagoCuenta para ReporteCuentasModal');

// 5. cuentaMensaje.ts: resumenBancoEnLinea ya no descarta datos bancarios si hay pagoTexto
assert(!/if \(p\) \{\s*const c = txt\(condiciones\);\s*return/.test(msgSrc), 'resumenBancoEnLinea no debe hacer return temprano ignorando datos bancarios');
assert(msgSrc.includes("from './cuentaPagoResuelto'"), 'cuentaMensaje debe usar cuentaPagoResuelto');

console.log('✅ test-cuentas-resumen-sos: todas las verificaciones pasaron (16/16).');
