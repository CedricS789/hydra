import { useSettingsOperationGuard } from "@renderer/context/settings/settings-draft.context";
import {
  useSettingsDraft,
  useSettingsFormGuard,
} from "@renderer/context/settings/settings-draft.context";
import "./integration-provider-section.scss";

import type { UserPreferences } from "@types";
import { FloppyDiskIcon } from "@phosphor-icons/react";
import { EyeClosedIcon, EyeIcon } from "@phosphor-icons/react/dist/ssr";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button, Checkbox, Input, VerticalFocusGroup } from "../../components";
import { useBigPictureToast, useUserPreferences } from "../../hooks";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import {
  getIntegrationProviderCheckboxFocusId,
  getIntegrationProviderInputFocusId,
  getIntegrationProviderRegionId,
  getIntegrationProviderSaveButtonFocusId,
  type IntegrationProviderId,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

type IntegrationPreferenceKey = Extract<
  keyof UserPreferences,
  | "realDebridApiToken"
  | "premiumizeApiToken"
  | "allDebridApiToken"
  | "torBoxApiToken"
>;

type IntegrationStatus =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; identity: string | null; token: string | null };

interface IntegrationForm {
  enabled: boolean;
  token: string | null;
}

export interface IntegrationProviderConfig<TUser> {
  id: IntegrationProviderId;
  title: string;
  description: string;
  checkboxLabel: string;
  tokenPreferenceKey: IntegrationPreferenceKey;
  tokenUrl: string;
  authenticate: (apiToken: string) => Promise<TUser>;
  getSuccessIdentity: (user: TUser) => string | null;
  getSuccessToastMessage?: (user: TUser) => string | null;
  getValidationErrorMessage?: (user: TUser) => string | null;
  upTarget: FocusOverrideTarget;
  downTarget: FocusOverrideTarget;
}

function getSuccessMessage(title: string, identity: string | null) {
  if (!identity) {
    return `${title} is connected.`;
  }

  return `${title} is connected as ${identity}.`;
}

const SETTINGS_TOAST_OPTIONS = {
  fallbackVisual: "settings" as const,
};

export function IntegrationProviderSection<TUser>({
  id,
  title,
  description,
  checkboxLabel,
  tokenPreferenceKey,
  tokenUrl,
  authenticate,
  getSuccessIdentity,
  getSuccessToastMessage,
  getValidationErrorMessage,
  upTarget,
  downTarget,
}: Readonly<IntegrationProviderConfig<TUser>>) {
  const userPreferences = useUserPreferences();
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [form, setForm] = useState<IntegrationForm>({
    enabled: false,
    token: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  useSettingsOperationGuard(`provider-${id}`, isLoading);
  const [isTokenVisible, setIsTokenVisible] = useState(false);
  const [status, setStatus] = useState<IntegrationStatus>({ kind: "idle" });

  const draft = useSettingsDraft();
  const savedToken = userPreferences?.[tokenPreferenceKey] ?? null;
  const dirty =
    form.enabled !== Boolean(savedToken) ||
    (form.enabled && form.token !== savedToken);
  useSettingsFormGuard(`provider-${id}`, dirty, `${title} connection`);

  const checkboxFocusId = getIntegrationProviderCheckboxFocusId(id);
  const inputFocusId = getIntegrationProviderInputFocusId(id);
  const saveButtonFocusId = getIntegrationProviderSaveButtonFocusId(id);

  useEffect(() => {
    setForm({
      enabled: Boolean(savedToken),
      token: savedToken,
    });

    setStatus((currentStatus) => {
      if (!savedToken) {
        return { kind: "idle" };
      }

      if (
        currentStatus.kind === "success" &&
        currentStatus.token === savedToken
      ) {
        return currentStatus;
      }

      return {
        kind: "success",
        identity: null,
        token: savedToken,
      };
    });
  }, [savedToken]);

  const persistPreference = async (token: string | null) => {
    await (draft?.commit ?? globalThis.window.electron.updateUserPreferences)({
      [tokenPreferenceKey]: token,
    });
  };

  const handleToggle = (enabled: boolean) => {
    setForm((currentForm) => ({
      ...currentForm,
      enabled,
    }));
    setStatus({ kind: "idle" });
  };

  const handleTokenChange = (token: string) => {
    setForm((currentForm) => ({
      ...currentForm,
      token,
    }));

    if (status.kind !== "idle") {
      setStatus({ kind: "idle" });
    }
  };

  const isProviderEnabled = form.enabled;
  const isTokenInputDisabled = !isProviderEnabled || isLoading;
  const isSaveButtonDisabled =
    !dirty || (isProviderEnabled && !form.token?.trim());

  const checkboxNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      up: upTarget,
      down: isProviderEnabled
        ? {
            type: "item",
            itemId: inputFocusId,
          }
        : dirty
          ? { type: "item", itemId: saveButtonFocusId }
          : downTarget,
    }),
    [
      downTarget,
      inputFocusId,
      isProviderEnabled,
      upTarget,
      dirty,
      saveButtonFocusId,
    ]
  );

  const inputNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: checkboxFocusId,
      },
      right: {
        type: "item",
        itemId: saveButtonFocusId,
      },
      down: downTarget,
    }),
    [checkboxFocusId, downTarget, saveButtonFocusId]
  );

  const saveButtonNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: checkboxFocusId,
      },
      left: {
        type: "item",
        itemId: inputFocusId,
      },
      down: downTarget,
    }),
    [checkboxFocusId, downTarget, inputFocusId]
  );

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();

    if (form.enabled && !form.token?.trim()) {
      return;
    }

    setIsLoading(true);

    try {
      if (!form.enabled) {
        await persistPreference(null);
        setStatus({ kind: "idle" });
        showSuccessToast("Provider disconnected", SETTINGS_TOAST_OPTIONS);
        return;
      }
      const user = await authenticate(form.token!.trim());
      const validationMessage = getValidationErrorMessage?.(user) ?? null;

      if (validationMessage) {
        setStatus({
          kind: "error",
          message: validationMessage,
        });
        showErrorToast("Invalid API token", {
          ...SETTINGS_TOAST_OPTIONS,
          message: validationMessage,
        });
        return;
      }

      await persistPreference(form.token!.trim());
      const identity = getSuccessIdentity(user);
      setStatus({
        kind: "success",
        identity,
        token: form.token!.trim(),
      });
      const successToastMessage =
        getSuccessToastMessage?.(user) ??
        (identity
          ? `${title} is connected as ${identity}.`
          : `${title} is connected.`);
      showSuccessToast(`${title} connected`, {
        ...SETTINGS_TOAST_OPTIONS,
        celebration: "confetti",
        message: successToastMessage,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not save provider settings.",
      });
      showErrorToast(
        "Provider settings were not saved",
        SETTINGS_TOAST_OPTIONS
      );
    } finally {
      setIsLoading(false);
    }
  };

  const helperContent: ReactNode =
    status.kind === "error" ? (
      status.message
    ) : status.kind === "success" ? (
      getSuccessMessage(title, status.identity)
    ) : (
      <>
        You can find your API Token{" "}
        <a href={tokenUrl} target="_blank" rel="noreferrer">
          here
        </a>
        .
      </>
    );

  return (
    <SettingsSection
      title={title}
      description={description}
      className="integration-provider-section"
    >
      <VerticalFocusGroup regionId={getIntegrationProviderRegionId(id)} asChild>
        <form
          className="integration-provider-section__content"
          onSubmit={handleSubmit}
        >
          <Checkbox
            id={`${id}-enabled`}
            label={checkboxLabel}
            disabled={isLoading}
            checked={form.enabled}
            focusId={checkboxFocusId}
            navigationOverrides={checkboxNavigationOverrides}
            block
            onChange={handleToggle}
          />

          <div className="integration-provider-section__token-row">
            <Input
              id={`${id}-token`}
              className="integration-provider-section__input"
              label="API Token"
              type={isTokenVisible ? "text" : "password"}
              placeholder="API Token"
              value={form.token ?? ""}
              disabled={isTokenInputDisabled}
              focusId={inputFocusId}
              focusNavigationState={
                isTokenInputDisabled ? "disabled" : "active"
              }
              focusNavigationOverrides={inputNavigationOverrides}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => handleTokenChange(event.target.value)}
              iconRight={
                <button
                  type="button"
                  className="integration-provider-section__visibility-toggle"
                  aria-label={
                    isTokenVisible ? "Hide API Token" : "Show API Token"
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    setIsTokenVisible((currentValue) => !currentValue)
                  }
                  disabled={isTokenInputDisabled}
                >
                  {isTokenVisible ? (
                    <EyeClosedIcon size={20} />
                  ) : (
                    <EyeIcon size={20} />
                  )}
                </button>
              }
            />

            <Button
              type="submit"
              className="integration-provider-section__save-button"
              variant="secondary"
              icon={<FloppyDiskIcon size={18} />}
              loading={isLoading}
              disabled={isSaveButtonDisabled}
              focusId={saveButtonFocusId}
              focusNavigationOverrides={saveButtonNavigationOverrides}
            >
              Save
            </Button>
          </div>

          <p
            className={`integration-provider-section__helper integration-provider-section__helper--${status.kind}`}
          >
            {helperContent}
          </p>
        </form>
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
