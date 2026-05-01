import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/testUtils";
import { HelpPage } from "./HelpPage";

describe("HelpPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a wiki-style help system with linked glossary and impact guidance", async () => {
    renderWithProviders(<HelpPage />);

    expect(await screen.findByRole("heading", { name: "Manager Wiki" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search wiki" })).toHaveAttribute(
      "placeholder",
      "Search pages, settings, flags, workflows, or glossary terms...",
    );
    expect(screen.getByRole("heading", { name: "Page Guides" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings Impact Matrix" })).toBeInTheDocument();
    expect(screen.getAllByText(/Increase ctx-size/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/longer prompts and documents/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Glossary" })).toBeInTheDocument();

    const ggufLink = screen.getAllByRole("link", { name: "GGUF" })[0];
    expect(ggufLink).toHaveAttribute("href", "#article-files-companions");

    const ctxGlossary = screen.getByTestId("glossary-ctx-size");
    expect(within(ctxGlossary).getByRole("link", { name: "Read article" })).toHaveAttribute(
      "href",
      "#article-context-kv-cache",
    );
  });

  it("filters wiki articles, impact rows, and glossary terms together", async () => {
    renderWithProviders(<HelpPage />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search wiki" }), { target: { value: "tensor split" } });

    const results = screen.getByTestId("help-results");
    expect(within(results).getByRole("heading", { name: "GPU Placement" })).toBeInTheDocument();
    expect(within(results).getAllByText(/tensor split/i).length).toBeGreaterThan(0);
    expect(within(results).queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(within(results).queryByRole("heading", { name: "Hugging Face Token" })).not.toBeInTheDocument();
  });
});
