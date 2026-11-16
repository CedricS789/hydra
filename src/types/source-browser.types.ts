import type { GameRepack, GameShop } from "./index";

export interface SourceWebsiteProfile {
  name?: string;
  website: string;
  searchUrl: string;
  approvedDomains?: string[];
}

export interface BlockedSourceNavigation {
  hostname: string | null;
  reason:
    | "unapproved-domain"
    | "profile-required"
    | "incompatible-address"
    | "different-game";
  message: string;
}

export interface SourceBrowserRequest {
  readOnly?: boolean;
  /** Website profile identity, independent from the Hydra feed identity. */
  websiteProfileId?: string;
  shop: GameShop;
  objectId: string;
  gameTitle: string;
  repack: GameRepack;
}

export interface SourceBrowserState {
  readOnly: boolean;
  title: string;
  releaseTitle: string;
  sourceName: string;
  url: string;
  pageUrl: string;
  lookup: "exact" | "search" | "setup";
  loading: boolean;
  error: string;
  links: string[];
  profile: SourceWebsiteProfile | null;
  blockedNavigation: BlockedSourceNavigation | null;
}

export type SourceBrowserCommand =
  | { action: "navigate" | "add"; url: string }
  | { action: "back" | "forward" | "reload" | "external" | "close" }
  | { action: "remove" | "up" | "down"; index: number }
  | {
      action: "review";
      mode: "single" | "mirrors" | "parts";
      mirrorIndex?: number;
      releaseTitle: string;
      acknowledged: boolean;
    };

export interface SourceBrowserApi {
  state(): Promise<SourceBrowserState>;
  command(command: SourceBrowserCommand): Promise<void>;
  onState(listener: (state: SourceBrowserState) => void): () => void;
}
