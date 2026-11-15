import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ReleaseDownloadOption } from "@renderer/pages/game-details/modals/release-download-option";
import {
  getDownloadOptionInteraction,
  type DownloadOptionInteraction,
} from "../../src/shared/download-option-interaction";

const calls = { downloads: 0, browsers: 0 };
const runtime = window as unknown as {
  electron: { openSourceBrowser: () => Promise<null> };
  releasePickerTest: {
    configure: (
      mode: DownloadOptionInteraction,
      browsingEnabled: boolean
    ) => void;
    snapshot: () => typeof calls;
  };
};
runtime.electron = {
  openSourceBrowser: async () => {
    calls.browsers++;
    return null;
  },
};
const repack = {
  id: "fixture",
  title: "Fixture Release",
  fileSize: "1 GB",
  uris: [],
  unavailableUris: [],
  uploadDate: null,
  downloadSourceId: "fixture-source",
  downloadSourceName: "Fixture",
  createdAt: "",
};
function Fixture() {
  const [config, setConfig] = useState({
    mode: getDownloadOptionInteraction(),
    browsingEnabled: true,
  });
  runtime.releasePickerTest = {
    configure: (mode, browsingEnabled) => {
      calls.downloads = 0;
      calls.browsers = 0;
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
        {...config}
        request={{
          shop: "steam",
          objectId: "123",
          gameTitle: "Fixture Game",
          repack,
        }}
        onDownload={() => calls.downloads++}
        onReview={() => calls.downloads++}
      >
        <p>{repack.title}</p>
      </ReleaseDownloadOption>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
