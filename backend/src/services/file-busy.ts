/**
 * Which downloads have their file in someone's hands right now. Renaming,
 * embedding cover art and moving all end by putting a file at a new path or
 * pointing the row at one, so two of them on the same file would each finish
 * against a path the other just changed. One claim per download, whatever the
 * kind, keeps them apart.
 *
 * In memory only: every one of these is undone or finished by a restart — a
 * rename is one syscall, an embed or a copy works on scratch files the boot
 * sweep collects, and the original file is never touched until the end.
 */

export type FileTask = "renaming" | "embedding" | "moving";

/** How far a copy to another filesystem has got, in bytes. */
export type MoveProgress = { copied: number; total: number };

const tasks = new Map<number, FileTask>();
const moves = new Map<number, MoveProgress>();

/** Claims the file of download `id` for `task`; false when it is taken. */
export function claimFile(id: number, task: FileTask): boolean {
  if (tasks.has(id)) return false;

  tasks.set(id, task);

  return true;
}

export function releaseFile(id: number): void {
  tasks.delete(id);
  moves.delete(id);
}

/** What is being done to the file of download `id`, if anything. */
export function fileTask(id: number): FileTask | undefined {
  return tasks.get(id);
}

export function setMoveProgress(id: number, progress: MoveProgress): void {
  moves.set(id, progress);
}

/**
 * The copy in progress for download `id`, or null. Only a move to another
 * filesystem has one: within one it is a rename, over before anyone could ask.
 */
export function moveProgress(id: number): MoveProgress | null {
  return moves.get(id) ?? null;
}

/** The refusal for a request that needs a file someone else is working on. */
export function busyError(id: number): string {
  return tasks.get(id) === "moving" ? "The file is being moved" : "The file is already being updated";
}
