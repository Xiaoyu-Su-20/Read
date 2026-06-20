import type { DocumentDeleteState } from "./types";

export type DocumentMenuView = "actions" | "move" | "confirm-delete";

export type DocumentMenuCollectionOption = {
  id: string;
  name: string;
};

export type DocumentMenuEntry =
  | {
      kind: "action";
      id:
        | "open"
        | "rename"
        | "move"
        | "show-in-folder"
        | "delete"
        | "move-destination";
      label: string;
      collectionId?: string;
      danger?: boolean;
      disabled?: boolean;
      tooltip?: string;
    }
  | {
      kind: "divider";
      id: "danger-divider";
    };

export type DocumentMenuResolution = {
  effect:
    | "none"
    | "open"
    | "rename"
    | "show-in-folder"
    | "delete"
    | "move";
  destinationCollectionId?: string;
  nextView: DocumentMenuView | null;
};

const CHECKING_DELETE_REASON = "Checking note status...";
const MOVE_UNAVAILABLE_REASON = "There is no other collection available yet.";

export function buildDocumentMenuEntries(options: {
  view: DocumentMenuView;
  currentCollectionId: string;
  collections: DocumentMenuCollectionOption[];
  deleteState: DocumentDeleteState | null;
}): DocumentMenuEntry[] {
  const { view, currentCollectionId, collections, deleteState } = options;

  if (view === "move") {
    const destinations = collections.filter((collection) => collection.id !== currentCollectionId);
    if (destinations.length === 0) {
      return [
        {
          kind: "action",
          id: "move",
          label: "No other collections",
          disabled: true,
          tooltip: MOVE_UNAVAILABLE_REASON
        }
      ];
    }

    return destinations.map((collection) => ({
      kind: "action" as const,
      id: "move-destination",
      label: collection.name,
      collectionId: collection.id
    }));
  }

  const hasMoveDestination = collections.some((collection) => collection.id !== currentCollectionId);
  const deleteDisabled = deleteState ? !deleteState.canDelete : true;
  const deleteTooltip =
    deleteState?.canDelete === false
      ? deleteState.reason ?? "This PDF cannot be deleted."
      : deleteState
        ? undefined
        : CHECKING_DELETE_REASON;

  return [
    {
      kind: "action",
      id: "open",
      label: "Open"
    },
    {
      kind: "action",
      id: "rename",
      label: "Rename"
    },
    {
      kind: "action",
      id: "move",
      label: "Move to",
      disabled: !hasMoveDestination,
      tooltip: !hasMoveDestination ? MOVE_UNAVAILABLE_REASON : undefined
    },
    {
      kind: "action",
      id: "show-in-folder",
      label: "Show in folder"
    },
    {
      kind: "divider",
      id: "danger-divider"
    },
    {
      kind: "action",
      id: "delete",
      label: "Delete",
      danger: true,
      disabled: deleteDisabled,
      tooltip: deleteTooltip
    }
  ];
}

export function resolveDocumentMenuAction(options: {
  view: DocumentMenuView;
  actionId:
    | "open"
    | "rename"
    | "move"
    | "show-in-folder"
    | "delete"
    | "cancel-delete"
    | "confirm-delete"
    | "move-destination";
  deleteState: DocumentDeleteState | null;
  destinationCollectionId?: string;
}): DocumentMenuResolution {
  const { actionId, deleteState, destinationCollectionId, view } = options;

  if (view === "confirm-delete") {
    if (actionId === "confirm-delete") {
      return {
        effect: "delete",
        nextView: null
      };
    }

    return {
      effect: "none",
      nextView: "actions"
    };
  }

  if (view === "move") {
    if (actionId === "move-destination" && destinationCollectionId) {
      return {
        effect: "move",
        destinationCollectionId,
        nextView: null
      };
    }

    return {
      effect: "none",
      nextView: "move"
    };
  }

  switch (actionId) {
    case "open":
      return { effect: "open", nextView: null };
    case "rename":
      return { effect: "rename", nextView: null };
    case "move":
      return { effect: "none", nextView: "move" };
    case "show-in-folder":
      return { effect: "show-in-folder", nextView: null };
    case "delete":
      if (deleteState?.canDelete) {
        return { effect: "none", nextView: "confirm-delete" };
      }

      return { effect: "none", nextView: "actions" };
    default:
      return { effect: "none", nextView: view };
  }
}
