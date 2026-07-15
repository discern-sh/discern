import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
} from "react";
import type { DialogHTMLAttributes, MouseEvent, ReactNode } from "react";
import { classNames } from "../../class-names.ts";
import { Kicker } from "../../display/kicker/kicker.tsx";

export interface DialogProps extends
  Omit<
    DialogHTMLAttributes<HTMLDialogElement>,
    "open" | "onClose" | "title"
  > {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly kicker?: ReactNode;
  readonly actions?: ReactNode;
  readonly closeLabel?: string;
  readonly closeOnBackdrop?: boolean;
  readonly children: ReactNode;
}

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(
  function Dialog(
    {
      open,
      onOpenChange,
      title,
      kicker,
      actions,
      closeLabel = "Close dialog",
      closeOnBackdrop = true,
      className,
      children,
      ...props
    },
    forwardedRef,
  ) {
    const internalRef = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useImperativeHandle(
      forwardedRef,
      () => internalRef.current as HTMLDialogElement,
      [],
    );

    useEffect(() => {
      const dialog = internalRef.current;
      if (!dialog) {
        return;
      }
      if (open && !dialog.open) {
        dialog.showModal();
      }
      if (!open && dialog.open) dialog.close();
    }, [open]);

    useEffect(() => {
      if (!open) return;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }, [open]);

    const handleBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
      if (
        closeOnBackdrop && event.target === event.currentTarget
      ) onOpenChange(false);
    };

    return (
      <dialog
        ref={internalRef}
        aria-labelledby={titleId}
        className={classNames("discern-dialog", className)}
        onCancel={(event) => {
          event.preventDefault();
          onOpenChange(false);
        }}
        onMouseDown={handleBackdrop}
        {...props}
      >
        <div className="discern-dialog__panel">
          <header className="discern-dialog__header">
            <div>
              {kicker ? <Kicker>{kicker}</Kicker> : null}
              <h2 className="discern-dialog__title" id={titleId}>{title}</h2>
            </div>
            <button
              type="button"
              className="discern-dialog__close"
              aria-label={closeLabel}
              onClick={() => onOpenChange(false)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className="discern-dialog__body">{children}</div>
          {actions
            ? <footer className="discern-dialog__actions">{actions}</footer>
            : null}
        </div>
      </dialog>
    );
  },
);
