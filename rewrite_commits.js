#!/usr/bin/env bun

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";

// --- Configuration ---
const MODEL_ID = "gemini-2.5-flash"; // User specified gemini-2.5-flash, but 1.5-flash is generally available and great for this
const GENERATE_CONTENT_API = "generateContent"; // Use the simpler, non-streaming API for this task

// --- ANSI Colors for better output ---
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const log = {
  info: (msg) => console.log(`${colors.cyan}ℹ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}✔ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`),
  error: (msg) => console.error(`${colors.red}✖ ${msg}${colors.reset}`),
  prompt: (msg) => `${colors.magenta}> ${msg}${colors.reset}`,
  dim: (msg) => `${colors.dim}${msg}${colors.reset}`,
};

// --- The AI Prompt ---
const PROMPT_TEMPLATE = `Use the Conventional Commit Messages specification to generate commit messages

The commit message should be structured as follows:


\`\`\`
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
\`\`\` 
--------------------------------

The commit contains the following structural elements, to communicate intent to the consumers of your library:

  - fix: a commit of the type fix patches a bug in your codebase (this correlates with PATCH in Semantic Versioning).
  - feat: a commit of the type feat introduces a new feature to the codebase (this correlates with MINOR in Semantic Versioning).
  - BREAKING CHANGE: a commit that has a footer BREAKING CHANGE:, or appends a ! after the type/scope, introduces a breaking API change (correlating with MAJOR in Semantic Versioning). A BREAKING CHANGE can be part of commits of any type.
  - types other than fix: and feat: are allowed, for example @commitlint/config-conventional (based on the Angular convention) recommends build:, chore:, ci:, docs:, style:, refactor:, perf:, test:, and others.
  - footers other than BREAKING CHANGE: <description> may be provided and follow a convention similar to git trailer format.
  - Additional types are not mandated by the Conventional Commits specification, and have no implicit effect in Semantic Versioning (unless they include a BREAKING CHANGE). A scope may be provided to a commit’s type, to provide additional contextual information and is contained within parenthesis, e.g., feat(parser): add ability to parse arrays.



### Specification Details

The key words “MUST”, “MUST NOT”, “REQUIRED”, “SHALL”, “SHALL NOT”, “SHOULD”, “SHOULD NOT”, “RECOMMENDED”, “MAY”, and “OPTIONAL” in this document are to be interpreted as described in RFC 2119.

Commits MUST be prefixed with a type, which consists of a noun, feat, fix, etc., followed by the OPTIONAL scope, OPTIONAL !, and REQUIRED terminal colon and space.
The type feat MUST be used when a commit adds a new feature to your application or library.
The type fix MUST be used when a commit represents a bug fix for your application.
A scope MAY be provided after a type. A scope MUST consist of a noun describing a section of the codebase surrounded by parenthesis, e.g., fix(parser):
A description MUST immediately follow the colon and space after the type/scope prefix. The description is a short summary of the code changes, e.g., fix: array parsing issue when multiple spaces were contained in string.
A longer commit body MAY be provided after the short description, providing additional contextual information about the code changes. The body MUST begin one blank line after the description.
A commit body is free-form and MAY consist of any number of newline separated paragraphs.
One or more footers MAY be provided one blank line after the body. Each footer MUST consist of a word token, followed by either a :<space> or <space># separator, followed by a string value (this is inspired by the git trailer convention).
A footer’s token MUST use - in place of whitespace characters, e.g., Acked-by (this helps differentiate the footer section from a multi-paragraph body). An exception is made for BREAKING CHANGE, which MAY also be used as a token.
A footer’s value MAY contain spaces and newlines, and parsing MUST terminate when the next valid footer token/separator pair is observed.
Breaking changes MUST be indicated in the type/scope prefix of a commit, or as an entry in the footer.
If included as a footer, a breaking change MUST consist of the uppercase text BREAKING CHANGE, followed by a colon, space, and description, e.g., BREAKING CHANGE: environment variables now take precedence over config files.
If included in the type/scope prefix, breaking changes MUST be indicated by a ! immediately before the :. If ! is used, BREAKING CHANGE: MAY be omitted from the footer section, and the commit description SHALL be used to describe the breaking change.
Types other than feat and fix MAY be used in your commit messages, e.g., docs: update ref docs.
The units of information that make up Conventional Commits MUST NOT be treated as case sensitive by implementors, with the exception of BREAKING CHANGE which MUST be uppercase.
BREAKING-CHANGE MUST be synonymous with BREAKING CHANGE, when used as a token in a footer.

<changes>{diff}</changes>

Now generate a commit message based on these changes. Output only your commit message in a code block.`;

/**
 * A promisified version of child_process.spawn to run shell commands.
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: "pipe", ...options });

    let stdout = "";
    let stderr = "";

    if (proc.stdout) {
      proc.stdout.on("data", (data) => (stdout += data.toString()));
    }
    if (proc.stderr) {
      proc.stderr.on("data", (data) => (stderr += data.toString()));
    }

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(
          `Command "${command} ${args.join(" ")}" failed with exit code ${code}`
        );
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Calls the Gemini API to generate a commit message from a git diff.
 */
async function generateCommitMessage(diff) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is not set.");
  }

  const promptWithDiff = PROMPT_TEMPLATE.replace("{diff}", diff);

  const requestBody = {
    contents: [{ role: "user", parts: [{ text: promptWithDiff }] }],
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:${GENERATE_CONTENT_API}?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Gemini API request failed with status ${response.status}: ${errorBody}`
      );
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error(
        "Invalid response from Gemini API: " + JSON.stringify(data, null, 2)
      );
    }

    // Clean up the response, removing markdown code block fences
    return text
      .trim()
      .replace(/^```(.*\n)?|\n```$/g, "")
      .trim();
  } catch (error) {
    log.error("Failed to call Gemini API.");
    throw error;
  }
}

/**
 * Prompts the user for an action.
 */
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

/**
 * Opens the user's default editor to let them edit a message.
 */
async function getEditedMessage(initialContent) {
  const editor = process.env.EDITOR || "vim";
  const tempFilePath = path.join(
    os.tmpdir(),
    `git-ai-commit-msg-${Date.now()}.txt`
  );

  fs.writeFileSync(tempFilePath, initialContent);

  return new Promise((resolve, reject) => {
    // Parse editor command to handle cases like "zed --wait"
    const editorParts = editor.split(" ");
    const editorCommand = editorParts[0];
    const editorArgs = [...editorParts.slice(1), tempFilePath];

    const editorProc = spawn(editorCommand, editorArgs, { stdio: "inherit" });

    editorProc.on("close", (code) => {
      if (code === 0) {
        const editedContent = fs.readFileSync(tempFilePath, "utf-8");
        fs.unlinkSync(tempFilePath); // Clean up
        resolve(editedContent.trim());
      } else {
        fs.unlinkSync(tempFilePath); // Clean up
        reject(new Error(`Editor exited with code ${code}. Aborting.`));
      }
    });
  });
}

/**
 * Checks if a commit message contains "AI generation failed"
 */
function hasAiGenerationFailed(message) {
  return message.toLowerCase().includes("ai generation failed");
}

/**
 * Main logic to process a single commit during a rebase.
 */
async function processOneCommit(autoYes = false, redoFailed = false) {
  log.info("Processing commit HEAD...");

  // 1. Get original commit message
  const { stdout: originalMessage } = await runCommand("git", [
    "log",
    "-1",
    "--pretty=%B",
  ]);

  // Check if this commit needs regeneration (only in redo-failed mode)
  if (redoFailed && !hasAiGenerationFailed(originalMessage)) {
    log.info(
      "Commit message does not contain 'AI generation failed'. Skipping."
    );
    return "continue";
  }

  if (redoFailed) {
    log.info("Found commit with 'AI generation failed'. Regenerating...");
  }

  // 2. Get the diff for this commit
  // `git show` without formatting shows the full commit details including the diff.
  const { stdout: commitInfo } = await runCommand("git", ["show", "HEAD"]);
  const diff = commitInfo
    .split("\n")
    .slice(
      commitInfo.split("\n").findIndex((line) => line.startsWith("diff --git"))
    )
    .join("\n");

  if (!diff.trim()) {
    log.warn(
      "No diff found for this commit. It might be a merge or an empty commit. Skipping."
    );
    return "continue";
  }

  log.info("Generating AI commit message...");
  let aiMessage;
  try {
    aiMessage = await generateCommitMessage(diff);
  } catch (error) {
    log.error(error.message);
    log.warn("Could not generate AI message. Please choose an action.");
    aiMessage = "AI Generation Failed";
  }

  console.log(`\n${colors.bright}--- ORIGINAL MESSAGE ---${colors.reset}`);
  console.log(`${colors.dim}${originalMessage.trim()}${colors.reset}`);
  console.log(`\n${colors.bright}--- AI SUGGESTION ---${colors.reset}`);
  console.log(`${colors.green}${aiMessage}${colors.reset}`);
  console.log("\n" + "-".repeat(50));

  // 3. Prompt user for action or auto-use AI message
  if (autoYes) {
    log.info("Auto-yes mode: using AI-generated message");
    const finalMessage = aiMessage;

    try {
      log.info("Amending commit...");
      await runCommand("git", ["commit", "--amend", "-m", finalMessage]);
      return "continue";
    } catch (error) {
      log.error("Failed to amend commit.");
      log.error(error.stderr);
      return "abort";
    }
  }

  // Interactive mode - prompt user for action
  while (true) {
    const choice = (
      await askQuestion(
        log.prompt("[y]es (use AI), [e]dit, [o]riginal, [a]bort: ")
      )
    ).toLowerCase();

    let finalMessage = "";

    switch (choice) {
      case "y":
      case "yes":
        finalMessage = aiMessage;
        break;
      case "e":
      case "edit":
        try {
          finalMessage = await getEditedMessage(aiMessage);
          log.info("Using edited message.");
        } catch (error) {
          log.error(error.message);
          return "abort";
        }
        break;
      case "o":
      case "original":
        log.info("Keeping original message.");
        return "continue"; // No need to amend, just continue
      case "a":
      case "abort":
        return "abort";
      default:
        log.warn("Invalid choice. Please try again.");
        continue; // Re-ask the question
    }

    try {
      log.info("Amending commit...");
      await runCommand("git", ["commit", "--amend", "-m", finalMessage]);
      return "continue";
    } catch (error) {
      log.error("Failed to amend commit.");
      log.error(error.stderr);
      return "abort";
    }
  }
}

/**
 * Checks if a git rebase is currently in progress.
 */
async function isRebasing() {
  const gitDir = (
    await runCommand("git", ["rev-parse", "--git-dir"])
  ).stdout.trim();
  return (
    fs.existsSync(path.join(gitDir, "rebase-merge")) ||
    fs.existsSync(path.join(gitDir, "rebase-apply"))
  );
}

/**
 * The main entry point of the script.
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const autoYes = args.includes("-y") || args.includes("--yes");
  const redoFailed = args.includes("--redo-failed");

  try {
    // --- Prerequisite Checks ---
    await runCommand("git", ["rev-parse", "--is-inside-work-tree"]);
  } catch (e) {
    log.error("This is not a git repository. Exiting.");
    process.exit(1);
  }

  try {
    const { stdout: status } = await runCommand("git", [
      "status",
      "--porcelain",
    ]);
    if (status.trim() !== "") {
      log.error(
        "Your working directory is not clean. Please commit or stash your changes. Exiting."
      );
      process.exit(1);
    }
  } catch (e) {
    log.error("Could not check git status.");
    log.error(e.stderr);
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    log.error("GEMINI_API_KEY environment variable is not set. Exiting.");
    process.exit(1);
  }

  // --- Rebase Management ---
  if (!(await isRebasing())) {
    log.info(
      "No rebase in progress. Starting a new interactive rebase from the root."
    );
    log.warn(
      "This will rewrite your entire commit history. This is a destructive operation."
    );
    log.warn(
      "Ensure you have a backup or have pushed the original branch to a remote."
    );

    if (autoYes) {
      log.info(
        "Auto-yes mode enabled: will automatically use AI-generated messages for all commits"
      );
    }

    if (redoFailed) {
      log.info(
        "Redo-failed mode enabled: will only regenerate commits with 'AI generation failed' in their message"
      );
    }

    const choice = await askQuestion(log.prompt("Proceed? [y/N]: "));
    if (choice.toLowerCase() !== "y") {
      log.info("Aborted by user.");
      process.exit(0);
    }

    try {
      const { stdout: rootCommit } = await runCommand("git", [
        "rev-list",
        "--max-parents=0",
        "HEAD",
      ]);
      log.info(
        `Starting rebase from root commit ${rootCommit
          .trim()
          .substring(0, 7)}...`
      );

      // This command starts the rebase. The script will then be controlled by the loop below.
      // We use `sed` to automatically change every 'pick' to 'edit' in the rebase-todo file.
      await runCommand("git", ["rebase", "-i", "--root"], {
        env: { ...process.env, GIT_SEQUENCE_EDITOR: "sed -i 's/^pick/edit/g'" },
      });
      log.success("Interactive rebase started. Now processing commits...");
    } catch (error) {
      log.error("Failed to start rebase.");
      if (error.stderr) log.error(error.stderr);
      process.exit(1);
    }
  } else {
    log.info("Resuming existing rebase.");
  }

  // --- Main Processing Loop ---
  while (await isRebasing()) {
    const action = await processOneCommit(autoYes, redoFailed);

    if (action === "abort") {
      log.warn("Aborting rebase...");
      await runCommand("git", ["rebase", "--abort"]);
      log.success(
        "Rebase aborted. Your repository is back to its original state."
      );
      break;
    }

    if (await isRebasing()) {
      log.info("Continuing to the next commit...");
      try {
        await runCommand("git", ["rebase", "--continue"]);
      } catch (error) {
        log.error("`git rebase --continue` failed. There might be a conflict.");
        log.error(
          "Please resolve the conflicts manually, then run this script again to continue."
        );
        log.error(error.stderr);
        process.exit(1);
      }
    }
  }

  if (!(await isRebasing())) {
    log.success("All commits processed. Rebase complete!");
  }
}

main().catch((err) => {
  log.error("An unexpected error occurred:");
  console.error(err);
  process.exit(1);
});
