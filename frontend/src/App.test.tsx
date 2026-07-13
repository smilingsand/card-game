import { render } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("does not introduce game UI before the rules are frozen", () => {
    const { container } = render(<App />);

    expect(container).toBeEmptyDOMElement();
  });
});
