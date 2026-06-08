import type { PaletteItem } from "../types";

export type PaletteSession =
  | {
      kind: "commands" | "select";
      title: string;
      query: string;
      items: PaletteItem[];
      emptyMessage: string;
    }
  | {
      kind: "input";
      title: string;
      query: string;
      placeholder: string;
      confirmLabel: string;
      emptyMessage?: string;
      onSubmit: (value: string) => void | Promise<void>;
    };
