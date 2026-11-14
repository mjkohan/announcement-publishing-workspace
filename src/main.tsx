import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App, ErrorBoundary, ServiceProvider } from "./app";
import { createAnnouncementMock } from "./mocks";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error('Root element "#root" not found');
}

const service = createAnnouncementMock();

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <ServiceProvider service={service}>
        <App />
      </ServiceProvider>
    </ErrorBoundary>
  </StrictMode>,
);
