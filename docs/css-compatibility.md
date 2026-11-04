# CSS compatibility and component rules

The stylesheet targets the Obsidian version declared in `manifest.json`. Component presentation uses Obsidian theme variables and a normal CSS cascade. The stylesheet contains no `!important` declarations or `:has()` selectors.

## Shared components

Settings tabs, manager page tabs, source tabs, installation type tabs and transfer strategies share one segmented-control definition. Their dimensions and states are controlled by `--bpm-segment-*` variables. The selectors include their actual settings or manager boundary and button element, so Obsidian's desktop and mobile button defaults cannot replace their appearance. Hidden features remain excluded from presentation rules.

Settings use a single icon-bearing navigation menu, with no duplicate brand or tab rail inside the editor. The native settings entry lists the categories with icons and previews of their setting names. Manager page navigation switches to the same menu component when its full rail no longer fits. Measurement temporarily reveals the existing rail; switching layout does not rebuild page content or discard its selected page. Menus and observers use the owning window and are released with the editor.

Card density continues to use `--bpm-item-padding`. Theme cards set this variable locally, so the common `Setting` presentation cannot override their spacing. Close buttons similarly provide their border through `--bpm-control-border` for both desktop and mobile headers.

Temporary tab-label previews are excluded from the label-hiding predicate. Hidden tools and responsive measurement states are scoped to their actual component boundaries. Responsive measurement preserves the existing DOM nodes and event handlers.

## Scrollbars

Obsidian's Chromium and WebKit engines support the native `::-webkit-scrollbar` track and thumb API used here. Tracks retain Obsidian's scrollbar width, radius, border and colour variables, including the active thumb colour. A guarded `@supports` block also retains the 1.2.12 native `scrollbar-width` and `scrollbar-color` contract on engines supporting both properties. Older engines continue to use the themed WebKit rules and floating strip thumbs; they do not depend on those standard properties.

Managed horizontal strips hide their native track and draw an absolutely positioned thumb inside the strip. The thumb appears while hovering, scrolling or dragging. This preserves the available toolbar height and the existing pointer-drag and touch-scroll behavior. Vertical lists retain their native, theme-styled scrollbars.

`scrollbar-gutter: stable` remains an optional layout enhancement. Engines that do not support it use their normal native scrollbar layout; mobile content also retains its explicit content inset and measured scrollbar allowance.

## Wrapper layout fallback

Two overview-toolbar rules flatten plain `div` wrappers with `display: contents`. The wrappers contain no interactive role, label or focus target. The enhancement is inside `@supports (display: contents)`; its preceding rule provides a wrapping flex layout with constrained widths. The fallback preserves accessible controls and avoids horizontal overflow without depending on wrapper flattening.

This is a progressive enhancement, not a claim that every historic engine implements every aspect of `display: contents`. Controls remain in their original DOM hierarchy, preserving event handlers and ancestor-based component styles.

## Other compatibility choices

- Grid row and column spacing use the common `gap` shorthand; no multicolumn layout is required.
- Ribbon order inputs use zero padding and centered text without a redundant `text-indent` reset.
- Disabled Ribbon item names use the basic `text-decoration: line-through` form. Line thickness follows the engine and theme; the newer thickness override is unnecessary.

## Verification boundaries

The CSS regression suite checks the normal cascade for selected, hover, hidden, measurement and compact states; representative native desktop/mobile button and input rules; component spacing; the flex fallback; and native-track suppression. These are static component checks.

Native comparison uses the published 1.2.12 stylesheet and current stylesheet on the same rendered DOM in an isolated Obsidian vault. Computed properties and element rectangles are compared across manager pages and settings, including mobile emulation. Intended additions such as the compact navigation and Save button are reviewed separately. Neither this comparison nor the automated suite establishes complete coverage of mobile hardware, older Obsidian releases or third-party themes.
