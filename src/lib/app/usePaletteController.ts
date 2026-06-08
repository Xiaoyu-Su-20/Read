import { useCallback, useState } from "react";

import { debugAction } from "../debugLog";
import type { PaletteItem } from "../types";
import type { PaletteSession } from "./palette";

export function usePaletteController() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteSession, setPaletteSession] = useState<PaletteSession | null>(null);

  const closePalette = useCallback(() => {
    debugAction("palette.close");
    setPaletteOpen(false);
    setPaletteSession(null);
  }, []);

  const openCommands = useCallback((items: PaletteItem[]) => {
    debugAction("palette.open-commands", {
      itemCount: items.length
    });
    setPaletteSession({
      kind: "commands",
      title: "Reader actions",
      query: "",
      items,
      emptyMessage: "No command matches that search."
    });
    setPaletteOpen(true);
  }, []);

  const openSelection = useCallback((title: string, items: PaletteItem[], emptyMessage: string) => {
    debugAction("palette.open-selection", {
      title,
      itemCount: items.length
    });
    setPaletteSession({
      kind: "select",
      title,
      query: "",
      items,
      emptyMessage
    });
    setPaletteOpen(true);
  }, []);

  const openPrompt = useCallback((
    title: string,
    placeholder: string,
    confirmLabel: string,
    onSubmit: (value: string) => void | Promise<void>,
    initialValue = ""
  ) => {
    debugAction("palette.open-prompt", {
      title
    });
    setPaletteSession({
      kind: "input",
      title,
      query: initialValue,
      placeholder,
      confirmLabel,
      onSubmit: async (value) => {
        await onSubmit(value);
        closePalette();
      }
    });
    setPaletteOpen(true);
  }, [closePalette]);

  const changeQuery = useCallback((query: string) => {
    setPaletteSession((current) => (current ? { ...current, query } : current));
  }, []);

  return {
    paletteOpen,
    paletteSession,
    closePalette,
    openCommands,
    openSelection,
    openPrompt,
    changeQuery
  };
}
