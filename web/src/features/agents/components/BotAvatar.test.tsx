import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BotAvatar from "./BotAvatar";

describe("BotAvatar", () => {
  it("uses the logo's Jeff for every agent", () => {
    const { container } = render(<BotAvatar bot={{ name: "Jeff", color: "#7FD4E8", avatar: "jeff-logo" }} size={40} />);
    expect(container.querySelector("img")).toHaveAttribute("src", `${import.meta.env.BASE_URL}jeffs/jeff-logo-eyeless.png?v=7`);
    expect(container.querySelector("[data-avatar-color]")).toHaveStyle({ backgroundColor: "#7FD4E8" });
  });

  it("renders independent eye layers and leaves the body still", () => {
    const { container } = render(<BotAvatar bot={{ name: "Jeff", color: "#7FD4E8", avatar: "jeff-logo" }} size={40} />);
    const eyes = container.querySelectorAll("[data-jeff-eyes]");
    expect(eyes).toHaveLength(1);
    expect(eyes[0]).toHaveAttribute("data-jeff-eyes", "jeff-logo");
    expect(eyes[0].querySelector("img")).toHaveAttribute("src", `${import.meta.env.BASE_URL}jeffs/jeff-logo-eyes.png?v=3`);
    expect(container.querySelector("img")?.parentElement).not.toHaveAttribute("style");
  });
});
