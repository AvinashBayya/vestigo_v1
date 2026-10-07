import { NotBuilt } from "@repo/ui";

/**
 * The Media tab (docs/design/mockups/Media.dc.html). The API has no media
 * endpoints, so the tab says what it will show and what it needs (§8 Not
 * built), and asks the API for nothing. No sample media, no greyed content.
 */
export function MediaTab() {
  return (
    <div className="px-10 py-6">
      <NotBuilt
        title="Media in this case"
        needs="It needs media upload and media-forensics endpoints (file metadata, C2PA provenance, near-duplicates, model analysis), which the API does not have."
        className="max-w-page"
      />
    </div>
  );
}
