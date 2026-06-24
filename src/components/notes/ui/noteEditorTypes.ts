import type {
  InteractiveColorKey,
  NoteBlockType,
  NotePageLinkNode,
  ParagraphTopic
} from "../../../lib/types";

export type NoteEditorContextTarget =
  | {
      target: "body";
      blockId: string;
      blockType: NoteBlockType;
      canInsertPageLinkAtPoint: boolean;
      canCreateTopicCardFromSelection: boolean;
      spellcheckWord: string | null;
    }
  | {
      target: "page-link";
      blockId: string;
      pageLinkId: string;
    }
  | {
      target: "topic-card";
      blockId: string;
      topicId: string;
      topicColor: InteractiveColorKey;
    };

type PageLinkCommandResult =
  | { ok: true; node?: NotePageLinkNode }
  | { ok: false; message: string };

type TopicCommandResult =
  | { ok: true; topic: ParagraphTopic }
  | { ok: false; message: string };

export type NoteEditorHandle = {
  focus: () => void;
  scrollToBlock: (blockId: string) => void;
  copySelection: () => void;
  cutSelection: () => Promise<boolean>;
  pasteSelection: () => Promise<void>;
  turnInto: (blockId: string, type: NoteBlockType) => void;
  removeBlock: (blockId: string) => boolean;
  insertPageLink: (pageNumber: number) => PageLinkCommandResult;
  openPageLink: (pageLinkId: string) => NotePageLinkNode | null;
  getPageLink: (pageLinkId: string) => NotePageLinkNode | null;
  editPageLink: (pageLinkId: string, pageNumber: number) => PageLinkCommandResult;
  removePageLink: (pageLinkId: string) => boolean;
  copyPageReference: (pageLinkId: string) => void;
  createTopicFromSelection: (color?: InteractiveColorKey) => TopicCommandResult;
  getTopic: (topicId: string) => ParagraphTopic | null;
  editTopic: (
    topicId: string,
    updates: Partial<Pick<ParagraphTopic, "text" | "color">>
  ) => TopicCommandResult;
  removeTopic: (topicId: string) => boolean;
  resolveContextMenuTargetAtPoint: (
    x: number,
    y: number
  ) => NoteEditorContextTarget | null;
  clearSelectedBlock: () => void;
  selectTextMatch: (blockId: string, query: string, occurrenceIndex: number) => boolean;
  undo: () => boolean;
  redo: () => boolean;
};
