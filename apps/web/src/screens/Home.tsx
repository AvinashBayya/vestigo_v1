import { AppShell } from "../components/AppShell.tsx";
import { SearchDashboard } from "./Search.tsx";

/** The signed-in home: the search dashboard. */
export function HomeScreen() {
  return (
    <AppShell>
      <SearchDashboard />
    </AppShell>
  );
}
