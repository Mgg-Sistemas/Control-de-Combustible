import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const dotenv = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const env = {};
dotenv.split('\n').forEach((l) => {
  const m = l.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
});

const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

async function main() {
  const { data: profiles, error: pErr } = await sb.from('profiles').select('*');
  if (pErr) console.log('pErr:', pErr);


  const { data: emps } = await sb.from('employees').select('id, first_name, last_name, cedula, cargo, status');
  const matchedEmps = emps?.filter((p) => {
    const s = `${p.first_name || ''} ${p.last_name || ''} ${p.cedula || ''}`.toLowerCase();
    return s.includes('narros') || s.includes('mansilla') || s.includes('fran') || s.includes('anthony');
  });
  console.log('matchedEmps:', JSON.stringify(matchedEmps, null, 2));

  const { data: allMi } = await sb.from('machine_inspectors').select('*');
  console.log('allMi count:', allMi?.length);
  if (allMi && allMi.length > 0) {
    console.log('sample mi:', allMi.slice(0, 5));
    const miMatch = allMi.filter(m => (m.inspector_name||'').toLowerCase().includes('narros') || (m.inspector_name||'').toLowerCase().includes('mansilla'));
    console.log('miMatch:', miMatch);
  }


  const { data: openRounds, error: rOpenErr } = await sb.from('machine_rounds').select('id, machinery_id, round_date, jornada_shift, jornada_start_at, horometro_inicial, horometro_final, day_hours, night_hours').not('jornada_start_at', 'is', null);
  console.log('open rounds count:', openRounds?.length);
  console.log('open rounds:', JSON.stringify(openRounds, null, 2));
}

main().catch(console.error);
