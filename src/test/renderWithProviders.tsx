import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import type { PublicationContextValue } from "../app/context";
import { ServiceProvider } from "../app/ServiceProvider";
import { createAnnouncementMock, type IAnnouncementService } from "../mocks";
import type { PublicationStoreApi } from "../store";
import { ContextProbe } from "./ContextProbe";

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  /** Defaults to a fresh `createAnnouncementMock()`. */
  service?: IAnnouncementService;
  /** Journal storage. Defaults to `sessionStorage`. */
  storage?: Storage;
}

export interface RenderWithProvidersResult extends RenderResult {
  service: IAnnouncementService;
  /** The store created by the provider, for inspecting state and calling actions. */
  store: PublicationStoreApi;
}

/** Renders `ui` inside a `ServiceProvider` with an injectable service and storage. */
export function renderWithProviders(
  ui: ReactElement,
  {
    service = createAnnouncementMock(),
    storage = sessionStorage,
    ...options
  }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  let captured: PublicationContextValue | undefined;
  const capture = (value: PublicationContextValue) => {
    captured = value;
  };

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServiceProvider service={service} storage={storage}>
        <ContextProbe onValue={capture} />
        {children}
      </ServiceProvider>
    );
  }

  const result = render(ui, { ...options, wrapper: Wrapper });
  if (!captured) throw new Error("ServiceProvider did not provide a context value");
  return { ...result, service, store: captured.store };
}
