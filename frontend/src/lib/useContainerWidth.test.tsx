import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { stubResizeObserver } from "../test/resizeObserverStub";
import { useContainerWidth } from "./useContainerWidth";

function Probe({ mounted = true }: { mounted?: boolean }) {
  const { ref, width } = useContainerWidth();
  return (
    <>
      <output>{width === null ? "sin medir" : String(width)}</output>
      {mounted ? <div ref={ref} /> : null}
    </>
  );
}

// El elemento medido aparece recién después del primer render, como el
// gráfico del Dashboard dentro de `isSuccess ? … : null`.
function LateProbe() {
  const [mounted, setMounted] = useState(false);
  return (
    <>
      <button onClick={() => setMounted(true)}>montar</button>
      <Probe mounted={mounted} />
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useContainerWidth", () => {
  it("null hasta que hay nodo; con nodo, el ancho que informa ResizeObserver, en píxeles enteros hacia abajo", () => {
    stubResizeObserver(640.7);
    render(<LateProbe />);
    expect(screen.getByRole("status")).toHaveTextContent("sin medir");

    screen.getByRole("button", { name: "montar" }).click();
    return vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("640"));
  });

  it("desconecta el observer al desmontar el nodo", () => {
    const instances = stubResizeObserver(600);
    const { rerender } = render(<Probe />);
    expect(instances).toHaveLength(1);
    expect(instances[0].observe).toHaveBeenCalledTimes(1);
    expect(instances[0].disconnect).not.toHaveBeenCalled();

    rerender(<Probe mounted={false} />);
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("sin ResizeObserver en el entorno: una sola medición con getBoundingClientRect", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 321.9 } as DOMRect);
    try {
      render(<Probe />);
      expect(screen.getByRole("status")).toHaveTextContent("321");
    } finally {
      spy.mockRestore();
    }
  });
});
