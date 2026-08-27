// src/lib/design/tokens.js
// Centralized design tokens for the QuickTeam UI Kit
// Single source of truth for colors, typography, spacing, and sizing

export const colors = {
  // Core/semantic colors
  dark: '#1f1f1f',        // Primary dark (buttons, text, sidebar)
  light: '#f4f4f5',       // Global canvas/surface background (Zinc-grey)
  elementLight: '#f4f4f5', // Previous element light grey (interactive components)
  surface: '#ffffff',     // White surfaces (cards, modals, content bg)
  border: {
    primary: '#e9e9e9',
    secondary: '#efefef',
    light: '#f0f0f0',
  },
  text: {
    primary: '#1f1f1f',   // Dark text
    muted: '#9a9a9a',     // Hints, placeholders, secondary
    inactive: '#cfcfcf',  // Disabled, very light
  },
  hover: {
    dark: '#303030',      // Dark button hover
    light: '#ebebeb',     // Light button hover
  },

  // Status/semantic colors
  status: {
    success: '#10b981',
    warning: '#eab308',
    danger: '#ef4444',
    error: '#f97316',
    info: '#6366f1',
    cyan: '#0891b2',
    purple: '#7c3aed',
  },

  // Status backgrounds (light tints)
  statusBg: {
    success: '#ecfdf5',
    warning: '#fefce8',
    danger: '#fef2f2',
    error: '#fff7ed',
    info: '#eef2ff',
    cyan: '#ecfeff',
    purple: '#f5f3ff',
  },

  // Priority colors
  priority: {
    blocker: '#ef4444',   // Red
    high: '#f97316',      // Orange
    medium: '#eab308',    // Yellow
    low: '#9a9a9a',       // Gray
  },

  // Button color variants - Primary style (dark bg)
  buttonPrimary: {
    dark: { bg: '#1f1f1f', text: '#ffffff', hover: '#303030', border: '#0a0a0a' },
    red: { bg: '#ef4444', text: '#ffffff', hover: '#dc2626', border: '#b91c1c' },
  },

  // Button color variants - Secondary style (light bg)
  buttonSecondary: {
    dark: { bg: '#f5f5f5', text: '#1f1f1f', hover: '#e9e9e9', border: '#d1d1d1' },
    red: { bg: '#fee2e2', text: '#7f1d1d', hover: '#fecaca', border: '#fca5a5' },
  },

  // Button color variants - Ghost style (transparent)
  buttonGhost: {
    dark: { bg: 'transparent', text: '#1f1f1f', border: '#1f1f1f', hover: '#f4f4f5' },
    red: { bg: 'transparent', text: '#ef4444', border: '#ef4444', hover: '#fee2e2' },
  },
};

export const typography = {
  // Font families
  fontFamily: {
    primary: 'Inter, sans-serif',
    secondary: 'Roboto Condensed, sans-serif',
  },

  // Font sizes and weights (in pixels)
  sizes: {
    h1: { size: '24px', weight: 700 },      // Page title
    h2: { size: '18px', weight: 700 },      // Section title
    h3: { size: '18px', weight: 700 },      // Subsection
    h4: { size: '16px', weight: 700 },      // Small title
    body: { size: '14px', weight: 600 },    // Primary text
    sm: { size: '13px', weight: 600 },      // Secondary text
    xs: { size: '12px', weight: 600 },      // Small text
    label: { size: '11px', weight: 700 },   // Form labels, badges
    tag: { size: '9px', weight: 700 },      // Type tags, tiny text
  },
};

// Live semantic contract. These references point at globals.css instead of
// duplicating geometry/typography values in JavaScript. Use them for inline
// styles or documentation that cannot consume the semantic CSS classes.
export const semanticContract = {
  controls: {
    sm: 'var(--ui-control-sm)',
    md: 'var(--ui-control-md)',
    lg: 'var(--ui-control-lg)',
    workspaceGuard: 'var(--ui-composition-guard)',
    metricEditor: 'var(--ui-composition-metric)',
  },
  radii: {
    action: 'var(--ui-radius-action)',
    field: 'var(--ui-radius-field)',
    inset: 'var(--ui-radius-inset)',
    surface: 'var(--ui-radius-surface)',
    dialog: 'var(--ui-radius-dialog)',
  },
  typography: {
    pageTitle: 'var(--ui-type-page-title-size)',
    detailTitle: 'var(--ui-type-detail-title-size)',
    sectionTitle: 'var(--ui-type-section-title-size)',
    dialogTitle: 'var(--ui-type-dialog-title-size)',
    cardTitle: 'var(--ui-type-card-title-size)',
    itemTitle: 'var(--ui-type-item-title-size)',
    eyebrow: 'var(--ui-type-eyebrow-size)',
  },
};

export const spacing = {
  // Fixed spacing values (in pixels)
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  xxl: '24px',
  xxxl: '32px',

  // Common composite spacing
  pagePadding: '32px',    // Content padding (px-8)
  sectionGap: '24px',     // Gap between sections
  componentGap: {
    tight: '6px',
    default: '8px',
    loose: '12px',
    section: '16px',
  },
};

export const sizing = {
  // Button heights
  button: {
    sm: '28px',           // h-7
    md: '32px',           // h-8
    lg: '36px',           // h-9 (default/primary)
  },

  // Named input heights. Context-specific compositions may still be taller
  // when they contain another control (for example the invite field + button).
  input: {
    sm: '28px',
    md: '32px',
    lg: '36px',
  },
  control: '36px',        // Standard height for controls (inputs, selects, tabs)

  // Border radius
  radius: {
    sm: '5px',            // Badges
    md: '8px',            // Buttons
    lg: '10px',           // Inputs, tabs
    xl: '12px',           // Cards
    xxl: '14px',          // Select dropdowns
    full: '16px',         // Common card radius (rounded-2xl)
    max: '24px',          // Modals
  },

  // Avatar sizes
  avatar: {
    sm: '28px',
    md: '32px',
    lg: '40px',
    xl: '48px',
  },

  // Icon sizes
  icon: {
    xs: '12px',
    sm: '14px',
    md: '18px',
    lg: '20px',
    xl: '24px',
  },

  // Checkbox & Radio sizes
  checkbox: {
    sm: '16px',
    md: '18px',
    lg: '20px',
  },

  // Progress bar heights
  progress: {
    sm: '4px',
    md: '6px',
    lg: '8px',
  },

  // Badge sizes
  badge: {
    sm: '16px',
    md: '20px',
    lg: '24px',
  },

  // List item heights (comfortable touch targets)
  listItem: {
    compact: '40px',      // For dense lists
    default: '48px',      // Standard list item
    spacious: '56px',     // For card-like items
  },

  // Toggle switch sizes
  toggle: {
    sm: '24px',
    md: '32px',
    lg: '36px',
  },
};

export const shadows = {
  none: 'none',
  sm: '0 1px 4px rgba(0, 0, 0, 0.04)',
  md: '0 2px 6px rgba(0, 0, 0, 0.04)',
  lg: '0 4px 24px rgba(0, 0, 0, 0.02)',
  xl: '0 8px 30px rgba(0, 0, 0, 0.08)',
  drag: '0 18px 44px rgba(0, 0, 0, 0.14)',
  modal: '0 25px 50px rgba(0, 0, 0, 0.15)',
};

export const transitions = {
  fast: '100ms',
  default: '200ms',
  slow: '300ms',
  timing: 'ease-in-out',
};

export const zIndex = {
  // Layering scale
  default: 0,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modal: 40,
  tooltip: 50,
  notification: 10000,
};

export const states = {
  // Opacity for disabled/inactive states
  disabled: 0.5,
  hover: 1,
  active: 1,
  focus: 1,

  // State colors
  focus: {
    ring: '2px',
    color: '#1f1f1f',
    offset: '1px',
  },
};

export const cardVariants = {
  // Card padding options
  padding: {
    compact: '12px',
    default: '16px',
    spacious: '20px',
    extra: '24px',
  },

  // Card border options
  border: {
    none: 'none',
    subtle: `1px solid ${colors.border.light}`,
    standard: `1px solid ${colors.border.primary}`,
    strong: `2px solid ${colors.dark}`,
  },
};

export const animations = {
  // Keyframe names for common animations
  spin: 'spin',
  pulse: 'pulse',
  bounce: 'bounce',
  slideIn: 'slideIn',
  fadeIn: 'fadeIn',
  slideUp: 'slideUp',
  // Toggle switch animations
  toggleSlide: 'toggleSlide',
  // Modal animations
  scaleIn: 'scaleIn',
  fadeInDown: 'fadeInDown',
  // Toast animations
  slideInRight: 'slideInRight',
  slideOutRight: 'slideOutRight',
};

// Preset combinations for common patterns
export const presets = {
  button: {
    primary: {
      height: sizing.button.lg,          // 36px
      padding: '0 20px',
      borderRadius: sizing.radius.lg,    // 10px
      fontSize: typography.sizes.xs.size,
      fontWeight: typography.sizes.xs.weight,
      bg: colors.dark,
      text: colors.surface,
    },
    secondary: {
      height: sizing.button.lg,          // 36px
      padding: '0 20px',
      borderRadius: sizing.radius.lg,    // 10px
      fontSize: typography.sizes.xs.size,
      fontWeight: typography.sizes.xs.weight,
      bg: colors.light,
      text: colors.dark,
    },
    action: {
      height: sizing.button.md,          // 32px
      padding: '0 16px',
      borderRadius: sizing.radius.md,    // 8px
      fontSize: typography.sizes.xs.size,
      fontWeight: typography.sizes.xs.weight,
    },
  },
  control: {
    height: sizing.control,              // 36px
    borderRadius: sizing.radius.lg,      // 10px
    fontSize: typography.sizes.sm.size,
  },
  surface: {
    borderRadius: sizing.radius.full,    // 16px
    shadow: shadows.sm,
    border: `1px solid ${colors.border.primary}`,
  },
  modal: {
    borderRadius: sizing.radius.max,     // 24px
    shadow: shadows.modal,
  },
};
