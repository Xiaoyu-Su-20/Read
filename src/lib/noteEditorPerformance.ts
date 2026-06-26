import type { NoteBlock } from "./types";

export type NoteBlocksUpdateProfile = {
  id: number;
  startedAt: number;
  source: string;
  noteId: string | null;
  blockCount: number;
};

const updateProfiles = new WeakMap<NoteBlock[], NoteBlocksUpdateProfile>();
let nextUpdateProfileId = 1;

export function markNoteBlocksUpdate(
  blocks: NoteBlock[],
  fields: Omit<NoteBlocksUpdateProfile, "id" | "startedAt">
) {
  const profile: NoteBlocksUpdateProfile = {
    id: nextUpdateProfileId++,
    startedAt: performance.now(),
    ...fields
  };
  updateProfiles.set(blocks, profile);
  return profile;
}

export function getNoteBlocksUpdateProfile(blocks: NoteBlock[]) {
  return updateProfiles.get(blocks) ?? null;
}
