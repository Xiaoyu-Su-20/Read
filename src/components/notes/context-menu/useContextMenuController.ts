import type { InteractiveColorKey, NoteBlockType } from "../../../lib/types";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from "react";
import {
  getSubmenuPlacement,
  placeMenu,
  type PanePoint,
  type SubmenuPlacement
} from "./menuPlacement";

export type NotesContextMenuState =
  | {
      target: "title";
      anchor: PanePoint;
    }
  | {
      target: "body";
      blockId: string;
      blockType: NoteBlockType;
      canInsertPageLinkAtPoint: boolean;
      canCreateTopicCardFromSelection: boolean;
      anchor: PanePoint;
    }
  | {
      target: "page-link";
      blockId: string;
      pageLinkId: string;
      anchor: PanePoint;
    }
  | {
      target: "topic-card";
      blockId: string;
      topicId: string;
      topicColor: InteractiveColorKey;
      anchor: PanePoint;
    };

type UseContextMenuControllerArgs = {
  paneRef: RefObject<HTMLElement | null>;
};

export function useContextMenuController({ paneRef }: UseContextMenuControllerArgs) {
  const [state, setState] = useState<NotesContextMenuState | null>(null);
  const [position, setPosition] = useState<PanePoint | null>(null);
  const [submenuKind, setSubmenuKind] = useState<"turn-into" | "topic-color" | null>(null);
  const [submenuPlacement, setSubmenuPlacement] = useState<SubmenuPlacement>({
    direction: "right",
    offsetY: 0
  });
  const closeTimerRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const submenuAnchorRef = useRef<HTMLDivElement | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closeMenu = useCallback(() => {
    clearCloseTimer();
    setSubmenuKind(null);
    setState(null);
  }, [clearCloseTimer]);

  const openMenu = useCallback(
    (nextState: NotesContextMenuState) => {
      clearCloseTimer();
      setSubmenuKind(null);
      setState(nextState);
    },
    [clearCloseTimer]
  );

  const openSubmenu = useCallback((kind: "turn-into" | "topic-color") => {
    clearCloseTimer();
    setSubmenuKind(kind);
  }, [clearCloseTimer]);

  const scheduleCloseSubmenu = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setSubmenuKind(null);
      closeTimerRef.current = null;
    }, 120);
  }, [clearCloseTimer]);

  useEffect(() => {
    return () => {
      clearCloseTimer();
    };
  }, [clearCloseTimer]);

  useLayoutEffect(() => {
    if (!state || !paneRef.current || !menuRef.current) {
      setPosition(null);
      return;
    }

    const currentState = state;

    function updatePosition() {
      if (!paneRef.current || !menuRef.current) {
        return;
      }

      setPosition(
        placeMenu(
          currentState.anchor,
          {
            width: paneRef.current.clientWidth,
            height: paneRef.current.clientHeight
          },
          {
            width: menuRef.current.offsetWidth,
            height: menuRef.current.offsetHeight
          }
        )
      );
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, [paneRef, state]);

  useLayoutEffect(() => {
    if (!submenuKind || !paneRef.current || !submenuAnchorRef.current || !submenuRef.current) {
      setSubmenuPlacement({
        direction: "right",
        offsetY: 0
      });
      return;
    }

    setSubmenuPlacement(
      getSubmenuPlacement(
        submenuAnchorRef.current.getBoundingClientRect(),
        paneRef.current.getBoundingClientRect(),
        {
          width: submenuRef.current.offsetWidth,
          height: submenuRef.current.offsetHeight
        }
      )
    );
  }, [paneRef, position, state, submenuKind]);

  return {
    state,
    position,
    submenuKind,
    submenuOpen: submenuKind !== null,
    submenuPlacement,
    menuRef,
    submenuRef,
    submenuAnchorRef,
    openMenu,
    closeMenu,
    openSubmenu,
    scheduleCloseSubmenu
  };
}
