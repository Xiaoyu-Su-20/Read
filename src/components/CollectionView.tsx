import { useEffect, useMemo, useRef, useState } from "react";

import type { DocumentRecord, FolderTreeNode } from "../lib/types";

type CollectionViewProps = {
  tree: FolderTreeNode | null;
  selectedCollectionId: string | null;
  onSelectCollection: (collectionId: string) => void;
  onCreateCollection: () => void | Promise<void>;
  onRenameCollection: (collectionId: string, nextName: string) => void | Promise<void>;
  onDeleteCollection: (collectionId: string) => void | Promise<void>;
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
  onSelectCollection,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
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
  const [openCollectionMenuId, setOpenCollectionMenuId] = useState<string | null>(null);
  const [confirmDeleteCollectionId, setConfirmDeleteCollectionId] = useState<string | null>(null);
  const suppressBookActivationUntilRef = useRef(0);
  const skipNextCollectionSelectionRef = useRef(false);
  const skipNextDocumentActivationRef = useRef(false);

  const visibleBooks = useMemo(() => books.slice(0, 14), [books]);

  function suppressBookActivation() {
    suppressBookActivationUntilRef.current = window.performance.now() + 250;
  }

  function shouldSuppressBookActivation() {
    return window.performance.now() < suppressBookActivationUntilRef.current;
  }

  function closeCollectionMenu() {
    setOpenCollectionMenuId(null);
    setConfirmDeleteCollectionId(null);
  }

  async function commitCollectionRename(options?: { skipNextSelection?: boolean }) {
    if (!editingCollectionId) {
      return;
    }

    const currentCollection =
      collections.find((collection) => collection.folder.id === editingCollectionId) ?? null;
    const nextName = editingCollectionValue.trim();
    const targetId = editingCollectionId;
    setEditingCollectionId(null);
    if (options?.skipNextSelection) {
      skipNextCollectionSelectionRef.current = true;
    }
    if (!nextName) {
      return;
    }
    if (currentCollection && nextName === currentCollection.folder.name) {
      return;
    }
    await onRenameCollection(targetId, nextName);
  }

  async function commitDocumentRename(
    document: DocumentRecord,
    options?: { skipNextActivation?: boolean }
  ) {
    if (editingDocumentId !== document.id) {
      return;
    }

    const nextName = nextDocumentName(editingDocumentValue, document.fileName);
    suppressBookActivation();
    if (options?.skipNextActivation) {
      skipNextDocumentActivationRef.current = true;
    }
    setEditingDocumentId(null);
    if (nextName === document.fileName) {
      return;
    }
    await onRenameDocument(document.id, nextName);
  }

  useEffect(() => {
    function handleWindowPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".collection-row__actions, .collection-row__menu")) {
        return;
      }

      closeCollectionMenu();
    }

    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeCollectionMenu();
      }
    }

    window.addEventListener("pointerdown", handleWindowPointerDown, true);
    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handleWindowPointerDown, true);
      window.removeEventListener("keydown", handleWindowKeyDown, true);
    };
  }, []);

  useEffect(() => {
    closeCollectionMenu();
  }, [selectedCollectionId]);

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
            const isMenuOpen = collection.folder.id === openCollectionMenuId;
            const isDeleteConfirming = collection.folder.id === confirmDeleteCollectionId;
            const collectionHasDocuments = collection.documents.length > 0;

            return (
              <div
                key={collection.folder.id}
                className={`collection-row${isActive ? " collection-row--active" : ""}`}
                role="button"
                tabIndex={isEditing ? -1 : 0}
                onClick={() => {
                  if (skipNextCollectionSelectionRef.current) {
                    skipNextCollectionSelectionRef.current = false;
                    return;
                  }
                  onSelectCollection(collection.folder.id);
                }}
                onKeyDown={(event) => {
                  if (isEditing) {
                    return;
                  }

                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectCollection(collection.folder.id);
                  }
                }}
              >
                {isEditing ? (
                  <input
                    className="collection-row__input"
                    autoFocus
                    value={editingCollectionValue}
                    onChange={(event) => setEditingCollectionValue(event.target.value)}
                    onBlur={() => {
                      void commitCollectionRename({ skipNextSelection: true });
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
                  <>
                    <span className="collection-row__icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M3.75 7.25A2.25 2.25 0 0 1 6 5h3.1c.6 0 1.18.24 1.6.66l1.15 1.14c.42.42 1 .66 1.6.66H18A2.25 2.25 0 0 1 20.25 9.7v7.05A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.25Z" />
                      </svg>
                    </span>
                    <span className="collection-row__name">{collection.folder.name}</span>
                    <span className="collection-row__actions">
                      <span className="collection-row__count" aria-label={`${collection.documents.length} documents`}>
                        {collection.documents.length}
                      </span>
                      <button
                        className="row-action-button"
                        type="button"
                        aria-label={`Open actions for ${collection.folder.name}`}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenCollectionMenuId((current) =>
                            current === collection.folder.id ? null : collection.folder.id
                          );
                          setConfirmDeleteCollectionId(null);
                        }}
                      >
                        <svg
                          className="row-action-button__icon"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <circle cx="6.5" cy="12" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="17.5" cy="12" r="1.8" />
                        </svg>
                      </button>
                      {isMenuOpen ? (
                        <div
                          className="notes-popover collection-row__menu"
                          role="menu"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {isDeleteConfirming ? (
                            <>
                              <strong className="collection-row__menu-title">Delete collection?</strong>
                              <p className="collection-row__menu-help">
                                {`This will delete "${collection.folder.name}" permanently.`}
                              </p>
                              <div className="collection-row__menu-footer">
                                <button
                                  className="collection-row__menu-button collection-row__menu-button--ghost"
                                  type="button"
                                  onClick={() => {
                                    setConfirmDeleteCollectionId(null);
                                  }}
                                >
                                  Cancel
                                </button>
                                <button
                                  className="collection-row__menu-button collection-row__menu-button--danger"
                                  type="button"
                                  onClick={() => {
                                    closeCollectionMenu();
                                    void onDeleteCollection(collection.folder.id);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <button
                                className="notes-popover__action collection-row__menu-action"
                                type="button"
                                onClick={() => {
                                  closeCollectionMenu();
                                  setEditingDocumentId(null);
                                  setEditingCollectionId(collection.folder.id);
                                  setEditingCollectionValue(collection.folder.name);
                                  onSelectCollection(collection.folder.id);
                                }}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                  <path d="M4 20h4l10-10-4-4L4 16v4Z" />
                                  <path d="m12.5 7.5 4 4" />
                                </svg>
                                  <span>Rename</span>
                                </button>
                              {collectionHasDocuments ? (
                                <div className="collection-row__menu-disabled">
                                  <button
                                    className="notes-popover__action collection-row__menu-action collection-row__menu-action--danger"
                                    type="button"
                                    disabled
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                      <path d="M6 7h12" />
                                      <path d="M9 7V5.5h6V7" />
                                      <path d="M8.2 7l.6 11h6.4l.6-11" />
                                    </svg>
                                    <span>Delete</span>
                                  </button>
                                  <div className="collection-row__menu-tooltip" role="note">
                                    Collections with PDFs inside cannot be deleted.
                                  </div>
                                </div>
                              ) : (
                                <button
                                  className="notes-popover__action collection-row__menu-action collection-row__menu-action--danger"
                                  type="button"
                                  onClick={() => {
                                    setConfirmDeleteCollectionId(collection.folder.id);
                                  }}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                    <path d="M6 7h12" />
                                    <path d="M9 7V5.5h6V7" />
                                    <path d="M8.2 7l.6 11h6.4l.6-11" />
                                  </svg>
                                  <span>Delete</span>
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      ) : null}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <section className="collection-main">
        {selectedCollection ? (
          <div className="collection-book-list">
            {visibleBooks.map((document) => {
              const isEditing = editingDocumentId === document.id;

              return (
                <div
                  key={document.id}
                  className="book-row"
                  role="button"
                  tabIndex={isEditing ? -1 : 0}
                  onClick={() => {
                    if (isEditing || shouldSuppressBookActivation()) {
                      return;
                    }
                    if (skipNextDocumentActivationRef.current) {
                      skipNextDocumentActivationRef.current = false;
                      return;
                    }
                    void onOpenDocument(document.id);
                  }}
                  onKeyDown={(event) => {
                    if (isEditing || shouldSuppressBookActivation()) {
                      return;
                    }
                    if (skipNextDocumentActivationRef.current) {
                      skipNextDocumentActivationRef.current = false;
                      return;
                    }

                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void onOpenDocument(document.id);
                    }
                  }}
                >
                  {isEditing ? (
                    <input
                      className="book-row__input"
                      autoFocus
                      value={editingDocumentValue}
                      onChange={(event) => setEditingDocumentValue(event.target.value)}
                      onBlur={() => {
                        void commitDocumentRename(document, { skipNextActivation: true });
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
                    <>
                      <span className="book-row__name">{document.title}</span>
                      <span className="book-row__actions">
                        <button
                          className="row-action-button"
                          type="button"
                          aria-label={`Rename ${document.title}`}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            suppressBookActivation();
                            setEditingCollectionId(null);
                            setEditingDocumentId(document.id);
                            setEditingDocumentValue(document.fileName);
                          }}
                        >
                          <svg
                            className="row-action-button__icon"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <circle cx="6.5" cy="12" r="1.8" />
                            <circle cx="12" cy="12" r="1.8" />
                            <circle cx="17.5" cy="12" r="1.8" />
                          </svg>
                        </button>
                      </span>
                    </>
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
