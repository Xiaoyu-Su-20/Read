import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PdfViewer from "./PdfViewer";
import type { DocumentPayload } from "../lib/types";

const documentPayload: DocumentPayload = {
  document: {
    id: "doc-1",
    title: "Example PDF",
    fileName: "example.pdf",
    folderId: "collection-1",
    relativePath: "collection-1/example.pdf",
    fingerprint: "fingerprint-1",
    importedAt: "2026-06-14T00:00:00Z",
    lastOpenedAt: "2026-06-14T00:00:00Z",
    availability: "available"
  },
  state: {
    version: 1,
    documentId: "doc-1",
    fingerprint: "fingerprint-1",
    lastOpenedAt: "2026-06-14T00:00:00Z",
    lastPage: 1,
    zoom: 1,
    bookmarks: [],
    preferences: {
      fitMode: "width"
    },
    userOutlineItems: []
  },
  filePath: "D:/Read/example.pdf",
  pageCount: 12
};

function renderViewer(mode: "light" | "dark") {
  return renderToStaticMarkup(
    createElement(PdfViewer, {
      document: documentPayload,
      onSnapshotChange: vi.fn(),
      onOutlineChange: vi.fn(),
      onStatusChange: vi.fn(),
      onStateChange: vi.fn(),
      registerApi: vi.fn(),
      viewerDisplayConfig: {
        mode,
        useOnePaperColorForBoth: false,
        light: {
          paperColor: "#c8c2b8",
          paperColorSource: "default",
          brightness: 1,
          contrast: 1
        },
        dark: {
          paperColor: "#20242a",
          paperColorSource: "default",
          brightness: 0.9,
          contrast: 0.92,
          inversion: 1
        }
      }
    })
  );
}

describe("PdfViewer", () => {
  it("renders the light appearance without a dark marker", () => {
    const markup = renderViewer("light");

    expect(markup).toContain('class="reader-stage"');
    expect(markup).toContain('data-document-appearance="light"');
    expect(markup).toContain("--viewer-paper-color:#c8c2b8");
    expect(markup).not.toContain('data-document-appearance="dark"');
  });

  it("renders the dark appearance marker and filter on the pdf shell", () => {
    const markup = renderViewer("dark");

    expect(markup).toContain('data-document-appearance="dark"');
    expect(markup).toContain("--viewer-paper-color:#20242a");
    expect(markup).toContain("invert(1)");
    expect(markup).toContain("brightness(0.9)");
    expect(markup).toContain("contrast(0.92)");
  });
});
