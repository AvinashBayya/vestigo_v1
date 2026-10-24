import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";
import { AppError } from "@repo/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createAppRouter, preloadFirstPage } from "./router.tsx";
import { applyTheme, initialTheme } from "./theme.ts";

// Before the first paint, so a dark-theme viewer never sees a light flash.
applyTheme(initialTheme());

class RootElementMissingError extends AppError {
  readonly code = "WEB_ROOT_ELEMENT_MISSING";

  constructor() {
    super('index.html has no element with id "root" to mount the app into.');
    this.name = "RootElementMissingError";
  }
}

const container = document.getElementById("root");
if (container === null) throw new RootElementMissingError();

// Failures are shown, not silently retried: a retry hides the reason.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const router = createAppRouter(queryClient);
preloadFirstPage(router);

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
