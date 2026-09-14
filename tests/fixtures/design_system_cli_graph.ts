import { packageManifest } from "discern-design-system";
import { renderBadgeCli } from "discern-design-system/cli";
import {
  MarkdownBrowserRefusalError,
  runTerminalApplication, renderTerminalApplication, updateTerminalApplication,
  transitionTerminalApplication, TERMINAL_APPLICATION_MINIMUM,
  type TerminalApplicationView,
  requestAcknowledgement,
  requestMarkdownBrowser,
  requestSelection,
} from "discern-design-system/cli/interactive";
import { FakeTerminalIO } from "discern-design-system/cli/interactive/testing";
import { projectTerminalHtml } from "discern-design-system/cli/projection";

void packageManifest;
void renderBadgeCli;
void MarkdownBrowserRefusalError;
void requestAcknowledgement;
void requestMarkdownBrowser;
void requestSelection;
void FakeTerminalIO;
void projectTerminalHtml;

void runTerminalApplication;
void renderTerminalApplication;
void updateTerminalApplication;
void transitionTerminalApplication;
void TERMINAL_APPLICATION_MINIMUM;
const publicView: TerminalApplicationView<string> | undefined = undefined;
void publicView;
