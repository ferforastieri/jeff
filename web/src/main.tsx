import React from "react";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/onest";
import ReactDOM from "react-dom/client";
import "./fonts.css";
import "./index.css";
import { initAppearance } from "./features/settings/store";
import { ConfirmProvider } from "./shared/ui/confirm";
import App from "./app/App";
import { installNativeInsets } from "./shared/platform/nativeInsets";

installNativeInsets();
// Keep browser settings from the pre-Jeff build without asking the user to redo them.
try {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith("toph")) continue;
    const next = `jeff${key.slice(4)}`;
    if (localStorage.getItem(next) === null) {
      localStorage.setItem(next, localStorage.getItem(key) ?? "");
    }
  }
} catch {
  /* private mode */
}
initAppearance();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </React.StrictMode>,
);
