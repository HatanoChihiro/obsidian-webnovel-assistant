# OBS Overlay CSS Customization Guide

This guide helps you personalize the appearance of your OBS live stream overlay through custom CSS.

---

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Available CSS Classes](#available-css-classes)
- [Common Customization Examples](#common-customization-examples)
- [Advanced Tips](#advanced-tips)

---

## Quick Start

1. Find the "OBS Overlay" section in plugin settings
2. Scroll to the "Custom CSS" input box
3. Enter your CSS code
4. After saving settings, the OBS browser source will refresh automatically

---

## Available CSS Classes

### Container and Layout

| Class | Description | Default Style |
|-------|-------------|---------------|
| `.overlay-card` | Overlay outer container | Width 280px, border-radius 12px, semi-transparent background |
| `.overlay-header` | Top title area | Contains title and status indicator |
| `.overlay-title` | Title text | Font size 1.1em, bold |
| `.status-dot` | Status indicator | Circle, 8px diameter |
| `.status-dot.active` | Recording status | Green, breathing animation |
| `.status-dot.paused` | Paused status | Gray |

### Time Statistics

| Class | Description | Default Style |
|-------|-------------|---------------|
| `.time-section` | Time statistics area container | Contains all time displays |
| `.time-row` | Single time display row | Left-right layout, label + value |
| `.time-label` | Time label text | e.g. "Total", "Focus", "Slack" |
| `.time-value` | Time value | Monospace font, bold |
| `.time-value.focus` | Focus time value | Green |
| `.time-value.slack` | Slack time value | Orange |

### Goal Progress

| Class | Description | Default Style |
|-------|-------------|---------------|
| `.goal-section` | Goal progress area container | Contains progress bar and values |
| `.goal-label` | Goal label text | e.g. "Chapter Goal", "Daily Goal" |
| `.goal-value` | Goal value container | Contains current value, separator, target value, percentage |
| `.current-val` | Current word count | Large font size, bold |
| `.target-val` | Target word count | Medium font size, semi-transparent |
| `.sep` | Separator `/` | Semi-transparent |
| `.percent` | Percentage text | Accent color |
| `.goal-value.done` | Goal completed status | Applied when percentage ≥ 100% |
| `.progress-bg` | Progress bar background track | Gray, rounded |
| `.progress-fill` | Progress bar fill | Accent color, transition animation |
| `.progress-fill.done` | Progress bar completed status | Green |

### Session Net Gain

| Class | Description | Default Style |
|-------|-------------|---------------|
| `.session-row` | Session net gain row container | Left-right layout |
| `.session-label` | "Session Net Gain" label | Small font size |
| `.session-value` | Net gain word count value | Monospace font, bold |

---

## Common Customization Examples

### 1. Modify Card Size and Border Radius

```css
/* Widen the card */
.overlay-card {
  width: 350px;
}

/* Rounder corners */
.overlay-card {
  border-radius: 20px;
}

/* Square card */
.overlay-card {
  border-radius: 0;
}
```

### 2. Modify Fonts

```css
/* Use a custom font */
.overlay-card {
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
}

/* Increase all font sizes */
.overlay-card {
  font-size: 1.1em;
}

/* Only increase time value font size */
.time-value {
  font-size: 1.5em;
}
```

### 3. Modify Color Theme

```css
/* Dark theme */
.overlay-card {
  background: rgba(20, 20, 30, 0.95);
  color: #e0e0e0;
}

/* Light theme */
.overlay-card {
  background: rgba(255, 255, 255, 0.95);
  color: #333;
}

/* Custom accent color */
.status-dot.active,
.progress-fill {
  background: #ff6b6b; /* Red */
}

.time-value.focus {
  color: #51cf66; /* Green */
}

.time-value.slack {
  color: #ffd43b; /* Yellow */
}
```

### 4. Add Borders and Shadows

```css
/* Add a border */
.overlay-card {
  border: 2px solid rgba(255, 255, 255, 0.3);
}

/* Stronger shadow */
.overlay-card {
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

/* Glow effect */
.overlay-card {
  box-shadow: 0 0 20px rgba(100, 200, 255, 0.5);
}
```

### 5. Modify Progress Bar Style

```css
/* Thicker progress bar */
.progress-bg {
  height: 12px;
}

/* Square progress bar */
.progress-bg,
.progress-fill {
  border-radius: 0;
}

/* Gradient progress bar */
.progress-fill {
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
}

/* Special effect when completed */
.progress-fill.done {
  background: linear-gradient(90deg, #56ab2f 0%, #a8e063 100%);
  box-shadow: 0 0 10px rgba(86, 171, 47, 0.5);
}
```

### 6. Hide Specific Elements

```css
/* Hide the status indicator */
.status-dot {
  display: none;
}

/* Hide the title */
.overlay-title {
  display: none;
}

/* Hide slack time */
.time-row:has(.time-value.slack) {
  display: none;
}

/* Hide the percentage */
.percent {
  display: none;
}
```

### 7. Adjust Spacing and Layout

```css
/* Increase padding */
.overlay-card {
  padding: 24px;
}

/* Increase spacing between sections */
.time-section,
.goal-section,
.session-row {
  margin-bottom: 20px;
}

/* Compact layout */
.time-row {
  margin-bottom: 4px;
}
```

### 8. Add Animation Effects

```css
/* Flash effect when values change */
.time-value,
.session-value {
  transition: all 0.3s ease;
}

/* Progress bar fill animation */
.progress-fill {
  transition: width 0.5s ease-out;
}

/* Card hover effect (won't trigger in OBS, but useful for testing) */
.overlay-card:hover {
  transform: scale(1.02);
  transition: transform 0.2s ease;
}
```

### 9. Enhanced Frosted Glass Effect

```css
/* Stronger frosted glass effect */
.overlay-card {
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}

/* Fully transparent background + frosted glass */
.overlay-card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(30px);
}
```

### 10. Minimalist Style

```css
/* Remove all decoration */
.overlay-card {
  background: transparent;
  box-shadow: none;
  border: none;
}

/* Show only key data */
.overlay-title,
.time-label,
.goal-label {
  display: none;
}

/* Large values */
.time-value,
.session-value {
  font-size: 2em;
  font-weight: bold;
}
```

---

## Advanced Tips

### Using CSS Variables

You can define variables to manage colors uniformly:

```css
.overlay-card {
  --primary-color: #667eea;
  --success-color: #51cf66;
  --warning-color: #ffd43b;
  --text-color: #ffffff;
}

.status-dot.active {
  background: var(--success-color);
}

.progress-fill {
  background: var(--primary-color);
}

.time-value.slack {
  color: var(--warning-color);
}
```

### Responsive Design

Although OBS browser source has a fixed size, you can prepare styles for different dimensions:

```css
/* Small size layout */
@media (max-width: 300px) {
  .overlay-card {
    padding: 12px;
    font-size: 0.9em;
  }
}
```

### Using Pseudo-elements for Decoration

```css
/* Add an icon before the title */
.overlay-title::before {
  content: "📝 ";
}

/* Add tick marks on the progress bar */
.progress-bg::after {
  content: "";
  position: absolute;
  top: 0;
  left: 50%;
  width: 2px;
  height: 100%;
  background: rgba(255, 255, 255, 0.3);
}
```

### Conditional Styles

```css
/* Highlight when focus time exceeds 1 hour */
.time-value.focus[data-minutes="60"] {
  color: #ffd700;
  font-size: 1.2em;
}

/* Celebration effect when goal is completed */
.goal-value.done {
  animation: celebrate 0.5s ease;
}

@keyframes celebrate {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}
```

---

## 💡 Debugging Tips

1. **Test in a browser**: First open `http://127.0.0.1:24816/` in a regular browser to test CSS
2. **Use browser developer tools**: Press F12 to open developer tools for live style debugging
3. **Refresh OBS browser source**: After modifying CSS, right-click the browser source in OBS → Refresh
4. **Save your favorite styles**: Save satisfying CSS to a text file for future use

---

## 📚 Reference Resources

- [CSS Color Reference](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value)
- [CSS Gradient Generator](https://cssgradient.io/)
- [CSS Animation Reference](https://developer.mozilla.org/en-US/docs/Web/CSS/animation)
- [Frosted Glass Effect Generator](https://glassmorphism.com/)

---

## ❓ FAQ

**Q: Why is my CSS not taking effect?**
A: Check that your CSS syntax is correct, make sure selector spellings are accurate, and refresh the browser source in OBS.

**Q: Can I completely hide the background?**
A: Yes, set `background: transparent;` and adjust the transparency slider to 0.

**Q: How can I make text clearer?**
A: Add a text shadow: `text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);`

**Q: Can I use custom fonts?**
A: Yes, but you need to ensure the font is installed on the system where the OBS browser source is running.

---

If you create cool styles, feel free to share them!
