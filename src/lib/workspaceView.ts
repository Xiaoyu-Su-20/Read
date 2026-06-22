export type WorkspaceView = "reader" | "collection" | "notes" | "book";

export type ViewTransition = {
  clickStartedAtMs: number;
  fromView: WorkspaceView;
  source: string;
  toView: WorkspaceView;
  viewTransitionId: string;
};

export function toViewEventName(view: WorkspaceView) {
  switch (view) {
    case "reader":
      return "document";
    case "book":
      return "book";
    case "notes":
      return "notes";
    case "collection":
      return "collection";
  }
}
