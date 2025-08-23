# Rules Editor Design

## Overview

The rules editor is a compact and user-friendly interface for managing text transformation rules within the AI enhancement settings section. It allows users to create, edit, and manage custom rules that control how the AI processes and transforms transcribed text, providing a streamlined alternative to manual JSON editing.

## Repository Type

Desktop Application - Electron-based macOS dictation application with TypeScript backend and HTML/JavaScript frontend.

## Architecture

### Component Integration

The rules editor integrates seamlessly into the existing settings architecture without creating a separate section, appearing as a specialized field type within the AI enhancement section.

```mermaid
graph TD
    A[Settings Window] --> B[AI Enhancement Section]
    B --> C[AI Configuration Fields]
    B --> D[Rules Editor Component]
    D --> E[Rule List View]
    D --> F[Rule Creation Modal]
    D --> G[Rule Editing Modal]
    E --> H[Individual Rule Cards]
    H --> I[Rule Preview]
    H --> J[Edit/Delete Actions]
```

### Settings Schema Integration

The rules editor extends the existing settings schema by introducing a new field type `rules-editor` within the AI enhancement section:

```mermaid
classDiagram
    class SettingsField {
        +string key
        +string type
        +string label
        +string description
        +any defaultValue
        +validation(value): string
    }

    class RulesEditorField {
        +type: "rules-editor"
        +key: "ai.rules"
        +label: "Text Rules"
        +description: "Configure rules for text transformation"
        +defaultValue: Rule[]
        +validation: validateRulesStructure()
    }

    class Rule {
        +string name
        +Example[] examples
        +string[] if?
        +boolean enabled
    }

    class Example {
        +string from
        +string to
    }

    SettingsField <|-- RulesEditorField
    RulesEditorField --> Rule
    Rule --> Example
```

### Icon Updates

Updated section icons following Phosphor Icons duotone design system:

| Section         | Current Icon | New Icon                | Rationale                                   |
| --------------- | ------------ | ----------------------- | ------------------------------------------- |
| Transcription   | `microphone` | `ph:waveform-duotone`   | Better represents audio waveform processing |
| Actions         | `lightning`  | `ph:flow-arrow-duotone` | Emphasizes action flow and automation       |
| Data Management | `database`   | `ph:database-duotone`   | Maintains consistency with duotone theme    |

## Component Architecture

### Rules Editor Component

```mermaid
graph TD
    A[RulesEditor Component] --> B[RulesListView]
    A --> C[RuleFormModal]
    A --> D[ConfirmationDialog]

    B --> E[RuleCard Components]
    E --> F[RulePreview]
    E --> G[RuleControls]

    C --> H[BasicInfoForm]
    C --> I[ExamplesEditor]
    C --> J[ConditionsSelector]

    F --> K[ExamplesList]
    F --> L[ConditionsDisplay]

    G --> M[EditButton]
    G --> N[DeleteButton]
    G --> O[EnableToggle]
```

### Rule Data Structure

Keeping the existing rule format from rules.json:

```typescript
interface Rule {
  name: string;
  examples: Example[];
  if?: string[];
}

interface Example {
  from: string;
  to: string;
}
```

### UI Component Hierarchy

```mermaid
graph TD
    A[AI Enhancement Section] --> B[Standard AI Fields]
    A --> C[Rules Editor Field]

    C --> D[Compact Rules Display]
    D --> E[Rules Summary Bar]
    D --> F[Quick Actions]

    E --> G[Rule Count Badge]
    E --> H[Active Rules Indicator]

    F --> I[Add Rule Button]
    F --> J[Import/Export Menu]
    F --> K[Reset to Defaults]

    C --> L[Expanded Rules Editor]
    L --> M[Rules List]
    L --> N[Rule Details Panel]

    M --> O[Rule Card Grid]
    O --> P[Individual Rule Cards]

    P --> Q[Rule Name & Description]
    P --> R[Examples Preview]
    P --> S[Conditions Tags]
    P --> T[Rule Actions Menu]
```

## User Interface Design

### Compact Integration Approach

The rules editor appears as a specialized component within the AI enhancement section, maintaining visual consistency with other setting fields while providing rich functionality:

#### Collapsed State (Default)

- **Rules Summary Bar**: Shows rule count
- **Quick Preview**: Displays first 2-3 rule names
- **Expand Button**: `ph:caret-down-duotone` to reveal full editor
- **Quick Actions**: Add rule (+) button

#### Expanded State

- **Rules List**: Simple single-column list of rule cards
- **Rule Cards**: Basic cards showing rule name and examples count
- **Add Rule Button**: Simple "Add Rule" button at the bottom

### Rule Card Design

Each rule card follows a simple design:

```
┌─────────────────────────────────────┐
│ Remove Filler Words           [Edit]│
│ ─────────────────────────────────── │
│ 📝 3 examples                      │
│ 🏷️ selection, context             │
│ [Delete]                           │
└─────────────────────────────────────┘
```

### Rule Creation/Editing Modal

Simple modal dialog with basic form:

```mermaid
graph TD
    A[Rule Editor Modal] --> B[Rule Name Input]
    A --> C[Examples List Editor]
    A --> D[Conditions Checkboxes]

    C --> E[Add Example Button]
    C --> F[Example Pairs List]

    F --> G[From Input]
    F --> H[To Input]
    F --> I[Remove Example]

    D --> J[Selection Checkbox]
    D --> K[Context Checkbox]
    D --> L[Writing Style Checkbox]
```

### Simple Layout

- Single-column rule card list
- Full-width modals for editing
- Basic action buttons

## Data Flow Architecture

### Settings Integration Flow

```mermaid
sequenceDiagram
    participant UI as Rules Editor UI
    participant Preload as Settings Preload
    participant Service as Settings Service
    participant Manager as Settings Manager
    participant Store as File Storage

    UI->>Preload: updateRules(rules)
    Preload->>Service: ipcRenderer.invoke("settings:save", {ai: {rules}})
    Service->>Manager: settingsManager.set("ai.rules", rules)
    Manager->>Manager: validateRulesStructure(rules)
    Manager->>Store: writeFileSync(settings.json)
    Store-->>Manager: success
    Manager-->>Service: updated settings
    Service-->>Preload: settings update broadcast
    Preload-->>UI: settings updated event
```

### Rule Processing Pipeline

```mermaid
graph LR
    A[Raw Transcription] --> B[Rule Matcher]
    B --> C[Priority Sorter]
    C --> D[Condition Evaluator]
    D --> E[Example Applicator]
    E --> F[Transformed Text]

    G[Context Data] --> D
    H[Selection State] --> D
    I[Writing Style] --> D

    J[Rule Database] --> B
    J --> C
```

### Simple Validation

```mermaid
graph TD
    A[Rule Input] --> B[Basic Validation]
    B --> C{Valid?}
    C -->|No| D[Show Error Message]
    C -->|Yes| E[Save Rule]

    D --> F[Focus Problem Field]
```

## Technical Implementation

### Component Structure

#### RulesEditor Component

```typescript
interface RulesEditorProps {
  value: Rule[];
  onChange: (rules: Rule[]) => void;
}

interface RulesEditorState {
  expanded: boolean;
  editingRule: Rule | null;
  editingIndex: number | null;
}
```

### Settings Schema Extension

Minimal change to existing SettingsSchema.ts - just change the existing rules field type:

```typescript
// Change existing rules field in ai section
{
  key: "ai.rules",
  type: "rules-editor" as const,
  label: "Text Rules",
  description: "Configure rules for text transformation and processing",
  defaultValue: loadDefaultRules(),
  validation: (value) => {
    // Keep existing validation logic
  }
}
```

### Icon Implementation

```typescript
// Icon mapping updates for settings sections
const SECTION_ICONS = {
  transcription: "ph:waveform-duotone",
  actions: "ph:flow-arrow-duotone",
  data: "ph:database-duotone",
  ai: "flash", // Keep existing for AI enhancement
  // ... other sections
};
```

## State Management

### Simple State Flow

```mermaid
stateDiagram-v2
    [*] --> Collapsed
    Collapsed --> Expanded: Click expand
    Expanded --> Collapsed: Click collapse

    Expanded --> EditingRule: Click edit/add rule
    EditingRule --> Expanded: Save/Cancel

    Expanded --> ConfirmingDelete: Click delete rule
    ConfirmingDelete --> Expanded: Confirm/Cancel
```

### Simple Data Persistence

```mermaid
graph TD
    A[User Action] --> B[Update Rules Array]
    B --> C[Save to Settings]
    C --> D[Update UI]
```

## User Experience Flows

### Simple Rule Creation

```mermaid
journey
    title Creating a New Text Rule
    section Setup
      Open AI Enhancement settings: 5: User
      Click expand rules editor: 5: User
    section Creation
      Click Add Rule button: 5: User
      Enter rule name: 4: User
      Add example transformations: 4: User
      Select conditions if needed: 3: User
      Save new rule: 5: User
```

### Simple Rule Management

```mermaid
journey
    title Managing Existing Rules
    section Review
      View rules in simple list: 5: User
      See rule names and example counts: 4: User
    section Modification
      Click edit rule: 5: User
      Modify examples or conditions: 4: User
      Save changes: 5: User
      Delete unused rules: 4: User
```

## Testing Strategy

### Basic Testing

#### Rule Creation

- ✅ Create rule with name and examples
- ✅ Validate required fields
- ✅ Save rule with conditions
- ✅ Cancel creation workflow

#### Rule Management

- ✅ Edit existing rule properties
- ✅ Add/remove examples from rule
- ✅ Delete rule with confirmation

#### Integration

- ✅ Persist rules to settings.json
- ✅ Handle basic validation errors

## Error Handling

### Simple Error Handling

```mermaid
graph TD
    A[Error Detected] --> B{Error Type}

    B -->|Validation| C[Show Error Message]
    C --> D[Focus Problem Field]

    B -->|Save| E[Show Error Toast]
    E --> F[Keep Current State]
```

## Migration Strategy

### Backward Compatibility

The rules editor maintains backward compatibility with the existing textarea-based rules configuration:

```mermaid
graph TD
    A[Existing JSON Rules] --> B[Migration Detector]
    B --> C{Format Valid?}
    C -->|Yes| D[Parse to Rule Objects]
    C -->|No| E[Show Migration Wizard]

    D --> F[Validate Rule Structure]
    F --> G{Structure Valid?}
    G -->|Yes| H[Enable Rules Editor]
    G -->|No| I[Show Conversion Errors]

    E --> J[Guide User Through Conversion]
    J --> K[Manual Rule Creation]
    K --> H

    I --> L[Provide Fix Suggestions]
    L --> M[User Fixes Issues]
    M --> F
```

### Keeping Existing Format

The rules editor maintains the existing JSON array format exactly as it is:

```typescript
type Rules = Array<{
  name: string;
  examples: Array<{ from: string; to: string }>;
  if?: string[];
}>;
```

The rules editor design provides a simple, user-friendly interface for managing text transformation rules while maintaining the existing data format and minimizing code changes.
