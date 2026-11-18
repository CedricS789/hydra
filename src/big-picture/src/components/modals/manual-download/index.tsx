import { DOWNLOADER_NAME } from "@renderer/constants";
import { Downloader, getDownloadersForUri } from "@shared";
import type { GameRepack } from "@types";
import { FileDirectoryIcon, SearchIcon } from "@primer/octicons-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { getDownloaderAvailabilityOptions } from "../../../helpers";
import { readActiveLibraryDownload } from "../download-game/download-queue";
import {
  useBigPictureToast,
  useFeature,
  useLibrary,
  useUserDetails,
  useUserPreferences,
} from "../../../hooks";
import {
  Button,
  DropdownSelect,
  HorizontalFocusGroup,
  Input,
  Modal,
  VerticalFocusGroup,
} from "../../common";
import "./styles.scss";

export interface BigPictureManualDownloadModalProps {
  visible: boolean;
  initialTitle?: string;
  onClose: () => void;
}

const MANUAL_DOWNLOAD_TITLE_ID = "bp-manual-download-title";
const MANUAL_DOWNLOAD_SEARCH_ID = "bp-manual-download-search";
const MANUAL_DOWNLOAD_URI_ID = "bp-manual-download-uri";
const MANUAL_DOWNLOAD_METHOD_ID = "bp-manual-download-method";
const MANUAL_DOWNLOAD_FOLDER_ID = "bp-manual-download-folder";
const MANUAL_DOWNLOAD_CANCEL_ID = "bp-manual-download-cancel";
const MANUAL_DOWNLOAD_SUBMIT_ID = "bp-manual-download-submit";

function getPreferredDownloader(downloaders: Downloader[]): Downloader | null {
  if (!downloaders.length) return null;
  for (const preferred of [
    Downloader.RealDebrid,
    Downloader.Premiumize,
    Downloader.AllDebrid,
    Downloader.TorBox,
  ]) {
    if (downloaders.includes(preferred)) return preferred;
  }
  return downloaders[0];
}

export function ManualDownloadModal({
  visible,
  initialTitle = "",
  onClose,
}: Readonly<BigPictureManualDownloadModalProps>) {
  const { t } = useTranslation("catalogue");
  const navigate = useNavigate();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const { updateLibrary } = useLibrary();
  const { features } = useFeature();
  const userPreferences = useUserPreferences();
  const { hasActiveSubscription } = useUserDetails();

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

  const availableDownloaders = useMemo(() => {
    if (!repack) return [];
    return getDownloaderAvailabilityOptions(
      repack,
      userPreferences,
      features,
      hasActiveSubscription
    )
      .filter((item) => item.isAvailable)
      .map((item) => item.downloader);
  }, [features, hasActiveSubscription, repack, userPreferences]);

  useEffect(() => {
    if (!visible) return;
    setTitle(initialTitle);
    setUri("");
    setSelectedDownloader(null);
    if (userPreferences?.downloadsPath) {
      setDownloadPath(userPreferences.downloadsPath);
    } else {
      void globalThis.window.electron
        .getDefaultDownloadsPath()
        .then(setDownloadPath);
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
      setSelectedDownloader(getPreferredDownloader(availableDownloaders));
    }
  }, [availableDownloaders, selectedDownloader]);

  const chooseDownloadFolder = async () => {
    const { filePaths } = await globalThis.window.electron.showOpenDialog({
      defaultPath: downloadPath,
      properties: ["openDirectory"],
    });
    const [folder] = filePaths ?? [];
    if (folder) setDownloadPath(folder);
  };

  const searchInBrowser = () => {
    const query = title.trim();
    if (!query) return;
    void globalThis.window.electron.openExternal(
      `https://www.google.com/search?q=${encodeURIComponent(query)}`
    );
  };

  const handleStart = async () => {
    if (!repack || selectedDownloader === null || !downloadPath) return;
    setIsStarting(true);
    try {
      const game = await globalThis.window.electron.addCustomGameToLibrary(
        title.trim(),
        "",
        "",
        "",
        ""
      );
      const payload = {
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
      } as const;
      const shouldQueue = await readActiveLibraryDownload(
        globalThis.window.electron.getLibrary
      );
      const response = shouldQueue
        ? await globalThis.window.electron.addGameToQueue(payload)
        : await globalThis.window.electron.startGameDownload(payload);
      if (!response.ok) {
        throw new Error(response.error || t("manual_download_failed"));
      }
      await updateLibrary();
      showSuccessToast(t("manual_download_started", { title: title.trim() }), {
        fallbackVisual: "downloads",
      });
      onClose();
      navigate("/big-picture/downloads");
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : t("manual_download_failed"),
        { fallbackVisual: "downloads" }
      );
    } finally {
      setIsStarting(false);
    }
  };

  const downloaderOptions = useMemo(
    () =>
      availableDownloaders.map((downloader) => ({
        value: String(downloader),
        label: DOWNLOADER_NAME[downloader],
      })),
    [availableDownloaders]
  );

  return (
    <Modal
      visible={visible}
      title={t("manual_download_title")}
      description={t("manual_download_description")}
      onClose={onClose}
      initialFocusId={MANUAL_DOWNLOAD_TITLE_ID}
      className="bp-manual-download-modal"
      backdropClassName="bp-manual-download-modal-backdrop"
    >
      <VerticalFocusGroup
        regionId="bp-manual-download-content"
        className="bp-manual-download-modal__content"
      >
        <Input
          focusId={MANUAL_DOWNLOAD_TITLE_ID}
          label={t("manual_download_game_name")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={isStarting}
        />

        <div className="bp-manual-download-modal__search-row">
          <p className="bp-manual-download-modal__hint">
            {t("manual_download_search_hint")}
          </p>
          <Button
            focusId={MANUAL_DOWNLOAD_SEARCH_ID}
            variant="secondary"
            icon={<SearchIcon size={16} />}
            disabled={!title.trim() || isStarting}
            onClick={searchInBrowser}
          >
            {t("manual_download_search")}
          </Button>
        </div>

        <Input
          focusId={MANUAL_DOWNLOAD_URI_ID}
          label={t("manual_download_link")}
          value={uri}
          onChange={(event) => setUri(event.target.value)}
          placeholder="https://… or magnet:?xt=…"
          hint={t("manual_download_supported_links")}
          disabled={isStarting}
        />

        {availableDownloaders.length > 0 && (
          <DropdownSelect
            focusId={MANUAL_DOWNLOAD_METHOD_ID}
            label={t("manual_download_method")}
            value={String(selectedDownloader ?? "")}
            options={downloaderOptions}
            onValueChange={(nextValue) =>
              setSelectedDownloader(Number(nextValue) as Downloader)
            }
          />
        )}

        {uri.trim() && !repack && (
          <p className="bp-manual-download-modal__error" role="alert">
            {t("manual_download_unsupported")}
          </p>
        )}

        {repack && availableDownloaders.length === 0 && (
          <p className="bp-manual-download-modal__error" role="alert">
            {t("manual_download_no_method")}
          </p>
        )}

        <div className="bp-manual-download-modal__folder-row">
          <div className="bp-manual-download-modal__folder-copy">
            <strong>{t("manual_download_folder")}</strong>
            <span title={downloadPath}>
              {downloadPath || t("manual_download_loading")}
            </span>
          </div>
          <Button
            focusId={MANUAL_DOWNLOAD_FOLDER_ID}
            variant="secondary"
            icon={<FileDirectoryIcon size={16} />}
            disabled={isStarting}
            onClick={() => void chooseDownloadFolder()}
          >
            {t("manual_download_browse")}
          </Button>
        </div>

        <HorizontalFocusGroup
          regionId="bp-manual-download-actions"
          className="bp-manual-download-modal__actions"
        >
          <Button
            focusId={MANUAL_DOWNLOAD_CANCEL_ID}
            variant="secondary"
            disabled={isStarting}
            onClick={onClose}
          >
            {t("cancel", { ns: "modal" })}
          </Button>
          <Button
            focusId={MANUAL_DOWNLOAD_SUBMIT_ID}
            variant="primary"
            disabled={
              !repack ||
              selectedDownloader === null ||
              !downloadPath ||
              isStarting
            }
            loading={isStarting}
            onClick={() => void handleStart()}
          >
            {isStarting
              ? t("manual_download_starting")
              : t("manual_download_start")}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}
