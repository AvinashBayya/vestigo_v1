/**
 * For tests that render through the router. The router downloads each screen
 * when its route is first matched (router.tsx); a test file imports this to
 * load every screen with the file, as the router did when it imported them
 * all. A test's waits are then for what a screen does, never for the first
 * compile of its modules, which can take longer than a wait allows.
 */
import "./screens/Cases.tsx";
import "./screens/Enrol.tsx";
import "./screens/Home.tsx";
import "./screens/Members.tsx";
import "./screens/Run.tsx";
import "./screens/Settings.tsx";
import "./screens/SignIn.tsx";
import "./screens/Tenant.tsx";
import "./screens/Verify.tsx";
import "./workspace/Workspace.tsx";
import "./workspace/graph/CytoscapeGraph.tsx";
