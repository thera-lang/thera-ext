import {
  workspace,
  ExtensionContext,
  ConfigurationTarget,
  commands,
  window,
  languages,
  CodeLensProvider,
  TextDocument,
  CodeLens,
  Range,
  Terminal,
} from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import * as fs from "fs";
import * as path from "path";

let client: LanguageClient | undefined;
let runTerminal: Terminal | undefined;

// Cached, resolved path to the `thera` executable. Populated lazily by
// ensureTheraPath() and shared by the language server and the Run/Test commands
// so they never disagree about which toolchain to use.
let theraPath: string | undefined;

// The explicit `thera.path` setting, or undefined if it's empty/unset.
function configuredTheraPath(): string | undefined {
  const p = workspace.getConfiguration("thera").get<string>("path", "").trim();
  return p !== "" ? p : undefined;
}

// Look for an executable named `thera` on the user's PATH. Returns the first
// match (which for an installed SDK is `<sdk>/bin/thera`), or undefined.
function findTheraOnPath(): string | undefined {
  const names =
    process.platform === "win32"
      ? ["thera.exe", "thera.cmd", "thera.bat", "thera"]
      : ["thera"];
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Not present here, or not executable — keep looking.
      }
    }
  }
  return undefined;
}

// Resolve a user-picked filesystem path to the `thera` executable: accept the
// binary itself, or an SDK folder containing `bin/thera` (or `thera`). Returns
// undefined if nothing usable is found.
function theraExecutableFrom(picked: string): string | undefined {
  const exe = process.platform === "win32" ? "thera.exe" : "thera";
  let stat: fs.Stats;
  try {
    stat = fs.statSync(picked);
  } catch {
    return undefined;
  }
  if (!stat.isDirectory()) return picked;
  for (const candidate of [
    path.join(picked, "bin", exe),
    path.join(picked, exe),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

// Persist a resolved path to the global `thera.path` setting so it's stable and
// visible in the Settings UI. Global scope because an SDK install is
// per-machine, not per-workspace.
async function persistTheraPath(p: string): Promise<void> {
  await workspace
    .getConfiguration("thera")
    .update("path", p, ConfigurationTarget.Global);
}

// Resolve the `thera` executable, in order: the explicit `thera.path` setting;
// then PATH auto-detection; then a prompt to locate the SDK. Auto-detected and
// user-picked paths are written back to `thera.path`. Returns undefined only if
// the user declines or dismisses the locate prompt.
async function resolveTheraPath(): Promise<string | undefined> {
  const configured = configuredTheraPath();
  if (configured) return configured;

  const onPath = findTheraOnPath();
  if (onPath) {
    await persistTheraPath(onPath);
    return onPath;
  }

  return promptToLocateSdk();
}

// Open a file picker for the Thera SDK and, if the user picks a usable location,
// persist and return the resolved `thera` executable. Returns undefined if the
// user cancels or the selection doesn't contain a `thera` binary.
async function pickTheraPath(): Promise<string | undefined> {
  const picked = await window.showOpenDialog({
    title: "Locate the Thera SDK",
    openLabel: "Use Thera SDK",
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
  });
  if (picked && picked.length > 0) {
    const exe = theraExecutableFrom(picked[0].fsPath);
    if (exe) {
      await persistTheraPath(exe);
      return exe;
    }
    window.showErrorMessage(
      "Couldn't find a `thera` executable at the selected location. " +
        "Pick the SDK folder (containing bin/thera) or the thera binary itself.",
    );
  }
  return undefined;
}

// When the `thera` CLI can't be found automatically, explain the situation with
// a (non-blocking) notification rather than surfacing a bare file dialog. The
// notification's button opens the picker; dismissing it leaves the server
// unstarted until the user tries again. Returns the resolved executable, or
// undefined if the user dismisses the notification or cancels the picker.
async function promptToLocateSdk(): Promise<string | undefined> {
  const locate = "Locate SDK…";
  const choice = await window.showInformationMessage(
    "Thera: couldn't find the `thera` CLI on your PATH. Locate your Thera SDK " +
      "to enable diagnostics, hover, and other language features.",
    locate,
  );
  if (choice !== locate) return undefined;
  return pickTheraPath();
}

// Cached accessor used by the Run/Test commands; resolves on first use.
async function ensureTheraPath(): Promise<string | undefined> {
  if (!theraPath) theraPath = await resolveTheraPath();
  return theraPath;
}

function runInTerminal(command: string) {
  if (!runTerminal || runTerminal.exitStatus !== undefined) {
    runTerminal = window.createTerminal("Thera");
  }
  runTerminal.show();
  runTerminal.sendText(command);
}

class TheraCodeLensProvider implements CodeLensProvider {
  provideCodeLenses(document: TextDocument): CodeLens[] {
    const lenses: CodeLens[] = [];
    const text = document.getText();

    // Naive regex to find main and test functions
    const mainRegex = /^(?:pub\s+)?fn\s+main\s*\(/gm;
    let match;
    while ((match = mainRegex.exec(text)) !== null) {
      const line = document.positionAt(match.index).line;
      const range = new Range(line, 0, line, 0);
      lenses.push(
        new CodeLens(range, {
          title: "Run",
          command: "thera.run",
          arguments: [document.uri.fsPath],
        }),
      );
    }

    const testRegex = /^#\[test\]\s*\n(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/gm;
    while ((match = testRegex.exec(text)) !== null) {
      const line = document.positionAt(match.index).line;
      const range = new Range(line, 0, line, 0);
      lenses.push(
        new CodeLens(range, {
          title: "Test",
          command: "thera.test",
          arguments: [document.uri.fsPath, match[1]],
        }),
      );
    }

    return lenses;
  }
}

// The `thera.exclude` globs — workspace-relative path patterns (e.g.
// `tests/lang/**`) whose files the server withholds diagnostics for. Sent to the
// server, which does the matching (it drives project-wide diagnostics over the
// pull channel, and filtering there is uniform across every channel).
function excludePatterns(): string[] {
  return workspace.getConfiguration("thera").get<string[]>("exclude", []);
}

// Create (but don't start) the Thera language client bound to the given `thera`
// executable. The server is a plain `thera lsp` subprocess over stdio.
function createClient(thera: string): LanguageClient {
  const serverOptions: ServerOptions = {
    command: thera,
    args: ["lsp"],
    options: {},
  };

  const clientOptions: LanguageClientOptions = {
    // Register the server for Thera documents.
    documentSelector: [{ scheme: "file", language: "thera" }],
    synchronize: {
      // Notify the server about file changes in the workspace.
      fileEvents: workspace.createFileSystemWatcher("**/.clientrc"),
    },
    // The server reads `exclude` here at startup and suppresses those files'
    // diagnostics. Live changes are pushed via `workspace/didChangeConfiguration`
    // (see the config listener in `activate`).
    initializationOptions: {
      exclude: excludePatterns(),
    },
  };

  return new LanguageClient(
    "theraLanguageServer",
    "Thera Language Server",
    serverOptions,
    clientOptions,
  );
}

// Resolve the `thera` executable and start the language server. If no executable
// can be resolved (the user dismissed the locate prompt), warns and leaves the
// server unstarted — Run/Test still work once a path is configured.
async function startLanguageServer(): Promise<void> {
  const thera = await ensureTheraPath();
  if (!thera) {
    window.showWarningMessage(
      "Thera: no `thera` executable found. Set `thera.path`, or run " +
        "“Thera: Restart Language Server” to locate the SDK.",
    );
    return;
  }
  client = createClient(thera);
  await client.start();
}

// Stop the running language client, if any, so a fresh one can be started.
async function stopClient(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}

export async function activate(context: ExtensionContext) {
  // Register command to (re)start the server. This also re-resolves thera.path,
  // so it doubles as the way to pick up a changed setting or retry after the
  // locate prompt was dismissed.
  const restartCommand = commands.registerCommand(
    "thera.restartServer",
    async () => {
      try {
        await stopClient();
        theraPath = undefined; // force re-resolution from the current setting
        window.showInformationMessage("Restarting Thera Language Server...");
        await startLanguageServer();
        if (client) {
          window.showInformationMessage(
            "Thera Language Server restarted successfully.",
          );
        }
      } catch (error) {
        window.showErrorMessage(
          `Failed to restart Thera Language Server: ${error}`,
        );
      }
    },
  );

  // Let the user (re)point the extension at their Thera SDK on demand, then
  // restart the server against it. Unlike the auto-prompt, this is always
  // available from the command palette.
  const locateSdkCommand = commands.registerCommand(
    "thera.locateSdk",
    async () => {
      try {
        const picked = await pickTheraPath();
        if (!picked) return; // user cancelled, or the selection was unusable
        theraPath = picked;
        await stopClient();
        await startLanguageServer();
        if (client) {
          window.showInformationMessage(
            `Thera SDK set to ${picked}. Language server started.`,
          );
        }
      } catch (error) {
        window.showErrorMessage(
          `Failed to start Thera Language Server: ${error}`,
        );
      }
    },
  );

  const runCommand = commands.registerCommand(
    "thera.run",
    async (file: string) => {
      const thera = await ensureTheraPath();
      if (!thera) return;
      runInTerminal(`${thera} run "${file}"`);
    },
  );

  const testCommand = commands.registerCommand(
    "thera.test",
    async (file: string, _testName?: string) => {
      // For v0 we just test the file. testName filtering can be a future CLI feature
      const thera = await ensureTheraPath();
      if (!thera) return;
      runInTerminal(`${thera} test "${file}"`);
    },
  );

  const codeLensProvider = languages.registerCodeLensProvider(
    { scheme: "file", language: "thera" },
    new TheraCodeLensProvider(),
  );

  // Push a live `thera.exclude` change to the running server (it applies the new
  // filter and nudges a re-pull). No restart needed.
  const configListener = workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("thera.exclude") && client) {
      client.sendNotification("workspace/didChangeConfiguration", {
        settings: { thera: { exclude: excludePatterns() } },
      });
    }
  });

  context.subscriptions.push(
    restartCommand,
    locateSdkCommand,
    runCommand,
    testCommand,
    codeLensProvider,
    configListener,
  );

  await startLanguageServer();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
