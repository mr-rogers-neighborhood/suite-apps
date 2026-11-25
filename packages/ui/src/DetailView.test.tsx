import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DetailView } from "./DetailView.js";

describe("DetailView", () => {
  it("names the pane with its title and renders it as a level-two heading", () => {
    render(<DetailView title="Everyday checking">Body</DetailView>);
    expect(screen.getByRole("region", { name: "Everyday checking" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Everyday checking" }),
    ).toBeInTheDocument();
  });

  it("renders a subtitle under the title", () => {
    render(
      <DetailView title="Everyday checking" subtitle="Bank account · updated today">
        Body
      </DetailView>,
    );
    expect(screen.getByText("Bank account · updated today")).toBeInTheDocument();
  });

  it("takes header actions and a footer as nodes", () => {
    render(
      <DetailView
        title="Everyday checking"
        actions={<button type="button">Edit</button>}
        footer={<button type="button">Save</button>}
      >
        Body
      </DetailView>,
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("renders the body content", () => {
    render(
      <DetailView title="Everyday checking">
        <p>Balance and transactions</p>
      </DetailView>,
    );
    expect(screen.getByText("Balance and transactions")).toBeInTheDocument();
  });

  it("omits the footer when it is not given", () => {
    const { container } = render(<DetailView title="Everyday checking">Body</DetailView>);
    expect(container.querySelector("footer")).toBeNull();
    expect(container.firstElementChild).not.toHaveAttribute("data-has-footer");
  });

  it("marks the pane when it has a footer", () => {
    const { container } = render(
      <DetailView title="Everyday checking" footer={<span>Actions</span>}>
        Body
      </DetailView>,
    );
    expect(container.firstElementChild).toHaveAttribute("data-has-footer", "true");
  });

  it("keeps a caller's class alongside its own", () => {
    const { container } = render(
      <DetailView title="Everyday checking" className="h-[28rem]">
        Body
      </DetailView>,
    );
    expect(container.firstElementChild?.className).toContain("h-[28rem]");
  });
});
