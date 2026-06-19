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
          const raw = this.values[field.key];
          if (field.type === "number") {
            t.inputEl.type = "number";
            const num = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
            // Show real non-zero values so they can be edited; blank out 0 so
            // typing doesn't produce "02"/"20". Placeholder hints the default.
            if (!isNaN(num) && num !== 0) {
              t.setValue(String(num));
            } else {
              t.setValue("");
              t.inputEl.placeholder = "0";
            }
          } else {
            t.setValue(String(raw ?? ""));
          }
          t.onChange((v) => {
            if (field.type === "number") {
              this.values[field.key] = v === "" ? 0 : (parseFloat(v) || 0);
            } else {
              this.values[field.key] = v;
            }
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

/**
 * A simple confirmation dialog. Resolves true if confirmed, false otherwise.
 * Replaces window.confirm() which doesn't work in Obsidian's Electron renderer.
 */
export function confirmAction(
  app: App,
  title: string,
  message: string,
  confirmLabel = "Confirm",
  danger = false
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmModal(app, title, message, confirmLabel, danger, resolve);
    modal.open();
  });
}

class ConfirmModal extends Modal {
  private title: string;
  private message: string;
  private confirmLabel: string;
  private danger: boolean;
  private resolve: (v: boolean) => void;
  private settled = false;

  constructor(app: App, title: string, message: string, confirmLabel: string, danger: boolean, resolve: (v: boolean) => void) {
    super(app);
    this.title = title;
    this.message = message;
    this.confirmLabel = confirmLabel;
    this.danger = danger;
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.title });
    contentEl.createEl("p", { text: this.message }).style.cssText = "font-size:13px;color:var(--text-muted);line-height:1.5";

    const btnRow = contentEl.createDiv();
    btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:16px";
    const cancel = btnRow.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.finish(false);
    const confirm = btnRow.createEl("button", { text: this.confirmLabel });
    confirm.style.cssText = this.danger
      ? "background:var(--background-modifier-error);color:var(--text-on-accent)"
      : "";
    if (!this.danger) confirm.addClass("mod-cta");
    confirm.onclick = () => this.finish(true);
    setTimeout(() => confirm.focus(), 50);
  }

  private finish(result: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(result);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(false);
    }
  }
}
