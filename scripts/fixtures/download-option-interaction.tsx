import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ReleaseDownloadOption } from "@renderer/pages/game-details/modals/release-download-option";
import {
  getDownloadOptionInteraction,
  type DownloadOptionInteraction,
} from "../../src/shared/download-option-interaction";

const calls = { downloads: 0 };
const runtime = window as unknown as {
  releasePickerTest: {
    configure: (
      mode: DownloadOptionInteraction,
      browsingEnabled: boolean
    ) => void;
    snapshot: () => typeof calls;
  };
};
function Fixture() {
  const [config, setConfig] = useState({
    mode: getDownloadOptionInteraction(),
    browsingEnabled: true,
  });
  runtime.releasePickerTest = {
    configure: (mode, browsingEnabled) => {
      calls.downloads = 0;
      setConfig({ mode, browsingEnabled });
    },
    snapshot: () => ({ ...calls }),
  };
  return (
    <main
      data-mode={config.mode}
      data-browsing={String(config.browsingEnabled)}
    >
      <ReleaseDownloadOption
        mode={config.mode}
        onDownload={() => calls.downloads++}
      >
        <p>Fixture Release</p>
      </ReleaseDownloadOption>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
