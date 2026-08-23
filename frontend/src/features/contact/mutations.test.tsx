import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeContact } from "../../test/contactFixtures";
import { useCreateContact, useDeleteContact, useUpdateContact } from "./mutations";
import { contactKeys } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/contacts`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("contact/mutations — invalidación de cache", () => {
  it("create exitoso invalida contactKeys.lists()", async () => {
    server.use(http.post(baseUrl, () => HttpResponse.json(makeContact(), { status: 201 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateContact(), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ firstName: "Juana", lastName: "Pérez" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contactKeys.lists() });
  });

  it("update exitoso invalida contactKeys.lists() y contactKeys.detail(id)", async () => {
    server.use(http.patch(`${baseUrl}/:id`, () => HttpResponse.json(makeContact())));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateContact("ct1"), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ firstName: "Juana 2" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contactKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contactKeys.detail("ct1") });
  });

  it("delete exitoso invalida contactKeys.lists()", async () => {
    server.use(http.delete(`${baseUrl}/:id`, () => new HttpResponse(null, { status: 204 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteContact(), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate("ct1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contactKeys.lists() });
  });

  it("una mutation fallida (incluido 409 por email duplicado) no ejecuta ninguna invalidación", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json(
          { error: { message: "Ya existe un contacto con ese email en esta organización" } },
          { status: 409 },
        ),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateContact(), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ firstName: "Juana", lastName: "Pérez", email: "dup@example.com" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
