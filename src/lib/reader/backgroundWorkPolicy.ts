export const PDF_RUNTIME_OUTLINE_LOAD_DELAY_MS = 2500;

type NativeTextEligibility = {
  backgroundWorkSuspended: boolean;
  displayedPageDocumentId: string | null;
  documentId: string | null;
  hasDisplayedPage: boolean;
};

type OutlineEligibility = {
  backgroundWorkSuspended: boolean;
  displayedPageRequestKey: string | null;
  hasDisplayedPage: boolean;
  hasOutlineProvider: boolean;
  outlineLoadedForDocument: boolean;
  postVisibleWorkReadyKey: string | null;
};

export function shouldRequestNativeTextLayer({
  backgroundWorkSuspended,
  displayedPageDocumentId,
  documentId,
  hasDisplayedPage
}: NativeTextEligibility) {
  return (
    hasDisplayedPage &&
    !backgroundWorkSuspended &&
    displayedPageDocumentId !== null &&
    displayedPageDocumentId === documentId
  );
}

export function shouldScheduleDeferredOutlineLoad({
  backgroundWorkSuspended,
  displayedPageRequestKey,
  hasDisplayedPage,
  hasOutlineProvider,
  outlineLoadedForDocument,
  postVisibleWorkReadyKey
}: OutlineEligibility) {
  return (
    hasDisplayedPage &&
    !backgroundWorkSuspended &&
    hasOutlineProvider &&
    !outlineLoadedForDocument &&
    displayedPageRequestKey !== null &&
    postVisibleWorkReadyKey === displayedPageRequestKey
  );
}
