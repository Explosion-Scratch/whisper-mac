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

| Section | Current Icon | New Icon | Rationale |
|---------|-------------|----------|-----------|
| Transcription | `microphone` | `ph:waveform-duotone` | Better represents audio waveform processing |
| Actions | `lightning` | `ph:flow-arrow-duotone` | Emphasizes action flow and automation |
| Data Management | `database` | `ph:database-duotone` | Maintains consistency with duotone theme |

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

```typescript
interface Rule {
  id: string;
  name: string;
  description?: string;
  examples: Example[];
  if?: RuleCondition[];
  enabled: boolean;
  priority: number;
}

interface Example {
  from: string;
  to: string;
  description?: string;
}

type RuleCondition = 'selection' | 'context' | 'writing_style';
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
- **Rules Summary Bar**: Shows rule count, active rules indicator
- **Quick Preview**: Displays first 2-3 rule names
- **Expand Button**: `ph:caret-down-duotone` to reveal full editor
- **Quick Actions**: Add rule (+), import/export menu (⋯)

#### Expanded State
- **Rules Grid**: 2-column responsive layout of rule cards
- **Rule Cards**: Compact cards showing rule name, examples count, conditions
- **Floating Action Button**: Persistent "Add Rule" button
- **Filter/Search Bar**: Quick filtering by name or condition type

### Rule Card Design

Each rule card follows a compact, scannable design:

```
┌─────────────────────────────────────┐
│ ⚡ Remove Filler Words        [⋯]  │
│ ─────────────────────────────────── │
│ 📝 3 examples • Context aware      │
│ ├ "uh, um" → ""                    │
│ ├ "[coughing]" → ""                │
│ └ "I think, maybe" → "I think"     │
│ ─────────────────────────────────── │
│ 🏷️ selection, context             │
│ [○ Enabled] [Edit] [Delete]        │
└─────────────────────────────────────┘
```

### Rule Creation/Editing Modal

Modal dialog with tabbed interface for complex rule configuration:

```mermaid
graph TD
    A[Rule Editor Modal] --> B[Basic Info Tab]
    A --> C[Examples Tab]
    A --> D[Conditions Tab]
    A --> E[Preview Tab]
    
    B --> F[Rule Name Input]
    B --> G[Description Textarea]
    B --> H[Priority Slider]
    
    C --> I[Examples List Editor]
    I --> J[Add Example Button]
    I --> K[Example Pairs Grid]
    
    K --> L[From Input]
    K --> M[To Input]
    K --> N[Remove Example]
    
    D --> O[Condition Checkboxes]
    O --> P[Selection Context]
    O --> Q[Writing Style Context]
    O --> R[General Context]
    
    E --> S[Live Preview Panel]
    S --> T[Sample Text Input]
    S --> U[Transformed Output]
```

### Responsive Design Patterns

#### Desktop Layout (>768px)
- 2-column rule card grid
- Side-by-side modal layout for editing
- Expanded quick actions toolbar

#### Compact Layout (≤768px)
- Single-column rule card stack
- Full-width modals with collapsible sections
- Simplified quick actions menu

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

### Validation and Error Handling

```mermaid
graph TD
    A[Rule Input] --> B[Structure Validation]
    B --> C{Valid Structure?}
    C -->|No| D[Show Structure Errors]
    C -->|Yes| E[Example Validation]
    E --> F{Valid Examples?}
    F -->|No| G[Show Example Errors]
    F -->|Yes| H[Condition Validation]
    H --> I{Valid Conditions?}
    I -->|No| J[Show Condition Errors]
    I -->|Yes| K[Save Rule]
    
    D --> L[Error Toast]
    G --> L
    J --> L
    L --> M[Focus Problem Field]
```

## Technical Implementation

### Component Structure

#### RulesEditor Component
```typescript
interface RulesEditorProps {
  value: Rule[];
  onChange: (rules: Rule[]) => void;
  compact?: boolean;
  maxRules?: number;
}

interface RulesEditorState {
  expanded: boolean;
  selectedRule: Rule | null;
  editingRule: Rule | null;
  filter: string;
  showImportDialog: boolean;
}
```

#### Rule Validation System
```typescript
interface RuleValidationResult {
  valid: boolean;
  errors: {
    field: string;
    message: string;
  }[];
  warnings: {
    field: string;
    message: string;
  }[];
}

interface RuleValidator {
  validateStructure(rule: Rule): RuleValidationResult;
  validateExamples(examples: Example[]): RuleValidationResult;
  validateConditions(conditions: RuleCondition[]): RuleValidationResult;
  validateUniqueness(rule: Rule, existingRules: Rule[]): RuleValidationResult;
}
```

### Settings Schema Extension

```typescript
// Extension to existing SettingsSchema.ts
{
  key: "ai.rules",
  type: "rules-editor" as const,
  label: "Text Rules",
  description: "Configure rules for text transformation and processing",
  defaultValue: loadDefaultRules(),
  validation: (value: Rule[]) => {
    const validator = new RuleValidator();
    const results = value.map(rule => validator.validateStructure(rule));
    const errors = results.flatMap(r => r.errors);
    return errors.length > 0 ? errors.map(e => e.message).join(", ") : null;
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

### Rule State Flow

```mermaid
stateDiagram-v2
    [*] --> Collapsed
    Collapsed --> Expanded: Click expand
    Expanded --> Collapsed: Click collapse
    
    Expanded --> CreatingRule: Click add rule
    CreatingRule --> Expanded: Save/Cancel
    
    Expanded --> EditingRule: Click edit rule
    EditingRule --> Expanded: Save/Cancel
    
    Expanded --> ConfirmingDelete: Click delete rule
    ConfirmingDelete --> Expanded: Confirm/Cancel
    
    state CreatingRule {
        [*] --> BasicInfo
        BasicInfo --> Examples: Next
        Examples --> Conditions: Next
        Conditions --> Preview: Next
        Preview --> [*]: Save
    }
    
    state EditingRule {
        [*] --> LoadRule
        LoadRule --> BasicInfo
        BasicInfo --> Examples
        Examples --> Conditions
        Conditions --> Preview
        Preview --> [*]: Save
    }
```

### Data Persistence Strategy

```mermaid
graph TD
    A[User Action] --> B[Component State Update]
    B --> C[Validation Check]
    C --> D{Valid?}
    D -->|No| E[Show Validation Error]
    D -->|Yes| F[Update Settings Store]
    F --> G[Persist to settings.json]
    G --> H[Broadcast Settings Update]
    H --> I[Update UI State]
    
    E --> J[Focus Error Field]
    
    F --> K[Backup Previous State]
    K --> L{Save Success?}
    L -->|No| M[Restore Backup]
    L -->|Yes| N[Clear Backup]
```

## User Experience Flows

### Rule Creation Workflow

```mermaid
journey
    title Creating a New Text Rule
    section Discovery
      Open AI Enhancement settings: 5: User
      Notice rules summary: 4: User
      Click expand rules editor: 5: User
    section Creation
      Click Add Rule button: 5: User
      Enter rule name and description: 4: User
      Add example transformations: 3: User
      Select applicable conditions: 4: User
      Preview rule effect: 5: User
    section Completion
      Save new rule: 5: User
      See rule in list: 5: User
      Test rule with sample text: 4: User
```

### Rule Management Workflow

```mermaid
journey
    title Managing Existing Rules
    section Review
      View rules in compact list: 5: User
      Read rule descriptions: 4: User
      Check enabled/disabled status: 4: User
    section Modification
      Click edit rule: 5: User
      Modify examples or conditions: 4: User
      Save changes: 5: User
    section Organization
      Enable/disable rules: 5: User
      Delete unused rules: 4: User
      Reorder by priority: 3: User
```

## Testing Strategy

### Component Testing

```mermaid
graph TD
    A[Unit Tests] --> B[Rule Validation Logic]
    A --> C[Component Rendering]
    A --> D[State Management]
    
    E[Integration Tests] --> F[Settings Integration]
    E --> G[IPC Communication]
    E --> H[File Persistence]
    
    I[User Testing] --> J[Rule Creation Flow]
    I --> K[Rule Editing Experience]
    I --> L[Import/Export Functionality]
    
    M[Performance Tests] --> N[Large Rule Sets]
    M --> O[Real-time Validation]
    M --> P[Memory Usage]
```

### Test Scenarios

#### Rule Creation
- ✅ Create rule with valid name and examples
- ✅ Validate required fields
- ❌ Prevent duplicate rule names
- ❌ Handle invalid example formats
- ✅ Save rule with conditions
- ✅ Cancel creation workflow

#### Rule Management
- ✅ Edit existing rule properties
- ✅ Add/remove examples from rule
- ✅ Toggle rule enabled state
- ✅ Delete rule with confirmation
- ✅ Bulk enable/disable operations
- ✅ Import/export rule sets

#### Integration
- ✅ Persist rules to settings.json
- ✅ Sync with AI transformation pipeline
- ✅ Handle settings validation errors
- ✅ Restore from backup on failure
- ✅ Update UI on external settings changes

## Performance Considerations

### Optimization Strategies

```mermaid
graph TD
    A[Performance Optimization] --> B[Virtual Scrolling]
    A --> C[Lazy Loading]
    A --> D[Debounced Validation]
    A --> E[Memoized Components]
    
    B --> F[Large Rule Lists]
    C --> G[Modal Content]
    D --> H[Real-time Validation]
    E --> I[Rule Card Rendering]
    
    J[Memory Management] --> K[Efficient State Updates]
    J --> L[Component Cleanup]
    J --> M[Event Listener Management]
```

### Scalability Limits

| Aspect | Recommended Limit | Performance Impact |
|--------|------------------|-------------------|
| Total Rules | 50-100 | Minimal |
| Examples per Rule | 10-20 | Low |
| Rule Name Length | 100 characters | None |
| Example Text Length | 500 characters | Low |
| Concurrent Editors | 1 | None |

## Error Handling

### Error Classification

```mermaid
graph TD
    A[Error Types] --> B[Validation Errors]
    A --> C[Persistence Errors]
    A --> D[UI Errors]
    A --> E[System Errors]
    
    B --> F[Invalid Rule Structure]
    B --> G[Duplicate Names]
    B --> H[Invalid Examples]
    
    C --> I[File Write Failures]
    C --> J[Settings Corruption]
    C --> K[Backup Failures]
    
    D --> L[Component Crashes]
    D --> M[Rendering Issues]
    D --> N[State Inconsistencies]
    
    E --> O[Memory Limitations]
    E --> P[Permission Issues]
    E --> Q[IPC Communication Failures]
```

### Recovery Mechanisms

```mermaid
graph TD
    A[Error Detected] --> B{Error Type}
    
    B -->|Validation| C[Show Inline Error]
    C --> D[Focus Problem Field]
    C --> E[Provide Correction Hints]
    
    B -->|Persistence| F[Show Error Toast]
    F --> G[Attempt Auto-recovery]
    G --> H[Restore from Backup]
    
    B -->|UI| I[Component Error Boundary]
    I --> J[Fallback UI]
    J --> K[Report Error]
    
    B -->|System| L[Graceful Degradation]
    L --> M[Disable Advanced Features]
    L --> N[Maintain Core Functionality]
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

### Data Format Evolution

```typescript
// Version 1: Current JSON array format
type RulesV1 = Array<{
  name: string;
  examples: Array<{from: string; to: string}>;
  if?: string[];
}>;

// Version 2: Enhanced rule objects with metadata
type RulesV2 = Array<{
  id: string;
  name: string;
  description?: string;
  examples: Array<{from: string; to: string; description?: string}>;
  if?: RuleCondition[];
  enabled: boolean;
  priority: number;
  version: 2;
}>;
```

The rules editor design provides a compact, user-friendly interface for managing text transformation rules while maintaining seamless integration with the existing AI enhancement settings. The design prioritizes discoverability, ease of use, and powerful functionality without overwhelming the user interface.