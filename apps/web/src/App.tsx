import { PRODUCT_NAME } from "@repo/config";
import { HealthStatus } from "./HealthStatus.tsx";

export function App() {
  return (
    <main>
      <h1>{PRODUCT_NAME}</h1>
      <HealthStatus />
    </main>
  );
}
