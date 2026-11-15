import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileDirectoryIcon, SearchIcon } from "@primer/octicons-react";

import { Button, Modal, SelectField, TextField } from "@renderer/components";
import { DOWNLOADER_NAME } from "@renderer/constants";
import {
  useAppSelector,
  useDownload,
  useLibrary,
  useToast,
} from "@renderer/hooks";
import {
  getDefaultDownloader,
  useDownloadOptions,
} from "@renderer/pages/game-details/modals/use-download-options";
import { Downloader, getDownloadersForUri } from "@shared";
import type { GameRepack } from "@types";

import "./manual-download-modal.scss";

export interface ManualDownloadModalProps {
  visible: boolean;
  initialTitle?: string;
  onClose: () => void;
}

export function ManualDownloadModal({
  visible,
  initialTitle = "",
  onClose,
}: Readonly<ManualDownloadModalProps>) {
  const { t } = useTranslation("catalogue");
  const navigate = useNavigate();
  const { startDownload } = useDownload();
  const { updateLibrary } = useLibrary();
  const { showErrorToast, showSuccessToast } = useToast();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const [title, setTitle] = useState(initialTitle);
  const [uri, setUri] = useState("");
  const [downloadPath, setDownloadPath] = useState("");
  const [selectedDownloader, setSelectedDownloader] =
    useState<Downloader | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const sourceName = useMemo(() => {
    const value = uri.trim();
    if (value.startsWith("magnet:")) return "Magnet link";
    try {
      return new URL(value).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }, [uri]);

  const repack = useMemo<GameRepack | null>(() => {
    if (!title.trim() || getDownloadersForUri(uri.trim()).length === 0) {
      return null;
    }
    return {
      id: "manual-link",
      title: title.trim(),
      fileSize: null,
      uris: [uri.trim()],
      unavailableUris: [],
      uploadDate: null,
      downloadSourceId: "manual-link",
      downloadSourceName: sourceName,
      createdAt: new Date().toISOString(),
    };
  }, [sourceName, title, uri]);

  const downloadOptions = useDownloadOptions(repack);
  const availableDownloaders = downloadOptions
    .filter((option) => option.isAvailable)
    .map((option) => option.downloader);

  useEffect(() => {
    if (!visible) return;
    setTitle(initialTitle);
    setUri("");
    setSelectedDownloader(null);
    if (userPreferences?.downloadsPath) {
      setDownloadPath(userPreferences.downloadsPath);
    } else {
      void window.electron.getDefaultDownloadsPath().then(setDownloadPath);
    }
  }, [initialTitle, userPreferences?.downloadsPath, visible]);

  useEffect(() => {
    if (!availableDownloaders.length) {
      setSelectedDownloader(null);
      return;
    }
    if (
      selectedDownloader === null ||
      !availableDownloaders.includes(selectedDownloader)
    ) {
      setSelectedDownloader(getDefaultDownloader(availableDownloaders));
    }
  }, [availableDownloaders, selectedDownloader]);

  const chooseDownloadFolder = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: downloadPath,
      properties: ["openDirectory"],
    });
    const [folder] = filePaths ?? [];
    if (folder) setDownloadPath(folder);
  };

  const searchInBrowser = () => {
    const query = title.trim();
    if (!query) return;
    void window.electron.openExternal(
      `https://www.google.com/search?q=${encodeURIComponent(query)}`
    );
  };

  const handleStart = async () => {
    if (!repack || selectedDownloader === null || !downloadPath) return;
    setIsStarting(true);
    try {
      const game = await window.electron.addCustomGameToLibrary(
        title.trim(),
        "",
        "",
        "",
        ""
      );
      const response = await startDownload({
        objectId: game.objectId,
        title: title.trim(),
        shop: "custom",
        downloader: selectedDownloader,
        downloadPath,
        uri: uri.trim(),
        automaticallyExtract: userPreferences?.extractFilesByDefault ?? true,
        automaticallyDeleteArchiveFiles:
          userPreferences?.deleteArchiveFilesAfterExtractionByDefault ?? true,
        repackTitle: title.trim(),
        downloadSourceName: sourceName,
      });
      if (!response.ok)
        throw new Error(response.error || t("manual_download_failed"));

      await updateLibrary();
      showSuccessToast(t("manual_download_started", { title: title.trim() }));
      onClose();
      navigate("/downloads");
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : t("manual_download_failed")
      );
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("manual_download_title")}
      description={t("manual_download_description")}
      onClose={onClose}
    >
      <div className="manual-download-modal">
        <TextField
          label={t("manual_download_game_name")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          theme="dark"
          disabled={isStarting}
        />
        <div className="manual-download-modal__search">
          <p>{t("manual_download_search_hint")}</p>
          <Button
            type="button"
            theme="outline"
            onClick={searchInBrowser}
            disabled={!title.trim() || isStarting}
          >
            <SearchIcon />
            {t("manual_download_search")}
          </Button>
        </div>
        <TextField
          label={t("manual_download_link")}
          value={uri}
          onChange={(event) => setUri(event.target.value)}
          placeholder="https://… or magnet:?xt=…"
          theme="dark"
          disabled={isStarting}
          hint={t("manual_download_supported_links")}
        />
        {availableDownloaders.length > 0 && (
          <SelectField
            label={t("manual_download_method")}
            theme="dark"
            value={String(selectedDownloader ?? "")}
            onChange={(event) =>
              setSelectedDownloader(Number(event.target.value) as Downloader)
            }
            options={availableDownloaders.map((downloader) => ({
              key: String(downloader),
              value: String(downloader),
              label: DOWNLOADER_NAME[downloader],
            }))}
          />
        )}
        {uri.trim() && !repack && (
          <p className="manual-download-modal__error" role="alert">
            {t("manual_download_unsupported")}
          </p>
        )}
        {repack && availableDownloaders.length === 0 && (
          <p className="manual-download-modal__error" role="alert">
            {t("manual_download_no_method")}
          </p>
        )}
        <div className="manual-download-modal__folder">
          <div>
            <strong>{t("manual_download_folder")}</strong>
            <span title={downloadPath}>
              {downloadPath || t("manual_download_loading")}
            </span>
          </div>
          <Button
            type="button"
            theme="outline"
            onClick={chooseDownloadFolder}
            disabled={isStarting}
          >
            <FileDirectoryIcon />
            {t("manual_download_browse")}
          </Button>
        </div>
        <div className="manual-download-modal__actions">
          <Button
            type="button"
            theme="outline"
            onClick={onClose}
            disabled={isStarting}
          >
            {t("cancel", { ns: "modal" })}
          </Button>
          <Button
            type="button"
            theme="primary"
            onClick={handleStart}
            disabled={
              !repack ||
              selectedDownloader === null ||
              !downloadPath ||
              isStarting
            }
          >
            {isStarting
              ? t("manual_download_starting")
              : t("manual_download_start")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
