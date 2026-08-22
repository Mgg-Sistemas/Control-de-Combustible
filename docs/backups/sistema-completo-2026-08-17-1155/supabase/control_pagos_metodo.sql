-- ============================================================================
-- CONTROL DE PAGOS (empresas) — MÉTODO DE PAGO del abono.
-- Guarda cómo se pagó cada abono: efectivo ($ físico), USDT o Bs (al cambio del día).
-- El ledger sigue en $ (columna amount); si el pago fue en Bs se guarda además el
-- monto en Bs y la tasa (Bs/$) usada, para dejar constancia del cálculo.
-- Idempotente (add column if not exists). Sin correrla, el abono NO guarda el método
-- ni el monto en Bs/tasa (el monto en $ sí se guarda igual).
-- ============================================================================
alter table public.company_payments add column if not exists metodo   text;                 -- 'efectivo' | 'usdt' | 'bs'
alter table public.company_payments add column if not exists monto_bs numeric(16,2);         -- monto pagado en Bs (si metodo='bs')
alter table public.company_payments add column if not exists tasa_bs  numeric(16,4);         -- tasa Bs/$ del día (si metodo='bs')
