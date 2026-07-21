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

// Cached, resolved path to the `hawk` executable. Populated lazily by
// ensureHawkPath() and shared by the language server and the Run/Test commands
// so they never disagree about which toolchain to use.
let hawkPath: string | undefined;

// The explicit `hawk.path` setting, or undefined if it's empty/unset.
function configuredHawkPath(): string | undefined {
  const p = workspace.getConfiguration("hawk").get<string>("path", "").trim();
  return p !== "" ? p : undefined;
}

// Look for an executable named `hawk` on the user's PATH. Returns the first
// match (which for an installed SDK is `<sdk>/bin/hawk`), or undefined.
function findHawkOnPath(): string | undefined {
  const names =
    process.platform === "win32"
      ? ["hawk.exe", "hawk.cmd", "hawk.bat", "hawk"]
      : ["hawk"];
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

// Resolve a user-picked filesystem path to the `hawk` executable: accept the
// binary itself, or an SDK folder containing `bin/hawk` (or `hawk`). Returns
// undefined if nothing usable is found.
function hawkExecutableFrom(picked: string): string | undefined {
  const exe = process.platform === "win32" ? "hawk.exe" : "hawk";
  let stat: fs.Stats;
  try {
    stat = fs.statSync(picked);
  } catch {
    return undefined;
  }
  if (!stat.isDirectory()) return picked;
  for (const candidate of [path.join(picked, "bin", exe), path.join(picked, exe)]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

// Persist a resolved path to the global `hawk.path` setting so it's stable and
// visible in the Settings UI. Global scope because an SDK install is
// per-machine, not per-workspace.
async function persistHawkPath(p: string): Promise<void> {
  await workspace
    .getConfiguration("hawk")
    .update("path", p, ConfigurationTarget.Global);
}

// Resolve the `hawk` executable, in order: the explicit `hawk.path` setting;
// then PATH auto-detection; then a prompt to locate the SDK. Auto-detected and
// user-picked paths are written back to `hawk.path`. Returns undefined only if
// the user dismisses the locate prompt.
async function resolveHawkPath(): Promise<string | undefined> {
  const configured = configuredHawkPath();
  if (configured) return configured;

  const onPath = findHawkOnPath();
  if (onPath) {
    await persistHawkPath(onPath);
    return onPath;
  }

  const picked = await window.showOpenDialog({
    title: "Locate the Hawk SDK",
    openLabel: "Use Hawk SDK",
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
  });
  if (picked && picked.length > 0) {
    const exe = hawkExecutableFrom(picked[0].fsPath);
    if (exe) {
      await persistHawkPath(exe);
      return exe;
    }
    window.showErrorMessage(
      "Couldn't find a `hawk` executable at the selected location. " +
        "Pick the SDK folder (containing bin/hawk) or the hawk binary itself.",
    );
  }
  return undefined;
}

// Cached accessor used by the Run/Test commands; resolves on first use.
async function ensureHawkPath(): Promise<string | undefined> {
  if (!hawkPath) hawkPath = await resolveHawkPath();
  return hawkPath;
}

function runInTerminal(command: string) {
  if (!runTerminal || runTerminal.exitStatus !== undefined) {
    runTerminal = window.createTerminal("Hawk");
  }
  runTerminal.show();
  runTerminal.sendText(command);
}

class HawkCodeLensProvider implements CodeLensProvider {
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
          command: "hawk.run",
          arguments: [document.uri.fsPath],
        })
      );
    }

    const testRegex = /^#\[test\]\s*\n(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/gm;
    while ((match = testRegex.exec(text)) !== null) {
      const line = document.positionAt(match.index).line;
      const range = new Range(line, 0, line, 0);
      lenses.push(
        new CodeLens(range, {
          title: "Test",
          command: "hawk.test",
          arguments: [document.uri.fsPath, match[1]],
        })
      );
    }
    
    return lenses;
  }
}

// The `hawk.exclude` globs — workspace-relative path patterns (e.g.
// `tests/lang/**`) whose files the server withholds diagnostics for. Sent to the
// server, which does the matching (it drives project-wide diagnostics over the
// pull channel, and filtering there is uniform across every channel).
function excludePatterns(): string[] {
  return workspace.getConfiguration("hawk").get<string[]>("exclude", []);
}

// Create (but don't start) the Hawk language client bound to the given `hawk`
// executable. The server is a plain `hawk lsp` subprocess over stdio.
function createClient(hawk: string): LanguageClient {
  const serverOptions: ServerOptions = {
    command: hawk,
    args: ["lsp"],
    options: {},
  };

  const clientOptions: LanguageClientOptions = {
    // Register the server for Hawk documents.
    documentSelector: [{ scheme: "file", language: "hawk" }],
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
    "hawkLanguageServer",
    "Hawk Language Server",
    serverOptions,
    clientOptions,
  );
}

// Resolve the `hawk` executable and start the language server. If no executable
// can be resolved (the user dismissed the locate prompt), warns and leaves the
// server unstarted — Run/Test still work once a path is configured.
async function startLanguageServer(): Promise<void> {
  const hawk = await ensureHawkPath();
  if (!hawk) {
    window.showWarningMessage(
      "Hawk: no `hawk` executable found. Set `hawk.path`, or run " +
        "“Hawk: Restart Language Server” to locate the SDK.",
    );
    return;
  }
  client = createClient(hawk);
  await client.start();
}

export async function activate(context: ExtensionContext) {
  // Register command to (re)start the server. This also re-resolves hawk.path,
  // so it doubles as the way to pick up a changed setting or retry after the
  // locate prompt was dismissed.
  const restartCommand = commands.registerCommand(
    "hawk.restartServer",
    async () => {
      try {
        if (client) {
          await client.stop();
          client = undefined;
        }
        hawkPath = undefined; // force re-resolution from the current setting
        window.showInformationMessage("Restarting Hawk Language Server...");
        await startLanguageServer();
        if (client) {
          window.showInformationMessage(
            "Hawk Language Server restarted successfully.",
          );
        }
      } catch (error) {
        window.showErrorMessage(
          `Failed to restart Hawk Language Server: ${error}`,
        );
      }
    },
  );

  const runCommand = commands.registerCommand(
    "hawk.run",
    async (file: string) => {
      const hawk = await ensureHawkPath();
      if (!hawk) return;
      runInTerminal(`${hawk} run "${file}"`);
    }
  );

  const testCommand = commands.registerCommand(
    "hawk.test",
    async (file: string, _testName?: string) => {
      // For v0 we just test the file. testName filtering can be a future CLI feature
      const hawk = await ensureHawkPath();
      if (!hawk) return;
      runInTerminal(`${hawk} test "${file}"`);
    }
  );

  const codeLensProvider = languages.registerCodeLensProvider(
    { scheme: "file", language: "hawk" },
    new HawkCodeLensProvider()
  );

  // Push a live `hawk.exclude` change to the running server (it applies the new
  // filter and nudges a re-pull). No restart needed.
  const configListener = workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("hawk.exclude") && client) {
      client.sendNotification("workspace/didChangeConfiguration", {
        settings: { hawk: { exclude: excludePatterns() } },
      });
    }
  });

  context.subscriptions.push(
    restartCommand,
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
