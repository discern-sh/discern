import { forwardRef, useId, useRef, useState } from "react";
import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface TabItem {
  readonly value: string;
  readonly label: ReactNode;
  readonly content: ReactNode;
  readonly disabled?: boolean;
}

export interface TabsProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "defaultValue" | "onChange"> {
  readonly items: readonly TabItem[];
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  readonly activationMode?: "automatic" | "manual";
  readonly label?: string;
}

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  {
    items,
    value,
    defaultValue,
    onValueChange,
    activationMode = "automatic",
    label = "Tabs",
    className,
    ...props
  },
  ref,
) {
  const firstEnabled = items.find((item) => !item.disabled)?.value ?? "";
  const [internalValue, setInternalValue] = useState(
    defaultValue ?? firstEnabled,
  );
  const activeValue = value ?? internalValue;
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (nextValue: string) => {
    if (value === undefined) setInternalValue(nextValue);
    onValueChange?.(nextValue);
  };

  const moveFocus = (currentIndex: number, direction: 1 | -1) => {
    if (!items.length) return;
    let next = currentIndex;
    for (let count = 0; count < items.length; count += 1) {
      next = (next + direction + items.length) % items.length;
      const item = items[next];
      if (item && !item.disabled) {
        tabRefs.current[next]?.focus();
        if (activationMode === "automatic") select(item.value);
        return;
      }
    }
  };

  const focusBoundary = (fromEnd: boolean) => {
    const indices = items.map((_, index) => index);
    if (fromEnd) indices.reverse();
    const target = indices.find((index) => !items[index]?.disabled);
    if (target === undefined) return;
    tabRefs.current[target]?.focus();
    const item = items[target];
    if (activationMode === "automatic" && item) select(item.value);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    item: TabItem,
  ) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveFocus(index, 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveFocus(index, -1);
        break;
      case "Home":
        event.preventDefault();
        focusBoundary(false);
        break;
      case "End":
        event.preventDefault();
        focusBoundary(true);
        break;
      case "Enter":
      case " ":
        if (activationMode === "manual") {
          event.preventDefault();
          select(item.value);
        }
        break;
    }
  };

  const activeItem = items.find((item) =>
    item.value === activeValue && !item.disabled
  ) ?? items.find((item) => !item.disabled);
  return (
    <div ref={ref} className={classNames("discern-tabs", className)} {...props}>
      <div role="tablist" aria-label={label} className="discern-tabs__list">
        {items.map((item, index) => {
          const selected = item.value === activeItem?.value;
          return (
            <button
              key={item.value}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`${baseId}-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${index}`}
              disabled={item.disabled}
              tabIndex={selected ? 0 : -1}
              className="discern-tabs__tab"
              onClick={() => select(item.value)}
              onKeyDown={(event) =>
                handleKeyDown(event, index, item)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {activeItem
        ? (() => {
          const activeIndex = items.indexOf(activeItem);
          return (
            <div
              id={`${baseId}-panel-${activeIndex}`}
              role="tabpanel"
              aria-labelledby={`${baseId}-tab-${activeIndex}`}
              tabIndex={0}
              className="discern-tabs__panel"
            >
              {activeItem.content}
            </div>
          );
        })()
        : null}
    </div>
  );
});
