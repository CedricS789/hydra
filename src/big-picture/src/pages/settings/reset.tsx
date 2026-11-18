/* eslint-disable react/prop-types -- Adapter props are contextually typed by the shared ResetControls interface. */
import {
  Button,
  Checkbox,
  DropdownSelect,
  GridFocusGroup,
  Input,
  Modal,
  VerticalFocusGroup,
} from "../../components";
import {
  SettingsResetPanel,
  type ResetControls,
} from "@renderer/pages/settings/settings-reset-panel";
const controls: ResetControls = {
  Button: ({ children, ...props }) => (
    <Button variant="secondary" {...props}>
      {children}
    </Button>
  ),
  Check: (props) => <Checkbox {...props} block />,
  Input: ({ onChange, ...props }) => (
    <Input {...props} onChange={(event) => onChange(event.target.value)} />
  ),
  Select: ({ onChange, ...props }) => (
    <DropdownSelect {...props} onValueChange={onChange} />
  ),
  Dialog: ({ children, ...props }) => (
    <Modal
      {...props}
      visible
      closeOnBackdrop={false}
      initialFocusId="settings-reset-cancel"
    >
      {children}
    </Modal>
  ),
  Stack: ({ children }) => <VerticalFocusGroup>{children}</VerticalFocusGroup>,
  Actions: ({ children, className }) => (
    <GridFocusGroup className={className}>{children}</GridFocusGroup>
  ),
};
export function ResetSettingsSection() {
  return <SettingsResetPanel controls={controls} />;
}
