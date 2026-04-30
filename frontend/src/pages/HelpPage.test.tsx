import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/testUtils";
import { HelpPage } from "./HelpPage";

describe("HelpPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders detailed settings guidance and filters help topics", async () => {
    renderWithProviders(<HelpPage />);

    expect(await screen.findByRole("heading", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getAllByText(/ctx-size/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/larger context windows consume more KV cache/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search help" }), { target: { value: "tensor split" } });

    const results = screen.getByTestId("help-results");
    expect(within(results).getAllByText(/tensor split/i).length).toBeGreaterThan(0);
    expect(within(results).queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
  });
});
