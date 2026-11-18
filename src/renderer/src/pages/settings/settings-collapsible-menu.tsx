import type { ReactNode } from "react";
import { ChevronDownIcon } from "@primer/octicons-react";

interface SettingsCollapsibleMenuProps {
  id?: string;
  classPrefix:
    | "settings-context-advanced__menu"
    | "local-edition__advanced-menu";
  extraClassName?: string;
  title: ReactNode;
  description?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * React-controlled collapsible section used in place of nested native `<details>`
 * elements so Chromium always recalculates scrollHeight accurately across toggles.
 */
export function SettingsCollapsibleMenu({
  id,
  classPrefix,
  extraClassName,
  title,
  description,
  open,
  onToggle,
  children,
}: Readonly<SettingsCollapsibleMenuProps>) {
  const classes = [
    classPrefix,
    open ? `${classPrefix}--open` : "",
    extraClassName ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section id={id} className={classes}>
      <button
        type="button"
        className={`${classPrefix}-trigger`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <div className={`${classPrefix}-header`}>
          <span>{title}</span>
          {description && <small>{description}</small>}
        </div>
        <ChevronDownIcon
          size={16}
          className={`${classPrefix}-chevron`}
          aria-hidden="true"
        />
      </button>
      <div className={`${classPrefix}-body`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
