import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ForgotPasswordPage } from "./ForgotPasswordPage";

// ForgotPasswordPage no usa useAuth ni AuthProvider — solo llama a
// supabase.auth.resetPasswordForEmail directo, mismo criterio de
// desacoplamiento que el resto del proyecto (ver api.ts: "no conoce
// Supabase" para el caso inverso). Se mockea únicamente esa frontera.
const resetPasswordForEmail = vi.hoisted(() =>
  vi.fn<(email: string, options: { redirectTo: string }) => Promise<{ error: Error | null }>>(),
);

vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail,
    },
  },
}));

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<div>login-ok</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetPasswordForEmail.mockReset();
  resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe("ForgotPasswordPage — R1.3", () => {
  it("submit exitoso llama a resetPasswordForEmail con el email y un redirectTo a /reset-password", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.click(screen.getByRole("button", { name: /enviar link/i }));

    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledTimes(1));
    const [email, options] = resetPasswordForEmail.mock.calls[0] as [
      string,
      { redirectTo: string },
    ];
    expect(email).toBe("a@example.com");
    expect(options.redirectTo).toMatch(/\/reset-password$/);
  });

  it("tras un submit exitoso muestra el mismo mensaje neutro, sin confirmar si el email existe", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Email"), "cualquiera@example.com");
    await user.click(screen.getByRole("button", { name: /enviar link/i }));

    await waitFor(() =>
      expect(screen.getByText(/si existe una cuenta con ese email/i)).toBeInTheDocument(),
    );
  });

  it("un error real (ej. rate limit) se muestra y no pasa al mensaje de éxito", async () => {
    resetPasswordForEmail.mockResolvedValueOnce({
      error: new Error("Demasiados intentos. Probá de nuevo más tarde."),
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.click(screen.getByRole("button", { name: /enviar link/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Demasiados intentos. Probá de nuevo más tarde.",
      ),
    );
    expect(screen.queryByText(/revisá tu email/i)).not.toBeInTheDocument();
  });
});
