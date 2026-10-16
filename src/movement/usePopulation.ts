// The population table proportions are placed against: exact figures loaded in
// Profile (from scripts/ansur-proportions.py), or the built-in approximate ones.
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setSetting } from '../db/db';
import { BUILT_IN, RATIO_IDS, validTable, type PopulationTable } from './proportions';

export function usePopulation(): PopulationTable {
  const s = useLiveQuery(() => db.settings.get('population'), []);
  return s && validTable(s.value) ? s.value : BUILT_IN;
}

/** Reads a table from a file and keeps it; null goes back to the built-in figures. */
export async function loadPopulation(file: File | null): Promise<PopulationTable> {
  if (!file) {
    await db.settings.delete('population');
    return BUILT_IN;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('That file isn’t JSON. Use the file scripts/ansur-proportions.py writes.');
  }
  if (!validTable(parsed)) throw new Error('That file doesn’t have the expected figures (every ratio, for men and women, at nine percentiles).');
  // keep only the figures used, copied out of the file
  const ratios = Object.fromEntries(RATIO_IDS.map((id) => [id, { male: [...parsed.ratios[id].male], female: [...parsed.ratios[id].female] }])) as PopulationTable['ratios'];
  const t: PopulationTable = { source: String(parsed.source).slice(0, 200), approx: !!parsed.approx, ratios };
  await setSetting('population', t);
  return t;
}
