## Thera Language Support for VS Code

Thera is a modern, expressive, and highly productive programming language
designed specifically for LLMs, AI coding agents, and developers to write clean,
fast, and robust tools and CLI applications.

This extension provides comprehensive, premium syntax highlighting and language
support for Thera in Visual Studio Code.

## Features

- Rich TextMate syntax highlighting for `.thera` files
- Code snippets for common Thera constructs
- Language configuration: auto-closing brackets, surrounding pairs, and comment
  toggling
- **Run** and **Test** CodeLens actions on `main` and `#[test]` functions
- Automatic Thera SDK detection (or configure the CLI path with `thera.path`)

The extension connects to the `thera lsp` language server, which provides:

- Live diagnostics (errors and warnings), including project-wide analysis, with
  configurable exclude globs (`thera.exclude`)
- Hover information
- Go to definition
- Find all references
- Rename symbol
- Document symbols (outline) and workspace symbol search
- Code actions (quick fixes)
- Document formatting

## Language At A Glance

Thera's syntax is familiar, clean, and expression-oriented:

```thera
import std.process;

fn current_branch() -> Result<String, Error> {
    let out = process.run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])?;
    return Ok(out.stdout.trim());
}

fn main(args: Args) -> Result<Int, Error> {
    let branch = current_branch()?;
    println('Current branch is ${branch}');
    return Ok(0);
}
```

## Installation & Development

### Running the Extension Locally

1. Clone or copy this repository to your local VS Code extensions directory:
   `~/.vscode/extensions/thera`.
2. Alternatively, open this folder (`thera-ext`) in VS Code.
3. Press **`F5`** to launch a new **[Extension Development Host]** window.
4. In the new window, open any file ending in `.thera` to experience premium
   syntax highlighting!
