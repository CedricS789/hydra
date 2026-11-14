import localEdition from "../../../shared/local-edition.json";
import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import {
  setHydraCloudModalVisible,
  setHydraCloudModalHidden,
} from "@renderer/features";
import { HydraCloudFeature } from "@types";

export function useSubscription() {
  const dispatch = useAppDispatch();

  const { isHydraCloudModalVisible, feature } = useAppSelector(
    (state) => state.subscription
  );

  const showHydraCloudModal = useCallback(
    (feature: HydraCloudFeature) => {
      if (localEdition.hideCloudPromotions) {
        if (feature === "backup")
          globalThis.location.hash = "/settings?tab=local_backups";
        return;
      }
      dispatch(setHydraCloudModalVisible(feature));
    },
    [dispatch]
  );

  const hideHydraCloudModal = useCallback(() => {
    dispatch(setHydraCloudModalHidden());
  }, [dispatch]);

  return {
    isHydraCloudModalVisible,
    hydraCloudFeature: feature,
    showHydraCloudModal,
    hideHydraCloudModal,
  };
}
