import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from "react";
import {
  getSubmenuDirection,
  placeMenu,
  type PanePoint,
  type SubmenuDirection
} from "./menuPlacement";

export type NotesContextMenuState =
  | {
      target: "title";
      anchor: PanePoint;
    }
  | {
      target: "body";
      blockId: string;
      canAddPageLink: boolean;
      anchor: PanePoint;
    }
  | {
      target: "page-link";
      blockId: string;
      pageLinkId: string;
      anchor: PanePoint;
    };

type UseContextMenuControllerArgs = {
  paneRef: RefObject<HTMLElement | null>;
};

export function useContextMenuController({ paneRef }: UseContextMenuControllerArgs) {
  const [state, setState] = useState<NotesContextMenuState | null>(null);
  const [position, setPosition] = useState<PanePoint | null>(null);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [submenuDirection, setSubmenuDirection] = useState<SubmenuDirection>("right");
  const closeTimerRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closeMenu = useCallback(() => {
    clearCloseTimer();
    setSubmenuOpen(false);
    setState(null);
  }, [clearCloseTimer]);

  const openMenu = useCallback(
    (nextState: NotesContextMenuState) => {
      clearCloseTimer();
      setSubmenuOpen(false);
      setState(nextState);
    },
    [clearCloseTimer]
  );

  const openSubmenu = useCallback(() => {
    clearCloseTimer();
    setSubmenuOpen(true);
  }, [clearCloseTimer]);

  const scheduleCloseSubmenu = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setSubmenuOpen(false);
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
    if (!submenuOpen || !paneRef.current || !menuRef.current) {
      setSubmenuDirection("right");
      return;
    }

    const menuPosition = position ?? state?.anchor;
    if (!menuPosition) {
      setSubmenuDirection("right");
      return;
    }

    setSubmenuDirection(
      getSubmenuDirection(
        menuPosition,
        {
          width: paneRef.current.clientWidth,
          height: paneRef.current.clientHeight
        },
        {
          width: menuRef.current.offsetWidth,
          height: menuRef.current.offsetHeight
        },
        submenuRef.current?.offsetWidth ?? 176
      )
    );
  }, [paneRef, position, state, submenuOpen]);

  return {
    state,
    position,
    submenuOpen,
    submenuDirection,
    menuRef,
    submenuRef,
    openMenu,
    closeMenu,
    openSubmenu,
    scheduleCloseSubmenu
  };
}
