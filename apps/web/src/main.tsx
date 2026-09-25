import { AppError } from "@repo/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

class RootElementMissingError extends AppError {
  readonly code = "WEB_ROOT_ELEMENT_MISSING";

  constructor() {
    super('index.html has no element with id "root" to mount the app into.');
    this.name = "RootElementMissingError";
  }
}

const container = document.getElementById("root");
if (container === null) throw new RootElementMissingError();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
