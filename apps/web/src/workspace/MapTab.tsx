import { NotBuilt } from "@repo/ui";

/**
 * The Map tab (docs/design/mockups/Map.dc.html). No read returns
 * coordinates, so there is nothing to place: the tab says what it will show
 * and what it needs (§8 Not built), and asks the API for nothing. MapShell is
 * not mounted: an empty map would suggest a search that found no places.
 */
export function MapTab() {
  return (
    <div className="px-10 py-6">
      <NotBuilt
        title="Map of located evidence"
        needs="Points are drawn only where a source supplied coordinates, and no endpoint returns coordinates yet. It needs a geolocation read in the API and the MapLibre GL renderer (deferred, R9)."
        className="max-w-page"
      />
    </div>
  );
}
