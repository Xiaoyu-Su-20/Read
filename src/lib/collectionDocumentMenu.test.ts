import { describe, expect, it } from "vitest";

import {
  buildDocumentMenuEntries,
  resolveDocumentMenuAction
} from "./collectionDocumentMenu";

describe("collectionDocumentMenu", () => {
  it("orders actions with a divider before delete", () => {
    const entries = buildDocumentMenuEntries({
      view: "actions",
      currentCollectionId: "c1",
      collections: [
        { id: "c1", name: "Collection 1" },
        { id: "c2", name: "Collection 2" }
      ],
      deleteState: {
        canDelete: true,
        reason: null
      }
    });

    expect(entries.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      "action:open",
      "action:rename",
      "action:move",
      "action:show-in-folder",
      "divider:danger-divider",
      "action:delete"
    ]);
  });

  it("excludes the current collection from move destinations", () => {
    const entries = buildDocumentMenuEntries({
      view: "move",
      currentCollectionId: "c2",
      collections: [
        { id: "c1", name: "Collection 1" },
        { id: "c2", name: "Collection 2" },
        { id: "c3", name: "Collection 3" }
      ],
      deleteState: null
    });

    expect(
      entries.flatMap((entry) =>
        entry.kind === "action" && entry.id === "move-destination" ? [entry.collectionId] : []
      )
    ).toEqual(["c1", "c3"]);
  });

  it("disables delete with the tooltip reason when note content blocks deletion", () => {
    const entries = buildDocumentMenuEntries({
      view: "actions",
      currentCollectionId: "c1",
      collections: [
        { id: "c1", name: "Collection 1" },
        { id: "c2", name: "Collection 2" }
      ],
      deleteState: {
        canDelete: false,
        reason: "PDFs with note content cannot be deleted."
      }
    });

    const deleteEntry = entries.find((entry) => entry.kind === "action" && entry.id === "delete");
    expect(deleteEntry).toMatchObject({
      kind: "action",
      id: "delete",
      disabled: true,
      tooltip: "PDFs with note content cannot be deleted."
    });
  });

  it("enters delete confirmation before invoking deletion", () => {
    const promptDelete = resolveDocumentMenuAction({
      view: "actions",
      actionId: "delete",
      deleteState: {
        canDelete: true,
        reason: null
      }
    });
    expect(promptDelete).toEqual({
      effect: "none",
      nextView: "confirm-delete"
    });

    const confirmDelete = resolveDocumentMenuAction({
      view: "confirm-delete",
      actionId: "confirm-delete",
      deleteState: {
        canDelete: true,
        reason: null
      }
    });
    expect(confirmDelete).toEqual({
      effect: "delete",
      nextView: null
    });
  });

  it("keeps move disabled when no destination collection exists", () => {
    const entries = buildDocumentMenuEntries({
      view: "actions",
      currentCollectionId: "c1",
      collections: [{ id: "c1", name: "Collection 1" }],
      deleteState: {
        canDelete: true,
        reason: null
      }
    });

    const moveEntry = entries.find((entry) => entry.kind === "action" && entry.id === "move");
    expect(moveEntry).toMatchObject({
      kind: "action",
      id: "move",
      disabled: true,
      tooltip: "There is no other collection available yet."
    });
  });
});
