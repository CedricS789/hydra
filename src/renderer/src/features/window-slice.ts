import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import {
  readStoredSidebarHidden,
  writeStoredSidebarHidden,
} from "../components/sidebar/sidebar-visibility";

export interface WindowState {
  draggingDisabled: boolean;
  headerTitle: string;
  isSidebarHidden: boolean;
}

const initialState: WindowState = {
  draggingDisabled: false,
  headerTitle: "",
  isSidebarHidden: readStoredSidebarHidden(),
};

export const windowSlice = createSlice({
  name: "window",
  initialState,
  reducers: {
    toggleDraggingDisabled: (state, action: PayloadAction<boolean>) => {
      state.draggingDisabled = action.payload;
    },
    setHeaderTitle: (state, action: PayloadAction<string>) => {
      state.headerTitle = action.payload;
    },
    setSidebarHidden: (state, action: PayloadAction<boolean>) => {
      state.isSidebarHidden = action.payload;
      writeStoredSidebarHidden(action.payload);
    },
    toggleSidebarHidden: (state) => {
      state.isSidebarHidden = !state.isSidebarHidden;
      writeStoredSidebarHidden(state.isSidebarHidden);
    },
  },
});

export const {
  toggleDraggingDisabled,
  setHeaderTitle,
  setSidebarHidden,
  toggleSidebarHidden,
} = windowSlice.actions;
