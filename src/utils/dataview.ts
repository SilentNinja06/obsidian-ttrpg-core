import { App } from "obsidian";

export function isDataviewAvailable(app: App): boolean {
  // @ts-ignore — Dataview exposes itself on app.plugins
  return !!app.plugins?.plugins?.dataview?.api;
}

export function getDataviewApi(app: App): unknown {
  // @ts-ignore
  return app.plugins?.plugins?.dataview?.api;
}

export function requireDataview(app: App): void {
  if (!isDataviewAvailable(app)) {
    throw new Error(
      "TTRPG Campaign Manager requires the Dataview plugin to be installed and enabled. " +
        "Please install Dataview from the Obsidian community plugins list."
    );
  }
}
