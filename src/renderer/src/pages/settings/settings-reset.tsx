/* eslint-disable react/prop-types -- Adapter props are contextually typed by the shared ResetControls interface. */
import { Fragment } from "react";
import { Button } from "@renderer/components/button/button";
import { CheckboxField } from "@renderer/components/checkbox-field/checkbox-field";
import { TextField } from "@renderer/components/text-field/text-field";
import { SelectField } from "@renderer/components/select-field/select-field";
import { Modal } from "@renderer/components/modal/modal";
import { SettingsResetPanel, type ResetControls } from "./settings-reset-panel";

const controls: ResetControls = {
  Button: ({ children, onClick, disabled, focusId }) => (
    <Button
      type="button"
      theme="outline"
      id={focusId}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  ),
  Check: ({ onChange, ...props }) => (
    <CheckboxField
      {...props}
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
  Input: ({ onChange, ...props }) => (
    <TextField {...props} onChange={(event) => onChange(event.target.value)} />
  ),
  Select: ({ onChange, options, ...props }) => (
    <SelectField
      {...props}
      options={options.map((option) => ({ ...option, key: option.value }))}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  Dialog: ({ children, ...props }) => (
    <Modal {...props} visible large clickOutsideToClose={false}>
      {children}
    </Modal>
  ),
  Stack: Fragment,
};
export function SettingsReset() {
  return <SettingsResetPanel controls={controls} />;
}
