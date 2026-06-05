import { findFolderNode } from "../lib/tree";
import type { DocumentRecord, FolderTreeNode } from "../lib/types";

type LibraryOverlayProps = {
  open: boolean;
  tree: FolderTreeNode | null;
  currentFolderId: string;
  onClose: () => void;
  onSelectFolder: (folderId: string) => void;
  onOpenDocument: (document: DocumentRecord) => void;
};

function FolderBranch({
  node,
  currentFolderId,
  onSelectFolder
}: {
  node: FolderTreeNode;
  currentFolderId: string;
  onSelectFolder: (folderId: string) => void;
}) {
  return (
    <li>
      <button
        className={
          node.folder.id === currentFolderId
            ? "tree-button tree-button--active"
            : "tree-button"
        }
        type="button"
        onClick={() => onSelectFolder(node.folder.id)}
      >
        {node.folder.name}
      </button>
      {node.folders.length > 0 ? (
        <ul className="tree-list">
          {node.folders.map((child) => (
            <FolderBranch
              key={child.folder.id}
              node={child}
              currentFolderId={currentFolderId}
              onSelectFolder={onSelectFolder}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function LibraryOverlay({
  open,
  tree,
  currentFolderId,
  onClose,
  onSelectFolder,
  onOpenDocument
}: LibraryOverlayProps) {
  if (!open || !tree) {
    return null;
  }

  const activeFolder = findFolderNode(tree, currentFolderId) ?? tree;

  return (
    <div className="overlay-shell" role="presentation" onClick={onClose}>
      <section
        className="panel panel--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Library"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel__header">
          <div>
            <span className="eyebrow">Library</span>
            <h2>{activeFolder.folder.name}</h2>
          </div>
          <button className="panel__close" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="library-layout">
          <aside className="library-tree">
            <ul className="tree-list">
              <FolderBranch
                node={tree}
                currentFolderId={currentFolderId}
                onSelectFolder={onSelectFolder}
              />
            </ul>
          </aside>
          <div className="library-documents">
            {activeFolder.documents.length === 0 ? (
              <div className="empty-state empty-state--panel">
                <p>No PDFs are stored in this folder yet.</p>
              </div>
            ) : (
              <ul className="document-list">
                {activeFolder.documents.map((document) => (
                  <li key={document.id}>
                    <button
                      className="document-card"
                      type="button"
                      onClick={() => onOpenDocument(document)}
                    >
                      <strong>{document.title}</strong>
                      <small>{document.fileName}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
