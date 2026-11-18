export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  route?: string;
  selector?: string;
  hint?: string;
}

export interface TutorialTour {
  id: string;
  title: string;
  summary: string;
  steps: TutorialStep[];
}

export const TUTORIAL_STORAGE_KEY = "hydra:completed-tutorials";

export const TUTORIAL_TOURS: TutorialTour[] = [
  {
    id: "app-overview",
    title: "App & Navigation Tour",
    summary:
      "Walk through Hydra Ludusavi's main sidebar, global search, downloads queue, and settings.",
    steps: [
      {
        id: "overview-sidebar",
        title: "Main navigation rail",
        route: "/",
        selector: ".sidebar__menu",
        description:
          "Switch between Home, Catalogue, your Library, active Downloads, and Settings from here. Your installed and saved games appear right below.",
      },
      {
        id: "overview-search",
        title: "Global game search",
        route: "/",
        selector: ".title-bar__search",
        description:
          "Search for any game at any time from the top bar—whether it is already in your library or in the catalogue.",
      },
      {
        id: "overview-downloads",
        title: "Downloads & source links",
        route: "/downloads",
        selector: ".downloads__container, .downloads__no-downloads",
        description:
          "Monitor active downloads, pause or resume queued items, check automatic archive extraction, and reopen the originating page for website downloads.",
      },
      {
        id: "overview-settings",
        title: "Settings & explicit saves",
        route: "/settings?tab=general",
        selector: ".settings__sidebar",
        description:
          "All configuration lives here. Sensitive settings stay protected behind an explicit Save review so nothing important changes accidentally.",
      },
    ],
  },
  {
    id: "downloading-games",
    title: "Finding & Downloading Games",
    summary:
      "Learn how to use catalog feeds, the Search on section, and Open in browser + paste link.",
    steps: [
      {
        id: "dl-catalogue-filters",
        title: "Filter the Catalogue",
        route: "/catalogue",
        selector: ".catalogue__filters-container",
        description:
          "Narrow down games by download source, genre, release year, or compatibility before picking a title.",
      },
      {
        id: "dl-catalogue-grid",
        title: "Open a game & click Download",
        route: "/catalogue",
        selector: ".catalogue__games-container",
        description:
          "Click any game card to open its details page, then press Download to open Download options.",
      },
      {
        id: "dl-feeds",
        title: "Hydra catalog feeds",
        route: "/settings?tab=download_sources",
        selector: ".settings__panel-body",
        description:
          "Your installed catalog feeds (such as SteamRIP, FitGirl, and DODI) automatically list matching releases under Hydra feeds in Download options.",
      },
      {
        id: "dl-search-on",
        title: "No feed result? Use “Search on”",
        description:
          "At the top of Download options, the Search on card lets you browse SteamRIP, FitGirl, or DODI directly. In the browser sidebar, enter the mandatory Selected release title * at the top and right-click links to open or collect them.",
        hint: "Fuzzy address matching lets you shorten searches (like searching “Sekiro” for “Sekiro™: Shadows Die Twice - GOTY Edition”).",
      },
      {
        id: "dl-open-external",
        title: "Use Open in browser + paste link when needed",
        description:
          "If a site uses ad-heavy link protectors or captchas, click Open in browser inside that window to solve it in your regular browser, then copy the final Gofile, Pixeldrain, or magnet link and paste it back into Hydra's sidebar.",
      },
    ],
  },
  {
    id: "save-backups",
    title: "Automatic Save Backups",
    summary:
      "See how bundled Ludusavi discovers existing saves, backs up on game exit, and restores safely.",
    steps: [
      {
        id: "saves-overview",
        title: "Save backups status",
        route: "/settings?tab=local_backups",
        selector: ".local-edition__card",
        description:
          "Automatic save backups run in the background when a tracked game closes. Hydra creates local versioned backups and never overwrites live saves automatically.",
      },
      {
        id: "saves-manage",
        title: "Discover saves, preview, and restore",
        route: "/settings?tab=local_backups",
        selector: ".local-edition__main-view",
        description:
          "Use Discover saved games to scan your PC or an existing backup folder, preview detected save files, trigger Back up now, or restore any past version with a pre-restore safety snapshot.",
      },
      {
        id: "saves-advanced",
        title: "Backup folder & retention",
        route: "/settings?tab=local_backups",
        selector: ".local-edition__advanced-entry",
        description:
          "Open advanced backup settings (or Settings → Advanced) to pick a destination such as OneDrive, a second drive, or NAS, and choose how many full/differential versions to keep.",
      },
      {
        id: "saves-exe",
        title: "Link your game executable",
        route: "/library",
        selector: ".sidebar__menu",
        description:
          "On any game's page, set its real .exe in Options and launch from Hydra so save backups trigger automatically right after the game exits.",
      },
    ],
  },
  {
    id: "safety-controls",
    title: "Safety, Debrid & Approved Domains",
    summary:
      "Understand direct torrent protection, Debrid integrations, and approved browsing domains.",
    steps: [
      {
        id: "safety-debrid",
        title: "Optional Debrid providers",
        route: "/settings?tab=integrations",
        selector: ".settings__panel-body",
        description:
          "Connect supported Debrid services here for cached downloads. Supported HTTP hosters (like Gofile and Pixeldrain) also work without a Debrid account.",
      },
      {
        id: "safety-gate",
        title: "Protected Advanced gate",
        route: "/settings?tab=advanced",
        selector:
          ".settings-context-advanced__gate, .settings-context-advanced__toolbar",
        description:
          "High-impact controls stay locked behind an acknowledgement so direct torrent rules, bulk library maintenance, and website permissions cannot change silently.",
      },
      {
        id: "safety-policies",
        title: "Direct torrents & website domain allowlists",
        route: "/settings?tab=advanced",
        selector: ".settings__panel-body",
        description:
          "Direct peer-to-peer torrents stay blocked by default unless explicitly unlocked. Inside Features → Source website profiles and cookies, you can reorder Search on buttons or approve extra container hostnames such as www.filecrypt.cc.",
      },
    ],
  },
];
