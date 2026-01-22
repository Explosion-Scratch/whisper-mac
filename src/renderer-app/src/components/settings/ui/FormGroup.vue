<template>
  <div class="form-group" :class="{ 'has-error': hasError }">
    <slot></slot>
  </div>
</template>

<script>
/**
 * FormGroup Component
 * Provides a styled container for form elements with global form-group styles.
 * Acts as a wrapper that applies consistent styling to any form content.
 * @component
 */
export default {
  name: "FormGroup",

  props: {
    /**
     * Whether the form group has an error state
     */
    hasError: {
      type: Boolean,
      default: false,
    },
  },
};
</script>

<style>
/*
 * Global form-group styles - NOT scoped so they apply to slotted content.
 * These styles cascade to all form elements inside the FormGroup component.
 */
.form-group {
  margin-bottom: var(--spacing-md, 16px);
  padding: var(--spacing-sm, 8px);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-md, 6px);
  transition: all var(--transition-fast, 0.15s ease);
  position: relative;
}

.form-group:hover {
  border-color: var(--color-border-secondary, #d0d0d0);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.05));
}

.form-group.has-error {
  border-color: var(--color-error, #ff3b30);
  background: rgba(255, 59, 48, 0.02);
}

.form-group label {
  display: flex;
  align-items: center;
  font-size: var(--font-size-md, 13px);
  font-weight: var(--font-weight-medium, 500);
  color: var(--color-text-primary, #333333);
  margin-bottom: var(--spacing-sm, 8px);
  line-height: 1.3;
}

.form-group label .ph-duotone {
  margin-right: var(--spacing-sm, 8px);
  font-size: var(--font-size-lg, 14px);
  color: var(--color-text-secondary, #666666);
  flex-shrink: 0;
}

.form-group .field-description {
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-secondary, #666666);
  margin-bottom: var(--spacing-sm, 8px);
  line-height: 1.4;
}

/* Form Controls inside form-group */
.form-group .form-control {
  width: 100%;
  max-width: 400px;
  padding: 6px 10px;
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-sm, 4px);
  font-size: var(--font-size-md, 13px);
  background: rgba(255, 255, 255, 0.08);
  transition: all var(--transition-fast, 0.15s ease);
  font-family: inherit;
  color: inherit;
}

.form-group .form-control:focus {
  outline: none;
  border-color: var(--color-border-focus, #007aff);
  box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.2);
}

.form-group .form-control:disabled {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-tertiary, #999999);
  cursor: not-allowed;
}

.form-group.has-error .form-control {
  border-color: var(--color-error, #ff3b30);
}

.form-group.has-error .form-control:focus {
  box-shadow: 0 0 0 2px rgba(255, 59, 48, 0.2);
}

/* Checkbox inside form-group */
.form-group .checkbox-container {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px) 0;
}

.form-group .checkbox-container label {
  display: flex;
  align-items: center;
  cursor: pointer;
  margin: 0;
  font-weight: var(--font-weight-medium, 500);
}

.form-group .checkbox {
  width: 18px;
  height: 18px;
  min-width: 18px;
  border: 2px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-sm, 4px);
  appearance: none;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
  position: relative;
  transition: all var(--transition-fast, 0.15s ease);
  margin: 0;
}

.form-group .checkbox:checked {
  background: var(--color-primary, #007aff);
  border-color: var(--color-primary, #007aff);
}

.form-group .checkbox:checked::after {
  content: "✓";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-inverse, #ffffff);
  font-weight: var(--font-weight-bold, 700);
}

.form-group .checkbox:hover {
  border-color: var(--color-border-focus, #007aff);
}

/* Validation Error inside form-group */
.form-group .validation-error {
  color: var(--color-error, #ff3b30);
  font-size: var(--font-size-sm, 12px);
  margin-top: var(--spacing-xs, 4px);
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  .form-group {
    background: rgba(255, 255, 255, 0.02);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .form-group:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .form-group.has-error {
    background: rgba(255, 59, 48, 0.05);
    border-color: #ff3b30;
  }

  .form-group label {
    color: #ececec;
  }

  .form-group label .ph-duotone {
    color: #a2a2a7;
  }

  .form-group .field-description {
    color: #a2a2a7;
  }

  .form-group .form-control {
    background: rgba(255, 255, 255, 0.06);
    color: #ececec;
    border-color: rgba(255, 255, 255, 0.12);
  }

  .form-group .form-control::placeholder {
    color: #666666;
  }

  .form-group .form-control:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .form-group .form-control:focus {
    background: rgba(255, 255, 255, 0.08);
    border-color: #007aff;
    box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.25);
  }

  .form-group .form-control:disabled {
    background: rgba(255, 255, 255, 0.02);
    color: #666666;
  }

  .form-group .checkbox {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .form-group .checkbox:hover {
    border-color: #007aff;
  }

  .form-group .checkbox-container label {
    color: #ececec;
  }
}
</style>
