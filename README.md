# Hawk Language Support for VS Code

Hawk is a modern, expressive, and highly productive programming language designed specifically for LLMs, AI coding agents, and developers to write clean, fast, and robust tools and CLI applications.

This extension provides comprehensive, premium syntax highlighting and language support for Hawk in Visual Studio Code.

---

## Features

### 🌟 Premium Syntax Highlighting

- **Keywords**: Full recognition of keywords (`let`, `mut`, `fn`, `return`, `throw`, `if`, `else`, `for`, `in`, `match`, `import`, `type`, `interface`, `impl`, `default`).
- **Types**: Highlighting of built-in and user-defined capitalized types (`Int`, `Double`, `Bool`, `String`, `Void`, `List`, `Map`, `Set`, `Option`, `Result`, `Args`, `Error`, etc.).
- **String Interpolation**: Full syntax highlighting inside single-quoted strings using `${expression}` syntax.
- **Error Propagation**: Accurate identification of the error propagation operator (`?`).
- **Decorators**: Beautiful highlighting for compile-time metadata and annotations (e.g. `@test`, `@route`).
- **Functions & Namespaces**: Differentiates between standard namespaces (e.g. `std.fs`, `process.run`) and standard function calls.
- **Comments**: Supports line comments (`//`) and block comments (`/* ... */`).

### ⚙️ Declarative Language Configuration

- **Bracket Matching**: Highlights matching curly `{ }`, square `[ ]`, and round `( )` brackets.
- **Auto-Closing Pairs**: Automatically closes braces, brackets, parentheses, single quotes, and double quotes.
- **Surrounding Selection**: Easily wrap text in parenthesis, brackets, braces, or quotes by highlighting it and typing the character.
- **Comment Toggling**: Quick toggling of single-line and block comments (`Cmd+/` / `Ctrl+/`).

---

## Language Specifications At A Glance

Hawk's syntax is familiar, clean, and expression-oriented:

```hawk
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

---

## Installation & Development

### Running the Extension Locally

1. Clone or copy this repository to your local VS Code extensions directory: `~/.vscode/extensions/hawk`.
2. Alternatively, open this folder (`hawk-ext`) in VS Code.
3. Press **`F5`** to launch a new **[Extension Development Host]** window.
4. In the new window, open any file ending in `.hawk` to experience premium syntax highlighting!

### Debugging TextMate Scopes

To inspect the exact scopes applied to Hawk tokens:

1. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
2. Run **`Developer: Inspect Editor Tokens and Scopes`**.
3. Click on any token in your `.hawk` file to inspect its TextMate scope (e.g. `source.hawk`).
