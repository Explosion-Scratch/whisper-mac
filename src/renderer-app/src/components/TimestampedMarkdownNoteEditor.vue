<template>
  <div class="rn-md-note-editor" @mousedown.stop>
    <EditorContent v-if="editor" :editor="editor" class="rn-md-note-editor__content" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from "vue";
import { Editor, EditorContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import HardBreak from "@tiptap/extension-hard-break";
import {
  Mathematics,
  createMathMigrateTransaction,
  mathMigrationRegex,
} from "@tiptap/extension-mathematics";
import "prosemirror-view/style/prosemirror.css";
import "katex/dist/katex.min.css";

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
  (event: "split"): void;
  (event: "remove"): void;
  (event: "indent", delta: number): void;
  (event: "navigate", delta: number): void;
}>();

const editor = shallowRef<Editor | null>(null);

function normalizeMarkdown(value: string | null | undefined): string {
  return (value || "").replace(/\n+$/, "");
}

function syncMathNodes(currentEditor: Editor) {
  const transaction = createMathMigrateTransaction(
    currentEditor,
    currentEditor.state.tr,
    mathMigrationRegex,
  );
  if (transaction.docChanged) {
    currentEditor.view.dispatch(transaction);
  }
}

function isAtStart(currentEditor: Editor): boolean {
  const { empty, from } = currentEditor.state.selection;
  return empty && from <= 1;
}

function isAtEnd(currentEditor: Editor): boolean {
  const { empty, to } = currentEditor.state.selection;
  return empty && to >= currentEditor.state.doc.content.size;
}

function isOnFirstLine(currentEditor: Editor): boolean {
  const { empty, from } = currentEditor.state.selection;
  if (!empty) return false;
  const resolved = currentEditor.state.doc.resolve(from);
  const startOfDoc = resolved.start(1);
  const textBefore = currentEditor.state.doc.textBetween(startOfDoc, from, "\n");
  return !textBefore.includes("\n");
}

function isOnLastLine(currentEditor: Editor): boolean {
  const { empty, to } = currentEditor.state.selection;
  if (!empty) return false;
  const docSize = currentEditor.state.doc.content.size;
  const resolved = currentEditor.state.doc.resolve(to);
  const endOfDoc = resolved.end(1);
  const textAfter = currentEditor.state.doc.textBetween(to, Math.min(endOfDoc, docSize), "\n");
  return !textAfter.includes("\n");
}

function emitMarkdown(currentEditor: Editor) {
  emit("update:modelValue", normalizeMarkdown(currentEditor.getMarkdown()));
}

editor.value = new Editor({
  extensions: [
    StarterKit.configure({
      hardBreak: false,
    }),
    HardBreak.configure({
      keepMarks: false,
    }),
    Placeholder.configure({
      placeholder: props.placeholder || "Type a note...",
    }),
    Markdown.configure({
      markedOptions: {
        gfm: true,
      },
    }),
    Mathematics.configure({
      katexOptions: {
        throwOnError: false,
      },
    }),
  ],
  content: props.modelValue || "",
  contentType: "markdown",
  editorProps: {
    attributes: {
      class: "rn-md-note-editor__input",
      spellcheck: "true",
    },
    handleKeyDown: (_view, event) => {
      const currentEditor = editor.value;
      if (!currentEditor) return false;
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        emit("split");
        return true;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        emit("indent", event.shiftKey ? -1 : 1);
        return true;
      }
      if (event.key === "Backspace" && isAtStart(currentEditor)) {
        const hasNoText = currentEditor.getText().trim() === "";
        if (hasNoText && currentEditor.isEmpty) {
          event.preventDefault();
          emit("remove");
          return true;
        }
        if (hasNoText) {
          const { state } = currentEditor;
          const firstChild = state.doc.firstChild;
          const isList = firstChild && (firstChild.type.name === "bulletList" || firstChild.type.name === "orderedList");
          if (isList) {
            return false;
          }
          event.preventDefault();
          emit("remove");
          return true;
        }
      }
      if (event.key === "ArrowUp" && (isAtStart(currentEditor) || isOnFirstLine(currentEditor))) {
        event.preventDefault();
        emit("navigate", -1);
        return true;
      }
      if (event.key === "ArrowDown" && (isAtEnd(currentEditor) || isOnLastLine(currentEditor))) {
        event.preventDefault();
        emit("navigate", 1);
        return true;
      }
      return false;
    },
  },
  onCreate: ({ editor: currentEditor }) => {
    syncMathNodes(currentEditor);
    emitMarkdown(currentEditor);
  },
  onUpdate: ({ editor: currentEditor }) => {
    syncMathNodes(currentEditor);
    emitMarkdown(currentEditor);
  },
});

watch(
  () => props.modelValue,
  (nextValue) => {
    const currentEditor = editor.value;
    if (!currentEditor) return;
    const normalizedIncoming = normalizeMarkdown(nextValue);
    const normalizedCurrent = normalizeMarkdown(currentEditor.getMarkdown());
    if (normalizedIncoming === normalizedCurrent) return;
    currentEditor.commands.setContent(normalizedIncoming, { contentType: "markdown" });
    syncMathNodes(currentEditor);
  },
);

watch(
  () => props.placeholder,
  (nextPlaceholder) => {
    const currentEditor = editor.value;
    if (!currentEditor) return;
    currentEditor.setOptions({
      editorProps: {
        ...currentEditor.options.editorProps,
        attributes: {
          ...(currentEditor.options.editorProps?.attributes || {}),
          class: "rn-md-note-editor__input",
          spellcheck: "true",
          "data-placeholder": nextPlaceholder || "Type a note...",
        },
      },
    });
  },
  { immediate: true },
);

function focusEditor() {
  editor.value?.commands.focus("end");
}

defineExpose({
  focusEditor,
});

onBeforeUnmount(() => {
  editor.value?.destroy();
  editor.value = null;
});
</script>

<style scoped>
.rn-md-note-editor {
  width: 100%;
  min-width: 0;
}

.rn-md-note-editor__content {
  width: 100%;
}

.rn-md-note-editor__content :deep(.ProseMirror) {
  min-height: 22px;
  padding: 0;
  outline: none;
  font-size: 14px;
  line-height: 1.55;
  color: var(--rn-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.rn-md-note-editor__content :deep(.ProseMirror > *:first-child) {
  margin-top: 0;
}

.rn-md-note-editor__content :deep(.ProseMirror > *:last-child) {
  margin-bottom: 0;
}

.rn-md-note-editor__content :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: var(--rn-text-tertiary);
  pointer-events: none;
  float: left;
  height: 0;
}

.rn-md-note-editor__content :deep(.ProseMirror p) {
  margin: 0;
}

.rn-md-note-editor__content :deep(.ProseMirror > p:last-child:has(> .ProseMirror-trailingBreak:only-child)) {
  display: none;
}

.rn-md-note-editor__content :deep(.ProseMirror h1),
.rn-md-note-editor__content :deep(.ProseMirror h2),
.rn-md-note-editor__content :deep(.ProseMirror h3) {
  margin: 0;
  font-weight: 650;
  letter-spacing: -0.03em;
  color: var(--rn-text);
}

.rn-md-note-editor__content :deep(.ProseMirror h1) {
  font-size: 1.3em;
}

.rn-md-note-editor__content :deep(.ProseMirror h2) {
  font-size: 1.15em;
}

.rn-md-note-editor__content :deep(.ProseMirror h3) {
  font-size: 1.05em;
}

.rn-md-note-editor__content :deep(.ProseMirror ul),
.rn-md-note-editor__content :deep(.ProseMirror ol) {
  margin: 0;
  padding-left: 1.2em;
}

.rn-md-note-editor__content :deep(.ProseMirror blockquote) {
  margin: 0;
  padding-left: 0.8em;
  border-left: 2px solid var(--rn-border-strong);
  color: var(--rn-text-secondary);
}

.rn-md-note-editor__content :deep(.ProseMirror code) {
  padding: 1px 5px;
  border-radius: 6px;
  background: rgba(28, 28, 26, 0.06);
  font-size: 12px;
}

.rn-md-note-editor__content :deep(.ProseMirror pre) {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(28, 28, 26, 0.05);
  overflow-x: auto;
}

.rn-md-note-editor__content :deep(.tiptap-mathematics-render) {
  padding: 2px 0;
  color: var(--rn-text);
}

.rn-md-note-editor__content :deep(.tiptap-mathematics-render[data-type="block-math"]) {
  padding: 8px 0;
}
</style>
