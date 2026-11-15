import assert from "node:assert/strict";
import test from "node:test";
import { getDownloadOptionInteraction } from "./download-option-interaction.js";

test("native interaction is the default for new and existing preferences", () => {
  assert.equal(getDownloadOptionInteraction(), "native");
  assert.equal(getDownloadOptionInteraction(null), "native");
  assert.equal(getDownloadOptionInteraction({}), "native");
  assert.equal(
    getDownloadOptionInteraction({
      downloadOptionInteraction: "unknown" as never,
    }),
    "native"
  );
});
test("explicit menu and website-only choices are preserved", () => {
  for (const mode of ["native", "menu", "website-only"] as const)
    assert.equal(
      getDownloadOptionInteraction({ downloadOptionInteraction: mode }),
      mode
    );
});
