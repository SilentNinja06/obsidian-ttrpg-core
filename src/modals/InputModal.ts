import { App, Modal, Setting } from "obsidian";

export interface InputField {
  key: string;
  label: string;
  type: "text" | "number" | "toggle" | "dropdown";
  default?: string | number | boolean;
  options?: string[];
}

/**
 * A reusable modal that collects a set of typed inputs and resolves to a
 * record of values. Replaces browser prompt()/confirm() which don't work
 * in Obsidian's Electron environment.
 */
export class InputModal extends Modal {
  private fields: InputField[];
  private title: string;
  private values: Record<string, string | number | boolean> = {};
  private onSubmit: (values: Record<string, string | number | boolean> | null) => void;
  private submitted = false;

  constructor(
    app: App,
    title: string,
    fields: InputField[],
    onSubmit: (values: Record<string, string | number | boolean> | null) => void
  ) {
    super(app);
    this.title = title;
    this.fields = fields;
    this.onSubmit = onSubmit;
    for (const f of fields) {
      this.values[f.key] = f.default ?? (f.type === "number" ? 0 : f.type === "toggle" ? false : "");
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.title });

    let firstInput: HTMLInputElement | null = null;

    for (const field of this.fields) {
      const setting = new Setting(contentEl).setName(field.label);

      if (field.type === "toggle") {
        setting.addToggle((t) =>
          t.setValue(this.values[field.key] as boolean).onChange((v) => {
            this.values[field.key] = v;
          })
        );
      } else if (field.type === "dropdown") {
        setting.addDropdown((d) => {
          for (const opt of field.options ?? []) d.addOption(opt, opt);
          d.setValue(this.values[field.key] as string);
          d.onChange((v) => { this.values[field.key] = v; });
        });
      } else {
        setting.addText((t) => {
          t.setValue(String(this.values[field.key] ?? ""));
          if (field.type === "number") t.inputEl.type = "number";
          t.onChange((v) => {
            this.values[field.key] = field.type === "number" ? (parseFloat(v) || 0) : v;
          });
          t.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this.submit();
          });
          if (!firstInput) firstInput = t.inputEl;
        });
      }
    }

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("OK").setCta().onClick(() => this.submit()));

    if (firstInput) setTimeout(() => firstInput!.focus(), 50);
  }

  private submit(): void {
    this.submitted = true;
    this.onSubmit({ ...this.values });
    this.close();
  }

  onClose(): void {
    if (!this.submitted) this.onSubmit(null);
    this.contentEl.empty();
  }
}

/** Convenience helper: single text input, resolves to string or null. */
export function promptText(
  app: App,
  title: string,
  label: string,
  defaultValue = ""
): Promise<string | null> {
  return new Promise((resolve) => {
    new InputModal(app, title, [{ key: "value", label, type: "text", default: defaultValue }], (v) => {
      resolve(v ? String(v.value) : null);
    }).open();
  });
}
