# OBS Overlay CSS Customization Guide

This guide covers desktop OBS browser sources. The plugin serves a local statistics page; its CSS is separate from Obsidian themes and CSS snippets. See the [Chinese guide](OBS_OVERLAY_CSS_GUIDE.md).

## Contents

- [Connecting and Refreshing](#connecting-and-refreshing)
- [Available Selectors](#available-selectors)
- [Ready-to-Use Examples](#ready-to-use-examples)
- [Custom CSS Limitations](#custom-css-limitations)
- [FAQ](#faq)

## Connecting and Refreshing

1. Open **Settings → WebNovel Assistant → Data Output → OBS Overlay** and enable the overlay. The default port is `24816`. Enabling starts the service immediately; changing the port restarts it automatically.
2. Copy the URL and paste it into a browser source in OBS on the same computer. The default is `http://127.0.0.1:24816/`.
3. Start with a **400×700px** browser source, then adjust for enabled items. The default card is 280px wide with an additional 1.1 scale factor; a small source can crop it.
4. Choose the theme, background opacity, and visible statistics in plugin settings. Paste the examples you need into **Custom CSS**. Examples are independent; later rules win when the same property is repeated.
5. After changing CSS, the theme, or visibility toggles, **manually refresh the OBS browser source**. Statistics update automatically, but the page structure and styles do not reload automatically.

The page requests local `/api/stats` data, then updates again about 500ms after each request finishes. The service listens only on `127.0.0.1`, so OBS and Obsidian must run on the same computer. Closing Obsidian or disabling the overlay stops updates.

## Available Selectors

Disabling a statistic removes its nodes from the page. CSS cannot display an item that was not generated; enable it in settings first.

| Selector | Purpose |
|---|---|
| `.overlay-card` | Card shell; defaults to 280px wide, 14px radius, 20px 24px padding |
| `.overlay-title` | Top status area; currently contains no title text |
| `.status-dot`, `.status-dot.active`, `.status-dot.paused` | 12px indicator, tracking, and paused states |
| `.time-row` | Time statistics container holding `.time-item` elements |
| `.time-item`, `.time-label`, `.time-value` | One time statistic, its label, and value |
| `.time-value.focus`, `.time-value.slack` | Focus and slack values |
| `#totalTime`, `#focusTime`, `#slackTime` | Individual total, focus, and slack values |
| `.divider` | Divider below the time section |
| `.goal-row`, `.goal-label`, `.goal-value` | Chapter/daily goal row, label, and value group |
| `.current-val`, `.target-val`, `.sep`, `.percent` | Current count, target, slash, and percentage |
| `#todayWords`, `#goalValue`, `#percentText` | Current chapter count, goal, and percentage; todayWords is the chapter count |
| `#dailyWords`, `#dailyGoalValue`, `#dailyPercentText` | Daily net count, daily goal, and percentage |
| `.progress-bg`, `.progress-fill`, `.progress-fill.done` | Progress track, fill, and completed state |
| `#progressFill`, `#dailyProgressFill` | Chapter and daily progress fills |
| `.session-row`, `.session-row .val` | Session statistics row and value |
| `#sessionWords`, `#sessionSpeed` | Session net count and writing speed; speed is hidden by default |

## Ready-to-Use Examples

### Card Size and Typography

```css
.overlay-card {
  width: 340px;
  border-radius: 18px;
  padding: 18px;
  font-family: "Segoe UI", sans-serif;
}
.time-value {
  font-size: 28px;
}
.goal-value .current-val {
  font-size: 30px;
}
```

### Colors and Borders

```css
.overlay-card {
  background: rgba(20, 24, 32, 0.9);
  color: #eeeeee;
  border: 1px solid #667788;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
}
.time-label,
.session-row .val {
  color: #eeeeee;
}
.time-value.focus {
  color: #8cc7ff;
}
.time-value.slack {
  color: #ffc078;
}
.progress-fill {
  background: linear-gradient(90deg, #667eea, #90b5ff);
}
.progress-fill.done {
  background: #76c893;
}
```

### Compact Layout

```css
.overlay-card {
  padding: 12px;
  gap: 4px;
}
.time-row {
  gap: 6px;
}
.time-value {
  font-size: 20px;
}
.percent,
.divider {
  display: none;
}
```

Use plugin visibility settings to hide entire statistics. This example hides percentages and dividers without changing the data.

### Transparent Background

```css
.overlay-card {
  background: transparent;
  border: none;
  box-shadow: none;
}
```

Also set plugin **Background Opacity** to `0` to remove the default frosted background effect. Text and progress bars remain visible over your stream.

## Custom CSS Limitations

The plugin filters this input; it is not a full stylesheet editor:

- Use simple class or ID selectors as above, with one property per line.
- Common supported properties include colors, backgrounds, font size/family, width/height, overall `margin` / `padding`, borders, radius, shadows, display, Flex/Grid, and `gap`.
- The current filter removes custom property definitions (`--variables`), `content`, `text-shadow`, `backdrop-filter`, `padding-top`, and other properties outside its allowed list. Pseudo-class selectors containing colons and some advanced rules may also be filtered. Avoid pasting complex theme CSS directly here.
- `@import`, HTML, and scripts are unsupported. Remote image or font URLs in your CSS may cause the browser source to contact those addresses; installed system fonts need no such request.
- Do not fix the progress fill's `width`, which live statistics update. Use `.progress-fill.done` for completion styles. The page has no `data-minutes` attribute or `.goal-value.done` state for time/completion conditions.

## FAQ

**Q: Why did my style change have no effect?**

A: Refresh the browser source. Confirm that the CSS is in the plugin's **Custom CSS** field, its selector matches an enabled item, and its properties survived filtering. Open the same URL in a local browser and inspect the generated page with developer tools.

**Q: Why have statistics stopped updating?**

A: Check that Obsidian is running, the overlay is enabled, and the port matches the browser source URL. Update the OBS address after changing ports; select another port if the current one is occupied.

**Q: Why is the card cropped?**

A: Increase the browser source width/height and check custom card dimensions. The default 280px card has a 1.1 scale factor; enabling more items increases its required height.

**Q: Can OBS on another computer connect?**

A: The current service listens only on the local loopback address. This setup requires OBS and Obsidian on the same computer.

Back to [User Guide](USER_GUIDE_EN.md#obs-overlay) · [README](../README.md#english)
