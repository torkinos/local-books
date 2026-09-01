/**
 * Device wiring for T25's share step: write text to a file, hand it to the OS share
 * sheet. Same stance as storage/opsqlite.ts -- this file is the only place the native
 * file/share modules are touched, it stays thin, and everything decidable (CSV
 * content, filename, totals) is decided and tested in ui/incomeSummary.ts.
 *
 * Uses expo-file-system's SDK-57 File/Paths API (not the legacy string-URI one). The
 * cache directory is deliberate: the share sheet copies the file to its destination,
 * so nothing here needs to survive -- and the OS reclaiming stale exports is a
 * feature, not a risk, for a file full of the user's income data.
 */
import { File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';

export async function shareTextFile(
  filename: string,
  text: string,
  mimeType: string,
): Promise<void> {
  const file = new File(Paths.cache, filename);
  // write() creates or overwrites; re-exporting on the same day replaces the file
  // rather than failing on the duplicate name.
  file.write(text);
  await shareAsync(file.uri, { mimeType });
}
