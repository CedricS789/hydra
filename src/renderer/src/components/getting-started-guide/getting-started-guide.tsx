import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DownloadSource } from "@types";
import { Button, CheckboxField, Modal } from "@renderer/components";
import "./getting-started-guide.scss";

const RECOMMENDED_SOURCES = [
  { name: "SteamRip", url: "https://hydralinks.cloud/sources/steamrip.json" },
  { name: "FitGirl", url: "https://hydralinks.cloud/sources/fitgirl.json" },
  { name: "DODI", url: "https://hydralinks.cloud/sources/dodi.json" },
];

const SOURCE_ORDER = ["SteamRip", "FitGirl", "DODI"];

export function GettingStartedGuide({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>(
    RECOMMENDED_SOURCES.map((source) => source.url)
  );
  const [existingSources, setExistingSources] = useState<DownloadSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!visible) return;
    setStep(0);
    setMessage("");
    void window.electron
      .getDownloadSources()
      .then(setExistingSources)
      .catch((error) =>
        setMessage(`Could not check existing catalogs: ${String(error)}`)
      );
  }, [visible]);

  const finish = async () => {
    setBusy(true);
    try {
      await window.electron.updateUserPreferences({
        firstRunGuideCompleted: true,
      });
      onClose();
    } catch (error) {
      setMessage(`Could not save setup completion: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const addSelectedSources = async () => {
    setBusy(true);
    setMessage("");
    try {
      const existingUrls = new Set(existingSources.map((source) => source.url));
      const missing = RECOMMENDED_SOURCES.filter(
        (source) =>
          selected.includes(source.url) && !existingUrls.has(source.url)
      );
      const added: string[] = [];
      const failed: string[] = [];
      for (const source of missing) {
        try {
          await window.electron.addDownloadSource(source.url);
          added.push(source.name);
        } catch {
          failed.push(source.name);
        }
      }
      const current = await window.electron.getDownloadSources();
      setExistingSources(current);
      if (added.length) {
        await window.electron.syncDownloadSources();
        const synced = `${added.join(", ")} added and synced.`;
        setMessage(
          failed.length
            ? `${synced} Could not add: ${failed.join(", ")}.`
            : synced
        );
      } else if (failed.length) {
        setMessage(`Could not add: ${failed.join(", ")}.`);
      } else {
        setMessage("Your selected catalogs are already installed.");
      }
    } catch (error) {
      setMessage(`Catalog setup stopped: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    {
      title: "Welcome to Hydra Ludusavi",
      body: "This short guide helps you set up game catalogs, understand save backups, and find the settings you may want first. You can skip it now and reopen it later from Settings.",
    },
    {
      title: "Add and launch your games",
      body: "Use Catalogue to add a game to My Games, or scan for games already installed on your PC. Launch games from Hydra as usual so Hydra can track playtime and achievements. Save backups are triggered after the actual game process exits.",
    },
    {
      title: "Choose game catalogs",
      body: "Catalogs add game release listings to Hydra’s download options. They do not install games by themselves. These three recommended feeds can be added now, or you can continue without them.",
    },
    {
      title: "Protect your game saves",
      body: "Automatic save backups are enabled by default. After a game exits, Hydra uses bundled Ludusavi to create a local versioned backup. This never restores or overwrites live saves automatically. Review the destination in Settings → Save backups; a sync client such as OneDrive must finish uploading separately.",
    },
    {
      title: "Your download controls",
      body: "Hydra’s native download-options flow stays the default. Direct peer-to-peer torrent access is blocked unless you explicitly unlock it in Advanced settings. Debrid services are optional. You can change website search order and other protected options in Settings → Advanced.",
    },
  ];
  const isLast = step === steps.length - 1;

  return (
    <Modal
      visible={visible}
      title="Getting started"
      description="A quick tour of your first setup choices"
      onClose={() => void finish()}
      clickOutsideToClose={false}
      className="getting-started-guide__modal"
    >
      <div className="getting-started-guide">
        <div className="getting-started-guide__progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((item, index) => (
            <span key={item.title} className={index <= step ? "is-active" : ""} />
          ))}
        </div>
        <h2>{steps[step].title}</h2>
        <p>{steps[step].body}</p>

        {step === 2 && (
          <div className="getting-started-guide__sources">
            {[...RECOMMENDED_SOURCES].sort(
              (a, b) => SOURCE_ORDER.indexOf(a.name) - SOURCE_ORDER.indexOf(b.name)
            ).map((source) => {
              const installed = existingSources.some((item) => item.url === source.url);
              return (
                <CheckboxField
                  key={source.url}
                  label={`${source.name}${installed ? " · already added" : ""}`}
                  checked={selected.includes(source.url)}
                  disabled={busy || installed}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(source.url)
                        ? current.filter((url) => url !== source.url)
                        : [...current, source.url]
                    )
                  }
                />
              );
            })}
          <Button
            disabled={busy || selected.length === 0}
            onClick={() => void addSelectedSources()}
          >
              {busy ? "Adding catalogs…" : "Add selected catalogs"}
            </Button>
          </div>
        )}
        {step === 3 && (
          <Button
            theme="outline"
            onClick={() => {
              navigate("/settings");
              void finish();
            }}
          >
            Go to Settings
          </Button>
        )}
        {step === 4 && (
          <Button
            theme="outline"
            onClick={() => {
              navigate("/settings");
              void finish();
            }}
          >
            Go to Settings
          </Button>
        )}
        {message && <p className="getting-started-guide__message" role="status">{message}</p>}

        <div className="getting-started-guide__actions">
          <Button theme="outline" disabled={busy} onClick={() => void finish()}>
            Skip guide
          </Button>
          <div>
            {step > 0 && (
              <Button theme="outline" disabled={busy} onClick={() => setStep((value) => value - 1)}>
                Back
              </Button>
            )}
            <Button
              theme="primary"
              disabled={busy}
              onClick={() => (isLast ? void finish() : setStep((value) => value + 1))}
            >
              {isLast ? "Finish setup" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
