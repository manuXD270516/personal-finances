import { execFileSync } from 'node:child_process';

export interface DeletedFile {
  /** Ruta relativa a la raíz del repo, con `/`. */
  file: string;
  /** Contenido del archivo en la ref base. */
  content: string;
}

function git(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: 'pipe',
    });
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr ?? '';
    throw new Error(`git ${args.slice(0, 2).join(' ')} falló: ${stderr.trim() || (e as Error).message}`, {
      cause: e,
    });
  }
}

/**
 * Archivos de TC borrados (o renombrados) por la PR: `git diff --name-status <base>...HEAD -- tests/cases`.
 * Devuelve el contenido de cada uno en la ref base.
 */
export function deletedCaseFiles(root: string, base: string): DeletedFile[] {
  const out = git(root, ['diff', '--name-status', '--no-renames', `${base}...HEAD`, '--', 'tests/cases']);
  const deleted: DeletedFile[] = [];
  for (const line of out.split(/\r?\n/)) {
    const [status, file] = line.split('\t');
    if (status !== 'D' || !file || !/\/TC-[^/]+\.md$/.test(file)) continue;
    deleted.push({ file, content: git(root, ['show', `${base}:${file}`]) });
  }
  return deleted;
}
