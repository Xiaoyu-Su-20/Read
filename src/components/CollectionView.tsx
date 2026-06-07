import { useEffect, useMemo, useRef, useState } from "react";

import type { DocumentRecord, FolderTreeNode } from "../lib/types";

type CollectionViewProps = {
  tree: FolderTreeNode | null;
  selectedCollectionId: string | null;
  activeDocumentId: string | null;
  onSelectCollection: (collectionId: string) => void;
  onCreateCollection: () => void | Promise<void>;
  onRenameCollection: (collectionId: string, nextName: string) => void | Promise<void>;
  onOpenDocument: (documentId: string) => void | Promise<void>;
  onRenameDocument: (documentId: string, nextName: string) => void | Promise<void>;
};

function nextDocumentName(value: string, originalFileName: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return originalFileName;
  }

  if (trimmed.toLowerCase().endsWith(".pdf")) {
    return trimmed;
  }

  return `${trimmed}.pdf`;
}

export default function CollectionView({
  tree,
  selectedCollectionId,
  activeDocumentId,
  onSelectCollection,
  onCreateCollection,
  onRenameCollection,
  onOpenDocument,
  onRenameDocument
}: CollectionViewProps) {
  const collections = tree?.folders ?? [];
  const selectedCollection =
    collections.find((collection) => collection.folder.id === selectedCollectionId) ??
    collections[0] ??
    null;
  const books = selectedCollection?.documents ?? [];

  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingCollectionValue, setEditingCollectionValue] = useState("");
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [editingDocumentValue, setEditingDocumentValue] = useState("");

  const clickTimerRef = useRef<number | null>(null);
  const suppressBookActivationUntilRef = useRef(0);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  const visibleBooks = useMemo(() => books.slice(0, 14), [books]);

  function clearPendingClick() {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }

  function queueSingleClick(action: () => void) {
    clearPendingClick();
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      action();
    }, 180);
  }

  function suppressBookActivation() {
    suppressBookActivationUntilRef.current = window.performance.now() + 250;
  }

  function shouldSuppressBookActivation() {
    return window.performance.now() < suppressBookActivationUntilRef.current;
  }

  async function commitCollectionRename() {
    if (!editingCollectionId) {
      return;
    }

    const nextName = editingCollectionValue.trim();
    const targetId = editingCollectionId;
    setEditingCollectionId(null);
    if (!nextName) {
      return;
    }
    await onRenameCollection(targetId, nextName);
  }

  async function commitDocumentRename(document: DocumentRecord) {
    if (editingDocumentId !== document.id) {
      return;
    }

    const nextName = nextDocumentName(editingDocumentValue, document.fileName);
    suppressBookActivation();
    setEditingDocumentId(null);
    await onRenameDocument(document.id, nextName);
  }

  return (
    <section className="collection-view">
      <aside className="collection-sidebar">
        <header className="collection-sidebar__header">
          <h2>Library</h2>
          <button
            className="collection-sidebar__add"
            type="button"
            aria-label="Add collection"
            onClick={() => {
              void onCreateCollection();
            }}
          >
            +
          </button>
        </header>

        <div className="collection-sidebar__rows">
          {collections.map((collection) => {
            const isActive = collection.folder.id === selectedCollection?.folder.id;
            const isEditing = collection.folder.id === editingCollectionId;

            return (
              <button
                key={collection.folder.id}
                className={`collection-row${isActive ? " collection-row--active" : ""}`}
                type="button"
                onClick={() => {
                  queueSingleClick(() => onSelectCollection(collection.folder.id));
                }}
                onDoubleClick={() => {
                  clearPendingClick();
                  setEditingDocumentId(null);
                  setEditingCollectionId(collection.folder.id);
                  setEditingCollectionValue(collection.folder.name);
                  onSelectCollection(collection.folder.id);
                }}
              >
                {isEditing ? (
                  <input
                    className="collection-row__input"
                    autoFocus
                    value={editingCollectionValue}
                    onChange={(event) => setEditingCollectionValue(event.target.value)}
                    onBlur={() => {
                      void commitCollectionRename();
                    }}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEditingCollectionId(null);
                        setEditingCollectionValue("");
                      }

                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitCollectionRename();
                      }
                    }}
                  />
                ) : (
                  <span className="collection-row__name">{collection.folder.name}</span>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="collection-main">
        {selectedCollection ? (
          <div className="collection-book-list">
            {visibleBooks.map((document) => {
              const isEditing = editingDocumentId === document.id;
              const isActive = activeDocumentId === document.id;

            return (
                <div
                  key={document.id}
                  className={`book-row${isActive ? " book-row--active" : ""}`}
                  role="button"
                  tabIndex={isEditing ? -1 : 0}
                  onClick={() => {
                    if (isEditing || shouldSuppressBookActivation()) {
                      return;
                    }
                    queueSingleClick(() => {
                      void onOpenDocument(document.id);
                    });
                  }}
                  onKeyDown={(event) => {
                    if (isEditing || shouldSuppressBookActivation()) {
                      return;
                    }

                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void onOpenDocument(document.id);
                    }
                  }}
                  onDoubleClick={() => {
                    clearPendingClick();
                    suppressBookActivation();
                    setEditingCollectionId(null);
                    setEditingDocumentId(document.id);
                    setEditingDocumentValue(document.fileName);
                  }}
                >
                  {isEditing ? (
                    <input
                      className="book-row__input"
                      autoFocus
                      value={editingDocumentValue}
                      onChange={(event) => setEditingDocumentValue(event.target.value)}
                      onBlur={() => {
                        void commitDocumentRename(document);
                      }}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                      onKeyUp={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation();

                        if (event.key === "Escape") {
                          event.preventDefault();
                          suppressBookActivation();
                          setEditingDocumentId(null);
                          setEditingDocumentValue("");
                        }

                        if (event.key === "Enter") {
                          event.preventDefault();
                          void commitDocumentRename(document);
                        }
                      }}
                    />
                  ) : (
                    <span className="book-row__name">{document.title}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state empty-state--panel">
            <span className="eyebrow">Collections</span>
            <h2>Your shelves are ready.</h2>
            <p>Click the + button to add a collection, then bring PDFs into it.</p>
          </div>
        )}
      </section>
    </section>
  );
}
